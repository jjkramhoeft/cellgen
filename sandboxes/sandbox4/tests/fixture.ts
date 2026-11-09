/**
 * Test parameters: the schema defaults with a fixed baseline on top.
 *
 * defaults.json is tuned for how the map looks, and its values change often. Many tests
 * check model behaviour against numbers measured at one parameter set (shape statistics,
 * counts, timings), so they run against this frozen baseline rather than the live
 * defaults. Retuning defaults.json therefore never breaks CI. A test that needs other
 * values overrides them itself.
 */
import { defaults } from '../src/params';
import type { Params } from '@shared/params/schema';

/** Values the tests were written against (defaults.json before the 2026-11-09 retune). */
export const BASELINE: Params = {
  'ez.flatSparseP': 660,
  'riv.step': 2,
  'riv.influence': 16,
  'riv.kill': 3,
  'riv.cone': '0',
  'riv.wander': 0,
  'riv.apical': 0,
  'hgt.chSlope': 0.02,
  'hgt.hs.lowland': 0.025,
  'hgt.hs.mountains': 0.3,
  'hgt.fp.w1': 500,
  'hgt.fp.w2': 400,
  'hgt.fp.w3': 150,
  'hgt.fp.w4': 40,
  'bio.cool.t2': 1.3,
  'bio.cool.t3': 2.6,
  'bio.cool.h4': 1000,
  'bio.cool.t4': 6.5,
  'bio.cool.h5': 2000,
  'bio.cool.t5': 13,
};

/** Schema defaults with BASELINE applied: what every test builds its parameters from. */
export function testParams(): Params {
  const d = defaults();
  for (const k of Object.keys(BASELINE)) if (!(k in d)) throw new Error(`tests/fixture.ts: BASELINE key ${k} is not a parameter`);
  return { ...d, ...BASELINE };
}
