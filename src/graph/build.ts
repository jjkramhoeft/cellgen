import { generatePoints, type PointMethod, type DensityMode } from '../core/sampling';
import type { MetricKind, WeightKind } from '../core/spatial';
import { aspectHeight, MAP_W, num, str, type Params } from '../params/schema';
import { buildHex, buildSquare, buildTri } from './grids';
import { buildImplicit } from './implicit';
import { buildVoronoi, lloydRelax, type CornerMode } from './voronoi';
import type { CellGraph } from './types';

const GRAPH_PREFIXES = ['graph.', 'pts.', 'vor.', 'imp.'];

/** Cache key covering every parameter the cell graph depends on. */
export function graphKey(p: Params, seed: number): string {
  const parts = Object.keys(p)
    .filter((k) => GRAPH_PREFIXES.some((pre) => k.startsWith(pre)))
    .sort()
    .map((k) => `${k}=${p[k]}`);
  return `${seed}|${parts.join('&')}`;
}

export function buildGraph(p: Params, seed: number): CellGraph {
  const W = MAP_W;
  const H = aspectHeight(p);
  const n = num(p, 'graph.cells');
  const type = str(p, 'graph.type');
  if (type === 'square') return buildSquare(n, W, H, str(p, 'graph.squareNbr') === '8');
  if (type === 'hex') return buildHex(n, W, H);
  if (type === 'tri') return buildTri(n, W, H);

  const pts = generatePoints({
    method: str(p, 'pts.method') as PointMethod,
    n,
    W,
    H,
    seed,
    jitter: num(p, 'pts.jitter'),
    poissonK: num(p, 'pts.k'),
    density: str(p, 'pts.density') as DensityMode,
    densityContrast: num(p, 'pts.densityContrast'),
    densityFreq: num(p, 'pts.densityFreq'),
  });
  const lloyd = num(p, 'pts.lloyd');
  if (type === 'voronoi') {
    return buildVoronoi(pts.xs, pts.ys, W, H, str(p, 'vor.corner') as CornerMode, lloyd, pts.lattice);
  }
  const relaxed = lloyd > 0 ? lloydRelax(pts.xs, pts.ys, W, H, lloyd) : pts;
  const g = buildImplicit(
    relaxed.xs,
    relaxed.ys,
    W,
    H,
    {
      metric: str(p, 'imp.metric') as MetricKind,
      p: num(p, 'imp.p'),
      weightKind: str(p, 'imp.weights') as WeightKind,
      weightAmt: num(p, 'imp.weightAmt'),
      weightSource: str(p, 'imp.weightSource') as 'random' | 'noise',
      warpAmp: num(p, 'imp.warpAmp'),
      warpFreq: num(p, 'imp.warpFreq'),
      res: num(p, 'imp.res'),
    },
    seed,
  );
  if (lloyd === 0 && pts.lattice) g.lattice = pts.lattice;
  return g;
}
