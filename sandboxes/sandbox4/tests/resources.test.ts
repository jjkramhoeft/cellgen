import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { testParams } from './fixture';
import { toBiomeParams, toClimateParams, toLakeParams, toRiverParams, toTerrainParams, toWorldParams } from '../src/params';
import type { Params } from '@shared/params/schema';
import { Biomes, BIOMES, classify, type BiomeId, type BiomeInfo } from '../src/world/biomes';
import { Climate } from '../src/world/climate';
import { Lakes } from '../src/world/lakes';
import { keyI, keyJ, packKey } from '../src/world/level';
import { BEDROCKS, bedrockOf, foodOf, landResources, MIN_AMOUNT, oceanResources, resourceIndex, RESOURCES, Resources, wealthOf, type BedrockId, type PatchResources, type PatchSite, type ResourceId } from '../src/world/resources';
import { Rivers } from '../src/world/rivers';
import { Terrain } from '../src/world/terrain';
import { World } from '../src/world/world';
import { ELEVATION_ZONE_TYPES } from '../src/world/zones';

const SEED = 12345;

function setup(over: Params = {}, seed = SEED) {
  const p = { ...testParams(), ...over };
  const w = new World(toWorldParams(p, seed));
  const rv = new Rivers(w, toRiverParams(p, seed));
  const cl = new Climate(toClimateParams(p, seed));
  const bio = new Biomes(w, rv, cl, null, toBiomeParams(p));
  const lk = new Lakes(w, rv, bio, toLakeParams(p));
  const res = new Resources(w, rv, lk, bio);
  return { p, w, rv, cl, bio, lk, res };
}

/** Regions around the origin with some land (lattice order). */
function landRegions(w: World, n: number, half = 400000): number[] {
  const out: number[] = [];
  for (const r of World.cellsIn(w.regionLevel, -half, -half, half, half, 0)) {
    if (w.region(r).elevationZones.some((b) => !w.elevationZoneCell(b).ocean)) out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

const R = (id: ResourceId) => resourceIndex(id);
const ZONE = (id: string) => ELEVATION_ZONE_TYPES.findIndex((t) => t.id === id);
const ROCK = (id: BedrockId) => BEDROCKS.findIndex((b) => b.id === id);
const biomeId = (b: BiomeInfo): BiomeId => BIOMES[b.biome].id;
const listed = (r: PatchResources, id: ResourceId) => r.list.find((h) => h.resource === R(id));
const SITE: PatchSite = { river: 0, mouth: 0, lake: 0, harbour: false, goldLoad: 0, tinLoad: 0 };

/** A biome record for a made-up land patch: sea-level temperature t0, temperature t, precipitation p, zone type. */
function info(t: number, p: number, zone: string, over: Partial<BiomeInfo> = {}): BiomeInfo {
  const k = classify(t, p);
  return { ...k, key: packKey(7, 9), level: 'patch', ocean: false, zoneType: ZONE(zone), x: 0, y: 0, t0: t, p0: p, height: 100, heightExact: true, cooling: 0, t, p, sparse: false, coastal: false, seaLevel: k.biome, ...over };
}

/** The resources of every land patch drawn in some regions, with its biome record. */
function survey(s: ReturnType<typeof setup>, regions: number[]) {
  const out: { r: PatchResources; b: BiomeInfo; region: number; zone: number }[] = [];
  for (const rk of regions) for (const pk of s.res.sites(rk).keys()) out.push({ r: s.res.ofPatch(pk), b: s.bio.ofPatch(pk), region: rk, zone: s.w.patchCell(pk).elevationZone });
  return out;
}

describe('patch resources', { timeout: 120_000 }, () => {
  it('has 24 raw resources in seven groups, each with an index', () => {
    expect(RESOURCES.length).toBe(24);
    expect(new Set(RESOURCES.map((r) => r.id)).size).toBe(24);
    expect(new Set(RESOURCES.map((r) => r.group)).size).toBe(7);
    RESOURCES.forEach((r, k) => expect(resourceIndex(r.id)).toBe(k));
  });

  it('gives every land patch amounts in [0, 1] with a variant, and lists the ones from the minimum, largest first', () => {
    const s = setup();
    const all = survey(s, landRegions(s.w, 12));
    expect(all.length).toBeGreaterThan(1500);
    let withSome = 0;
    let total = 0;
    for (const { r, b } of all) {
      expect(r.ocean).toBe(false);
      expect(r.patch).toBe(b.key);
      expect(r.amount.length).toBe(RESOURCES.length);
      r.amount.forEach((a, k) => {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
        // a variant names every amount, and only those
        expect(r.variant[k] !== '').toBe(a > 0);
      });
      expect(r.list.map((h) => h.resource).sort((x, y) => x - y)).toEqual(r.amount.flatMap((a, k) => (a >= MIN_AMOUNT ? [k] : [])));
      r.list.forEach((h, k) => {
        expect(h.amount).toBe(r.amount[h.resource]);
        expect(h.variant).toBe(r.variant[h.resource]);
        if (k > 0) expect(h.amount).toBeLessThanOrEqual(r.list[k - 1].amount);
      });
      expect(r.food).toBe(foodOf(r.amount));
      expect(r.wealth).toBe(wealthOf(r.amount));
      if (r.list.length) withSome++;
      total += r.list.length;
    }
    // nearly every land patch has something (inland ice is bare), and a handful of resources, not all 24
    expect(withSome / all.length).toBeGreaterThan(0.97);
    expect(total / all.length).toBeGreaterThan(4);
    expect(total / all.length).toBeLessThan(12);
    // every resource occurs somewhere
    const seen = new Set(all.flatMap(({ r }) => r.list.map((h) => h.resource)));
    expect(seen.size).toBeGreaterThanOrEqual(22);
  });

  it('selects resources that fit the biome, the climate and the position', () => {
    const s = setup();
    const all = survey(s, landRegions(s.w, 20));
    const forest = new Set<BiomeId>(['taiga', 'mixedForest', 'broadleaf', 'tempRainforest', 'rainforest']);
    const share = (rows: typeof all, id: ResourceId) => rows.filter(({ r }) => listed(r, id)).length / Math.max(1, rows.length);
    for (const { r, b } of all) {
      const id = biomeId(b);
      const v = (res: ResourceId) => listed(r, res)?.variant;
      // nothing grows on the ice or the tundra, forests have timber and fuel, bare deserts have neither
      if (id === 'ice' || id === 'tundra') for (const crop of ['grain', 'produce', 'orchard', 'fibre', 'spices'] as const) expect(listed(r, crop)).toBeUndefined();
      if (forest.has(id)) {
        expect(r.amount[R('timber')]).toBeGreaterThanOrEqual(0.8);
        expect(r.amount[R('fuel')]).toBeGreaterThanOrEqual(0.7);
      }
      if ((id === 'hotDesert' || id === 'coldDesert' || id === 'ice') && r.site.river < 2) expect(listed(r, 'timber')).toBeUndefined();
      // luxuries are climate-locked: spices to the tropical belt, sable and beaver to the cold forests
      if (listed(r, 'spices')) expect(b.t).toBeGreaterThanOrEqual(18);
      if (v('furs') === 'sable and marten' || v('furs') === 'beaver') expect(['taiga', 'mixedForest', 'tempRainforest']).toContain(id);
      // crops in their climates
      if (v('orchard') === 'date palm') expect(b.t).toBeGreaterThanOrEqual(17);
      if (v('orchard') === 'olive') {
        expect(b.t).toBeGreaterThanOrEqual(10);
        expect(b.t).toBeLessThanOrEqual(23);
      }
      if (v('orchard') === 'coconut') expect(b.coastal).toBe(true);
      if (v('grain') === 'paddy rice') expect(b.t).toBeGreaterThanOrEqual(10);
      if (v('grain') === 'rye' || v('grain') === 'oats') expect(b.t).toBeLessThanOrEqual(15);
      if (v('livestock') === 'herded reindeer') expect(['tundra', 'taiga']).toContain(id);
      if (v('timber') === 'mangrove timber') expect(id).toBe('mangrove');
      // the sea's goods only on the coast
      if (v('salt') === 'solar sea salt') {
        expect(b.coastal).toBe(true);
        expect(b.aridity).toBeLessThan(1);
      }
      for (const sea of ['cod banks', 'herring', 'sardine and anchovy', 'reef fish and shellfish', 'tuna and large pelagics', 'salmon runs']) if (v('fish') === sea) expect(b.coastal).toBe(true);
      if (v('fish') === 'lake fish') expect(r.site.lake).toBeGreaterThan(0);
      if (b.coastal && id !== 'ice') expect(r.amount[R('fish')]).toBeGreaterThanOrEqual(0.8);
    }
    // stone is a deficit of the flat land; grain belongs to the temperate farmland, not the taiga
    const zone = (z: string) => all.filter(({ b }) => b.zoneType === ZONE(z));
    expect(share([...zone('hills'), ...zone('mountains')], 'stone')).toBeGreaterThan(0.6);
    expect(share(zone('flat'), 'stone')).toBeLessThan(0.2);
    const biome = (id: BiomeId) => all.filter(({ b }) => biomeId(b) === id);
    expect(share([...biome('broadleaf'), ...biome('mixedForest')], 'grain')).toBeGreaterThan(0.7);
    expect(share(biome('taiga'), 'grain')).toBeLessThan(0.3);
    expect(share([...biome('grassland'), ...biome('coldSteppe')], 'horses')).toBeGreaterThan(0.9);
  });

  it('a river irrigates dry land, and the uplands shed placer gold into it', () => {
    // a hot desert plain: nothing grows without water, wheat and dates do along a large river
    const desert = info(26, 150, 'flat');
    expect(BIOMES[desert.biome].id).toBe('hotDesert');
    const dry = landResources(SEED, desert, packKey(1, 1), ROCK('alluvium'), SITE);
    const wet = landResources(SEED, desert, packKey(1, 1), ROCK('alluvium'), { ...SITE, river: 20 });
    expect(dry.food).toBeLessThan(0.1);
    expect(listed(dry, 'grain')).toBeUndefined();
    expect(wet.food).toBeGreaterThan(dry.food + 0.3);
    expect(listed(wet, 'grain')).toBeDefined();
    expect(listed(wet, 'orchard')?.variant).toBe('date palm');
    expect(listed(wet, 'timber')?.variant).toBe('poplar');
    // the same temperate lowland with and without a gold-bearing river upstream, over many patches
    let plain = 0;
    let below = 0;
    for (let k = 0; k < 400; k++) {
      const b = info(11, 800, 'lowland', { key: packKey(k, 3) });
      if (listed(landResources(SEED, b, packKey(1, 1), ROCK('alluvium'), { ...SITE, river: 5 }), 'gold')) plain++;
      const g = listed(landResources(SEED, b, packKey(1, 1), ROCK('alluvium'), { ...SITE, river: 5, goldLoad: 0.8 }), 'gold');
      if (g) {
        below++;
        expect(g.variant).toBe('placer gold');
      }
    }
    expect(plain).toBe(0);
    expect(below).toBeGreaterThan(30);
    expect(below).toBeLessThan(110);
  });

  it('reads rivers, mouths, lakes, harbours and upland loads per region', () => {
    const s = setup();
    let rivers = 0;
    let lakes = 0;
    let gold = 0;
    let n = 0;
    for (const rk of landRegions(s.w, 12)) {
      const sites = s.res.sites(rk);
      for (const [pk, site] of sites) {
        const c = s.w.patchCell(pk);
        expect(c.ocean).toBe(false);
        expect(c.region).toBe(rk);
        expect(c.patch).toBe(pk);
        expect(site.river).toBeGreaterThanOrEqual(site.mouth);
        for (const load of [site.goldLoad, site.tinLoad]) {
          expect(load).toBeGreaterThanOrEqual(0);
          expect(load).toBeLessThanOrEqual(1);
        }
        expect(site.goldLoad + site.tinLoad).toBeLessThanOrEqual(1);
        if (site.river === 0) expect(site.goldLoad + site.tinLoad).toBe(0);
        if (site.harbour) expect(s.bio.ofPatch(pk).coastal).toBe(true);
        if (site.river > 0) rivers++;
        if (site.lake > 0) lakes++;
        if (site.goldLoad > 0) gold++;
        n++;
      }
      // a lake is recorded on its host patch
      for (const l of s.lk.get(rk).lakes) expect(sites.get(l.patch)!.lake).toBeGreaterThanOrEqual(l.area);
    }
    expect(rivers / n).toBeGreaterThan(0.5);
    expect(lakes).toBeGreaterThan(5);
    expect(gold).toBeGreaterThan(10);
  });

  it('gives every land zone one bedrock by its zone type, and keeps tin and copper in different zones', () => {
    // the classes follow the weights of the zone type
    for (const zone of ['flat', 'lowland', 'hills', 'mountains']) {
      const zt = ZONE(zone);
      const col = ['flat', 'lowland', 'hills', 'mountains'].indexOf(zone);
      const count = BEDROCKS.map(() => 0);
      const N = 6000;
      for (let k = 0; k < N; k++) count[bedrockOf(SEED, packKey(k % 97, Math.floor(k / 97) - 30), zt)]++;
      const total = BEDROCKS.reduce((a, b) => a + b.weights[col], 0);
      BEDROCKS.forEach((b, k) => {
        if (b.weights[col] === 0) expect(count[k]).toBe(0);
        else expect(Math.abs(count[k] / N - b.weights[col] / total)).toBeLessThan(0.03);
      });
    }
    expect(bedrockOf(SEED, packKey(3, 4), ZONE('ocean'))).toBe(-1);
    expect(bedrockOf(SEED, packKey(3, 4), ZONE('hills'))).toBe(bedrockOf(SEED, packKey(3, 4), ZONE('hills')));

    const s = setup();
    const all = survey(s, landRegions(s.w, 40, 600000));
    const zones = new Map<number, { rock: number; has: Set<number> }>();
    for (const { r, b, zone } of all) {
      expect(r.bedrock).toBe(s.res.bedrock(zone));
      expect(r.bedrock).toBe(bedrockOf(s.w.p.seed, zone, b.zoneType));
      let z = zones.get(zone);
      if (!z) zones.set(zone, (z = { rock: r.bedrock, has: new Set() }));
      expect(z.rock).toBe(r.bedrock);
      for (const h of r.list) z.has.add(h.resource);
      // lodes sit in their own rocks
      if (listed(r, 'tin')?.variant === 'tin lode') expect(BEDROCKS[r.bedrock].id).toBe('granite');
      if (listed(r, 'copperOre')) expect(['volcanic', 'basalt', 'ophiolite', 'clastic']).toContain(BEDROCKS[r.bedrock].id);
      if (listed(r, 'gold')?.variant === 'placer gold') {
        expect(r.site.river).toBeGreaterThanOrEqual(1);
        expect(r.site.goldLoad).toBeGreaterThan(0);
        expect(b.zoneType).not.toBe(ZONE('mountains'));
      }
    }
    let tin = 0;
    let copper = 0;
    for (const z of zones.values()) {
      if (z.has.has(R('tin'))) tin++;
      if (z.has.has(R('copperOre'))) copper++;
      expect(z.has.has(R('tin')) && z.has.has(R('copperOre'))).toBe(false);
    }
    expect(copper).toBeGreaterThan(5);
    expect(tin).toBeGreaterThan(0);
    expect(tin).toBeLessThan(copper);
  });

  it('keeps salt, metals and gems scarce: many regions have to trade for them', () => {
    const s = setup();
    const regions = landRegions(s.w, 40, 600000);
    const all = survey(s, regions);
    const share = (id: ResourceId) => all.filter(({ r }) => listed(r, id)).length / all.length;
    const without = (id: ResourceId) => regions.filter((rk) => !all.some((x) => x.region === rk && listed(x.r, id))).length / regions.length;
    // salt is the archetypal trade good: about half of the regions have none
    expect(share('salt')).toBeLessThan(0.025);
    expect(share('salt')).toBeGreaterThan(0.002);
    expect(without('salt')).toBeGreaterThanOrEqual(0.4);
    for (const id of ['copperOre', 'tin', 'silverLead', 'gold', 'gems', 'crystal'] as const) expect(share(id)).toBeLessThan(0.03);
    expect(share('tin')).toBeLessThan(share('copperOre'));
    expect(without('tin')).toBeGreaterThan(0.6);
    // iron is the common metal
    expect(share('ironOre')).toBeGreaterThan(share('copperOre'));
    // the land's staples are everywhere
    for (const id of ['livestock', 'clay', 'timber', 'fuel'] as const) expect(share(id)).toBeGreaterThan(0.5);
  });

  it('gives ocean patches fish, more on the shelf, and the right catch for the water', () => {
    const shelf = oceanResources(SEED, packKey(2, 2), 2, true);
    const open = oceanResources(SEED, packKey(2, 2), 2, false);
    const warm = oceanResources(SEED, packKey(2, 2), 25, true);
    expect(shelf.ocean).toBe(true);
    expect(shelf.bedrock).toBe(-1);
    expect(shelf.amount[R('fish')]).toBeGreaterThan(open.amount[R('fish')]);
    expect(listed(shelf, 'fish')?.variant).toBe('cod banks');
    expect(listed(shelf, 'furs')?.variant).toBe('seals');
    expect(listed(open, 'furs')?.variant).toBe('whales');
    expect(listed(warm, 'fish')?.variant).toBe('reef fish and shellfish');
    expect(listed(warm, 'furs')).toBeUndefined();
    // no land resources at sea
    for (const id of ['grain', 'timber', 'stone', 'ironOre', 'livestock'] as const) expect(shelf.amount[R(id)]).toBe(0);
    // pearls only in warm shelf water, and only in some patches
    let pearls = 0;
    for (let k = 0; k < 500; k++) {
      if (listed(oceanResources(SEED, packKey(k, 5), 25, true), 'gems')) pearls++;
      expect(listed(oceanResources(SEED, packKey(k, 5), 25, false), 'gems')).toBeUndefined();
      expect(listed(oceanResources(SEED, packKey(k, 5), 5, true), 'gems')).toBeUndefined();
    }
    expect(pearls).toBeGreaterThan(5);
    expect(pearls).toBeLessThan(60);

    // on the map: every ocean patch lists fish, and one next to land is on the shelf
    const s = setup();
    let ocean = 0;
    let onShelf = 0;
    for (const pk of World.cellsIn(s.w.patchLevel, -300000, -300000, 300000, 300000, 0)) {
      const c = s.w.patchCell(pk);
      if (!c.ocean) continue;
      const r = s.res.ofPatch(pk);
      expect(r.ocean).toBe(true);
      expect(r.patch).toBe(c.patch);
      expect(listed(r, 'fish')).toBeDefined();
      const nextToLand = s.w.patchNbrs(s.w.patch(pk)).some((q) => !s.w.patchCell(q).ocean);
      if (nextToLand) expect(r.amount[R('fish')]).toBe(0.9);
      if (r.amount[R('fish')] === 0.9) onShelf++;
      ocean++;
    }
    expect(ocean).toBeGreaterThan(300);
    expect(onShelf).toBeGreaterThan(20);
    expect(onShelf).toBeLessThan(ocean);
  });

  it('is deterministic and independent of the order the regions are computed in', () => {
    const digest = (s: ReturnType<typeof setup>, rk: number) => [...s.res.sites(rk).keys()].sort((a, b) => a - b).map((pk) => [pk, s.res.ofPatch(pk).amount, s.res.ofPatch(pk).variant]);
    const a = setup();
    const regs = landRegions(a.w, 6);
    const first = new Map(regs.map((r) => [r, digest(a, r)]));
    // a fresh world, the regions in reverse, and the neighbours' rivers grown first
    const b = setup();
    for (const r of regs) b.rv.get(r);
    for (const r of regs.slice().reverse()) expect(digest(b, r)).toEqual(first.get(r));
    // another seed gives other deposits
    const c = setup({}, SEED + 1);
    expect(landRegions(c.w, 1).map((r) => digest(c, r))).not.toEqual([first.get(regs[0])]);
  });

  it('follows the biomes it is built on: zone-typical heights, or the exact ones once a tile is computed', () => {
    const s = setup();
    const [rk] = landRegions(s.w, 1);
    const patches = [...s.res.sites(rk).keys()];
    const before = patches.map((pk) => s.res.ofPatch(pk).amount);
    const terrain = new Terrain(s.w, s.rv, { ...toTerrainParams(s.p), res: 2000 });
    const exact = new Biomes(s.w, s.rv, s.cl, terrain, toBiomeParams(s.p));
    const onMap = s.res.withBiomes(exact);
    // the map's layer shares the river and lake sites
    expect(onMap.sites(rk)).toBe(s.res.sites(rk));
    // before the tile: the estimate, the same as the terrain-less layer, and not kept
    expect(patches.map((pk) => onMap.ofPatch(pk).amount)).toEqual(before);
    terrain.get(rk);
    let changed = 0;
    for (const [k, pk] of patches.entries()) {
      const b = exact.ofPatch(pk);
      expect(b.heightExact).toBe(true);
      const r = onMap.ofPatch(pk);
      expect(r.amount).toEqual(landResources(s.w.p.seed, b, s.w.patchCell(pk).elevationZone, r.bedrock, r.site).amount);
      if (r.amount.some((a, i) => a !== before[k][i])) changed++;
    }
    // exact heights move the climate of some patches, and with it their crops
    expect(changed).toBeGreaterThan(0);
    // the terrain-less layer never changes as tiles arrive
    expect(patches.map((pk) => s.res.ofPatch(pk).amount)).toEqual(before);
    expect(patches.map((pk) => new Resources(s.w, s.rv, s.lk, s.bio).ofPatch(pk).amount)).toEqual(before);
  });

  it('any key of a merged patch gives the resources of its root', () => {
    const s = setup();
    let merged = 0;
    for (const pk of World.cellsIn(s.w.patchLevel, -200000, -200000, 200000, 200000, 0)) {
      const root = s.w.patchRoot(pk);
      if (root === pk) continue;
      expect(s.res.ofPatch(pk)).toBe(s.res.ofPatch(root));
      expect(s.res.ofPatch(pk).patch).toBe(root);
      merged++;
    }
    expect(merged).toBeGreaterThan(50);
    expect(keyI(packKey(3, -4))).toBe(3);
    expect(keyJ(packKey(3, -4))).toBe(-4);
  });

  it('uses only bit-exact maths', () => {
    const src = readFileSync(new URL('../src/world/resources.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/Math\.(exp|log|log2|log10|pow|sin|cos|tan|hypot|cbrt|atan2?|sqrt|random)\b/);
    // no ** operator (comment blocks aside)
    expect(src).not.toMatch(/[\w)\]]\s*\*\*\s*[\w(]/);
  });
});
