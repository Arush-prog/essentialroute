import { ANALYSIS_ZONES, type AnalysisZone } from '../data/places';
import { formatDistance } from '../lib/geo';
import type { ActiveZone, Service, ServiceCategory } from '../types';
import { pointInZone } from './flood';
import { components, dijkstra, floodWeights, nodesWithin, snap, type RoadGraph } from './graph';

/**
 * ACCESSIBILITY ANALYSIS (deterministic graph analysis on the OSM major-road network)
 *
 * For a service category (e.g. hospitals):
 *  • Every service is snapped to the nearest graph node (≤500 m) in the main network component.
 *  • Multi-source Dijkstra from all services gives the shortest road distance from every node
 *    to its nearest service — once on the normal network, once with flood weights applied
 *    (impassable edges removed, passable flooded edges length-penalised).
 *  • Each sample zone is represented by every graph node within its radius. For each zone we
 *    compare the median road distance and the share of nodes that can still reach any service.
 *
 * Status rules:
 *   no-route  — no node in the zone can reach any service of the category under the scenario
 *   reduced   — median distance rises ≥30% (and ≥500 m), or reachable share drops ≥25 points
 *   ok        — otherwise
 * Zones with no graph nodes are reported as "insufficient data", never guessed.
 */

export type ZoneStatus = 'ok' | 'reduced' | 'no-route' | 'no-data';

export interface ZoneResult {
  zone: AnalysisZone;
  status: ZoneStatus;
  nodes: number;
  baseMedianM: number;
  floodMedianM: number;
  baseReach: number; // 0..1
  floodReach: number; // 0..1
  floodedCentre: boolean;
  explanation: string;
}

export interface AccessibilityResult {
  category: ServiceCategory;
  computedAt: number;
  ms: number;
  graphNodes: number;
  graphEdges: number;
  affectedEdges: number;
  blockedEdges: number;
  affectedWays: number;
  servicesTotal: number;
  servicesSnapped: number;
  servicesHarder: Service[];
  zones: ZoneResult[];
  reducedCount: number;
  noRouteCount: number;
  floodedWayNames: string[];
}

const median = (xs: number[]) => {
  if (!xs.length) return Infinity;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function analyseAccessibility(g: RoadGraph, services: Service[], category: ServiceCategory, zones: ActiveZone[]): AccessibilityResult {
  const t0 = performance.now();
  const svc = services.filter((s) => s.category === category);
  const snapped = svc.map((s) => snap(g, s, 500, g.mainComponent));
  const sources = snapped.filter((n) => n >= 0);

  const fw = floodWeights(g, zones);
  const base = dijkstra(g, sources, g.edgeLen);
  const flood = dijkstra(g, sources, fw.weight);

  // services that become harder to reach: inside a zone, or cut off from the main flooded component
  const floodComp = components(g, fw.weight);
  const harder: Service[] = [];
  svc.forEach((s, i) => {
    const node = snapped[i];
    if (node < 0) return;
    const inZone = zones.some((z) => pointInZone(s, z));
    const isolated = floodComp.componentOf[node] !== floodComp.largest;
    if (inZone || isolated) harder.push(s);
  });

  const zoneResults: ZoneResult[] = ANALYSIS_ZONES.map((zone) => {
    const nodes = nodesWithin(g, zone, zone.radiusM).filter((n) => g.componentOf[n] === g.mainComponent);
    const floodedCentre = zones.some((z) => pointInZone(zone, z));
    if (!nodes.length || !sources.length) {
      return { zone, status: 'no-data', nodes: 0, baseMedianM: Infinity, floodMedianM: Infinity, baseReach: 0, floodReach: 0, floodedCentre, explanation: 'No major-road nodes inside this sample zone — not enough data to assess.' };
    }
    const bd = nodes.map((n) => base.dist[n]).filter(isFinite);
    const fd = nodes.map((n) => flood.dist[n]).filter(isFinite);
    const baseReach = bd.length / nodes.length;
    const floodReach = fd.length / nodes.length;
    const baseMedianM = median(bd);
    const floodMedianM = median(fd);
    const label = category === 'hospital' ? 'hospital' : category === 'station' ? 'station' : category === 'clinic' ? 'clinic' : 'emergency service';
    let status: ZoneStatus = 'ok';
    let explanation = `Median road distance to the nearest ${label}: ${formatDistance(baseMedianM)} (unchanged by the scenario).`;
    if (floodReach === 0) {
      status = 'no-route';
      explanation = `None of the ${nodes.length} major-road points in this zone can reach any ${label} once impassable roads are removed${floodedCentre ? ' — the zone centre itself is inside a flood zone' : ''}. Normally ${formatDistance(baseMedianM)}.`;
    } else {
      const rise = floodMedianM - baseMedianM;
      const pct = baseMedianM > 0 ? rise / baseMedianM : 0;
      const reachDrop = baseReach - floodReach;
      if ((pct >= 0.3 && rise >= 500) || reachDrop >= 0.25) {
        status = 'reduced';
        const parts: string[] = [];
        if (rise > 0) parts.push(`median distance to the nearest ${label} rises from ${formatDistance(baseMedianM)} to ${formatDistance(floodMedianM)} (+${Math.round(pct * 100)}%)`);
        if (reachDrop > 0) parts.push(`${Math.round(reachDrop * 100)}% of road points lose any connection`);
        explanation = `${parts.join('; ')}. Alternative paths still exist for ${Math.round(floodReach * 100)}% of points.`;
        explanation = explanation[0].toUpperCase() + explanation.slice(1);
      } else if (rise > 0) {
        explanation = `Median road distance to the nearest ${label} rises slightly: ${formatDistance(baseMedianM)} → ${formatDistance(floodMedianM)}. Alternatives remain.`;
      }
    }
    return { zone, status, nodes: nodes.length, baseMedianM, floodMedianM, baseReach, floodReach, floodedCentre, explanation };
  });

  const wayNames = [...new Set([...fw.affectedWays].map((w) => g.wayNames[w]).filter((x): x is string => !!x))].slice(0, 12);

  return {
    category,
    computedAt: Date.now(),
    ms: Math.round(performance.now() - t0),
    graphNodes: g.nodeCount,
    graphEdges: g.edgeCount,
    affectedEdges: fw.affectedEdges,
    blockedEdges: fw.blockedEdges,
    affectedWays: fw.affectedWays.size,
    servicesTotal: svc.length,
    servicesSnapped: sources.length,
    servicesHarder: harder,
    zones: zoneResults,
    reducedCount: zoneResults.filter((z) => z.status === 'reduced').length,
    noRouteCount: zoneResults.filter((z) => z.status === 'no-route').length,
    floodedWayNames: wayNames,
  };
}
