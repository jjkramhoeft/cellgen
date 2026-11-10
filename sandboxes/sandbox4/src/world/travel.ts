/**
 * Travel network between the city and town locations that are on show: roads over land,
 * river routes along navigable rivers and sea lanes across the ocean.
 *
 * Cost grid (TravelGrid, per region as drawn, 2 km cells aligned to the world):
 *   Land     cost of a kilometre of road relative to open flat land: elevation zone type
 *            (mountains are heavily penalised) × biome (deserts and ice heavily, swamp and
 *            rainforest too) × lakes (roads go round them).
 *   Height   an estimate that needs no terrain tile: the river beds rise upstream from the
 *            sea (the terrain's own stream-power rise), and the land rises from every river
 *            and the coast at the zone type's hillslope (the terrain's envelope, coarse and
 *            on the region's own land). Rivers are the valleys and region borders the
 *            ridges, as in the height map. A road pays for the slope of every step
 *            (1 + (slope / 5 %)²) and for the height itself.
 *   Water    ocean cells (dearer right at the shore, so lanes keep clear of capes) and the
 *            navigable rivers (NAVIGABLE subbiomes drained, as for the locations), stamped
 *            on the grid as links between the cells each river segment crosses.
 *
 * Network (Travel, per region; needs the locations and grids of the 3 × 3 regions around):
 *   Nodes    the locations on show (viability threshold; cities only when zoomed far out).
 *   Forests  two multi-source shortest-path forests over the 3 × 3 regions, one over land
 *            (roads, from every location) and one over water (from every location on a
 *            navigable river, and from the harbour of every coastal one). Each cell ends up
 *            with its cheapest location: a Voronoi diagram under travel cost.
 *   Links    two locations whose Voronoi cells touch are neighbours: the candidate link
 *            runs through the cheapest crossing of their common border, down both trees
 *            (so links out of one place share their first stretch, like real roads).
 *            These neighbour graphs contain the minimum spanning tree of all travel costs.
 *   Pruning  a link is dropped when cheaper links (through other locations, or the other
 *            kind of link between the same two) make a detour of at most DETOUR × its
 *            cost; a road only gives way to a route that uses water when that is far
 *            cheaper. Only ever the dearest link of a cycle goes, so whatever was
 *            connected stays connected.
 *   Owner    every pair of regions has one owner (the smaller key of two neighbours, the
 *            region in the middle of two that are two apart), which decides and holds the
 *            links between their locations. Nothing depends on the order regions are
 *            computed in.
 *   Routes   road: the cells of the path, smoothed locally (shared stretches stay shared).
 *            River: the river's own nodes. Sea: the path pulled straight wherever the line
 *            of sight is open water. The stretches several links share are drawn once.
 *
 * Deterministic: + − × ÷ √ only, heap ties broken by cell index, fixed visiting orders.
 */
import { MinHeap } from '@shared/core/heap';
import { BIOMES, type BiomeId, type Biomes } from './biomes';
import { inPolygon, type Lakes } from './lakes';
import { keyI, keyJ, packKey } from './level';
import { NAVIGABLE, viable, type Location, type Locations } from './locations';
import type { RegionRivers, Rivers } from './rivers';
import { invPowTheta, type Terrain } from './terrain';
import type { Cell, World } from './world';
import { ELEVATION_ZONE_TYPES, elevationZoneType } from './zones';

/** Cell size of the travel grid, metres. */
export const CELL = 2000;
const KM = 1000;

const ZONE_TABLE = (flat: number, lowland: number, hills: number, mountains: number) => ELEVATION_ZONE_TYPES.map((t) => ({ ocean: 1, flat, lowland, hills, mountains })[t.id]);
const BIOME_TABLE = (values: Record<BiomeId, number>) => BIOMES.map((b) => values[b.id]);
/** Cost of a road per km, relative to open flat land, by elevation zone type and by biome (design values). */
export const ZONE_COST = ZONE_TABLE(1, 1.15, 1.8, 4);
export const BIOME_COST = BIOME_TABLE({ ocean: 1, ice: 5, tundra: 1.6, coldSteppe: 1.1, taiga: 1.4, coldDesert: 3.5, grassland: 1, shrubland: 1.1, mixedForest: 1.3, broadleaf: 1.3, tempRainforest: 2, hotDesert: 4, thornScrub: 1.5, savanna: 1.05, dryForest: 1.3, rainforest: 2.2, mangrove: 3 });
/** A road across a lake costs this × (it goes round). */
const LAKE_COST = 8;
/** Slope at which a road costs twice as much, and the most the slope can add (× the flat cost). */
const SLOPE_REF = 0.05;
const SLOPE_MAX = 12;
/** Height (m) at which a road costs twice as much (snow, thin air, a short season). */
const ELEV_REF = 1500;
/** Crossing a navigable river (a bridge or ferry), km of open flat road. */
const BRIDGE = 3;
/** A km on the open sea, right at the shore, and on a navigable river, relative to a km of open flat road. */
const SEA = 0.3;
const SEA_SHORE = 0.6;
const RIVER = 0.4;
/** Loading and unloading at a sea harbour and at a river landing, km of open flat road (per end of a link). */
const PORT = 12;
const LANDING = 6;
/** A location is on a navigable river when one runs within this many cells of it. */
const RIVER_REACH = 1;
/** A link is dropped for a detour over cheaper links of at most this × its cost. */
export const DETOUR = 1.6;
/** A road is dropped for a cheaper route that uses water only when that costs at most this × the road. */
const DETOUR_WATER = 0.35;
/** Height of land no river or coast of its own region reaches (a walled-off pocket), metres. */
const POCKET_H = 150;

/** kinds of grid cell (0 = no cell of the region or view) */
const LAND = 1;
const SEA_CELL = 2;

/** The 8 neighbours (index = direction; the opposite of d is (d + 4) & 7), then the 8 knight moves. */
const DX = [1, 1, 0, -1, -1, -1, 0, 1, 2, 1, -1, -2, -2, -1, 1, 2];
const DY = [0, 1, 1, 1, 0, -1, -1, -1, 1, 2, 2, 1, -1, -2, -2, -1];
/** the two cells a knight move passes between */
const MAX = DX.map((dx, m) => (m < 8 ? 0 : Math.abs(dx) === 2 ? dx / 2 : 0));
const MAY = DY.map((dy, m) => (m < 8 ? 0 : Math.abs(dy) === 2 ? dy / 2 : 0));
const MBX = DX.map((dx, m) => (m < 8 ? 0 : Math.abs(dx) === 2 ? dx / 2 : dx));
const MBY = DY.map((dy, m) => (m < 8 ? 0 : Math.abs(dy) === 2 ? dy / 2 : dy));
const LEN = DX.map((dx, m) => Math.sqrt(dx * dx + DY[m] * DY[m]) * CELL);

function dirOf(dx: number, dy: number): number {
  for (let d = 0; d < 8; d++) if (DX[d] === dx && DY[d] === dy) return d;
  return -1;
}

// ------------------------------------------------------------------ cost grid

/** The travel grid of one region: its own cells (land and sea) and its navigable rivers. */
export interface RegionGrid {
  region: number;
  /** bounding box of the region's cells, in grid cells (cell (i, j) spans [i, i + 1) × CELL) */
  i0: number;
  j0: number;
  nx: number;
  ny: number;
  /** 0 = not this region's, 1 = land, 2 = sea */
  kind: Uint8Array;
  /** land: cost of a km of road relative to open flat land (zone type × biome × lake) */
  cost: Float32Array;
  /** land: estimated height, metres */
  h: Float32Array;
  /** navigable river links, 5 numbers each: cell (i, j) → the next cell downstream (i, j), and the river node whose segment to its parent crosses between them */
  links: Int32Array;
  land: number;
  sea: number;
  ms: number;
}

export class TravelGrid {
  private cache = new Map<number, RegionGrid>();

  /** `biomes` must be terrain-less (zone-typical heights), like the locations' one; `terrain` is only read for its parameters. */
  constructor(
    readonly world: World,
    readonly rivers: Rivers,
    readonly lakes: Lakes,
    readonly biomes: Biomes,
    readonly terrain: Terrain,
  ) {}

  get size(): number {
    return this.cache.size;
  }

  has(rkey: number): boolean {
    return this.cache.has(rkey);
  }

  get(rkey: number): RegionGrid {
    let g = this.cache.get(rkey);
    if (!g) {
      if (this.cache.size > 600) this.cache.clear();
      g = this.compute(rkey);
      this.cache.set(rkey, g);
    }
    return g;
  }

  /** Bed height (m) of every node of a region's rivers: the terrain's rise from the sea, without its levelling and caps. */
  bed(rr: RegionRivers): Float64Array {
    const w = this.world;
    const t = this.terrain;
    const P = t.p;
    const z = new Float64Array(rr.n);
    for (let k = 0; k < rr.n; k++) {
      const p = rr.parent[k];
      if (p < 0 || rr.wet[k]) continue;
      const x = rr.x[k];
      const y = rr.y[k];
      const c = w.cellAt(x, y, true);
      const type = elevationZoneType(c.elevationZone, c.ocean);
      const rf = t.reliefAt(x, y);
      const dx = Math.sqrt((x - rr.x[p]) * (x - rr.x[p]) + (y - rr.y[p]) * (y - rr.y[p]));
      const ch = P.chSlope * t.chanOf(type) * rf * invPowTheta(Math.max(1, rr.flow[k]), P.theta);
      const hs = t.hillOf(type) * P.hill * rf;
      z[k] = z[p] + dx * Math.min(ch, hs);
    }
    return z;
  }

  private compute(rkey: number): RegionGrid {
    const t0 = performance.now();
    const w = this.world;
    const G = CELL;
    const S = w.subLevel.size;

    // ---- bounding box: the sites of the region's subbiomes plus their reach
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    if (w.p.nest) {
      for (const b of this.rivers.regionElevationZones(rkey)) {
        for (const s of w.elevationZoneSubs(w.elevationZone(b))) {
          const sd = w.sub(s);
          if (sd.x < bx0) bx0 = sd.x;
          if (sd.x > bx1) bx1 = sd.x;
          if (sd.y < by0) by0 = sd.y;
          if (sd.y > by1) by1 = sd.y;
        }
      }
      const m = 1.5 * S + w.subLevel.warpReach + G;
      bx0 -= m;
      by0 -= m;
      bx1 += m;
      by1 += m;
    } else {
      // without nesting a region is its own Voronoi cell: at most a lattice cell beyond its own
      const R = w.regionLevel.size;
      bx0 = (keyI(rkey) - 1) * R;
      by0 = (keyJ(rkey) - 1) * R;
      bx1 = (keyI(rkey) + 2) * R;
      by1 = (keyJ(rkey) + 2) * R;
    }
    const empty = (): RegionGrid => ({ region: rkey, i0: 0, j0: 0, nx: 0, ny: 0, kind: new Uint8Array(0), cost: new Float32Array(0), h: new Float32Array(0), links: new Int32Array(0), land: 0, sea: 0, ms: performance.now() - t0 });
    if (!(bx1 >= bx0)) return empty();

    // ---- classify every cell of the box (at its centre)
    const bi0 = Math.floor(bx0 / G);
    const bj0 = Math.floor(by0 / G);
    const bnx = Math.floor(bx1 / G) - bi0 + 1;
    const bny = Math.floor(by1 / G) - bj0 + 1;
    const BN = bnx * bny;
    const bKind = new Uint8Array(BN);
    /** any region's ocean */
    const bOcean = new Uint8Array(BN);
    const bCost = new Float32Array(BN);
    const bSteep = new Float32Array(BN);
    const ter = this.terrain;
    const scratch = {} as Cell;
    let ci0 = bnx;
    let ci1 = -1;
    let cj0 = bny;
    let cj1 = -1;
    let land = 0;
    let sea = 0;
    for (let j = 0; j < bny; j++) {
      const y = (bj0 + j + 0.5) * G;
      for (let i = 0; i < bnx; i++) {
        const x = (bi0 + i + 0.5) * G;
        const c = w.cellAt(x, y, true, scratch);
        const q = j * bnx + i;
        if (c.ocean) bOcean[q] = 1;
        if (c.region !== rkey) continue;
        if (i < ci0) ci0 = i;
        if (i > ci1) ci1 = i;
        if (j < cj0) cj0 = j;
        if (j > cj1) cj1 = j;
        if (c.ocean) {
          bKind[q] = SEA_CELL;
          sea++;
          continue;
        }
        bKind[q] = LAND;
        land++;
        const type = elevationZoneType(c.elevationZone, false);
        bCost[q] = ZONE_COST[type] * BIOME_COST[this.biomes.ofSub(c.sub).biome];
        bSteep[q] = ter.hillOf(type) * ter.p.hill * ter.reliefAt(x, y);
      }
    }
    if (ci1 < 0) return empty();

    // ---- heights: seeded by the river beds and the coast, spread at the hillslope over the region's own land
    const rr = this.rivers.get(rkey);
    const bH = new Float64Array(BN).fill(Infinity);
    const heap = new MinHeap(1024);
    if (land > 0) {
      const z = this.bed(rr);
      for (let k = 0; k < rr.n; k++) {
        if (rr.parent[k] < 0 || rr.wet[k]) continue;
        const i = Math.floor(rr.x[k] / G) - bi0;
        const j = Math.floor(rr.y[k] / G) - bj0;
        if (i < 0 || j < 0 || i >= bnx || j >= bny) continue;
        const q = j * bnx + i;
        if (bKind[q] === LAND && z[k] < bH[q]) bH[q] = z[k];
      }
      for (let j = 0; j < bny; j++) {
        for (let i = 0; i < bnx; i++) {
          const q = j * bnx + i;
          if (bKind[q] !== LAND) continue;
          let coast = false;
          for (let d = 0; d < 8 && !coast; d++) {
            const ii = i + DX[d];
            const jj = j + DY[d];
            if (ii >= 0 && jj >= 0 && ii < bnx && jj < bny && bOcean[jj * bnx + ii]) coast = true;
          }
          if (coast) {
            const v = bSteep[q] * G * 0.5;
            if (v < bH[q]) bH[q] = v;
          }
        }
      }
      for (let q = 0; q < BN; q++) if (bH[q] < Infinity) heap.push(bH[q], q);
      while (heap.size) {
        const d = heap.peekKey();
        const u = heap.pop();
        if (d > bH[u]) continue;
        const ui = u % bnx;
        const uj = (u - ui) / bnx;
        for (let m = 0; m < 8; m++) {
          const vi = ui + DX[m];
          const vj = uj + DY[m];
          if (vi < 0 || vj < 0 || vi >= bnx || vj >= bny) continue;
          const v = vj * bnx + vi;
          if (bKind[v] !== LAND) continue;
          const nd = d + 0.5 * (bSteep[u] + bSteep[v]) * LEN[m];
          if (nd < bH[v]) {
            bH[v] = nd;
            heap.push(nd, v);
          }
        }
      }
    }

    // ---- lakes: roads go round
    for (const l of this.lakes.get(rkey).lakes) {
      const li0 = Math.max(0, Math.floor(l.x0 / G) - bi0);
      const li1 = Math.min(bnx - 1, Math.floor(l.x1 / G) - bi0);
      const lj0 = Math.max(0, Math.floor(l.y0 / G) - bj0);
      const lj1 = Math.min(bny - 1, Math.floor(l.y1 / G) - bj0);
      for (let j = lj0; j <= lj1; j++) {
        for (let i = li0; i <= li1; i++) {
          const q = j * bnx + i;
          if (bKind[q] === LAND && inPolygon(l.x, l.y, (bi0 + i + 0.5) * G, (bj0 + j + 0.5) * G)) bCost[q] *= LAKE_COST;
        }
      }
    }

    // ---- navigable rivers: a link wherever a segment passes from one cell into the next (downstream)
    const navFlow = NAVIGABLE * Math.max(1, this.rivers.p.perSub);
    const links: number[] = [];
    const seen = new Set<number>();
    for (let k = 0; k < rr.n; k++) {
      const p = rr.parent[k];
      if (p < 0 || rr.flow[k] < navFlow) continue;
      const ax = rr.x[k];
      const ay = rr.y[k];
      const dx = rr.x[p] - ax;
      const dy = rr.y[p] - ay;
      // steps of at most a quarter cell: consecutive samples lie in the same cell or in two that touch
      const n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / (G / 4)));
      let pi = Math.floor(ax / G);
      let pj = Math.floor(ay / G);
      for (let s = 1; s <= n; s++) {
        const ci = Math.floor((ax + (dx * s) / n) / G);
        const cj = Math.floor((ay + (dy * s) / n) / G);
        if (ci === pi && cj === pj) continue;
        const d = dirOf(ci - pi, cj - pj);
        if (d >= 0) {
          const key = packKey(pi, pj) * 8 + d;
          if (!seen.has(key)) {
            seen.add(key);
            links.push(pi, pj, ci, cj, k);
          }
        }
        pi = ci;
        pj = cj;
      }
    }

    // ---- crop to the region's own cells
    const nx = ci1 - ci0 + 1;
    const ny = cj1 - cj0 + 1;
    const kind = new Uint8Array(nx * ny);
    const cost = new Float32Array(nx * ny);
    const h = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const q = (j + cj0) * bnx + i + ci0;
        const o = j * nx + i;
        kind[o] = bKind[q];
        if (bKind[q] !== LAND) continue;
        cost[o] = bCost[q];
        h[o] = bH[q] < Infinity ? bH[q] : POCKET_H;
      }
    }
    return { region: rkey, i0: bi0 + ci0, j0: bj0 + cj0, nx, ny, kind, cost, h, links: Int32Array.from(links), land, sea, ms: performance.now() - t0 };
  }
}

// ------------------------------------------------------------------ network

export interface TravelParams {
  /** only locations with at least this viability score are connected (the Display threshold) */
  minScore: number;
  /** connect the cities only (zoomed far out, where the towns are not drawn) */
  citiesOnly: boolean;
}

export const TRAVEL_MODES = ['road', 'river', 'sea'] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];

/** One stretch of a link's route, of a single kind. */
export interface TravelPart {
  mode: TravelMode;
  /** the route, x and y in turn, metres */
  pts: Float64Array;
  /** the stretches to draw (first and last point index of each): what no link drawn earlier in the region already covers */
  runs: Int32Array;
}

/** A link of the network between two locations. */
export interface TravelEdge {
  a: Location;
  b: Location;
  /** the kind of the link: road, or the larger part of a water route (river / sea) */
  mode: TravelMode;
  /** travel cost, km of open flat road */
  cost: number;
  /** length of the route, metres */
  length: number;
  /** between two cities */
  major: boolean;
  /** the route from a to b */
  parts: TravelPart[];
  /** bounding box of the route */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RegionTravel {
  region: number;
  /** the links this region owns */
  edges: TravelEdge[];
  /** locations on show in the 3 × 3 regions around, candidate links found among them, and how many of the owned ones were pruned */
  nodes: number;
  candidates: number;
  pruned: number;
  ms: number;
}

/** The region that decides the links between the locations of two regions (−1: too far apart for a link). */
export function ownerOf(ra: number, rb: number): number {
  const ia = keyI(ra);
  const ja = keyJ(ra);
  const ib = keyI(rb);
  const jb = keyJ(rb);
  const ch = Math.max(Math.abs(ia - ib), Math.abs(ja - jb));
  if (ch <= 1) return Math.min(ra, rb);
  if (ch === 2) return packKey(Math.floor((ia + ib) / 2), Math.floor((ja + jb) / 2));
  return -1;
}

interface Cand {
  /** node indices, a < b */
  a: number;
  b: number;
  cost: number;
  /** the crossing: cell u in a's tree, cell v in b's */
  u: number;
  v: number;
  water: boolean;
}

/** Scratch arrays of one computation, reused between regions. */
class Scratch {
  n = 0;
  kind = new Uint8Array(0);
  cost = new Float32Array(0);
  h = new Float32Array(0);
  rmask = new Uint8Array(0);
  dist = [new Float64Array(0), new Float64Array(0)];
  src = [new Int32Array(0), new Int32Array(0)];
  prev = [new Int32Array(0), new Int32Array(0)];

  ensure(n: number): void {
    if (n > this.kind.length) {
      const m = Math.ceil(n * 1.25);
      this.kind = new Uint8Array(m);
      this.cost = new Float32Array(m);
      this.h = new Float32Array(m);
      this.rmask = new Uint8Array(m);
      this.dist = [new Float64Array(m), new Float64Array(m)];
      this.src = [new Int32Array(m), new Int32Array(m)];
      this.prev = [new Int32Array(m), new Int32Array(m)];
    }
    this.n = n;
    this.kind.fill(0, 0, n);
    this.rmask.fill(0, 0, n);
    for (const d of this.dist) d.fill(Infinity, 0, n);
    for (const s of this.src) s.fill(-1, 0, n);
    for (const p of this.prev) p.fill(-1, 0, n);
  }
}

export class Travel {
  readonly p: TravelParams;
  private cache = new Map<number, RegionTravel>();
  private scratch = new Scratch();
  private heap = new MinHeap(4096);

  constructor(
    readonly grid: TravelGrid,
    readonly locations: Locations,
    p: TravelParams,
  ) {
    this.p = { minScore: p.minScore, citiesOnly: p.citiesOnly };
  }

  get world(): World {
    return this.grid.world;
  }

  get size(): number {
    return this.cache.size;
  }

  has(rkey: number): boolean {
    return this.cache.has(rkey);
  }

  peek(rkey: number): RegionTravel | undefined {
    return this.cache.get(rkey);
  }

  get(rkey: number): RegionTravel {
    let r = this.cache.get(rkey);
    if (!r) {
      if (this.cache.size > 1500) this.cache.clear();
      r = this.compute(rkey);
      this.cache.set(rkey, r);
    }
    return r;
  }

  /** The 3 × 3 regions around a region, lattice order. */
  around(rkey: number): number[] {
    const i = keyI(rkey);
    const j = keyJ(rkey);
    const out: number[] = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) out.push(packKey(i + di, j + dj));
    return out;
  }

  /**
   * Compute what a region's network needs (the locations and grids of the 3 × 3 regions
   * around it), one region at a time until `deadline`. True when everything is there.
   */
  prepare(rkey: number, deadline: number): boolean {
    for (const q of this.around(rkey)) {
      if (this.locations.has(q)) continue;
      if (performance.now() > deadline) return false;
      this.locations.get(q);
    }
    for (const q of this.around(rkey)) {
      if (this.grid.has(q)) continue;
      if (performance.now() > deadline) return false;
      this.grid.get(q);
    }
    return true;
  }

  /** The locations of a region that the network connects. */
  shown(rkey: number): Location[] {
    const list = viable(this.locations.get(rkey).list, this.p.minScore);
    return this.p.citiesOnly ? list.filter((l) => l.kind === 'city') : list;
  }

  private compute(rkey: number): RegionTravel {
    const t0 = performance.now();
    const G = CELL;
    const regs = this.around(rkey);
    const grids = regs.map((q) => this.grid.get(q));

    // ---- nodes: the locations on show, region by region
    const nodes: Location[] = [];
    for (const q of regs) for (const l of this.shown(q)) nodes.push(l);
    const M = nodes.length;
    const done = (edges: TravelEdge[], candidates: number, pruned: number): RegionTravel => ({ region: rkey, edges, nodes: M, candidates, pruned, ms: performance.now() - t0 });
    if (M < 2) return done([], 0, 0);

    // ---- the view: the cells of the nine regions on one raster
    let I0 = Infinity;
    let J0 = Infinity;
    let I1 = -Infinity;
    let J1 = -Infinity;
    for (const g of grids) {
      if (!g.nx) continue;
      I0 = Math.min(I0, g.i0);
      J0 = Math.min(J0, g.j0);
      I1 = Math.max(I1, g.i0 + g.nx - 1);
      J1 = Math.max(J1, g.j0 + g.ny - 1);
    }
    if (!(I1 >= I0)) return done([], 0, 0);
    const NX = I1 - I0 + 1;
    const NY = J1 - J0 + 1;
    const N = NX * NY;
    const sc = this.scratch;
    sc.ensure(N);
    const { kind, cost, h, rmask } = sc;
    for (const g of grids) {
      for (let j = 0; j < g.ny; j++) {
        const row = (g.j0 + j - J0) * NX + g.i0 - I0;
        for (let i = 0; i < g.nx; i++) {
          const k = g.kind[j * g.nx + i];
          if (!k) continue;
          const Q = row + i;
          kind[Q] = k;
          if (k === LAND) {
            h[Q] = g.h[j * g.nx + i];
            cost[Q] = g.cost[j * g.nx + i] * (1 + h[Q] / ELEV_REF);
          }
        }
      }
    }
    // the sea is dearer right at the shore
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const Q = j * NX + i;
        if (kind[Q] !== SEA_CELL) continue;
        let shore = false;
        for (let d = 0; d < 8 && !shore; d++) {
          const ii = i + DX[d];
          const jj = j + DY[d];
          if (ii >= 0 && jj >= 0 && ii < NX && jj < NY && kind[jj * NX + ii] === LAND) shore = true;
        }
        cost[Q] = shore ? SEA_SHORE : SEA;
      }
    }
    // navigable rivers (over open sea a boat needs no river): link → grid and river node, for the route
    const linkInfo = new Map<number, number>();
    grids.forEach((g, gi) => {
      for (let e = 0; e < g.links.length; e += 5) {
        const i = g.links[e] - I0;
        const j = g.links[e + 1] - J0;
        const i2 = g.links[e + 2] - I0;
        const j2 = g.links[e + 3] - J0;
        if (i < 0 || j < 0 || i >= NX || j >= NY || i2 < 0 || j2 < 0 || i2 >= NX || j2 >= NY) continue;
        const Q = j * NX + i;
        const Q2 = j2 * NX + i2;
        if (!kind[Q] || !kind[Q2] || (kind[Q] === SEA_CELL && kind[Q2] === SEA_CELL)) continue;
        const d = dirOf(i2 - i, j2 - j);
        if (rmask[Q] & (1 << d)) continue;
        rmask[Q] |= 1 << d;
        rmask[Q2] |= 1 << ((d + 4) & 7);
        linkInfo.set(Q * 8 + d, gi * 0x100000 + g.links[e + 4]);
      }
    });

    // ---- seeds
    const heap = this.heap;
    const [distL, distW] = sc.dist;
    const [srcL, srcW] = sc.src;
    const [prevL, prevW] = sc.prev;
    const cx = (Q: number) => (I0 + (Q % NX) + 0.5) * G;
    const cy = (Q: number) => (J0 + Math.floor(Q / NX) + 0.5) * G;
    /** the nearest cell to a point within `reach` cells of its own that passes `ok` (−1: none) */
    const nearest = (x: number, y: number, reach: number, ok: (Q: number) => boolean): number => {
      const i = Math.floor(x / G) - I0;
      const j = Math.floor(y / G) - J0;
      let best = -1;
      let bd = Infinity;
      for (let jj = Math.max(0, j - reach); jj <= Math.min(NY - 1, j + reach); jj++) {
        for (let ii = Math.max(0, i - reach); ii <= Math.min(NX - 1, i + reach); ii++) {
          const Q = jj * NX + ii;
          if (!ok(Q)) continue;
          const d = (cx(Q) - x) * (cx(Q) - x) + (cy(Q) - y) * (cy(Q) - y);
          if (d < bd) {
            bd = d;
            best = Q;
          }
        }
      }
      return best;
    };
    const portReach = Math.ceil((1.5 * this.world.subLevel.size) / G);
    for (let n = 0; n < M; n++) {
      const l = nodes[n];
      const Q = nearest(l.x, l.y, 2, (q) => kind[q] === LAND && srcL[q] < 0);
      if (Q >= 0) {
        distL[Q] = 0;
        srcL[Q] = n;
      }
      const seedW = (q: number, d0: number) => {
        if (q < 0) return;
        const d = d0 + Math.sqrt((cx(q) - l.x) * (cx(q) - l.x) + (cy(q) - l.y) * (cy(q) - l.y)) / KM;
        if (d < distW[q]) {
          distW[q] = d;
          srcW[q] = n;
        }
      };
      seedW(
        nearest(l.x, l.y, RIVER_REACH, (q) => rmask[q] !== 0),
        LANDING,
      );
      if (l.coast)
        seedW(
          nearest(l.x, l.y, portReach, (q) => kind[q] === SEA_CELL),
          PORT,
        );
    }

    // ---- road forest: 16 directions, slope and river crossings
    /** cost of the road step u → u + move m (Infinity: not possible) */
    const stepL = (u: number, ui: number, uj: number, m: number): number => {
      const vi = ui + DX[m];
      const vj = uj + DY[m];
      if (vi < 0 || vj < 0 || vi >= NX || vj >= NY) return Infinity;
      const v = vj * NX + vi;
      if (kind[v] !== LAND) return Infinity;
      let c: number;
      let climb: number;
      if (m < 8) {
        c = 0.5 * (cost[u] + cost[v]);
        climb = Math.abs(h[v] - h[u]);
      } else {
        const a = (uj + MAY[m]) * NX + ui + MAX[m];
        const b = (uj + MBY[m]) * NX + ui + MBX[m];
        if (kind[a] !== LAND || kind[b] !== LAND) return Infinity;
        c = 0.25 * (cost[u] + cost[v] + cost[a] + cost[b]);
        const hm = 0.5 * (h[a] + h[b]);
        climb = Math.abs(hm - h[u]) + Math.abs(h[v] - hm);
      }
      const s = climb / LEN[m] / SLOPE_REF;
      let wgt = (LEN[m] / KM) * c * (1 + Math.min(SLOPE_MAX, s * s));
      if ((rmask[u] !== 0) !== (rmask[v] !== 0)) wgt += BRIDGE / 2;
      return wgt;
    };
    for (let Q = 0; Q < N; Q++) if (srcL[Q] >= 0) heap.push(0, Q);
    while (heap.size) {
      const d = heap.peekKey();
      const u = heap.pop();
      if (d > distL[u]) continue;
      const ui = u % NX;
      const uj = (u - ui) / NX;
      for (let m = 0; m < 16; m++) {
        const wgt = stepL(u, ui, uj, m);
        if (wgt === Infinity) continue;
        const v = (uj + DY[m]) * NX + ui + DX[m];
        const nd = d + wgt;
        if (nd < distL[v]) {
          distL[v] = nd;
          srcL[v] = srcL[u];
          prevL[v] = u;
          heap.push(nd, v);
        }
      }
    }

    // ---- water forest: open sea in 8 directions, rivers along their links
    /** cost of the water step u → its neighbour in direction d (Infinity: not possible) */
    const stepW = (u: number, ui: number, uj: number, d: number): number => {
      if (rmask[u] & (1 << d)) return (LEN[d] / KM) * RIVER;
      if (kind[u] !== SEA_CELL) return Infinity;
      const vi = ui + DX[d];
      const vj = uj + DY[d];
      if (vi < 0 || vj < 0 || vi >= NX || vj >= NY) return Infinity;
      const v = vj * NX + vi;
      if (kind[v] !== SEA_CELL) return Infinity;
      // no squeezing between two land cells that touch at a corner
      if (d & 1 && kind[uj * NX + vi] !== SEA_CELL && kind[vj * NX + ui] !== SEA_CELL) return Infinity;
      return (LEN[d] / KM) * 0.5 * (cost[u] + cost[v]);
    };
    for (let Q = 0; Q < N; Q++) if (srcW[Q] >= 0) heap.push(distW[Q], Q);
    while (heap.size) {
      const d = heap.peekKey();
      const u = heap.pop();
      if (d > distW[u]) continue;
      const ui = u % NX;
      const uj = (u - ui) / NX;
      for (let m = 0; m < 8; m++) {
        const wgt = stepW(u, ui, uj, m);
        if (wgt === Infinity) continue;
        const v = (uj + DY[m]) * NX + ui + DX[m];
        const nd = d + wgt;
        if (nd < distW[v]) {
          distW[v] = nd;
          srcW[v] = srcW[u];
          prevW[v] = u;
          heap.push(nd, v);
        }
      }
    }

    // ---- candidate links: the cheapest crossing between every two trees that touch
    const pairKey = (a: number, b: number) => (a < b ? a * M + b : b * M + a);
    const byPair: [Map<number, Cand>, Map<number, Cand>] = [new Map(), new Map()];
    const offer = (water: boolean, u: number, v: number, su: number, sv: number, total: number) => {
      const map = byPair[water ? 1 : 0];
      const key = pairKey(su, sv);
      const old = map.get(key);
      if (old && old.cost <= total) return;
      map.set(key, su < sv ? { a: su, b: sv, cost: total, u, v, water } : { a: sv, b: su, cost: total, u: v, v: u, water });
    };
    for (let u = 0; u < N; u++) {
      const ui = u % NX;
      const uj = (u - ui) / NX;
      if (srcL[u] >= 0) {
        // the forward half of the 16 moves: every pair of cells once
        for (const m of [0, 1, 2, 3, 8, 9, 10, 11]) {
          const wgt = stepL(u, ui, uj, m);
          if (wgt === Infinity) continue;
          const v = (uj + DY[m]) * NX + ui + DX[m];
          if (srcL[v] >= 0 && srcL[v] !== srcL[u]) offer(false, u, v, srcL[u], srcL[v], distL[u] + wgt + distL[v]);
        }
      }
      if (srcW[u] >= 0) {
        for (let m = 0; m < 4; m++) {
          const wgt = stepW(u, ui, uj, m);
          if (wgt === Infinity) continue;
          const v = (uj + DY[m]) * NX + ui + DX[m];
          if (srcW[v] >= 0 && srcW[v] !== srcW[u]) offer(true, u, v, srcW[u], srcW[v], distW[u] + wgt + distW[v]);
        }
      }
    }
    const cands = [...byPair[0].values(), ...byPair[1].values()];
    const adj: Cand[][] = nodes.map(() => []);
    for (const c of cands) {
      adj[c.a].push(c);
      adj[c.b].push(c);
    }

    // ---- pruning: only ever the dearest link of a cycle
    const less = (x: Cand, y: Cand) => x.cost < y.cost || (x.cost === y.cost && (x.water !== y.water ? !x.water : x.a !== y.a ? x.a < y.a : x.b < y.b));
    const reach = new Float64Array(M);
    const hops = new MinHeap(64);
    /** is there a way from e.a to e.b over cheaper links (roads only, or any) that costs at most `limit`? */
    const detour = (e: Cand, limit: number, roadsOnly: boolean): boolean => {
      reach.fill(Infinity);
      reach[e.a] = 0;
      hops.push(0, e.a);
      let found = false;
      while (hops.size) {
        const d = hops.peekKey();
        const u = hops.pop();
        if (found || d > reach[u]) continue;
        if (u === e.b) {
          found = true;
          continue;
        }
        for (const f of adj[u]) {
          if ((roadsOnly && f.water) || !less(f, e)) continue;
          const v = f.a === u ? f.b : f.a;
          const nd = d + f.cost;
          if (nd <= limit && nd < reach[v]) {
            reach[v] = nd;
            hops.push(nd, v);
          }
        }
      }
      return found;
    };
    const isPruned = (e: Cand): boolean => (e.water ? detour(e, DETOUR * e.cost, false) : detour(e, DETOUR * e.cost, true) || detour(e, DETOUR_WATER * e.cost, false));
    const kept: Cand[] = [];
    let pruned = 0;
    for (const c of cands) {
      if (ownerOf(nodes[c.a].region, nodes[c.b].region) !== rkey) continue;
      if (isPruned(c)) pruned++;
      else kept.push(c);
    }
    // links between cities first: the stretches they share with lesser links are theirs
    const major = (c: Cand) => nodes[c.a].kind === 'city' && nodes[c.b].kind === 'city';
    kept.sort((x, y) => Number(major(y)) - Number(major(x)) || x.cost - y.cost || x.a - y.a || x.b - y.b || Number(x.water) - Number(y.water));

    // ---- routes
    /** cells from a's seed to b's seed through the crossing */
    const cellsOf = (c: Cand): number[] => {
      const prev = c.water ? prevW : prevL;
      const out: number[] = [];
      for (let q = c.u; q >= 0; q = prev[q]) out.push(q);
      out.reverse();
      for (let q = c.v; q >= 0; q = prev[q]) out.push(q);
      return out;
    };
    const seenRoad = new Set<number>();
    const seenRiver = new Set<number>();
    const runsOf = (n: number, isNew: (i: number) => boolean): Int32Array => {
      const runs: number[] = [];
      let start = -1;
      for (let i = 0; i < n - 1; i++) {
        if (isNew(i)) {
          if (start < 0) start = i;
        } else if (start >= 0) {
          runs.push(start, i);
          start = -1;
        }
      }
      if (start >= 0) runs.push(start, n - 1);
      return Int32Array.from(runs);
    };
    /** is the straight line between two points open sea all the way? */
    const openSea = (ax: number, ay: number, bx: number, by: number): boolean => {
      const n = Math.max(1, Math.ceil(Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) / (G / 2)));
      for (let s = 0; s <= n; s++) {
        const i = Math.floor((ax + ((bx - ax) * s) / n) / G) - I0;
        const j = Math.floor((ay + ((by - ay) * s) / n) / G) - J0;
        if (i < 0 || j < 0 || i >= NX || j >= NY || kind[j * NX + i] !== SEA_CELL) return false;
      }
      return true;
    };
    const roadPart = (c: Cand): TravelPart => {
      const cells = cellsOf(c);
      const n = cells.length;
      const pts = new Float64Array(2 * n);
      for (let i = 0; i < n; i++) {
        pts[2 * i] = cx(cells[i]);
        pts[2 * i + 1] = cy(cells[i]);
      }
      pts[0] = nodes[c.a].x;
      pts[1] = nodes[c.a].y;
      pts[2 * n - 2] = nodes[c.b].x;
      pts[2 * n - 1] = nodes[c.b].y;
      // two passes of ¼ ½ ¼: a point only moves with its two neighbours on either side, so
      // the stretch two links share comes out the same for both
      const tmp = new Float64Array(2 * n);
      for (let pass = 0; pass < 2; pass++) {
        tmp.set(pts);
        for (let i = 1; i < n - 1; i++) {
          pts[2 * i] = 0.25 * tmp[2 * i - 2] + 0.5 * tmp[2 * i] + 0.25 * tmp[2 * i + 2];
          pts[2 * i + 1] = 0.25 * tmp[2 * i - 1] + 0.5 * tmp[2 * i + 1] + 0.25 * tmp[2 * i + 3];
        }
      }
      const runs = runsOf(n, (i) => {
        const lo = Math.min(cells[i], cells[i + 1]);
        const key = lo * N + (lo === cells[i] ? cells[i + 1] : cells[i]);
        if (seenRoad.has(key)) return false;
        seenRoad.add(key);
        return true;
      });
      return { mode: 'road', pts, runs };
    };
    /** the river nodes along the cells [i0 … i1] of a water route (null: not along one river) */
    const riverNodes = (cells: number[], i0: number, i1: number): { gi: number; path: number[] } | null => {
      const end = (i: number, first: boolean): { gi: number; node: number } | null => {
        const u = cells[i];
        const v = cells[i + 1];
        const d = dirOf((v % NX) - (u % NX), Math.floor(v / NX) - Math.floor(u / NX));
        const down = linkInfo.get(u * 8 + d);
        const info = down ?? linkInfo.get(v * 8 + ((d + 4) & 7));
        if (info === undefined) return null;
        const gi = Math.floor(info / 0x100000);
        const k = info % 0x100000;
        const par = this.grid.rivers.get(regs[gi]).parent[k];
        // going downstream the stretch starts at the node and ends at its parent; upstream the other way round
        return { gi, node: (down !== undefined) === first ? k : par };
      };
      const s = end(i0, true);
      const e = end(i1 - 1, false);
      if (!s || !e || s.gi !== e.gi) return null;
      const par = this.grid.rivers.get(regs[s.gi]).parent;
      const up = new Map<number, number>();
      const fromS: number[] = [];
      for (let k = s.node; k >= 0; k = par[k]) {
        up.set(k, fromS.length);
        fromS.push(k);
      }
      const fromE: number[] = [];
      let k = e.node;
      while (k >= 0 && !up.has(k)) {
        fromE.push(k);
        k = par[k];
      }
      if (k < 0) return null;
      return { gi: s.gi, path: [...fromS.slice(0, up.get(k)! + 1), ...fromE.reverse()] };
    };
    const waterParts = (c: Cand): TravelPart[] => {
      const cells = cellsOf(c);
      const n = cells.length;
      const la = nodes[c.a];
      const lb = nodes[c.b];
      const isRiver = (i: number) => kind[cells[i]] !== SEA_CELL || kind[cells[i + 1]] !== SEA_CELL;
      const raw: { river: boolean; xs: number[]; ys: number[]; keys: number[] | null }[] = [];
      let i = 0;
      while (i < n - 1) {
        const river = isRiver(i);
        let j = i + 1;
        while (j < n - 1 && isRiver(j) === river) j++;
        const xs: number[] = [];
        const ys: number[] = [];
        let keys: number[] | null = null;
        const rn = river ? riverNodes(cells, i, j) : null;
        if (rn) {
          const rr = this.grid.rivers.get(regs[rn.gi]);
          keys = [];
          for (let t = 0; t < rn.path.length; t++) {
            xs.push(rr.x[rn.path[t]]);
            ys.push(rr.y[rn.path[t]]);
            // a river segment is named by its upstream node
            if (t > 0) keys.push(rn.gi * 0x100000 + (rr.parent[rn.path[t]] === rn.path[t - 1] ? rn.path[t] : rn.path[t - 1]));
          }
        } else {
          for (let t = i; t <= j; t++) {
            xs.push(cx(cells[t]));
            ys.push(cy(cells[t]));
          }
        }
        raw.push({ river, xs, ys, keys });
        i = j;
      }
      // the stretches meet where the river meets the sea (at the river's node), and the route starts and ends at the two places
      for (let t = 0; t + 1 < raw.length; t++) {
        const p = raw[t];
        const q = raw[t + 1];
        if (p.river) {
          q.xs[0] = p.xs[p.xs.length - 1];
          q.ys[0] = p.ys[p.ys.length - 1];
        } else {
          p.xs[p.xs.length - 1] = q.xs[0];
          p.ys[p.ys.length - 1] = q.ys[0];
        }
      }
      const first = raw[0];
      if (first.xs[0] !== la.x || first.ys[0] !== la.y) {
        first.xs.unshift(la.x);
        first.ys.unshift(la.y);
        first.keys?.unshift(-1);
      }
      const last = raw[raw.length - 1];
      if (last.xs[last.xs.length - 1] !== lb.x || last.ys[last.ys.length - 1] !== lb.y) {
        last.xs.push(lb.x);
        last.ys.push(lb.y);
        last.keys?.push(-1);
      }
      return raw.map((p): TravelPart => {
        let xs = p.xs;
        let ys = p.ys;
        if (!p.river) {
          // pull the lane straight wherever the line of sight is open water
          const px: number[] = [xs[0]];
          const py: number[] = [ys[0]];
          let at = 0;
          while (at < xs.length - 1) {
            let next = at + 1;
            for (let t = xs.length - 1; t > at + 1; t--) {
              if (openSea(xs[at], ys[at], xs[t], ys[t])) {
                next = t;
                break;
              }
            }
            px.push(xs[next]);
            py.push(ys[next]);
            at = next;
          }
          xs = px;
          ys = py;
        }
        const pts = new Float64Array(2 * xs.length);
        for (let t = 0; t < xs.length; t++) {
          pts[2 * t] = xs[t];
          pts[2 * t + 1] = ys[t];
        }
        const keys = p.keys;
        const runs = keys
          ? runsOf(xs.length, (t) => {
              if (keys[t] < 0) return true;
              if (seenRiver.has(keys[t])) return false;
              seenRiver.add(keys[t]);
              return true;
            })
          : Int32Array.of(0, xs.length - 1);
        return { mode: p.river ? 'river' : 'sea', pts, runs };
      });
    };

    const edges: TravelEdge[] = kept.map((c) => {
      const parts = c.water ? waterParts(c) : [roadPart(c)];
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const len = [0, 0, 0];
      for (const p of parts) {
        const mi = TRAVEL_MODES.indexOf(p.mode);
        for (let t = 0; t < p.pts.length; t += 2) {
          const x = p.pts[t];
          const y = p.pts[t + 1];
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
          if (t > 0) len[mi] += Math.sqrt((x - p.pts[t - 2]) * (x - p.pts[t - 2]) + (y - p.pts[t - 1]) * (y - p.pts[t - 1]));
        }
      }
      return { a: nodes[c.a], b: nodes[c.b], mode: !c.water ? 'road' : len[1] >= len[2] ? 'river' : 'sea', cost: c.cost, length: len[0] + len[1] + len[2], major: major(c), parts, x0, y0, x1, y1 };
    });
    return done(edges, cands.length, pruned);
  }
}
