/**
 * Potential city and town locations, computed per region (docs/research/settlement-siting.md;
 * this is its map-level "Tier M" in a first, simpler form).
 *
 * For one region (as drawn, like the rivers and lakes):
 *   Candidates  every land patch (merged) drawn in the region. Each gets five factor
 *               scores in [0, 1], from the map alone (no terrain tiles):
 *                 resources   food of its catchment (farmland by biome and zone type, river
 *                             irrigation in dry land; itself and its neighbours), fresh
 *                             water, building material and fuel (wood, stone, clay), fish
 *                 geography   buildable ground (flat and lowland over hills and mountains,
 *                             mangrove is swamp), a waterside site (river, harbour, coast,
 *                             lake), defence (hills, peninsula, confluence) and how deep
 *                             inside the region it lies (region borders are ridges)
 *                 trade       the better of a gateway (river mouth, sheltered harbour,
 *                             navigable river, head of navigation, confluence, lake) and a
 *                             central place (how much of the region's food lies within a
 *                             day or two of travel, over land and along navigable rivers)
 *                 climate     comfort of the temperature (at the zone type's typical
 *                             height) and of the aridity
 *                 prosperity  the prosperity map at the spot
 *   Score       viability = 100 x need x the weighted mean of the five factors. `need` is
 *               the limiting necessity: no fresh water or an unlivable temperature gives
 *               0, whatever the rest.
 *   Selection   candidates need a score above 0 and must not touch another region's land
 *               (so locations keep apart across region borders without reading the
 *               neighbour). First up to `cities` cities: the best scores, at least two
 *               patch steps inside the region and CITY_SPACING x the spacing apart.
 *               Then towns, best first, each at least the spacing from every location
 *               chosen so far. When that leaves fewer than `count` locations, the spacing
 *               is relaxed step by step (down to one patch) and the towns are picked
 *               again. Regions with little habitable land end up with fewer.
 *   Spot        on the river where one runs through the patch (its mouth, or where it
 *               is largest, but not in a lake), otherwise the patch's site.
 *
 * Deterministic and order-independent: everything is read from the region's own rivers
 * and lakes and from pure functions of the map; sums run in key order, ties break on a
 * hash; + - x / sqrt and dlog only. The biomes must be terrain-less (zone-typical
 * heights), so the locations never change as terrain tiles arrive.
 */
import { dlog } from '@shared/core/dmath';
import { hash4 } from '@shared/core/hash';
import { MinHeap } from '@shared/core/heap';
import { BIOMES, type BiomeId, type Biomes } from './biomes';
import type { Climate } from './climate';
import { inPolygon, type Lake, type Lakes } from './lakes';
import { keyI, keyJ, packKey } from './level';
import type { Rivers } from './rivers';
import type { World } from './world';
import { ELEVATION_ZONE_TYPES } from './zones';

/** The five factors of the combined score, in display order. */
export const FACTORS = ['resources', 'geography', 'trade', 'climate', 'prosperity'] as const;
export type Factor = (typeof FACTORS)[number];
export const FACTOR_NAMES: Record<Factor, string> = { resources: 'Resources', geography: 'Geography', trade: 'Trade & travel', climate: 'Climate', prosperity: 'Prosperity' };

export interface LocationParams {
  /** locations aimed for per region (cities included) */
  count: number;
  /** at most this many of them are cities */
  cities: number;
  /** preferred least distance between two locations, metres (relaxed when the region would get fewer than `count`) */
  spacing: number;
  /** relative weight of each factor in the combined score */
  weights: Record<Factor, number>;
}

/** A land patch of a region with everything that went into its viability score. */
export interface Candidate {
  /** patch (merged root), its region and (merged) elevation zone */
  patch: number;
  region: number;
  zone: number;
  /** index into ELEVATION_ZONE_TYPES, index into BIOMES */
  zoneType: number;
  biome: number;
  /** the spot: on the patch's river when it has one, otherwise its site; metres */
  x: number;
  y: number;
  /** the spot is on a river */
  onRiver: boolean;
  /** patch steps to the nearest patch that touches another region's land (0 = touches one; NO_BORDER = the region has no land border) */
  depth: number;
  coast: boolean;
  /** on the coast of an enclosed bay */
  harbour: boolean;
  /** share of the neighbours that are ocean */
  oceanFrac: number;
  /** area of the largest lake placed in the patch, m² (0 = none) */
  lake: number;
  /** largest river in the patch, at its mouth here, and the smaller branch of its largest confluence: patches drained upstream (flow / attractors per patch) */
  river: number;
  mouth: number;
  confluence: number;
  /** the upstream end of a navigable river */
  head: boolean;
  /** terms of the factors, each in [0, 1] */
  food: number;
  water: number;
  materials: number;
  fish: number;
  buildable: number;
  waterside: number;
  defence: number;
  gateway: number;
  centrality: number;
  /** temperature comfort alone (the climate factor also holds the aridity) */
  comfort: number;
  /** the five factors, each in [0, 1] */
  resources: number;
  geography: number;
  trade: number;
  climate: number;
  prosperity: number;
  /** the limiting necessity: min(water, temperature comfort), doubled and capped at 1 */
  need: number;
  /** combined viability, 0–100 */
  score: number;
  /** what stands out about the place ("river mouth", "harbour", "central place", …) */
  features: string[];
}

export type LocationKind = 'city' | 'town';

export interface Location extends Candidate {
  /** 1 = the best score of its region */
  rank: number;
  kind: LocationKind;
}

export interface RegionLocations {
  region: number;
  /** the chosen locations, best score first */
  list: Location[];
  /** every land patch of the region, by key order, and by patch key */
  candidates: Candidate[];
  byPatch: Map<number, Candidate>;
  /** candidates that may hold a location (score above 0, not on a land border) */
  eligible: number;
  /** the least distance between two locations the selection ended up using, metres */
  spacing: number;
  ms: number;
}

/** Depth of every patch in a region with no land border (an island). */
export const NO_BORDER = 99;
/** Cities keep this x the spacing from each other, and lie at least this many patch steps inside the region. */
export const CITY_SPACING = 2.5;
export const CITY_DEPTH = 2;
/** The spacing is relaxed by this factor per round, down to one patch size. */
const RELAX = 0.85;
/** A river is navigable / large from this many patches drained upstream. */
export const NAVIGABLE = 8;
export const BIG_RIVER = 80;
/** One day of travel on open flat land, km: the distance scale of the central-place term. */
const DAY_KM = 35;
/** Travel along a navigable river costs this x the same distance on open flat land. */
const RIVER_COST = 0.4;
/** The central-place term reaches 1 at this share of an ideal region (a disc of farmland, seen from its centre). */
const CENTRAL_FULL = 0.55;

/** A site that lies outside its own (warped) cell is moved: points up to one patch size away, in this many rings of 8 directions. */
const SPOT_RINGS = 4;
const SPOT_DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [0.7, 0.7],
  [-0.7, 0.7],
  [-0.7, -0.7],
  [0.7, -0.7],
];

const ST_LOC = 0x10c1;

const BIOME_TABLE = (values: Record<BiomeId, number>) => BIOMES.map((b) => values[b.id]);
/** Farmland: people per km² the biome can feed once cleared (settlement-siting.md §6.4; design values). */
const FARM = BIOME_TABLE({ ocean: 0, ice: 0, tundra: 0.3, coldSteppe: 3, taiga: 2, coldDesert: 0.3, grassland: 20, shrubland: 20, mixedForest: 30, broadleaf: 30, tempRainforest: 8, hotDesert: 0.3, thornScrub: 4, savanna: 12, dryForest: 18, rainforest: 8, mangrove: 3 });
/** Timber and fuel, 0–1. */
const WOOD = BIOME_TABLE({ ocean: 0, ice: 0, tundra: 0.05, coldSteppe: 0.2, taiga: 1, coldDesert: 0.05, grassland: 0.4, shrubland: 0.5, mixedForest: 1, broadleaf: 1, tempRainforest: 1, hotDesert: 0.05, thornScrub: 0.3, savanna: 0.4, dryForest: 0.7, rainforest: 1, mangrove: 0.5 });
/** How much slower travel is through the vegetation (1 = open). */
const VEG = BIOME_TABLE({ ocean: 1, ice: 1.5, tundra: 1.1, coldSteppe: 1, taiga: 1.3, coldDesert: 1, grassland: 1, shrubland: 1.1, mixedForest: 1.3, broadleaf: 1.3, tempRainforest: 2, hotDesert: 1.1, thornScrub: 1.1, savanna: 1, dryForest: 1.3, rainforest: 2, mangrove: 2 });
const MANGROVE = BIOMES.findIndex((b) => b.id === 'mangrove');
/** A fully fed catchment: people per km² (temperate farmland). */
const FARM_FULL = 30;
/** What a large river adds by irrigation where the climate is dry (aridity below 1), people per km². */
const IRRIGATION = 60;

const ZONE_TABLE = (flat: number, lowland: number, hills: number, mountains: number) => ELEVATION_ZONE_TYPES.map((t) => ({ ocean: 0, flat, lowland, hills, mountains })[t.id]);
const FARM_ZONE = ZONE_TABLE(1, 1, 0.6, 0.3);
const STONE = ZONE_TABLE(0.2, 0.3, 0.8, 1);
const BUILDABLE = ZONE_TABLE(1, 0.9, 0.55, 0.25);
const DEFENCE = ZONE_TABLE(0, 0.1, 0.6, 0.7);
const ROUGH = ZONE_TABLE(1, 1, 1.3, 2);
const CLAY_ZONE = ZONE_TABLE(1, 1, 0, 0);
/** How much fuel a thermal belt needs (index = BELTS order: polar … tropical). */
const FUEL_NEED = [1, 1, 0.8, 0.5, 0.1];

const sat = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ramp = (v: number, a: number, b: number) => sat((v - a) / (b - a));
/** Trapezoid: 0 below a, 1 on [b, c], 0 above d. */
const trap = (v: number, a: number, b: number, c: number, d: number) => (v <= a || v >= d ? 0 : v < b ? (v - a) / (b - a) : v <= c ? 1 : (d - v) / (d - c));

/** The combined viability (0–100) of five factor scores under the weights; `need` scales it. */
export function combine(f: Record<Factor, number>, need: number, weights: Record<Factor, number>): number {
  let sum = 0;
  let total = 0;
  for (const k of FACTORS) {
    const w = Math.max(0, weights[k]);
    sum += w * f[k];
    total += w;
  }
  // all weights 0: every factor counts the same
  if (total <= 0) {
    for (const k of FACTORS) sum += f[k];
    total = FACTORS.length;
  }
  return (100 * need * sum) / total;
}

/** The locations a viability threshold (0–100) leaves on show. */
export function viable<T extends { score: number }>(list: T[], min: number): T[] {
  return min <= 0 ? list : list.filter((l) => l.score >= min);
}

export class Locations {
  readonly p: LocationParams;
  private cache = new Map<number, RegionLocations>();

  /**
   * `biomes` must be built without a terrain (like the lakes' one): the locations then use
   * each zone type's typical height and never change as terrain tiles arrive.
   */
  constructor(
    readonly world: World,
    readonly rivers: Rivers,
    readonly lakes: Lakes,
    readonly biomes: Biomes,
    readonly climate: Climate,
    p: LocationParams,
  ) {
    if (biomes.terrain) throw new Error('Locations need terrain-less Biomes (zone-typical heights)');
    this.p = { ...p, count: Math.max(0, Math.floor(p.count)), cities: Math.max(0, Math.floor(p.cities)), spacing: Math.max(0, p.spacing) };
  }

  get size(): number {
    return this.cache.size;
  }

  has(rkey: number): boolean {
    return this.cache.has(rkey);
  }

  peek(rkey: number): RegionLocations | undefined {
    return this.cache.get(rkey);
  }

  get(rkey: number): RegionLocations {
    let r = this.cache.get(rkey);
    if (!r) {
      if (this.cache.size > 1500) this.cache.clear();
      r = this.compute(rkey);
      this.cache.set(rkey, r);
    }
    return r;
  }

  /** The candidate of the patch at a point, when its region is already computed. */
  candidateAt(x: number, y: number): Candidate | null {
    const c = this.world.cellAt(x, y, true);
    if (c.ocean) return null;
    return this.cache.get(c.region)?.byPatch.get(c.patch) ?? null;
  }

  /** The nearest location with at least `minScore` within `maxDist` metres (only regions already computed are searched). */
  nearest(x: number, y: number, maxDist: number, minScore = 0): Location | null {
    const rk = this.world.regionAt(x, y);
    const ri = keyI(rk);
    const rj = keyJ(rk);
    let best: Location | null = null;
    let bd = maxDist * maxDist;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const r = this.cache.get(packKey(ri + di, rj + dj));
        if (!r) continue;
        for (const l of r.list) {
          if (l.score < minScore) continue;
          const d = (l.x - x) * (l.x - x) + (l.y - y) * (l.y - y);
          if (d <= bd) {
            bd = d;
            best = l;
          }
        }
      }
    }
    return best;
  }

  private compute(rkey: number): RegionLocations {
    const t0 = performance.now();
    const w = this.world;
    const P = this.p;
    const S = w.patchLevel.size;

    // ---- the region's land patches (merged roots, key order) and their raw members
    const members = new Map<number, number[]>();
    for (const b of this.rivers.regionElevationZones(rkey)) {
      if (w.elevationZoneCell(b).ocean) continue;
      for (const s of w.elevationZonePatches(w.elevationZone(b))) {
        const c = w.patchCell(s);
        if (c.ocean || c.region !== rkey) continue;
        const list = members.get(c.patch);
        if (list) list.push(s);
        else members.set(c.patch, [s]);
      }
    }
    const roots = [...members.keys()].sort((a, b) => a - b);
    const n = roots.length;
    const index = new Map<number, number>();
    roots.forEach((r, i) => index.set(r, i));

    // ---- neighbours: own land (indices), ocean, other regions' land; enclosed bays
    const land: number[][] = [];
    const oceanFrac = new Float64Array(n);
    /** ocean neighbours (merged patches) */
    const seaNbrs = new Int32Array(n);
    const coast = new Uint8Array(n);
    const harbour = new Uint8Array(n);
    const border = new Uint8Array(n);
    const bayMemo = new Map<number, boolean>();
    /** is this raw ocean patch mostly enclosed by land (at least 3 land neighbours, and more land than ocean ones)? */
    const isBay = (o: number): boolean => {
      let v = bayMemo.get(o);
      if (v === undefined) {
        const nb = w.patchNbrs(w.patch(o));
        let l = 0;
        for (const q of nb) if (!w.patchCell(q).ocean) l++;
        v = l >= 3 && 2 * l > nb.length;
        bayMemo.set(o, v);
      }
      return v;
    };
    for (let i = 0; i < n; i++) {
      const own = new Set<number>();
      const sea = new Set<number>();
      const foreign = new Set<number>();
      for (const s of members.get(roots[i])!.slice().sort((a, b) => a - b)) {
        for (const q of w.patchNbrs(w.patch(s))) {
          const qc = w.patchCell(q);
          if (qc.patch === roots[i]) continue;
          if (qc.ocean) {
            sea.add(qc.patch);
            if (isBay(q)) harbour[i] = 1;
          } else if (qc.region === rkey) {
            const j = index.get(qc.patch);
            if (j !== undefined) own.add(j);
          } else foreign.add(qc.patch);
        }
      }
      land.push([...own].sort((a, b) => a - b));
      const all = own.size + sea.size + foreign.size;
      oceanFrac[i] = all ? sea.size / all : 0;
      seaNbrs[i] = sea.size;
      coast[i] = sea.size ? 1 : 0;
      border[i] = foreign.size ? 1 : 0;
    }

    // ---- depth: patch steps from the land border of the region (breadth first)
    const depth = new Int32Array(n).fill(NO_BORDER);
    let front: number[] = [];
    for (let i = 0; i < n; i++) {
      if (border[i]) {
        depth[i] = 0;
        front.push(i);
      }
    }
    while (front.length) {
      const next: number[] = [];
      for (const i of front) {
        for (const j of land[i]) {
          if (depth[j] === NO_BORDER) {
            depth[j] = depth[i] + 1;
            next.push(j);
          }
        }
      }
      front = next;
    }

    // ---- lakes: the largest lake of each patch
    const regionLakes: Lake[] = this.lakes.get(rkey).lakes;
    const lakeArea = new Float64Array(n);
    for (const l of regionLakes) {
      const i = index.get(l.patch);
      if (i !== undefined && l.area > lakeArea[i]) lakeArea[i] = l.area;
    }
    const inLake = (x: number, y: number): boolean => {
      for (const l of regionLakes) if (x >= l.x0 && x <= l.x1 && y >= l.y0 && y <= l.y1 && inPolygon(l.x, l.y, x, y)) return true;
      return false;
    };

    // ---- rivers: size, mouths, confluences, heads of navigation, and the spot on the river
    const rr = this.rivers.get(rkey);
    const perPatch = Math.max(1, this.rivers.p.perPatch);
    const river = new Float64Array(n);
    const mouth = new Float64Array(n);
    const conf = new Float64Array(n);
    const head = new Uint8Array(n);
    /** the node the spot goes to: the mouth when there is one, else the largest flow, never in a lake */
    const spot = new Int32Array(n).fill(-1);
    const spotFlow = new Int32Array(n);
    const spotMouth = new Uint8Array(n);
    /** patch index of each node on the region's own land (−1 otherwise) */
    const nodePatch = new Int32Array(rr.n).fill(-1);
    for (let k = 0; k < rr.n; k++) {
      if (rr.parent[k] < 0 || rr.wet[k]) continue;
      const c = w.cellAt(rr.x[k], rr.y[k], true);
      if (c.ocean || c.region !== rkey) continue;
      const i = index.get(c.patch);
      if (i !== undefined) nodePatch[k] = i;
    }
    // the two largest flows among each node's children on the region's land
    const kid1 = new Int32Array(rr.n);
    const kid2 = new Int32Array(rr.n);
    for (let k = 0; k < rr.n; k++) {
      const p = rr.parent[k];
      if (p < 0 || nodePatch[k] < 0) continue;
      const f = rr.flow[k];
      if (f > kid1[p]) {
        kid2[p] = kid1[p];
        kid1[p] = f;
      } else if (f > kid2[p]) kid2[p] = f;
    }
    const navFlow = NAVIGABLE * perPatch;
    /** navigable river links between two patches (pairs of indices) */
    const riverLinks: number[] = [];
    for (let k = 0; k < rr.n; k++) {
      const i = nodePatch[k];
      if (i < 0) continue;
      const f = rr.flow[k];
      const a = f / perPatch;
      const p = rr.parent[k];
      if (a > river[i]) river[i] = a;
      const atMouth = rr.parent[p] < 0 || rr.wet[p] === 1;
      if (atMouth && a > mouth[i]) mouth[i] = a;
      if (kid2[k] / perPatch > conf[i]) conf[i] = kid2[k] / perPatch;
      if (f >= navFlow && kid1[k] < navFlow) head[i] = 1;
      if (f >= navFlow && nodePatch[p] >= 0 && nodePatch[p] !== i) riverLinks.push(i, nodePatch[p]);
      // the spot: a mouth beats any other node, then the larger flow, then the smaller index
      const better = atMouth ? !spotMouth[i] || f > spotFlow[i] : !spotMouth[i] && f > spotFlow[i];
      if (better && !inLake(rr.x[k], rr.y[k])) {
        spot[i] = k;
        spotFlow[i] = f;
        spotMouth[i] = atMouth ? 1 : 0;
      }
    }

    // ---- per-patch climate and biome (zone-typical heights), food, travel cost
    const zt = new Int32Array(n);
    const biome = new Int32Array(n);
    const zone = new Float64Array(n);
    const temp = new Float64Array(n);
    const arid = new Float64Array(n);
    const belt = new Int32Array(n);
    const foodHere = new Float64Array(n);
    const sx = new Float64Array(n);
    const sy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const b = this.biomes.ofPatch(roots[i]);
      zt[i] = b.zoneType;
      biome[i] = b.biome;
      zone[i] = w.patchCell(roots[i]).elevationZone;
      temp[i] = b.t;
      arid[i] = b.aridity;
      belt[i] = b.belt;
      const irrigation = b.aridity < 1 ? IRRIGATION * sat(river[i] / BIG_RIVER) : 0;
      foodHere[i] = sat((FARM[b.biome] * FARM_ZONE[b.zoneType] + irrigation) / FARM_FULL);
      const s = w.patch(roots[i]);
      sx[i] = s.x;
      sy[i] = s.y;
    }

    // ---- central places: how much of the region's food is within reach of each patch
    // (Hansen accessibility over the travel graph: land between neighbours, navigable rivers)
    const adj: number[][] = land.map(() => []);
    const cost: number[][] = land.map(() => []);
    const km = (i: number, j: number) => Math.sqrt((sx[i] - sx[j]) * (sx[i] - sx[j]) + (sy[i] - sy[j]) * (sy[i] - sy[j])) / 1000;
    for (let i = 0; i < n; i++) {
      for (const j of land[i]) {
        adj[i].push(j);
        cost[i].push(km(i, j) * 0.5 * (ROUGH[zt[i]] + ROUGH[zt[j]]) * 0.5 * (VEG[biome[i]] + VEG[biome[j]]));
      }
    }
    for (let e = 0; e < riverLinks.length; e += 2) {
      const i = riverLinks[e];
      const j = riverLinks[e + 1];
      const c = km(i, j) * RIVER_COST;
      adj[i].push(j);
      cost[i].push(c);
      adj[j].push(i);
      cost[j].push(c);
    }
    const patchKm2 = (S / 1000) * (S / 1000);
    const weight = new Float64Array(n);
    for (let i = 0; i < n; i++) weight[i] = foodHere[i] * members.get(roots[i])!.length * patchKm2;
    // an ideal region: a disc of full farmland of the region's area, seen from its centre
    const reach = w.regionLevel.size / 1000 / Math.sqrt(Math.PI) / DAY_KM;
    const ideal = 2 * Math.PI * DAY_KM * DAY_KM * (dlog(1 + reach) + 1 / (1 + reach) - 1);
    const central = new Float64Array(n);
    const dist = new Float64Array(n);
    const heap = new MinHeap(256);
    for (let s = 0; s < n; s++) {
      dist.fill(Infinity);
      dist[s] = 0;
      heap.push(0, s);
      let acc = 0;
      while (heap.size) {
        const d = heap.peekKey();
        const u = heap.pop();
        if (d > dist[u]) continue;
        const q = 1 + d / DAY_KM;
        acc += weight[u] / (q * q);
        const au = adj[u];
        const cu = cost[u];
        for (let e = 0; e < au.length; e++) {
          const nd = d + cu[e];
          if (nd < dist[au[e]]) {
            dist[au[e]] = nd;
            heap.push(nd, au[e]);
          }
        }
      }
      central[s] = sat(acc / (CENTRAL_FULL * ideal));
    }

    // ---- the candidates
    const pros = this.climate.p.prosperity;
    const prosSpan = pros.max - pros.min;
    const candidates: Candidate[] = [];
    for (let i = 0; i < n; i++) {
      const root = roots[i];
      const isCoast = coast[i] === 1;
      const isHarbour = harbour[i] === 1;
      const hasLake = lakeArea[i] > 0;
      const a = river[i];

      // the spot: on the river, else the site of the root (or of a member that lies in its own cell)
      let x = sx[i];
      let y = sy[i];
      let onRiver = false;
      if (spot[i] >= 0 && spotFlow[i] >= 3) {
        x = rr.x[spot[i]];
        y = rr.y[spot[i]];
        onRiver = true;
      } else {
        const ok = (px: number, py: number) => w.cellAt(px, py, true).patch === root && !inLake(px, py);
        if (!ok(x, y)) {
          // border warp can push a site out of its own cell (or a lake may cover it): try the
          // other members' sites, then points around the sites, nearest first
          const sites = members.get(root)!.map((s) => w.patch(s));
          let found = false;
          for (let ring = 0; ring <= SPOT_RINGS && !found; ring++) {
            for (const m of sites) {
              for (const [ux, uy] of ring === 0 ? [[0, 0]] : SPOT_DIRS) {
                const px = m.x + (ux * ring * S) / SPOT_RINGS;
                const py = m.y + (uy * ring * S) / SPOT_RINGS;
                if (ok(px, py)) {
                  x = px;
                  y = py;
                  found = true;
                  break;
                }
              }
              if (found) break;
            }
          }
        }
      }

      // resources
      let ring = 2 * foodHere[i];
      let woodNear = 0;
      let stoneNear = 0;
      for (const j of land[i]) {
        ring += foodHere[j];
        if (WOOD[biome[j]] > woodNear) woodNear = WOOD[biome[j]];
        if (STONE[zt[j]] > stoneNear) stoneNear = STONE[zt[j]];
      }
      // ocean neighbours hold no farmland: a coast has a smaller catchment (and fish instead)
      const food = ring / (2 + land[i].length + seaNbrs[i]);
      const water = Math.max(sat(a / 2), ramp(arid[i], 0.5, 1.5), isCoast ? 0.5 : 0, hasLake ? 1 : 0);
      const wood = Math.max(WOOD[biome[i]], 0.7 * woodNear);
      const stone = Math.max(STONE[zt[i]], 0.7 * stoneNear);
      const clay = CLAY_ZONE[zt[i]] && a >= 1 ? 0.8 : 0.3;
      const materials = 0.5 * Math.max(wood, stone, clay) + 0.5 * Math.max(wood, 1 - FUEL_NEED[belt[i]]);
      const fish = Math.max(isHarbour ? 1 : isCoast ? 0.8 : 0, a >= NAVIGABLE ? 0.6 : a >= 2 ? 0.3 : 0, hasLake ? 0.6 : 0);
      const resources = 0.5 * food + 0.2 * water + 0.2 * materials + 0.1 * fish;

      // geography
      const buildable = BUILDABLE[zt[i]] * (biome[i] === MANGROVE ? 0.5 : 1);
      const waterside = Math.max(a >= NAVIGABLE ? 1 : a >= 2 ? 0.7 : a > 0 ? 0.4 : 0, isHarbour ? 1 : isCoast ? 0.7 : 0, hasLake ? 0.8 : 0);
      const defence = Math.max(DEFENCE[zt[i]], oceanFrac[i] >= 0.5 ? 0.5 : 0, conf[i] >= NAVIGABLE / 2 ? 0.4 : 0);
      const geography = buildable * (0.5 + 0.3 * waterside + 0.2 * defence) * (0.75 + 0.25 * sat(depth[i] / 3));

      // trade and travel: one dominant gateway feature plus a quarter of the rest, or a central place
      const items = [sat(mouth[i] / BIG_RIVER), isHarbour ? 0.6 : isCoast ? 0.24 : 0, 0.5 * ramp(a, NAVIGABLE, BIG_RIVER), head[i] ? 0.6 : 0, 0.4 * sat(conf[i] / NAVIGABLE), hasLake ? 0.15 : 0];
      let top = 0;
      let sum = 0;
      for (const v of items) {
        sum += v;
        if (v > top) top = v;
      }
      const gateway = sat((top + 0.25 * (sum - top)) / 1.5);
      const centrality = central[i];
      const trade = sat(Math.max(gateway, centrality) + 0.25 * Math.min(gateway, centrality));

      // climate
      const comfort = trap(temp[i], -8, 4, 24, 34);
      const climate = comfort * (0.4 + 0.6 * ramp(arid[i], 0.2, 1)) * (arid[i] > 6 ? 0.85 : 1);

      // prosperity
      const prosperity = prosSpan > 0 ? sat((this.climate.prosperityAt(x, y) - pros.min) / prosSpan) : 0.5;

      const need = sat(2 * Math.min(water, comfort));
      const score = combine({ resources, geography, trade, climate, prosperity }, need, P.weights);

      const features: string[] = [];
      if (mouth[i] >= 2) features.push(mouth[i] >= NAVIGABLE ? 'mouth of a navigable river' : 'river mouth');
      if (isHarbour) features.push('sheltered harbour');
      else if (isCoast) features.push('coast');
      if (a >= NAVIGABLE && mouth[i] < NAVIGABLE) features.push(a >= BIG_RIVER ? 'large river' : 'navigable river');
      else if (a >= 2 && mouth[i] < 2) features.push('river');
      if (head[i]) features.push('head of navigation');
      if (conf[i] >= NAVIGABLE / 2) features.push('confluence');
      if (hasLake) features.push('lake');
      if (centrality >= 0.6 && centrality >= gateway) features.push('central place');
      if (DEFENCE[zt[i]] >= 0.6) features.push('high ground');
      else if (oceanFrac[i] >= 0.5) features.push('peninsula');
      if (food >= 0.7) features.push('rich farmland');

      candidates.push({
        patch: root,
        region: rkey,
        zone: zone[i],
        zoneType: zt[i],
        biome: biome[i],
        x,
        y,
        onRiver,
        depth: depth[i],
        coast: isCoast,
        harbour: isHarbour,
        oceanFrac: oceanFrac[i],
        lake: lakeArea[i],
        river: a,
        mouth: mouth[i],
        confluence: conf[i],
        head: head[i] === 1,
        food,
        water,
        materials,
        fish,
        buildable,
        waterside,
        defence,
        gateway,
        centrality,
        comfort,
        resources,
        geography,
        trade,
        climate,
        prosperity,
        need,
        score,
        features,
      });
    }

    // ---- selection: cities first, then towns, both greedy by score with a least distance
    const tie = (c: Candidate) => hash4(w.p.seed, ST_LOC, keyI(c.patch), keyJ(c.patch));
    const order = candidates.filter((c) => c.score > 0 && c.depth >= 1).sort((a, b) => b.score - a.score || tie(a) - tie(b) || a.patch - b.patch);
    const far = (c: Candidate, others: Candidate[], d: number) => {
      for (const o of others) if ((o.x - c.x) * (o.x - c.x) + (o.y - c.y) * (o.y - c.y) < d * d) return false;
      return true;
    };
    const cities: Candidate[] = [];
    const cityCap = Math.min(P.cities, P.count);
    for (const c of order) {
      if (cities.length >= cityCap) break;
      if (c.depth >= CITY_DEPTH && far(c, cities, CITY_SPACING * P.spacing)) cities.push(c);
    }
    const isCity = new Set(cities);
    let spacing = P.spacing;
    let picked: Candidate[] = [];
    for (;;) {
      picked = cities.slice();
      for (const c of order) {
        if (picked.length >= P.count) break;
        if (!isCity.has(c) && far(c, picked, spacing)) picked.push(c);
      }
      if (picked.length >= P.count || spacing <= S) break;
      spacing = Math.max(S, spacing * RELAX);
    }
    const list: Location[] = picked
      .sort((a, b) => b.score - a.score || tie(a) - tie(b) || a.patch - b.patch)
      .map((c, k) => ({ ...c, rank: k + 1, kind: isCity.has(c) ? 'city' : 'town' }));

    const byPatch = new Map<number, Candidate>();
    for (const c of candidates) byPatch.set(c.patch, c);
    return { region: rkey, list, candidates, byPatch, eligible: order.length, spacing, ms: performance.now() - t0 };
  }
}
