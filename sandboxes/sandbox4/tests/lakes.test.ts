import { describe, expect, it } from 'vitest';
import { testParams } from './fixture';
import { toBiomeParams, toClimateParams, toLakeParams, toRiverParams, toWorldParams } from '../src/params';
import { Biomes, BIOMES, classify } from '../src/world/biomes';
import { Climate } from '../src/world/climate';
import { inPolygon, LAKE_MIN_FLOW, Lakes, RAYS, TAPER, type LakeParams } from '../src/world/lakes';
import { Rivers } from '../src/world/rivers';
import { World } from '../src/world/world';
import { ELEVATION_ZONE_TYPES, elevationZoneType } from '../src/world/zones';

const SEED = 12345;
const MOUNTAINS = ELEVATION_ZONE_TYPES.findIndex((t) => t.id === 'mountains');
const DESERT = new Set(BIOMES.flatMap((b, i) => (b.id === 'hotDesert' || b.id === 'coldDesert' ? [i] : [])));

function setup(over: Partial<LakeParams> = {}, seed = SEED) {
  const p = testParams();
  const w = new World(toWorldParams(p, seed));
  const rv = new Rivers(w, toRiverParams(p, seed));
  const cl = new Climate(toClimateParams(p, seed));
  const bio = new Biomes(w, rv, cl, null, toBiomeParams(p));
  const lk = new Lakes(w, rv, bio, { ...toLakeParams(p), ...over });
  return { w, rv, bio, lk };
}

/** Regions around the origin with some land. */
function landRegions(w: World, n: number): number[] {
  const out: number[] = [];
  for (const r of World.cellsIn(w.regionLevel, -500000, -500000, 500000, 500000, 0)) {
    if (w.region(r).elevationZones.some((b) => !w.elevationZoneCell(b).ocean)) out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

/** a bump of the outline counts as a lobe when it stands this × the nominal radius above its surroundings */
const BUMP_PROMINENCE = 0.02;

/**
 * Prominence of the peak at ray k of a closed radius profile: how far it rises above the
 * higher of the two lowest points reached walking either way before a higher ray.
 */
function prominence(rad: number[], k: number): number {
  const n = rad.length;
  let lo = -Infinity;
  for (const dir of [1, -1]) {
    let min = rad[k];
    for (let j = 1; j < n; j++) {
      const v = rad[(k + dir * j + n) % n];
      if (v > rad[k]) break;
      min = Math.min(min, v);
    }
    lo = Math.max(lo, min);
  }
  return rad[k] - lo;
}

describe('lakes', { timeout: 60_000 }, () => {
  it.each([SEED, 777])('only cover lake-eligible land of their own region (seed %i)', (seed) => {
    const { w, rv, bio, lk } = setup({ frequency: 0.25 }, seed);
    let lakes = 0;
    let samples = 0;
    for (const r of landRegions(w, 8)) {
      for (const l of lk.get(r).lakes) {
        lakes++;
        // the vertices and a grid of points inside the outline
        const pts: [number, number][] = [];
        for (let k = 0; k < l.x.length; k++) pts.push([l.cx + (l.x[k] - l.cx) * 0.999, l.cy + (l.y[k] - l.cy) * 0.999]);
        const g = 24;
        for (let a = 0; a <= g; a++) {
          for (let b = 0; b <= g; b++) {
            const x = l.x0 + ((l.x1 - l.x0) * a) / g;
            const y = l.y0 + ((l.y1 - l.y0) * b) / g;
            if (inPolygon(l.x, l.y, x, y)) pts.push([x, y]);
          }
        }
        for (const [x, y] of pts) {
          const c = w.cellAt(x, y, true);
          samples++;
          expect(c.region).toBe(r);
          expect(c.ocean).toBe(false);
          const zt = elevationZoneType(c.elevationZone, false);
          expect(zt).not.toBe(MOUNTAINS);
          expect(DESERT.has(bio.ofSub(c.sub).seaLevel)).toBe(false);
          expect(rv.isSparseFlat(c.elevationZone)).toBe(false);
          expect(lk.block(c.subRaw)).toBeNull();
        }
      }
    }
    expect(lakes).toBeGreaterThan(20);
    expect(samples).toBeGreaterThan(lakes * 20);
  });

  it('never puts a lake where the map would show desert, at any height', () => {
    // the desert test is at sea level: a subbiome that is no desert there is none higher up
    const { w, bio, lk } = setup({ frequency: 0.25 });
    const hot = new Biomes(w, lk.rivers, bio.climate, null, toBiomeParams(testParams()));
    for (const r of landRegions(w, 8)) {
      for (const l of lk.get(r).lakes) {
        const info = hot.ofSub(l.sub);
        for (const h of [0, 100, 300, 800, 1500, 3000]) {
          const t = info.t0 - hot.cooling(h);
          const b = BIOMES[classifyAt(t, info.p)].id;
          expect(b === 'hotDesert' || b === 'coldDesert').toBe(false);
        }
      }
    }
  });

  it('keeps every lake between the minimum and maximum size, without overlaps', () => {
    const min = 1500;
    const max = 7000;
    const { w, lk } = setup({ frequency: 0.3, minSize: min, maxSize: max });
    let n = 0;
    for (const r of landRegions(w, 8)) {
      const ls = lk.get(r).lakes;
      for (const l of ls) {
        n++;
        expect(l.size).toBeGreaterThanOrEqual(min - 1e-6);
        expect(l.size).toBeLessThanOrEqual(max + 1e-6);
        expect(l.x.length).toBe(RAYS);
      }
      for (let a = 0; a < ls.length; a++) {
        for (let b = a + 1; b < ls.length; b++) {
          for (let k = 0; k < RAYS; k++) {
            expect(inPolygon(ls[b].x, ls[b].y, ls[a].x[k], ls[a].y[k])).toBe(false);
            expect(inPolygon(ls[a].x, ls[a].y, ls[b].x[k], ls[b].y[k])).toBe(false);
          }
        }
      }
    }
    expect(n).toBeGreaterThan(20);
  });

  it('follows the frequency (0 = none)', () => {
    const { w } = setup();
    const regions = landRegions(w, 6);
    const count = (f: number) => {
      const { lk } = setup({ frequency: f });
      return regions.reduce((s, r) => s + lk.get(r).lakes.length, 0);
    };
    expect(count(0)).toBe(0);
    const lo = count(0.03);
    const hi = count(0.15);
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(2 * lo);
  });

  it('gives noise-shaped, varied outlines', () => {
    const { w, lk } = setup({ frequency: 0.25 });
    const ratios: number[] = [];
    for (const r of landRegions(w, 8)) {
      for (const l of lk.get(r).lakes) {
        let lo = Infinity;
        let hi = 0;
        for (let k = 0; k < RAYS; k++) {
          const d = Math.hypot(l.x[k] - l.cx, l.y[k] - l.cy);
          lo = Math.min(lo, d);
          hi = Math.max(hi, d);
        }
        ratios.push(hi / lo);
      }
    }
    ratios.sort((a, b) => a - b);
    const median = ratios[ratios.length >> 1];
    // not circles, and not all the same shape
    expect(median).toBeGreaterThan(1.4);
    expect(ratios[ratios.length - 1] - ratios[0]).toBeGreaterThan(0.8);
  });

  it('gives smooth, organic outlines (gentle tapers, a few broad lobes)', () => {
    const { w, lk } = setup({ frequency: 0.25 });
    const turns: number[] = [];
    let n = 0;
    for (const r of landRegions(w, 8)) {
      for (const l of lk.get(r).lakes) {
        n++;
        const rad = Array.from({ length: RAYS }, (_, k) => Math.hypot(l.x[k] - l.cx, l.y[k] - l.cy));
        // neighbouring rays never jump: at most TAPER × the nominal radius apart
        for (let k = 0; k < RAYS; k++) expect(Math.abs(rad[k] - rad[(k + 1) % RAYS])).toBeLessThanOrEqual(TAPER * (l.nominal / 2) + 1e-6);
        // count the bumps: local maxima of the radius around the outline that stand out by at
        // least BUMP_PROMINENCE × the nominal radius (the taper and rounding against a clipped
        // side leave sub-metre ripples that are local maxima too, but no visible lobe)
        let bumps = 0;
        for (let k = 0; k < RAYS; k++) {
          const a = rad[(k + RAYS - 1) % RAYS];
          const b = rad[k];
          const c = rad[(k + 1) % RAYS];
          if (b > a + 1e-6 && b >= c && prominence(rad, k) >= BUMP_PROMINENCE * (l.nominal / 2)) bumps++;
        }
        turns.push(bumps);
      }
    }
    expect(n).toBeGreaterThan(20);
    turns.sort((a, b) => a - b);
    // an ellipse has 2 bumps; the noise adds a few broad lobes, never a jagged fringe
    expect(turns[turns.length >> 1]).toBeLessThanOrEqual(5);
    expect(turns[Math.floor(turns.length * 0.9)]).toBeLessThanOrEqual(8);
  });

  it('puts every lake on a river, which runs in and out of it', () => {
    const { w, rv, lk } = setup({ frequency: 0.25 });
    let n = 0;
    let through = 0;
    for (const r of landRegions(w, 8)) {
      const rr = rv.get(r);
      for (const l of lk.get(r).lakes) {
        n++;
        // centred on a land node of a real river of its own region
        expect(rr.x[l.node]).toBe(l.cx);
        expect(rr.y[l.node]).toBe(l.cy);
        expect(rr.parent[l.node]).toBeGreaterThanOrEqual(0);
        expect(rr.wet[l.node]).toBe(0);
        expect(rr.flow[l.node]).toBe(l.flow);
        expect(l.flow).toBeGreaterThanOrEqual(LAKE_MIN_FLOW);
        expect(inPolygon(l.x, l.y, l.cx, l.cy)).toBe(true);
        // downstream the river leaves the lake on its way to the sea
        let k = l.node;
        while (rr.parent[k] >= 0 && inPolygon(l.x, l.y, rr.x[k], rr.y[k])) k = rr.parent[k];
        if (!inPolygon(l.x, l.y, rr.x[k], rr.y[k])) through++;
      }
    }
    expect(n).toBeGreaterThan(20);
    expect(through).toBe(n);
  });

  it('is deterministic and independent of the order regions are computed in', () => {
    const a = setup({ frequency: 0.2 });
    const b = setup({ frequency: 0.2 });
    const regions = landRegions(a.w, 6);
    const ra = regions.map((r) => a.lk.get(r));
    const rb = [...regions].reverse().map((r) => b.lk.get(r)).reverse();
    for (let i = 0; i < regions.length; i++) {
      expect(rb[i].lakes.length).toBe(ra[i].lakes.length);
      for (let k = 0; k < ra[i].lakes.length; k++) {
        expect(Array.from(rb[i].lakes[k].x)).toEqual(Array.from(ra[i].lakes[k].x));
        expect(Array.from(rb[i].lakes[k].y)).toEqual(Array.from(ra[i].lakes[k].y));
      }
    }
  });

  it('marks ocean, mountains, desert and river-poor flat (restricted) subbiomes as blocked', () => {
    const { w, rv, bio, lk } = setup();
    const seen = new Set<string | null>();
    for (const r of landRegions(w, 10)) {
      for (const b of rv.regionElevationZones(r)) {
        for (const s of w.elevationZoneSubs(w.elevationZone(b))) {
          const c = w.subCell(s);
          const why = lk.block(s);
          seen.add(why);
          if (c.ocean) expect(why).toBe('ocean');
          else if (elevationZoneType(c.elevationZone, false) === MOUNTAINS) expect(why).toBe('mountains');
          else if (DESERT.has(bio.ofSub(c.sub).seaLevel)) expect(why).toBe('desert');
          else if (rv.isSparseFlat(c.elevationZone)) expect(why).toBe('restricted');
          else expect(why).toBeNull();
        }
      }
    }
    for (const k of ['ocean', 'mountains', 'restricted', null]) expect(seen.has(k)).toBe(true);
  });
});

/** Biome index of a temperature and precipitation (biomes.ts `classify`). */
function classifyAt(t: number, p: number): number {
  return classify(t, p).biome;
}
