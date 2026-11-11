#!/usr/bin/env node
/**
 * Regenerate docs/network-default-structure.json: the travel network (city and town locations
 * as nodes; roads, river routes and sea lanes as links) of sandbox4 at its default seed and
 * settings, for the four central regions of docs/map-default-structure.json and the twelve
 * regions around them.
 *
 *   npm run export-network
 *
 * The export itself is scripts/export-network.ts. It is loaded through Vite (the project's
 * vite.config.ts), so it runs the sandbox's TypeScript sources directly. The network itself
 * takes a few seconds; most of the time goes to the terrain of the 4 × 4 block, which gives
 * the biomes their exact patch heights (as in docs/map-default-structure.json).
 */
import { writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'docs', 'network-default-structure.json');

const server = await createServer({
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { exportNetwork } = await server.ssrLoadModule('/scripts/export-network.ts');
  const t0 = Date.now();
  const n = exportNetwork();
  writeFileSync(out, n.text);
  const m = n.byMode;
  console.log(`${relative(root, out)}: ${n.regions} regions, ${n.nodes} nodes (${n.cities} cities), ${n.links} links (${m.road} road, ${m.river} river, ${m.sea} sea) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`${n.components} connected component${n.components === 1 ? '' : 's'}, ${n.isolated} node${n.isolated === 1 ? '' : 's'} without a link; ${n.outside} link${n.outside === 1 ? '' : 's'} leaving the block left out`);
  if (n.estimated) console.warn(`warning: ${n.estimated} land patches have a biome from an estimated height (no terrain value)`);
} finally {
  await server.close();
}
