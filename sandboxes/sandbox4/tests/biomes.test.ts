import { describe, expect, it } from 'vitest';
import { defaults, toBiomeParams, toClimateParams, toRiverParams, toTerrainParams, toWorldParams } from '../src/params';
import { Biomes, BIOMES, classify, coolingCurve, dryThreshold, OCEAN_BIOME, TYPICAL_HEIGHT, type BiomeId, type BiomeParams } from '../src/world/biomes';
import { Climate } from '../src/world/climate';
import { packKey } from '../src/world/level';
import { Rivers } from '../src/world/rivers';
import { LAND, ownsRegion, regionAt, Terrain } from '../src/world/terrain';
import { World } from '../src/world/world';
import { elevationZoneType } from '../src/world/zones';

const SEED = 12345;
const id = (k: number) => BIOMES[k].id;
/** Cooling points of a straight line through 0 with this many °C per km. */
const perKm = (r: number): Pick<BiomeParams, 'coolH' | 'coolT'> => ({ coolH: [0, 500, 1000, 1500, 2000], coolT: [0, 500, 1000, 1500, 2000].map((h) => (r * h) / 1000) });

const setup = (over: Partial<BiomeParams> = {}, withTerrain = false) => {
  const d = defaults();
  const w = new World(toWorldParams(d, SEED));
  const rv = new Rivers(w, toRiverParams(d, SEED));
  const cl = new Climate(toClimateParams(d, SEED));
  // 2 km cells keep the terrain quick; the pipeline is the same at every resolution
  const t = withTerrain ? new Terrain(w, rv, { ...toTerrainParams(d), res: 2000 }) : null;
  return { w, rv, cl, t, b: new Biomes(w, rv, cl, t, { ...toBiomeParams(d), ...over }) };
};

/** The (merged) subbiomes under a grid over a square around the origin. */
function subsAround(w: World, half: number, step: number): number[] {
  const out = new Set<number>();
  for (let y = -half; y < half; y += step) for (let x = -half; x < half; x += step) out.add(w.cellAt(x, y, true).sub);
  return [...out];
}

describe('biome classification', () => {
  it('follows the thermal belts and the aridity classes', () => {
    const cases: [number, number, BiomeId][] = [
      [-15, 500, 'ice'],
      [-5, 500, 'tundra'],
      [0, 100, 'coldSteppe'],
      [0, 600, 'taiga'],
      [12, 150, 'coldDesert'],
      [0, 50, 'coldDesert'],
      [12, 300, 'grassland'],
      [12, 600, 'shrubland'],
      [6, 1000, 'mixedForest'],
      [12, 1200, 'broadleaf'],
      [12, 3000, 'tempRainforest'],
      [25, 150, 'hotDesert'],
      [25, 500, 'thornScrub'],
      [25, 1000, 'savanna'],
      [25, 2000, 'dryForest'],
      [25, 4000, 'rainforest'],
    ];
    for (const [t, p, want] of cases) expect(id(classify(t, p).biome), `${t} °C, ${p} mm`).toBe(want);
  });

  it('uses Köppen’s dryness threshold: the same rain is drier where it is warmer', () => {
    expect(dryThreshold(10)).toBe(340);
    expect(dryThreshold(-20)).toBe(40);
    expect(classify(10, 500).aridity).toBeGreaterThan(classify(25, 500).aridity);
    // 500 mm is woodland at 10 °C but thorn scrub at 25 °C
    expect(id(classify(10, 500).biome)).toBe('shrubland');
    expect(id(classify(25, 500).biome)).toBe('thornScrub');
  });

  it('never gets drier with more rain or warmer with less heat', () => {
    for (let t = -20; t <= 35; t += 0.5) {
      let last = -1;
      for (let p = 10; p <= 12000; p *= 1.05) {
        const c = classify(t, p);
        expect(c.moisture).toBeGreaterThanOrEqual(last);
        last = c.moisture;
      }
    }
    for (let p = 10; p <= 12000; p *= 1.3) {
      let last = -1;
      for (let t = -20; t <= 35; t += 0.25) {
        const c = classify(t, p);
        expect(c.belt).toBeGreaterThanOrEqual(last);
        last = c.belt;
      }
    }
  });
});

describe('cooling curve', () => {
  it('passes through its points, in any order, and is monotone between them', () => {
    const hs = [1000, 0, 2000, 300, 600];
    const cs = [5, 0, 9, 2, 3];
    const f = coolingCurve(hs, cs);
    hs.forEach((h, i) => expect(f(h)).toBeCloseTo(cs[i], 12));
    let last = -Infinity;
    for (let h = 0; h <= 2000; h += 5) {
      expect(f(h)).toBeGreaterThanOrEqual(last - 1e-12);
      last = f(h);
    }
  });

  it('holds the first point below it and continues the last slope above the last point', () => {
    const f = coolingCurve([100, 400, 800, 1200, 1600], [1, 2, 4, 7, 9]);
    expect(f(0)).toBe(1);
    expect(f(50)).toBe(1);
    // last segment: 2 °C over 400 m
    expect(f(2000)).toBeCloseTo(11, 12);
    expect(f(3600)).toBeCloseTo(19, 12);
  });

  it('defaults to the standard atmosphere, 6.5 °C per km', () => {
    const p = toBiomeParams(defaults());
    const f = coolingCurve(p.coolH, p.coolT);
    for (const h of [0, 50, 137, 470, 999, 1500, 2000, 2500, 4000]) expect(f(h)).toBeCloseTo((6.5 * h) / 1000, 9);
  });
});

describe('biomes of the subbiomes', { timeout: 60_000 }, () => {
  it('gives every land subbiome a land biome and every ocean subbiome the ocean', () => {
    const { w, b } = setup();
    let land = 0;
    let ocean = 0;
    for (const s of subsAround(w, 400_000, 4000)) {
      const info = b.ofSub(s);
      if (w.subCell(s).ocean) {
        ocean++;
        expect(info.biome).toBe(OCEAN_BIOME);
      } else {
        land++;
        expect(info.biome).not.toBe(OCEAN_BIOME);
      }
    }
    expect(land).toBeGreaterThan(500);
    expect(ocean).toBeGreaterThan(50);
  });

  it('is a pure function of the seed, the parameters and the subbiome', () => {
    const a = setup().b;
    const c = setup().b;
    const subs = subsAround(a.world, 300_000, 6000);
    // read the second one in reverse order, so caching cannot matter
    const fromC = new Map([...subs].reverse().map((s) => [s, c.ofSub(s)]));
    for (const s of subs) expect(a.ofSub(s)).toEqual(fromC.get(s));
  });

  it('reads the climate at the subbiome’s site and cools it with its height', () => {
    const { w, cl, b } = setup(perKm(5));
    for (const s of subsAround(w, 300_000, 9000)) {
      const info = b.ofSub(s);
      if (info.ocean) continue;
      const site = w.sub(w.subCell(s).sub);
      expect(info.t0).toBe(cl.temperatureAt(site.x, site.y));
      expect(info.p0).toBe(cl.precipitationAt(site.x, site.y));
      // no terrain: the typical height of the elevation zone type stands in
      expect(info.heightExact).toBe(false);
      expect(info.height).toBe(TYPICAL_HEIGHT[elevationZoneType(w.subCell(s).elevationZone, false)]);
      expect(info.cooling).toBeCloseTo((5 * info.height) / 1000, 9);
      expect(info.t).toBe(info.t0 - info.cooling);
      expect(info.seaLevel).toBe(classify(info.t0, info.p).biome);
    }
  });

  it('a steeper cooling curve turns high ground colder (more tundra, ice and taiga)', () => {
    const cold = (b: Biomes, subs: number[]) => subs.filter((s) => ['ice', 'tundra', 'taiga'].includes(id(b.ofSub(s).biome))).length;
    const { w, rv, cl } = setup();
    const subs = subsAround(w, 800_000, 8000);
    const flat = new Biomes(w, rv, cl, null, { ...perKm(0), sparseDry: 1 });
    const steep = new Biomes(w, rv, cl, null, { ...perKm(12), sparseDry: 1 });
    expect(cold(steep, subs)).toBeGreaterThan(cold(flat, subs));
    for (const s of subs) expect(steep.ofSub(s).belt).toBeLessThanOrEqual(flat.ofSub(s).belt);
  });

  it('river-poor (sparse) flat zones are drier and favour desert', () => {
    const { w, rv, cl } = setup();
    const subs = subsAround(w, 1_200_000, 6000);
    const wet = new Biomes(w, rv, cl, null, { ...toBiomeParams(defaults()), sparseDry: 1 });
    const dry = new Biomes(w, rv, cl, null, toBiomeParams(defaults()));
    const desert = (k: number) => id(k) === 'hotDesert' || id(k) === 'coldDesert';
    let sparse = 0;
    let desertWet = 0;
    let desertDry = 0;
    let desertElsewhere = 0;
    let elsewhere = 0;
    for (const s of subs) {
      const a = wet.ofSub(s);
      const c = dry.ofSub(s);
      expect(c.sparse).toBe(!c.ocean && rv.isSparseFlat(w.subCell(s).elevationZone));
      if (c.ocean) continue;
      if (c.sparse) {
        sparse++;
        expect(c.p).toBeCloseTo(c.p0 * dry.p.sparseDry, 9);
        expect(c.moisture).toBeLessThanOrEqual(a.moisture);
        if (desert(a.biome)) desertWet++;
        if (desert(c.biome)) desertDry++;
      } else {
        elsewhere++;
        expect(c.p).toBe(c.p0);
        if (desert(c.biome)) desertElsewhere++;
      }
    }
    expect(sparse).toBeGreaterThan(300);
    // at the defaults most sparse flat subbiomes are desert, against a few percent elsewhere
    expect(desertDry / sparse).toBeGreaterThan(0.5);
    expect(desertDry).toBeGreaterThan(3 * desertWet);
    expect(desertElsewhere / elsewhere).toBeLessThan(0.1);
  });

  it('takes the subbiome’s mean land height from its terrain tile once it is computed', () => {
    const { w, t, b } = setup({}, true);
    const tile = t!.getTile(packKey(0, 0));
    expect(tile.subKeys.length).toBeGreaterThan(50);
    expect(tile.subH.length).toBe(tile.subKeys.length);
    // the tile's means are the means of the subbiomes' owned land cells (cropping keeps them all)
    const sum = new Map<number, number>();
    const cnt = new Map<number, number>();
    for (let j = 0; j < tile.ny; j++) {
      for (let i = 0; i < tile.nx; i++) {
        const q = j * tile.nx + i;
        if (tile.cls[q] !== LAND || !ownsRegion(tile, regionAt(tile, q))) continue;
        const s = w.cellAt(tile.x0 + i * tile.res, tile.y0 + j * tile.res, true).sub;
        sum.set(s, (sum.get(s) ?? 0) + tile.h[q]);
        cnt.set(s, (cnt.get(s) ?? 0) + 1);
      }
    }
    expect(sum.size).toBe(tile.subKeys.length);
    for (let n = 0; n < tile.subKeys.length; n++) {
      const s = tile.subKeys[n];
      expect(tile.subH[n]).toBeCloseTo(sum.get(s)! / cnt.get(s)!, 2);
      const info = b.ofSub(s);
      expect(info.heightExact).toBe(true);
      expect(info.height).toBe(Math.max(0, tile.subH[n]));
      expect(info.t).toBe(info.t0 - b.cooling(info.height));
    }
  });

  it('switches an estimated subbiome to its exact height when the tile arrives', () => {
    const { w, t, b } = setup({}, true);
    const rk = packKey(0, 0);
    const land = subsAround(w, 200_000, 4000).find((s) => {
      const c = w.subCell(s);
      return !c.ocean && t!.tileOf(c.region) === t!.tileOf(rk);
    })!;
    expect(land).toBeDefined();
    expect(b.ofSub(land).heightExact).toBe(false);
    t!.getTile(t!.tileOf(rk));
    expect(b.ofSub(land).heightExact).toBe(true);
  });
});
