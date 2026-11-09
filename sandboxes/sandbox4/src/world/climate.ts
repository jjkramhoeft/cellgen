/**
 * Initial climate: a temperature map (°C) and a precipitation map (mm per year), each
 * an fBm of classic Perlin noise with its own parameters. Precipitation is mapped on a
 * log scale (like real rainfall: most land is dry or moderate, few places very wet). Both are pure functions of the seed,
 * the parameters and the point (metres); nothing depends on the map yet, so they
 * are the starting point for biomes, not the result of the terrain.
 *
 * A prosperity map (a unitless index, 1 to 100 by default) is built the same way. It does
 * not feed the biomes or rivers; it is there for later use (settlements, roads).
 */
import { perlinFbm, type FbmParams } from '@shared/core/noise';

export interface NoiseFieldParams extends FbmParams {
  /** wavelength of the first octave, metres */
  scale: number;
  /** value at the strongest lows and highs (the field is stretched to [min, max]) */
  min: number;
  max: number;
  /** stretch the noise over [log min, log max] instead (min must be > 0): the middle value is √(min·max) */
  log: boolean;
}

/** Smallest value of a log-scale field (a log scale cannot reach 0). */
export const LOG_FLOOR = 1;

export interface ClimateParams {
  seed: number;
  /** °C */
  temperature: NoiseFieldParams;
  /** precipitation, mm per year */
  precipitation: NoiseFieldParams;
  /** prosperity index (unitless), linear */
  prosperity: NoiseFieldParams;
}

/** Seed salts, so the two fields are independent of each other (and of every other noise). */
const TEMP_SALT = 0x7e3a11c5;
const PRECIP_SALT = 0x2b9d40f3;
const PROSPERITY_SALT = 0x5c1f86a9;

/**
 * Perlin fBm with its spread made independent of the octave count and gain (divided by
 * √Σa² instead of Σa), measured: this is about the 99.7th percentile of
 * |noise| over a large area. Values beyond it are clamped to min / max, so the extremes
 * are reached only at the strongest peaks and troughs.
 */
export const NOISE_EXTREME = 0.8;

/** The value at fraction t ∈ [0, 1] of a field's range (linear or log). */
export function fieldAt(p: NoiseFieldParams, t: number): number {
  if (!p.log) return p.min + t * (p.max - p.min);
  const a = Math.log(Math.max(LOG_FLOOR, p.min));
  const b = Math.log(Math.max(LOG_FLOOR, p.max));
  // exp(log(x)) can overshoot x by an ulp: clamp, so the ends are exact
  const lo = Math.max(LOG_FLOOR, p.min);
  const hi = Math.max(LOG_FLOOR, p.max);
  return Math.min(hi, Math.max(lo, Math.exp(a + t * (b - a))));
}

/** One climate field: noise → [min, max]. */
export function fieldValue(seed: number, p: NoiseFieldParams, x: number, y: number): number {
  const f = 1 / p.scale;
  let n = perlinFbm(seed, x * f, y * f, p) * spreadFix(p);
  n /= NOISE_EXTREME;
  if (n < -1) n = -1;
  else if (n > 1) n = 1;
  return fieldAt(p, (n + 1) / 2);
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
  private readonly pSeed: number;
  private readonly wSeed: number;

  constructor(readonly p: ClimateParams) {
    this.tSeed = (p.seed ^ TEMP_SALT) | 0;
    this.pSeed = (p.seed ^ PRECIP_SALT) | 0;
    this.wSeed = (p.seed ^ PROSPERITY_SALT) | 0;
  }

  /** Initial temperature at a point, °C. */
  temperatureAt(x: number, y: number): number {
    return fieldValue(this.tSeed, this.p.temperature, x, y);
  }

  /** Initial precipitation at a point, mm per year. */
  precipitationAt(x: number, y: number): number {
    return fieldValue(this.pSeed, this.p.precipitation, x, y);
  }

  /** Prosperity index at a point (unitless, [min, max] of its parameters). */
  prosperityAt(x: number, y: number): number {
    return fieldValue(this.wSeed, this.p.prosperity, x, y);
  }
}
