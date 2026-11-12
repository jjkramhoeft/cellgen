import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { testParams } from './fixture';
import { toBiomeParams, toClimateParams, toLakeParams, toLocationParams, toRiverParams, toTerrainParams, toWorldParams } from '../src/params';
import type { Params } from '@shared/params/schema';
import { Biomes } from '../src/world/biomes';
import { Climate } from '../src/world/climate';
import { Lakes } from '../src/world/lakes';
import { CITY_DEPTH, CITY_SPACING, combine, FACTORS, Locations, viable, type Location, type RegionLocations } from '../src/world/locations';
import { MIN_AMOUNT, resourceIndex, RESOURCES, Resources } from '../src/world/resources';
import { Rivers } from '../src/world/rivers';
import { Terrain } from '../src/world/terrain';
import { World } from '../src/world/world';

const SEED = 12345;

function setup(over: Params = {}, seed = SEED) {
  const p = { ...testParams(), ...over };
  const w = new World(toWorldParams(p, seed));
  const rv = new Rivers(w, toRiverParams(p, seed));
  const cl = new Climate(toClimateParams(p, seed));
  const bio = new Biomes(w, rv, cl, null, toBiomeParams(p));
  const lk = new Lakes(w, rv, bio, toLakeParams(p));
  const loc = new Locations(w, rv, lk, bio, cl, toLocationParams(p));
  return { p, w, rv, cl, bio, lk, loc };
}

/** Regions around the origin with some land (lattice order). */
function landRegions(w: World, n: number): number[] {
  const out: number[] = [];
  for (const r of World.cellsIn(w.regionLevel, -400000, -400000, 400000, 400000, 0)) {
    if (w.region(r).elevationZones.some((b) => !w.elevationZoneCell(b).ocean)) out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

const dist = (a: Location, b: Location) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
/** What must be identical between two computations of a region. */
const digest = (rl: RegionLocations) => rl.list.map((l) => [l.patch, l.kind, l.rank, l.score, l.x, l.y, ...FACTORS.map((k) => l[k])]);

describe('city and town locations', { timeout: 120_000 }, () => {
  it('gives every region with enough habitable land about 20 locations, cities among them', () => {
    const { w, loc, p } = setup();
    const want = Number(p['loc.count']);
    let regions = 0;
    let full = 0;
    let cities = 0;
    for (const r of landRegions(w, 16)) {
      const rl = loc.get(r);
      expect(rl.list.length).toBeLessThanOrEqual(want);
      const nCities = rl.list.filter((l) => l.kind === 'city').length;
      expect(nCities).toBeLessThanOrEqual(Number(p['loc.cities']));
      // a region short of locations has used up its eligible patches or relaxed the spacing all the way
      if (rl.list.length < want) expect(rl.eligible < want || rl.spacing === w.patchLevel.size).toBe(true);
      if (rl.eligible >= 3 * want) {
        regions++;
        if (rl.list.length === want) full++;
        expect(nCities).toBeGreaterThanOrEqual(1);
      }
      cities += nCities;
    }
    expect(regions).toBeGreaterThanOrEqual(8);
    expect(full).toBe(regions);
    expect(cities).toBeGreaterThan(regions);
  });

  it('scores are the weighted combination of five factors in [0, 1], best first', () => {
    const { w, loc } = setup();
    const weights = loc.p.weights;
    let n = 0;
    for (const r of landRegions(w, 8)) {
      const rl = loc.get(r);
      for (const c of rl.candidates) {
        for (const k of FACTORS) {
          expect(c[k]).toBeGreaterThanOrEqual(0);
          expect(c[k]).toBeLessThanOrEqual(1);
        }
        expect(c.need).toBeGreaterThanOrEqual(0);
        expect(c.need).toBeLessThanOrEqual(1);
        expect(c.score).toBe(combine(c, c.need, weights));
        expect(c.score).toBeGreaterThanOrEqual(0);
        expect(c.score).toBeLessThanOrEqual(100);
        // necessities: no fresh water or an unlivable temperature means no viability at all
        if (c.water === 0 || c.comfort === 0) expect(c.score).toBe(0);
        n++;
      }
      rl.list.forEach((l, k) => {
        expect(l.rank).toBe(k + 1);
        expect(l.score).toBeGreaterThan(0);
        if (k > 0) expect(l.score).toBeLessThanOrEqual(rl.list[k - 1].score);
        // a location is its patch's candidate
        expect(rl.byPatch.get(l.patch)!.score).toBe(l.score);
      });
    }
    expect(n).toBeGreaterThan(800);
  });

  it('puts locations on land of their own region, off its land border, and keeps them apart', () => {
    const { w, loc } = setup();
    let n = 0;
    for (const r of landRegions(w, 10)) {
      const rl = loc.get(r);
      const patches = new Set<number>();
      for (const l of rl.list) {
        const c = w.cellAt(l.x, l.y, true);
        expect(c.ocean).toBe(false);
        expect(c.region).toBe(r);
        expect(c.patch).toBe(l.patch);
        expect(l.depth).toBeGreaterThanOrEqual(l.kind === 'city' ? CITY_DEPTH : 1);
        expect(patches.has(l.patch)).toBe(false);
        patches.add(l.patch);
        n++;
      }
      const cities = rl.list.filter((l) => l.kind === 'city');
      for (let a = 0; a < rl.list.length; a++) {
        for (let b = a + 1; b < rl.list.length; b++) {
          const both = rl.list[a].kind === 'city' && rl.list[b].kind === 'city';
          expect(dist(rl.list[a], rl.list[b])).toBeGreaterThanOrEqual(both ? CITY_SPACING * loc.p.spacing : rl.spacing);
        }
      }
      // cities are the best scores that fit: no town deep enough and far enough from every city beats the weakest city
      if (cities.length === loc.p.cities) {
        const weakest = Math.min(...cities.map((c) => c.score));
        for (const t of rl.list) {
          if (t.kind === 'city' || t.depth < CITY_DEPTH) continue;
          if (cities.every((c) => dist(c, t) >= CITY_SPACING * loc.p.spacing)) expect(t.score).toBeLessThanOrEqual(weakest);
        }
      }
    }
    expect(n).toBeGreaterThan(150);
  });

  it('is deterministic and independent of the order the regions are computed in', () => {
    const a = setup();
    const regs = landRegions(a.w, 9);
    const first = new Map(regs.map((r) => [r, digest(a.loc.get(r))]));
    // a fresh world, the regions in reverse, and the neighbours' rivers grown first
    const b = setup();
    for (const r of regs) b.rv.get(r);
    for (const r of regs.slice().reverse()) expect(digest(b.loc.get(r))).toEqual(first.get(r));
  });

  it('does not read the terrain: the same list before and after a tile is computed', () => {
    const { p, w, rv, cl, bio, lk, loc } = setup();
    const [r] = landRegions(w, 1);
    const before = digest(loc.get(r));
    const terrain = new Terrain(w, rv, { ...toTerrainParams(p), res: 2000 });
    terrain.get(r);
    expect(digest(new Locations(w, rv, lk, bio, cl, loc.p).get(r))).toEqual(before);
    // biomes that read tile heights (exact once a tile exists, an estimate before) are refused
    expect(() => new Locations(w, rv, lk, new Biomes(w, rv, cl, terrain, toBiomeParams(p)), cl, loc.p)).toThrow(/terrain-less/);
  });

  it('scores the resources factor on the resource layer: food, water, materials, fish and trade goods', () => {
    const { w, rv, lk, bio, cl, loc } = setup();
    const fish = resourceIndex('fish');
    let n = 0;
    let named = 0;
    let rich = 0;
    let poor = 0;
    let richGoods = 0;
    let poorGoods = 0;
    for (const r of landRegions(w, 12)) {
      const rl = loc.get(r);
      for (const c of rl.candidates) {
        const res = loc.resources.ofPatch(c.patch);
        for (const term of [c.food, c.water, c.materials, c.fish, c.goods]) {
          expect(term).toBeGreaterThanOrEqual(0);
          expect(term).toBeLessThanOrEqual(1);
        }
        expect(c.resources).toBeCloseTo(0.45 * c.food + 0.2 * c.water + 0.15 * c.materials + 0.1 * c.fish + 0.1 * c.goods, 12);
        expect(c.fish).toBe(res.amount[fish]);
        // the patch's own trade goods count in full, so a rich deposit always shows in the term
        expect(c.goods).toBeGreaterThanOrEqual(Math.min(1, res.wealth / 1.2) - 1e-12);
        if (res.wealth >= 0.6) {
          rich++;
          richGoods += c.goods;
        } else {
          poor++;
          poorGoods += c.goods;
        }
        // a rich deposit is named among what stands out: a salt works, a mining town
        for (const h of res.list) {
          const type = RESOURCES[h.resource];
          if (type.kind === 'deposit' && type.id !== 'stone' && h.amount >= 0.5 && h === res.list.filter((x) => RESOURCES[x.resource].kind === 'deposit' && RESOURCES[x.resource].id !== 'stone')[0]) {
            expect(c.features).toContain(type.name.toLowerCase());
            named++;
          }
          expect(h.amount).toBeGreaterThanOrEqual(MIN_AMOUNT);
        }
        n++;
      }
    }
    expect(n).toBeGreaterThan(1500);
    expect(named).toBeGreaterThan(20);
    expect(rich).toBeGreaterThan(20);
    expect(richGoods / rich).toBeGreaterThan(poorGoods / poor + 0.25);
    // the locations read their own layer, or one passed in on the same biomes
    const [r] = landRegions(w, 1);
    const shared = new Resources(w, rv, lk, bio);
    expect(digest(new Locations(w, rv, lk, bio, cl, loc.p, shared).get(r))).toEqual(digest(loc.get(r)));
    expect(() => new Locations(w, rv, lk, bio, cl, loc.p, shared.withBiomes(new Biomes(w, rv, cl, null, bio.p)))).toThrow(/own Biomes/);
  });

  it('a patch with salt, ore or luxuries outscores the same patch without them', () => {
    // all the weight on resources: the score is the resources factor, and trade goods are a tenth of it
    const only: Params = { 'loc.wRes': 1, 'loc.wGeo': 0, 'loc.wTrade': 0, 'loc.wClim': 0, 'loc.wPros': 0 };
    const { w, loc } = setup(only);
    let n = 0;
    for (const r of landRegions(w, 6)) {
      for (const c of loc.get(r).candidates) {
        if (c.need <= 0) continue;
        const without = 0.45 * c.food + 0.2 * c.water + 0.15 * c.materials + 0.1 * c.fish;
        expect(c.score).toBeCloseTo(100 * c.need * (without + 0.1 * c.goods), 9);
        if (c.goods > 0) n++;
      }
    }
    expect(n).toBeGreaterThan(200);
  });

  it('follows the weights: a factor with all the weight ranks the locations', () => {
    for (const [key, factor] of [
      ['loc.wTrade', 'trade'],
      ['loc.wPros', 'prosperity'],
    ] as const) {
      const only: Params = { 'loc.wRes': 0, 'loc.wGeo': 0, 'loc.wTrade': 0, 'loc.wClim': 0, 'loc.wPros': 0, [key]: 1 };
      const { w, loc } = setup(only);
      for (const r of landRegions(w, 3)) {
        for (const c of loc.get(r).candidates) expect(c.score).toBeCloseTo(100 * c.need * c[factor], 9);
      }
    }
    // all weights 0: the five factors count the same
    expect(combine({ resources: 1, geography: 0, trade: 0, climate: 0, prosperity: 0 }, 1, { resources: 0, geography: 0, trade: 0, climate: 0, prosperity: 0 })).toBe(20);
  });

  it('follows the count, city and spacing settings', () => {
    const few = setup({ 'loc.count': 6, 'loc.cities': 2, 'loc.spacing': 40 });
    const none = setup({ 'loc.count': 0 });
    for (const r of landRegions(few.w, 5)) {
      const rl = few.loc.get(r);
      expect(rl.list.length).toBeLessThanOrEqual(6);
      expect(rl.list.filter((l) => l.kind === 'city').length).toBeLessThanOrEqual(2);
      expect(none.loc.get(r).list).toEqual([]);
    }
    // more locations asked for than fit at the spacing: the spacing is relaxed, never below one patch
    const many = setup({ 'loc.count': 60, 'loc.spacing': 40 });
    const [r] = landRegions(many.w, 1);
    const rl = many.loc.get(r);
    expect(rl.spacing).toBeLessThan(40000);
    expect(rl.spacing).toBeGreaterThanOrEqual(many.w.patchLevel.size);
    expect(rl.list.length).toBeGreaterThan(20);
  });

  it('favours water, trade features and farmland over the average patch', () => {
    const { w, loc } = setup();
    const chosen: Location[] = [];
    let all = 0;
    let allRiver = 0;
    let allFood = 0;
    for (const r of landRegions(w, 16)) {
      const rl = loc.get(r);
      chosen.push(...rl.list);
      for (const c of rl.candidates) {
        all++;
        if (c.river >= 2 || c.coast) allRiver++;
        allFood += c.food;
      }
    }
    const share = (f: (l: Location) => boolean, list = chosen) => list.filter(f).length / list.length;
    const cities = chosen.filter((l) => l.kind === 'city');
    // most cities sit on a river or the coast (Bosker & Buringh; Henderson et al.), more often than land at large
    expect(share((l) => l.river >= 2 || l.coast, cities)).toBeGreaterThan(0.6);
    expect(share((l) => l.river >= 2 || l.coast)).toBeGreaterThan(allRiver / all);
    expect(chosen.reduce((a, l) => a + l.food, 0) / chosen.length).toBeGreaterThan(allFood / all);
    // cities outscore towns
    const towns = chosen.filter((l) => l.kind === 'town');
    const mean = (list: Location[]) => list.reduce((a, l) => a + l.score, 0) / list.length;
    expect(mean(cities)).toBeGreaterThan(mean(towns));
  });

  it('the viability threshold keeps the locations at or above a score', () => {
    const { w, loc } = setup();
    const [r] = landRegions(w, 1);
    const list = loc.get(r).list;
    expect(viable(list, 0)).toBe(list);
    const mid = list[Math.floor(list.length / 2)].score;
    const kept = viable(list, mid);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(list.length);
    expect(kept.every((l) => l.score >= mid)).toBe(true);
    expect(viable(list, 101)).toEqual([]);
    // lookups: the nearest location honours the threshold, the candidate of a point is its patch's
    const top = list[0];
    expect(loc.nearest(top.x + 100, top.y, 500)?.patch).toBe(top.patch);
    expect(loc.nearest(top.x + 100, top.y, 500, top.score + 1)).toBeNull();
    expect(loc.candidateAt(top.x, top.y)?.patch).toBe(top.patch);
  });

  it('uses only bit-exact maths', () => {
    const src = readFileSync(new URL('../src/world/locations.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/Math\.(exp|log|log2|log10|pow|sin|cos|tan|hypot|cbrt|atan2?)\b/);
    // no ** operator (comment blocks aside)
    expect(src).not.toMatch(/[\w)\]]\s*\*\*\s*[\w(]/);
  });
});
