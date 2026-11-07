import './style.css';
import { SANDBOXES } from '../sandboxes/registry';

// Links made before the repo had a landing page pointed at the root with Sandbox 1's
// state in the hash (#seed=…). Forward those to Sandbox 1.
if (/(^#|&)seed=/.test(location.hash)) {
  location.replace(`sandboxes/sandbox1/${location.hash}`);
}

const host = document.getElementById('sandboxes')!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

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
