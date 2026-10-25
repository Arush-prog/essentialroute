import { ENDPOINTS } from '../config';
import { fetchJson, ServiceError } from '../lib/http';
import type { LatLon } from '../types';

/**
 * LIVE RAIN (real data, no API key)
 * - Open-Meteo: hourly precipitation for many points in one request. Values are weather-model
 *   estimates on a ~10 km grid, not rain-gauge readings — the UI says so.
 * - RainViewer: latest radar frame as map tiles (max zoom 7). Radar coverage over India can have gaps.
 */

export interface RainReading extends LatLon {
  /** precipitation in the current hour (mm, model estimate) — used as the "now" rate in mm/h */
  nowMmH: number;
  /** total of the last 3 completed hours (mm) */
  last3hMm: number;
  /** next hour (mm, forecast) */
  nextMmH: number;
}

export interface LiveRain {
  readings: RainReading[];
  /** unix ms of the hour the "now" value refers to */
  validAt: number;
  fetchedAt: number;
  source: string;
}

interface OmResult {
  hourly?: { time: number[]; precipitation?: (number | null)[]; rain?: (number | null)[]; showers?: (number | null)[] };
}

export async function fetchLiveRain(points: LatLon[], signal?: AbortSignal): Promise<LiveRain> {
  const lat = points.map((p) => p.lat.toFixed(4)).join(',');
  const lon = points.map((p) => p.lon.toFixed(4)).join(',');
  const url = `${ENDPOINTS.openMeteo}?latitude=${lat}&longitude=${lon}&hourly=precipitation,rain,showers&past_days=1&forecast_days=2&timeformat=unixtime&timezone=Asia%2FKolkata`;
  const raw = await fetchJson<OmResult | OmResult[]>(url, { signal, timeoutMs: 15_000, cacheMs: 5 * 60_000 });
  const list = Array.isArray(raw) ? raw : [raw];
  if (list.length !== points.length) throw new ServiceError('Weather service returned an unexpected response.', 'data');
  const now = Date.now() / 1000;
  let validAt = 0;
  const readings = list.map((r, i) => {
    const h = r.hourly;
    if (!h?.time?.length) throw new ServiceError('Weather service returned no rainfall data.', 'data');
    const val = (k: number) => {
      const p = h.precipitation?.[k];
      if (p != null) return p;
      return (h.rain?.[k] ?? 0) + (h.showers?.[k] ?? 0);
    };
    // each hourly value is the sum of the PRECEDING hour: the first timestamp ≥ now is the hour in progress
    let cur = h.time.findIndex((t) => t >= now);
    if (cur < 0) cur = h.time.length - 1;
    validAt = h.time[cur] * 1000;
    let last3 = 0;
    for (let k = Math.max(0, cur - 3); k < cur; k++) last3 += val(k);
    return { ...points[i], nowMmH: round1(val(cur)), last3hMm: round1(last3), nextMmH: round1(val(Math.min(cur + 1, h.time.length - 1))) };
  });
  return { readings, validAt, fetchedAt: Date.now(), source: 'Open-Meteo (weather model)' };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export interface RadarFrame {
  url: string;
  time: number;
}

/** Latest radar frame tile template from RainViewer, or null if unavailable. */
export async function fetchRadarFrame(signal?: AbortSignal): Promise<RadarFrame | null> {
  const r = await fetchJson<{ host?: string; radar?: { past?: { time: number; path: string }[] } }>(ENDPOINTS.rainViewer, { signal, timeoutMs: 10_000, cacheMs: 5 * 60_000 });
  const past = r.radar?.past;
  if (!r.host || !past?.length) return null;
  const last = past[past.length - 1];
  // 256 px tiles · colour scheme 2 (Universal Blue, the only free scheme) · smoothed, no snow
  return { url: `${r.host}${last.path}/256/{z}/{x}/{y}/2/1_0.png`, time: last.time * 1000 };
}

/** Plain-language rain intensity (standard hourly intensity classes). */
export function rainLabel(mmH: number): string {
  if (mmH < 0.1) return 'No rain';
  if (mmH < 2.5) return 'Light rain';
  if (mmH < 7.6) return 'Moderate rain';
  if (mmH < 50) return 'Heavy rain';
  return 'Violent rain';
}
