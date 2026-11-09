import { describe, expect, it } from 'vitest';
import { testParams } from './fixture';
import { decodeState, encodeState } from '@shared/params/url';
import { ALL_DEFS, PRESETS, toWorldParams } from '../src/params';
import { keyI, keyJ, Level, packKey } from '../src/world/level';
import { LINKED, ORIGIN, resolveRoot, SEED, World, type WorldParams } from '../src/world/world';

const base = (over: Partial<WorldParams> = {}): WorldParams => ({ ...toWorldParams(testParams(), 12345), ...over });

/** Raw elevation zone keys whose site lies in a square around the origin. */
function elevationZonesNear(w: World, half: number): number[] {
  return World.cellsIn(w.elevationZoneLevel, -half, -half, half, half, 0);
}

describe('level', () => {
  it('packs keys exactly', () => {
    for (const [i, j] of [
      [0, 0],
      [-1, 5],
      [123456, -98765],
      [-2097152, 2097151],
    ]) {
      const k = packKey(i, j);
      expect(keyI(k)).toBe(i);
      expect(keyJ(k)).toBe(j);
    }
  });

  it('finds the true nearest site (brute force, with and without jitter)', () => {
    for (const jitter of [0, 0.5, 1]) {
      const L = new Level({ seed: 7, size: 1000, jitter, warp: 0, warpFreq: 1 });
      for (let t = 0; t < 400; t++) {
        const x = (t * 7919) % 20000 - 10000 + 0.37;
        const y = (t * 104729) % 20000 - 10000 + 0.61;
        const k = L.query(x, y);
        let best = Infinity;
        const ci = Math.floor(x / 1000);
        const cj = Math.floor(y / 1000);
        for (let j = cj - 4; j <= cj + 4; j++)
          for (let i = ci - 4; i <= ci + 4; i++) best = Math.min(best, Math.hypot(L.siteX(i, j) - x, L.siteY(i, j) - y));
        expect(Math.hypot(L.siteX(keyI(k), keyJ(k)) - x, L.siteY(keyI(k), keyJ(k)) - y)).toBeCloseTo(best, 6);
      }
    }
  });

  it('has a symmetric neighbour relation that contains the nearest neighbour', () => {
    const L = new Level({ seed: 3, size: 1000, jitter: 1, warp: 0, warpFreq: 1 });
    for (let i = -4; i <= 4; i++) {
      for (let j = -4; j <= 4; j++) {
        const nb = L.neighbours(i, j);
        expect(nb.length).toBeGreaterThanOrEqual(2);
        for (const n of nb) {
          const back = L.neighbours(keyI(n.key), keyJ(n.key)).map((m) => m.key);
          expect(back).toContain(packKey(i, j));
        }
        let best = Infinity;
        let bestKey = -1;
        for (let dj = -2; dj <= 2; dj++)
          for (let di = -2; di <= 2; di++) {
            if (!di && !dj) continue;
            const d = Math.hypot(L.siteX(i + di, j + dj) - L.siteX(i, j), L.siteY(i + di, j + dj) - L.siteY(i, j));
            if (d < best) {
              best = d;
              bestKey = packKey(i + di, j + dj);
            }
          }
        expect(nb[0].key).toBe(bestKey);
      }
    }
  });
});

describe('world', () => {
  it('is deterministic and independent of exploration order and cache trimming', () => {
    const pts: [number, number][] = [];
    for (let t = 0; t < 600; t++) pts.push([((t * 7919) % 800) * 1000 - 400000, ((t * 6271) % 800) * 1000 - 400000]);
    const a = new World(base());
    const b = new World(base());
    const fa = pts.map(([x, y]) => ({ ...a.cellAt(x, y, true) }));
    const fb: typeof fa = [];
    for (let t = pts.length - 1; t >= 0; t--) {
      if (t % 97 === 0) b.trim(0);
      fb[t] = { ...b.cellAt(pts[t][0], pts[t][1], true) };
    }
    expect(fb).toEqual(fa);
    expect(new World(base()).fingerprint(24)).toBe(new World(base()).fingerprint(24));
    expect(new World(base({ seed: 999 })).fingerprint(24)).not.toBe(new World(base()).fingerprint(24));
  });

  it('gives each region an ocean seed and merge count inside the configured range', () => {
    const w = new World(base({ oceanMin: 1, oceanMax: 2, elevationZoneMergeMin: 2, elevationZoneMergeMax: 4 }));
    const counts = new Set<number>();
    for (const r of World.cellsIn(w.regionLevel, -500000, -500000, 500000, 500000, 0)) {
      const reg = w.region(r);
      expect(reg.elevationZones.length).toBeGreaterThan(4);
      expect(reg.seeds.length).toBeGreaterThanOrEqual(1);
      expect(reg.seeds.length).toBeLessThanOrEqual(2);
      expect(reg.merges.size).toBeGreaterThanOrEqual(2);
      expect(reg.merges.size).toBeLessThanOrEqual(4);
      counts.add(reg.seeds.length);
      for (const s of reg.seeds) expect(w.elevationZone(s).region).toBe(r);
    }
    expect(counts.size).toBe(2);
  });

  it('turns exactly the seeds into ocean when nothing links or grows', () => {
    const w = new World(base({ connectChance: 0, growPasses: 0 }));
    for (const b of elevationZonesNear(w, 400000)) {
      const isSeed = w.region(w.elevationZone(b).region).seeds.includes(b);
      expect(w.ocean(b)).toBe(isSeed);
      if (isSeed) expect(w.origin(b)).toBe(ORIGIN.loneSeed);
    }
  });

  it('links every seed to its nearest seed through a chain of ocean elevation zones', () => {
    const w = new World(base({ connectChance: 1, growPasses: 0, oceanMin: 1, oceanMax: 1 }));
    let links = 0;
    for (const r of World.cellsIn(w.regionLevel, -300000, -300000, 300000, 300000, 0)) {
      for (const l of w.links(r)) {
        links++;
        expect(l.chain[0]).toBe(l.from);
        expect(l.chain[l.chain.length - 1]).toBe(l.to);
        for (const c of l.chain) {
          expect(w.ocean(c)).toBe(true);
          expect(w.baseFlags(c) & LINKED).toBe(LINKED);
        }
        expect(w.baseFlags(l.from) & SEED).toBe(SEED);
      }
    }
    expect(links).toBeGreaterThan(10);
  });

  it('double links connect a seed to its two nearest seeds', () => {
    const w = new World(base({ connectChance: 0, doubleLinkChance: 1, growPasses: 0, oceanMin: 1, oceanMax: 2 }));
    let doubles = 0;
    for (const r of World.cellsIn(w.regionLevel, -300000, -300000, 300000, 300000, 0)) {
      const bySeed = new Map<number, number[]>();
      for (const l of w.links(r)) bySeed.set(l.from, [...(bySeed.get(l.from) ?? []), l.to]);
      for (const s of w.region(r).seeds) {
        const to = bySeed.get(s) ?? [];
        expect(to.length).toBe(2);
        doubles++;
        // the two targets are the two nearest other seeds in the search window
        const sb = w.elevationZone(s);
        const d2 = (k: number) => (w.elevationZone(k).x - sb.x) ** 2 + (w.elevationZone(k).y - sb.y) ** 2;
        const others: number[] = [];
        const R = w.p.connectRange;
        for (let dj = -R; dj <= R; dj++)
          for (let di = -R; di <= R; di++) for (const t of w.region(packKey(keyI(r) + di, keyJ(r) + dj)).seeds) if (t !== s) others.push(t);
        others.sort((a, b) => d2(a) - d2(b) || a - b);
        expect(to).toEqual(others.slice(0, 2));
        expect(d2(to[0])).toBeLessThanOrEqual(d2(to[1]));
      }
    }
    expect(doubles).toBeGreaterThan(10);
  });

  it('double link chance sets the share of double-linked seeds and leaves single links alone at 0', () => {
    const count = (w: World) => {
      let seeds = 0;
      let doubles = 0;
      for (const r of World.cellsIn(w.regionLevel, -1500000, -1500000, 1500000, 1500000, 0)) {
        for (const s of w.region(r).seeds) {
          seeds++;
          if (w.linkCount(w.elevationZone(s)) === 2) doubles++;
        }
      }
      return doubles / seeds;
    };
    const share = count(new World(base({ doubleLinkChance: 0.05 })));
    expect(share).toBeGreaterThan(0.02);
    expect(share).toBeLessThan(0.09);
    const single = new World(base({ doubleLinkChance: 0 }));
    for (const r of World.cellsIn(single.regionLevel, -300000, -300000, 300000, 300000, 0)) {
      const from = single.links(r).map((l) => l.from);
      expect(new Set(from).size).toBe(from.length);
    }
  });

  it('grows only from linked ocean and converts at most 3 closest land neighbours per pass', () => {
    const w = new World(base({ growPasses: 1, growWeights: [0, 0, 0, 1] }));
    let grew = 0;
    for (const g of elevationZonesNear(w, 400000)) {
      const edges = w.growthFrom(g);
      if (!edges.length) continue;
      grew++;
      expect(w.baseFlags(g) & LINKED).toBe(LINKED);
      expect(edges.length).toBeLessThanOrEqual(3);
      for (const e of edges) {
        expect(w.oceanAt(e.to, 0)).toBe(false);
        expect(w.ocean(e.to)).toBe(true);
        expect(w.elevationZoneNbrs(w.elevationZone(g))).toContain(e.to);
      }
    }
    expect(grew).toBeGreaterThan(5);
    // weights [1, 0, 0, 0] = never convert anything
    const still = new World(base({ growPasses: 2, growWeights: [1, 0, 0, 0] }));
    for (const b of elevationZonesNear(still, 300000)) expect(still.ocean(b)).toBe(still.oceanAt(b, 0));
  });

  it('keeps merges on one side of the coast and inside the parent elevation zone', () => {
    const w = new World(base({ elevationZoneMergeMin: 4, elevationZoneMergeMax: 6, subMergeMin: 3, subMergeMax: 5 }));
    let bm = 0;
    for (const b of elevationZonesNear(w, 300000)) {
      const t = w.elevationZoneTarget(b);
      if (t < 0) continue;
      bm++;
      expect(w.ocean(t)).toBe(w.ocean(b));
      expect(w.elevationZoneNbrs(w.elevationZone(b))).toContain(t);
    }
    expect(bm).toBeGreaterThan(10);
    let sm = 0;
    for (const s of World.cellsIn(w.subLevel, -60000, -60000, 60000, 60000, 0)) {
      const t = w.subTarget(s);
      if (t < 0) continue;
      sm++;
      expect(w.elevationZoneRoot(w.sub(t).elevationZone)).toBe(w.elevationZoneRoot(w.sub(s).elevationZone));
    }
    expect(sm).toBeGreaterThan(5);
  });

  it('nests: a subbiome cell reports the merged elevation zone and region of its merged site', () => {
    const w = new World(base());
    for (let t = 0; t < 300; t++) {
      const c = w.cellAt(((t * 7919) % 400) * 1000 - 200000, ((t * 6271) % 400) * 1000 - 200000, true);
      const owner = w.sub(c.sub).elevationZone;
      expect(c.elevationZone).toBe(w.elevationZoneRoot(owner));
      expect(c.region).toBe(w.elevationZone(c.elevationZone).region);
      expect(c.ocean).toBe(w.ocean(c.elevationZone));
    }
  });

  it('produces a plausible ocean share with the spec defaults', () => {
    const w = new World(base());
    let ocean = 0;
    const n = 60;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (w.cellAt((x - n / 2) * 20000, (y - n / 2) * 20000, false).ocean) ocean++;
    const share = ocean / (n * n);
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.7);
  });

  it('resolves merge chains and cycles', () => {
    const t = (m: Record<number, number>) => (k: number) => m[k] ?? -1;
    expect(resolveRoot(1, t({ 1: 2, 2: 3 }))).toBe(3);
    expect(resolveRoot(5, t({ 5: 2, 2: 5 }))).toBe(2);
    expect(resolveRoot(2, t({ 5: 2, 2: 5 }))).toBe(2);
    expect(resolveRoot(9, t({ 9: 4, 4: 7, 7: 4 }))).toBe(4);
    expect(resolveRoot(8, t({}))).toBe(8);
  });
});

describe('params', () => {
  it('round-trips through the URL', () => {
    const p = { ...testParams(), 'ez.warp': 0.5, 'oc.passes': 3, 'sub.nest': false };
    const back = decodeState(`#${encodeState('abc', p, ALL_DEFS)}`, ALL_DEFS, 'x');
    expect(back?.seed).toBe('abc');
    expect(back?.params).toEqual(p);
  });

  it('keeps levels nested and every preset valid', () => {
    for (const pr of PRESETS) {
      const wp = toWorldParams({ ...testParams(), ...pr.params }, 1);
      expect(wp.elevationZoneSize).toBeLessThan(wp.regionSize);
      expect(wp.subSize).toBeLessThan(wp.elevationZoneSize);
      for (const k of Object.keys(pr.params)) expect(ALL_DEFS.some((d) => d.key === k), k).toBe(true);
    }
    const wp = toWorldParams({ ...testParams(), 'reg.size': 32, 'ez.size': 128, 'sub.size': 32 }, 1);
    expect(wp.elevationZoneSize).toBeLessThan(wp.regionSize);
    expect(wp.subSize).toBeLessThan(wp.elevationZoneSize);
  });
});
