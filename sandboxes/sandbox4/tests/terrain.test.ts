import { describe, expect, it } from 'vitest';
import { defaults, toRiverParams, toTerrainParams, toWorldParams } from '../src/params';
import { Rivers } from '../src/world/rivers';
import { invPowTheta, LAND, OCEAN, Terrain, type RegionTerrain, type TerrainParams } from '../src/world/terrain';
import { World } from '../src/world/world';

const setup = (over: Partial<TerrainParams> = {}) => {
  const w = new World(toWorldParams(defaults(), 12345));
  const rv = new Rivers(w, toRiverParams(defaults()));
  // 2 km cells keep the tests quick; the pipeline is the same at every resolution
  const t = new Terrain(w, rv, { ...toTerrainParams(defaults()), res: 2000, ...over });
  return { w, rv, t };
};

/** Regions with land near the origin (a lattice walk, deterministic). */
function landRegions(w: World, n: number): number[] {
  const out: number[] = [];
  for (const r of World.cellsIn(w.regionLevel, -300000, -300000, 300000, 300000, 0)) {
    if (w.region(r).biomes.some((b) => !w.biomeCell(b).ocean)) out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

const own = (t: RegionTerrain, q: number) => t.cls[q] === LAND && t.reg[q] === t.region;

describe('terrain', () => {
  it('A^−θ from √ only matches Math.pow', () => {
    for (const th of [0.375, 0.4375, 0.5] as const) for (const a of [1, 2, 7.5, 100, 4096]) expect(invPowTheta(a, th)).toBeCloseTo(Math.pow(a, -th), 12);
  });

  it('river beds rise strictly upstream from sea level', () => {
    const { rv, t } = setup();
    for (const r of landRegions(t.world, 3)) {
      const rr = rv.get(r);
      const z = t.bed(r);
      for (let k = 0; k < rr.n; k++) {
        const p = rr.parent[k];
        if (p < 0 || rr.wet[k]) expect(z[k]).toBe(0);
        else expect(z[k]).toBeGreaterThan(z[p]);
      }
    }
  });

  it('every land cell of the region drains: it has a strictly lower neighbour or is a fill seed (sea or border)', () => {
    const { t } = setup();
    for (const r of landRegions(t.world, 2)) {
      const T = t.get(r);
      let checked = 0;
      for (let j = 1; j < T.ny - 1; j++) {
        for (let i = 1; i < T.nx - 1; i++) {
          const q = j * T.nx + i;
          if (!own(T, q)) continue;
          let lower = false;
          let seed = false;
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              if (!di && !dj) continue;
              const n = q + dj * T.nx + di;
              if (T.h[n] < T.h[q]) lower = true;
              if (T.cls[n] === OCEAN && (di === 0 || dj === 0 || true)) seed = true;
              if (T.cls[n] === LAND && T.reg[n] !== r && (di === 0 || dj === 0)) seed = true;
            }
          }
          expect(lower || seed).toBe(true);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(1000);
      expect(T.h.every((v) => Number.isFinite(v))).toBe(true);
    }
  });

  it('the sea is below sea level and the land above it', () => {
    const { t } = setup();
    const T = t.get(landRegions(t.world, 1)[0]);
    for (let q = 0; q < T.h.length; q++) {
      if (T.cls[q] === OCEAN) expect(T.h[q]).toBeLessThan(0);
      else if (own(T, q)) expect(T.h[q]).toBeGreaterThan(-25); // only burnt channels dip below 0
    }
  });

  it('rivers are burnt in: the raster at a river node is no higher than its bed (plus the fill ε) in almost every case', () => {
    const { rv, t } = setup({ res: 1000 });
    const r = landRegions(t.world, 1)[0];
    const T = t.get(r);
    const rr = rv.get(r);
    let ok = 0;
    let all = 0;
    for (let k = 0; k < rr.n; k++) {
      if (rr.parent[k] < 0 || rr.wet[k]) continue;
      const i = Math.round((rr.x[k] - T.x0) / T.res);
      const j = Math.round((rr.y[k] - T.y0) / T.res);
      const q = j * T.nx + i;
      if (!own(T, q)) continue;
      all++;
      if (T.h[q] <= T.bed[k] + 1) ok++;
    }
    expect(all).toBeGreaterThan(200);
    expect(ok / all).toBeGreaterThan(0.95);
  });

  it('is seamless: two neighbouring regions compute the same heights along their shared border', () => {
    const { w, t } = setup();
    let compared = 0;
    let maxDiff = 0;
    for (const a of landRegions(w, 4)) {
      const A = t.get(a);
      // every border cell of A that touches another region's land
      for (let j = 1; j < A.ny - 1; j++) {
        for (let i = 1; i < A.nx - 1; i++) {
          const q = j * A.nx + i;
          if (A.cls[q] !== LAND) continue;
          const nb = [q - 1, q + 1, q - A.nx, q + A.nx].find((n) => A.cls[n] === LAND && A.reg[n] !== A.reg[q]);
          if (nb === undefined || (A.reg[q] !== a && A.reg[nb] !== a)) continue;
          const other = A.reg[q] === a ? A.reg[nb] : A.reg[q];
          const B = t.get(other);
          const x = A.x0 + i * A.res;
          const y = A.y0 + j * A.res;
          const bi = Math.round((x - B.x0) / B.res);
          const bj = Math.round((y - B.y0) / B.res);
          if (bi < 0 || bj < 0 || bi >= B.nx || bj >= B.ny) continue;
          maxDiff = Math.max(maxDiff, Math.abs(A.h[q] - B.h[bj * B.nx + bi]));
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(200);
    expect(maxDiff).toBeLessThan(1e-3);
  });

  it('is deterministic', () => {
    const r = landRegions(setup().w, 1)[0];
    const a = setup().t.get(r);
    const b = setup().t.get(r);
    expect(Array.from(b.h)).toEqual(Array.from(a.h));
  });

  it('settings change the relief as intended', () => {
    const r = landRegions(setup().w, 1)[0];
    const mean = (T: RegionTerrain) => {
      let s = 0;
      let n = 0;
      for (let q = 0; q < T.h.length; q++) {
        if (!own(T, q)) continue;
        s += T.h[q];
        n++;
      }
      return s / n;
    };
    const base = mean(setup().t.get(r));
    expect(mean(setup({ hill: 2 }).t.get(r))).toBeGreaterThan(base);
    expect(mean(setup({ chSlope: 0.05 }).t.get(r))).toBeGreaterThan(base);
    expect(mean(setup({ ridge: 0, divide: 0, noise: 0 }).t.get(r))).toBeLessThan(base);
  });
});
