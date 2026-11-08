/** Colour helpers: pixel packing, hex parsing, hashed and HSL colours (display only — may use Math freely). */

export type RGB = [number, number, number];

/** Pack r, g, b (clamped to 0–255, fractions truncated) into an opaque ABGR pixel for an ImageData Uint32 view. */
export function packColor(r: number, g: number, b: number): number {
  return (0xff000000 | (Math.max(0, Math.min(255, b)) << 16) | (Math.max(0, Math.min(255, g)) << 8) | Math.max(0, Math.min(255, r))) >>> 0;
}

export function hex(h: string): RGB {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Stable pseudo-random colour for an integer id. */
export function hashColor(id: number): RGB {
  let h = Math.imul(id ^ 0x5bd1e995, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  const hue = ((h >>> 0) % 360) / 360;
  const sat = 0.45 + ((h >>> 9) % 30) / 100;
  const lig = 0.55 + ((h >>> 17) % 20) / 100;
  return hsl(hue, sat, lig);
}

export function hsl(h: number, s: number, l: number): RGB {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

export function cssRgb(c: RGB, a = 1): string {
  return a >= 1
    ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
    : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}
