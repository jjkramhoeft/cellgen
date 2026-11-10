/**
 * Deterministic transcendental functions.
 *
 * ECMAScript leaves Math.sin/cos/exp/log/pow "implementation-approximated", so they
 * may differ between engines (research gaps §4.1). These versions use only + − × ÷,
 * Math.round/floor and bit manipulation — all exactly specified — so generation stays
 * bit-identical across browsers. Accuracy is ~1e-15 relative.
 */

const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;
const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;
const LN2 = 0.6931471805599453;

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
// Little-endian is universal on the web platform.
const HI = 1;
const LO = 0;

/** 2^k for integer k in [-1022, 1023], built from the bit pattern. */
function pow2i(k: number): number {
  if (k > 1023) return Infinity;
  if (k < -1022) return 0;
  u32[LO] = 0;
  u32[HI] = (k + 1023) << 20;
  return f64[0];
}

export function dexp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709.7) return Infinity;
  if (x < -708) return 0;
  const k = Math.round(x / LN2);
  const r = x - k * LN2_HI - k * LN2_LO; // |r| <= 0.347
  let s = 1;
  for (let n = 16; n >= 1; n--) s = 1 + (r * s) / n;
  return s * pow2i(k);
}

export function dlog(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let e = 0;
  if (x < 2.2250738585072014e-308) {
    x *= 18014398509481984; // 2^54, normalise subnormals
    e -= 54;
  }
  f64[0] = x;
  const hi = u32[HI];
  e += ((hi >>> 20) & 0x7ff) - 1023;
  u32[HI] = (hi & 0x000fffff) | 0x3ff00000; // mantissa in [1,2)
  let m = f64[0];
  if (m > 1.4142135623730951) {
    m *= 0.5;
    e += 1;
  }
  // log(m) = 2 atanh(s), s = (m-1)/(m+1), |s| <= 0.1716
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let t = 0;
  for (let n = 25; n >= 1; n -= 2) t = 1 / n + s2 * t;
  return 2 * s * t + e * LN2;
}

/** x^y. Small integer exponents use exact repeated multiplication. */
export function dpow(x: number, y: number): number {
  if (y === 0) return 1;
  if (y === 1) return x;
  if (y === 2) return x * x;
  if (y === 0.5) return Math.sqrt(x);
  if (Number.isInteger(y) && Math.abs(y) <= 64) {
    let r = 1;
    let b = x;
    let n = Math.abs(y);
    while (n > 0) {
      if (n & 1) r *= b;
      b *= b;
      n >>= 1;
    }
    return y < 0 ? 1 / r : r;
  }
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) return NaN;
  return dexp(y * dlog(x));
}

function sinPoly(x: number): number {
  const x2 = x * x;
  let t = 1;
  for (let n = 17; n >= 3; n -= 2) t = 1 - (x2 / (n * (n - 1))) * t;
  return x * t;
}

function cosPoly(x: number): number {
  const x2 = x * x;
  let t = 1;
  for (let n = 18; n >= 2; n -= 2) t = 1 - (x2 / (n * (n - 1))) * t;
  return t;
}

export function dsin(x: number): number {
  x = x - TWO_PI * Math.round(x / TWO_PI); // [-pi, pi]
  const q = Math.round(x / HALF_PI); // -2..2
  const r = x - q * HALF_PI; // [-pi/4, pi/4]
  switch (((q % 4) + 4) % 4) {
    case 0:
      return sinPoly(r);
    case 1:
      return cosPoly(r);
    case 2:
      return -sinPoly(r);
    default:
      return -cosPoly(r);
  }
}

export function dcos(x: number): number {
  x = x - TWO_PI * Math.round(x / TWO_PI);
  const q = Math.round(x / HALF_PI);
  const r = x - q * HALF_PI;
  switch (((q % 4) + 4) % 4) {
    case 0:
      return cosPoly(r);
    case 1:
      return -sinPoly(r);
    case 2:
      return -cosPoly(r);
    default:
      return sinPoly(r);
  }
}

/** x². Use instead of `x ** 2`: the exponentiation operator is implementation-approximated. */
export function sq(x: number): number {
  return x * x;
}

/** √(x² + y²). Use instead of Math.hypot, which is implementation-approximated. */
export function dhypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
