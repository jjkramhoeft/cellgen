/**
 * Per-pixel raster source for the fractal Voronoi field. Every pixel is a pure
 * function of its world position, so edges and coastlines are pixel-exact at any
 * zoom: a pixel is on an edge when its octave-k cell differs from its left or upper
 * neighbour's.
 */
import { COLORMAPS, hashColor, type RGB } from '@shared/render/colormaps';
import type { RasterSource } from '@shared/render/raster';
import { newSample, type Calibration, type Field } from '../voronoi/field';

export type ViewMode = 'terrain' | 'flat' | 'value' | 'cellid' | 'octaves' | 'f1' | 'f2' | 'f2f1' | 'ratio' | 'worley';
export type EdgeMode = 'none' | 'coarse' | 'all' | 'selected';

export interface ViewOpts {
  mode: ViewMode;
  /** 0-based octave for cell / distance views */
  oct: number;
  edges: EdgeMode;
  coast: boolean;
  bevel: number;
  dim: boolean;
  pinned: { oct: number; id: number } | null;
}

export function pack(r: number, g: number, b: number): number {
  return (0xff000000 | (Math.max(0, Math.min(255, b)) << 16) | (Math.max(0, Math.min(255, g)) << 8) | Math.max(0, Math.min(255, r))) >>> 0;
}

function scale(c: number, f: number): number {
  return pack((c & 255) * f, ((c >>> 8) & 255) * f, ((c >>> 16) & 255) * f);
}

function mix(c: number, r: number, g: number, b: number, t: number): number {
  const cr = c & 255;
  const cg = (c >>> 8) & 255;
  const cb = (c >>> 16) & 255;
  return pack(cr + (r - cr) * t, cg + (g - cg) * t, cb + (b - cb) * t);
}

/** A colour map baked into a 256-entry lookup table of packed pixels. */
function lut(fn: (t: number) => RGB): Uint32Array {
  const out = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = fn(i / 255);
    out[i] = pack(c[0], c[1], c[2]);
  }
  return out;
}

const WATER = lut((t) => {
  // shallow → deep
  const a: RGB = [74, 132, 178];
  const b: RGB = [17, 38, 72];
  const u = Math.sqrt(t);
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
});
const LAND = lut((t) => {
  const stops: [number, RGB][] = [
    [0, [214, 200, 146]],
    [0.08, [128, 168, 94]],
    [0.45, [78, 128, 72]],
    [0.7, [140, 122, 92]],
    [0.88, [176, 168, 158]],
    [1, [240, 240, 236]],
  ];
  let k = 1;
  while (k < stops.length - 1 && stops[k][0] < t) k++;
  const [t0, c0] = stops[k - 1];
  const [t1, c1] = stops[k];
  const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u];
});
const MAGMA = lut(COLORMAPS.magma);
const VIRIDIS = lut(COLORMAPS.viridis);
const DIVERGING = lut(COLORMAPS.diverging);
const GRAY = lut(COLORMAPS.gray);
const FLUX = lut(COLORMAPS.flux);

const FLAT_LAND = pack(150, 178, 112);
const FLAT_WATER = pack(38, 78, 128);
const COAST = pack(16, 22, 32);

const idColorCache = new Map<number, number>();
function idColor(id: number, oct: number): number {
  const key = (id ^ Math.imul(oct + 1, 0x27d4eb2d)) | 0;
  let c = idColorCache.get(key);
  if (c === undefined) {
    const rgb = hashColor(key);
    c = pack(rgb[0], rgb[1], rgb[2]);
    if (idColorCache.size > 100000) idColorCache.clear();
    idColorCache.set(key, c);
  }
  return c;
}

function idx(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 255 : (t * 255) | 0;
}

/** Edge darkening per octave (coarse edges strongest). */
const EDGE_FACTOR = [0.45, 0.66, 0.8, 0.88];

export function viewKey(v: ViewOpts): string {
  return `${v.mode}|${v.oct}|${v.edges}|${v.coast}|${v.bevel}|${v.dim}|${v.pinned ? `${v.pinned.oct}:${v.pinned.id}` : '-'}`;
}

/** Colour one sample (no edges). Exported for thumbnails and tests. */
export function makeColorer(field: Field, cal: Calibration, v: ViewOpts): (s: ReturnType<typeof newSample>) => number {
  const K = field.octaves;
  const o = Math.min(K - 1, Math.max(0, v.oct));
  const T = cal.threshold;
  const up = Math.max(1e-9, cal.vmax - T);
  const down = Math.max(1e-9, T - cal.vmin);
  const span = Math.max(up, down);
  const bevel = v.bevel;
  const amps = field.amps;
  return (s) => {
    const h = s.hits[o];
    let c: number;
    switch (v.mode) {
      case 'flat':
        c = s.v > T ? FLAT_LAND : FLAT_WATER;
        break;
      case 'value':
        c = DIVERGING[idx(0.5 + (0.5 * (s.v - T)) / span)];
        break;
      case 'cellid':
        c = idColor(s.ids[o], o);
        break;
      case 'octaves': {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let k = 0; k < K; k++) {
          const ck = idColor(s.ids[k], k);
          r += amps[k] * (ck & 255);
          g += amps[k] * ((ck >>> 8) & 255);
          b += amps[k] * ((ck >>> 16) & 255);
        }
        c = pack(r, g, b);
        break;
      }
      case 'f1':
        c = MAGMA[idx(h.f1 / cal.f1Max[o])];
        break;
      case 'f2':
        c = VIRIDIS[idx(h.f2 / cal.f2Max[o])];
        break;
      case 'f2f1':
        c = FLUX[idx(Math.sqrt((h.f2 - h.f1) / cal.dfMax[o]))];
        break;
      case 'ratio':
        c = GRAY[idx(h.f2 > 0 ? 1 - h.f1 / h.f2 : 0)];
        break;
      case 'worley': {
        let f = 0;
        for (let k = 0; k < K; k++) f += amps[k] * s.hits[k].f1;
        c = MAGMA[idx(f / cal.f1SumMax)];
        break;
      }
      default:
        c = s.v > T ? LAND[idx((s.v - T) / up)] : WATER[idx((T - s.v) / down)];
    }
    if (bevel > 0 && v.mode !== 'f1' && v.mode !== 'f2' && v.mode !== 'f2f1' && v.mode !== 'ratio' && v.mode !== 'worley') {
      // F1/F2 → 1 at a cell border, 0 at the site: a soft raised-tile look
      // (weighted diagrams can have F1 > F2 in raw distance, so clamp)
      const r = h.f2 > 0 ? Math.min(1, h.f1 / h.f2) : 0;
      c = scale(c, 1 - bevel * 0.42 * r * r * r);
    }
    return c;
  };
}

export function fieldSource(field: Field, cal: Calibration, genKey: string, v: ViewOpts): RasterSource {
  const K = field.octaves;
  const o = Math.min(K - 1, Math.max(0, v.oct));
  const { W, H } = field.p;
  const T = cal.threshold;
  const edgeOcts: number[] =
    v.edges === 'none' ? [] : v.edges === 'coarse' ? [0] : v.edges === 'selected' ? [o] : Array.from({ length: K }, (_, k) => k);
  const pinned = v.pinned && v.pinned.oct < K ? v.pinned : null;
  return {
    key: `${genKey}|${viewKey(v)}`,
    create() {
      const sampler = field.makeSampler();
      const colorer = makeColorer(field, cal, v);
      const s = newSample(K);
      let cols = 0;
      let curIds = new Int32Array(0);
      let prevIds = new Int32Array(0);
      let curLand = new Uint8Array(0);
      let prevLand = new Uint8Array(0);
      let inside = new Uint8Array(0);
      let first = true;
      return (_py, wy, wx0, dwx, n, out, off) => {
        if (n !== cols) {
          cols = n;
          curIds = new Int32Array(n * K);
          prevIds = new Int32Array(n * K);
          curLand = new Uint8Array(n);
          prevLand = new Uint8Array(n);
          inside = new Uint8Array(n);
          first = true;
        }
        const rowIn = wy >= 0 && wy < H;
        for (let c = 0; c < n; c++) {
          const wx = wx0 + c * dwx;
          sampler(wx, wy, s);
          for (let k = 0; k < K; k++) curIds[c * K + k] = s.ids[k];
          curLand[c] = s.v > T ? 1 : 0;
          inside[c] = rowIn && wx >= 0 && wx < W ? 1 : 0;
          out[off + c] = colorer(s);
        }
        for (let c = 0; c < n; c++) {
          let col = out[off + c];
          const base = c * K;
          for (let e = 0; e < edgeOcts.length; e++) {
            const k = edgeOcts[e];
            const id = curIds[base + k];
            if ((c > 0 && curIds[base - K + k] !== id) || (!first && prevIds[base + k] !== id)) {
              col = scale(col, EDGE_FACTOR[k]);
              break;
            }
          }
          if (pinned) {
            const id = curIds[base + pinned.oct];
            const isIn = id === pinned.id;
            const leftIn = c > 0 ? curIds[base - K + pinned.oct] === pinned.id : isIn;
            const upIn = first ? isIn : prevIds[base + pinned.oct] === pinned.id;
            if (isIn !== leftIn || isIn !== upIn) col = pack(253, 231, 37);
            else if (isIn) col = mix(col, 253, 231, 37, 0.28);
          }
          if (v.coast) {
            const l = curLand[c];
            if ((c > 0 && curLand[c - 1] !== l) || (!first && prevLand[c] !== l)) col = COAST;
          }
          if (v.dim && !inside[c]) col = mix(col, 11, 14, 19, 0.55);
          out[off + c] = col;
        }
        first = false;
        const t = prevIds;
        prevIds = curIds;
        curIds = t;
        const tl = prevLand;
        prevLand = curLand;
        curLand = tl;
      };
    },
  };
}
