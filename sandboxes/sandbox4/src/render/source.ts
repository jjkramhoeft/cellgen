/**
 * Per-pixel raster source for the map hierarchy. Every pixel is classified through
 * World.cellAt, so borders of every level and the coastline are pixel-exact at any
 * zoom: a pixel is on a border when its cell differs from its left or upper
 * neighbour's.
 */
import { hash4 } from '@shared/core/hash';
import { hashColor, packColor, hsl, type RGB } from '@shared/render/colormaps';
import type { RasterSource } from '@shared/render/raster';
import { keyI, keyJ } from '../world/level';
import { ORIGIN, type Cell, type World } from '../world/world';
import { sample, type Terrain } from '../world/terrain';
import { ELEVATION_ZONE_TYPES, elevationZoneType, OCEAN_ZONE } from '../world/zones';
import { BIOMES, type Biomes } from '../world/biomes';

export type ViewMode = 'map' | 'biomes' | 'landsea' | 'genesis' | 'merges' | 'regions' | 'elevationZones' | 'subbiomes' | 'hierarchy' | 'height';

export interface ViewOpts {
  mode: ViewMode;
  regEdges: boolean;
  zoneEdges: boolean;
  subEdges: boolean;
  coast: boolean;
  /** 'auto' skips the subbiome level when subbiomes are under ~3 px */
  lod: 'auto' | 'full';
  pinElevationZone: number;
  pinSub: number;
  /** shade by the height map (always on for 'height') */
  hillshade: boolean;
}

const packRGB = (c: RGB) => packColor(c[0], c[1], c[2]);

function scale(c: number, f: number): number {
  return packColor((c & 255) * f, ((c >>> 8) & 255) * f, ((c >>> 16) & 255) * f);
}

function mix(c: number, r: number, g: number, b: number, t: number): number {
  const cr = c & 255;
  const cg = (c >>> 8) & 255;
  const cb = (c >>> 16) & 255;
  return packColor(cr + (r - cr) * t, cg + (g - cg) * t, cb + (b - cb) * t);
}

/** Display hash of a cell key (salted per level). */
export function keyHash(key: number, salt: number): number {
  return hash4(0x0c0101, salt, keyI(key), keyJ(key));
}

export const OCEAN_RGB: RGB = ELEVATION_ZONE_TYPES[OCEAN_ZONE].rgb;

export const GENESIS: { origin: number; name: string; rgb: RGB }[] = [
  { origin: ORIGIN.land, name: 'Land', rgb: [96, 104, 92] },
  { origin: ORIGIN.loneSeed, name: 'Lone seed', rgb: [255, 150, 60] },
  { origin: ORIGIN.linkedSeed, name: 'Linked seed', rgb: [253, 231, 37] },
  { origin: ORIGIN.chain, name: 'Link chain', rgb: [63, 193, 176] },
  { origin: ORIGIN.grow, name: 'Growth pass 1', rgb: [64, 128, 206] },
  { origin: ORIGIN.grow + 1, name: 'Growth pass 2', rgb: [104, 92, 206] },
  { origin: ORIGIN.grow + 2, name: 'Growth pass 3', rgb: [150, 84, 190] },
  { origin: ORIGIN.grow + 3, name: 'Growth pass 4', rgb: [190, 84, 150] },
];
const GENESIS_PX = new Map(GENESIS.map((g) => [g.origin, packRGB(g.rgb)]));
const BIOME_PX = BIOMES.map((b) => packRGB(b.rgb));

const FLAT_LAND = packColor(150, 178, 112);
const FLAT_OCEAN = packColor(38, 78, 128);
const COAST = packColor(14, 20, 30);
/** Region borders: a 3 px red dashed line, drawn over land, ocean and the coastline. */
const REGION_EDGE = packColor(235, 28, 36);
const REGION_THICK = 3;
const REGION_DASH_ON = 4;
const REGION_DASH_PERIOD = 7;

/** ±amt lightness factor from a hash. */
function jitterF(h: number, amt: number): number {
  return 1 + ((((h >>> 8) & 1023) / 1023) * 2 - 1) * amt;
}

const colorCache = new Map<string, number>();
function cached(tag: string, key: number, f: () => number): number {
  const k = tag + key;
  let c = colorCache.get(k);
  if (c === undefined) {
    if (colorCache.size > 200000) colorCache.clear();
    c = f();
    colorCache.set(k, c);
  }
  return c;
}

/** Colour of one classified cell (no borders). `biomes` is needed for the 'biomes' mode. */
export function colorOf(c: Cell, mode: ViewMode, biomes: Biomes | null = null): number {
  switch (mode) {
    case 'biomes': {
      if (c.ocean) return colorOf(c, 'map');
      if (!biomes) return FLAT_LAND;
      // one colour per biome, a little lighter / darker per subbiome so the cells still read
      const f = c.sub >= 0 ? jitterF(keyHash(c.sub, 9), 0.05) : 1;
      return scale(BIOME_PX[biomes.indexOf(c.sub, c.elevationZoneRaw)], f);
    }
    case 'landsea':
    case 'height': // until the height raster is ready
      return c.ocean ? FLAT_OCEAN : FLAT_LAND;
    case 'genesis':
      return GENESIS_PX.get(c.origin) ?? GENESIS_PX.get(ORIGIN.grow + 3)!;
    case 'regions': {
      const base = cached('r', c.region, () => packRGB(hashColor(keyHash(c.region, 3))));
      return c.ocean ? scale(base, 0.42) : base;
    }
    case 'elevationZones': {
      const base = cached('b', c.elevationZone, () => packRGB(hashColor(keyHash(c.elevationZone, 4))));
      return c.ocean ? mix(scale(base, 0.5), 20, 50, 100, 0.45) : base;
    }
    case 'subbiomes': {
      const k = c.sub >= 0 ? c.sub : c.elevationZone;
      const base = cached('s', k, () => packRGB(hashColor(keyHash(k, 5))));
      return c.ocean ? mix(scale(base, 0.5), 20, 50, 100, 0.45) : base;
    }
    case 'hierarchy': {
      const rh = keyHash(c.region, 3);
      const hue = (rh % 360) / 360;
      const bh = keyHash(c.elevationZone, 4);
      const light = 0.42 + ((bh >>> 4) % 100) / 400;
      let px = packRGB(hsl(hue, 0.5, light));
      if (c.sub >= 0) px = scale(px, jitterF(keyHash(c.sub, 5), 0.07));
      return c.ocean ? scale(px, 0.42) : px;
    }
    case 'merges': {
      let px = c.ocean ? packColor(40, 58, 84) : packColor(118, 124, 112);
      if (c.elevationZoneMerged) {
        const h = keyHash(c.elevationZone, 6);
        px = packRGB(hsl((18 + (h % 34)) / 360, 0.75, c.ocean ? 0.38 : 0.55));
      }
      if (c.subMerged && c.sub >= 0) {
        const h = keyHash(c.sub, 7);
        const y = hsl((50 + (h % 20)) / 360, 0.85, 0.62);
        px = mix(px, y[0], y[1], y[2], c.elevationZoneMerged ? 0.35 : 0.7);
      }
      return px;
    }
    default: {
      // map: elevation zone types
      if (c.ocean) {
        const f = jitterF(keyHash(c.elevationZone, 8), 0.07) * (c.sub >= 0 ? jitterF(keyHash(c.sub, 9), 0.03) : 1);
        return packColor(OCEAN_RGB[0] * f, OCEAN_RGB[1] * f, OCEAN_RGB[2] * f);
      }
      const t = ELEVATION_ZONE_TYPES[elevationZoneType(c.elevationZone, false)].rgb;
      const f = c.sub >= 0 ? jitterF(keyHash(c.sub, 9), 0.08) : 1;
      return packColor(t[0] * f, t[1] * f, t[2] * f);
    }
  }
}

export function viewKey(v: ViewOpts): string {
  return `${v.mode}|${+v.regEdges}${+v.zoneEdges}${+v.subEdges}${+v.coast}|${v.lod}|${v.pinElevationZone}|${v.pinSub}|${+v.hillshade}`;
}

/** Subbiomes are classified when at least this many raster pixels wide. */
export const DETAIL_PX = 3;

/** Hypsometric tint: stops (metres → colour) for land, and sea depth shades. */
const LAND_STOPS: [number, number, number, number][] = [
  [0, 72, 128, 76],
  [60, 104, 152, 84],
  [180, 150, 176, 98],
  [400, 206, 194, 122],
  [700, 182, 142, 94],
  [1100, 150, 120, 98],
  [1600, 168, 160, 156],
  [2400, 246, 246, 246],
];
export function heightColor(h: number): number {
  if (h < 0) {
    const t = Math.min(1, -h / 1200);
    return packColor(84 - 62 * t, 150 - 104 * t, 200 - 100 * t);
  }
  for (let k = 1; k < LAND_STOPS.length; k++) {
    const [h1, r1, g1, b1] = LAND_STOPS[k];
    if (h <= h1) {
      const [h0, r0, g0, b0] = LAND_STOPS[k - 1];
      const t = (h - h0) / (h1 - h0);
      return packColor(r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t);
    }
  }
  const last = LAND_STOPS[LAND_STOPS.length - 1];
  return packColor(last[1], last[2], last[3]);
}

/** Light from the north-west, 45° up (screen y grows southwards). */
const LX = -0.5;
const LY = -0.5;
const LZ = Math.SQRT1_2;
/** shading exaggeration so 1 km cells with gentle slopes still read */
const SHADE_EXAG = 4;

/**
 * `biomes` colours the 'biomes' mode; `biomeKey` names its state (parameters and the
 * terrain tiles its heights came from), so the map re-renders when either changes.
 */
export function mapSource(world: World, genKey: string, v: ViewOpts, terrain: Terrain | null = null, terrainVer = 0, biomes: Biomes | null = null, biomeKey = ''): RasterSource {
  const S = world.subLevel.size;
  const B = world.elevationZoneLevel.size;
  const R = world.regionLevel.size;
  return {
    key: `${genKey}|${viewKey(v)}|t${terrain && (v.hillshade || v.mode === 'height') ? terrainVer : '-'}|b${v.mode === 'biomes' ? biomeKey : '-'}`,
    create() {
      let cols = 0;
      let sub = new Float64Array(0);
      let zone = new Float64Array(0);
      let reg = new Float64Array(0);
      let oc = new Uint8Array(0);
      let pSub = new Float64Array(0);
      let pZone = new Float64Array(0);
      /** region keys of the REGION_THICK rows above (regUp[0] = the row just above) */
      let regUp: Float64Array<ArrayBuffer>[] = [];
      let pOc = new Uint8Array(0);
      let hRow = new Float64Array(0);
      let pH = new Float64Array(0);
      let row = 0;
      let first = true;
      const tmp = {} as Cell;
      return (_py, wy, wx0, dwx, n, out, off) => {
        if (n !== cols) {
          cols = n;
          sub = new Float64Array(n);
          zone = new Float64Array(n);
          reg = new Float64Array(n);
          oc = new Uint8Array(n);
          pSub = new Float64Array(n);
          pZone = new Float64Array(n);
          regUp = Array.from({ length: REGION_THICK }, () => new Float64Array(n));
          pOc = new Uint8Array(n);
          hRow = new Float64Array(n);
          pH = new Float64Array(n);
          first = true;
          row = 0;
        }
        const detail = v.lod === 'full' || S / dwx >= DETAIL_PX;
        // borders fade out before they would turn the map into a mesh
        const subEdges = v.subEdges && detail && S / dwx >= 8;
        const zoneEdges = v.zoneEdges && B / dwx >= 8;
        const regEdges = v.regEdges && R / dwx >= 5;
        const useH = terrain !== null && (v.hillshade || v.mode === 'height');
        for (let c = 0; c < n; c++) {
          const cell = world.cellAt(wx0 + c * dwx, wy, detail, tmp);
          sub[c] = cell.sub;
          zone[c] = cell.elevationZone;
          reg[c] = cell.region;
          oc[c] = cell.ocean ? 1 : 0;
          let px = colorOf(cell, v.mode, biomes);
          if (useH) {
            const t = terrain!.peek(cell.region);
            const h = t ? sample(t, wx0 + c * dwx, wy) : NaN;
            hRow[c] = h;
            if (v.mode === 'height' && h === h) px = heightColor(h);
          }
          if (cell.elevationZone === v.pinElevationZone) px = mix(px, 253, 231, 37, 0.22);
          out[off + c] = px;
        }
        // dash phase anchored to the world, so dashes don't crawl while panning
        const iy = Math.round(wy / dwx);
        const ix0 = Math.round(wx0 / dwx);
        for (let c = 0; c < n; c++) {
          let px = out[off + c];
          const l = c > 0;
          const u = !first;
          if (useH && l && u && !oc[c]) {
            // hillshade from the left and upper neighbours (land only; the sea stays flat)
            const h = hRow[c];
            const gx = ((h - hRow[c - 1]) / dwx) * SHADE_EXAG;
            const gy = ((h - pH[c]) / dwx) * SHADE_EXAG;
            if (gx === gx && gy === gy) {
              const shade = (-gx * LX - gy * LY + LZ) / Math.sqrt(gx * gx + gy * gy + 1);
              const f = 1 + 1.25 * (shade - LZ);
              px = scale(px, f < 0.35 ? 0.35 : f > 1.45 ? 1.45 : f);
            }
          }
          // REGION_THICK px thick: a pixel is on the border when another region lies within
          // 1 px to its right, REGION_THICK − 1 px to its left, or REGION_THICK rows above
          let regEdge = false;
          if (regEdges) {
            const r = reg[c];
            if (c + 1 < n && reg[c + 1] !== r) regEdge = true;
            for (let k = 1; k < REGION_THICK && !regEdge; k++) if (c - k >= 0 && reg[c - k] !== r) regEdge = true;
            for (let k = 0; k < REGION_THICK && k < row && !regEdge; k++) if (regUp[k][c] !== r) regEdge = true;
          }
          const dash = (((ix0 + c + iy) % REGION_DASH_PERIOD) + REGION_DASH_PERIOD) % REGION_DASH_PERIOD < REGION_DASH_ON;
          if (regEdge && dash) px = REGION_EDGE;
          else if (v.coast && ((l && oc[c - 1] !== oc[c]) || (u && pOc[c] !== oc[c]))) px = COAST;
          else if (zoneEdges && ((l && zone[c - 1] !== zone[c]) || (u && pZone[c] !== zone[c]))) px = scale(px, 0.5);
          else if (subEdges && ((l && sub[c - 1] !== sub[c]) || (u && pSub[c] !== sub[c]))) px = scale(px, 0.8);
          // pinned outlines on top
          if (v.pinElevationZone >= 0) {
            const inB = zone[c] === v.pinElevationZone;
            if ((l && (zone[c - 1] === v.pinElevationZone) !== inB) || (u && (pZone[c] === v.pinElevationZone) !== inB)) px = packColor(253, 231, 37);
          }
          if (v.pinSub >= 0 && detail) {
            const inS = sub[c] === v.pinSub;
            if ((l && (sub[c - 1] === v.pinSub) !== inS) || (u && (pSub[c] === v.pinSub) !== inS)) px = packColor(90, 230, 255);
          }
          out[off + c] = px;
        }
        first = false;
        row++;
        const th = pH;
        pH = hRow;
        hRow = th;
        let t = pSub;
        pSub = sub;
        sub = t;
        t = pZone;
        pZone = zone;
        zone = t;
        // shift region rows down: regUp[0] ← reg, the oldest row is reused
        t = regUp[REGION_THICK - 1];
        for (let k = REGION_THICK - 1; k > 0; k--) regUp[k] = regUp[k - 1];
        regUp[0] = reg;
        reg = t;
        const to = pOc;
        pOc = oc;
        oc = to;
      };
    },
  };
}
