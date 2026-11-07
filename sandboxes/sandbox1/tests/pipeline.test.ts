import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/graph/build';
import { runPipeline } from '../src/gen/pipeline';
import { WATER_OCEAN } from '../src/gen/hydrology';
import { defaults, type Params } from '../src/params/schema';
import { PRESETS } from '../src/params/presets';

function run(over: Params, seed = 1234) {
  const p = { ...defaults(), 'graph.cells': 1500, ...over };
  const g = buildGraph(p, seed);
  return runPipeline(g, p, seed, 0);
}

describe('pipeline', () => {
  it('is deterministic', () => {
    const a = run({ 'sca.enabled': true, 'paths.enabled': true, 'ca.enabled': true });
    const b = run({ 'sca.enabled': true, 'paths.enabled': true, 'ca.enabled': true });
    expect(a.fingerprint).toBe(b.fingerprint);
    const c = run({}, 999);
    expect(c.fingerprint).not.toBe(a.fingerprint);
  });

  it('matches the golden fingerprint for the default world', () => {
    // Update deliberately when generation changes on purpose.
    expect(run({}).fingerprint).toMatchSnapshot();
  });

  it('hits the requested land fraction', () => {
    const w = run({ 'elev.land': 0.4, 'elev.mask': 'none' });
    expect(Math.abs(w.stats.landFrac - 0.4)).toBeLessThan(0.05);
  });

  it('every land cell drains to the ocean or the map edge', () => {
    const w = run({});
    const g = w.graph;
    const dr = w.drainage!;
    for (let i = 0; i < g.n; i++) {
      let c = i;
      let steps = 0;
      while (dr.downhill[c] >= 0 && steps <= g.n) {
        expect(dr.filled[dr.downhill[c]]).toBeLessThan(dr.filled[c]);
        c = dr.downhill[c];
        steps++;
      }
      expect(w.water[c] === WATER_OCEAN || g.border[c] === 1).toBe(true);
    }
  });

  it('space colonization grows a forest from its roots', () => {
    const w = run({ 'sca.enabled': true });
    const s = w.sca!;
    expect(s.roots).toBeGreaterThan(0);
    expect(s.count).toBeGreaterThan(s.roots * 5);
    for (let k = 0; k < s.count; k++) {
      if (s.parent[k] >= 0) expect(s.parent[k]).toBeLessThan(k);
    }
    expect(s.maxOrder).toBeGreaterThanOrEqual(2);
  });

  it('runs every preset on every cell type without throwing', () => {
    for (const preset of PRESETS) {
      const w = run({ ...preset.params, 'graph.cells': 600, 'imp.res': 200 }, 77);
      expect(w.graph.n).toBeGreaterThan(100);
      expect(w.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    }
    for (const t of ['square', 'hex', 'tri', 'implicit']) {
      const w = run({ 'graph.type': t, 'graph.cells': 600, 'imp.res': 200, 'sca.enabled': true, 'ca.enabled': true, 'paths.enabled': true, 'elev.method': 'plates' }, 5);
      expect(w.graph.n).toBeGreaterThan(100);
    }
  });
});
