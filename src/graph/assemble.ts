import { SiteIndex } from '../core/spatial';
import { buildCSR, type CellGraph, type GraphKind } from './types';
import { polyCentroid, polyPerimeter, dedupe, type LPoly } from './polygon';

/** Turn per-cell labelled polygons into a CellGraph with flat arrays. */
export function assembleExplicit(
  kind: GraphKind,
  W: number,
  H: number,
  polys: LPoly[],
  sx: Float64Array,
  sy: Float64Array,
  cellAt: ((g: CellGraph) => (x: number, y: number) => number) | null,
  extraNbrs: number[][] | null,
  info: Record<string, string | number>,
): CellGraph {
  const n = polys.length;
  const spacing = Math.sqrt((W * H) / Math.max(1, n));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const area = new Float64Array(n);
  const perimeter = new Float64Array(n);
  const border = new Uint8Array(n);
  const off = new Uint32Array(n + 1);
  const cleaned: LPoly[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = dedupe(polys[i], spacing * 1e-7);
    cleaned[i] = p;
    off[i + 1] = off[i] + p.xs.length;
  }
  const xy = new Float64Array(off[n] * 2);
  const lbl = new Int32Array(off[n]);
  const lists: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = cleaned[i];
    const o = off[i];
    const list: number[] = [];
    for (let k = 0; k < p.xs.length; k++) {
      xy[2 * (o + k)] = p.xs[k];
      xy[2 * (o + k) + 1] = p.ys[k];
      lbl[o + k] = p.lbl[k];
      if (p.lbl[k] >= 0) list.push(p.lbl[k]);
      else border[i] = 1;
    }
    if (extraNbrs) for (const j of extraNbrs[i]) list.push(j);
    lists[i] = list;
    if (p.xs.length >= 3) {
      const [cx, cy, a] = polyCentroid(p.xs, p.ys);
      x[i] = cx;
      y[i] = cy;
      area[i] = a;
      perimeter[i] = polyPerimeter(p.xs, p.ys);
    } else {
      x[i] = sx[i];
      y[i] = sy[i];
      border[i] = 1;
    }
  }
  const { nbrOff, nbr } = buildCSR(n, lists);
  const sites = new SiteIndex(sx, sy, W, H, spacing);
  const g: CellGraph = {
    kind,
    n,
    W,
    H,
    x,
    y,
    sx,
    sy,
    area,
    perimeter,
    nbrOff,
    nbr,
    border,
    spacing,
    poly: { off, xy, lbl },
    sites,
    cellAt: (px, py) => sites.nearest(px, py),
    info,
  };
  if (cellAt) g.cellAt = cellAt(g);
  return g;
}
