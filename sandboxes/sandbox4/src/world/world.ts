/**
 * The three-level map hierarchy (spec: sandbox3.md), as a pure function of (seed, params).
 *
 *   Regions    128 km lattice Voronoi, no warp. Each region owns the biomes whose
 *              site lies inside it, and picks among them 0–2 ocean seeds and 2–4
 *              biome mergers.
 *   Biomes      32 km lattice Voronoi with border warp. Each biome owns the
 *              subbiomes whose site lies inside it, and picks 2–4 subbiome mergers.
 *   Subbiomes    8 km lattice Voronoi with border warp.
 *
 * Oceans (on raw biome cells, before merging):
 *   1. Seeds: every region marks n ∈ [min, max] of its biomes as ocean seeds.
 *   2. Links: each seed, with probability `doubleLinkChance`, links to its two nearest
 *      other seeds; otherwise, with probability `connectChance`, it links to the nearest other
 *      seed (searching regions up to `connectRange` away). Every biome crossed by the
 *      straight segment between the two seed sites becomes ocean ("chain"), so more
 *      than two seeds can join into one ocean.
 *   3. Growth: every linked ocean biome (or every ocean biome, see `growFrom`) turns
 *      its n closest land neighbours into ocean, n ∈ {0,1,2,3} drawn with the given
 *      weights. Further passes grow from the biomes converted in the previous pass.
 *
 * Merges: a chosen cell joins its nearest neighbour (Gabriel graph, by site
 * distance). Biome merges stay on one side of the coast unless `mergeAcrossCoast`;
 * subbiome merges stay inside one (merged) biome. Chains X→Y→Z merge into one cell,
 * and a cycle X→Y→X resolves to the smaller key.
 *
 * Nesting: with `nest`, a subbiome belongs to the biome under its site and a biome
 * to the region under its site, and every pixel is classified through its subbiome,
 * so the borders of all three levels line up (coasts follow 8 km cells).
 *
 * Everything is evaluated lazily and memoised. Every value only depends on a bounded
 * neighbourhood, and the ocean registry is merged with bitwise OR, so the result is
 * independent of the order in which the map is explored (see tests/world.test.ts).
 */
import { hash4, sfc32, toUnit } from '@shared/core/hash';
import { keyI, keyJ, Level, packKey } from './level';

export type GrowFrom = 'connected' | 'all';

export interface WorldParams {
  seed: number;
  // regions
  regionSize: number;
  regionJitter: number;
  oceanMin: number;
  oceanMax: number;
  biomeMergeMin: number;
  biomeMergeMax: number;
  // oceans
  connectChance: number;
  /** chance that a seed links to its two nearest seeds instead (overrides connectChance) */
  doubleLinkChance: number;
  connectRange: number;
  /** relative weights of converting 0, 1, 2, 3 neighbours */
  growWeights: [number, number, number, number];
  growFrom: GrowFrom;
  growPasses: number;
  // biomes
  biomeSize: number;
  biomeJitter: number;
  biomeWarp: number;
  biomeWarpFreq: number;
  mergeAcrossCoast: boolean;
  subMergeMin: number;
  subMergeMax: number;
  // subbiomes
  subSize: number;
  subJitter: number;
  subWarp: number;
  subWarpFreq: number;
  nest: boolean;
}

/** Base ocean flags (OR-merged from every region's sources). */
export const SEED = 1;
export const LINKED = 2;

/** Ocean genesis of a biome, for display. */
export const ORIGIN = {
  land: 0,
  loneSeed: 1,
  linkedSeed: 2,
  chain: 3,
  /** growth pass p is `grow + p − 1` */
  grow: 4,
} as const;

export interface Region {
  key: number;
  i: number;
  j: number;
  x: number;
  y: number;
  /** owned biome keys (sites inside this region), lattice order */
  biomes: number[];
  seeds: number[];
  merges: Set<number>;
  /** seed links that start in this region (null until sourced) */
  links: Link[] | null;
}

export interface Link {
  from: number;
  to: number;
  chain: number[];
}

export interface Biome {
  key: number;
  i: number;
  j: number;
  x: number;
  y: number;
  /** owning region: the region containing the site */
  region: number;
  nbrs: number[] | null;
  /** ocean state after pass p: −1 unknown, 0 land, 1 ocean */
  oceanP: Int8Array;
  picks: (number[] | null)[];
  /** NaN = not resolved yet, −1 = not merged */
  target: number;
  root: number;
  subs: number[] | null;
  subMerges: Set<number> | null;
}

export interface Sub {
  key: number;
  i: number;
  j: number;
  x: number;
  y: number;
  /** owning raw biome: the biome containing the site */
  biome: number;
  nbrs: number[] | null;
  target: number;
  root: number;
}

/** Everything the renderer needs about one map location. */
export interface Cell {
  /** subbiome (raw and merged root); −1 when resolved at biome level only */
  subRaw: number;
  sub: number;
  biomeRaw: number;
  biome: number;
  region: number;
  ocean: boolean;
  origin: number;
  /** member of a merged group */
  subMerged: boolean;
  biomeMerged: boolean;
}

const ST_SEEDS = 0x5e01;
const ST_MERGE = 0x5e02;
const ST_LINK = 0x5e03;
const ST_DLINK = 0x5e05;
const ST_GROW = 0x5e10;
const ST_SUBMERGE = 0x5e04;

/** Pick k distinct items (partial Fisher–Yates on a copy). */
function pick<T>(items: T[], k: number, rng: () => number): T[] {
  const a = items.slice();
  const n = Math.min(k, a.length);
  for (let t = 0; t < n; t++) {
    const r = t + Math.floor(rng() * (a.length - t));
    const tmp = a[t];
    a[t] = a[r];
    a[r] = tmp;
  }
  return a.slice(0, n);
}

/** Uniform integer in [lo, hi] (bounds may come in either order). */
function between(lo: number, hi: number, u: number): number {
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  return a + Math.min(b - a, Math.floor(u * (b - a + 1)));
}

export class World {
  readonly p: WorldParams;
  readonly regionLevel: Level;
  readonly biomeLevel: Level;
  readonly subLevel: Level;
  /** cumulative normalised growth weights */
  private readonly growCdf: number[];

  private regions = new Map<number, Region>();
  private biomes = new Map<number, Biome>();
  private subs = new Map<number, Sub>();
  private subCells = new Map<number, Cell>();
  private biomeCells = new Map<number, Cell>();
  /** base ocean flags per biome key, OR-merged by region sourcing */
  private base = new Map<number, number>();
  private sourced = new Set<number>();
  /** regions whose whole sourcing neighbourhood is done */
  private settled = new Set<number>();

  constructor(p: WorldParams) {
    this.p = p;
    const s = p.seed | 0;
    this.regionLevel = new Level({ seed: (s ^ 0x1b873593) | 0, size: p.regionSize, jitter: p.regionJitter, warp: 0, warpFreq: 1 });
    this.biomeLevel = new Level({ seed: (s ^ 0x7f4a7c15) | 0, size: p.biomeSize, jitter: p.biomeJitter, warp: p.biomeWarp, warpFreq: p.biomeWarpFreq });
    this.subLevel = new Level({ seed: (s ^ 0x6c8e9cf5) | 0, size: p.subSize, jitter: p.subJitter, warp: p.subWarp, warpFreq: p.subWarpFreq });
    const w = p.growWeights.map((x) => Math.max(0, x));
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    this.growCdf = w.map((x) => (acc += x / sum));
  }

  /** Number of memoised objects (for the cache budget). */
  get cacheSize(): number {
    return this.regions.size + this.biomes.size + this.subs.size + this.subCells.size + this.biomeCells.size;
  }

  get cacheStats(): { regions: number; biomes: number; subs: number; cells: number } {
    return { regions: this.regions.size, biomes: this.biomes.size, subs: this.subs.size, cells: this.subCells.size + this.biomeCells.size };
  }

  /** Drop every cache when over budget. Results are pure, so this never changes the map. */
  trim(limit: number): boolean {
    if (this.cacheSize <= limit) return false;
    this.regions.clear();
    this.biomes.clear();
    this.subs.clear();
    this.subCells.clear();
    this.biomeCells.clear();
    this.base.clear();
    this.sourced.clear();
    this.settled.clear();
    return true;
  }

  // ------------------------------------------------------------------ regions

  region(key: number): Region {
    let r = this.regions.get(key);
    if (r) return r;
    const i = keyI(key);
    const j = keyJ(key);
    const L = this.regionLevel;
    // owned biomes: candidates from the biome lattice cells covering the region's
    // lattice neighbourhood, kept when the region under their site is this one
    const B = this.biomeLevel.size;
    const R = L.size;
    const bi0 = Math.floor(((i - 1) * R) / B);
    const bi1 = Math.floor(((i + 2) * R) / B);
    const bj0 = Math.floor(((j - 1) * R) / B);
    const bj1 = Math.floor(((j + 2) * R) / B);
    const biomes: number[] = [];
    for (let bj = bj0; bj <= bj1; bj++) {
      for (let bi = bi0; bi <= bi1; bi++) {
        const b = this.biome(packKey(bi, bj));
        if (b.region === key) biomes.push(b.key);
      }
    }
    const p = this.p;
    const rng = sfc32(hash4(p.seed, ST_SEEDS, i, j));
    const nSeeds = between(p.oceanMin, p.oceanMax, rng());
    const seeds = pick(biomes, nSeeds, rng);
    const rngM = sfc32(hash4(p.seed, ST_MERGE, i, j));
    const nMerge = between(p.biomeMergeMin, p.biomeMergeMax, rngM());
    const merges = new Set(pick(biomes, nMerge, rngM));
    r = { key, i, j, x: L.siteX(i, j), y: L.siteY(i, j), biomes, seeds, merges, links: null };
    this.regions.set(key, r);
    return r;
  }

  regionAt(x: number, y: number): number {
    return this.regionLevel.query(x, y);
  }

  /**
   * Register this region's ocean sources: its seeds, and for every seed that links,
   * the chain of biomes to its nearest other seed (or two nearest, see linkCount).
   */
  private source(rkey: number): void {
    if (this.sourced.has(rkey)) return;
    const r = this.region(rkey);
    const p = this.p;
    const links: Link[] = [];
    for (const s of r.seeds) {
      this.flag(s, SEED);
      const sb = this.biome(s);
      const n = this.linkCount(sb);
      if (n === 0) continue;
      // the n nearest other seeds within connectRange regions (by site distance, ties by key)
      const cands: { key: number; d: number }[] = [];
      const R = p.connectRange;
      for (let dj = -R; dj <= R; dj++) {
        for (let di = -R; di <= R; di++) {
          const o = this.region(packKey(r.i + di, r.j + dj));
          for (const t of o.seeds) {
            if (t === s) continue;
            const tb = this.biome(t);
            cands.push({ key: t, d: (tb.x - sb.x) * (tb.x - sb.x) + (tb.y - sb.y) * (tb.y - sb.y) });
          }
        }
      }
      cands.sort((a, b) => a.d - b.d || a.key - b.key);
      for (const { key: to } of cands.slice(0, n)) {
        const chain = this.trace(sb, this.biome(to));
        for (const c of chain) this.flag(c, LINKED);
        links.push({ from: s, to, chain });
      }
    }
    r.links = links;
    this.sourced.add(rkey);
  }

  /**
   * How many links a seed makes: 2 (its two nearest seeds) with `doubleLinkChance`,
   * otherwise 1 with `connectChance`, otherwise 0. The two draws use independent hash
   * streams, so a double-link chance of 0 leaves every single link unchanged.
   */
  linkCount(sb: Biome): number {
    const p = this.p;
    if (toUnit(hash4(p.seed, ST_DLINK, sb.i, sb.j)) < p.doubleLinkChance) return 2;
    return toUnit(hash4(p.seed, ST_LINK, sb.i, sb.j)) < p.connectChance ? 1 : 0;
  }

  private flag(bkey: number, f: number): void {
    this.base.set(bkey, (this.base.get(bkey) ?? 0) | f);
  }

  /** Biomes crossed by the straight segment between two biome sites (both ends included). */
  trace(a: Biome, b: Biome): number[] {
    const out: number[] = [a.key];
    const seen = new Set<number>(out);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / (this.biomeLevel.size * 0.12)));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const key = this.biomeLevel.query(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
    if (!seen.has(b.key)) out.push(b.key);
    return out;
  }

  /** Radius (in region lattice cells) of the regions whose sources can reach a biome. */
  get sourceRadius(): number {
    return this.p.connectRange + 5;
  }

  /** Base ocean flags of a raw biome (seed / linked), complete. */
  baseFlags(bkey: number): number {
    const b = this.biome(bkey);
    if (!this.settled.has(b.region)) {
      const ri = keyI(b.region);
      const rj = keyJ(b.region);
      const R = this.sourceRadius;
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) this.source(packKey(ri + di, rj + dj));
      this.settled.add(b.region);
    }
    return this.base.get(bkey) ?? 0;
  }

  // ------------------------------------------------------------------ biomes

  biome(key: number): Biome {
    let b = this.biomes.get(key);
    if (b) return b;
    const i = keyI(key);
    const j = keyJ(key);
    const L = this.biomeLevel;
    const x = L.siteX(i, j);
    const y = L.siteY(i, j);
    b = {
      key,
      i,
      j,
      x,
      y,
      region: this.regionLevel.query(x, y),
      nbrs: null,
      oceanP: new Int8Array(this.p.growPasses + 1).fill(-1),
      picks: new Array(this.p.growPasses + 1).fill(null),
      target: NaN,
      root: NaN,
      subs: null,
      subMerges: null,
    };
    this.biomes.set(key, b);
    return b;
  }

  biomeNbrs(b: Biome): number[] {
    if (!b.nbrs) b.nbrs = this.biomeLevel.neighbours(b.i, b.j).map((n) => n.key);
    return b.nbrs;
  }

  /** Is the raw biome ocean after growth pass p (0 = seeds and chains only)? */
  oceanAt(key: number, p: number): boolean {
    const b = this.biome(key);
    const memo = b.oceanP[p];
    if (memo >= 0) return memo === 1;
    let v: boolean;
    if (p === 0) v = this.baseFlags(key) !== 0;
    else if (this.oceanAt(key, p - 1)) v = true;
    else {
      v = false;
      for (const g of this.biomeNbrs(b)) {
        if (this.isGrower(g, p) && this.growPicks(g, p).includes(key)) {
          v = true;
          break;
        }
      }
    }
    b.oceanP[p] = v ? 1 : 0;
    return v;
  }

  /** Growth edges out of biome g: the biomes it converted, per pass. */
  growthFrom(g: number): { p: number; to: number }[] {
    const out: { p: number; to: number }[] = [];
    for (let p = 1; p <= this.p.growPasses; p++) if (this.isGrower(g, p)) for (const to of this.growPicks(g, p)) out.push({ p, to });
    return out;
  }

  /** Does biome g grow in pass p? */
  isGrower(g: number, p: number): boolean {
    if (p === 1) {
      const f = this.baseFlags(g);
      return this.p.growFrom === 'all' ? f !== 0 : (f & LINKED) !== 0;
    }
    return this.oceanAt(g, p - 1) && !this.oceanAt(g, p - 2);
  }

  /** The land neighbours grower g converts in pass p (its n closest). */
  growPicks(g: number, p: number): number[] {
    const b = this.biome(g);
    const memo = b.picks[p];
    if (memo) return memo;
    const u = toUnit(hash4(this.p.seed, ST_GROW + p, b.i, b.j));
    let n = 0;
    while (n < 3 && u >= this.growCdf[n]) n++;
    const out: number[] = [];
    if (n > 0) {
      for (const c of this.biomeNbrs(b)) {
        if (out.length >= n) break;
        if (!this.oceanAt(c, p - 1)) out.push(c);
      }
    }
    b.picks[p] = out;
    return out;
  }

  ocean(key: number): boolean {
    return this.oceanAt(key, this.p.growPasses);
  }

  /** Ocean genesis of a raw biome (ORIGIN code). */
  origin(key: number): number {
    if (!this.ocean(key)) return ORIGIN.land;
    const f = this.baseFlags(key);
    if (f & SEED) return f & LINKED ? ORIGIN.linkedSeed : ORIGIN.loneSeed;
    if (f & LINKED) return ORIGIN.chain;
    for (let p = 1; p <= this.p.growPasses; p++) if (this.oceanAt(key, p)) return ORIGIN.grow + p - 1;
    return ORIGIN.land;
  }

  /** The biome a merged biome joins, or −1. */
  biomeTarget(key: number): number {
    const b = this.biome(key);
    if (!Number.isNaN(b.target)) return b.target;
    let t = -1;
    if (this.region(b.region).merges.has(key)) {
      const oc = this.ocean(key);
      for (const c of this.biomeNbrs(b)) {
        if (this.p.mergeAcrossCoast || this.ocean(c) === oc) {
          t = c;
          break;
        }
      }
    }
    b.target = t;
    return t;
  }

  biomeRoot(key: number): number {
    const b = this.biome(key);
    if (Number.isNaN(b.root)) b.root = resolveRoot(key, (k) => this.biomeTarget(k));
    return b.root;
  }

  /** Is the biome part of a merged group (merged into another, or something merged into it)? */
  biomeMerged(key: number): boolean {
    const root = this.biomeRoot(key);
    if (root !== key) return true;
    for (const n of this.biomeNbrs(this.biome(key))) if (this.biomeRoot(n) === key) return true;
    return false;
  }

  /** Subbiomes owned by a raw biome (sites inside it), lattice order. */
  biomeSubs(b: Biome): number[] {
    if (b.subs) return b.subs;
    const B = this.biomeLevel.size;
    const S = this.subLevel.size;
    const m = Math.ceil(this.biomeLevel.warp) + 1;
    const si0 = Math.floor(((b.i - m) * B) / S);
    const si1 = Math.floor(((b.i + 1 + m) * B) / S);
    const sj0 = Math.floor(((b.j - m) * B) / S);
    const sj1 = Math.floor(((b.j + 1 + m) * B) / S);
    const out: number[] = [];
    for (let sj = sj0; sj <= sj1; sj++) {
      for (let si = si0; si <= si1; si++) {
        const s = this.sub(packKey(si, sj));
        if (s.biome === b.key) out.push(s.key);
      }
    }
    b.subs = out;
    return out;
  }

  private subMergeSet(bkey: number): Set<number> {
    const b = this.biome(bkey);
    if (!b.subMerges) {
      const rng = sfc32(hash4(this.p.seed, ST_SUBMERGE, b.i, b.j));
      const n = between(this.p.subMergeMin, this.p.subMergeMax, rng());
      b.subMerges = new Set(pick(this.biomeSubs(b), n, rng));
    }
    return b.subMerges;
  }

  // ------------------------------------------------------------------ subbiomes

  sub(key: number): Sub {
    let s = this.subs.get(key);
    if (s) return s;
    const i = keyI(key);
    const j = keyJ(key);
    const L = this.subLevel;
    const x = L.siteX(i, j);
    const y = L.siteY(i, j);
    s = { key, i, j, x, y, biome: this.biomeLevel.query(x, y), nbrs: null, target: NaN, root: NaN };
    this.subs.set(key, s);
    return s;
  }

  subNbrs(s: Sub): number[] {
    if (!s.nbrs) s.nbrs = this.subLevel.neighbours(s.i, s.j).map((n) => n.key);
    return s.nbrs;
  }

  subTarget(key: number): number {
    const s = this.sub(key);
    if (!Number.isNaN(s.target)) return s.target;
    let t = -1;
    if (this.subMergeSet(s.biome).has(key)) {
      const home = this.biomeRoot(s.biome);
      for (const c of this.subNbrs(s)) {
        if (this.biomeRoot(this.sub(c).biome) === home) {
          t = c;
          break;
        }
      }
    }
    s.target = t;
    return t;
  }

  subRoot(key: number): number {
    const s = this.sub(key);
    if (Number.isNaN(s.root)) s.root = resolveRoot(key, (k) => this.subTarget(k));
    return s.root;
  }

  subMerged(key: number): boolean {
    const root = this.subRoot(key);
    if (root !== key) return true;
    for (const n of this.subNbrs(this.sub(key))) if (this.subRoot(n) === key) return true;
    return false;
  }

  // ------------------------------------------------------------------ resolution

  /** Cell info for a raw biome (biome-level detail). */
  biomeCell(bkey: number): Cell {
    let c = this.biomeCells.get(bkey);
    if (c) return c;
    const root = this.biomeRoot(bkey);
    const ocean = this.ocean(root);
    // genesis of the raw cell, so merged groups still show why each part is ocean
    const rawOrigin = this.origin(bkey);
    c = {
      subRaw: -1,
      sub: -1,
      biomeRaw: bkey,
      biome: root,
      region: this.biome(root).region,
      ocean,
      origin: !ocean ? ORIGIN.land : rawOrigin !== ORIGIN.land ? rawOrigin : this.origin(root),
      subMerged: false,
      biomeMerged: this.biomeMerged(root),
    };
    this.biomeCells.set(bkey, c);
    return c;
  }

  /** Cell info for a raw subbiome, nested: everything follows the merged subbiome's site. */
  subCell(skey: number): Cell {
    let c = this.subCells.get(skey);
    if (c) return c;
    const sr = this.subRoot(skey);
    const bc = this.biomeCell(this.sub(sr).biome);
    c = { ...bc, subRaw: skey, sub: sr, subMerged: this.subMerged(sr) };
    this.subCells.set(skey, c);
    return c;
  }

  /**
   * Classify a world point. `detail` = false skips the subbiome level (used when
   * subbiomes are smaller than a pixel). Without nesting each level is looked up
   * at the point itself.
   */
  cellAt(x: number, y: number, detail: boolean, out?: Cell): Cell {
    if (this.p.nest) {
      if (detail) return this.subCell(this.subLevel.query(x, y));
      return this.biomeCell(this.biomeLevel.query(x, y));
    }
    const bc = this.biomeCell(this.biomeLevel.query(x, y));
    const o = out ?? ({} as Cell);
    Object.assign(o, bc);
    o.region = this.regionLevel.query(x, y);
    if (detail) {
      const s = this.subLevel.query(x, y);
      o.subRaw = s;
      o.sub = this.subRoot(s);
      o.subMerged = this.subMerged(o.sub);
    }
    return o;
  }

  // ------------------------------------------------------------------ enumeration (overlays, stats)

  /** Keys of a level's lattice cells whose site may lie in the rectangle (+ margin cells). */
  static cellsIn(level: Level, x0: number, y0: number, x1: number, y1: number, margin = 1): number[] {
    const s = level.size;
    const out: number[] = [];
    const i0 = Math.floor(x0 / s) - margin;
    const i1 = Math.floor(x1 / s) + margin;
    const j0 = Math.floor(y0 / s) - margin;
    const j1 = Math.floor(y1 / s) + margin;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out.push(packKey(i, j));
    return out;
  }

  /** Count of lattice cells a rectangle would enumerate at a level (to cap overlay work). */
  static countIn(level: Level, x0: number, y0: number, x1: number, y1: number, margin = 1): number {
    const s = level.size;
    return (Math.floor(x1 / s) - Math.floor(x0 / s) + 1 + 2 * margin) * (Math.floor(y1 / s) - Math.floor(y0 / s) + 1 + 2 * margin);
  }

  /** Links of a region (sources it on demand). */
  links(rkey: number): Link[] {
    this.source(rkey);
    return this.region(rkey).links!;
  }

  /**
   * Determinism fingerprint: FNV-1a over a fixed sample grid around the origin
   * (nested cell ids and ocean flags). Independent of the camera and of caching.
   */
  fingerprint(n = 64, half = 3 * 128000): string {
    let h = 0x811c9dc5;
    const mix = (v: number) => {
      // keys are < 2^44: hash the low and high 22-bit halves
      const lo = v % 4194304;
      const hi = Math.floor(v / 4194304);
      h = Math.imul(h ^ lo, 16777619);
      h = Math.imul(h ^ hi, 16777619);
    };
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const wx = -half + ((x + 0.5) / n) * 2 * half;
        const wy = -half + ((y + 0.5) / n) * 2 * half;
        const c = this.cellAt(wx, wy, true);
        mix(c.sub + 1);
        mix(c.biome + 1);
        mix(c.region + 1);
        mix(c.ocean ? 1 : 2);
      }
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}

/** Follow merge targets to the root; a cycle resolves to its smallest key. */
export function resolveRoot(key: number, target: (k: number) => number): number {
  const path: number[] = [key];
  let cur = key;
  for (let step = 0; step < 64; step++) {
    const t = target(cur);
    if (t < 0) return cur;
    const at = path.indexOf(t);
    if (at >= 0) {
      let m = t;
      for (let q = at; q < path.length; q++) if (path[q] < m) m = path[q];
      return m;
    }
    path.push(t);
    cur = t;
  }
  return cur;
}
