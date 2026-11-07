/**
 * The list of sandboxes shown on the landing page. Each `ready` entry must have a
 * page at `sandboxes/<id>/index.html` (checked by sandboxes/registry.test.ts).
 * `npm run new-sandbox <id> "<title>"` scaffolds a folder and adds an entry here.
 */
export interface SandboxInfo {
  id: string;
  title: string;
  summary: string;
  status: 'ready' | 'planned';
  tags: string[];
}

export const SANDBOXES: SandboxInfo[] = [
  {
    id: 'sandbox1',
    title: 'Sandbox 1 · Cell generation',
    summary:
      'Generate cells (Voronoi, grids, distance-function cells), configure sampling, noise, hydrology, space colonization and cellular automata, then inspect the cells with zoom, pan, statistics and A/B compare.',
    status: 'ready',
    tags: ['Voronoi', 'Worley', 'distance functions', 'space colonization', 'noise networks'],
  },
  {
    id: 'sandbox2',
    title: 'Sandbox 2 · Voronoi cells',
    summary:
      'Stateless lattice Voronoi under eight distance functions (L2, L2², L1, L∞, Lp, octagonal, hexagonal, triangular), layered into 1–4 fractal octaves, with a land/water split at an exact chosen ratio. Deep zoom and pan, a distance probe, a metric gallery and coastline statistics.',
    status: 'ready',
    tags: ['Voronoi', 'distance functions', 'fractal octaves', 'land/water', 'Worley'],
  },
  {
    id: 'sandbox3',
    title: 'Sandbox 3 · Map hierarchy',
    summary:
      'An unbounded, deterministic base map in metres from three nested Voronoi levels: 128 km regions, warped 32 km biomes and 8 km subbiomes. Regions place ocean seeds that link and grow into oceans; cells randomly merge with their nearest neighbour; space-colonization rivers grow inland from the ocean biomes, with width from the attractors they reach. Ocean-genesis and merge views, arrows, inspector, ruler with travel times.',
    status: 'ready',
    tags: ['Voronoi', 'hierarchy', 'oceans', 'cell merging', 'space colonization', 'infinite world'],
  },
  {
    id: 'sandbox4',
    title: 'Sandbox 4 · Terrain',
    summary:
      'Sandbox 3’s map with a height map fitted to its rivers and biomes: river beds rise upstream from the stream-power law, hillslopes are a geodesic distance from rivers and coast with slopes per land type, ridges divide regions and river systems, then detail noise, river burning and Priority-Flood filling so everything drains to the sea. Hillshaded height views and a 3D landscape.',
    status: 'ready',
    tags: ['height map', 'stream power', 'fast marching', 'Priority-Flood', 'WebGL', '3D terrain'],
  },
];
