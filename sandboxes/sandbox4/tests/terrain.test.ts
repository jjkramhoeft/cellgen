import { describe, expect, it } from 'vitest';
import { defaults, toRiverParams, toTerrainParams, toWorldParams } from '../src/params';
import { Rivers } from '../src/world/rivers';
import { invPowTheta, LAND, monotoneSpline, OCEAN, ownsRegion, regionAt, Terrain, tileSide, type TerrainParams, type TerrainTile } from '../src/world/terrain';
import { keyI, keyJ, packKey } from '../src/world/level';
import { ELEVATION_ZONE_TYPES, elevationZoneType } from '../src/world/zones';
import { World } from '../src/world/world';

/** Elevation zone type index under a point (merged zone, nested). */
const typeAt = (w: World, x: number, y: number) => {
  const c = w.cellAt(x, y, true);
  return elevationZoneType(c.elevationZone, c.ocean);
};
/** Index of an elevation zone type by id. */
const typeIndex = (id: string) => ELEVATION_ZONE_TYPES.findIndex((t) => t.id === id);

const setup = (over: Partial<TerrainParams> = {}) => {
  const w = new World(toWorldParams(defaults(), 12345));
  const rv = new Rivers(w, toRiverParams(defaults(), 12345));
  // 2 km cells keep the tests quick; the pipeline is the same at every resolution
  const t = new Terrain(w, rv, { ...toTerrainParams(defaults()), res: 2000, ...over });
  return { w, rv, t };
};

/** Regions with land near the origin (a lattice walk, deterministic). */
function landRegions(w: World, n: number): number[] {
  const out: number[] = [];
  for (const r of World.cellsIn(w.regionLevel, -300000, -300000, 300000, 300000, 0)) {
    if (w.region(r).elevationZones.some((b) => !w.elevationZoneCell(b).ocean)) out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

/** Is cell q land of region r (whose final heights this tile computed)? */
const own = (t: TerrainTile, q: number, r: number) => t.cls[q] === LAND && regionAt(t, q) === r;

// whole tiles (several regions, plus the rivers around them) take seconds each, more on CI runners
describe('terrain', { timeout: 60_000 }, () => {
  it('A^−θ from √ only matches Math.pow', () => {
    for (const th of [0.375, 0.4375, 0.5] as const) for (const a of [1, 2, 7.5, 100, 4096]) expect(invPowTheta(a, th)).toBeCloseTo(Math.pow(a, -th), 12);
  });

  it('river beds never fall upstream, start at sea level, and mostly rise', () => {
    const { rv, t } = setup();
    let rising = 0;
    let dry = 0;
    for (const r of landRegions(t.world, 3)) {
      const rr = rv.get(r);
      const z = t.bed(r);
      for (let k = 0; k < rr.n; k++) {
        const p = rr.parent[k];
        if (p < 0 || rr.wet[k]) {
          expect(z[k]).toBe(0);
          continue;
        }
        expect(z[k]).toBeGreaterThanOrEqual(z[p]);
        dry++;
        if (z[k] > z[p]) rising++;
      }
    }
    // level stretches: flat elevation zones and gorges
    expect(rising / dry).toBeGreaterThan(0.5);
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

  it('tiles: 2 regions per side by default (about 256 km), 1 for huge regions, up to 4 for small ones; ownership by lattice index', () => {
    expect(tileSide(128000)).toBe(2);
    expect(tileSide(64000)).toBe(4);
    expect(tileSide(32000)).toBe(4);
    expect(tileSide(256000)).toBe(1);
    expect(tileSide(512000)).toBe(1);
    const { t } = setup();
    expect(t.k).toBe(2);
    expect(t.tileOf(packKey(-1, 0))).toBe(packKey(-1, 0));
    expect(t.tileOf(packKey(3, 7))).toBe(packKey(1, 3));
    expect(t.tileOf(packKey(4, -5))).toBe(packKey(2, -3));
    expect(t.tileRegions(packKey(1, 3))).toEqual([packKey(2, 6), packKey(3, 6), packKey(2, 7), packKey(3, 7)]);
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

  it('river gradient per elevation zone type: factors scale the bed rise, 0 makes that type flat', () => {
    const r = landRegions(setup().w, 1)[0];
    // the factor scales the rise exactly while nothing else limits it (no hillslope limit,
    // no levelling, no envelope caps: a huge hillslope)
    const free = { hill: 1e4, level: 0 };
    const base = setup(free).t.bed(r);
    const twice = setup({ ...free, chanFactor: setup().t.p.chanFactor.map((v) => v * 2) }).t.bed(r);
    for (let k = 0; k < base.length; k++) expect(twice[k]).toBeCloseTo(base[k] * 2, 6);
    // flatten one elevation zone type: its dry nodes no longer rise above their parent
    const { w, rv, t } = setup();
    const rr = rv.get(r);
    const counts = new Map<number, number>();
    for (let k = 0; k < rr.n; k++) if (!rr.wet[k] && rr.parent[k] >= 0) {
        const ty = typeAt(w, rr.x[k], rr.y[k]);
        counts.set(ty, (counts.get(ty) ?? 0) + 1);
      }
    const type = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const flat = setup({ chanFactor: t.p.chanFactor.map((v, i) => (i === type ? 0 : v)) }).t.bed(r);
    let checked = 0;
    for (let k = 0; k < rr.n; k++) {
      const p = rr.parent[k];
      if (p < 0 || rr.wet[k] || typeAt(w, rr.x[k], rr.y[k]) !== type) continue;
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

  it('has a mountains elevation zone type, and it occurs', () => {
    const i = typeIndex('mountains');
    expect(i).toBeGreaterThanOrEqual(0);
    const { w } = setup();
    let n = 0;
    for (const b of World.cellsIn(w.elevationZoneLevel, -400000, -400000, 400000, 400000, 0)) if (elevationZoneType(b, false) === i) n++;
    expect(n).toBeGreaterThan(5);
  });
  it('levelling: with gradient 0 an elevation zone’s rivers sit at one level (its lowest entry); without levelling they do not', () => {
    const r = landRegions(setup().w, 1)[0];
    const { w, rv } = setup();
    const rr = rv.get(r);
    // the elevation zone type most river nodes run through
    const counts = new Map<number, number>();
    for (let k = 0; k < rr.n; k++) if (!rr.wet[k] && rr.parent[k] >= 0) {
        const ty = typeAt(w, rr.x[k], rr.y[k]);
        counts.set(ty, (counts.get(ty) ?? 0) + 1);
      }
    const type = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const chan = setup().t.p.chanFactor.map((v, i) => (i === type ? 0 : v));
    const spreads = (level: number) => {
      const z = setup({ chanFactor: chan, level }).t.bed(r);
      const byElevationZone = new Map<number, number[]>();
      for (let k = 0; k < rr.n; k++) {
        if (rr.wet[k] || rr.parent[k] < 0) continue;
        const b = w.cellAt(rr.x[k], rr.y[k], true).elevationZone;
        if (elevationZoneType(b, false) !== type) continue;
        if (!byElevationZone.has(b)) byElevationZone.set(b, []);
        byElevationZone.get(b)!.push(z[k]);
      }
      return [...byElevationZone.values()].filter((v) => v.length >= 5).map((v) => Math.max(...v) - Math.min(...v));
    };
    const off = spreads(0);
    const on = spreads(1);
    expect(on.length).toBeGreaterThan(0);
    expect(Math.max(...off)).toBeGreaterThan(20);
    // one level, up to the cap tolerances (gorges cut below it only where the land forces them)
    const flat = on.filter((v) => v <= 10).length;
    expect(flat / on.length).toBeGreaterThan(0.8);
    expect(on.reduce((a, b) => a + b, 0)).toBeLessThan(off.reduce((a, b) => a + b, 0) / 4);
  });

  it('rivers do not stand above their land (at most a few, shallow exceptions)', () => {
    const { w, rv, t } = setup({ res: 1000 });
    const T = t.get(landRegions(w, 1)[0]);
    let all = 0;
    let perched = 0;
    let deep = 0;
    for (const rk of t.tileRegions(T.tile)) {
      const rr = rv.get(rk);
      const z = t.bed(rk);
      for (let k = 0; k < rr.n; k++) {
        if (rr.parent[k] < 0 || rr.wet[k] || z[k] < 20) continue;
        const i = Math.round((rr.x[k] - T.x0) / T.res);
        const j = Math.round((rr.y[k] - T.y0) / T.res);
        if (i < 0 || j < 0 || i >= T.nx || j >= T.ny || !ownsRegion(T, regionAt(T, j * T.nx + i))) continue;
        all++;
        const d = z[k] - T.h[j * T.nx + i];
        if (d > t.p.burn + 10) perched++;
        if (d > 100) deep++;
      }
    }
    // before: about half of all river nodes, by up to 1.3 km
    expect(all).toBeGreaterThan(2000);
    expect(perched / all).toBeLessThan(0.05);
    expect(deep / all).toBeLessThan(0.002);
  });

  it('hillslope by elevation zone type: flat zones are flatter than hills and mountains, and the per-type value controls it', () => {
    const spreadOf = (over: Partial<TerrainParams>, types: number[]) => {
      const { w, t } = setup(over);
      const T = t.get(landRegions(w, 1)[0]);
      const byElevationZone = new Map<number, number[]>();
      for (let q = 0; q < T.h.length; q++) {
        if (T.cls[q] !== LAND || !ownsRegion(T, regionAt(T, q))) continue;
        const i = q % T.nx;
        const j = (q - i) / T.nx;
        const b = w.cellAt(T.x0 + i * T.res, T.y0 + j * T.res, true).elevationZone;
        if (!types.includes(elevationZoneType(b, false))) continue;
        if (!byElevationZone.has(b)) byElevationZone.set(b, []);
        byElevationZone.get(b)!.push(T.h[q]);
      }
      const sp = [...byElevationZone.values()].filter((v) => v.length >= 20).map((v) => {
        v.sort((a, b) => a - b);
        return v[Math.floor(0.95 * v.length)] - v[Math.floor(0.05 * v.length)];
      });
      sp.sort((a, b) => a - b);
      return sp[Math.floor(sp.length / 2)];
    };
    const plains = [typeIndex('flat')];
    const rugged = [typeIndex('hills'), typeIndex('mountains')];
    const p = spreadOf({}, plains);
    const r = spreadOf({}, rugged);
    expect(p * 4).toBeLessThan(r);
    // steeper plains: more relief inside them
    const steep = setup().t.p.hillType.map((v, i) => (plains.includes(i) ? 0.05 : v));
    expect(spreadOf({ hillType: steep }, plains)).toBeGreaterThan(p * 1.5);
  });
  it('heightFast (3D mesh) agrees with heightAt where tiles are computed, and is NaN where none are', () => {
    const { w, t } = setup();
    const r = landRegions(w, 1)[0];
    const T = t.get(r);
    const span = (T.nx - 1) * T.res;
    const pts: [number, number][] = [];
    for (let j = 0; j < 60; j++) for (let i = 0; i < 60; i++) pts.push([T.x0 + 0.1 * span + (0.8 * span * i) / 59, T.y0 + 0.1 * (T.ny - 1) * T.res + (0.8 * (T.ny - 1) * T.res * j) / 59]);
    let a = performance.now();
    const fast = pts.map(([x, y]) => t.heightFast(x, y));
    const fastMs = performance.now() - a;
    a = performance.now();
    const exact = pts.map(([x, y]) => t.heightAt(x, y));
    const exactMs = performance.now() - a;
    let n = 0;
    let close = 0;
    for (let q = 0; q < pts.length; q++) {
      if (exact[q] !== exact[q]) continue; // a neighbouring tile that is not computed
      n++;
      if (Math.abs(fast[q] - exact[q]) < 1) close++;
    }
    expect(n).toBeGreaterThan(1000);
    expect(close / n).toBeGreaterThan(0.99);
    expect(fastMs).toBeLessThan(exactMs);
    // far away, nothing is computed
    expect(t.heightFast(T.x0 + 5e6, T.y0 + 5e6)).toBeNaN();
  });
});
