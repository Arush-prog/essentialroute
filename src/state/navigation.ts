import { formatDistance, haversine, projector } from '../lib/geo';
import { startLocation, stopLocation } from '../hooks/useGeolocation';
import type { EvaluatedRoute, LatLon, RouteStep } from '../types';
import { computeRoute } from './actions';
import { flyTo, getState, setState, subscribe, toast, type AppState, type NavProgress } from './store';

/**
 * TURN-BY-TURN NAVIGATION
 * - 'live': follows the device GPS. Progress, the next turn and the remaining distance are measured
 *   by snapping each GPS fix onto the selected route. Remaining time = engine duration scaled by the
 *   remaining share of the route (free-flow estimate — no live traffic).
 * - Off the route (or starting away from it) → flood-aware re-route from the current position.
 * - 'preview': step through the turns without GPS (useful for demos and planning).
 * Voice prompts use the phone's built-in speech engine (no network); the screen is kept awake.
 */

interface Geom {
  routeId: string;
  coords: [number, number][];
  cum: number[];
  total: number;
  stepAlong: number[];
}

let geom: Geom | null = null;
let lastIdx = 0;
let offCount = 0;
/** true once the user has actually been on the route; until then a start point they chose is kept */
let joined = false;
let lastReroute = 0;
const announced = new Map<number, Set<'far' | 'near'>>();

export function selectedRoute(s: AppState = getState()): EvaluatedRoute | null {
  const plan = s.route.data;
  if (!plan) return null;
  return plan.routes.find((r) => r.id === s.selectedRouteId) ?? plan.routes[plan.recommendedIndex] ?? null;
}

function buildGeom(r: EvaluatedRoute): Geom {
  const cum = [0];
  for (let i = 1; i < r.coords.length; i++) cum.push(cum[i - 1] + haversine({ lat: r.coords[i - 1][0], lon: r.coords[i - 1][1] }, { lat: r.coords[i][0], lon: r.coords[i][1] }));
  const g: Geom = { routeId: r.id, coords: r.coords, cum, total: cum[cum.length - 1] || 1, stepAlong: [] };
  let from = 0;
  for (const st of r.steps) {
    const hit = locate(g, { lat: st.location[0], lon: st.location[1] }, from, g.coords.length - 1);
    g.stepAlong.push(hit.along);
    from = Math.max(0, hit.idx - 1);
  }
  return g;
}

/** Nearest point on the route polyline (within an index window): distance along the route and offset. */
function locate(g: Geom, p: LatLon, from: number, to: number): { along: number; off: number; idx: number } {
  const pr = projector(p.lat);
  const px = pr.x(p.lon);
  const py = pr.y(p.lat);
  let best = { along: 0, off: Infinity, idx: from };
  const a = Math.max(1, from);
  const b = Math.min(g.coords.length - 1, to);
  if (g.coords.length === 1) return { along: 0, off: haversine(p, { lat: g.coords[0][0], lon: g.coords[0][1] }), idx: 0 };
  for (let i = a; i <= b; i++) {
    const ax = pr.x(g.coords[i - 1][1]);
    const ay = pr.y(g.coords[i - 1][0]);
    const dx = pr.x(g.coords[i][1]) - ax;
    const dy = pr.y(g.coords[i][0]) - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const off = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (off < best.off) best = { along: g.cum[i - 1] + t * (g.cum[i] - g.cum[i - 1]), off, idx: i };
  }
  return best;
}

/* ---------------- voice ---------------- */

function spokenDistance(m: number) {
  if (m >= 1000) return `${(Math.round(m / 100) / 10).toString()} kilometres`;
  return `${Math.max(50, Math.round(m / 50) * 50)} metres`;
}

export function phrase(st: RouteStep | undefined): string {
  if (!st) return '';
  const t = st.instruction;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

export function speak(text: string, force = false) {
  if (!force && !getState().nav.voice) return;
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(text);
    const voice = synth.getVoices().find((v) => v.lang === 'en-IN') ?? synth.getVoices().find((v) => v.lang.startsWith('en'));
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? 'en-IN';
    u.rate = 1;
    synth.cancel();
    synth.speak(u);
  } catch {
    /* speech unavailable — the on-screen banner still shows every instruction */
  }
}

/* ---------------- keep the screen awake ---------------- */

let wakeLock: { release: () => Promise<void> } | null = null;
async function lockScreen() {
  try {
    const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (wl && !wakeLock) wakeLock = await wl.request('screen');
  } catch {
    wakeLock = null;
  }
}
function unlockScreen() {
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && getState().nav.active && getState().nav.mode === 'live') {
      wakeLock = null; // the browser releases the lock when the page is hidden
      void lockScreen();
    }
  });
}

/* ---------------- start / stop ---------------- */

export function startNavigation() {
  const s = getState();
  const r = selectedRoute(s);
  if (!r) return;
  if (r.exposure.blocked) {
    toast('This route crosses an impassable flood zone. Choose the safe route first.', 'warn');
    return;
  }
  geom = buildGeom(r);
  lastIdx = 0;
  offCount = 0;
  joined = s.originMode === 'live';
  announced.clear();
  setState({
    nav: { ...s.nav, active: true, mode: 'live', routeId: r.id, step: 0, progress: null, rerouting: false, arrived: false, demo: false, startedAt: Date.now() },
    follow: true,
    searchOpen: false,
    selectedService: null,
    tab: 'map',
    sheetSnap: 'peek',
  });
  startLocation();
  void lockScreen();
  const fix = getState().geo.fix;
  const chosenStart = s.originMode === 'fixed' && s.origin ? s.origin : null;
  if (chosenStart && (!fix || haversine(fix, chosenStart) > 300)) {
    // the user picked a start point somewhere else: keep their route, follow them once they reach it
    if (fix) onFix();
    toast(`Route starts at ${chosenStart.name}. Guidance follows you once you reach it.`);
    setTimeout(() => {
      if (getState().nav.active) flyTo(chosenStart.lat, chosenStart.lon, 16);
    }, 80);
  } else if (fix) {
    onFix();
    // after the navigation screen has rendered, so the camera knows where the banners are
    setTimeout(() => {
      const f = getState().geo.fix;
      if (f && getState().nav.active) flyTo(f.lat, f.lon, 17);
    }, 80);
  } else toast('Waiting for GPS…');
  const first = r.steps.find((st) => st.type !== 'depart') ?? r.steps[0];
  speak(`Starting navigation to ${s.destination?.name ?? 'your destination'}. ${first ? `Then ${phrase(first)}.` : ''}`);
}

export function startPreview() {
  const s = getState();
  const r = selectedRoute(s);
  if (!r) return;
  geom = buildGeom(r);
  setState({ nav: { ...s.nav, active: true, mode: 'preview', routeId: r.id, step: 0, progress: null, rerouting: false, arrived: false, demo: false }, follow: false, tab: 'map', sheetSnap: 'peek', searchOpen: false });
  goToStep(0);
}

export function goToStep(i: number) {
  const r = selectedRoute();
  if (!r || !r.steps.length) return;
  const step = Math.max(0, Math.min(r.steps.length - 1, i));
  setState((s) => ({ nav: { ...s.nav, step } }));
  const st = r.steps[step];
  flyTo(st.location[0], st.location[1], 17);
}

/* ---------------- demo drive (simulated position, clearly labelled) ---------------- */

let demoTimer: ReturnType<typeof setInterval> | undefined;

function pointAt(g: Geom, along: number): { lat: number; lon: number; bearing: number } {
  let i = g.cum.findIndex((c) => c >= along);
  if (i <= 0) i = Math.min(1, g.coords.length - 1);
  const a = g.coords[i - 1];
  const b = g.coords[i];
  const seg = g.cum[i] - g.cum[i - 1] || 1;
  const t = Math.max(0, Math.min(1, (along - g.cum[i - 1]) / seg));
  const br = (Math.atan2((b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180), b[0] - a[0]) * 180) / Math.PI;
  return { lat: a[0] + (b[0] - a[0]) * t, lon: a[1] + (b[1] - a[1]) * t, bearing: (br + 360) % 360 };
}

/**
 * Plays the selected route with a SIMULATED position so navigation can be shown indoors, where phone
 * GPS is weak. Real GPS is switched off for the demo and the screen says "DEMO DRIVE · simulated".
 * Flood/rain re-routing still works: if the route changes mid-demo, the demo continues on the new one.
 */
export function startDemoDrive() {
  const s = getState();
  const r = selectedRoute(s);
  if (!r) return;
  if (r.exposure.blocked) {
    toast('This route crosses an impassable flood zone. Choose the safe route first.', 'warn');
    return;
  }
  stopLocation();
  clearInterval(demoTimer);
  geom = buildGeom(r);
  lastIdx = 0;
  offCount = 0;
  joined = true;
  announced.clear();
  let routeId = r.id;
  let along = 0;
  setState({
    nav: { ...getState().nav, active: true, mode: 'live', routeId: r.id, step: 0, progress: null, rerouting: false, arrived: false, demo: true, startedAt: Date.now() },
    follow: true,
    searchOpen: false,
    selectedService: null,
    tab: 'map',
    sheetSnap: 'peek',
  });
  const tickMs = 500;
  const step = () => {
    const st = getState();
    if (!st.nav.active || !st.nav.demo) return clearInterval(demoTimer);
    const cur = selectedRoute(st);
    if (!cur) return;
    if (cur.id !== routeId) {
      // route changed (flood/rain update): continue from the nearest point on the new route
      const fix = st.geo.fix;
      routeId = cur.id;
      const g = buildGeom(cur);
      along = fix ? locate(g, fix, 1, g.coords.length - 1).along : 0;
    }
    const g = geom && geom.routeId === cur.id ? geom : buildGeom(cur);
    // ~3 minutes for the whole trip whatever its length, never slower than 50 km/h
    const speed = Math.max(14, g.total / 180);
    along = Math.min(g.total, along + (speed * tickMs) / 1000);
    const p = pointAt(g, along);
    setState({ geo: { status: 'active', watching: true, fix: { lat: p.lat, lon: p.lon, accuracy: 5, timestamp: Date.now(), heading: p.bearing, speed, simulated: true } } });
    if (along >= g.total) clearInterval(demoTimer);
  };
  step();
  demoTimer = setInterval(step, tickMs);
  void lockScreen();
  setTimeout(() => {
    const f = getState().geo.fix;
    if (f && getState().nav.active) flyTo(f.lat, f.lon, 17);
  }, 80);
  speak(`Demo drive to ${s.destination?.name ?? 'your destination'}. Position is simulated.`);
}

export function stopNavigation() {
  const wasDemo = getState().nav.demo;
  clearInterval(demoTimer);
  if (wasDemo) setState({ geo: { status: 'idle', fix: null, watching: false } });
  unlockScreen();
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  geom = null;
  setState((s) => ({ nav: { ...s.nav, active: false, progress: null, rerouting: false, arrived: false, demo: false }, follow: false, sheetSnap: 'half' }));
}

export function toggleVoice() {
  const on = !getState().nav.voice;
  setState((s) => ({ nav: { ...s.nav, voice: on } }));
  if (on) speak('Voice guidance on', true);
  else window.speechSynthesis?.cancel();
}

/* ---------------- live progress ---------------- */

function reroute(reason: string) {
  const s = getState();
  const fix = s.geo.fix;
  if (!fix || !s.destination) return;
  lastReroute = Date.now();
  offCount = 0;
  joined = true;
  setState((st) => ({
    nav: { ...st.nav, rerouting: true },
    origin: { id: 'gps', name: 'My location', context: `GPS ±${Math.round(fix.accuracy)} m`, lat: fix.lat, lon: fix.lon, source: 'gps' },
    originMode: 'live',
  }));
  toast(reason);
  speak('Rerouting.');
  void computeRoute({ fit: false, silent: true });
}

function onFix() {
  const s = getState();
  const fix = s.geo.fix;
  // after arrival nothing moves, re-routes or speaks until the user taps Done
  if (!s.nav.active || s.nav.mode !== 'live' || !fix || s.nav.arrived) return;
  const r = selectedRoute(s);
  if (!r) return;
  if (!geom || geom.routeId !== r.id) {
    geom = buildGeom(r);
    lastIdx = 0;
    announced.clear();
  }
  const g = geom;
  let hit = locate(g, fix, lastIdx - 30, lastIdx + 600);
  if (hit.off > 60) hit = locate(g, fix, 1, g.coords.length - 1);
  lastIdx = hit.idx;

  // off the route: re-plan from here (the planner is flood-aware, so the new route avoids zones too)
  const tol = Math.max(45, Math.min(fix.accuracy, 80));
  if (fix.accuracy <= 100 && hit.off <= tol) joined = true;
  if (fix.accuracy <= 100 && hit.off > tol) offCount++;
  else offCount = 0;
  const farAtStart = hit.off > 300 && fix.accuracy <= 150;
  if (joined && !s.nav.demo && !s.nav.rerouting && Date.now() - lastReroute > 12_000 && (farAtStart || offCount >= 2)) {
    reroute(farAtStart && hit.along < 50 ? 'Starting from your current location…' : 'Off route — finding a new safe route…');
  }

  const along = hit.along;
  let next = g.stepAlong.findIndex((a, i) => i > 0 && a > along + 8);
  if (next < 0) next = r.steps.length - 1;
  const toNext = Math.max(0, g.stepAlong[next] - along);
  const remainingM = Math.max(0, g.total - along);
  const remainingS = r.duration * (remainingM / g.total);
  const a = g.coords[Math.max(0, hit.idx - 1)];
  const b = g.coords[Math.min(g.coords.length - 1, hit.idx)];
  const bearing = (Math.atan2((b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180), b[0] - a[0]) * 180) / Math.PI;
  const progress: NavProgress = { along, next, toNext, remainingM, remainingS, offRouteM: hit.off, bearing: (bearing + 360) % 360 };

  const dest = s.destination;
  const arrived = remainingM < 30 || (!!dest && haversine(fix, dest) < 30);
  if (arrived && !s.nav.arrived) {
    onArrive();
    return;
  }
  setState((st) => ({ nav: { ...st.nav, progress } }));
  if (s.nav.arrived) return;

  // voice prompts: once when approaching, once at the turn
  const car = s.travelMode === 'car';
  const far = car ? 450 : 150;
  const near = car ? 70 : 25;
  const st = r.steps[next];
  const done = announced.get(next) ?? new Set();
  if (toNext <= near && !done.has('near')) {
    done.add('near').add('far');
    try {
      navigator.vibrate?.([120, 80, 120]); // Android: a double buzz at the turn
    } catch {
      /* not supported */
    }
    speak(phrase(st).replace(/^./, (c) => c.toUpperCase()) + '.');
  } else if (toNext <= far && toNext > near * 1.5 && !done.has('far')) {
    done.add('far');
    speak(`In ${spokenDistance(toNext)}, ${phrase(st)}.`);
  }
  announced.set(next, done);
}

/** Destination reached: stop moving the camera, celebrate once, keep the summary on screen until Done. */
function onArrive() {
  const s = getState();
  const dest = s.destination;
  clearInterval(demoTimer);
  setState((st) => ({ nav: { ...st.nav, arrived: true, progress: st.nav.progress ? { ...st.nav.progress, remainingM: 0, remainingS: 0, toNext: 0 } : null }, follow: false }));
  if (dest) setTimeout(() => flyTo(dest.lat, dest.lon, 17), 60);
  try {
    navigator.vibrate?.([200, 100, 200, 100, 400]);
  } catch {
    /* not supported */
  }
  speak(`You have arrived at your location${dest ? `, ${dest.name}` : ''}.`);
}

/** Wire navigation to GPS fixes and route changes. Call once at start-up. */
export function initNavigation() {
  let prevFix = getState().geo.fix;
  let prevRoute = selectedRoute()?.id;
  let prevPlan = getState().route.data;
  return subscribe(() => {
    const s = getState();
    if (!s.nav.active) {
      prevFix = s.geo.fix;
      prevRoute = selectedRoute(s)?.id;
      prevPlan = s.route.data;
      return;
    }
    const routeId = selectedRoute(s)?.id;
    if (s.nav.arrived) {
      prevPlan = s.route.data;
      prevRoute = selectedRoute(s)?.id;
      prevFix = s.geo.fix;
      return;
    }
    if (s.route.data !== prevPlan && s.route.status === 'ok') {
      prevPlan = s.route.data;
      const plan = s.route.data!;
      const wasRerouting = s.nav.rerouting;
      setState((st) => ({ nav: { ...st.nav, rerouting: false, routeId: routeId ?? null, step: 0 } }));
      if (!wasRerouting && routeId !== prevRoute && plan.floodCheck.status === 'avoided') speak('Flooding reported ahead. Route updated to avoid it.');
      else if (wasRerouting) speak(plan.floodCheck.status === 'avoided' ? 'New route found. It avoids the flood zones.' : 'New route found.');
    }
    if (s.route.status === 'error' && s.nav.rerouting) setState((st) => ({ nav: { ...st.nav, rerouting: false } }));
    if (routeId !== prevRoute) {
      prevRoute = routeId;
      geom = null;
      onFix();
    }
    if (s.geo.fix !== prevFix) {
      prevFix = s.geo.fix;
      onFix();
    }
  });
}

export const navDistance = (m: number) => (m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : formatDistance(m));
