/** Legend, inspector, statistics, and the metric gallery. */
import { COLORMAPS, cssRgb, type RGB } from '@shared/render/colormaps';
import { esc } from '@shared/ui/html';
import { Field, type Calibration, type FieldParams, type Sample } from '../voronoi/field';
import type { MapStats } from '../voronoi/analysis';
import { METRICS, metricInfo, Metric, type MetricId } from '../voronoi/metrics';
import { fieldSource, type ViewMode, type ViewOpts } from '../render/source';
import { drawBall, octColor } from '../render/overlays';

const fmt = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

function gradient(cm: (t: number) => RGB, w = 200, h = 10): HTMLCanvasElement {
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

const LEGENDS: Record<ViewMode, { title: string; cm?: (t: number) => RGB; lo?: string; hi?: string; note: string }> = {
  terrain: { title: 'Land & water', note: 'Depth and height are the distance of the cell value v from the threshold.' },
  flat: { title: 'Land & water', note: 'Two-tone map: land where v > threshold.' },
  value: { title: 'Cell value v', cm: COLORMAPS.diverging, lo: 'below T', hi: 'above T', note: 'Diverging around the land/water threshold T.' },
  cellid: { title: 'Cell IDs', note: 'A random colour per cell of the selected octave.' },
  octaves: { title: 'Octave mosaic', note: 'Cell colours of every octave blended by octave weight: the fractal overlay of cells.' },
  f1: { title: 'Worley F1', cm: COLORMAPS.magma, lo: '0', hi: 'p99', note: 'Distance to the nearest site (lattice units, current metric).' },
  f2: { title: 'Worley F2', cm: COLORMAPS.viridis, lo: '0', hi: 'p99', note: 'Distance to the second-nearest site.' },
  f2f1: { title: 'F2 − F1', cm: COLORMAPS.flux, lo: '0', hi: 'p99', note: 'Zero exactly on cell borders. Not a true distance, so border widths vary (√ scale).' },
  ratio: { title: 'F1 / F2', cm: COLORMAPS.gray, lo: 'border', hi: 'site', note: '1 − F1/F2: bright at the site, black on the border. Scale-free.' },
  worley: { title: 'Fractal Worley F1', cm: COLORMAPS.magma, lo: '0', hi: 'p99', note: 'Σ gainᵏ · F1ₖ over the octaves: Worley fBm.' },
};

export function renderLegend(host: HTMLElement, mode: ViewMode, stats: MapStats | null, target: number): void {
  const L = LEGENDS[mode];
  host.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'lg-title';
  title.textContent = L.title;
  title.title = 'Click to collapse / expand';
  title.addEventListener('click', () => host.classList.toggle('min'));
  host.append(title);
  if (L.cm) {
    host.append(gradient(L.cm));
    const r = document.createElement('div');
    r.className = 'lg-range';
    r.innerHTML = `<span>${esc(L.lo ?? '')}</span><span>${esc(L.hi ?? '')}</span>`;
    host.append(r);
  } else if (mode === 'terrain' || mode === 'flat') {
    const cats = document.createElement('div');
    cats.className = 'lg-cats';
    const land = stats ? stats.landFraction : NaN;
    const sw = (c: string, label: string, v: string) => `<div class="lg-cat"><i style="background:${c}"></i><span>${label}</span><em>${v}</em></div>`;
    cats.innerHTML =
      sw(mode === 'flat' ? '#96b270' : '#4e8048', 'Land', pct(land)) + sw(mode === 'flat' ? '#264e80' : '#2a5585', 'Water', pct(1 - land));
    host.append(cats);
    const t = document.createElement('div');
    t.className = 'lg-note';
    t.textContent = `Target ${Math.round(target * 100)}% land, achieved ${pct(land)}.`;
    host.append(t);
  }
  const n = document.createElement('div');
  n.className = 'lg-note';
  n.textContent = L.note;
  host.append(n);
}

export function renderInspector(host: HTMLElement, field: Field | null, cal: Calibration | null, s: Sample | null, wx: number, wy: number, pinned: boolean): void {
  if (!field || !cal || !s) {
    host.innerHTML = '<p class="muted">Hover the map to inspect a point. Click a cell to pin it.</p>';
    return;
  }
  const land = s.v > cal.threshold;
  let html = `<div class="kv"><span>Point</span><b>${wx.toFixed(1)}, ${wy.toFixed(1)}</b></div>`;
  html += `<div class="kv"><span>Field v</span><b>${fmt(s.v)} ${land ? '▲ land' : '▼ water'}</b></div>`;
  html += `<div class="kv"><span>Threshold T</span><b>${fmt(cal.threshold)}</b></div>`;
  html += '<table class="oct-table"><thead><tr><th>oct</th><th>cell</th><th>F1</th><th>F2</th><th>g</th></tr></thead><tbody>';
  for (let k = 0; k < field.octaves; k++) {
    const h = s.hits[k];
    html += `<tr><td><i style="background:${octColor(k)}"></i>${k + 1}</td><td>${h.i1},${h.j1}</td><td>${fmt(h.f1)}</td><td>${fmt(h.f2)}</td><td>${fmt(s.vals[k], 2)}</td></tr>`;
  }
  html += '</tbody></table>';
  const h0 = s.hits[0];
  const lat = field.lattices[0];
  html += `<div class="kv"><span>Site (oct 1)</span><b>${lat.toWorldX(h0.x1).toFixed(1)}, ${lat.toWorldY(h0.y1).toFixed(1)}</b></div>`;
  if (field.p.weightMode !== 'none') html += `<div class="kv"><span>Site weight</span><b>${fmt(lat.weight(h0.i1, h0.j1))}</b></div>`;
  html += `<div class="kv"><span>Cells searched</span><b>${s.hits.map((x) => x.visited).join(' / ')}</b></div>`;
  html += `<p class="muted small">F in lattice units of each octave. g = the cell's value; v = Σ wₖ·gₖ.${pinned ? ' Pinned: Esc to release.' : ''}</p>`;
  host.innerHTML = html;
}

function histCanvas(stats: MapStats, threshold: number, w = 250, h = 54): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = w * dpr;
  c.height = h * dpr;
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  c.className = 'hist';
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const max = Math.max(1, ...stats.hist);
  const bw = w / stats.hist.length;
  const span = Math.max(1e-9, stats.histMax - stats.histMin);
  const tx = ((threshold - stats.histMin) / span) * w;
  for (let i = 0; i < stats.hist.length; i++) {
    const bh = Math.round(Math.sqrt(stats.hist[i] / max) * (h - 4));
    ctx.fillStyle = (i + 0.5) * bw > tx ? '#7fae5e' : '#3d6ea3';
    ctx.fillRect(i * bw + 0.5, h - bh, Math.max(1, bw - 1), bh);
  }
  ctx.strokeStyle = '#fde725';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(tx, 0);
  ctx.lineTo(tx, h);
  ctx.stroke();
  c.title = 'Distribution of the field value v over the map (√ count). Yellow line = land/water threshold.';
  return c;
}

export function renderStats(host: HTMLElement, field: Field, cal: Calibration, stats: MapStats, timings: { calib: number; render: number }): void {
  host.innerHTML = '';
  const add = (k: string, v: string, title?: string) => {
    const d = document.createElement('div');
    d.className = 'kv';
    if (title) d.title = title;
    d.innerHTML = `<span>${esc(k)}</span><b>${esc(v)}</b>`;
    host.append(d);
  };
  add('Land (target)', `${pct(stats.landFraction)} (${Math.round(field.p.land * 100)}%)`);
  add('Islands', String(stats.islands), 'Connected land areas on the analysis grid');
  add('Largest island', pct(stats.largestIsland), 'Share of all land in the largest island');
  add('Lakes', String(stats.lakes), 'Water bodies that do not reach the map edge');
  if (field.oceans)
    add(
      'Ocean seeds',
      `${field.oceans.seeds.length} of ${field.oceans.cells} cells`,
      '⌈water % / 10⌉ random octave-1 cells; the flood spreads from them through neighbouring cells until the water share is met',
    );
  add('Coastline', `${Math.round(stats.coastLength)} u`, 'Length estimate in world units on the analysis grid');
  add(
    'Coast dimension',
    Number.isFinite(stats.coastDim) ? `≈ ${stats.coastDim.toFixed(3)}` : '—',
    `Box-counting dimension of the coastline: ${stats.boxes.map((b) => `${b.size}px→${b.count}`).join(', ')}. 1 = smooth curve.`,
  );
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = 'Field value';
  host.append(sub, histCanvas(stats, cal.threshold));
  const sub2 = document.createElement('div');
  sub2.className = 'sub';
  sub2.textContent = 'Octaves';
  host.append(sub2);
  const t = document.createElement('table');
  t.className = 'oct-table';
  let rows = '<thead><tr><th>oct</th><th>size</th><th>weight</th><th>cells</th></tr></thead><tbody>';
  for (let k = 0; k < field.octaves; k++) {
    const lat = field.lattices[k];
    rows += `<tr><td><i style="background:${octColor(k)}"></i>${k + 1}</td><td>${lat.size.toFixed(1)}</td><td>${pct(field.amps[k], 0)}</td><td>${stats.cellsPerOctave[k]}</td></tr>`;
  }
  t.innerHTML = rows + '</tbody></table>';
  host.append(t);
  const sub3 = document.createElement('div');
  sub3.className = 'sub';
  sub3.textContent = 'Performance';
  host.append(sub3);
  add('Cells searched / query', cal.visited.toFixed(2), 'Mean lattice cells visited by the pruned ring search, per octave');
  add('Calibration', `${timings.calib.toFixed(0)} ms (${cal.gw}×${cal.gh})`);
  add('Last full render', timings.render > 0 ? `${timings.render.toFixed(0)} ms` : '…');
  add('Fingerprint', stats.fingerprint, 'Hash of the calibration grid. Same seed + parameters give the same value in every browser.');
}

// ------------------------------------------------------------------ metric gallery

export interface Gallery {
  /** re-render all thumbnails for these parameters (cancels a running update) */
  update(p: FieldParams, view: ViewOpts): void;
  select(id: MetricId): void;
}

export function buildGallery(host: HTMLElement, onPick: (id: MetricId) => void): Gallery {
  host.innerHTML = '';
  const W = 124;
  const H = 78;
  const items = METRICS.map((m) => {
    const b = document.createElement('button');
    b.className = 'thumb';
    b.title = `${m.label}: ${m.formula}\n${m.note}`;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ball = document.createElement('canvas');
    ball.className = 'thumb-ball';
    const label = document.createElement('span');
    label.textContent = m.label.replace(/ \(.*\)$/, '');
    b.append(cv, ball, label);
    b.addEventListener('click', () => onPick(m.id));
    host.append(b);
    return { m, b, cv, ball };
  });
  let token = 0;
  return {
    select(id) {
      for (const it of items) it.b.classList.toggle('active', it.m.id === id);
    },
    update(p, view) {
      const my = ++token;
      let i = 0;
      const next = () => {
        if (my !== token || i >= items.length) return;
        const it = items[i++];
        const fp: FieldParams = { ...p, metric: { ...p.metric, id: it.m.id } };
        const f = new Field(fp, Math.pow);
        const cal = f.calibrate(72);
        const v: ViewOpts = { ...view, edges: view.edges === 'none' ? 'none' : 'coarse', pinned: null, dim: false };
        const fn = fieldSource(f, cal, 'thumb', v).create();
        const ctx = it.cv.getContext('2d')!;
        const img = ctx.createImageData(W, H);
        const u32 = new Uint32Array(img.data.buffer);
        const dw = fp.W / W;
        const dh = fp.H / H;
        for (let y = 0; y < H; y++) fn(y, (y + 0.5) * dh, dw / 2, dw, W, u32, y * W);
        ctx.putImageData(img, 0, 0);
        drawBall(it.ball, [{ poly: new Metric(fp.metric, Math.pow).ballPolygon(96), color: '#fde725' }], 30);
        setTimeout(next, 0);
      };
      setTimeout(next, 30);
    },
  };
}

/** The unit-ball diagram under the metric parameters. */
export function renderMetricCard(host: HTMLElement, p: FieldParams): void {
  host.innerHTML = '';
  const canvas = document.createElement('canvas');
  const base = new Metric(p.metric, Math.pow);
  const balls: { poly: Float64Array; color: string; dash?: boolean }[] = [{ poly: base.ballPolygon(), color: '#fde725' }];
  if (p.detailMetric && p.octaves > 1) balls.push({ poly: new Metric(p.detailMetric, Math.pow).ballPolygon(), color: '#3fc1b0', dash: true });
  drawBall(canvas, balls, 96);
  const info = metricInfo(p.metric.id);
  const text = document.createElement('div');
  text.className = 'metric-text';
  text.innerHTML =
    `<b>${esc(info.label)}</b><code>${esc(info.formula)}</code><p>${esc(info.note)}</p>` +
    `<p class="legend-line"><i class="sw y"></i>unit ball <i class="sw d"></i>L2 circle${balls.length > 1 ? ' <i class="sw t"></i>detail octaves' : ''}</p>`;
  host.append(canvas, text);
}
