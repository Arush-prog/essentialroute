import * as L from 'leaflet';
import type { ServiceCategory } from '../types';

export const CATEGORY_META: Record<ServiceCategory, { label: string; plural: string; color: string; glyph: string }> = {
  hospital: {
    label: 'Hospital',
    plural: 'Hospitals',
    color: '#FF6B9D',
    glyph: '<path d="M7 5h3v5h4V5h3v14h-3v-6h-4v6H7z" fill="currentColor"/>',
  },
  clinic: {
    label: 'Clinic',
    plural: 'Clinics',
    color: '#B794F6',
    glyph: '<path d="M10 5h4v5h5v4h-5v5h-4v-5H5v-4h5z" fill="currentColor"/>',
  },
  station: {
    label: 'Station',
    plural: 'Rail & Metro',
    color: '#FACC15',
    glyph: '<path d="M8 4h8a3 3 0 0 1 3 3v8a3 3 0 0 1-2 2.8l1.6 2.2h-2.4l-1.4-2H9.2l-1.4 2H5.4L7 17.8A3 3 0 0 1 5 15V7a3 3 0 0 1 3-3zm-1 4v3h10V8zm1.5 6.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm7 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z" fill="currentColor"/>',
  },
  emergency: {
    label: 'Emergency',
    plural: 'Police & Fire',
    color: '#34D399',
    glyph: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6zm-1 5v5h2V8zm0 6.5v2h2v-2z" fill="currentColor"/>',
  },
};

export function glyphSvg(cat: ServiceCategory, size = 16) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${CATEGORY_META[cat].glyph}</svg>`;
}

const iconCache = new Map<string, L.DivIcon>();

export function serviceIcon(cat: ServiceCategory, selected = false): L.DivIcon {
  const key = `${cat}${selected ? '!' : ''}`;
  let ic = iconCache.get(key);
  if (!ic) {
    const size = selected ? 38 : 30;
    ic = L.divIcon({
      className: 'er-svc-icon',
      html: `<div class="er-svc${selected ? ' is-selected' : ''}" style="--c:${CATEGORY_META[cat].color}">${glyphSvg(cat, selected ? 20 : 16)}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    iconCache.set(key, ic);
  }
  return ic;
}

export function clusterIcon(count: number, cats: ServiceCategory[]): L.DivIcon {
  const size = count < 10 ? 34 : count < 100 ? 40 : 46;
  const ring = cats
    .slice(0, 4)
    .map((c) => CATEGORY_META[c].color)
    .join(', ');
  const bg = cats.length > 1 ? `conic-gradient(${cats.map((c, i) => `${CATEGORY_META[c].color} ${(i * 100) / cats.length}% ${((i + 1) * 100) / cats.length}%`).join(', ')})` : CATEGORY_META[cats[0]].color;
  return L.divIcon({
    className: 'er-svc-icon',
    html: `<div class="er-cluster" style="width:${size}px;height:${size}px;background:${bg}" data-ring="${ring}"><span>${count > 999 ? '999+' : count}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function endpointIcon(kind: 'start' | 'end'): L.DivIcon {
  return L.divIcon({
    className: 'er-svc-icon',
    html:
      kind === 'start'
        ? '<div class="er-start"></div>'
        : '<div class="er-end"><svg viewBox="0 0 24 32" width="28" height="36"><path d="M12 0C5.4 0 0 5.2 0 11.7 0 20.4 12 32 12 32s12-11.6 12-20.3C24 5.2 18.6 0 12 0z" fill="#20D9F3"/><circle cx="12" cy="11.5" r="4.6" fill="#0B1220"/></svg></div>',
    iconSize: kind === 'start' ? [18, 18] : [28, 36],
    iconAnchor: kind === 'start' ? [9, 9] : [14, 36],
  });
}

export const userDotIcon = (stale: boolean, heading: number | null, navigating = false) =>
  navigating
    ? L.divIcon({
        className: 'er-svc-icon',
        html: `<div class="er-nav-puck${stale ? ' is-stale' : ''}" style="transform:rotate(${heading ?? 0}deg)"><svg viewBox="0 0 24 24" width="30" height="30"><path d="M12 2 4.5 20.5 12 16.5l7.5 4z" fill="#1a73e8" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg></div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      })
    : L.divIcon({
    className: 'er-svc-icon',
    html: `<div class="er-user${stale ? ' is-stale' : ''}"><div class="er-user-heading" style="${heading != null && !Number.isNaN(heading) ? `transform:rotate(${heading}deg)` : 'display:none'}"></div><div class="er-user-dot"></div></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

export const reportIcon = L.divIcon({
  className: 'er-svc-icon',
  html: '<div class="er-report" title="User report">!</div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});
