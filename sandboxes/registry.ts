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
];
