/**
 * Elevation stage: raw height from a method (fBm / ridged / domain-warped noise,
 * FMG-style template blobs, or tectonic plates), then an SDF island mask, smoothing,
 * sea level by area-weighted quantile, redistribution and terraces.
 *
 * Output convention: elevation in [−1, 1] with sea level at exactly 0.
 */
import { hash3, rand01, sfc32, STAGE, toUnit } from '@shared/core/hash';
import { dpow } from '@shared/core/dmath';
import { fbm, ridged, warpedFbm, type FbmParams } from '@shared/core/noise';
import { onion, sdCircle, sdRoundBox, smin } from '@shared/core/sdf';
import type { CellGraph } from '../graph/types';
import { num, str, type Params } from '../params/schema';
import { generatePlates, type PlateResult } from './plates';
import { areaQuantile, minMax, smoothField } from './util';

export interface ElevationResult {
  elevation: Float64Array;
  plates: PlateResult | null;
  /** normalisation used: e = ((raw − lo) / span)·2 − 1, then mask; sea level in that space */
  norm: { lo: number; span: number; sea: number };
}

export function noiseParams(p: Params): FbmParams {
  return { octaves: num(p, 'elev.octaves'), lacunarity: num(p, 'elev.lacunarity'), gain: num(p, 'elev.gain') };
}

/** Continuous elevation noise (pre-mask) at a world position — also used by the raster preview. */
export function makeNoiseFn(p: Params, seed: number, W: number): ((x: number, y: number) => number) | null {
  const method = str(p, 'elev.method');
  const f = num(p, 'elev.freq') / W;
  const fp = noiseParams(p);
  const s = (seed ^ Math.imul(STAGE.elevation, 0x9e3779b9)) | 0;
  if (method === 'fbm') return (x, y) => fbm(s, x * f, y * f, fp);
  if (method === 'ridged') return (x, y) => ridged(s, x * f, y * f, fp);
  if (method === 'warp') {
    const ws = num(p, 'elev.warp');
    return (x, y) => warpedFbm(s, x * f, y * f, fp, ws);
  }
  return null;
}

/** The island-mask signed distance at a world position (in half-height units). */
export function makeMaskFn(p: Params, seed: number, W: number, H: number): ((x: number, y: number) => number) | null {
  const mask = str(p, 'elev.mask');
  if (mask === 'none') return null;
  const size = num(p, 'elev.maskSize');
  const half = H / 2;
  const aspect = W / H;
  const nx = (x: number) => (x - W / 2) / half;
  const ny = (y: number) => (y - H / 2) / half;
  switch (mask) {
    case 'circle':
      return (x, y) => sdCircle(nx(x), ny(y), size);
    case 'box':
      return (x, y) => sdRoundBox(nx(x), ny(y), aspect * size * 0.85, size * 0.85, 0.25 * size);
    case 'atoll':
      return (x, y) => onion(sdCircle(nx(x), ny(y), size), 0.16 * size);
    case 'coast':
      return (x) => (nx(x) - (size - 0.75)) * 0.8;
    case 'blobs': {
      const k = num(p, 'elev.maskBlobs');
      const smooth = num(p, 'elev.maskSmooth');
      const cs: number[] = [];
      for (let i = 0; i < k; i++) {
        const cx = (rand01(seed, STAGE.mask, 3 * i) * 2 - 1) * aspect * 0.65 * size;
        const cy = (rand01(seed, STAGE.mask, 3 * i + 1) * 2 - 1) * 0.6 * size;
        const r = (0.18 + 0.3 * rand01(seed, STAGE.mask, 3 * i + 2)) * size;
        cs.push(cx, cy, r);
      }
      return (x, y) => {
        const px = nx(x);
        const py = ny(y);
        let d = Infinity;
        for (let i = 0; i < cs.length; i += 3) {
          const di = sdCircle(px - cs[i], py - cs[i + 1], cs[i + 2]);
          d = d === Infinity ? di : smin(d, di, smooth);
        }
        return d;
      };
    }
  }
  return null;
}

export function computeElevation(g: CellGraph, p: Params, seed: number): ElevationResult {
  const n = g.n;
  const method = str(p, 'elev.method');
  let raw: Float64Array = new Float64Array(n);
  let plates: PlateResult | null = null;
  const noiseFn = makeNoiseFn(p, seed, g.W);
  if (noiseFn) {
    for (let i = 0; i < n; i++) raw[i] = noiseFn(g.x[i], g.y[i]);
  } else if (method === 'blobs') {
    raw = templateBlobs(g, p, seed);
  } else if (method === 'plates') {
    plates = generatePlates(g, p, seed);
    raw = plates.height;
  }
  if (method === 'blobs' || method === 'plates') {
    const detail = num(p, 'elev.detail');
    if (detail > 0) {
      const f = 4 / g.W;
      const s = (seed ^ 0x1b873593) | 0;
      const fp = { octaves: 4, lacunarity: 2, gain: 0.5 };
      const [lo, hi] = minMax(raw);
      const range = hi - lo || 1;
      for (let i = 0; i < n; i++) raw[i] += detail * 0.5 * range * fbm(s, g.x[i] * f, g.y[i] * f, fp);
    }
  }
  // normalise to [−1, 1]
  const [lo, hi] = minMax(raw);
  const span = hi - lo || 1;
  const e = new Float64Array(n);
  for (let i = 0; i < n; i++) e[i] = ((raw[i] - lo) / span) * 2 - 1;

  const maskFn = makeMaskFn(p, seed, g.W, g.H);
  if (maskFn) {
    const a = num(p, 'elev.maskStrength');
    for (let i = 0; i < n; i++) e[i] -= a * maskFn(g.x[i], g.y[i]);
  }
  const passes = num(p, 'elev.smooth');
  if (passes > 0) smoothField(g, e, passes);

  // sea level by area-weighted quantile
  const land = num(p, 'elev.land');
  const sea = land >= 1 ? -Infinity : land <= 0 ? Infinity : areaQuantile(e, g.area, 1 - land);
  let emin = Infinity;
  let emax = -Infinity;
  for (let i = 0; i < n; i++) {
    emin = Math.min(emin, e[i]);
    emax = Math.max(emax, e[i]);
  }
  const exp = num(p, 'elev.exponent');
  const terr = num(p, 'elev.terraces');
  const out = new Float64Array(n);
  const landSpan = emax - (Number.isFinite(sea) ? sea : emin) || 1;
  const seaSpan = (Number.isFinite(sea) ? sea : emax) - emin || 1;
  for (let i = 0; i < n; i++) {
    if (e[i] >= sea) {
      let h = (e[i] - (Number.isFinite(sea) ? sea : emin)) / landSpan;
      h = dpow(Math.max(0, Math.min(1, h)), exp);
      if (terr > 0) h = Math.round(h * terr) / terr;
      out[i] = Math.max(1e-4, h);
    } else {
      out[i] = -Math.min(1, ((Number.isFinite(sea) ? sea : emax) - e[i]) / seaSpan);
    }
  }
  return { elevation: out, plates, norm: { lo, span, sea } };
}

/**
 * Azgaar FMG heightmap templates: BFS "blobs" where each neighbour gets
 * parent · decay · U(0.9, 1.1), plus pits (negative blobs) and ranges (ridges along a
 * greedy path). Decay per hop is derived from a radius in world units.
 */
function templateBlobs(g: CellGraph, p: Params, seed: number): Float64Array {
  const n = g.n;
  const h = new Float64Array(n);
  const rng = sfc32((seed ^ Math.imul(STAGE.blobs, 0x9e3779b9)) | 0);
  const radius = num(p, 'elev.blobRadius') * g.W;
  const decay = dpow(0.01, g.spacing / radius);
  const stamp = new Float64Array(n);
  const mark = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let stampId = 0;

  const blob = (sources: number[], height: number, dec: number, sign: number) => {
    stampId++;
    let head = 0;
    let tail = 0;
    for (const s of sources) {
      if (mark[s] === stampId) continue;
      mark[s] = stampId;
      stamp[s] = height;
      queue[tail++] = s;
    }
    while (head < tail) {
      const c = queue[head++];
      const v = stamp[c];
      for (let k = g.nbrOff[c]; k < g.nbrOff[c + 1]; k++) {
        const nb = g.nbr[k];
        if (mark[nb] === stampId) continue;
        const nv = v * dec * (0.9 + 0.2 * toUnit(hash3(seed, STAGE.blobs + stampId, nb)));
        if (nv < 0.01 * height) continue;
        mark[nb] = stampId;
        stamp[nb] = nv;
        queue[tail++] = nb;
      }
    }
    for (let k = 0; k < tail; k++) {
      const c = queue[k];
      h[c] += sign * stamp[c];
    }
  };
  const pick = (margin: number) => {
    const x = g.W * (margin + (1 - 2 * margin) * rng());
    const y = g.H * (margin + (1 - 2 * margin) * rng());
    return Math.max(0, g.cellAt(x, y));
  };
  const hills = num(p, 'elev.hills');
  for (let k = 0; k < hills; k++) blob([pick(0.15)], 0.5 + 0.5 * rng(), decay, 1);
  const ranges = num(p, 'elev.ranges');
  for (let k = 0; k < ranges; k++) {
    const a = pick(0.1);
    const b = pick(0.1);
    const path: number[] = [a];
    let cur = a;
    let guard = 0;
    while (cur !== b && guard++ < n) {
      let best = -1;
      let bestD = Infinity;
      for (let q = g.nbrOff[cur]; q < g.nbrOff[cur + 1]; q++) {
        const nb = g.nbr[q];
        const dx = g.x[nb] - g.x[b];
        const dy = g.y[nb] - g.y[b];
        const d = Math.sqrt(dx * dx + dy * dy) * (0.85 + 0.3 * rng());
        if (d < bestD) {
          bestD = d;
          best = nb;
        }
      }
      if (best < 0 || path.includes(best)) break;
      path.push(best);
      cur = best;
    }
    blob(path, 0.35 + 0.35 * rng(), dpow(decay, 2.2), 1);
  }
  const pits = num(p, 'elev.pits');
  for (let k = 0; k < pits; k++) blob([pick(0.1)], 0.2 + 0.3 * rng(), decay, -1);
  for (let i = 0; i < n; i++) h[i] = Math.min(1.2, h[i]);
  return h;
}

