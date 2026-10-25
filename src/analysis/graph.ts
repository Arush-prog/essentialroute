import { hav, segmentCircleClip } from '../lib/geo';
import type { RawWay } from '../services/overpass';
import type { ActiveZone, LatLon } from '../types';

/**
 * Compact undirected road graph built from OpenStreetMap ways.
 * Topology comes from shared OSM node IDs, so junctions are real junctions.
 * Limitations (disclosed in the UI): major roads only, one-way restrictions and
 * turn restrictions are ignored, edge weight = length in metres.
 */
export interface RoadGraph {
  lat: Float64Array;
  lon: Float64Array;
  /** CSR adjacency */
  adjStart: Int32Array;
  adjNode: Int32Array;
  adjEdge: Int32Array;
  edgeA: Int32Array;
  edgeB: Int32Array;
  edgeLen: Float64Array;
  edgeWay: Int32Array; // index into ways
  wayIds: number[];
  wayNames: (string | undefined)[];
  nodeCount: number;
  edgeCount: number;
  grid: Map<string, number[]>;
  componentOf: Int32Array;
  mainComponent: number;
  builtAt: number;
}

const CELL = 0.005; // ~550 m
const cellKey = (lat: number, lon: number) => `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;

export function buildGraph(ways: RawWay[]): RoadGraph {
  const idx = new Map<number, number>();
  const lat: number[] = [];
  const lon: number[] = [];
  const eA: number[] = [];
  const eB: number[] = [];
  const eL: number[] = [];
  const eW: number[] = [];
  const nodeOf = (osmId: number, la: number, lo: number) => {
    let i = idx.get(osmId);
    if (i === undefined) {
      i = lat.length;
      idx.set(osmId, i);
      lat.push(la);
      lon.push(lo);
    }
    return i;
  };
  ways.forEach((w, wi) => {
    for (let k = 1; k < w.nodes.length; k++) {
      const a = nodeOf(w.nodes[k - 1], w.geometry[k - 1].lat, w.geometry[k - 1].lon);
      const b = nodeOf(w.nodes[k], w.geometry[k].lat, w.geometry[k].lon);
      if (a === b) continue;
      eA.push(a);
      eB.push(b);
      eL.push(hav([lat[a], lon[a]], [lat[b], lon[b]]));
      eW.push(wi);
    }
  });
  const n = lat.length;
  const m = eA.length;
  const deg = new Int32Array(n + 1);
  for (let e = 0; e < m; e++) {
    deg[eA[e] + 1]++;
    deg[eB[e] + 1]++;
  }
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
  const adjStart = deg;
  const fill = adjStart.slice(0, n);
  const adjNode = new Int32Array(2 * m);
  const adjEdge = new Int32Array(2 * m);
  for (let e = 0; e < m; e++) {
    adjNode[fill[eA[e]]] = eB[e];
    adjEdge[fill[eA[e]]++] = e;
    adjNode[fill[eB[e]]] = eA[e];
    adjEdge[fill[eB[e]]++] = e;
  }
  const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = cellKey(lat[i], lon[i]);
    const arr = grid.get(k);
    if (arr) arr.push(i);
    else grid.set(k, [i]);
  }
  const g: RoadGraph = {
    lat: Float64Array.from(lat),
    lon: Float64Array.from(lon),
    adjStart,
    adjNode,
    adjEdge,
    edgeA: Int32Array.from(eA),
    edgeB: Int32Array.from(eB),
    edgeLen: Float64Array.from(eL),
    edgeWay: Int32Array.from(eW),
    wayIds: ways.map((w) => w.id),
    wayNames: ways.map((w) => w.name),
    nodeCount: n,
    edgeCount: m,
    grid,
    componentOf: new Int32Array(n),
    mainComponent: 0,
    builtAt: Date.now(),
  };
  const comp = components(g, null);
  g.componentOf = comp.componentOf;
  g.mainComponent = comp.largest;
  return g;
}

/** Nearest graph node within maxM metres (optionally restricted to a component). */
export function snap(g: RoadGraph, p: LatLon, maxM = 800, component?: number): number {
  const r = Math.ceil(maxM / 550) + 1;
  const ci = Math.floor(p.lat / CELL);
  const cj = Math.floor(p.lon / CELL);
  let best = -1;
  let bestD = maxM;
  for (let di = -r; di <= r; di++)
    for (let dj = -r; dj <= r; dj++) {
      const arr = g.grid.get(`${ci + di}:${cj + dj}`);
      if (!arr) continue;
      for (const i of arr) {
        if (component !== undefined && g.componentOf[i] !== component) continue;
        const d = hav([p.lat, p.lon], [g.lat[i], g.lon[i]]);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
  return best;
}

/** Nodes within radius of a point. */
export function nodesWithin(g: RoadGraph, p: LatLon, radiusM: number): number[] {
  const r = Math.ceil(radiusM / 550) + 1;
  const ci = Math.floor(p.lat / CELL);
  const cj = Math.floor(p.lon / CELL);
  const out: number[] = [];
  for (let di = -r; di <= r; di++)
    for (let dj = -r; dj <= r; dj++) {
      const arr = g.grid.get(`${ci + di}:${cj + dj}`);
      if (!arr) continue;
      for (const i of arr) if (hav([p.lat, p.lon], [g.lat[i], g.lon[i]]) <= radiusM) out.push(i);
    }
  return out;
}

export interface FloodWeights {
  /** Infinity = impassable */
  weight: Float64Array;
  affectedEdges: number;
  blockedEdges: number;
  affectedWays: Set<number>;
}

/** Applies flood zones to every edge using exact segment–circle intersection. */
/**
 * `safety`: for a SAFEST-path search, roads inside passable (low/moderate) zones cost 8× their
 * normal penalty, so the search avoids them unless there is truly no other way.
 */
export function floodWeights(g: RoadGraph, zones: ActiveZone[], safety = false): FloodWeights {
  const weight = Float64Array.from(g.edgeLen);
  let affectedEdges = 0;
  let blockedEdges = 0;
  const affectedWays = new Set<number>();
  if (!zones.length) return { weight, affectedEdges, blockedEdges, affectedWays };
  for (const z of zones) {
    const cand = new Set<number>();
    for (const v of nodesWithin(g, z, z.effectiveRadiusM + 600)) {
      for (let k = g.adjStart[v]; k < g.adjStart[v + 1]; k++) cand.add(g.adjEdge[k]);
    }
    for (const e of cand) {
      const a = g.edgeA[e];
      const b = g.edgeB[e];
      const clip = segmentCircleClip([g.lat[a], g.lon[a]], [g.lat[b], g.lon[b]], z, z.effectiveRadiusM);
      if (!clip) continue;
      const wasAffected = weight[e] !== g.edgeLen[e];
      if (z.blocked) {
        if (weight[e] !== Infinity) blockedEdges++;
        weight[e] = Infinity;
      } else if (weight[e] !== Infinity) {
        const inside = (clip[1] - clip[0]) * g.edgeLen[e];
        weight[e] = Math.max(weight[e], g.edgeLen[e] + inside * ((safety ? z.penalty * 8 : z.penalty) - 1));
      }
      if (!wasAffected) affectedEdges++;
      affectedWays.add(g.edgeWay[e]);
    }
  }
  return { weight, affectedEdges, blockedEdges, affectedWays };
}

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): [number, number] {
    const k = this.k, v = this.v;
    const topK = k[0], topV = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return [topK, topV];
  }
}

/** Multi-source Dijkstra. Returns distance (metres, weighted) from the nearest source to every node. */
export function dijkstra(g: RoadGraph, sources: number[], weight: Float64Array): { dist: Float64Array; nearest: Int32Array } {
  const dist = new Float64Array(g.nodeCount).fill(Infinity);
  const nearest = new Int32Array(g.nodeCount).fill(-1);
  const h = new MinHeap();
  sources.forEach((s, i) => {
    if (s < 0) return;
    if (dist[s] > 0) {
      dist[s] = 0;
      nearest[s] = i;
      h.push(0, s);
    }
  });
  while (h.size) {
    const [d, u] = h.pop();
    if (d > dist[u]) continue;
    for (let k = g.adjStart[u]; k < g.adjStart[u + 1]; k++) {
      const w = weight[g.adjEdge[k]];
      if (w === Infinity) continue;
      const v = g.adjNode[k];
      const nd = d + w;
      if (nd < dist[v]) {
        dist[v] = nd;
        nearest[v] = nearest[u];
        h.push(nd, v);
      }
    }
  }
  return { dist, nearest };
}

/** A* shortest path with a haversine heuristic (admissible: weights ≥ geometric length). */
export function aStar(g: RoadGraph, s: number, t: number, weight: Float64Array): { path: number[]; length: number } | null {
  if (s < 0 || t < 0) return null;
  const gScore = new Float64Array(g.nodeCount).fill(Infinity);
  const prev = new Int32Array(g.nodeCount).fill(-1);
  const tl: [number, number] = [g.lat[t], g.lon[t]];
  const hfn = (i: number) => hav([g.lat[i], g.lon[i]], tl);
  const h = new MinHeap();
  gScore[s] = 0;
  h.push(hfn(s), s);
  const closed = new Uint8Array(g.nodeCount);
  while (h.size) {
    const [, u] = h.pop();
    if (closed[u]) continue;
    closed[u] = 1;
    if (u === t) break;
    for (let k = g.adjStart[u]; k < g.adjStart[u + 1]; k++) {
      const w = weight[g.adjEdge[k]];
      if (w === Infinity) continue;
      const v = g.adjNode[k];
      const ng = gScore[u] + w;
      if (ng < gScore[v]) {
        gScore[v] = ng;
        prev[v] = u;
        h.push(ng + hfn(v), v);
      }
    }
  }
  if (gScore[t] === Infinity) return null;
  const path: number[] = [];
  for (let v = t; v !== -1; v = prev[v]) path.push(v);
  path.reverse();
  let length = 0;
  for (let i = 1; i < path.length; i++) length += hav([g.lat[path[i - 1]], g.lon[path[i - 1]]], [g.lat[path[i]], g.lon[path[i]]]);
  return { path, length };
}

/** Connected components, ignoring impassable edges when weights are given. */
export function components(g: RoadGraph, weight: Float64Array | null): { componentOf: Int32Array; largest: number } {
  const comp = new Int32Array(g.nodeCount).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < g.nodeCount; s++) {
    if (comp[s] !== -1) continue;
    const c = sizes.length;
    let size = 0;
    comp[s] = c;
    stack.push(s);
    while (stack.length) {
      const u = stack.pop()!;
      size++;
      for (let k = g.adjStart[u]; k < g.adjStart[u + 1]; k++) {
        if (weight && weight[g.adjEdge[k]] === Infinity) continue;
        const v = g.adjNode[k];
        if (comp[v] === -1) {
          comp[v] = c;
          stack.push(v);
        }
      }
    }
    sizes.push(size);
  }
  let largest = 0;
  sizes.forEach((sz, i) => {
    if (sz > sizes[largest]) largest = i;
  });
  return { componentOf: comp, largest };
}
