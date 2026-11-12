/**
 * Natural resources of the patches (docs/research/patch-resources.md is the catalogue,
 * docs/research/game-resources-and-trade.md §5.2–5.3 the 24 raw game resources used here).
 *
 * Every patch gets an amount in [0, 1] for each of the 24 raw resources, and with it the
 * catalogue variant that fits the patch best ("grain: rye", "timber: teak", "iron ore: bog
 * iron"). Two kinds:
 *
 *   Potentials   what the land can yield, from the climate and the position: crops (grain,
 *                produce, orchard, fibre, spices, stimulants, dyes), pasture, fish, game,
 *                timber, clay, fuel. The amount is a suitability.
 *                  Crops     the best of a table of crops, each an ECOCROP trapezoid over
 *                            the growing-season temperature and the yearly water (0 outside
 *                            the absolute limits, 1 inside the optimum), times the farmland
 *                            of the zone type, the soil of the biome and the length of the
 *                            growing season. A river irrigates: it adds water up to the
 *                            crop's optimum, so desert rivers grow wheat and dates.
 *                            Luxury crops (spices, stimulants, dyes) only grow in some
 *                            elevation zones (a hashed gate per crop and zone), so they
 *                            are regional specialities.
 *                  The rest  tables by biome and zone type, plus the water of the patch
 *                            (coast, harbour, river size, lake).
 *   Deposits     rare point resources: stone, crystal, salt, the ores, gems. A hashed draw
 *                per patch against a chance from the bedrock of its elevation zone, the
 *                zone type and the climate; the amount is the richness of the deposit.
 *                  Bedrock   every (merged) land elevation zone has one bedrock class,
 *                            hashed by weight from its zone type (shields and basins under
 *                            flat land, fold belts and volcanic arcs under mountains).
 *                            Copper and tin come from different classes, so no zone has
 *                            both.
 *                  Placers   gold and tin washed down the rivers: the share of a river's
 *                            upstream network that lies in lode-bearing hills and
 *                            mountains (per region, from the river tree).
 *
 *   Prosperity   the prosperity map (climate.ts) at the patch's site sets how often the
 *                valuable things turn up: gold, silver & lead, gems & pearls, and the
 *                luxuries (spices, stimulants, dyes, furs and ivory). Their deposit
 *                chances and the share of zones a luxury crop grows in are multiplied by
 *                (2 x prosperity)^2, prosperity taken from 0 (the map's minimum) to 1: a
 *                quarter in poor land, 1 in the middle, 2.25 in rich land, 4 at the top.
 *                Furs and ivory are regional too: fur animals worth trapping in half of
 *                the cold zones, ivory and big cats in three tenths of the hot ones, at
 *                the middle of the prosperity map.
 *                Everything else (food, materials, fuel, salt, iron, copper, tin) ignores it.
 *
 * Ocean patches have fish, and on the shelf (next to land) seaweed, seals, pearls and coral.
 *
 * Deterministic: a pure function of the seed, the parameters and the patch. The river and
 * lake inputs ("sites") are read per region, as drawn, like the lakes and the locations.
 * Hashes, comparisons and + − × ÷ only. With terrain-less Biomes (zone-typical heights)
 * the resources never change as terrain tiles arrive; with the map's Biomes they follow the
 * exact patch heights, like the biomes themselves.
 */
import { hash4, toUnit } from '@shared/core/hash';
import { BELTS, BIOMES, type BiomeId, type BiomeInfo, type Biomes } from './biomes';
import type { Climate } from './climate';
import type { Lakes } from './lakes';
import { keyI, keyJ } from './level';
import type { Rivers } from './rivers';
import type { World } from './world';
import { ELEVATION_ZONE_TYPES, elevationZoneType } from './zones';

// ------------------------------------------------------------------ the resource set

export type ResourceGroup = 'food' | 'materials' | 'fuel' | 'salt' | 'metals' | 'luxuries' | 'animals';

export const RESOURCE_GROUPS: { id: ResourceGroup; name: string }[] = [
  { id: 'food', name: 'Food' },
  { id: 'materials', name: 'Materials' },
  { id: 'fuel', name: 'Fuel' },
  { id: 'salt', name: 'Salt' },
  { id: 'metals', name: 'Metals' },
  { id: 'luxuries', name: 'Luxuries' },
  { id: 'animals', name: 'Animals' },
];

export type ResourceId =
  | 'grain'
  | 'produce'
  | 'orchard'
  | 'livestock'
  | 'fish'
  | 'wildFood'
  | 'timber'
  | 'stone'
  | 'clay'
  | 'crystal'
  | 'fibre'
  | 'fuel'
  | 'salt'
  | 'ironOre'
  | 'copperOre'
  | 'tin'
  | 'silverLead'
  | 'gold'
  | 'gems'
  | 'spices'
  | 'stimulants'
  | 'furs'
  | 'dyes'
  | 'horses';

/** potential = a suitability every patch has; deposit = a rare hashed point resource; both = a potential with deposits on top */
export type ResourceKind = 'potential' | 'deposit' | 'both';
export type ResourceValue = 'subsistence' | 'bulk' | 'trade' | 'luxury';

export interface ResourceType {
  id: ResourceId;
  name: string;
  group: ResourceGroup;
  kind: ResourceKind;
  /** how far it is worth carrying (game-resources-and-trade.md §5.7) */
  value: ResourceValue;
}

/** The 24 raw resources, in group order. */
export const RESOURCES: ResourceType[] = [
  { id: 'grain', name: 'Grain', group: 'food', kind: 'potential', value: 'bulk' },
  { id: 'produce', name: 'Produce', group: 'food', kind: 'potential', value: 'subsistence' },
  { id: 'orchard', name: 'Orchard', group: 'food', kind: 'potential', value: 'bulk' },
  { id: 'livestock', name: 'Livestock', group: 'food', kind: 'potential', value: 'bulk' },
  { id: 'fish', name: 'Fish', group: 'food', kind: 'potential', value: 'bulk' },
  { id: 'wildFood', name: 'Wild food & game', group: 'food', kind: 'potential', value: 'subsistence' },
  { id: 'timber', name: 'Timber', group: 'materials', kind: 'potential', value: 'bulk' },
  { id: 'stone', name: 'Stone', group: 'materials', kind: 'deposit', value: 'bulk' },
  { id: 'clay', name: 'Clay & earth', group: 'materials', kind: 'both', value: 'bulk' },
  { id: 'crystal', name: 'Crystal', group: 'materials', kind: 'deposit', value: 'trade' },
  { id: 'fibre', name: 'Fibre', group: 'materials', kind: 'potential', value: 'bulk' },
  { id: 'fuel', name: 'Fuel', group: 'fuel', kind: 'both', value: 'bulk' },
  { id: 'salt', name: 'Salt', group: 'salt', kind: 'deposit', value: 'trade' },
  { id: 'ironOre', name: 'Iron ore', group: 'metals', kind: 'deposit', value: 'bulk' },
  { id: 'copperOre', name: 'Copper ore', group: 'metals', kind: 'deposit', value: 'trade' },
  { id: 'tin', name: 'Tin', group: 'metals', kind: 'deposit', value: 'luxury' },
  { id: 'silverLead', name: 'Silver & lead', group: 'metals', kind: 'deposit', value: 'luxury' },
  { id: 'gold', name: 'Gold', group: 'metals', kind: 'deposit', value: 'luxury' },
  { id: 'gems', name: 'Gems & pearls', group: 'luxuries', kind: 'deposit', value: 'luxury' },
  { id: 'spices', name: 'Spices & incense', group: 'luxuries', kind: 'potential', value: 'luxury' },
  { id: 'stimulants', name: 'Stimulants & sugar', group: 'luxuries', kind: 'potential', value: 'trade' },
  { id: 'furs', name: 'Furs & ivory', group: 'luxuries', kind: 'potential', value: 'luxury' },
  { id: 'dyes', name: 'Dyes', group: 'luxuries', kind: 'both', value: 'trade' },
  { id: 'horses', name: 'Horses & pack animals', group: 'animals', kind: 'potential', value: 'trade' },
];

/** Index of a resource in RESOURCES. */
export const resourceIndex = (id: ResourceId): number => RESOURCES.findIndex((r) => r.id === id);

const GRAIN = resourceIndex('grain');
const PRODUCE = resourceIndex('produce');
const ORCHARD = resourceIndex('orchard');
const LIVESTOCK = resourceIndex('livestock');
const FISH = resourceIndex('fish');
const WILD = resourceIndex('wildFood');
const TIMBER = resourceIndex('timber');
const STONE = resourceIndex('stone');
const CLAY = resourceIndex('clay');
const CRYSTAL = resourceIndex('crystal');
const FIBRE = resourceIndex('fibre');
const FUEL = resourceIndex('fuel');
const SALT = resourceIndex('salt');
const IRON = resourceIndex('ironOre');
const COPPER = resourceIndex('copperOre');
const TIN = resourceIndex('tin');
const SILVER = resourceIndex('silverLead');
const GOLD = resourceIndex('gold');
const GEMS = resourceIndex('gems');
const SPICES = resourceIndex('spices');
const STIMULANTS = resourceIndex('stimulants');
const FURS = resourceIndex('furs');
const DYES = resourceIndex('dyes');
const HORSES = resourceIndex('horses');

/** The resources whose frequency follows the prosperity map: the precious metals, gems and the luxuries. */
export const PROSPERITY_RESOURCES: ResourceId[] = ['silverLead', 'gold', 'gems', 'spices', 'stimulants', 'furs', 'dyes'];
const PROSPEROUS = RESOURCES.map((r) => PROSPERITY_RESOURCES.includes(r.id));

/**
 * How much more often the PROSPERITY_RESOURCES turn up at a prosperity of 0–1 (the
 * prosperity map between its minimum and maximum): (2 x prosperity)^2, so 0.25 at a
 * quarter, 1 in the middle, 2.25 at three quarters and 4 at the top.
 */
export function prosperityBoost(prosperity: number): number {
  const p = prosperity < 0 ? 0 : prosperity > 1 ? 1 : prosperity;
  return 4 * p * p;
}

/** A resource is listed for a patch from this amount. */
export const MIN_AMOUNT = 0.25;

// ------------------------------------------------------------------ bedrock

export type BedrockId = 'shield' | 'foldBelt' | 'granite' | 'volcanic' | 'basalt' | 'ophiolite' | 'carbonate' | 'clastic' | 'alluvium';

export interface BedrockType {
  id: BedrockId;
  name: string;
  /** relative share among the zones of each land type: flat, lowland, hills, mountains (whole numbers) */
  weights: [number, number, number, number];
}

/** Bedrock classes (patch-resources.md §7.3), with how common each is under each land zone type. */
export const BEDROCKS: BedrockType[] = [
  { id: 'shield', name: 'Crystalline shield', weights: [20, 20, 20, 10] },
  { id: 'foldBelt', name: 'Fold belt', weights: [0, 5, 30, 40] },
  { id: 'granite', name: 'Granite intrusion', weights: [0, 3, 15, 20] },
  { id: 'volcanic', name: 'Volcanic arc', weights: [0, 2, 10, 30] },
  { id: 'basalt', name: 'Flood basalt', weights: [10, 10, 15, 5] },
  { id: 'ophiolite', name: 'Ophiolite', weights: [0, 2, 10, 15] },
  { id: 'carbonate', name: 'Carbonate platform', weights: [15, 30, 30, 15] },
  { id: 'clastic', name: 'Clastic basin', weights: [40, 40, 20, 5] },
  { id: 'alluvium', name: 'Unconsolidated cover', weights: [60, 40, 0, 0] },
];

const ST_BEDROCK = 0x5e01;
const ST_PLAYA = 0x5e02;
const ST_EVAPORITE = 0x5e03;
const ST_IVORY = 0x5e04;
const ST_FUR = 0x5e05;
const ST_PICK = 0x5e10;
const ST_GATE = 0x5e100;
const ST_DEPOSIT = 0x5e400;
const ST_RICH = 0x5e800;

const ZONE_INDEX = (id: string) => ELEVATION_ZONE_TYPES.findIndex((t) => t.id === id);
const LOWLAND = ZONE_INDEX('lowland');
const HILLS = ZONE_INDEX('hills');
const MOUNTAINS = ZONE_INDEX('mountains');
/** Position of a zone type among the land types (flat 0 … mountains 3), −1 for ocean. */
const LAND_ORDER = ELEVATION_ZONE_TYPES.map((t) => ['flat', 'lowland', 'hills', 'mountains'].indexOf(t.id));

/**
 * Bedrock class (index into BEDROCKS) of a land elevation zone (merged root) of a zone
 * type, −1 for ocean: hashed from the seed and the zone key, by the weights of the type.
 */
export function bedrockOf(seed: number, zkey: number, zoneType: number): number {
  const col = LAND_ORDER[zoneType];
  if (col < 0) return -1;
  let total = 0;
  for (const b of BEDROCKS) total += b.weights[col];
  let h = hash4(seed, ST_BEDROCK, keyI(zkey), keyJ(zkey)) % total;
  for (let i = 0; i < BEDROCKS.length; i++) {
    h -= BEDROCKS[i].weights[col];
    if (h < 0) return i;
  }
  return BEDROCKS.length - 1;
}

const ROCK = (id: BedrockId) => BEDROCKS.findIndex((b) => b.id === id);
const SHIELD = ROCK('shield');
const FOLD = ROCK('foldBelt');
const GRANITE = ROCK('granite');
const VOLCANIC = ROCK('volcanic');
const BASALT = ROCK('basalt');
const OPHIOLITE = ROCK('ophiolite');
const CARBONATE = ROCK('carbonate');
const CLASTIC = ROCK('clastic');
const ALLUVIUM = ROCK('alluvium');

/** Bedrock that carries copper. Tin (granite, and placers below it) never shares a zone with these. */
const COPPER_ROCK = new Set([VOLCANIC, BASALT, OPHIOLITE, CLASTIC]);
/** Bedrock whose hills and mountains shed gold into the rivers. */
const GOLD_ROCK = new Set([FOLD, VOLCANIC, SHIELD]);

// ------------------------------------------------------------------ sites and results

/** What a land patch gets from its region's rivers and lakes (terrain-free). */
export interface PatchSite {
  /** the largest river in the patch, and the largest that meets the sea here: patches drained upstream (flow / attractors per patch); 0 = none */
  river: number;
  mouth: number;
  /** area of the largest lake placed in the patch, m² (0 = none) */
  lake: number;
  /** on the coast of an enclosed bay */
  harbour: boolean;
  /** share (0–1) of the river's upstream network, at its largest point here, in gold-bearing and in tin-bearing hills and mountains */
  goldLoad: number;
  tinLoad: number;
}

const NO_SITE: PatchSite = { river: 0, mouth: 0, lake: 0, harbour: false, goldLoad: 0, tinLoad: 0 };

export interface ResourceHit {
  /** index into RESOURCES */
  resource: number;
  amount: number;
  variant: string;
}

export interface PatchResources {
  /** the patch (merged root) */
  patch: number;
  ocean: boolean;
  /** bedrock of its elevation zone, index into BEDROCKS (−1 for ocean) */
  bedrock: number;
  /** per RESOURCES index: the amount, 0–1 (suitability of a potential, richness of a deposit), and the catalogue variant behind it ('' when 0) */
  amount: number[];
  variant: string[];
  /** the resources of at least MIN_AMOUNT, largest first (ties in RESOURCES order) */
  list: ResourceHit[];
  /** food a settlement can count on from the patch, 0–1 (`foodOf`), and its trade goods (`wealthOf`) */
  food: number;
  wealth: number;
  /** the prosperity map at the patch's site, 0–1 between its minimum and maximum, and what it makes of the chances of the PROSPERITY_RESOURCES (`prosperityBoost`) */
  prosperity: number;
  boost: number;
  site: PatchSite;
}

const sat = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ramp = (v: number, a: number, b: number) => sat((v - a) / (b - a));
/** Trapezoid: 0 at and below a, 1 on [b, c], 0 at and above d. */
const trap = (v: number, a: number, b: number, c: number, d: number) => (v <= a || v >= d ? 0 : v < b ? (v - a) / (b - a) : v <= c ? 1 : (d - v) / (d - c));

const BIOME_TABLE = (values: Record<BiomeId, number>) => BIOMES.map((b) => values[b.id]);
const ZONE_TABLE = (flat: number, lowland: number, hills: number, mountains: number) => ELEVATION_ZONE_TYPES.map((t) => ({ ocean: 0, flat, lowland, hills, mountains })[t.id]);

/** Is this raw ocean patch mostly enclosed by land (at least 3 land neighbours, and more land than ocean ones)? */
export function isBayPatch(w: World, o: number): boolean {
  const nb = w.patchNbrs(w.patch(o));
  let l = 0;
  for (const q of nb) if (!w.patchCell(q).ocean) l++;
  return l >= 3 && 2 * l > nb.length;
}

// ------------------------------------------------------------------ crops

interface Crop {
  name: string;
  /** growing-season temperature, °C: absolute min, optimum min and max, absolute max */
  t: [number, number, number, number];
  /** yearly water, mm */
  p: [number, number, number, number];
  /** unique index (the zone gate's hash stage) */
  n: number;
  /** farmland by zone type (ELEVATION_ZONE_TYPES order); default FARM_ZONE */
  zones?: number[];
  /** least and most yearly mean temperature, °C (frost-tender and chill-needing perennials); fades over 2 °C */
  minT?: number;
  maxT?: number;
  /** a tree or shrub crop: no short-season penalty and no poor-soil penalty */
  tree?: boolean;
  needs?: 'river' | 'coast' | 'highland';
  /** share of the elevation zones where it grows at all (a regional speciality) */
  gate?: number;
  /** yield factor */
  k?: number;
}

let cropCount = 0;
const crop = (name: string, t: Crop['t'], p: Crop['p'], o: Omit<Crop, 'name' | 't' | 'p' | 'n'> = {}): Crop => ({ name, t, p, n: cropCount++, ...o });

/** Farmland by zone type: field crops like flat ground. */
const FARM_ZONE = ZONE_TABLE(1, 1, 0.6, 0.3);
/** Terraces and slopes: crops of the hills. */
const SLOPE_ZONE = ZONE_TABLE(0.6, 0.85, 1, 0.6);
const HIGH_ZONE = ZONE_TABLE(0.4, 0.6, 1, 0.9);
const WET_ZONE = ZONE_TABLE(1, 1, 0.35, 0);
/** Soil for field crops once cleared: leached under rainforest, podzol under taiga, saline in mangrove. */
const SOIL = BIOME_TABLE({ ocean: 0, ice: 0, tundra: 0.3, coldSteppe: 1, taiga: 0.55, coldDesert: 1, grassland: 1, shrubland: 1, mixedForest: 1, broadleaf: 1, tempRainforest: 0.55, hotDesert: 1, thornScrub: 0.7, savanna: 0.6, dryForest: 0.7, rainforest: 0.4, mangrove: 0.3 });
/** Ground for tree crops: not in swamp, on ice or on tundra. */
const TREE_GROUND = BIOME_TABLE({ ocean: 0, ice: 0, tundra: 0.2, coldSteppe: 1, taiga: 1, coldDesert: 1, grassland: 1, shrubland: 1, mixedForest: 1, broadleaf: 1, tempRainforest: 1, hotDesert: 1, thornScrub: 1, savanna: 1, dryForest: 1, rainforest: 1, mangrove: 0.4 });

// ECOCROP limits as listed in patch-resources.md §4 (row numbers there).
const GRAINS: Crop[] = [
  crop('bread wheat', [5, 15, 23, 27], [300, 750, 900, 1600]),
  crop('durum wheat', [6, 17, 25, 30], [400, 500, 700, 800], { minT: 9 }),
  crop('barley', [2, 15, 20, 40], [200, 500, 1000, 2000], { k: 0.85 }),
  crop('rye', [3, 15, 20, 31], [400, 600, 1000, 2000], { maxT: 12, k: 0.8 }),
  crop('oats', [5, 16, 20, 30], [250, 600, 1000, 1500], { maxT: 13, k: 0.8 }),
  crop('paddy rice', [10, 20, 30, 36], [1000, 1500, 2000, 4000], { zones: WET_ZONE, minT: 12 }),
  crop('maize', [10, 18, 33, 47], [400, 600, 1200, 1800], { minT: 9 }),
  crop('sorghum', [8, 22, 35, 40], [300, 400, 600, 700], { minT: 16, k: 0.6 }),
  crop('pearl millet', [12, 25, 35, 40], [200, 400, 900, 1700], { minT: 18, k: 0.5 }),
  crop('finger millet', [8, 18, 30, 35], [300, 500, 1100, 4300], { zones: HIGH_ZONE, minT: 14, k: 0.6 }),
  crop('proso millet', [15, 20, 32, 45], [200, 500, 750, 1000], { maxT: 16, k: 0.6 }),
  crop('buckwheat', [7, 17, 27, 40], [400, 700, 1000, 1300], { zones: SLOPE_ZONE, maxT: 12, k: 0.6 }),
  crop('fonio', [18, 22, 27, 31], [400, 900, 1600, 2800], { minT: 20, k: 0.4 }),
  crop('teff', [2, 22, 28, 30], [300, 600, 1200, 2500], { zones: HIGH_ZONE, needs: 'highland', k: 0.6 }),
  crop('quinoa', [2, 14, 18, 35], [250, 500, 1000, 2600], { zones: HIGH_ZONE, needs: 'highland', k: 0.6 }),
];

const PRODUCES: Crop[] = [
  crop('potato', [7, 15, 25, 30], [250, 500, 800, 2000], { zones: ZONE_TABLE(0.8, 1, 1, 0.7), maxT: 17 }),
  crop('cassava', [10, 20, 29, 35], [500, 1000, 1500, 5000], { minT: 18 }),
  crop('sweet potato', [10, 18, 28, 38], [350, 750, 2000, 5000], { minT: 15 }),
  crop('greater yam', [14, 20, 32, 40], [700, 1200, 4000, 8000], { minT: 20 }),
  crop('taro', [10, 21, 28, 35], [1000, 1800, 2700, 4100], { zones: WET_ZONE, minT: 19 }),
  crop('banana and plantain', [12, 23, 33, 42], [650, 1200, 3600, 5000], { minT: 20, tree: true, k: 0.6 }),
  crop('sago palm', [18, 25, 36, 40], [2100, 3000, 4500, 5800], { zones: ZONE_TABLE(1, 1, 0, 0), minT: 23, tree: true, k: 0.6 }),
  crop('faba bean', [5, 18, 28, 32], [250, 650, 1000, 2600], { maxT: 16 }),
  crop('pea', [4, 10, 24, 30], [350, 800, 1200, 2500], { maxT: 14 }),
  crop('lentil', [5, 15, 29, 32], [250, 600, 1000, 2500], { minT: 8, maxT: 19 }),
  crop('chickpea', [7, 15, 29, 35], [300, 600, 1000, 1800], { minT: 10 }),
  crop('common bean', [7, 16, 25, 32], [300, 500, 2000, 4300], { minT: 10 }),
  crop('cowpea', [15, 25, 35, 40], [300, 500, 1500, 4100], { minT: 19 }),
  crop('cabbage and kale', [5, 10, 25, 30], [450, 600, 1100, 1900], { maxT: 15 }),
  crop('onion and alliums', [4, 12, 25, 30], [300, 350, 600, 2800], { k: 0.8 }),
  crop('carrot and root vegetables', [3, 15, 24, 30], [400, 600, 1200, 4000], { maxT: 16 }),
  crop('melons', [15, 20, 35, 40], [400, 500, 700, 1800], { minT: 14, k: 0.8 }),
  crop('enset', [8, 16, 24, 30], [900, 1100, 1500, 1700], { zones: HIGH_ZONE, needs: 'highland', tree: true }),
];

const ORCHARDS: Crop[] = [
  crop('olive', [5, 20, 34, 40], [200, 400, 700, 1200], { zones: SLOPE_ZONE, minT: 12, maxT: 21, tree: true }),
  crop('grape', [10, 18, 30, 38], [400, 700, 850, 1200], { zones: SLOPE_ZONE, minT: 9, maxT: 20, tree: true }),
  crop('date palm', [10, 26, 45, 52], [100, 200, 300, 400], { zones: WET_ZONE, minT: 19, needs: 'river', tree: true }),
  crop('fig', [4, 16, 26, 38], [300, 700, 1500, 2700], { minT: 11, tree: true, k: 0.8 }),
  crop('pomegranate', [8, 23, 32, 40], [400, 900, 1200, 4200], { minT: 13, tree: true, k: 0.8 }),
  crop('almond', [10, 12, 35, 40], [250, 600, 900, 1500], { zones: SLOPE_ZONE, minT: 11, maxT: 21, tree: true, k: 0.8 }),
  crop('pistachio', [12, 25, 35, 40], [250, 400, 700, 1100], { zones: SLOPE_ZONE, minT: 13, maxT: 22, tree: true, k: 0.7 }),
  crop('apple', [8, 14, 27, 33], [500, 700, 2500, 3200], { zones: SLOPE_ZONE, minT: 5, maxT: 15, tree: true }),
  crop('pear', [10, 20, 35, 37], [400, 600, 900, 2100], { zones: SLOPE_ZONE, minT: 6, maxT: 16, tree: true, k: 0.8 }),
  crop('peach and stone fruit', [7, 20, 33, 35], [750, 900, 1100, 1600], { minT: 10, maxT: 19, tree: true, k: 0.9 }),
  crop('citrus', [13, 20, 30, 38], [450, 1200, 2000, 2700], { minT: 16, tree: true }),
  crop('walnut', [7, 15, 30, 40], [400, 800, 1700, 2200], { zones: SLOPE_ZONE, minT: 7, maxT: 17, tree: true, k: 0.8 }),
  crop('sweet chestnut', [7, 15, 25, 30], [500, 900, 1300, 1600], { zones: SLOPE_ZONE, minT: 8, maxT: 16, tree: true, k: 0.8 }),
  crop('hazel', [5, 10, 24, 35], [600, 900, 1100, 1400], { minT: 4, maxT: 14, tree: true, k: 0.6 }),
  crop('coconut', [14, 22, 34, 38], [650, 1200, 2400, 4000], { minT: 22, needs: 'coast', tree: true }),
  crop('oil palm', [12, 20, 35, 38], [1000, 1500, 3000, 8000], { zones: WET_ZONE, minT: 23, tree: true }),
  crop('mango', [8, 24, 30, 48], [300, 600, 1500, 2600], { minT: 20, tree: true, k: 0.8 }),
  crop('cashew', [5, 15, 35, 46], [400, 750, 1600, 4000], { minT: 21, tree: true, k: 0.7 }),
  crop('shea', [18, 24, 38, 43], [300, 500, 1000, 1800], { minT: 23, tree: true, k: 0.7 }),
  crop('baobab', [14, 26, 36, 42], [250, 600, 1500, 4200], { minT: 23, tree: true, k: 0.5 }),
  crop('tamarind', [12, 20, 35, 45], [300, 800, 3000, 4500], { minT: 21, tree: true, k: 0.6 }),
  crop('breadfruit', [16, 21, 33, 40], [1000, 1500, 3000, 3500], { minT: 23, tree: true, k: 0.8 }),
  crop('Brazil nut', [12, 20, 36, 40], [1400, 2400, 2800, 3500], { zones: WET_ZONE, minT: 23, tree: true, k: 0.7 }),
  crop('avocado', [10, 14, 40, 45], [300, 500, 2000, 2500], { zones: HIGH_ZONE, needs: 'highland', tree: true, k: 0.8 }),
  crop('sunflower', [5, 17, 34, 45], [300, 600, 1000, 1600], { minT: 6, maxT: 17, k: 0.6 }),
  crop('rapeseed', [5, 15, 25, 41], [400, 500, 1000, 2800], { maxT: 13, k: 0.6 }),
  crop('sesame', [10, 20, 30, 40], [300, 500, 1000, 1500], { minT: 17, k: 0.6 }),
  crop('groundnut', [10, 22, 32, 45], [400, 600, 1500, 4000], { minT: 18, k: 0.6 }),
  crop('soybean', [10, 20, 33, 38], [450, 600, 1500, 1800], { minT: 10, maxT: 19, k: 0.6 }),
];

const FIBRES: Crop[] = [
  crop('flax', [5, 16, 24, 30], [250, 500, 800, 1300], { maxT: 13 }),
  crop('hemp', [6, 15, 28, 32], [350, 600, 1200, 4000], { minT: 5, maxT: 17 }),
  crop('cotton', [15, 22, 36, 42], [450, 750, 1200, 1500], { minT: 17 }),
  crop('jute', [13, 20, 37, 45], [900, 1500, 3000, 3600], { zones: WET_ZONE, minT: 21, needs: 'river' }),
  crop('ramie', [10, 17, 27, 34], [1000, 1500, 2500, 4000], { minT: 14, k: 0.8 }),
  crop('kenaf', [10, 15, 28, 35], [450, 600, 2000, 3000], { minT: 21, k: 0.7 }),
  crop('sisal and agave', [10, 15, 27, 45], [500, 900, 1250, 1800], { zones: SLOPE_ZONE, minT: 18, tree: true, k: 0.7 }),
  crop('abaca', [16, 20, 29, 33], [700, 1800, 3000, 4400], { minT: 23, tree: true, k: 0.7 }),
  crop('esparto grass', [3, 15, 25, 35], [100, 200, 500, 600], { zones: SLOPE_ZONE, minT: 10, tree: true, k: 0.5 }),
  crop('silk', [13, 20, 28, 45], [300, 700, 2500, 5100], { zones: SLOPE_ZONE, minT: 12, maxT: 20, tree: true, gate: 0.2 }),
  crop('kapok', [12, 17, 38, 40], [750, 1500, 2500, 3000], { minT: 22, tree: true, k: 0.5 }),
  crop('New Zealand flax', [9, 13, 25, 30], [1300, 2000, 3000, 3800], { minT: 8, maxT: 15, tree: true, k: 0.6 }),
  crop('nettle and lime-bast', [5, 12, 22, 28], [400, 500, 700, 800], { maxT: 12, tree: true, k: 0.35 }),
];

// Luxury crops: all gated per elevation zone, and climate-locked (spices to the tropics).
const SPICE_CROPS: Crop[] = [
  crop('black pepper', [10, 22, 35, 40], [2000, 2500, 4000, 5500], { minT: 22, tree: true, gate: 0.08 }),
  crop('clove', [20, 24, 34, 38], [1200, 1500, 3600, 4000], { zones: WET_ZONE, minT: 24, needs: 'coast', tree: true, gate: 0.06 }),
  crop('nutmeg and mace', [12, 22, 34, 38], [1200, 1500, 3500, 4000], { zones: WET_ZONE, minT: 24, needs: 'coast', tree: true, gate: 0.06 }),
  crop('cinnamon', [18, 24, 30, 36], [1200, 2000, 2600, 3000], { minT: 22, tree: true, gate: 0.08 }),
  crop('cardamom', [10, 22, 30, 35], [1500, 3000, 6000, 7000], { zones: HIGH_ZONE, minT: 20, tree: true, gate: 0.1 }),
  crop('ginger', [13, 19, 29, 35], [700, 1400, 3000, 4000], { minT: 20, gate: 0.1, k: 0.8 }),
  crop('turmeric', [18, 20, 28, 32], [800, 1000, 2000, 3000], { minT: 20, gate: 0.1, k: 0.8 }),
  crop('vanilla', [10, 21, 30, 33], [1500, 2000, 2500, 3000], { zones: WET_ZONE, minT: 22, tree: true, gate: 0.05 }),
  crop('chili pepper', [8, 17, 30, 35], [500, 600, 1250, 1700], { minT: 20, gate: 0.1, k: 0.7 }),
  crop('myrrh', [18, 23, 33, 40], [250, 400, 800, 1000], { zones: SLOPE_ZONE, minT: 22, tree: true, gate: 0.1 }),
  crop('frankincense', [18, 26, 40, 47], [100, 150, 400, 600], { zones: ZONE_TABLE(0, 0.5, 1, 1), minT: 22, tree: true, gate: 0.1 }),
  crop('gum arabic', [14, 24, 32, 48], [200, 300, 800, 2300], { minT: 21, tree: true, gate: 0.12, k: 0.7 }),
  crop('sandalwood', [10, 22, 30, 38], [450, 800, 1400, 3000], { zones: SLOPE_ZONE, minT: 21, tree: true, gate: 0.07 }),
  crop('rubber latex', [10, 24, 33, 45], [1200, 2000, 4000, 6000], { zones: WET_ZONE, minT: 23, tree: true, gate: 0.07, k: 0.7 }),
];

const STIMULANT_CROPS: Crop[] = [
  crop('sugar cane', [15, 24, 37, 41], [1000, 1500, 2000, 5000], { zones: WET_ZONE, minT: 20, gate: 0.2 }),
  crop('palm sugar and toddy', [16, 24, 32, 36], [700, 1000, 1500, 4200], { minT: 22, tree: true, gate: 0.12, k: 0.5 }),
  crop('tea', [8, 20, 30, 35], [1000, 1400, 2000, 5000], { zones: ZONE_TABLE(0, 0.4, 1, 1), minT: 12, tree: true, gate: 0.15 }),
  crop('coffee', [10, 14, 28, 34], [750, 1400, 2300, 4200], { zones: ZONE_TABLE(0, 0.4, 1, 1), needs: 'highland', tree: true, gate: 0.3 }),
  crop('cacao', [10, 21, 32, 38], [900, 1200, 3000, 7600], { zones: WET_ZONE, minT: 22, tree: true, gate: 0.12 }),
  crop('kola nut', [10, 21, 30, 35], [1200, 1400, 2500, 3500], { zones: WET_ZONE, minT: 23, tree: true, gate: 0.08, k: 0.7 }),
  crop('betel nut', [7, 16, 33, 39], [750, 1500, 3000, 5000], { minT: 21, tree: true, gate: 0.1, k: 0.7 }),
  crop('coca', [14, 17, 23, 27], [700, 1000, 2100, 4000], { zones: ZONE_TABLE(0, 0, 0.8, 1), needs: 'highland', tree: true, gate: 0.15, k: 0.8 }),
  crop('tobacco', [7, 15, 30, 35], [350, 500, 750, 3000], { minT: 11, gate: 0.12, k: 0.8 }),
];

const DYE_CROPS: Crop[] = [
  crop('woad', [5, 14, 22, 28], [450, 600, 1000, 1500], { maxT: 14, gate: 0.12, k: 0.7 }),
  crop('madder', [8, 16, 26, 32], [350, 500, 900, 1300], { minT: 9, maxT: 19, gate: 0.12, k: 0.7 }),
  crop('weld', [6, 14, 24, 30], [400, 500, 900, 1200], { minT: 7, maxT: 17, gate: 0.1, k: 0.5 }),
  crop('indigo', [7, 22, 28, 32], [640, 1300, 1700, 3000], { minT: 19, gate: 0.15 }),
  crop('safflower', [5, 20, 32, 45], [300, 600, 1000, 1400], { minT: 13, gate: 0.12, k: 0.6 }),
  crop('henna', [13, 19, 27, 33], [250, 500, 1500, 4200], { minT: 20, tree: true, gate: 0.12, k: 0.6 }),
  crop('annatto', [15, 20, 28, 36], [1250, 1500, 2000, 2500], { minT: 22, tree: true, gate: 0.1, k: 0.6 }),
  crop('red dyewoods', [7, 26, 32, 46], [875, 1000, 1900, 2800], { minT: 22, tree: true, gate: 0.07 }),
  crop('lac', [12, 22, 32, 40], [700, 1000, 1800, 2600], { minT: 21, tree: true, gate: 0.1, k: 0.7 }),
  crop('cochineal', [10, 18, 26, 30], [300, 700, 1300, 1700], { zones: SLOPE_ZONE, minT: 14, tree: true, gate: 0.06 }),
];

// ------------------------------------------------------------------ biome tables

/** Pasture, 0–1. */
const PASTURE = BIOME_TABLE({ ocean: 0, ice: 0, tundra: 0.25, coldSteppe: 0.7, taiga: 0.25, coldDesert: 0.2, grassland: 1, shrubland: 0.7, mixedForest: 0.6, broadleaf: 0.6, tempRainforest: 0.5, hotDesert: 0.15, thornScrub: 0.5, savanna: 0.8, dryForest: 0.45, rainforest: 0.15, mangrove: 0.1 });
const PASTURE_ZONE = ZONE_TABLE(1, 1, 0.9, 0.7);
/** Forage and game, 0–1. */
const GAME = BIOME_TABLE({ ocean: 0, ice: 0.05, tundra: 0.3, coldSteppe: 0.3, taiga: 0.7, coldDesert: 0.1, grassland: 0.4, shrubland: 0.45, mixedForest: 0.8, broadleaf: 0.8, tempRainforest: 0.8, hotDesert: 0.05, thornScrub: 0.3, savanna: 0.6, dryForest: 0.6, rainforest: 0.6, mangrove: 0.4 });
/** Standing timber, 0–1 (rivers add gallery forest in open land, see `timber`). */
const WOOD = BIOME_TABLE({ ocean: 0, ice: 0, tundra: 0, coldSteppe: 0.08, taiga: 1, coldDesert: 0, grassland: 0.1, shrubland: 0.4, mixedForest: 1, broadleaf: 1, tempRainforest: 1, hotDesert: 0, thornScrub: 0.25, savanna: 0.35, dryForest: 0.8, rainforest: 1, mangrove: 0.5 });
/** Furs (cold forests and tundra) and ivory, feathers and skins (hot lands), 0–1. */
const FUR = BIOME_TABLE({ ocean: 0, ice: 0, tundra: 0.5, coldSteppe: 0.15, taiga: 0.85, coldDesert: 0, grassland: 0, shrubland: 0, mixedForest: 0.3, broadleaf: 0.1, tempRainforest: 0.2, hotDesert: 0, thornScrub: 0.25, savanna: 0.4, dryForest: 0.35, rainforest: 0.35, mangrove: 0 });
/** Share of the hot-land elevation zones with elephants, ostriches or big cats worth hunting. */
const IVORY_ZONES = 0.3;
/** Share of the cold-land elevation zones (and of the cold sea's patches) with fur animals worth trapping, at the middle of the prosperity map. */
const FUR_ZONES = 0.5;
/** Horses and pack animals, 0–1. */
const MOUNTS = BIOME_TABLE({ ocean: 0, ice: 0, tundra: 0, coldSteppe: 0.9, taiga: 0, coldDesert: 0.5, grassland: 0.9, shrubland: 0.3, mixedForest: 0.15, broadleaf: 0.15, tempRainforest: 0, hotDesert: 0.5, thornScrub: 0.4, savanna: 0.3, dryForest: 0.1, rainforest: 0, mangrove: 0 });
const MOUNT_ZONE = ZONE_TABLE(1, 1, 0.7, 0.4);
/** Honey and beeswax: widespread and cheap. */
const HONEY = BIOME_TABLE({ ocean: 0, ice: 0, tundra: 0, coldSteppe: 0.1, taiga: 0.2, coldDesert: 0, grassland: 0.2, shrubland: 0.3, mixedForest: 0.2, broadleaf: 0.3, tempRainforest: 0.15, hotDesert: 0, thornScrub: 0.15, savanna: 0.2, dryForest: 0.2, rainforest: 0.15, mangrove: 0.1 });

const MANGROVE = BIOMES.findIndex((b) => b.id === 'mangrove');

const CLAY_ZONE = ZONE_TABLE(0.7, 0.6, 0.25, 0.1);
/** Chance of workable stone in a patch, and how rich it is, by zone type. */
const STONE_CHANCE = ZONE_TABLE(0.04, 0.12, 0.75, 0.95);
const STONE_RICH = ZONE_TABLE(0.35, 0.5, 0.85, 1);

const BELT_INDEX = (id: string) => BELTS.findIndex((b) => b.id === id);
const POLAR = BELT_INDEX('polar');
const BOREAL = BELT_INDEX('boreal');
const TEMPERATE = BELT_INDEX('temperate');
const TROPICAL = BELT_INDEX('tropical');
/** Moisture classes (MOISTURE order): Arid, Semi-arid, Subhumid, Humid, Perhumid. */
const ARID = 0;
const HUMID = 3;

/** A river irrigates: mm of water per patch it drains upstream beyond the first (up to IRRIGATION_FULL patches), by zone type. */
const IRRIGATION_MM = 100;
const IRRIGATION_FULL = 13;
/** A river counts as navigable from this many patches drained upstream (as for the locations). */
const NAVIGABLE = 8;
const IRRIGATION_ZONE = ZONE_TABLE(1, 1, 0.5, 0.25);
/** The growing season is this much warmer than the yearly mean per °C the sea-level temperature lies below 24 °C, at most 12 °C. */
const SEASON_GAIN = 0.5;

/** Deposit kinds: the stage of their hashed draw (never renumber: that reshuffles the deposits). */
enum D {
  stone = 1,
  kaolin,
  quartz,
  glassSand,
  coal,
  lignite,
  oilSeep,
  solarSalt,
  playaSalt,
  natron,
  rockSalt,
  brine,
  bogIron,
  laterite,
  bandedIron,
  skarnIron,
  blackSand,
  porphyryCopper,
  redBedCopper,
  sulfideCopper,
  nativeCopper,
  tinLode,
  streamTin,
  silverVein,
  leadZinc,
  volcanicSilver,
  lodeGold,
  greenstoneGold,
  epithermalGold,
  placerGold,
  beachGold,
  diamond,
  granitGems,
  garnet,
  emerald,
  agate,
  ruby,
  jade,
  lapis,
  turquoise,
  opal,
  amber,
  jet,
  pearl,
  riverPearl,
  coral,
  murex,
  kermes,
  muskDeer,
  seaPearl,
  seaCoral,
}

// ------------------------------------------------------------------ one patch

/** Everything the rules read about a land patch. */
interface Env {
  seed: number;
  patch: number;
  zone: number;
  b: BiomeInfo;
  id: BiomeId;
  zt: number;
  rock: number;
  site: PatchSite;
  /** growing-season temperature, °C */
  tg: number;
  /** length of the growing season, 0–1 */
  season: number;
  /** irrigation water from the patch's river, mm */
  irr: number;
  /** a tropical highland: tropical at sea level, temperate at its height */
  highland: boolean;
  /** a river on flat ground: floodplain */
  floodplain: boolean;
  /** factor on the chances of the PROSPERITY_RESOURCES, from the prosperity map */
  boost: number;
  amount: number[];
  variant: string[];
}

const unit = (seed: number, stage: number, key: number) => toUnit(hash4(seed, stage, keyI(key), keyJ(key)));

/** Keep the larger amount of a resource, with its variant. */
function put(e: Env, r: number, amount: number, variant: string): void {
  const a = sat(amount);
  if (a > e.amount[r]) {
    e.amount[r] = a;
    e.variant[r] = variant;
  }
}

/**
 * A deposit: present with `chance` (hashed per patch and kind), its richness hashed in
 * [0.35, 1] × `rich`. The chance of a precious metal, gem or luxury follows the prosperity.
 */
function deposit(e: Env, r: number, kind: D, chance: number, variant: string, rich = 1): void {
  if (PROSPEROUS[r]) chance *= e.boost;
  if (chance <= 0 || unit(e.seed, ST_DEPOSIT + kind, e.patch) >= chance) return;
  put(e, r, rich * (0.35 + 0.65 * unit(e.seed, ST_RICH + kind, e.patch)), variant);
}

/** One of the options, hashed per patch and resource (flavour: which timber, which game). */
function pick(e: Env, r: number, options: string[]): string {
  return options[hash4(e.seed, ST_PICK + r, keyI(e.patch), keyJ(e.patch)) % options.length];
}

function cropScore(e: Env, c: Crop, boost: number): number {
  let s = trap(e.tg, c.t[0], c.t[1], c.t[2], c.t[3]);
  if (s <= 0) return 0;
  let water = e.b.p;
  if (water < c.p[1]) water = Math.min(c.p[1], water + e.irr);
  s *= trap(water, c.p[0], c.p[1], c.p[2], c.p[3]);
  s *= (c.zones ?? FARM_ZONE)[e.zt];
  if (s <= 0) return 0;
  if (c.minT !== undefined) s *= ramp(e.b.t, c.minT - 2, c.minT);
  if (c.maxT !== undefined) s *= 1 - ramp(e.b.t, c.maxT, c.maxT + 2);
  s *= c.tree ? TREE_GROUND[e.b.biome] : e.season * SOIL[e.b.biome];
  if (c.needs === 'river' && e.site.river <= 0 && e.site.lake <= 0) s *= 0.25;
  if (c.needs === 'coast' && !e.b.coastal) return 0;
  if (c.needs === 'highland' && !e.highland) return 0;
  if (c.k !== undefined) s *= c.k;
  if (s <= 0) return 0;
  // a regional speciality: only in some zones, in more of them where the land is prosperous
  if (c.gate !== undefined && unit(e.seed, ST_GATE + c.n, e.zone) >= c.gate * boost) return 0;
  return s;
}

/** The best crop of a table becomes the resource's amount and variant. */
function crops(e: Env, r: number, table: Crop[]): void {
  const boost = PROSPEROUS[r] ? e.boost : 1;
  for (const c of table) {
    const s = cropScore(e, c, boost);
    if (s > e.amount[r]) put(e, r, s, c.name);
  }
}

function livestock(e: Env): void {
  const { id, zt, b, site } = e;
  let a = PASTURE[b.biome] * PASTURE_ZONE[zt];
  // floodplain hay meadows, and watered pasture along a desert river
  if (site.river >= 1 && b.belt >= BOREAL) a += 0.1;
  let v: string;
  if (zt === MOUNTAINS && b.t < 5 && id !== 'tundra') v = 'yak';
  else if (zt === MOUNTAINS) v = id === 'shrubland' || id === 'thornScrub' ? 'goats' : 'alpine summer pasture';
  else if (id === 'tundra' || id === 'taiga') v = 'herded reindeer';
  else if (id === 'coldSteppe' || id === 'coldDesert') v = 'sheep';
  else if (id === 'grassland') v = pick(e, LIVESTOCK, ['cattle', 'sheep']);
  else if (id === 'shrubland') v = zt === HILLS ? 'goats' : 'sheep';
  else if (id === 'broadleaf') v = pick(e, LIVESTOCK, ['pigs', 'cattle']);
  else if (id === 'mixedForest' || id === 'tempRainforest') v = pick(e, LIVESTOCK, ['cattle', 'sheep']);
  else if (id === 'hotDesert' || id === 'thornScrub') v = 'goats';
  else if (id === 'dryForest') v = e.floodplain ? 'water buffalo' : 'cattle';
  else if (id === 'rainforest' || id === 'mangrove') v = pick(e, LIVESTOCK, ['pigs', 'poultry']);
  else v = 'cattle';
  put(e, LIVESTOCK, a, v);
}

function fish(e: Env): void {
  const { b, site } = e;
  if (b.coastal) {
    const t = b.t0;
    if (b.biome === MANGROVE) put(e, FISH, 0.9, 'crabs, lobsters and shrimp');
    else if (site.mouth >= 2 && t < 10) put(e, FISH, site.harbour ? 1 : 0.85, 'salmon runs');
    else put(e, FISH, b.belt === POLAR ? 0.6 : site.harbour ? 1 : 0.8, t < 4 ? 'cod banks' : t < 11 ? 'herring' : t < 18 ? pick(e, FISH, ['sardine and anchovy', 'oysters and mussels']) : pick(e, FISH, ['reef fish and shellfish', 'tuna and large pelagics']));
  }
  const a = site.river;
  if (a > 0 && b.belt > POLAR) {
    const river = a >= 80 ? 0.7 : a >= NAVIGABLE ? 0.6 : a >= 2 ? 0.3 : 0.15;
    put(e, FISH, river, a >= 80 && b.belt <= TEMPERATE ? 'sturgeon' : a >= NAVIGABLE && b.belt === TEMPERATE ? pick(e, FISH, ['river fish', 'eels']) : 'river fish');
  }
  if (site.lake > 0) put(e, FISH, 0.45 + 0.3 * sat(site.lake / 2e7), 'lake fish');
}

function wildFood(e: Env): void {
  const { id, b, site, zt } = e;
  let a = GAME[b.biome];
  // wetland birds and plants along the water
  if ((site.lake > 0 || e.floodplain) && b.belt > POLAR) a += 0.15;
  let v: string;
  switch (id) {
    case 'ice':
      v = 'seals';
      if (!b.coastal) a = 0;
      break;
    case 'tundra':
      v = pick(e, WILD, ['caribou', 'cloudberry and crowberry']);
      break;
    case 'taiga':
      v = pick(e, WILD, ['deer and elk', 'bilberry and blueberry', 'forest mushrooms']);
      break;
    case 'mixedForest':
      v = pick(e, WILD, ['deer', 'wild boar', 'forest mushrooms']);
      break;
    case 'broadleaf':
      v = pick(e, WILD, ['deer', 'wild boar', 'acorns']);
      break;
    case 'tempRainforest':
      v = pick(e, WILD, ['deer', 'raspberry and bramble']);
      break;
    case 'grassland':
      v = pick(e, WILD, ['bison and wild cattle', 'hares and rabbits']);
      break;
    case 'coldSteppe':
      v = pick(e, WILD, ['antelope and gazelle', 'upland game birds']);
      break;
    case 'shrubland':
      v = pick(e, WILD, ['upland game birds', 'wild herbs', 'hares and rabbits']);
      break;
    case 'mangrove':
      v = 'waterfowl';
      break;
    case 'coldDesert':
      v = pick(e, WILD, ['hares and rabbits', 'upland game birds']);
      break;
    case 'rainforest':
    case 'dryForest':
      v = pick(e, WILD, ['wild boar', 'deer', 'wild herbs']);
      break;
    default:
      v = 'antelope and gazelle';
  }
  if (zt === MOUNTAINS && id !== 'ice' && id !== 'tundra') v = 'wild sheep and ibex';
  else if (site.lake > 0 && b.belt >= TEMPERATE) v = b.belt === TROPICAL ? 'lotus' : 'waterfowl';
  put(e, WILD, a, v);
}

function timberVariant(e: Env): string {
  const { id, zt, b, site } = e;
  switch (id) {
    case 'taiga':
      return zt >= HILLS ? pick(e, TIMBER, ['larch', 'spruce']) : pick(e, TIMBER, ['Scots pine', 'spruce']);
    case 'mixedForest':
      return zt === MOUNTAINS ? 'fir' : zt === HILLS ? pick(e, TIMBER, ['beech', 'spruce']) : pick(e, TIMBER, ['oak', 'Scots pine', 'lime']);
    case 'broadleaf':
      if (zt === MOUNTAINS) return b.t >= 12 ? 'cedar' : 'beech';
      if (zt === HILLS) return pick(e, TIMBER, ['beech', 'oak']);
      return e.floodplain ? pick(e, TIMBER, ['oak', 'ash', 'elm']) : 'oak';
    case 'tempRainforest':
      return 'giant conifers';
    case 'shrubland':
      if (b.t < 10) return zt >= HILLS ? 'juniper' : pick(e, TIMBER, ['oak', 'Scots pine', 'juniper']);
      return zt >= HILLS ? pick(e, TIMBER, ['cypress', 'Mediterranean pines']) : pick(e, TIMBER, ['cork oak', 'Mediterranean pines']);
    case 'dryForest':
      return b.p >= 1500 ? pick(e, TIMBER, ['teak', 'sal']) : pick(e, TIMBER, ['teak', 'Spanish cedar', 'rosewood']);
    case 'rainforest':
      return pick(e, TIMBER, ['mahogany', 'iroko', 'rosewood', 'ebony', 'mahogany', 'iroko']);
    case 'savanna':
      return site.river >= 1 ? 'African mahogany' : 'thorn-scrub wood';
    case 'thornScrub':
      return 'thorn-scrub wood';
    case 'mangrove':
      return 'mangrove timber';
    case 'hotDesert':
    case 'coldDesert':
      return 'poplar';
    case 'tundra':
    case 'ice':
      return 'driftwood';
    default:
      // grassland and steppe: gallery woods along the rivers, juniper on the hills
      return site.river >= 1 ? 'willow and poplar' : 'juniper';
  }
}

function timber(e: Env): void {
  const { id, b, site, zt } = e;
  let a = WOOD[b.biome];
  if (id === 'grassland' || id === 'coldSteppe') {
    if (site.river >= 1) a += 0.2;
    else if (zt >= HILLS) a += 0.07;
  } else if (id === 'hotDesert' || id === 'coldDesert') a = site.river >= 2 ? 0.3 : 0;
  else if (id === 'tundra') a = b.coastal ? 0.1 : 0;
  // above the tree line the forest thins
  if (zt === MOUNTAINS && a > 0.6) a *= 0.8;
  if (a > 0) put(e, TIMBER, a, timberVariant(e));
}

function stone(e: Env): void {
  const { zt, rock } = e;
  let chance = STONE_CHANCE[zt];
  let v: string;
  switch (rock) {
    case SHIELD:
    case GRANITE:
      v = 'granite';
      break;
    case FOLD:
      v = zt === MOUNTAINS ? pick(e, STONE, ['slate', 'slate', 'marble']) : pick(e, STONE, ['slate', 'whetstone', 'slate']);
      break;
    case VOLCANIC:
      v = pick(e, STONE, ['basalt', 'pumice and pozzolana', 'obsidian', 'basalt']);
      break;
    case BASALT:
      v = pick(e, STONE, ['basalt', 'basalt', 'millstone and quern stone']);
      chance *= 2;
      break;
    case OPHIOLITE:
      v = 'soapstone';
      break;
    case CARBONATE:
      v = zt <= LOWLAND ? pick(e, STONE, ['chalk', 'limestone', 'flint and chert']) : pick(e, STONE, ['limestone', 'limestone', 'marble']);
      chance *= 2.5;
      break;
    case CLASTIC:
      v = pick(e, STONE, ['sandstone', 'sandstone', 'millstone and quern stone']);
      chance *= 1.6;
      break;
    default:
      v = 'field stone and boulders';
      chance *= 0.5;
  }
  deposit(e, STONE, D.stone, chance, v, STONE_RICH[zt]);
}

function clay(e: Env): void {
  const { id, zt, b, rock, site } = e;
  if (id === 'ice') return;
  let a = CLAY_ZONE[zt];
  if (site.river >= 1 && zt <= LOWLAND) a += 0.3;
  if (rock === ALLUVIUM) a += 0.1;
  if (id === 'tundra') a *= 0.3;
  const dry = b.aridity < 1;
  const v = dry && b.belt >= TEMPERATE ? 'adobe and mud-brick earth' : site.river >= 1 ? 'brick and pottery clay' : id === 'mixedForest' || id === 'broadleaf' ? 'wattle and daub' : dry || id === 'shrubland' ? 'rammed earth and cob' : 'brick and pottery clay';
  put(e, CLAY, a, v);
  // porcelain clay: deeply weathered granite in warm, wet climates
  if ((rock === GRANITE || rock === SHIELD) && b.t >= 10 && b.moisture >= HUMID && zt !== MOUNTAINS) deposit(e, CLAY, D.kaolin, 0.05, 'kaolin', 1.2);
}

function crystal(e: Env): void {
  const { zt, rock, b, site } = e;
  if (zt >= HILLS) {
    const k = rock === VOLCANIC ? 3 : rock === GRANITE || rock === FOLD ? 2 : 1;
    deposit(e, CRYSTAL, D.quartz, (zt === MOUNTAINS ? 0.05 : 0.03) * k, 'rock crystal');
  } else {
    // pure quartz sand: coastal dunes and the rivers of the lowlands
    const chance = (b.coastal ? 0.03 : 0) + (site.river >= NAVIGABLE ? 0.015 : 0);
    deposit(e, CRYSTAL, D.glassSand, chance, 'glass sand', 0.8);
  }
}

function fuel(e: Env): void {
  const { id, zt, b, rock } = e;
  if (e.amount[TIMBER] > 0) put(e, FUEL, 0.9 * e.amount[TIMBER], id === 'mangrove' ? 'charcoal' : e.amount[TIMBER] >= 0.7 ? pick(e, FUEL, ['firewood', 'charcoal']) : 'firewood');
  // peat: cool, wet, low ground
  if (zt <= LOWLAND && b.moisture >= HUMID && b.t < 10 && b.belt >= BOREAL) put(e, FUEL, 0.6, 'peat');
  if (id === 'tundra') put(e, FUEL, zt <= LOWLAND ? 0.35 : 0.2, 'turf and sod');
  // dung of the herds where there is no wood
  if (e.amount[LIVESTOCK] >= 0.15) put(e, FUEL, 0.35 * e.amount[LIVESTOCK], 'dung fuel');
  if (rock === CLASTIC) {
    if (zt === HILLS || zt === LOWLAND) deposit(e, FUEL, D.coal, 0.04, 'coal');
    if (zt <= LOWLAND) {
      deposit(e, FUEL, D.lignite, 0.04, 'lignite', 0.7);
      deposit(e, FUEL, D.oilSeep, 0.01, 'oil and naphtha seeps', 0.8);
    }
  }
}

function salt(e: Env): void {
  const { zt, b, rock } = e;
  // solar pans need evaporation above the rainfall: dry, warm, low coasts
  if (b.coastal && zt <= LOWLAND && b.aridity < 1 && b.t >= 12) deposit(e, SALT, D.solarSalt, 0.25, 'solar sea salt');
  // salt flats: a few of the river-poor flat zones are closed basins
  if (b.sparse && b.moisture === ARID && unit(e.seed, ST_PLAYA, e.zone) < PLAYA_ZONES) {
    deposit(e, SALT, D.playaSalt, 0.3, 'lake and playa salt');
    deposit(e, SALT, D.natron, 0.05, 'natron and soda', 0.8);
  }
  // salt beds and brine springs: a few of the old basins have an evaporite member
  if (rock === CLASTIC && zt !== MOUNTAINS && unit(e.seed, ST_EVAPORITE, e.zone) < EVAPORITE_ZONES) {
    deposit(e, SALT, D.rockSalt, 0.12, 'rock salt');
    deposit(e, SALT, D.brine, 0.08, 'brine springs', 0.8);
  }
}

/** Share of the arid river-poor flat zones that hold a salt flat, and of the clastic basins that hold salt beds. */
const PLAYA_ZONES = 0.08;
const EVAPORITE_ZONES = 0.05;

function metals(e: Env): void {
  const { id, zt, b, rock, site } = e;
  const high = zt >= HILLS;

  // iron
  if (zt <= LOWLAND && b.moisture >= HUMID && (id === 'taiga' || id === 'mixedForest' || id === 'broadleaf' || id === 'tempRainforest')) deposit(e, IRON, D.bogIron, site.river >= 1 || site.lake > 0 ? 0.1 : 0.05, 'bog iron', 0.7);
  if (zt !== MOUNTAINS && (id === 'rainforest' || id === 'dryForest' || id === 'savanna')) deposit(e, IRON, D.laterite, 0.1, 'lateritic iron and ironstone', 0.8);
  if (rock === SHIELD && (zt === HILLS || zt === LOWLAND)) deposit(e, IRON, D.bandedIron, 0.08, 'banded iron formation');
  if ((rock === GRANITE || rock === CARBONATE) && high) deposit(e, IRON, D.skarnIron, 0.06, 'magnetite skarn iron');
  if (b.coastal && rock === BASALT) deposit(e, IRON, D.blackSand, 0.05, 'black sands', 0.6);

  // copper: arcs, ophiolites, basalts and red beds
  if (rock === VOLCANIC && high) deposit(e, COPPER, D.porphyryCopper, zt === MOUNTAINS ? 0.1 : 0.05, pick(e, COPPER, ['porphyry copper', 'malachite and azurite', 'porphyry copper']));
  if (rock === CLASTIC && (zt === LOWLAND || zt === HILLS)) deposit(e, COPPER, D.redBedCopper, 0.03, 'red-bed copper', 0.8);
  if (rock === OPHIOLITE && high) deposit(e, COPPER, D.sulfideCopper, 0.08, 'massive-sulfide copper');
  if (rock === BASALT && zt >= LOWLAND) deposit(e, COPPER, D.nativeCopper, zt === LOWLAND ? 0.02 : 0.06, 'native copper', 0.8);

  // tin: granite, and the streams below it (never in a copper zone)
  if (rock === GRANITE && high) deposit(e, TIN, D.tinLode, 0.06, 'tin lode');
  if (!COPPER_ROCK.has(rock) && zt !== MOUNTAINS && site.river >= 1) deposit(e, TIN, D.streamTin, 0.35 * site.tinLoad, 'stream tin', 0.4 + 0.6 * site.tinLoad);

  // silver and lead
  if (rock === FOLD && high) deposit(e, SILVER, D.silverVein, 0.05, 'silver');
  if (rock === CARBONATE && (zt === HILLS || zt === LOWLAND)) deposit(e, SILVER, D.leadZinc, zt === HILLS ? 0.06 : 0.025, pick(e, SILVER, ['lead-zinc in carbonates', 'calamine', 'lead-zinc in carbonates']), 0.8);
  if (rock === VOLCANIC && zt === MOUNTAINS) deposit(e, SILVER, D.volcanicSilver, 0.03, 'lead-zinc skarns and veins');

  // gold: lodes in the mountains, placers where their rivers reach flatter ground
  if (rock === FOLD && high) deposit(e, GOLD, D.lodeGold, 0.03, 'lode gold');
  if (rock === SHIELD && zt === HILLS) deposit(e, GOLD, D.greenstoneGold, 0.03, 'lode gold');
  if (rock === VOLCANIC && zt === MOUNTAINS) deposit(e, GOLD, D.epithermalGold, 0.03, 'epithermal and hot-spring gold-silver');
  if (zt !== MOUNTAINS && site.river >= 1) deposit(e, GOLD, D.placerGold, 0.2 * site.goldLoad, 'placer gold', 0.4 + 0.6 * site.goldLoad);
  if (b.coastal && site.mouth >= 2) deposit(e, GOLD, D.beachGold, 0.1 * site.goldLoad, 'beach gold', 0.6);
}

function gems(e: Env): void {
  const { id, zt, b, rock, site } = e;
  const high = zt >= HILLS;
  const desert = id === 'hotDesert' || id === 'coldDesert' || id === 'thornScrub';
  if (rock === SHIELD && zt !== MOUNTAINS) deposit(e, GEMS, D.diamond, 0.004, 'diamond');
  if (rock === GRANITE && high) deposit(e, GEMS, D.granitGems, 0.04, 'topaz, beryl and tourmaline');
  if (rock === FOLD && high) {
    deposit(e, GEMS, D.garnet, 0.03, 'garnet', 0.7);
    deposit(e, GEMS, D.emerald, 0.004, 'emerald');
  }
  if ((rock === VOLCANIC || rock === BASALT) && high) deposit(e, GEMS, D.agate, 0.04, 'amethyst and agate', 0.7);
  if ((rock === BASALT || rock === CARBONATE) && zt === MOUNTAINS) deposit(e, GEMS, D.ruby, 0.008, 'ruby and sapphire');
  if (rock === OPHIOLITE && high) deposit(e, GEMS, D.jade, 0.04, 'jade');
  if (rock === CARBONATE && zt === MOUNTAINS) deposit(e, GEMS, D.lapis, 0.012, 'lapis lazuli');
  // arid weathering over copper, and in the dry basins
  if (desert && high && (rock === VOLCANIC || rock === CLASTIC)) deposit(e, GEMS, D.turquoise, 0.04, 'turquoise');
  if (desert && (zt === LOWLAND || zt === HILLS) && (rock === CLASTIC || rock === BASALT)) deposit(e, GEMS, D.opal, 0.012, 'opal');
  if (b.coastal) {
    if (b.t < 12 && b.belt >= BOREAL && (rock === CLASTIC || rock === ALLUVIUM)) deposit(e, GEMS, D.amber, 0.03, 'amber');
    if (rock === CLASTIC && zt === HILLS) deposit(e, GEMS, D.jet, 0.02, 'jet', 0.6);
    if (b.t0 >= 20) deposit(e, GEMS, D.pearl, 0.04, 'pearl oyster');
    else if (b.t0 >= 11 && high) deposit(e, GEMS, D.coral, 0.03, 'precious red coral');
  }
  if (site.river >= 2 && b.t < 9 && b.belt >= BOREAL) deposit(e, GEMS, D.riverPearl, 0.006, 'freshwater pearl mussel', 0.7);
}

function furs(e: Env): void {
  const { id, zt, b, site } = e;
  let a = FUR[b.biome];
  // a regional speciality, in more of the zones where the land is prosperous: ivory and skins in the hot lands, furs in the cold
  const here = b.belt === TROPICAL ? unit(e.seed, ST_IVORY, e.zone) < IVORY_ZONES * e.boost : unit(e.seed, ST_FUR, e.zone) < FUR_ZONES * e.boost;
  let v: string;
  switch (id) {
    case 'taiga':
      v = site.river >= 1 ? pick(e, FURS, ['beaver', 'sable and marten']) : pick(e, FURS, ['sable and marten', 'squirrel', 'ermine']);
      break;
    case 'tundra':
      v = b.coastal ? pick(e, FURS, ['walrus', 'seals', 'fox and Arctic fox']) : 'fox and Arctic fox';
      if (b.coastal) a += 0.15;
      break;
    case 'ice':
      v = pick(e, FURS, ['walrus', 'seals', 'narwhal tusk']);
      a = b.coastal ? 0.5 : 0;
      break;
    case 'mixedForest':
    case 'tempRainforest':
      v = zt >= HILLS ? 'bear' : site.river >= 1 ? 'beaver' : pick(e, FURS, ['squirrel', 'sable and marten']);
      break;
    case 'broadleaf':
      v = 'fox and Arctic fox';
      break;
    case 'coldSteppe':
      v = 'fox and Arctic fox';
      break;
    case 'savanna':
      v = pick(e, FURS, ['elephant ivory', 'ostrich', 'big cats']);
      break;
    case 'thornScrub':
      v = 'ostrich';
      break;
    case 'dryForest':
      v = pick(e, FURS, ['elephant ivory', 'big cats']);
      break;
    case 'rainforest':
      v = pick(e, FURS, ['exotic feathers', 'big cats', 'elephant ivory']);
      break;
    default:
      v = '';
  }
  // cold coasts: seals
  if (!v && b.coastal && b.t0 < 3) {
    a = 0.3;
    v = 'seals';
  }
  if (here && a > 0 && v) put(e, FURS, a, v);
  if (zt === MOUNTAINS && b.belt === BOREAL) deposit(e, FURS, D.muskDeer, 0.03, 'musk deer');
}

function dyes(e: Env): void {
  const { id, zt, b } = e;
  crops(e, DYES, DYE_CROPS);
  if (b.coastal && zt >= HILLS && b.t0 >= 12 && b.t0 < 21) deposit(e, DYES, D.murex, 0.06, 'murex');
  if (id === 'shrubland' && zt === HILLS && b.t >= 12) deposit(e, DYES, D.kermes, 0.06, 'kermes');
  if (id === 'tundra' || id === 'tempRainforest') put(e, DYES, 0.15, 'lichen dyes');
}

function horses(e: Env): void {
  const { id, zt, b } = e;
  let a = MOUNTS[b.biome] * MOUNT_ZONE[zt];
  let v: string;
  if (id === 'hotDesert' || id === 'thornScrub') v = zt >= HILLS ? 'donkeys and mules' : 'dromedary camel';
  else if (id === 'coldDesert') v = 'Bactrian camel';
  else if (e.highland && zt === MOUNTAINS) {
    v = 'llama and alpaca-like camelids';
    a = Math.max(a, 0.5 * PASTURE[b.biome]);
  } else if (zt >= HILLS) {
    v = 'donkeys and mules';
    a = Math.max(a, 0.3 * PASTURE[b.biome]);
  } else v = 'horses';
  put(e, HORSES, a, v);
}

/**
 * Food a settlement can count on from a patch, 0–1: the staple (grain, or roots and pulses
 * at four fifths), herds, orchards and what the wild gives. Fish is counted on its own.
 */
export function foodOf(amount: number[]): number {
  const staple = Math.max(amount[GRAIN], 0.8 * amount[PRODUCE]);
  return sat(0.75 * staple + 0.2 * amount[LIVESTOCK] + 0.1 * amount[ORCHARD] + 0.05 * amount[WILD]);
}

/** Weight of each resource as a trade good (0 for food, building material and fuel, which the other terms count). */
const TRADE_VALUE: Record<ResourceId, number> = {
  grain: 0,
  produce: 0,
  orchard: 0.1,
  livestock: 0,
  fish: 0,
  wildFood: 0,
  timber: 0,
  stone: 0,
  clay: 0,
  crystal: 0.4,
  fibre: 0.1,
  fuel: 0,
  salt: 0.7,
  ironOre: 0.5,
  copperOre: 0.6,
  tin: 0.9,
  silverLead: 0.9,
  gold: 1,
  gems: 0.8,
  spices: 0.7,
  stimulants: 0.4,
  furs: 0.35,
  dyes: 0.3,
  horses: 0.2,
};
const TRADE_WEIGHTS = RESOURCES.map((r) => TRADE_VALUE[r.id]);

/** Trade goods of a patch: its salt, metals, luxuries and cash crops by value, 0 and up (1 = one rich deposit of the dearest kind). */
export function wealthOf(amount: number[]): number {
  let s = 0;
  for (let r = 0; r < amount.length; r++) if (amount[r] >= MIN_AMOUNT) s += TRADE_WEIGHTS[r] * amount[r];
  return s;
}

function finish(patch: number, ocean: boolean, bedrock: number, amount: number[], variant: string[], site: PatchSite, prosperity: number): PatchResources {
  const list: ResourceHit[] = [];
  for (let r = 0; r < amount.length; r++) {
    if (amount[r] >= MIN_AMOUNT) list.push({ resource: r, amount: amount[r], variant: variant[r] });
    else if (amount[r] <= 0) variant[r] = '';
  }
  list.sort((a, b) => b.amount - a.amount || a.resource - b.resource);
  return { patch, ocean, bedrock, amount, variant, list, food: foodOf(amount), wealth: wealthOf(amount), prosperity, boost: prosperityBoost(prosperity), site };
}

/**
 * The resources of a land patch from its biome record, the (merged) elevation zone it
 * lies in, that zone's bedrock, its river and lake site and the prosperity there (0–1; the
 * middle, 0.5, leaves every chance as it is). A pure function.
 */
export function landResources(seed: number, b: BiomeInfo, zone: number, bedrock: number, site: PatchSite, prosperity = 0.5): PatchResources {
  const zt = b.zoneType;
  const gain = SEASON_GAIN * (24 - b.t0);
  const e: Env = {
    seed,
    patch: b.key,
    zone,
    b,
    id: BIOMES[b.biome].id,
    zt,
    rock: bedrock,
    site,
    tg: b.t + (gain < 0 ? 0 : gain > 12 ? 12 : gain),
    season: ramp(b.t, -4, 6),
    irr: (site.river > 1 ? IRRIGATION_MM * (Math.min(site.river, IRRIGATION_FULL) - 1) * IRRIGATION_ZONE[zt] : 0) + (site.lake > 0 ? 2 * IRRIGATION_MM : 0),
    highland: b.t0 >= BELTS[TROPICAL].min && b.belt === TEMPERATE,
    floodplain: site.river >= 1 && zt <= LOWLAND,
    boost: prosperityBoost(prosperity),
    amount: RESOURCES.map(() => 0),
    variant: RESOURCES.map(() => ''),
  };
  crops(e, GRAIN, GRAINS);
  crops(e, PRODUCE, PRODUCES);
  crops(e, ORCHARD, ORCHARDS);
  livestock(e);
  fish(e);
  wildFood(e);
  timber(e);
  stone(e);
  clay(e);
  crystal(e);
  crops(e, FIBRE, FIBRES);
  fuel(e);
  salt(e);
  metals(e);
  gems(e);
  crops(e, SPICES, SPICE_CROPS);
  crops(e, STIMULANTS, STIMULANT_CROPS);
  put(e, STIMULANTS, HONEY[b.biome], 'honey and beeswax');
  furs(e);
  dyes(e);
  horses(e);
  return finish(b.key, false, bedrock, e.amount, e.variant, site, prosperity);
}

/**
 * The resources of an ocean patch: fish everywhere (more on the shelf, next to land), and
 * on the shelf seaweed, seals and whales in cold water, pearls and coral in warm water.
 * `t0` is the sea-level temperature at its site, `prosperity` (0–1) makes the pearls, the
 * coral and the seals and whales more or less frequent.
 */
export function oceanResources(seed: number, patch: number, t0: number, shelf: boolean, prosperity = 0.5): PatchResources {
  const amount = RESOURCES.map(() => 0);
  const variant = RESOURCES.map(() => '');
  const set = (r: number, a: number, v: string) => {
    if (a > amount[r]) {
      amount[r] = a;
      variant[r] = v;
    }
  };
  const boost = prosperityBoost(prosperity);
  // seals and whales: in some patches of the cold sea, more of them where it is prosperous
  const furs = unit(seed, ST_FUR, patch) < FUR_ZONES * boost;
  const roll = (r: number, kind: D, chance: number, v: string) => {
    if (unit(seed, ST_DEPOSIT + kind, patch) < chance * boost) set(r, 0.35 + 0.65 * unit(seed, ST_RICH + kind, patch), v);
  };
  if (shelf) {
    set(FISH, 0.9, t0 < 4 ? 'cod banks' : t0 < 11 ? 'herring' : t0 < 18 ? 'sardine and anchovy' : 'reef fish and shellfish');
    if (t0 < 12) set(WILD, 0.3, 'edible seaweed and kelp');
    if (t0 < 3 && furs) set(FURS, 0.4, 'seals');
    if (t0 >= 20) roll(GEMS, D.seaPearl, 0.05, 'pearl oyster');
    else if (t0 >= 11) roll(GEMS, D.seaCoral, 0.03, 'precious red coral');
  } else {
    set(FISH, 0.5, t0 < 8 ? 'cod banks' : t0 < 16 ? 'herring' : 'tuna and large pelagics');
    if (t0 < 6 && furs) set(FURS, 0.3, 'whales');
  }
  return finish(patch, true, -1, amount, variant, NO_SITE, prosperity);
}

// ------------------------------------------------------------------ the layer

/** Patch records kept at most. */
const CACHE = 400_000;

export class Resources {
  private cache = new Map<number, PatchResources>();

  /**
   * `sites` is shared between layers on the same world, rivers and lakes (`withBiomes`):
   * the river and lake inputs do not depend on the biomes' heights.
   */
  constructor(
    readonly world: World,
    readonly rivers: Rivers,
    readonly lakes: Lakes,
    readonly biomes: Biomes,
    /** the climate whose prosperity map sets how often precious metals, gems and luxuries turn up */
    readonly climate: Climate,
    private readonly siteCache = new Map<number, Map<number, PatchSite>>(),
  ) {}

  /** The same layer on other Biomes (the map's, at exact patch heights), sharing the river and lake sites. */
  withBiomes(biomes: Biomes): Resources {
    return new Resources(this.world, this.rivers, this.lakes, biomes, this.climate, this.siteCache);
  }

  /** The prosperity map at a point, 0–1 between its minimum and maximum (0.5 when the map is flat). */
  prosperityAt(x: number, y: number): number {
    const p = this.climate.p.prosperity;
    const span = p.max - p.min;
    return span > 0 ? sat((this.climate.prosperityAt(x, y) - p.min) / span) : 0.5;
  }

  /** Bedrock (index into BEDROCKS) of an elevation zone (merged root); −1 for ocean. */
  bedrock(zkey: number): number {
    const ocean = this.world.ocean(zkey);
    return bedrockOf(this.world.p.seed, zkey, elevationZoneType(zkey, ocean));
  }

  /** The resources of a patch (any key of a merged patch; land or ocean). */
  ofPatch(skey: number): PatchResources {
    const w = this.world;
    const c = w.patchCell(skey);
    const hit = this.cache.get(c.patch);
    if (hit) return hit;
    const info = this.biomes.ofPatch(c.patch);
    let r: PatchResources;
    // the prosperity is read at the patch's site, like its climate
    const prosperity = this.prosperityAt(info.x, info.y);
    if (c.ocean) r = oceanResources(w.p.seed, c.patch, info.t0, this.touchesLand(c.patch), prosperity);
    else r = landResources(w.p.seed, info, c.elevationZone, bedrockOf(w.p.seed, c.elevationZone, info.zoneType), this.sites(c.region).get(c.patch) ?? NO_SITE, prosperity);
    // an estimated height may still change: keep only what is final
    if (c.ocean || info.heightExact || !this.biomes.terrain) {
      if (this.cache.size >= CACHE) this.cache.clear();
      this.cache.set(c.patch, r);
    }
    return r;
  }

  /** Does a (merged) ocean patch touch land: is it on the shelf? */
  private touchesLand(root: number): boolean {
    const w = this.world;
    const seen = new Set<number>([root]);
    const stack = [root];
    while (stack.length) {
      const s = stack.pop()!;
      for (const n of w.patchNbrs(w.patch(s))) {
        if (!w.patchCell(n).ocean) return true;
        if (!seen.has(n) && w.patchRoot(n) === root) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    return false;
  }

  /** The river and lake site of every land patch (merged root) drawn in a region. */
  sites(rkey: number): Map<number, PatchSite> {
    let s = this.siteCache.get(rkey);
    if (!s) {
      if (this.siteCache.size > 1500) this.siteCache.clear();
      s = this.computeSites(rkey);
      this.siteCache.set(rkey, s);
    }
    return s;
  }

  private computeSites(rkey: number): Map<number, PatchSite> {
    const w = this.world;
    const seed = w.p.seed;
    const out = new Map<number, PatchSite>();

    // the region's land patches (merged roots) with their raw members: enclosed bays
    for (const b of this.rivers.regionElevationZones(rkey)) {
      if (w.elevationZoneCell(b).ocean) continue;
      for (const s of w.elevationZonePatches(w.elevationZone(b))) {
        const c = w.patchCell(s);
        if (c.ocean || c.region !== rkey) continue;
        let site = out.get(c.patch);
        if (!site) {
          site = { river: 0, mouth: 0, lake: 0, harbour: false, goldLoad: 0, tinLoad: 0 };
          out.set(c.patch, site);
        }
        if (!site.harbour) for (const q of w.patchNbrs(w.patch(s))) if (w.patchCell(q).ocean && isBayPatch(w, q)) site.harbour = true;
      }
    }

    for (const l of this.lakes.get(rkey).lakes) {
      const site = out.get(l.patch);
      if (site && l.area > site.lake) site.lake = l.area;
    }

    // rivers: size and mouths per patch, and what the uplands shed into them
    const rr = this.rivers.get(rkey);
    const perPatch = Math.max(1, this.rivers.p.perPatch);
    const n = rr.n;
    const nodeSite: (PatchSite | undefined)[] = new Array(n);
    /** land nodes at and upstream of each node: all, in gold-bearing and in tin-bearing uplands */
    const all = new Int32Array(n);
    const gold = new Int32Array(n);
    const tin = new Int32Array(n);
    const zoneKind = new Map<number, number>();
    for (let k = 0; k < n; k++) {
      if (rr.parent[k] < 0 || rr.wet[k]) continue;
      const c = w.cellAt(rr.x[k], rr.y[k], true);
      if (c.ocean || c.region !== rkey) continue;
      nodeSite[k] = out.get(c.patch);
      if (!nodeSite[k]) continue;
      let kind = zoneKind.get(c.elevationZone);
      if (kind === undefined) {
        const zt = elevationZoneType(c.elevationZone, false);
        const rock = bedrockOf(seed, c.elevationZone, zt);
        kind = zt >= HILLS ? (GOLD_ROCK.has(rock) ? 1 : rock === GRANITE ? 2 : 0) : 0;
        zoneKind.set(c.elevationZone, kind);
      }
      all[k] = 1;
      if (kind === 1) gold[k] = 1;
      else if (kind === 2) tin[k] = 1;
    }
    // nodes are appended as the rivers grow, so a parent always comes before its children
    for (let k = n - 1; k > 0; k--) {
      const p = rr.parent[k];
      if (p < 0) continue;
      all[p] += all[k];
      gold[p] += gold[k];
      tin[p] += tin[k];
    }
    const best = new Map<PatchSite, number>();
    for (let k = 0; k < n; k++) {
      const site = nodeSite[k];
      if (!site) continue;
      const f = rr.flow[k];
      const a = f / perPatch;
      const p = rr.parent[k];
      if (a > site.river) site.river = a;
      if ((rr.parent[p] < 0 || rr.wet[p] === 1) && a > site.mouth) site.mouth = a;
      // the loads are read where the river is largest in the patch (first node on a tie)
      if (f > (best.get(site) ?? -1)) {
        best.set(site, f);
        site.goldLoad = gold[k] / all[k];
        site.tinLoad = tin[k] / all[k];
      }
    }
    return out;
  }
}
