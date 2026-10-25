import { useSyncExternalStore } from 'react';
import { STORAGE_KEYS, type MapStyle } from '../config';
import { readStorage, writeStorage } from '../lib/http';
import type { AccessibilityResult } from '../analysis/accessibility';
import type { RainMode } from '../analysis/rain';
import type { LiveRain, RadarFrame } from '../services/weather';
import type { FloodZone, GeoFix, GeoStatus, Place, RoutePlan, Service, ServiceCategory, Severity, TravelMode } from '../types';

export type Tab = 'map' | 'explore' | 'flood' | 'ask' | 'alerts';
export type Async<T> = { status: 'idle' | 'loading' | 'ok' | 'error'; data?: T; error?: string; progress?: string };

export interface NavProgress {
  /** metres travelled along the route */
  along: number;
  /** index of the next maneuver in route.steps */
  next: number;
  toNext: number;
  remainingM: number;
  remainingS: number;
  offRouteM: number;
  /** direction of travel along the route at the current position (degrees from north) */
  bearing: number;
}
export interface NavState {
  active: boolean;
  mode: 'live' | 'preview';
  routeId: string | null;
  /** preview: the step being shown */
  step: number;
  voice: boolean;
  progress: NavProgress | null;
  rerouting: boolean;
  arrived: boolean;
  /** Demo drive: position is SIMULATED along the route (for indoor presentations), labelled on screen */
  demo: boolean;
  /** when live navigation / demo started (for the arrival summary) */
  startedAt: number;
}

export interface AppState {
  tab: Tab;
  searchOpen: boolean;
  origin: Place | null;
  originMode: 'fixed' | 'live';
  destination: Place | null;
  travelMode: TravelMode;
  route: Async<RoutePlan>;
  selectedRouteId: string | null;
  /** origin coordinates used for the current live-origin route */
  routedFrom: { lat: number; lon: number; at: number } | null;

  services: Async<{ items: Service[]; fetchedAt: number; fromCache: boolean; scope: string }>;
  filters: Record<ServiceCategory, boolean>;
  selectedService: Service | null;

  sim: { enabled: boolean; severity: Severity; zones: FloodZone[]; placing: boolean; radiusM: number };
  reports: FloodZone[];
  includeReports: boolean;
  /** Rain-aware routing: live rainfall (real) or a simulated rain level → risk zones at known waterlogging spots */
  rain: { mode: RainMode; live: Async<LiveRain>; zones: FloodZone[]; radar: boolean; radarFrame: RadarFrame | null };
  reportPlacing: boolean;
  /** location chosen for a new user report (form shown in Alerts) */
  reportDraft: { lat: number; lon: number } | null;
  tiles: 'loading' | 'ok' | 'error';
  sheetSnap: 'peek' | 'half' | 'full';
  sidebarOpen: boolean;

  graph: Async<{ nodes: number; edges: number; builtAt: number }>;
  analysis: Async<AccessibilityResult>;
  analysisCategory: ServiceCategory;

  geo: { status: GeoStatus; fix: GeoFix | null; error?: string; watching: boolean };
  follow: boolean;

  recents: Place[];
  baseLayer: MapStyle;
  /** Turn-by-turn navigation. 'live' follows the device GPS; 'preview' steps through turns manually. */
  nav: NavState;
  toast: { id: number; text: string; tone: 'info' | 'warn' | 'error' } | null;
  /** imperative map commands (consumed by MapView) */
  mapCmd: { id: number; type: 'fly'; lat: number; lon: number; zoom?: number } | { id: number; type: 'fit'; bounds: [[number, number], [number, number]] } | null;
}

const prefs = readStorage<{ baseLayer?: MapStyle; travelMode?: TravelMode; voice?: boolean }>(STORAGE_KEYS.prefs, {});

let state: AppState = {
  tab: 'map',
  searchOpen: false,
  origin: null,
  originMode: 'fixed',
  destination: null,
  travelMode: prefs.travelMode ?? 'car',
  route: { status: 'idle' },
  selectedRouteId: null,
  routedFrom: null,
  services: { status: 'idle' },
  filters: { hospital: true, clinic: false, station: true, emergency: false },
  selectedService: null,
  sim: { enabled: false, severity: 'high', zones: [], placing: false, radiusM: 400 },
  reports: readStorage<FloodZone[]>(STORAGE_KEYS.reports, []),
  includeReports: true,
  rain: { mode: 'live', live: { status: 'idle' }, zones: [], radar: false, radarFrame: null },
  reportPlacing: false,
  reportDraft: null,
  tiles: 'loading',
  sheetSnap: 'peek',
  sidebarOpen: true,
  graph: { status: 'idle' },
  analysis: { status: 'idle' },
  analysisCategory: 'hospital',
  geo: { status: 'idle', fix: null, watching: false },
  follow: false,
  recents: readStorage<Place[]>(STORAGE_KEYS.recents, []),
  baseLayer: prefs.baseLayer === 'clean' ? 'clean' : 'standard',
  nav: { active: false, mode: 'live', routeId: null, step: 0, voice: prefs.voice ?? true, progress: null, rerouting: false, arrived: false, demo: false, startedAt: 0 },
  toast: null,
  mapCmd: null,
};

const listeners = new Set<() => void>();

export function getState() {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  if ('reports' in p) writeStorage(STORAGE_KEYS.reports, state.reports);
  if ('recents' in p) writeStorage(STORAGE_KEYS.recents, state.recents);
  if ('baseLayer' in p || 'travelMode' in p || 'nav' in p) writeStorage(STORAGE_KEYS.prefs, { baseLayer: state.baseLayer, travelMode: state.travelMode, voice: state.nav.voice });
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => sel(state),
    () => sel(state),
  );
}

let cmdId = 0;
export function flyTo(lat: number, lon: number, zoom?: number) {
  setState({ mapCmd: { id: ++cmdId, type: 'fly', lat, lon, zoom } });
}
export function fitBounds(bounds: [[number, number], [number, number]]) {
  setState({ mapCmd: { id: ++cmdId, type: 'fit', bounds } });
}

let toastId = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, tone: 'info' | 'warn' | 'error' = 'info', ms = 4000) {
  clearTimeout(toastTimer);
  setState({ toast: { id: ++toastId, text, tone } });
  toastTimer = setTimeout(() => setState({ toast: null }), ms);
}

export function addRecent(p: Place) {
  if (p.source === 'gps' || p.source === 'map') return;
  setState((s) => ({ recents: [{ ...p, source: 'recent' as const }, ...s.recents.filter((r) => r.id !== p.id)].slice(0, 6) }));
}
