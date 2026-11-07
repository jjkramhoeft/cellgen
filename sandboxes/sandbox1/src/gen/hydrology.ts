/**
 * Hydrology on any cell graph (research §7):
 *  1. ocean = below-sea cells connected to the map border; enclosed below-sea cells are lakes,
 *  2. Priority-Flood (Barnes et al. 2014) with an ε gradient makes every cell drainable,
 *  3. steepest descent on the filled surface gives a drainage forest,
 *  4. flow accumulation in descending filled-height order,
 *  5. rivers = land cells whose flux exceeds a threshold; watersheds = outlet ids.
 * Also O'Leary-style flux erosion, which reuses steps 2–4.
 */
import { MinHeap } from '@shared/core/heap';
import type { CellGraph } from '../graph/types';

export const WATER_LAND = 0;
export const WATER_OCEAN = 1;
export const WATER_LAKE = 2;

export function classifyWater(g: CellGraph, elev: Float64Array): Uint8Array {
  const n = g.n;
  const water = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (elev[i] < 0 && g.border[i]) {
      water[i] = WATER_OCEAN;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const c = queue[head++];
    for (let k = g.nbrOff[c]; k < g.nbrOff[c + 1]; k++) {
      const nb = g.nbr[k];
      if (water[nb] || elev[nb] >= 0) continue;
      water[nb] = WATER_OCEAN;
      queue[tail++] = nb;
    }
  }
  for (let i = 0; i < n; i++) if (!water[i] && elev[i] < 0) water[i] = WATER_LAKE;
  return water;
}

export interface Drainage {
  filled: Float64Array;
  /** downhill neighbour, −1 for ocean / map-edge sinks */
  downhill: Int32Array;
  flux: Float64Array;
  /** cells sorted by descending filled height */
  order: Int32Array;
}

/**
 * Priority-Flood + ε: seeds are ocean cells and border cells; every other cell is
 * raised to at least (lowest spill neighbour + ε), so all land drains to a seed.
 */
export function drain(g: CellGraph, elev: Float64Array, water: Uint8Array, rain: Float64Array | null): Drainage {
  const n = g.n;
  const filled = new Float64Array(n);
  const visited = new Uint8Array(n);
  const heap = new MinHeap(n);
  const EPS = 1e-6;
  for (let i = 0; i < n; i++) {
    if (water[i] === WATER_OCEAN || g.border[i]) {
      filled[i] = elev[i];
      visited[i] = 1;
      heap.push(elev[i], i);
    }
  }
  if (heap.size === 0 && n > 0) {
    // no outlet at all (e.g. 100% land with no border cells): seed the lowest cell
    let lo = 0;
    for (let i = 1; i < n; i++) if (elev[i] < elev[lo]) lo = i;
    filled[lo] = elev[lo];
    visited[lo] = 1;
    heap.push(elev[lo], lo);
  }
  while (heap.size > 0) {
    const c = heap.pop();
    for (let k = g.nbrOff[c]; k < g.nbrOff[c + 1]; k++) {
      const nb = g.nbr[k];
      if (visited[nb]) continue;
      visited[nb] = 1;
      filled[nb] = Math.max(elev[nb], filled[c] + EPS);
      heap.push(filled[nb], nb);
    }
  }
  // isolated cells (no neighbours) keep their elevation
  for (let i = 0; i < n; i++) if (!visited[i]) filled[i] = elev[i];

  const downhill = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (water[i] === WATER_OCEAN) continue;
    let best = -1;
    let bestH = filled[i];
    for (let k = g.nbrOff[i]; k < g.nbrOff[i + 1]; k++) {
      const nb = g.nbr[k];
      if (filled[nb] < bestH || (filled[nb] === bestH && best >= 0 && nb < best)) {
        bestH = filled[nb];
        best = nb;
      }
    }
    downhill[i] = best;
  }
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => filled[b] - filled[a] || a - b);

  let meanArea = 0;
  for (let i = 0; i < n; i++) meanArea += g.area[i];
  meanArea = meanArea / n || 1;
  const flux = new Float64Array(n);
  for (let i = 0; i < n; i++) flux[i] = (rain ? rain[i] : 1) * (g.area[i] / meanArea);
  for (let k = 0; k < n; k++) {
    const i = order[k];
    const d = downhill[i];
    if (d >= 0) flux[d] += flux[i];
  }
  return { filled, downhill, flux, order };
}

export interface RiverNet {
  /** river cells: cell i flows to downhill[i] */
  isRiver: Uint8Array;
  threshold: number;
  maxFlux: number;
  /** polylines of cell ids from source/confluence to confluence/mouth */
  chains: number[][];
  count: number;
}

export function extractRivers(g: CellGraph, dr: Drainage, water: Uint8Array, thresholdFrac: number): RiverNet {
  const n = g.n;
  let total = 0;
  for (let i = 0; i < n; i++) if (water[i] !== WATER_OCEAN && dr.downhill[i] < 0) total += dr.flux[i];
  for (let i = 0; i < n; i++) if (water[i] !== WATER_OCEAN && dr.downhill[i] >= 0 && water[dr.downhill[i]] === WATER_OCEAN) total += dr.flux[i];
  if (total <= 0) total = n;
  const thr = thresholdFrac * total;
  const isRiver = new Uint8Array(n);
  let maxFlux = 0;
  for (let i = 0; i < n; i++) {
    if (water[i] === WATER_LAND && dr.downhill[i] >= 0 && dr.flux[i] >= thr) {
      isRiver[i] = 1;
      maxFlux = Math.max(maxFlux, dr.flux[i]);
    }
  }
  // main upstream = river tributary with the largest flux
  const mainUp = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!isRiver[i]) continue;
    const d = dr.downhill[i];
    if (d < 0) continue;
    const cur = mainUp[d];
    if (cur < 0 || dr.flux[i] > dr.flux[cur] || (dr.flux[i] === dr.flux[cur] && i < cur)) mainUp[d] = i;
  }
  const chains: number[][] = [];
  let mouths = 0;
  for (let k = 0; k < n; k++) {
    const i = dr.order[k];
    if (!isRiver[i]) continue;
    const d = dr.downhill[i];
    // start a chain at sources and at tributaries (cells that are not the main upstream of their downstream)
    const isStart = mainUp[i] < 0 || false;
    const isTrib = d >= 0 && mainUp[d] !== i;
    if (!isStart && !isTrib) continue;
    const chain = [i];
    let cur = i;
    for (;;) {
      const nx = dr.downhill[cur];
      if (nx < 0) break;
      chain.push(nx);
      if (!isRiver[nx] || mainUp[nx] !== cur) break;
      cur = nx;
    }
    if (!isRiver[chain[chain.length - 1]]) mouths++;
    chains.push(chain);
  }
  return { isRiver, threshold: thr, maxFlux, chains, count: mouths };
}

export function watersheds(g: CellGraph, dr: Drainage): Int32Array {
  const basin = new Int32Array(g.n);
  for (let k = g.n - 1; k >= 0; k--) {
    const i = dr.order[k];
    const d = dr.downhill[i];
    basin[i] = d < 0 ? i : basin[d];
  }
  return basin;
}

/**
 * Flux erosion after O'Leary (mewo2/terrain): erosion rate ∝ √flux·slope + slope²,
 * normalised and scaled, repeated with a fresh fill each time.
 */
export function erode(g: CellGraph, elev: Float64Array, iterations: number, rate: number): void {
  const n = g.n;
  for (let it = 0; it < iterations; it++) {
    const water = classifyWater(g, elev);
    const dr = drain(g, elev, water, null);
    const er = new Float64Array(n);
    let maxE = 0;
    for (let i = 0; i < n; i++) {
      if (water[i] !== WATER_LAND) continue;
      const d = dr.downhill[i];
      if (d < 0) continue;
      const dx = g.x[d] - g.x[i];
      const dy = g.y[d] - g.y[i];
      const dist = Math.sqrt(dx * dx + dy * dy) / g.spacing || 1;
      const slope = Math.max(0, (dr.filled[i] - dr.filled[d]) / dist);
      const e = Math.min(Math.sqrt(dr.flux[i]) * slope + slope * slope, 1e3);
      er[i] = e;
      if (e > maxE) maxE = e;
    }
    if (maxE <= 0) break;
    for (let i = 0; i < n; i++) {
      if (er[i] > 0) elev[i] = Math.max(1e-4, elev[i] - (rate * er[i]) / maxE);
    }
  }
  // re-stretch land so the highest peak is 1 again
  let hi = 0;
  for (let i = 0; i < n; i++) hi = Math.max(hi, elev[i]);
  if (hi > 0) for (let i = 0; i < n; i++) if (elev[i] > 0) elev[i] /= hi;
}
