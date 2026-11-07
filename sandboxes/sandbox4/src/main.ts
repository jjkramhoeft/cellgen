/**
 * Sandbox 4 · Terrain (Sandbox 3 plus a height map and a 3D view).
 *
 * Generation: an unbounded world (metres) of three nested Voronoi levels — regions,
 * biomes, subbiomes — with ocean seeds / links / growth and random merges
 * (src/world). Everything is a lazily memoised pure function of seed + parameters.
 *
 * Display: a progressive per-pixel raster (shared RasterLayer) with pixel-exact
 * borders at every level, vector overlays (seeds, links, growth and merge arrows,
 * sites, km grid, ruler), an inspector and statistics for the current view.
 */
import './style.css';
import { seedFromText } from '@shared/core/hash';
import { str, type Params, type ParamValue, type Section } from '@shared/params/schema';
import { decodeState, encodeState } from '@shared/params/url';
import { screenToWorld, zoomAt, type Camera, type Viewport } from '@shared/render/camera';
import { RasterLayer } from '@shared/render/raster';
import { buildPanel } from '@shared/ui/panel';
import { ALL_DEFS, defaults, GEN_KEYS, PRESETS, RIVER_KEYS, RIVER_SECTION, FLOODPLAIN_SECTION, GRADIENT_SECTION, SECTIONS, TERRAIN_KEYS, TERRAIN_SECTION, toRiverParams, toTerrainParams, toWorldParams, VIEW_MODES, VIEW_SECTION } from './params';
import { drawGrid, drawGrowth, drawLinks, drawMerges, drawRivers, drawRuler, drawSites, fmtDist, niceStep, type Frame } from './render/overlays';
import { DETAIL_PX, mapSource, type ViewMode, type ViewOpts } from './render/source';
import { computeViewStats, renderInspector, renderLegend, renderLevels, renderRuler, renderStats, type ViewStats } from './ui/widgets';
import { buildMesh, View3D, type HeightGrid } from './render/view3d';
import { Rivers } from './world/rivers';
import { FLOOD_REF_FLOW, monotoneSpline, Terrain } from './world/terrain';
import type { FromTerrainWorker, ToTerrainWorker } from './world/terrain.worker';
import { keyI, keyJ } from './world/level';
import { World } from './world/world';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const DEFAULT_SEED = 'cellgen';
/** CSS px per metre */
const MIN_ZOOM = 1e-4;
const MAX_ZOOM = 0.25;
/** width of the home view, metres */
const HOME_SPAN = 1_000_000;
const CACHE_LIMIT = 900_000;
/** the terrain is skipped when the view touches more regions than this (at 1 km cells; scales with the cell area) */
const TERRAIN_MAX_REGIONS = 64;
/** 3D mesh resolution (vertices across) */
const MESH_COLS = 320;

// ------------------------------------------------------------------ state

const initial = decodeState(location.hash, ALL_DEFS, DEFAULT_SEED);
let seedText = initial?.seed ?? DEFAULT_SEED;
let params: Params = initial?.params ?? defaults();

let world!: World;
let rivers!: Rivers;
let terrain!: Terrain;
/** bumped when new terrain rasters are ready (part of the raster key, so the map re-renders) */
let terrainVer = 0;
/** terrain tiles around the view still being computed (-1 = view too large) */
let terrainPending = 0;
let terrainBump = 0;
/** parameter generation of the terrain (tiles from an older one are dropped) */
let terrainGen = 0;
/** tiles received from the worker since the last frame */
let tilesArrived = 0;
/** the missing tiles last asked of the worker (comma-joined) */
let tilesWanted = '';
/** the 3D mesh/texture are stale */
let dirty3d = true;
/** regions around the view whose rivers are still being computed */
let riverPending = 0;
let genId = 0;
let fingerprint = '';
let stats: ViewStats | null = null;
let hover: { x: number; y: number } | null = null;
let pinned: { x: number; y: number } | null = null;
let pinBiome = -1;
let pinSub = -1;
let measuring = false;
let ruler: { ax: number; ay: number; bx: number; by: number } | null = null;
const timings = { render: 0 };

// ------------------------------------------------------------------ canvas & camera

const canvas = $<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d', { alpha: false })!;
const layer = new RasterLayer();
let vp: Viewport = { w: 1, h: 1 };
let cam: Camera = { cx: 0, cy: 0, zoom: 1e-3 };
let homed = true;
let lastInteract = 0;
let renderStart = 0;
let renderScale = 0;

function homeCamera(): Camera {
  return { cx: 0, cy: 0, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(vp.w, vp.h * 1.6) / HOME_SPAN)) };
}

/** camera from the URL: at=x_km,y_km,metres_per_px */
function camFromUrl(): Camera | null {
  const at = new URLSearchParams(location.hash.replace(/^#/, '')).get('at');
  if (!at) return null;
  const [x, y, mpp] = at.split(',').map(Number);
  if (![x, y, mpp].every(Number.isFinite) || mpp <= 0) return null;
  return { cx: x * 1000, cy: y * 1000, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, 1 / mpp)) };
}
const urlCam = camFromUrl();
if (urlCam) {
  cam = urlCam;
  homed = false;
}

// ------------------------------------------------------------------ panels

const leftPanel = buildPanel($('left'), [...SECTIONS, RIVER_SECTION, TERRAIN_SECTION, FLOODPLAIN_SECTION, GRADIENT_SECTION], params, onParam, resetSection);

/** Live plot of the floodplain curve (half-width over bed height) in its panel section. */
function renderFloodPlot(): void {
  const body = document.querySelector<HTMLElement>('#left section[data-id="floodplain"] .sec-body');
  if (!body) return;
  let host = body.querySelector<HTMLElement>('.flood-plot');
  if (!host) {
    host = document.createElement('div');
    host.className = 'flood-plot';
    body.querySelector('.sec-help')?.after(host);
  }
  const hs = [1, 2, 3, 4].map((i) => Number(params[`hgt.fp.h${i}`]));
  const ws = [1, 2, 3, 4].map((i) => Number(params[`hgt.fp.w${i}`]));
  const f = monotoneSpline(hs, ws);
  const W = 240;
  const H = 110;
  const pl = 34;
  const pb = 18;
  const xMax = Math.max(500, ...hs) * 1.15;
  const yMax = Math.max(50, ...ws) * 1.15;
  const X = (h: number) => pl + (h / xMax) * (W - pl - 6);
  const Y = (w: number) => H - pb - (w / yMax) * (H - pb - 6);
  let d = '';
  for (let k = 0; k <= 80; k++) {
    const h = (xMax * k) / 80;
    d += `${k ? 'L' : 'M'}${X(h).toFixed(1)},${Y(f(h)).toFixed(1)}`;
  }
  const dots = hs.map((h, i) => `<circle cx="${X(h).toFixed(1)}" cy="${Y(ws[i]).toFixed(1)}" r="3" fill="#fde725"><title>Point ${i + 1}: ${h} m → ${ws[i]} m</title></circle>`).join('');
  const flow = params['hgt.fp.flow'] === true ? ` · flow ${FLOOD_REF_FLOW}` : '';
  host.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Floodplain half-width over river bed height">` +
    `<line x1="${pl}" y1="${H - pb}" x2="${W - 4}" y2="${H - pb}" stroke="currentColor" stroke-opacity=".35"/>` +
    `<line x1="${pl}" y1="4" x2="${pl}" y2="${H - pb}" stroke="currentColor" stroke-opacity=".35"/>` +
    `<path d="${d}" fill="none" stroke="#5aa0ff" stroke-width="2"/>${dots}` +
    `<text x="${pl}" y="${H - 4}" font-size="9" fill="currentColor" opacity=".7">0</text>` +
    `<text x="${W - 4}" y="${H - 4}" font-size="9" fill="currentColor" opacity=".7" text-anchor="end">${Math.round(xMax)} m bed height</text>` +
    `<text x="${pl - 4}" y="10" font-size="9" fill="currentColor" opacity=".7" text-anchor="end">${Math.round(yMax)}</text>` +
    `<text x="${pl - 4}" y="${H - pb}" font-size="9" fill="currentColor" opacity=".7" text-anchor="end">0 m</text>` +
    `<text x="${W - 4}" y="12" font-size="9" fill="currentColor" opacity=".7" text-anchor="end">half-width${flow}</text>` +
    `</svg>`;
}
renderFloodPlot();
const viewPanel = buildPanel($('viewPanel'), [VIEW_SECTION], params, onParam, resetSection);
$('statsSec').querySelector('.sec-head')!.addEventListener('click', () => {
  $('statsSec').classList.toggle('collapsed');
  scheduleStats();
});

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
  renderFloodPlot();
  const gen = Object.keys(patch).some((k) => GEN_KEYS.has(k) && before[k] !== params[k]);
  if (gen) regenerate();
  else {
    // river settings rebuild only the rivers (and the terrain on them), never the map
    const changed = (keys: Set<string>) => Object.keys(patch).some((k) => keys.has(k) && before[k] !== params[k]);
    const riv = changed(RIVER_KEYS);
    if (riv) rivers = new Rivers(world, toRiverParams(params));
    if (riv || changed(TERRAIN_KEYS)) newTerrain();
    viewChanged();
  }
}

// ------------------------------------------------------------------ generation

let fpTimer = 0;
function regenerate(): void {
  world = new World(toWorldParams(params, seedFromText(seedText)));
  rivers = new Rivers(world, toRiverParams(params));
  newTerrain();
  genId++;
  timings.render = 0;
  fingerprint = '';
  stats = null;
  refreshPins();
  clearTimeout(fpTimer);
  fpTimer = window.setTimeout(() => {
    const id = genId;
    const fp = world.fingerprint();
    if (id === genId) {
      fingerprint = fp;
      renderStatsPanel();
    }
  }, 700);
  viewChanged();
}

/** Terrain tiles are computed in a worker; without one (very old browsers) on the main thread. */
const terrainWorker: Worker | null = (() => {
  try {
    const wk = new Worker(new URL('./world/terrain.worker.ts', import.meta.url), { type: 'module' });
    wk.onmessage = (e: MessageEvent<FromTerrainWorker>) => {
      const m = e.data;
      if (m.kind !== 'tile' || m.gen !== terrainGen) return;
      terrain.put(m.tile);
      tilesArrived++;
      invalidate();
    };
    wk.onerror = (e) => console.error('terrain worker', e.message);
    return wk;
  } catch {
    return null;
  }
})();

function toWorker(m: ToTerrainWorker): void {
  terrainWorker?.postMessage(m);
}

function newTerrain(): void {
  terrain = new Terrain(world, rivers, toTerrainParams(params));
  terrainGen++;
  tilesWanted = '';
  tilesArrived = 0;
  toWorker({ kind: 'gen', gen: terrainGen, world: world.p, rivers: rivers.p, terrain: terrain.p });
  terrainVer++;
  dirty3d = true;
}

/** Does the current display need the height map? */
function needTerrain(): boolean {
  return params['view.3d'] === true || params['view.hillshade'] === true || str(params, 'view.color') === 'height';
}

/** Ask the worker for exactly these tiles (nearest first), unless that is what it already has. */
function wantTiles(keys: number[]): void {
  const sig = keys.join(',');
  if (sig === tilesWanted) return;
  tilesWanted = sig;
  toWorker({ kind: 'want', gen: terrainGen, tiles: keys });
}

/**
 * Get the terrain tiles around the view: requested from the worker (or, without one,
 * computed here until `deadline`). Returns how many are still missing (-1 when the
 * view spans too many regions).
 */
function prepareTerrain(deadline: number): number {
  const [x0, y0] = screenToWorld(cam, vp, 0, 0);
  const [x1, y1] = screenToWorld(cam, vp, vp.w, vp.h);
  const R = world.regionLevel;
  const budget = TERRAIN_MAX_REGIONS * (terrain.p.res / 1000) ** 2;
  if (World.countIn(R, x0, y0, x1, y1, 1) > budget) {
    terrain.setNeeded([]);
    wantTiles([]);
    return -1;
  }
  // tiles of the regions around the view, nearest tile centre first
  const span = R.size * terrain.k;
  const dist = (t: number) => {
    return ((keyI(t) + 0.5) * span - cam.cx) ** 2 + ((keyJ(t) + 0.5) * span - cam.cy) ** 2;
  };
  const tiles = terrain.tilesIn(x0, y0, x1, y1).sort((a, b) => dist(a) - dist(b));
  terrain.setNeeded(tiles);
  if (terrainWorker) wantTiles(tiles.filter((k) => !terrain.hasTile(k)));
  else {
    for (const k of tiles) {
      if (terrain.hasTile(k)) continue;
      if (performance.now() > deadline) break;
      terrain.getTile(k);
      tilesArrived++;
    }
  }
  const pending = tiles.filter((k) => !terrain.hasTile(k)).length;
  // re-render the map when everything is in, or every ~1.5 s while tiles arrive
  const now = performance.now();
  if (tilesArrived > 0) {
    if (pending === 0 || now - terrainBump > 1500) {
      tilesArrived = 0;
      terrainVer++;
      terrainBump = now;
      dirty3d = true;
    } else window.setTimeout(invalidate, 1500 - (now - terrainBump) + 10);
  }
  return pending;
}

function refreshPins(): void {
  if (!pinned) {
    pinBiome = pinSub = -1;
    return;
  }
  const c = world.cellAt(pinned.x, pinned.y, true);
  pinBiome = c.biome;
  pinSub = c.sub;
}

function viewOpts(): ViewOpts {
  return {
    mode: str(params, 'view.color') as ViewMode,
    regEdges: params['view.regEdges'] === true,
    bioEdges: params['view.bioEdges'] === true,
    subEdges: params['view.subEdges'] === true,
    coast: params['view.coast'] === true,
    lod: str(params, 'view.lod') as 'auto' | 'full',
    pinBiome,
    pinSub,
    hillshade: params['view.hillshade'] === true,
  };
}

/** Anything that changes the picture but not the world. */
function viewChanged(): void {
  dirty3d = true;
  show3d();
  renderLegend($('legend'), viewOpts().mode, stats ? stats.oceanShare : null, world.p.growPasses);
  updateInspector();
  writeUrl();
  scheduleStats();
  invalidate();
}

let urlTimer = 0;
function writeUrl(): void {
  clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => history.replaceState(null, '', urlHash()), 200);
}

function urlHash(): string {
  const at = `${+(cam.cx / 1000).toFixed(3)},${+(cam.cy / 1000).toFixed(3)},${+(1 / cam.zoom).toPrecision(4)}`;
  return `#${encodeState(seedText, params, ALL_DEFS)}&at=${at}`;
}

let statsTimer = 0;
function scheduleStats(): void {
  clearTimeout(statsTimer);
  statsTimer = window.setTimeout(() => {
    if ($('statsSec').classList.contains('collapsed')) return;
    const [x0, y0] = screenToWorld(cam, vp, 0, 0);
    const [x1, y1] = screenToWorld(cam, vp, vp.w, vp.h);
    stats = computeViewStats(world, x0, y0, x1, y1, detailOn(), params['riv.on'] === true ? rivers : null);
    renderStatsPanel();
    if (str(params, 'view.color') === 'landsea') renderLegend($('legend'), 'landsea', stats.oceanShare, world.p.growPasses);
  }, 350);
}

function renderStatsPanel(): void {
  renderStats($('stats'), world, stats, { fingerprint, render: timings.render, cache: world.cacheStats });
}

function detailOn(): boolean {
  return str(params, 'view.lod') === 'full' || world.subLevel.size * cam.zoom * (window.devicePixelRatio || 1) >= DETAIL_PX;
}

// ------------------------------------------------------------------ render loop

let raf = 0;
let idleTimer = 0;
let lastFrame = 0;
function invalidate(): void {
  if (!raf) raf = requestAnimationFrame(frame);
}

function frame(): void {
  raf = 0;
  const dpr = window.devicePixelRatio || 1;
  const now = performance.now();
  const interacting = now - lastInteract < 160;
  world.trim(CACHE_LIMIT);
  const useTerrain = needTerrain();
  terrainPending = 0;
  if (useTerrain) terrainPending = prepareTerrain(interacting ? 0 : now + 120);
  const src = mapSource(world, `g${genId}`, viewOpts(), useTerrain ? terrain : null, terrainVer);
  const fresh = !layer.hasContentFor(src.key);
  // coarse first while moving or when the content is new, then full resolution
  const preview = Math.max(0.25, dpr * 0.3);
  let scale = interacting || fresh ? preview : dpr;
  if (scale === dpr && layer.busy && layer.isCurrent(src, cam, vp, preview)) scale = preview;
  if (!layer.isCurrent(src, cam, vp, scale) && !(scale < dpr && layer.isCurrent(src, cam, vp, dpr))) {
    layer.start(src, cam, vp, scale);
    renderStart = now;
    renderScale = scale;
  }
  // the slice grows when frames arrive slowly (throttled or background tabs)
  const gap = lastFrame > 0 ? now - lastFrame : 16;
  lastFrame = now;
  const budget = Math.min(60, Math.max(renderScale < dpr ? 40 : 14, gap * 0.6));
  const busy = layer.step(now + budget);
  if (!busy && renderScale === dpr && renderStart > 0) {
    timings.render = performance.now() - renderStart;
    renderStart = 0;
    renderStatsPanel();
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b0e13';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  layer.draw(ctx, cam, vp, dpr, src.key, true, true);

  const [x0, y0] = screenToWorld(cam, vp, 0, 0);
  const [x1, y1] = screenToWorld(cam, vp, vp.w, vp.h);
  const f: Frame = { ctx, cam, vp, dpr, x0, y0, x1, y1 };
  // rivers: cached regions always; new regions are computed between interactions
  riverPending = 0;
  if (params['riv.on'] === true) {
    riverPending = drawRivers(
      f,
      rivers,
      { width: Number(params['view.riverWidth']), minFlow: Number(params['view.riverMin']), attractors: params['view.attractors'] === true, sea: params['view.riverSea'] === true, exp: Number(params['view.riverExp']) },
      interacting ? 0 : performance.now() + Math.max(12, budget * 0.6),
    );
  }
  // vector overlays only once the raster is settled (they trigger the same lazy work)
  if (!layer.busy || !interacting) {
    if (params['view.grid'] === true) drawGrid(f);
    if (params['view.mergeArrows'] === true) drawMerges(f, world);
    if (params['view.growth'] === true) drawGrowth(f, world);
    if (params['view.links'] === true) drawLinks(f, world);
    const sites = str(params, 'view.sites');
    if (sites !== 'none') drawSites(f, world, sites);
  }
  if (ruler) drawRuler(f, ruler.ax, ruler.ay, ruler.bx, ruler.by);

  updateStatus(layer.busy ? layer.progress : 1);
  renderLevels($('levels'), world, cam.zoom, detailOn());
  const terrainBusy = terrainPending > 0;
  $('busy').hidden = !layer.busy && riverPending === 0 && !terrainBusy;
  if (params['view.3d'] === true) update3d(!layer.busy && riverPending === 0 && !terrainBusy && !interacting);
  // with a worker, arriving tiles wake the loop (no need to spin while it works)
  if (layer.busy || riverPending > 0 || (terrainBusy && !terrainWorker)) invalidate();
  else if (interacting || fresh) {
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(invalidate, 170);
  }
}

// ------------------------------------------------------------------ status, inspector

function updateStatus(progress: number): void {
  const len = niceStep(100 / cam.zoom);
  const px = len * cam.zoom;
  const pos = hover ? `<span><b>${(hover.x / 1000).toFixed(1)}</b>, <b>${(hover.y / 1000).toFixed(1)}</b> km</span>` : '<span>—</span>';
  const mpp = 1 / cam.zoom;
  $('status').innerHTML =
    pos +
    `<span title="Metres per CSS pixel">${mpp >= 1000 ? `<b>${(mpp / 1000).toFixed(2)}</b> km/px` : `<b>${mpp.toFixed(0)}</b> m/px`}</span>` +
    `<span title="Width of the view">view <b>${fmtDist(vp.w / cam.zoom)}</b></span>` +
    (progress < 1 ? `<span class="rendering">rendering ${(progress * 100).toFixed(0)}%</span>` : '') +
    (riverPending > 0 ? `<span class="rendering" title="Regions whose rivers are still growing">rivers: ${riverPending} regions to go</span>` : '') +
    (terrainPending > 0 ? `<span class="rendering" title="Terrain tiles (${terrain.k} × ${terrain.k} regions) still being computed">terrain: ${terrainPending} tile${terrainPending === 1 ? '' : 's'} to go</span>` : '') +
    (terrainPending < 0 ? `<span title="The height map is computed per tile of regions; zoom in to see it">terrain: zoom in</span>` : '') +
    `<span class="scalebar"><i style="width:${px.toFixed(0)}px"></i>${fmtDist(len)}</span>`;
}

function updateInspector(): void {
  const pt = pinned ?? hover;
  renderInspector($('inspector'), world, params['riv.on'] === true ? rivers : null, pt ? { ...pt, pinned: !!pinned } : null, needTerrain() ? terrain : null);
}

let inspectTimer = 0;
function scheduleInspector(): void {
  if (pinned) return;
  if (inspectTimer) return;
  inspectTimer = window.setTimeout(() => {
    inspectTimer = 0;
    updateInspector();
  }, 40);
}

// ------------------------------------------------------------------ 3D landscape

const canvas3d = $<HTMLCanvasElement>('view3d');
const view3d = new View3D(canvas3d);
view3d.onPan = (dxKm, dzKm) => setCam({ ...cam, cx: cam.cx + dxKm * 1000, cy: cam.cy + dzKm * 1000 });
let has3d = false;

function show3d(): void {
  const on = params['view.3d'] === true;
  if (on && !view3d.supported) {
    toast('WebGL2 is not available in this browser');
    return;
  }
  // the 2D map (with its progress) stays visible until the first 3D picture is built
  canvas3d.hidden = !(on && has3d);
  if (on) view3d.requestDraw();
}

/** Rebuild the mesh and re-drape the map once the 2D picture is settled (map, rivers and terrain all done). */
function update3d(settled: boolean): void {
  if (!view3d.supported || !dirty3d || !settled) return;
  const [x0, y0] = screenToWorld(cam, vp, 0, 0);
  const [x1, y1] = screenToWorld(cam, vp, vp.w, vp.h);
  const cols = MESH_COLS;
  const rows = Math.max(2, Math.round((cols * vp.h) / vp.w));
  const h = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const y = y0 + ((y1 - y0) * j) / (rows - 1);
    for (let i = 0; i < cols; i++) h[j * cols + i] = terrain.heightAt(x0 + ((x1 - x0) * i) / (cols - 1), y);
  }
  const grid: HeightGrid = { cols, rows, x0, y0, x1, y1, h };
  view3d.setData(buildMesh(grid, Number(params['view.exag'])), canvas);
  has3d = true;
  dirty3d = false;
  canvas3d.hidden = false;
}

// ------------------------------------------------------------------ interaction

function setCam(c: Camera): void {
  cam = c;
  dirty3d = true;
  homed = false;
  lastInteract = performance.now();
  writeUrl();
  scheduleStats();
  invalidate();
}

function zoomBy(f: number, sx = vp.w / 2, sy = vp.h / 2): void {
  setCam(zoomAt(cam, vp, sx, sy, f, MIN_ZOOM, MAX_ZOOM));
}

function home(): void {
  setCam(homeCamera());
  homed = true;
}

new ResizeObserver(() => {
  const rect = canvas.parentElement!.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  vp = { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  if (homed) cam = homeCamera();
  canvas3d.width = canvas.width;
  canvas3d.height = canvas.height;
  dirty3d = true;
  view3d.requestDraw();
  scheduleStats();
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
let drag: { x: number; y: number; moved: number; measure: boolean } | null = null;
let pinch: { d: number } | null = null;

function local(e: PointerEvent | MouseEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    const m = measuring || e.shiftKey;
    drag = { x: e.clientX, y: e.clientY, moved: 0, measure: m };
    if (m) {
      const [wx, wy] = screenToWorld(cam, vp, ...local(e));
      ruler = { ax: wx, ay: wy, bx: wx, by: wy };
      renderRuler($('ruler'), null, true);
      invalidate();
    }
  } else if (pointers.size === 2) {
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
  const [wx, wy] = screenToWorld(cam, vp, sx, sy);
  if (drag) {
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.measure && ruler) {
      ruler.bx = wx;
      ruler.by = wy;
      renderRuler($('ruler'), Math.hypot(ruler.bx - ruler.ax, ruler.by - ruler.ay), true);
      invalidate();
    } else if (drag.moved > 3) {
      canvas.classList.add('dragging');
      setCam({ ...cam, cx: cam.cx - dx / cam.zoom, cy: cam.cy - dy / cam.zoom });
    }
  }
  hover = { x: wx, y: wy };
  scheduleInspector();
  updateStatus(layer.busy ? layer.progress : 1);
});

function endPointer(e: PointerEvent): void {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (drag && pointers.size === 0) {
    if (drag.measure) {
      if (drag.moved <= 3) {
        ruler = null;
        renderRuler($('ruler'), null, measuring);
        invalidate();
      }
    } else if (drag.moved <= 3 && e.type === 'pointerup') {
      // click: pin the biome and subbiome under the cursor (click it again to release)
      const [wx, wy] = screenToWorld(cam, vp, ...local(e));
      const c = world.cellAt(wx, wy, true);
      if (pinned && c.biome === pinBiome && c.sub === pinSub) pinned = null;
      else pinned = { x: wx, y: wy };
      refreshPins();
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
    updateStatus(layer.busy ? layer.progress : 1);
  }
});
canvas.addEventListener('dblclick', (e) => {
  if (measuring || e.shiftKey) return;
  const [sx, sy] = local(e);
  zoomBy(e.shiftKey ? 0.5 : 2, sx, sy);
});

$('zin').addEventListener('click', () => zoomBy(1.5));
$('zout').addEventListener('click', () => zoomBy(1 / 1.5));
$('zhome').addEventListener('click', home);

function setMeasuring(on: boolean): void {
  measuring = on;
  $('measure').classList.toggle('on', on);
  canvas.classList.toggle('measuring', on);
  if (!on) ruler = null;
  renderRuler($('ruler'), ruler ? Math.hypot(ruler.bx - ruler.ax, ruler.by - ruler.ay) : null, on);
  invalidate();
}
$('measure').addEventListener('click', () => setMeasuring(!measuring));

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
  // keep the display settings, replace the generation settings
  const d = defaults();
  const keep: Params = {};
  for (const k of Object.keys(params)) if (!GEN_KEYS.has(k)) keep[k] = params[k];
  params = { ...d, ...keep, ...p.params };
  leftPanel.sync(params);
  renderFloodPlot();
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
  history.replaceState(null, '', urlHash());
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
    a.download = `cellgen-terrain-${seedText.replace(/[^\w-]+/g, '_')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
});

$('resetAll').addEventListener('click', () => {
  pinned = null;
  params = defaults();
  leftPanel.sync(params);
  renderFloodPlot();
  viewPanel.sync(params);
  regenerate();
  toast('Parameters reset');
});

const helpDlg = $<HTMLDialogElement>('helpDlg');
$('help').addEventListener('click', () => helpDlg.showModal());
$('toggleRight').addEventListener('click', () => $('right').classList.toggle('open'));

// ------------------------------------------------------------------ keyboard

function cycle(key: string, values: string[], dir: number): void {
  const i = values.indexOf(str(params, key));
  setParams({ [key]: values[(i + dir + values.length) % values.length] });
}
const toggle = (key: string) => setParams({ [key]: params[key] !== true });
const MODES = VIEW_MODES.map((m) => m[0]);

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const pan = 80 / cam.zoom;
  const k = e.key;
  if (/^[1-9]$/.test(k)) {
    setParams({ 'view.color': MODES[Number(k) - 1] });
    toast(VIEW_MODES[Number(k) - 1][1]);
    e.preventDefault();
    return;
  }
  switch (k) {
    case '+':
    case '=':
      zoomBy(1.5);
      break;
    case '-':
    case '_':
      zoomBy(1 / 1.5);
      break;
    case '0':
    case 'h':
    case 'H':
      home();
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
    case '[':
      cycle('view.color', MODES, -1);
      break;
    case ']':
      cycle('view.color', MODES, 1);
      break;
    case 'b':
    case 'B':
      toggle('view.bioEdges');
      break;
    case 'n':
    case 'N':
      toggle('view.subEdges');
      break;
    case 'l':
    case 'L':
      toggle('view.links');
      break;
    case 'w':
    case 'W':
      toggle('view.growth');
      break;
    case 'j':
    case 'J':
      toggle('view.mergeArrows');
      break;
    case 'v':
    case 'V':
      toggle('riv.on');
      break;
    case 'g':
    case 'G':
      toggle('view.grid');
      break;
    case 't':
    case 'T':
      toggle('view.3d');
      break;
    case 's':
    case 'S':
      cycle('view.sites', ['none', 'regions', 'biomes', 'all'], 1);
      break;
    case 'm':
    case 'M':
      setMeasuring(!measuring);
      break;
    case 'Escape':
      if (measuring || ruler) setMeasuring(false);
      else if (pinned) {
        pinned = null;
        refreshPins();
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

// a link pasted into the address bar (replaceState never fires this)
window.addEventListener('hashchange', () => {
  const s = decodeState(location.hash, ALL_DEFS, DEFAULT_SEED);
  if (!s) return;
  seedText = s.seed;
  seedInput.value = seedText;
  params = s.params;
  leftPanel.sync(params);
  renderFloodPlot();
  viewPanel.sync(params);
  const c = camFromUrl();
  if (c) {
    cam = c;
    homed = false;
  }
  regenerate();
});

// ------------------------------------------------------------------ go

regenerate();
