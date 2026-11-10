/**
 * Biomes of the subbiomes (small cells), from the initial climate and the height map.
 *
 * Every land subbiome gets one biome, read at its (merged root's) site:
 *
 *   1. Temperature   the initial temperature T₀ (°C, the sea-level value) cooled with the
 *                    subbiome's height: T = T₀ − cooling(h), where cooling is a monotone
 *                    spline through 5 configurable points (height → °C cooler; the default
 *                    is the standard atmosphere's 6.5 °C per km). h is the mean height of
 *                    the subbiome's land from its terrain tile; while that tile is not
 *                    computed, a typical height of its elevation zone type stands in
 *                    (flagged as an estimate).
 *   2. Moisture      the initial precipitation P (mm/yr). In a river-poor ("sparse") flat
 *                    elevation zone (rivers.ts, `isSparseFlat`) it is multiplied by a
 *                    dryness factor, so those zones favour desert and steppe.
 *   3. Aridity       m = P / P_th with Köppen's dryness threshold for evenly spread rain,
 *                    P_th = 20·T + 140 mm (Peel et al. 2007): warm air needs more rain.
 *                    m < 0.5 is Köppen's desert (BW), 0.5–1 steppe (BS).
 *   4. Classify      a thermal belt (from T) × a moisture class (from m) table, with
 *                    Whittaker / Holdridge names. See docs/research/biomes-and-climate.md
 *                    §7.3 ("aridity × thermal belt"); the thresholds are this file's own
 *                    calibration against the Whittaker grid (§2.1), not sourced values.
 *   5. Mangrove      an azonal override (§7.2, step 6): a coastal subbiome (one of its
 *                    cells borders an ocean subbiome) in a flat or lowland elevation zone
 *                    becomes mangrove when it is warm enough (T ≥ `mangroveT`) and not
 *                    desert (m ≥ `mangroveM`). Never in hills or mountains, never inland.
 *                    Zoomed far out (elevation zones only) there is no mangrove: the
 *                    coastal strip is a subbiome feature.
 *
 * Pure functions of the seed, the parameters and the subbiome (comparisons and + − × ÷
 * only on top of the climate maps), apart from the height: exact once the subbiome's
 * terrain tile exists, an estimate before.
 */
import type { RGB } from '@shared/render/colormaps';
import type { Climate } from './climate';
import type { Rivers } from './rivers';
import { monotoneSpline, type Terrain } from './terrain';
import type { World } from './world';
import { ELEVATION_ZONE_TYPES, elevationZoneType } from './zones';

export type BiomeId =
  | 'ocean'
  | 'ice'
  | 'tundra'
  | 'coldSteppe'
  | 'taiga'
  | 'coldDesert'
  | 'grassland'
  | 'shrubland'
  | 'mixedForest'
  | 'broadleaf'
  | 'tempRainforest'
  | 'hotDesert'
  | 'thornScrub'
  | 'savanna'
  | 'dryForest'
  | 'rainforest'
  | 'mangrove';

export interface BiomeType {
  id: BiomeId;
  name: string;
  /** map colour: what the biome looks like from above (sand, dry grass, forest greens, snow) */
  rgb: RGB;
}

/** Every biome, in legend order (cold → hot, dry → wet within a belt; the azonal mangrove last). */
export const BIOMES: BiomeType[] = [
  { id: 'ocean', name: 'Ocean', rgb: [38, 84, 132] },
  { id: 'ice', name: 'Ice & snow', rgb: [234, 239, 243] },
  { id: 'tundra', name: 'Tundra', rgb: [146, 154, 138] },
  { id: 'coldSteppe', name: 'Cold steppe', rgb: [178, 171, 132] },
  { id: 'taiga', name: 'Boreal forest (taiga)', rgb: [56, 94, 78] },
  { id: 'coldDesert', name: 'Cold desert', rgb: [204, 189, 152] },
  { id: 'grassland', name: 'Temperate grassland', rgb: [186, 186, 112] },
  { id: 'shrubland', name: 'Woodland & shrubland', rgb: [144, 152, 90] },
  { id: 'mixedForest', name: 'Temperate mixed forest', rgb: [68, 114, 72] },
  { id: 'broadleaf', name: 'Temperate broadleaf forest', rgb: [90, 140, 64] },
  { id: 'tempRainforest', name: 'Temperate rainforest', rgb: [40, 102, 80] },
  { id: 'hotDesert', name: 'Hot desert', rgb: [229, 200, 138] },
  { id: 'thornScrub', name: 'Thorn scrub', rgb: [198, 166, 100] },
  { id: 'savanna', name: 'Savanna', rgb: [190, 176, 80] },
  { id: 'dryForest', name: 'Tropical dry forest', rgb: [122, 144, 58] },
  { id: 'rainforest', name: 'Tropical rainforest', rgb: [28, 94, 44] },
  { id: 'mangrove', name: 'Mangrove', rgb: [66, 132, 118] },
];

const B = (id: BiomeId) => BIOMES.findIndex((b) => b.id === id);
export const OCEAN_BIOME = B('ocean');
export const MANGROVE_BIOME = B('mangrove');

/** Elevation zone types (ELEVATION_ZONE_TYPES indices) where mangroves may grow: flat and lowland. */
export const MANGROVE_ZONES: ReadonlySet<number> = new Set(
  ELEVATION_ZONE_TYPES.flatMap((z, i) => (z.id === 'flat' || z.id === 'lowland' ? [i] : [])),
);

/**
 * Thermal belts by temperature after the height cooling (°C, lower bounds). Ice below −10,
 * tundra to −3 (Whittaker's tundra spans about −15 to −4 °C), boreal to 3, temperate to
 * 18 (Holdridge's frost line is 16–18 °C), then subtropical / tropical.
 */
export const BELTS = [
  { id: 'polar', name: 'Polar / nival', min: -Infinity },
  { id: 'subpolar', name: 'Subpolar / alpine', min: -10 },
  { id: 'boreal', name: 'Boreal / subalpine', min: -3 },
  { id: 'temperate', name: 'Temperate', min: 3 },
  { id: 'tropical', name: 'Subtropical / tropical', min: 18 },
] as const;

/** Cool / warm temperate split for the forests (Holdridge's cool temperate region ends near 12 °C). */
const WARM_TEMPERATE = 10;

/** Moisture classes by aridity m = P / P_th (upper bounds, except the last). */
export const MOISTURE = ['Arid', 'Semi-arid', 'Subhumid', 'Humid', 'Perhumid'] as const;

/**
 * Biome per moisture class in each belt, with the m bounds between the classes.
 * Rainforest needs m ≥ 6 when temperate (≈ 2000 mm at 10 °C) but only 4 when tropical
 * (≈ 2600 mm at 25 °C), as on the Whittaker grid.
 */
const TEMPERATE_BOUNDS = [0.5, 1, 2, 6];
const TROPICAL_BOUNDS = [0.5, 1, 2, 4];

/** Köppen's dryness threshold (mm/yr) for evenly spread rain; never below 40 mm (cold air). */
export function dryThreshold(t: number): number {
  return Math.max(40, 20 * t + 140);
}

/** Index of the first bound that m is below (bounds.length when none). */
function classOf(m: number, bounds: number[]): number {
  let k = 0;
  while (k < bounds.length && m >= bounds[k]) k++;
  return k;
}

export interface Classified {
  /** index into BIOMES */
  biome: number;
  /** index into BELTS */
  belt: number;
  /** index into MOISTURE */
  moisture: number;
  /** aridity P / P_th */
  aridity: number;
}

/** The biome of a land climate: temperature (°C, after the height cooling) and precipitation (mm/yr). */
export function classify(t: number, p: number): Classified {
  let belt = 0;
  for (let k = 1; k < BELTS.length; k++) if (t >= BELTS[k].min) belt = k;
  const aridity = p / dryThreshold(t);
  const id = BELTS[belt].id;
  let biome: number;
  let moisture: number;
  if (id === 'tropical') {
    moisture = classOf(aridity, TROPICAL_BOUNDS);
    biome = B((['hotDesert', 'thornScrub', 'savanna', 'dryForest', 'rainforest'] as const)[moisture]);
  } else {
    moisture = classOf(aridity, TEMPERATE_BOUNDS);
    if (id === 'polar') biome = B('ice');
    else if (id === 'subpolar') biome = B('tundra');
    else if (id === 'boreal') biome = B(aridity < 0.5 ? 'coldDesert' : aridity < 1 ? 'coldSteppe' : 'taiga');
    else {
      const forest = t >= WARM_TEMPERATE ? 'broadleaf' : 'mixedForest';
      biome = B((['coldDesert', 'grassland', 'shrubland', forest, 'tempRainforest'] as const)[moisture]);
    }
  }
  return { biome, belt, moisture, aridity };
}

/**
 * How much cooler it is at a height: a monotone cubic spline (terrain.ts, `monotoneSpline`)
 * through the control points (height in metres → cooling in °C), sorted by height. Below
 * the first point it stays at the first point's cooling; above the last it carries on
 * along the last segment's slope, so peaks above the curve keep getting colder.
 * + − × ÷ √ only (bit-exact).
 */
export function coolingCurve(hs: number[], cs: number[]): (h: number) => number {
  const spline = monotoneSpline(hs, cs);
  const pts = hs.map((h, i) => [h, cs[i]] as [number, number]).sort((a, b) => a[0] - b[0]);
  const ph: number[] = [];
  const pc: number[] = [];
  for (const [h, c] of pts) {
    if (ph.length && h <= ph[ph.length - 1]) continue;
    ph.push(h);
    pc.push(c);
  }
  const n = ph.length;
  if (n < 2) return spline;
  const top = ph[n - 1];
  const slope = (pc[n - 1] - pc[n - 2]) / (top - ph[n - 2]);
  return (h) => (h > top ? pc[n - 1] + slope * (h - top) : spline(h));
}

export interface BiomeParams {
  /** cooling curve: control point heights (m) and how much cooler it is there (°C) */
  coolH: number[];
  coolT: number[];
  /** precipitation factor in river-poor (sparse) flat elevation zones (1 = no effect) */
  sparseDry: number;
  /** mangrove: least temperature (°C, after the height cooling) and least aridity P / P_th */
  mangroveT: number;
  mangroveM: number;
}

/**
 * Typical mean subbiome height per elevation zone type (index = ELEVATION_ZONE_TYPES
 * order), metres: the medians measured on the default terrain (1 km cells, two seeds).
 * Only used until the subbiome's terrain tile is computed.
 */
export const TYPICAL_HEIGHT = [0, 70, 140, 270, 470];

/** Everything that went into one subbiome's biome (for the inspector). */
export interface BiomeInfo extends Classified {
  /** the subbiome (merged root) or, zoomed far out, the elevation zone it was read for */
  key: number;
  level: 'sub' | 'zone';
  ocean: boolean;
  /** type of its (merged) elevation zone, index into ELEVATION_ZONE_TYPES */
  zoneType: number;
  /** site the climate was read at, metres */
  x: number;
  y: number;
  /** initial (sea-level) temperature, °C, and precipitation, mm/yr, at the site */
  t0: number;
  p0: number;
  /** mean land height used for the cooling, metres; exact (from the terrain tile) or an estimate */
  height: number;
  heightExact: boolean;
  /** how much cooler the height makes it, °C (the cooling curve at `height`) */
  cooling: number;
  /** temperature after the cooling and effective precipitation, as classified */
  t: number;
  p: number;
  /** in a river-poor flat elevation zone (precipitation × sparseDry) */
  sparse: boolean;
  /** a land subbiome bordering the ocean (always false zoomed out, at elevation zone level) */
  coastal: boolean;
  /** the biome the sea-level temperature alone would give (differs on high ground) */
  seaLevel: number;
}

/** Subbiome infos kept at most (each is small; the map re-reads them per pixel). */
const CACHE = 400_000;

export class Biomes {
  private cache = new Map<number, BiomeInfo>();
  private zoneCache = new Map<number, BiomeInfo>();
  private coastCache = new Map<number, boolean>();
  /** °C cooler at a height (m): the cooling curve of the parameters */
  readonly cooling: (h: number) => number;

  constructor(
    readonly world: World,
    readonly rivers: Rivers,
    readonly climate: Climate,
    readonly terrain: Terrain | null,
    readonly p: BiomeParams,
  ) {
    this.cooling = coolingCurve(p.coolH, p.coolT);
  }

  /**
   * Biome of a (merged) subbiome. Cached once its height is exact; an estimate is
   * recomputed on every call until the terrain tile arrives.
   */
  ofSub(skey: number): BiomeInfo {
    const hit = this.cache.get(skey);
    if (hit && hit.heightExact) return hit;
    const w = this.world;
    const c = w.subCell(skey);
    const h = this.terrain && !c.ocean ? this.terrain.subHeight(c.sub, c.region) : NaN;
    if (hit && h !== h) return hit;
    const s = w.sub(c.sub);
    const info = this.info(c.sub, 'sub', s.x, s.y, c.elevationZone, c.ocean, h);
    if (this.cache.size >= CACHE) this.cache.clear();
    this.cache.set(skey, info);
    return info;
  }

  /** Biome of an elevation zone at its own site (zoomed far out, where subbiomes are skipped); always an estimated height. */
  ofZone(zkey: number): BiomeInfo {
    let info = this.zoneCache.get(zkey);
    if (info) return info;
    const c = this.world.elevationZoneCell(zkey);
    const z = this.world.elevationZone(c.elevationZone);
    info = this.info(c.elevationZone, 'zone', z.x, z.y, c.elevationZone, c.ocean, NaN);
    if (this.zoneCache.size >= CACHE) this.zoneCache.clear();
    this.zoneCache.set(zkey, info);
    return info;
  }

  /**
   * Does a (merged) land subbiome border the ocean: is a cell next to one of its raw
   * subbiomes an ocean subbiome? Merges go to neighbours, so the raw members are found
   * by walking neighbours that share the root.
   */
  isCoastal(root: number): boolean {
    const hit = this.coastCache.get(root);
    if (hit !== undefined) return hit;
    const w = this.world;
    let coast = false;
    const seen = new Set<number>([root]);
    const stack = [root];
    while (stack.length && !coast) {
      const s = stack.pop()!;
      for (const n of w.subNbrs(w.sub(s))) {
        if (w.subCell(n).ocean) {
          coast = true;
          break;
        }
        if (!seen.has(n) && w.subRoot(n) === root) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    if (this.coastCache.size >= CACHE) this.coastCache.clear();
    this.coastCache.set(root, coast);
    return coast;
  }

  /** Biome index of a classified map cell (subbiome, or elevation zone when sub < 0). */
  indexOf(sub: number, zoneRaw: number): number {
    return sub >= 0 ? this.ofSub(sub).biome : this.ofZone(zoneRaw).biome;
  }

  private info(key: number, level: 'sub' | 'zone', x: number, y: number, zone: number, ocean: boolean, h: number): BiomeInfo {
    const t0 = this.climate.temperatureAt(x, y);
    const p0 = this.climate.precipitationAt(x, y);
    const exact = h === h;
    const zoneType = elevationZoneType(zone, ocean);
    const height = exact ? Math.max(0, h) : TYPICAL_HEIGHT[zoneType];
    const sparse = !ocean && this.rivers.isSparseFlat(zone);
    const cooling = ocean ? 0 : this.cooling(height);
    const t = t0 - cooling;
    const p = sparse ? p0 * this.p.sparseDry : p0;
    const k = classify(t, p);
    const coastal = !ocean && level === 'sub' && this.isCoastal(key);
    const base = { key, level, ocean, zoneType, x, y, t0, p0, height, heightExact: exact, cooling, t, p, sparse, coastal };
    if (ocean) return { ...base, ...k, biome: OCEAN_BIOME, seaLevel: OCEAN_BIOME };
    // the mangrove override, for the actual and the sea-level temperature alike
    const pick = (c: Classified, tt: number) => (coastal && MANGROVE_ZONES.has(zoneType) && tt >= this.p.mangroveT && c.aridity >= this.p.mangroveM ? MANGROVE_BIOME : c.biome);
    return { ...base, ...k, biome: pick(k, t), seaLevel: pick(classify(t0, p), t0) };
  }
}
