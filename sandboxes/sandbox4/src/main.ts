/**
 * Sandbox 4 · Terrain (a three-level base map plus a height map and a 3D view).
 *
 * Generation: an unbounded world (metres) of three nested Voronoi levels — regions,
 * elevation zones, subbiomes — with ocean seeds / links / growth and random merges
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
import { tagTooltips } from '@shared/ui/html';
import { ALL_DEFS, BIOME_KEYS, BIOME_SECTION, CLIMATE_KEYS, PRECIP_KEYS, CLIMATE_SECTIONS, PROSPERITY_KEYS, PROSPERITY_SECTION, DEFAULT_SEED, defaults, GEN_KEYS, PRESETS, RIVER_KEYS, RIVER_SECTION, FLOODPLAIN_SECTION, GRADIENT_SECTION, HILLSLOPE_SECTION, SECTIONS, TERRAIN_KEYS, TERRAIN_SECTION, toBiomeParams, toClimateParams, toRiverParams, toTerrainParams, toWorldParams, VIEW_MODES, VIEW_SECTION } from './params';
import { drawGrid, drawGrowth, drawLinks, drawMerges, drawRivers, drawRuler, drawSites, fmtDist, niceStep, type Frame } from './render/overlays';
import { climateSource, type ClimateField } from './render/climate';
import { DETAIL_PX, mapSource, type ViewMode, type ViewOpts } from './render/source';
import { computeViewStats, renderInspector, type ClimateLegend, renderLegend, renderLevels, renderRuler, renderStats, type ViewStats } from './ui/widgets';
import { renderMapStats, type BiomeSort } from './ui/mapstats';
import { MapStatsJob, type MapStats } from './world/mapstats';
import { buildMesh, View3D, type HeightGrid, type Rect } from './render/view3d';
import { Biomes, coolingCurve } from './world/biomes';
import { Climate } from './world/climate';
import { Rivers } from './world/rivers';
import { FLOOD_REF_FLOW, monotoneSpline, Terrain } from './world/terrain';
import type { FromTerrainWorker, ToTerrainWorker } from './world/terrain.worker';
import { keyI, keyJ } from './world/level';
import { World } from './world/world';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
/** CSS px per metre */
const MIN_ZOOM = 1e-4;
const MAX_ZOOM = 0.25;
/** width of the home view, metres */
const HOME_SPAN = 1_000_000;
const CACHE_LIMIT = 900_000;
/** the terrain is skipped when the view touches more regions than this (at 1 km cells; scales with the cell area) */
const TERRAIN_MAX_REGIONS = 64;
/** 3D mesh resolution (vertices across the whole mesh, margin included) */
const MESH_COLS = 480;
/** the 3D mesh reaches this many view widths (heights) beyond each side of the view, so a pan slides real terrain into view */
const MESH_MARGIN = 0.5;
/** climate overlays: device px per CSS px of their raster (the fields are smooth), and while moving */
const CLIMATE_SCALE = 0.5;
const CLIMATE_PREVIEW = 0.25;
/** opacity of each climate overlay */
const CLIMATE_ALPHA = 0.5;
/** half the side of the Statistics section's fixed square around the origin, metres */
const STATS_WORLD_HALF = 1_024_000;
/** the Statistics wait this long after the last change before they are recomputed, ms */
const STATS_DELAY = 450;
/** time slice of the Statistics computation, ms */
const STATS_SLICE = 12;

// ------------------------------------------------------------------ state

const initial = decodeState(location.hash, ALL_DEFS, DEFAULT_SEED);
let seedText = initial?.seed ?? DEFAULT_SEED;
let params: Params = initial?.params ?? defaults();

let world!: World;
let rivers!: Rivers;
let terrain!: Terrain;
let climate!: Climate;
let biomes!: Biomes;
/** bumped whenever the biomes are rebuilt (part of the raster key of the biome colours) */
let biomeGen = 0;
/** bumped when new terrain rasters are ready (part of the raster key, so the map re-renders) */
let terrainVer = 0;
/** terrain tiles around the view still being computed (-1 = view too large) */
let terrainPending = 0;
let terrainBump = 0;
/** parameter generation of the terrain (tiles from an older one are dropped) */
let terrainGen = 0;
/** tiles of the view received from the worker since the last frame */
let tilesArrived = 0;
/** terrain tiles the 2D view needs, and those of the 3D mesh's margin (the rest are look-ahead) */
let viewTiles = new Set<number>();
let marginTiles = new Set<number>();
/** the missing tiles last asked of the worker (comma-joined) */
let tilesWanted = '';
/** the 3D mesh (heights, centred on the view) and the draped map image are stale */
let meshDirty = true;
let texDirty = true;
/** the view (centre and size, metres) the current 3D mesh was built around */
let meshAt: { cx: number; cy: number; w: number; h: number } | null = null;
/** regions around the view whose rivers are still being computed */
let riverPending = 0;
let genId = 0;
let fingerprint = '';
let stats: ViewStats | null = null;
/** the Statistics section: last result, the job computing the next one, and the inputs it is (being) computed for */
let mapStats: MapStats | null = null;
let mapStatsJob: MapStatsJob | null = null;
let mapStatsSig = '';
/** inputs of the result on show */
let shownSig = '';
let mapStatsTimer = 0;
let biomeSort: BiomeSort = 'legend';
let hover: { x: number; y: number } | null = null;
let pinned: { x: number; y: number } | null = null;
let pinElevationZone = -1;
let pinSub = -1;
let measuring = false;
let ruler: { ax: number; ay: number; bx: number; by: number } | null = null;
const timings = { render: 0 };

// ------------------------------------------------------------------ canvas & camera

const canvas = $<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d', { alpha: false })!;
const layer = new RasterLayer();
const climateLayers: Record<ClimateField, RasterLayer> = { temperature: new RasterLayer(), precipitation: new RasterLayer(), prosperity: new RasterLayer() };
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

const leftPanel = buildPanel($('left'), [...SECTIONS, RIVER_SECTION, TERRAIN_SECTION, HILLSLOPE_SECTION, GRADIENT_SECTION, FLOODPLAIN_SECTION, ...CLIMATE_SECTIONS, PROSPERITY_SECTION, BIOME_SECTION], params, onParam, resetSection);

/** A live plot of a control-point curve, placed under a panel section's help text. */
interface CurvePlot {
  /** panel section id, and the class of the plot element */
  section: string;
  cls: string;
  label: string;
  xs: number[];
  ys: number[];
  f: (x: number) => number;
  /** right end of the x axis, and its label (after the number) */
  xMax: number;
  xLabel: string;
  /** smallest top of the y axis, the y unit, and the title in the top-right corner */
  yFloor: number;
  yUnit: string;
  title: string;
  /** drawn dashed from this x on (an extrapolation beyond the last point) */
  dashFrom?: number;
  /** a faint straight reference line through the origin */
  ref?: { slope: number; label: string };
  pointTitle: (i: number) => string;
}

function renderCurvePlot(c: CurvePlot): void {
  const body = document.querySelector<HTMLElement>(`#left section[data-id="${c.section}"] .sec-body`);
  if (!body) return;
  let host = body.querySelector<HTMLElement>(`.${c.cls}`);
  if (!host) {
    host = document.createElement('div');
    host.className = `curve-plot ${c.cls}`;
    body.querySelector('.sec-help')?.after(host);
  }
  const W = 240;
  const H = 110;
  const pl = 34;
  const pb = 18;
  const N = 80;
  const xMax = c.xMax;
  const fx = Array.from({ length: N + 1 }, (_, k) => c.f((xMax * k) / N));
  const yMax = Math.max(c.yFloor, ...c.ys, ...fx) * 1.15;
  const lo = Math.min(0, ...c.ys, ...fx);
  const yMin = lo < 0 ? lo * 1.15 : 0;
  const X = (x: number) => pl + (x / xMax) * (W - pl - 6);
  const Y = (y: number) => H - pb - ((y - yMin) / (yMax - yMin)) * (H - pb - 6);
  const dash = c.dashFrom ?? Infinity;
  let solid = '';
  let dashed = '';
  for (let k = 0; k <= N; k++) {
    const x = (xMax * k) / N;
    const pt = `${X(x).toFixed(1)},${Y(fx[k]).toFixed(1)}`;
    if (x <= dash) solid += `${solid ? 'L' : 'M'}${pt}`;
    else dashed += `L${pt}`;
  }
  if (dashed) {
    // both parts meet exactly at the last control point
    const pt = `${X(dash).toFixed(1)},${Y(c.f(dash)).toFixed(1)}`;
    solid += `L${pt}`;
    dashed = `M${pt}${dashed}`;
  }
  const t = (x: number, y: number, s: string, anchor = 'start') => `<text x="${x}" y="${y}" font-size="9" fill="currentColor" opacity=".7" text-anchor="${anchor}">${s}</text>`;
  let ref = '';
  if (c.ref && c.ref.slope > 0) {
    const xe = Math.min(xMax, yMax / c.ref.slope);
    ref =
      `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(xe).toFixed(1)}" y2="${Y(c.ref.slope * xe).toFixed(1)}" stroke="currentColor" stroke-opacity=".3" stroke-dasharray="2 3"/>` +
      `<text x="${(X(xe) - 2).toFixed(1)}" y="${(Y(c.ref.slope * xe) + 10).toFixed(1)}" font-size="8" fill="currentColor" opacity=".45" text-anchor="end">${c.ref.label}</text>`;
  }
  const dots = c.xs.map((x, i) => `<circle cx="${X(x).toFixed(1)}" cy="${Y(c.ys[i]).toFixed(1)}" r="3" fill="#fde725"><title>${c.pointTitle(i)}</title></circle>`).join('');
  host.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${c.label}">` +
    `<line x1="${pl}" y1="${Y(0).toFixed(1)}" x2="${W - 4}" y2="${Y(0).toFixed(1)}" stroke="currentColor" stroke-opacity=".35"/>` +
    `<line x1="${pl}" y1="4" x2="${pl}" y2="${H - pb}" stroke="currentColor" stroke-opacity=".35"/>` +
    ref +
    `<path d="${solid}" fill="none" stroke="#5aa0ff" stroke-width="2"/>` +
    (dashed ? `<path d="${dashed}" fill="none" stroke="#5aa0ff" stroke-width="2" stroke-dasharray="4 3" opacity=".7"/>` : '') +
    dots +
    t(pl, H - 4, '0') +
    t(W - 4, H - 4, `${Math.round(xMax)} ${c.xLabel}`, 'end') +
    t(pl - 4, 10, String(Math.round(yMax)), 'end') +
    t(pl - 4, Y(0) + 3, `0 ${c.yUnit}`, 'end') +
    (yMin < 0 ? t(pl - 4, H - pb, String(Math.round(yMin)), 'end') : '') +
    t(W - 4, 12, c.title, 'end') +
    `</svg>`;
}

/** Live plots of the floodplain curve (half-width over bed height) and the biomes' height cooling curve. */
function renderPlots(): void {
  const hs = [1, 2, 3, 4].map((i) => Number(params[`hgt.fp.h${i}`]));
  const ws = [1, 2, 3, 4].map((i) => Number(params[`hgt.fp.w${i}`]));
  renderCurvePlot({
    section: 'floodplain',
    cls: 'flood-plot',
    label: 'Floodplain half-width over river bed height',
    xs: hs,
    ys: ws,
    f: monotoneSpline(hs, ws),
    xMax: Math.max(500, ...hs) * 1.15,
    xLabel: 'm bed height',
    yFloor: 50,
    yUnit: 'm',
    title: `half-width${params['hgt.fp.flow'] === true ? ` · flow ${FLOOD_REF_FLOW}` : ''}`,
    pointTitle: (i) => `Point ${i + 1}: ${hs[i]} m → ${ws[i]} m [hgt.fp.h${i + 1}, hgt.fp.w${i + 1}]`,
  });
  const bp = toBiomeParams(params);
  renderCurvePlot({
    section: 'biomes',
    cls: 'cool-plot',
    label: 'Cooling over height',
    xs: bp.coolH,
    ys: bp.coolT,
    f: coolingCurve(bp.coolH, bp.coolT),
    xMax: Math.max(2500, ...bp.coolH) * 1.25,
    xLabel: 'm height',
    yFloor: 5,
    yUnit: '°C',
    title: '°C cooler',
    dashFrom: Math.max(...bp.coolH),
    ref: { slope: 6.5 / 1000, label: '6.5 °C/km' },
    pointTitle: (i) => `Cooling point ${i + 1}: ${bp.coolH[i]} m → ${bp.coolT[i]} °C cooler [bio.cool.h${i + 1}, bio.cool.t${i + 1}]`,
  });
}
renderPlots();
const viewPanel = buildPanel($('viewPanel'), [VIEW_SECTION], params, onParam, resetSection);
$('statsSec').querySelector('.sec-head')!.addEventListener('click', () => {
  $('statsSec').classList.toggle('collapsed');
  scheduleStats();
});
$('mapStatsSec').querySelector('.sec-head')!.addEventListener('click', () => {
  $('mapStatsSec').classList.toggle('collapsed');
  if (statisticsOpen()) {
    renderStatistics();
    checkStatistics();
  } else cancelStatistics();
  // the open section asks for the view's terrain (exact heights for the biomes)
  invalidate();
});
$('msScope').addEventListener('change', () => {
  // a different area: start at once, without showing the old numbers meanwhile
  mapStats = null;
  shownSig = mapStatsSig = '';
  renderStatistics();
  checkStatistics();
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
  renderPlots();
  const gen = Object.keys(patch).some((k) => GEN_KEYS.has(k) && before[k] !== params[k]);
  if (gen) regenerate();
  else {
    // river settings rebuild only the rivers (and the terrain on them), never the map
    const changed = (keys: Set<string>) => Object.keys(patch).some((k) => keys.has(k) && before[k] !== params[k]);
    // the precipitation map thins the rivers of dry flat zones
    const riv = changed(RIVER_KEYS) || changed(PRECIP_KEYS);
    if (riv) rivers = new Rivers(world, toRiverParams(params, seedFromText(seedText)));
    if (riv || changed(TERRAIN_KEYS)) newTerrain();
    // prosperity feeds nothing yet: only the overlay and inspector change
    if (changed(CLIMATE_KEYS) || changed(PROSPERITY_KEYS)) newClimate();
    if (riv || changed(TERRAIN_KEYS) || changed(CLIMATE_KEYS) || changed(BIOME_KEYS)) newBiomes();
    viewChanged();
  }
}

// ------------------------------------------------------------------ generation

let fpTimer = 0;
function regenerate(): void {
  world = new World(toWorldParams(params, seedFromText(seedText)));
  rivers = new Rivers(world, toRiverParams(params, seedFromText(seedText)));
  newTerrain();
  newClimate();
  newBiomes();
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

function newClimate(): void {
  climate = new Climate(toClimateParams(params, seedFromText(seedText)));
}

/** Biomes on the current world, rivers, climate and terrain (rebuilt when any of them is). */
function newBiomes(): void {
  biomes = new Biomes(world, rivers, climate, terrain, toBiomeParams(params));
  biomeGen++;
}

/** The climate overlays that are on, bottom first. */
function climateOn(): ClimateField[] {
  const on: ClimateField[] = [];
  if (params['view.temp'] === true) on.push('temperature');
  if (params['view.precip'] === true) on.push('precipitation');
  if (params['view.prosperity'] === true) on.push('prosperity');
  return on;
}

/** Legend entries for the climate overlays that are on. */
function climateLegend(): ClimateLegend[] {
  return climateOn().map((field) => ({ field, p: climate.p[field] }));
}

/** Terrain tiles are computed in a worker; without one (very old browsers) on the main thread. */
const terrainWorker: Worker | null = (() => {
  try {
    const wk = new Worker(new URL('./world/terrain.worker.ts', import.meta.url), { type: 'module' });
    wk.onmessage = (e: MessageEvent<FromTerrainWorker>) => {
      const m = e.data;
      if (m.kind !== 'tile' || m.gen !== terrainGen) return;
      terrain.put(m.tile);
      // a tile of the view re-renders the map, one of the 3D margin only the mesh; a
      // look-ahead tile just waits in the cache until a pan reaches it
      if (viewTiles.has(m.tile.tile)) tilesArrived++;
      else if (marginTiles.has(m.tile.tile)) meshDirty = true;
      else return;
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
  meshDirty = texDirty = true;
}

/** Does the current display need the height map? (The biomes need it for the height cooling.) */
function needTerrain(): boolean {
  const mode = str(params, 'view.color');
  return params['view.3d'] === true || params['view.hillshade'] === true || mode === 'height' || mode === 'biomes';
}

/** Ask the worker for exactly these tiles (nearest first), unless that is what it already has. */
function wantTiles(keys: number[]): void {
  const sig = keys.join(',');
  if (sig === tilesWanted) return;
  tilesWanted = sig;
  toWorker({ kind: 'want', gen: terrainGen, tiles: keys });
}

/** World rectangle of the 2D view (metres). */
function viewRect(): Rect {
  const [x0, y0] = screenToWorld(cam, vp, 0, 0);
  const [x1, y1] = screenToWorld(cam, vp, vp.w, vp.h);
  return { x0, y0, x1, y1 };
}

/** World rectangle of the 3D mesh: the view plus MESH_MARGIN of it on every side. */
function meshRect(): Rect {
  const v = viewRect();
  const mx = (v.x1 - v.x0) * MESH_MARGIN;
  const my = (v.y1 - v.y0) * MESH_MARGIN;
  return { x0: v.x0 - mx, y0: v.y0 - my, x1: v.x1 + mx, y1: v.y1 + my };
}

/**
 * Get the terrain tiles around the view: requested from the worker (or, without one,
 * computed here until `deadline`), then, with the 3D view on, those of the mesh's
 * margin, and last a look-ahead ring one tile wider all round, so the tiles a pan
 * reaches are usually ready. All of them stay in the cache while they are needed.
 * Returns how many of the view's tiles are still missing (-1 when the view spans too
 * many regions).
 */
function prepareTerrain(deadline: number): number {
  const { x0, y0, x1, y1 } = viewRect();
  const R = world.regionLevel;
  const budget = TERRAIN_MAX_REGIONS * (terrain.p.res / 1000) ** 2;
  if (World.countIn(R, x0, y0, x1, y1, 1) > budget) {
    terrain.setNeeded([]);
    viewTiles = new Set();
    marginTiles = new Set();
    wantTiles([]);
    return -1;
  }
  // tiles of the regions around the view, nearest tile centre first
  const span = R.size * terrain.k;
  const dist = (t: number) => {
    return ((keyI(t) + 0.5) * span - cam.cx) ** 2 + ((keyJ(t) + 0.5) * span - cam.cy) ** 2;
  };
  const tiles = terrain.tilesIn(x0, y0, x1, y1).sort((a, b) => dist(a) - dist(b));
  viewTiles = new Set(tiles);
  let margin: number[] = [];
  const near = params['view.3d'] === true ? meshRect() : { x0, y0, x1, y1 };
  if (params['view.3d'] === true) margin = terrain.tilesIn(near.x0, near.y0, near.x1, near.y1).filter((k) => !viewTiles.has(k)).sort((a, b) => dist(a) - dist(b));
  marginTiles = new Set(margin);
  // look-ahead: one tile span further out on every side, computed last
  const ring = terrain
    .tilesIn(near.x0 - span, near.y0 - span, near.x1 + span, near.y1 + span)
    .filter((k) => !viewTiles.has(k) && !marginTiles.has(k))
    .sort((a, b) => dist(a) - dist(b));
  const all = [...tiles, ...margin, ...ring];
  terrain.setNeeded(all);
  if (terrainWorker) wantTiles(all.filter((k) => !terrain.hasTile(k)));
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
      meshDirty = texDirty = true;
    } else window.setTimeout(invalidate, 1500 - (now - terrainBump) + 10);
  }
  return pending;
}

function refreshPins(): void {
  if (!pinned) {
    pinElevationZone = pinSub = -1;
    return;
  }
  const c = world.cellAt(pinned.x, pinned.y, true);
  pinElevationZone = c.elevationZone;
  pinSub = c.sub;
}

function viewOpts(): ViewOpts {
  return {
    mode: str(params, 'view.color') as ViewMode,
    regEdges: params['view.regEdges'] === true,
    zoneEdges: params['view.zoneEdges'] === true,
    subEdges: params['view.subEdges'] === true,
    coast: params['view.coast'] === true,
    lod: str(params, 'view.lod') as 'auto' | 'full',
    pinElevationZone,
    pinSub,
    hillshade: params['view.hillshade'] === true,
  };
}

/** Anything that changes the picture but not the world. */
function viewChanged(): void {
  meshDirty = texDirty = true;
  show3d();
  renderLegend($('legend'), viewOpts().mode, stats ? stats.oceanShare : null, world.p.growPasses, climateLegend());
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
    if (str(params, 'view.color') === 'landsea') renderLegend($('legend'), 'landsea', stats.oceanShare, world.p.growPasses, climateLegend());
  }, 350);
}

function renderStatsPanel(): void {
  renderStats($('stats'), world, stats, { fingerprint, render: timings.render, cache: world.cacheStats });
  tagTooltips($('stats'));
}

// ------------------------------------------------------------------ statistics section

function statisticsOpen(): boolean {
  return !$('mapStatsSec').classList.contains('collapsed');
}

/** The rectangle the Statistics are taken over: the view, or a fixed square at the origin. */
function statisticsRect(): Rect {
  if ($<HTMLSelectElement>('msScope').value === 'world') return { x0: -STATS_WORLD_HALF, y0: -STATS_WORLD_HALF, x1: STATS_WORLD_HALF, y1: STATS_WORLD_HALF };
  return viewRect();
}

/** Everything the Statistics depend on: the world, biomes, computed terrain and rectangle. */
function statisticsSig(): string {
  const r = statisticsRect();
  return `${genId}|${biomeGen}|${terrainVer}|${Math.round(r.x0)},${Math.round(r.y0)},${Math.round(r.x1)},${Math.round(r.y1)}`;
}

/** Restart the Statistics (after a short pause) when anything they depend on has changed. */
function checkStatistics(): void {
  if (!statisticsOpen()) return;
  const sig = statisticsSig();
  if (sig === mapStatsSig) return;
  mapStatsSig = sig;
  mapStatsJob = null;
  clearTimeout(mapStatsTimer);
  if (sig !== shownSig) mapStatsTimer = window.setTimeout(startStatistics, mapStats ? STATS_DELAY : 0);
  renderStatisticsStatus();
}

/** Stop computing (the section was closed); reopening recomputes only if something changed. */
function cancelStatistics(): void {
  clearTimeout(mapStatsTimer);
  mapStatsJob = null;
  mapStatsSig = shownSig;
  renderStatisticsStatus();
}

function startStatistics(): void {
  if (!statisticsOpen()) return;
  const job = new MapStatsJob(world, biomes, terrain, statisticsRect());
  mapStatsJob = job;
  runStatistics(job, mapStatsSig);
}

/** One time slice of the job; it waits while the user is moving the map. */
function runStatistics(job: MapStatsJob, sig: string): void {
  if (job !== mapStatsJob) return;
  if (performance.now() - lastInteract < 200) {
    mapStatsTimer = window.setTimeout(() => runStatistics(job, sig), 200);
    return;
  }
  if (job.step(performance.now() + STATS_SLICE)) {
    mapStats = job.result;
    mapStatsJob = null;
    shownSig = sig;
    renderStatistics();
  } else {
    renderStatisticsStatus();
    mapStatsTimer = window.setTimeout(() => runStatistics(job, sig), 0);
  }
}

/** "updating" in the section head (and the shown numbers dimmed) while they are out of date. */
function renderStatisticsStatus(): void {
  const busy = statisticsOpen() && shownSig !== mapStatsSig;
  $('msStatus').textContent = busy ? (mapStatsJob ? `updating ${Math.round(mapStatsJob.progress * 100)} %` : 'updating…') : '';
  $('mapStats').classList.toggle('stale', busy && mapStats !== null);
}

function renderStatistics(): void {
  renderMapStats($('mapStats'), mapStats, biomeSort, jumpTo, (s) => {
    biomeSort = s;
    renderStatistics();
  });
  tagTooltips($('mapStats'));
  renderStatisticsStatus();
}

/** Centre the view on a point and pin it (the Statistics' min / max links). */
function jumpTo(x: number, y: number): void {
  setCam({ ...cam, cx: x, cy: y });
  pinned = { x, y };
  refreshPins();
  viewChanged();
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
  // the open Statistics section also wants the view's terrain (exact heights for the biomes)
  if (useTerrain || statisticsOpen()) terrainPending = prepareTerrain(interacting ? 0 : now + 120);
  const src = mapSource(world, `g${genId}`, viewOpts(), useTerrain ? terrain : null, terrainVer, biomes, `${biomeGen}.${terrainVer}`);
  const fresh = !layer.hasContentFor(src.key);
  // while the 3D view covers the map and the user is moving it, the hidden 2D map is not
  // drawn (it is only needed as the 3D map image, which is re-draped once things settle)
  if (params['view.3d'] === true && has3d && interacting) {
    update3d(true, terrainPending <= 0, false);
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(invalidate, 170);
    return;
  }
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
  // climate overlays: half transparent, over the map and rivers (coarse while moving)
  let climateBusy = false;
  for (const field of climateOn()) {
    const cl = climateLayers[field];
    const csrc = climateSource(climate, field);
    const cs = interacting ? CLIMATE_PREVIEW : CLIMATE_SCALE;
    if (!cl.isCurrent(csrc, cam, vp, cs) && !(cs < CLIMATE_SCALE && cl.isCurrent(csrc, cam, vp, CLIMATE_SCALE))) cl.start(csrc, cam, vp, cs);
    if (cl.step(performance.now() + Math.max(6, budget * 0.25))) climateBusy = true;
    ctx.globalAlpha = CLIMATE_ALPHA;
    cl.draw(ctx, cam, vp, dpr, csrc.key, true, true);
    ctx.globalAlpha = 1;
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
  $('busy').hidden = !layer.busy && riverPending === 0 && !terrainBusy && !climateBusy;
  if (params['view.3d'] === true) update3d(interacting, !terrainBusy, !layer.busy && riverPending === 0 && !terrainBusy && !climateBusy && !interacting);
  checkStatistics();
  // with a worker, arriving tiles wake the loop (no need to spin while it works)
  if (layer.busy || climateBusy || riverPending > 0 || (terrainBusy && !terrainWorker)) invalidate();
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
  renderInspector($('inspector'), world, params['riv.on'] === true ? rivers : null, pt ? { ...pt, pinned: !!pinned } : null, needTerrain() ? terrain : null, climate, biomes);
  tagTooltips($('inspector'));
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

/**
 * Keep the 3D view up to date, in two independent parts (panning itself never waits:
 * `setCam` slides the existing mesh at once):
 *   mesh     rebuilt around the view (plus its margin) as soon as the user stops moving;
 *            tiles that arrive later (view or margin) rebuild it again
 *   texture  the 2D map image, re-draped once the 2D picture is settled (map, rivers and
 *            terrain all done); it stays anchored to the world rectangle it shows
 */
function update3d(interacting: boolean, terrainReady: boolean, pictureSettled: boolean): void {
  if (!view3d.supported) return;
  // during a long drag, rebuild before the camera runs off the mesh's margin
  const nearEdge =
    meshAt !== null && Math.max(Math.abs(cam.cx - meshAt.cx) / meshAt.w, Math.abs(cam.cy - meshAt.cy) / meshAt.h) > MESH_MARGIN * 0.6;
  // the first picture waits for the view's terrain (the 2D map stays up meanwhile); later
  // rebuilds do not: unknown heights show flat and grey and fill in as their tiles arrive
  if (meshDirty && (!interacting || nearEdge) && (has3d || terrainReady)) {
    const { x0, y0, x1, y1 } = meshRect();
    const cols = MESH_COLS;
    const rows = Math.max(2, Math.round((cols * (y1 - y0)) / (x1 - x0)));
    const h = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      const y = y0 + ((y1 - y0) * j) / (rows - 1);
      for (let i = 0; i < cols; i++) h[j * cols + i] = terrain.heightFast(x0 + ((x1 - x0) * i) / (cols - 1), y);
    }
    const grid: HeightGrid = { cols, rows, x0, y0, x1, y1, viewW: vp.w / cam.zoom, h };
    view3d.follow(cam.cx, cam.cy);
    view3d.setMesh(buildMesh(grid, Number(params['view.exag'])));
    meshAt = { cx: cam.cx, cy: cam.cy, w: vp.w / cam.zoom, h: vp.h / cam.zoom };
    meshDirty = false;
    has3d = true;
    canvas3d.hidden = false;
  }
  if (texDirty && has3d && pictureSettled) {
    view3d.setTexture(canvas, viewRect());
    texDirty = false;
  }
}

// ------------------------------------------------------------------ interaction

function setCam(c: Camera): void {
  cam = c;
  meshDirty = texDirty = true;
  // the 3D view slides with the camera right away; the mesh is rebuilt around the new view later
  view3d.follow(cam.cx, cam.cy);
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
  meshDirty = texDirty = true;
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
      // click: pin the elevation zone and subbiome under the cursor (click it again to release)
      const [wx, wy] = screenToWorld(cam, vp, ...local(e));
      const c = world.cellAt(wx, wy, true);
      if (pinned && c.elevationZone === pinElevationZone && c.sub === pinSub) pinned = null;
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
  renderPlots();
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
  renderPlots();
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
      toggle('view.zoneEdges');
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
      cycle('view.sites', ['none', 'regions', 'elevationZones', 'all'], 1);
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
  renderPlots();
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
