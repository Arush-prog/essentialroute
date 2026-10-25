/**
 * Central configuration. Every external service is free, keyless and public.
 * Endpoints are kept here so providers can be swapped without touching UI code.
 */

export const MUMBAI_CENTER: [number, number] = [19.076, 72.8777];
export const INITIAL_ZOOM_DESKTOP = 12;
export const INITIAL_ZOOM_MOBILE = 11;

/** Mumbai city + suburbs (BMC area, roughly). Used for services, road network and analysis. */
export const MUMBAI_BBOX = { south: 18.89, west: 72.77, north: 19.29, east: 72.99 };

/** Mumbai Metropolitan Region — first-pass search scope (includes Thane / Navi Mumbai). */
export const MMR_BBOX = { south: 18.85, west: 72.74, north: 19.5, east: 73.25 };

/** Rough Maharashtra extent used only to rank wider search results. */
export const MAHARASHTRA_BBOX = { south: 15.6, west: 72.6, north: 22.1, east: 80.9 };

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

/**
 * Basemap. Primary: OpenFreeMap vector tiles (free, no API key, no registration) drawn with MapLibre GL —
 * crisp at any screen density, Google-Maps-like colours. If WebGL is unavailable or the vector style
 * fails to load, the app falls back to OpenStreetMap raster tiles (TILE_SOURCES) automatically.
 */
const OFM_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
export const VECTOR_STYLES = {
  standard: { label: 'Standard', url: 'https://tiles.openfreemap.org/styles/liberty', attribution: OFM_ATTRIBUTION },
  clean: { label: 'Clean', url: 'https://tiles.openfreemap.org/styles/positron', attribution: OFM_ATTRIBUTION },
} as const;
export type MapStyle = keyof typeof VECTOR_STYLES;

/** Raster fallback (no WebGL / vector style unreachable). */
export const TILE_SOURCES = [
  { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxNativeZoom: 19, attribution: OSM_ATTRIBUTION },
  {
    name: 'OpenStreetMap Germany',
    url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    maxNativeZoom: 18,
    attribution: `${OSM_ATTRIBUTION} · tiles by <a href="https://openstreetmap.de" target="_blank" rel="noopener">OSM Germany</a>`,
  },
] as const;

export const ENDPOINTS = {
  /** Photon (komoot) is built for search-as-you-type over OSM data. Nominatim's policy forbids autocomplete. */
  photon: 'https://photon.komoot.io/api/',
  /** Nominatim is used only for single reverse-geocode lookups (permitted, ≤1 req/s). */
  nominatimReverse: 'https://nominatim.openstreetmap.org/reverse',
  /** OSRM-compatible routing. FOSSGIS servers offer car and foot profiles; OSRM demo is the car fallback. */
  routing: {
    car: ['https://routing.openstreetmap.de/routed-car', 'https://router.project-osrm.org'],
    foot: ['https://routing.openstreetmap.de/routed-foot'],
  },
  overpass: ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'],
  /** Open-Meteo weather API — free, no key (non-commercial use). Model-based hourly rainfall. */
  openMeteo: 'https://api.open-meteo.com/v1/forecast',
  /** RainViewer public weather-maps index — free for personal/educational use, radar tiles up to zoom 7. */
  rainViewer: 'https://api.rainviewer.com/public/weather-maps.json',
};

/** Minimum gap between requests per host, respecting public-server fair-use policies. */
export const RATE_LIMIT_MS: Record<string, number> = {
  'photon.komoot.io': 350,
  'nominatim.openstreetmap.org': 1100,
  'routing.openstreetmap.de': 1000,
  'router.project-osrm.org': 1000,
  'overpass-api.de': 2000,
  'overpass.kumi.systems': 2000,
  'api.open-meteo.com': 1000,
  'api.rainviewer.com': 1000,
};

/** Live-location tuning. */
export const GPS = {
  /** Recalculate an active live-origin route only after moving this far (metres). */
  rerouteDistanceM: 150,
  /** …and no more often than this. */
  rerouteMinIntervalMs: 20_000,
  /** Ignore fixes worse than this for rerouting (metres). */
  maxAccuracyForRerouteM: 100,
  /** Re-run reverse geocoding only after moving this far. */
  reverseGeocodeDistanceM: 300,
  /** Flag the fix as possibly outdated if no update arrives for this long (stationary devices may report rarely). */
  staleAfterMs: 120_000,
  poorAccuracyM: 150,
};

export const STORAGE_KEYS = {
  recents: 'er.recents.v1',
  reports: 'er.reports.v1',
  services: 'er.services.v1',
  prefs: 'er.prefs.v2',
};

export const SERVICES_TTL_MS = 24 * 60 * 60 * 1000;
export const REPORT_STALE_MS = 6 * 60 * 60 * 1000;
