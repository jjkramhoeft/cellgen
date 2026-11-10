/**
 * Lakes, placed per region after the rivers.
 *
 * For one region (as drawn, like the rivers: `Rivers.regionElevationZones`):
 *   Candidates  lakes come after the rivers and sit on them: every subbiome drawn in the
 *               region that may hold a lake and has a river node in it (flow >=
 *               LAKE_MIN_FLOW, on land) gets one try, with chance `frequency`. The lake is
 *               centred on one of those nodes, so its river runs in and out of it. A
 *               subbiome may not hold a lake when it is
 *                 · ocean, or in a mountains elevation zone,
 *                 · a desert: its biome at sea level is hot or cold desert. Sea level is
 *                   the warmest (so the most arid) the subbiome can be, so a subbiome that
 *                   is no desert there is no desert at any height either; the test needs
 *                   no terrain and never puts a lake in a subbiome the map shows as desert,
 *                 · restricted: it lies in a river-poor ("sparse") flat elevation zone
 *                   (`Rivers.isSparseFlat`: the zone's site gets less initial precipitation
 *                   than the sparse river cutoff), the dry plains with few rivers.
 *   Size        a nominal size (diameter, metres) in [minSize, maxSize], skewed towards
 *               small lakes (min + (max − min)·u²). Lakes keep a gap from each other
 *               (they never overlap).
 *   Shape       a star-shaped polygon of `RAYS` rays. Each ray's radius is the nominal
 *               radius × an ellipse (random axis, elongation 1–2.2, area kept) × (1 + a
 *               ± `NOISE_AMP` fBm term). The noise is low-frequency and read on a small
 *               circle, so the outline closes smoothly with a few broad lobes and bays:
 *               round ponds, ovals, kidney and lobed lakes.
 *   Clip        every ray is walked outwards from the centre and stops before the first
 *               point that is not lake-eligible land of this region (see `eligibleAt`),
 *               so a lake never crosses a region border, a mountains zone, the coast, a
 *               desert or a restricted subbiome (an ocean subbiome is never eligible).
 *               Then neighbouring rays are tapered (they differ by at most TAPER x the
 *               radius) and rounded, only ever shortening them, so clipped sides bend in
 *               gently instead of in notches. A clipped lake whose size (the diameter
 *               of a circle of the same area) falls below `minSize` is dropped; one
 *               above `maxSize` is scaled down towards its centre (still eligible: every
 *               point on a ray inside the walked radius was checked).
 *
 * Deterministic: sfc32 per region, simplex fBm and dcos/dsin (bit-exact), a fixed
 * visiting order, and no dependence on the terrain tiles (which arrive over time).
 */
import { dcos, dsin, sq } from '@shared/core/dmath';
import { hash4, sfc32 } from '@shared/core/hash';
import { fbm } from '@shared/core/noise';
import { BIOMES, type Biomes } from './biomes';
import { keyI, keyJ } from './level';
import type { Rivers } from './rivers';
import type { World } from './world';
import { ELEVATION_ZONE_TYPES, elevationZoneType } from './zones';

export interface LakeParams {
  /** chance that an eligible subbiome holds a lake, 0–1 */
  frequency: number;
  /** lake size bounds: diameter of a circle of the lake's area, metres */
  minSize: number;
  maxSize: number;
}

export interface Lake {
  /** index within its region */
  id: number;
  region: number;
  /** subbiome (merged root) the lake was placed in */
  sub: number;
  /** the river node at the lake's centre (index into the region's RegionRivers) and its flow */
  node: number;
  flow: number;
  /** centre, metres */
  cx: number;
  cy: number;
  /** nominal size drawn for it (diameter, metres) and its size after the clip */
  nominal: number;
  size: number;
  /** area, m² */
  area: number;
  /** outline (RAYS vertices, counter-clockwise from +x) */
  x: Float64Array;
  y: Float64Array;
  /** bounding box */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RegionLakes {
  region: number;
  lakes: Lake[];
  /** subbiomes with a river (a node of flow >= LAKE_MIN_FLOW) that may hold a lake */
  candidates: number;
  /** candidates that passed the frequency roll */
  tries: number;
  /** tries dropped: centre too close to another lake, or clipped below the minimum size (or squeezed against its centre) */
  crowded: number;
  tooSmall: number;
  ms: number;
}

/** Why a subbiome may not hold a lake (null = it may). */
export type LakeBlock = 'ocean' | 'mountains' | 'desert' | 'restricted' | null;

/** Rays (outline vertices) per lake. */
export const RAYS = 64;
/** amplitude of the fBm term on the radius */
const NOISE_AMP = 0.3;
/**
 * noise read on a circle of this radius in noise space: small, so the outline gets one to
 * three broad lobes and bays, not wiggles
 */
const NOISE_RING = 0.75;
const NOISE_FBM = { octaves: 2, lacunarity: 2, gain: 0.35 };
/**
 * after the clip, neighbouring rays differ by at most this x the nominal radius, so a
 * clipped side bends in gently instead of in a notch
 */
export const TAPER = 0.09;
/** rounding passes after the taper (each ray = min(itself, (left + 2 self + right) / 4)) */
const ROUND_PASSES = 3;
/** a lake sits on a river node carrying at least this many attractors upstream */
export const LAKE_MIN_FLOW = 4;
/** largest elongation of the ellipse (long axis / short axis) */
const MAX_ELONG = 2.2;
/** steps per nominal radius when a ray is walked outwards */
const RAY_STEPS = 12;
/** walk step never finer than this, metres */
const MIN_STEP = 60;
/** gap between two lakes, × the sum of their nominal radii */
const GAP = 1.15;
/** shortest a ray may be after the noise, × the nominal radius */
const MIN_RAY = 0.25;
/** a lake whose shortest ray the clip leaves below this × the nominal radius is dropped (squeezed against its centre, the river) */
const MIN_KEEP = 0.2;
/** an outline edge that crosses ineligible land pulls both its ends in by this factor, at most this often */
const EDGE_SHRINK = 0.85;
const EDGE_TRIES = 12;

const ST_LAKE = 0x1a01;
const ST_SHAPE = 0x1a02;
const MOUNTAINS = ELEVATION_ZONE_TYPES.findIndex((t) => t.id === 'mountains');
const DESERTS = new Set(BIOMES.flatMap((b, i) => (b.id === 'hotDesert' || b.id === 'coldDesert' ? [i] : [])));

/** Unit vectors of the rays (dcos / dsin: bit-exact everywhere). */
const RAY_X = new Float64Array(RAYS);
const RAY_Y = new Float64Array(RAYS);
for (let k = 0; k < RAYS; k++) {
  const a = (2 * Math.PI * k) / RAYS;
  RAY_X[k] = dcos(a);
  RAY_Y[k] = dsin(a);
}
/** area of the triangle between two neighbouring rays of length 1: ½ sin(2π / RAYS) */
const WEDGE = 0.5 * dsin((2 * Math.PI) / RAYS);

/** Is the point inside the polygon (even–odd rule)? */
export function inPolygon(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number, y: number): boolean {
  let inside = false;
  const n = xs.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    if (ys[i] > y !== ys[j] > y && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i]) inside = !inside;
  }
  return inside;
}

export class Lakes {
  readonly world: World;
  readonly rivers: Rivers;
  readonly biomes: Biomes;
  readonly p: LakeParams;
  private cache = new Map<number, RegionLakes>();
  private blockCache = new Map<number, LakeBlock>();

  /**
   * `biomes` supplies the climate at each subbiome's site (only its sea-level biome is
   * read, so any Biomes of the current world, rivers and climate gives the same lakes).
   */
  constructor(world: World, rivers: Rivers, biomes: Biomes, p: LakeParams) {
    this.world = world;
    this.rivers = rivers;
    this.biomes = biomes;
    const lo = Math.max(1, Math.min(p.minSize, p.maxSize));
    this.p = { frequency: Math.max(0, Math.min(1, p.frequency)), minSize: lo, maxSize: Math.max(lo, p.maxSize) };
  }

  get size(): number {
    return this.cache.size;
  }

  peek(rkey: number): RegionLakes | undefined {
    return this.cache.get(rkey);
  }

  get(rkey: number): RegionLakes {
    let r = this.cache.get(rkey);
    if (!r) {
      if (this.cache.size > 4000) this.cache.clear();
      r = this.compute(rkey);
      this.cache.set(rkey, r);
    }
    return r;
  }

  /** Why a (raw or merged) subbiome may not hold a lake; null when it may. */
  block(skey: number): LakeBlock {
    const w = this.world;
    const c = w.subCell(skey);
    const root = c.sub;
    const hit = this.blockCache.get(root);
    if (hit !== undefined) return hit;
    let b: LakeBlock = null;
    if (c.ocean) b = 'ocean';
    else if (elevationZoneType(c.elevationZone, false) === MOUNTAINS) b = 'mountains';
    else if (this.desertAtSeaLevel(root)) b = 'desert';
    else if (this.restricted(c.elevationZone)) b = 'restricted';
    if (this.blockCache.size > 400_000) this.blockCache.clear();
    this.blockCache.set(root, b);
    return b;
  }

  /**
   * Restricted subbiomes: those of a river-poor flat elevation zone (merged root `zkey`;
   * `Rivers.isSparseFlat`, the zones whose site gets less initial precipitation than the
   * sparse river cutoff). A zone split across regions is restricted in all of them.
   */
  restricted(zkey: number): boolean {
    return this.rivers.isSparseFlat(zkey);
  }

  /** Is the subbiome a desert at sea level (its warmest, most arid height)? */
  private desertAtSeaLevel(root: number): boolean {
    return DESERTS.has(this.biomes.ofSub(root).seaLevel);
  }

  /** May a lake of region `rkey` cover this point? */
  eligibleAt(rkey: number, x: number, y: number): boolean {
    const c = this.world.cellAt(x, y, true);
    return c.region === rkey && !c.ocean && this.block(c.subRaw) === null;
  }

  /** The lake at a point, if any (only regions already computed are searched). */
  lakeAt(x: number, y: number): Lake | null {
    const rk = this.world.cellAt(x, y, true).region;
    const rl = this.cache.get(rk);
    if (!rl) return null;
    for (const l of rl.lakes) if (x >= l.x0 && x <= l.x1 && y >= l.y0 && y <= l.y1 && inPolygon(l.x, l.y, x, y)) return l;
    return null;
  }

  /**
   * River nodes of the region a lake may be centred on, by raw subbiome: on land of the
   * region, not a root, flow >= LAKE_MIN_FLOW, in a subbiome that may hold a lake.
   */
  riverNodes(rkey: number): Map<number, number[]> {
    const w = this.world;
    const rr = this.rivers.get(rkey);
    const out = new Map<number, number[]>();
    for (let k = 0; k < rr.n; k++) {
      if (rr.parent[k] < 0 || rr.wet[k] || rr.flow[k] < LAKE_MIN_FLOW) continue;
      const c = w.cellAt(rr.x[k], rr.y[k], true);
      if (c.region !== rkey || c.ocean || this.block(c.subRaw) !== null) continue;
      const list = out.get(c.subRaw);
      if (list) list.push(k);
      else out.set(c.subRaw, [k]);
    }
    return out;
  }

  compute(rkey: number): RegionLakes {
    const t0 = performance.now();
    const w = this.world;
    const P = this.p;
    const reg = w.region(rkey);
    const rng = sfc32(hash4(w.p.seed, ST_LAKE, reg.i, reg.j));
    const out: RegionLakes = { region: rkey, lakes: [], candidates: 0, tries: 0, crowded: 0, tooSmall: 0, ms: 0 };
    if (P.frequency <= 0) return out;
    // lakes come after the rivers: every lake is centred on a river node, so its river runs through it
    const rr = this.rivers.get(rkey);
    const nodes = this.riverNodes(rkey);
    const radii: number[] = [];
    for (const b of this.rivers.regionElevationZones(rkey)) {
      const bc = w.elevationZoneCell(b);
      if (bc.ocean || elevationZoneType(bc.elevationZone, false) === MOUNTAINS) continue;
      for (const s of w.elevationZoneSubs(w.elevationZone(b))) {
        const sc = w.subCell(s);
        if (sc.ocean || sc.region !== rkey) continue;
        // the draws always happen, so the stream does not depend on which subbiomes have rivers
        const roll = rng();
        const u = rng();
        const pick = rng();
        const list = nodes.get(s);
        if (!list) continue;
        out.candidates++;
        if (roll >= P.frequency) continue;
        out.tries++;
        const k = list[Math.min(list.length - 1, Math.floor(pick * list.length))];
        const cx = rr.x[k];
        const cy = rr.y[k];
        const nominal = P.minSize + (P.maxSize - P.minSize) * u * u;
        const R = nominal / 2;
        let crowded = false;
        for (let q = 0; q < out.lakes.length; q++) {
          const o = out.lakes[q];
          if (sq(o.cx - cx) + sq(o.cy - cy) < sq(GAP * (R + radii[q]))) {
            crowded = true;
            break;
          }
        }
        if (crowded) {
          out.crowded++;
          continue;
        }
        const lake = this.shape(rkey, sc.sub, out.lakes.length, cx, cy, nominal, k, rr.flow[k]);
        if (!lake) {
          out.tooSmall++;
          continue;
        }
        out.lakes.push(lake);
        radii.push(R);
      }
    }
    out.ms = performance.now() - t0;
    return out;
  }

  /** Outline of one lake: noise-shaped rays, clipped to eligible land; null when too small after the clip. */
  private shape(rkey: number, sub: number, id: number, cx: number, cy: number, nominal: number, node: number, flow: number): Lake | null {
    const P = this.p;
    const R = nominal / 2;
    const seed = hash4(this.world.p.seed, ST_SHAPE, keyI(sub) * 4099 + id, keyJ(sub));
    const srng = sfc32(seed);
    // ellipse: random axis (rejection sampling in the unit disc, no trig), elongation, area kept
    let axX = 1;
    let axY = 0;
    for (;;) {
      const x = srng() * 2 - 1;
      const y = srng() * 2 - 1;
      const d = x * x + y * y;
      if (d <= 1 && d > 1e-6) {
        const s = 1 / Math.sqrt(d);
        axX = x * s;
        axY = y * s;
        break;
      }
    }
    const e = 1 + (MAX_ELONG - 1) * srng() * srng();
    const ia2 = 1 / e; // 1 / a² with a = √e (in units of R)
    const ib2 = e; // 1 / b² with b = 1 / √e
    const nx0 = srng() * 1000;
    const ny0 = srng() * 1000;
    const ring = NOISE_RING * (0.6 + 0.8 * srng());
    const nseed = (seed ^ 0x5bd1e995) | 0;
    const r = new Float64Array(RAYS);
    const step = Math.max(MIN_STEP, R / RAY_STEPS);
    for (let k = 0; k < RAYS; k++) {
      const ux = RAY_X[k];
      const uy = RAY_Y[k];
      const along = ux * axX + uy * axY;
      const across = uy * axX - ux * axY;
      const ell = 1 / Math.sqrt(along * along * ia2 + across * across * ib2);
      const n = fbm(nseed, nx0 + ux * ring, ny0 + uy * ring, NOISE_FBM);
      const want = R * Math.max(MIN_RAY, ell * (1 + NOISE_AMP * n));
      // walk outwards; stop one step before the first point that may not be lake
      let got = want;
      for (let t = step; ; t += step) {
        const tt = Math.min(t, want);
        if (!this.eligibleAt(rkey, cx + ux * tt, cy + uy * tt)) {
          got = Math.max(0, tt - step);
          break;
        }
        if (tt >= want) break;
      }
      r[k] = got;
    }
    // the rays are clean; anything ineligible reaching into the wedge between two rays must
    // cross its outer edge, so walk each edge and pull both ends in until it is clean.
    // Pulling a vertex in along its ray keeps the neighbouring wedge inside its old self,
    // so one pass suffices
    for (let k = 0; k < RAYS; k++) {
      const k2 = (k + 1) % RAYS;
      for (let tries = 0; ; tries++) {
        if (r[k] === 0 && r[k2] === 0) break;
        const ax = cx + RAY_X[k] * r[k];
        const ay = cy + RAY_Y[k] * r[k];
        const bx = cx + RAY_X[k2] * r[k2];
        const by = cy + RAY_Y[k2] * r[k2];
        const m = Math.max(1, Math.ceil(Math.sqrt(sq(bx - ax) + sq(by - ay)) / step));
        let clean = true;
        for (let i = 1; i < m && clean; i++) clean = this.eligibleAt(rkey, ax + ((bx - ax) * i) / m, ay + ((by - ay) * i) / m);
        if (clean) break;
        if (tries >= EDGE_TRIES) {
          r[k] = r[k2] = 0;
          break;
        }
        r[k] *= EDGE_SHRINK;
        r[k2] *= EDGE_SHRINK;
      }
    }
    // taper and round: rays only ever get shorter here, and a segment between two points
    // of a clean wedge stays inside it, so the outline stays on eligible land
    const cap = TAPER * R;
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < RAYS; k++) r[k] = Math.min(r[k], r[(k + RAYS - 1) % RAYS] + cap);
      for (let k = RAYS - 1; k >= 0; k--) r[k] = Math.min(r[k], r[(k + 1) % RAYS] + cap);
    }
    const tmp = new Float64Array(RAYS);
    for (let pass = 0; pass < ROUND_PASSES; pass++) {
      for (let k = 0; k < RAYS; k++) tmp[k] = Math.min(r[k], 0.25 * (r[(k + RAYS - 1) % RAYS] + 2 * r[k] + r[(k + 1) % RAYS]));
      r.set(tmp);
    }
    let area = 0;
    for (let k = 0; k < RAYS; k++) area += r[k] * r[(k + 1) % RAYS];
    area *= WEDGE;
    let size = 2 * Math.sqrt(area / Math.PI);
    let shortest = Infinity;
    for (let k = 0; k < RAYS; k++) shortest = Math.min(shortest, r[k]);
    if (size < P.minSize || shortest < MIN_KEEP * R) return null;
    if (size > P.maxSize) {
      const f = P.maxSize / size;
      for (let k = 0; k < RAYS; k++) r[k] *= f;
      area *= f * f;
      size = P.maxSize;
    }
    const x = new Float64Array(RAYS);
    const y = new Float64Array(RAYS);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < RAYS; k++) {
      x[k] = cx + RAY_X[k] * r[k];
      y[k] = cy + RAY_Y[k] * r[k];
      if (x[k] < x0) x0 = x[k];
      if (x[k] > x1) x1 = x[k];
      if (y[k] < y0) y0 = y[k];
      if (y[k] > y1) y1 = y[k];
    }
    return { id, region: rkey, sub, node, flow, cx, cy, nominal, size, area, x, y, x0, y0, x1, y1 };
  }
}
