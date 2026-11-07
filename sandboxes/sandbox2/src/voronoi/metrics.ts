/**
 * Distance functions for Voronoi / Worley cells (research gaps §2.1).
 *
 * Every metric is evaluated on the offset `query − site` after an optional
 * rotation and anisotropic stretch, so all of them can be turned and squashed.
 * All of them are positively homogeneous (m(t·d) = t·m(d) for t ≥ 0), except
 * "squared Euclidean", which is the square of one. That lets the lattice search
 * prune with a single lower-bound factor per metric (see `lb`).
 *
 * Generation code uses deterministic `dpow`/`dsin`/`dcos` (shared/core/dmath), so
 * the same seed gives the same world in every browser. Display code may pass
 * `Math.pow` for speed.
 */
import { DEG, dcos, dpow, dsin } from '@shared/core/dmath';

export type MetricId =
  | 'euclidean'
  | 'squared'
  | 'manhattan'
  | 'chebyshev'
  | 'minkowski'
  | 'octagonal'
  | 'hexagonal'
  | 'triangular';

export interface MetricInfo {
  id: MetricId;
  label: string;
  short: string;
  formula: string;
  note: string;
}

export const METRICS: MetricInfo[] = [
  {
    id: 'euclidean',
    label: 'Euclidean (L2)',
    short: 'L2',
    formula: '√(dx² + dy²)',
    note: 'Convex polygons with straight bisector edges at any angle.',
  },
  {
    id: 'squared',
    label: 'Squared Euclidean',
    short: 'L2²',
    formula: 'dx² + dy²',
    note: 'Same cells as L2 (squaring is monotone) but different F-values. With additive weights it becomes a power diagram: straight edges, variable cell sizes.',
  },
  {
    id: 'manhattan',
    label: 'Manhattan (L1)',
    short: 'L1',
    formula: '|dx| + |dy|',
    note: 'Bisectors made of axis-aligned and 45° pieces: rigid, rectangular but random cells.',
  },
  {
    id: 'chebyshev',
    label: 'Chebyshev (L∞)',
    short: 'L∞',
    formula: 'max(|dx|, |dy|)',
    note: 'Blocky cells with edges at 0°, 45° and 90°.',
  },
  {
    id: 'minkowski',
    label: 'Minkowski (Lp)',
    short: 'Lp',
    formula: '(|dx|ᵖ + |dy|ᵖ)^(1/p)',
    note: 'p = 1 → L1, p = 2 → L2, p → ∞ → L∞. Below 1 it is no longer a metric and gives star-shaped, shard-like cells.',
  },
  {
    id: 'octagonal',
    label: 'Octagonal',
    short: 'Oct',
    formula: 'max(|dx|, |dy|, (|dx|+|dy|)/√2)',
    note: 'Regular-octagon unit ball: edges at multiples of 22.5°, between L1/L∞ and L2.',
  },
  {
    id: 'hexagonal',
    label: 'Hexagonal',
    short: 'Hex',
    formula: 'max(|dx|, |dx|/2 + |dy|·√3/2)',
    note: 'Regular-hexagon unit ball: edges at multiples of 30°, a cheap stand-in for L2 on hex boards.',
  },
  {
    id: 'triangular',
    label: 'Triangular (asymmetric)',
    short: 'Tri',
    formula: 'max(nᵢ · d), nᵢ at 90°, 210°, 330°',
    note: 'A quasi-metric: d(a→b) ≠ d(b→a). The unit ball is a triangle, so cells grow like shark fins in one direction.',
  },
];

export const METRIC_IDS: MetricId[] = METRICS.map((m) => m.id);

export function metricInfo(id: MetricId): MetricInfo {
  return METRICS.find((m) => m.id === id) ?? METRICS[0];
}

export interface MetricOptions {
  id: MetricId;
  /** Minkowski exponent */
  p: number;
  /** rotation of the metric frame, degrees */
  angle: number;
  /** anisotropy: > 1 stretches cells along the rotated x axis */
  stretch: number;
}

const K_L2 = 0;
const K_L1 = 1;
const K_LINF = 2;
const K_LP = 3;
const K_OCT = 4;
const K_HEX = 5;
const K_TRI = 6;

const KIND: Record<MetricId, number> = {
  euclidean: K_L2,
  squared: K_L2,
  manhattan: K_L1,
  chebyshev: K_LINF,
  minkowski: K_LP,
  octagonal: K_OCT,
  hexagonal: K_HEX,
  triangular: K_TRI,
};

const S3_2 = 0.8660254037844386;
const SQRT1_2 = 0.7071067811865476;

export class Metric {
  readonly id: MetricId;
  readonly squared: boolean;
  readonly p: number;
  /** norm(d) ≥ lb · max(|dx|, |dy|) for every offset d (used to prune the lattice search) */
  readonly lb: number;
  private readonly k: number;
  private readonly identity: boolean;
  private readonly m00: number;
  private readonly m01: number;
  private readonly m10: number;
  private readonly m11: number;
  private readonly pow: (x: number, y: number) => number;
  private readonly invP: number;

  constructor(o: MetricOptions, pow: (x: number, y: number) => number = dpow) {
    this.id = o.id;
    this.squared = o.id === 'squared';
    this.k = KIND[o.id] ?? K_L2;
    this.p = Math.min(16, Math.max(0.2, o.p));
    this.invP = 1 / this.p;
    this.pow = pow;
    const stretch = Math.min(8, Math.max(0.125, o.stretch || 1));
    const angle = o.angle || 0;
    this.identity = angle === 0 && stretch === 1;
    const c = dcos(angle * DEG);
    const s = dsin(angle * DEG);
    const k = Math.sqrt(stretch);
    // u = (c·dx + s·dy) / √k, v = (−s·dx + c·dy)·√k : area-preserving rotate + stretch
    this.m00 = c / k;
    this.m01 = s / k;
    this.m10 = -s * k;
    this.m11 = c * k;
    // Lower bound of the norm on the unit L∞ square boundary (sampled), with a safety margin.
    let lb = Infinity;
    const N = 512;
    for (let i = 0; i < N; i++) {
      const t = -1 + (2 * i) / N;
      lb = Math.min(lb, this.norm(1, t), this.norm(-1, -t), this.norm(t, -1), this.norm(-t, 1));
    }
    this.lb = lb * 0.985;
  }

  /** Positively homogeneous norm of the offset (√ of the value for "squared"). */
  norm(dx: number, dy: number): number {
    let u = dx;
    let v = dy;
    if (!this.identity) {
      u = this.m00 * dx + this.m01 * dy;
      v = this.m10 * dx + this.m11 * dy;
    }
    const au = u < 0 ? -u : u;
    const av = v < 0 ? -v : v;
    switch (this.k) {
      case K_L2:
        return Math.sqrt(u * u + v * v);
      case K_L1:
        return au + av;
      case K_LINF:
        return au > av ? au : av;
      case K_LP: {
        const p = this.p;
        if (p === 2) return Math.sqrt(u * u + v * v);
        if (p === 1) return au + av;
        const s = this.pow(au, p) + this.pow(av, p);
        return s === 0 ? 0 : this.pow(s, this.invP);
      }
      case K_OCT: {
        const m = au > av ? au : av;
        const d = (au + av) * SQRT1_2;
        return m > d ? m : d;
      }
      case K_HEX: {
        const d = au * 0.5 + av * S3_2;
        return au > d ? au : d;
      }
      default: {
        // triangular quasi-metric: max of three half-plane functionals 120° apart
        const a = v;
        const b = -S3_2 * u - 0.5 * v;
        const c = S3_2 * u - 0.5 * v;
        return a > b ? (a > c ? a : c) : b > c ? b : c;
      }
    }
  }

  /** The metric value of the offset `query − site` (squared for "squared Euclidean"). */
  value(dx: number, dy: number): number {
    const n = this.norm(dx, dy);
    return this.squared ? n * n : n;
  }

  /** Inverse of `value` back to a norm (for drawing balls of a given value). */
  toNorm(value: number): number {
    return this.squared ? Math.sqrt(Math.max(0, value)) : value;
  }

  /**
   * Boundary of the unit ball {d : norm(d) ≤ 1} as a closed polygon of `n` points
   * (display only: uses Math.cos/sin).
   */
  ballPolygon(n = 180): Float64Array<ArrayBuffer> {
    const out = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ex = Math.cos(a);
      const ey = Math.sin(a);
      const r = 1 / Math.max(1e-9, this.norm(ex, ey));
      out[i * 2] = ex * r;
      out[i * 2 + 1] = ey * r;
    }
    return out;
  }
}
