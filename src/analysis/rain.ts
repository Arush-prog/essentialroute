import type { FloodZone, Severity } from '../types';
import type { LiveRain } from '../services/weather';

/**
 * RAIN → WATERLOGGING RISK (transparent rule-based estimate, NOT observed flooding)
 *
 * Rain alone does not tell us where a road is under water. What we do know:
 *  1. how much rain is falling (live model data, or a simulated rain level), and
 *  2. where Mumbai roads have repeatedly waterlogged in past monsoons (approximate locations of
 *     junctions and subways widely reported in news coverage).
 * The app combines the two with simple published-style thresholds. Mumbai's storm drains are
 * commonly cited as designed for ~25 mm/h (being upgraded to ~50 mm/h), so sustained rain above
 * those rates is where low spots start to flood. Subways flood first, so they move up one level.
 *
 *   Risk      | rain now (mm/h)  OR  last 3 h (mm) | Routing effect
 *   ----------|------------------------------------|-------------------------------
 *   Low       | ≥ 4                  ≥ 10          | passable, travel time ×1.5
 *   Moderate  | ≥ 10                 ≥ 25          | passable, travel time ×3
 *   High      | ≥ 25                 ≥ 60          | treated as impassable
 *   Extreme   | ≥ 50                 ≥ 120         | impassable, zone 35% wider
 *
 * Every zone produced this way is labelled "RAIN-RISK · estimate" in the UI.
 */

export interface Hotspot {
  label: string;
  lat: number;
  lon: number;
  radiusM: number;
  type: 'junction' | 'subway';
}

/** Approximate locations of frequently reported monsoon waterlogging spots in Mumbai. */
export const HOTSPOTS: Hotspot[] = [
  { label: 'Hindmata, Dadar East', lat: 19.0067, lon: 72.8437, radiusM: 450, type: 'junction' },
  { label: "King's Circle / Gandhi Market", lat: 19.0285, lon: 72.8566, radiusM: 450, type: 'junction' },
  { label: 'Sion (Road No. 24 area)', lat: 19.0405, lon: 72.8618, radiusM: 400, type: 'junction' },
  { label: 'Chunabhatti', lat: 19.0517, lon: 72.8695, radiusM: 350, type: 'junction' },
  { label: 'Kalanagar, Bandra East', lat: 19.0603, lon: 72.8494, radiusM: 350, type: 'junction' },
  { label: 'Khar Subway', lat: 19.0712, lon: 72.8402, radiusM: 300, type: 'subway' },
  { label: 'Kurla (LBS Marg area)', lat: 19.0742, lon: 72.8846, radiusM: 400, type: 'junction' },
  { label: 'Milan Subway, Santacruz', lat: 19.0826, lon: 72.8418, radiusM: 350, type: 'subway' },
  { label: 'Andheri Subway', lat: 19.1189, lon: 72.8467, radiusM: 350, type: 'subway' },
  { label: 'Malad Subway', lat: 19.1868, lon: 72.8484, radiusM: 300, type: 'subway' },
  { label: 'Dahisar Subway', lat: 19.2502, lon: 72.8594, radiusM: 300, type: 'subway' },
];

export type RainMode = 'off' | 'live' | 'moderate' | 'heavy' | 'extreme';

/** Simulated rain levels: steady rate and 3-hour total that the level represents. */
export const RAIN_LEVELS: Record<Exclude<RainMode, 'off' | 'live'>, { label: string; nowMmH: number; last3hMm: number; hint: string }> = {
  moderate: { label: 'Moderate', nowMmH: 8, last3hMm: 20, hint: 'Steady rain ~8 mm/h. Subways slow down; most roads open.' },
  heavy: { label: 'Heavy', nowMmH: 18, last3hMm: 45, hint: 'Heavy rain ~18 mm/h for hours. Subways close; low junctions slow.' },
  extreme: { label: 'Extreme', nowMmH: 55, last3hMm: 140, hint: 'Cloudburst-level rain ~55 mm/h (like 26 July 2005). Hotspots impassable.' },
};

const ORDER: (Severity | null)[] = [null, 'low', 'moderate', 'high', 'extreme'];

export function riskFor(nowMmH: number, last3hMm: number): Severity | null {
  if (nowMmH >= 50 || last3hMm >= 120) return 'extreme';
  if (nowMmH >= 25 || last3hMm >= 60) return 'high';
  if (nowMmH >= 10 || last3hMm >= 25) return 'moderate';
  if (nowMmH >= 4 || last3hMm >= 10) return 'low';
  return null;
}

function bump(s: Severity | null, type: Hotspot['type']): Severity | null {
  if (!s || type !== 'subway') return s;
  return ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(s) + 1)];
}

/** Rain-risk zones for the chosen rain mode. Returns [] when there is no risk. */
export function buildRainZones(mode: RainMode, live: LiveRain | null | undefined): FloodZone[] {
  if (mode === 'off') return [];
  const out: FloodZone[] = [];
  HOTSPOTS.forEach((h, i) => {
    let nowMmH: number;
    let last3hMm: number;
    if (mode === 'live') {
      const r = live?.readings[i];
      if (!r) return;
      nowMmH = r.nowMmH;
      last3hMm = r.last3hMm;
    } else {
      ({ nowMmH, last3hMm } = RAIN_LEVELS[mode]);
    }
    const severity = bump(riskFor(nowMmH, last3hMm), h.type);
    if (!severity) return;
    out.push({
      id: `rain-${i}`,
      label: h.label,
      lat: h.lat,
      lon: h.lon,
      radiusM: h.radiusM,
      kind: 'rain',
      severity,
      createdAt: mode === 'live' ? live?.fetchedAt ?? Date.now() : 0,
      rain: { source: mode === 'live' ? 'live' : 'simulated', nowMmH, last3hMm },
    });
  });
  return out;
}
