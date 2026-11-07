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
  it('places attractors only in inland land subbiomes drawn in the region, perSub per subbiome', () => {
    const w = world();
    const rv = new Rivers(w, rp({ perSub: 10 }));
    const r = landRegions(w, 1)[0];
    const { ax, ay } = rv.attractors(r);
    expect(ax.length).toBeGreaterThan(100);
    expect(ax.length % 10).toBe(0);
    let eligible = 0;
    for (const b of rv.regionBiomes(r)) {
      if (w.biomeCell(b).ocean) continue;
      for (const s of w.biomeSubs(w.biome(b))) {
        const c = w.subCell(s);
        if (!c.ocean && c.region === r && !rv.isCoastSub(s)) eligible++;
      }
    }
    expect(ax.length).toBe(eligible * 10);
    for (let a = 0; a < ax.length; a++) {
      const c = w.cellAt(ax[a], ay[a], true);
      expect(c.ocean).toBe(false);
      expect(c.region).toBe(r);
    }
  });

  it('follows the drawn regions: a biome merged into a neighbouring region belongs to that region', () => {
    const w = world();
    const rv = new Rivers(w, rp());
    let moved = 0;
    for (const r of World.cellsIn(w.regionLevel, -400000, -400000, 400000, 400000, 0)) {
      const mine = new Set(rv.regionBiomes(r));
      for (const b of w.region(r).biomes) {
        expect(mine.has(b)).toBe(w.biomeCell(b).region === r);
        if (!mine.has(b)) moved++;
      }
      for (const b of mine) expect(w.biomeCell(b).region).toBe(r);
    }
    // the case exists with the default parameters (merges cross region borders)
    expect(moved).toBeGreaterThan(0);
  });

  it('never crosses into another region: every node and segment is ocean or the region’s own land', () => {
    const w = world();
    const rv = new Rivers(w, rp());
    let checked = 0;
    for (const r of World.cellsIn(w.regionLevel, -400000, -400000, 400000, 400000, 0)) {
      if (!w.region(r).biomes.some((b) => !w.biomeCell(b).ocean)) continue;
      const rr = rv.get(r);
      if (rr.landlocked) continue; // exempt: it must cross its neighbours to reach the sea
      const ok = (x: number, y: number) => {
        const c = w.cellAt(x, y, true);
        return c.ocean || c.region === r;
      };
      for (let k = 0; k < rr.n; k++) {
        expect(ok(rr.x[k], rr.y[k])).toBe(true);
        const p = rr.parent[k];
        if (p >= 0) expect(ok((rr.x[k] + rr.x[p]) / 2, (rr.y[k] + rr.y[p]) / 2)).toBe(true);
        checked++;
      }
      for (const k of rr.roots) expect(w.cellAt(rr.x[k], rr.y[k], true).ocean).toBe(true);
    }
    expect(checked).toBeGreaterThan(10000);
  });

  it('reaches nearly every attractor, and the roots carry all the flow', () => {
    const w = world();
    const rv = new Rivers(w, rp());
    for (const r of landRegions(w, 4)) {
      const rr = rv.get(r);
      expect(rr.roots.length).toBeGreaterThan(0);
      // a few attractors can be cut off from the sea by another region's land
      expect(rr.reached).toBeGreaterThanOrEqual(rr.ax.length * 0.99);
      let rootFlow = 0;
      for (const k of rr.roots) rootFlow += rr.flow[k];
      expect(rootFlow).toBe(rr.reached);
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
      expect(own).toBe(rr.reached);
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
        // at the biome's site, or (when the site sits on a sliver of land) at an ocean subbiome site of it
        const atSite = rr.x[k] === o.x && rr.y[k] === o.y;
        const atSub = w.biomeSubs(o).some((s) => w.sub(s).x === rr.x[k] && w.sub(s).y === rr.y[k]);
        expect(atSite || atSub).toBe(true);
        expect(w.cellAt(rr.x[k], rr.y[k], true).ocean).toBe(true);
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
