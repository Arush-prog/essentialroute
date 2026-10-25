import * as L from 'leaflet';
import { useEffect, useRef } from 'react';
import { INITIAL_ZOOM_DESKTOP, INITIAL_ZOOM_MOBILE, MUMBAI_CENTER, TILE_SOURCES, VECTOR_STYLES, GPS } from '../config';
import { webglAvailable } from './webgl';
import { activeZones, addSimZone, selectService, setDestination, setOrigin } from '../state/actions';
import { getState, setState, subscribe, toast, useStore } from '../state/store';
import { formatDistance } from '../lib/geo';
import { compassHeading } from '../lib/compass';
import { haptic } from '../lib/haptic';
import type { ActiveZone, Service, Severity } from '../types';
import { CATEGORY_META, clusterIcon, endpointIcon, reportIcon, serviceIcon, userDotIcon } from './icons';
import { glMapRef, mapRef, onGlMap, setGlMap } from './mapRef';
import { setGlRoute } from './glRoute';

export const SEVERITY_COLOR: Record<Severity, string> = {
  low: '#FFD166',
  moderate: '#FF8A1F',
  high: '#FF3B3B',
  extreme: '#E0115F',
};

function zoneTag(kind: string, z?: { rain?: { source: string } }) {
  if (kind === 'simulated') return 'SIMULATED';
  if (kind === 'rain') return z?.rain?.source === 'live' ? 'RAIN-RISK · estimate from live rain' : 'RAIN-RISK · simulated rain';
  return 'USER-REPORTED · unverified';
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function popupActions(title: string, actions: { label: string; onClick: () => void; primary?: boolean }[], body = '') {
  const el = document.createElement('div');
  el.className = 'er-popup';
  el.innerHTML = `<div class="er-popup-title">${esc(title)}</div>${body}`;
  const row = document.createElement('div');
  row.className = 'er-popup-actions';
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = a.primary ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
    b.textContent = a.label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      mapRef.current?.closePopup();
      a.onClick();
    });
    row.appendChild(b);
  }
  el.appendChild(row);
  return el;
}

/** While placing zones/reports, taps on markers or routes should place, not select. */
function forwardIfPlacing(e: L.LeafletMouseEvent): boolean {
  const st = getState();
  if (!(st.sim.placing || st.reportPlacing)) return false;
  L.DomEvent.stopPropagation(e);
  mapRef.current?.fire('click', { latlng: e.latlng, layerPoint: e.layerPoint, containerPoint: e.containerPoint, originalEvent: e.originalEvent });
  return true;
}

export function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const baseLayer = useStore((s) => s.baseLayer);

  /* ---------- create map ---------- */
  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const mobile = window.matchMedia('(max-width: 899px)').matches;
    const map = L.map(el.current, {
      center: MUMBAI_CENTER,
      zoom: mobile ? INITIAL_ZOOM_MOBILE : INITIAL_ZOOM_DESKTOP,
      minZoom: 9,
      maxZoom: 19,
      zoomControl: false,
      attributionControl: false,
      worldCopyJump: false,
      preferCanvas: false,
      // draw overlay lines well beyond the screen edge so panning never reveals a cut-off line end
      renderer: L.svg({ padding: 0.8 }),
      zoomDelta: 1,
      wheelPxPerZoomLevel: 90,
      tapTolerance: 15,
      zoomSnap: 0.5,
    });
    mapRef.current = map;
    L.control.attribution({ position: 'bottomright', prefix: '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>' }).addTo(map);
    L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 110 }).addTo(map);

    map.createPane('zones').style.zIndex = '390';
    map.createPane('routes').style.zIndex = '410';
    map.createPane('exposure').style.zIndex = '420';
    map.createPane('user').style.zIndex = '650';

    const onClick = (e: L.LeafletMouseEvent) => {
      const s = getState();
      if (s.sim.placing) {
        addSimZone({ lat: e.latlng.lat, lon: e.latlng.lng });
        haptic(15);
        toast('Simulated flood zone added. Tap again to add more.');
        return;
      }
      if (s.reportPlacing) {
        setState({ reportDraft: { lat: e.latlng.lat, lon: e.latlng.lng }, reportPlacing: false, tab: 'alerts' });
        return;
      }
      if (s.selectedService) selectService(null, false);
    };
    const onContext = (e: L.LeafletMouseEvent) => {
      haptic(20);
      const p = { lat: e.latlng.lat, lon: e.latlng.lng };
      const label = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
      const place = { id: `map-${label}`, name: 'Dropped pin', context: label, lat: p.lat, lon: p.lon, source: 'map' as const };
      L.popup({ className: 'er-leaflet-popup', closeButton: true, autoPanPadding: [40, 120] })
        .setLatLng(e.latlng)
        .setContent(
          popupActions('Dropped pin', [
            { label: 'Directions to here', primary: true, onClick: () => setDestination(place) },
            { label: 'Start from here', onClick: () => setOrigin(place) },
            { label: 'Simulate flood here', onClick: () => { addSimZone(p); setState({ tab: 'flood' }); } },
            { label: 'Report waterlogging', onClick: () => setState({ reportDraft: p, tab: 'alerts' }) },
          ], `<div class="er-popup-sub">${label}</div>`),
        )
        .openOn(map);
    };
    map.on('click', onClick);
    map.on('contextmenu', onContext);
    map.on('dragstart', () => {
      if (getState().follow) setState({ follow: false });
    });

    // keep map size correct when panels or the virtual keyboard resize the viewport
    // Debounced, and paused while the full-screen search is open: the Android keyboard animates the
    // viewport height frame by frame, and resizing the map on every frame is what made the screen jitter.
    let rt: ReturnType<typeof setTimeout> | undefined;
    const resize = () => {
      clearTimeout(rt);
      if (getState().searchOpen) return;
      rt = setTimeout(() => map.invalidateSize({ pan: false }), 120);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el.current);
    let wasSearching = getState().searchOpen;
    const unsubSearch = subscribe(() => {
      const open = getState().searchOpen;
      if (open === wasSearching) return;
      wasSearching = open;
      if (!open) {
        clearTimeout(rt);
        rt = setTimeout(() => map.invalidateSize({ pan: false }), 280); // after the keyboard has closed
      }
    });

    return () => {
      clearTimeout(rt);
      unsubSearch();
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /* ---------- basemap: crisp vector map (OpenFreeMap) with automatic raster fallback ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let disposed = false;
    let layer: L.Layer | null = null;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    const swap = (next: L.Layer | null) => {
      setGlMap(null);
      layer?.remove();
      layer = next;
      next?.addTo(map);
    };
    const raster = (idx: number) => {
      if (disposed) return;
      clearTimeout(readyTimer);
      // raster tiles are only sharp at whole zoom levels
      map.options.zoomSnap = 1;
      if (map.getZoom() % 1) map.setZoom(Math.round(map.getZoom()), { animate: false });
      const src = TILE_SOURCES[idx];
      let ok = 0;
      let errors = 0;
      setState({ tiles: 'loading' });
      const t = L.tileLayer(src.url, {
        attribution: src.attribution,
        maxZoom: 19,
        maxNativeZoom: src.maxNativeZoom,
        className: 'er-tiles-raster',
        keepBuffer: 3,
        updateWhenIdle: true,
      });
      t.on('tileload', () => {
        ok++;
        if (getState().tiles !== 'ok') setState({ tiles: 'ok' });
      });
      t.on('tileerror', () => {
        errors++;
        if (errors >= 6 && ok === 0) {
          if (idx + 1 < TILE_SOURCES.length) raster(idx + 1);
          else setState({ tiles: 'error' });
        }
      });
      swap(t);
    };
    const vector = async () => {
      setState({ tiles: 'loading' });
      try {
        const { VectorBaseLayer } = await import('./vectorBase');
        if (disposed) return;
        const style = VECTOR_STYLES[baseLayer] ?? VECTOR_STYLES.standard;
        map.options.zoomSnap = 0.25;
        const v = new VectorBaseLayer({
          style: style.url,
          attribution: style.attribution,
          onReady: () => {
            clearTimeout(readyTimer);
            if (disposed) return;
            setState({ tiles: 'ok' });
            setGlMap(v.getGl());
          },
          onError: () => {
            if (!disposed) raster(0);
          },
        });
        swap(v);
        // a slow or blocked vector host must not leave the user without a map
        readyTimer = setTimeout(() => {
          if (!disposed && getState().tiles !== 'ok') raster(0);
        }, 15000);
      } catch {
        raster(0);
      }
    };
    if (webglAvailable()) void vector();
    else raster(0);
    document.documentElement.dataset.base = baseLayer;
    return () => {
      disposed = true;
      clearTimeout(readyTimer);
      setGlMap(null);
      layer?.remove();
    };
  }, [baseLayer]);

  /* ---------- imperative commands ---------- */
  useEffect(() => {
    let last = 0;
    return subscribe(() => {
      const cmd = getState().mapCmd;
      const map = mapRef.current;
      if (!cmd || cmd.id === last || !map) return;
      last = cmd.id;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const pad = paddingForUi();
      if (cmd.type === 'fly') {
        // centre the target in the part of the map not covered by panels
        const z = cmd.zoom === undefined ? map.getZoom() : Math.max(map.getZoom(), cmd.zoom);
        const size = map.getSize();
        const visCx = (pad.tl.x + size.x - pad.br.x) / 2;
        const visCy = (pad.tl.y + size.y - pad.br.y) / 2;
        const offset = L.point(size.x / 2 - visCx, size.y / 2 - visCy);
        const target = map.unproject(map.project([cmd.lat, cmd.lon], z).add(offset), z);
        if (cmd.zoom === undefined) map.panTo(target, { animate: !reduce });
        else map.flyTo(target, z, { animate: !reduce, duration: 0.6 });
      } else {
        map.fitBounds(cmd.bounds, { paddingTopLeft: pad.tl, paddingBottomRight: pad.br, animate: !reduce, maxZoom: 16 });
      }
    });
  }, []);

  /* ---------- live rain radar (RainViewer, max native zoom 7) ---------- */
  useEffect(() => {
    const map = mapRef.current!;
    map.createPane('radar').style.zIndex = '380';
    map.getPane('radar')!.style.pointerEvents = 'none';
    let layer: L.TileLayer | null = null;
    let lastUrl: string | null = null;
    const render = () => {
      const { radar, radarFrame } = getState().rain;
      const url = radar && radarFrame ? radarFrame.url : null;
      if (url === lastUrl) return;
      lastUrl = url;
      layer?.remove();
      layer = null;
      if (!url) return;
      layer = L.tileLayer(url, {
        pane: 'radar',
        opacity: 0.6,
        maxNativeZoom: 7,
        maxZoom: 19,
        attribution: 'Radar © <a href="https://www.rainviewer.com" target="_blank" rel="noopener">RainViewer</a>',
        className: 'er-radar',
      }).addTo(map);
    };
    render();
    const unsub = subscribe(render);
    return () => {
      unsub();
      layer?.remove();
    };
  }, []);

  /* ---------- routes ---------- */
  useEffect(() => {
    const map = mapRef.current!;
    const group = L.layerGroup().addTo(map);
    const arrows = L.layerGroup().addTo(map);
    let arrowCoords: [number, number][] | null = null;
    // direction chevrons along the selected route, spaced on screen so they read at every zoom
    const drawArrows = () => {
      arrows.clearLayers();
      if (!arrowCoords || arrowCoords.length < 2) return;
      const z = map.getZoom();
      if (z < 12) return;
      const spacing = 90;
      let acc = 0;
      let next = spacing / 2;
      let count = 0;
      for (let i = 1; i < arrowCoords.length && count < 400; i++) {
        const p0 = map.project(arrowCoords[i - 1], z);
        const p1 = map.project(arrowCoords[i], z);
        const seg = p0.distanceTo(p1);
        while (seg > 0 && acc + seg >= next) {
          const t = (next - acc) / seg;
          const pt = L.point(p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t);
          const ll = map.unproject(pt, z);
          next += spacing;
          const ang = (Math.atan2(p1.x - p0.x, -(p1.y - p0.y)) * 180) / Math.PI;
          L.marker(ll, { pane: 'routes', interactive: false, keyboard: false, icon: L.divIcon({ className: 'er-arrow-wrap', html: `<svg class="er-arrow" width="14" height="14" viewBox="0 0 14 14" style="transform:rotate(${ang.toFixed(0)}deg)"><path d="M3 9.5 7 4.5l4 5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`, iconSize: [14, 14], iconAnchor: [7, 7] }) }).addTo(arrows);
          count++;
        }
        acc += seg;
      }
    };
    // (raster fallback only) arrows are laid out for the whole route once per zoom level — never on pan
    map.on('zoomend', drawArrows);
    let lastKey = '';
    const render = () => {
      const s = getState();
      const plan = s.route.data;
      const gl = glMapRef.current;
      const key = `${plan?.requestedAt}|${s.selectedRouteId}|${s.origin?.lat},${s.origin?.lon}|${s.destination?.id}|${s.nav.active}|${gl ? 'gl' : 'svg'}`;
      if (key === lastKey) return;
      lastKey = key;
      group.clearLayers();
      arrowCoords = null;
      if (!plan) setGlRoute(gl, null);
      const navigating = s.nav.active;
      if (s.origin && !(navigating && s.origin.source === 'gps')) L.marker([s.origin.lat, s.origin.lon], { icon: endpointIcon('start'), pane: 'routes', keyboard: false, title: `Start: ${s.origin.name}` }).addTo(group);
      if (s.destination) L.marker([s.destination.lat, s.destination.lon], { icon: endpointIcon('end'), pane: 'routes', title: `Destination: ${s.destination.name}` }).addTo(group);
      if (!plan) return;
      const selected = plan.routes.find((r) => r.id === s.selectedRouteId) ?? plan.routes[plan.recommendedIndex];
      for (const r of plan.routes) {
        if (r === selected || navigating) continue;
        const line = L.polyline(r.coords, { pane: 'routes', smoothFactor: 0, color: r.exposure.blocked ? '#8a94a6' : '#7fa7e8', weight: 6, opacity: 0.9, dashArray: r.id === plan.baselineId && r.exposure.exposedM > 0 ? '8 8' : undefined, lineCap: 'round' });
        line.on('click', (e) => {
          if (forwardIfPlacing(e)) return;
          L.DomEvent.stopPropagation(e);
          setState({ selectedRouteId: r.id });
        });
        line.bindTooltip(r.id === plan.baselineId ? 'Fastest (engine) route — tap to select' : 'Alternative route — tap to select', { sticky: true });
        line.addTo(group);
      }
      if (plan.graphPath && !navigating) {
        L.polyline(plan.graphPath.coords, { pane: 'routes', smoothFactor: 0, color: '#A3E635', weight: 5, opacity: 0.95, dashArray: '2 9', lineCap: 'round' })
          .bindTooltip('Approximate major-road graph path (A*) avoiding impassable zones', { sticky: true })
          .addTo(group);
      }
      const zones = activeZones();
      const sevOf = (id: string) => zones.find((z) => z.id === id)?.severity ?? 'high';
      // Google-style route: dark casing + bright core. Drawn inside the vector map when available
      // (moves and zooms with the roads, no lag or snapping); SVG overlay only as a fallback.
      const onGl = setGlRoute(gl, {
        coords: selected.coords,
        blocked: selected.exposure.blocked,
        navigating,
        exposure: selected.exposure.segments.map((seg) => ({ coords: seg.coords, color: seg.blocked ? '#FF3B3B' : SEVERITY_COLOR[sevOf(seg.zoneId)] })),
      });
      if (!onGl) {
        const w = navigating ? 10 : 7;
        L.polyline(selected.coords, { pane: 'routes', smoothFactor: 0, color: selected.exposure.blocked ? '#5b6577' : '#0b57d0', weight: w + 4, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(group);
        L.polyline(selected.coords, { pane: 'routes', smoothFactor: 0, color: selected.exposure.blocked ? '#8FA3BF' : '#1a73e8', weight: w, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(group);
        arrowCoords = selected.coords;
      }
      const drawn = new Set<string>();
      for (const r of navigating ? (onGl ? [] : [selected]) : onGl ? plan.routes.filter((x) => x.id === plan.baselineId && x !== selected) : [selected, ...plan.routes.filter((x) => x.id === plan.baselineId && x !== selected)]) {
        for (const seg of r.exposure.segments) {
          const k = `${seg.coords[0]}|${seg.coords[seg.coords.length - 1]}`;
          if (drawn.has(k)) continue;
          drawn.add(k);
          L.polyline(seg.coords, {
            pane: 'exposure',
            smoothFactor: 0,
            color: seg.blocked ? '#FF3B3B' : SEVERITY_COLOR[sevOf(seg.zoneId)],
            weight: r === selected ? 7 : 5,
            opacity: 1,
            dashArray: seg.kind === 'user-reported' ? '6 6' : undefined,
            lineCap: 'butt',
          })
            .bindTooltip(`${seg.blocked ? 'Impassable' : 'Flood-affected'} road · ${zoneTag(seg.kind, zones.find((z) => z.id === seg.zoneId))}`, { sticky: true })
            .addTo(group);
        }
      }
    };
    const renderAll = () => {
      const before = lastKey;
      render();
      if (lastKey !== before) drawArrows();
    };
    renderAll();
    const unsub = subscribe(renderAll);
    // vector map became ready (or was replaced): redraw the route into it
    const unsubGl = onGlMap(() => {
      lastKey = '';
      renderAll();
    });
    return () => {
      unsub();
      unsubGl();
      setGlRoute(glMapRef.current, null);
      map.off('zoomend', drawArrows);
      group.remove();
      arrows.remove();
    };
  }, []);

  /* ---------- flood zones & reports ---------- */
  useEffect(() => {
    const group = L.layerGroup().addTo(mapRef.current!);
    let lastZones: ActiveZone[] | null = null;
    let lastSim: unknown = null;
    const render = () => {
      const s = getState();
      const zones = activeZones(s);
      if (zones === lastZones && lastSim === s.sim) return;
      lastZones = zones;
      lastSim = s.sim;
      group.clearLayers();
      for (const z of zones) {
        const color = z.kind === 'user-reported' ? '#F59E0B' : SEVERITY_COLOR[z.severity];
        const isRain = z.kind === 'rain';
        const c = L.circle([z.lat, z.lon], {
          pane: 'zones',
          radius: z.effectiveRadiusM,
          color,
          weight: 2,
          opacity: 0.95,
          fillColor: color,
          fillOpacity: z.blocked ? 0.26 : 0.18,
          dashArray: z.kind === 'user-reported' ? '6 6' : isRain ? '3 5' : undefined,
        });
        const tag = zoneTag(z.kind, z);
        c.bindTooltip(`<b>${esc(z.label)}</b><br><span class="er-tag">${tag}</span> · ${z.severity}${z.blocked ? ' · impassable' : ' · passable'}`, { direction: 'top', className: 'er-zone-tip' });
        c.on('click', (e) => {
          if (forwardIfPlacing(e)) return;
          L.DomEvent.stopPropagation(e);
          L.popup({ className: 'er-leaflet-popup' })
            .setLatLng(e.latlng)
            .setContent(
              popupActions(z.label, isRain ? [] : [
                {
                  label: 'Remove',
                  onClick: () =>
                    z.kind === 'simulated'
                      ? setState((x) => ({ sim: { ...x.sim, zones: x.sim.zones.filter((q) => q.id !== z.id) } }))
                      : setState((x) => ({ reports: x.reports.filter((q) => q.id !== z.id) })),
                },
              ], `<div class="er-popup-sub">${tag} · radius ${formatDistance(z.effectiveRadiusM)} · ${z.blocked ? 'roads treated as impassable' : 'travel-time penalty ×' + z.penalty}</div>${isRain && z.rain ? `<div class="er-popup-sub">Rain ${z.rain.nowMmH} mm/h now · ${z.rain.last3hMm} mm in last 3 h${z.rain.source === 'live' ? ' (Open-Meteo model)' : ' (simulated)'}. Known waterlogging spot — risk estimated from rainfall, not observed flooding.</div>` : ''}`),
            )
            .openOn(mapRef.current!);
        });
        c.addTo(group);
        if (z.kind === 'user-reported') L.marker([z.lat, z.lon], { icon: reportIcon, pane: 'zones', interactive: false }).addTo(group);
      }
    };
    render();
    const unsub = subscribe(render);
    return () => {
      unsub();
      group.remove();
    };
  }, []);

  /* ---------- essential services (grid clustering) ---------- */
  useEffect(() => {
    const map = mapRef.current!;
    const group = L.layerGroup().addTo(map);
    let lastKey = '';
    const render = (force = false) => {
      const s = getState();
      const items = s.services.data?.items ?? [];
      const key = `${items.length}|${s.services.data?.fetchedAt}|${JSON.stringify(s.filters)}|${s.selectedService?.id}|${map.getZoom()}|${map.getBounds().toBBoxString()}|${s.tab}|${s.nav.active}`;
      if (!force && key === lastKey) return;
      lastKey = key;
      group.clearLayers();
      const bounds = map.getBounds().pad(0.25);
      const zoom = map.getZoom();
      // keep the city-wide view clean (like Google Maps): services appear from street level,
      // or at any zoom while the Explore tab is open
      if (zoom < 13.5 && s.tab !== 'explore' && !s.selectedService) return;
      if (s.nav.active) return;
      const vis = items.filter((i) => s.filters[i.category] && bounds.contains([i.lat, i.lon]));
      const cell = zoom >= 16 ? 0 : zoom >= 14 ? 48 : zoom >= 12.5 ? 72 : 100;
      const buckets = new Map<string, Service[]>();
      for (const it of vis) {
        if (s.selectedService?.id === it.id) continue;
        const pt = map.latLngToLayerPoint([it.lat, it.lon]);
        const k = cell ? `${Math.floor(pt.x / cell)}:${Math.floor(pt.y / cell)}` : it.id;
        const b = buckets.get(k);
        if (b) b.push(it);
        else buckets.set(k, [it]);
      }
      for (const b of buckets.values()) {
        if (b.length === 1) {
          const it = b[0];
          const m = L.marker([it.lat, it.lon], { icon: serviceIcon(it.category), title: `${it.name} (${CATEGORY_META[it.category].label})`, riseOnHover: true, keyboard: true });
          m.on('click', (e) => {
            if (forwardIfPlacing(e)) return;
            L.DomEvent.stopPropagation(e);
            selectService(it, false);
            setState({ tab: getState().tab === 'map' && !getState().route.data ? 'explore' : getState().tab });
          });
          m.on('keypress', (e) => {
            if ((e as unknown as { originalEvent: KeyboardEvent }).originalEvent.key === 'Enter') selectService(it, false);
          });
          m.addTo(group);
        } else {
          const lat = b.reduce((a, x) => a + x.lat, 0) / b.length;
          const lon = b.reduce((a, x) => a + x.lon, 0) / b.length;
          const cats = [...new Set(b.map((x) => x.category))];
          const m = L.marker([lat, lon], { icon: clusterIcon(b.length, cats), title: `${b.length} services — zoom in`, keyboard: true });
          m.on('click', (e) => {
            if (forwardIfPlacing(e)) return;
            L.DomEvent.stopPropagation(e);
            const bb = L.latLngBounds(b.map((x) => [x.lat, x.lon] as [number, number]));
            if (bb.getNorthEast().equals(bb.getSouthWest(), 1e-5)) map.setView(bb.getCenter(), Math.min(19, zoom + 3));
            else map.fitBounds(bb.pad(0.3), { maxZoom: Math.min(19, zoom + 3) });
          });
          m.addTo(group);
        }
      }
      if (s.selectedService) {
        L.marker([s.selectedService.lat, s.selectedService.lon], { icon: serviceIcon(s.selectedService.category, true), zIndexOffset: 1000, title: s.selectedService.name }).addTo(group);
      }
    };
    const onMove = () => render();
    map.on('moveend zoomend', onMove);
    const unsub = subscribe(() => render());
    render(true);
    return () => {
      unsub();
      map.off('moveend zoomend', onMove);
      group.remove();
    };
  }, []);

  /* ---------- accessibility analysis zones ---------- */
  useEffect(() => {
    const group = L.layerGroup().addTo(mapRef.current!);
    let last: unknown = null;
    const render = () => {
      const a = getState().analysis;
      if (a === last) return;
      last = a;
      group.clearLayers();
      if (a.status !== 'ok' || !a.data) return;
      for (const z of a.data.zones) {
        const style =
          z.status === 'no-route'
            ? { color: '#FF3B3B', fillOpacity: 0.22, dashArray: undefined }
            : z.status === 'reduced'
              ? { color: '#FF8A1F', fillOpacity: 0.18, dashArray: undefined }
              : z.status === 'no-data'
                ? { color: '#6B7C99', fillOpacity: 0.04, dashArray: '4 6' }
                : { color: '#20D9F3', fillOpacity: 0.05, dashArray: '2 6' };
        L.circle([z.zone.lat, z.zone.lon], { pane: 'zones', radius: z.zone.radiusM, weight: 1.5, fillColor: style.color, ...style })
          .bindTooltip(`<b>${esc(z.zone.name)}</b> · sample zone<br>${esc(z.explanation)}`, { className: 'er-zone-tip er-zone-tip-wide', sticky: true })
          .addTo(group);
      }
    };
    render();
    const unsub = subscribe(render);
    return () => {
      unsub();
      group.remove();
    };
  }, []);

  /* ---------- live location (blue dot / navigation arrow + accuracy) ---------- */
  useEffect(() => {
    const map = mapRef.current!;
    let dot: L.Marker | null = null;
    let acc: L.Circle | null = null;
    let lastFix: unknown = null;
    let iconKey = '';

    /*
     * Which way the arrow points (like Google Maps):
     *  - driving (> 18 km/h): GPS direction of travel — a compass is unreliable inside a vehicle;
     *  - standing / walking: the phone's compass;
     *  - neither available: the direction of the road being navigated.
     * Hysteresis (switch to GPS above 5 m/s, back below 3 m/s) stops it flipping between sources.
     */
    let useCourse = false;
    const target = (): number | null => {
      const s = getState();
      const fix = s.geo.fix;
      const speed = fix?.speed ?? 0;
      const course = fix && fix.heading != null && !Number.isNaN(fix.heading) ? fix.heading : null;
      if (course == null) useCourse = false;
      else if (!useCourse && speed > 5) useCourse = true;
      else if (useCourse && speed < 3) useCourse = false;
      if (useCourse && course != null) return course;
      const c = compassHeading();
      if (c != null) return c;
      if (course != null && speed > 1) return course;
      if (s.nav.active && s.nav.mode === 'live') return s.nav.progress?.bearing ?? null;
      return null;
    };

    // one animation loop eases the drawn angle toward the target — smooth whatever the source
    let shown: number | null = null;
    let lastFrame = 0;
    let raf = 0;
    let lastWritten = NaN;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const node = dot?.getElement();
      if (!node) return;
      const puck = node.querySelector('.er-nav-puck') as HTMLElement | null;
      const beam = node.querySelector('.er-user-heading') as HTMLElement | null;
      const t = target();
      if (t == null) {
        if (beam && beam.style.display !== 'none') beam.style.display = 'none';
        lastFrame = now;
        return;
      }
      const dt = lastFrame ? Math.min(100, now - lastFrame) : 16;
      lastFrame = now;
      if (shown == null) shown = t;
      else {
        let d = t - (((shown % 360) + 360) % 360);
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        if (Math.abs(d) < 0.5) d = 0; // dead band: no micro-wobble when the phone is still
        shown += d * (1 - Math.exp(-dt / 160));
      }
      const deg = Math.round(shown * 10) / 10;
      if (deg === lastWritten && !(beam && beam.style.display === 'none')) return;
      lastWritten = deg;
      const tf = `rotate(${deg}deg)`;
      if (puck) puck.style.transform = tf;
      if (beam) {
        beam.style.display = '';
        beam.style.transform = tf;
      }
    };
    raf = requestAnimationFrame(frame);

    const render = () => {
      const { fix, status, watching } = getState().geo;
      const navigating = getState().nav.active && getState().nav.mode === 'live';
      const stale = status === 'stale';
      const key = `${stale}|${navigating}`;
      if (fix === lastFix && key === iconKey && (!!dot === !!(fix && watching))) return;
      lastFix = fix;
      // only show the dot while the browser is actually delivering positions
      if (!fix || !watching) {
        dot?.remove();
        acc?.remove();
        dot = acc = null;
        iconKey = '';
        return;
      }
      const ll: L.LatLngExpression = [fix.lat, fix.lon];
      if (!acc) acc = L.circle(ll, { pane: 'user', radius: fix.accuracy, color: '#3B82F6', weight: 1, opacity: 0.6, fillColor: '#3B82F6', fillOpacity: 0.12, interactive: false }).addTo(map);
      else {
        acc.setLatLng(ll);
        acc.setRadius(fix.accuracy);
      }
      acc.setStyle({ opacity: fix.accuracy > GPS.poorAccuracyM ? 0.3 : 0.6 });
      if (!dot) {
        dot = L.marker(ll, { pane: 'user', icon: userDotIcon(stale, shown, navigating), interactive: false, keyboard: false }).addTo(map);
        iconKey = key;
        lastWritten = NaN;
      } else {
        dot.setLatLng(ll); // position only — the arrow element is kept, so its rotation never resets
        if (key !== iconKey) {
          dot.setIcon(userDotIcon(stale, shown, navigating));
          iconKey = key;
          lastWritten = NaN;
        }
      }
    };
    render();
    const unsub = subscribe(render);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
      dot?.remove();
      acc?.remove();
    };
  }, []);

  return <div ref={el} className="map" role="application" aria-label="Interactive map of Mumbai" />;
}

/** Padding that keeps fitted content clear of floating UI (search card, bottom sheet, sidebar). */
function paddingForUi(): { tl: L.Point; br: L.Point } {
  const desktop = window.matchMedia('(min-width: 900px)').matches;
  if (desktop && !document.querySelector('.nav-top')) {
    const sidebar = document.querySelector('.sidebar:not(.is-collapsed)') as HTMLElement | null;
    return { tl: L.point((sidebar?.offsetWidth ?? 0) + 40, 60), br: L.point(70, 40) };
  }
  const navTop = document.querySelector('.nav-top') as HTMLElement | null;
  const navBottom = document.querySelector('.nav-bottom') as HTMLElement | null;
  if (navTop && navBottom) {
    // navigation camera: keep the user in the lower part of the visible map, like a car navigator
    const t = navTop.getBoundingClientRect().bottom;
    const b = window.innerHeight - navBottom.getBoundingClientRect().top;
    const visible = window.innerHeight - t - b;
    return { tl: L.point(16, t + Math.max(0, visible * 0.35)), br: L.point(16, b + 8) };
  }
  const top = (document.querySelector('.mobile-top') as HTMLElement | null)?.getBoundingClientRect().bottom ?? 120;
  const sheet = document.querySelector('.sheet') as HTMLElement | null;
  const sheetTop = sheet ? sheet.getBoundingClientRect().top : window.innerHeight - 200;
  const bottom = Math.max(80, window.innerHeight - sheetTop + 16);
  return { tl: L.point(24, top + 16), br: L.point(24, Math.min(bottom, window.innerHeight * 0.55)) };
}
