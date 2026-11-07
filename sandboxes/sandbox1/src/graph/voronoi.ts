/**
 * Voronoi / dual mesh from Delaunator (research §2.3), with:
 *  - ghost points one spacing outside the map so every real cell is closed,
 *  - corners at circumcenters (true Voronoi) or centroids (Red Blob's dual mesh),
 *  - label-preserving clip to the map rectangle,
 *  - Lloyd relaxation (move sites to cell centroids, repeat).
 */
import Delaunator from 'delaunator';
import { assembleExplicit } from './assemble';
import { clipToRect, polyCentroid, type LPoly } from './polygon';
import type { CellGraph } from './types';

export type CornerMode = 'circumcenter' | 'centroid';

interface Mesh {
  polys: LPoly[];
  triangles: number;
}

function buildMesh(xs: Float64Array, ys: Float64Array, W: number, H: number, corner: CornerMode): Mesh {
  const n = xs.length;
  // Ghost ring far outside the map (margin = max(W, H)): their cells — Voronoi or
  // centroid-dual — can never reach into the map, so real cells clipped to the
  // rectangle tile it exactly.
  const gx: number[] = [];
  const gy: number[] = [];
  const M = Math.max(W, H);
  const per = 12;
  const x0 = -M;
  const x1 = W + M;
  const y0 = -M;
  const y1 = H + M;
  for (let k = 0; k < per; k++) {
    const t = k / per;
    gx.push(x0 + (x1 - x0) * t, x1, x1 - (x1 - x0) * t, x0);
    gy.push(y0, y0 + (y1 - y0) * t, y1, y1 - (y1 - y0) * t);
  }
  const total = n + gx.length;
  const coords = new Float64Array(total * 2);
  for (let i = 0; i < n; i++) {
    coords[2 * i] = xs[i];
    coords[2 * i + 1] = ys[i];
  }
  for (let k = 0; k < gx.length; k++) {
    coords[2 * (n + k)] = gx[k];
    coords[2 * (n + k) + 1] = gy[k];
  }
  const d = new Delaunator(coords);
  const { triangles, halfedges } = d;
  const nt = triangles.length / 3;
  // triangle corners
  const cxs = new Float64Array(nt);
  const cys = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = triangles[3 * t];
    const b = triangles[3 * t + 1];
    const c = triangles[3 * t + 2];
    const ax = coords[2 * a];
    const ay = coords[2 * a + 1];
    const bx = coords[2 * b];
    const by = coords[2 * b + 1];
    const cx = coords[2 * c];
    const cy = coords[2 * c + 1];
    if (corner === 'centroid') {
      cxs[t] = (ax + bx + cx) / 3;
      cys[t] = (ay + by + cy) / 3;
    } else {
      const dx = bx - ax;
      const dy = by - ay;
      const ex = cx - ax;
      const ey = cy - ay;
      const bl = dx * dx + dy * dy;
      const cl = ex * ex + ey * ey;
      const dd = 2 * (dx * ey - dy * ex);
      if (Math.abs(dd) < 1e-12) {
        cxs[t] = (ax + bx + cx) / 3;
        cys[t] = (ay + by + cy) / 3;
      } else {
        cxs[t] = ax + (ey * bl - dy * cl) / dd;
        cys[t] = ay + (dx * cl - ex * bl) / dd;
      }
    }
  }
  // incoming half-edge per point (as in d3-delaunay)
  const inedge = new Int32Array(total).fill(-1);
  for (let e = 0; e < triangles.length; e++) {
    const p = triangles[e % 3 === 2 ? e - 2 : e + 1];
    if (halfedges[e] === -1 || inedge[p] === -1) inedge[p] = e;
  }
  const polys: LPoly[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const e0 = inedge[i];
    if (e0 === -1) {
      polys[i] = { xs: [], ys: [], lbl: [] };
      continue;
    }
    const pxs: number[] = [];
    const pys: number[] = [];
    const lbl: number[] = [];
    let e = e0;
    let guard = 0;
    do {
      const t = Math.floor(e / 3);
      pxs.push(cxs[t]);
      pys.push(cys[t]);
      const out = e % 3 === 2 ? e - 2 : e + 1; // outgoing from i
      const q = triangles[out % 3 === 2 ? out - 2 : out + 1];
      lbl.push(q < n ? q : -1);
      e = halfedges[out];
    } while (e !== e0 && e !== -1 && ++guard < 1000);
    polys[i] = clipToRect({ xs: pxs, ys: pys, lbl }, W, H);
  }
  return { polys, triangles: nt };
}

export function buildVoronoi(
  xs0: Float64Array,
  ys0: Float64Array,
  W: number,
  H: number,
  corner: CornerMode,
  lloyd: number,
  lattice?: CellGraph['lattice'],
): CellGraph {
  const xs = Float64Array.from(xs0);
  const ys = Float64Array.from(ys0);
  let mesh = buildMesh(xs, ys, W, H, corner);
  const eps = 1e-6;
  for (let it = 0; it < lloyd; it++) {
    for (let i = 0; i < xs.length; i++) {
      const p = mesh.polys[i];
      if (p.xs.length < 3) continue;
      const [cx, cy] = polyCentroid(p.xs, p.ys);
      xs[i] = Math.min(W - eps, Math.max(eps, cx));
      ys[i] = Math.min(H - eps, Math.max(eps, cy));
    }
    mesh = buildMesh(xs, ys, W, H, corner);
  }
  const g = assembleExplicit('voronoi', W, H, mesh.polys, xs, ys, null, null, {
    'Delaunay triangles': mesh.triangles,
    corners: corner,
    'Lloyd iterations': lloyd,
  });
  if (lattice && lloyd === 0) g.lattice = lattice;
  return g;
}

/** Lloyd-relax a point set (used by implicit cells, which have no polygons of their own). */
export function lloydRelax(xs0: Float64Array, ys0: Float64Array, W: number, H: number, iters: number) {
  const xs = Float64Array.from(xs0);
  const ys = Float64Array.from(ys0);
  for (let it = 0; it < iters; it++) {
    const mesh = buildMesh(xs, ys, W, H, 'circumcenter');
    for (let i = 0; i < xs.length; i++) {
      const p = mesh.polys[i];
      if (p.xs.length < 3) continue;
      const [cx, cy] = polyCentroid(p.xs, p.ys);
      xs[i] = Math.min(W - 1e-6, Math.max(1e-6, cx));
      ys[i] = Math.min(H - 1e-6, Math.max(1e-6, cy));
    }
  }
  return { xs, ys };
}
