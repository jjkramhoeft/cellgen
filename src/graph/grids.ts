/**
 * Regular grids (research §3.1): square (4/8-neighbour), pointy-top hex in odd-r
 * offset layout (Red Blob "Hexagonal Grids"), and equilateral triangles.
 */
import { assembleExplicit } from './assemble';
import { clipToRect, polyArea, type LPoly } from './polygon';
import type { CellGraph } from './types';

export function buildSquare(n: number, W: number, H: number, eight: boolean): CellGraph {
  const s = Math.sqrt((W * H) / n);
  const cols = Math.max(1, Math.round(W / s));
  const rows = Math.max(1, Math.round(H / s));
  const dx = W / cols;
  const dy = H / rows;
  const N = cols * rows;
  const polys: LPoly[] = new Array(N);
  const sx = new Float64Array(N);
  const sy = new Float64Array(N);
  const extra: number[][] | null = eight ? new Array(N) : null;
  const id = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x0 = c * dx;
      const y0 = r * dy;
      const x1 = x0 + dx;
      const y1 = y0 + dy;
      polys[i] = {
        xs: [x0, x1, x1, x0],
        ys: [y0, y0, y1, y1],
        lbl: [id(c, r - 1), id(c + 1, r), id(c, r + 1), id(c - 1, r)],
      };
      sx[i] = x0 + dx / 2;
      sy[i] = y0 + dy / 2;
      if (extra) extra[i] = [id(c - 1, r - 1), id(c + 1, r - 1), id(c - 1, r + 1), id(c + 1, r + 1)];
    }
  }
  const cellAt = () => (x: number, y: number) => {
    const c = Math.floor(x / dx);
    const r = Math.floor(y / dy);
    return id(c, r);
  };
  return assembleExplicit('square', W, H, polys, sx, sy, cellAt, extra, {
    lattice: `${cols} × ${rows}`,
    neighbourhood: eight ? 'Moore (8)' : 'von Neumann (4)',
  });
}

const S3 = Math.sqrt(3);
// pointy-top unit hex corners at 30° + 60°k
const HX = [S3 / 2, 0, -S3 / 2, -S3 / 2, 0, S3 / 2];
const HY = [0.5, 1, 0.5, -0.5, -1, -0.5];

export function buildHex(n: number, W: number, H: number): CellGraph {
  const hexArea = (W * H) / n;
  const R = Math.sqrt(hexArea / ((3 * S3) / 2));
  const w = S3 * R;
  const vs = 1.5 * R;
  const cols = Math.ceil(W / w) + 1;
  const rows = Math.ceil(H / vs) + 1;
  const center = (c: number, r: number): [number, number] => [(c + 0.5 * (r & 1)) * w, r * vs];
  // fractional pixel → odd-r offset coords
  const lattice = (x: number, y: number): [number, number] => {
    const q = ((S3 / 3) * x - (1 / 3) * y) / R;
    const rr = ((2 / 3) * y) / R;
    // cube round
    const cx = q;
    const cz = rr;
    const cy = -cx - cz;
    let rx = Math.round(cx);
    let ry = Math.round(cy);
    let rz = Math.round(cz);
    const dx = Math.abs(rx - cx);
    const dy = Math.abs(ry - cy);
    const dz = Math.abs(rz - cz);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    void ry;
    const row = rz;
    const col = rx + (row - (row & 1)) / 2;
    return [col, row];
  };
  const index = new Int32Array(cols * rows).fill(-1);
  const cand: { c: number; r: number; p: LPoly }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [cx, cy] = center(c, r);
      const xs = HX.map((v) => cx + v * R);
      const ys = HY.map((v) => cy + v * R);
      const lbl = [0, 0, 0, 0, 0, 0];
      const clipped = clipToRect({ xs, ys, lbl }, W, H);
      if (clipped.xs.length < 3 || Math.abs(polyArea(clipped.xs, clipped.ys)) < hexArea * 1e-4) continue;
      index[r * cols + c] = cand.length;
      cand.push({ c, r, p: { xs, ys, lbl } });
    }
  }
  const idAt = (x: number, y: number) => {
    const [c, r] = lattice(x, y);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return -1;
    return index[r * cols + c];
  };
  const N = cand.length;
  const polys: LPoly[] = new Array(N);
  const sx = new Float64Array(N);
  const sy = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const { c, r, p } = cand[i];
    const [cx, cy] = center(c, r);
    sx[i] = cx;
    sy[i] = cy;
    for (let k = 0; k < 6; k++) {
      const j = (k + 1) % 6;
      const mx = (p.xs[k] + p.xs[j]) / 2;
      const my = (p.ys[k] + p.ys[j]) / 2;
      p.lbl[k] = idAt(2 * mx - cx, 2 * my - cy);
    }
    polys[i] = clipToRect(p, W, H);
  }
  return assembleExplicit('hex', W, H, polys, sx, sy, () => idAt, null, {
    layout: 'pointy-top, odd-r offset',
    'hex radius': R.toFixed(2),
  });
}

export function buildTri(n: number, W: number, H: number): CellGraph {
  // N ≈ 4WH / (√3 a²)
  const a = Math.sqrt((4 * W * H) / (S3 * n));
  const h = (a * S3) / 2;
  const rows = Math.ceil(H / h);
  const cols = Math.ceil((2 * W) / a) + 2;
  const verts = (c: number, r: number): [number[], number[]] => {
    const x0 = ((c - 1) * a) / 2;
    const up = ((r + c) & 1) === 0;
    if (up) return [[x0 + a / 2, x0 + a, x0], [r * h, (r + 1) * h, (r + 1) * h]];
    return [[x0, x0 + a, x0 + a / 2], [r * h, r * h, (r + 1) * h]];
  };
  const inTri = (xs: number[], ys: number[], x: number, y: number) => {
    let neg = false;
    let pos = false;
    for (let k = 0; k < 3; k++) {
      const j = (k + 1) % 3;
      const d = (xs[j] - xs[k]) * (y - ys[k]) - (ys[j] - ys[k]) * (x - xs[k]);
      if (d < -1e-12) neg = true;
      if (d > 1e-12) pos = true;
    }
    return !(neg && pos);
  };
  const index = new Int32Array(cols * rows).fill(-1);
  const cand: { c: number; r: number; p: LPoly }[] = [];
  const triArea = (a * h) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [xs, ys] = verts(c, r);
      const clipped = clipToRect({ xs, ys, lbl: [0, 0, 0] }, W, H);
      if (clipped.xs.length < 3 || Math.abs(polyArea(clipped.xs, clipped.ys)) < triArea * 1e-4) continue;
      index[r * cols + c] = cand.length;
      cand.push({ c, r, p: { xs, ys, lbl: [0, 0, 0] } });
    }
  }
  const idAt = (x: number, y: number) => {
    const r = Math.floor(y / h);
    if (r < 0 || r >= rows) return -1;
    const u = x / (a / 2);
    const c0 = Math.floor(u);
    for (const c of [c0, c0 + 1]) {
      if (c < 0 || c >= cols) continue;
      const [xs, ys] = verts(c, r);
      if (inTri(xs, ys, x, y)) return index[r * cols + c];
    }
    return -1;
  };
  const N = cand.length;
  const polys: LPoly[] = new Array(N);
  const sx = new Float64Array(N);
  const sy = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const { p } = cand[i];
    const cx = (p.xs[0] + p.xs[1] + p.xs[2]) / 3;
    const cy = (p.ys[0] + p.ys[1] + p.ys[2]) / 3;
    sx[i] = cx;
    sy[i] = cy;
    for (let k = 0; k < 3; k++) {
      const j = (k + 1) % 3;
      const mx = (p.xs[k] + p.xs[j]) / 2;
      const my = (p.ys[k] + p.ys[j]) / 2;
      p.lbl[k] = idAt(2 * mx - cx, 2 * my - cy);
    }
    polys[i] = clipToRect(p, W, H);
  }
  return assembleExplicit('tri', W, H, polys, sx, sy, () => idAt, null, {
    'side length': a.toFixed(2),
  });
}
