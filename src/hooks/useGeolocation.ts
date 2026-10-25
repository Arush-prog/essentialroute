import { useEffect } from 'react';
import { GPS } from '../config';
import { startCompass, stopCompass } from '../lib/compass';
import { getState, setState, useStore } from '../state/store';
import type { GeoFix } from '../types';

/**
 * Continuous device location via navigator.geolocation.watchPosition().
 * Started only after an explicit user action (startLocation), stopped on stopLocation
 * or when the app unmounts. Positions stay in memory — nothing is stored or transmitted
 * except the coordinates sent to routing / reverse-geocoding when the user asks for them.
 */
let watchId: number | null = null;
let staleTimer: ReturnType<typeof setInterval> | undefined;

function onFix(pos: GeolocationPosition) {
  const fix: GeoFix = {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    timestamp: pos.timestamp || Date.now(),
    heading: pos.coords.heading,
    speed: pos.coords.speed,
  };
  setState((s) => ({ geo: { ...s.geo, status: 'active', fix, error: undefined } }));
}

function onError(err: GeolocationPositionError) {
  const s = getState().geo;
  if (err.code === err.PERMISSION_DENIED) {
    stopLocation();
    setState({ geo: { status: 'denied', fix: s.fix, watching: false, error: 'Location permission was denied.' } });
    return;
  }
  // POSITION_UNAVAILABLE / TIMEOUT: keep watching — the device may recover.
  const status = err.code === err.TIMEOUT ? 'timeout' : 'unavailable';
  // a timeout after we already have a fix just means the device is stationary or between fixes
  if (s.fix && s.status === 'active' && status === 'timeout') return;
  setState({ geo: { ...s, status: s.fix && status === 'timeout' ? 'stale' : status, error: err.message || undefined } });
}

export function locationSupportIssue(): 'insecure' | 'unsupported' | null {
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'insecure';
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return 'unsupported';
  return null;
}

export function startLocation() {
  // compass for the direction arrow — started from the same tap (iPhone asks permission here)
  void startCompass();
  const issue = locationSupportIssue();
  if (issue) {
    setState((s) => ({ geo: { ...s.geo, status: issue, watching: false } }));
    return false;
  }
  if (watchId !== null) return true;
  setState((s) => ({ geo: { ...s.geo, status: s.geo.fix ? s.geo.status : 'requesting', watching: true } }));
  watchId = navigator.geolocation.watchPosition(onFix, onError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  // Android GPS can take 20 s+ to lock indoors. Ask in parallel for a quick network-based fix so the
  // dot appears immediately; it is a REAL position with its (larger) accuracy shown honestly, and the
  // high-accuracy watch replaces it as soon as GPS locks.
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const cur = getState().geo;
      if (watchId !== null && (!cur.fix || cur.fix.accuracy > pos.coords.accuracy)) onFix(pos);
    },
    () => undefined,
    { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8000 },
  );
  clearInterval(staleTimer);
  staleTimer = setInterval(() => {
    const g = getState().geo;
    if (g.status === 'active' && g.fix && Date.now() - g.fix.timestamp > GPS.staleAfterMs) {
      setState({ geo: { ...g, status: 'stale' } });
    }
  }, 5000);
  return true;
}

export function stopLocation() {
  stopCompass();
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearInterval(staleTimer);
  setState((s) => ({ geo: { ...s.geo, watching: false, status: s.geo.status === 'denied' ? 'denied' : 'idle' }, follow: false }));
}

/** Mount once at the root: guarantees the watch is cleared on unmount. */
export function useGeolocationLifecycle() {
  useEffect(() => () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    clearInterval(staleTimer);
  }, []);
}

export function useGeo() {
  return useStore((s) => s.geo);
}
