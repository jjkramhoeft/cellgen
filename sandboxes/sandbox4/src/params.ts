/** Sandbox 4 parameter schema (panels and URL state), presets, and its mapping to the World, Rivers and Terrain parameters. */
import { bindDefaults, bool, defaultsOf, num, opt, str, type ParamDef, type Params, type Section } from '@shared/params/schema';
import type { ConeAngle, PullPower, RiverParams } from './world/rivers';
import { FLOOD_REF_FLOW, type TerrainParams, type Theta } from './world/terrain';
import { LAND_TYPES } from './render/source';
import type { GrowFrom, WorldParams } from './world/world';
import DEFAULTS from '../defaults.json';

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
    help: 'Plain Voronoi cells (no warp). A region owns the biomes whose site lies inside it and decides how many of them become ocean seeds and how many merge.',
    params: [
      { key: 'reg.size', label: 'Grid size', type: 'number', min: 32, max: 512, step: 1, log: true, unit: ' km' },
      { key: 'reg.jitter', label: 'Jitter', type: 'number', min: 0, max: 1, step: 0.01, help: 'How far a site may move from its lattice cell centre. 0 = a square grid.' },
      { key: 'reg.oceanMin', label: 'Ocean seeds min', type: 'int', min: 0, max: 4, help: 'Ocean seed biomes per region: a uniform count in [min, max].' },
      { key: 'reg.oceanMax', label: 'Ocean seeds max', type: 'int', min: 0, max: 4 },
      { key: 'reg.mergeMin', label: 'Biome merges min', type: 'int', min: 0, max: 12, help: 'Biomes per region that join their nearest neighbour: a uniform count in [min, max].' },
      { key: 'reg.mergeMax', label: 'Biome merges max', type: 'int', min: 0, max: 12 },
    ],
  },
  {
    id: 'oceans',
    title: 'Oceans',
    open: true,
    help: 'Seeds → links → growth. A linked seed turns every biome on the straight line to its nearest other seed (or two nearest, with a double link) into ocean; linked ocean biomes then convert some of their closest land neighbours.',
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
      { key: 'oc.g3', label: 'Grow 3 nbrs', type: 'int', min: 0, max: 100, unit: '%', help: 'Chance that a growing ocean biome converts its 3 closest land neighbours. The four chances are normalised.' },
      { key: 'oc.g2', label: 'Grow 2 nbrs', type: 'int', min: 0, max: 100, unit: '%' },
      { key: 'oc.g1', label: 'Grow 1 nbr', type: 'int', min: 0, max: 100, unit: '%' },
      { key: 'oc.g0', label: 'Grow 0 nbrs', type: 'int', min: 0, max: 100, unit: '%' },
      {
        key: 'oc.from',
        label: 'Grow from',
        type: 'select',
        options: opt(['connected', 'Linked ocean biomes'], ['all', 'All ocean biomes']),
        help: 'Which ocean biomes grow in the first pass. "Linked" (the spec) leaves lone seeds as single-biome seas.',
      },
      { key: 'oc.passes', label: 'Growth passes', type: 'int', min: 0, max: 4, help: 'Later passes grow from the biomes converted in the previous pass.' },
    ],
  },
  {
    id: 'biomes',
    title: 'Biomes · medium cells',
    open: true,
    help: 'Warped Voronoi cells: the ocean/land unit, and the unit for factions. A biome owns the subbiomes whose site lies inside it.',
    params: [
      { key: 'bio.size', label: 'Grid size', type: 'number', min: 8, max: 128, step: 1, log: true, unit: ' km' },
      { key: 'bio.jitter', label: 'Jitter', type: 'number', min: 0, max: 1, step: 0.01 },
      { key: 'bio.warp', label: 'Border warp', type: 'number', min: 0, max: 1, step: 0.01, help: 'Amplitude of the border warp, in cell sizes.' },
      { key: 'bio.warpFreq', label: 'Warp frequency', type: 'number', min: 0.1, max: 4, step: 0.01, log: true, help: 'Warp noise cycles per cell. Low = gently bent borders, high = wiggly borders.' },
      { key: 'bio.mergeMin', label: 'Subbiome merges min', type: 'int', min: 0, max: 12, help: 'Subbiomes per biome that join their nearest neighbour in the same biome.' },
      { key: 'bio.mergeMax', label: 'Subbiome merges max', type: 'int', min: 0, max: 12 },
      { key: 'bio.mergeCoast', label: 'Merge across coast', type: 'bool', help: 'Allow a land biome to merge into an ocean biome (and vice versa). Off keeps coastlines intact.' },
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
        help: 'Classify every point through its subbiome: biome and region borders (and coasts) then follow subbiome cells. Off = each level is looked up at the point itself.',
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
  help: 'Per region: a root at the point of every ocean biome touching the region, attractors in every inland (non-coastal) land subbiome, then space colonization until every attractor is reached. Width = attractors reached upstream.',
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
export const RIVER_KEYS = new Set(RIVER_SECTION.params.map((p) => p.key));

/** Schema → model parameters for Rivers. */
export function toRiverParams(p: Params): RiverParams {
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
    maxHops: 4,
  };
}

/**
 * Height-map parameters (left panel). The terrain is computed per region on top of the
 * map and the rivers, only while a view needs it (height colours, hillshade or 3D).
 */
export const TERRAIN_SECTION: Section = withDefaults.section({
  id: 'terrain',
  title: 'Terrain · height map',
  open: true,
  help: 'Fitted to the map: river beds rise upstream by the stream-power law, hillslopes rise from rivers and coast (steepness per land type), ridges divide regions and river systems, then detail noise, the rivers are burnt in and pits are filled so everything drains to the sea.',
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
    { key: 'hgt.hill', label: 'Hillslope steepness', type: 'number', min: 0.05, max: 4, step: 0.05, log: true, help: 'Multiplier on the hillslope of every land type (set per type under "hillslope by land type").' },
    {
      key: 'hgt.level',
      label: 'Level flat biomes',
      type: 'number',
      min: 0,
      max: 1,
      step: 0.05,
      help: 'A biome whose river gradient is below 1 sits at one level: the rivers entering it are lowered towards its lowest entry (to the level at gradient 0), cutting gorges through the steeper land downstream. 0 = off: every river keeps the height it climbed to elsewhere.',
    },
    { key: 'hgt.relief', label: 'Mountain belts', type: 'number', min: 0, max: 1, step: 0.01, help: 'Strength of a slow, region-scale relief field that makes several neighbouring biomes rugged or flat together.' },
    { key: 'hgt.ridge', label: 'Region ridge', type: 'number', min: 0, max: 400, step: 5, unit: ' m', help: 'Ridge along region borders (rivers never cross them). Fades out near rivers.' },
    { key: 'hgt.divide', label: 'Basin divides', type: 'number', min: 0, max: 300, step: 5, unit: ' m', help: 'Extra height where the basins of two different river systems meet.' },
    { key: 'hgt.noise', label: 'Detail noise', type: 'number', min: 0, max: 3, step: 0.05, help: 'Multiplier on the noise amplitude of every land type; masked to zero on the river beds.' },
    { key: 'hgt.burn', label: 'Channel depth', type: 'number', min: 0, max: 20, step: 0.5, unit: ' m', help: 'How deep the rivers are burnt below their bed profile.' },
    { key: 'hgt.sea', label: 'Sea depth', type: 'number', min: 0, max: 2000, step: 10, unit: ' m', help: 'Ocean depth 40 km and more from the coast.' },
  ],
});

/** URL/param key of a land type's river gradient factor, e.g. 'hgt.ch.oldforest'. */
export const chanKey = (name: string) => `hgt.ch.${name.toLowerCase().replace(/[^a-z]/g, '')}`;

/** How fast the river bed rises upstream in each land type (factor on S₀). */
export const GRADIENT_SECTION: Section = withDefaults.section({
  id: 'gradient',
  title: 'Terrain · river gradient by land type',
  open: false,
  help: 'Factor on the channel slope S₀ where a river runs through each land type: how fast the river bed rises upstream (never steeper than the land type’s hillslope). 0 = flat: with "Level flat biomes" the whole biome sits at the level of its lowest river entry; below 1 it is levelled partly.',
  params: LAND_TYPES.map((t, i) => ({
    key: chanKey(t.name),
    label: t.name,
    type: 'number' as const,
    min: 0,
    max: 5,
    step: 0.05,
  })),
});

/** URL/param key of a land type’s hillslope steepness, e.g. 'hgt.hs.oldforest'. */
export const hillKey = (name: string) => `hgt.hs.${name.toLowerCase().replace(/[^a-z]/g, '')}`;

/** How steeply the land rises away from rivers and the coast in each land type. */
export const HILLSLOPE_SECTION: Section = withDefaults.section({
  id: 'hillslope',
  title: 'Terrain · hillslope by land type',
  open: false,
  help: 'How steeply the land rises away from its rivers and the coast (metres per metre, × "Hillslope steepness" and the mountain belts). Low values make flat plains, high values rugged hills.',
  params: LAND_TYPES.map((t, i) => ({
    key: hillKey(t.name),
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
    hillType: LAND_TYPES.map((t) => num(p, hillKey(t.name))),
    level: num(p, 'hgt.level'),
    chanFactor: LAND_TYPES.map((t) => num(p, chanKey(t.name))),
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

/** Colour modes: [id, label]. */
export const VIEW_MODES = [
  ['map', 'Map (cosmetic biomes)'],
  ['landsea', 'Land & ocean'],
  ['genesis', 'Ocean genesis'],
  ['merges', 'Merged cells'],
  ['regions', 'Regions'],
  ['biomes', 'Biomes'],
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
    { key: 'view.regEdges', label: 'Region borders', type: 'bool', view: true },
    { key: 'view.bioEdges', label: 'Biome borders', type: 'bool', view: true },
    { key: 'view.subEdges', label: 'Subbiome borders', type: 'bool', view: true, help: 'Drawn when subbiomes are large enough on screen.' },
    { key: 'view.coast', label: 'Coastline', type: 'bool', view: true },
    { key: 'view.links', label: 'Ocean seeds & links', type: 'bool', view: true, help: 'Seeds (●linked ○lone) and the straight links between them.' },
    { key: 'view.growth', label: 'Growth arrows', type: 'bool', view: true, help: 'Arrow from each growing ocean biome to the land biomes it converted.' },
    { key: 'view.mergeArrows', label: 'Merge arrows', type: 'bool', view: true, help: 'Arrow from each merged cell to the neighbour it joined.' },
    {
      key: 'view.sites',
      label: 'Sites',
      type: 'select',
      options: opt(['none', 'None'], ['regions', 'Regions'], ['biomes', 'Regions + biomes'], ['all', 'All levels']),
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
    { key: 'view.riverSea', label: 'River paths over sea', type: 'bool', view: true, help: 'Roots sit at ocean biome points, so each river first crosses the water to the coast. Off hides that stretch.' },
    { key: 'view.attractors', label: 'Attractor points', type: 'bool', view: true, help: 'Reached attractors in grey, unreached in red, river roots as rings.' },
    { key: 'view.lod', label: 'Detail', type: 'select', options: opt(['auto', 'Auto (skip sub-pixel cells)'], ['full', 'Always full detail']), view: true },
  ],
});

export const ALL_DEFS: ParamDef[] = [...SECTIONS.flatMap((s) => s.params), ...RIVER_SECTION.params, ...TERRAIN_SECTION.params, ...HILLSLOPE_SECTION.params, ...GRADIENT_SECTION.params, ...FLOODPLAIN_SECTION.params, ...VIEW_SECTION.params];
withDefaults.checkAllUsed();
export const GEN_KEYS = new Set(SECTIONS.flatMap((s) => s.params.map((p) => p.key)));

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
  const biomeSize = Math.min(regionSize / 1.5, Math.max(regionSize / 16, num(p, 'bio.size') * KM));
  const subSize = Math.min(biomeSize / 1.5, Math.max(biomeSize / 16, num(p, 'sub.size') * KM));
  return {
    seed,
    regionSize,
    regionJitter: num(p, 'reg.jitter'),
    oceanMin: num(p, 'reg.oceanMin'),
    oceanMax: num(p, 'reg.oceanMax'),
    biomeMergeMin: num(p, 'reg.mergeMin'),
    biomeMergeMax: num(p, 'reg.mergeMax'),
    connectChance: num(p, 'oc.connect') / 100,
    doubleLinkChance: num(p, 'oc.double') / 100,
    connectRange: num(p, 'oc.range'),
    growWeights: [num(p, 'oc.g0'), num(p, 'oc.g1'), num(p, 'oc.g2'), num(p, 'oc.g3')],
    growFrom: str(p, 'oc.from') as GrowFrom,
    growPasses: num(p, 'oc.passes'),
    biomeSize,
    biomeJitter: num(p, 'bio.jitter'),
    biomeWarp: num(p, 'bio.warp'),
    biomeWarpFreq: num(p, 'bio.warpFreq'),
    mergeAcrossCoast: bool(p, 'bio.mergeCoast'),
    subMergeMin: num(p, 'bio.mergeMin'),
    subMergeMax: num(p, 'bio.mergeMax'),
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
  { id: 'nowarp', label: 'Straight borders (no warp)', params: { 'bio.warp': 0, 'sub.warp': 0 } },
  { id: 'organic', label: 'Organic borders', params: { 'bio.warp': 0.7, 'bio.warpFreq': 0.45, 'sub.warp': 0.6, 'sub.warpFreq': 0.8 } },
  {
    id: 'grid',
    label: 'Square grid (jitter 0)',
    params: { 'reg.jitter': 0, 'bio.jitter': 0, 'sub.jitter': 0, 'bio.warp': 0, 'sub.warp': 0 },
  },
  { id: 'bigmerge', label: 'Heavy merging', params: { 'reg.mergeMin': 6, 'reg.mergeMax': 10, 'bio.mergeMin': 5, 'bio.mergeMax': 9 } },
  { id: 'flat', label: 'Independent levels (no nesting)', params: { 'sub.nest': false, 'view.color': 'hierarchy' } },
];
