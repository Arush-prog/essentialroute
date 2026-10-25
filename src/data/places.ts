import type { Place } from '../types';

/**
 * Suggested destinations shown before the user types. Coordinates are preset approximations
 * of well-known Mumbai landmarks — clearly labelled as "Suggested" in the UI, never mixed with
 * live search results.
 */
export const POPULAR_PLACES: Place[] = [
  { id: 'pop-csmt', name: 'Chhatrapati Shivaji Maharaj Terminus', context: 'Fort · Railway terminus', lat: 18.9401, lon: 72.8352, source: 'popular' },
  { id: 'pop-dadar', name: 'Dadar Station', context: 'Dadar · Railway station', lat: 19.0186, lon: 72.8428, source: 'popular' },
  { id: 'pop-bkc', name: 'Bandra Kurla Complex', context: 'Bandra East · Business district', lat: 19.066, lon: 72.8679, source: 'popular' },
  { id: 'pop-iitb', name: 'IIT Bombay', context: 'Powai · Campus', lat: 19.1334, lon: 72.9133, source: 'popular' },
  { id: 'pop-andheri', name: 'Andheri Station', context: 'Andheri · Railway station', lat: 19.1197, lon: 72.8464, source: 'popular' },
  { id: 'pop-kem', name: 'KEM Hospital', context: 'Parel · Hospital', lat: 19.0024, lon: 72.842, source: 'popular' },
  { id: 'pop-sion', name: 'Lokmanya Tilak Municipal General Hospital', context: 'Sion · Hospital', lat: 19.0373, lon: 72.8605, source: 'popular' },
  { id: 'pop-airport', name: 'Mumbai Airport Terminal 2', context: 'Andheri East · Airport', lat: 19.0989, lon: 72.8746, source: 'popular' },
  { id: 'pop-gateway', name: 'Gateway of India', context: 'Colaba · Landmark', lat: 18.922, lon: 72.8347, source: 'popular' },
  { id: 'pop-borivali', name: 'Borivali Station', context: 'Borivali · Railway station', lat: 19.229, lon: 72.8573, source: 'popular' },
];

export interface AnalysisZone {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
}

/**
 * SAMPLE ANALYSIS ZONES — approximate neighbourhood centres with a fixed 1.2 km radius.
 * These are NOT administrative boundaries and carry no population data; the UI says so.
 */
export const ANALYSIS_ZONES: AnalysisZone[] = [
  ['Colaba', 18.9067, 72.8147],
  ['Fort', 18.9345, 72.8355],
  ['Girgaon', 18.9535, 72.8186],
  ['Byculla', 18.979, 72.833],
  ['Worli', 19.01, 72.817],
  ['Parel', 19.0, 72.84],
  ['Dadar', 19.019, 72.843],
  ['Wadala', 19.017, 72.865],
  ['Mahim', 19.04, 72.84],
  ['Dharavi', 19.04, 72.855],
  ['Sion', 19.043, 72.862],
  ['Bandra West', 19.06, 72.835],
  ['Santacruz', 19.081, 72.841],
  ['Kurla', 19.07, 72.88],
  ['Chembur', 19.062, 72.9],
  ['Govandi', 19.055, 72.915],
  ['Ghatkopar', 19.086, 72.908],
  ['Vikhroli', 19.11, 72.928],
  ['Powai', 19.118, 72.906],
  ['Andheri East', 19.115, 72.87],
  ['Andheri West', 19.136, 72.83],
  ['Jogeshwari', 19.137, 72.849],
  ['Goregaon', 19.164, 72.849],
  ['Malad', 19.186, 72.848],
  ['Kandivali', 19.205, 72.851],
  ['Borivali', 19.23, 72.857],
  ['Bhandup', 19.144, 72.937],
  ['Mulund', 19.172, 72.956],
].map(([name, lat, lon]) => ({ id: `az-${String(name).toLowerCase().replace(/\s+/g, '-')}`, name: String(name), lat: Number(lat), lon: Number(lon), radiusM: 1200 }));
