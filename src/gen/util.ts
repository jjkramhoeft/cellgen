import type { CellGraph } from '../graph/types';

/** Breadth-first hop distance from all cells with sources[i] = 1 (−1 where unreachable). */
export function bfsHops(g: CellGraph, sources: Uint8Array, allowed?: (i: number) => boolean): Int32Array {
  const dist = new Int32Array(g.n).fill(-1);
  const queue = new Int32Array(g.n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < g.n; i++) {
    if (sources[i]) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const c = queue[head++];
    for (let k = g.nbrOff[c]; k < g.nbrOff[c + 1]; k++) {
      const nb = g.nbr[k];
      if (dist[nb] !== -1) continue;
      if (allowed && !allowed(nb)) continue;
      dist[nb] = dist[c] + 1;
      queue[tail++] = nb;
    }
  }
  return dist;
}

/** Neighbour-averaging passes (optionally only where mask[i] is set). */
export function smoothField(g: CellGraph, v: Float64Array, passes: number, mask?: Uint8Array): void {
  const tmp = new Float64Array(g.n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < g.n; i++) {
      if (mask && !mask[i]) {
        tmp[i] = v[i];
        continue;
      }
      let s = v[i];
      let c = 1;
      for (let k = g.nbrOff[i]; k < g.nbrOff[i + 1]; k++) {
        s += v[g.nbr[k]];
        c++;
      }
      tmp[i] = s / c;
    }
    v.set(tmp);
  }
}

/** Least-squares gradient of a per-cell field from neighbour differences. */
export function cellGradient(g: CellGraph, v: ArrayLike<number>): { gx: Float64Array; gy: Float64Array } {
  const gx = new Float64Array(g.n);
  const gy = new Float64Array(g.n);
  for (let i = 0; i < g.n; i++) {
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    let sxv = 0;
    let syv = 0;
    for (let k = g.nbrOff[i]; k < g.nbrOff[i + 1]; k++) {
      const j = g.nbr[k];
      const dx = g.x[j] - g.x[i];
      const dy = g.y[j] - g.y[i];
      const dv = v[j] - v[i];
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
      sxv += dx * dv;
      syv += dy * dv;
    }
    const det = sxx * syy - sxy * sxy;
    if (Math.abs(det) < 1e-12) continue;
    gx[i] = (syy * sxv - sxy * syv) / det;
    gy[i] = (sxx * syv - sxy * sxv) / det;
  }
  return { gx, gy };
}

/** Area-weighted quantile of a per-cell value. */
export function areaQuantile(v: ArrayLike<number>, area: ArrayLike<number>, q: number): number {
  const n = v.length;
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => v[a] - v[b] || a - b);
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.max(area[i], 1e-12);
  const target = total * Math.min(1, Math.max(0, q));
  let acc = 0;
  for (let k = 0; k < n; k++) {
    acc += Math.max(area[idx[k]], 1e-12);
    if (acc >= target) return v[idx[k]];
  }
  return v[idx[n - 1]];
}

export function minMax(v: ArrayLike<number>): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return [lo, hi];
}

export function dist(g: CellGraph, a: number, b: number): number {
  const dx = g.x[a] - g.x[b];
  const dy = g.y[a] - g.y[b];
  return Math.sqrt(dx * dx + dy * dy);
}
