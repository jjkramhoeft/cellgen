import { describe, expect, it } from 'vitest';
import { defaults, toRiverParams, toWorldParams } from '../src/params';
import { Rivers, type RiverParams } from '../src/world/rivers';
import { World } from '../src/world/world';

const world = (seed = 12345) => new World(toWorldParams(defaults(), seed));
const rp = (over: Partial<RiverParams> = {}): RiverParams => ({ ...toRiverParams(defaults()), ...over });

/** Regions around the origin that have land. */
function landRegions(w: World, n = 6): number[] {
  const out: number[] = [];
  for (const r of World.cellsIn(w.regionLevel, -400000, -400000, 400000, 400000, 0)) {
    if (w.region(r).biomes.some((b) => !w.biomeCell(b).ocean)) out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

describe('space-colonization rivers', () => {
  it('places attractors only in inland land subbiomes of the region, perSub per subbiome', () => {
    const w = world();
    const rv = new Rivers(w, rp({ perSub: 10 }));
    const r = landRegions(w, 1)[0];
    const { ax, ay } = rv.attractors(r);
    expect(ax.length).toBeGreaterThan(100);
    expect(ax.length % 10).toBe(0);
    let eligible = 0;
    for (const b of w.region(r).biomes) {
      if (w.biomeCell(b).ocean) continue;
      for (const s of w.biomeSubs(w.biome(b))) if (!w.subCell(s).ocean && !rv.isCoastSub(s)) eligible++;
    }
    expect(ax.length).toBe(eligible * 10);
    for (let a = 0; a < ax.length; a++) {
      const c = w.subCell(w.subLevel.query(ax[a], ay[a]));
      expect(c.ocean).toBe(false);
    }
  });

  it('reaches every attractor, and the roots carry all the flow', () => {
    const w = world();
    const rv = new Rivers(w, rp());
    for (const r of landRegions(w, 4)) {
      const rr = rv.get(r);
      expect(rr.roots.length).toBeGreaterThan(0);
      expect(rr.reached).toBe(rr.ax.length);
      let rootFlow = 0;
      for (const k of rr.roots) rootFlow += rr.flow[k];
      expect(rootFlow).toBe(rr.ax.length);
      let own = 0;
      for (let k = 0; k < rr.n; k++) {
        own += rr.own[k];
        if (rr.parent[k] >= 0) {
          expect(rr.parent[k]).toBeLessThan(k);
          expect(rr.flow[rr.parent[k]]).toBeGreaterThanOrEqual(rr.flow[k]);
          // every segment is one growth step long, or a bridge step
          const d = Math.hypot(rr.x[k] - rr.x[rr.parent[k]], rr.y[k] - rr.y[rr.parent[k]]);
          expect(d).toBeCloseTo(rv.p.step, 3);
        }
      }
      expect(own).toBe(rr.ax.length);
    }
  });

  it('puts one root at the point of each ocean biome touching the region, and flags nodes over water', () => {
    const w = world();
    const rv = new Rivers(w, rp());
    for (const r of landRegions(w, 3)) {
      const rr = rv.get(r);
      expect(new Set(rr.rootOcean).size).toBe(rr.rootOcean.length);
      rr.roots.forEach((k, t) => {
        const o = w.biome(rr.rootOcean[t]);
        expect(w.biomeCell(o.key).ocean).toBe(true);
        expect([rr.x[k], rr.y[k]]).toEqual([o.x, o.y]);
        // the ocean biome touches land
        expect(w.biomeNbrs(o).some((n) => !w.biomeCell(n).ocean)).toBe(true);
      });
      for (let k = 0; k < rr.n; k++) expect(rr.wet[k]).toBe(w.cellAt(rr.x[k], rr.y[k], true).ocean ? 1 : 0);
      // rivers that reached anything cross the coast: some of their nodes are on land
      for (const k of rr.roots) {
        if (rr.flow[k] === 0) continue;
        let dry = false;
        for (let m = 0; m < rr.n && !dry; m++) if (rr.tree[m] === k && !rr.wet[m]) dry = true;
        expect(dry).toBe(true);
      }
    }
  });

  it('is deterministic, and random motion changes the rivers', () => {
    const r = landRegions(world(), 1)[0];
    const a = new Rivers(world(), rp()).compute(r);
    const b = new Rivers(world(), rp()).compute(r);
    expect(Array.from(b.x)).toEqual(Array.from(a.x));
    expect(Array.from(b.flow)).toEqual(Array.from(a.flow));
    const still = new Rivers(world(), rp({ jitter: 0 })).compute(r);
    expect(Array.from(still.x)).not.toEqual(Array.from(a.x));
    expect(still.reached).toBe(still.ax.length);
  });

  it('pull power: every variant reaches all attractors deterministically, and changes the rivers', () => {
    const r = landRegions(world(), 1)[0];
    const xs: number[][] = [];
    for (const pull of ['normal', 'squared', 'sqrt'] as const) {
      const a = new Rivers(world(), rp({ pull, jitter: 0 })).compute(r);
      const b = new Rivers(world(), rp({ pull, jitter: 0 })).compute(r);
      expect(a.reached).toBe(a.ax.length);
      expect(Array.from(b.x)).toEqual(Array.from(a.x));
      xs.push(Array.from(a.x));
    }
    expect(xs[1]).not.toEqual(xs[0]);
    expect(xs[2]).not.toEqual(xs[0]);
    expect(xs[2]).not.toEqual(xs[1]);
  });

  it('runs in reasonable time per region', () => {
    const w = world();
    const rv = new Rivers(w, rp());
    const t0 = performance.now();
    const rs = landRegions(w, 6);
    let attr = 0;
    let nodes = 0;
    for (const r of rs) {
      const rr = rv.get(r);
      attr += rr.ax.length;
      nodes += rr.n;
    }
    const ms = (performance.now() - t0) / rs.length;
    console.log(`rivers: ${ms.toFixed(1)} ms/region, ${(attr / rs.length).toFixed(0)} attractors, ${(nodes / rs.length).toFixed(0)} nodes`);
    expect(ms).toBeLessThan(1500);
  });
});
