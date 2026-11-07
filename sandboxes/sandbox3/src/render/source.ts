/**
 * Per-pixel raster source for the map hierarchy. Every pixel is classified through
 * World.cellAt, so borders of every level and the coastline are pixel-exact at any
 * zoom: a pixel is on a border when its cell differs from its left or upper
 * neighbour's.
 */
import { hash4 } from '@shared/core/hash';
import { hashColor, hsl, type RGB } from '@shared/render/colormaps';
import type { RasterSource } from '@shared/render/raster';
import { keyI, keyJ } from '../world/level';
import { ORIGIN, type Cell, type World } from '../world/world';

export type ViewMode = 'map' | 'landsea' | 'genesis' | 'merges' | 'regions' | 'biomes' | 'subbiomes' | 'hierarchy';

export interface ViewOpts {
  mode: ViewMode;
  regEdges: boolean;
  bioEdges: boolean;
  subEdges: boolean;
  coast: boolean;
  /** 'auto' skips the subbiome level when subbiomes are under ~3 px */
  lod: 'auto' | 'full';
  pinBiome: number;
  pinSub: number;
}

export function pack(r: number, g: number, b: number): number {
  return (0xff000000 | (Math.max(0, Math.min(255, b)) << 16) | (Math.max(0, Math.min(255, g)) << 8) | Math.max(0, Math.min(255, r))) >>> 0;
}
const packRGB = (c: RGB) => pack(c[0], c[1], c[2]);

function scale(c: number, f: number): number {
  return pack((c & 255) * f, ((c >>> 8) & 255) * f, ((c >>> 16) & 255) * f);
}

function mix(c: number, r: number, g: number, b: number, t: number): number {
  const cr = c & 255;
  const cg = (c >>> 8) & 255;
  const cb = (c >>> 16) & 255;
  return pack(cr + (r - cr) * t, cg + (g - cg) * t, cb + (b - cb) * t);
}

/** Display hash of a cell key (salted per level). */
export function keyHash(key: number, salt: number): number {
  return hash4(0x0c0101, salt, keyI(key), keyJ(key));
}

/** Cosmetic land biome palette: biomes have no climate here, only a look. */
export const LAND_TYPES: { name: string; rgb: RGB }[] = [
  { name: 'Grassland', rgb: [143, 174, 93] },
  { name: 'Forest', rgb: [79, 127, 69] },
  { name: 'Old forest', rgb: [58, 100, 62] },
  { name: 'Steppe', rgb: [181, 176, 106] },
  { name: 'Desert', rgb: [214, 193, 140] },
  { name: 'Tundra', rgb: [160, 170, 152] },
  { name: 'Marsh', rgb: [96, 122, 86] },
  { name: 'Hills', rgb: [154, 138, 98] },
  { name: 'Savanna', rgb: [194, 169, 90] },
  { name: 'Taiga', rgb: [88, 118, 98] },
  { name: 'Scrub', rgb: [163, 156, 107] },
  { name: 'Heath', rgb: [140, 118, 118] },
];
export const OCEAN_RGB: RGB = [38, 84, 132];

export function landType(biomeKey: number): number {
  return keyHash(biomeKey, 1) % LAND_TYPES.length;
}

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

const FLAT_LAND = pack(150, 178, 112);
const FLAT_OCEAN = pack(38, 78, 128);
const COAST = pack(14, 20, 30);
const REGION_EDGE = [250, 236, 200] as const;

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

/** Colour of one classified cell (no borders). */
export function colorOf(c: Cell, mode: ViewMode): number {
  switch (mode) {
    case 'landsea':
      return c.ocean ? FLAT_OCEAN : FLAT_LAND;
    case 'genesis':
      return GENESIS_PX.get(c.origin) ?? GENESIS_PX.get(ORIGIN.grow + 3)!;
    case 'regions': {
      const base = cached('r', c.region, () => packRGB(hashColor(keyHash(c.region, 3))));
      return c.ocean ? scale(base, 0.42) : base;
    }
    case 'biomes': {
      const base = cached('b', c.biome, () => packRGB(hashColor(keyHash(c.biome, 4))));
      return c.ocean ? mix(scale(base, 0.5), 20, 50, 100, 0.45) : base;
    }
    case 'subbiomes': {
      const k = c.sub >= 0 ? c.sub : c.biome;
      const base = cached('s', k, () => packRGB(hashColor(keyHash(k, 5))));
      return c.ocean ? mix(scale(base, 0.5), 20, 50, 100, 0.45) : base;
    }
    case 'hierarchy': {
      const rh = keyHash(c.region, 3);
      const hue = (rh % 360) / 360;
      const bh = keyHash(c.biome, 4);
      const light = 0.42 + ((bh >>> 4) % 100) / 400;
      let px = packRGB(hsl(hue, 0.5, light));
      if (c.sub >= 0) px = scale(px, jitterF(keyHash(c.sub, 5), 0.07));
      return c.ocean ? scale(px, 0.42) : px;
    }
    case 'merges': {
      let px = c.ocean ? pack(40, 58, 84) : pack(118, 124, 112);
      if (c.biomeMerged) {
        const h = keyHash(c.biome, 6);
        px = packRGB(hsl((18 + (h % 34)) / 360, 0.75, c.ocean ? 0.38 : 0.55));
      }
      if (c.subMerged && c.sub >= 0) {
        const h = keyHash(c.sub, 7);
        const y = hsl((50 + (h % 20)) / 360, 0.85, 0.62);
        px = mix(px, y[0], y[1], y[2], c.biomeMerged ? 0.35 : 0.7);
      }
      return px;
    }
    default: {
      // cosmetic map
      if (c.ocean) {
        const f = jitterF(keyHash(c.biome, 8), 0.07) * (c.sub >= 0 ? jitterF(keyHash(c.sub, 9), 0.03) : 1);
        return pack(OCEAN_RGB[0] * f, OCEAN_RGB[1] * f, OCEAN_RGB[2] * f);
      }
      const t = LAND_TYPES[landType(c.biome)].rgb;
      const f = c.sub >= 0 ? jitterF(keyHash(c.sub, 9), 0.08) : 1;
      return pack(t[0] * f, t[1] * f, t[2] * f);
    }
  }
}

export function viewKey(v: ViewOpts): string {
  return `${v.mode}|${+v.regEdges}${+v.bioEdges}${+v.subEdges}${+v.coast}|${v.lod}|${v.pinBiome}|${v.pinSub}`;
}

/** Subbiomes are classified when at least this many raster pixels wide. */
export const DETAIL_PX = 3;

export function mapSource(world: World, genKey: string, v: ViewOpts): RasterSource {
  const S = world.subLevel.size;
  const B = world.biomeLevel.size;
  const R = world.regionLevel.size;
  return {
    key: `${genKey}|${viewKey(v)}`,
    create() {
      let cols = 0;
      let sub = new Float64Array(0);
      let bio = new Float64Array(0);
      let reg = new Float64Array(0);
      let oc = new Uint8Array(0);
      let pSub = new Float64Array(0);
      let pBio = new Float64Array(0);
      let pReg = new Float64Array(0);
      let pOc = new Uint8Array(0);
      let first = true;
      const tmp = {} as Cell;
      return (_py, wy, wx0, dwx, n, out, off) => {
        if (n !== cols) {
          cols = n;
          sub = new Float64Array(n);
          bio = new Float64Array(n);
          reg = new Float64Array(n);
          oc = new Uint8Array(n);
          pSub = new Float64Array(n);
          pBio = new Float64Array(n);
          pReg = new Float64Array(n);
          pOc = new Uint8Array(n);
          first = true;
        }
        const detail = v.lod === 'full' || S / dwx >= DETAIL_PX;
        // borders fade out before they would turn the map into a mesh
        const subEdges = v.subEdges && detail && S / dwx >= 8;
        const bioEdges = v.bioEdges && B / dwx >= 8;
        const regEdges = v.regEdges && R / dwx >= 5;
        for (let c = 0; c < n; c++) {
          const cell = world.cellAt(wx0 + c * dwx, wy, detail, tmp);
          sub[c] = cell.sub;
          bio[c] = cell.biome;
          reg[c] = cell.region;
          oc[c] = cell.ocean ? 1 : 0;
          let px = colorOf(cell, v.mode);
          if (cell.biome === v.pinBiome) px = mix(px, 253, 231, 37, 0.22);
          out[off + c] = px;
        }
        for (let c = 0; c < n; c++) {
          let px = out[off + c];
          const l = c > 0;
          const u = !first;
          if (v.coast && ((l && oc[c - 1] !== oc[c]) || (u && pOc[c] !== oc[c]))) px = COAST;
          else if (regEdges && ((l && reg[c - 1] !== reg[c]) || (u && pReg[c] !== reg[c])))
            px = mix(px, REGION_EDGE[0], REGION_EDGE[1], REGION_EDGE[2], 0.75);
          else if (bioEdges && ((l && bio[c - 1] !== bio[c]) || (u && pBio[c] !== bio[c]))) px = scale(px, 0.5);
          else if (subEdges && ((l && sub[c - 1] !== sub[c]) || (u && pSub[c] !== sub[c]))) px = scale(px, 0.8);
          // pinned outlines on top
          if (v.pinBiome >= 0) {
            const inB = bio[c] === v.pinBiome;
            if ((l && (bio[c - 1] === v.pinBiome) !== inB) || (u && (pBio[c] === v.pinBiome) !== inB)) px = pack(253, 231, 37);
          }
          if (v.pinSub >= 0 && detail) {
            const inS = sub[c] === v.pinSub;
            if ((l && (sub[c - 1] === v.pinSub) !== inS) || (u && (pSub[c] === v.pinSub) !== inS)) px = pack(90, 230, 255);
          }
          out[off + c] = px;
        }
        first = false;
        let t = pSub;
        pSub = sub;
        sub = t;
        t = pBio;
        pBio = bio;
        bio = t;
        t = pReg;
        pReg = reg;
        reg = t;
        const to = pOc;
        pOc = oc;
        oc = to;
      };
    },
  };
}
