import { describe, expect, it } from 'vitest';
import { testParams } from './fixture';
import { toBiomeParams, toClimateParams, toRiverParams, toTerrainParams, toWorldParams } from '../src/params';
import { Biomes, OCEAN_BIOME } from '../src/world/biomes';
import { Climate } from '../src/world/climate';
import { computeMapStats, HIST_BINS, MAX_SAMPLES, MapStatsJob, type Rect } from '../src/world/mapstats';
import { Rivers } from '../src/world/rivers';
import { Terrain } from '../src/world/terrain';
import { World } from '../src/world/world';
import { OCEAN_ZONE } from '../src/world/zones';

const SEED = 4242;

const setup = (withTerrain = false) => {
  const d = testParams();
  const w = new World(toWorldParams(d, SEED));
  const rv = new Rivers(w, toRiverParams(d, SEED));
  const cl = new Climate(toClimateParams(d, SEED));
  // 2 km cells keep the terrain quick
  const t = withTerrain ? new Terrain(w, rv, { ...toTerrainParams(d), res: 2000 }) : null;
  return { w, t, b: new Biomes(w, rv, cl, t, toBiomeParams(d)) };
};

const square = (half: number): Rect => ({ x0: -half, y0: -half, x1: half, y1: half });
const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);

describe('map statistics', { timeout: 60_000 }, () => {
  it('accounts for every sample in the biome, zone and climate tallies', () => {
    const { w, b } = setup();
    const s = computeMapStats(w, b, null, square(200_000));
    expect(s.samples).toBe(s.land + s.ocean);
    expect(s.stride).toBe(1);
    expect(sum(s.biomeSamples)).toBe(s.samples);
    expect(sum(s.zoneSamples)).toBe(s.samples);
    expect(s.biomeSamples[OCEAN_BIOME]).toBe(s.ocean);
    expect(s.zoneSamples[OCEAN_ZONE]).toBe(s.ocean);
    expect(sum(s.grid.flat())).toBe(s.land);
    expect(s.patches).toBe(sum(s.biomePatches));
    expect(s.zones).toBe(sum(s.zoneCount));
    expect(s.land).toBeGreaterThan(0);
    for (const d of [s.t0, s.p0, s.t, s.p]) {
      expect(d.bins).toHaveLength(HIST_BINS);
      expect(sum(d.bins)).toBe(d.n);
      expect(d.min!.v).toBeLessThanOrEqual(d.mean);
      expect(d.mean).toBeLessThanOrEqual(d.max!.v);
    }
    expect(s.t0.n).toBe(s.samples);
    expect(s.t.n).toBe(s.land);
    // the height cooling never warms: land is no warmer than the sea-level maximum
    expect(s.t.max!.v).toBeLessThanOrEqual(s.t0.max!.v);
    // no terrain: no heights, only estimates
    expect(s.height.n).toBe(0);
    expect(s.coverage).toBe(0);
    expect(s.exactHeight).toBe(0);
  });

  it('is deterministic, and the same in time slices as in one go', () => {
    const rect = square(150_000);
    const a = setup();
    const one = computeMapStats(a.w, a.b, null, rect);
    const c = setup();
    const job = new MapStatsJob(c.w, c.b, null, rect);
    let slices = 0;
    while (!job.step(0)) slices++;
    expect(slices).toBeGreaterThan(1);
    const sliced = job.result!;
    expect({ ...sliced, ms: 0 }).toEqual({ ...one, ms: 0 });
  });

  it('strides over large areas to stay under the sample budget', () => {
    const { w, b } = setup();
    const job = new MapStatsJob(w, b, null, square(2_000_000));
    expect(job.stride).toBeGreaterThan(1);
    // only the constructor's arithmetic is checked here: running it would take a while
    const cells = (Math.floor(2_000_000 / w.patchLevel.size) - Math.floor(-2_000_000 / w.patchLevel.size) + 1) ** 2;
    expect(Math.ceil(Math.sqrt(cells / job.stride ** 2))).toBeLessThanOrEqual(Math.ceil(Math.sqrt(MAX_SAMPLES)) + 1);
  });

  it('reads heights from computed terrain tiles only, inside the rectangle', () => {
    const { w, t, b } = setup(true);
    const rect = square(60_000);
    const before = computeMapStats(w, b, t, rect);
    expect(before.height.n + before.depth.n).toBe(0);
    for (const tk of t!.tilesIn(rect.x0, rect.y0, rect.x1, rect.y1)) t!.getTile(tk);
    const s = computeMapStats(w, b, t, rect);
    expect(s.coverage).toBeGreaterThan(0.95);
    expect(s.coverage).toBeLessThanOrEqual(1);
    expect(s.height.n + s.depth.n).toBeGreaterThan(0);
    for (const e of [s.height.min, s.height.max, s.depth.min, s.depth.max]) {
      if (!e) continue;
      expect(e.x).toBeGreaterThanOrEqual(rect.x0);
      expect(e.x).toBeLessThanOrEqual(rect.x1);
      expect(e.y).toBeGreaterThanOrEqual(rect.y0);
      expect(e.y).toBeLessThanOrEqual(rect.y1);
    }
    // land is above the sea but for burnt-in river mouths a few metres down; ocean is below it
    if (s.height.n) expect(s.height.min!.v).toBeGreaterThan(-50);
    if (s.height.n) expect(s.height.max!.v).toBeGreaterThan(0);
    if (s.depth.n) expect(s.depth.max!.v).toBeLessThanOrEqual(1e-6);
    // the biomes now use exact heights for (nearly) all the land
    if (s.land) expect(s.exactHeight / s.land).toBeGreaterThan(0.9);
  });
});
