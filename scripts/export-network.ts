/**
 * Export the travel network of sandbox4 at its default seed and settings
 * (sandboxes/sandbox4/defaults.json) as a graph in JSON:
 *
 *   nodes   the city and town locations on show          (fields: docs/network-structure.md)
 *   links   the roads, river routes and sea lanes between them
 *
 * Covers the four regions of docs/map-default-structure.json (lattice cells (−1, −1), (0, −1),
 * (−1, 0) and (0, 0), the "core") and the twelve regions around them: the 4 × 4 block of
 * lattice cells (−2 … 1, −2 … 1). A link is exported when both its ends lie in the block.
 *
 * The network is the one the sandbox draws with its default display settings: the locations
 * at or above the default Location viability (`view.locMin`), towns included. The network
 * itself needs no terrain (the travel grid estimates heights, and the locations and costs
 * read biomes at zone-typical heights). The biomes written to the file are the map's own,
 * at exact patch heights, as in docs/map-default-structure.json: the terrain tiles of the
 * block are computed for that, which is where the time goes.
 *
 * Run through scripts/export-network.mjs (`npm run export-network`), which loads this file
 * with Vite so the `@shared` alias and the JSON import resolve as they do in the app.
 */
import { seedFromText } from '@shared/core/hash';
import { num } from '@shared/params/schema';
import { DEFAULT_SEED, defaults, toBiomeParams, toClimateParams, toLakeParams, toLocationParams, toRiverParams, toTerrainParams, toWorldParams } from '../sandboxes/sandbox4/src/params';
import { Biomes, BIOMES } from '../sandboxes/sandbox4/src/world/biomes';
import { Climate } from '../sandboxes/sandbox4/src/world/climate';
import { Lakes } from '../sandboxes/sandbox4/src/world/lakes';
import { packKey } from '../sandboxes/sandbox4/src/world/level';
import { Locations, NAVIGABLE, type Location } from '../sandboxes/sandbox4/src/world/locations';
import { Rivers } from '../sandboxes/sandbox4/src/world/rivers';
import { Terrain } from '../sandboxes/sandbox4/src/world/terrain';
import { CELL, DETOUR, Travel, TRAVEL_MODES, TravelGrid, type TravelEdge, type TravelMode } from '../sandboxes/sandbox4/src/world/travel';
import { World, type Cell } from '../sandboxes/sandbox4/src/world/world';
import { ELEVATION_ZONE_TYPES } from '../sandboxes/sandbox4/src/world/zones';

/** Region lattice cells of docs/map-default-structure.json: the four that meet at the origin. */
const CORE: [number, number][] = [
  [-1, -1],
  [0, -1],
  [-1, 0],
  [0, 0],
];
/** Rings of neighbouring regions exported around the core. */
const MARGIN = 1;
/** A route is sampled at most this far apart (metres) to find the biomes it passes through. */
const SAMPLE = 250;

interface RegionOut {
  key: number;
  i: number;
  j: number;
  x: number;
  y: number;
  core: boolean;
  nodes: number;
}

interface NodeOut {
  /** key of the location's biome patch: the node id */
  key: number;
  region: number;
  core: boolean;
  kind: string;
  rank: number;
  score: number;
  x: number;
  y: number;
  biome: string;
  zoneType: string;
  coast: boolean;
  harbour: boolean;
  onRiver: boolean;
  navigable: boolean;
  features: string[];
}

interface LinkOut {
  id: number;
  a: number;
  b: number;
  mode: TravelMode;
  /** length of the route, metres */
  length: number;
  /** travel cost, km of open flat road */
  weight: number;
  /** the biome most of the route runs through */
  biome: string;
  major: boolean;
  /** metres of the route by kind of travel (only the kinds it uses) */
  modes: Partial<Record<TravelMode, number>>;
  /** metres of the route by biome, longest first */
  biomes: Record<string, number>;
}

export interface NetworkExport {
  /** the JSON document */
  text: string;
  regions: number;
  nodes: number;
  cities: number;
  links: number;
  byMode: Record<TravelMode, number>;
  /** connected components of the exported graph, and nodes without any link */
  components: number;
  isolated: number;
  /** land patches of nodes and routes whose biome rests on an estimated height, not the terrain's (expected 0) */
  estimated: number;
  /** links of the block's regions that leave the block (not exported) */
  outside: number;
}

const r0 = (v: number) => Math.round(v);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** `{"a":1,"b":2}` → `{ "a": 1, "b": 2 }` (keys and string values here hold no `,"` or `":`). */
const oneLine = (o: object) =>
  JSON.stringify(o)
    .replace(/,"/g, ', "')
    .replace(/":/g, '": ')
    .replace(/\{"/g, '{ "')
    .replace(/\}/g, ' }');

export function exportNetwork(): NetworkExport {
  const d = defaults();
  const seed = seedFromText(DEFAULT_SEED);
  const w = new World(toWorldParams(d, seed));
  const rv = new Rivers(w, toRiverParams(d, seed));
  const cl = new Climate(toClimateParams(d, seed));
  const t = new Terrain(w, rv, toTerrainParams(d));
  // the model: terrain-less biomes (zone-typical heights), as the lakes, locations and travel grid need them
  const bio = new Biomes(w, rv, cl, null, toBiomeParams(d));
  const lk = new Lakes(w, rv, bio, toLakeParams(d));
  const loc = new Locations(w, rv, lk, bio, cl, toLocationParams(d));
  // the travel grid only reads the terrain's parameters
  const grid = new TravelGrid(w, rv, lk, bio, t);
  // the biomes written out: the map's, at exact patch heights where the terrain is computed
  const mapBio = new Biomes(w, rv, cl, t, toBiomeParams(d));
  const minScore = num(d, 'view.locMin');
  const travel = new Travel(grid, loc, { minScore, citiesOnly: false });

  // ---- regions: the core and MARGIN rings around it, row by row
  const ci = CORE.map(([i]) => i);
  const cj = CORE.map(([, j]) => j);
  const coreKeys = new Set(CORE.map(([i, j]) => packKey(i, j)));
  const block: number[] = [];
  for (let j = Math.min(...cj) - MARGIN; j <= Math.max(...cj) + MARGIN; j++) for (let i = Math.min(...ci) - MARGIN; i <= Math.max(...ci) + MARGIN; i++) block.push(packKey(i, j));
  const inBlock = new Set(block);
  // exact patch heights come only from computed tiles: those of the block, all kept
  t.setNeeded(block.map((rk) => t.tileOf(rk)));
  for (const rk of block) t.get(rk);

  const estimated = new Set<number>();
  /** Biome id of a (merged) land patch as the map shows it. */
  const biomeOf = (patch: number): string => {
    // a route may leave the block for a stretch: that region's terrain is computed when first met
    const region = w.patchCell(patch).region;
    if (!t.peek(region)) t.get(region);
    const info = mapBio.ofPatch(patch);
    if (!info.ocean && !info.heightExact) estimated.add(patch);
    return BIOMES[info.biome].id;
  };

  // ---- nodes: the locations on show, region by region, best score first
  const nodes: NodeOut[] = [];
  const byKey = new Map<number, NodeOut>();
  const regions: RegionOut[] = block.map((rk) => {
    const r = w.region(rk);
    const shown = travel.shown(rk);
    for (const l of shown) {
      if (l.region !== rk) throw new Error(`location ${l.patch} of region ${rk} reports region ${l.region}`);
      if (byKey.has(l.patch)) throw new Error(`two locations in patch ${l.patch}`);
      const n: NodeOut = {
        key: l.patch,
        region: rk,
        core: coreKeys.has(rk),
        kind: l.kind,
        rank: l.rank,
        score: r1(l.score),
        x: r0(l.x),
        y: r0(l.y),
        biome: biomeOf(l.patch),
        zoneType: ELEVATION_ZONE_TYPES[l.zoneType].id,
        coast: l.coast,
        harbour: l.harbour,
        onRiver: l.onRiver,
        navigable: l.river >= NAVIGABLE,
        features: l.features,
      };
      nodes.push(n);
      byKey.set(n.key, n);
    }
    return { key: rk, i: r.i, j: r.j, x: r0(r.x), y: r0(r.y), core: coreKeys.has(rk), nodes: shown.length };
  });

  // ---- links: what the block's regions own, between two locations of the block
  const scratch = {} as Cell;
  /** metres of an edge's route by biome */
  const biomesAlong = (e: TravelEdge): Map<string, number> => {
    const m = new Map<string, number>();
    for (const part of e.parts) {
      const p = part.pts;
      for (let t = 2; t < p.length; t += 2) {
        const ax = p[t - 2];
        const ay = p[t - 1];
        const dx = p[t] - ax;
        const dy = p[t + 1] - ay;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) continue;
        const n = Math.max(1, Math.ceil(len / SAMPLE));
        for (let s = 0; s < n; s++) {
          const f = (s + 0.5) / n;
          const c = w.cellAt(ax + dx * f, ay + dy * f, true, scratch);
          const id = c.ocean ? 'ocean' : biomeOf(c.patch);
          m.set(id, (m.get(id) ?? 0) + len / n);
        }
      }
    }
    return m;
  };
  const partLength = (pts: Float64Array): number => {
    let len = 0;
    for (let t = 2; t < pts.length; t += 2) len += Math.sqrt((pts[t] - pts[t - 2]) * (pts[t] - pts[t - 2]) + (pts[t + 1] - pts[t - 1]) * (pts[t + 1] - pts[t - 1]));
    return len;
  };

  const found: { e: TravelEdge; a: Location; b: Location }[] = [];
  let outside = 0;
  for (const rk of block) {
    for (const e of travel.get(rk).edges) {
      if (!inBlock.has(e.a.region) || !inBlock.has(e.b.region)) {
        outside++;
        continue;
      }
      if (!byKey.has(e.a.patch) || !byKey.has(e.b.patch)) throw new Error(`link ${e.a.patch} – ${e.b.patch} ends at a location that is not a node`);
      // from the smaller key to the larger
      found.push(e.a.patch < e.b.patch ? { e, a: e.a, b: e.b } : { e, a: e.b, b: e.a });
    }
  }
  found.sort((p, q) => p.a.patch - q.a.patch || p.b.patch - q.b.patch || TRAVEL_MODES.indexOf(p.e.mode) - TRAVEL_MODES.indexOf(q.e.mode));

  const byMode: Record<TravelMode, number> = { road: 0, river: 0, sea: 0 };
  const links: LinkOut[] = found.map(({ e, a, b }, id) => {
    byMode[e.mode]++;
    const modes: Partial<Record<TravelMode, number>> = {};
    for (const mode of TRAVEL_MODES) {
      const len = e.parts.filter((p) => p.mode === mode).reduce((s, p) => s + partLength(p.pts), 0);
      if (len > 0) modes[mode] = r0(len);
    }
    const along = [...biomesAlong(e)].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1));
    const biomes: Record<string, number> = {};
    for (const [id2, len] of along) if (r0(len) > 0) biomes[id2] = r0(len);
    return { id, a: a.patch, b: b.patch, mode: e.mode, length: r0(e.length), weight: r1(e.cost), biome: along[0][0], major: e.major, modes, biomes };
  });

  // ---- connectivity of what is exported
  const parent = new Map<number, number>();
  const find = (k: number): number => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  for (const n of nodes) parent.set(n.key, n.key);
  const linked = new Set<number>();
  for (const l of links) {
    parent.set(find(l.a), find(l.b));
    linked.add(l.a);
    linked.add(l.b);
  }
  const components = new Set(nodes.map((n) => find(n.key))).size;
  const isolated = nodes.filter((n) => !linked.has(n.key)).length;

  // ---- pretty JSON, one region, node and link per line
  const comma = (n: number, len: number) => (n < len - 1 ? ',' : '');
  const list = (name: string, items: object[], last = false) => [`  "${name}": [`, ...items.map((o, n) => `    ${oneLine(o)}${comma(n, items.length)}`), last ? '  ]' : '  ],'];
  const lines: string[] = [
    '{',
    `  "seed": ${JSON.stringify(DEFAULT_SEED)},`,
    '  "units": { "distance": "m", "length": "m", "weight": "km of open flat road" },',
    `  "settings": ${oneLine({ minScore, citiesOnly: false, cell: CELL, detour: DETOUR })},`,
    ...list('regions', regions),
    ...list('nodes', nodes),
    ...list('links', links, true),
    '}',
  ];
  const text = lines.join('\n') + '\n';
  JSON.parse(text);

  return { text, regions: regions.length, nodes: nodes.length, cities: nodes.filter((n) => n.kind === 'city').length, links: links.length, byMode, components, isolated, estimated: estimated.size, outside };
}
