/**
 * Implicit "distance-function" cells: every location belongs to the site with the
 * lowest score under a chosen metric (L2, L1, L∞, Lp), optional per-site weights
 * (additively / multiplicatively weighted Voronoi, power diagrams) and optional
 * domain warping of the query point.
 *
 * There are no polygons. Cell ownership is a pure function of (x, y), so it is
 * rendered per pixel at any zoom. Adjacency, area and centroids come from an
 * analysis raster: two cells are neighbours when their pixels touch.
 */
import { SiteIndex, type MetricKind, type MetricSpec, type QueryResult, type WeightKind } from '@shared/core/spatial';
import { rand01, STAGE } from '@shared/core/hash';
import { dpow } from '@shared/core/dmath';
import { fbm, warpVec } from '@shared/core/noise';
import type { CellGraph, ImplicitSpec } from './types';

export interface ImplicitParams {
  metric: MetricKind;
  p: number;
  weightKind: WeightKind;
  weightAmt: number;
  weightSource: 'random' | 'noise';
  warpAmp: number;
  warpFreq: number;
  res: number;
}

const WARP_FBM = { octaves: 3, lacunarity: 2, gain: 0.5 };

export type OwnerFn = (x: number, y: number, out?: QueryResult) => number;

/** Build the per-location ownership function. `pow` lets display code use Math.pow for speed. */
export function makeOwner(
  spec: ImplicitSpec,
  sites: SiteIndex,
  spacing: number,
  pow: (x: number, y: number) => number,
  needSecond = false,
): OwnerFn {
  const metric: MetricSpec = { ...spec.metric, pow };
  const q: QueryResult = { i1: -1, i2: -1, d1: 0, d2: 0, s1: 0, s2: 0 };
  const v = new Float64Array(2);
  const amp = spec.warpAmp * spacing;
  const f = spec.warpFreq / spacing;
  return (x, y, out) => {
    let wx = x;
    let wy = y;
    if (amp > 0) {
      warpVec(spec.warpSeed, x * f, y * f, WARP_FBM, v);
      wx += amp * v[0];
      wy += amp * v[1];
    }
    const r = out ?? q;
    sites.query(wx, wy, metric, spec.weightKind, spec.weights, spec.wMax, r, needSecond || !!out);
    return r.i1;
  };
}

export function buildImplicit(
  xs: Float64Array,
  ys: Float64Array,
  W: number,
  H: number,
  ip: ImplicitParams,
  seed: number,
): CellGraph {
  const n = xs.length;
  const spacing = Math.sqrt((W * H) / Math.max(1, n));
  const sites = new SiteIndex(xs, ys, W, H, spacing);
  let weights: Float64Array | null = null;
  let wMax = 1;
  if (ip.weightKind !== 'none') {
    weights = new Float64Array(n);
    const amt = Math.max(0, ip.weightAmt);
    for (let i = 0; i < n; i++) {
      const u =
        ip.weightSource === 'noise'
          ? Math.min(1, Math.max(0, fbm(seed ^ 0x51ed27, (xs[i] * 3) / W, (ys[i] * 3) / W, WARP_FBM) * 0.7 + 0.5))
          : rand01(seed, STAGE.weights, i);
      switch (ip.weightKind) {
        case 'additive':
          weights[i] = amt * spacing * u;
          break;
        case 'multiplicative':
          weights[i] = 1 + 2 * amt * u;
          break;
        case 'power':
          weights[i] = 1.2 * amt * spacing * u;
          break;
      }
    }
    wMax = 0;
    for (let i = 0; i < n; i++) wMax = Math.max(wMax, weights[i]);
    if (ip.weightKind === 'multiplicative') wMax = Math.max(1, wMax);
  }
  const spec: ImplicitSpec = {
    metric: { kind: ip.metric, p: ip.p, pow: dpow },
    weightKind: ip.weightKind,
    weights,
    wMax,
    warpAmp: ip.warpAmp,
    warpFreq: ip.warpFreq,
    warpSeed: (seed ^ Math.imul(STAGE.warp, 0x9e3779b9)) | 0,
  };
  const owner = makeOwner(spec, sites, spacing, dpow);

  // analysis raster
  const cols = Math.max(32, Math.floor(ip.res));
  const rows = Math.max(16, Math.round((cols * H) / W));
  const pw = W / cols;
  const ph = H / rows;
  const ids = new Int32Array(cols * rows);
  const count = new Float64Array(n);
  const sumx = new Float64Array(n);
  const sumy = new Float64Array(n);
  const edges = new Float64Array(n);
  const border = new Uint8Array(n);
  for (let r = 0; r < rows; r++) {
    const y = (r + 0.5) * ph;
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * pw;
      const id = owner(x, y);
      ids[r * cols + c] = id;
      count[id]++;
      sumx[id] += x;
      sumy[id] += y;
      if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) border[id] = 1;
    }
  }
  const pairs = new Set<number>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = ids[r * cols + c];
      if (c + 1 < cols) {
        const b = ids[r * cols + c + 1];
        if (a !== b) {
          pairs.add(a < b ? a * n + b : b * n + a);
          edges[a] += ph;
          edges[b] += ph;
        }
      }
      if (r + 1 < rows) {
        const b = ids[(r + 1) * cols + c];
        if (a !== b) {
          pairs.add(a < b ? a * n + b : b * n + a);
          edges[a] += pw;
          edges[b] += pw;
        }
      }
      if (c === 0 || c === cols - 1) edges[ids[r * cols + c]] += ph;
      if (r === 0 || r === rows - 1) edges[ids[r * cols + c]] += pw;
    }
  }
  const deg = new Uint32Array(n);
  const plist = Array.from(pairs).sort((a, b) => a - b);
  for (const k of plist) {
    deg[Math.floor(k / n)]++;
    deg[k % n]++;
  }
  const nbrOff = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) nbrOff[i + 1] = nbrOff[i] + deg[i];
  const nbr = new Int32Array(nbrOff[n]);
  const fillp = nbrOff.slice(0, n);
  for (const k of plist) {
    const a = Math.floor(k / n);
    const b = k % n;
    nbr[fillp[a]++] = b;
    nbr[fillp[b]++] = a;
  }
  for (let i = 0; i < n; i++) nbr.subarray(nbrOff[i], nbrOff[i + 1]).sort();

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const area = new Float64Array(n);
  const perimeter = new Float64Array(n);
  let empty = 0;
  for (let i = 0; i < n; i++) {
    if (count[i] > 0) {
      x[i] = sumx[i] / count[i];
      y[i] = sumy[i] / count[i];
    } else {
      x[i] = xs[i];
      y[i] = ys[i];
      empty++;
    }
    area[i] = count[i] * pw * ph;
    // staircase boundary length overestimates a random-orientation curve by 4/π
    perimeter[i] = (edges[i] * Math.PI) / 4;
  }
  const displayOwner = makeOwner(spec, sites, spacing, Math.pow);
  return {
    kind: 'implicit',
    n,
    W,
    H,
    x,
    y,
    sx: xs,
    sy: ys,
    area,
    perimeter,
    nbrOff,
    nbr,
    border,
    spacing,
    poly: null,
    sites,
    cellAt: (px, py) => displayOwner(px, py),
    implicit: spec,
    raster: { cols, rows, ids },
    info: {
      metric: ip.metric === 'Lp' ? `Lp (p=${ip.p})` : ip.metric,
      weights: ip.weightKind,
      'analysis raster': `${cols} × ${rows}`,
      'empty cells': empty,
    },
  };
}
