#!/usr/bin/env node
/**
 * Regenerate the golden data of Sandbox 5 (the C# port of the Sandbox 4 generator):
 *
 *   npm run export-sandbox5-golden            every part
 *   npm run export-sandbox5-golden -- rivers  only the named part(s)
 *
 * Writes sandboxes/sandbox5/tests/Sandbox5.Tests/Golden/<part>.json from this repository's
 * TypeScript generator at the parameters in Golden/settings.json. The C# tests compare
 * their own results with these files. The export itself is scripts/export-sandbox5-golden.ts,
 * loaded through Vite like the other export scripts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'sandboxes', 'sandbox5', 'tests', 'Sandbox5.Tests', 'Golden');
const settings = JSON.parse(readFileSync(resolve(dir, 'settings.json'), 'utf8'));

const server = await createServer({
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { PARTS } = await server.ssrLoadModule('/scripts/export-sandbox5-golden.ts');
  const wanted = process.argv.slice(2);
  for (const name of wanted.length ? wanted : Object.keys(PARTS)) {
    if (!PARTS[name]) throw new Error(`unknown part "${name}" (known: ${Object.keys(PARTS).join(', ')})`);
    const t0 = Date.now();
    const out = resolve(dir, `${name}.json`);
    writeFileSync(out, JSON.stringify(PARTS[name](settings)) + '\n');
    console.log(`${relative(root, out)} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
} finally {
  await server.close();
}
