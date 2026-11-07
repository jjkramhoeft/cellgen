import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SANDBOXES } from './registry';

const dir = import.meta.dirname;

describe('sandbox registry', () => {
  it('has unique ids', () => {
    const ids = SANDBOXES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('every ready sandbox has a page', () => {
    for (const s of SANDBOXES.filter((x) => x.status === 'ready')) {
      expect(existsSync(resolve(dir, s.id, 'index.html')), `${s.id}/index.html`).toBe(true);
    }
  });
  it('every sandbox folder with a page is registered as ready', () => {
    const ready = new Set(SANDBOXES.filter((s) => s.status === 'ready').map((s) => s.id));
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('_')) continue;
      if (existsSync(resolve(dir, e.name, 'index.html'))) expect(ready.has(e.name), e.name).toBe(true);
    }
  });
});
