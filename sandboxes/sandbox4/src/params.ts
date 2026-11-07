import { bool, defaultsOf, num, opt, str, type ParamDef, type Params, type Section } from '@shared/params/schema';
import type { ConeAngle, PullPower, RiverParams } from './world/rivers';
import type { TerrainParams, Theta } from './world/terrain';
import type { GrowFrom, WorldParams } from './world/world';

const KM = 1000;

/** Generation parameters (left panel). Sizes are in km in the UI, metres in the model. */
export const SECTIONS: Section[] = [
  {
    id: 'regions',
    title: 'Regions · large cells',
    open: true,
    help: 'Plain Voronoi cells (no warp). A region owns the biomes whose site lies inside it and decides how many of them become ocean seeds and how many merge.',
    params: [
      { key: 'reg.size', label: 'Grid size', type: 'number', min: 32, max: 512, step: 1, default: 128, log: true, unit: ' km' },
      { key: 'reg.jitter', label: 'Jitter', type: 'number', min: 0, max: 1, step: 0.01, default: 1, help: 'How far a site may move from its lattice cell centre. 0 = a square grid.' },
      { key: 'reg.oceanMin', label: 'Ocean seeds min', type: 'int', min: 0, max: 4, default: 0, help: 'Ocean seed biomes per region: a uniform count in [min, max].' },
      { key: 'reg.oceanMax', label: 'Ocean seeds max', type: 'int', min: 0, max: 4, default: 2 },
      { key: 'reg.mergeMin', label: 'Biome merges min', type: 'int', min: 0, max: 12, default: 2, help: 'Biomes per region that join their nearest neighbour: a uniform count in [min, max].' },
      { key: 'reg.mergeMax', label: 'Biome merges max', type: 'int', min: 0, max: 12, default: 4 },
    ],
  },
  {
    id: 'oceans',
    title: 'Oceans',
    open: true,
    help: 'Seeds → links → growth. A linked seed turns every biome on the straight line to its nearest other seed (or two nearest, with a double link) into ocean; linked ocean biomes then convert some of their closest land neighbours.',
    params: [
      { key: 'oc.connect', label: 'Link chance', type: 'int', min: 0, max: 100, default: 40, unit: '%', help: 'Chance that an ocean seed links to its nearest other ocean seed.' },
      {
        key: 'oc.double',
        label: 'Double link chance',
        type: 'int',
        min: 0,
        max: 100,
        default: 5,
        unit: '%',
        help: 'Chance that an ocean seed links to its two nearest other seeds instead of one. Checked before the link chance, so it applies to every seed.',
      },
      { key: 'oc.range', label: 'Link search', type: 'int', min: 1, max: 3, default: 2, unit: ' reg', help: 'How many regions away a seed looks for its nearest other seed.' },
      { key: 'oc.g3', label: 'Grow 3 nbrs', type: 'int', min: 0, max: 100, default: 10, unit: '%', help: 'Chance that a growing ocean biome converts its 3 closest land neighbours. The four chances are normalised.' },
      { key: 'oc.g2', label: 'Grow 2 nbrs', type: 'int', min: 0, max: 100, default: 33, unit: '%' },
      { key: 'oc.g1', label: 'Grow 1 nbr', type: 'int', min: 0, max: 100, default: 33, unit: '%' },
      { key: 'oc.g0', label: 'Grow 0 nbrs', type: 'int', min: 0, max: 100, default: 23, unit: '%' },
      {
        key: 'oc.from',
        label: 'Grow from',
        type: 'select',
        default: 'connected',
        options: opt(['connected', 'Linked ocean biomes'], ['all', 'All ocean biomes']),
        help: 'Which ocean biomes grow in the first pass. "Linked" (the spec) leaves lone seeds as single-biome seas.',
      },
      { key: 'oc.passes', label: 'Growth passes', type: 'int', min: 0, max: 4, default: 1, help: 'Later passes grow from the biomes converted in the previous pass.' },
    ],
  },
  {
    id: 'biomes',
    title: 'Biomes · medium cells',
    open: true,
    help: 'Warped Voronoi cells: the ocean/land unit, and the unit for factions. A biome owns the subbiomes whose site lies inside it.',
    params: [
      { key: 'bio.size', label: 'Grid size', type: 'number', min: 8, max: 128, step: 1, default: 32, log: true, unit: ' km' },
      { key: 'bio.jitter', label: 'Jitter', type: 'number', min: 0, max: 1, step: 0.01, default: 1 },
      { key: 'bio.warp', label: 'Border warp', type: 'number', min: 0, max: 1, step: 0.01, default: 0.35, help: 'Amplitude of the border warp, in cell sizes.' },
      { key: 'bio.warpFreq', label: 'Warp frequency', type: 'number', min: 0.1, max: 4, step: 0.01, default: 0.6, log: true, help: 'Warp noise cycles per cell. Low = gently bent borders, high = wiggly borders.' },
      { key: 'bio.mergeMin', label: 'Subbiome merges min', type: 'int', min: 0, max: 12, default: 2, help: 'Subbiomes per biome that join their nearest neighbour in the same biome.' },
      { key: 'bio.mergeMax', label: 'Subbiome merges max', type: 'int', min: 0, max: 12, default: 4 },
      { key: 'bio.mergeCoast', label: 'Merge across coast', type: 'bool', default: false, help: 'Allow a land biome to merge into an ocean biome (and vice versa). Off keeps coastlines intact.' },
    ],
  },
  {
    id: 'subs',
    title: 'Subbiomes · small cells',
    open: true,
    help: 'Warped Voronoi cells for detail: sub-biomes, cities and towns, ore deposits, competing factions.',
    params: [
      { key: 'sub.size', label: 'Grid size', type: 'number', min: 2, max: 32, step: 0.1, default: 8, log: true, unit: ' km' },
      { key: 'sub.jitter', label: 'Jitter', type: 'number', min: 0, max: 1, step: 0.01, default: 1 },
      { key: 'sub.warp', label: 'Border warp', type: 'number', min: 0, max: 1, step: 0.01, default: 0.35 },
      { key: 'sub.warpFreq', label: 'Warp frequency', type: 'number', min: 0.1, max: 4, step: 0.01, default: 0.6, log: true },
      {
        key: 'sub.nest',
        label: 'Nest levels',
        type: 'bool',
        default: true,
        help: 'Classify every point through its subbiome: biome and region borders (and coasts) then follow subbiome cells. Off = each level is looked up at the point itself.',
      },
    ],
  },
];

/**
 * River parameters (left panel). Rivers are computed per region on top of the world,
 * so changing them never regenerates the map itself.
 */
export const RIVER_SECTION: Section = {
  id: 'rivers',
  title: 'Rivers · space colonization',
  enableKey: 'riv.on',
  open: true,
  help: 'Per region: a root at the point of every ocean biome touching the region, attractors in every inland (non-coastal) land subbiome, then space colonization until every attractor is reached. Width = attractors reached upstream.',
  params: [
    { key: 'riv.on', label: 'Rivers', type: 'bool', default: true },
    { key: 'riv.points', label: 'Attractors / subbiome', type: 'int', min: 1, max: 30, default: 10, help: 'Attraction points scattered inside every inland land subbiome.' },
    { key: 'riv.step', label: 'Step D', type: 'number', min: 0.5, max: 8, step: 0.1, default: 2, log: true, unit: ' km', help: 'Length of one growth step (segment length).' },
    {
      key: 'riv.influence',
      label: 'Influence dᵢ',
      type: 'number',
      min: 2,
      max: 256,
      step: 0.5,
      default: 16,
      log: true,
      unit: ' km',
      help: 'An attractor pulls on its nearest node only within this radius. Small = many independent branches; large = fewer, straighter rivers.',
    },
    { key: 'riv.kill', label: 'Kill dₖ', type: 'number', min: 0.5, max: 16, step: 0.1, default: 3, log: true, unit: ' km', help: 'An attractor is reached (removed) once a node is this close. Kept above the step D.' },
    {
      key: 'riv.jitter',
      label: 'Random motion',
      type: 'number',
      min: 0,
      max: 2,
      step: 0.01,
      default: 0.4,
      help: 'Weight of a random unit vector added to every growth direction. 0 = straight, smooth branches; 1 = strongly meandering.',
    },
    {
      key: 'riv.pull',
      label: 'Pull power',
      type: 'select',
      default: 'normal',
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
      default: 0,
      help: 'Weight of the direction a river already runs in, blended into every step. 0 = off; higher = longer straight reaches and wider bends.',
    },
    {
      key: 'riv.cone',
      label: 'Perception cone',
      type: 'select',
      default: '0',
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
      default: 0,
      help: 'How much each step’s random motion carries over from the previous one. 0 = fresh every step (wiggle); towards 1 = long, coherent bends. Needs some random motion.',
    },
    {
      key: 'riv.apical',
      label: 'Main-stem dominance',
      type: 'number',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      help: 'A side branch only sprouts when its pull is at least this fraction of the pull on the main stem it leaves. 0 = off; higher = dominant trunks, fewer short tributaries.',
    },
    { key: 'riv.coast', label: 'Skip coast subbiomes', type: 'bool', default: true, help: 'No attractors in subbiomes that touch the ocean (the spec).' },
  ],
};
export const RIVER_KEYS = new Set(RIVER_SECTION.params.map((p) => p.key));

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
export const TERRAIN_SECTION: Section = {
  id: 'terrain',
  title: 'Terrain · height map',
  open: true,
  help: 'Fitted to the map: river beds rise upstream by the stream-power law, hillslopes rise from rivers and coast (steepness per land type), ridges divide regions and river systems, then detail noise, the rivers are burnt in and pits are filled so everything drains to the sea.',
  params: [
    {
      key: 'hgt.res',
      label: 'Resolution',
      type: 'select',
      default: '1000',
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
      default: 0.02,
      log: true,
      help: 'River gradient where the flow is one attractor; bigger rivers are flatter (S = S₀·flow^−θ). The main knob for overall relief.',
    },
    {
      key: 'hgt.theta',
      label: 'Concavity θ',
      type: 'select',
      default: '0.4375',
      options: opt(['0.375', '⅜ (straighter profiles)'], ['0.4375', '7⁄16 (≈ 0.45, typical)'], ['0.5', '½ (more concave)']),
      help: 'How fast rivers flatten downstream as flow grows.',
    },
    { key: 'hgt.hill', label: 'Hillslope steepness', type: 'number', min: 0.25, max: 4, step: 0.05, default: 1, log: true, help: 'Multiplier on the hillslope of every land type (hills 0.15, marsh 0.01, …).' },
    { key: 'hgt.valley', label: 'Floodplain width', type: 'number', min: 0, max: 200, step: 1, default: 40, unit: ' m', help: 'Flat valley floor half-width per √flow (a flow of 400 → 20× this).' },
    { key: 'hgt.relief', label: 'Mountain belts', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5, help: 'Strength of a slow, region-scale relief field that makes several neighbouring biomes rugged or flat together.' },
    { key: 'hgt.ridge', label: 'Region ridge', type: 'number', min: 0, max: 400, step: 5, default: 80, unit: ' m', help: 'Ridge along region borders (rivers never cross them). Fades out near rivers.' },
    { key: 'hgt.divide', label: 'Basin divides', type: 'number', min: 0, max: 300, step: 5, default: 30, unit: ' m', help: 'Extra height where the basins of two different river systems meet.' },
    { key: 'hgt.noise', label: 'Detail noise', type: 'number', min: 0, max: 3, step: 0.05, default: 1, help: 'Multiplier on the noise amplitude of every land type; masked to zero on the river beds.' },
    { key: 'hgt.burn', label: 'Channel depth', type: 'number', min: 0, max: 20, step: 0.5, default: 3, unit: ' m', help: 'How deep the rivers are burnt below their bed profile.' },
    { key: 'hgt.sea', label: 'Sea depth', type: 'number', min: 0, max: 2000, step: 10, default: 300, unit: ' m', help: 'Ocean depth 40 km and more from the coast.' },
  ],
};
export const TERRAIN_KEYS = new Set(TERRAIN_SECTION.params.map((p) => p.key));

export function toTerrainParams(p: Params): TerrainParams {
  return {
    res: Number(str(p, 'hgt.res')),
    chSlope: num(p, 'hgt.chSlope'),
    theta: Number(str(p, 'hgt.theta')) as Theta,
    hill: num(p, 'hgt.hill'),
    valley: num(p, 'hgt.valley'),
    relief: num(p, 'hgt.relief'),
    ridge: num(p, 'hgt.ridge'),
    divide: num(p, 'hgt.divide'),
    noise: num(p, 'hgt.noise'),
    burn: num(p, 'hgt.burn'),
    sea: num(p, 'hgt.sea'),
  };
}

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
export const VIEW_SECTION: Section = {
  id: 'view',
  title: 'Display',
  open: true,
  params: [
    { key: 'view.color', label: 'Colour by', type: 'select', default: 'map', options: opt(...VIEW_MODES), view: true },
    {
      key: 'view.3d',
      label: '3D landscape',
      type: 'bool',
      default: false,
      view: true,
      help: 'Show the current view as a 3D landscape, draped with the map (rivers and borders included). Drag to orbit, scroll to zoom, Shift/right-drag to pan.',
    },
    { key: 'view.exag', label: 'Vertical exaggeration', type: 'number', min: 1, max: 60, step: 0.5, default: 12, log: true, view: true, help: '3D only: heights are this many times taller than true scale.' },
    { key: 'view.hillshade', label: 'Hillshade', type: 'bool', default: false, view: true, help: 'Shade any colour mode by the height map (lit from the north-west). Always on for “Height”.' },
    { key: 'view.regEdges', label: 'Region borders', type: 'bool', default: true, view: true },
    { key: 'view.bioEdges', label: 'Biome borders', type: 'bool', default: true, view: true },
    { key: 'view.subEdges', label: 'Subbiome borders', type: 'bool', default: true, view: true, help: 'Drawn when subbiomes are large enough on screen.' },
    { key: 'view.coast', label: 'Coastline', type: 'bool', default: true, view: true },
    { key: 'view.links', label: 'Ocean seeds & links', type: 'bool', default: false, view: true, help: 'Seeds (●linked ○lone) and the straight links between them.' },
    { key: 'view.growth', label: 'Growth arrows', type: 'bool', default: false, view: true, help: 'Arrow from each growing ocean biome to the land biomes it converted.' },
    { key: 'view.mergeArrows', label: 'Merge arrows', type: 'bool', default: false, view: true, help: 'Arrow from each merged cell to the neighbour it joined.' },
    {
      key: 'view.sites',
      label: 'Sites',
      type: 'select',
      default: 'none',
      options: opt(['none', 'None'], ['regions', 'Regions'], ['biomes', 'Regions + biomes'], ['all', 'All levels']),
      view: true,
    },
    { key: 'view.grid', label: 'Kilometre grid', type: 'bool', default: false, view: true },
    { key: 'view.riverWidth', label: 'River width', type: 'number', min: 0.25, max: 4, step: 0.05, default: 1, log: true, view: true, help: 'Scales the flow-based line width.' },
    {
      key: 'view.riverExp',
      label: 'Width exponent',
      type: 'number',
      min: 0.2,
      max: 1,
      step: 0.01,
      default: 0.5,
      view: true,
      help: 'Width ∝ flow^b. ½ = real rivers (hydraulic geometry) and Leonardo’s rule; ⅓ = Murray’s law, flatter contrast; ¾ and up = trunks dominate. A flow of 100 keeps its width.',
    },
    { key: 'view.riverMin', label: 'Min river flow', type: 'int', min: 1, max: 200, default: 1, log: true, view: true, help: 'Hide river segments that carry fewer attractors than this (prunes twigs).' },
    { key: 'view.riverSea', label: 'River paths over sea', type: 'bool', default: false, view: true, help: 'Roots sit at ocean biome points, so each river first crosses the water to the coast. Off hides that stretch.' },
    { key: 'view.attractors', label: 'Attractor points', type: 'bool', default: false, view: true, help: 'Reached attractors in grey, unreached in red, river roots as rings.' },
    { key: 'view.lod', label: 'Detail', type: 'select', default: 'auto', options: opt(['auto', 'Auto (skip sub-pixel cells)'], ['full', 'Always full detail']), view: true },
  ],
};

export const ALL_DEFS: ParamDef[] = [...SECTIONS.flatMap((s) => s.params), ...RIVER_SECTION.params, ...TERRAIN_SECTION.params, ...VIEW_SECTION.params];
export const GEN_KEYS = new Set(SECTIONS.flatMap((s) => s.params.map((p) => p.key)));

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
