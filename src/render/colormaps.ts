/** Colour maps and palettes (display only — may use Math freely). */
import type { ColormapId } from '../gen/pipeline';

export type RGB = [number, number, number];

export function hex(h: string): RGB {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

type Stops = [number, string][];

function ramp(stops: Stops): (t: number) => RGB {
  const s = stops.map(([t, c]) => [t, ...hex(c)] as [number, number, number, number]);
  return (t: number) => {
    if (!(t >= 0)) t = 0;
    if (t > 1) t = 1;
    let k = 1;
    while (k < s.length - 1 && s[k][0] < t) k++;
    const a = s[k - 1];
    const b = s[k];
    const u = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
    return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
  };
}

// Viridis / magma control points (matplotlib, sampled at 1/8 steps).
const viridis = ramp([
  [0, '#440154'],
  [0.125, '#472d7b'],
  [0.25, '#3b528b'],
  [0.375, '#2c728e'],
  [0.5, '#21918c'],
  [0.625, '#28ae80'],
  [0.75, '#5ec962'],
  [0.875, '#addc30'],
  [1, '#fde725'],
]);
const magma = ramp([
  [0, '#000004'],
  [0.125, '#1c1044'],
  [0.25, '#4f127b'],
  [0.375, '#812581'],
  [0.5, '#b5367a'],
  [0.625, '#e55064'],
  [0.75, '#fb8761'],
  [0.875, '#fec287'],
  [1, '#fcfdbf'],
]);
const moisture = ramp([
  [0, '#a8783e'],
  [0.25, '#d6c27a'],
  [0.5, '#8fbf6a'],
  [0.75, '#3c8f73'],
  [1, '#1f4f8c'],
]);
const temperature = ramp([
  [0, '#2c4f9e'],
  [0.3, '#7fb3d5'],
  [0.5, '#f2efe4'],
  [0.7, '#f3a65a'],
  [1, '#b2182b'],
]);
const gray = ramp([
  [0, '#111111'],
  [1, '#f2f2f2'],
]);
const diverging = ramp([
  [0, '#1d3f73'],
  [0.45, '#8fb4d9'],
  [0.5, '#f4f1e8'],
  [0.55, '#c9d98f'],
  [1, '#6b4a2b'],
]);
const flux = ramp([
  [0, '#0f1620'],
  [0.35, '#18456b'],
  [0.7, '#2f8fd0'],
  [1, '#d8f3ff'],
]);
const waterRamp = ramp([
  [0, '#1b2a4e'],
  [0.7, '#2f5487'],
  [1, '#4f7fb5'],
]);
const landRamp = ramp([
  [0, '#5d8c4f'],
  [0.25, '#8daa5c'],
  [0.5, '#c2b675'],
  [0.75, '#9c7b5a'],
  [0.9, '#d8d2c8'],
  [1, '#ffffff'],
]);

/** Terrain colormap over t ∈ [0,1] representing elevation ∈ [−1,1] (sea level at t = 0.5). */
function terrain(t: number): RGB {
  const e = t * 2 - 1;
  return e < 0 ? waterRamp(1 + e) : landRamp(e);
}

export const COLORMAPS: Record<ColormapId, (t: number) => RGB> = {
  terrain,
  viridis,
  magma,
  moisture,
  temperature,
  gray,
  diverging,
  flux,
};

/** Soft categorical palette for graph colouring (neighbours differ). */
export const PALETTE: RGB[] = [
  '#8dd3c7',
  '#ffffb3',
  '#bebada',
  '#fb8072',
  '#80b1d3',
  '#fdb462',
  '#b3de69',
  '#fccde5',
  '#d9d9d9',
  '#bc80bd',
  '#ccebc5',
  '#ffed6f',
].map(hex);

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
