/** Sandbox 4 parameter schema (panels and URL state), presets, and its mapping to the World, Rivers and Terrain parameters. */
import { bindDefaults, bool, defaultsOf, num, opt, str, type DefaultsFile, type ParamDef, type Params, type Section } from '@shared/params/schema';
import type { BiomeParams } from './world/biomes';
import type { ClimateParams, NoiseFieldParams } from './world/climate';
import type { LakeParams } from './world/lakes';
import type { LocationParams } from './world/locations';
import type { ConeAngle, PullPower, RiverParams } from './world/rivers';
import { FLOOD_REF_FLOW, type TerrainParams, type Theta } from './world/terrain';
import type { GrowFrom, WorldParams } from './world/world';
import { ELEVATION_ZONE_TYPES, LAND_ZONE_TYPES } from './world/zones';
import defaultsJson from '../defaults.json';

const DEFAULTS: DefaultsFile = defaultsJson;
/** Seed used when the URL has none (from sandboxes/sandbox4/defaults.json). */
export const DEFAULT_SEED = DEFAULTS.seed;
/** Attaches each parameter's default from sandboxes/sandbox4/defaults.json. */
const withDefaults = bindDefaults(DEFAULTS.params, 'sandboxes/sandbox4/defaults.json');

const KM = 1000;

/** Generation parameters (left panel). Sizes are in km in the UI, metres in the model. */
export const SECTIONS: Section[] = withDefaults.sections([
  {
    id: 'regions',
    title: 'Regions · large cells',
    open: true,
    help: 'Plain Voronoi cells (no warp). A region owns the elevation zones whose site lies inside it and decides how many of them become ocean seeds and how many merge.',
    params: [
      { key: 'reg.size', label: 'Grid size', type: 'number', min: 32, max: 512, step: 1, log: true, unit: ' km' },
      { key: 'reg.jitter', label: 'Jitter', type: 'number', min: 0, max: 1, step: 0.01, help: 'How far a site may move from its lattice cell centre. 0 = a square grid.' },
      { key: 'reg.oceanMin', label: 'Ocean seeds min', type: 'int', min: 0, max: 4, help: 'Ocean seed elevation zones per region: a uniform count in [min, max].' },
      { key: 'reg.oceanMax', label: 'Ocean seeds max', type: 'int', min: 0, max: 4 },
      { key: 'reg.mergeMin', label: 'Zone merges min', type: 'int', min: 0, max: 12, help: 'Elevation zones per region that join their nearest neighbour: a uniform count in [min, max].' },
      { key: 'reg.mergeMax', label: 'Zone merges max', type: 'int', min: 0, max: 12 },
    ],
  },
  {
    id: 'oceans',
    title: 'Oceans',
    open: true,
    help: 'Seeds → links → growth. A linked seed turns every elevation zone on the straight line to its nearest other seed (or two nearest, with a double link) into ocean; linked ocean elevation zones then convert some of their closest land neighbours.',
    params: [
      { key: 'oc.connect', label: 'Link chance', type: 'int', min: 0, max: 100, unit: '%', help: 'Chance that an ocean seed links to its nearest other ocean seed.' },
      {
        key: 'oc.double',
        label: 'Double link chance',
        type: 'int',
        min: 0,
        max: 100,
        unit: '%',
        help: 'Chance that an ocean seed links to its two nearest other seeds instead of one. Checked before the link chance, so it applies to every seed.',
      },
      { key: 'oc.range', label: 'Link search', type: 'int', min: 1, max: 3, unit: ' reg', help: 'How many regions away a seed looks for its nearest other seed.' },
      { key: 'oc.g3', label: 'Grow 3 nbrs', type: 'int', min: 0, max: 100, unit: '%', help: 'Chance that a growing ocean elevation zone converts its 3 closest land neighbours. The four chances are normalised.' },
      { key: 'oc.g2', label: 'Grow 2 nbrs', type: 'int', min: 0, max: 100, unit: '%' },
      { key: 'oc.g1', label: 'Grow 1 nbr', type: 'int', min: 0, max: 100, unit: '%' },
      { key: 'oc.g0', label: 'Grow 0 nbrs', type: 'int', min: 0, max: 100, unit: '%' },
      {
        key: 'oc.from',
        label: 'Grow from',
        type: 'select',
        options: opt(['connected', 'Linked ocean elevation zones'], ['all', 'All ocean elevation zones']),
        help: 'Which ocean elevation zones grow in the first pass. "Linked" (the spec) leaves lone seeds as single-zone seas.',
      },
      { key: 'oc.passes', label: 'Growth passes', type: 'int', min: 0, max: 4, help: 'Later passes grow from the elevation zones converted in the previous pass.' },
    ],
  },
  {
    id: 'elevationZones',
    title: 'Elevation zones · medium cells',
    open: true,
    help: 'Warped Voronoi cells: the ocean/land unit, and the unit for factions. An elevation zone owns the subbiomes whose site lies inside it.',
    params: [
      { key: 'ez.size', label: 'Grid size', type: 'number', min: 8, max: 128, step: 1, log: true, unit: ' km' },
      { key: 'ez.jitter', label: 'Jitter', type: 'number', min: 0, max: 1, step: 0.01 },
      { key: 'ez.warp', label: 'Border warp', type: 'number', min: 0, max: 1, step: 0.01, help: 'Amplitude of the border warp, in cell sizes.' },
      { key: 'ez.warpFreq', label: 'Warp frequency', type: 'number', min: 0.1, max: 4, step: 0.01, log: true, help: 'Warp noise cycles per cell. Low = gently bent borders, high = wiggly borders.' },
      { key: 'ez.mergeMin', label: 'Subbiome merges min', type: 'int', min: 0, max: 12, help: 'Subbiomes per elevation zone that join their nearest neighbour in the same elevation zone.' },
      { key: 'ez.mergeMax', label: 'Subbiome merges max', type: 'int', min: 0, max: 12 },
      { key: 'ez.mergeCoast', label: 'Merge across coast', type: 'bool', help: 'Allow a land elevation zone to merge into an ocean elevation zone (and vice versa). Off keeps coastlines intact.' },
      {
        key: 'ez.flatSparseP',
        label: 'Flat: sparse river precipitation cutoff',
        type: 'number',
        min: 0,
        max: 20000,
        step: 10,
        unit: ' mm/yr',
        help: 'A flat elevation zone whose point (site) gets less initial precipitation than this is river-poor: every one of its subbiomes then gets only 0 or 1 river attractor (50/50) instead of "Attractors / subbiome". 0 = off. The default makes about a third of the flat zones river-poor. Rebuilds only the rivers.',
      },
    ],
  },
  {
    id: 'subs',
    title: 'Subbiomes · small cells',
    open: true,
    help: 'Warped Voronoi cells for detail: sub-biomes, cities and towns, ore deposits, competing factions.',
    params: [
      { key: 'sub.size', label: 'Grid size', type: 'number', min: 2, max: 32, step: 0.1, log: true, unit: ' km' },
      { key: 'sub.jitter', label: 'Jitter', type: 'number', min: 0, max: 1, step: 0.01 },
      { key: 'sub.warp', label: 'Border warp', type: 'number', min: 0, max: 1, step: 0.01 },
      { key: 'sub.warpFreq', label: 'Warp frequency', type: 'number', min: 0.1, max: 4, step: 0.01, log: true },
      {
        key: 'sub.nest',
        label: 'Nest levels',
        type: 'bool',
        help: 'Classify every point through its subbiome: elevation zone and region borders (and coasts) then follow subbiome cells. Off = each level is looked up at the point itself.',
      },
    ],
  },
]);

/**
 * River parameters (left panel). Rivers are computed per region on top of the world,
 * so changing them never regenerates the map itself.
 */
export const RIVER_SECTION: Section = withDefaults.section({
  id: 'rivers',
  title: 'Rivers · space colonization',
  enableKey: 'riv.on',
  open: true,
  help: 'Per region: a root at the point of every ocean elevation zone touching the region, attractors in every inland (non-coastal) land subbiome, then space colonization until every attractor is reached. Width = attractors reached upstream.',
  params: [
    { key: 'riv.on', label: 'Rivers', type: 'bool' },
    { key: 'riv.points', label: 'Attractors / subbiome', type: 'int', min: 1, max: 30, help: 'Attraction points scattered inside every inland land subbiome.' },
    { key: 'riv.step', label: 'Step D', type: 'number', min: 0.5, max: 8, step: 0.1, log: true, unit: ' km', help: 'Length of one growth step (segment length).' },
    {
      key: 'riv.influence',
      label: 'Influence dᵢ',
      type: 'number',
      min: 2,
      max: 256,
      step: 0.5,
      log: true,
      unit: ' km',
      help: 'An attractor pulls on its nearest node only within this radius. Small = many independent branches; large = fewer, straighter rivers.',
    },
    { key: 'riv.kill', label: 'Kill dₖ', type: 'number', min: 0.5, max: 16, step: 0.1, log: true, unit: ' km', help: 'An attractor is reached (removed) once a node is this close. Kept above the step D.' },
    {
      key: 'riv.jitter',
      label: 'Random motion',
      type: 'number',
      min: 0,
      max: 2,
      step: 0.01,
      help: 'Weight of a random unit vector added to every growth direction. 0 = straight, smooth branches; 1 = strongly meandering.',
    },
    {
      key: 'riv.pull',
      label: 'Pull power',
      type: 'select',
      options: opt(['normal', 'Normal (equal pulls)'], ['squared', 'Distance² to target'], ['sqrt', '√ distance to target']),
      help: 'How each attractor’s pull is weighted when a node picks its step direction. Normal = every attractor in range pulls equally (the paper); distance² = far attractors dominate (longer, straighter reaches); √distance = a mild bias towards far ones.',
    },
    {
      key: 'riv.inertia',
      label: 'Inertia',
      type: 'number',
      min: 0,
      max: 3,
      step: 0.05,
      help: 'Weight of the direction a river already runs in, blended into every step. 0 = off; higher = longer straight reaches and wider bends.',
    },
    {
      key: 'riv.cone',
      label: 'Perception cone',
      type: 'select',
      options: opt(['0', 'Off (all round)'], ['150', '150°'], ['144', '144° (72° junctions, humid)'], ['120', '120°'], ['90', '90° (45° junctions, arid)'], ['60', '60°']),
      help: 'A node is only pulled by attractors within this angle ahead of it. No hooking back, and side branches leave at most half the angle from the main stem.',
    },
    {
      key: 'riv.wander',
      label: 'Wander',
      type: 'number',
      min: 0,
      max: 0.98,
      step: 0.01,
      help: 'How much each step’s random motion carries over from the previous one. 0 = fresh every step (wiggle); towards 1 = long, coherent bends. Needs some random motion.',
    },
    {
      key: 'riv.apical',
      label: 'Main-stem dominance',
      type: 'number',
      min: 0,
      max: 1,
      step: 0.01,
      help: 'A side branch only sprouts when its pull is at least this fraction of the pull on the main stem it leaves. 0 = off; higher = dominant trunks, fewer short tributaries.',
    },
    { key: 'riv.coast', label: 'Skip coast subbiomes', type: 'bool', help: 'No attractors in subbiomes that touch the ocean (the spec).' },
  ],
});
/** Keys shown in the map sections that only feed the rivers (changing them never regenerates the map). */
const RIVER_ONLY_KEYS = ['ez.flatSparseP'];
export const RIVER_KEYS = new Set([...RIVER_SECTION.params.map((p) => p.key), ...RIVER_ONLY_KEYS]);

/** Schema → model parameters for Rivers (the seed feeds the precipitation map that thins flat zones). */
export function toRiverParams(p: Params, seed: number): RiverParams {
  return {
    perSub: num(p, 'riv.points'),
    step: num(p, 'riv.step') * KM,
    influence: num(p, 'riv.influence') * KM,
    kill: num(p, 'riv.kill') * KM,
    jitter: num(p, 'riv.jitter'),
    pull: str(p, 'riv.pull') as PullPower,
    inertia: num(p, 'riv.inertia'),
    cone: Number(str(p, 'riv.cone')) as ConeAngle,
    wander: num(p, 'riv.wander'),
    apical: num(p, 'riv.apical'),
    skipCoast: bool(p, 'riv.coast'),
    flatSparseCutoff: num(p, 'ez.flatSparseP'),
    climate: toClimateParams(p, seed),
    maxHops: 4,
  };
}

/**
 * Lake parameters (left panel). Lakes are placed per region after the rivers, so changing
 * them never regenerates the map, the rivers or the terrain.
 */
export const LAKE_SECTION: Section = withDefaults.section({
  id: 'lakes',
  title: 'Lakes',
  open: true,
  help: 'Per region, after the rivers, and always on a river: every subbiome that may hold a lake and has a river running through it gets one try, centred on the river (shown with the rivers). No lakes in ocean or mountains elevation zones, in desert subbiomes (hot or cold desert at sea level, so never where the map shows desert) or in restricted subbiomes (those of a river-poor flat elevation zone, see “Flat: sparse river precipitation cutoff”). The outline is an ellipse with a few broad noise lobes, clipped so a lake never leaves its region or the land it may cover, then rounded.',
  params: [
    {
      key: 'lake.freq',
      label: 'Frequency',
      type: 'number',
      min: 0,
      max: 1,
      step: 0.01,
      help: 'Chance that a subbiome which may hold a lake, and has a river in it, gets one. 0 = no lakes. Lakes that would overlap another lake, or that the clip leaves smaller than the minimum size, are dropped.',
    },
    {
      key: 'lake.min',
      label: 'Minimum size',
      type: 'number',
      min: 0.2,
      max: 40,
      step: 0.1,
      log: true,
      unit: ' km',
      help: 'Smallest lake: the diameter of a circle with the lake’s area. Nominal sizes are drawn between the minimum and maximum, favouring small lakes.',
    },
    { key: 'lake.max', label: 'Maximum size', type: 'number', min: 0.2, max: 40, step: 0.1, log: true, unit: ' km', help: 'Largest lake (diameter of a circle with the same area). A lake the noise makes larger is scaled down.' },
  ],
});
export const LAKE_KEYS = new Set(LAKE_SECTION.params.map((p) => p.key));

/** Schema → model parameters for Lakes. */
export function toLakeParams(p: Params): LakeParams {
  return { frequency: num(p, 'lake.freq'), minSize: num(p, 'lake.min') * KM, maxSize: num(p, 'lake.max') * KM };
}

/**
 * Height-map parameters (left panel). The terrain is computed per region on top of the
 * map and the rivers, only while a view needs it (height colours, hillshade or 3D).
 */
export const TERRAIN_SECTION: Section = withDefaults.section({
  id: 'terrain',
  title: 'Terrain · height map',
  open: true,
  help: 'Fitted to the map: river beds rise upstream by the stream-power law, hillslopes rise from rivers and coast (steepness per elevation zone type), ridges divide regions and river systems, then detail noise, the rivers are burnt in and pits are filled so everything drains to the sea.',
  params: [
    {
      key: 'hgt.res',
      label: 'Resolution',
      type: 'select',
      options: opt(['2000', '2 km (fast)'], ['1000', '1 km'], ['500', '500 m (slow)']),
      help: 'Cell size of the per-region height raster.',
    },
    {
      key: 'hgt.chSlope',
      label: 'Channel slope S₀',
      type: 'number',
      min: 0.002,
      max: 0.1,
      step: 0.001,
      log: true,
      help: 'River gradient where the flow is one attractor; bigger rivers are flatter (S = S₀·flow^−θ). The main knob for overall relief.',
    },
    {
      key: 'hgt.theta',
      label: 'Concavity θ',
      type: 'select',
      options: opt(['0.375', '⅜ (straighter profiles)'], ['0.4375', '7⁄16 (≈ 0.45, typical)'], ['0.5', '½ (more concave)']),
      help: 'How fast rivers flatten downstream as flow grows.',
    },
    { key: 'hgt.hill', label: 'Hillslope steepness', type: 'number', min: 0.05, max: 4, step: 0.05, log: true, help: 'Multiplier on the hillslope of every elevation zone type (set per type under "hillslope by elevation zone").' },
    {
      key: 'hgt.level',
      label: 'Level flat zones',
      type: 'number',
      min: 0,
      max: 1,
      step: 0.05,
      help: 'An elevation zone whose river gradient is below 1 sits at one level: the rivers entering it are lowered towards its lowest entry (to the level at gradient 0), cutting gorges through the steeper land downstream. 0 = off: every river keeps the height it climbed to elsewhere.',
    },
    { key: 'hgt.relief', label: 'Mountain belts', type: 'number', min: 0, max: 1, step: 0.01, help: 'Strength of a slow, region-scale relief field that makes several neighbouring elevation zones rugged or flat together.' },
    { key: 'hgt.ridge', label: 'Region ridge', type: 'number', min: 0, max: 400, step: 5, unit: ' m', help: 'Ridge along region borders (rivers never cross them). Fades out near rivers.' },
    { key: 'hgt.divide', label: 'Basin divides', type: 'number', min: 0, max: 300, step: 5, unit: ' m', help: 'Extra height where the basins of two different river systems meet.' },
    { key: 'hgt.noise', label: 'Detail noise', type: 'number', min: 0, max: 3, step: 0.05, help: 'Multiplier on the noise amplitude of every elevation zone type; masked to zero on the river beds.' },
    { key: 'hgt.burn', label: 'Channel depth', type: 'number', min: 0, max: 20, step: 0.5, unit: ' m', help: 'How deep the rivers are burnt below their bed profile.' },
    { key: 'hgt.sea', label: 'Sea depth', type: 'number', min: 0, max: 2000, step: 10, unit: ' m', help: 'Ocean depth 40 km and more from the coast.' },
  ],
});

/** URL/param key of an elevation zone type's river gradient factor, e.g. 'hgt.ch.lowland'. */
export const chanKey = (id: string) => `hgt.ch.${id}`;

/** How fast the river bed rises upstream in each elevation zone type (factor on S₀). */
export const GRADIENT_SECTION: Section = withDefaults.section({
  id: 'gradient',
  title: 'Terrain · river gradient by elevation zone',
  open: false,
  help: 'Factor on the channel slope S₀ where a river runs through each type of elevation zone: how fast the river bed rises upstream (never steeper than the zone’s hillslope). 0 = flat: with "Level flat zones" the whole elevation zone sits at the level of its lowest river entry; below 1 it is levelled partly.',
  params: LAND_ZONE_TYPES.map((t) => ({
    key: chanKey(t.id),
    label: t.name,
    type: 'number' as const,
    min: 0,
    max: 5,
    step: 0.05,
  })),
});

/** URL/param key of an elevation zone type’s hillslope steepness, e.g. 'hgt.hs.lowland'. */
export const hillKey = (id: string) => `hgt.hs.${id}`;

/** How steeply the land rises away from rivers and the coast in each elevation zone type. */
export const HILLSLOPE_SECTION: Section = withDefaults.section({
  id: 'hillslope',
  title: 'Terrain · hillslope by elevation zone',
  open: false,
  help: 'How steeply the land rises away from its rivers and the coast (metres per metre, × "Hillslope steepness" and the mountain belts). Low values make flat plains, high values rugged hills.',
  params: LAND_ZONE_TYPES.map((t) => ({
    key: hillKey(t.id),
    label: t.name,
    type: 'number' as const,
    min: 0,
    max: 0.6,
    step: 0.001,
  })),
});

/** Floodplain half-width as a function of bed height: four control points of a monotone spline. */
export const FLOODPLAIN_SECTION: Section = withDefaults.section({
  id: 'floodplain',
  title: 'Terrain · floodplain',
  open: false,
  help: 'Half-width of the flat valley floor along a river, as a smooth curve over the river bed height through these four points (sorted by height; flat beyond the ends).',
  params: [
    ...[0, 1, 2, 3].flatMap((i) => [
      { key: `hgt.fp.h${i + 1}`, label: `Point ${i + 1} · height`, type: 'number' as const, min: 0, max: 3000, step: 10, unit: ' m' },
      { key: `hgt.fp.w${i + 1}`, label: `Point ${i + 1} · half-width`, type: 'number' as const, min: 0, max: 3000, step: 10, unit: ' m' },
    ]),
    {
      key: 'hgt.fp.flow',
      label: 'Scale with river size',
      type: 'bool',
      help: `On: the curve is the half-width for a flow of ${FLOOD_REF_FLOW} attractors; bigger rivers get × √(flow / ${FLOOD_REF_FLOW}). Off: the curve alone, for every river.`,
    },
  ],
});

export const TERRAIN_KEYS = new Set([TERRAIN_SECTION, HILLSLOPE_SECTION, GRADIENT_SECTION, FLOODPLAIN_SECTION].flatMap((sec) => sec.params.map((p) => p.key)));

/** Schema → model parameters for Terrain. */
export function toTerrainParams(p: Params): TerrainParams {
  return {
    res: Number(str(p, 'hgt.res')),
    chSlope: num(p, 'hgt.chSlope'),
    theta: Number(str(p, 'hgt.theta')) as Theta,
    hill: num(p, 'hgt.hill'),
    hillType: ELEVATION_ZONE_TYPES.map((t) => (t.id === 'ocean' ? 0 : num(p, hillKey(t.id)))),
    level: num(p, 'hgt.level'),
    chanFactor: ELEVATION_ZONE_TYPES.map((t) => (t.id === 'ocean' ? 1 : num(p, chanKey(t.id)))),
    floodH: [1, 2, 3, 4].map((i) => num(p, `hgt.fp.h${i}`)),
    floodW: [1, 2, 3, 4].map((i) => num(p, `hgt.fp.w${i}`)),
    floodFlow: bool(p, 'hgt.fp.flow'),
    relief: num(p, 'hgt.relief'),
    ridge: num(p, 'hgt.ridge'),
    divide: num(p, 'hgt.divide'),
    noise: num(p, 'hgt.noise'),
    burn: num(p, 'hgt.burn'),
    sea: num(p, 'hgt.sea'),
  };
}

/** Parameters of one Perlin-noise climate field (left panel), keys `clim.<id>.*`. */
function climateSection(id: FieldId, title: string, help: string, unit: string, lo: number, hi: number, step: number, log: boolean, scaleMin = 20, scaleStep = 10): Section {
  const k = (name: string) => `clim.${id}.${name}`;
  return withDefaults.section({
    id: `climate-${id}`,
    title,
    open: false,
    help,
    params: [
      { key: k('scale'), label: 'Feature size', type: 'number', min: scaleMin, max: 4000, step: scaleStep, log: true, unit: ' km', help: 'Wavelength of the first (largest) octave: roughly the distance between a high and the next one.' },
      { key: k('octaves'), label: 'Octaves', type: 'int', min: 1, max: 8, help: 'Layers of Perlin noise, each finer than the last. 1 = smooth blobs; more = rougher, more detailed.' },
      { key: k('lacunarity'), label: 'Lacunarity', type: 'number', min: 1.5, max: 4, step: 0.05, help: 'How much finer each octave is than the previous one.' },
      { key: k('gain'), label: 'Gain', type: 'number', min: 0.1, max: 0.9, step: 0.01, help: 'How much weaker each octave is than the previous one. Higher = rougher.' },
      { key: k('min'), label: 'Minimum', type: 'number', min: lo, max: hi, step, log, unit, help: `Value at the strongest lows. The noise is stretched to [minimum, maximum]${log ? ' on a log scale (the middle is √(min · max))' : ''}; only the strongest lows and highs (≈ 0.3 %) reach the ends.` },
      { key: k('max'), label: 'Maximum', type: 'number', min: lo, max: hi, step, log, unit, help: 'Value at the strongest highs.' },
    ],
  });
}

/** Ids of the Perlin-noise fields: temperature, precipitation, prosperity, supernatural. */
type FieldId = 't' | 'p' | 'pros' | 'sup';

/** Initial temperature and precipitation maps: Perlin noise, independent of the map for now. */
export const CLIMATE_SECTIONS: Section[] = [
  climateSection('t', 'Climate · initial temperature', 'Initial temperature map (°C): fBm of Perlin noise. Shown with Display → Temperature overlay and in the inspector.', ' °C', -60, 60, 1, false),
  climateSection('p', 'Climate · initial precipitation', 'Initial precipitation map (mm per year): fBm of Perlin noise with its own seed, on a log scale, so most of the map is dry to moderate and only the strongest highs are very wet. Shown with Display → Precipitation overlay and in the inspector.', ' mm/yr', 10, 20000, 10, true),
];
export const CLIMATE_KEYS = new Set(CLIMATE_SECTIONS.flatMap((sec) => sec.params.map((p) => p.key)));
/** Precipitation keys: they also feed the rivers (river-poor dry flat zones). */
export const PRECIP_KEYS = new Set([...CLIMATE_KEYS].filter((k) => k.startsWith('clim.p.')));

/** Prosperity map: Perlin noise like the climate. It feeds only the city and town locations (no biome or river rebuild). */
export const PROSPERITY_SECTION: Section = climateSection(
  'pros',
  'Prosperity',
  'Prosperity map (unitless index, 1 to 100 by default): fBm of Perlin noise with its own seed, independent of the climate and the map. It is one of the five factors of the city and town locations. Shown with Display → Prosperity overlay and in the inspector.',
  '',
  0,
  1000,
  1,
  false,
);
export const PROSPERITY_KEYS = new Set(PROSPERITY_SECTION.params.map((p) => p.key));

/**
 * Supernatural map: Perlin noise like the prosperity map, with fine (10 km) features. It
 * feeds nothing yet (meant for magic resources and other fantasy game play).
 */
export const SUPERNATURAL_SECTION: Section = climateSection(
  'sup',
  'Supernatural',
  'Supernatural map (unitless index, 0 to 100 by default): how strong magic is at a point, for magic resources and other fantasy game play. fBm of Perlin noise with its own seed and fine features (10 km by default), independent of the climate and the map for now. Shown with Display → Supernatural overlay and in the inspector.',
  '',
  0,
  1000,
  1,
  false,
  1,
  0.5,
);
export const SUPERNATURAL_KEYS = new Set(SUPERNATURAL_SECTION.params.map((p) => p.key));

function toField(p: Params, id: FieldId): NoiseFieldParams {
  const a = num(p, `clim.${id}.min`);
  const b = num(p, `clim.${id}.max`);
  return {
    scale: num(p, `clim.${id}.scale`) * KM,
    octaves: num(p, `clim.${id}.octaves`),
    lacunarity: num(p, `clim.${id}.lacunarity`),
    gain: num(p, `clim.${id}.gain`),
    min: Math.min(a, b),
    max: Math.max(a, b),
    log: id === 'p',
  };
}

/** Schema → model parameters for the climate maps. */
export function toClimateParams(p: Params, seed: number): ClimateParams {
  return { seed, temperature: toField(p, 't'), precipitation: toField(p, 'p'), prosperity: toField(p, 'pros'), supernatural: toField(p, 'sup') };
}

/**
 * Biome parameters (left panel): every subbiome gets a biome from the initial climate at
 * its site, its height and its elevation zone. Changing them only recolours the map.
 */
export const BIOME_SECTION: Section = withDefaults.section({
  id: 'biomes',
  title: 'Biomes · per subbiome',
  open: false,
  help: 'Each land subbiome gets a biome from the initial temperature and precipitation at its site. The temperature is lowered by the height cooling curve at the subbiome’s mean height (from the terrain; a typical height for its elevation zone type until the terrain is computed). The aridity P / (20·T + 140) and a thermal belt pick the biome. River-poor flat elevation zones are drier, so they favour desert. Coastal subbiomes (bordering the ocean) of flat and lowland elevation zones become mangrove where it is warm and wet enough. Colour by → Biomes.',
  params: [
    ...[0, 1, 2, 3, 4].flatMap((i) => [
      {
        key: `bio.cool.h${i + 1}`,
        label: `Point ${i + 1} · height`,
        type: 'number' as const,
        min: 0,
        max: 6000,
        step: 10,
        unit: ' m',
        help:
          i === 0
            ? 'How much cooler it is at a height: a smooth monotone curve through these five points (sorted by height). Below the lowest point it keeps that point’s cooling; above the highest it continues along the last segment’s slope. The defaults are the standard atmosphere, 6.5 °C per km; real mountain slopes are often 4–5 °C per km. Steeper = more tundra and snow on hills and mountains.'
            : undefined,
      },
      { key: `bio.cool.t${i + 1}`, label: `Point ${i + 1} · cooling`, type: 'number' as const, min: -20, max: 60, step: 0.1, unit: ' °C' },
    ]),
    {
      key: 'bio.sparseDry',
      label: 'Sparse flat: precipitation factor',
      type: 'number',
      min: 0,
      max: 1,
      step: 0.05,
      help: 'In river-poor flat elevation zones (initial precipitation at the zone’s site below “Flat: sparse river precipitation cutoff”) the precipitation is multiplied by this before classifying, so they favour desert and steppe. 1 = no effect.',
    },
    {
      key: 'bio.mangroveT',
      label: 'Mangrove: min temperature',
      type: 'number',
      min: -10,
      max: 50,
      step: 0.5,
      unit: ' °C',
      help: 'Mangrove grows only in coastal subbiomes (a cell borders an ocean subbiome) of flat and lowland elevation zones, never in hills or mountains or inland. There it replaces the climate biome when the temperature after the height cooling is at least this (real mangroves stop near the frost line, about the 20 °C isotherm). Above the warmest coast = no mangrove.',
    },
    {
      key: 'bio.mangroveM',
      label: 'Mangrove: min aridity',
      type: 'number',
      min: 0,
      max: 10,
      step: 0.1,
      help: 'Least aridity P / P_th for mangrove on an eligible coast. 0.5 keeps desert coasts bare; 0 allows mangrove on arid coasts too (as on the Red Sea).',
    },
  ],
});
export const BIOME_KEYS = new Set(BIOME_SECTION.params.map((p) => p.key));

/** Schema → model parameters for the biomes. */
export function toBiomeParams(p: Params): BiomeParams {
  return {
    coolH: [1, 2, 3, 4, 5].map((i) => num(p, `bio.cool.h${i}`)),
    coolT: [1, 2, 3, 4, 5].map((i) => num(p, `bio.cool.t${i}`)),
    sparseDry: num(p, 'bio.sparseDry'),
    mangroveT: num(p, 'bio.mangroveT'),
    mangroveM: num(p, 'bio.mangroveM'),
  };
}

/**
 * City and town locations (left panel): scored per region on top of the map, rivers, lakes,
 * climate and prosperity map. Changing them only re-scores the locations.
 */
export const LOCATION_SECTION: Section = withDefaults.section({
  id: 'locations',
  title: 'City & town locations',
  open: false,
  help: 'Per region, every land subbiome is scored as a place for a city or town on five factors, each 0–1: resources (food of the catchment, fresh water, wood / stone / clay, fish), geography (buildable ground, a waterside site, defence, depth inside the region), trade & travel (river mouth, harbour, navigable river, confluence, or a central place within a day or two of much farmland), climate (temperature and aridity) and prosperity (the prosperity map). Viability = 100 × the weighted mean of the five, scaled down to 0 where there is no fresh water or the temperature is unlivable. The best-scoring subbiomes become the region’s locations, kept apart by the spacing; the top ones, far apart and well inside the region, are cities. Shown with Display → City & town locations; the Location viability slider there hides the weaker ones.',
  params: [
    { key: 'loc.count', label: 'Locations / region', type: 'int', min: 0, max: 60, help: 'How many locations a region aims for (cities included). Regions with little habitable land get fewer.' },
    { key: 'loc.cities', label: 'Cities / region', type: 'int', min: 0, max: 12, help: 'At most this many of a region’s locations are cities: its best scores that lie at least two subbiomes inside the region and 2.5 × the spacing apart. The rest are towns.' },
    {
      key: 'loc.spacing',
      label: 'Spacing',
      type: 'number',
      min: 4,
      max: 80,
      step: 0.5,
      log: true,
      unit: ' km',
      help: 'Least distance between two locations of a region. When that leaves a region short of its number of locations, the spacing is relaxed step by step, down to one subbiome size.',
    },
    { key: 'loc.wRes', label: 'Weight · resources', type: 'number', min: 0, max: 1, step: 0.05, help: 'Relative weight of each factor in the viability score (the five weights are normalised).' },
    { key: 'loc.wGeo', label: 'Weight · geography', type: 'number', min: 0, max: 1, step: 0.05 },
    { key: 'loc.wTrade', label: 'Weight · trade & travel', type: 'number', min: 0, max: 1, step: 0.05 },
    { key: 'loc.wClim', label: 'Weight · climate', type: 'number', min: 0, max: 1, step: 0.05 },
    { key: 'loc.wPros', label: 'Weight · prosperity', type: 'number', min: 0, max: 1, step: 0.05 },
  ],
});
export const LOCATION_KEYS = new Set(LOCATION_SECTION.params.map((p) => p.key));

/** Schema → model parameters for the locations. */
export function toLocationParams(p: Params): LocationParams {
  return {
    count: num(p, 'loc.count'),
    cities: num(p, 'loc.cities'),
    spacing: num(p, 'loc.spacing') * KM,
    weights: { resources: num(p, 'loc.wRes'), geography: num(p, 'loc.wGeo'), trade: num(p, 'loc.wTrade'), climate: num(p, 'loc.wClim'), prosperity: num(p, 'loc.wPros') },
  };
}

/** Colour modes: [id, label]. */
export const VIEW_MODES = [
  ['map', 'Map (elevation zone types)'],
  ['biomes', 'Biomes (per subbiome)'],
  ['landsea', 'Land & ocean'],
  ['genesis', 'Ocean genesis'],
  ['merges', 'Merged cells'],
  ['regions', 'Regions'],
  ['elevationZones', 'Elevation zones'],
  ['subbiomes', 'Subbiomes'],
  ['hierarchy', 'Hierarchy (all levels)'],
  ['height', 'Height (hypsometric)'],
] as [string, string][];

/** Display parameters (right panel): re-render, never regenerate. */
export const VIEW_SECTION: Section = withDefaults.section({
  id: 'view',
  title: 'Display',
  open: true,
  params: [
    { key: 'view.color', label: 'Colour by', type: 'select', options: opt(...VIEW_MODES), view: true },
    {
      key: 'view.3d',
      label: '3D landscape',
      type: 'bool',
      view: true,
      help: 'Show the current view as a 3D landscape, draped with the map (rivers and borders included). Drag to orbit, scroll to zoom, Shift/right-drag to pan.',
    },
    { key: 'view.exag', label: 'Vertical exaggeration', type: 'number', min: 1, max: 60, step: 0.5, log: true, view: true, help: '3D only: heights are this many times taller than true scale.' },
    { key: 'view.hillshade', label: 'Hillshade', type: 'bool', view: true, help: 'Shade any colour mode by the height map (lit from the north-west). Always on for “Height”.' },
    { key: 'view.temp', label: 'Temperature overlay', type: 'bool', view: true, help: 'The initial temperature map, 50 % transparent on top of the map and rivers (blue = cold, red = hot).' },
    { key: 'view.precip', label: 'Precipitation overlay', type: 'bool', view: true, help: 'The initial precipitation map, 50 % transparent on top of the map and rivers (brown = dry, teal/blue = wet). Drawn above the temperature overlay when both are on.' },
    { key: 'view.prosperity', label: 'Prosperity overlay', type: 'bool', view: true, help: 'The prosperity map, 50 % transparent on top of the map and rivers (dark purple = poor, gold = prosperous). Drawn above the climate overlays.' },
    { key: 'view.supernatural', label: 'Supernatural overlay', type: 'bool', view: true, help: 'The supernatural map, 50 % transparent on top of the map and rivers (near black = mundane, violet → glowing cyan = strong magic). Drawn above the other noise overlays.' },
    { key: 'view.locations', label: 'City & town locations', type: 'bool', view: true, help: 'The potential city (diamond) and town (dot) locations of every region, coloured by their viability score (purple = poor, orange, pale yellow = excellent). Zoom in for the scores; hover one for the factors behind it. Zoomed far out only the cities are drawn.' },
    {
      key: 'view.locMin',
      label: 'Location viability',
      type: 'number',
      min: 0,
      max: 100,
      step: 1,
      view: true,
      help: 'Show only locations whose combined viability score (0–100: resources, geography, trade & travel, climate and prosperity) is at least this. 0 shows every location; raise it to keep only the most viable sites.',
    },
    {
      key: 'view.travel',
      label: 'Travel network',
      type: 'bool',
      view: true,
      help: 'Roads, river routes and sea lanes between the cities and towns on show (the Location viability slider; zoomed far out only the cities). Roads avoid mountains, deserts and steep ground; boats follow the navigable rivers and sail between harbours and river mouths. A link is left out when a short detour over two cheaper links does the same job.',
    },
    {
      key: 'view.travelStyle',
      label: 'Travel routes',
      type: 'select',
      options: opt(['simple', 'Straight lines'], ['terrain', 'Follow the terrain']),
      view: true,
      help: 'Straight lines: one line per link, from place to place. Follow the terrain: roads wind along valleys and over the lowest passes (by estimated height and steepness), river routes follow the river and sea lanes go round the land.',
    },
    { key: 'view.regEdges', label: 'Region borders', type: 'bool', view: true },
    { key: 'view.zoneEdges', label: 'Elevation zone borders', type: 'bool', view: true },
    { key: 'view.subEdges', label: 'Subbiome borders', type: 'bool', view: true, help: 'Drawn when subbiomes are large enough on screen.' },
    { key: 'view.coast', label: 'Coastline', type: 'bool', view: true },
    { key: 'view.links', label: 'Ocean seeds & links', type: 'bool', view: true, help: 'Seeds (●linked ○lone) and the straight links between them.' },
    { key: 'view.growth', label: 'Growth arrows', type: 'bool', view: true, help: 'Arrow from each growing ocean elevation zone to the land elevation zones it converted.' },
    { key: 'view.mergeArrows', label: 'Merge arrows', type: 'bool', view: true, help: 'Arrow from each merged cell to the neighbour it joined.' },
    {
      key: 'view.sites',
      label: 'Sites',
      type: 'select',
      options: opt(['none', 'None'], ['regions', 'Regions'], ['elevationZones', 'Regions + elevation zones'], ['all', 'All levels']),
      view: true,
    },
    { key: 'view.grid', label: 'Kilometre grid', type: 'bool', view: true },
    { key: 'view.riverWidth', label: 'River width', type: 'number', min: 0.25, max: 4, step: 0.05, log: true, view: true, help: 'Scales the flow-based line width.' },
    {
      key: 'view.riverExp',
      label: 'Width exponent',
      type: 'number',
      min: 0.2,
      max: 1,
      step: 0.01,
      view: true,
      help: 'Width ∝ flow^b. ½ = real rivers (hydraulic geometry) and Leonardo’s rule; ⅓ = Murray’s law, flatter contrast; ¾ and up = trunks dominate. A flow of 100 keeps its width.',
    },
    { key: 'view.riverMin', label: 'Min river flow', type: 'int', min: 1, max: 200, log: true, view: true, help: 'Hide river segments that carry fewer attractors than this (prunes twigs).' },
    { key: 'view.riverSea', label: 'River paths over sea', type: 'bool', view: true, help: 'Roots sit at ocean elevation zone points, so each river first crosses the water to the coast. Off hides that stretch.' },
    { key: 'view.attractors', label: 'Attractor points', type: 'bool', view: true, help: 'Reached attractors in grey, unreached in red, river roots as rings.' },
    { key: 'view.lod', label: 'Detail', type: 'select', options: opt(['auto', 'Auto (skip sub-pixel cells)'], ['full', 'Always full detail']), view: true },
  ],
});

export const ALL_DEFS: ParamDef[] = [...SECTIONS.flatMap((s) => s.params), ...RIVER_SECTION.params, ...LAKE_SECTION.params, ...TERRAIN_SECTION.params, ...HILLSLOPE_SECTION.params, ...GRADIENT_SECTION.params, ...FLOODPLAIN_SECTION.params, ...CLIMATE_SECTIONS.flatMap((s) => s.params), ...PROSPERITY_SECTION.params, ...SUPERNATURAL_SECTION.params, ...BIOME_SECTION.params, ...LOCATION_SECTION.params, ...VIEW_SECTION.params];
withDefaults.checkAllUsed();
export const GEN_KEYS = new Set(SECTIONS.flatMap((s) => s.params.map((p) => p.key)).filter((k) => !RIVER_KEYS.has(k)));

/** Every parameter at its default value. */
export function defaults(): Params {
  return defaultsOf(ALL_DEFS);
}

/**
 * Schema → model parameters. Level sizes are kept strictly nested and at most 16×
 * apart (each parent scans its children on a local window of ~(5·ratio)² cells).
 */
export function toWorldParams(p: Params, seed: number): WorldParams {
  const regionSize = num(p, 'reg.size') * KM;
  const elevationZoneSize = Math.min(regionSize / 1.5, Math.max(regionSize / 16, num(p, 'ez.size') * KM));
  const subSize = Math.min(elevationZoneSize / 1.5, Math.max(elevationZoneSize / 16, num(p, 'sub.size') * KM));
  return {
    seed,
    regionSize,
    regionJitter: num(p, 'reg.jitter'),
    oceanMin: num(p, 'reg.oceanMin'),
    oceanMax: num(p, 'reg.oceanMax'),
    elevationZoneMergeMin: num(p, 'reg.mergeMin'),
    elevationZoneMergeMax: num(p, 'reg.mergeMax'),
    connectChance: num(p, 'oc.connect') / 100,
    doubleLinkChance: num(p, 'oc.double') / 100,
    connectRange: num(p, 'oc.range'),
    growWeights: [num(p, 'oc.g0'), num(p, 'oc.g1'), num(p, 'oc.g2'), num(p, 'oc.g3')],
    growFrom: str(p, 'oc.from') as GrowFrom,
    growPasses: num(p, 'oc.passes'),
    elevationZoneSize,
    elevationZoneJitter: num(p, 'ez.jitter'),
    elevationZoneWarp: num(p, 'ez.warp'),
    elevationZoneWarpFreq: num(p, 'ez.warpFreq'),
    mergeAcrossCoast: bool(p, 'ez.mergeCoast'),
    subMergeMin: num(p, 'ez.mergeMin'),
    subMergeMax: num(p, 'ez.mergeMax'),
    subSize,
    subJitter: num(p, 'sub.jitter'),
    subWarp: num(p, 'sub.warp'),
    subWarpFreq: num(p, 'sub.warpFreq'),
    nest: bool(p, 'sub.nest'),
  };
}

export interface Preset {
  id: string;
  label: string;
  seed?: string;
  params: Params;
}

export const PRESETS: Preset[] = [
  { id: 'spec', label: 'Spec defaults', params: {} },
  {
    id: 'archipelago',
    label: 'Archipelago',
    params: { 'reg.oceanMin': 1, 'reg.oceanMax': 3, 'oc.connect': 75, 'oc.g3': 30, 'oc.g2': 35, 'oc.g1': 25, 'oc.g0': 10, 'oc.from': 'all', 'oc.passes': 2 },
  },
  {
    id: 'continents',
    label: 'Continents',
    params: { 'reg.oceanMin': 0, 'reg.oceanMax': 1, 'oc.connect': 70, 'oc.range': 3, 'oc.passes': 3, 'oc.g3': 25, 'oc.g2': 40, 'oc.g1': 25, 'oc.g0': 10 },
  },
  { id: 'inland', label: 'Inland seas (no links)', params: { 'oc.connect': 0, 'oc.from': 'all', 'oc.passes': 2 } },
  { id: 'oceanic', label: 'Ocean world', params: { 'reg.oceanMin': 2, 'reg.oceanMax': 4, 'oc.connect': 90, 'oc.passes': 2, 'oc.from': 'all' } },
  { id: 'nowarp', label: 'Straight borders (no warp)', params: { 'ez.warp': 0, 'sub.warp': 0 } },
  { id: 'organic', label: 'Organic borders', params: { 'ez.warp': 0.7, 'ez.warpFreq': 0.45, 'sub.warp': 0.6, 'sub.warpFreq': 0.8 } },
  {
    id: 'grid',
    label: 'Square grid (jitter 0)',
    params: { 'reg.jitter': 0, 'ez.jitter': 0, 'sub.jitter': 0, 'ez.warp': 0, 'sub.warp': 0 },
  },
  { id: 'bigmerge', label: 'Heavy merging', params: { 'reg.mergeMin': 6, 'reg.mergeMax': 10, 'ez.mergeMin': 5, 'ez.mergeMax': 9 } },
  { id: 'flat', label: 'Independent levels (no nesting)', params: { 'sub.nest': false, 'view.color': 'hierarchy' } },
];
