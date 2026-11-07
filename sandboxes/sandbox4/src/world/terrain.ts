/**
 * Height map fitted to the map and its rivers ("Option B" of
 * docs/research/heightmap-from-biomes-and-rivers.md), computed per region on a raster.
 *
 *   0. Channel profile   every river node gets a bed elevation from the steady-state
 *                        stream-power law integrated upstream from the sea (the χ
 *                        integral, Mudd et al. 2014 Eq. 4): z_k = z_parent + Δx·S₀·A^−θ,
 *                        with A = flow (attractors upstream) as the drainage-area proxy.
 *                        Strictly rising upstream by construction.
 *   1. Envelope          a geodesic distance (Dijkstra on an 8-connected grid, i.e. a
 *                        chamfer fast-marching) from every river bed and from the coast,
 *                        with the hillslope steepness as the local cost: every land cell
 *                        drains to a river or the sea. Rivers get a flat floodplain of
 *                        half-width ∝ √flow.
 *   2. Divides           a ridge along region borders (which rivers never cross) and a
 *                        smaller one where the basins of two different river systems meet.
 *   3. Detail noise      fbm / ridged per land type, masked to zero near the channels.
 *   4. Burn              the rivers are imprinted (AGREE: a trench plus a linear buffer).
 *   5. Fill              ε-Priority-Flood over the region's own land, seeded from the
 *                        sea and the region border: no pits, everything drains.
 *
 * Seamless: steps 1–4 are a pure function of position (all sources within the raster's
 * halo are used, and the grid is aligned to the world), so two regions' rasters agree
 * where they overlap; step 5 only changes cells strictly inside the region and keeps
 * the border cells. Deterministic: + − × ÷ √ and the simplex noise only, heap ties
 * broken by cell index.
 */
import { MinHeap } from '@shared/core/heap';
import { fbm, ridged } from '@shared/core/noise';
import { hash4 } from '@shared/core/hash';
import { landType } from '../render/source';
import { keyI, keyJ } from './level';
import type { RegionRivers, Rivers } from './rivers';
import { World } from './world';

export type Theta = 0.375 | 0.4375 | 0.5;

export interface TerrainParams {
  /** raster cell size, metres */
  res: number;
  /** channel slope S₀ at a flow of one attractor */
  chSlope: number;
  /** concavity θ of the river profiles (dyadic, so √ suffices) */
  theta: Theta;
  /** multiplier on the hillslope steepness of every land type */
  hill: number;
  /** floodplain half-width per √flow, metres */
  valley: number;
  /** strength of the region-scale relief field (mountain belts across biomes) */
  relief: number;
  /** height of the ridge along region borders, metres */
  ridge: number;
  /** extra height where the basins of two different river systems meet, metres */
  divide: number;
  /** multiplier on the detail noise amplitude of every land type */
  noise: number;
  /** channel depth burnt below the bed profile, metres */
  burn: number;
  /** ocean depth far from the coast, metres */
  sea: number;
}

/**
 * Relief per cosmetic land type (index = LAND_TYPES order in render/source.ts).
 * Starting points from the report's §7.2 table, not sourced values.
 */
const TYPES: { hill: number; chan: number; valley: number; amp: number; ridged: number }[] = [
  { hill: 0.03, chan: 0.7, valley: 1.5, amp: 10, ridged: 0 }, // Grassland
  { hill: 0.05, chan: 1.0, valley: 1.0, amp: 20, ridged: 0 }, // Forest
  { hill: 0.05, chan: 1.0, valley: 1.0, amp: 20, ridged: 0 }, // Old forest
  { hill: 0.03, chan: 0.7, valley: 1.5, amp: 10, ridged: 0 }, // Steppe
  { hill: 0.04, chan: 0.8, valley: 1.0, amp: 25, ridged: 1 }, // Desert (dune-like ridges)
  { hill: 0.07, chan: 1.0, valley: 1.0, amp: 30, ridged: 0.3 }, // Tundra
  { hill: 0.01, chan: 0.3, valley: 3.0, amp: 2, ridged: 0 }, // Marsh
  { hill: 0.15, chan: 1.8, valley: 0.5, amp: 80, ridged: 1 }, // Hills
  { hill: 0.03, chan: 0.7, valley: 1.5, amp: 10, ridged: 0 }, // Savanna
  { hill: 0.05, chan: 1.0, valley: 1.0, amp: 20, ridged: 0 }, // Taiga
  { hill: 0.07, chan: 1.0, valley: 1.0, amp: 30, ridged: 0.3 }, // Scrub
  { hill: 0.07, chan: 1.0, valley: 1.0, amp: 30, ridged: 0.3 }, // Heath
];

/** Raster margin beyond the region, metres: sources this far out still shape the region. */
export const HALO = 48_000;
/** blend width of the per-land-type parameters across biome borders, metres */
const BLEND = 4_000;
/** ridge widths, metres */
const BORDER_W = 10_000;
const DIVIDE_W = 6_000;
/** distance over which the sea deepens from the coast, metres */
const SEA_W = 40_000;
/** height above the river (path cost from the channel) over which noise and ridges fade in, metres */
const MASK_H = 40;
/** ε of the Priority-Flood fill, metres */
const EPS = 0.01;
const ST_RELIEF = 0x7e11;
const ST_NOISE = 0x7e12;

/** Land-class codes of a raster cell. */
export const OCEAN = 0;
export const LAND = 1;

export interface RegionTerrain {
  region: number;
  /** world position of cell (0, 0)'s centre, cell size, size */
  x0: number;
  y0: number;
  res: number;
  nx: number;
  ny: number;
  /** final heights (metres; ocean negative) */
  h: Float32Array;
  /** heights before the fill (steps 1–4): a pure function of position */
  pre: Float32Array;
  /** OCEAN / LAND */
  cls: Uint8Array;
  /** region key of each cell */
  reg: Float64Array;
  /** bed elevation of this region's river nodes */
  bed: Float64Array;
  /** cells raised by the fill, and the largest raise (lakes / flats), metres */
  filled: number;
  maxFill: number;
  ms: number;
}

/** A^−θ for dyadic θ, with √ only (bit-exact everywhere). */
export function invPowTheta(a: number, theta: Theta): number {
  const r2 = Math.sqrt(a);
  if (theta === 0.5) return 1 / r2;
  const r4 = Math.sqrt(r2);
  const r8 = Math.sqrt(r4);
  if (theta === 0.375) return 1 / (r4 * r8);
  return 1 / (r4 * r8 * Math.sqrt(r8));
}

const smooth01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

const RELIEF_FBM = { octaves: 3, lacunarity: 2, gain: 0.5 };
const DETAIL_FBM = { octaves: 4, lacunarity: 2.1, gain: 0.5 };

export class Terrain {
  readonly world: World;
  readonly rivers: Rivers;
  readonly p: TerrainParams;
  private tiles = new Map<number, RegionTerrain>();
  private beds = new Map<number, Float64Array>();
  private readonly seedR: number;
  private readonly seedN: number;

  constructor(world: World, rivers: Rivers, p: TerrainParams) {
    this.world = world;
    this.rivers = rivers;
    this.p = p;
    this.seedR = hash4(world.p.seed, ST_RELIEF, 0, 0) | 0;
    this.seedN = hash4(world.p.seed, ST_NOISE, 0, 0) | 0;
  }

  get size(): number {
    return this.tiles.size;
  }

  peek(rkey: number): RegionTerrain | undefined {
    return this.tiles.get(rkey);
  }

  get(rkey: number): RegionTerrain {
    let t = this.tiles.get(rkey);
    if (!t) {
      if (this.tiles.size > 240) this.tiles.clear();
      t = this.compute(rkey);
      this.tiles.set(rkey, t);
    }
    return t;
  }

  /** Region-scale relief factor (mountain belts spanning several biomes). */
  reliefAt(x: number, y: number): number {
    if (this.p.relief <= 0) return 1;
    const f = fbm(this.seedR, x / 220_000, y / 220_000, RELIEF_FBM);
    return Math.max(0.25, 1 + this.p.relief * 1.6 * f);
  }

  /** Bed elevation of every node of a region's rivers (step 0). */
  bed(rkey: number): Float64Array {
    let z = this.beds.get(rkey);
    if (z) return z;
    const rr = this.rivers.get(rkey);
    const w = this.world;
    const P = this.p;
    z = new Float64Array(rr.n);
    // parents always have smaller indices than their children
    for (let k = 0; k < rr.n; k++) {
      const p = rr.parent[k];
      if (p < 0 || rr.wet[k]) continue; // roots and the stretch over the sea sit at sea level
      const dx = Math.sqrt((rr.x[k] - rr.x[p]) ** 2 + (rr.y[k] - rr.y[p]) ** 2);
      const c = w.cellAt(rr.x[k], rr.y[k], true);
      const mult = c.ocean ? 1 : TYPES[landType(c.biome)].chan * this.reliefAt(rr.x[k], rr.y[k]);
      z[k] = z[p] + dx * P.chSlope * mult * invPowTheta(Math.max(1, rr.flow[k]), P.theta);
    }
    if (this.beds.size > 4000) this.beds.clear();
    this.beds.set(rkey, z);
    return z;
  }

  /**
   * Height at a point, bilinear in the raster of the point's region. NaN when that
   * raster is not computed yet and `compute` is false.
   */
  heightAt(x: number, y: number, compute = false): number {
    const r = this.world.cellAt(x, y, true).region;
    const t = compute ? this.get(r) : this.tiles.get(r);
    return t ? sample(t, x, y) : NaN;
  }

  /** Raster bounding box of a region: its drawn biomes' sites plus a cell of slack, plus the halo. */
  private bbox(rkey: number): [number, number, number, number] {
    const w = this.world;
    const B = w.biomeLevel.size;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const keys = new Set([...this.rivers.regionBiomes(rkey), ...w.region(rkey).biomes]);
    for (const b of keys) {
      const bd = w.biome(b);
      x0 = Math.min(x0, bd.x);
      y0 = Math.min(y0, bd.y);
      x1 = Math.max(x1, bd.x);
      y1 = Math.max(y1, bd.y);
    }
    if (!Number.isFinite(x0)) {
      const reg = w.region(rkey);
      x0 = x1 = reg.x;
      y0 = y1 = reg.y;
    }
    const m = 1.6 * B * (1 + w.p.biomeWarp) + HALO;
    return [x0 - m, y0 - m, x1 + m, y1 + m];
  }

  compute(rkey: number): RegionTerrain {
    const t0 = performance.now();
    const w = this.world;
    const P = this.p;
    const res = P.res;
    const [bx0, by0, bx1, by1] = this.bbox(rkey);
    const i0 = Math.floor(bx0 / res);
    const j0 = Math.floor(by0 / res);
    const nx = Math.floor(bx1 / res) - i0 + 1;
    const ny = Math.floor(by1 / res) - j0 + 1;
    const N = nx * ny;
    const X0 = (i0 + 0.5) * res;
    const Y0 = (j0 + 0.5) * res;
    const cx = (i: number) => X0 + i * res;
    const cy = (j: number) => Y0 + j * res;

    // ---- classify + per-land-type parameters
    const cls = new Uint8Array(N);
    const reg = new Float64Array(N);
    const lt = new Int8Array(N).fill(-1);
    const cell = {} as ReturnType<World['cellAt']>;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = w.cellAt(cx(i), cy(j), true, cell);
        const q = j * nx + i;
        cls[q] = c.ocean ? OCEAN : LAND;
        reg[q] = c.region;
        if (!c.ocean) lt[q] = landType(c.biome);
      }
    }
    // blended over land cells (box blur, separable): slope, noise amplitude, ridged share
    const rb = Math.max(1, Math.round(BLEND / res));
    const slope = blurLand(nx, ny, cls, rb, (q) => TYPES[lt[q]].hill);
    const amp = blurLand(nx, ny, cls, rb, (q) => TYPES[lt[q]].amp);
    const rmix = blurLand(nx, ny, cls, rb, (q) => TYPES[lt[q]].ridged);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const q = j * nx + i;
        if (cls[q] !== LAND) continue;
        const rf = this.reliefAt(cx(i), cy(j));
        slope[q] *= P.hill * rf;
        amp[q] *= P.noise * rf;
      }
    }

    // ---- river segments of every region around (stamped as sources, then burnt in)
    const segs: Seg[] = [];
    const R = w.regionLevel;
    for (const rk of World.cellsIn(R, bx0, by0, bx1, by1, 1)) {
      const rr = this.rivers.get(rk);
      if (rr.n === 0 || rr.x1 < bx0 || rr.x0 > bx1 || rr.y1 < by0 || rr.y0 > by1) continue;
      const z = this.bed(rk);
      const lab0 = ((keyI(rk) & 0xffff) * 65536 + (keyJ(rk) & 0xffff)) * 131072;
      addSegments(segs, rr, z, lab0, w, P.valley, res);
    }

    // ---- 1. envelope: Dijkstra from the river beds and the coast
    const E = new Float64Array(N).fill(Infinity);
    const src = new Float64Array(N); // bed / coast height the cell's path starts from
    const lab = new Float64Array(N).fill(-1); // river system (−1 = coast)
    const heap = new MinHeap(4096);
    for (const s of segs) {
      stampSeg(s, nx, ny, X0, Y0, res, (q, zb) => {
        if (cls[q] !== LAND || zb >= E[q]) return;
        E[q] = zb;
        src[q] = zb;
        lab[q] = s.lab;
      });
    }
    for (let q = 0; q < N; q++) if (Number.isFinite(E[q])) heap.push(E[q], q);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const q = j * nx + i;
        if (cls[q] !== OCEAN || !hasNbr(cls, nx, ny, i, j, LAND)) continue;
        E[q] = 0;
        src[q] = 0;
        lab[q] = -1;
        heap.push(0, q);
      }
    }
    const DI = [1, -1, 0, 0, 1, 1, -1, -1];
    const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    const SQ2 = Math.SQRT2;
    while (heap.size > 0) {
      const d = heap.peekKey();
      const q = heap.pop();
      if (d > E[q]) continue;
      const i = q % nx;
      const j = (q - i) / nx;
      const sq = cls[q] === LAND ? slope[q] : -1;
      for (let n = 0; n < 8; n++) {
        const ii = i + DI[n];
        const jj = j + DJ[n];
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const r = jj * nx + ii;
        if (cls[r] !== LAND) continue;
        const s = sq < 0 ? slope[r] : (sq + slope[r]) * 0.5;
        const nd = d + res * s * (n < 4 ? 1 : SQ2);
        if (nd < E[r]) {
          E[r] = nd;
          src[r] = src[q];
          lab[r] = lab[q];
          heap.push(nd, r);
        }
      }
    }
    let maxE = 0;
    for (let q = 0; q < N; q++) if (cls[q] === LAND && Number.isFinite(E[q]) && E[q] > maxE) maxE = E[q];

    // ---- 2. divides: distance to region borders and to basin boundaries
    const dBorder = chamfer(nx, ny, res, BORDER_W, (q, i, j) => cls[q] === LAND && landNbrDiffers(cls, reg, nx, ny, i, j));
    const dDivide =
      P.divide > 0
        ? chamfer(nx, ny, res, DIVIDE_W, (q, i, j) => cls[q] === LAND && lab[q] >= 0 && labNbrDiffers(cls, lab, nx, ny, i, j))
        : null;
    const dCoast = chamfer(nx, ny, res, SEA_W, (q, i, j) => cls[q] === OCEAN && hasNbr(cls, nx, ny, i, j, LAND));

    // ---- 3. assemble + detail noise
    const pre = new Float32Array(N);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const q = j * nx + i;
        if (cls[q] === OCEAN) {
          pre[q] = -(2 + P.sea * smooth01(dCoast[q] / SEA_W));
          continue;
        }
        const e = Number.isFinite(E[q]) ? E[q] : maxE;
        const m = smooth01((e - src[q]) / MASK_H);
        let h = e;
        if (P.ridge > 0 && dBorder[q] < BORDER_W) {
          const t = 1 - dBorder[q] / BORDER_W;
          h += P.ridge * t * t * m;
        }
        if (dDivide && dDivide[q] < DIVIDE_W) {
          const t = 1 - dDivide[q] / DIVIDE_W;
          h += P.divide * t * t * m;
        }
        if (amp[q] > 0) {
          const x = cx(i) / 6000;
          const y = cy(j) / 6000;
          const rm = rmix[q];
          const n = rm <= 0 ? fbm(this.seedN, x, y, DETAIL_FBM) : rm >= 1 ? ridged(this.seedN, x, y, DETAIL_FBM) : (1 - rm) * fbm(this.seedN, x, y, DETAIL_FBM) + rm * ridged(this.seedN, x, y, DETAIL_FBM);
          h += amp[q] * m * (n * 0.5 + 0.5);
        }
        pre[q] = h;
      }
    }

    // ---- 4. burn the rivers in (AGREE: trench under the bed, linear buffer to the surface)
    for (const s of segs) {
      const buf = Math.max(2 * res, s.wv);
      stampSeg(s, nx, ny, X0, Y0, res, (q, zb, d) => {
        if (cls[q] !== LAND) return;
        let target: number;
        if (d <= s.wv) target = zb - P.burn;
        else {
          if (pre[q] <= zb) return;
          target = zb + (pre[q] - zb) * ((d - s.wv) / buf);
        }
        if (target < pre[q]) pre[q] = target;
      }, buf);
    }

    // ---- 5. ε-Priority-Flood over the region's own land
    const h = Float32Array.from(pre);
    const own = (q: number) => cls[q] === LAND && reg[q] === rkey;
    const done = new Uint8Array(N);
    let filled = 0;
    let maxFill = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const q = j * nx + i;
        let seed = false;
        if (cls[q] === OCEAN) seed = ownNbr(own, nx, ny, i, j);
        else if (own(q)) seed = i === 0 || j === 0 || i === nx - 1 || j === ny - 1 || landNbrDiffers(cls, reg, nx, ny, i, j);
        if (seed) {
          done[q] = 1;
          heap.push(h[q], q);
        }
      }
    }
    while (heap.size > 0) {
      const q = heap.pop();
      const i = q % nx;
      const j = (q - i) / nx;
      const hq = h[q];
      for (let n = 0; n < 8; n++) {
        const ii = i + DI[n];
        const jj = j + DJ[n];
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const r = jj * nx + ii;
        if (done[r] || !own(r)) continue;
        done[r] = 1;
        // Math.fround: the raise is decided in the stored (float32) precision
        const lift = Math.fround(hq + EPS);
        if (h[r] < lift) {
          if (lift - h[r] > maxFill) maxFill = lift - h[r];
          h[r] = lift;
          filled++;
        }
        heap.push(h[r], r);
      }
    }

    return {
      region: rkey,
      x0: X0,
      y0: Y0,
      res,
      nx,
      ny,
      h,
      pre,
      cls,
      reg,
      bed: this.bed(rkey),
      filled,
      maxFill,
      ms: performance.now() - t0,
    };
  }
}

// ------------------------------------------------------------------ helpers

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  za: number;
  zb: number;
  /** floodplain half-width */
  wv: number;
  lab: number;
}

/** Dry river segments (child on land) of one region, with floodplain half-widths. */
function addSegments(out: Seg[], rr: RegionRivers, z: Float64Array, lab0: number, w: World, valley: number, res: number): void {
  for (let k = 0; k < rr.n; k++) {
    const p = rr.parent[k];
    if (p < 0 || rr.wet[k]) continue;
    const c = w.cellAt(rr.x[k], rr.y[k], true);
    const vm = c.ocean ? 1 : TYPES[landType(c.biome)].valley;
    out.push({
      ax: rr.x[p],
      ay: rr.y[p],
      bx: rr.x[k],
      by: rr.y[k],
      za: z[p],
      zb: z[k],
      wv: Math.max(0.75 * res, valley * vm * Math.sqrt(Math.max(1, rr.flow[k]))),
      lab: lab0 + rr.tree[k],
    });
  }
}

/** Visit the raster cells within `wv + extra` of a segment: f(cell, bed height at the projection, distance). */
function stampSeg(s: Seg, nx: number, ny: number, X0: number, Y0: number, res: number, f: (q: number, zb: number, d: number) => void, extra = 0): void {
  const r = s.wv + extra;
  const ia = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - r - X0) / res));
  const ib = Math.min(nx - 1, Math.ceil((Math.max(s.ax, s.bx) + r - X0) / res));
  const ja = Math.max(0, Math.floor((Math.min(s.ay, s.by) - r - Y0) / res));
  const jb = Math.min(ny - 1, Math.ceil((Math.max(s.ay, s.by) + r - Y0) / res));
  const ex = s.bx - s.ax;
  const ey = s.by - s.ay;
  const l2 = ex * ex + ey * ey;
  for (let j = ja; j <= jb; j++) {
    for (let i = ia; i <= ib; i++) {
      const px = X0 + i * res - s.ax;
      const py = Y0 + j * res - s.ay;
      let t = l2 > 0 ? (px * ex + py * ey) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - t * ex;
      const dy = py - t * ey;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > r) continue;
      f(j * nx + i, s.za + (s.zb - s.za) * t, d);
    }
  }
}

/** Box blur of a per-land-cell value over land cells only (ocean cells neither contribute nor receive). */
function blurLand(nx: number, ny: number, cls: Uint8Array, r: number, val: (q: number) => number): Float64Array {
  const N = nx * ny;
  const v = new Float64Array(N);
  const c = new Float64Array(N);
  for (let q = 0; q < N; q++) {
    if (cls[q] === LAND) {
      v[q] = val(q);
      c[q] = 1;
    }
  }
  const tv = new Float64Array(N);
  const tc = new Float64Array(N);
  // horizontal running sums
  for (let j = 0; j < ny; j++) {
    let sv = 0;
    let sc = 0;
    const row = j * nx;
    for (let i = -r; i < nx; i++) {
      const a = i + r;
      if (a < nx) {
        sv += v[row + a];
        sc += c[row + a];
      }
      const b = i - r - 1;
      if (b >= 0) {
        sv -= v[row + b];
        sc -= c[row + b];
      }
      if (i >= 0) {
        tv[row + i] = sv;
        tc[row + i] = sc;
      }
    }
  }
  const out = new Float64Array(N);
  for (let i = 0; i < nx; i++) {
    let sv = 0;
    let sc = 0;
    for (let j = -r; j < ny; j++) {
      const a = j + r;
      if (a < ny) {
        sv += tv[a * nx + i];
        sc += tc[a * nx + i];
      }
      const b = j - r - 1;
      if (b >= 0) {
        sv -= tv[b * nx + i];
        sc -= tc[b * nx + i];
      }
      if (j >= 0) {
        const q = j * nx + i;
        out[q] = cls[q] === LAND && sc > 0 ? sv / sc : 0;
      }
    }
  }
  return out;
}

/**
 * Chamfer distance (8-connected Dijkstra, metres) from the cells where `isSeed` holds,
 * up to `cutoff` (farther cells stay at `cutoff`).
 */
function chamfer(nx: number, ny: number, res: number, cutoff: number, isSeed: (q: number, i: number, j: number) => boolean): Float64Array {
  const N = nx * ny;
  const d = new Float64Array(N).fill(cutoff);
  const heap = new MinHeap(1024);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const q = j * nx + i;
      if (isSeed(q, i, j)) {
        d[q] = 0.5 * res;
        heap.push(d[q], q);
      }
    }
  }
  const diag = res * Math.SQRT2;
  while (heap.size > 0) {
    const dq = heap.peekKey();
    const q = heap.pop();
    if (dq > d[q]) continue;
    const i = q % nx;
    const j = (q - i) / nx;
    for (let jj = j - 1; jj <= j + 1; jj++) {
      for (let ii = i - 1; ii <= i + 1; ii++) {
        if ((ii === i && jj === j) || ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const r = jj * nx + ii;
        const nd = dq + (ii === i || jj === j ? res : diag);
        if (nd < d[r]) {
          d[r] = nd;
          heap.push(nd, r);
        }
      }
    }
  }
  return d;
}

function hasNbr(cls: Uint8Array, nx: number, ny: number, i: number, j: number, want: number): boolean {
  for (let jj = j - 1; jj <= j + 1; jj++) {
    for (let ii = i - 1; ii <= i + 1; ii++) {
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny || (ii === i && jj === j)) continue;
      if (cls[jj * nx + ii] === want) return true;
    }
  }
  return false;
}

/** Does a land cell touch (4-neighbourhood) a land cell of another region? */
function landNbrDiffers(cls: Uint8Array, reg: Float64Array, nx: number, ny: number, i: number, j: number): boolean {
  const q = j * nx + i;
  const r = reg[q];
  if (i > 0 && cls[q - 1] === LAND && reg[q - 1] !== r) return true;
  if (i < nx - 1 && cls[q + 1] === LAND && reg[q + 1] !== r) return true;
  if (j > 0 && cls[q - nx] === LAND && reg[q - nx] !== r) return true;
  if (j < ny - 1 && cls[q + nx] === LAND && reg[q + nx] !== r) return true;
  return false;
}

/** Does a land cell touch (4-neighbourhood) a cell draining to another river system? */
function labNbrDiffers(cls: Uint8Array, lab: Float64Array, nx: number, ny: number, i: number, j: number): boolean {
  const q = j * nx + i;
  const l = lab[q];
  const ok = (r: number) => cls[r] === LAND && lab[r] >= 0 && lab[r] !== l;
  return (i > 0 && ok(q - 1)) || (i < nx - 1 && ok(q + 1)) || (j > 0 && ok(q - nx)) || (j < ny - 1 && ok(q + nx));
}

function ownNbr(own: (q: number) => boolean, nx: number, ny: number, i: number, j: number): boolean {
  for (let jj = j - 1; jj <= j + 1; jj++) {
    for (let ii = i - 1; ii <= i + 1; ii++) {
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny || (ii === i && jj === j)) continue;
      if (own(jj * nx + ii)) return true;
    }
  }
  return false;
}

/** Bilinear sample of a region raster (clamped at the raster edge). */
export function sample(t: RegionTerrain, x: number, y: number): number {
  const fx = (x - t.x0) / t.res;
  const fy = (y - t.y0) / t.res;
  let i = Math.floor(fx);
  let j = Math.floor(fy);
  let u = fx - i;
  let v = fy - j;
  if (i < 0) {
    i = 0;
    u = 0;
  } else if (i >= t.nx - 1) {
    i = t.nx - 2;
    u = 1;
  }
  if (j < 0) {
    j = 0;
    v = 0;
  } else if (j >= t.ny - 1) {
    j = t.ny - 2;
    v = 1;
  }
  const q = j * t.nx + i;
  const a = t.h[q] + (t.h[q + 1] - t.h[q]) * u;
  const b = t.h[q + t.nx] + (t.h[q + t.nx + 1] - t.h[q + t.nx]) * u;
  return a + (b - a) * v;
}
