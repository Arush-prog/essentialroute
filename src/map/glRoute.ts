/*
 * The selected route, its flood sections and its direction arrows, drawn INSIDE the vector map
 * engine (MapLibre GL) rather than as a separate SVG layer on top.
 *
 * Why: an overlay layer is stretched during pinch-zoom and redrawn only when the gesture ends, so the
 * line visibly thickens, lags behind the roads and then snaps. Drawn by the same engine as the roads,
 * the route is re-rendered every frame — it never drifts off the road, keeps a constant width while
 * zooming, and the arrows are laid out along the line by the engine (no marker rebuilds).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type GlMap = any;

export interface GlRouteData {
  coords: [number, number][]; // [lat, lon]
  blocked: boolean;
  navigating: boolean;
  exposure: { coords: [number, number][]; color: string }[];
}

const SRC_ROUTE = 'er-route';
const SRC_EXPO = 'er-route-exposure';
const IMG = 'er-chevron';
const LAYERS = ['er-route-case', 'er-route-line', 'er-route-expo', 'er-route-arrows'];

const toLngLat = (c: [number, number][]) => c.map(([la, lo]) => [lo, la]);

function chevron(): { width: number; height: number; data: Uint8ClampedArray } {
  // white ">" chevron pointing along the line (the engine rotates it with the line direction)
  const s = 2; // drawn at 2× for sharpness, registered with pixelRatio 2
  const w = 14 * s;
  const h = 14 * s;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2.6 * s;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(4.5 * s, 3.5 * s);
  g.lineTo(9.5 * s, 7 * s);
  g.lineTo(4.5 * s, 10.5 * s);
  g.stroke();
  return { width: w, height: h, data: g.getImageData(0, 0, w, h).data };
}

function ensure(gl: GlMap) {
  if (!gl.hasImage(IMG)) gl.addImage(IMG, chevron(), { pixelRatio: 2 });
  if (!gl.getSource(SRC_ROUTE)) gl.addSource(SRC_ROUTE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  if (!gl.getSource(SRC_EXPO)) gl.addSource(SRC_EXPO, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  // widths follow zoom like Google Maps (MapLibre zoom = Leaflet zoom − 1)
  const w = (base: number) => ['interpolate', ['exponential', 1.5], ['zoom'], 9, base * 0.45, 13, base, 17, base * 2.1];
  if (!gl.getLayer('er-route-case'))
    gl.addLayer({ id: 'er-route-case', type: 'line', source: SRC_ROUTE, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'case'], 'line-width': w(9) } });
  if (!gl.getLayer('er-route-line'))
    gl.addLayer({ id: 'er-route-line', type: 'line', source: SRC_ROUTE, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': w(6) } });
  if (!gl.getLayer('er-route-expo'))
    gl.addLayer({ id: 'er-route-expo', type: 'line', source: SRC_EXPO, layout: { 'line-join': 'round', 'line-cap': 'butt' }, paint: { 'line-color': ['get', 'color'], 'line-width': w(6.5) } });
  if (!gl.getLayer('er-route-arrows'))
    gl.addLayer({
      id: 'er-route-arrows',
      type: 'symbol',
      source: SRC_ROUTE,
      minzoom: 11,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 11, 60, 16, 110],
        'icon-image': IMG,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, 1],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-rotation-alignment': 'map',
        'icon-keep-upright': false,
      },
    });
}

/** Draw (or clear with null) the selected route in the vector map. Returns false if the map isn't ready. */
export function setGlRoute(gl: GlMap | null, d: GlRouteData | null): boolean {
  if (!gl || !gl.isStyleLoaded?.()) return false;
  try {
    ensure(gl);
    const route = d
      ? {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { color: d.blocked ? '#8FA3BF' : '#1a73e8', case: d.blocked ? '#5b6577' : '#0b57d0' },
              geometry: { type: 'LineString', coordinates: toLngLat(d.coords) },
            },
          ],
        }
      : { type: 'FeatureCollection', features: [] };
    const expo = {
      type: 'FeatureCollection',
      features: (d?.exposure ?? []).map((e) => ({ type: 'Feature', properties: { color: e.color }, geometry: { type: 'LineString', coordinates: toLngLat(e.coords) } })),
    };
    gl.getSource(SRC_ROUTE).setData(route);
    gl.getSource(SRC_EXPO).setData(expo);
    for (const id of LAYERS) gl.setLayoutProperty(id, 'visibility', d ? 'visible' : 'none');
    return true;
  } catch {
    return false;
  }
}
