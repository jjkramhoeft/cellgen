/**
 * Vector overlays drawn over the raster in device pixels: ocean seeds and links,
 * growth and merge arrows, sites, rivers, lakes, the travel network, city and town
 * locations, a kilometre grid and the measuring ruler.
 * Overlays enumerate lattice cells around the view and skip themselves when that
 * would mean too many cells (they would be unreadable anyway).
 */
import type { Camera, Viewport } from '@shared/render/camera';
import { LINKED, World } from '../world/world';
import type { Level } from '../world/level';
import type { Lakes } from '../world/lakes';
import type { Location, Locations } from '../world/locations';
import type { Rivers } from '../world/rivers';
import { CELL, type RegionTravel, type Travel, type TravelMode } from '../world/travel';

export interface Frame {
  ctx: CanvasRenderingContext2D;
  cam: Camera;
  vp: Viewport;
  dpr: number;
  /** visible world rect */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MAX_CELLS = 9000;

function sx(f: Frame, x: number): number {
  return ((x - f.cam.cx) * f.cam.zoom + f.vp.w / 2) * f.dpr;
}
function sy(f: Frame, y: number): number {
  return ((y - f.cam.cy) * f.cam.zoom + f.vp.h / 2) * f.dpr;
}

/** On-screen size of a level's cells, CSS px. */
export function cellPx(level: Level, cam: Camera): number {
  return level.size * cam.zoom;
}

function arrow(f: Frame, ax: number, ay: number, bx: number, by: number, head: number): void {
  const { ctx } = f;
  const x0 = sx(f, ax);
  const y0 = sy(f, ay);
  let x1 = sx(f, bx);
  let y1 = sy(f, by);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;
  const ux = dx / len;
  const uy = dy / len;
  // stop short of the target site so arrowheads don't pile up on it
  const back = Math.min(len * 0.2, head * 1.2);
  x1 -= ux * back;
  y1 -= uy * back;
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.moveTo(x1 - ux * head - uy * head * 0.55, y1 - uy * head + ux * head * 0.55);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1 - ux * head + uy * head * 0.55, y1 - uy * head - ux * head * 0.55);
}

function haloStroke(f: Frame, color: string, width: number): void {
  const { ctx, dpr } = f;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(8,10,14,0.75)';
  ctx.lineWidth = (width + 2) * dpr;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width * dpr;
  ctx.stroke();
}

/** Ocean seeds (● linked, ○ lone) and the links between them. */
export function drawLinks(f: Frame, world: World): void {
  const R = world.regionLevel;
  const reach = R.size * (world.p.connectRange + 2);
  if (World.countIn(R, f.x0 - reach, f.y0 - reach, f.x1 + reach, f.y1 + reach, 0) > 2500) return;
  const regions = World.cellsIn(R, f.x0 - reach, f.y0 - reach, f.x1 + reach, f.y1 + reach, 0);
  const { ctx, dpr } = f;
  ctx.beginPath();
  for (const r of regions) {
    for (const l of world.links(r)) {
      const a = world.elevationZone(l.from);
      const b = world.elevationZone(l.to);
      ctx.moveTo(sx(f, a.x), sy(f, a.y));
      ctx.lineTo(sx(f, b.x), sy(f, b.y));
    }
  }
  ctx.setLineDash([6 * dpr, 4 * dpr]);
  haloStroke(f, '#3fc1b0', 1.6);
  ctx.setLineDash([]);
  const rad = Math.max(3, Math.min(7, world.elevationZoneLevel.size * f.cam.zoom * 0.12)) * dpr;
  for (const r of regions) {
    for (const s of world.region(r).seeds) {
      const b = world.elevationZone(s);
      const x = sx(f, b.x);
      const y = sy(f, b.y);
      if (x < -20 || y < -20 || x > f.vp.w * dpr + 20 || y > f.vp.h * dpr + 20) continue;
      const linked = (world.baseFlags(s) & LINKED) !== 0;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fillStyle = linked ? '#fde725' : 'rgba(10,14,20,0.6)';
      ctx.fill();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = linked ? '#1b1f12' : '#ff9a3c';
      ctx.stroke();
    }
  }
}

/** Arrows from growing ocean elevation zones to the land elevation zones they converted. */
export function drawGrowth(f: Frame, world: World): void {
  const L = world.elevationZoneLevel;
  if (world.p.growPasses === 0 || World.countIn(L, f.x0, f.y0, f.x1, f.y1) > MAX_CELLS / 3) return;
  const colors = ['#5aa0ff', '#8f7bff', '#c06bd8', '#e06aa0'];
  const head = Math.max(4, Math.min(8, L.size * f.cam.zoom * 0.12)) * f.dpr;
  const byPass: number[][][] = [[], [], [], []];
  for (const g of World.cellsIn(L, f.x0, f.y0, f.x1, f.y1)) {
    for (const e of world.growthFrom(g)) byPass[e.p - 1].push([g, e.to]);
  }
  byPass.forEach((edges, p) => {
    if (!edges.length) return;
    f.ctx.beginPath();
    for (const [g, t] of edges) {
      const a = world.elevationZone(g);
      const b = world.elevationZone(t);
      arrow(f, a.x, a.y, b.x, b.y, head);
    }
    haloStroke(f, colors[p], 1.5);
  });
}

/** Arrows from each merged cell to the neighbour it joined (elevation zones; patches when large enough). */
export function drawMerges(f: Frame, world: World): void {
  const BL = world.elevationZoneLevel;
  const SL = world.patchLevel;
  if (World.countIn(BL, f.x0, f.y0, f.x1, f.y1) <= MAX_CELLS) {
    const head = Math.max(4, Math.min(9, BL.size * f.cam.zoom * 0.15)) * f.dpr;
    f.ctx.beginPath();
    for (const b of World.cellsIn(BL, f.x0, f.y0, f.x1, f.y1)) {
      const t = world.elevationZoneTarget(b);
      if (t < 0) continue;
      const a = world.elevationZone(b);
      const c = world.elevationZone(t);
      arrow(f, a.x, a.y, c.x, c.y, head);
    }
    haloStroke(f, '#ff9a3c', 2);
  }
  if (cellPx(SL, f.cam) >= 14 && World.countIn(SL, f.x0, f.y0, f.x1, f.y1) <= MAX_CELLS) {
    const head = Math.max(3, Math.min(7, SL.size * f.cam.zoom * 0.15)) * f.dpr;
    f.ctx.beginPath();
    for (const s of World.cellsIn(SL, f.x0, f.y0, f.x1, f.y1)) {
      const t = world.patchTarget(s);
      if (t < 0) continue;
      const a = world.patch(s);
      const c = world.patch(t);
      arrow(f, a.x, a.y, c.x, c.y, head);
    }
    haloStroke(f, '#fde725', 1.3);
  }
}

/** Site dots per level. */
export function drawSites(f: Frame, world: World, which: string): void {
  const { ctx, dpr } = f;
  const levels: [Level, string, number][] = [[world.regionLevel, '#ffffff', 4.5]];
  if (which === 'elevationZones' || which === 'all') levels.push([world.elevationZoneLevel, '#fde725', 3]);
  if (which === 'all') levels.push([world.patchLevel, '#3fc1b0', 2]);
  for (let k = levels.length - 1; k >= 0; k--) {
    const [L, color, r] = levels[k];
    if (cellPx(L, f.cam) < 6 || World.countIn(L, f.x0, f.y0, f.x1, f.y1) > MAX_CELLS) continue;
    ctx.beginPath();
    for (const key of World.cellsIn(L, f.x0, f.y0, f.x1, f.y1)) {
      const i = Math.floor(key / 4194304) - 2097152;
      const j = (key % 4194304) - 2097152;
      const x = sx(f, L.siteX(i, j));
      const y = sy(f, L.siteY(i, j));
      ctx.moveTo(x + r * dpr, y);
      ctx.arc(x, y, r * dpr, 0, Math.PI * 2);
    }
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(8,10,14,0.85)';
    ctx.lineWidth = 1.2 * dpr;
    ctx.fill();
    ctx.stroke();
  }
}

export function niceStep(target: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [1, 2, 5, 10]) if (m * p >= target) return m * p;
  return 10 * p;
}

export function fmtDist(m: number): string {
  if (m >= 1000) return `${+(m / 1000).toFixed(m >= 100000 ? 0 : m >= 10000 ? 1 : 2)} km`;
  return `${Math.round(m)} m`;
}

/** Kilometre grid with coordinate labels along the top and left edges. */
export function drawGrid(f: Frame): void {
  const { ctx, dpr } = f;
  const step = niceStep(110 / f.cam.zoom);
  ctx.beginPath();
  for (let x = Math.ceil(f.x0 / step) * step; x <= f.x1; x += step) {
    const X = Math.round(sx(f, x)) + 0.5;
    ctx.moveTo(X, 0);
    ctx.lineTo(X, f.vp.h * dpr);
  }
  for (let y = Math.ceil(f.y0 / step) * step; y <= f.y1; y += step) {
    const Y = Math.round(sy(f, y)) + 0.5;
    ctx.moveTo(0, Y);
    ctx.lineTo(f.vp.w * dpr, Y);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = `${10.5 * dpr}px ui-monospace, Consolas, monospace`;
  ctx.fillStyle = 'rgba(230,236,244,0.85)';
  ctx.textBaseline = 'top';
  for (let x = Math.ceil(f.x0 / step) * step; x <= f.x1; x += step) ctx.fillText(fmtDist(x).replace(' ', ''), sx(f, x) + 3 * dpr, 3 * dpr);
  for (let y = Math.ceil(f.y0 / step) * step; y <= f.y1; y += step) ctx.fillText(fmtDist(y).replace(' ', ''), 3 * dpr, sy(f, y) + 3 * dpr);
  // the origin
  const ox = sx(f, 0);
  const oy = sy(f, 0);
  ctx.beginPath();
  ctx.arc(ox, oy, 4 * dpr, 0, Math.PI * 2);
  ctx.strokeStyle = '#fde725';
  ctx.lineWidth = 1.5 * dpr;
  ctx.stroke();
}

/**
 * Travel-speed reference from sandbox3.md ("recorded size/distance and travel info").
 * Display only: the generator does not use it.
 */
export const TRAVEL = [
  { name: 'Horse, under saddle', lo: 32, hi: 48 },
  { name: 'Roman legion, marching', lo: 24, hi: 32 },
  { name: 'Hiker, long-distance', lo: 16, hi: 24 },
];

export function travelDays(km: number, lo: number, hi: number): string {
  const a = km / hi;
  const b = km / lo;
  const f = (d: number) => (d < 1 ? `${Math.round(d * 24)} h` : d < 10 ? d.toFixed(1) : d.toFixed(0));
  if (a < 1 && b < 1) return `${f(a)}–${f(b)}`;
  return `${f(a)}–${f(b)} days`;
}

/** Straight-line measuring ruler with a distance label. */
export function drawRuler(f: Frame, ax: number, ay: number, bx: number, by: number): void {
  const { ctx, dpr } = f;
  const x0 = sx(f, ax);
  const y0 = sy(f, ay);
  const x1 = sx(f, bx);
  const y1 = sy(f, by);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.setLineDash([8 * dpr, 5 * dpr]);
  haloStroke(f, '#ffffff', 2);
  ctx.setLineDash([]);
  for (const [x, y] of [
    [x0, y0],
    [x1, y1],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, 4 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  const d = Math.hypot(bx - ax, by - ay);
  const label = fmtDist(d);
  ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`;
  const tw = ctx.measureText(label).width;
  const lx = (x0 + x1) / 2 + 10 * dpr;
  const ly = (y0 + y1) / 2 - 10 * dpr;
  ctx.fillStyle = 'rgba(10,14,20,0.85)';
  ctx.fillRect(lx - 5 * dpr, ly - 13 * dpr, tw + 10 * dpr, 18 * dpr);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, lx, ly);
}

export interface RiverDraw {
  /** width multiplier */
  width: number;
  /** hide segments carrying fewer attractors */
  minFlow: number;
  attractors: boolean;
  /** also draw the stretch from each root (an ocean elevation zone point) across the water to the coast */
  sea: boolean;
  /** width exponent b in width ∝ flow^b (½ = Leonardo / hydraulic geometry, ⅓ = Murray) */
  exp: number;
}

/**
 * Fixed world length (m) the river line width scales with when zooming. Deliberately
 * not the growth step D: changing D must not change how wide rivers are drawn.
 * (2 km = the default D, so the default look is unchanged.)
 */
export const RIVER_REF_M = 2000;

/** Flow whose width does not depend on the width exponent (the exponents pivot around it). */
export const RIVER_REF_FLOW = 100;

/**
 * On-screen width (CSS px) of a river segment carrying `flow` attractors; `refPx` =
 * RIVER_REF_M on screen. Width ∝ flow^exp (downstream hydraulic geometry, Leopold &
 * Maddock 1953), normalised so a flow of RIVER_REF_FLOW is equally wide for every
 * exponent; exp = ½ gives the original 0.45 + 0.3·√flow exactly. Render only, so
 * Math.pow is fine here.
 */
export function riverPx(flow: number, refPx: number, scale: number, exp = 0.5): number {
  const zf = Math.min(2.2, Math.max(0.45, refPx / 7));
  const f = exp === 0.5 ? Math.sqrt(flow / RIVER_REF_FLOW) : Math.pow(flow / RIVER_REF_FLOW, exp);
  return scale * zf * (0.45 + 3 * f);
}

/**
 * Space-colonization rivers of the regions around the view. Regions not computed
 * yet are computed until `deadline`; returns how many are still pending.
 */
export function drawRivers(f: Frame, rivers: Rivers, o: RiverDraw, deadline: number): number {
  const world = rivers.world;
  const R = world.regionLevel;
  if (World.countIn(R, f.x0, f.y0, f.x1, f.y1, 1) > 900) return 0;
  const { ctx, dpr } = f;
  const refPx = RIVER_REF_M * f.cam.zoom;
  let pending = 0;
  const shown: ReturnType<Rivers['get']>[] = [];
  for (const rk of World.cellsIn(R, f.x0, f.y0, f.x1, f.y1, 1)) {
    let rr = rivers.peek(rk);
    if (!rr) {
      if (performance.now() > deadline) {
        pending++;
        continue;
      }
      rr = rivers.get(rk);
    }
    if (rr.x1 < f.x0 || rr.x0 > f.x1 || rr.y1 < f.y0 || rr.y0 > f.y1) continue;
    shown.push(rr);
  }
  // width buckets of ¼ px so each stroke() covers many segments
  const buckets = new Map<number, number[][]>();
  for (const rr of shown) {
    for (let k = 0; k < rr.n; k++) {
      const p = rr.parent[k];
      if (p < 0 || rr.flow[k] < o.minFlow) continue;
      if (!o.sea && rr.wet[k] && rr.wet[p]) continue;
      const w = Math.max(0.5, Math.round(riverPx(rr.flow[k], refPx, o.width, o.exp) * dpr * 4) / 4);
      let b = buckets.get(w);
      if (!b) buckets.set(w, (b = []));
      b.push([sx(f, rr.x[p]), sy(f, rr.y[p]), sx(f, rr.x[k]), sy(f, rr.y[k])]);
    }
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#3f93dc';
  for (const w of [...buckets.keys()].sort((a, b) => a - b)) {
    ctx.beginPath();
    for (const [x0, y0, x1, y1] of buckets.get(w)!) {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.lineWidth = w;
    ctx.stroke();
  }
  if (o.attractors) {
    const r = Math.max(0.8, Math.min(2.2, refPx * 0.15)) * dpr;
    for (const pass of [0, 1]) {
      ctx.beginPath();
      for (const rr of shown) {
        for (let a = 0; a < rr.ax.length; a++) {
          if ((rr.reachedBy[a] < 0 ? 1 : 0) !== pass) continue;
          const x = sx(f, rr.ax[a]);
          const y = sy(f, rr.ay[a]);
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      ctx.fillStyle = pass ? '#ff4d4d' : 'rgba(235,240,245,0.55)';
      ctx.fill();
    }
    ctx.beginPath();
    const rr0 = Math.max(3, Math.min(7, refPx * 0.6)) * dpr;
    for (const rr of shown) {
      for (const k of rr.roots) {
        const x = sx(f, rr.x[k]);
        const y = sy(f, rr.y[k]);
        ctx.moveTo(x + rr0, y);
        ctx.arc(x, y, rr0, 0, Math.PI * 2);
      }
    }
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
  return pending;
}

/** Lake fill and shore colours. */
export const LAKE_FILL = '#3a78b6';
const LAKE_SHORE = 'rgba(20, 52, 88, 0.85)';

/**
 * Lakes of the regions around the view: computed regions always, new ones (whose rivers
 * are grown) until the deadline. Returns the number of regions still to place (drawn on a later frame).
 */
export function drawLakes(f: Frame, lakes: Lakes, deadline: number): number {
  if (lakes.p.frequency <= 0) return 0;
  const R = lakes.world.regionLevel;
  if (World.countIn(R, f.x0, f.y0, f.x1, f.y1, 1) > 900) return 0;
  const { ctx, dpr } = f;
  let pending = 0;
  ctx.beginPath();
  let any = false;
  for (const rk of World.cellsIn(R, f.x0, f.y0, f.x1, f.y1, 1)) {
    let rl = lakes.peek(rk);
    if (!rl) {
      // lakes sit on the rivers: wait until the region's rivers are grown (drawRivers does that)
      if (!lakes.rivers.has(rk) || performance.now() > deadline) {
        pending++;
        continue;
      }
      rl = lakes.get(rk);
    }
    for (const l of rl.lakes) {
      if (l.x1 < f.x0 || l.x0 > f.x1 || l.y1 < f.y0 || l.y0 > f.y1) continue;
      any = true;
      ctx.moveTo(sx(f, l.x[0]), sy(f, l.y[0]));
      for (let k = 1; k < l.x.length; k++) ctx.lineTo(sx(f, l.x[k]), sy(f, l.y[k]));
      ctx.closePath();
    }
  }
  if (any) {
    ctx.fillStyle = LAKE_FILL;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.75, Math.min(1.5, 600 * f.cam.zoom)) * dpr;
    ctx.strokeStyle = LAKE_SHORE;
    ctx.stroke();
  }
  return pending;
}

/** Viability colour stops (score 0–100): purple (poor) → crimson → orange → pale yellow (excellent). */
export const VIABILITY_STOPS: [number, number, number, number][] = [
  [0, 75, 42, 107],
  [35, 184, 64, 94],
  [65, 240, 138, 36],
  [100, 255, 243, 176],
];

/** CSS colour of a viability score (0–100). */
export function viabilityColor(score: number): string {
  const v = Math.min(100, Math.max(0, score));
  let k = 1;
  while (k < VIABILITY_STOPS.length - 1 && v > VIABILITY_STOPS[k][0]) k++;
  const a = VIABILITY_STOPS[k - 1];
  const b = VIABILITY_STOPS[k];
  const t = (v - a[0]) / (b[0] - a[0]);
  const c = (i: 1 | 2 | 3) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgb(${c(1)},${c(2)},${c(3)})`;
}

/** A region must be at least this wide on screen (CSS px) for its cities, and for its towns, to be drawn. */
export const LOC_CITY_PX = 14;
export const LOC_TOWN_PX = 44;
/** Scores are written next to the markers when the location spacing is at least this wide on screen (CSS px). */
const LOC_LABEL_PX = 30;

export interface LocationDraw {
  /** hide locations with a viability score below this (0–100) */
  min: number;
}

/**
 * Potential city (diamond) and town (dot) locations of the regions around the view, coloured
 * by viability and filtered by the viability threshold. Regions not scored yet are computed
 * until `deadline` (that grows their rivers and lakes too); returns how many are still pending.
 */
export function drawLocations(f: Frame, locations: Locations, o: LocationDraw, deadline: number): number {
  const world = locations.world;
  const R = world.regionLevel;
  const regPx = cellPx(R, f.cam);
  if (regPx < LOC_CITY_PX || World.countIn(R, f.x0, f.y0, f.x1, f.y1, 1) > 900) return 0;
  const { ctx, dpr } = f;
  const towns = regPx >= LOC_TOWN_PX;
  const labels = locations.p.spacing * f.cam.zoom >= LOC_LABEL_PX;
  let pending = 0;
  const shown: Location[] = [];
  const pad = 12 * dpr;
  for (const rk of World.cellsIn(R, f.x0, f.y0, f.x1, f.y1, 1)) {
    let rl = locations.peek(rk);
    if (!rl) {
      if (performance.now() > deadline) {
        pending++;
        continue;
      }
      rl = locations.get(rk);
    }
    for (const l of rl.list) {
      if (l.score < o.min || (!towns && l.kind !== 'city')) continue;
      const x = sx(f, l.x);
      const y = sy(f, l.y);
      if (x < -pad || y < -pad || x > f.vp.w * dpr + pad || y > f.vp.h * dpr + pad) continue;
      shown.push(l);
    }
  }
  // towns under cities, weaker under stronger
  shown.sort((a, b) => (a.kind === b.kind ? a.score - b.score : a.kind === 'city' ? 1 : -1));
  const zf = Math.min(1.5, Math.max(0.7, regPx / 160));
  ctx.lineJoin = 'round';
  for (const l of shown) {
    const x = sx(f, l.x);
    const y = sy(f, l.y);
    const city = l.kind === 'city';
    const r = (city ? 5.2 : 3.2) * zf * dpr;
    ctx.beginPath();
    if (city) {
      ctx.moveTo(x, y - r * 1.25);
      ctx.lineTo(x + r * 1.25, y);
      ctx.lineTo(x, y + r * 1.25);
      ctx.lineTo(x - r * 1.25, y);
      ctx.closePath();
    } else ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = viabilityColor(l.score);
    ctx.fill();
    if (city) {
      ctx.lineWidth = 3.2 * dpr;
      ctx.strokeStyle = 'rgba(8,10,14,0.9)';
      ctx.stroke();
      ctx.lineWidth = 1.4 * dpr;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    } else {
      ctx.lineWidth = 1.2 * dpr;
      ctx.strokeStyle = 'rgba(8,10,14,0.9)';
      ctx.stroke();
    }
  }
  if (labels) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = 'rgba(8,10,14,0.85)';
    for (const l of shown) {
      const city = l.kind === 'city';
      const r = (city ? 5.2 * 1.25 : 3.2) * zf * dpr;
      ctx.font = `${city ? '700' : '500'} ${(city ? 11.5 : 10) * dpr}px system-ui, sans-serif`;
      const text = String(Math.round(l.score));
      const x = sx(f, l.x);
      const y = sy(f, l.y) + r + 2 * dpr;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = city ? '#ffffff' : 'rgba(236,240,246,0.95)';
      ctx.fillText(text, x, y);
    }
    ctx.textAlign = 'start';
  }
  return pending;
}

/** How the travel network is drawn: one straight line per link, or the routes that follow the terrain. */
export type TravelStyle = 'simple' | 'terrain';

export interface TravelDraw {
  style: TravelStyle;
}

/** Line colours of the travel network: roads, river routes and sea lanes. */
export const TRAVEL_COLORS: Record<TravelMode, string> = { road: '#f3dfb4', river: '#c9f6ff', sea: '#eaf3ff' };
const TRAVEL_CASING: Record<TravelMode, string> = { road: 'rgba(52,28,10,0.9)', river: 'rgba(6,34,66,0.85)', sea: 'rgba(6,24,52,0.8)' };
/** Dash pattern (CSS px) of each kind of link; roads are solid. */
export const TRAVEL_DASH: Record<TravelMode, number[]> = { road: [], river: [2.5, 3.5], sea: [7, 5] };
/** Line width (CSS px) of a link between two cities and of any other, before the zoom factor. */
const TRAVEL_WIDTH: Record<TravelMode, [number, number]> = { road: [2.3, 1.3], river: [1.9, 1.4], sea: [1.7, 1.2] };

/**
 * Add the points [i0 … i1] of a route to the current path: straight pieces when they are
 * tiny on screen, otherwise a Catmull-Rom spline through them (as cubic Béziers, the
 * handles capped at a third of the piece so uneven spacing cannot overshoot).
 */
function traceRoute(f: Frame, pts: Float64Array, i0: number, i1: number, curved: boolean): void {
  const { ctx } = f;
  const n = pts.length / 2;
  const X = (i: number) => sx(f, pts[2 * i]);
  const Y = (i: number) => sy(f, pts[2 * i + 1]);
  let px = X(i0);
  let py = Y(i0);
  ctx.moveTo(px, py);
  if (!curved) {
    const tiny = f.dpr * f.dpr;
    for (let i = i0 + 1; i <= i1; i++) {
      const x = X(i);
      const y = Y(i);
      // skip points under a pixel away (but never the last)
      if (i < i1 && (x - px) * (x - px) + (y - py) * (y - py) < tiny) continue;
      ctx.lineTo(x, y);
      px = x;
      py = y;
    }
    return;
  }
  for (let i = i0; i < i1; i++) {
    const x1 = X(i);
    const y1 = Y(i);
    const x2 = X(i + 1);
    const y2 = Y(i + 1);
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 2);
    let t1x = (x2 - X(a)) / 6;
    let t1y = (y2 - Y(a)) / 6;
    let t2x = (X(b) - x1) / 6;
    let t2y = (Y(b) - y1) / 6;
    const cap = Math.hypot(x2 - x1, y2 - y1) / 3;
    const l1 = Math.hypot(t1x, t1y);
    if (l1 > cap) {
      t1x *= cap / l1;
      t1y *= cap / l1;
    }
    const l2 = Math.hypot(t2x, t2y);
    if (l2 > cap) {
      t2x *= cap / l2;
      t2y *= cap / l2;
    }
    ctx.bezierCurveTo(x1 + t1x, y1 + t1y, x2 - t2x, y2 - t2y, x2, y2);
  }
}

/**
 * The travel network of the regions around the view: roads (solid), river routes (short
 * dashes along the river) and sea lanes (long dashes), heavier between two cities. Regions
 * not connected yet are computed until `deadline` (that scores the locations of their
 * neighbours too); returns how many are still pending.
 */
export function drawTravel(f: Frame, travel: Travel, o: TravelDraw, deadline: number): number {
  const world = travel.world;
  const R = world.regionLevel;
  const regPx = cellPx(R, f.cam);
  if (regPx < LOC_CITY_PX || World.countIn(R, f.x0, f.y0, f.x1, f.y1, 1) > 900) return 0;
  const { ctx, dpr } = f;
  let pending = 0;
  const shown: RegionTravel[] = [];
  for (const rk of World.cellsIn(R, f.x0, f.y0, f.x1, f.y1, 1)) {
    let rt = travel.peek(rk);
    if (!rt) {
      if (performance.now() > deadline || !travel.prepare(rk, deadline)) {
        pending++;
        continue;
      }
      rt = travel.get(rk);
    }
    shown.push(rt);
  }
  // one path per kind and weight; sea lanes lowest, roads on top
  const zf = Math.min(1.5, Math.max(0.65, regPx / 160));
  const curved = CELL * f.cam.zoom >= 2.5;
  ctx.lineJoin = 'round';
  for (const mode of ['sea', 'river', 'road'] as TravelMode[]) {
    for (const major of [false, true]) {
      ctx.beginPath();
      let any = false;
      for (const rt of shown) {
        for (const e of rt.edges) {
          if (e.major !== major) continue;
          if (o.style === 'simple') {
            if (e.mode !== mode) continue;
            if (Math.max(e.a.x, e.b.x) < f.x0 || Math.min(e.a.x, e.b.x) > f.x1 || Math.max(e.a.y, e.b.y) < f.y0 || Math.min(e.a.y, e.b.y) > f.y1) continue;
            ctx.moveTo(sx(f, e.a.x), sy(f, e.a.y));
            ctx.lineTo(sx(f, e.b.x), sy(f, e.b.y));
            any = true;
            continue;
          }
          if (e.x1 < f.x0 || e.x0 > f.x1 || e.y1 < f.y0 || e.y0 > f.y1) continue;
          for (const part of e.parts) {
            if (part.mode !== mode) continue;
            for (let r = 0; r < part.runs.length; r += 2) {
              // a river route is the river's own polyline: no spline needed
              traceRoute(f, part.pts, part.runs[r], part.runs[r + 1], curved && mode !== 'river');
              any = true;
            }
          }
        }
      }
      if (!any) continue;
      const w = TRAVEL_WIDTH[mode][major ? 0 : 1] * zf;
      ctx.lineCap = mode === 'road' ? 'round' : 'butt';
      ctx.setLineDash([]);
      ctx.strokeStyle = TRAVEL_CASING[mode];
      ctx.lineWidth = (w + (mode === 'road' ? 1.8 : 1.4)) * dpr;
      ctx.stroke();
      ctx.setLineDash(TRAVEL_DASH[mode].map((d) => d * zf * dpr));
      ctx.strokeStyle = TRAVEL_COLORS[mode];
      ctx.lineWidth = w * dpr;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  return pending;
}
