/** Per-pixel raster sources: implicit cells, Worley fields, continuous noise, exact noise networks. */
import { makeMaskFn, makeNoiseFn } from '../gen/elevation';
import { WATER_OCEAN } from '../gen/hydrology';
import { makePathFn } from '../gen/noisepaths';
import type { World } from '../gen/pipeline';
import { makeOwner } from '../graph/implicit';
import type { MetricSpec, QueryResult } from '../core/spatial';
import { bool, num, type Params } from '../params/schema';
import { COLORMAPS, type RGB } from './colormaps';
import { pack } from './colorize';
import type { RasterSource } from './raster';

const OUTSIDE = 0; // transparent

function inside(world: World, wx: number, wy: number) {
  return wx >= 0 && wy >= 0 && wx < world.graph.W && wy < world.graph.H;
}

/** Implicit (distance-function) cells, coloured per cell, with pixel-exact edges and coastline. */
export function implicitSource(world: World, colors: Uint32Array, colorKey: string, edges: boolean, coast: boolean): RasterSource {
  const g = world.graph;
  const isWater = (id: number) => world.water[id] === WATER_OCEAN;
  return {
    key: `imp|${colorKey}|${edges}|${coast}`,
    create() {
      let prev: Int32Array | null = null;
      let cur: Int32Array = new Int32Array(0);
      return (_py, wy, wx0, dwx, cols, out, off) => {
        if (cur.length !== cols) cur = new Int32Array(cols);
        for (let c = 0; c < cols; c++) {
          const wx = wx0 + c * dwx;
          cur[c] = inside(world, wx, wy) ? g.cellAt(wx, wy) : -1;
        }
        for (let c = 0; c < cols; c++) {
          const id = cur[c];
          if (id < 0) {
            out[off + c] = OUTSIDE;
            continue;
          }
          let col = colors[id];
          const left = c > 0 ? cur[c - 1] : id;
          const up = prev ? prev[c] : id;
          if (coast && ((left >= 0 && isWater(left) !== isWater(id)) || (up >= 0 && isWater(up) !== isWater(id)))) {
            col = pack(18, 26, 40);
          } else if (edges && ((left >= 0 && left !== id) || (up >= 0 && up !== id))) {
            const r = (col & 255) * 0.55;
            const gg = ((col >>> 8) & 255) * 0.55;
            const b = ((col >>> 16) & 255) * 0.55;
            col = pack(r, gg, b);
          }
          out[off + c] = col;
        }
        const t = prev ?? new Int32Array(cols);
        prev = cur;
        cur = t;
      };
    },
  };
}

export interface RasterFieldInfo {
  label: string;
  colormap: (t: number) => RGB;
  minLabel: string;
  maxLabel: string;
  note?: string;
}

/** Worley F1 / F2 / F2−F1 / exact border distance, under the graph's own metric. */
export function worleySource(world: World, field: string): { src: RasterSource; info: RasterFieldInfo } {
  const g = world.graph;
  const s = g.spacing;
  const spec = g.implicit;
  const q: QueryResult = { i1: -1, i2: -1, d1: 0, d2: 0, s1: 0, s2: 0 };
  const owner = spec ? makeOwner(spec, g.sites, s, Math.pow, true) : null;
  const l2: MetricSpec = { kind: 'L2', p: 2, pow: Math.pow };
  const exactOk = !spec || (spec.metric.kind === 'L2' && spec.weightKind === 'none' && spec.warpAmp === 0);
  const query = (x: number, y: number) => {
    if (owner) owner(x, y, q);
    else g.sites.query(x, y, l2, 'none', null, 1, q, true);
    return q;
  };
  let info: RasterFieldInfo;
  let value: (x: number, y: number) => number;
  switch (field) {
    case 'worleyF1':
      info = { label: 'Worley F1 / spacing', colormap: COLORMAPS.magma, minLabel: '0', maxLabel: '0.9' };
      value = (x, y) => query(x, y).d1 / (s * 0.9);
      break;
    case 'worleyF2':
      info = { label: 'Worley F2 / spacing', colormap: COLORMAPS.viridis, minLabel: '0.3', maxLabel: '1.5' };
      value = (x, y) => (query(x, y).d2 / s - 0.3) / 1.2;
      break;
    case 'worleyF2F1':
      info = {
        label: 'F2 − F1 (uneven widths)',
        colormap: COLORMAPS.gray,
        minLabel: '0',
        maxLabel: '0.6',
        note: 'Zero on cell borders, but not a distance: band widths vary with site spacing (Quilez).',
      };
      value = (x, y) => {
        const r = query(x, y);
        return (r.d2 - r.d1) / (s * 0.6);
      };
      break;
    default:
      info = {
        label: exactOk ? 'Exact border distance' : 'Border distance ≈ (F2 − F1)/2',
        colormap: COLORMAPS.flux,
        minLabel: '0',
        maxLabel: '0.5 spacing',
        note: exactOk
          ? 'min over neighbours of (|b−x|² − |a−x|²) / 2|b−a| — stripes are iso-distance bands.'
          : 'Exact formula needs unweighted, unwarped L2; showing an approximation.',
      };
      value = exactOk
        ? (x, y) => g.sites.borderDistanceL2(x, y) / (s * 0.5)
        : (x, y) => {
            const r = query(x, y);
            return (r.d2 - r.d1) / (s * 1.0);
          };
  }
  const cm = info.colormap;
  const stripes = field === 'worleyBorder';
  const src: RasterSource = {
    key: `worley|${field}|${world.fingerprint}`,
    create() {
      return (_py, wy, wx0, dwx, cols, out, off) => {
        for (let c = 0; c < cols; c++) {
          const wx = wx0 + c * dwx;
          if (!inside(world, wx, wy)) {
            out[off + c] = OUTSIDE;
            continue;
          }
          const t = value(wx, wy);
          const col = cm(t);
          let f = 1;
          if (stripes) {
            const ph = t * 5;
            const fr = ph - Math.floor(ph);
            f = 0.82 + 0.18 * Math.cos(fr * 2 * Math.PI);
            if (t < 0.04) f = 0.25;
          }
          out[off + c] = pack(col[0] * f, col[1] * f, col[2] * f);
        }
      };
    },
  };
  return { src, info };
}

/** The continuous elevation function the cells sample (same normalisation and mask). */
export function noiseSource(world: World, p: Params): { src: RasterSource; info: RasterFieldInfo } | null {
  const g = world.graph;
  const fn = makeNoiseFn(p, world.seed, g.W);
  if (!fn || !world.elevNorm) return null;
  const mask = makeMaskFn(p, world.seed, g.W, g.H);
  const a = num(p, 'elev.maskStrength');
  const { lo, span, sea } = world.elevNorm;
  const water = COLORMAPS.terrain;
  const src: RasterSource = {
    key: `noise|${world.fingerprint}`,
    create() {
      return (_py, wy, wx0, dwx, cols, out, off) => {
        for (let c = 0; c < cols; c++) {
          const wx = wx0 + c * dwx;
          if (!inside(world, wx, wy)) {
            out[off + c] = OUTSIDE;
            continue;
          }
          let e = ((fn(wx, wy) - lo) / span) * 2 - 1;
          if (mask) e -= a * mask(wx, wy);
          // map relative to sea level into terrain colours (sea at t = 0.5)
          const t = e >= sea ? 0.5 + 0.5 * Math.min(1, (e - sea) / Math.max(1e-6, 1 - sea)) : 0.5 - 0.5 * Math.min(1, (sea - e) / Math.max(1e-6, sea + 1 + a));
          const col = water(t);
          out[off + c] = pack(col[0], col[1], col[2]);
        }
      };
    },
  };
  return {
    src,
    info: {
      label: 'Continuous elevation (pre-sampling)',
      colormap: water,
      minLabel: 'deep',
      maxLabel: 'peak',
      note: 'The function every cell samples at its centroid — compare with “Elevation” to see sampling loss.',
    },
  };
}

/** The island-mask signed distance field with iso-distance stripes and the zero contour. */
export function maskSource(world: World, p: Params): { src: RasterSource; info: RasterFieldInfo } | null {
  const g = world.graph;
  const mask = makeMaskFn(p, world.seed, g.W, g.H);
  if (!mask) return null;
  const cm = COLORMAPS.diverging;
  const half = g.H / 2;
  const src: RasterSource = {
    key: `mask|${world.fingerprint}`,
    create() {
      return (_py, wy, wx0, dwx, cols, out, off) => {
        const pxUnits = dwx / half; // one pixel in mask units
        for (let c = 0; c < cols; c++) {
          const wx = wx0 + c * dwx;
          if (!inside(world, wx, wy)) {
            out[off + c] = OUTSIDE;
            continue;
          }
          const d = mask(wx, wy);
          // inside (d < 0) maps to the land side of the diverging ramp
          const col = cm(0.5 - Math.max(-0.5, Math.min(0.5, d / 1.2)));
          const ph = d / 0.1;
          let f = 0.86 + 0.14 * Math.cos((ph - Math.floor(ph)) * 2 * Math.PI);
          if (Math.abs(d) < pxUnits * 1.2) f = 0.15;
          out[off + c] = pack(col[0] * f, col[1] * f, col[2] * f);
        }
      };
    },
  };
  return {
    src,
    info: {
      label: 'Island mask signed distance',
      colormap: (t: number) => cm(1 - t),
      minLabel: 'inside (−)',
      maxLabel: 'outside (+)',
      note: 'Stripes every 0.1 half-heights; the dark line is the zero contour. Elevation uses e = noise − α·sdf.',
    },
  };
}

/** Exact (per-pixel) noise network band, alpha-blended over the map. */
export function pathSource(world: World, p: Params): RasterSource | null {
  if (!bool(p, 'paths.enabled')) return null;
  const g = world.graph;
  const fn = makePathFn(p, world.seed, g.W, g.spacing);
  return {
    key: `paths|${world.fingerprint}`,
    create() {
      return (_py, wy, wx0, dwx, cols, out, off) => {
        for (let c = 0; c < cols; c++) {
          const wx = wx0 + c * dwx;
          if (!inside(world, wx, wy)) {
            out[off + c] = 0;
            continue;
          }
          const de = fn.de(wx, wy);
          const a = Math.max(0, Math.min(1, (fn.w - de) / dwx + 0.5));
          out[off + c] = a > 0 ? pack(255, 240, 200, Math.round(a * 230)) : 0;
        }
      };
    },
  };
}

