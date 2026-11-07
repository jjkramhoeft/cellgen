/**
 * One level of the map hierarchy: a stateless ("infinite") Voronoi diagram on a
 * jittered square lattice, with optional domain-warped borders.
 *
 * Lattice cell (i, j) of side `size` metres holds exactly one site at a hashed
 * offset, so the diagram is a pure function of (seed, position): any point of an
 * unbounded world can be evaluated without a mesh, in any order, in any browser.
 *
 * Border warp displaces the query point by a two-octave fBm vector field before
 * the nearest-site search:  cell(p) = nearest site to p + a·size·w(p·f/size).
 * The sites themselves do not move, so a site may sit just outside its own warped
 * cell; everything that needs "the cell a site belongs to" uses the site position.
 *
 * Cells are addressed by a packed numeric key (exact in a float64), see `packKey`.
 */
import { hash4, toUnit } from '@shared/core/hash';
import { fbm } from '@shared/core/noise';

const OFF = 2097152; // 2^21: lattice indices in [−2^21, 2^21)
const SPAN = 4194304; // 2^22

/** Pack lattice indices into one exact float64 key (< 2^44). */
export function packKey(i: number, j: number): number {
  return (i + OFF) * SPAN + (j + OFF);
}
export function keyI(k: number): number {
  return Math.floor(k / SPAN) - OFF;
}
export function keyJ(k: number): number {
  return (k % SPAN) - OFF;
}

const ST_SX = 0x3a01;
const ST_SY = 0x3a02;
const WARP_FBM = { octaves: 2, lacunarity: 2, gain: 0.5 };

export interface LevelOptions {
  seed: number;
  /** lattice spacing, metres */
  size: number;
  /** 0 = sites on the cell centres (a square grid), 1 = anywhere in the lattice cell */
  jitter: number;
  /** border warp amplitude, in cell sizes (0 = straight Voronoi edges) */
  warp: number;
  /** border warp frequency, in noise cycles per cell */
  warpFreq: number;
}

export interface Neighbour {
  key: number;
  /** squared site distance, m² */
  d2: number;
}

export class Level {
  readonly seed: number;
  readonly size: number;
  readonly jitter: number;
  readonly warp: number;
  readonly warpFreq: number;
  private readonly inv: number;
  /** (1 − jitter)/2: the minimum L∞ gap from a lattice cell border to its site */
  private readonly lb: number;
  private readonly wsx: number;
  private readonly wsy: number;

  /** outputs of the last `query`: lattice cell of the nearest site and the warped query point */
  qi = 0;
  qj = 0;
  qx = 0;
  qy = 0;
  /** lattice cells visited by the last query */
  visited = 0;

  constructor(o: LevelOptions) {
    this.seed = o.seed | 0;
    this.size = o.size;
    this.jitter = Math.min(1, Math.max(0, o.jitter));
    this.warp = Math.max(0, o.warp);
    this.warpFreq = o.warpFreq;
    this.inv = 1 / o.size;
    this.lb = (1 - this.jitter) / 2;
    this.wsx = (this.seed ^ 0x2f6b1e3d) | 0;
    this.wsy = (this.seed ^ 0x5bd1e995) | 0;
  }

  /** Site of lattice cell (i, j), metres. */
  siteX(i: number, j: number): number {
    return (i + 0.5 + (toUnit(hash4(this.seed, ST_SX, i, j)) - 0.5) * this.jitter) * this.size;
  }
  siteY(i: number, j: number): number {
    return (j + 0.5 + (toUnit(hash4(this.seed, ST_SY, i, j)) - 0.5) * this.jitter) * this.size;
  }

  /** Max displacement of the border warp, metres (fBm is bounded by 1). */
  get warpReach(): number {
    return this.warp * this.size;
  }

  /** Key of the cell containing world point (wx, wy). Sets qi, qj, qx, qy. */
  query(wx: number, wy: number): number {
    let x = wx;
    let y = wy;
    if (this.warp > 0) {
      const f = this.warpFreq * this.inv;
      const a = this.warp * this.size;
      const nx = wx * f;
      const ny = wy * f;
      x += a * fbm(this.wsx, nx, ny, WARP_FBM);
      y += a * fbm(this.wsy, nx + 31.7, ny - 47.3, WARP_FBM);
    }
    this.qx = x;
    this.qy = y;
    const lx = x * this.inv;
    const ly = y * this.inv;
    const ci = Math.floor(lx);
    const cj = Math.floor(ly);
    const jit = this.jitter;
    const seed = this.seed;
    let best = Infinity;
    let bi = ci;
    let bj = cj;
    let visited = 0;
    // Chebyshev rings with Worley's pruning: a site in ring r is ≥ r − 1 + (1 − jitter)/2
    // away in L∞, hence in L2. Ring 3 always prunes (best ≤ √2 within ring 0..1).
    for (let r = 0; r <= 3; r++) {
      if (r >= 1) {
        const b = r - 1 + this.lb;
        if (b > 0 && b * b > best) break;
      }
      for (let dj = -r; dj <= r; dj++) {
        const step = r === 0 || dj === -r || dj === r ? 1 : 2 * r;
        for (let di = -r; di <= r; di += step) {
          const i = ci + di;
          const j = cj + dj;
          visited++;
          const dx = lx - (i + 0.5 + (toUnit(hash4(seed, ST_SX, i, j)) - 0.5) * jit);
          const dy = ly - (j + 0.5 + (toUnit(hash4(seed, ST_SY, i, j)) - 0.5) * jit);
          const d = dx * dx + dy * dy;
          // ties broken by (j, i) so the answer never depends on the visiting order
          if (d < best || (d === best && (j < bj || (j === bj && i < bi)))) {
            best = d;
            bi = i;
            bj = j;
          }
        }
      }
    }
    this.qi = bi;
    this.qj = bj;
    this.visited = visited;
    return packKey(bi, bj);
  }

  /**
   * Gabriel-graph neighbours of cell (i, j), nearest first: B is a neighbour of A
   * when no other site lies inside the circle with diameter AB. The Gabriel graph
   * is a subgraph of the Delaunay graph (so these are true Voronoi neighbours of
   * the unwarped diagram) and always contains each site's nearest neighbour. The
   * test is a function of the pair only, so the relation is symmetric.
   */
  neighbours(i: number, j: number): Neighbour[] {
    const ax = this.siteX(i, j);
    const ay = this.siteY(i, j);
    const out: Neighbour[] = [];
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        if (di === 0 && dj === 0) continue;
        const bi = i + di;
        const bj = j + dj;
        const bx = this.siteX(bi, bj);
        const by = this.siteY(bi, bj);
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const r2 = ((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) / 4;
        const r = Math.sqrt(r2);
        const i0 = Math.floor((mx - r) * this.inv);
        const i1 = Math.floor((mx + r) * this.inv);
        const j0 = Math.floor((my - r) * this.inv);
        const j1 = Math.floor((my + r) * this.inv);
        let empty = true;
        for (let cj = j0; cj <= j1 && empty; cj++) {
          for (let ci = i0; ci <= i1; ci++) {
            if ((ci === i && cj === j) || (ci === bi && cj === bj)) continue;
            const cx = this.siteX(ci, cj) - mx;
            const cy = this.siteY(ci, cj) - my;
            if (cx * cx + cy * cy < r2) {
              empty = false;
              break;
            }
          }
        }
        if (empty) out.push({ key: packKey(bi, bj), d2: 4 * r2 });
      }
    }
    out.sort((a, b) => a.d2 - b.d2 || a.key - b.key);
    return out;
  }
}
