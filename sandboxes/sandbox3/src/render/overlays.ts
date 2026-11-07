/**
 * Vector overlays drawn over the raster in device pixels: ocean seeds and links,
 * growth and merge arrows, sites, a kilometre grid and the measuring ruler.
 * Overlays enumerate lattice cells around the view and skip themselves when that
 * would mean too many cells (they would be unreadable anyway).
 */
import type { Camera, Viewport } from '@shared/render/camera';
import { LINKED, World } from '../world/world';
import type { Level } from '../world/level';

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
      const a = world.biome(l.from);
      const b = world.biome(l.to);
      ctx.moveTo(sx(f, a.x), sy(f, a.y));
      ctx.lineTo(sx(f, b.x), sy(f, b.y));
    }
  }
  ctx.setLineDash([6 * dpr, 4 * dpr]);
  haloStroke(f, '#3fc1b0', 1.6);
  ctx.setLineDash([]);
  const rad = Math.max(3, Math.min(7, world.biomeLevel.size * f.cam.zoom * 0.12)) * dpr;
  for (const r of regions) {
    for (const s of world.region(r).seeds) {
      const b = world.biome(s);
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

/** Arrows from growing ocean biomes to the land biomes they converted. */
export function drawGrowth(f: Frame, world: World): void {
  const L = world.biomeLevel;
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
      const a = world.biome(g);
      const b = world.biome(t);
      arrow(f, a.x, a.y, b.x, b.y, head);
    }
    haloStroke(f, colors[p], 1.5);
  });
}

/** Arrows from each merged cell to the neighbour it joined (biomes; subbiomes when large enough). */
export function drawMerges(f: Frame, world: World): void {
  const BL = world.biomeLevel;
  const SL = world.subLevel;
  if (World.countIn(BL, f.x0, f.y0, f.x1, f.y1) <= MAX_CELLS) {
    const head = Math.max(4, Math.min(9, BL.size * f.cam.zoom * 0.15)) * f.dpr;
    f.ctx.beginPath();
    for (const b of World.cellsIn(BL, f.x0, f.y0, f.x1, f.y1)) {
      const t = world.biomeTarget(b);
      if (t < 0) continue;
      const a = world.biome(b);
      const c = world.biome(t);
      arrow(f, a.x, a.y, c.x, c.y, head);
    }
    haloStroke(f, '#ff9a3c', 2);
  }
  if (cellPx(SL, f.cam) >= 14 && World.countIn(SL, f.x0, f.y0, f.x1, f.y1) <= MAX_CELLS) {
    const head = Math.max(3, Math.min(7, SL.size * f.cam.zoom * 0.15)) * f.dpr;
    f.ctx.beginPath();
    for (const s of World.cellsIn(SL, f.x0, f.y0, f.x1, f.y1)) {
      const t = world.subTarget(s);
      if (t < 0) continue;
      const a = world.sub(s);
      const c = world.sub(t);
      arrow(f, a.x, a.y, c.x, c.y, head);
    }
    haloStroke(f, '#fde725', 1.3);
  }
}

/** Site dots per level. */
export function drawSites(f: Frame, world: World, which: string): void {
  const { ctx, dpr } = f;
  const levels: [Level, string, number][] = [[world.regionLevel, '#ffffff', 4.5]];
  if (which === 'biomes' || which === 'all') levels.push([world.biomeLevel, '#fde725', 3]);
  if (which === 'all') levels.push([world.subLevel, '#3fc1b0', 2]);
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
