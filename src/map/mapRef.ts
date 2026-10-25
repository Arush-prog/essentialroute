import type * as L from 'leaflet';

/** Single shared map instance so React controls can drive it imperatively. */
export const mapRef: { current: L.Map | null } = { current: null };

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The vector (MapLibre GL) basemap once its style has loaded, or null (raster fallback / loading). */
const glListeners = new Set<() => void>();
export const glMapRef: { current: any | null } = { current: null };
export function setGlMap(gl: any | null) {
  glMapRef.current = gl;
  glListeners.forEach((l) => l());
}
export function onGlMap(l: () => void) {
  glListeners.add(l);
  return () => {
    glListeners.delete(l);
  };
}
