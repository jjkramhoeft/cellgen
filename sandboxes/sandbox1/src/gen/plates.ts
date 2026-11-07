/**
 * Cheap tectonic plates on the cell graph (research §7 design note): grow plates as
 * a randomised flood fill, give each a velocity, and raise or lower elevation along
 * boundaries by the sign of relative convergence, decaying with distance.
 */
import { hash3, rand01, STAGE, toUnit } from '@shared/core/hash';
import { dcos, dsin, DPI } from '@shared/core/dmath';
import { MinHeap } from '@shared/core/heap';
import type { CellGraph } from '../graph/types';
import { num, type Params } from '../params/schema';

export interface Plate {
  seed: number;
  oceanic: boolean;
  vx: number;
  vy: number;
}

export interface PlateResult {
  plateId: Int32Array;
  plates: Plate[];
  /** 0 interior, 1 convergent, 2 divergent, 3 transform */
  boundary: Int8Array;
  height: Float64Array;
}

export function generatePlates(g: CellGraph, p: Params, seed: number): PlateResult {
  const n = g.n;
  const K = Math.min(n, Math.max(1, num(p, 'plates.count')));
  const oceanicFrac = num(p, 'plates.oceanic');
  const strength = num(p, 'plates.strength');
  const width = num(p, 'plates.width') * g.W;
  const plates: Plate[] = [];
  const plateId = new Int32Array(n).fill(-1);
  const cost = new Float64Array(n).fill(Infinity);
  const heap = new MinHeap(n);
  const used = new Set<number>();
  for (let k = 0; k < K; k++) {
    let c = Math.floor(rand01(seed, STAGE.plates, k) * n);
    let guard = 0;
    while (used.has(c) && guard++ < n) c = (c + 1) % n;
    used.add(c);
    const a = 2 * DPI * rand01(seed, STAGE.plates + 1, k);
    const speed = 0.3 + 0.7 * rand01(seed, STAGE.plates + 2, k);
    plates.push({ seed: c, oceanic: rand01(seed, STAGE.plates + 3, k) < oceanicFrac, vx: speed * dcos(a), vy: speed * dsin(a) });
    cost[c] = 0;
    plateId[c] = k;
    heap.push(0, c);
  }
  // randomised Dijkstra flood fill → irregular plate shapes
  while (heap.size > 0) {
    const key = heap.peekKey();
    const c = heap.pop();
    if (key > cost[c]) continue;
    for (let q = g.nbrOff[c]; q < g.nbrOff[c + 1]; q++) {
      const nb = g.nbr[q];
      const dx = g.x[nb] - g.x[c];
      const dy = g.y[nb] - g.y[c];
      const w = Math.sqrt(dx * dx + dy * dy) * (0.3 + 1.4 * toUnit(hash3(seed, STAGE.plates + 7, nb)));
      const nc = cost[c] + w;
      if (nc < cost[nb]) {
        cost[nb] = nc;
        plateId[nb] = plateId[c];
        heap.push(nc, nb);
      }
    }
  }
  for (let i = 0; i < n; i++) if (plateId[i] < 0) plateId[i] = 0;

  // boundary effect per boundary cell
  const boundary = new Int8Array(n);
  const effect = new Float64Array(n);
  const isB = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const pi = plates[plateId[i]];
    let best = 0;
    let bestAbs = -1;
    let type = 0;
    for (let q = g.nbrOff[i]; q < g.nbrOff[i + 1]; q++) {
      const j = g.nbr[q];
      if (plateId[j] === plateId[i]) continue;
      const pj = plates[plateId[j]];
      let nx = g.x[j] - g.x[i];
      let ny = g.y[j] - g.y[i];
      const L = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= L;
      ny /= L;
      const conv = (pi.vx - pj.vx) * nx + (pi.vy - pj.vy) * ny;
      const shear = Math.abs((pi.vx - pj.vx) * -ny + (pi.vy - pj.vy) * nx);
      let e: number;
      if (conv > 0) {
        if (!pi.oceanic && !pj.oceanic) e = 1.0 * conv;
        else if (!pi.oceanic && pj.oceanic) e = 0.75 * conv;
        else if (pi.oceanic && !pj.oceanic) e = -0.6 * conv;
        else e = 0.45 * conv;
      } else {
        e = pi.oceanic ? 0.3 * -conv : -0.45 * -conv;
      }
      if (Math.abs(e) > bestAbs) {
        bestAbs = Math.abs(e);
        best = e;
        type = Math.abs(conv) < 0.35 * shear ? 3 : conv > 0 ? 1 : 2;
      }
    }
    if (bestAbs >= 0) {
      isB[i] = 1;
      effect[i] = best;
      boundary[i] = type;
    }
  }
  // spread boundary effect inward with a quadratic falloff
  const d = new Float64Array(n).fill(Infinity);
  const src = new Int32Array(n).fill(-1);
  const h2 = new MinHeap(n);
  for (let i = 0; i < n; i++) {
    if (isB[i]) {
      d[i] = 0;
      src[i] = i;
      h2.push(0, i);
    }
  }
  while (h2.size > 0) {
    const key = h2.peekKey();
    const c = h2.pop();
    if (key > d[c] || key > width) continue;
    for (let q = g.nbrOff[c]; q < g.nbrOff[c + 1]; q++) {
      const nb = g.nbr[q];
      if (plateId[nb] !== plateId[c]) continue;
      const dx = g.x[nb] - g.x[c];
      const dy = g.y[nb] - g.y[c];
      const nd = d[c] + Math.sqrt(dx * dx + dy * dy);
      if (nd < d[nb]) {
        d[nb] = nd;
        src[nb] = src[c];
        h2.push(nd, nb);
      }
    }
  }
  const height = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const pl = plates[plateId[i]];
    let base = pl.oceanic ? -0.5 : 0.3;
    base += 0.1 * (rand01(seed, STAGE.plates + 5, plateId[i]) - 0.5);
    let b = 0;
    if (src[i] >= 0 && d[i] < width) {
      const t = 1 - d[i] / width;
      b = effect[src[i]] * t * t;
    }
    height[i] = base + strength * b;
  }
  return { plateId, plates, boundary, height };
}
