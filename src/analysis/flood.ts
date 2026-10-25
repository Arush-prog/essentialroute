import { HOTSPOTS } from './rain';
import { lerp, segmentCircleClip, hav } from '../lib/geo';
import type { ActiveZone, EngineRoute, EvaluatedRoute, ExposureSegment, FloodZone, RouteExposure, Severity } from '../types';

/**
 * FLOOD SIMULATION MODEL (documented, deterministic, reproducible)
 *
 * A flood zone is a circle (centre + radius). Severity sets how routing treats roads inside it:
 *
 *   Severity  | Treated as            | Travel-time penalty inside zone | Effective radius
 *   ----------|-----------------------|---------------------------------|-----------------
 *   Low       | passable, slow        | ×1.5                            | ×1.00
 *   Moderate  | passable, high risk   | ×3                              | ×1.00
 *   High      | impassable            | —                               | ×1.00
 *   Extreme   | impassable            | —                               | ×1.35 (spread)
 *
 * A road segment is "affected" when the segment geometrically intersects the circle
 * (exact segment–circle clipping in a local planar projection). Exposure = length of the
 * clipped portions. These parameters are illustrative scenario settings, not hydrological
 * measurements.
 */
export const SEVERITY: Record<Severity, { label: string; blocked: boolean; penalty: number; radiusMul: number; hint: string }> = {
  low: { label: 'Low', blocked: false, penalty: 1.5, radiusMul: 1, hint: 'Passable with care · travel-time ×1.5 inside zones' },
  moderate: { label: 'Moderate', blocked: false, penalty: 3, radiusMul: 1, hint: 'High risk · travel-time ×3 inside zones, avoided where possible' },
  high: { label: 'High', blocked: true, penalty: Infinity, radiusMul: 1, hint: 'Roads inside zones treated as impassable' },
  extreme: { label: 'Extreme', blocked: true, penalty: Infinity, radiusMul: 1.35, hint: 'Impassable · zones spread 35% wider' },
};

export const SEVERITY_ORDER: Severity[] = ['low', 'moderate', 'high', 'extreme'];

export function resolveZones(simulated: FloodZone[], simEnabled: boolean, severity: Severity, reports: FloodZone[], includeReports: boolean, rain: FloodZone[] = []): ActiveZone[] {
  const out: ActiveZone[] = [];
  for (const z of rain) {
    const sev = z.severity ?? 'low';
    const s = SEVERITY[sev];
    out.push({ ...z, severity: sev, effectiveRadiusM: z.radiusM * s.radiusMul, blocked: s.blocked, penalty: s.penalty });
  }
  if (simEnabled) {
    for (const z of simulated) {
      const s = SEVERITY[severity];
      out.push({ ...z, severity, effectiveRadiusM: z.radiusM * s.radiusMul, blocked: s.blocked, penalty: s.penalty });
    }
  }
  if (includeReports) {
    for (const z of reports) {
      const sev = z.severity ?? 'high';
      const s = SEVERITY[sev];
      out.push({ ...z, severity: sev, effectiveRadiusM: z.radiusM * s.radiusMul, blocked: s.blocked, penalty: s.penalty });
    }
  }
  return out;
}

/** Quick bounding test to skip zones far from a route. */
function routeBBox(coords: [number, number][]) {
  let s = 90, w = 180, n = -90, e = -180;
  for (const [la, lo] of coords) {
    if (la < s) s = la;
    if (la > n) n = la;
    if (lo < w) w = lo;
    if (lo > e) e = lo;
  }
  return { s, w, n, e };
}

export function evaluateExposure(route: EngineRoute, zones: ActiveZone[]): RouteExposure {
  const segments: ExposureSegment[] = [];
  let exposedM = 0;
  let blockedM = 0;
  let penaltySeconds = 0;
  const zoneIds = new Set<string>();
  const avgSpeed = route.duration > 0 ? route.distance / route.duration : 10; // m/s
  const bb = routeBBox(route.coords);

  for (const z of zones) {
    const padLat = z.effectiveRadiusM / 111_000;
    const padLon = padLat / Math.cos((z.lat * Math.PI) / 180);
    if (z.lat + padLat < bb.s || z.lat - padLat > bb.n || z.lon + padLon < bb.w || z.lon - padLon > bb.e) continue;

    let current: [number, number][] | null = null;
    let zoneExposure = 0;
    for (let i = 1; i < route.coords.length; i++) {
      const a = route.coords[i - 1];
      const b = route.coords[i];
      const clip = segmentCircleClip(a, b, z, z.effectiveRadiusM);
      if (!clip) {
        if (current) {
          segments.push({ zoneId: z.id, kind: z.kind, blocked: z.blocked, coords: current });
          current = null;
        }
        continue;
      }
      const p0 = lerp(a, b, clip[0]);
      const p1 = lerp(a, b, clip[1]);
      zoneExposure += hav(p0, p1);
      if (current && clip[0] === 0) current.push(p1);
      else {
        if (current) segments.push({ zoneId: z.id, kind: z.kind, blocked: z.blocked, coords: current });
        current = [p0, p1];
      }
      if (clip[1] < 1) {
        segments.push({ zoneId: z.id, kind: z.kind, blocked: z.blocked, coords: current });
        current = null;
      }
    }
    if (current) segments.push({ zoneId: z.id, kind: z.kind, blocked: z.blocked, coords: current });
    if (zoneExposure > 0) {
      zoneIds.add(z.id);
      exposedM += zoneExposure;
      if (z.blocked) blockedM += zoneExposure;
      else penaltySeconds += (zoneExposure / avgSpeed) * (z.penalty - 1);
    }
  }
  const blocked = blockedM > 0;
  return {
    exposedM,
    blockedM,
    zoneIds: [...zoneIds],
    blocked,
    segments,
    score: blocked ? Infinity : route.duration + penaltySeconds,
  };
}

export function evaluate(routes: EngineRoute[], zones: ActiveZone[]): EvaluatedRoute[] {
  return routes.map((r) => ({ ...r, exposure: evaluateExposure(r, zones) }));
}

export function pointInZone(p: { lat: number; lon: number }, z: ActiveZone): boolean {
  return hav([p.lat, p.lon], [z.lat, z.lon]) <= z.effectiveRadiusM;
}

/**
 * Illustrative scenario: approximate locations of junctions widely reported in news coverage
 * as recurrent monsoon waterlogging spots. Positions are approximate and this is a SIMULATED
 * scenario — it says nothing about current conditions.
 */
export const PRESET_HOTSPOTS: Omit<FloodZone, 'id' | 'createdAt' | 'kind'>[] = HOTSPOTS.map(({ label, lat, lon, radiusM }) => ({ label, lat, lon, radiusM }));
