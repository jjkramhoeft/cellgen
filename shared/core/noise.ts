/**
 * Seeded 2D simplex noise with a stateless lattice hash, plus fBm and ridged fBm.
 *
 * Following the research recommendation (gaps §6.1) this is an in-house simplex that
 * picks gradients with a pcg-style hash of the lattice coordinates instead of a
 * 256-entry permutation table: no 256-unit repetition, and the noise is tied to the
 * same hash(seed, x, y) used everywhere else. Arithmetic only — deterministic.
 */
import { pcg3 } from './hash';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

// 12 unit gradients at 30° steps (literal constants, no runtime trig).
const GX = new Float64Array([
  1, 0.8660254037844387, 0.5, 0, -0.5, -0.8660254037844387, -1, -0.8660254037844387, -0.5, 0, 0.5,
  0.8660254037844387,
]);
const GY = new Float64Array([
  0, 0.5, 0.8660254037844387, 1, 0.8660254037844387, 0.5, 0, -0.5, -0.8660254037844387, -1,
  -0.8660254037844387, -0.5,
]);

/** Output scale so that the result spans roughly [-1, 1]. */
const SCALE = 99.204;

/** Raw 2D simplex noise in [-1, 1] for a given 32-bit seed. */
export function simplex2(seed: number, x: number, y: number): number {
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  let i1: number, j1: number;
  if (x0 > y0) {
    i1 = 1;
    j1 = 0;
  } else {
    i1 = 0;
    j1 = 1;
  }
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  let n = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    const g = pcg3(i, j, seed) % 12;
    t0 *= t0;
    n += t0 * t0 * (GX[g] * x0 + GY[g] * y0);
  }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    const g = pcg3(i + i1, j + j1, seed) % 12;
    t1 *= t1;
    n += t1 * t1 * (GX[g] * x1 + GY[g] * y1);
  }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    const g = pcg3(i + 1, j + 1, seed) % 12;
    t2 *= t2;
    n += t2 * t2 * (GX[g] * x2 + GY[g] * y2);
  }
  return SCALE * n;
}

export interface FbmParams {
  octaves: number;
  lacunarity: number;
  gain: number;
}

// Octave rotation by the exact Pythagorean angle (cos, sin) = (0.8, 0.6) hides lattice alignment.
const RC = 0.8;
const RS = 0.6;

/** Fractal Brownian motion, normalised to roughly [-1, 1]. */
export function fbm(seed: number, x: number, y: number, p: FbmParams): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let px = x;
  let py = y;
  const oct = Math.max(1, Math.floor(p.octaves));
  for (let o = 0; o < oct; o++) {
    sum += amp * simplex2((seed + Math.imul(o, 0x3c6ef372)) | 0, px, py);
    norm += amp;
    amp *= p.gain;
    const nx = (RC * px - RS * py) * p.lacunarity + 17.3;
    const ny = (RS * px + RC * py) * p.lacunarity - 9.1;
    px = nx;
    py = ny;
  }
  return sum / norm;
}

/** Ridged multifractal (Musgrave-style weighting), mapped to [-1, 1]. */
export function ridged(seed: number, x: number, y: number, p: FbmParams): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let weight = 1;
  let px = x;
  let py = y;
  const oct = Math.max(1, Math.floor(p.octaves));
  for (let o = 0; o < oct; o++) {
    let r = 1 - Math.abs(simplex2((seed + Math.imul(o, 0x3c6ef372)) | 0, px, py));
    r *= r;
    r *= weight;
    weight = r * 2 > 1 ? 1 : r * 2;
    sum += amp * r;
    norm += amp;
    amp *= p.gain;
    const nx = (RC * px - RS * py) * p.lacunarity + 17.3;
    const ny = (RS * px + RC * py) * p.lacunarity - 9.1;
    px = nx;
    py = ny;
  }
  return (sum / norm) * 2 - 1;
}
