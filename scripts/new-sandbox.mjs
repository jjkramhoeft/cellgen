#!/usr/bin/env node
/**
 * Scaffold a new sandbox from sandboxes/_template and register it.
 *
 *   npm run new-sandbox -- sandbox5 "Sandbox 5 · River networks"
 *
 * Creates sandboxes/<id>/ (index.html, src/, tests/) and marks the entry in
 * sandboxes/registry.ts as ready (adding it if missing). Vite picks the page up
 * automatically; it is served at /sandboxes/<id>/.
 */
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const [id, ...titleParts] = process.argv.slice(2);
const title = titleParts.join(' ').trim() || (id ? id.replace(/^sandbox(\d+)$/, 'Sandbox $1') : '');

if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
  console.error('Usage: npm run new-sandbox -- <id> "<title>"   (id: lowercase letters, digits, dashes)');
  process.exit(1);
}
const dest = join(root, 'sandboxes', id);
if (existsSync(join(dest, 'index.html'))) {
  console.error(`sandboxes/${id} already has a page — pick another id.`);
  process.exit(1);
}

cpSync(join(root, 'sandboxes', '_template'), dest, { recursive: true });

// fill placeholders
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(html|ts|css|md)$/.test(name)) {
      const s = readFileSync(p, 'utf8');
      const t = s.replaceAll('{{TITLE}}', title).replaceAll('{{ID}}', id);
      if (t !== s) writeFileSync(p, t);
    }
  }
};
walk(dest);

// register (or flip a planned entry to ready)
const regPath = join(root, 'sandboxes', 'registry.ts');
let reg = readFileSync(regPath, 'utf8');
const entryRe = new RegExp(`(\\{\\s*id: '${id}',[\\s\\S]*?\\n  \\})`);
const json = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
if (entryRe.test(reg)) {
  reg = reg.replace(entryRe, (block) =>
    block.replace(/status: '\w+'/, "status: 'ready'").replace(/title: '(?:[^'\\]|\\.)*'/, `title: ${json(title)}`),
  );
} else {
  const entry = `  {\n    id: '${id}',\n    title: ${json(title)},\n    summary: 'Describe this sandbox.',\n    status: 'ready',\n    tags: [],\n  },\n`;
  reg = reg.replace(/\n\];\s*$/, `\n${entry}];\n`);
}
writeFileSync(regPath, reg);

console.log(`Created sandboxes/${id}/ and registered "${title}".`);
console.log(`Run \`npm run dev\` and open /sandboxes/${id}/`);
