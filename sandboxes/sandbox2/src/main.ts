/**
 * Sandbox 2 · Voronoi cells.
 *
 * Generation: a fractal stack of stateless lattice-Voronoi diagrams under a chosen
 * distance function (src/voronoi). Calibration samples the map on a grid to place the
 * land/water threshold at the target ratio and to gather statistics.
 *
 * Display: a progressive per-pixel raster (shared RasterLayer) with pixel-exact
 * edges at any zoom, plus vector overlays (sites, lattice, distance probe), a
 * minimap, inspector, statistics and a gallery of every metric.
 */
import './style.css';
import { seedFromText } from '@shared/core/hash';
import { num, str, type Params, type ParamValue, type Section } from '@shared/params/schema';
import { decodeState, encodeState } from '@shared/params/url';
import { fitCamera, screenToWorld, zoomAt, type Camera, type Viewport } from '@shared/render/camera';
import { RasterLayer } from '@shared/render/raster';
import { buildPanel } from '@shared/ui/panel';
import { ALL_DEFS, defaults, GEN_KEYS, MAP_H, MAP_W, SECTIONS, toFieldParams, VIEW_MODES, VIEW_SECTION } from './params';
import { PRESETS } from './presets';
import { drawLattice, drawMapBorder, drawOceanSeeds, drawProbe, drawSites } from './render/overlays';
import { fieldSource, type EdgeMode, type ViewMode, type ViewOpts } from './render/source';
import { analyse, type MapStats } from './voronoi/analysis';
import { Field, newSample, type Calibration, type Sample, type Sampler } from './voronoi/field';
import { METRIC_IDS, metricInfo, type MetricId } from './voronoi/metrics';
import { buildGallery, renderInspector, renderLegend, renderMetricCard, renderStats } from './ui/widgets';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const DEFAULT_SEED = 'voronoi';
const CALIB_GRID = 256;
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 2000;

// ------------------------------------------------------------------ state

const initial = decodeState(location.hash, ALL_DEFS, DEFAULT_SEED);
let seedText = initial?.seed ?? DEFAULT_SEED;
let params: Params = initial?.params ?? defaults();

/** deterministic field (dpow) for calibration and statistics */
let field!: Field;
/** display field (Math.pow — only differs for Minkowski) */
let dfield!: Field;
let cal!: Calibration;
let stats: MapStats | null = null;
let genId = 0;
let hoverSampler!: Sampler;
let hoverSample: Sample = newSample(1);
let hover: { wx: number; wy: number } | null = null;
let pinned: { oct: number; id: number; wx: number; wy: number } | null = null;
let probeBall: Float64Array = new Float64Array(0);
const timings = { calib: 0, render: 0 };

// ------------------------------------------------------------------ canvas & camera

const canvas = $<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d', { alpha: false })!;
const layer = new RasterLayer();
let vp: Viewport = { w: 1, h: 1 };
let cam: Camera = { cx: MAP_W / 2, cy: MAP_H / 2, zoom: 1 };
let fitted = true;
let lastInteract = 0;
let renderStart = 0;
let renderScale = 0;

// ------------------------------------------------------------------ panels

const left = $('left');
const leftPanel = buildPanel(left, SECTIONS, params, onParam, resetSection);
const metricCard = document.createElement('div');
metricCard.className = 'metric-card';
left.querySelector('.sec[data-id="metric"] .sec-body')!.append(metricCard);

const viewPanel = buildPanel($('viewPanel'), [VIEW_SECTION], params, onParam, resetSection);

const gallery = buildGallery($('gallery'), (id) => setParams({ 'metric.kind': id }));
for (const id of ['gallerySec', 'statsSec']) {
  const sec = $(id);
  sec.querySelector('.sec-head')!.addEventListener('click', () => sec.classList.toggle('collapsed'));
}

function onParam(key: string, value: ParamValue): void {
  setParams({ [key]: value });
}

function resetSection(s: Section): void {
  const d = defaults();
  const patch: Params = {};
  for (const def of s.params) patch[def.key] = d[def.key];
  setParams(patch);
}

function setParams(patch: Params): void {
  const before = params;
  params = { ...params, ...patch };
  leftPanel.sync(params);
  viewPanel.sync(params);
  const gen = Object.keys(patch).some((k) => GEN_KEYS.has(k) && before[k] !== params[k]);
  if (gen) regenerate();
  else viewChanged();
}

// ------------------------------------------------------------------ generation

function regenerate(): void {
  const seed = seedFromText(seedText);
  const fp = toFieldParams(params, seed);
  const t0 = performance.now();
  field = new Field(fp);
  dfield = new Field(fp, Math.pow);
  cal = field.calibrate(CALIB_GRID);
  stats = analyse(field, cal);
  timings.calib = performance.now() - t0;
  timings.render = 0;
  genId++;
  hoverSampler = dfield.makeSampler();
  hoverSample = newSample(dfield.octaves);
  if (pinned && pinned.oct >= field.octaves) pinned = null;
  if (pinned) {
    // keep the pin on whatever cell is now under the pinned point
    hoverSampler(pinned.wx, pinned.wy, hoverSample);
    pinned.id = hoverSample.ids[pinned.oct];
  }
  renderMetricCard(metricCard, fp);
  drawMinimapBase();
  scheduleGallery();
  viewChanged();
}

function viewOpts(): ViewOpts {
  return {
    mode: str(params, 'view.color') as ViewMode,
    oct: Math.min(field.octaves, num(params, 'view.oct')) - 1,
    edges: str(params, 'view.edges') as EdgeMode,
    coast: params['view.coast'] === true,
    bevel: num(params, 'view.bevel'),
    dim: params['view.dim'] === true,
    pinned: pinned ? { oct: pinned.oct, id: pinned.id } : null,
  };
}

/** Anything that changes the picture but not the field. */
function viewChanged(): void {
  const k = viewOpts().oct;
  probeBall = dfield.lattices[k].metric.ballPolygon(160);
  renderLegend($('legend'), viewOpts().mode, stats, field.p.land);
  if (stats) renderStats($('stats'), field, cal, stats, timings);
  updateInspector();
  writeUrl();
  invalidate();
}

let urlTimer = 0;
function writeUrl(): void {
  clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => history.replaceState(null, '', `#${encodeState(seedText, params, ALL_DEFS)}`), 150);
}

let galleryTimer = 0;
function scheduleGallery(): void {
  gallery.select(str(params, 'metric.kind') as MetricId);
  clearTimeout(galleryTimer);
  galleryTimer = window.setTimeout(() => {
    if (!$('gallerySec').classList.contains('collapsed')) gallery.update(dfield.p, viewOpts());
  }, 250);
}

// ------------------------------------------------------------------ render loop

let raf = 0;
let idleTimer = 0;
function invalidate(): void {
  if (!raf) raf = requestAnimationFrame(frame);
}

function frame(): void {
  raf = 0;
  const dpr = window.devicePixelRatio || 1;
  const now = performance.now();
  const interacting = now - lastInteract < 160;
  const view = viewOpts();
  const src = fieldSource(dfield, cal, `g${genId}`, view);
  const fresh = !layer.hasContentFor(src.key);
  // coarse first while moving or when the content is new, then full resolution
  const preview = Math.max(0.25, dpr * 0.3);
  let scale = interacting || fresh ? preview : dpr;
  // let a running preview of this exact view finish before starting the full pass
  if (scale === dpr && layer.busy && layer.isCurrent(src, cam, vp, preview)) scale = preview;
  if (!layer.isCurrent(src, cam, vp, scale) && !(scale < dpr && layer.isCurrent(src, cam, vp, dpr))) {
    layer.start(src, cam, vp, scale);
    renderStart = now;
    renderScale = scale;
  }
  // a coarse preview gets a bigger slice so it usually completes within one frame
  const busy = layer.step(now + (renderScale < dpr ? 40 : 14));
  if (!busy && renderScale === dpr && renderStart > 0) {
    timings.render = performance.now() - renderStart;
    renderStart = 0;
    if (stats) renderStats($('stats'), field, cal, stats, timings);
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b0e13';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  layer.draw(ctx, cam, vp, dpr, src.key, true, true);

  drawMapBorder(ctx, dfield, cam, vp, dpr);
  if (params['view.lattice'] === true) drawLattice(ctx, dfield, view.oct, cam, vp, dpr);
  const sites = str(params, 'view.sites');
  if (sites !== 'none') drawSites(ctx, dfield, sites === 'all' ? [3, 2, 1, 0] : [0], cam, vp, dpr);
  if (field.oceans) drawOceanSeeds(ctx, field.oceans.seeds, cam, vp, dpr);
  if (params['view.probe'] === true && hover && !drag) drawProbe(ctx, dfield, view.oct, hoverSample, probeBall, cam, vp, dpr);

  updateStatus(layer.busy ? layer.progress : 1);
  $('busy').hidden = !layer.busy;
  drawMinimap();
  if (layer.busy) invalidate();
  else if (interacting || fresh) {
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(invalidate, 170);
  }
}

// ------------------------------------------------------------------ status, inspector, minimap

function niceLength(target: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [1, 2, 5, 10]) if (m * p >= target) return m * p;
  return 10 * p;
}

function updateStatus(progress: number): void {
  const len = niceLength(90 / cam.zoom);
  const px = len * cam.zoom;
  const cellPx = dfield.lattices[0].size * cam.zoom;
  const finest = dfield.lattices[dfield.octaves - 1].size * cam.zoom;
  const pos = hover ? `<span><b>${hover.wx.toFixed(1)}</b>, <b>${hover.wy.toFixed(1)}</b></span>` : '<span>—</span>';
  $('status').innerHTML =
    pos +
    `<span>zoom <b>${(cam.zoom / fitCamera(MAP_W, MAP_H, vp).zoom).toFixed(cam.zoom < 10 ? 2 : 0)}×</b></span>` +
    `<span title="Octave-1 and finest-octave cell size on screen">cells <b>${cellPx.toFixed(0)}</b> / <b>${finest.toFixed(1)}</b> px</span>` +
    (progress < 1 ? `<span class="rendering">rendering ${(progress * 100).toFixed(0)}%</span>` : '') +
    `<span class="scalebar"><i style="width:${px.toFixed(0)}px"></i>${len >= 1 ? len : len.toPrecision(2)} u</span>`;
}

function updateInspector(): void {
  const pt = pinned ?? hover;
  if (!pt || !hoverSampler) {
    renderInspector($('inspector'), null, null, null, 0, 0, false);
    return;
  }
  hoverSampler(pt.wx, pt.wy, hoverSample);
  renderInspector($('inspector'), dfield, cal, hoverSample, pt.wx, pt.wy, !!pinned);
  // keep the probe on the hover point even when the inspector shows the pin
  if (pinned && hover) hoverSampler(hover.wx, hover.wy, hoverSample);
}

const mini = $<HTMLCanvasElement>('minimap');
const miniBase = document.createElement('canvas');
function drawMinimapBase(): void {
  if (!stats) return;
  const { gw, gh, values, threshold, vmin, vmax } = cal;
  miniBase.width = gw;
  miniBase.height = gh;
  const mctx = miniBase.getContext('2d')!;
  const img = mctx.createImageData(gw, gh);
  for (let i = 0; i < gw * gh; i++) {
    const v = values[i];
    let r: number, g: number, b: number;
    if (v > threshold) {
      const t = Math.min(1, (v - threshold) / Math.max(1e-9, vmax - threshold));
      r = 120 + 70 * t;
      g = 160 - 20 * t;
      b = 90 + 40 * t;
    } else {
      const t = Math.min(1, (threshold - v) / Math.max(1e-9, threshold - vmin));
      r = 60 - 40 * t;
      g = 110 - 70 * t;
      b = 160 - 80 * t;
    }
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  mctx.putImageData(img, 0, 0);
}

function drawMinimap(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = mini.clientWidth || 200;
  const h = Math.round((w * MAP_H) / MAP_W);
  if (mini.width !== Math.round(w * dpr) || mini.height !== Math.round(h * dpr)) {
    mini.width = Math.round(w * dpr);
    mini.height = Math.round(h * dpr);
    mini.style.height = `${h}px`;
  }
  const m = mini.getContext('2d')!;
  m.setTransform(1, 0, 0, 1, 0, 0);
  m.imageSmoothingEnabled = true;
  m.drawImage(miniBase, 0, 0, mini.width, mini.height);
  const s = mini.width / MAP_W;
  const vw = vp.w / cam.zoom;
  const vh = vp.h / cam.zoom;
  m.strokeStyle = '#fde725';
  m.lineWidth = 1.5 * dpr;
  m.strokeRect((cam.cx - vw / 2) * s, (cam.cy - vh / 2) * s, vw * s, vh * s);
}

function miniJump(e: PointerEvent): void {
  const r = mini.getBoundingClientRect();
  cam = { ...cam, cx: ((e.clientX - r.left) / r.width) * MAP_W, cy: ((e.clientY - r.top) / r.height) * MAP_H };
  fitted = false;
  lastInteract = performance.now();
  invalidate();
}
mini.addEventListener('pointerdown', (e) => {
  mini.setPointerCapture(e.pointerId);
  miniJump(e);
});
mini.addEventListener('pointermove', (e) => {
  if (mini.hasPointerCapture(e.pointerId)) miniJump(e);
});

// ------------------------------------------------------------------ interaction

function setCam(c: Camera): void {
  cam = c;
  fitted = false;
  lastInteract = performance.now();
  invalidate();
}

function zoomBy(f: number, sx = vp.w / 2, sy = vp.h / 2): void {
  setCam(zoomAt(cam, vp, sx, sy, f, MIN_ZOOM, MAX_ZOOM));
}

function fit(): void {
  cam = fitCamera(MAP_W, MAP_H, vp);
  fitted = true;
  lastInteract = performance.now();
  invalidate();
}

new ResizeObserver(() => {
  const rect = canvas.parentElement!.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  vp = { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  if (fitted) cam = fitCamera(MAP_W, MAP_H, vp);
  invalidate();
}).observe(canvas.parentElement!);

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomBy(Math.exp(-dy * 0.0016), e.clientX - r.left, e.clientY - r.top);
  },
  { passive: false },
);

const pointers = new Map<number, { x: number; y: number }>();
let drag: { x: number; y: number; moved: number } | null = null;
let pinch: { d: number } | null = null;

function local(e: PointerEvent | MouseEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, moved: 0 };
  else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
    drag = null;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const [sx, sy] = local(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const r = canvas.getBoundingClientRect();
    zoomBy(d / Math.max(1, pinch.d), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    pinch.d = d;
    return;
  }
  if (drag) {
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.moved > 3) {
      canvas.classList.add('dragging');
      setCam({ ...cam, cx: cam.cx - dx / cam.zoom, cy: cam.cy - dy / cam.zoom });
    }
  }
  const [wx, wy] = screenToWorld(cam, vp, sx, sy);
  hover = { wx, wy };
  updateInspector();
  if (hoverSampler) hoverSampler(wx, wy, hoverSample);
  invalidate();
});

function endPointer(e: PointerEvent): void {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (drag && pointers.size === 0) {
    if (drag.moved <= 3 && e.type === 'pointerup') {
      // click: pin the cell of the selected octave under the cursor
      const [sx, sy] = local(e);
      const [wx, wy] = screenToWorld(cam, vp, sx, sy);
      const oct = viewOpts().oct;
      const s = newSample(dfield.octaves);
      dfield.makeSampler()(wx, wy, s);
      if (pinned && pinned.id === s.ids[oct] && pinned.oct === oct) pinned = null;
      else pinned = { oct, id: s.ids[oct], wx, wy };
      viewChanged();
    }
    drag = null;
    canvas.classList.remove('dragging');
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => {
  if (!drag) {
    hover = null;
    updateInspector();
    invalidate();
  }
});
canvas.addEventListener('dblclick', (e) => {
  const [sx, sy] = local(e);
  zoomBy(e.shiftKey ? 0.5 : 2, sx, sy);
});

$('zin').addEventListener('click', () => zoomBy(1.5));
$('zout').addEventListener('click', () => zoomBy(1 / 1.5));
$('zfit').addEventListener('click', fit);

// ------------------------------------------------------------------ top bar

const seedInput = $<HTMLInputElement>('seed');
seedInput.value = seedText;
seedInput.addEventListener('change', () => {
  seedText = seedInput.value.trim() || DEFAULT_SEED;
  regenerate();
});
seedInput.addEventListener('keydown', (e) => e.stopPropagation());

function randomSeed(): void {
  seedText = String(Math.floor(Math.random() * 1e9));
  seedInput.value = seedText;
  regenerate();
}
$('dice').addEventListener('click', randomSeed);

const presetSel = $<HTMLSelectElement>('preset');
presetSel.innerHTML = '<option value="">Presets…</option>' + PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
presetSel.addEventListener('change', () => {
  const p = PRESETS.find((x) => x.id === presetSel.value);
  presetSel.value = '';
  if (!p) return;
  if (p.seed) {
    seedText = p.seed;
    seedInput.value = seedText;
  }
  pinned = null;
  params = { ...defaults(), ...p.params };
  leftPanel.sync(params);
  viewPanel.sync(params);
  regenerate();
  toast(p.label);
});

function toast(msg: string): void {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout((toast as unknown as { h: number }).h);
  (toast as unknown as { h: number }).h = window.setTimeout(() => (t.hidden = true), 1600);
}

$('share').addEventListener('click', async () => {
  history.replaceState(null, '', `#${encodeState(seedText, params, ALL_DEFS)}`);
  try {
    await navigator.clipboard.writeText(location.href);
    toast('Link copied');
  } catch {
    toast('Copy the URL from the address bar');
  }
});

$('png').addEventListener('click', () => {
  canvas.toBlob((b) => {
    if (!b) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `cellgen-voronoi-${seedText.replace(/[^\w-]+/g, '_')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
});

$('resetAll').addEventListener('click', () => {
  pinned = null;
  params = defaults();
  leftPanel.sync(params);
  viewPanel.sync(params);
  regenerate();
  toast('Parameters reset');
});

const helpDlg = $<HTMLDialogElement>('helpDlg');
$('help').addEventListener('click', () => helpDlg.showModal());
$('toggleRight').addEventListener('click', () => $('right').classList.toggle('open'));
$('gallerySec').querySelector('.sec-head')!.addEventListener('click', scheduleGallery);

// ------------------------------------------------------------------ keyboard

function cycle(key: string, values: string[], dir: number): void {
  const i = values.indexOf(str(params, key));
  setParams({ [key]: values[(i + dir + values.length) % values.length] });
}

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const pan = 80 / cam.zoom;
  switch (e.key) {
    case '+':
    case '=':
      zoomBy(1.5);
      break;
    case '-':
    case '_':
      zoomBy(1 / 1.5);
      break;
    case '0':
    case 'f':
    case 'F':
      fit();
      break;
    case 'ArrowLeft':
      setCam({ ...cam, cx: cam.cx - pan });
      break;
    case 'ArrowRight':
      setCam({ ...cam, cx: cam.cx + pan });
      break;
    case 'ArrowUp':
      setCam({ ...cam, cy: cam.cy - pan });
      break;
    case 'ArrowDown':
      setCam({ ...cam, cy: cam.cy + pan });
      break;
    case 'r':
    case 'R':
      randomSeed();
      break;
    case 'm':
    case 'M':
      cycle('metric.kind', METRIC_IDS, e.shiftKey ? -1 : 1);
      toast(metricInfo(str(params, 'metric.kind') as MetricId).label);
      break;
    case '[':
      cycle('view.color', VIEW_MODES.map((m) => m[0]), -1);
      break;
    case ']':
      cycle('view.color', VIEW_MODES.map((m) => m[0]), 1);
      break;
    case '1':
    case '2':
    case '3':
    case '4':
      setParams({ 'frac.octaves': Number(e.key) });
      break;
    case 'e':
    case 'E':
      cycle('view.edges', ['none', 'coarse', 'all', 'selected'], 1);
      break;
    case 's':
    case 'S':
      cycle('view.sites', ['none', 'coarse', 'all'], 1);
      break;
    case 'g':
    case 'G':
      setParams({ 'view.lattice': params['view.lattice'] !== true });
      break;
    case 'p':
    case 'P':
      setParams({ 'view.probe': params['view.probe'] !== true });
      break;
    case 'Escape':
      if (pinned) {
        pinned = null;
        viewChanged();
      }
      break;
    case '?':
      helpDlg.showModal();
      break;
    default:
      return;
  }
  e.preventDefault();
});

// ------------------------------------------------------------------ go

regenerate();
