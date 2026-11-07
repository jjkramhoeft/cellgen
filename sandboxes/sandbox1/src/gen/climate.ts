/**
 * Temperature and moisture.
 *  - temperature: latitude + lapse rate + noise
 *  - moisture: independent noise | rank-normalised distance to water (mapgen2) |
 *    wind sweep with orographic rain and rain shadows (mapgen4)
 */
import { STAGE } from '@shared/core/hash';
import { dcos, dsin, DEG } from '@shared/core/dmath';
import { fbm } from '@shared/core/noise';
import type { CellGraph } from '../graph/types';
import { num, str, type Params } from '../params/schema';
import { WATER_LAND } from './hydrology';
import { bfsHops, smoothField } from './util';

const FP = { octaves: 4, lacunarity: 2, gain: 0.5 };

export function temperature(g: CellGraph, p: Params, seed: number, elev: Float64Array): Float64Array {
  const n = g.n;
  const t = new Float64Array(n);
  const mode = str(p, 'climate.latitude');
  const ls = num(p, 'climate.latStrength');
  const lapse = num(p, 'climate.lapse');
  const tn = num(p, 'climate.tempNoise');
  const f = 3 / g.W;
  const s = (seed ^ Math.imul(STAGE.temperature, 0x9e3779b9)) | 0;
  for (let i = 0; i < n; i++) {
    const v = g.y[i] / g.H;
    const lat = mode === 'north' ? v : mode === 'equator' ? 1 - Math.abs(2 * v - 1) : 0.75;
    let tt = 1 - ls * (1 - lat) - lapse * Math.max(0, elev[i]);
    if (tn > 0) tt += tn * fbm(s, g.x[i] * f, g.y[i] * f, FP);
    t[i] = Math.min(1, Math.max(0, tt));
  }
  return t;
}

export interface MoistureResult {
  moisture: Float64Array;
  /** wind direction (unit) when the wind model ran */
  wind?: [number, number];
}

export function moisture(g: CellGraph, p: Params, seed: number, elev: Float64Array, water: Uint8Array): MoistureResult {
  const n = g.n;
  const m = new Float64Array(n);
  const model = str(p, 'climate.moisture');
  if (model === 'noise') {
    const f = num(p, 'climate.moistFreq') / g.W;
    const s = (seed ^ Math.imul(STAGE.moisture, 0x9e3779b9)) | 0;
    for (let i = 0; i < n; i++) m[i] = water[i] ? 1 : Math.min(1, Math.max(0, fbm(s, g.x[i] * f, g.y[i] * f, FP) * 0.75 + 0.5));
    return { moisture: m };
  }
  if (model === 'water') {
    const src = new Uint8Array(n);
    for (let i = 0; i < n; i++) src[i] = water[i] !== WATER_LAND ? 1 : 0;
    const d = bfsHops(g, src);
    const land: number[] = [];
    for (let i = 0; i < n; i++) {
      if (water[i]) m[i] = 1;
      else land.push(i);
    }
    // rank-normalise so moisture is uniformly distributed over land (Red Blob redistribution)
    land.sort((a, b) => (d[a] < 0 ? 1e9 : d[a]) - (d[b] < 0 ? 1e9 : d[b]) || a - b);
    for (let k = 0; k < land.length; k++) m[land[k]] = 1 - k / Math.max(1, land.length - 1);
    return { moisture: m };
  }
  // wind sweep
  const a = num(p, 'climate.windAngle') * DEG;
  const wx = dcos(a);
  const wy = dsin(a);
  const key = new Float64Array(n);
  for (let i = 0; i < n; i++) key[i] = wx * g.x[i] + wy * g.y[i];
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((x, y) => key[x] - key[y] || x - y);
  const evap = num(p, 'climate.evaporation');
  const rainRate = num(p, 'climate.rain');
  const oro = num(p, 'climate.orographic');
  const hum = new Float64Array(n);
  const rain = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const i = order[k];
    let h = 0;
    let c = 0;
    for (let q = g.nbrOff[i]; q < g.nbrOff[i + 1]; q++) {
      const j = g.nbr[q];
      if (key[j] < key[i]) {
        // weight upwind neighbours by how directly they lie upwind
        const dx = g.x[i] - g.x[j];
        const dy = g.y[i] - g.y[j];
        const L = Math.sqrt(dx * dx + dy * dy) || 1;
        const w = Math.max(0.05, (dx * wx + dy * wy) / L);
        h += hum[j] * w;
        c += w;
      }
    }
    h = c > 0 ? h / c : water[i] ? 1 : 0.4;
    if (water[i]) {
      h = h + evap * (1 - h);
      rain[i] = 0;
    } else {
      let r = rainRate * h;
      const cap = Math.max(0, 1 - elev[i]);
      if (h - r > cap) r += oro * (h - r - cap);
      rain[i] = r;
      h = Math.max(0, h - r);
    }
    hum[i] = h;
  }
  // normalise rain over land by the 95th percentile
  const landRain: number[] = [];
  for (let i = 0; i < n; i++) if (!water[i]) landRain.push(rain[i]);
  landRain.sort((x, y) => x - y);
  const ref = landRain.length ? landRain[Math.floor(0.95 * (landRain.length - 1))] || 1 : 1;
  for (let i = 0; i < n; i++) m[i] = water[i] ? 1 : Math.min(1, rain[i] / ref);
  const landMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) landMask[i] = water[i] ? 0 : 1;
  smoothField(g, m, 1, landMask);
  return { moisture: m, wind: [wx, wy] };
}
