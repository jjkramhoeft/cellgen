#!/usr/bin/env node
/**
 * Regenerate docs/map-default-structure.json: the map structure (Region → ElevationZone →
 * BiomePatch) of sandbox4 at its default seed and settings, for the four central regions.
 *
 *   npm run export-map
 *
 * The export itself is scripts/export-map.ts. It is loaded through Vite (the project's
 * vite.config.ts), so it runs the sandbox's TypeScript sources directly. Takes about 20 s,
 * mostly the terrain of the four regions.
 */
import { writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'docs', 'map-default-structure.json');

const server = await createServer({
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { exportMap } = await server.ssrLoadModule('/scripts/export-map.ts');
  const t0 = Date.now();
  const m = exportMap();
  writeFileSync(out, m.text);
  console.log(`${relative(root, out)}: ${m.regions} regions, ${m.zones} elevation zones, ${m.patches} biome patches (${m.land} land), ${m.resources} resources (${m.bare} patches with none) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (m.estimated) console.warn(`warning: ${m.estimated} land patches have an estimated height (no terrain value)`);
} finally {
  await server.close();
}
