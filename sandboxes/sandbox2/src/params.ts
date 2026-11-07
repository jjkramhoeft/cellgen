import { and, defaultsOf, is, num, opt, str, type ParamDef, type Params, type Section } from '@shared/params/schema';
import type { FieldParams, Shape, ValueNoise } from './voronoi/field';
import type { WeightMode } from './voronoi/lattice';
import { METRICS, type MetricId } from './voronoi/metrics';

export const MAP_W = 1600;
export const MAP_H = 1000;

const metricOptions = METRICS.map((m) => [m.id, m.label] as [string, string]);
const multiOctave = (p: Params) => num(p, 'frac.octaves') > 1;

/** Generation parameters (left panel). */
export const SECTIONS: Section[] = [
  {
    id: 'metric',
    title: 'Distance function',
    open: true,
    help: 'Which site is "nearest" decides the cell shapes. The unit ball of the metric is drawn below; edit angle and stretch to rotate and squash it.',
    params: [
      { key: 'metric.kind', label: 'Metric', type: 'select', default: 'euclidean', options: opt(...metricOptions) },
      {
        key: 'metric.p',
        label: 'Exponent p',
        type: 'number',
        min: 0.3,
        max: 8,
        step: 0.05,
        default: 0.7,
        help: 'Minkowski exponent. 1 = Manhattan, 2 = Euclidean, large = Chebyshev, below 1 = star-shaped shards.',
        show: is('metric.kind', 'minkowski'),
      },
      {
        key: 'metric.angle',
        label: 'Rotation',
        type: 'number',
        min: 0,
        max: 180,
        step: 1,
        default: 0,
        unit: '°',
        help: 'Rotates the metric frame (most visible on L1, L∞, hex and octagonal).',
      },
      {
        key: 'metric.stretch',
        label: 'Stretch',
        type: 'number',
        min: 0.25,
        max: 4,
        step: 0.01,
        default: 1,
        log: true,
        help: 'Anisotropy. Above 1 stretches cells along the rotated x axis; area is preserved.',
      },
      {
        key: 'metric.detail',
        label: 'Detail metric',
        type: 'select',
        default: 'same',
        options: opt(['same', 'Same as octave 1'], ...metricOptions),
        help: 'Distance function for octaves 2 and up. Mixing metrics gives, say, round continents with blocky coastline detail.',
        show: multiOctave,
      },
    ],
  },
  {
    id: 'cells',
    title: 'Voronoi sites',
    open: true,
    help: 'One site per lattice cell at a hashed offset: the diagram is stateless and infinite, so it stays exact at any zoom.',
    params: [
      {
        key: 'cell.size',
        label: 'Cell size',
        type: 'number',
        min: 25,
        max: 500,
        step: 1,
        default: 130,
        log: true,
        help: 'Lattice spacing of octave 1, in world units (the map is 1600 × 1000).',
      },
      {
        key: 'cell.jitter',
        label: 'Jitter',
        type: 'number',
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
        help: 'How far a site may move from its lattice cell centre. 0 gives a perfect grid of squares.',
      },
      {
        key: 'cell.weight',
        label: 'Weights',
        type: 'select',
        default: 'none',
        options: opt(['none', 'None'], ['additive', 'Additive (d − w)'], ['multiplicative', 'Multiplicative (d / w)']),
        help: 'Weighted Voronoi: per-site random weights make cells of different sizes. Squared Euclidean + additive = power diagram.',
      },
      {
        key: 'cell.weightAmt',
        label: 'Weight spread',
        type: 'number',
        min: 0,
        max: 1.5,
        step: 0.01,
        default: 0.5,
        show: (p) => str(p, 'cell.weight') !== 'none',
      },
    ],
  },
  {
    id: 'fractal',
    title: 'Fractal octaves',
    open: true,
    help: 'Layer 1–4 Voronoi diagrams, each finer by the lacunarity. Coarse cells shape the continents and finer ones roughen the coast.',
    params: [
      { key: 'frac.octaves', label: 'Octaves', type: 'int', min: 1, max: 4, default: 3 },
      {
        key: 'frac.lacunarity',
        label: 'Lacunarity',
        type: 'number',
        min: 1.5,
        max: 6,
        step: 0.05,
        default: 3,
        help: 'Cell-size ratio between consecutive octaves.',
        show: multiOctave,
      },
      {
        key: 'frac.gain',
        label: 'Gain',
        type: 'number',
        min: 0.1,
        max: 1,
        step: 0.01,
        default: 0.55,
        help: 'Weight of each octave relative to the previous one. Higher = rougher coastline.',
        show: multiOctave,
      },
      {
        key: 'frac.warp',
        label: 'Border warp',
        type: 'number',
        min: 0,
        max: 1.2,
        step: 0.01,
        default: 0,
        help: 'Domain-warps the query point, bending straight Voronoi edges into organic curves (per octave, in cell units).',
      },
      {
        key: 'frac.warpFreq',
        label: 'Warp frequency',
        type: 'number',
        min: 0.1,
        max: 3,
        step: 0.01,
        default: 0.7,
        show: (p) => num(p, 'frac.warp') > 0,
      },
    ],
  },
  {
    id: 'land',
    title: 'Land & water',
    open: true,
    help: 'Each cell gets a value; the threshold is set so that exactly the chosen share of the map is land.',
    params: [
      { key: 'land.pct', label: 'Land', type: 'int', min: 0, max: 100, default: 40, unit: '%', help: 'Target land/water ratio.' },
      {
        key: 'land.noise',
        label: 'Value noise',
        type: 'select',
        default: 'fbm',
        options: opt(['fbm', 'fBm (rolling)'], ['ridged', 'Ridged (chains)']),
        help: 'Smooth noise sampled at every cell site. Neighbouring cells get similar values, so land clusters into continents.',
      },
      {
        key: 'land.scale',
        label: 'Feature size',
        type: 'number',
        min: 100,
        max: 4000,
        step: 1,
        default: 700,
        log: true,
        help: 'Size of the value noise features in world units.',
      },
      {
        key: 'land.rough',
        label: 'Cell randomness',
        type: 'number',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.3,
        help: 'Share of a purely random per-cell value. 0 = cells quantise the smooth noise; 1 = salt-and-pepper.',
      },
      {
        key: 'land.shape',
        label: 'Shape',
        type: 'select',
        default: 'island',
        options: opt(
          ['none', 'None (open map)'],
          ['island', 'Island'],
          ['twin', 'Twin islands'],
          ['atoll', 'Atoll / ring'],
          ['coast', 'West coast'],
          ['oceans', 'Random oceans'],
        ),
        help: 'Random oceans: ⌈water % / 10⌉ random cells seed oceans (≤ 10 % water → 1, 10–20 % → 2, …), and neighbouring cells flood until the water share is met. Value noise and cell randomness shape the flood fronts.',
      },
      {
        key: 'land.shapeAmt',
        label: 'Shape strength',
        type: 'number',
        min: 0,
        max: 2,
        step: 0.01,
        default: 0.8,
        show: (p) => str(p, 'land.shape') !== 'none' && str(p, 'land.shape') !== 'oceans',
      },
    ],
  },
];

export const VIEW_MODES = [
  ['terrain', 'Land & water (relief)'],
  ['flat', 'Land & water (flat)'],
  ['value', 'Cell value v'],
  ['cellid', 'Cell IDs'],
  ['octaves', 'Octave mosaic'],
  ['f1', 'Worley F1'],
  ['f2', 'Worley F2'],
  ['f2f1', 'F2 − F1 (borders)'],
  ['ratio', 'F1 / F2'],
  ['worley', 'Fractal F1 (Σ octaves)'],
] as [string, string][];

/** Display parameters (right panel): changing them re-renders but never regenerates. */
export const VIEW_SECTION: Section = {
  id: 'view',
  title: 'Display',
  open: true,
  params: [
    { key: 'view.color', label: 'Colour by', type: 'select', default: 'terrain', options: opt(...VIEW_MODES), view: true },
    {
      key: 'view.oct',
      label: 'Octave',
      type: 'int',
      min: 1,
      max: 4,
      default: 1,
      view: true,
      help: 'Which octave the cell-ID, F1/F2, bevel and probe views use.',
      show: and(multiOctave),
    },
    {
      key: 'view.edges',
      label: 'Cell edges',
      type: 'select',
      default: 'coarse',
      options: opt(['none', 'None'], ['coarse', 'Octave 1'], ['all', 'All octaves'], ['selected', 'Selected octave']),
      view: true,
    },
    { key: 'view.coast', label: 'Coastline', type: 'bool', default: true, view: true },
    {
      key: 'view.sites',
      label: 'Sites',
      type: 'select',
      default: 'coarse',
      options: opt(['none', 'None'], ['coarse', 'Octave 1'], ['all', 'All octaves']),
      view: true,
    },
    { key: 'view.lattice', label: 'Lattice grid', type: 'bool', default: false, view: true, help: 'The lattice cells that each hold one site.' },
    {
      key: 'view.probe',
      label: 'Distance probe',
      type: 'bool',
      default: true,
      view: true,
      help: 'Under the cursor: the metric balls of radius F1 and F2, which touch the nearest and second-nearest sites.',
    },
    { key: 'view.bevel', label: 'Cell bevel', type: 'number', min: 0, max: 1, step: 0.01, default: 0.3, view: true, help: 'Shades each cell by F1/F2.' },
    { key: 'view.dim', label: 'Dim outside map', type: 'bool', default: true, view: true, help: 'The field is infinite; the map (and the land ratio) is the 1600 × 1000 rectangle.' },
  ],
};

export const ALL_DEFS: ParamDef[] = [...SECTIONS.flatMap((s) => s.params), ...VIEW_SECTION.params];
export const GEN_KEYS = new Set(SECTIONS.flatMap((s) => s.params.map((d) => d.key)));

export function defaults(): Params {
  return defaultsOf(ALL_DEFS);
}

export function toFieldParams(p: Params, seed: number): FieldParams {
  const metric = {
    id: str(p, 'metric.kind') as MetricId,
    p: num(p, 'metric.p'),
    angle: num(p, 'metric.angle'),
    stretch: num(p, 'metric.stretch'),
  };
  const detail = str(p, 'metric.detail');
  return {
    seed,
    W: MAP_W,
    H: MAP_H,
    octaves: num(p, 'frac.octaves'),
    cellSize: num(p, 'cell.size'),
    lacunarity: num(p, 'frac.lacunarity'),
    gain: num(p, 'frac.gain'),
    jitter: num(p, 'cell.jitter'),
    metric,
    detailMetric: detail === 'same' ? null : { ...metric, id: detail as MetricId },
    weightMode: str(p, 'cell.weight') as WeightMode,
    weightAmt: num(p, 'cell.weightAmt'),
    warpAmp: num(p, 'frac.warp'),
    warpFreq: num(p, 'frac.warpFreq'),
    noise: str(p, 'land.noise') as ValueNoise,
    featureScale: num(p, 'land.scale'),
    roughness: num(p, 'land.rough'),
    shape: str(p, 'land.shape') as Shape,
    shapeAmt: num(p, 'land.shapeAmt'),
    land: num(p, 'land.pct') / 100,
  };
}

