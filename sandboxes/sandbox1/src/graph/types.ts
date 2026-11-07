import type { SiteIndex, MetricSpec, WeightKind } from '@shared/core/spatial';

export type GraphKind = 'square' | 'hex' | 'tri' | 'voronoi' | 'implicit';

/**
 * Explicit cell polygons, flat-array style (as recommended for Delaunator meshes).
 * Cell i owns vertices off[i]..off[i+1]-1; lbl[k] is the neighbour across the edge
 * from vertex k to the next vertex of the same cell (−1 = map border).
 */
export interface Polygons {
  off: Uint32Array;
  xy: Float64Array;
  lbl: Int32Array;
}

export interface ImplicitSpec {
  metric: MetricSpec;
  weightKind: WeightKind;
  weights: Float64Array | null;
  wMax: number;
  warpAmp: number;
  warpFreq: number;
  warpSeed: number;
}

/**
 * The CellGraph abstraction from the research (§9.1): every stage is written against
 * this, so it runs on square/hex/triangle grids, Voronoi meshes and implicit cells.
 */
export interface CellGraph {
  kind: GraphKind;
  n: number;
  W: number;
  H: number;
  /** representative position (polygon centroid) */
  x: Float64Array;
  y: Float64Array;
  /** generating site (equals x/y for regular grids) */
  sx: Float64Array;
  sy: Float64Array;
  area: Float64Array;
  perimeter: Float64Array;
  /** CSR adjacency */
  nbrOff: Uint32Array;
  nbr: Int32Array;
  /** 1 if the cell touches the map border */
  border: Uint8Array;
  /** mean spacing √(W·H/n) */
  spacing: number;
  poly: Polygons | null;
  /** spatial index over the sites */
  sites: SiteIndex;
  cellAt(x: number, y: number): number;
  lattice?: { kind: 'square' | 'hex'; dx: number; dy: number; cols: number; rows: number };
  implicit?: ImplicitSpec;
  /** for implicit graphs: cell id per analysis-raster pixel */
  raster?: { cols: number; rows: number; ids: Int32Array };
  /** Delaunay triangle count etc. — shown in stats */
  info: Record<string, string | number>;
}

export function degree(g: CellGraph, i: number): number {
  return g.nbrOff[i + 1] - g.nbrOff[i];
}

/** Build CSR adjacency from per-cell neighbour lists, made symmetric and sorted. */
export function buildCSR(n: number, lists: number[][]): { nbrOff: Uint32Array; nbr: Int32Array } {
  const sets: Set<number>[] = new Array(n);
  for (let i = 0; i < n; i++) sets[i] = new Set();
  for (let i = 0; i < n; i++) {
    for (const j of lists[i]) {
      if (j < 0 || j >= n || j === i) continue;
      sets[i].add(j);
      sets[j].add(i);
    }
  }
  const nbrOff = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) nbrOff[i + 1] = nbrOff[i] + sets[i].size;
  const nbr = new Int32Array(nbrOff[n]);
  for (let i = 0; i < n; i++) {
    const arr = Array.from(sets[i]).sort((a, b) => a - b);
    nbr.set(arr, nbrOff[i]);
  }
  return { nbrOff, nbr };
}
