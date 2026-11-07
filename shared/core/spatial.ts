/**
 * Uniform-grid spatial index over a set of sites, with nearest / second-nearest
 * queries under arbitrary distance metrics and per-site weights.
 *
 * This is the engine behind implicit ("distance-function") cells and Worley F1/F2
 * fields. Ring search stops using a metric-agnostic lower bound: any site in a bucket
 * at Chebyshev ring r is at least (r−1)·cellSize away in L∞, and every Lp distance
 * (including p < 1) is ≥ the L∞ distance (research gaps §2.2).
 */

export type MetricKind = 'L2' | 'L1' | 'Linf' | 'Lp';
export type WeightKind = 'none' | 'additive' | 'multiplicative' | 'power';

export interface MetricSpec {
  kind: MetricKind;
  p: number;
  /** pow implementation: deterministic dpow for generation, Math.pow for display. */
  pow: (x: number, y: number) => number;
}

export function metricDistance(m: MetricSpec, dx: number, dy: number): number {
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  switch (m.kind) {
    case 'L2':
      return Math.sqrt(dx * dx + dy * dy);
    case 'L1':
      return ax + ay;
    case 'Linf':
      return ax > ay ? ax : ay;
    case 'Lp': {
      const p = m.p;
      if (p === 2) return Math.sqrt(dx * dx + dy * dy);
      if (p === 1) return ax + ay;
      const s = m.pow(ax, p) + m.pow(ay, p);
      return s === 0 ? 0 : m.pow(s, 1 / p);
    }
  }
}

export interface QueryResult {
  i1: number;
  i2: number;
  /** metric distances (unweighted) */
  d1: number;
  d2: number;
  /** weighted scores used for ownership */
  s1: number;
  s2: number;
}

export class SiteIndex {
  readonly cs: number;
  readonly gw: number;
  readonly gh: number;
  readonly start: Uint32Array;
  readonly items: Uint32Array;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly n: number;
  readonly W: number;
  readonly H: number;

  constructor(xs: Float64Array, ys: Float64Array, W: number, H: number, cellSize: number) {
    this.xs = xs;
    this.ys = ys;
    this.n = xs.length;
    this.W = W;
    this.H = H;
    this.cs = Math.max(cellSize, 1e-6);
    this.gw = Math.max(1, Math.ceil(W / this.cs));
    this.gh = Math.max(1, Math.ceil(H / this.cs));
    const nb = this.gw * this.gh;
    const counts = new Uint32Array(nb + 1);
    const bucketOf = new Uint32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const b = this.bucket(xs[i], ys[i]);
      bucketOf[i] = b;
      counts[b + 1]++;
    }
    for (let b = 0; b < nb; b++) counts[b + 1] += counts[b];
    this.start = counts;
    this.items = new Uint32Array(this.n);
    const fill = counts.slice(0, nb);
    for (let i = 0; i < this.n; i++) this.items[fill[bucketOf[i]]++] = i;
  }

  private bucket(x: number, y: number): number {
    let bx = Math.floor(x / this.cs);
    let by = Math.floor(y / this.cs);
    if (bx < 0) bx = 0;
    else if (bx >= this.gw) bx = this.gw - 1;
    if (by < 0) by = 0;
    else if (by >= this.gh) by = this.gh - 1;
    return by * this.gw + bx;
  }

  /** Visit every site in the bucket ring at Chebyshev radius r around (bx, by). */
  private ring(bx: number, by: number, r: number, fn: (i: number) => void): boolean {
    const { gw, gh, start, items } = this;
    let any = false;
    const y0 = by - r;
    const y1 = by + r;
    const x0 = bx - r;
    const x1 = bx + r;
    for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= gh) continue;
      const edgeRow = y === y0 || y === y1;
      const step = edgeRow ? 1 : x1 - x0;
      for (let x = x0; x <= x1; x += step) {
        if (x < 0 || x >= gw) {
          if (step === 0) break;
          continue;
        }
        any = true;
        const b = y * gw + x;
        for (let k = start[b]; k < start[b + 1]; k++) fn(items[k]);
        if (step === 0) break;
      }
    }
    return any || r <= Math.max(gw, gh);
  }

  /** Nearest site under Euclidean distance. Returns −1 if the index is empty. */
  nearest(x: number, y: number): number {
    if (this.n === 0) return -1;
    const bx = Math.min(this.gw - 1, Math.max(0, Math.floor(x / this.cs)));
    const by = Math.min(this.gh - 1, Math.max(0, Math.floor(y / this.cs)));
    let best = -1;
    let bestD = Infinity;
    const maxR = Math.max(this.gw, this.gh);
    for (let r = 0; r <= maxR; r++) {
      const lb = (r - 1) * this.cs;
      if (lb > 0 && lb * lb > bestD) break;
      this.ring(bx, by, r, (i) => {
        const dx = this.xs[i] - x;
        const dy = this.ys[i] - y;
        const d = dx * dx + dy * dy;
        if (d < bestD || (d === bestD && i < best)) {
          bestD = d;
          best = i;
        }
      });
    }
    return best;
  }

  /**
   * Nearest and second-nearest under a metric with optional per-site weights.
   * score = d (none) | d − w (additive) | d / w (multiplicative) | d² − w² (power).
   */
  query(
    x: number,
    y: number,
    metric: MetricSpec,
    weightKind: WeightKind,
    weights: Float64Array | null,
    wMax: number,
    out: QueryResult,
    needSecond = true,
  ): QueryResult {
    out.i1 = out.i2 = -1;
    out.s1 = out.s2 = Infinity;
    out.d1 = out.d2 = Infinity;
    if (this.n === 0) return out;
    const bx = Math.min(this.gw - 1, Math.max(0, Math.floor(x / this.cs)));
    const by = Math.min(this.gh - 1, Math.max(0, Math.floor(y / this.cs)));
    const maxR = Math.max(this.gw, this.gh);
    const xs = this.xs;
    const ys = this.ys;
    const visit = (i: number) => {
      const d = metricDistance(metric, xs[i] - x, ys[i] - y);
      let s: number;
      switch (weightKind) {
        case 'additive':
          s = d - weights![i];
          break;
        case 'multiplicative':
          s = d / weights![i];
          break;
        case 'power':
          s = d * d - weights![i] * weights![i];
          break;
        default:
          s = d;
      }
      if (s < out.s1 || (s === out.s1 && i < out.i1)) {
        out.s2 = out.s1;
        out.d2 = out.d1;
        out.i2 = out.i1;
        out.s1 = s;
        out.d1 = d;
        out.i1 = i;
      } else if (s < out.s2) {
        out.s2 = s;
        out.d2 = d;
        out.i2 = i;
      }
    };
    for (let r = 0; r <= maxR; r++) {
      const lb = Math.max(0, (r - 1) * this.cs);
      if (r > 1) {
        let slb: number;
        switch (weightKind) {
          case 'additive':
            slb = lb - wMax;
            break;
          case 'multiplicative':
            slb = lb / wMax;
            break;
          case 'power':
            slb = lb * lb - wMax * wMax;
            break;
          default:
            slb = lb;
        }
        if (slb > (needSecond ? out.s2 : out.s1)) break;
      }
      this.ring(bx, by, r, visit);
    }
    return out;
  }

  /**
   * Exact Euclidean distance from (x, y) to the border of its (unweighted L2) Voronoi
   * cell — Quilez's "Voronoi edges" construction: min over neighbours b of
   * (|b−x|² − |a−x|²) / (2|b−a|). Gives constant-width cell borders, unlike F2 − F1.
   */
  borderDistanceL2(x: number, y: number): number {
    const a = this.nearest(x, y);
    if (a < 0) return Infinity;
    const ax = this.xs[a] - x;
    const ay = this.ys[a] - y;
    const da2 = ax * ax + ay * ay;
    const da = Math.sqrt(da2);
    let best = Infinity;
    const bx = Math.min(this.gw - 1, Math.max(0, Math.floor(x / this.cs)));
    const by = Math.min(this.gh - 1, Math.max(0, Math.floor(y / this.cs)));
    const maxR = Math.max(this.gw, this.gh);
    for (let r = 0; r <= maxR; r++) {
      const lb = Math.max(0, (r - 1) * this.cs);
      // bisector distance >= (|b−x| − |a−x|) / 2
      if (r > 1 && (lb - da) / 2 > best) break;
      this.ring(bx, by, r, (i) => {
        if (i === a) return;
        const qx = this.xs[i] - x;
        const qy = this.ys[i] - y;
        const ex = this.xs[i] - this.xs[a];
        const ey = this.ys[i] - this.ys[a];
        const len = Math.sqrt(ex * ex + ey * ey);
        if (len === 0) return;
        const d = (qx * qx + qy * qy - da2) / (2 * len);
        if (d < best) best = d;
      });
    }
    return best;
  }
}
