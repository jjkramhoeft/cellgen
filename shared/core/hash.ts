/**
 * Deterministic integer hashing and seeded PRNGs.
 *
 * Everything here uses only 32-bit integer ops (Math.imul, xor, shifts), which
 * ECMAScript specifies exactly, so results are bit-identical in every engine.
 * See docs/research/readme-topics-gaps.md §4.
 */

/** pcg3d (Jarzynski & Olano, JCGT 2020) — returns the first output lane as uint32. */
export function pcg3(a: number, b: number, c: number): number {
  let x = (Math.imul(a | 0, 1664525) + 1013904223) | 0;
  let y = (Math.imul(b | 0, 1664525) + 1013904223) | 0;
  let z = (Math.imul(c | 0, 1664525) + 1013904223) | 0;
  x = (x + Math.imul(y, z)) | 0;
  y = (y + Math.imul(z, x)) | 0;
  z = (z + Math.imul(x, y)) | 0;
  x ^= x >>> 16;
  y ^= y >>> 16;
  z ^= z >>> 16;
  x = (x + Math.imul(y, z)) | 0;
  y = (y + Math.imul(z, x)) | 0;
  z = (z + Math.imul(x, y)) | 0;
  return x >>> 0;
}

/** MurmurHash3 fmix32 finalizer. */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash of (seed, stage, x, y) → uint32. The workhorse for per-cell randomness. */
export function hash4(seed: number, stage: number, x: number, y: number): number {
  return fmix32(pcg3(x, y, seed ^ Math.imul(stage | 0, 0x9e3779b9)));
}

/** Hash of (seed, stage, i) → uint32. */
export function hash3(seed: number, stage: number, i: number): number {
  return fmix32(pcg3(i, stage, seed));
}

/** uint32 → [0, 1). */
export function toUnit(h: number): number {
  return (h >>> 0) / 4294967296;
}

/** String → uint32 seed (xmur3-style, as recommended by bryc). */
export function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Seed text → uint32. Pure digits are used as a number, anything else is hashed. */
export function seedFromText(text: string): number {
  const t = text.trim();
  if (/^\d{1,9}$/.test(t)) return Number(t) >>> 0;
  return hashString(t);
}

/** SplitMix32 — expands a 32-bit seed into PRNG state. */
export function splitmix32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export interface Rng {
  /** uniform [0,1) */
  (): number;
  /** uniform integer [0, n) */
  int(n: number): number;
  /** uniform [a, b) */
  range(a: number, b: number): number;
}

/** sfc32 (PractRand), state filled from SplitMix32 — the research's recommended sequential PRNG. */
export function sfc32(seed: number): Rng {
  const sm = splitmix32(seed);
  let a = sm() | 0;
  let b = sm() | 0;
  let c = sm() | 0;
  let d = sm() | 0;
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  const rng = next as Rng;
  rng.int = (n: number) => Math.floor(next() * n);
  rng.range = (lo: number, hi: number) => lo + (hi - lo) * next();
  return rng;
}

/** Stage ids keep per-stage random streams independent. */
export const STAGE = {
  points: 1,
  jitter: 2,
  density: 3,
  weights: 4,
  warp: 5,
  elevation: 10,
  mask: 11,
  blobs: 12,
  plates: 13,
  moisture: 20,
  temperature: 21,
  sca: 30,
  paths: 40,
  ca: 50,
  color: 70,
} as const;

/** FNV-1a over the float64 bit patterns of the given arrays → 8-hex-digit fingerprint. */
export function fingerprint(arrays: ArrayLike<number>[]): string {
  let h = 0x811c9dc5;
  const f = new Float64Array(1);
  const u = new Uint32Array(f.buffer);
  for (const arr of arrays) {
    for (let i = 0; i < arr.length; i++) {
      f[0] = arr[i];
      h = Math.imul(h ^ u[0], 16777619);
      h = Math.imul(h ^ u[1], 16777619);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
