import { ENDPOINTS, MAHARASHTRA_BBOX, MMR_BBOX, MUMBAI_BBOX, MUMBAI_CENTER } from '../config';
import { fetchJson, ServiceError } from '../lib/http';
import { haversine, inBBox } from '../lib/geo';
import type { LatLon, Place } from '../types';

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id?: number;
    osm_type?: string;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    locality?: string;
    district?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    postcode?: string;
    type?: string;
  };
}

function toPlace(f: PhotonFeature): Place | null {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const name = p.name || (p.street ? `${p.housenumber ? p.housenumber + ' ' : ''}${p.street}` : '');
  if (!name || !isFinite(lat) || !isFinite(lon)) return null;
  const ctxParts = [p.street && p.name ? p.street : undefined, p.locality, p.district, p.city, p.state !== 'Maharashtra' || !p.city ? p.state : undefined, p.countrycode && p.countrycode !== 'IN' ? p.country : undefined];
  const context = [...new Set(ctxParts.filter((x): x is string => !!x && x !== name))].join(', ');
  const kind = p.osm_value && p.osm_value !== 'yes' ? p.osm_value.replace(/_/g, ' ') : undefined;
  return {
    id: `${p.osm_type ?? 'X'}${p.osm_id ?? `${lat},${lon}`}`,
    name,
    context: kind ? `${kind[0].toUpperCase()}${kind.slice(1)}${context ? ' · ' + context : ''}` : context,
    lat,
    lon,
    source: 'search',
  };
}

function rank(p: Place): number {
  const pt: LatLon = p;
  const tier = inBBox(pt, MUMBAI_BBOX) ? 0 : inBBox(pt, MMR_BBOX) ? 1 : inBBox(pt, MAHARASHTRA_BBOX) ? 2 : 3;
  return tier;
}

function dedupe(list: Place[]): Place[] {
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const p of list) {
    const key = `${p.name.toLowerCase()}|${p.lat.toFixed(3)}|${p.lon.toFixed(3)}`;
    if (seen.has(key) || seen.has(p.id)) continue;
    seen.add(key);
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/**
 * Search-as-you-type over OpenStreetMap via Photon.
 * Pass 1 is restricted to the Mumbai Metropolitan Region and biased to the city centre.
 * Pass 2 (only when pass 1 is thin) is unrestricted but still biased, so deliberate
 * searches for places outside Mumbai (e.g. "Pune station") still work.
 */
export async function searchPlaces(query: string, signal?: AbortSignal, near?: LatLon): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const bias = near && inBBox(near, MMR_BBOX) ? near : { lat: MUMBAI_CENTER[0], lon: MUMBAI_CENTER[1] };
  const base = `${ENDPOINTS.photon}?q=${encodeURIComponent(q)}&lang=en&lat=${bias.lat}&lon=${bias.lon}&location_bias_scale=0.3&zoom=12`;
  const bbox = `${MMR_BBOX.west},${MMR_BBOX.south},${MMR_BBOX.east},${MMR_BBOX.north}`;

  const first = await fetchJson<{ features: PhotonFeature[] }>(`${base}&limit=8&bbox=${bbox}`, { signal, cacheMs: 10 * 60_000, timeoutMs: 8000 });
  let places = first.features.map(toPlace).filter((p): p is Place => !!p);

  if (places.length < 4) {
    try {
      const wide = await fetchJson<{ features: PhotonFeature[] }>(`${base}&limit=8`, { signal, cacheMs: 10 * 60_000, timeoutMs: 8000 });
      places = places.concat(wide.features.map(toPlace).filter((p): p is Place => !!p));
    } catch (e) {
      if (e instanceof ServiceError && e.kind === 'aborted') throw e;
      // first-pass results are still valid; ignore wide-search failure
    }
  }

  const ranked = dedupe(places)
    .map((p, i) => ({ p, r: rank(p), i, d: haversine(p, bias) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.p);
  return ranked.slice(0, 8);
}

interface NominatimReverse {
  name?: string;
  display_name?: string;
  address?: Record<string, string>;
  error?: string;
}

/** Single reverse-geocode lookup (Nominatim, ≤1 request/second). */
export async function reverseGeocode(p: LatLon, signal?: AbortSignal): Promise<{ name: string; context?: string }> {
  const url = `${ENDPOINTS.nominatimReverse}?format=jsonv2&lat=${p.lat.toFixed(6)}&lon=${p.lon.toFixed(6)}&zoom=17&addressdetails=1&accept-language=en`;
  const r = await fetchJson<NominatimReverse>(url, { signal, cacheMs: 30 * 60_000, timeoutMs: 8000 });
  if (r.error || !r.address) throw new ServiceError('No address found for this point.', 'data');
  const a = r.address;
  const primary =
    r.name ||
    a.amenity || a.building || a.shop || a.tourism ||
    (a.road ? `${a.house_number ? a.house_number + ' ' : ''}${a.road}` : '') ||
    a.neighbourhood || a.suburb || a.city_district || 'Unnamed location';
  const context = [a.neighbourhood, a.suburb, a.city || a.town || a.village].filter((x) => x && x !== primary).join(', ');
  return { name: primary, context: context || undefined };
}
