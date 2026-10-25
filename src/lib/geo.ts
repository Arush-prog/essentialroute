import type { LatLon } from '../types';

const R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export const hav = (a: [number, number], b: [number, number]) =>
  haversine({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] });

/** Destination point given start, bearing (deg) and distance (m). */
export function destination(p: LatLon, bearingDeg: number, distM: number): LatLon {
  const d = distM / R;
  const b = toRad(bearingDeg);
  const lat1 = toRad(p.lat);
  const lon1 = toRad(p.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lon: toDeg(lon2) };
}

/**
 * Local equirectangular projection around a reference latitude (metres).
 * Accurate to well under 0.1% at city scale — adequate for segment/circle tests.
 */
export function projector(refLat: number) {
  const kx = (Math.PI / 180) * R * Math.cos(toRad(refLat));
  const ky = (Math.PI / 180) * R;
  return {
    x: (lon: number) => lon * kx,
    y: (lat: number) => lat * ky,
    lon: (x: number) => x / kx,
    lat: (y: number) => y / ky,
  };
}

/**
 * Portion of segment AB lying inside circle (C, r), as parameters [t0, t1] in [0,1], or null.
 * Coordinates are [lat, lon]. Exact for the planar approximation.
 */
export function segmentCircleClip(
  a: [number, number],
  b: [number, number],
  c: LatLon,
  r: number,
): [number, number] | null {
  const p = projector(c.lat);
  const ax = p.x(a[1]) - p.x(c.lon);
  const ay = p.y(a[0]) - p.y(c.lat);
  const dx = p.x(b[1]) - p.x(a[1]);
  const dy = p.y(b[0]) - p.y(a[0]);
  const A = dx * dx + dy * dy;
  const B = 2 * (ax * dx + ay * dy);
  const C = ax * ax + ay * ay - r * r;
  if (A === 0) return C <= 0 ? [0, 1] : null;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = Math.max(0, (-B - s) / (2 * A));
  const t1 = Math.min(1, (-B + s) / (2 * A));
  return t0 <= t1 ? [t0, t1] : null;
}

/** Shortest distance (m) from a point to a polyline of [lat, lon] pairs — true segment distance. */
export function distanceToLine(p: LatLon, coords: [number, number][]): number {
  if (!coords.length) return Infinity;
  const pr = projector(p.lat);
  const px = pr.x(p.lon), py = pr.y(p.lat);
  let best = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const ax = pr.x(coords[i][1]), ay = pr.y(coords[i][0]);
    if (i === 0) {
      best = Math.hypot(px - ax, py - ay);
      continue;
    }
    const bx = pr.x(coords[i - 1][1]), by = pr.y(coords[i - 1][0]);
    const dx = ax - bx, dy = ay - by;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - bx) * dx + (py - by) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - (bx + t * dx), py - (by + t * dy)));
  }
  return best;
}

export function lerp(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function lineLength(coords: [number, number][]): number {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += hav(coords[i - 1], coords[i]);
  return d;
}

export function inBBox(p: LatLon, b: { south: number; west: number; north: number; east: number }) {
  return p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;
}

export function formatDistance(m: number): string {
  if (!isFinite(m)) return '—';
  if (m < 950) return `${Math.round(m / 10) * 10} m`;
  if (m < 10_000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

export function formatDuration(s: number): string {
  if (!isFinite(s)) return '—';
  const min = Math.round(s / 60);
  if (min < 1) return '<1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export const uid = (p = 'id') => `${p}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
