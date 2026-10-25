import { ENDPOINTS, SERVICES_TTL_MS, STORAGE_KEYS } from '../config';
import { fetchJson, readStorage, ServiceError, writeStorage } from '../lib/http';
import type { Service, ServiceCategory } from '../types';

type BBox = { south: number; west: number; north: number; east: number };

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
}

async function overpass(query: string, signal?: AbortSignal, timeoutMs = 60_000): Promise<OsmElement[]> {
  let lastErr: unknown;
  for (const ep of ENDPOINTS.overpass) {
    try {
      const res = await fetchJson<{ elements: OsmElement[] }>(ep, {
        signal,
        timeoutMs,
        init: { method: 'POST', body: `data=${encodeURIComponent(query)}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      });
      return res.elements ?? [];
    } catch (e) {
      lastErr = e;
      if (e instanceof ServiceError && e.kind === 'aborted') throw e;
    }
  }
  throw lastErr instanceof ServiceError ? lastErr : new ServiceError('OpenStreetMap data service (Overpass) is unavailable.', 'network');
}

const bboxStr = (b: BBox) => `${b.south},${b.west},${b.north},${b.east}`;

function classify(t: Record<string, string>): { category: ServiceCategory; subtype: string } | null {
  if (t.amenity === 'hospital' || t.healthcare === 'hospital') return { category: 'hospital', subtype: 'Hospital' };
  if (t.amenity === 'clinic' || t.healthcare === 'clinic') return { category: 'clinic', subtype: 'Clinic' };
  if (t.railway === 'station' || t.railway === 'halt') {
    const metro = t.station === 'subway' || t.station === 'light_rail' || /metro/i.test(t.network ?? '') || /metro/i.test(t.operator ?? '');
    const mono = t.station === 'monorail' || /monorail/i.test(t.network ?? '');
    return { category: 'station', subtype: mono ? 'Monorail station' : metro ? 'Metro station' : 'Railway station' };
  }
  if (t.amenity === 'police') return { category: 'emergency', subtype: 'Police' };
  if (t.amenity === 'fire_station') return { category: 'emergency', subtype: 'Fire station' };
  return null;
}

function address(t: Record<string, string>): string | undefined {
  if (t['addr:full']) return t['addr:full'];
  const parts = [
    t['addr:housenumber'] && t['addr:street'] ? `${t['addr:housenumber']} ${t['addr:street']}` : t['addr:street'],
    t['addr:suburb'] || t['addr:place'],
    t['addr:city'],
    t['addr:postcode'],
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

export interface ServicesResult {
  items: Service[];
  fetchedAt: number;
  bbox: BBox;
  fromCache: boolean;
}

/**
 * Hospitals, clinics, railway/metro stations, police and fire stations from OpenStreetMap.
 * Only tags present in OSM are shown — nothing is invented (no phone numbers, hours or capabilities).
 */
export async function fetchServices(bbox: BBox, signal?: AbortSignal, useCache = true): Promise<ServicesResult> {
  const cacheKey = `${STORAGE_KEYS.services}:${bboxStr(bbox)}`;
  if (useCache) {
    const cached = readStorage<{ items: Service[]; fetchedAt: number } | null>(cacheKey, null);
    if (cached && Date.now() - cached.fetchedAt < SERVICES_TTL_MS) return { ...cached, bbox, fromCache: true };
  }
  const b = bboxStr(bbox);
  const q = `[out:json][timeout:60];
(
  nwr["amenity"="hospital"](${b});
  nwr["healthcare"="hospital"](${b});
  nwr["amenity"="clinic"](${b});
  nwr["healthcare"="clinic"](${b});
  nwr["railway"~"^(station|halt)$"](${b});
  nwr["amenity"="police"](${b});
  nwr["amenity"="fire_station"](${b});
);
out center tags;`;
  const els = await overpass(q, signal);
  const seen = new Set<string>();
  const items: Service[] = [];
  for (const el of els) {
    const t = el.tags ?? {};
    const c = classify(t);
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!c || lat == null || lon == null) continue;
    const name = t['name:en'] || t.name || '';
    const dedupeKey = `${c.category}|${name.toLowerCase()}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
    if (name && seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    items.push({
      id: `${el.type[0]}${el.id}`,
      category: c.category,
      subtype: c.subtype,
      name: name || `Unnamed ${c.subtype.toLowerCase()}`,
      named: !!name,
      address: address(t),
      lat,
      lon,
      osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    });
  }
  const fetchedAt = Date.now();
  writeStorage(cacheKey, { items, fetchedAt });
  return { items, fetchedAt, bbox, fromCache: false };
}

export interface RawWay {
  id: number;
  highway: string;
  name?: string;
  nodes: number[];
  geometry: { lat: number; lon: number }[];
}

/** Major-road network (motorway → tertiary, incl. links) for graph analysis. */
export async function fetchRoadNetwork(bbox: BBox, signal?: AbortSignal): Promise<RawWay[]> {
  const q = `[out:json][timeout:120];
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link)$"](${bboxStr(bbox)});
out geom;`;
  const els = await overpass(q, signal, 150_000);
  return els
    .filter((e) => e.type === 'way' && e.nodes && e.geometry && e.nodes.length === e.geometry.length)
    .map((e) => ({ id: e.id, highway: e.tags?.highway ?? 'road', name: e.tags?.name, nodes: e.nodes!, geometry: e.geometry! }));
}
