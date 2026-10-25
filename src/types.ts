export type LatLon = { lat: number; lon: number };

export type PlaceSource = 'search' | 'gps' | 'service' | 'popular' | 'map' | 'recent';

export interface Place extends LatLon {
  id: string;
  name: string;
  /** Secondary address context (locality, city). */
  context?: string;
  source: PlaceSource;
}

export type TravelMode = 'car' | 'foot';

export interface RouteStep {
  instruction: string;
  distance: number;
  duration: number;
  location: [number, number];
  /** OSRM maneuver type / modifier, used for turn arrows and voice prompts */
  type?: string;
  modifier?: string;
  road?: string;
  exit?: number;
}

/** A route exactly as returned by the routing engine. */
export interface EngineRoute {
  id: string;
  /** [lat, lon] pairs */
  coords: [number, number][];
  distance: number; // metres, from engine
  duration: number; // seconds, from engine
  steps: RouteStep[];
  provider: string;
  /** Present when the route was forced through a detour waypoint. */
  via?: LatLon[];
  origin: 'engine' | 'detour' | 'graph';
}

export type Severity = 'low' | 'moderate' | 'high' | 'extreme';

/** Label describing where a flood condition comes from. Never mixed. */
export type FloodSourceKind = 'simulated' | 'user-reported' | 'sourced' | 'rain';

export interface FloodZone extends LatLon {
  id: string;
  radiusM: number;
  label: string;
  kind: FloodSourceKind;
  /** Only for user reports; simulated zones use the global scenario severity. */
  severity?: Severity;
  createdAt: number;
  note?: string;
  /** rain-risk zones only: the rainfall that produced this zone */
  rain?: { source: 'live' | 'simulated'; nowMmH: number; last3hMm: number };
}

/** Zone with severity and effective radius resolved, used by all analysis code. */
export interface ActiveZone extends FloodZone {
  severity: Severity;
  effectiveRadiusM: number;
  blocked: boolean;
  penalty: number;
}

export interface ExposureSegment {
  zoneId: string;
  kind: FloodSourceKind;
  blocked: boolean;
  coords: [number, number][];
}

export interface RouteExposure {
  exposedM: number;
  blockedM: number;
  zoneIds: string[];
  blocked: boolean;
  segments: ExposureSegment[];
  /** Duration + flood penalty (s). Infinity when blocked. */
  score: number;
}

export interface EvaluatedRoute extends EngineRoute {
  exposure: RouteExposure;
}

/** Major-road graph path used only when the routing engine cannot produce a clean detour. */
export interface GraphPath {
  coords: [number, number][];
  distance: number;
}

export interface RoutePlan {
  requestedAt: number;
  from: Place;
  to: Place;
  mode: TravelMode;
  routes: EvaluatedRoute[];
  recommendedIndex: number;
  /** Engine's own fastest route, kept for comparison when flood logic picks something else. */
  baselineId: string;
  reason: string;
  floodCheck: {
    zonesConsidered: number;
    status: 'no-zones' | 'clear' | 'avoided' | 'penalised' | 'no-clean-route';
    detourAttempts: number;
    message: string;
  };
  graphPath?: GraphPath;
}

export type ServiceCategory = 'hospital' | 'clinic' | 'station' | 'emergency';

export interface Service extends LatLon {
  id: string;
  category: ServiceCategory;
  subtype: string;
  name: string;
  named: boolean;
  address?: string;
  osmUrl: string;
}

export type GeoStatus =
  | 'idle'
  | 'requesting'
  | 'active'
  | 'stale'
  | 'denied'
  | 'unavailable'
  | 'timeout'
  | 'insecure'
  | 'unsupported';

export interface GeoFix extends LatLon {
  accuracy: number;
  timestamp: number;
  heading: number | null;
  speed: number | null;
  /** true only in the clearly labelled Demo drive — never for real positions */
  simulated?: boolean;
}
