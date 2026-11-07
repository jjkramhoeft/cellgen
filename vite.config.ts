import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

/**
 * Multi-page build: the landing page plus one page per sandbox. Any folder
 * `sandboxes/<id>/` that contains an `index.html` is picked up automatically,
 * so adding a sandbox needs no config change (see `npm run new-sandbox`).
 */
function pages(): Record<string, string> {
  const input: Record<string, string> = { index: resolve(root, 'index.html') };
  const dir = resolve(root, 'sandboxes');
  for (const id of readdirSync(dir, { withFileTypes: true })) {
    if (!id.isDirectory() || id.name.startsWith('_')) continue;
    const html = resolve(dir, id.name, 'index.html');
    if (existsSync(html)) input[id.name] = html;
  }
  return input;
}

// A relative base works for a GitHub Pages project site (https://<user>.github.io/<repo>/)
// whatever the repository is called, and for local `vite preview` too.
export default defineConfig({
  base: './',
  resolve: { alias: { '@shared': resolve(root, 'shared') } },
  build: { target: 'es2022', sourcemap: true, rollupOptions: { input: pages() } },
  test: { include: ['shared/**/*.test.ts', 'sandboxes/**/*.test.ts', 'landing/**/*.test.ts'] },
});
