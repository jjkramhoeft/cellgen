/**
 * Whittaker-style biome lookup on (temperature, moisture), following the band
 * structure of Red Blob's elevation × moisture table but with an explicit
 * temperature field (so latitude and lapse rate both matter).
 */
import type { CellGraph } from '../graph/types';
import { WATER_LAKE, WATER_OCEAN } from './hydrology';

export interface Biome {
  id: number;
  name: string;
  color: string;
}

export const BIOMES: Biome[] = [
  { id: 0, name: 'Ocean', color: '#3b4f7a' },
  { id: 1, name: 'Lake', color: '#3f74a8' },
  { id: 2, name: 'Sea ice', color: '#c7dbe6' },
  { id: 3, name: 'Beach', color: '#cdb98f' },
  { id: 4, name: 'Snow', color: '#f4f6f6' },
  { id: 5, name: 'Tundra', color: '#bbbbaa' },
  { id: 6, name: 'Bare', color: '#8c8c84' },
  { id: 7, name: 'Scorched', color: '#5c5a55' },
  { id: 8, name: 'Taiga', color: '#99aa77' },
  { id: 9, name: 'Shrubland', color: '#889977' },
  { id: 10, name: 'Temperate desert', color: '#c9d29b' },
  { id: 11, name: 'Temperate rain forest', color: '#448855' },
  { id: 12, name: 'Temperate deciduous forest', color: '#679459' },
  { id: 13, name: 'Grassland', color: '#88aa55' },
  { id: 14, name: 'Subtropical desert', color: '#d2b98b' },
  { id: 15, name: 'Tropical rain forest', color: '#337755' },
  { id: 16, name: 'Tropical seasonal forest', color: '#559944' },
  { id: 17, name: 'Marsh', color: '#4c7a6a' },
];

function classify(t: number, m: number): number {
  if (t < 0.18) {
    if (m < 0.1) return 7;
    if (m < 0.2) return 6;
    if (m < 0.5) return 5;
    return 4;
  }
  if (t < 0.4) {
    if (m < 0.33) return 10;
    if (m < 0.66) return 9;
    return 8;
  }
  if (t < 0.7) {
    if (m < 0.16) return 10;
    if (m < 0.5) return 13;
    if (m < 0.83) return 12;
    return 11;
  }
  if (m < 0.16) return 14;
  if (m < 0.33) return 13;
  if (m < 0.66) return 16;
  return 15;
}

export function assignBiomes(
  g: CellGraph,
  elev: Float64Array,
  water: Uint8Array,
  temp: Float64Array,
  moist: Float64Array,
): Int32Array {
  const n = g.n;
  const b = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (water[i] === WATER_OCEAN) {
      b[i] = temp[i] < 0.08 ? 2 : 0;
      continue;
    }
    if (water[i] === WATER_LAKE) {
      b[i] = temp[i] < 0.08 ? 2 : 1;
      continue;
    }
    let coastal = false;
    for (let k = g.nbrOff[i]; k < g.nbrOff[i + 1]; k++) if (water[g.nbr[k]] === WATER_OCEAN) coastal = true;
    if (coastal && elev[i] < 0.04 && temp[i] > 0.25) {
      b[i] = 3;
      continue;
    }
    if (moist[i] > 0.92 && elev[i] < 0.12 && temp[i] > 0.35) {
      b[i] = 17;
      continue;
    }
    b[i] = classify(temp[i], moist[i]);
  }
  return b;
}
