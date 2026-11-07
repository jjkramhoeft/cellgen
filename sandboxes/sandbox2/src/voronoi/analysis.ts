/**
 * Map statistics from the calibration grid: the land fraction actually achieved,
 * islands and lakes (connected components), coastline length, a box-counting
 * estimate of the coastline's fractal dimension, cell counts and a histogram of the
 * field value.
 */
import { fingerprint } from '@shared/core/hash';
import type { Calibration, Field } from './field';

export interface MapStats {
  landFraction: number;
  islands: number;
  lakes: number;
  /** share of the land in the largest island */
  largestIsland: number;
  /** coastline length in world units (grid-crack estimate) */
  coastLength: number;
  /** box-counting dimension of the coastline (1 = smooth, → 2 = space-filling) */
  coastDim: number;
  /** box sizes and counts used for the dimension fit */
  boxes: { size: number; count: number }[];
  /** distinct cells per octave seen on the grid */
  cellsPerOctave: number[];
  hist: number[];
  histMin: number;
  histMax: number;
  fingerprint: string;
  /** land mask of the grid (1 = land) */
  mask: Uint8Array;
}

/** Label 4-connected components of cells where mask[i] === value. Returns per-component sizes and border flags. */
function components(mask: Uint8Array, gw: number, gh: number, value: number): { sizes: number[]; touchesBorder: boolean[] } {
  const label = new Int32Array(gw * gh).fill(-1);
  const sizes: number[] = [];
  const touchesBorder: boolean[] = [];
  const stack: number[] = [];
  for (let s = 0; s < gw * gh; s++) {
    if (mask[s] !== value || label[s] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    let border = false;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const c = stack.pop()!;
      size++;
      const x = c % gw;
      const y = (c - x) / gw;
      if (x === 0 || y === 0 || x === gw - 1 || y === gh - 1) border = true;
      if (x > 0 && mask[c - 1] === value && label[c - 1] < 0) (label[c - 1] = id), stack.push(c - 1);
      if (x < gw - 1 && mask[c + 1] === value && label[c + 1] < 0) (label[c + 1] = id), stack.push(c + 1);
      if (y > 0 && mask[c - gw] === value && label[c - gw] < 0) (label[c - gw] = id), stack.push(c - gw);
      if (y < gh - 1 && mask[c + gw] === value && label[c + gw] < 0) (label[c + gw] = id), stack.push(c + gw);
    }
    sizes.push(size);
    touchesBorder.push(border);
  }
  return { sizes, touchesBorder };
}

export function analyse(field: Field, cal: Calibration, bins = 48): MapStats {
  const { gw, gh, values, threshold } = cal;
  const n = gw * gh;
  const mask = new Uint8Array(n);
  let landCount = 0;
  for (let i = 0; i < n; i++) {
    if (values[i] > threshold) {
      mask[i] = 1;
      landCount++;
    }
  }
  const land = components(mask, gw, gh, 1);
  const water = components(mask, gw, gh, 0);
  // small specks of one grid cell are noise of the analysis grid, not islands
  const islands = land.sizes.filter((s) => s >= 2).length;
  const lakes = water.sizes.filter((s, i) => !water.touchesBorder[i] && s >= 2).length;
  const largest = land.sizes.length ? Math.max(...land.sizes) : 0;

  // coastline: land/water cracks between 4-neighbours, and the coast cells for box counting
  const coast = new Uint8Array(n);
  let cracks = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (x < gw - 1 && mask[i] !== mask[i + 1]) {
        cracks++;
        coast[i] = coast[i + 1] = 1;
      }
      if (y < gh - 1 && mask[i] !== mask[i + gw]) {
        cracks++;
        coast[i] = coast[i + gw] = 1;
      }
    }
  }
  const cellW = field.p.W / gw;
  // grid cracks overestimate a diagonal line's length by ~4/π on average
  const coastLength = (cracks * cellW * Math.PI) / 4;

  const boxes: { size: number; count: number }[] = [];
  for (let b = 1; b <= Math.min(gw, gh) / 4; b *= 2) {
    const bw = Math.ceil(gw / b);
    const bh = Math.ceil(gh / b);
    const hit = new Uint8Array(bw * bh);
    let count = 0;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (!coast[y * gw + x]) continue;
        const k = Math.floor(y / b) * bw + Math.floor(x / b);
        if (!hit[k]) {
          hit[k] = 1;
          count++;
        }
      }
    }
    boxes.push({ size: b, count });
  }
  // least-squares slope of log N against log(1/b)
  const pts = boxes.filter((b) => b.count > 0);
  let coastDim = NaN;
  if (pts.length >= 3) {
    const xs = pts.map((b) => -Math.log(b.size));
    const ys = pts.map((b) => Math.log(b.count));
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    coastDim = den > 0 ? num / den : NaN;
  }

  const cellsPerOctave: number[] = [];
  for (let k = 0; k < field.octaves; k++) {
    const seen = new Set<number>();
    for (let i = 0; i < n; i++) seen.add(cal.ids[k * n + i]);
    cellsPerOctave.push(seen.size);
  }

  const hist = new Array<number>(bins).fill(0);
  const span = Math.max(1e-9, cal.vmax - cal.vmin);
  for (let i = 0; i < n; i++) hist[Math.min(bins - 1, Math.floor(((values[i] - cal.vmin) / span) * bins))]++;

  return {
    landFraction: landCount / n,
    islands,
    lakes,
    largestIsland: landCount ? largest / landCount : 0,
    coastLength,
    coastDim,
    boxes,
    cellsPerOctave,
    hist,
    histMin: cal.vmin,
    histMax: cal.vmax,
    fingerprint: fingerprint([values, [threshold]]),
    mask,
  };
}
