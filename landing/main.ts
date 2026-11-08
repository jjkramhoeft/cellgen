/** Landing page: one card per sandbox in sandboxes/registry.ts. */
import './style.css';
import { esc } from '@shared/ui/html';
import { SANDBOXES } from '../sandboxes/registry';

const host = document.getElementById('sandboxes')!;

host.innerHTML = SANDBOXES.map((s) => {
  const tags = s.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  const body = `
    <div class="card-head">
      <h2>${esc(s.title)}</h2>
      <span class="status ${s.status}">${s.status === 'ready' ? 'open' : 'planned'}</span>
    </div>
    <p>${esc(s.summary)}</p>
    ${tags ? `<div class="tags">${tags}</div>` : ''}`;
  return s.status === 'ready'
    ? `<a class="card" href="sandboxes/${encodeURIComponent(s.id)}/">${body}</a>`
    : `<div class="card disabled">${body}</div>`;
}).join('');
