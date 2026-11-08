/**
 * Map statistics: how the biomes, elevation zone types, climate and heights are spread
 * over a rectangle of the world, to spot under-represented biomes while tuning.
 *
 *   Samples   one per raw subbiome lattice cell whose (i, j) lies in the rectangle (equal
 *             areas), every `stride`-th cell in each direction when the rectangle holds
 *             more than MAX_SAMPLES of them. A sample takes everything from its merged
 *             subbiome: biome, belt, moisture and climate (biomes.ts), elevation zone type.
 *   Heights   from the terrain tiles that are already computed (their raster cells inside
 *             the rectangle, owned regions only); no tile is computed for the statistics.
 *
 * Time-sliced: call `step(deadline)` until it returns true, then read `result`.
 */
import { BELTS, BIOMES, MOISTURE, type Biomes } from './biomes';
import { packKey } from './level';
import { LAND, ownsRegion, type Terrain, type TerrainTile } from './terrain';
import { ELEVATION_ZONE_TYPES } from './zones';
import type { World } from './world';

/** Most subbiome samples per run (the stride grows beyond it). */
export const MAX_SAMPLES = 40_000;
/** Bars of the distribution histograms. */
export const HIST_BINS = 24;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A value and where it was found (metres). */
export interface Extreme {
  v: number;
  x: number;
  y: number;
}

/** Summary and histogram of one quantity. */
export interface Dist {
  n: number;
  mean: number;
  min: Extreme | null;
  max: Extreme | null;
  /** counts over [lo, hi] in HIST_BINS equal bins (of log10 values when `log`) */
  bins: number[];
  lo: number;
  hi: number;
  log: boolean;
}

export interface MapStats {
  rect: Rect;
  /** samples taken, the lattice stride between them and the area each one stands for (m²) */
  samples: number;
  stride: number;
  sampleArea: number;
  land: number;
  ocean: number;
  /** distinct merged cells met */
  regions: number;
  zones: number;
  subs: number;
  /** per BIOMES index: samples (area) and distinct merged subbiomes */
  biomeSamples: number[];
  biomeSubs: number[];
  /** per ELEVATION_ZONE_TYPES index: samples (area) and distinct merged elevation zones */
  zoneSamples: number[];
  zoneCount: number[];
  /** land samples per thermal belt × moisture class, and the most common biome in each (−1 when empty) */
  grid: number[][];
  gridBiome: number[][];
  /** initial (sea-level) temperature and precipitation of every sample */
  t0: Dist;
  p0: Dist;
  /** land: temperature after the height cooling, precipitation after the sparse-flat dryness */
  t: Dist;
  p: Dist;
  /** land height and ocean depth from the computed terrain rasters */
  height: Dist;
  depth: Dist;
  /** share of the rectangle with a computed height map */
  coverage: number;
  /** land samples whose biome used an exact (terrain) height, that the height cooling changed, in river-poor flat zones */
  exactHeight: number;
  shifted: number;
  sparse: number;
  ms: number;
}

/** Collects values (with the positions of the extremes) into a Dist. */
class Acc {
  private v = new Float32Array(1024);
  n = 0;
  private sum = 0;
  min: Extreme | null = null;
  max: Extreme | null = null;

  constructor(private readonly log = false) {}

  add(v: number, x: number, y: number): void {
    if (v !== v) return;
    if (this.n === this.v.length) {
      const g = new Float32Array(this.v.length * 2);
      g.set(this.v);
      this.v = g;
    }
    this.v[this.n++] = v;
    this.sum += v;
    if (!this.min || v < this.min.v) this.min = { v, x, y };
    if (!this.max || v > this.max.v) this.max = { v, x, y };
  }

  finish(): Dist {
    const bins = new Array<number>(HIST_BINS).fill(0);
    const f = (v: number) => (this.log ? Math.log10(Math.max(1, v)) : v);
    const lo = this.min ? f(this.min.v) : 0;
    const hi = this.max ? f(this.max.v) : 0;
    const span = hi - lo;
    for (let k = 0; k < this.n; k++) {
      const b = span > 0 ? Math.min(HIST_BINS - 1, Math.floor(((f(this.v[k]) - lo) / span) * HIST_BINS)) : 0;
      bins[b]++;
    }
    return { n: this.n, mean: this.n ? this.sum / this.n : NaN, min: this.min, max: this.max, bins, lo, hi, log: this.log };
  }
}

const zeros = (n: number) => new Array<number>(n).fill(0);

export class MapStatsJob {
  readonly rect: Rect;
  readonly stride: number;
  private readonly i0: number;
  private readonly j0: number;
  private readonly cols: number;
  private readonly total: number;
  private next = 0;
  private tiles: TerrainTile[] = [];
  private tileNext = 0;
  private covered = 0;
  private elapsed = 0;

  private land = 0;
  private ocean = 0;
  private regions = new Set<number>();
  private zoneSets = ELEVATION_ZONE_TYPES.map(() => new Set<number>());
  private biomeSets = BIOMES.map(() => new Set<number>());
  private biomeSamples = zeros(BIOMES.length);
  private zoneSamples = zeros(ELEVATION_ZONE_TYPES.length);
  private grid = BELTS.map(() => zeros(MOISTURE.length));
  private gridBiomes = BELTS.map(() => MOISTURE.map(() => zeros(BIOMES.length)));
  private accT0 = new Acc();
  private accP0 = new Acc(true);
  private accT = new Acc();
  private accP = new Acc(true);
  private accH = new Acc();
  private accD = new Acc();
  private exact = 0;
  private shifted = 0;
  private sparse = 0;
  result: MapStats | null = null;

  constructor(
    readonly world: World,
    readonly biomes: Biomes,
    readonly terrain: Terrain | null,
    rect: Rect,
  ) {
    this.rect = rect;
    const s = world.subLevel.size;
    this.i0 = Math.floor(rect.x0 / s);
    this.j0 = Math.floor(rect.y0 / s);
    const ni = Math.floor(rect.x1 / s) - this.i0 + 1;
    const nj = Math.floor(rect.y1 / s) - this.j0 + 1;
    this.stride = Math.max(1, Math.ceil(Math.sqrt((ni * nj) / MAX_SAMPLES)));
    this.cols = Math.ceil(ni / this.stride);
    this.total = this.cols * Math.ceil(nj / this.stride);
    if (terrain) {
      for (const tk of terrain.tilesIn(rect.x0, rect.y0, rect.x1, rect.y1)) {
        const t = terrain.peek(terrain.tileRegions(tk)[0]);
        if (t) this.tiles.push(t);
      }
    }
  }

  /** Share of the work done, 0–1. */
  get progress(): number {
    const work = this.total + this.tiles.length * 2000;
    return (this.next + this.tileNext * 2000) / Math.max(1, work);
  }

  /** Work until `deadline` (performance.now() ms); true when finished. */
  step(deadline: number): boolean {
    if (this.result) return true;
    const start = performance.now();
    while (this.next < this.total) {
      const end = Math.min(this.total, this.next + 64);
      for (; this.next < end; this.next++) this.sample(this.next);
      if (performance.now() > deadline) {
        this.elapsed += performance.now() - start;
        return false;
      }
    }
    while (this.tileNext < this.tiles.length) {
      this.scanTile(this.tiles[this.tileNext++]);
      if (performance.now() > deadline && this.tileNext < this.tiles.length) {
        this.elapsed += performance.now() - start;
        return false;
      }
    }
    this.elapsed += performance.now() - start;
    this.finish();
    return true;
  }

  private sample(n: number): void {
    const w = this.world;
    const i = this.i0 + (n % this.cols) * this.stride;
    const j = this.j0 + Math.floor(n / this.cols) * this.stride;
    const c = w.subCell(packKey(i, j));
    const b = this.biomes.ofSub(c.sub);
    this.regions.add(c.region);
    this.zoneSets[b.zoneType].add(c.elevationZone);
    this.zoneSamples[b.zoneType]++;
    this.biomeSets[b.biome].add(c.sub);
    this.biomeSamples[b.biome]++;
    this.accT0.add(b.t0, b.x, b.y);
    this.accP0.add(b.p0, b.x, b.y);
    if (b.ocean) {
      this.ocean++;
      return;
    }
    this.land++;
    this.accT.add(b.t, b.x, b.y);
    this.accP.add(b.p, b.x, b.y);
    this.grid[b.belt][b.moisture]++;
    this.gridBiomes[b.belt][b.moisture][b.biome]++;
    if (b.heightExact) this.exact++;
    if (b.seaLevel !== b.biome) this.shifted++;
    if (b.sparse) this.sparse++;
  }

  /** Heights of a tile's raster cells inside the rectangle, in the regions the tile owns. */
  private scanTile(t: TerrainTile): void {
    const { x0, y0, x1, y1 } = this.rect;
    const owned = Array.from(t.regKeys, (rk) => ownsRegion(t, rk));
    const ci0 = Math.max(0, Math.ceil((x0 - t.x0) / t.res));
    const ci1 = Math.min(t.nx - 1, Math.floor((x1 - t.x0) / t.res));
    const cj0 = Math.max(0, Math.ceil((y0 - t.y0) / t.res));
    const cj1 = Math.min(t.ny - 1, Math.floor((y1 - t.y0) / t.res));
    for (let cj = cj0; cj <= cj1; cj++) {
      const y = t.y0 + cj * t.res;
      for (let ci = ci0; ci <= ci1; ci++) {
        const q = cj * t.nx + ci;
        const r = t.reg[q];
        if (r < 0 || !owned[r]) continue;
        this.covered += t.res * t.res;
        const x = t.x0 + ci * t.res;
        if (t.cls[q] === LAND) this.accH.add(t.h[q], x, y);
        else this.accD.add(t.h[q], x, y);
      }
    }
  }

  private finish(): void {
    const { x0, y0, x1, y1 } = this.rect;
    const area = Math.max(1, (x1 - x0) * (y1 - y0));
    const s = this.world.subLevel.size * this.stride;
    const gridBiome = this.gridBiomes.map((row) =>
      row.map((counts) => {
        let best = -1;
        for (let k = 0; k < counts.length; k++) if (counts[k] > 0 && (best < 0 || counts[k] > counts[best])) best = k;
        return best;
      }),
    );
    let subs = 0;
    for (const set of this.biomeSets) subs += set.size;
    let zones = 0;
    for (const set of this.zoneSets) zones += set.size;
    this.result = {
      rect: this.rect,
      samples: this.total,
      stride: this.stride,
      sampleArea: s * s,
      land: this.land,
      ocean: this.ocean,
      regions: this.regions.size,
      zones,
      subs,
      biomeSamples: this.biomeSamples,
      biomeSubs: this.biomeSets.map((x) => x.size),
      zoneSamples: this.zoneSamples,
      zoneCount: this.zoneSets.map((x) => x.size),
      grid: this.grid,
      gridBiome,
      t0: this.accT0.finish(),
      p0: this.accP0.finish(),
      t: this.accT.finish(),
      p: this.accP.finish(),
      height: this.accH.finish(),
      depth: this.accD.finish(),
      coverage: Math.min(1, this.covered / area),
      exactHeight: this.exact,
      shifted: this.shifted,
      sparse: this.sparse,
      ms: this.elapsed,
    };
  }
}

/** Run a job to the end (tests, small rectangles). */
export function computeMapStats(world: World, biomes: Biomes, terrain: Terrain | null, rect: Rect): MapStats {
  const job = new MapStatsJob(world, biomes, terrain, rect);
  job.step(Infinity);
  return job.result!;
}
