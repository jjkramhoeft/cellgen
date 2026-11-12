/**
 * Export the map structure of sandbox4 at its default seed and settings
 * (sandboxes/sandbox4/defaults.json) as nested JSON:
 *
 *   Region → ElevationZone → BiomePatch        (fields: docs/map-structure.md)
 *
 * Covers the four regions that meet at the map origin: lattice cells (−1, −1), (0, −1),
 * (−1, 0) and (0, 0). Cells are listed after merging: a merged zone or patch appears once,
 * under the cell the others merged into, and a zone under the region holding that cell's
 * site. Heights are exact (the terrain tiles of the four regions are computed first).
 *
 * Every biome patch lists its resources (world/resources.ts), read on the same exact-height
 * biomes, so they fit the biome and climate written next to them; every land elevation zone
 * names the bedrock that places its deposits, and every patch the prosperity that sets how
 * often its precious metals, gems and luxuries turn up.
 *
 * Run through scripts/export-map.mjs (`npm run export-map`), which loads this file with
 * Vite so the `@shared` alias and the JSON import resolve as they do in the app.
 */
import { seedFromText } from '@shared/core/hash';
import { DEFAULT_SEED, defaults, toBiomeParams, toClimateParams, toLakeParams, toRiverParams, toTerrainParams, toWorldParams } from '../sandboxes/sandbox4/src/params';
import { BELTS, Biomes, BIOMES, MOISTURE } from '../sandboxes/sandbox4/src/world/biomes';
import { Climate } from '../sandboxes/sandbox4/src/world/climate';
import { Lakes } from '../sandboxes/sandbox4/src/world/lakes';
import { packKey } from '../sandboxes/sandbox4/src/world/level';
import { BEDROCKS, RESOURCES, Resources } from '../sandboxes/sandbox4/src/world/resources';
import { Rivers } from '../sandboxes/sandbox4/src/world/rivers';
import { Terrain } from '../sandboxes/sandbox4/src/world/terrain';
import { World } from '../sandboxes/sandbox4/src/world/world';
import { ELEVATION_ZONE_TYPES, elevationZoneType } from '../sandboxes/sandbox4/src/world/zones';

/** Region lattice cells exported: the four that meet at the origin. */
const REGIONS: [number, number][] = [
  [-1, -1],
  [0, -1],
  [-1, 0],
  [0, 0],
];

interface PatchOut {
  key: number;
  i: number;
  j: number;
  x: number;
  y: number;
  biome: string;
  belt: string | null;
  moisture: string | null;
  aridity: number | null;
  temperature: number | null;
  precipitation: number | null;
  height: number;
  coastal: boolean;
  /** the prosperity map at the patch's site, 0–1 between its minimum and maximum */
  prosperity: number;
  /** the patch's resources, largest amount first */
  resources: ResourceOut[];
}

interface ResourceOut {
  id: string;
  amount: number;
  variant: string;
}

interface ZoneOut {
  key: number;
  i: number;
  j: number;
  x: number;
  y: number;
  type: string;
  ocean: boolean;
  bedrock: string | null;
  biomePatches: PatchOut[];
}

interface RegionOut {
  key: number;
  i: number;
  j: number;
  x: number;
  y: number;
  elevationZones: ZoneOut[];
}

export interface MapExport {
  /** the JSON document */
  text: string;
  regions: number;
  zones: number;
  patches: number;
  land: number;
  /** land patches whose height is the per-type estimate, not the terrain's (expected 0) */
  estimated: number;
  /** resources listed over all patches, and patches that list none */
  resources: number;
  bare: number;
}

const r0 = (v: number) => Math.round(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** `{"a":1,"b":[{"c":2}]}` → `{ "a": 1, "b": [{ "c": 2 }] }` (keys and string values here hold no `,"`, `":`, `{` or `}`). */
const oneLine = (o: object) =>
  JSON.stringify(o)
    .replace(/,"/g, ', "')
    .replace(/":/g, '": ')
    .replace(/\},\{/g, '}, {')
    .replace(/\{/g, '{ ')
    .replace(/\}/g, ' }');

export function exportMap(): MapExport {
  const d = defaults();
  const seed = seedFromText(DEFAULT_SEED);
  const w = new World(toWorldParams(d, seed));
  const rv = new Rivers(w, toRiverParams(d, seed));
  const cl = new Climate(toClimateParams(d, seed));
  const t = new Terrain(w, rv, toTerrainParams(d));
  const b = new Biomes(w, rv, cl, t, toBiomeParams(d));
  // lakes read terrain-less biomes (as in the app); the resources read the exact-height ones
  const lk = new Lakes(w, rv, new Biomes(w, rv, cl, null, toBiomeParams(d)), toLakeParams(d));
  const res = new Resources(w, rv, lk, b, cl);

  const regionKeys = REGIONS.map(([i, j]) => packKey(i, j));
  // the biomes read exact patch heights only from computed tiles
  for (const rk of regionKeys) t.get(rk);

  /** Raw zones of a merged zone: the root and every neighbour-connected zone that resolves to it. */
  const members = (root: number): number[] => {
    const seen = new Set<number>([root]);
    const stack = [root];
    while (stack.length) {
      const z = stack.pop()!;
      for (const n of w.elevationZoneNbrs(w.elevationZone(z))) {
        if (!seen.has(n) && w.elevationZoneRoot(n) === root) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    return [...seen];
  };

  let land = 0;
  let estimated = 0;
  let listed = 0;
  let bare = 0;

  const resourcesOut = (pk: number): ResourceOut[] => {
    const list = res.ofPatch(pk).list.map((h) => ({ id: RESOURCES[h.resource].id, amount: r2(h.amount), variant: h.variant }));
    listed += list.length;
    if (!list.length) bare++;
    return list;
  };

  const patchOut = (pk: number, zk: number): PatchOut => {
    const s = w.patch(pk);
    const cell = w.patchCell(pk);
    if (cell.elevationZone !== zk) throw new Error(`patch ${pk} resolves to zone ${cell.elevationZone}, not ${zk}`);
    const info = b.ofPatch(pk);
    const head = { key: pk, i: s.i, j: s.j, x: r0(s.x), y: r0(s.y), biome: BIOMES[info.biome].id };
    if (info.ocean) return { ...head, belt: null, moisture: null, aridity: null, temperature: null, precipitation: null, height: 0, coastal: false, prosperity: r2(res.ofPatch(pk).prosperity), resources: resourcesOut(pk) };
    land++;
    if (!info.heightExact) estimated++;
    return {
      ...head,
      belt: BELTS[info.belt].id,
      moisture: MOISTURE[info.moisture],
      aridity: r2(info.aridity),
      temperature: r1(info.t),
      precipitation: r0(info.p),
      height: r0(info.height),
      coastal: info.coastal,
      prosperity: r2(res.ofPatch(pk).prosperity),
      resources: resourcesOut(pk),
    };
  };

  const zoneOut = (zk: number): ZoneOut => {
    const z = w.elevationZone(zk);
    const ocean = w.ocean(zk);
    const biomePatches = members(zk)
      .flatMap((m) => w.elevationZonePatches(w.elevationZone(m)))
      .filter((pk) => w.patchRoot(pk) === pk)
      .sort((a, c) => w.patch(a).j - w.patch(c).j || w.patch(a).i - w.patch(c).i)
      .map((pk) => patchOut(pk, zk));
    const rock = res.bedrock(zk);
    return { key: zk, i: z.i, j: z.j, x: r0(z.x), y: r0(z.y), type: ELEVATION_ZONE_TYPES[elevationZoneType(zk, ocean)].id, ocean, bedrock: rock < 0 ? null : BEDROCKS[rock].id, biomePatches };
  };

  const regions: RegionOut[] = regionKeys.map((rk) => {
    const r = w.region(rk);
    const elevationZones = r.elevationZones.filter((zk) => w.elevationZoneRoot(zk) === zk).map(zoneOut);
    return { key: rk, i: r.i, j: r.j, x: r0(r.x), y: r0(r.y), elevationZones };
  });

  // pretty JSON, one biome patch per line
  const lines: string[] = ['{', `  "seed": ${JSON.stringify(DEFAULT_SEED)},`, '  "units": { "distance": "m", "temperature": "°C", "precipitation": "mm/yr", "height": "m" },', '  "regions": ['];
  const comma = (n: number, len: number) => (n < len - 1 ? ',' : '');
  regions.forEach((r, ri) => {
    lines.push('    {', `      "key": ${r.key},`, `      "i": ${r.i},`, `      "j": ${r.j},`, `      "x": ${r.x},`, `      "y": ${r.y},`, '      "elevationZones": [');
    r.elevationZones.forEach((z, zi) => {
      lines.push('        {', `          "key": ${z.key},`, `          "i": ${z.i},`, `          "j": ${z.j},`, `          "x": ${z.x},`, `          "y": ${z.y},`);
      lines.push(`          "type": ${JSON.stringify(z.type)},`, `          "ocean": ${z.ocean},`, `          "bedrock": ${JSON.stringify(z.bedrock)},`, '          "biomePatches": [');
      z.biomePatches.forEach((p, pi) => lines.push(`            ${oneLine(p)}${comma(pi, z.biomePatches.length)}`));
      lines.push('          ]', `        }${comma(zi, r.elevationZones.length)}`);
    });
    lines.push('      ]', `    }${comma(ri, regions.length)}`);
  });
  lines.push('  ]', '}');
  const text = lines.join('\n') + '\n';
  JSON.parse(text);

  const zones = regions.reduce((n, r) => n + r.elevationZones.length, 0);
  const patches = regions.reduce((n, r) => n + r.elevationZones.reduce((m, z) => m + z.biomePatches.length, 0), 0);
  return { text, regions: regions.length, zones, patches, land, estimated, resources: listed, bare };
}
