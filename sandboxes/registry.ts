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
    id: 'sandbox4',
    title: 'Sandbox 4 · Terrain',
    summary:
      'An unbounded, deterministic base map from three nested Voronoi levels (128 km regions, warped 32 km elevation zones, 8 km subbiomes) with oceans, cell merges and space-colonization rivers, plus a height map fitted to its rivers and elevation zones: river beds rise upstream from the stream-power law, hillslopes are a geodesic distance from rivers and coast with slopes per elevation zone type (ocean, flat, lowland, hills, mountains), ridges divide regions and river systems, then detail noise, river burning and Priority-Flood filling so everything drains to the sea. Hillshaded height views and a 3D landscape.',
    status: 'ready',
    tags: ['height map', 'stream power', 'fast marching', 'Priority-Flood', 'WebGL', '3D terrain'],
  },
];
