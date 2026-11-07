import './style.css';
import { seedFromText } from '@shared/core/hash';
import { runPipeline, type World } from './gen/pipeline';
import { buildGraph, graphKey } from './graph/build';
import type { CellGraph } from './graph/types';
import { PRESETS } from './params/presets';
import { ALL_DEFS, DEF_BY_KEY, defaults, FIELD_OPTIONS, SECTIONS, VIEW_SECTION, type Params, type ParamValue, type Section } from './params/schema';
import { decodeState, encodeState } from '@shared/params/url';
import { fitCamera, screenToWorld, zoomAt, type Camera } from '@shared/render/camera';
import { Renderer } from './render/renderer';
import { buildPanel } from '@shared/ui/panel';
import { renderInspector, renderLegend, renderStats } from './ui/widgets';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ------------------------------------------------------------------ state
const initial = decodeState(location.hash, ALL_DEFS, 'cellgen');
let seedText = initial?.seed ?? 'cellgen';
let params: Params = initial?.params ?? defaults();
let world: World | null = null;
const graphCache = new Map<string, { g: CellGraph; ms: number }>();

const canvas = $<HTMLCanvasElement>('view');
const renderer = new Renderer(canvas);
renderer.view = { ...params };

// ------------------------------------------------------------------ panels
const viewKeys = new Set(VIEW_SECTION.params.map((d) => d.key));
const left = buildPanel($('left'), SECTIONS, params, onParam, resetSection);
const right = buildPanel($('viewPanel'), [VIEW_SECTION], params, onParam, resetSection);

function onParam(key: string, value: ParamValue, committed: boolean): void {
  if (params[key] === value) return;
  params = { ...params, [key]: value };
  left.sync(params);
  right.sync(params);
  if (viewKeys.has(key) || DEF_BY_KEY.get(key)?.view) {
    renderer.setView(params);
    rendererB?.setView({ ...rendererB.world!.params, ...pickView(params) });
    updateLegend();
    updateUrl();
    return;
  }
  scheduleGenerate(committed);
}

function pickView(p: Params): Params {
  const out: Params = {};
  for (const k of viewKeys) out[k] = p[k];
  return out;
}

function resetSection(s: Section): void {
  const d = defaults();
  const next = { ...params };
  for (const def of s.params) next[def.key] = d[def.key];
  applyParams(next);
}

function applyParams(next: Params): void {
  params = next;
  left.sync(params);
  right.sync(params);
  renderer.setView(params);
  scheduleGenerate(true);
}

// presets
const presetSel = $<HTMLSelectElement>('preset');
presetSel.innerHTML = `<option value="">Presets…</option>` + PRESETS.map((p) => `<option value="${p.id}" title="${p.description}">${p.name}</option>`).join('');
presetSel.addEventListener('change', () => {
  const p = PRESETS.find((x) => x.id === presetSel.value);
  presetSel.value = '';
  if (!p) return;
  applyParams({ ...defaults(), ...p.params });
  renderer.autoFit = true;
  toast(`${p.name} — ${p.description}`, 3200);
});

// seed
const seedInput = $<HTMLInputElement>('seed');
seedInput.value = seedText;
seedInput.addEventListener('change', () => {
  seedText = seedInput.value.trim() || 'cellgen';
  scheduleGenerate(true);
});
seedInput.addEventListener('keydown', (e) => e.stopPropagation());
const WORDS = ['amber', 'basalt', 'cedar', 'delta', 'ember', 'fjord', 'granite', 'heath', 'isle', 'juniper', 'karst', 'lagoon', 'moraine', 'nimbus', 'oasis', 'pumice', 'quartz', 'reef', 'steppe', 'tundra', 'umber', 'vale', 'willow', 'xeric', 'yarrow', 'zephyr'];
function randomSeed(): void {
  const a = WORDS[Math.floor(Math.random() * WORDS.length)];
  seedText = `${a}-${Math.floor(Math.random() * 9000 + 1000)}`;
  seedInput.value = seedText;
  scheduleGenerate(true);
}
$('dice').addEventListener('click', randomSeed);

// ------------------------------------------------------------------ generation
let lastGenMs = 0;
let genTimer = 0;
let genRaf = 0;
const busyEl = $('busy');

function scheduleGenerate(committed: boolean): void {
  clearTimeout(genTimer);
  if (lastGenMs > 90) {
    busyEl.hidden = false;
    genTimer = window.setTimeout(generate, committed ? 20 : 140);
    return;
  }
  if (!genRaf) genRaf = requestAnimationFrame(() => {
    genRaf = 0;
    generate();
  });
}

function generate(): void {
  const seed = seedFromText(seedText);
  const t0 = performance.now();
  try {
    const key = graphKey(params, seed);
    let cached = graphCache.get(key);
    if (!cached) {
      const g0 = performance.now();
      const g = buildGraph(params, seed);
      cached = { g, ms: performance.now() - g0 };
      graphCache.set(key, cached);
      while (graphCache.size > 4) graphCache.delete(graphCache.keys().next().value!);
    }
    const prev = world;
    world = runPipeline(cached.g, params, seed, cached.ms);
    renderer.setView(params);
    renderer.setWorld(world, !!prev);
    renderStats($('stats'), world);
    updateLegend();
    updateInspector();
    updateUrl();
  } catch (err) {
    console.error(err);
    toast(`Generation failed: ${(err as Error).message}`, 5000);
  }
  lastGenMs = performance.now() - t0;
  busyEl.hidden = true;
}

function updateLegend(): void {
  renderLegend($('legend'), renderer.rasterInfo ? null : renderer.legend, renderer.rasterInfo, world, String(params['view.field']));
}

let urlTimer = 0;
function updateUrl(): void {
  clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => {
    history.replaceState(null, '', `#${encodeState(seedText, params, ALL_DEFS)}`);
  }, 250);
}

window.addEventListener('hashchange', () => {
  const s = decodeState(location.hash, ALL_DEFS, 'cellgen');
  if (!s) return;
  if (encodeState(s.seed, s.params, ALL_DEFS) === encodeState(seedText, params, ALL_DEFS)) return;
  seedText = s.seed;
  seedInput.value = seedText;
  applyParams(s.params);
});

// ------------------------------------------------------------------ canvas sizing
const stage = $('stage');
function resize(): void {
  const r = stage.getBoundingClientRect();
  renderer.resize(r.width, r.height, window.devicePixelRatio || 1);
  if (rendererB) {
    rendererB.resize(r.width, r.height, window.devicePixelRatio || 1);
    layoutSplit();
  }
}
new ResizeObserver(resize).observe(stage);

// ------------------------------------------------------------------ camera animation
let anim = 0;
function animateTo(target: Camera, ms = 220): void {
  cancelAnimationFrame(anim);
  const from = { ...renderer.cam };
  const t0 = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - t0) / ms);
    const e = 1 - Math.pow(1 - t, 3);
    const lz = Math.log(from.zoom) + (Math.log(target.zoom) - Math.log(from.zoom)) * e;
    renderer.setCamera({ cx: from.cx + (target.cx - from.cx) * e, cy: from.cy + (target.cy - from.cy) * e, zoom: Math.exp(lz) }, t >= 1);
    if (t < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}
function zoomBy(f: number, sx?: number, sy?: number): void {
  const [lo, hi] = renderer.zoomLimits();
  const vp = renderer.vp;
  animateTo(zoomAt(renderer.cam, vp, sx ?? vp.w / 2, sy ?? vp.h / 2, f, lo, hi));
}
function fitView(): void {
  if (!world) return;
  animateTo(fitCamera(world.graph.W, world.graph.H, renderer.vp));
  window.setTimeout(() => (renderer.autoFit = true), 260);
}
$('zin').addEventListener('click', () => zoomBy(1.6));
$('zout').addEventListener('click', () => zoomBy(1 / 1.6));
$('zfit').addEventListener('click', fitView);

// ------------------------------------------------------------------ pointer interaction
const pointers = new Map<number, { x: number; y: number }>();
let dragMoved = false;
let pinchDist = 0;
let downAt = { x: 0, y: 0 };

function local(e: PointerEvent | WheelEvent | MouseEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cancelAnimationFrame(anim);
  const [x, y] = local(e);
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  const f = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016));
  const [lo, hi] = renderer.zoomLimits();
  renderer.setCamera(zoomAt(renderer.cam, renderer.vp, x, y, f, lo, hi));
  updateStatus();
}, { passive: false });

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const [x, y] = local(e);
  pointers.set(e.pointerId, { x, y });
  dragMoved = false;
  downAt = { x, y };
  cancelAnimationFrame(anim);
  if (pointers.size === 2) {
    const [a, b] = Array.from(pointers.values());
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
});

canvas.addEventListener('pointermove', (e) => {
  const [x, y] = local(e);
  const p = pointers.get(e.pointerId);
  if (p) {
    if (pointers.size === 1) {
      if (Math.hypot(x - downAt.x, y - downAt.y) > 3) dragMoved = true;
      if (dragMoved) {
        canvas.classList.add('dragging');
        const c = renderer.cam;
        renderer.setCamera({ ...c, cx: c.cx - (x - p.x) / c.zoom, cy: c.cy - (y - p.y) / c.zoom });
      }
    } else if (pointers.size === 2) {
      dragMoved = true;
      const others = Array.from(pointers.entries()).filter(([id]) => id !== e.pointerId);
      const o = others[0][1];
      const d = Math.hypot(x - o.x, y - o.y);
      const mx = (x + o.x) / 2;
      const my = (y + o.y) / 2;
      const pmx = (p.x + o.x) / 2;
      const pmy = (p.y + o.y) / 2;
      const [lo, hi] = renderer.zoomLimits();
      let c = renderer.cam;
      c = { ...c, cx: c.cx - (mx - pmx) / c.zoom, cy: c.cy - (my - pmy) / c.zoom };
      if (pinchDist > 0) c = zoomAt(c, renderer.vp, mx, my, d / pinchDist, lo, hi);
      pinchDist = d;
      renderer.setCamera(c);
    }
    p.x = x;
    p.y = y;
    updateStatus();
  }
  hoverAt(x, y);
});

function endPointer(e: PointerEvent): void {
  const wasSingle = pointers.size === 1;
  pointers.delete(e.pointerId);
  canvas.classList.remove('dragging');
  if (pointers.size < 2) pinchDist = 0;
  if (wasSingle && !dragMoved && e.type === 'pointerup' && world) {
    const [x, y] = local(e);
    const [wx, wy] = screenToWorld(renderer.cam, renderer.vp, x, y);
    const i = wx >= 0 && wy >= 0 && wx < world.graph.W && wy < world.graph.H ? world.graph.cellAt(wx, wy) : -1;
    renderer.selected = renderer.selected === i ? -1 : i;
    renderer.requestDraw();
    updateInspector();
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => {
  if (pointers.size) return;
  renderer.hover = -1;
  renderer.cursor = null;
  renderer.requestDraw();
  updateInspector();
});
canvas.addEventListener('dblclick', (e) => {
  const [x, y] = local(e);
  zoomBy(e.shiftKey ? 1 / 2 : 2, x, y);
});

let hoverRaf = 0;
let hoverXY: [number, number] = [0, 0];
function hoverAt(x: number, y: number): void {
  hoverXY = [x, y];
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    if (!world) return;
    const [wx, wy] = screenToWorld(renderer.cam, renderer.vp, hoverXY[0], hoverXY[1]);
    const inside = wx >= 0 && wy >= 0 && wx < world.graph.W && wy < world.graph.H;
    const i = inside ? world.graph.cellAt(wx, wy) : -1;
    renderer.cursor = inside ? [wx, wy] : null;
    if (i !== renderer.hover) {
      renderer.hover = i;
      renderer.requestDraw();
    }
    updateInspector();
    updateStatus();
  });
}

function updateInspector(): void {
  const i = renderer.selected >= 0 ? renderer.selected : renderer.hover;
  renderInspector($('inspector'), world, i, renderer.cursor, renderer.selected >= 0);
}

// ------------------------------------------------------------------ status bar & minimap
const statusEl = $('status');
function niceLength(target: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [1, 2, 5, 10]) if (m * p >= target) return m * p;
  return 10 * p;
}
function updateStatus(): void {
  if (!world) return;
  const fit = fitCamera(world.graph.W, world.graph.H, renderer.vp).zoom;
  const z = renderer.cam.zoom / fit;
  const L = niceLength(90 / renderer.cam.zoom);
  const px = L * renderer.cam.zoom;
  const cur = renderer.cursor ? `${renderer.cursor[0].toFixed(1)}, ${renderer.cursor[1].toFixed(1)}` : '—';
  const cellPx = world.graph.spacing * renderer.cam.zoom;
  statusEl.innerHTML =
    `<span>zoom <b>${z < 10 ? z.toFixed(2) : z.toFixed(0)}×</b></span>` +
    `<span>cell ≈ <b>${cellPx.toFixed(cellPx < 10 ? 1 : 0)} px</b></span>` +
    `<span>cursor <b>${cur}</b></span>` +
    `<span>${world.graph.n.toLocaleString()} cells · ${world.graph.W}×${world.graph.H} u</span>` +
    (renderer.rasterProgress !== null ? `<span class="rendering">rendering ${(renderer.rasterProgress * 100).toFixed(0)}%</span>` : '') +
    `<span class="scalebar"><i style="width:${px.toFixed(0)}px"></i><b>${L} u</b></span>`;
}

const mini = $<HTMLCanvasElement>('minimap');
function drawMinimap(): void {
  if (!world) return;
  const W = mini.clientWidth || 200;
  const H = Math.round((W * world.graph.H) / world.graph.W);
  const dpr = window.devicePixelRatio || 1;
  if (mini.width !== W * dpr || mini.height !== H * dpr) {
    mini.width = W * dpr;
    mini.height = H * dpr;
    mini.style.height = `${H}px`;
  }
  const ctx = mini.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(renderer.overview, 0, 0, W, H);
  const s = W / world.graph.W;
  const c = renderer.cam;
  const vw = renderer.vp.w / c.zoom;
  const vh = renderer.vp.h / c.zoom;
  ctx.strokeStyle = '#fde725';
  ctx.lineWidth = 1.5;
  ctx.fillStyle = 'rgba(253,231,37,0.08)';
  const rx = (c.cx - vw / 2) * s;
  const ry = (c.cy - vh / 2) * s;
  ctx.fillRect(rx, ry, vw * s, vh * s);
  ctx.strokeRect(rx, ry, vw * s, vh * s);
}
renderer.onFrame = () => {
  drawMinimap();
  updateStatus();
  syncCompare();
};

// ------------------------------------------------------------------ A/B compare
// B is a second renderer on an overlaid canvas, clipped with CSS to the right of the
// split and kept on A's camera, so both worlds are inspected at the same place.
const canvasB = $<HTMLCanvasElement>('viewB');
const splitter = $('splitter');
let rendererB: Renderer | null = null;
let splitX = 0.5;
let compareLabel = '';

function syncCompare(): void {
  if (!rendererB) return;
  const c = renderer.cam;
  rendererB.setCamera({ ...c }, !renderer.busy);
}
function layoutSplit(): void {
  const w = renderer.vp.w;
  const x = Math.round(splitX * w);
  canvasB.style.clipPath = `inset(0 0 0 ${x}px)`;
  splitter.style.left = `${x}px`;
}
function startCompare(): void {
  if (!world) return;
  rendererB = new Renderer(canvasB);
  rendererB.view = { ...params };
  const r = stage.getBoundingClientRect();
  rendererB.resize(r.width, r.height, window.devicePixelRatio || 1);
  rendererB.setWorld(world, false);
  rendererB.setCamera({ ...renderer.cam }, true);
  canvasB.hidden = false;
  splitter.hidden = false;
  compareLabel = `B · pinned (${seedText}, ${world.graph.n.toLocaleString()} cells, ${world.fingerprint})`;
  splitter.querySelector('.tagB')!.textContent = compareLabel;
  $('compare').classList.add('active');
  layoutSplit();
  toast('World pinned as B — change parameters to compare with A', 2600);
}
function stopCompare(): void {
  rendererB = null;
  canvasB.hidden = true;
  splitter.hidden = true;
  $('compare').classList.remove('active');
}
$('compare').addEventListener('click', () => (rendererB ? stopCompare() : startCompare()));
const handle = splitter.querySelector('.handle') as HTMLElement;
handle.addEventListener('pointerdown', (e) => {
  handle.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    splitX = Math.min(0.98, Math.max(0.02, (ev.clientX - r.left) / r.width));
    layoutSplit();
  };
  const up = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
});
let miniDrag = false;
function miniMove(e: PointerEvent): void {
  if (!world) return;
  const r = mini.getBoundingClientRect();
  const s = r.width / world.graph.W;
  renderer.setCamera({ ...renderer.cam, cx: (e.clientX - r.left) / s, cy: (e.clientY - r.top) / s });
}
mini.addEventListener('pointerdown', (e) => {
  miniDrag = true;
  mini.setPointerCapture(e.pointerId);
  cancelAnimationFrame(anim);
  miniMove(e);
});
mini.addEventListener('pointermove', (e) => miniDrag && miniMove(e));
mini.addEventListener('pointerup', () => (miniDrag = false));

// ------------------------------------------------------------------ keyboard
const fieldIds = FIELD_OPTIONS.map((o) => o.value);
window.addEventListener('keydown', (e) => {
  const tgt = e.target as HTMLElement;
  if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'SELECT' || tgt.tagName === 'TEXTAREA')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const pan = 120 / renderer.cam.zoom;
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
      fitView();
      break;
    case 'ArrowLeft':
      animateTo({ ...renderer.cam, cx: renderer.cam.cx - pan }, 120);
      break;
    case 'ArrowRight':
      animateTo({ ...renderer.cam, cx: renderer.cam.cx + pan }, 120);
      break;
    case 'ArrowUp':
      animateTo({ ...renderer.cam, cy: renderer.cam.cy - pan }, 120);
      break;
    case 'ArrowDown':
      animateTo({ ...renderer.cam, cy: renderer.cam.cy + pan }, 120);
      break;
    case 'r':
    case 'R':
      randomSeed();
      break;
    case 'e':
    case 'E':
      onParam('view.edges', !params['view.edges'], true);
      break;
    case '[':
    case ']': {
      const k = fieldIds.indexOf(String(params['view.field']));
      const n = (k + (e.key === ']' ? 1 : -1) + fieldIds.length) % fieldIds.length;
      onParam('view.field', fieldIds[n], true);
      break;
    }
    case 'c':
    case 'C':
      if (rendererB) stopCompare();
      else startCompare();
      break;
    case 'Escape':
      renderer.selected = -1;
      renderer.requestDraw();
      updateInspector();
      break;
    case '?':
      ($('helpDlg') as HTMLDialogElement).showModal();
      break;
    default:
      return;
  }
  e.preventDefault();
});

// ------------------------------------------------------------------ toolbar actions
let toastTimer = 0;
function toast(msg: string, ms = 1800): void {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), ms);
}

$('share').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#${encodeState(seedText, params, ALL_DEFS)}`;
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied to clipboard');
  } catch {
    toast('Link is in the address bar');
  }
});

function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const safeSeed = () => seedText.replace(/[^\w-]+/g, '_');
$('png').addEventListener('click', () => {
  canvas.toBlob((b) => b && download(b, `cellgen-${safeSeed()}.png`), 'image/png');
});
$('json').addEventListener('click', () => {
  if (!world) return;
  const g = world.graph;
  const r3 = (a: ArrayLike<number>) => Array.from(a, (v) => Math.round(v * 1000) / 1000);
  const data = {
    generator: 'cellgen sandbox 1',
    seed: seedText,
    params,
    fingerprint: world.fingerprint,
    width: g.W,
    height: g.H,
    kind: g.kind,
    cells: {
      count: g.n,
      x: r3(g.x),
      y: r3(g.y),
      siteX: r3(g.sx),
      siteY: r3(g.sy),
      area: r3(g.area),
      neighborOffsets: Array.from(g.nbrOff),
      neighbors: Array.from(g.nbr),
      polygonOffsets: g.poly ? Array.from(g.poly.off) : null,
      polygonXY: g.poly ? r3(g.poly.xy) : null,
    },
    fields: {
      elevation: r3(world.elevation),
      water: Array.from(world.water),
      temperature: r3(world.temperature),
      moisture: r3(world.moisture),
      biome: Array.from(world.biome),
      flux: world.drainage ? r3(world.drainage.flux) : null,
      downhill: world.drainage ? Array.from(world.drainage.downhill) : null,
      plate: world.plates ? Array.from(world.plates.plateId) : null,
      cave: world.ca ? Array.from(world.ca.state) : null,
      network: world.paths ? Array.from(world.paths.cells) : null,
    },
    colonization: world.sca ? { x: r3(world.sca.nx), y: r3(world.sca.ny), parent: Array.from(world.sca.parent), radius: r3(world.sca.radius) } : null,
  };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `cellgen-${safeSeed()}.json`);
});
$('resetAll').addEventListener('click', () => {
  applyParams(defaults());
  toast('All parameters reset');
});
$('help').addEventListener('click', () => ($('helpDlg') as HTMLDialogElement).showModal());
$('toggleRight').addEventListener('click', () => {
  const open = $('right').classList.toggle('open');
  $('toggleRight').textContent = open ? 'Display ◂' : 'Display ▸';
});
$('legend').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).classList.contains('lg-title')) $('legend').classList.toggle('min');
});

// ------------------------------------------------------------------ go
resize();
generate();

// Console access for experiments: window.cellgen.world, .renderer, .params
Object.assign(window, {
  cellgen: {
    get world() {
      return world;
    },
    get params() {
      return params;
    },
    renderer,
  },
});
