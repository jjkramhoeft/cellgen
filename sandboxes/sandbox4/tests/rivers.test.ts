import { describe, expect, it } from 'vitest';
import { defaults, toRiverParams, toWorldParams } from '../src/params';
import { coneCos, Rivers, type RiverParams } from '../src/world/rivers';
import { RIVER_REF_FLOW, riverPx } from '../src/render/overlays';
import { World } from '../src/world/world';

const world = (seed = 12345) => new World(toWorldParams(defaults(), seed));
const rp = (over: Partial<RiverParams> = {}): RiverParams => ({ ...toRiverParams(defaults()), ...over });

/** Regions around the origin that have land. */
function landRegions(w: World, n = 6): number[] {
  const out: number[] = [];
  for (const r of World.cellsIn(w.regionLevel, -400000, -400000, 400000, 400000, 0)) {
    if (w.region(r).elevationZones.some((b) => !w.elevationZoneCell(b).ocean)) out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

describe('space-colonization rivers', () => {
  it('places attractors only in inland land subbiomes drawn in the region, perSub per subbiome', () => {
    const w = world();
    const rv = new Rivers(w, rp({ perSub: 10, flatSparseChance: 0 }));
    const r = landRegions(w, 1)[0];
    const { ax, ay } = rv.attractors(r);
    expect(ax.length).toBeGreaterThan(100);
    expect(ax.length % 10).toBe(0);
    let eligible = 0;
    for (const b of rv.regionElevationZones(r)) {
      if (w.elevationZoneCell(b).ocean) continue;
      for (const s of w.elevationZoneSubs(w.elevationZone(b))) {
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

  it('gives the subbiomes of a river-poor flat elevation zone only 0 or 1 attractor', () => {
    const w = world();
    const regions = landRegions(w, 12);
    const count = (rv: Rivers) => regions.reduce((n, r) => n + rv.attractors(r).ax.length, 0);
    const flatZones = new Set<number>();
    for (const r of regions) for (const b of new Rivers(w, rp()).regionElevationZones(r)) if (!w.elevationZoneCell(b).ocean) flatZones.add(w.elevationZoneCell(b).elevationZone);
    // chance 0: no zone is sparse; chance 1: every flat zone (and nothing else) is
    const none = new Rivers(w, rp({ perSub: 10, flatSparseChance: 0 }));
    const all = new Rivers(w, rp({ perSub: 10, flatSparseChance: 1 }));
    let flat = 0;
    for (const z of flatZones) {
      expect(none.isSparseFlat(z)).toBe(false);
      if (all.isSparseFlat(z)) flat++;
    }
    expect(flat).toBeGreaterThan(0);
    expect(count(all)).toBeLessThan(count(none));
    // per region: perSub for every eligible subbiome outside sparse zones, plus 0 or 1 for each inside one
    for (const r of regions) {
      let dense = 0;
      let sparse = 0;
      for (const b of all.regionElevationZones(r)) {
        const bc = w.elevationZoneCell(b);
        if (bc.ocean) continue;
        for (const s of w.elevationZoneSubs(w.elevationZone(b))) {
          const c = w.subCell(s);
          if (c.ocean || c.region !== r || all.isCoastSub(s)) continue;
          if (all.isSparseFlat(bc.elevationZone)) sparse++;
          else dense++;
        }
      }
      const n = all.attractors(r).ax.length;
      expect(n).toBeGreaterThanOrEqual(dense * 10);
      expect(n).toBeLessThanOrEqual(dense * 10 + sparse);
    }
    // about a third of the flat zones are sparse at the default chance
    const def = new Rivers(w, rp());
    expect(toRiverParams(defaults()).flatSparseChance).toBeCloseTo(0.33);
    const hits = [...flatZones].filter((z) => all.isSparseFlat(z) && def.isSparseFlat(z)).length;
    expect(hits).toBeLessThan(flat);
  });

  it('follows the drawn regions: an elevation zone merged into a neighbouring region belongs to that region', () => {
    const w = world();
    const rv = new Rivers(w, rp());
    let moved = 0;
    for (const r of World.cellsIn(w.regionLevel, -400000, -400000, 400000, 400000, 0)) {
      const mine = new Set(rv.regionElevationZones(r));
      for (const b of w.region(r).elevationZones) {
        expect(mine.has(b)).toBe(w.elevationZoneCell(b).region === r);
        if (!mine.has(b)) moved++;
      }
      for (const b of mine) expect(w.elevationZoneCell(b).region).toBe(r);
    }
    // the case exists with the default parameters (merges cross region borders)
    expect(moved).toBeGreaterThan(0);
  });

  it('never crosses into another region: every node and segment is ocean or the region’s own land', () => {
    const w = world();
    const rv = new Rivers(w, rp());
    let checked = 0;
    for (const r of World.cellsIn(w.regionLevel, -400000, -400000, 400000, 400000, 0)) {
      if (!w.region(r).elevationZones.some((b) => !w.elevationZoneCell(b).ocean)) continue;
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

  it('puts one root at the point of each ocean elevation zone touching the region, and flags nodes over water', () => {
    const w = world();
    const rv = new Rivers(w, rp());
    for (const r of landRegions(w, 3)) {
      const rr = rv.get(r);
      expect(new Set(rr.rootOcean).size).toBe(rr.rootOcean.length);
      rr.roots.forEach((k, t) => {
        const o = w.elevationZone(rr.rootOcean[t]);
        expect(w.elevationZoneCell(o.key).ocean).toBe(true);
        // at the elevation zone's site, or (when the site sits on a sliver of land) at an ocean subbiome site of it
        const atSite = rr.x[k] === o.x && rr.y[k] === o.y;
        const atSub = w.elevationZoneSubs(o).some((s) => w.sub(s).x === rr.x[k] && w.sub(s).y === rr.y[k]);
        expect(atSite || atSub).toBe(true);
        expect(w.cellAt(rr.x[k], rr.y[k], true).ocean).toBe(true);
        // the ocean elevation zone touches land
        expect(w.elevationZoneNbrs(o).some((n) => !w.elevationZoneCell(n).ocean)).toBe(true);
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

/** Angle (degrees) between two unit-ish vectors. */
const angle = (ax: number, ay: number, bx: number, by: number) =>
  (Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by))))) * 180) / Math.PI;

/** Mean turn per step along unbranched land reaches, mean junction angle, and tip count over some regions. */
function shape(over: Partial<RiverParams>, regions = 4) {
  const w = world();
  const rv = new Rivers(w, rp(over));
  let turn = 0;
  let turnN = 0;
  let junc = 0;
  let juncN = 0;
  let tips = 0;
  for (const r of landRegions(w, regions)) {
    const rr = rv.get(r);
    const kids: number[][] = Array.from({ length: rr.n }, () => []);
    for (let k = 0; k < rr.n; k++) if (rr.parent[k] >= 0) kids[rr.parent[k]].push(k);
    const hx = (k: number) => rr.x[k] - rr.x[rr.parent[k]];
    const hy = (k: number) => rr.y[k] - rr.y[rr.parent[k]];
    for (let k = 0; k < rr.n; k++) {
      if (kids[k].length === 0) tips++;
      if (rr.parent[k] < 0) continue;
      if (kids[k].length === 1 && !rr.wet[k]) {
        turn += angle(hx(k), hy(k), hx(kids[k][0]), hy(kids[k][0]));
        turnN++;
      } else if (kids[k].length >= 2) {
        const [a, b] = [...kids[k]].sort((p, q) => rr.flow[q] - rr.flow[p]);
        junc += angle(hx(a), hy(a), hx(b), hy(b));
        juncN++;
      }
    }
  }
  return { turn: turn / turnN, junc: junc / juncN, tips };
}

describe('branch-look settings', () => {
  const variants: [string, Partial<RiverParams>][] = [
    ['inertia', { inertia: 1.5 }],
    ['cone', { cone: 90 }],
    ['wander', { wander: 0.9, jitter: 0.8 }],
    ['apical', { apical: 0.5 }],
    ['all together', { inertia: 1, cone: 120, wander: 0.8, apical: 0.5, pull: 'sqrt' }],
  ];
  for (const [name, over] of variants) {
    it(`${name}: deterministic, stays in the region, conserves flow, reaches ≥ 99%`, () => {
      const w = world();
      for (const r of landRegions(w, 2)) {
        const a = new Rivers(world(), rp(over)).compute(r);
        const b = new Rivers(world(), rp(over)).compute(r);
        expect(Array.from(b.x)).toEqual(Array.from(a.x));
        expect(Array.from(b.flow)).toEqual(Array.from(a.flow));
        expect(a.reached).toBeGreaterThanOrEqual(a.ax.length * 0.99);
        let rootFlow = 0;
        for (const k of a.roots) rootFlow += a.flow[k];
        expect(rootFlow).toBe(a.reached);
        for (let k = 0; k < a.n; k++) {
          const c = w.cellAt(a.x[k], a.y[k], true);
          if (!a.landlocked) expect(c.ocean || c.region === r).toBe(true);
          if (a.parent[k] >= 0) expect(Math.hypot(a.x[k] - a.x[a.parent[k]], a.y[k] - a.y[a.parent[k]])).toBeCloseTo(rp().step, 3);
        }
      }
    });
  }

  it('all off is the plain algorithm (defaults)', () => {
    const d = rp();
    expect([d.inertia, d.cone, d.wander, d.apical]).toEqual([0, 0, 0, 0]);
  });

  it('inertia straightens reaches and narrows junctions', () => {
    const base = shape({});
    const s = shape({ inertia: 1.5 });
    expect(s.turn).toBeLessThan(base.turn * 0.9);
    expect(s.junc).toBeLessThan(base.junc * 0.75);
  });

  it('the perception cone caps junction angles: children leave within ±half the cone of the heading', () => {
    const w = world();
    const rv = new Rivers(w, rp({ cone: 90, jitter: 0 }));
    let inside = 0;
    let all = 0;
    for (const r of landRegions(w, 3)) {
      const rr = rv.get(r);
      for (let k = 0; k < rr.n; k++) {
        const p = rr.parent[k];
        if (p < 0 || rr.parent[p] < 0) continue;
        all++;
        const t = angle(rr.x[p] - rr.x[rr.parent[p]], rr.y[p] - rr.y[rr.parent[p]], rr.x[k] - rr.x[p], rr.y[k] - rr.y[p]);
        if (t <= 45 + 1e-6) inside++;
      }
    }
    // straight bridges (the fallback when no node sees an attractor) are the only exception
    expect(inside / all).toBeGreaterThan(0.99);
    expect(shape({ cone: 90 }).junc).toBeLessThan(shape({}).junc * 0.6);
  });

  it('wander turns wiggle into smoother bends', () => {
    expect(shape({ wander: 0.9, jitter: 0.8 }).turn).toBeLessThan(shape({ jitter: 0.8 }).turn * 0.7);
  });

  it('main-stem dominance leaves fewer, larger tributaries', () => {
    expect(shape({ apical: 0.5 }).tips).toBeLessThan(shape({}).tips * 0.6);
  });

  it('width exponent pivots around flow 100, ½ is the original width, higher b favours trunks', () => {
    for (const b of [0.25, 1 / 3, 0.5, 0.75]) expect(riverPx(RIVER_REF_FLOW, 10, 1, b)).toBeCloseTo(riverPx(RIVER_REF_FLOW, 10, 1, 0.5), 9);
    for (const f of [1, 7, 100, 2500]) expect(riverPx(f, 10, 1, 0.5)).toBeCloseTo((10 / 7) * (0.45 + 0.3 * Math.sqrt(f)), 9);
    expect(riverPx(2500, 10, 1, 0.75)).toBeGreaterThan(riverPx(2500, 10, 1, 0.5));
    expect(riverPx(4, 10, 1, 0.75)).toBeLessThan(riverPx(4, 10, 1, 0.5));
  });

  it('cone cosines are the exact half-angle cosines', () => {
    for (const c of [150, 144, 120, 90, 60] as const) expect(coneCos(c)).toBeCloseTo(Math.cos(((c / 2) * Math.PI) / 180), 12);
    expect(coneCos(0)).toBe(-1);
  });
});
