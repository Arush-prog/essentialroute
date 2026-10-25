/*
 * Vector basemap inside Leaflet: a MapLibre GL map rendered as a Leaflet layer and kept in sync
 * with Leaflet's view. Vector tiles are drawn at the phone's full pixel density, so roads and
 * labels stay sharp at every zoom level (raster tiles are 256 px images that blur on high-DPI
 * Android screens and at fractional zooms).
 *
 * Adapted from @maplibre/maplibre-gl-leaflet (ISC licence):
 *   Copyright (c) 2021 MapLibre contributors · Copyright (c) 2014, Mapbox
 *   Permission to use, copy, modify, and/or distribute this software for any purpose with or
 *   without fee is hereby granted, provided that the above copyright notice and this permission
 *   notice appear in all copies.
 * MapLibre GL JS is BSD-3-Clause licensed.
 */
import * as L from 'leaflet';
import * as maplibregl from 'maplibre-gl';

/* eslint-disable @typescript-eslint/no-explicit-any */
type GlMap = any;

export interface VectorBaseOptions {
  style: string;
  attribution?: string;
  /** Called once when the style and first tiles have rendered. */
  onReady?: () => void;
  /** Called if the style or tiles fail to load. */
  onError?: (err: unknown) => void;
}

const PADDING = 0.1;

export class VectorBaseLayer extends L.Layer {
  private opts: VectorBaseOptions;
  private container!: HTMLDivElement;
  private gl: GlMap | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private offset = L.point(0, 0);
  private zooming = false;
  private readyFired = false;
  private throttledUpdate: () => void;

  constructor(opts: VectorBaseOptions) {
    super({ pane: 'tilePane', attribution: opts.attribution } as L.LayerOptions);
    this.opts = opts;
    this.throttledUpdate = L.Util.throttle(() => this.update(), 24, this);
  }

  /** The underlying MapLibre map (for drawing the route inside the engine). */
  getGl(): GlMap | null {
    return this.gl;
  }

  getEvents() {
    return {
      move: this.throttledUpdate,
      zoomanim: this.animateZoom,
      zoom: this.pinchZoom,
      zoomstart: this.zoomStart,
      zoomend: this.zoomEnd,
      resize: this.transitionEnd,
    } as unknown as { [name: string]: L.LeafletEventHandlerFn };
  }

  onAdd(map: L.Map) {
    this.container = L.DomUtil.create('div', 'leaflet-gl-layer') as HTMLDivElement;
    this.resizeContainer();
    const topLeft = map.containerPointToLayerPoint([0, 0]).subtract(map.getSize().multiplyBy(PADDING));
    L.DomUtil.setPosition(this.container, topLeft.round());
    map.getPane('tilePane')!.appendChild(this.container);

    const c = map.getCenter();
    const gl: GlMap = new (maplibregl as any).Map({
      container: this.container,
      style: this.opts.style,
      center: [c.lng, c.lat],
      zoom: map.getZoom() - 1,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      // 2× is pin-sharp on every phone; rendering 3× pixels makes mid-range Android GPUs stutter
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      maxTileCacheSize: 200,
    });
    this.gl = gl;
    if (gl.setTransformConstrain) gl.setTransformConstrain((center: unknown, zoom: number) => ({ center, zoom }));
    this.canvas = gl.getCanvas() as HTMLCanvasElement;
    L.DomUtil.addClass(this.canvas, 'leaflet-image-layer');
    L.DomUtil.addClass(this.canvas, 'leaflet-zoom-animated');
    gl.on('idle', () => {
      if (this.readyFired) return;
      this.readyFired = true;
      this.opts.onReady?.();
    });
    gl.on('error', (e: unknown) => {
      if (!this.readyFired) this.opts.onError?.(e);
    });
    this.offset = map.containerPointToLayerPoint([0, 0]);
    if ((map.options as any).zoomAnimation) L.DomEvent.on((map as any)._proxy, L.DomUtil.TRANSITION_END, this.transitionEnd, this);
    return this;
  }

  onRemove(map: L.Map) {
    if ((map as any)._proxy && (map.options as any).zoomAnimation) L.DomEvent.off((map as any)._proxy, L.DomUtil.TRANSITION_END, this.transitionEnd, this);
    this.container.remove();
    this.gl?.remove();
    this.gl = null;
    return this;
  }

  private size() {
    return this._map.getSize().multiplyBy(1 + PADDING * 2);
  }

  private resizeContainer() {
    const s = this.size();
    this.container.style.width = `${s.x}px`;
    this.container.style.height = `${s.y}px`;
  }

  private jump() {
    const c = this._map.getCenter();
    this.gl?.jumpTo({ center: [c.lng, c.lat], zoom: this._map.getZoom() - 1 });
  }

  private update() {
    if (!this._map || !this.gl) return;
    this.offset = this._map.containerPointToLayerPoint([0, 0]);
    if (this.zooming) return;
    const topLeft = this._map.containerPointToLayerPoint([0, 0]).subtract(this._map.getSize().multiplyBy(PADDING));
    L.DomUtil.setPosition(this.container, topLeft.round());
    this.jump();
  }

  private pinchZoom() {
    this.jump();
  }

  private animateZoom(e: L.ZoomAnimEvent) {
    if (!this.canvas) return;
    const map = this._map as any;
    const scale = map.getZoomScale(e.zoom);
    const padding = map.getSize().multiplyBy(PADDING * scale);
    const viewHalf = this.size().divideBy(2);
    const topLeft = map.project(e.center, e.zoom).subtract(viewHalf).add(map._getMapPanePos().add(padding)).round();
    const offset = map.project(map.getBounds().getNorthWest(), e.zoom).subtract(topLeft);
    L.DomUtil.setTransform(this.canvas, offset.subtract(this.offset), scale);
  }

  private zoomStart() {
    this.zooming = true;
  }

  private zoomEnd() {
    if (!this.canvas) return;
    const scale = this._map.getZoomScale(this._map.getZoom());
    L.DomUtil.setTransform(this.canvas, null as unknown as L.Point, scale);
    this.zooming = false;
    this.update();
  }

  private transitionEnd() {
    L.Util.requestAnimFrame(() => {
      if (!this._map || !this.gl || !this.canvas) return;
      const offset = this._map.latLngToContainerPoint(this._map.getBounds().getNorthWest());
      this.resizeContainer();
      this.gl.resize();
      L.DomUtil.setTransform(this.canvas, offset, 1);
      this.gl.once('moveend', () => this.zoomEnd());
      this.jump();
    }, this);
  }
}
