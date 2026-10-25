import { useEffect, useRef } from 'react';
import { GPS, MUMBAI_BBOX, MUMBAI_CENTER } from '../config';
import { PRESET_HOTSPOTS, resolveZones } from '../analysis/flood';
import { buildRainZones, HOTSPOTS, RAIN_LEVELS, type RainMode } from '../analysis/rain';
import { fetchLiveRain, fetchRadarFrame } from '../services/weather';
import { planRoute } from '../analysis/floodRouting';
import { getLoadedGraph, loadRoadGraph } from '../analysis/network';
import { haversine, uid } from '../lib/geo';
import { ServiceError } from '../lib/http';
import { reverseGeocode } from '../services/geocoding';
import { fetchServices } from '../services/overpass';
import { startLocation } from '../hooks/useGeolocation';
import type { ActiveZone, FloodZone, LatLon, Place, Service, Severity } from '../types';
import { mapRef } from '../map/mapRef';
import { addRecent, fitBounds, flyTo, getState, setState, subscribe, toast, type AppState } from './store';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

/* ---------------- flood zones ---------------- */

let zonesCache: { key: unknown[]; zones: ActiveZone[] } | null = null;
export function activeZones(s: AppState = getState()): ActiveZone[] {
  const key = [s.sim.zones, s.sim.enabled, s.sim.severity, s.reports, s.includeReports, s.rain.zones];
  if (zonesCache && zonesCache.key.every((k, i) => k === key[i])) return zonesCache.zones;
  const zones = resolveZones(s.sim.zones, s.sim.enabled, s.sim.severity, s.reports, s.includeReports, s.rain.zones);
  zonesCache = { key, zones };
  return zones;
}

/* ---------------- rain ---------------- */

const sameZones = (a: FloodZone[], b: FloodZone[]) => a.length === b.length && a.every((z, i) => z.id === b[i].id && z.severity === b[i].severity);

function applyRainZones() {
  const s = getState();
  const zones = buildRainZones(s.rain.mode, s.rain.live.data);
  if (!sameZones(zones, s.rain.zones)) setState((st) => ({ rain: { ...st.rain, zones } }));
}

let rainCtrl: AbortController | null = null;
/** Fetch live rainfall at every waterlogging hotspot (+ city centre) — one request, cached 5 min. */
export async function refreshLiveRain(force = false) {
  const s = getState();
  if (s.rain.live.status === 'loading') return;
  if (!force && s.rain.live.data && Date.now() - s.rain.live.data.fetchedAt < 9 * 60_000) return;
  rainCtrl?.abort();
  const ctrl = new AbortController();
  rainCtrl = ctrl;
  setState((st) => ({ rain: { ...st.rain, live: { status: 'loading', data: st.rain.live.data } } }));
  try {
    const live = await fetchLiveRain([...HOTSPOTS, { lat: MUMBAI_CENTER[0], lon: MUMBAI_CENTER[1] }], ctrl.signal);
    setState((st) => ({ rain: { ...st.rain, live: { status: 'ok', data: live } } }));
  } catch (e) {
    if (ctrl.signal.aborted) return;
    setState((st) => ({ rain: { ...st.rain, live: { status: 'error', data: st.rain.live.data, error: errMsg(e) } } }));
  }
  applyRainZones();
}

export function setRainMode(mode: RainMode) {
  setState((s) => ({ rain: { ...s.rain, mode } }));
  applyRainZones();
  if (mode === 'live') void refreshLiveRain();
  if (mode !== 'off' && mode !== 'live') toast(`Simulating ${RAIN_LEVELS[mode].label.toLowerCase()} rain — not live conditions.`, 'warn');
}

let radarCtrl: AbortController | null = null;
export async function setRadar(on: boolean) {
  setState((s) => ({ rain: { ...s.rain, radar: on } }));
  if (!on) return;
  radarCtrl?.abort();
  const ctrl = new AbortController();
  radarCtrl = ctrl;
  try {
    const frame = await fetchRadarFrame(ctrl.signal);
    if (!frame) toast('Rain radar is not available right now.', 'warn');
    setState((s) => ({ rain: { ...s.rain, radarFrame: frame } }));
  } catch {
    if (!ctrl.signal.aborted) toast('Rain radar could not load.', 'warn');
  }
}

export function addSimZone(p: LatLon, label?: string, radiusM?: number) {
  setState((s) => {
    const n = s.sim.zones.length + 1;
    const zone: FloodZone = { id: uid('sz'), lat: p.lat, lon: p.lon, radiusM: radiusM ?? s.sim.radiusM, label: label ?? `Simulated zone ${n}`, kind: 'simulated', createdAt: Date.now() };
    return { sim: { ...s.sim, enabled: true, zones: [...s.sim.zones, zone] } };
  });
}

export function removeSimZone(id: string) {
  setState((s) => ({ sim: { ...s.sim, zones: s.sim.zones.filter((z) => z.id !== id) } }));
}

export function updateSimZoneRadius(id: string, radiusM: number) {
  setState((s) => ({ sim: { ...s.sim, zones: s.sim.zones.map((z) => (z.id === id ? { ...z, radiusM } : z)) } }));
}

export function loadPresetScenario() {
  const zones: FloodZone[] = PRESET_HOTSPOTS.map((h) => ({ ...h, id: uid('sz'), kind: 'simulated', createdAt: Date.now() }));
  setState((s) => ({ sim: { ...s.sim, enabled: true, zones, placing: false } }));
  fitBounds([[19.0, 72.835], [19.125, 72.892]]);
  toast('Illustrative scenario loaded — simulated, not live conditions.', 'warn');
}

export function resetSimulation() {
  setState((s) => ({ sim: { ...s.sim, enabled: false, zones: [], placing: false }, analysis: { status: 'idle' } }));
  toast('Simulation reset.');
}

export function setSeverity(severity: Severity) {
  setState((s) => ({ sim: { ...s.sim, severity } }));
}

export function addReport(p: LatLon, severity: Severity, note: string) {
  const r: FloodZone = { id: uid('ur'), lat: p.lat, lon: p.lon, radiusM: 250, label: note.trim() || 'Waterlogging reported', kind: 'user-reported', severity, createdAt: Date.now(), note: note.trim() || undefined };
  setState((s) => ({ reports: [r, ...s.reports], reportPlacing: false }));
  toast('Report saved on this device only (unverified).');
}

export function removeReport(id: string) {
  setState((s) => ({ reports: s.reports.filter((r) => r.id !== id) }));
}

/* ---------------- origin / destination ---------------- */

export function setOrigin(p: Place | null) {
  setState({ origin: p, originMode: 'fixed' });
  if (p) {
    addRecent(p);
    if (!getState().destination) flyTo(p.lat, p.lon, 15);
  }
}

export function setDestination(p: Place | null) {
  setState({ destination: p });
  if (p) {
    addRecent(p);
    if (!getState().origin) flyTo(p.lat, p.lon, 15);
  }
}

function placeFromFix(): Place | null {
  const fix = getState().geo.fix;
  if (!fix) return null;
  return { id: 'gps', name: 'My location', context: `GPS ±${Math.round(fix.accuracy)} m`, lat: fix.lat, lon: fix.lon, source: 'gps' };
}

let lastGeocodedAt: LatLon | null = null;
async function nameLiveOrigin(p: LatLon) {
  lastGeocodedAt = p;
  try {
    const r = await reverseGeocode(p);
    const s = getState();
    if (s.originMode === 'live' && s.origin?.source === 'gps') {
      setState({ origin: { ...s.origin, name: `My location · ${r.name}`, context: r.context ?? s.origin.context } });
    }
  } catch {
    /* keep "My location" — coordinates are still exact */
  }
}

/** Switch the origin to live GPS mode (after explicit user action). */
export function useMyLocation() {
  const ok = startLocation();
  if (!ok) return;
  setState({ originMode: 'live', follow: true });
  const p = placeFromFix();
  if (p) {
    setState({ origin: p });
    flyTo(p.lat, p.lon, 15);
    void nameLiveOrigin(p);
  } else {
    setState({ origin: null });
  }
}

/** Freeze the live origin at its current coordinates. */
export function fixOriginHere() {
  const s = getState();
  if (s.origin) setState({ originMode: 'fixed', origin: { ...s.origin, id: `fixed-${Date.now()}`, source: 'map' } });
}

export function swapEnds() {
  const s = getState();
  const o = s.origin && s.originMode === 'live' ? { ...s.origin, id: `fixed-${Date.now()}`, source: 'map' as const } : s.origin;
  setState({ origin: s.destination, destination: o, originMode: 'fixed' });
}

export function clearRoute() {
  abortRoute();
  setState({ destination: null, route: { status: 'idle' }, selectedRouteId: null, routedFrom: null });
}

/* ---------------- routing ---------------- */

let routeCtrl: AbortController | null = null;
function abortRoute() {
  routeCtrl?.abort();
  routeCtrl = null;
}

export async function computeRoute(opts: { fit?: boolean; fitOnChange?: boolean; silent?: boolean } = {}) {
  const s = getState();
  if (!s.origin || !s.destination) return;
  abortRoute();
  const ctrl = new AbortController();
  routeCtrl = ctrl;
  const from = s.origin;
  setState((st) => ({ route: { status: 'loading', data: st.route.data, progress: 'Requesting routes…' } }));
  try {
    const plan = await planRoute({
      from,
      to: s.destination,
      mode: s.travelMode,
      zones: activeZones(),
      graph: getLoadedGraph(),
      loadGraph: loadRoadGraph,
      signal: ctrl.signal,
      onProgress: (msg) => setState((st) => ({ route: { ...st.route, progress: msg } })),
    });
    if (ctrl.signal.aborted) return;
    const rec = plan.routes[plan.recommendedIndex];
    setState({ route: { status: 'ok', data: plan }, selectedRouteId: rec.id, routedFrom: { lat: from.lat, lon: from.lon, at: Date.now() } });
    const prevStatus = s.route.data?.floodCheck.status;
    const statusChanged = prevStatus !== plan.floodCheck.status;
    if (!getState().nav.active && (opts.fitOnChange ? statusChanged : opts.fit !== false)) {
      const all = plan.routes.flatMap((r) => r.coords).concat(plan.graphPath?.coords ?? []);
      let s1 = 90, w = 180, n = -90, e = -180;
      for (const [la, lo] of all) {
        s1 = Math.min(s1, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo);
      }
      if (all.length) {
        setState({ follow: false });
        fitBounds([[s1, w], [n, e]]);
      }
    }
    if (opts.silent) toast('Route updated from your latest position.');
  } catch (e) {
    if (e instanceof ServiceError && e.kind === 'aborted') return;
    if (ctrl.signal.aborted) return;
    setState({ route: { status: 'error', error: errMsg(e) } });
  } finally {
    if (routeCtrl === ctrl) routeCtrl = null;
  }
}

/* ---------------- services ---------------- */

let svcCtrl: AbortController | null = null;
export async function loadServices(scope: 'mumbai' | { south: number; west: number; north: number; east: number } = 'mumbai', force = false) {
  svcCtrl?.abort();
  const ctrl = new AbortController();
  svcCtrl = ctrl;
  const bbox = scope === 'mumbai' ? MUMBAI_BBOX : scope;
  setState((s) => ({ services: { status: 'loading', data: s.services.data } }));
  try {
    const res = await fetchServices(bbox, ctrl.signal, !force);
    let items = res.items;
    if (scope !== 'mumbai') {
      // merge viewport results with what we already have
      const prev = getState().services.data?.items ?? [];
      const ids = new Set(items.map((i) => i.id));
      items = [...items, ...prev.filter((p) => !ids.has(p.id))];
    }
    setState({ services: { status: 'ok', data: { items, fetchedAt: res.fetchedAt, fromCache: res.fromCache, scope: scope === 'mumbai' ? 'Mumbai' : 'Mumbai + searched area' } } });
  } catch (e) {
    if (e instanceof ServiceError && e.kind === 'aborted') return;
    setState((s) => ({ services: { status: 'error', error: errMsg(e), data: s.services.data } }));
  }
}

export function selectService(svc: Service | null, fly = true) {
  setState({ selectedService: svc });
  if (svc && fly) flyTo(svc.lat, svc.lon, 15);
}

export function serviceToPlace(svc: Service): Place {
  return { id: `svc-${svc.id}`, name: svc.name, context: `${svc.subtype}${svc.address ? ' · ' + svc.address : ''}`, lat: svc.lat, lon: svc.lon, source: 'service' };
}

export function routeToService(svc: Service) {
  setDestination(serviceToPlace(svc));
  const s = getState();
  setState({ selectedService: null, tab: 'map' });
  if (!s.origin) {
    if (s.geo.fix) useMyLocation();
    else setState({ searchOpen: true });
  }
}

/* ---------------- analysis ---------------- */

export async function ensureGraph() {
  const g = getLoadedGraph();
  if (g) return g;
  setState({ graph: { status: 'loading', progress: 'Downloading Mumbai major-road network from OpenStreetMap…' } });
  try {
    const graph = await loadRoadGraph();
    setState({ graph: { status: 'ok', data: { nodes: graph.nodeCount, edges: graph.edgeCount, builtAt: graph.builtAt } } });
    return graph;
  } catch (e) {
    setState({ graph: { status: 'error', error: errMsg(e) } });
    throw e;
  }
}

export async function runAnalysis() {
  setState({ analysis: { status: 'loading', progress: 'Preparing road network…' } });
  try {
    const graph = await ensureGraph();
    let svc = getState().services;
    if (svc.status !== 'ok') {
      setState({ analysis: { status: 'loading', progress: 'Loading essential services…' } });
      await loadServices();
      svc = getState().services;
    }
    if (!svc.data?.items.length) throw new Error('Essential-service data is unavailable, so accessibility cannot be calculated.');
    setState({ analysis: { status: 'loading', progress: 'Running Dijkstra on normal and flooded networks…' } });
    await new Promise((r) => setTimeout(r, 30)); // let the UI paint
    const { analyseAccessibility } = await import('../analysis/accessibility');
    const s = getState();
    const result = analyseAccessibility(graph, svc.data.items, s.analysisCategory, activeZones(s));
    setState({ analysis: { status: 'ok', data: result } });
  } catch (e) {
    setState({ analysis: { status: 'error', error: errMsg(e) } });
  }
}

/* ---------------- reactive controller ---------------- */

/** Wires state changes to side effects: auto-routing, live-origin updates, re-scoring on flood changes. */
export function useController() {
  const prev = useRef<AppState>(getState());

  useEffect(() => {
    let zoneTimer: ReturnType<typeof setTimeout> | undefined;
    const unsub = subscribe(() => {
      const s = getState();
      const p = prev.current;
      prev.current = s;

      // 1) endpoints or mode changed → recalc
      const endpointsChanged =
        s.destination !== p.destination ||
        s.travelMode !== p.travelMode ||
        (s.origin !== p.origin && !(s.originMode === 'live' && p.originMode === 'live' && p.origin && s.origin && s.origin.source === 'gps' && p.origin.source === 'gps'));
      if (endpointsChanged) {
        if (s.origin && s.destination) void computeRoute();
        else if (s.route.status !== 'idle' && (!s.destination || !s.origin)) setState({ route: { status: 'idle' }, selectedRouteId: null });
      }

      // 2) flood zones changed → re-plan existing route (debounced)
      const zonesChanged = s.sim.zones !== p.sim.zones || s.sim.enabled !== p.sim.enabled || s.sim.severity !== p.sim.severity || s.reports !== p.reports || s.includeReports !== p.includeReports || s.rain.zones !== p.rain.zones;
      if (zonesChanged) {
        if (s.origin && s.destination && s.route.status !== 'idle') {
          clearTimeout(zoneTimer);
          zoneTimer = setTimeout(() => void computeRoute({ fitOnChange: true }), 700);
        }
        if (s.analysis.status === 'ok') setState({ analysis: { status: 'idle' } });
        // warm the road network in the background so a flood-free path search is instant when needed
        if (activeZones(s).length && !getLoadedGraph()) loadRoadGraph().catch(() => undefined);
      }

      // 3) live GPS origin
      if (s.geo.fix !== p.geo.fix && s.geo.fix && s.originMode === 'live') {
        const fix = s.geo.fix;
        if (!s.origin || s.origin.source !== 'gps') {
          setState({ origin: { id: 'gps', name: 'My location', context: `GPS ±${Math.round(fix.accuracy)} m`, lat: fix.lat, lon: fix.lon, source: 'gps' } });
          flyTo(fix.lat, fix.lon, 15);
          void nameLiveOrigin(fix);
        } else if (haversine(s.origin, fix) > 15) {
          setState({ origin: { ...s.origin, lat: fix.lat, lon: fix.lon, context: s.origin.context?.startsWith('GPS') ? `GPS ±${Math.round(fix.accuracy)} m` : s.origin.context } });
          if (lastGeocodedAt && haversine(lastGeocodedAt, fix) > GPS.reverseGeocodeDistanceM) void nameLiveOrigin(fix);
          const rf = s.routedFrom;
          if (
            !s.nav.active && // during navigation, off-route detection decides when to re-route
            s.destination && rf && s.route.status === 'ok' &&
            fix.accuracy <= GPS.maxAccuracyForRerouteM &&
            haversine(rf, fix) >= GPS.rerouteDistanceM &&
            Date.now() - rf.at >= GPS.rerouteMinIntervalMs
          ) {
            void computeRoute({ fit: false, silent: true });
          }
        }
      }
      if (s.geo.fix !== p.geo.fix && s.geo.fix && s.follow) {
        // navigation keeps a street-level camera; normal follow keeps the user's zoom
        const zoomIn = s.nav.active && (mapRef.current?.getZoom() ?? 17) < 15;
        flyTo(s.geo.fix.lat, s.geo.fix.lon, zoomIn ? 17 : undefined);
      }
    });
    return () => {
      unsub();
      clearTimeout(zoneTimer);
    };
  }, []);
}
