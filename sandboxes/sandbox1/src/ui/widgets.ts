/** Legend, inspector and statistics panels. */
import { BIOMES } from '../gen/biomes';
import { WATER_LAKE, WATER_OCEAN } from '../gen/hydrology';
import type { World } from '../gen/pipeline';
import type { Legend } from '../render/colorize';
import { cssRgb, type RGB } from '@shared/render/colormaps';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function gradientCanvas(cm: (t: number) => RGB, w = 220, h = 10): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  for (let x = 0; x < w; x++) {
    ctx.fillStyle = cssRgb(cm(x / (w - 1)));
    ctx.fillRect(x, 0, 1, h);
  }
  c.className = 'grad';
  return c;
}

function histCanvas(hist: number[], cm: (t: number) => RGB, w = 220, h = 36): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = w * dpr;
  c.height = h * dpr;
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const max = Math.max(1, ...hist);
  const bw = w / hist.length;
  for (let i = 0; i < hist.length; i++) {
    const bh = (Math.sqrt(hist[i] / max) * (h - 2)) | 0;
    ctx.fillStyle = cssRgb(cm((i + 0.5) / hist.length), 0.9);
    ctx.fillRect(i * bw + 0.5, h - bh, Math.max(1, bw - 1), bh);
  }
  c.className = 'hist';
  c.title = 'Distribution over cells (√ count scale)';
  return c;
}

export function renderLegend(
  host: HTMLElement,
  legend: Legend | null,
  raster: { label: string; minLabel: string; maxLabel: string; colormap: (t: number) => RGB; note?: string } | null,
  world: World | null,
  fieldId: string,
): void {
  host.innerHTML = '';
  if (!legend && !raster) return;
  const title = document.createElement('div');
  title.className = 'lg-title';
  if (raster) {
    title.textContent = raster.label;
    host.append(title, gradientCanvas(raster.colormap));
    const lab = document.createElement('div');
    lab.className = 'lg-range';
    lab.innerHTML = `<span>${esc(raster.minLabel)}</span><span>${esc(raster.maxLabel)}</span>`;
    host.append(lab);
    if (raster.note) {
      const n = document.createElement('div');
      n.className = 'lg-note';
      n.textContent = raster.note;
      host.append(n);
    }
  } else if (legend) {
    title.textContent = legend.label;
    host.append(title);
    if (legend.kind === 'scalar') {
      host.append(histCanvas(legend.hist, legend.colormap), gradientCanvas(legend.colormap));
      const lab = document.createElement('div');
      lab.className = 'lg-range';
      lab.innerHTML = `<span>${esc(legend.format(legend.min))}</span><span>${esc(legend.format(legend.max))}</span>`;
      host.append(lab);
    } else if (legend.kind === 'category') {
      const list = document.createElement('div');
      list.className = 'lg-cats';
      const total = legend.items.reduce((a, b) => a + b.count, 0) || 1;
      for (const it of legend.items.slice(0, 16)) {
        const row = document.createElement('div');
        row.className = 'lg-cat';
        row.innerHTML = `<i style="background:${cssRgb(it.color)}"></i><span>${esc(it.label)}</span><em>${((100 * it.count) / total).toFixed(1)}%</em>`;
        list.append(row);
      }
      if (legend.items.length > 16) {
        const more = document.createElement('div');
        more.className = 'lg-note';
        more.textContent = `+ ${legend.items.length - 16} more`;
        list.append(more);
      }
      host.append(list);
    }
    if (legend.note) {
      const n = document.createElement('div');
      n.className = 'lg-note';
      n.textContent = legend.note;
      host.append(n);
    }
  }
  if (world?.wind && ['moisture', 'biome'].includes(fieldId)) {
    const ang = (Math.atan2(world.wind[1], world.wind[0]) * 180) / Math.PI;
    const w = document.createElement('div');
    w.className = 'lg-wind';
    w.innerHTML = `<svg viewBox="-12 -12 24 24" width="22" height="22"><g transform="rotate(${ang.toFixed(1)})"><line x1="-8" y1="0" x2="7" y2="0" stroke="currentColor" stroke-width="2"/><path d="M8 0 L2 -4 L2 4 Z" fill="currentColor"/></g></svg><span>prevailing wind</span>`;
    host.append(w);
  }
}

const WATER_NAMES = ['Land', 'Ocean', 'Lake'];

export function renderInspector(host: HTMLElement, world: World | null, i: number, cursor: [number, number] | null, pinned: boolean): void {
  if (!world || i < 0) {
    host.innerHTML = `<div class="muted">Hover a cell to inspect it. Click to pin it and highlight its neighbours.</div>${
      cursor ? `<div class="kv"><span>cursor</span><b>${cursor[0].toFixed(1)}, ${cursor[1].toFixed(1)}</b></div>` : ''
    }`;
    return;
  }
  const g = world.graph;
  const deg = g.nbrOff[i + 1] - g.nbrOff[i];
  const rows: [string, string][] = [
    ['cell', `#${i}${pinned ? ' (pinned)' : ''}`],
    ['centroid', `${g.x[i].toFixed(1)}, ${g.y[i].toFixed(1)}`],
  ];
  if (g.kind === 'voronoi' || g.kind === 'implicit') rows.push(['site', `${g.sx[i].toFixed(1)}, ${g.sy[i].toFixed(1)}`]);
  rows.push(
    ['neighbours', String(deg)],
    ['area', `${g.area[i].toFixed(1)}  (${(g.area[i] / world.stats.areaMean).toFixed(2)}× mean)`],
    ['compactness', g.perimeter[i] > 0 ? ((4 * Math.PI * g.area[i]) / (g.perimeter[i] * g.perimeter[i])).toFixed(3) : '—'],
    ['border cell', g.border[i] ? 'yes' : 'no'],
    ['elevation', world.elevation[i].toFixed(3)],
    ['water', WATER_NAMES[world.water[i]]],
    ['temperature', world.temperature[i].toFixed(2)],
    ['moisture', world.moisture[i].toFixed(2)],
    ['biome', BIOMES[world.biome[i]]?.name ?? '?'],
    ['hops to coast', String(world.coastDist[i])],
  );
  if (world.drainage) {
    rows.push(['flux', world.drainage.flux[i].toFixed(2)]);
    rows.push(['flows to', world.drainage.downhill[i] >= 0 ? `#${world.drainage.downhill[i]}` : world.water[i] === WATER_OCEAN ? 'sea' : 'edge']);
    if (world.rivers?.isRiver[i]) rows.push(['river', 'yes']);
    if (world.water[i] === WATER_LAKE) rows.push(['lake depth', (world.drainage.filled[i] - world.elevation[i]).toFixed(3)]);
  }
  if (world.plates) {
    const p = world.plates.plates[world.plates.plateId[i]];
    rows.push(['plate', `${world.plates.plateId[i]} (${p.oceanic ? 'oceanic' : 'continental'})`]);
    const b = world.plates.boundary[i];
    if (b) rows.push(['boundary', ['', 'convergent', 'divergent', 'transform'][b]]);
  }
  if (world.ca) rows.push(['CA', ['floor', 'wall', 'outside'][world.ca.state[i]]]);
  if (world.paths) rows.push(['network', world.paths.cells[i] ? 'on' : 'off']);
  if (cursor) rows.push(['cursor', `${cursor[0].toFixed(1)}, ${cursor[1].toFixed(1)}`]);
  const nb: string[] = [];
  for (let k = g.nbrOff[i]; k < g.nbrOff[i + 1] && nb.length < 12; k++) nb.push(`#${g.nbr[k]}`);
  host.innerHTML =
    rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('') +
    `<div class="nbrs">${nb.join(' ')}${deg > 12 ? ' …' : ''}</div>`;
}

export function renderStats(host: HTMLElement, world: World): void {
  const s = world.stats;
  const g = world.graph;
  const kv = (k: string, v: string, title = '') => `<div class="kv"${title ? ` title="${esc(title)}"` : ''}><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
  let html = '';
  html += kv('cells', s.cells.toLocaleString());
  html += kv('adjacencies', s.edges.toLocaleString());
  html += kv('mean degree', s.meanDegree.toFixed(2), 'Planar Voronoi interiors tend to 6');
  html += kv('area CV', s.areaCV.toFixed(3), 'Coefficient of variation of cell area: 0 = perfectly uniform');
  html += kv('area max/min', s.areaMinMax[0] > 0 ? (s.areaMinMax[1] / s.areaMinMax[0]).toFixed(1) : '∞');
  html += kv('compactness', s.compactnessMean.toFixed(3), 'Mean isoperimetric quotient 4πA/P² (circle = 1, hexagon ≈ 0.907, square ≈ 0.785)');
  for (const [k, v] of Object.entries(g.info)) html += kv(k, String(v));
  html += `<div class="sub">Neighbour count</div><div class="bars">`;
  const maxC = Math.max(...s.degreeHist.map((d) => d[1]));
  for (const [d, c] of s.degreeHist) {
    const pct = (100 * c) / s.cells;
    html += `<div class="bar" title="${c} cells (${pct.toFixed(1)}%)"><span>${d}</span><i style="width:${(100 * c) / maxC}%"></i><em>${pct.toFixed(1)}%</em></div>`;
  }
  html += `</div><div class="sub">World</div>`;
  html += kv('land', `${(100 * s.landFrac).toFixed(1)}%`);
  html += kv('lakes', String(s.lakes));
  if (world.rivers) html += kv('river systems', String(s.riverMouths)) + kv('river cells', String(s.riverCells));
  if (world.sca) html += kv('colonization nodes', `${world.sca.count} (${world.sca.iterations} it.)`) + kv('Strahler max', String(world.sca.maxOrder));
  if (world.paths) html += kv('network cells', String(world.paths.count));
  if (world.ca) html += kv('cave regions', String(world.ca.regions)) + kv('floor', `${(100 * world.ca.floorFrac).toFixed(1)}%`);
  if (world.plates) html += kv('plates', String(world.plates.plates.length));
  html += `<div class="sub">Timings</div><div class="bars timing">`;
  const total = world.timings.reduce((a, t) => a + t.ms, 0);
  const maxT = Math.max(...world.timings.map((t) => t.ms), 1);
  for (const t of world.timings) {
    html += `<div class="bar"><span>${esc(t.name)}</span><i style="width:${(100 * t.ms) / maxT}%"></i><em>${t.ms.toFixed(1)} ms</em></div>`;
  }
  html += `</div>${kv('total', `${total.toFixed(1)} ms`)}`;
  html += kv('fingerprint', world.fingerprint, 'FNV-1a hash of the generated fields. Same seed + params ⇒ same fingerprint in every browser.');
  host.innerHTML = html;
}
