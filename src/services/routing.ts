import { ENDPOINTS } from '../config';
import { fetchJson, ServiceError } from '../lib/http';
import { uid } from '../lib/geo';
import type { EngineRoute, LatLon, RouteStep, TravelMode } from '../types';

/**
 * OSRM-compatible routing provider. Any server speaking the OSRM v1 HTTP API can be
 * plugged in via ENDPOINTS.routing. Durations are the engine's free-flow estimates —
 * no live-traffic source is integrated.
 */

interface OsrmManeuver {
  type: string;
  modifier?: string;
  location: [number, number];
  exit?: number;
}
interface OsrmStep {
  maneuver: OsrmManeuver;
  name: string;
  ref?: string;
  distance: number;
  duration: number;
  rotary_name?: string;
  destinations?: string;
}
interface OsrmRoute {
  geometry: { coordinates: [number, number][] };
  distance: number;
  duration: number;
  legs: { steps: OsrmStep[] }[];
}
interface OsrmResponse {
  code: string;
  message?: string;
  routes?: OsrmRoute[];
}

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0] ?? 'th'}`;

export function describeStep(s: OsrmStep): string {
  const road = s.name || s.ref || '';
  const on = road ? ` onto ${road}` : '';
  const m = s.maneuver;
  const dir = m.modifier ? m.modifier.replace('uturn', 'U-turn') : '';
  switch (m.type) {
    case 'depart':
      return `Head ${road ? `along ${road}` : 'off'}`;
    case 'arrive':
      return 'Arrive at destination';
    case 'turn':
    case 'end of road':
      return dir === 'straight' ? `Continue straight${on}` : `Turn ${dir}${on}`;
    case 'new name':
    case 'continue':
      return `Continue${dir && dir !== 'straight' ? ` ${dir}` : ''}${on}`;
    case 'merge':
      return `Merge ${dir}${on}`;
    case 'on ramp':
      return `Take the ramp${dir ? ` on the ${dir}` : ''}${on}`;
    case 'off ramp':
      return `Take the exit${dir ? ` on the ${dir}` : ''}${on}`;
    case 'fork':
      return `Keep ${dir}${on}`;
    case 'roundabout':
    case 'rotary':
    case 'exit roundabout':
    case 'exit rotary':
      return m.exit ? `At the roundabout, take the ${ordinal(m.exit)} exit${on}` : `Go through the roundabout${on}`;
    case 'roundabout turn':
      return `At the roundabout, turn ${dir}${on}`;
    case 'notification':
      return `Continue${on}`;
    default:
      return `${dir ? `Go ${dir}` : 'Continue'}${on}`;
  }
}

function parse(r: OsrmRoute, provider: string, origin: EngineRoute['origin'], via?: LatLon[]): EngineRoute {
  const steps: RouteStep[] = r.legs
    .flatMap((l) => l.steps)
    .filter((s, i, arr) => !(s.maneuver.type === 'arrive' && i < arr.length - 1)) // drop intermediate arrivals at via points
    .map((s) => ({
      instruction: describeStep(s),
      distance: s.distance,
      duration: s.duration,
      location: [s.maneuver.location[1], s.maneuver.location[0]] as [number, number],
      type: s.maneuver.type,
      modifier: s.maneuver.modifier,
      road: s.name || s.ref || undefined,
      exit: s.maneuver.exit,
    }));
  return {
    id: uid('rt'),
    coords: r.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]),
    distance: r.distance,
    duration: r.duration,
    steps,
    provider,
    via,
    origin,
  };
}

export interface RouteRequest {
  points: LatLon[]; // origin, [via…], destination
  mode: TravelMode;
  alternatives?: boolean;
  signal?: AbortSignal;
  /** Tag for routes built through intermediate waypoints (default 'detour'). */
  viaOrigin?: EngineRoute['origin'];
}

export async function requestRoutes({ points, mode, alternatives = true, signal, viaOrigin = 'detour' }: RouteRequest): Promise<EngineRoute[]> {
  const coordStr = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const qs = `overview=full&geometries=geojson&steps=true&alternatives=${alternatives && points.length === 2 ? 'true' : 'false'}`;
  let lastErr: unknown;
  for (const base of ENDPOINTS.routing[mode]) {
    const provider = new URL(base).host + (base.includes('routed-') ? ` (${mode})` : '');
    try {
      const res = await fetchJson<OsrmResponse>(`${base}/route/v1/driving/${coordStr}?${qs}`, { signal, timeoutMs: 15_000, cacheMs: 5 * 60_000 });
      if (res.code !== 'Ok' || !res.routes?.length) {
        if (res.code === 'NoRoute') throw new ServiceError('No route exists between these points for this travel mode.', 'data');
        if (res.code === 'NoSegment') throw new ServiceError('One of the points is too far from any road. Try a nearby street.', 'data');
        throw new ServiceError(res.message || `Routing failed (${res.code}).`, 'data');
      }
      const via = points.length > 2 ? points.slice(1, -1) : undefined;
      return res.routes.map((r) => parse(r, provider, via ? viaOrigin : 'engine', via));
    } catch (e) {
      lastErr = e;
      if (e instanceof ServiceError && (e.kind === 'aborted' || e.kind === 'data')) throw e;
      if (e instanceof ServiceError && e.kind === 'http' && e.status === 400) {
        throw new ServiceError('The routing engine could not snap one of the points to a road. Try a nearby street or landmark.', 'data');
      }
      // network/HTTP failure — try next provider
    }
  }
  if (lastErr instanceof ServiceError) throw lastErr;
  throw new ServiceError('Routing service unavailable.', 'network');
}
