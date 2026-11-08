/** Sandbox 1 presets (the Presets menu). */
import type { Params } from './schema';

export interface Preset {
  id: string;
  name: string;
  description: string;
  params: Params;
}

/** Curated starting points; each applies on top of the defaults. */
export const PRESETS: Preset[] = [
  {
    id: 'island',
    name: 'Voronoi island',
    description: 'Poisson-disc Voronoi, fBm + circle mask, wind-driven rain, rivers.',
    params: {},
  },
  {
    id: 'relaxed',
    name: 'Lloyd-relaxed mesh',
    description: 'Uniform random sites relaxed twice with centroid corners — compare regularity in the stats.',
    params: { 'pts.method': 'uniform', 'pts.lloyd': 2, 'vor.corner': 'centroid', 'view.field': 'compactness' },
  },
  {
    id: 'hexmap',
    name: 'Hex strategy map',
    description: 'Hex grid with domain-warped continents and biomes.',
    params: { 'graph.type': 'hex', 'graph.cells': 2500, 'elev.method': 'warp', 'elev.mask': 'box', 'elev.land': 0.5 },
  },
  {
    id: 'manhattan',
    name: 'Manhattan cells',
    description: 'Distance-function cells under the L1 metric: Worley’s “rigidly rectangular” regions.',
    params: { 'graph.type': 'implicit', 'graph.cells': 900, 'imp.metric': 'L1', 'view.field': 'cellId', 'view.hillshade': false, 'view.rivers': false, 'view.coast': false },
  },
  {
    id: 'mud',
    name: 'Cracked mud',
    description: 'Warped, multiplicatively weighted cells — organic, uneven polygons.',
    params: {
      'graph.type': 'implicit',
      'graph.cells': 700,
      'imp.weights': 'multiplicative',
      'imp.weightAmt': 0.35,
      'imp.warpAmp': 0.45,
      'imp.warpFreq': 0.3,
      'view.field': 'cellId',
      'view.hillshade': false,
      'view.rivers': false,
      'view.coast': false,
    },
  },
  {
    id: 'worley',
    name: 'Worley border field',
    description: 'Quilez’s exact border distance vs F2 − F1 — constant-width borders.',
    params: { 'graph.type': 'voronoi', 'graph.cells': 300, 'view.field': 'worleyBorder', 'view.edges': false, 'view.coast': false, 'view.rivers': false },
  },
  {
    id: 'density',
    name: 'Variable density',
    description: 'Variable-radius Poisson disc driven by noise: small cells where it matters.',
    params: { 'pts.density': 'noise', 'pts.densityContrast': 0.9, 'graph.cells': 5000, 'view.field': 'area' },
  },
  {
    id: 'plates',
    name: 'Tectonic plates',
    description: 'Plate flood-fill with convergent ranges and rifts.',
    params: { 'elev.method': 'plates', 'elev.mask': 'none', 'graph.cells': 8000, 'elev.land': 0.38 },
  },
  {
    id: 'rivers-sca',
    name: 'Space-colonization rivers',
    description: 'River networks grown upstream from the coast, carving valleys that hydrology then follows.',
    params: {
      'graph.cells': 8000,
      'sca.enabled': true,
      'sca.carve': true,
      'hydro.threshold': 0.01,
      'view.rivers': false,
      'elev.mask': 'blobs',
      'elev.land': 0.5,
    },
  },
  {
    id: 'roads',
    name: 'Noise road network',
    description: 'Union of gradient-normalised zero isolines from two noise fields.',
    params: { 'paths.enabled': true, 'graph.cells': 10000, 'view.pathExact': true, 'elev.land': 0.6 },
  },
  {
    id: 'caves',
    name: 'CA caves',
    description: 'RogueBasin 4-5 rule with the 2-ring hall fix, on a square grid.',
    params: {
      'graph.type': 'square',
      'graph.squareNbr': '8',
      'graph.cells': 9000,
      'ca.enabled': true,
      'ca.r2': 4,
      'ca.iterations': 3,
      'ca.fill': 0.4,
      'view.field': 'cave',
      'view.hillshade': false,
      'view.edges': false,
      'view.coast': false,
      'view.rivers': false,
    },
  },
  {
    id: 'organic-caves',
    name: 'Caves on Voronoi',
    description: 'The same threshold rule on an irregular graph.',
    params: { 'ca.enabled': true, 'graph.cells': 6000, 'view.field': 'cave', 'view.hillshade': false, 'view.coast': false, 'view.rivers': false },
  },
  {
    id: 'blobs',
    name: 'FMG template',
    description: 'Azgaar-style hills, pits and ranges on a jittered lattice.',
    params: { 'elev.method': 'blobs', 'pts.method': 'jitter-square', 'elev.mask': 'none', 'elev.land': 0.35, 'graph.cells': 6000 },
  },
];
