// TEMPORARY: reproduce the browser tile with seed 'cellgen'. Delete after use.
import { it } from 'vitest';
import { seedFromText } from '@shared/core/hash';
import { defaults, toRiverParams, toTerrainParams, toWorldParams } from '../src/params';
import { Rivers } from '../src/world/rivers';
import { Terrain } from '../src/world/terrain';
import { World } from '../src/world/world';
import { packKey } from '../src/world/level';

it('seed cellgen tile', () => {
  const d = defaults();
  const w = new World(toWorldParams(d, seedFromText('cellgen')));
  const rv = new Rivers(w, toRiverParams(d));
  const t = new Terrain(w, rv, toTerrainParams(d));
  const regs = t.tileRegions(packKey(0, 0));
  const t0 = performance.now();
  for (const rk of regs) {
    const a = performance.now();
    t.bed(rk);
    console.log(`S bed ${rk} ${(performance.now() - a).toFixed(0)} ms`);
    if (performance.now() - t0 > 60000) { console.log('S giving up'); break; }
  }
  const a = performance.now();
  t.compute(packKey(0, 0));
  console.log(`S raster ${(performance.now() - a).toFixed(0)} ms, total ${(performance.now() - t0).toFixed(0)}`);
}, 300000);
