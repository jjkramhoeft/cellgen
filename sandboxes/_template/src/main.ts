/**
 * Sandbox skeleton: schema-driven parameter panel, seed + URL state, and a
 * zoomable/pannable canvas — all from shared/. Replace the drawing with the
 * sandbox's own generation and rendering.
 */
import './style.css';
import { seedFromText } from '@shared/core/hash';
import { generatePoints, type PointMethod, type PointSet } from '@shared/core/sampling';
import { num, str, type Params, type ParamValue } from '@shared/params/schema';
import { decodeState, encodeState } from '@shared/params/url';
import { fitCamera, zoomAt, type Camera, type Viewport } from '@shared/render/camera';
import { buildPanel } from '@shared/ui/panel';
import { ALL_DEFS, defaults, SECTIONS } from './params';

const W = 1600;
const H = 1000;
const DEFAULT_SEED = 'cellgen';

const initial = decodeState(location.hash, ALL_DEFS, DEFAULT_SEED);
let seedText = initial?.seed ?? DEFAULT_SEED;
let params: Params = initial?.params ?? defaults();

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;
let vp: Viewport = { w: 1, h: 1 };
let cam: Camera = { cx: W / 2, cy: H / 2, zoom: 1 };
let fitted = true;
let points: PointSet = { xs: new Float64Array(0), ys: new Float64Array(0) };

const panel = buildPanel(document.getElementById('left')!, SECTIONS, params, (key: string, value: ParamValue) => {
  params = { ...params, [key]: value };
  panel.sync(params);
  generate();
});

const seedInput = document.getElementById('seed') as HTMLInputElement;
seedInput.value = seedText;
seedInput.addEventListener('change', () => {
  seedText = seedInput.value.trim() || DEFAULT_SEED;
  generate();
});

function generate(): void {
  points = generatePoints({
    method: str(params, 'pts.method') as PointMethod,
    n: num(params, 'pts.n'),
    W,
    H,
    seed: seedFromText(seedText),
    jitter: num(params, 'pts.jitter'),
    poissonK: 30,
    density: 'none',
    densityContrast: 0,
    densityFreq: 1,
  });
  history.replaceState(null, '', `#${encodeState(seedText, params, ALL_DEFS)}`);
  draw();
}

function draw(): void {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b0e13';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * (vp.w / 2 - cam.cx * cam.zoom), dpr * (vp.h / 2 - cam.cy * cam.zoom));
  ctx.fillStyle = '#151a22';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#3fc1b0';
  const r = 2 / cam.zoom;
  ctx.beginPath();
  for (let i = 0; i < points.xs.length; i++) ctx.rect(points.xs[i] - r, points.ys[i] - r, 2 * r, 2 * r);
  ctx.fill();
}

new ResizeObserver(() => {
  const rect = canvas.parentElement!.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  vp = { w: rect.width, h: rect.height };
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  if (fitted) cam = fitCamera(W, H, vp);
  draw();
}).observe(canvas.parentElement!);

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    cam = zoomAt(cam, vp, e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0016), 0.05, 200);
    fitted = false;
    draw();
  },
  { passive: false },
);
let drag: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  cam = { ...cam, cx: cam.cx - (e.clientX - drag.x) / cam.zoom, cy: cam.cy - (e.clientY - drag.y) / cam.zoom };
  drag = { x: e.clientX, y: e.clientY };
  fitted = false;
  draw();
});
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener('dblclick', () => {
  cam = fitCamera(W, H, vp);
  fitted = true;
  draw();
});

generate();
