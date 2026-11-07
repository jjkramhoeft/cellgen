import { describe, expect, it } from 'vitest';
import { defaults, toRiverParams, toTerrainParams, toWorldParams } from '../src/params';
import { Rivers } from '../src/world/rivers';
import { invPowTheta, LAND, monotoneSpline, OCEAN, ownsRegion, regionAt, Terrain, tileSide, type TerrainParams, type TerrainTile } from '../src/world/terrain';
import { keyI, keyJ, packKey } from '../src/world/level';
import { LAND_TYPES, landType } from '../src/render/source';
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

/** Is cell q land of region r (whose final heights this tile computed)? */
const own = (t: TerrainTile, q: number, r: number) => t.cls[q] === LAND && regionAt(t, q) === r;

// whole tiles (4 × 4 regions, plus the rivers around them) take seconds each, more on CI runners
describe('terrain', { timeout: 60_000 }, () => {
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
          if (!own(T, q, r)) continue;
          let lower = false;
          let seed = false;
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              if (!di && !dj) continue;
              const n = q + dj * T.nx + di;
              if (T.h[n] < T.h[q]) lower = true;
              if (T.cls[n] === OCEAN && (di === 0 || dj === 0 || true)) seed = true;
              if (T.cls[n] === LAND && regionAt(T, n) !== r && (di === 0 || dj === 0)) seed = true;
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
    const r = landRegions(t.world, 1)[0];
    const T = t.get(r);
    for (let q = 0; q < T.h.length; q++) {
      if (T.cls[q] === OCEAN) expect(T.h[q]).toBeLessThan(0);
      else if (ownsRegion(T, regionAt(T, q))) expect(T.h[q]).toBeGreaterThan(-25); // only burnt channels dip below 0
    }
  });

  it('rivers are burnt in: the raster at a river node is no higher than its bed (plus the fill ε) in almost every case', () => {
    const { rv, t } = setup({ res: 1000 });
    const r = landRegions(t.world, 1)[0];
    const T = t.get(r);
    const rr = rv.get(r);
    const bed = t.bed(r);
    let ok = 0;
    let all = 0;
    for (let k = 0; k < rr.n; k++) {
      if (rr.parent[k] < 0 || rr.wet[k]) continue;
      const i = Math.round((rr.x[k] - T.x0) / T.res);
      const j = Math.round((rr.y[k] - T.y0) / T.res);
      const q = j * T.nx + i;
      if (!own(T, q, r)) continue;
      all++;
      if (T.h[q] <= bed[k] + 1) ok++;
    }
    expect(all).toBeGreaterThan(200);
    expect(ok / all).toBeGreaterThan(0.95);
  });

  it('is seamless: two neighbouring tiles compute the same heights along their shared border', () => {
    const { w, t } = setup();
    let compared = 0;
    let maxDiff = 0;
    for (const a of landRegions(w, 4)) {
      const A = t.get(a);
      // every land cell of A's own regions that touches land of a region owned by another tile
      for (let j = 1; j < A.ny - 1; j++) {
        for (let i = 1; i < A.nx - 1; i++) {
          const q = j * A.nx + i;
          if (A.cls[q] !== LAND) continue;
          const nb = [q - 1, q + 1, q - A.nx, q + A.nx].find((n) => A.cls[n] === LAND && A.reg[n] !== A.reg[q]);
          if (nb === undefined) continue;
          const rq = regionAt(A, q);
          const rn = regionAt(A, nb);
          if (ownsRegion(A, rq) === ownsRegion(A, rn)) continue;
          const B = t.get(ownsRegion(A, rq) ? rn : rq);
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

  it('a tile computes exactly the heights of one raster per region (bit for bit)', () => {
    const per = setup({ tile: 1 });
    const tiled = setup({ tile: 4 });
    const r0 = per.w.regionAt(0, 0);
    const I = Math.floor(keyI(r0) / 4) * 4;
    const J = Math.floor(keyJ(r0) / 4) * 4;
    let compared = 0;
    let maxDiff = 0;
    for (let dj = 0; dj < 4; dj++) {
      for (let di = 0; di < 4; di++) {
        const r = packKey(I + di, J + dj);
        const P = per.t.get(r);
        const T = tiled.t.get(r);
        for (let q = 0; q < P.h.length; q++) {
          if (!own(P, q, r)) continue;
          const i = q % P.nx;
          const j = (q - i) / P.nx;
          const ti = Math.round((P.x0 + i * P.res - T.x0) / T.res);
          const tj = Math.round((P.y0 + j * P.res - T.y0) / T.res);
          maxDiff = Math.max(maxDiff, Math.abs(P.h[q] - T.h[tj * T.nx + ti]));
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(20000);
    expect(maxDiff).toBe(0);
  });

  it('tiles: 4 regions per side by default, fewer for huge regions; ownership by lattice index', () => {
    expect(tileSide(128000)).toBe(4);
    expect(tileSide(32000)).toBe(4);
    expect(tileSide(256000)).toBe(2);
    expect(tileSide(512000)).toBe(1);
    const { t } = setup();
    expect(t.k).toBe(4);
    expect(t.tileOf(packKey(-1, 0))).toBe(packKey(-1, 0));
    expect(t.tileOf(packKey(3, 7))).toBe(packKey(0, 1));
    expect(t.tileOf(packKey(4, -5))).toBe(packKey(1, -2));
    expect(t.tileRegions(packKey(0, 1))).toContain(packKey(3, 7));
  });

  it('is deterministic', () => {
    const r = landRegions(setup().w, 1)[0];
    const a = setup().t.get(r);
    const b = setup().t.get(r);
    expect(Array.from(b.h)).toEqual(Array.from(a.h));
  });

  it('settings change the relief as intended', () => {
    const r = landRegions(setup().w, 1)[0];
    const mean = (T: TerrainTile) => {
      let s = 0;
      let n = 0;
      for (let q = 0; q < T.h.length; q++) {
        if (!own(T, q, r)) continue;
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

  it('floodplain spline: through the points, no overshoot, flat beyond the ends, any point order', () => {
    const f = monotoneSpline([400, 0, 1000, 100], [150, 500, 40, 400]);
    expect(f(0)).toBe(500);
    expect(f(100)).toBeCloseTo(400, 9);
    expect(f(400)).toBeCloseTo(150, 9);
    expect(f(1000)).toBe(40);
    expect(f(-50)).toBe(500);
    expect(f(5000)).toBe(40);
    let prev = Infinity;
    for (let h = 0; h <= 1000; h += 5) {
      const v = f(h);
      expect(v).toBeLessThanOrEqual(prev + 1e-9); // decreasing data → decreasing curve
      expect(v).toBeGreaterThanOrEqual(40 - 1e-9);
      prev = v;
    }
    // a bump stays between its neighbours' values (no ringing)
    const g = monotoneSpline([0, 1, 2, 3], [0, 10, 10, 0]);
    for (let x = 0; x <= 3; x += 0.05) expect(g(x)).toBeLessThanOrEqual(10 + 1e-9);
  });

  it('river gradient per land type: factors scale the bed rise, 0 makes that land type flat', () => {
    const r = landRegions(setup().w, 1)[0];
    const base = setup().t.bed(r);
    const twice = setup({ chanFactor: setup().t.p.chanFactor.map((v) => v * 2) }).t.bed(r);
    for (let k = 0; k < base.length; k++) expect(twice[k]).toBe(base[k] * 2);
    // flatten one land type: its dry nodes no longer rise above their parent
    const { w, rv, t } = setup();
    const rr = rv.get(r);
    const counts = new Map<number, number>();
    for (let k = 0; k < rr.n; k++) if (!rr.wet[k] && rr.parent[k] >= 0) counts.set(landType(w.cellAt(rr.x[k], rr.y[k], true).biome), (counts.get(landType(w.cellAt(rr.x[k], rr.y[k], true).biome)) ?? 0) + 1);
    const type = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const flat = setup({ chanFactor: t.p.chanFactor.map((v, i) => (i === type ? 0 : v)) }).t.bed(r);
    let checked = 0;
    for (let k = 0; k < rr.n; k++) {
      const p = rr.parent[k];
      if (p < 0 || rr.wet[k] || landType(w.cellAt(rr.x[k], rr.y[k], true).biome) !== type) continue;
      expect(flat[k]).toBe(flat[p]);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('a wider floodplain flattens the valleys (lower mean land height)', () => {
    const r = landRegions(setup().w, 1)[0];
    const mean = (T: TerrainTile) => {
      let s = 0;
      let n = 0;
      for (let q = 0; q < T.h.length; q++) if (own(T, q, r)) (s += T.h[q]), n++;
      return s / n;
    };
    const narrow = mean(setup({ floodW: [100, 80, 40, 20] }).t.get(r));
    const wide = mean(setup({ floodW: [3000, 2500, 1500, 800] }).t.get(r));
    expect(wide).toBeLessThan(narrow);
  });

  it('has a Mountains land type, and it occurs', () => {
    const i = LAND_TYPES.findIndex((t) => t.name === 'Mountains');
    expect(i).toBeGreaterThanOrEqual(0);
    const { w } = setup();
    let n = 0;
    for (const b of World.cellsIn(w.biomeLevel, -400000, -400000, 400000, 400000, 0)) if (landType(b) === i) n++;
    expect(n).toBeGreaterThan(5);
  });
});
