/** Sandbox 2 presets (the Presets menu). */
import type { Params } from '@shared/params/schema';

export interface Preset {
  id: string;
  label: string;
  seed?: string;
  params: Params;
}

/** Each preset is applied on top of the defaults. */
export const PRESETS: Preset[] = [
  { id: 'default', label: 'Fractal island (default)', params: {} },
  {
    id: 'single',
    label: 'Plain Voronoi, one octave',
    params: { 'frac.octaves': 1, 'cell.size': 70, 'land.rough': 0.15, 'view.edges': 'coarse' },
  },
  {
    id: 'archipelago',
    label: 'Archipelago',
    params: { 'land.pct': 22, 'land.rough': 0.55, 'land.scale': 420, 'land.shape': 'none', 'frac.gain': 0.7, 'cell.size': 110 },
  },
  {
    id: 'continents',
    label: 'Continents, warped borders',
    params: { 'land.pct': 45, 'land.shape': 'none', 'land.scale': 1400, 'frac.warp': 0.35, 'frac.octaves': 4, 'frac.lacunarity': 2.6, 'view.edges': 'none' },
  },
  {
    id: 'manhattan',
    label: 'Manhattan coastlines',
    params: { 'metric.kind': 'manhattan', 'land.pct': 38, 'view.color': 'flat', 'view.edges': 'all' },
  },
  {
    id: 'crystal',
    label: 'Chebyshev crystals (45°)',
    params: { 'metric.kind': 'chebyshev', 'metric.angle': 45, 'land.shape': 'atoll', 'land.shapeAmt': 1.1, 'land.pct': 30 },
  },
  {
    id: 'shards',
    label: 'Star shards (Lp, p = 0.6)',
    params: { 'metric.kind': 'minkowski', 'metric.p': 0.6, 'land.pct': 35, 'view.color': 'cellid', 'view.edges': 'all' },
  },
  {
    id: 'hex',
    label: 'Hex mosaic, low jitter',
    params: { 'metric.kind': 'hexagonal', 'cell.jitter': 0.35, 'frac.octaves': 2, 'view.edges': 'all', 'view.color': 'octaves' },
  },
  {
    id: 'power',
    label: 'Power diagram',
    params: { 'metric.kind': 'squared', 'cell.weight': 'additive', 'cell.weightAmt': 0.6, 'frac.octaves': 1, 'cell.size': 90, 'view.color': 'cellid' },
  },
  {
    id: 'dunes',
    label: 'Triangular dunes (stretched)',
    params: { 'metric.kind': 'triangular', 'metric.angle': 90, 'metric.stretch': 2.2, 'land.shape': 'coast', 'land.pct': 50 },
  },
  {
    id: 'mixed',
    label: 'Round continents, blocky coast',
    params: { 'metric.kind': 'euclidean', 'metric.detail': 'chebyshev', 'frac.gain': 0.75, 'land.rough': 0.45 },
  },
  {
    id: 'cracked',
    label: 'Cracked earth (F2 − F1)',
    params: { 'view.color': 'f2f1', 'frac.warp': 0.25, 'view.edges': 'none', 'view.coast': false, 'view.sites': 'none', 'view.probe': false },
  },
  {
    id: 'worley',
    label: 'Fractal Worley F1',
    params: { 'view.color': 'worley', 'frac.octaves': 4, 'frac.lacunarity': 2.2, 'view.edges': 'none', 'view.coast': false, 'view.sites': 'none' },
  },
];
