import { describe, expect, it } from 'vitest';
import { perlin2 } from '@shared/core/noise';
import { defaults, toClimateParams } from '../src/params';
import { Climate } from '../src/world/climate';

/** Values of a field on a grid over a large area (far more than one feature size). */
function sampleField(at: (x: number, y: number) => number, span: number, n: number): number[] {
  const v: number[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v.push(at(-span / 2 + (span * i) / n + 137, -span / 2 + (span * j) / n + 911));
  return v;
}

const climate = (seed: number) => new Climate(toClimateParams(defaults(), seed));

describe('perlin2', () => {
  it('is deterministic, zero on the lattice and within [-1, 1]', () => {
    expect(perlin2(7, 3, -4)).toBe(0);
    for (let k = 0; k < 2000; k++) {
      const x = k * 0.137 - 50;
      const y = k * 0.291 + 13;
      const v = perlin2(42, x, y);
      expect(v).toBe(perlin2(42, x, y));
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
    let differ = 0;
    for (let k = 0; k < 100; k++) if (perlin2(1, k + 0.5, 0.3) !== perlin2(2, k + 0.5, 0.3)) differ++;
    expect(differ).toBeGreaterThan(80);
  });
});

describe('initial climate', () => {
  it('defaults: temperature reaches about −10 to 30 °C, precipitation about 100 to 10 000 mm per year', () => {
    for (const seed of [1, 2024, 987654]) {
      const c = climate(seed);
      const t = sampleField((x, y) => c.temperatureAt(x, y), 30_000_000, 220);
      const h = sampleField((x, y) => c.precipitationAt(x, y), 10_000_000, 220);
      expect(Math.min(...t)).toBeGreaterThanOrEqual(-10);
      expect(Math.max(...t)).toBeLessThanOrEqual(30);
      expect(Math.min(...t)).toBeLessThan(-8);
      expect(Math.max(...t)).toBeGreaterThan(28);
      expect(Math.min(...h)).toBeGreaterThanOrEqual(100);
      expect(Math.max(...h)).toBeLessThanOrEqual(10_000);
      expect(Math.min(...h)).toBeLessThan(600);
      expect(Math.max(...h)).toBeGreaterThan(9500);
      // centred on the middle of the range
      const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
      expect(mean(t)).toBeGreaterThan(5);
      expect(mean(t)).toBeLessThan(15);
      // precipitation is log-scaled: centred on √(100 · 10 000) = 1000 mm, most of it dry to moderate
      const sorted = [...h].sort((x, y) => x - y);
      const median = sorted[sorted.length >> 1];
      expect(median).toBeGreaterThan(600);
      expect(median).toBeLessThan(1700);
      expect(h.filter((v) => v > 3000).length / h.length).toBeLessThan(0.2);
    }
  });

  it('is a pure function of seed and point, with independent fields', () => {
    const a = climate(5);
    const b = climate(5);
    const c = climate(6);
    let diffSeed = 0;
    let corr = 0;
    const t: number[] = [];
    const h: number[] = [];
    for (let k = 0; k < 400; k++) {
      const x = k * 53_000 - 9_000_000;
      const y = ((k * 7919) % 400) * 41_000;
      expect(a.temperatureAt(x, y)).toBe(b.temperatureAt(x, y));
      expect(a.precipitationAt(x, y)).toBe(b.precipitationAt(x, y));
      if (a.temperatureAt(x, y) !== c.temperatureAt(x, y)) diffSeed++;
      t.push(a.temperatureAt(x, y));
      h.push(a.precipitationAt(x, y));
    }
    expect(diffSeed).toBeGreaterThan(390);
    const mt = t.reduce((s, v) => s + v, 0) / t.length;
    const mh = h.reduce((s, v) => s + v, 0) / h.length;
    let st = 0;
    let sh = 0;
    for (let k = 0; k < t.length; k++) {
      corr += (t[k] - mt) * (h[k] - mh);
      st += (t[k] - mt) ** 2;
      sh += (h[k] - mh) ** 2;
    }
    expect(Math.abs(corr / Math.sqrt(st * sh))).toBeLessThan(0.3);
  });

  it('follows the min / max parameters (swapped values are sorted)', () => {
    const p = toClimateParams({ ...defaults(), 'clim.t.min': 40, 'clim.t.max': 0 }, 3);
    expect(p.temperature.min).toBe(0);
    expect(p.temperature.max).toBe(40);
    const c = new Climate(p);
    const t = sampleField((x, y) => c.temperatureAt(x, y), 20_000_000, 120);
    expect(Math.min(...t)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...t)).toBeLessThanOrEqual(40);
  });

  it('prosperity: defaults to about 1 to 100, its own seed, and follows its min / max', () => {
    const d = defaults();
    expect(d['clim.pros.min']).toBe(1);
    expect(d['clim.pros.max']).toBe(100);
    const c = climate(11);
    const w = sampleField((x, y) => c.prosperityAt(x, y), 30_000_000, 200);
    expect(Math.min(...w)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...w)).toBeLessThanOrEqual(100);
    // spreads over most of the range, centred near the middle
    expect(Math.min(...w)).toBeLessThan(20);
    expect(Math.max(...w)).toBeGreaterThan(80);
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    expect(Math.abs(mean - 50.5)).toBeLessThan(10);
    // independent of temperature and precipitation (own seed salt)
    const t = sampleField((x, y) => c.temperatureAt(x, y), 30_000_000, 200);
    let same = 0;
    for (let k = 0; k < w.length; k++) if (Math.abs((w[k] - 1) / 99 - (t[k] + 10) / 40) < 1e-9) same++;
    expect(same).toBeLessThan(w.length / 100);
    const q = new Climate(toClimateParams({ ...d, 'clim.pros.min': 500, 'clim.pros.max': 200 }, 11));
    const v = sampleField((x, y) => q.prosperityAt(x, y), 20_000_000, 100);
    expect(Math.min(...v)).toBeGreaterThanOrEqual(200);
    expect(Math.max(...v)).toBeLessThanOrEqual(500);
  });
});
