/**
 * Stateless ("infinite") Voronoi on a jittered lattice — the Worley / Quilez
 * construction (research §6.3, gaps §2.2).
 *
 * Space is cut into square lattice cells of side `size`. Each cell (i, j) holds
 * exactly one site, placed at a hashed offset inside the cell:
 *   site = (i + ½ + (h − ½)·jitter, j + ½ + (h' − ½)·jitter)   (lattice units)
 * so the site set is a pure function of (seed, i, j) and the diagram can be
 * evaluated at any point, at any zoom, with no precomputed mesh.
 *
 * The nearest and second-nearest sites are found by visiting Chebyshev rings of
 * lattice cells around the query. That stops with Worley's pruning: every site in
 * ring r is at least r − 1 + (1 − jitter)/2 away in L∞, and the metric's `lb`
 * factor turns that into a bound in any metric (gaps §2.2, "search neighbourhood
 * per metric"). The search is therefore exact for every metric and jitter.
 *
 * Optional per-site weights give weighted Voronoi diagrams:
 *   additive        score = value − w      (Apollonius / hyperbolic edges)
 *   multiplicative  score = value / w      (circular edges)
 * With the squared-Euclidean metric, additive weights give a power diagram.
 */
import { hash4, toUnit } from '@shared/core/hash';
import type { Metric } from './metrics';

export type WeightMode = 'none' | 'additive' | 'multiplicative';

/** Result of a lattice query. Coordinates are in lattice units unless noted. */
export interface Hit {
  /** lattice cell of the nearest site */
  i1: number;
  j1: number;
  /** nearest site, lattice units */
  x1: number;
  y1: number;
  /** metric value (F1) and weighted score of the nearest site */
  f1: number;
  s1: number;
  /** second-nearest */
  i2: number;
  j2: number;
  x2: number;
  y2: number;
  f2: number;
  s2: number;
  /** the (possibly warped) query point, lattice units */
  qx: number;
  qy: number;
  /** number of lattice cells visited (for the statistics panel) */
  visited: number;
}

export function newHit(): Hit {
  return { i1: 0, j1: 0, x1: 0, y1: 0, f1: 0, s1: 0, i2: 0, j2: 0, x2: 0, y2: 0, f2: 0, s2: 0, qx: 0, qy: 0, visited: 0 };
}

const ST_X = 0x51a1;
const ST_Y = 0x51a2;
const ST_W = 0x51a3;
/** Hard cap on the ring radius (only reachable with extreme additive weights). */
const MAX_RING = 6;

/** 16-bit packed cell id: unique for cells less than 65536 apart, which is all that adjacency needs. */
export function cellId(i: number, j: number): number {
  return ((i & 0xffff) | ((j & 0xffff) << 16)) | 0;
}

export interface LatticeOptions {
  seed: number;
  /** lattice cell side, world units */
  size: number;
  /** lattice origin offset, world units */
  ox: number;
  oy: number;
  /** 0 = sites on the cell centres (perfect squares), 1 = anywhere in the cell */
  jitter: number;
  metric: Metric;
  weightMode: WeightMode;
  /** weight strength (lattice units for additive, ratio for multiplicative) */
  weightAmt: number;
}

export class Lattice {
  readonly seed: number;
  readonly size: number;
  readonly ox: number;
  readonly oy: number;
  readonly jitter: number;
  readonly metric: Metric;
  readonly weightMode: WeightMode;
  readonly weightAmt: number;
  private readonly wMax: number;
  private readonly lbBase: number;

  constructor(o: LatticeOptions) {
    this.seed = o.seed | 0;
    this.size = o.size;
    this.ox = o.ox;
    this.oy = o.oy;
    this.jitter = Math.min(1, Math.max(0, o.jitter));
    this.metric = o.metric;
    this.weightMode = o.weightAmt > 0 ? o.weightMode : 'none';
    this.weightAmt = Math.max(0, o.weightAmt);
    this.wMax = this.weightMode === 'multiplicative' ? 1 + this.weightAmt : this.weightAmt;
    this.lbBase = (1 - this.jitter) / 2;
  }

  /** Site x of lattice cell (i, j), lattice units. */
  siteX(i: number, j: number): number {
    return i + 0.5 + (toUnit(hash4(this.seed, ST_X, i, j)) - 0.5) * this.jitter;
  }

  siteY(i: number, j: number): number {
    return j + 0.5 + (toUnit(hash4(this.seed, ST_Y, i, j)) - 0.5) * this.jitter;
  }

  /** Per-site weight (additive: [0, amt], multiplicative: [1, 1 + amt]). */
  weight(i: number, j: number): number {
    if (this.weightMode === 'none') return 0;
    const u = toUnit(hash4(this.seed, ST_W, i, j));
    return this.weightMode === 'additive' ? this.weightAmt * u : 1 + this.weightAmt * u;
  }

  toLatticeX(wx: number): number {
    return (wx - this.ox) / this.size;
  }

  toLatticeY(wy: number): number {
    return (wy - this.oy) / this.size;
  }

  toWorldX(lx: number): number {
    return lx * this.size + this.ox;
  }

  toWorldY(ly: number): number {
    return ly * this.size + this.oy;
  }

  /** Lower bound of the score of any site in Chebyshev ring r ≥ 1. */
  private ringBound(r: number): number {
    const inf = r - 1 + this.lbBase;
    if (inf <= 0) return -Infinity;
    let v = inf * this.metric.lb;
    if (this.metric.squared) v *= v;
    if (this.weightMode === 'additive') return v - this.wMax;
    if (this.weightMode === 'multiplicative') return v / this.wMax;
    return v;
  }

  /** Nearest and second-nearest site to the world point (wx, wy). */
  query(wx: number, wy: number, out: Hit): Hit {
    const qx = (wx - this.ox) / this.size;
    const qy = (wy - this.oy) / this.size;
    const ci = Math.floor(qx);
    const cj = Math.floor(qy);
    out.s1 = out.s2 = Infinity;
    out.f1 = out.f2 = Infinity;
    out.visited = 0;
    out.qx = qx;
    out.qy = qy;
    for (let r = 0; r <= MAX_RING; r++) {
      if (r >= 1 && this.ringBound(r) > out.s2) break;
      for (let dj = -r; dj <= r; dj++) {
        const edgeRow = dj === -r || dj === r;
        const step = edgeRow || r === 0 ? 1 : 2 * r;
        for (let di = -r; di <= r; di += step) this.visit(ci + di, cj + dj, qx, qy, out);
      }
    }
    return out;
  }

  private visit(i: number, j: number, qx: number, qy: number, out: Hit): void {
    out.visited++;
    const sx = this.siteX(i, j);
    const sy = this.siteY(i, j);
    const f = this.metric.value(qx - sx, qy - sy);
    let s = f;
    if (this.weightMode === 'additive') s = f - this.weight(i, j);
    else if (this.weightMode === 'multiplicative') s = f / this.weight(i, j);
    // ties broken by (j, i) so the result does not depend on the visiting order
    if (s < out.s1 || (s === out.s1 && (j < out.j1 || (j === out.j1 && i < out.i1)))) {
      out.i2 = out.i1;
      out.j2 = out.j1;
      out.x2 = out.x1;
      out.y2 = out.y1;
      out.f2 = out.f1;
      out.s2 = out.s1;
      out.i1 = i;
      out.j1 = j;
      out.x1 = sx;
      out.y1 = sy;
      out.f1 = f;
      out.s1 = s;
    } else if (s < out.s2) {
      out.i2 = i;
      out.j2 = j;
      out.x2 = sx;
      out.y2 = sy;
      out.f2 = f;
      out.s2 = s;
    }
  }
}
