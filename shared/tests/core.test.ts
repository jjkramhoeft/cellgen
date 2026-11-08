import { describe, expect, it } from 'vitest';
import { dcos, dexp, dlog, dpow, dsin } from '../core/dmath';
import { hash3, hashString, sfc32, seedFromText } from '../core/hash';
import { fbm, simplex2 } from '../core/noise';
import { generatePoints } from '../core/sampling';
import { MinHeap } from '../core/heap';

describe('hashing', () => {
  it('is deterministic and well spread', () => {
    expect(hash3(1, 2, 3)).toBe(hash3(1, 2, 3));
    expect(hash3(1, 2, 3)).not.toBe(hash3(1, 2, 4));
    const buckets = new Array(16).fill(0);
    for (let i = 0; i < 16000; i++) buckets[hash3(42, 7, i) & 15]++;
    for (const b of buckets) expect(Math.abs(b - 1000)).toBeLessThan(150);
  });
  it('parses seeds', () => {
    expect(seedFromText('123')).toBe(123);
    expect(seedFromText('hello')).toBe(hashString('hello'));
  });
  it('sfc32 is reproducible', () => {
    const a = sfc32(9);
    const b = sfc32(9);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
});

describe('deterministic math', () => {
  it('matches Math within tight tolerance', () => {
    for (let k = -50; k <= 50; k++) {
      const x = k * 0.37;
      expect(dsin(x)).toBeCloseTo(Math.sin(x), 13);
      expect(dcos(x)).toBeCloseTo(Math.cos(x), 13);
      expect(dexp(x / 5)).toBeCloseTo(Math.exp(x / 5), 10);
    }
    for (const x of [1e-6, 0.01, 0.5, 1, 2, 3.7, 100, 12345.678]) {
      expect(Math.abs(dlog(x) - Math.log(x))).toBeLessThan(1e-13 * Math.max(1, Math.abs(Math.log(x))));
      expect(dpow(x, 1.37) / Math.pow(x, 1.37)).toBeCloseTo(1, 12);
    }
    expect(dpow(3, 4)).toBe(81);
  });
});

describe('noise', () => {
  it('simplex stays in [-1, 1] and is deterministic', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 20000; i++) {
      const v = simplex2(5, i * 0.137, i * 0.0731 + (i % 7));
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThan(-1.05);
    expect(hi).toBeLessThan(1.05);
    expect(hi - lo).toBeGreaterThan(1.4);
    expect(fbm(3, 0.5, 0.25, { octaves: 4, lacunarity: 2, gain: 0.5 })).toBe(fbm(3, 0.5, 0.25, { octaves: 4, lacunarity: 2, gain: 0.5 }));
  });
});

describe('sampling', () => {
  const base = { n: 800, W: 1000, H: 600, seed: 7, jitter: 0.9, poissonK: 30, density: 'none' as const, densityContrast: 0.8, densityFreq: 3 };
  it('poisson disc respects its minimum distance', () => {
    const pts = generatePoints({ ...base, method: 'poisson' });
    expect(pts.xs.length).toBeGreaterThan(500);
    expect(pts.xs.length).toBeLessThan(1200);
    const r = Math.sqrt((0.63 * 1000 * 600) / 800);
    let minD = Infinity;
    for (let i = 0; i < pts.xs.length; i++)
      for (let j = i + 1; j < pts.xs.length; j++) {
        const d = Math.hypot(pts.xs[i] - pts.xs[j], pts.ys[i] - pts.ys[j]);
        minD = Math.min(minD, d);
      }
    expect(minD).toBeGreaterThanOrEqual(r * 0.999);
  });
  it('every method returns points inside the map', () => {
    for (const method of ['uniform', 'jitter-square', 'jitter-hex', 'poisson', 'best-candidate', 'spiral'] as const) {
      const pts = generatePoints({ ...base, method });
      expect(pts.xs.length).toBeGreaterThan(400);
      for (let i = 0; i < pts.xs.length; i++) {
        expect(pts.xs[i]).toBeGreaterThanOrEqual(0);
        expect(pts.xs[i]).toBeLessThanOrEqual(1000);
        expect(pts.ys[i]).toBeGreaterThanOrEqual(0);
        expect(pts.ys[i]).toBeLessThanOrEqual(600);
      }
    }
  });
});

describe('heap', () => {
  it('pops in key order', () => {
    const h = new MinHeap(2);
    const keys = [5, 3, 9, 1, 7, 3, 0];
    keys.forEach((k, i) => h.push(k, i));
    const out: number[] = [];
    while (h.size) {
      out.push(h.peekKey());
      h.pop();
    }
    expect(out).toEqual([...keys].sort((a, b) => a - b));
  });
});
