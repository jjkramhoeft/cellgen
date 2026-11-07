/** Vector overlays drawn over the raster: map border, lattice grid, sites and the distance probe. */
import { visibleRect, type Camera, type Viewport } from '@shared/render/camera';
import type { Field, Sample } from '../voronoi/field';

const OCT_COLORS = ['#fde725', '#3fc1b0', '#f08a5d', '#c58bf2'];

export function octColor(k: number): string {
  return OCT_COLORS[k % OCT_COLORS.length];
}

/** Set a world → device-pixel transform. */
function worldTransform(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, dpr: number): void {
  ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * (vp.w / 2 - cam.cx * cam.zoom), dpr * (vp.h / 2 - cam.cy * cam.zoom));
}

export function drawMapBorder(ctx: CanvasRenderingContext2D, field: Field, cam: Camera, vp: Viewport, dpr: number): void {
  worldTransform(ctx, cam, vp, dpr);
  ctx.strokeStyle = 'rgba(215, 221, 230, 0.55)';
  ctx.lineWidth = 1 / cam.zoom;
  ctx.setLineDash([6 / cam.zoom, 4 / cam.zoom]);
  ctx.strokeRect(0, 0, field.p.W, field.p.H);
  ctx.setLineDash([]);
}

/** Lattice cells (one site each) of octave k, when they are big enough on screen. */
export function drawLattice(ctx: CanvasRenderingContext2D, field: Field, k: number, cam: Camera, vp: Viewport, dpr: number): void {
  const lat = field.lattices[Math.min(k, field.octaves - 1)];
  if (lat.size * cam.zoom < 6) return;
  const [x0, y0, x1, y1] = visibleRect(cam, vp);
  worldTransform(ctx, cam, vp, dpr);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1 / cam.zoom;
  ctx.beginPath();
  for (let i = Math.floor(lat.toLatticeX(x0)); i <= Math.ceil(lat.toLatticeX(x1)); i++) {
    const x = lat.toWorldX(i);
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
  }
  for (let j = Math.floor(lat.toLatticeY(y0)); j <= Math.ceil(lat.toLatticeY(y1)); j++) {
    const y = lat.toWorldY(j);
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
  }
  ctx.stroke();
}

/** Seed cells of the "random oceans" flood: a ring with a cross at each seed site. */
export function drawOceanSeeds(ctx: CanvasRenderingContext2D, seeds: { x: number; y: number }[], cam: Camera, vp: Viewport, dpr: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const r = 7 * dpr;
  ctx.lineWidth = 2 * dpr;
  for (const s of seeds) {
    const sx = ((s.x - cam.cx) * cam.zoom + vp.w / 2) * dpr;
    const sy = ((s.y - cam.cy) * cam.zoom + vp.h / 2) * dpr;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.beginPath();
    ctx.arc(sx, sy, r + dpr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#7fd4ff';
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.moveTo(sx - r * 0.6, sy);
    ctx.lineTo(sx + r * 0.6, sy);
    ctx.moveTo(sx, sy - r * 0.6);
    ctx.lineTo(sx, sy + r * 0.6);
    ctx.stroke();
  }
}

/** Sites of the given octaves. Skips an octave whose sites would be closer than ~5 px. */
export function drawSites(ctx: CanvasRenderingContext2D, field: Field, octs: number[], cam: Camera, vp: Viewport, dpr: number): void {
  const [x0, y0, x1, y1] = visibleRect(cam, vp);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const k of octs) {
    if (k >= field.octaves) continue;
    const lat = field.lattices[k];
    const px = lat.size * cam.zoom;
    if (px < 5) continue;
    const i0 = Math.floor(lat.toLatticeX(x0)) - 1;
    const i1 = Math.ceil(lat.toLatticeX(x1)) + 1;
    const j0 = Math.floor(lat.toLatticeY(y0)) - 1;
    const j1 = Math.ceil(lat.toLatticeY(y1)) + 1;
    if ((i1 - i0) * (j1 - j0) > 40000) continue;
    const r = Math.max(1.3, Math.min(3.2, px / 18)) * dpr;
    ctx.fillStyle = octColor(k);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const wx = lat.toWorldX(lat.siteX(i, j));
        const wy = lat.toWorldY(lat.siteY(i, j));
        const sx = ((wx - cam.cx) * cam.zoom + vp.w / 2) * dpr;
        const sy = ((wy - cam.cy) * cam.zoom + vp.h / 2) * dpr;
        ctx.moveTo(sx + r, sy);
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
      }
    }
    if (k === 0) ctx.stroke();
    ctx.fill();
  }
}

/**
 * The distance probe: from the cursor, the metric balls of radius F1 and F2 (in the
 * octave's lattice units). By definition they pass through the nearest and
 * second-nearest sites, which makes the metric's geometry visible. For the
 * asymmetric triangular metric the ball is reflected (sites s with m(q − s) ≤ r).
 */
export function drawProbe(
  ctx: CanvasRenderingContext2D,
  field: Field,
  k: number,
  sample: Sample,
  ball: Float64Array,
  cam: Camera,
  vp: Viewport,
  dpr: number,
): void {
  const o = Math.min(k, field.octaves - 1);
  const lat = field.lattices[o];
  const h = sample.hits[o];
  // centre on the query point the lattice actually saw (differs from the cursor under border warp)
  const wx = lat.toWorldX(h.qx);
  const wy = lat.toWorldY(h.qy);
  worldTransform(ctx, cam, vp, dpr);
  const lw = 1.5 / cam.zoom;
  const toScreenLen = lat.size;
  const n = ball.length / 2;
  const ring = (radius: number, stroke: string, fill: string) => {
    const r = lat.metric.toNorm(radius) * toScreenLen;
    if (!(r > 0) || !Number.isFinite(r)) return;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = wx - ball[i * 2] * r;
      const y = wy - ball[i * 2 + 1] * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  };
  ring(h.f2, 'rgba(63, 193, 176, 0.9)', 'rgba(63, 193, 176, 0.06)');
  ring(h.f1, 'rgba(253, 231, 37, 0.95)', 'rgba(253, 231, 37, 0.08)');
  const s1x = lat.toWorldX(h.x1);
  const s1y = lat.toWorldY(h.y1);
  const s2x = lat.toWorldX(h.x2);
  const s2y = lat.toWorldY(h.y2);
  ctx.lineWidth = lw;
  ctx.setLineDash([4 / cam.zoom, 3 / cam.zoom]);
  ctx.strokeStyle = 'rgba(63, 193, 176, 0.9)';
  ctx.beginPath();
  ctx.moveTo(wx, wy);
  ctx.lineTo(s2x, s2y);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(253, 231, 37, 0.95)';
  ctx.beginPath();
  ctx.moveTo(wx, wy);
  ctx.lineTo(s1x, s1y);
  ctx.stroke();
  ctx.setLineDash([]);
  const dot = (x: number, y: number, c: string, r: number) => {
    ctx.beginPath();
    ctx.arc(x, y, r / cam.zoom, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1 / cam.zoom;
    ctx.stroke();
  };
  dot(s2x, s2y, '#3fc1b0', 4.5);
  dot(s1x, s1y, '#fde725', 5);
  dot(wx, wy, '#ffffff', 2.5);
}

/** Small unit-ball diagram for a metric: L2 circle for reference plus the metric's ball. */
export function drawBall(
  canvas: HTMLCanvasElement,
  balls: { poly: Float64Array; color: string; dash?: boolean }[],
  size = 120,
): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  let rmax = 1;
  for (const b of balls) for (let i = 0; i < b.poly.length; i += 2) rmax = Math.max(rmax, Math.hypot(b.poly[i], b.poly[i + 1]));
  const s = (size / 2 - 8) / rmax;
  const c = size / 2;
  ctx.strokeStyle = '#2d3644';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(c, 4);
  ctx.lineTo(c, size - 4);
  ctx.moveTo(4, c);
  ctx.lineTo(size - 4, c);
  ctx.stroke();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = '#4a5568';
  ctx.beginPath();
  ctx.arc(c, c, s, 0, Math.PI * 2);
  ctx.stroke();
  for (const b of balls) {
    ctx.setLineDash(b.dash ? [4, 3] : []);
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < b.poly.length; i += 2) {
      const x = c + b.poly[i] * s;
      const y = c + b.poly[i + 1] * s;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = '#d7dde6';
  ctx.beginPath();
  ctx.arc(c, c, 2, 0, Math.PI * 2);
  ctx.fill();
}
