#!/usr/bin/env node
/**
 * Regenerate docs/classify-vs-whittaker.svg: sandbox4's classify(t, p) on a temperature ×
 * precipitation chart with the Whittaker (plotbiomes) outlines on top, plus how much of
 * each Whittaker biome classify() agrees with.
 *
 *   npm run biome-chart
 *
 * The chart itself is scripts/biome-chart.ts, loaded through Vite (the project's
 * vite.config.ts) so it runs the sandbox's TypeScript sources directly.
 */
import { writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'docs', 'classify-vs-whittaker.svg');

const server = await createServer({
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { biomeChart } = await server.ssrLoadModule('/scripts/biome-chart.ts');
  const { svg, rows } = biomeChart();
  writeFileSync(out, svg);
  console.log(`${relative(root, out)} (${(svg.length / 1024).toFixed(0)} KB)`);
  for (const r of rows) console.log(`  ${r.name.padEnd(34)} ${String(Math.round(r.agree * 100)).padStart(3)} %   mostly ${r.top}`);
} finally {
  await server.close();
}
