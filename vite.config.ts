import { defineConfig } from 'vitest/config';

// A relative base works for a GitHub Pages project site (https://<user>.github.io/<repo>/)
// whatever the repository is called, and for local `vite preview` too.
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true },
  test: { include: ['tests/**/*.test.ts'] },
});
