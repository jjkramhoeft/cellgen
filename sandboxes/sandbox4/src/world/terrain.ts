/**
 * Height map fitted to the map and its rivers ("Option B" of
 * docs/research/heightmap-from-biomes-and-rivers.md), computed per tile on a raster.
 *
 * Tiles: tile (I, J) owns the k × k block of region lattice cells (i, j) with ⌊i/k⌋ = I,
 * ⌊j/k⌋ = J (k = 2 for the default 128 km regions, see `tileSide`). Ownership is by the
 * region's lattice index, never by position: a region's land spills out of its lattice
 * cell, so a height is looked up as point → region → tile. One raster covers the whole
 * tile (steps 1–4 run once), and step 5 runs once per owned region on it. The result is
 * bit-identical to one raster per region (see tests/terrain.test.ts) at a fraction of
 * the cost, since the halo is shared (docs/research/sandbox4-tiling.md).
 *
 *   0. Channel profile   every river node gets a bed elevation from the steady-state
 *                        stream-power law integrated upstream from the sea (the χ
 *                        integral, Mudd et al. 2014 Eq. 4): z_k = z_parent + Δx·S₀·A^−θ,
 *                        with A = flow (attractors upstream) as the drainage-area proxy
 *                        and a configurable gradient factor per elevation zone type.
 *                        Strictly rising upstream by construction.
 *   1. Envelope          a geodesic distance (Dijkstra on an 8-connected grid, i.e. a
 *                        chamfer fast-marching) from every river bed and from the coast,
 *                        with the hillslope steepness as the local cost: every land cell
 *                        drains to a river or the sea. Rivers get a flat floodplain whose
 *                        half-width is a spline over the bed height (optionally ∝ √flow).
 *   2. Divides           a ridge along region borders (which rivers never cross) and a
 *                        smaller one where the basins of two different river systems meet.
 *   3. Detail noise      fbm / ridged per elevation zone type, masked to zero near the channels.
 *   4. Burn              the rivers are imprinted (AGREE: a trench plus a linear buffer).
 *   5. Fill              ε-Priority-Flood over the region's own land, seeded from the
 *                        sea and the region border: no pits, everything drains.
 *
 * Seamless: steps 1–4 are a pure function of position more than ~20 km inside the
 * raster (all sources within the raster's halo are used, and the grid is aligned to the
 * world), so two rasters agree where they overlap; step 5 only changes cells strictly
 * inside a region and keeps its border cells. Deterministic: + − × ÷ √ and the simplex
 * noise only, heap ties broken by cell index (row-major, i.e. world order on any
 * world-aligned raster, so the fill does not depend on the raster's extent).
 */
import { sq } from '@shared/core/dmath';
import { MinHeap } from '@shared/core/heap';
import { fbm, ridged } from '@shared/core/noise';
import { hash4 } from '@shared/core/hash';
import { keyI, keyJ, packKey } from './level';
import type { RegionRivers, Rivers } from './rivers';
import { World } from './world';
import { elevationZoneType } from './zones';

export type Theta = 0.375 | 0.4375 | 0.5;

export interface TerrainParams {
  /** raster cell size, metres */
  res: number;
  /** channel slope S₀ at a flow of one attractor */
  chSlope: number;
  /** concavity θ of the river profiles (dyadic, so √ suffices) */
  theta: Theta;
  /** multiplier on the hillslope steepness of every elevation zone type */
  hill: number;
  /** hillslope steepness per elevation zone type (index = ELEVATION_ZONE_TYPES order; the ocean entry is unused), m/m; defaults: hgt.hs.* in defaults.json */
  hillType: number[];
  /**
   * Levelling of low-gradient elevation zones, 0–1: an elevation zone with river gradient factor c < 1 has
   * its river entries lowered by level × (1 − c) of the way to its lowest entry.
   */
  level: number;
  /**
   * River gradient factor per elevation zone type (index = ELEVATION_ZONE_TYPES order; the ocean entry is unused): how fast the bed
   * rises upstream there, relative to S₀.
   */
  chanFactor: number[];
  /** floodplain half-width (metres) as a function of bed height: 4 control points of a monotone cubic spline */
  floodH: number[];
  floodW: number[];
  /** scale the floodplain with river size: × √(flow / FLOOD_REF_FLOW) */
  floodFlow: boolean;
  /** strength of the region-scale relief field (mountain belts across elevation zones) */
  relief: number;
  /** height of the ridge along region borders, metres */
  ridge: number;
  /** extra height where the basins of two different river systems meet, metres */
  divide: number;
  /** multiplier on the detail noise amplitude of every elevation zone type */
  noise: number;
  /** channel depth burnt below the bed profile, metres */
  burn: number;
  /** ocean depth far from the coast, metres */
  sea: number;
  /** regions per tile side (default: `tileSide` of the region size) */
  tile?: number;
}

/**
 * World span a tile aims for at most, metres: 2 regions of the default 128 km. Smaller
 * tiles arrive sooner while panning (about 0.7 s instead of 2 s for 4 × 4 at 1 km cells)
 * at about 1.5 × the cost per area, since each tile pays for its own halo and neighbours
 * (docs/research/sandbox4-tiling.md).
 */
const TILE_SPAN = 256_000;

/** Regions per tile side: 2 for 128 km regions, 1 from 256 km up, up to 4 for small regions (so tiles never get tiny). */
export function tileSide(regionSize: number): number {
  return Math.max(1, Math.min(4, Math.floor(TILE_SPAN / regionSize)));
}

/** Raster cells kept in the tile cache (h + cls + reg ≈ 9 bytes per cell). */
const CACHE_CELLS = 12_000_000;

/**
 * Detail-noise relief per elevation zone type (index = ELEVATION_ZONE_TYPES order in
 * world/zones.ts). Starting points from the report's §7.2 table, not sourced values.
 */
const ZONE_RELIEF: { amp: number; ridged: number }[] = [
  { amp: 0, ridged: 0 }, // Ocean (unused: noise is land only)
  { amp: 8, ridged: 0 }, // Flat
  { amp: 25, ridged: 0.15 }, // Lowland
  { amp: 80, ridged: 1 }, // Hills
  { amp: 180, ridged: 1 }, // Mountains
];

/** flow whose floodplain is exactly the curve when "scale with river size" is on */
export const FLOOD_REF_FLOW = 100;

/**
 * Monotone cubic interpolation (Fritsch & Carlson 1980) through control points:
 * C¹, passes through every point, never overshoots between two points (so a
 * positive curve stays positive), constant beyond the end points. The points are
 * sorted by x; equal x's keep the first. + − × ÷ only (bit-exact).
 */
export function monotoneSpline(xs: number[], ys: number[]): (x: number) => number {
  const pts = xs.map((x, i) => [x, ys[i]] as [number, number]).sort((a, b) => a[0] - b[0]);
  const px: number[] = [];
  const py: number[] = [];
  for (const [x, y] of pts) {
    if (px.length && x <= px[px.length - 1]) continue;
    px.push(x);
    py.push(y);
  }
  const n = px.length;
  if (n === 0) return () => 0;
  if (n === 1) return () => py[0];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((py[i + 1] - py[i]) / (px[i + 1] - px[i]));
  const m: number[] = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= px[0]) return py[0];
    if (x >= px[n - 1]) return py[n - 1];
    let i = 0;
    while (x > px[i + 1]) i++;
    const h = px[i + 1] - px[i];
    const t = (x - px[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * py[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * py[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/**
 * Raster margin beyond the region, metres: sources this far out still shape the region.
 * Steps 1–4 only differ between overlapping rasters within ~20 km of a raster edge
 * (measured: 0 beyond 20 km), so 24 km keeps every tile bit-identical to one raster per
 * region (tested) with 20–25 % fewer cells than the earlier 48 km.
 */
export const HALO = 24_000;
/** blend width of the per-zone-type parameters across elevation zone borders, metres */
const BLEND = 4_000;
/** ridge widths, metres */
const BORDER_W = 10_000;
const DIVIDE_W = 6_000;
/** distance over which the sea deepens from the coast, metres */
const SEA_W = 40_000;
/** height above the river (path cost from the channel) over which noise and ridges fade in, metres */
const MASK_H = 40;
/** cell size of the coarse per-region envelope that keeps river beds below their land, metres */
const BED_GRID = 2000;
/** slack of the bed caps, and the smallest lowering of a cap that counts (convergence), metres */
const BED_SLACK = 5;
/** gradient of a river below a cap (through a gorge): it only has to keep descending */
const GORGE_SLOPE = 0.0005;
const BED_TOL = 1;
/** ε of the Priority-Flood fill, metres */
const EPS = 0.01;
const ST_RELIEF = 0x7e11;
const ST_NOISE = 0x7e12;

/** Land-class codes of a raster cell. */
export const OCEAN = 0;
export const LAND = 1;

/**
 * One tile's height raster, cropped to the cells of its owned regions (plus a 2-cell
 * margin). Only typed arrays and numbers, so it can be posted from a worker.
 */
export interface TerrainTile {
  /** tile key (packKey(I, J)) and regions per side */
  tile: number;
  k: number;
  /** world position of cell (0, 0)'s centre, cell size, size */
  x0: number;
  y0: number;
  res: number;
  nx: number;
  ny: number;
  /** final heights (metres; ocean negative) */
  h: Float32Array;
  /** OCEAN / LAND */
  cls: Uint8Array;
  /** region of each cell, as an index into `regKeys` (see `regionAt`) */
  reg: Int32Array;
  regKeys: Float64Array;
  /**
   * Mean final height (metres) of each (merged) subbiome's land cells in the tile's owned
   * regions: `subH[n]` belongs to subbiome `subKeys[n]`. Read through `Terrain.subHeight`.
   */
  subKeys: Float64Array;
  subH: Float32Array;
  /** cells raised by the fill, and the largest raise (lakes / flats), metres */
  filled: number;
  maxFill: number;
  ms: number;
}

/** Region key of a tile cell. */
export function regionAt(t: TerrainTile, q: number): number {
  return t.regKeys[t.reg[q]];
}

/** Does the tile own (compute the final heights of) this region? */
export function ownsRegion(t: TerrainTile, rkey: number): boolean {
  return packKey(Math.floor(keyI(rkey) / t.k), Math.floor(keyJ(rkey) / t.k)) === t.tile;
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
  /** regions per tile side */
  readonly k: number;
  /** tile cache, oldest first */
  private tiles = new Map<number, TerrainTile>();
  private cells = 0;
  /** tiles the view still needs: never evicted */
  private needed = new Set<number>();
  private beds = new Map<number, Float64Array>();
  private bases = new Map<number, { z: Float64Array; cap: Float64Array }>();
  private grids = new Map<number, { i0: number; j0: number; nx: number; ny: number; ocean: Uint8Array; reg: Float64Array; hill: Float64Array; relief: Float64Array }>();
  private readonly seedR: number;
  private readonly seedN: number;
  /** floodplain half-width (m) at a bed height (m) */
  readonly flood: (z: number) => number;

  constructor(world: World, rivers: Rivers, p: TerrainParams) {
    this.world = world;
    this.rivers = rivers;
    this.p = p;
    this.k = Math.max(1, Math.floor(p.tile ?? tileSide(world.p.regionSize)));
    this.seedR = hash4(world.p.seed, ST_RELIEF, 0, 0) | 0;
    this.seedN = hash4(world.p.seed, ST_NOISE, 0, 0) | 0;
    this.flood = monotoneSpline(p.floodH, p.floodW);
  }

  /** Key of the tile that owns a region. */
  tileOf(rkey: number): number {
    return packKey(Math.floor(keyI(rkey) / this.k), Math.floor(keyJ(rkey) / this.k));
  }

  /** The regions a tile owns, lattice order. */
  tileRegions(tkey: number): number[] {
    const I = keyI(tkey) * this.k;
    const J = keyJ(tkey) * this.k;
    const out: number[] = [];
    for (let dj = 0; dj < this.k; dj++) for (let di = 0; di < this.k; di++) out.push(packKey(I + di, J + dj));
    return out;
  }

  /** Tiles whose regions may cover a world rectangle (regions spill one lattice cell out). */
  tilesIn(x0: number, y0: number, x1: number, y1: number): number[] {
    const set = new Set<number>();
    for (const rk of World.cellsIn(this.world.regionLevel, x0, y0, x1, y1, 1)) set.add(this.tileOf(rk));
    return [...set];
  }

  /** Tiles the view needs: kept in the cache whatever its size. */
  setNeeded(keys: Iterable<number>): void {
    this.needed = new Set(keys);
  }

  /** Add a tile (computed here or by a worker), evicting the oldest unneeded ones when over budget. */
  put(t: TerrainTile): void {
    const old = this.tiles.get(t.tile);
    if (old) this.cells -= old.nx * old.ny;
    this.tiles.delete(t.tile);
    this.tiles.set(t.tile, t);
    this.cells += t.nx * t.ny;
    for (const [key, v] of this.tiles) {
      if (this.cells <= CACHE_CELLS) break;
      if (key === t.tile || this.needed.has(key)) continue;
      this.tiles.delete(key);
      this.cells -= v.nx * v.ny;
    }
  }

  hasTile(tkey: number): boolean {
    return this.tiles.has(tkey);
  }

  /** The tile with this key, computed on demand. */
  getTile(tkey: number): TerrainTile {
    let t = this.tiles.get(tkey);
    if (!t) {
      t = this.compute(tkey);
      this.put(t);
    }
    return t;
  }

  /** Hillslope steepness of an elevation zone type (0.03 for an unknown index). */
  hillOf(type: number): number {
    const v = this.p.hillType[type];
    return v === undefined ? 0.03 : Math.max(0, v);
  }

  /** River gradient factor of an elevation zone type (1 for an unknown index). */
  chanOf(type: number): number {
    const f = this.p.chanFactor[type];
    return f === undefined ? 1 : f;
  }

  get size(): number {
    return this.tiles.size;
  }

  /** The tile holding a region's heights, if computed. */
  peek(rkey: number): TerrainTile | undefined {
    return this.tiles.get(this.tileOf(rkey));
  }

  /**
   * Mean land height (metres) of a merged subbiome of region `rkey`, from the tile that
   * owns the region. NaN while that tile is not computed (or the subbiome has no land).
   */
  subHeight(skey: number, rkey: number): number {
    const t = this.peek(rkey);
    if (!t) return NaN;
    let m = this.subMeans.get(t);
    if (!m) {
      m = new Map();
      for (let n = 0; n < t.subKeys.length; n++) m.set(t.subKeys[n], t.subH[n]);
      this.subMeans.set(t, m);
    }
    return m.get(skey) ?? NaN;
  }
  private subMeans = new WeakMap<TerrainTile, Map<number, number>>();

  /** The tile holding a region's heights, computed on demand. */
  get(rkey: number): TerrainTile {
    return this.getTile(this.tileOf(rkey));
  }

  /** Region-scale relief factor (mountain belts spanning several elevation zones). */
  reliefAt(x: number, y: number): number {
    if (this.p.relief <= 0) return 1;
    const f = fbm(this.seedR, x / 220_000, y / 220_000, RELIEF_FBM);
    return Math.max(0.25, 1 + this.p.relief * 1.6 * f);
  }

  /**
   * Bed elevation of every node of a region's rivers (step 0).
   *
   *   Rise      z_k = z_parent + Δx·S₀·c·A^−θ (c = gradient factor × relief), but never
   *             steeper than the hillslope of the land around (a river climbing faster than
   *             its valley sides would stand above the land).
   *   Levelling an elevation zone with factor c < 1 is a plain: its rivers may enter it at several
   *             points (they wander out into steeper neighbours and back), each carrying the
   *             height it climbed to outside. Every entry is lowered by level × (1 − c) of
   *             the way to the elevation zone's lowest entry. A river cannot run uphill, so the cap
   *             is pushed downstream: the stretch between the sea and a lowered entry is cut
   *             down to it (a gorge through the steeper land). Lowering one entry can lower
   *             another elevation zone's lowest entry, so this repeats until nothing changes.
   *
   * A pure function of the region (its rivers and the map), so every tile agrees.
   */
  bed(rkey: number): Float64Array {
    let z = this.beds.get(rkey);
    if (z) return z;
    z = this.solveBed(rkey, true).z;
    if (this.beds.size > 4000) this.beds.clear();
    this.beds.set(rkey, z);
    return z;
  }

  /** A region's beds with rise and levelling only (no envelope caps): the neighbours' sources in `bed`. */
  private baseBed(rkey: number): { z: Float64Array; cap: Float64Array } {
    let b = this.bases.get(rkey);
    if (b) return b;
    b = this.solveBed(rkey, false);
    if (this.bases.size > 4000) this.bases.clear();
    this.bases.set(rkey, b);
    return b;
  }

  /**
   * Bed profile of a region: rise and levelling; with `cross`, also capped by the bed
   * envelope over all land around the region, whose sources are the coast, the region's
   * own rivers and the neighbouring regions' rivers at their levelled beds (the land
   * between two regions follows the lower one, so a bed standing higher than a
   * neighbour's river allows must cut down too). Neighbours enter without their own caps,
   * so this stays local: a pure function of the region and its neighbours.
   */
  private solveBed(rkey: number, cross: boolean): { z: Float64Array; cap: Float64Array } {
    const rr = this.rivers.get(rkey);
    const w = this.world;
    const P = this.p;
    const n = rr.n;
    const par = rr.parent;
    // per node: elevation zone (merged root, −1 over the sea), rise above the parent, levelling share
    const env = cross ? this.bedEnvelope(rkey, rr, this.neighbourSources(rkey, rr), null) : null;
    const zone = new Float64Array(n).fill(-1);
    const rise = new Float64Array(n);
    /** segment length to the parent */
    const len = new Float64Array(n);
    /** share of an entry's excess over the lowest entry that is kept: 1 = no levelling */
    const keep = new Float64Array(n).fill(1);
    for (let k = 0; k < n; k++) {
      const p = par[k];
      if (p < 0 || rr.wet[k]) continue; // roots and the stretch over the sea sit at sea level
      const x = rr.x[k];
      const y = rr.y[k];
      const c = w.cellAt(x, y, true);
      const type = elevationZoneType(c.elevationZone, c.ocean);
      const rf = this.reliefAt(x, y);
      const dx = Math.sqrt(sq(x - rr.x[p]) + sq(y - rr.y[p]));
      const ch = P.chSlope * this.chanOf(type) * rf * invPowTheta(Math.max(1, rr.flow[k]), P.theta);
      // the same (blurred) hillslope the envelope uses, so a river never caps itself
      const hs = env && env.slope[k] >= 0 ? env.slope[k] : this.hillOf(type) * P.hill * rf;
      zone[k] = c.elevationZone;
      len[k] = dx;
      rise[k] = dx * Math.min(ch, hs);
      const cf = Math.min(1, Math.max(0, this.chanOf(type)));
      keep[k] = 1 - Math.min(1, Math.max(0, P.level)) * (1 - cf);
    }
    const isEntry = (k: number) => zone[k] >= 0 && zone[par[k]] !== zone[k];
    const zz = new Float64Array(n);
    const cap = new Float64Array(n).fill(Infinity);
    const envs = env ? [env] : [];
    /** rise from the parent within the caps (parents have smaller indices); returns the largest change */
    const forward = (): number => {
      let changed = 0;
      for (let k = 0; k < n; k++) {
        const p = par[k];
        if (p < 0 || rr.wet[k]) continue;
        const v = Math.max(zz[p], Math.min(zz[p] + rise[k], cap[k]));
        if (Math.abs(v - zz[k]) > changed) changed = Math.abs(v - zz[k]);
        zz[k] = v;
      }
      return changed;
    };
    /**
     * A river cannot run uphill: a node's cap also caps everything downstream (children
     * have larger indices). Below a cap the river only has to keep descending, at its
     * natural rise or GORGE_SLOPE if that is gentler, so a cut does not drag the whole
     * river below it down to the sea.
     */
    const pushDown = (): void => {
      for (let k = n - 1; k >= 0; k--) {
        const p = par[k];
        if (p < 0 || cap[k] === Infinity) continue;
        const c = Math.max(0, cap[k] - Math.min(rise[k], GORGE_SLOPE * len[k]));
        if (c < cap[p]) cap[p] = c;
      }
    };
    const lowest = new Map<number, number>();
    /** levelling: cap every entry of a low-gradient elevation zone towards its lowest entry */
    const level = (): boolean => {
      lowest.clear();
      for (let k = 0; k < n; k++) {
        if (!isEntry(k)) continue;
        const zp = zz[par[k]];
        const l = lowest.get(zone[k]);
        if (l === undefined || zp < l) lowest.set(zone[k], zp);
      }
      let capped = false;
      for (let k = 0; k < n; k++) {
        if (!isEntry(k) || keep[k] >= 1) continue;
        const zp = zz[par[k]];
        const l = lowest.get(zone[k])!;
        const t = l + keep[k] * (zp - l) + rise[k];
        if (t < cap[k] - BED_TOL) {
          cap[k] = t;
          capped = true;
        }
      }
      return capped;
    };
    forward();
    for (let outer = 0; outer < 6; outer++) {
      if (P.level > 0) {
        for (let it = 0; it < 32 && level(); it++) {
          pushDown();
          if (forward() < 1e-6) break;
        }
      }
      let capped = false;
      for (const e of envs) if (e.apply(zz, cap)) capped = true;
      if (!capped) break;
      pushDown();
      forward();
    }
    return { z: zz, cap };
  }

  /**
   * River nodes of the regions around a region's rivers (within the reach of its bed
   * envelope), at their pass-1 beds, with their floodplain half-widths.
   */
  private neighbourSources(rkey: number, rr: RegionRivers): { x: number[]; y: number[]; z: number[]; px: number[]; py: number[]; pz: number[]; wv: number[] } {
    const out = { x: [] as number[], y: [] as number[], z: [] as number[], px: [] as number[], py: [] as number[], pz: [] as number[], wv: [] as number[] };
    if (rr.n === 0) return out;
    const P = this.p;
    const M = 5 * BED_GRID;
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (let k = 0; k < rr.n; k++) {
      if (rr.x[k] < bx0) bx0 = rr.x[k];
      if (rr.x[k] > bx1) bx1 = rr.x[k];
      if (rr.y[k] < by0) by0 = rr.y[k];
      if (rr.y[k] > by1) by1 = rr.y[k];
    }
    bx0 -= M;
    by0 -= M;
    bx1 += M;
    by1 += M;
    for (const ok of World.cellsIn(this.world.regionLevel, bx0, by0, bx1, by1, 1)) {
      if (ok === rkey) continue;
      const ro = this.rivers.get(ok);
      if (ro.n === 0 || ro.x1 < bx0 || ro.x0 > bx1 || ro.y1 < by0 || ro.y0 > by1) continue;
      const zo = this.baseBed(ok).z;
      for (let k = 0; k < ro.n; k++) {
        const p = ro.parent[k];
        if (p < 0 || ro.wet[k]) continue;
        const x = ro.x[k];
        const y = ro.y[k];
        if (x < bx0 || x > bx1 || y < by0 || y > by1) continue;
        let wv = this.flood((zo[p] + zo[k]) * 0.5);
        if (P.floodFlow) wv *= Math.sqrt(Math.max(1, ro.flow[k]) / FLOOD_REF_FLOW);
        out.x.push(x);
        out.y.push(y);
        out.z.push(zo[k]);
        out.px.push(ro.x[p]);
        out.py.push(ro.y[p]);
        out.pz.push(zo[p]);
        out.wv.push(Math.max(0.75 * P.res, wv));
      }
    }
    return out;
  }

  /**
   * Height at a point, bilinear in the tile of the point's region. NaN when that
   * tile is not computed yet and `compute` is false.
   */
  heightAt(x: number, y: number, compute = false): number {
    const r = this.world.cellAt(x, y, true).region;
    const t = compute ? this.get(r) : this.peek(r);
    return t ? sample(t, x, y) : NaN;
  }

  /**
   * Height at a point from the computed tiles only, without classifying the point
   * (for the 3D mesh: many points, fast). A point's region lies within two region
   * lattice cells of the lattice cell under it (jitter and merges), so it is read from
   * the first cached tile around whose nearest raster cell belongs to a region the tile
   * owns; the rare point where none does falls back to `heightAt`. NaN when no tile
   * around is computed yet.
   */
  heightFast(x: number, y: number): number {
    const R = this.world.regionLevel.size;
    const i = Math.floor(x / R);
    const j = Math.floor(y / R);
    const k = this.k;
    let any = false;
    for (let tj = Math.floor((j - 2) / k); tj <= Math.floor((j + 2) / k); tj++) {
      for (let ti = Math.floor((i - 2) / k); ti <= Math.floor((i + 2) / k); ti++) {
        const t = this.tiles.get(packKey(ti, tj));
        if (!t) continue;
        any = true;
        const ci = Math.round((x - t.x0) / t.res);
        const cj = Math.round((y - t.y0) / t.res);
        if (ci < 0 || cj < 0 || ci >= t.nx || cj >= t.ny) continue;
        if (ownsRegion(t, regionAt(t, cj * t.nx + ci))) return sample(t, x, y);
      }
    }
    return any ? this.heightAt(x, y) : NaN;
  }

  /** Raster bounding box of a tile: the union of its regions' boxes. */
  private bbox(tkey: number): [number, number, number, number] {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const rk of this.tileRegions(tkey)) {
      const b = this.regionBox(rk);
      x0 = Math.min(x0, b[0]);
      y0 = Math.min(y0, b[1]);
      x1 = Math.max(x1, b[2]);
      y1 = Math.max(y1, b[3]);
    }
    return [x0, y0, x1, y1];
  }

  /** Raster bounding box of a region: its drawn elevation zones' sites plus a cell of slack, plus the halo. */
  private regionBox(rkey: number): [number, number, number, number] {
    const w = this.world;
    const B = w.elevationZoneLevel.size;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const keys = new Set([...this.rivers.regionElevationZones(rkey), ...w.region(rkey).elevationZones]);
    for (const b of keys) {
      const bd = w.elevationZone(b);
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
    const m = 1.6 * B * (1 + w.p.elevationZoneWarp) + HALO;
    return [x0 - m, y0 - m, x1 + m, y1 + m];
  }

  /**
   * The coarse (BED_GRID) classification around a region's rivers, shared by both bed
   * envelopes: sea flag, region, raw hillslope and relief factor per cell. Cached.
   */
  private bedGrid(rkey: number, rr: RegionRivers): { i0: number; j0: number; nx: number; ny: number; ocean: Uint8Array; reg: Float64Array; hill: Float64Array; relief: Float64Array } {
    let g = this.grids.get(rkey);
    if (g) return g;
    const w = this.world;
    const G = BED_GRID;
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (let k = 0; k < rr.n; k++) {
      if (rr.x[k] < bx0) bx0 = rr.x[k];
      if (rr.x[k] > bx1) bx1 = rr.x[k];
      if (rr.y[k] < by0) by0 = rr.y[k];
      if (rr.y[k] > by1) by1 = rr.y[k];
    }
    const i0 = Math.floor(bx0 / G) - 4;
    const j0 = Math.floor(by0 / G) - 4;
    const nx = Math.floor(bx1 / G) + 4 - i0 + 1;
    const ny = Math.floor(by1 / G) + 4 - j0 + 1;
    const N = nx * ny;
    const ocean = new Uint8Array(N);
    const reg = new Float64Array(N);
    const hill = new Float64Array(N);
    const relief = new Float64Array(N);
    const cell = {} as ReturnType<World['cellAt']>;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = (i0 + i + 0.5) * G;
        const y = (j0 + j + 0.5) * G;
        const c = w.cellAt(x, y, true, cell);
        const q = j * nx + i;
        reg[q] = c.region;
        if (c.ocean) {
          ocean[q] = 1;
          continue;
        }
        hill[q] = this.hillOf(elevationZoneType(c.elevationZone, false));
        relief[q] = this.reliefAt(x, y);
      }
    }
    g = { i0, j0, nx, ny, ocean, reg, hill, relief };
    if (this.grids.size > 4000) this.grids.clear();
    this.grids.set(rkey, g);
    return g;
  }

  /**
   * No river above its land. The land rises from every river and the coast at the
   * hillslope (step 1 takes the lowest such surface), so a bed that stands higher than
   * another source of the region allows (a headwater that wandered back near a much
   * lower river, or near the coast) leaves the river perched above its land.
   *
   * This builds that surface on a coarse grid (BED_GRID) over the region's own land: the
   * sea and every river segment seed it exactly (the bed at the projection of the cell
   * centre onto the segment, + slope × distance beyond the floodplain, in the 3 × 3 cells
   * around the segment's node; as the raster stamps it), then it spreads at the
   * hillslope. `apply` caps every bed above min over its 3 × 3 cells of (surface + slope ×
   * distance) and reports whether a cap was lowered; the caller pushes caps downstream,
   * so the river cuts a gorge instead. By the triangle inequality a river never caps
   * itself or its own course (its rise is limited by the same slope, `slope[k]`).
   *
   * Region-local (own land and the sea; landlocked regions walk all land), so a pure
   * function of the region.
   */
  private bedEnvelope(
    rkey: number,
    rr: RegionRivers,
    others: { x: number[]; y: number[]; z: number[]; px: number[]; py: number[]; pz: number[]; wv: number[] } | null,
    ownSlope: Float64Array | null,
  ): { slope: Float64Array; apply: (z: Float64Array, cap: Float64Array) => boolean } {
    const P = this.p;
    const G = BED_GRID;
    const n = rr.n;
    /** blurred hillslope (× multiplier × relief) at each node's cell, −1 = not on walkable land */
    const nodeSlope = new Float64Array(n).fill(-1);
    if (n === 0) return { slope: nodeSlope, apply: () => false };
    const grid = this.bedGrid(rkey, rr);
    const { i0, j0, nx, ny } = grid;
    const N = nx * ny;
    const cxOf = (i: number) => (i0 + i + 0.5) * G;
    const cyOf = (j: number) => (j0 + j + 0.5) * G;
    /** 0 = not walkable (another region's land), 1 = walkable land, 2 = sea */
    const kind = new Uint8Array(N);
    const raw = grid.hill;
    for (let q = 0; q < N; q++) {
      if (grid.ocean[q]) kind[q] = 2;
      else if (others !== null || rr.landlocked || grid.reg[q] === rkey) kind[q] = 1;
    }
    // blurred over walkable land within ±BLEND (like the raster's slope), × multiplier × relief
    const slope = new Float64Array(N);
    const r = Math.max(1, Math.round(BLEND / G));
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const q = j * nx + i;
        if (kind[q] !== 1) continue;
        let sum = 0;
        let cnt = 0;
        for (let jj = Math.max(0, j - r); jj <= Math.min(ny - 1, j + r); jj++) {
          for (let ii = Math.max(0, i - r); ii <= Math.min(nx - 1, i + r); ii++) {
            const t = jj * nx + ii;
            if (kind[t] !== 1) continue;
            sum += raw[t];
            cnt++;
          }
        }
        slope[q] = (sum / cnt) * P.hill * grid.relief[q];
      }
    }
    const nodeCell = new Int32Array(n).fill(-1);
    for (let k = 0; k < n; k++) {
      if (rr.parent[k] < 0 || rr.wet[k]) continue;
      const q = (Math.floor(rr.y[k] / G) - j0) * nx + (Math.floor(rr.x[k] / G) - i0);
      if (kind[q] !== 1) continue;
      nodeCell[k] = q;
      nodeSlope[k] = ownSlope && ownSlope[k] >= 0 ? ownSlope[k] : slope[q];
    }
    // the neighbours' river nodes (cross mode): fixed sources
    const oCell: number[] = [];
    if (others) {
      for (let t = 0; t < others.x.length; t++) {
        const oi = Math.floor(others.x[t] / G) - i0;
        const oj = Math.floor(others.y[t] / G) - j0;
        const q = oi >= 0 && oj >= 0 && oi < nx && oj < ny ? oj * nx + oi : -1;
        oCell.push(q >= 0 && kind[q] === 1 ? q : -1);
      }
    }
    const E = new Float64Array(N);
    const heap = new MinHeap(1024);
    const DI = [1, -1, 0, 0, 1, 1, -1, -1];
    const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    /** visit the walkable 3 × 3 cells around cell q0 with the distance from (px, py) to each cell centre */
    const aroundAt = (q0: number, px: number, py: number, f: (q: number, d: number) => void) => {
      const ci = q0 % nx;
      const cj = (q0 - ci) / nx;
      for (let jj = cj - 1; jj <= cj + 1; jj++) {
        for (let ii = ci - 1; ii <= ci + 1; ii++) {
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          const q = jj * nx + ii;
          if (kind[q] !== 1) continue;
          f(q, Math.sqrt(sq(px - cxOf(ii)) + sq(py - cyOf(jj))));
        }
      }
    };
    const around = (k: number, f: (q: number, d: number) => void) => aroundAt(nodeCell[k], rr.x[k], rr.y[k], f);
    /**
     * Seed the 3 × 3 cells around cell q0 from segment a → b (beds za, zb, floodplain
     * half-width wv): the bed at the cell centre's projection onto the segment, plus the
     * hillslope beyond the floodplain. Sloping along the river like the raster's stamp,
     * so a river never caps its own rise (triangle inequality).
     */
    const seedSeg = (q0: number, ax: number, ay: number, za: number, bx: number, by: number, zb: number, wv: number, s0: number) => {
      const ex = bx - ax;
      const ey = by - ay;
      const l2 = ex * ex + ey * ey;
      const ci = q0 % nx;
      const cj = (q0 - ci) / nx;
      for (let jj = cj - 1; jj <= cj + 1; jj++) {
        for (let ii = ci - 1; ii <= ci + 1; ii++) {
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          const q = jj * nx + ii;
          if (kind[q] !== 1) continue;
          const px = cxOf(ii) - ax;
          const py = cyOf(jj) - ay;
          let t = l2 > 0 ? (px * ex + py * ey) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.sqrt(sq(px - t * ex) + sq(py - t * ey));
          const v = za + (zb - za) * t + Math.max(s0, slope[q]) * Math.max(0, d - wv);
          if (v < E[q]) E[q] = v;
        }
      }
    };
    const apply = (z: Float64Array, cap: Float64Array): boolean => {
      E.fill(Infinity);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const q = j * nx + i;
          if (kind[q] === 2 && hasNbr(kind, nx, ny, i, j, 1)) E[q] = 0;
        }
      }
      for (let k = 0; k < n; k++) {
        if (nodeCell[k] < 0) continue;
        const p = rr.parent[k];
        const zk = z[k];
        // the segment's floodplain is flat across, at the bed interpolated along it (as the raster stamps it, see addSegments)
        let wv = this.flood((z[p] + zk) * 0.5);
        if (P.floodFlow) wv *= Math.sqrt(Math.max(1, rr.flow[k]) / FLOOD_REF_FLOW);
        wv = Math.max(0.75 * P.res, wv);
        seedSeg(nodeCell[k], rr.x[p], rr.y[p], z[p], rr.x[k], rr.y[k], zk, wv, nodeSlope[k]);
      }
      if (others) {
        for (let t = 0; t < oCell.length; t++) {
          const q0 = oCell[t];
          if (q0 < 0) continue;
          seedSeg(q0, others.px[t], others.py[t], others.pz[t], others.x[t], others.y[t], others.z[t], others.wv[t], slope[q0]);
        }
      }
      for (let q = 0; q < N; q++) if (E[q] < Infinity) heap.push(E[q], q);
      while (heap.size > 0) {
        const d = heap.peekKey();
        const q = heap.pop();
        if (d > E[q]) continue;
        const i = q % nx;
        const j = (q - i) / nx;
        for (let t = 0; t < 8; t++) {
          const ii = i + DI[t];
          const jj = j + DJ[t];
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          const rq = jj * nx + ii;
          if (kind[rq] !== 1) continue;
          const sl = kind[q] === 1 ? (slope[q] + slope[rq]) * 0.5 : slope[rq];
          const nd = d + G * sl * (t < 4 ? 1 : Math.SQRT2);
          if (nd < E[rq]) {
            E[rq] = nd;
            heap.push(nd, rq);
          }
        }
      }
      let capped = false;
      for (let k = 0; k < n; k++) {
        if (nodeCell[k] < 0) continue;
        let lim = Infinity;
        const sk = nodeSlope[k];
        around(k, (q, d) => {
          const v = E[q] + Math.max(sk, slope[q]) * d;
          if (v < lim) lim = v;
        });
        // a few metres of slack for the discretised spread
        lim += BED_SLACK;
        // only lowerings that matter count (each one lowers the surface a little in turn)
        if (z[k] > lim && lim < cap[k] - BED_TOL) {
          cap[k] = lim;
          capped = true;
        }
      }
      return capped;
    };
    return { slope: nodeSlope, apply };
  }

  /** Compute a tile (not cached: see `getTile`). */
  compute(tkey: number): TerrainTile {
    const t0 = performance.now();
    const w = this.world;
    const P = this.p;
    const res = P.res;
    const [bx0, by0, bx1, by1] = this.bbox(tkey);
    const i0 = Math.floor(bx0 / res);
    const j0 = Math.floor(by0 / res);
    const nx = Math.floor(bx1 / res) - i0 + 1;
    const ny = Math.floor(by1 / res) - j0 + 1;
    const N = nx * ny;
    const X0 = (i0 + 0.5) * res;
    const Y0 = (j0 + 0.5) * res;
    const cx = (i: number) => X0 + i * res;
    const cy = (j: number) => Y0 + j * res;

    // ---- classify + per-zone-type parameters
    const cls = new Uint8Array(N);
    /** region of each cell, as an index into regKeys */
    const reg = new Int32Array(N);
    const regKeys: number[] = [];
    const regIndex = new Map<number, number>();
    const lt = new Int8Array(N).fill(-1);
    /** (merged) subbiome of each cell, for the per-subbiome mean heights */
    const subOf = new Float64Array(N);
    const cell = {} as ReturnType<World['cellAt']>;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = w.cellAt(cx(i), cy(j), true, cell);
        const q = j * nx + i;
        subOf[q] = c.sub;
        cls[q] = c.ocean ? OCEAN : LAND;
        let ri = regIndex.get(c.region);
        if (ri === undefined) {
          ri = regKeys.length;
          regKeys.push(c.region);
          regIndex.set(c.region, ri);
        }
        reg[q] = ri;
        if (!c.ocean) lt[q] = elevationZoneType(c.elevationZone, false);
      }
    }
    // blended over land cells (box blur, separable): slope, noise amplitude, ridged share
    const rb = Math.max(1, Math.round(BLEND / res));
    const slope = blurLand(nx, ny, cls, rb, (q) => this.hillOf(lt[q]));
    const amp = blurLand(nx, ny, cls, rb, (q) => ZONE_RELIEF[lt[q]].amp);
    const rmix = blurLand(nx, ny, cls, rb, (q) => ZONE_RELIEF[lt[q]].ridged);
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
      // a river's corridor only shapes its own region's land (rivers never enter another
      // region's land; a neighbour's corridor spilling over the border would pull this
      // region's land down below its own rivers). Landlocked regions cross their neighbours.
      const ri = rr.landlocked ? -1 : (regIndex.get(rk) ?? -2);
      addSegments(segs, rr, z, lab0, ri, this.flood, P.floodFlow, res);
    }

    // ---- 1. envelope: Dijkstra from the river beds and the coast
    const E = new Float64Array(N).fill(Infinity);
    const src = new Float64Array(N); // bed / coast height the cell's path starts from
    const lab = new Float64Array(N).fill(-1); // river system (−1 = coast)
    const heap = new MinHeap(4096);
    // distance from every cell to its nearest river (within the burn reach): a river's
    // corridor and burn ramp only shape the cells it is nearest to, so a big river's wide
    // floodplain cannot pull down a higher tributary running beside it (that left the
    // tributary standing above its land)
    const near = new Float64Array(N).fill(Infinity);
    for (const s of segs) {
      stampSeg(s, nx, ny, X0, Y0, res, (q, _zb, d) => {
        if (s.reg !== -1 && reg[q] !== s.reg && cls[q] === LAND) return;
        if (d < near[q]) near[q] = d;
      }, Math.max(2 * res, s.wv));
    }
    // only exact ties (a cell equally near two joined segments of one river) share it
    const tol = 1;
    // the channel itself (the narrowest corridor, see addSegments) is always stamped and
    // burnt, so a river's trench stays continuous where another river passes close by
    const chan = 0.75 * res;
    for (const s of segs) {
      stampSeg(s, nx, ny, X0, Y0, res, (q, zb, d) => {
        if (cls[q] !== LAND || zb >= E[q] || (d > near[q] + tol && d > chan) || (s.reg !== -1 && reg[q] !== s.reg)) return;
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
        if (cls[q] !== LAND || (d > near[q] + tol && d > chan) || (s.reg !== -1 && reg[q] !== s.reg)) return;
        let target: number;
        if (d <= s.wv) target = zb - P.burn;
        else {
          if (pre[q] <= zb) return;
          target = zb + (pre[q] - zb) * ((d - s.wv) / buf);
        }
        if (target < pre[q]) pre[q] = target;
      }, buf);
    }

    // ---- 5. ε-Priority-Flood over each owned region's land, on the shared raster.
    // A region's fill only writes its own land cells and is seeded from its sea and
    // border cells, which keep their `pre` heights, so the regions do not interact.
    const h = pre;
    const owned = new Int8Array(regKeys.length);
    for (const rk of this.tileRegions(tkey)) {
      const ri = regIndex.get(rk);
      if (ri !== undefined) owned[ri] = 1;
    }
    // seeds per owned region index: sea cells next to its land, its land on the raster
    // edge or next to another region's land (raster scan order; the heap orders them)
    const seeds = new Map<number, number[]>();
    const addSeed = (ri: number, q: number) => {
      const list = seeds.get(ri);
      if (list) list.push(q);
      else seeds.set(ri, [q]);
    };
    const nbrRegs: number[] = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const q = j * nx + i;
        if (cls[q] === OCEAN) {
          nbrRegs.length = 0;
          for (let jj = j - 1; jj <= j + 1; jj++) {
            for (let ii = i - 1; ii <= i + 1; ii++) {
              if (ii < 0 || jj < 0 || ii >= nx || jj >= ny || (ii === i && jj === j)) continue;
              const r = jj * nx + ii;
              if (cls[r] === LAND && owned[reg[r]] && !nbrRegs.includes(reg[r])) nbrRegs.push(reg[r]);
            }
          }
          for (const ri of nbrRegs) addSeed(ri, q);
        } else if (owned[reg[q]] && (i === 0 || j === 0 || i === nx - 1 || j === ny - 1 || landNbrDiffers(cls, reg, nx, ny, i, j))) {
          addSeed(reg[q], q);
        }
      }
    }
    /** cells already processed in the current region's fill (stamped with pass + 1) */
    const done = new Int32Array(N);
    let filled = 0;
    let maxFill = 0;
    let pass = 0;
    for (const [ri, list] of [...seeds.entries()].sort((a, b) => a[0] - b[0])) {
      pass++;
      for (const q of list) {
        done[q] = pass;
        heap.push(h[q], q);
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
          if (done[r] === pass || cls[r] !== LAND || reg[r] !== ri) continue;
          done[r] = pass;
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
    }

    // ---- mean height of every subbiome's land in the owned regions (raster order, so deterministic)
    const subIndex = new Map<number, number>();
    const subKeys: number[] = [];
    const subSum: number[] = [];
    const subCount: number[] = [];
    for (let q = 0; q < N; q++) {
      if (cls[q] !== LAND || !owned[reg[q]]) continue;
      let si = subIndex.get(subOf[q]);
      if (si === undefined) {
        si = subKeys.length;
        subIndex.set(subOf[q], si);
        subKeys.push(subOf[q]);
        subSum.push(0);
        subCount.push(0);
      }
      subSum[si] += h[q];
      subCount[si]++;
    }

    // ---- crop to the owned regions' cells (+ a margin for bilinear sampling)
    let ci0 = nx;
    let cj0 = ny;
    let ci1 = -1;
    let cj1 = -1;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!owned[reg[j * nx + i]]) continue;
        if (i < ci0) ci0 = i;
        if (i > ci1) ci1 = i;
        if (j < cj0) cj0 = j;
        if (j > cj1) cj1 = j;
      }
    }
    if (ci1 < 0) {
      // no owned region reaches the raster (cannot happen with lattice-aligned tiles): keep the centre cell
      ci0 = ci1 = nx >> 1;
      cj0 = cj1 = ny >> 1;
    }
    const M = 2;
    ci0 = Math.max(0, ci0 - M);
    cj0 = Math.max(0, cj0 - M);
    ci1 = Math.min(nx - 1, ci1 + M);
    cj1 = Math.min(ny - 1, cj1 + M);
    const cnx = ci1 - ci0 + 1;
    const cny = cj1 - cj0 + 1;
    const ch = new Float32Array(cnx * cny);
    const ccls = new Uint8Array(cnx * cny);
    const creg = new Int32Array(cnx * cny);
    for (let j = 0; j < cny; j++) {
      const src0 = (j + cj0) * nx + ci0;
      ch.set(h.subarray(src0, src0 + cnx), j * cnx);
      ccls.set(cls.subarray(src0, src0 + cnx), j * cnx);
      creg.set(reg.subarray(src0, src0 + cnx), j * cnx);
    }

    return {
      tile: tkey,
      k: this.k,
      x0: cx(ci0),
      y0: cy(cj0),
      res,
      nx: cnx,
      ny: cny,
      h: ch,
      cls: ccls,
      reg: creg,
      regKeys: Float64Array.from(regKeys),
      subKeys: Float64Array.from(subKeys),
      subH: Float32Array.from(subSum, (s, n) => s / subCount[n]),
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
  /** index (into the raster's region table) of the region whose land the river may shape; −1 = any (landlocked) */
  reg: number;
}

/**
 * Dry river segments (child on land) of one region, with floodplain half-widths from
 * the height curve at the segment's mean bed height (optionally × √(flow / reference)).
 */
function addSegments(out: Seg[], rr: RegionRivers, z: Float64Array, lab0: number, reg: number, flood: (z: number) => number, byFlow: boolean, res: number): void {
  for (let k = 0; k < rr.n; k++) {
    const p = rr.parent[k];
    if (p < 0 || rr.wet[k]) continue;
    let wv = flood((z[p] + z[k]) * 0.5);
    if (byFlow) wv *= Math.sqrt(Math.max(1, rr.flow[k]) / FLOOD_REF_FLOW);
    out.push({
      ax: rr.x[p],
      ay: rr.y[p],
      bx: rr.x[k],
      by: rr.y[k],
      za: z[p],
      zb: z[k],
      wv: Math.max(0.75 * res, wv),
      lab: lab0 + rr.tree[k],
      reg,
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
function landNbrDiffers(cls: Uint8Array, reg: Int32Array, nx: number, ny: number, i: number, j: number): boolean {
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

/** Bilinear sample of a tile raster (clamped at the raster edge). */
export function sample(t: TerrainTile, x: number, y: number): number {
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
