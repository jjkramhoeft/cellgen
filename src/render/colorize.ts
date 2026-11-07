/** Per-cell colours for the selected field, plus legend data. */
import type { FieldDef, World } from '../gen/pipeline';
import { WATER_OCEAN } from '../gen/hydrology';
import { COLORMAPS, hashColor, hex, PALETTE, type RGB } from './colormaps';

export type Legend =
  | {
      kind: 'scalar';
      label: string;
      min: number;
      max: number;
      colormap: (t: number) => RGB;
      hist: number[];
      format: (v: number) => string;
      note?: string;
    }
  | { kind: 'category'; label: string; items: { label: string; color: RGB; count: number }[]; note?: string }
  | { kind: 'raster'; label: string; colormap: (t: number) => RGB; minLabel: string; maxLabel: string; note?: string };

export interface Colorization {
  /** packed ABGR for ImageData */
  u32: Uint32Array;
  rgb: Uint8ClampedArray;
  legend: Legend;
  fieldId: string;
}

export const RASTER_FIELDS = new Set(['worleyF1', 'worleyF2', 'worleyF2F1', 'worleyBorder', 'noiseRaw', 'maskSdf']);

const REQUIRES: Record<string, string> = {
  flux: 'Hydrology',
  watershed: 'Hydrology',
  plates: 'Elevation → Tectonic plates',
  cave: 'Cellular automata',
  paths: 'Noise networks',
};

export function pack(r: number, g: number, b: number, a = 255): number {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export function colorize(world: World, fieldId: string, hillshade: boolean): Colorization {
  const g = world.graph;
  const n = g.n;
  let note: string | undefined;
  let field: FieldDef | undefined = world.fields[fieldId];
  if (!field) {
    if (RASTER_FIELDS.has(fieldId)) field = world.fields.elevation;
    else {
      note = REQUIRES[fieldId] ? `Enable ${REQUIRES[fieldId]} to compute this field.` : undefined;
      field = world.fields.elevation;
    }
  }
  const rgb = new Uint8ClampedArray(n * 3);
  let legend: Legend;
  const v = field.values;
  if (field.kind === 'category') {
    const counts = new Map<number, number>();
    for (let i = 0; i < n; i++) counts.set(v[i], (counts.get(v[i]) ?? 0) + 1);
    const colorOf = (val: number): RGB => {
      if (field!.categories) return hex(field!.categories[val]?.color ?? '#ff00ff');
      if (field!.hashColors) return hashColor(val);
      return PALETTE[val % PALETTE.length];
    };
    const cache = new Map<number, RGB>();
    for (let i = 0; i < n; i++) {
      let c = cache.get(v[i]);
      if (!c) {
        c = colorOf(v[i]);
        cache.set(v[i], c);
      }
      rgb[3 * i] = c[0];
      rgb[3 * i + 1] = c[1];
      rgb[3 * i + 2] = c[2];
    }
    let items: { label: string; color: RGB; count: number }[];
    if (field.categories) {
      items = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([val, count]) => ({ label: field!.categories![val]?.label ?? String(val), color: colorOf(val), count }));
    } else if (field.hashColors) {
      items = [{ label: `${counts.size} distinct ids`, color: [160, 160, 160], count: n }];
    } else {
      items = Array.from(counts.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([val, count]) => ({ label: `colour ${val + 1}`, color: colorOf(val), count }));
      note = `Greedy graph colouring: ${counts.size} colours keep neighbours distinct.`;
    }
    legend = { kind: 'category', label: field.label, items, note };
  } else {
    let lo = field.min;
    let hi = field.max;
    if (lo === undefined || hi === undefined) {
      let a = Infinity;
      let b = -Infinity;
      for (let i = 0; i < n; i++) {
        if (v[i] < a) a = v[i];
        if (v[i] > b) b = v[i];
      }
      if (field.colormap === 'diverging') {
        const m = Math.max(Math.abs(a), Math.abs(b)) || 1;
        a = -m;
        b = m;
      }
      lo = lo ?? a;
      hi = hi ?? b;
    }
    const span = hi - lo || 1;
    const cm = COLORMAPS[field.colormap ?? 'viridis'];
    const hist = new Array(40).fill(0);
    for (let i = 0; i < n; i++) {
      const t = (v[i] - lo) / span;
      const c = cm(t);
      rgb[3 * i] = c[0];
      rgb[3 * i + 1] = c[1];
      rgb[3 * i + 2] = c[2];
      hist[Math.max(0, Math.min(39, Math.floor(t * 40)))]++;
    }
    legend = { kind: 'scalar', label: field.label, min: lo, max: hi, colormap: cm, hist, format: field.format ?? ((x) => x.toFixed(2)), note };
  }

  if (hillshade) applyHillshade(world, rgb);
  const u32 = new Uint32Array(n);
  for (let i = 0; i < n; i++) u32[i] = pack(rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2]);
  return { u32, rgb, legend, fieldId: field.id };
}

/** Lambertian shading from the per-cell elevation gradient, light from the north-west. */
function applyHillshade(world: World, rgb: Uint8ClampedArray): void {
  const { gx, gy } = world.grad;
  const g = world.graph;
  const S = g.W * 0.12; // vertical exaggeration
  const L = [-0.5, -0.6, 0.62];
  const ll = Math.hypot(L[0], L[1], L[2]);
  const lx = L[0] / ll;
  const ly = L[1] / ll;
  const lz = L[2] / ll;
  const flat = lz; // shade of a flat surface
  for (let i = 0; i < g.n; i++) {
    if (world.water[i] === WATER_OCEAN || world.elevation[i] <= 0) continue;
    const nx = -gx[i] * S;
    const ny = -gy[i] * S;
    const nl = Math.hypot(nx, ny, 1);
    const d = (nx * lx + ny * ly + lz) / nl;
    const f = Math.max(0.68, Math.min(1.22, 1 + (d - flat) * 0.9));
    rgb[3 * i] *= f;
    rgb[3 * i + 1] *= f;
    rgb[3 * i + 2] *= f;
  }
}
