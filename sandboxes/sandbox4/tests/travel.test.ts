import { describe, expect, it } from 'vitest';
import { testParams } from './fixture';
import { toBiomeParams, toClimateParams, toLakeParams, toLocationParams, toRiverParams, toTerrainParams, toWorldParams } from '../src/params';
import type { Params } from '@shared/params/schema';
import { BIOMES, Biomes } from '../src/world/biomes';
import { Climate } from '../src/world/climate';
import { Lakes } from '../src/world/lakes';
import { keyI, keyJ, packKey } from '../src/world/level';
import { Locations, type Location } from '../src/world/locations';
import { Rivers } from '../src/world/rivers';
import { Terrain } from '../src/world/terrain';
import { BIOME_COST, CELL, ownerOf, Travel, TravelGrid, ZONE_COST, type RegionTravel, type TravelEdge } from '../src/world/travel';
import { World } from '../src/world/world';
import { ELEVATION_ZONE_TYPES, elevationZoneType } from '../src/world/zones';

const SEED = 12345;
const MIN = 59;

function setup(over: Params = {}, seed = SEED) {
  const p = { ...testParams(), ...over };
  const w = new World(toWorldParams(p, seed));
  const rv = new Rivers(w, toRiverParams(p, seed));
  const cl = new Climate(toClimateParams(p, seed));
  const bio = new Biomes(w, rv, cl, null, toBiomeParams(p));
  const lk = new Lakes(w, rv, bio, toLakeParams(p));
  const loc = new Locations(w, rv, lk, bio, cl, toLocationParams(p));
  const grid = new TravelGrid(w, rv, lk, bio, new Terrain(w, rv, toTerrainParams(p)));
  const travel = (minScore = MIN, citiesOnly = false) => new Travel(grid, loc, { minScore, citiesOnly });
  return { p, w, rv, bio, lk, loc, grid, travel };
}

/** The regions whose lattice cell touches the square of half-side `half` metres around the origin, plus `margin` rings. */
const block = (w: World, half: number, margin = 0) => World.cellsIn(w.regionLevel, -half, -half, half, half, margin);

/** What must be identical between two computations of a region. */
const digest = (rt: RegionTravel) => rt.edges.map((e) => [e.a.patch, e.b.patch, e.mode, e.cost, e.length, e.major, ...e.parts.map((q) => [q.mode, [...q.pts], [...q.runs]])]);

const pairKey = (e: TravelEdge) => `${Math.min(e.a.patch, e.b.patch)}:${Math.max(e.a.patch, e.b.patch)}:${e.mode === 'road' ? 'road' : 'water'}`;

const MOUNTAINS = ELEVATION_ZONE_TYPES.findIndex((t) => t.id === 'mountains');
const FLAT = ELEVATION_ZONE_TYPES.findIndex((t) => t.id === 'flat');
const HARSH = new Set(['hotDesert', 'coldDesert', 'ice'].map((id) => BIOMES.findIndex((b) => b.id === id)));

describe('travel network', { timeout: 240_000 }, () => {
  // one world shared by the read-only tests (regions are computed on demand and cached)
  const s = setup();
  const tr = s.travel();
  const inner = block(s.w, 200_000);
  const all = block(s.w, 200_000, 1);
  const edges = () => all.flatMap((r) => tr.get(r).edges);

  it('links the locations on show, every pair at most once per kind, held by the owner of its two regions', () => {
    const seen = new Set<string>();
    let n = 0;
    for (const r of all) {
      const rt = tr.get(r);
      expect(rt.region).toBe(r);
      for (const e of rt.edges) {
        n++;
        expect(e.a.patch).not.toBe(e.b.patch);
        for (const l of [e.a, e.b]) {
          expect(l.score).toBeGreaterThanOrEqual(MIN);
          // the very location of its region's list
          expect(s.loc.get(l.region).list).toContain(l);
        }
        expect(ownerOf(e.a.region, e.b.region)).toBe(r);
        const key = pairKey(e);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        expect(e.major).toBe(e.a.kind === 'city' && e.b.kind === 'city');
        expect(e.cost).toBeGreaterThan(0);
        expect(e.length).toBeGreaterThan(0);
      }
    }
    expect(n).toBeGreaterThan(100);
  });

  it('connects every location on show into one network', () => {
    const parent = new Map<number, number>();
    const find = (a: number): number => {
      let r = a;
      while (parent.get(r) !== r) r = parent.get(r)!;
      parent.set(a, r);
      return r;
    };
    for (const r of all) for (const l of tr.shown(r)) parent.set(l.patch, l.patch);
    for (const e of edges()) if (parent.has(e.a.patch) && parent.has(e.b.patch)) parent.set(find(e.a.patch), find(e.b.patch));
    const sizes = new Map<number, number>();
    let n = 0;
    for (const r of inner) {
      for (const l of tr.shown(r)) {
        n++;
        sizes.set(find(l.patch), (sizes.get(find(l.patch)) ?? 0) + 1);
      }
    }
    expect(n).toBeGreaterThan(60);
    // measured: one component; allow a far-off island or two
    expect(Math.max(...sizes.values())).toBeGreaterThanOrEqual(0.95 * n);
  });

  it('is sparse: a few links per place, not one to every neighbour', () => {
    const deg = new Map<number, number>();
    for (const e of edges()) for (const l of [e.a, e.b]) deg.set(l.patch, (deg.get(l.patch) ?? 0) + 1);
    let n = 0;
    let sum = 0;
    for (const r of inner) {
      for (const l of tr.shown(r)) {
        n++;
        sum += deg.get(l.patch) ?? 0;
        expect(deg.get(l.patch) ?? 0).toBeLessThanOrEqual(12);
      }
    }
    // measured ≈ 3.8
    expect(sum / n).toBeGreaterThan(2);
    expect(sum / n).toBeLessThan(5.5);
  });

  it('has roads, river routes and sea lanes', () => {
    const count = { road: 0, river: 0, sea: 0 };
    for (const e of edges()) count[e.mode]++;
    expect(count.road).toBeGreaterThan(count.river + count.sea);
    expect(count.river).toBeGreaterThan(0);
    expect(count.sea).toBeGreaterThan(0);
  });

  it('runs every route from place to place without a gap, roads over land and sea lanes over water', () => {
    let roadSteps = 0;
    let roadAtSea = 0;
    let seaSteps = 0;
    let seaOnLand = 0;
    for (const e of edges()) {
      expect(e.parts.length).toBeGreaterThan(0);
      const first = e.parts[0].pts;
      const last = e.parts[e.parts.length - 1].pts;
      expect([first[0], first[1]]).toEqual([e.a.x, e.a.y]);
      expect([last[last.length - 2], last[last.length - 1]]).toEqual([e.b.x, e.b.y]);
      if (e.mode === 'road') expect(e.parts.map((q) => q.mode)).toEqual(['road']);
      else expect(e.parts.every((q) => q.mode !== 'road')).toBe(true);
      let px = first[0];
      let py = first[1];
      for (const part of e.parts) {
        const n = part.pts.length / 2;
        expect(n).toBeGreaterThanOrEqual(2);
        // joined to the part before
        expect([part.pts[0], part.pts[1]]).toEqual([px, py]);
        px = part.pts[2 * n - 2];
        py = part.pts[2 * n - 1];
        for (let i = 0; i < n; i++) {
          expect(part.pts[2 * i]).toBeGreaterThanOrEqual(e.x0);
          expect(part.pts[2 * i]).toBeLessThanOrEqual(e.x1);
          expect(part.pts[2 * i + 1]).toBeGreaterThanOrEqual(e.y0);
          expect(part.pts[2 * i + 1]).toBeLessThanOrEqual(e.y1);
        }
        // the stretches to draw are in order and inside the route
        for (let r = 0; r < part.runs.length; r += 2) {
          expect(part.runs[r]).toBeGreaterThanOrEqual(r > 0 ? part.runs[r - 1] : 0);
          expect(part.runs[r + 1]).toBeGreaterThan(part.runs[r]);
          expect(part.runs[r + 1]).toBeLessThan(n);
        }
        for (let i = 0; i + 1 < n; i++) {
          const ocean = s.w.cellAt((part.pts[2 * i] + part.pts[2 * i + 2]) / 2, (part.pts[2 * i + 1] + part.pts[2 * i + 3]) / 2, true).ocean;
          if (part.mode === 'road') {
            roadSteps++;
            if (ocean) roadAtSea++;
          } else if (part.mode === 'sea' && i > 0 && i + 2 < n) {
            // (the first and last piece of a lane run from the town or the river mouth to open water)
            seaSteps++;
            if (!ocean) seaOnLand++;
          }
        }
      }
    }
    // smoothing may clip a cove (measured 0.3 %), and a lane a cape
    expect(roadSteps).toBeGreaterThan(1000);
    expect(roadAtSea / roadSteps).toBeLessThan(0.02);
    expect(seaSteps).toBeGreaterThan(10);
    expect(seaOnLand / seaSteps).toBeLessThan(0.08);
  });

  it('draws every stretch of road once, however many links share it', () => {
    // every link draws something, unless all of it lies on links drawn before it
    let drawn = 0;
    let whole = 0;
    for (const e of edges()) {
      for (const part of e.parts) {
        if (part.mode !== 'road') continue;
        whole += part.pts.length / 2 - 1;
        for (let r = 0; r < part.runs.length; r += 2) drawn += part.runs[r + 1] - part.runs[r];
      }
    }
    expect(drawn).toBeGreaterThan(0);
    // links out of one place share their first stretch: measurably less is drawn than the routes hold
    expect(drawn).toBeLessThan(whole);
    expect(drawn).toBeGreaterThan(0.5 * whole);
  });

  it('keeps roads off mountains, deserts and ice', () => {
    const { w, bio, grid } = s;
    let road = 0;
    let roadMountain = 0;
    let roadHarsh = 0;
    for (const e of edges()) {
      for (const part of e.parts) {
        if (part.mode !== 'road') continue;
        for (let i = 0; i + 2 < part.pts.length; i += 2) {
          const c = w.cellAt((part.pts[i] + part.pts[i + 2]) / 2, (part.pts[i + 1] + part.pts[i + 3]) / 2, true);
          if (c.ocean) continue;
          const d = Math.hypot(part.pts[i + 2] - part.pts[i], part.pts[i + 3] - part.pts[i + 1]);
          road += d;
          if (elevationZoneType(c.elevationZone, false) === MOUNTAINS) roadMountain += d;
          if (HARSH.has(bio.ofPatch(c.patch).biome)) roadHarsh += d;
        }
      }
    }
    let land = 0;
    let mountain = 0;
    let harsh = 0;
    for (const r of inner) {
      const g = grid.get(r);
      for (let j = 0; j < g.ny; j++) {
        for (let i = 0; i < g.nx; i++) {
          if (g.kind[j * g.nx + i] !== 1) continue;
          const c = w.cellAt((g.i0 + i + 0.5) * CELL, (g.j0 + j + 0.5) * CELL, true);
          land++;
          if (elevationZoneType(c.elevationZone, false) === MOUNTAINS) mountain++;
          if (HARSH.has(bio.ofPatch(c.patch).biome)) harsh++;
        }
      }
    }
    expect(mountain).toBeGreaterThan(0);
    expect(harsh).toBeGreaterThan(0);
    // measured: 0.5 % of the road length against 4 % of the land in mountains, 2 % against 11 % in deserts and ice
    expect(roadMountain / road).toBeLessThan(0.5 * (mountain / land));
    expect(roadHarsh / road).toBeLessThan(0.5 * (harsh / land));
    expect(ZONE_COST[MOUNTAINS]).toBeGreaterThanOrEqual(3 * ZONE_COST[FLAT]);
    for (const b of HARSH) expect(BIOME_COST[b]).toBeGreaterThanOrEqual(3);
  });

  it('sails only between places on the water: a coast or a navigable river', () => {
    const { grid, rv } = s;
    // every cell of a navigable river link, by region
    const riverCells = (r: number) => {
      const set = new Set<string>();
      const g = grid.get(r);
      for (let e = 0; e < g.links.length; e += 5) {
        set.add(`${g.links[e]},${g.links[e + 1]}`);
        set.add(`${g.links[e + 2]},${g.links[e + 3]}`);
      }
      return set;
    };
    const onRiver = (l: Location) => {
      const i = Math.floor(l.x / CELL);
      const j = Math.floor(l.y / CELL);
      for (const q of tr.around(l.region)) {
        const cells = riverCells(q);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (cells.has(`${i + di},${j + dj}`)) return true;
      }
      return false;
    };
    let water = 0;
    for (const e of edges()) {
      if (e.mode === 'road') continue;
      water++;
      for (const l of [e.a, e.b]) expect(l.coast || onRiver(l)).toBe(true);
      // a river stretch is the river's own nodes
      for (const part of e.parts) {
        if (part.mode !== 'river' || part.pts.length < 8) continue;
        const rr = rv.get(e.a.region);
        const rb = rv.get(e.b.region);
        const isNode = (x: number, y: number) => {
          for (const t of [rr, rb]) for (let k = 0; k < t.n; k++) if (t.x[k] === x && t.y[k] === y) return true;
          return false;
        };
        // (skip the ends: they are the places themselves or where the river meets the lane)
        const mid = 2 * Math.floor(part.pts.length / 4);
        const hit = isNode(part.pts[mid], part.pts[mid + 1]);
        if (e.a.region === e.b.region) expect(hit).toBe(true);
      }
    }
    expect(water).toBeGreaterThan(10);
  });

  it('does not depend on the order regions are computed in', () => {
    const target = inner[Math.floor(inner.length / 2)];
    // the shared instance reached it after its neighbours; a fresh one computes it first, a third one last
    const a = setup();
    const ta = a.travel();
    const first = digest(ta.get(target));
    const b = setup();
    const tb = b.travel();
    for (const r of block(b.w, 330_000).reverse()) if (r !== target) tb.get(r);
    expect(digest(tb.get(target))).toEqual(first);
    expect(digest(tr.get(target))).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it('prepares a region step by step and then computes it', () => {
    const a = setup();
    const t = a.travel();
    const r = inner[0];
    expect(t.has(r)).toBe(false);
    // a deadline in the past does at most nothing
    expect(t.prepare(r, 0)).toBe(false);
    expect(a.loc.size).toBe(0);
    expect(t.prepare(r, Infinity)).toBe(true);
    for (const q of t.around(r)) {
      expect(a.loc.has(q)).toBe(true);
      expect(a.grid.has(q)).toBe(true);
    }
    expect(t.peek(r)).toBeUndefined();
    const rt = t.get(r);
    expect(t.peek(r)).toBe(rt);
    expect(t.around(r)).toHaveLength(9);
  });

  it('follows the viability threshold: fewer places, fewer links, none below it', () => {
    const lo = s.travel(0);
    const hi = s.travel(70);
    let nLo = 0;
    let nHi = 0;
    for (const r of inner) {
      nLo += lo.get(r).edges.length;
      nHi += hi.get(r).edges.length;
      for (const e of hi.get(r).edges) for (const l of [e.a, e.b]) expect(l.score).toBeGreaterThanOrEqual(70);
      expect(hi.shown(r).length).toBeLessThanOrEqual(lo.shown(r).length);
    }
    expect(nLo).toBeGreaterThan(nHi);
    expect(nHi).toBeGreaterThan(0);
  });

  it('links only the cities when only the cities are on show', () => {
    const tc = s.travel(MIN, true);
    let n = 0;
    for (const r of inner) {
      for (const e of tc.get(r).edges) {
        n++;
        expect(e.a.kind).toBe('city');
        expect(e.b.kind).toBe('city');
        expect(e.major).toBe(true);
      }
    }
    expect(n).toBeGreaterThan(5);
  });

  it('gives every pair of regions up to two apart one owner next to both', () => {
    const cheb = (a: number, b: number) => Math.max(Math.abs(keyI(a) - keyI(b)), Math.abs(keyJ(a) - keyJ(b)));
    const o = packKey(3, -7);
    for (let dj = -3; dj <= 3; dj++) {
      for (let di = -3; di <= 3; di++) {
        const q = packKey(3 + di, -7 + dj);
        const owner = ownerOf(o, q);
        expect(ownerOf(q, o)).toBe(owner);
        if (Math.max(Math.abs(di), Math.abs(dj)) > 2) expect(owner).toBe(-1);
        else {
          expect(cheb(owner, o)).toBeLessThanOrEqual(1);
          expect(cheb(owner, q)).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(ownerOf(o, o)).toBe(o);
  });
});

describe('travel grid', { timeout: 120_000 }, () => {
  it('holds each region’s own cells: sea, and land with a cost and a height', () => {
    const { w, grid, rv, lk } = setup();
    let land = 0;
    let sea = 0;
    let onRiver = 0;
    let riverH = 0;
    let offRiver = 0;
    let offH = 0;
    let lakeCells = 0;
    for (const r of block(w, 130_000)) {
      const g = grid.get(r);
      expect(grid.get(r)).toBe(g);
      const rr = rv.get(r);
      const river = new Set<number>();
      for (let k = 0; k < rr.n; k++) {
        if (rr.parent[k] < 0 || rr.wet[k]) continue;
        const i = Math.floor(rr.x[k] / CELL) - g.i0;
        const j = Math.floor(rr.y[k] / CELL) - g.j0;
        if (i >= 0 && j >= 0 && i < g.nx && j < g.ny) river.add(j * g.nx + i);
      }
      for (let j = 0; j < g.ny; j++) {
        for (let i = 0; i < g.nx; i++) {
          const q = j * g.nx + i;
          const x = (g.i0 + i + 0.5) * CELL;
          const y = (g.j0 + j + 0.5) * CELL;
          const c = w.cellAt(x, y, true);
          if (!g.kind[q]) {
            expect(c.region).not.toBe(r);
            continue;
          }
          expect(c.region).toBe(r);
          expect(g.kind[q]).toBe(c.ocean ? 2 : 1);
          if (c.ocean) {
            sea++;
            continue;
          }
          land++;
          const lake = lk.lakeAt(x, y) !== null;
          if (lake) lakeCells++;
          // zone type × biome, × 8 in a lake
          expect(g.cost[q]).toBeGreaterThanOrEqual(lake ? 8 : 1);
          expect(g.h[q]).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(g.h[q])).toBe(true);
          if (river.has(q)) {
            onRiver++;
            riverH += g.h[q];
          } else {
            offRiver++;
            offH += g.h[q];
          }
        }
      }
      expect(g.land).toBeGreaterThanOrEqual(0);
      for (let e = 0; e < g.links.length; e += 5) {
        // a link joins two cells that touch
        expect(Math.max(Math.abs(g.links[e] - g.links[e + 2]), Math.abs(g.links[e + 1] - g.links[e + 3]))).toBe(1);
        expect(rr.parent[g.links[e + 4]]).toBeGreaterThanOrEqual(0);
      }
    }
    expect(land).toBeGreaterThan(1000);
    expect(sea).toBeGreaterThan(100);
    expect(onRiver).toBeGreaterThan(100);
    expect(offRiver).toBeGreaterThan(100);
    // rivers are the valleys: the land between them stands higher
    expect(offH / offRiver).toBeGreaterThan(riverH / onRiver);
    expect(lakeCells).toBeGreaterThanOrEqual(0);
  });

  it('raises river beds upstream', () => {
    const { w, grid, rv } = setup();
    const r = block(w, 130_000).find((q) => rv.get(q).n > 200)!;
    const rr = rv.get(r);
    const z = grid.bed(rr);
    let rising = 0;
    for (let k = 0; k < rr.n; k++) {
      const p = rr.parent[k];
      if (p < 0) continue;
      // the stretch over the sea (and a river that crosses a bay) sits at sea level
      if (rr.wet[k]) {
        expect(z[k]).toBe(0);
        continue;
      }
      expect(z[k]).toBeGreaterThanOrEqual(z[p]);
      if (z[k] > z[p]) rising++;
    }
    expect(rising).toBeGreaterThan(100);
  });
});
