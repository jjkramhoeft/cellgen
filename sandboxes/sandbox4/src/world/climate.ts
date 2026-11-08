/**
 * Initial climate: a temperature map (°C) and a humidity map (%), each an fBm of
 * classic Perlin noise with its own parameters. Both are pure functions of the seed,
 * the parameters and the point (metres); nothing depends on the map yet, so they
 * are the starting point for biomes, not the result of the terrain.
 */
import { perlinFbm, type FbmParams } from '@shared/core/noise';

export interface NoiseFieldParams extends FbmParams {
  /** wavelength of the first octave, metres */
  scale: number;
  /** value at the strongest lows and highs (the field is stretched to [min, max]) */
  min: number;
  max: number;
}

export interface ClimateParams {
  seed: number;
  /** °C */
  temperature: NoiseFieldParams;
  /** relative humidity, % */
  humidity: NoiseFieldParams;
}

/** Seed salts, so the two fields are independent of each other (and of every other noise). */
const TEMP_SALT = 0x7e3a11c5;
const HUMID_SALT = 0x2b9d40f3;

/**
 * Perlin fBm with its spread made independent of the octave count and gain (divided by
 * √Σa² instead of Σa), measured: this is about the 99.7th percentile of
 * |noise| over a large area. Values beyond it are clamped to min / max, so the extremes
 * are reached only at the strongest peaks and troughs.
 */
export const NOISE_EXTREME = 0.8;

/** One climate field: noise → [min, max]. */
export function fieldValue(seed: number, p: NoiseFieldParams, x: number, y: number): number {
  const f = 1 / p.scale;
  let n = perlinFbm(seed, x * f, y * f, p) * spreadFix(p);
  n /= NOISE_EXTREME;
  if (n < -1) n = -1;
  else if (n > 1) n = 1;
  return p.min + ((n + 1) / 2) * (p.max - p.min);
}

/** Σa / √Σa² for the octave weights 1, gain, gain², … */
function spreadFix(p: FbmParams): number {
  let sum = 0;
  let sq = 0;
  let a = 1;
  for (let o = 0; o < Math.max(1, Math.floor(p.octaves)); o++) {
    sum += a;
    sq += a * a;
    a *= p.gain;
  }
  return sum / Math.sqrt(sq);
}

export class Climate {
  private readonly tSeed: number;
  private readonly hSeed: number;

  constructor(readonly p: ClimateParams) {
    this.tSeed = (p.seed ^ TEMP_SALT) | 0;
    this.hSeed = (p.seed ^ HUMID_SALT) | 0;
  }

  /** Initial temperature at a point, °C. */
  temperatureAt(x: number, y: number): number {
    return fieldValue(this.tSeed, this.p.temperature, x, y);
  }

  /** Initial relative humidity at a point, %. */
  humidityAt(x: number, y: number): number {
    return fieldValue(this.hSeed, this.p.humidity, x, y);
  }
}
