import { destination, distanceToLine, formatDistance, formatDuration, haversine } from '../lib/geo';
import { requestRoutes } from '../services/routing';
import type { ActiveZone, EvaluatedRoute, GraphPath, LatLon, Place, RoutePlan, TravelMode } from '../types';
import { evaluate, pointInZone } from './flood';
import { aStar, floodWeights, snap, type RoadGraph } from './graph';
import { ServiceError } from '../lib/http';

/**
 * FLOOD-AWARE ROUTE PLANNING — recommends the SAFEST route, not just the fastest.
 *
 * 1. Ask the routing engine (OSRM) for the fastest route plus its alternatives.
 * 2. Score every route: blocked if it crosses an impassable zone, otherwise
 *    engine duration + travel-time penalty for the length inside passable zones.
 * 3. If no alternative is clean, genuinely re-route: waypoints on a ring around the first
 *    flood zone the fastest route crosses (12 bearings, off the flooded corridor, ranked by
 *    detour length), request engine routes through them, re-score. A second stage handles a
 *    second zone. While this runs, the Mumbai major-road graph is loaded in the background.
 * 4. Still not clean → A* on the road graph with flooded roads removed (and passable flood
 *    zones heavily penalised). The A* path is then turned into a REAL engine route by
 *    requesting OSRM through waypoints sampled along it — so distance, time and turn-by-turn
 *    directions all come from the engine, not from us.
 * 5. Ranking: clean routes first (fastest of those, within a sane time cap), then least
 *    exposure, impassable routes last.
 * Every number shown to the user comes from the engine or from these calculations.
 */

const MAX_DETOUR_REQUESTS = 8;
const GRAPH_WAIT_MS = 75_000;
const GUIDE_SPACINGS_M = [1600, 700];

/** Same route = similar length AND same flood exposure AND geometrically close at ¼, ½, ¾ of the way. */
function isDuplicate(a: EvaluatedRoute, b: EvaluatedRoute) {
  if (Math.abs(a.distance - b.distance) / a.distance > 0.01) return false;
  if (Math.abs(a.exposure.exposedM - b.exposure.exposedM) > 10) return false;
  const at = (r: EvaluatedRoute, f: number) => {
    const c = r.coords[Math.floor((r.coords.length - 1) * f)];
    return { lat: c[0], lon: c[1] };
  };
  return [0.25, 0.5, 0.75].every((f) => haversine(at(a, f), at(b, f)) < 120);
}

function firstZoneAlong(route: EvaluatedRoute, zones: ActiveZone[], exclude: Set<string>): ActiveZone | undefined {
  const hit = zones.filter((z) => route.exposure.zoneIds.includes(z.id) && !exclude.has(z.id));
  if (!hit.length) return undefined;
  // order by position of first vertex near the zone along the route
  const idx = (z: ActiveZone) => {
    for (let i = 0; i < route.coords.length; i += 2) {
      if (haversine({ lat: route.coords[i][0], lon: route.coords[i][1] }, z) <= z.effectiveRadiusM + 50) return i;
    }
    return Infinity;
  };
  return hit.sort((a, b) => idx(a) - idx(b))[0];
}

/**
 * Waypoints on a ring around the zone (8 bearings). Points lying on the flooded route's own
 * corridor (directly ahead of / behind the zone) are discarded — routing through them would
 * cross the zone again. Remaining points are ranked by added detour length.
 */
function detourCandidates(z: ActiveZone, from: LatLon, to: LatLon, zones: ActiveZone[], seed: [number, number][], take: number): LatLon[] {
  const ring = z.effectiveRadiusM + Math.max(350, 0.4 * z.effectiveRadiusM);
  const pts: LatLon[] = [];
  for (let b = 0; b < 360; b += 30) pts.push(destination(z, b, ring));
  return pts
    .filter((p) => !zones.some((o) => haversine(p, o) <= o.effectiveRadiusM + 100))
    .filter((p) => distanceToLine(p, seed) >= z.effectiveRadiusM + 150)
    .map((p) => ({ p, cost: haversine(from, p) + haversine(p, to) }))
    .sort((a, b) => a.cost - b.cost)
    .slice(0, take)
    .map((x) => x.p);
}


/**
 * Waypoints along a polyline: one every `spacing` m, and a dense one every ~200 m wherever the
 * path passes within 800 m of a flood zone — that is where the engine (which knows nothing about
 * floods) is most likely to cut a corner back through the water. First/last 250 m are skipped.
 */
function sampleVias(coords: [number, number][], spacing: number, zones: ActiveZone[], cap = 28): LatLon[] {
  const pts = coords.map(([lat, lon]) => ({ lat, lon }));
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += haversine(pts[i - 1], pts[i]);
  const out: LatLon[] = [];
  let acc = 0;
  let sinceLast = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = haversine(pts[i - 1], pts[i]);
    acc += seg;
    sinceLast += seg;
    if (acc <= 250 || total - acc <= 250) continue;
    const near = zones.some((z) => haversine(pts[i], z) <= z.effectiveRadiusM + 800);
    if ((near && sinceLast >= 200) || sinceLast >= spacing) {
      out.push(pts[i]);
      sinceLast = 0;
    }
  }
  if (out.length <= cap) return out;
  const thin: LatLon[] = [];
  for (let k = 0; k < cap; k++) thin.push(out[Math.round((k * (out.length - 1)) / (cap - 1))]);
  return thin;
}

function awaitGraph(p: Promise<RoadGraph>, ms: number, signal?: AbortSignal): Promise<RoadGraph | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ServiceError('Cancelled', 'aborted'));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    p.then(
      (g) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(g);
      },
      () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(null);
      },
    );
  });
}

function zoneNames(ids: string[], zones: ActiveZone[]) {
  const names = ids.map((id) => zones.find((z) => z.id === id)?.label).filter(Boolean) as string[];
  if (!names.length) return 'a flood zone';
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2} more` : names.join(' and ');
}

export interface PlanInput {
  from: Place;
  to: Place;
  mode: TravelMode;
  zones: ActiveZone[];
  signal?: AbortSignal;
  /** Already-built road graph, if any. */
  graph?: RoadGraph | null;
  /** Loader used to fetch the road graph on demand (cached by the caller). */
  loadGraph?: () => Promise<RoadGraph>;
  onProgress?: (msg: string) => void;
}

export async function planRoute({ from, to, mode, zones, signal, graph, loadGraph, onProgress }: PlanInput): Promise<RoutePlan> {
  onProgress?.('Requesting routes…');
  const engine = await requestRoutes({ points: [from, to], mode, alternatives: true, signal });
  const routes = evaluate(engine, zones);
  const baseline = routes[0];
  let detourAttempts = 0;
  let graphPath: GraphPath | undefined;

  const clean = (r: EvaluatedRoute) => r.exposure.exposedM === 0;
  // a clean route is only preferred while it is a sane length of trip (≤3× the fastest, or +30 min)
  const cap = Math.max(baseline.duration * 3, baseline.duration + 1800);
  const tier = (r: EvaluatedRoute) => (r.exposure.blocked ? 2 : clean(r) && r.duration <= cap ? 0 : 1);
  const rank = (a: EvaluatedRoute, b: EvaluatedRoute) => {
    const ta = tier(a), tb = tier(b);
    if (ta !== tb) return ta - tb;
    if (ta === 0) return a.duration - b.duration;
    if (ta === 2) return a.exposure.blockedM - b.exposure.blockedM;
    return a.exposure.score - b.exposure.score;
  };

  const plan = (status: RoutePlan['floodCheck']['status'], reason: string, message: string): RoutePlan => ({
    requestedAt: Date.now(),
    from,
    to,
    mode,
    routes: [...routes].sort(rank),
    recommendedIndex: 0,
    baselineId: baseline.id,
    reason,
    floodCheck: { zonesConsidered: zones.length, status, detourAttempts, message },
    graphPath,
  });

  if (!zones.length) {
    return plan('no-zones', 'Fastest route returned by the routing engine. Times are free-flow estimates — no live traffic data.', 'No flood zones active.');
  }
  if (clean(baseline)) {
    return plan('clear', 'Fastest route, and it does not cross any active flood zone.', `Checked against ${zones.length} active zone${zones.length > 1 ? 's' : ''}.`);
  }

  // an endpoint inside an impassable zone cannot be avoided by any route — don't waste requests
  const startBlocked = zones.some((z) => z.blocked && pointInZone(from, z));
  const endBlocked = zones.some((z) => z.blocked && pointInZone(to, z));
  const endpointBlocked = startBlocked || endBlocked;

  let graphP: Promise<RoadGraph> | null = graph ? Promise.resolve(graph) : null;
  const wantGraph = () => {
    if (!graphP && loadGraph) {
      graphP = loadGraph();
      graphP.catch(() => undefined);
    }
    return graphP;
  };

  const pushUnique = (ev: EvaluatedRoute) => {
    if (!routes.some((x) => isDuplicate(x, ev))) routes.push(ev);
  };

  if (!routes.some(clean) && !endpointBlocked) {
    wantGraph(); // start (or reuse) the road network download right away

    const ringStage = async () => {
    const tried = new Set<string>();
    let seed: EvaluatedRoute = baseline;
    let fixedVias: LatLon[] = [];
    for (let stage = 0; stage < 2 && detourAttempts < MAX_DETOUR_REQUESTS; stage++) {
      const z = firstZoneAlong(seed, zones, tried);
      if (!z) break;
      tried.add(z.id);
      const vias = detourCandidates(z, from, to, zones, seed.coords, stage === 0 ? 4 : 2);
      let bestStage: EvaluatedRoute | null = null;
      for (const v of vias) {
        if (detourAttempts >= MAX_DETOUR_REQUESTS) break;
        detourAttempts++;
        onProgress?.(`Testing detour ${detourAttempts} around ${z.label}…`);
        const viaList = [...fixedVias, v].sort((a, b) => haversine(from, a) - haversine(from, b));
        try {
          const [r] = await requestRoutes({ points: [from, ...viaList, to], mode, alternatives: false, signal });
          const [ev] = evaluate([r], zones);
          pushUnique(ev);
          if (!ev.exposure.zoneIds.includes(z.id) && (!bestStage || ev.exposure.score < bestStage.exposure.score || (bestStage.exposure.blocked && !ev.exposure.blocked))) bestStage = ev;
          if (clean(ev)) break;
        } catch (e) {
          if ((e as { kind?: string }).kind === 'aborted') throw e;
        }
      }
      if (routes.some(clean) || !bestStage) break;
      seed = bestStage;
      fixedVias = bestStage.via ?? [];
    }

    };

    const graphStage = async () => {
    if (wantGraph()) {
      onProgress?.(graph ? 'Searching for a flood-free path…' : 'Loading the Mumbai road network to find a flood-free path (first time only)…');
      const g = graph ?? (await awaitGraph(graphP!, GRAPH_WAIT_MS, signal));
      if (g) {
        const w = floodWeights(g, zones, true).weight;
        const res = aStar(g, snap(g, from, 1500), snap(g, to, 1500), w);
        if (res) {
          const gCoords = res.path.map((i) => [g.lat[i], g.lon[i]] as [number, number]);
          graphPath = { coords: gCoords, distance: res.length };
          for (const spacing of GUIDE_SPACINGS_M) {
            const vias = sampleVias(gCoords, spacing, zones);
            if (!vias.length) break;
            detourAttempts++;
            onProgress?.('Building a drivable route along the flood-free path…');
            try {
              const [r] = await requestRoutes({ points: [from, ...vias, to], mode, alternatives: false, signal, viaOrigin: 'graph' });
              const [ev] = evaluate([r], zones);
              pushUnique(ev);
              if (clean(ev)) break;
            } catch (e) {
              if ((e as { kind?: string }).kind === 'aborted') throw e;
            }
          }
        }
      }
    }
    };

    // With the road graph already in memory the graph search is fast and deterministic, so try it first.
    // Otherwise run the quick waypoint detours while the graph downloads, then fall back to the graph.
    const order = graph ? [graphStage, ringStage] : [ringStage, graphStage];
    for (const stage of order) {
      if (routes.some(clean)) break;
      await stage();
    }
  }

  const ranked = [...routes].sort(rank);
  const best = ranked[0];
  if (!best.exposure.blocked) {
    if (clean(best)) graphPath = undefined; // a real engine route exists; no need for the raw graph line
    const dT = best.duration - baseline.duration;
    const dD = best.distance - baseline.distance;
    const sign = (n: number) => (n >= 0 ? '+' : '−');
    const cost = `${sign(dT)}${formatDuration(Math.abs(dT))}, ${sign(dD)}${formatDistance(Math.abs(dD))}`;
    const names = zoneNames(baseline.exposure.zoneIds, zones);
    const was = `The fastest route (${formatDuration(baseline.duration)}) crosses ${names} — ${formatDistance(baseline.exposure.exposedM)} of ${baseline.exposure.blocked ? 'impassable' : 'flooded'} road.`;
    const how = best.origin === 'graph' ? 'built along a flood-free path found on the road network' : best.origin === 'detour' ? 'found by re-routing around the flooded area' : 'an alternative route from the routing engine';
    if (clean(best) && best.id !== baseline.id) {
      return plan('avoided', `Safest route. ${was} This one avoids every flood zone (${cost}).`, `Clean route — ${how}${detourAttempts ? ` after ${detourAttempts} engine request${detourAttempts > 1 ? 's' : ''}` : ''}.`);
    }
    return plan(
      'penalised',
      `No route fully avoids the flooded area. ${best.id === baseline.id ? 'The fastest route is also the least exposed' : 'This is the least exposed'}: ${formatDistance(best.exposure.exposedM)} through passable (low/moderate) zones (${cost}). Drive with great caution.`,
      `No fully clean route found${detourAttempts ? ` after ${detourAttempts} attempt${detourAttempts > 1 ? 's' : ''}` : ''}.`,
    );
  }

  // every route is blocked: show the raw road-graph path only if one exists
  if (!graphPath && graph && !endpointBlocked) {
    const res = aStar(graph, snap(graph, from, 1500), snap(graph, to, 1500), floodWeights(graph, zones, true).weight);
    if (res) graphPath = { coords: res.path.map((i) => [graph.lat[i], graph.lon[i]] as [number, number]), distance: res.length };
  }
  if (graphPath) {
    return plan(
      'no-clean-route',
      'The routing engine could not build a drivable route around the impassable zones. A path on the major-road graph that avoids them is shown in green (approximate).',
      `Graph path: ${formatDistance(graphPath.distance)} on major roads (ignores one-way rules; no travel time estimate).`,
    );
  }
  return plan(
    'no-clean-route',
    `Every route found crosses an impassable flood zone. The least-affected route is shown for reference only — do not rely on it.`,
    endpointBlocked
      ? 'Your start or destination lies inside an impassable zone — no route can avoid it.'
      : `No flood-free route exists on the road network we checked${detourAttempts ? ` (${detourAttempts} attempts)` : ''}. Consider postponing travel.`,
  );
}
