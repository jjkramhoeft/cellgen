/**
 * Lines and networks from noise (research gaps §3).
 *
 * Each field n_k contributes its zero isoline. The gradient-normalised distance
 * estimate de = |n| / |∇n| turns a threshold into a constant half-width w in world
 * units (Quilez, "distance estimation"). Union of fields → network with X-junctions;
 * intersection in 2D → isolated dots where isolines cross (1 + 1 − 2 = 0 dimensions);
 * an optional gate field cuts lines into segments with dead ends.
 */
import { fbm, warpVec } from '../core/noise';
import { STAGE } from '../core/hash';
import type { CellGraph } from '../graph/types';
import { bool, num, str, type Params } from '../params/schema';
import { WATER_LAND } from './hydrology';

export interface PathFn {
  /** returns the combined distance estimate in world units (≤ w means "on a path"), or Infinity when gated */
  de(x: number, y: number): number;
  w: number;
}

export function makePathFn(p: Params, seed: number, W: number, spacing: number): PathFn {
  const k = num(p, 'paths.fields');
  const f = num(p, 'paths.freq') / W;
  const fp = { octaves: num(p, 'paths.octaves'), lacunarity: 2, gain: 0.5 };
  const normalize = bool(p, 'paths.normalize');
  const inter = str(p, 'paths.combine') === 'intersection';
  const gate = bool(p, 'paths.gate');
  const warp = num(p, 'paths.warp');
  const w = num(p, 'paths.width') * spacing;
  const seeds = [0, 1, 2].map((i) => (seed ^ Math.imul(STAGE.paths + i, 0x9e3779b9)) | 0);
  const gateSeed = (seed ^ Math.imul(STAGE.paths + 9, 0x9e3779b9)) | 0;
  const v = new Float64Array(2);
  const h = 0.05 / f > 0 ? Math.min(spacing * 0.25, 0.02 / f) : 1; // central-difference step
  // field value at world position, including optional domain warp (so |∇| is of the warped function)
  const field = (s: number, x: number, y: number) => {
    let u = x * f;
    let t = y * f;
    if (warp > 0) {
      warpVec(s ^ 0x7f4a7c15, u * 0.5, t * 0.5, fp, v);
      u += warp * v[0];
      t += warp * v[1];
    }
    return fbm(s, u, t, fp);
  };
  // fixed scale for the un-normalised variant: typical |∇n| ≈ 2.5·f
  const typicalGrad = 2.5 * f;
  const deK = (s: number, x: number, y: number): number => {
    const n0 = field(s, x, y);
    if (!normalize) return Math.abs(n0) / typicalGrad;
    const gx = (field(s, x + h, y) - field(s, x - h, y)) / (2 * h);
    const gy = (field(s, x, y + h) - field(s, x, y - h)) / (2 * h);
    const gl = Math.sqrt(gx * gx + gy * gy);
    return Math.abs(n0) / Math.max(gl, typicalGrad * 0.05);
  };
  return {
    w,
    de(x, y) {
      if (gate && fbm(gateSeed, x * f * 0.8, y * f * 0.8, { octaves: 2, lacunarity: 2, gain: 0.5 }) < 0) return Infinity;
      if (inter) {
        if (k < 2) return deK(seeds[0], x, y);
        // gradient-normalised L2 of the per-field estimates (orthogonal-gradient approximation)
        let s2 = 0;
        for (let i = 0; i < k; i++) {
          const d = deK(seeds[i], x, y);
          s2 += d * d;
        }
        return Math.sqrt(s2);
      }
      let best = Infinity;
      for (let i = 0; i < k; i++) best = Math.min(best, deK(seeds[i], x, y));
      return best;
    },
  };
}

/** Per-cell network membership: 0 none, 1 on a path. */
export function pathCells(g: CellGraph, p: Params, seed: number, water: Uint8Array): { cells: Uint8Array; count: number } {
  const fn = makePathFn(p, seed, g.W, g.spacing);
  const landOnly = bool(p, 'paths.landOnly');
  const cells = new Uint8Array(g.n);
  let count = 0;
  for (let i = 0; i < g.n; i++) {
    if (landOnly && water[i] !== WATER_LAND) continue;
    if (fn.de(g.x[i], g.y[i]) <= fn.w) {
      cells[i] = 1;
      count++;
    }
  }
  return { cells, count };
}
