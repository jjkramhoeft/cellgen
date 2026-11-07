/**
 * Point-set generators for cell sites (research §2.2):
 * uniform random, jittered square / hex lattice (FMG-style), Bridson Poisson-disc
 * (with optional variable density), Mitchell best-candidate, and a Vogel
 * (sunflower) spiral.
 */
import { hash4, toUnit, sfc32, STAGE, type Rng } from './hash';
import { dsin, dcos } from './dmath';
import { fbm } from './noise';

export type PointMethod = 'uniform' | 'jitter-square' | 'jitter-hex' | 'poisson' | 'best-candidate' | 'spiral';
export type DensityMode = 'none' | 'noise' | 'radial' | 'gradient';

export interface PointParams {
  method: PointMethod;
  n: number;
  W: number;
  H: number;
  seed: number;
  jitter: number;
  poissonK: number;
  density: DensityMode;
  densityContrast: number;
  densityFreq: number;
}

export interface PointSet {
  xs: Float64Array;
  ys: Float64Array;
  /** Lattice info for jittered methods, used by the lattice overlay. */
  lattice?: { kind: 'square' | 'hex'; dx: number; dy: number; cols: number; rows: number };
}

/** Density in (0, 1]: 1 means "full" density, lower values mean sparser sampling. */
export function makeDensity(p: PointParams): (x: number, y: number) => number {
  const c = Math.min(0.97, Math.max(0, p.densityContrast));
  const { W, H } = p;
  switch (p.density) {
    case 'noise': {
      const f = p.densityFreq / W;
      const seed = (p.seed ^ 0x2545f491) | 0;
      return (x, y) => {
        const v = fbm(seed, x * f, y * f, { octaves: 3, lacunarity: 2, gain: 0.5 }) * 0.5 + 0.5;
        return 1 - c * (1 - Math.min(1, Math.max(0, v * 1.4 - 0.2)));
      };
    }
    case 'radial':
      return (x, y) => {
        const dx = (x - W / 2) / (W / 2);
        const dy = (y - H / 2) / (H / 2);
        const r = Math.min(1, Math.sqrt(dx * dx + dy * dy) / Math.SQRT2);
        return 1 - c * r;
      };
    case 'gradient':
      return (x) => 1 - c * (x / W);
    default:
      return () => 1;
  }
}

function meanDensity(d: (x: number, y: number) => number, W: number, H: number): number {
  let s = 0;
  const k = 40;
  for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) s += d(((i + 0.5) * W) / k, ((j + 0.5) * H) / k);
  return s / (k * k);
}

export function generatePoints(p: PointParams): PointSet {
  const rng = sfc32((p.seed ^ Math.imul(STAGE.points, 0x9e3779b9)) | 0);
  const n = Math.max(3, Math.floor(p.n));
  switch (p.method) {
    case 'uniform':
      return uniform(n, p, rng);
    case 'jitter-square':
      return jitterSquare(n, p);
    case 'jitter-hex':
      return jitterHex(n, p);
    case 'poisson':
      return poisson(n, p, rng);
    case 'best-candidate':
      return bestCandidate(n, p, rng);
    case 'spiral':
      return spiral(n, p);
  }
}

function uniform(n: number, p: PointParams, rng: Rng): PointSet {
  const dens = makeDensity(p);
  const xs: number[] = [];
  const ys: number[] = [];
  let guard = n * 200;
  while (xs.length < n && guard-- > 0) {
    const x = rng() * p.W;
    const y = rng() * p.H;
    if (p.density === 'none' || rng() < dens(x, y)) {
      xs.push(x);
      ys.push(y);
    }
  }
  return { xs: Float64Array.from(xs), ys: Float64Array.from(ys) };
}

/** One point per lattice cell, displaced by a hashed offset (Azgaar FMG grid sampling). */
function jitterSquare(n: number, p: PointParams): PointSet {
  const s = Math.sqrt((p.W * p.H) / n);
  const cols = Math.max(1, Math.round(p.W / s));
  const rows = Math.max(1, Math.round(p.H / s));
  const dx = p.W / cols;
  const dy = p.H / rows;
  const xs = new Float64Array(cols * rows);
  const ys = new Float64Array(cols * rows);
  const j = Math.min(1, Math.max(0, p.jitter)) * 0.5;
  let k = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const hx = toUnit(hash4(p.seed, STAGE.jitter, c, r)) * 2 - 1;
      const hy = toUnit(hash4(p.seed, STAGE.jitter + 100, c, r)) * 2 - 1;
      xs[k] = (c + 0.5 + hx * j * 0.999) * dx;
      ys[k] = (r + 0.5 + hy * j * 0.999) * dy;
      k++;
    }
  }
  return { xs, ys, lattice: { kind: 'square', dx, dy, cols, rows } };
}

/** Hex lattice (offset rows) with hashed jitter. Jitter 0 gives perfect hexagonal Voronoi cells. */
function jitterHex(n: number, p: PointParams): PointSet {
  // hex lattice: horizontal spacing s, vertical spacing s·√3/2
  const s = Math.sqrt((p.W * p.H) / n / (Math.sqrt(3) / 2));
  const dy = (s * Math.sqrt(3)) / 2;
  const rows = Math.max(1, Math.round(p.H / dy));
  const cols = Math.max(1, Math.round(p.W / s));
  const ddx = p.W / cols;
  const ddy = p.H / rows;
  const xs: number[] = [];
  const ys: number[] = [];
  const j = Math.min(1, Math.max(0, p.jitter)) * 0.5;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 === 0 ? 0.25 : 0.75;
    for (let c = 0; c < cols; c++) {
      const hx = toUnit(hash4(p.seed, STAGE.jitter, c, r)) * 2 - 1;
      const hy = toUnit(hash4(p.seed, STAGE.jitter + 100, c, r)) * 2 - 1;
      xs.push(Math.min(p.W - 1e-6, Math.max(1e-6, (c + off + hx * j * 0.999) * ddx)));
      ys.push(Math.min(p.H - 1e-6, Math.max(1e-6, (r + 0.5 + hy * j * 0.999) * ddy)));
    }
  }
  return {
    xs: Float64Array.from(xs),
    ys: Float64Array.from(ys),
    lattice: { kind: 'hex', dx: ddx, dy: ddy, cols, rows },
  };
}

/**
 * Bridson's Poisson-disc sampling (SIGGRAPH 2007), with k candidates in the annulus
 * [r, 2r]. Supports variable radius r(x) = r0 / √density(x). Annulus candidates are
 * drawn by rejection in the square, so no trig is needed.
 */
function poisson(n: number, p: PointParams, rng: Rng): PointSet {
  const { W, H } = p;
  const dens = makeDensity(p);
  const variable = p.density !== 'none';
  const md = variable ? meanDensity(dens, W, H) : 1;
  // Bridson's output has about 0.63·A/r² points (measured), so solve for r.
  const r0 = Math.sqrt((0.63 * W * H * md) / n);
  const rAt = variable ? (x: number, y: number) => r0 / Math.sqrt(dens(x, y)) : () => r0;
  const rMax = variable ? r0 / Math.sqrt(1 - Math.min(0.97, p.densityContrast)) : r0;
  const cell = r0 / Math.SQRT2;
  const gw = Math.ceil(W / cell);
  const gh = Math.ceil(H / cell);
  // a cell may hold several points when radii vary; keep a small linked list per cell
  const head = new Int32Array(gw * gh).fill(-1);
  const nextIdx: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const rs: number[] = [];
  const active: number[] = [];
  const k = Math.max(1, Math.floor(p.poissonK));
  const reach = Math.ceil((2 * rMax) / cell);

  const add = (x: number, y: number) => {
    const i = xs.length;
    xs.push(x);
    ys.push(y);
    rs.push(rAt(x, y));
    const g = Math.floor(y / cell) * gw + Math.floor(x / cell);
    nextIdx.push(head[g]);
    head[g] = i;
    active.push(i);
  };
  const ok = (x: number, y: number, r: number) => {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    const rr = variable ? reach : 2;
    for (let yy = Math.max(0, gy - rr); yy <= Math.min(gh - 1, gy + rr); yy++) {
      for (let xx = Math.max(0, gx - rr); xx <= Math.min(gw - 1, gx + rr); xx++) {
        for (let q = head[yy * gw + xx]; q !== -1; q = nextIdx[q]) {
          const dx = xs[q] - x;
          const dy = ys[q] - y;
          const lim = variable ? 0.5 * (r + rs[q]) : r;
          if (dx * dx + dy * dy < lim * lim) return false;
        }
      }
    }
    return true;
  };

  add(W * (0.25 + 0.5 * rng()), H * (0.25 + 0.5 * rng()));
  while (active.length > 0) {
    const ai = rng.int(active.length);
    const s = active[ai];
    const r = rs[s];
    let found = false;
    for (let t = 0; t < k; t++) {
      let cx = 0;
      let cy = 0;
      // uniform in annulus [r, 2r] by rejection
      for (let g = 0; g < 16; g++) {
        cx = (rng() * 2 - 1) * 2 * r;
        cy = (rng() * 2 - 1) * 2 * r;
        const d2 = cx * cx + cy * cy;
        if (d2 >= r * r && d2 <= 4 * r * r) break;
      }
      const x = xs[s] + cx;
      const y = ys[s] + cy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if (ok(x, y, rAt(x, y))) {
        add(x, y);
        found = true;
        break;
      }
    }
    if (!found) {
      active[ai] = active[active.length - 1];
      active.pop();
    }
  }
  return { xs: Float64Array.from(xs), ys: Float64Array.from(ys) };
}

/** Mitchell's best-candidate: each new point is the farthest of m candidates from all existing ones. */
function bestCandidate(n: number, p: PointParams, rng: Rng): PointSet {
  const { W, H } = p;
  const dens = makeDensity(p);
  const m = Math.max(2, Math.floor(p.poissonK / 3));
  const cell = Math.sqrt((W * H) / n);
  const gw = Math.ceil(W / cell);
  const gh = Math.ceil(H / cell);
  const head = new Int32Array(gw * gh).fill(-1);
  const nextIdx = new Int32Array(n).fill(-1);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let count = 0;
  const nearestD2 = (x: number, y: number): number => {
    const gx = Math.min(gw - 1, Math.floor(x / cell));
    const gy = Math.min(gh - 1, Math.floor(y / cell));
    let best = Infinity;
    for (let r = 0; r < Math.max(gw, gh); r++) {
      const lb = (r - 1) * cell;
      if (lb > 0 && lb * lb > best) break;
      for (let yy = gy - r; yy <= gy + r; yy++) {
        if (yy < 0 || yy >= gh) continue;
        for (let xx = gx - r; xx <= gx + r; xx++) {
          if (xx < 0 || xx >= gw) continue;
          if (Math.max(Math.abs(xx - gx), Math.abs(yy - gy)) !== r) continue;
          for (let q = head[yy * gw + xx]; q !== -1; q = nextIdx[q]) {
            const dx = xs[q] - x;
            const dy = ys[q] - y;
            const d = dx * dx + dy * dy;
            if (d < best) best = d;
          }
        }
      }
    }
    return best;
  };
  for (let i = 0; i < n; i++) {
    let bx = 0;
    let by = 0;
    let bd = -1;
    for (let c = 0; c < m; c++) {
      const x = rng() * W;
      const y = rng() * H;
      let d = count === 0 ? 1 : nearestD2(x, y);
      if (p.density !== 'none') d *= dens(x, y);
      if (d > bd) {
        bd = d;
        bx = x;
        by = y;
      }
    }
    xs[count] = bx;
    ys[count] = by;
    const g = Math.min(gh - 1, Math.floor(by / cell)) * gw + Math.min(gw - 1, Math.floor(bx / cell));
    nextIdx[count] = head[g];
    head[g] = count;
    count++;
  }
  return { xs, ys };
}

/** Vogel's sunflower spiral (golden-angle phyllotaxis), cropped to the map. */
function spiral(n: number, p: PointParams): PointSet {
  const { W, H } = p;
  const golden = 2.399963229728653; // π(3 − √5)
  const R = Math.sqrt(W * W + H * H) / 2;
  // the disc of radius R has area πR²; scale count so ~n land inside the rectangle
  const total = Math.ceil((n * Math.PI * R * R) / (W * H));
  const c = R / Math.sqrt(total);
  const xs: number[] = [];
  const ys: number[] = [];
  const j = p.jitter * c * 0.5;
  for (let i = 0; i < total; i++) {
    const r = c * Math.sqrt(i + 0.5);
    const a = i * golden;
    let x = W / 2 + r * dcos(a);
    let y = H / 2 + r * dsin(a);
    if (j > 0) {
      x += (toUnit(hash4(p.seed, STAGE.jitter, i, 0)) * 2 - 1) * j;
      y += (toUnit(hash4(p.seed, STAGE.jitter, i, 1)) * 2 - 1) * j;
    }
    if (x > 0 && y > 0 && x < W && y < H) {
      xs.push(x);
      ys.push(y);
    }
  }
  return { xs: Float64Array.from(xs), ys: Float64Array.from(ys) };
}
