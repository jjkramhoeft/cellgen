/**
 * Fractal Voronoi field and the land/water split.
 *
 * Octave k is a lattice Voronoi diagram (lattice.ts) with cell size
 * size₀ / lacunarityᵏ, its own seed and its own lattice offset. Each cell gets a value
 * that depends only on its site S:
 *
 *   g_k(S) = (1 − ρ)·B(S) + ρ·R_k(cell) + σ·shape(S)
 *
 * B is a smooth fBm (or ridged) "continent" noise sampled at the site, R_k is a
 * per-cell random number in [−1, 1], and shape is an optional island / coast / atoll
 * bias. The field value is the gain-weighted mean over octaves:
 *
 *   v(x) = Σ gainᵏ · g_k(S_k(x)) / Σ gainᵏ
 *
 * v is piecewise constant on the overlay of all octaves' cells. So the coastline
 * {v = T} is made only of Voronoi edges: big cells give the outline, smaller
 * octaves refine it with fractal detail. The threshold T is the (1 − land) quantile
 * of v over the map, measured on an analysis grid. That makes the land/water ratio
 * a direct parameter.
 *
 * Optional per-octave domain warping bends the cell borders.
 *
 * Shape "random oceans" works differently: N = ⌈water% / 10⌉ random octave-1 cells
 * seed oceans (≤ 10 % water → 1 seed, 10–20 % → 2, …). A multi-source flood then
 * converts neighbouring cells to water, cheapest first, until the whole map is
 * ordered. A cell's value is the water share already reached when the flood took
 * it, so the quantile threshold stops the flood exactly at the target water share.
 * Value noise and cell randomness set how costly a cell is to flood, so oceans grow
 * around high ground and along irregular fronts. Finer octaves take the value of
 * the octave-1 cell their site lies in, plus a little per-cell randomness, which
 * gives the coastline fractal detail.
 */
import { rand01, hash4, sfc32, toUnit } from '@shared/core/hash';
import { MinHeap } from '@shared/core/heap';
import { dpow } from '@shared/core/dmath';
import { fbm, ridged, warpVec } from '@shared/core/noise';
import { Lattice, cellId, newHit, type Hit, type WeightMode } from './lattice';
import { Metric, type MetricOptions } from './metrics';

export type ValueNoise = 'fbm' | 'ridged';
export type Shape = 'none' | 'island' | 'coast' | 'atoll' | 'twin' | 'oceans';

export interface FieldParams {
  seed: number;
  /** map extent, world units */
  W: number;
  H: number;
  octaves: number;
  /** octave-0 lattice cell size, world units */
  cellSize: number;
  lacunarity: number;
  gain: number;
  jitter: number;
  metric: MetricOptions;
  /** metric for octaves ≥ 2 (null = same as octave 1) */
  detailMetric: MetricOptions | null;
  weightMode: WeightMode;
  weightAmt: number;
  /** border warp amplitude in units of the octave's cell size */
  warpAmp: number;
  /** border warp frequency in cycles per cell */
  warpFreq: number;
  noise: ValueNoise;
  /** continent noise feature size, world units */
  featureScale: number;
  /** ρ: share of per-cell randomness in a cell's value */
  roughness: number;
  shape: Shape;
  /** σ: strength of the shape bias */
  shapeAmt: number;
  /** target land fraction in [0, 1] */
  land: number;
}

/** Per-point result of sampling the field. */
export interface Sample {
  /** one hit per octave */
  hits: Hit[];
  /** packed cell id per octave */
  ids: Int32Array;
  /** cell value g_k per octave */
  vals: Float64Array;
  /** field value */
  v: number;
}

export function newSample(octaves: number): Sample {
  return {
    hits: Array.from({ length: octaves }, newHit),
    ids: new Int32Array(octaves),
    vals: new Float64Array(octaves),
    v: 0,
  };
}

export type Sampler = (wx: number, wy: number, out: Sample) => Sample;

const ST_RAND = 0x7a11;
const ST_OFFSET = 0x7a12;
const ST_OCEAN = 0x7a13;
/** analysis grid width used to find octave-1 cell areas and neighbours for the ocean flood */
const OCEAN_GRID = 320;

/** Number of ocean seeds for a water fraction: ≤ 10 % → 1, (10, 20] % → 2, … 100 % → 10. */
export function oceanSeedCount(water: number): number {
  return Math.min(10, Math.max(1, Math.ceil(water * 10 - 1e-9)));
}

export interface OceanFlood {
  /** seed cells, world coordinates of their sites */
  seeds: { i: number; j: number; x: number; y: number }[];
  /** flood value per octave-1 cell id in [−1, 1]: water share reached when the cell flooded */
  value: Map<number, number>;
  /** octave-1 cells taking part (those with area inside the map) */
  cells: number;
}
const NOISE = { octaves: 4, lacunarity: 2, gain: 0.5 };
const WARP = { octaves: 2, lacunarity: 2, gain: 0.5 };

export interface Calibration {
  /** land/water threshold: land where v > threshold */
  threshold: number;
  vmin: number;
  vmax: number;
  /** analysis grid size and contents */
  gw: number;
  gh: number;
  /** field value per grid sample */
  values: Float64Array;
  /** cell id per octave per grid sample (octave-major) */
  ids: Int32Array;
  /** 99th-percentile F1, F2, F2 − F1 per octave, and of the fractal F1 sum */
  f1Max: number[];
  f2Max: number[];
  dfMax: number[];
  f1SumMax: number;
  /** mean lattice cells visited per octave query */
  visited: number;
  ms: number;
}

export class Field {
  readonly p: FieldParams;
  readonly octaves: number;
  readonly lattices: Lattice[];
  /** gain-weighted octave amplitudes, normalised to sum 1 */
  readonly amps: Float64Array;
  private readonly noiseSeed: number;
  private readonly warpSeed: number;
  /** random-oceans flood (only for shape "oceans") */
  readonly oceans: OceanFlood | null;
  private readonly tmpWv = new Float64Array(2);
  private readonly tmpQ = new Float64Array(2);
  private readonly tmpHit = newHit();

  constructor(p: FieldParams, pow: (x: number, y: number) => number = dpow) {
    this.p = p;
    this.octaves = Math.max(1, Math.min(4, Math.floor(p.octaves)));
    this.noiseSeed = (p.seed ^ 0x1b873593) | 0;
    this.warpSeed = (p.seed ^ 0x2c1b3c6d) | 0;
    const base = new Metric(p.metric, pow);
    const detail = p.detailMetric ? new Metric(p.detailMetric, pow) : base;
    this.lattices = [];
    const amps: number[] = [];
    let size = p.cellSize;
    let a = 1;
    for (let k = 0; k < this.octaves; k++) {
      const seed = (p.seed + Math.imul(k + 1, 0x9e3779b9)) | 0;
      this.lattices.push(
        new Lattice({
          seed,
          size,
          // offset each octave's lattice so lattice lines never line up
          ox: k === 0 ? 0 : rand01(p.seed, ST_OFFSET, k * 2) * size,
          oy: k === 0 ? 0 : rand01(p.seed, ST_OFFSET, k * 2 + 1) * size,
          jitter: p.jitter,
          metric: k === 0 ? base : detail,
          weightMode: p.weightMode,
          weightAmt: p.weightAmt,
        }),
      );
      amps.push(a);
      a *= p.gain;
      size /= Math.max(1.01, p.lacunarity);
    }
    const sum = amps.reduce((s, x) => s + x, 0);
    this.amps = Float64Array.from(amps, (x) => x / sum);
    this.oceans = p.shape === 'oceans' ? this.floodOceans() : null;
  }

  /** The query point octave k actually sees (domain-warped when border warp is on). */
  warpPoint(k: number, wx: number, wy: number, wv: Float64Array, out: Float64Array): Float64Array {
    const lat = this.lattices[k];
    out[0] = wx;
    out[1] = wy;
    if (this.p.warpAmp > 0) {
      const f = this.p.warpFreq / lat.size;
      warpVec((this.warpSeed + k * 7919) | 0, wx * f, wy * f, WARP, wv);
      out[0] += this.p.warpAmp * lat.size * wv[0];
      out[1] += this.p.warpAmp * lat.size * wv[1];
    }
    return out;
  }

  /** Grow "random oceans" over the octave-1 cells (see the file comment). */
  private floodOceans(): OceanFlood {
    const { W, H } = this.p;
    const lat = this.lattices[0];
    const gw = OCEAN_GRID;
    const gh = Math.max(2, Math.round((gw * H) / W));
    const hit = newHit();
    const wv = new Float64Array(2);
    const q = new Float64Array(2);
    // 1. octave-1 cell of every grid sample -> cell list, areas, adjacency
    const index = new Map<number, number>();
    const ci: number[] = [];
    const cj: number[] = [];
    const area: number[] = [];
    const grid = new Int32Array(gw * gh);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        this.warpPoint(0, ((x + 0.5) * W) / gw, ((y + 0.5) * H) / gh, wv, q);
        lat.query(q[0], q[1], hit);
        const id = cellId(hit.i1, hit.j1);
        let c = index.get(id);
        if (c === undefined) {
          c = ci.length;
          index.set(id, c);
          ci.push(hit.i1);
          cj.push(hit.j1);
          area.push(0);
        }
        area[c]++;
        grid[y * gw + x] = c;
      }
    }
    const n = ci.length;
    const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
    const link = (a: number, b: number) => {
      if (a === b) return;
      adj[a].add(b);
      adj[b].add(a);
    };
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const a = grid[y * gw + x];
        if (x < gw - 1) link(a, grid[y * gw + x + 1]);
        if (y < gh - 1) link(a, grid[(y + 1) * gw + x]);
      }
    }
    // 2. flood cost per cell: smooth noise (high ground resists) mixed with per-cell randomness
    const rho = this.p.roughness;
    const cost = new Float64Array(n);
    const siteX = (c: number) => lat.toWorldX(lat.siteX(ci[c], cj[c]));
    const siteY = (c: number) => lat.toWorldY(lat.siteY(ci[c], cj[c]));
    for (let c = 0; c < n; c++) {
      const u = toUnit(hash4(lat.seed, ST_OCEAN, ci[c], cj[c]));
      const b = (this.continent(siteX(c), siteY(c)) + 1) / 2;
      cost[c] = 1 + 4 * (rho * u + (1 - rho) * b);
    }
    // 3. seeds: ceil(water / 10 %) distinct random cells (partial Fisher-Yates)
    const water = 1 - Math.min(1, Math.max(0, this.p.land));
    const count = Math.min(n, oceanSeedCount(water));
    const rng = sfc32((this.p.seed ^ 0x0cea0001) | 0);
    const order = Array.from({ length: n }, (_, c) => c);
    const seeds: OceanFlood['seeds'] = [];
    const heap = new MinHeap(n);
    const dist = new Float64Array(n).fill(Infinity);
    for (let s = 0; s < count; s++) {
      const r = s + rng.int(n - s);
      const t = order[s];
      order[s] = order[r];
      order[r] = t;
      const c = order[s];
      dist[c] = 0;
      heap.push(0, c);
      seeds.push({ i: ci[c], j: cj[c], x: siteX(c), y: siteY(c) });
    }
    // 4. multi-source Dijkstra: all oceans grow at once, cheapest neighbour first
    const total = gw * gh;
    const value = new Map<number, number>();
    const done = new Uint8Array(n);
    let flooded = 0;
    while (heap.size > 0) {
      const d = heap.peekKey();
      const c = heap.pop();
      if (done[c] || d > dist[c]) continue;
      done[c] = 1;
      value.set(cellId(ci[c], cj[c]), -1 + (2 * (flooded + area[c] / 2)) / total);
      flooded += area[c];
      for (const nb of adj[c]) {
        const nd = d + cost[nb];
        if (!done[nb] && nd < dist[nb]) {
          dist[nb] = nd;
          heap.push(nd, nb);
        }
      }
    }
    // cells the flood could not reach (none on a connected map) stay land
    for (let c = 0; c < n; c++) if (!done[c]) value.set(cellId(ci[c], cj[c]), 1);
    return { seeds, value, cells: n };
  }

  /** Ocean-flood value of the octave-1 cell containing world point (x, y). Outside the map = deep water. */
  private oceanAt(x: number, y: number): number {
    this.warpPoint(0, x, y, this.tmpWv, this.tmpQ);
    const h = this.lattices[0].query(this.tmpQ[0], this.tmpQ[1], this.tmpHit);
    return this.oceans!.value.get(cellId(h.i1, h.j1)) ?? -1;
  }

  /** Smooth "continent" noise at a world point. */
  private continent(x: number, y: number): number {
    const f = 1 / Math.max(1, this.p.featureScale);
    const n = this.p.noise === 'ridged' ? ridged(this.noiseSeed, x * f, y * f, NOISE) : fbm(this.noiseSeed, x * f, y * f, NOISE);
    return Math.max(-1, Math.min(1, n * 1.6));
  }

  /** Shape bias in roughly [−1, 1] (positive favours land). */
  shapeAt(x: number, y: number): number {
    const { W, H } = this.p;
    const nx = (x - W / 2) / (W / 2);
    const ny = (y - H / 2) / (H / 2);
    switch (this.p.shape) {
      case 'island': {
        const r2 = nx * nx + ny * ny;
        return 1 - 2 * r2;
      }
      case 'coast':
        return -nx * 1.2 + 0.2;
      case 'atoll': {
        const r = Math.sqrt(nx * nx + ny * ny);
        return 1 - 5 * Math.abs(r - 0.55);
      }
      case 'twin': {
        const ax = nx + 0.45;
        const bx = nx - 0.45;
        const da = ax * ax * 2.2 + ny * ny;
        const db = bx * bx * 2.2 + ny * ny;
        return 1 - 2.2 * Math.min(da, db);
      }
      default:
        return 0;
    }
  }

  /** Value of a cell of octave k, from its site (world units) and lattice cell. */
  cellValue(k: number, i: number, j: number, sx: number, sy: number): number {
    const rho = this.p.roughness;
    const lat = this.lattices[k];
    const rnd = toUnit(hash4(lat.seed, ST_RAND, i, j)) * 2 - 1;
    if (this.oceans) {
      if (k === 0) return this.oceans.value.get(cellId(i, j)) ?? -1;
      // finer cells follow the octave-1 cell holding their site, roughened slightly
      return this.oceanAt(sx, sy) + rho * 0.12 * rnd;
    }
    let g = (1 - rho) * this.continent(sx, sy) + rho * rnd;
    if (this.p.shape !== 'none') g += this.p.shapeAmt * this.shapeAt(sx, sy);
    return g;
  }

  /**
   * A sampling function with its own caches (cell values are memoised per octave).
   * Each raster job or analysis pass should make its own sampler.
   */
  makeSampler(): Sampler {
    const K = this.octaves;
    const lats = this.lattices;
    const amps = this.amps;
    const caches: Map<number, number>[] = Array.from({ length: K }, () => new Map());
    const lastId = new Int32Array(K).fill(0x7fffffff);
    const lastVal = new Float64Array(K);
    const wv = new Float64Array(2);
    const q = new Float64Array(2);
    return (wx, wy, out) => {
      let v = 0;
      for (let k = 0; k < K; k++) {
        const lat = lats[k];
        this.warpPoint(k, wx, wy, wv, q);
        const h = lat.query(q[0], q[1], out.hits[k]);
        const id = cellId(h.i1, h.j1);
        out.ids[k] = id;
        let g: number;
        if (id === lastId[k]) g = lastVal[k];
        else {
          const cache = caches[k];
          const c = cache.get(id);
          if (c !== undefined) g = c;
          else {
            g = this.cellValue(k, h.i1, h.j1, lat.toWorldX(h.x1), lat.toWorldY(h.y1));
            if (cache.size > 200000) cache.clear();
            cache.set(id, g);
          }
          lastId[k] = id;
          lastVal[k] = g;
        }
        out.vals[k] = g;
        v += amps[k] * g;
      }
      out.v = v;
      return out;
    };
  }

  /**
   * Sample the map on a gw × gh analysis grid, then set the land/water threshold
   * from the target land fraction and measure value / distance ranges for display.
   */
  calibrate(gw: number): Calibration {
    const t0 = performance.now();
    const { W, H } = this.p;
    const gh = Math.max(2, Math.round((gw * H) / W));
    const K = this.octaves;
    const n = gw * gh;
    const values = new Float64Array(n);
    const ids = new Int32Array(n * K);
    const f1s: Float64Array[] = Array.from({ length: K }, () => new Float64Array(n));
    const f2s: Float64Array[] = Array.from({ length: K }, () => new Float64Array(n));
    const f1Sum = new Float64Array(n);
    const sampler = this.makeSampler();
    const s = newSample(K);
    let visited = 0;
    for (let y = 0; y < gh; y++) {
      const wy = ((y + 0.5) * H) / gh;
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        sampler(((x + 0.5) * W) / gw, wy, s);
        values[i] = s.v;
        let fs = 0;
        for (let k = 0; k < K; k++) {
          const h = s.hits[k];
          ids[k * n + i] = s.ids[k];
          f1s[k][i] = h.f1;
          f2s[k][i] = h.f2;
          fs += this.amps[k] * h.f1;
          visited += h.visited;
        }
        f1Sum[i] = fs;
      }
    }
    const sorted = Float64Array.from(values).sort();
    const land = Math.min(1, Math.max(0, this.p.land));
    let threshold: number;
    if (land <= 0) threshold = sorted[n - 1];
    else if (land >= 1) threshold = sorted[0] - 1e-9;
    else {
      // land = v > T. Put T halfway between the two values around the quantile, so ties
      // (v is constant per cell) land on whichever side keeps the ratio closest.
      const idx = Math.min(n - 1, Math.max(0, Math.round((1 - land) * n) - 1));
      const lo = sorted[idx];
      const hi = sorted[Math.min(n - 1, idx + 1)];
      threshold = hi > lo ? (lo + hi) / 2 : lo;
    }
    const p99 = (a: Float64Array) => {
      const t = Float64Array.from(a).sort();
      return Math.max(1e-9, t[Math.min(t.length - 1, Math.floor(t.length * 0.99))]);
    };
    return {
      threshold,
      vmin: sorted[0],
      vmax: sorted[n - 1],
      gw,
      gh,
      values,
      ids,
      f1Max: f1s.map(p99),
      f2Max: f2s.map(p99),
      dfMax: f1s.map((f1, k) => p99(f2s[k].map((f2, i) => f2 - f1[i]))),
      f1SumMax: p99(f1Sum),
      visited: visited / (n * K),
      ms: performance.now() - t0,
    };
  }
}
