import { describe, expect, it } from 'vitest';
import { sfc32 } from '@shared/core/hash';
import { decodeState, encodeState } from '@shared/params/url';
import { ALL_DEFS, defaults, toFieldParams } from '../src/params';
import { PRESETS } from '../src/presets';
import { analyse } from '../src/voronoi/analysis';
import { Field, newSample, oceanSeedCount } from '../src/voronoi/field';
import { Lattice, newHit, type WeightMode } from '../src/voronoi/lattice';
import { METRIC_IDS, Metric, type MetricId } from '../src/voronoi/metrics';

const opts = (id: MetricId, extra: Partial<{ p: number; angle: number; stretch: number }> = {}) => ({ id, p: 0.6, angle: 0, stretch: 1, ...extra });

describe('metrics', () => {
  it('has at least five distance functions', () => {
    expect(METRIC_IDS.length).toBeGreaterThanOrEqual(5);
  });

  it('computes the textbook values', () => {
    expect(new Metric(opts('euclidean')).value(3, 4)).toBe(5);
    expect(new Metric(opts('squared')).value(3, 4)).toBe(25);
    expect(new Metric(opts('manhattan')).value(3, -4)).toBe(7);
    expect(new Metric(opts('chebyshev')).value(-3, 4)).toBe(4);
    expect(new Metric(opts('minkowski', { p: 2 })).value(3, 4)).toBe(5);
    expect(new Metric(opts('minkowski', { p: 3 })).value(3, 4)).toBeCloseTo(Math.cbrt(27 + 64), 10);
    expect(new Metric(opts('octagonal')).value(1, 1)).toBeCloseTo(Math.SQRT2, 12);
    expect(new Metric(opts('hexagonal')).value(1, 0)).toBe(1);
  });

  it('triangular is asymmetric but positive', () => {
    const m = new Metric(opts('triangular'));
    expect(m.value(0, 1)).not.toBeCloseTo(m.value(0, -1), 3);
    for (let a = 0; a < 6.28; a += 0.1) expect(m.value(Math.cos(a), Math.sin(a))).toBeGreaterThan(0);
  });

  it('lower bound holds for every metric, rotation and stretch', () => {
    const rng = sfc32(7);
    for (const id of METRIC_IDS) {
      for (const [angle, stretch] of [
        [0, 1],
        [30, 1],
        [45, 2.5],
        [120, 0.3],
      ]) {
        const m = new Metric(opts(id, { angle, stretch, p: id === 'minkowski' ? 0.5 : 2 }));
        for (let i = 0; i < 400; i++) {
          const dx = rng() * 6 - 3;
          const dy = rng() * 6 - 3;
          expect(m.norm(dx, dy), `${id} ${angle} ${stretch}`).toBeGreaterThanOrEqual(m.lb * Math.max(Math.abs(dx), Math.abs(dy)) - 1e-12);
        }
      }
    }
  });

  it('unit-ball polygon lies on norm = 1', () => {
    for (const id of METRIC_IDS) {
      const m = new Metric(opts(id, { angle: 20, stretch: 1.7 }), Math.pow);
      const b = m.ballPolygon(64);
      for (let i = 0; i < b.length; i += 2) expect(m.norm(b[i], b[i + 1])).toBeCloseTo(1, 9);
    }
  });
});

describe('lattice Voronoi search', () => {
  /** Brute force over a wide block of lattice cells. */
  function brute(lat: Lattice, wx: number, wy: number) {
    const qx = lat.toLatticeX(wx);
    const qy = lat.toLatticeY(wy);
    const ci = Math.floor(qx);
    const cj = Math.floor(qy);
    const all: { s: number; i: number; j: number }[] = [];
    for (let j = cj - 7; j <= cj + 7; j++) {
      for (let i = ci - 7; i <= ci + 7; i++) {
        const f = lat.metric.value(qx - lat.siteX(i, j), qy - lat.siteY(i, j));
        const w = lat.weight(i, j);
        const s = lat.weightMode === 'additive' ? f - w : lat.weightMode === 'multiplicative' ? f / w : f;
        all.push({ s, i, j });
      }
    }
    all.sort((a, b) => a.s - b.s || a.j - b.j || a.i - b.i);
    return all;
  }

  const cases: [MetricId, WeightMode, number, number, number][] = [];
  for (const id of METRIC_IDS) {
    cases.push([id, 'none', 0, 1, 0]);
    cases.push([id, 'none', 0, 0.3, 35]);
  }
  cases.push(['euclidean', 'additive', 0.8, 1, 0], ['squared', 'additive', 0.8, 1, 0], ['manhattan', 'multiplicative', 1, 1, 0]);

  it.each(cases)('%s (weights %s %f, jitter %f, rot %f) matches brute force', (id, wm, wa, jitter, angle) => {
    const lat = new Lattice({
      seed: 1234,
      size: 37,
      ox: 5,
      oy: -11,
      jitter,
      metric: new Metric(opts(id, { angle, p: 0.6, stretch: angle ? 1.8 : 1 })),
      weightMode: wm,
      weightAmt: wa,
    });
    const rng = sfc32(99);
    const h = newHit();
    for (let t = 0; t < 300; t++) {
      const wx = rng() * 2000 - 1000;
      const wy = rng() * 2000 - 1000;
      lat.query(wx, wy, h);
      const b = brute(lat, wx, wy);
      expect(h.s1).toBeCloseTo(b[0].s, 12);
      expect(h.s2).toBeCloseTo(b[1].s, 12);
      if (b[1].s - b[0].s > 1e-9) expect([h.i1, h.j1]).toEqual([b[0].i, b[0].j]);
    }
  });

  it('jitter 0 gives sites on lattice-cell centres', () => {
    const lat = new Lattice({ seed: 1, size: 10, ox: 0, oy: 0, jitter: 0, metric: new Metric(opts('euclidean')), weightMode: 'none', weightAmt: 0 });
    expect(lat.siteX(3, -2)).toBe(3.5);
    expect(lat.siteY(3, -2)).toBe(-1.5);
  });
});

describe('fractal field', () => {
  const base = () => toFieldParams(defaults(), 4242);

  it('is deterministic', () => {
    const a = analyse(new Field(base()), new Field(base()).calibrate(96));
    const b = analyse(new Field(base()), new Field(base()).calibrate(96));
    expect(a.fingerprint).toBe(b.fingerprint);
    const c = analyse(new Field({ ...base(), seed: 4243 }), new Field({ ...base(), seed: 4243 }).calibrate(96));
    expect(c.fingerprint).not.toBe(a.fingerprint);
  });

  it.each([0.1, 0.25, 0.4, 0.6, 0.85])('hits the target land ratio %f', (land) => {
    const f = new Field({ ...base(), land });
    const cal = f.calibrate(128);
    const st = analyse(f, cal);
    expect(Math.abs(st.landFraction - land)).toBeLessThan(0.03);
  });

  it('0% and 100% land are exact', () => {
    for (const land of [0, 1]) {
      const f = new Field({ ...base(), land });
      expect(analyse(f, f.calibrate(64)).landFraction).toBe(land);
    }
  });

  it('works for every metric, with 1–4 octaves', () => {
    for (const id of METRIC_IDS) {
      for (const octaves of [1, 4]) {
        const f = new Field({ ...base(), octaves, metric: { ...base().metric, id } });
        const cal = f.calibrate(48);
        expect(Number.isFinite(cal.threshold), id).toBe(true);
        expect(f.lattices.length).toBe(octaves);
      }
    }
  });

  it('coastlines run along cell edges: v is constant inside a cell overlay', () => {
    const f = new Field({ ...base(), octaves: 2 });
    const smp = f.makeSampler();
    const s = newSample(2);
    const seen = new Map<string, number>();
    const rng = sfc32(5);
    for (let i = 0; i < 3000; i++) {
      smp(rng() * 1600, rng() * 1000, s);
      const key = `${s.ids[0]}|${s.ids[1]}`;
      const prev = seen.get(key);
      if (prev !== undefined) expect(s.v).toBe(prev);
      seen.set(key, s.v);
    }
  });

  it('more octaves give a rougher coastline', () => {
    const dim = (octaves: number) => {
      const f = new Field({ ...base(), octaves, gain: 0.7, roughness: 0.5 });
      return analyse(f, f.calibrate(256)).coastLength;
    };
    expect(dim(3)).toBeGreaterThan(dim(1));
  });
});

describe('random oceans', () => {
  const base = () => ({ ...toFieldParams(defaults(), 777), shape: 'oceans' as const });

  it('seeds one ocean per started 10 % of water', () => {
    expect(oceanSeedCount(0)).toBe(1);
    expect(oceanSeedCount(0.05)).toBe(1);
    expect(oceanSeedCount(0.1)).toBe(1);
    expect(oceanSeedCount(0.11)).toBe(2);
    expect(oceanSeedCount(0.2)).toBe(2);
    expect(oceanSeedCount(0.6)).toBe(6);
    expect(oceanSeedCount(0.95)).toBe(10);
    expect(oceanSeedCount(1)).toBe(10);
    for (const land of [0.95, 0.85, 0.5, 0.25]) {
      const f = new Field({ ...base(), land });
      expect(f.oceans!.seeds.length).toBe(oceanSeedCount(1 - land));
    }
  });

  it.each([0.1, 0.35, 0.6, 0.9])('floods until the land share is %f', (land) => {
    const f = new Field({ ...base(), land });
    const st = analyse(f, f.calibrate(160));
    expect(Math.abs(st.landFraction - land)).toBeLessThan(0.03);
  });

  it('every water body grows from a seed, and seeds are water', () => {
    for (const land of [0.75, 0.45, 0.2]) {
      const f = new Field({ ...base(), land, octaves: 1 });
      // same sample positions as the flood's own grid, so connectivity matches exactly
      const cal = f.calibrate(320);
      const st = analyse(f, cal);
      const { gw, gh } = cal;
      const seen = new Uint8Array(gw * gh);
      let bodies = 0;
      for (let s = 0; s < gw * gh; s++) {
        if (st.mask[s] || seen[s]) continue;
        bodies++;
        const stack = [s];
        seen[s] = 1;
        while (stack.length) {
          const c = stack.pop()!;
          const x = c % gw;
          for (const nb of [x > 0 ? c - 1 : -1, x < gw - 1 ? c + 1 : -1, c - gw, c + gw]) {
            if (nb >= 0 && nb < gw * gh && !st.mask[nb] && !seen[nb]) {
              seen[nb] = 1;
              stack.push(nb);
            }
          }
        }
      }
      expect(bodies, `land ${land}`).toBeLessThanOrEqual(f.oceans!.seeds.length);
      const smp = f.makeSampler();
      const s = newSample(1);
      for (const seed of f.oceans!.seeds) expect(smp(seed.x, seed.y, s).v).toBeLessThanOrEqual(cal.threshold);
    }
  });

  it('is deterministic per seed', () => {
    const a = new Field({ ...base(), land: 0.5 }).oceans!.seeds;
    const b = new Field({ ...base(), land: 0.5 }).oceans!.seeds;
    const c = new Field({ ...base(), land: 0.5, seed: 778 }).oceans!.seeds;
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('params and presets', () => {
  it('round-trips through the URL', () => {
    const p = { ...defaults(), 'metric.kind': 'hexagonal', 'land.pct': 63, 'view.color': 'f2f1' };
    const back = decodeState(`#${encodeState('abc', p, ALL_DEFS)}`, ALL_DEFS, 'x');
    expect(back?.seed).toBe('abc');
    expect(back?.params).toEqual(p);
  });

  it('presets only use known keys and valid values', () => {
    const byKey = new Map(ALL_DEFS.map((d) => [d.key, d]));
    for (const pr of PRESETS) {
      for (const [k, v] of Object.entries(pr.params)) {
        const d = byKey.get(k);
        expect(d, `${pr.id}: ${k}`).toBeDefined();
        if (d!.type === 'select') expect(d!.options.map((o) => o.value), `${pr.id}: ${k}`).toContain(v);
        if (d!.type === 'number' || d!.type === 'int') {
          expect(v as number).toBeGreaterThanOrEqual(d!.min);
          expect(v as number).toBeLessThanOrEqual(d!.max);
        }
      }
    }
  });
});
