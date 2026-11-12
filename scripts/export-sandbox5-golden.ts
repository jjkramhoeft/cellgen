/**
 * Golden data for Sandbox 5 (the C# port of the Sandbox 4 generator): values computed by
 * this TypeScript generator at a frozen set of parameters, which the C# tests in
 * sandboxes/sandbox5/tests/Sandbox5.Tests must reproduce bit for bit.
 *
 * The parameters come from sandboxes/sandbox5/tests/Sandbox5.Tests/Golden/settings.json (the
 * same format as a sandbox's defaults.json), not from the live defaults, so retuning either
 * sandbox does not invalidate the golden files.
 *
 * Run through scripts/export-sandbox5-golden.mjs (`npm run export-sandbox5-golden`).
 */
import { dcos, dexp, dlog, dpow, dsin } from '@shared/core/dmath';
import { fingerprint, hash3, hash4, hashString, pcg3, seedFromText, sfc32 } from '@shared/core/hash';
import { fbm, perlin2, perlinFbm, ridged, simplex2 } from '@shared/core/noise';
import type { Params } from '@shared/params/schema';
import { toBiomeParams, toClimateParams, toLakeParams, toLocationParams, toRiverParams, toTerrainParams, toWorldParams } from '../sandboxes/sandbox4/src/params';
import { Biomes, classify, coolingCurve } from '../sandboxes/sandbox4/src/world/biomes';
import { Climate } from '../sandboxes/sandbox4/src/world/climate';
import { Lakes } from '../sandboxes/sandbox4/src/world/lakes';
import { packKey } from '../sandboxes/sandbox4/src/world/level';
import { Locations, type Candidate } from '../sandboxes/sandbox4/src/world/locations';
import { Resources } from '../sandboxes/sandbox4/src/world/resources';
import { Rivers } from '../sandboxes/sandbox4/src/world/rivers';
import { Terrain } from '../sandboxes/sandbox4/src/world/terrain';
import { Travel, TravelGrid } from '../sandboxes/sandbox4/src/world/travel';
import { World } from '../sandboxes/sandbox4/src/world/world';
import { elevationZoneType } from '../sandboxes/sandbox4/src/world/zones';

export interface GoldenSettings {
  seed: string;
  params: Params;
}

/** Region lattice cells the per-region golden data covers: the four that meet at the origin. */
const REGIONS: [number, number][] = [
  [-1, -1],
  [0, -1],
  [-1, 0],
  [0, 0],
];

const fp = (...arrays: ArrayLike<number>[]) => fingerprint(arrays);

/** Hashing, PRNG, deterministic maths and noise. */
export function numerics(): object {
  const hashes: number[][] = [];
  for (let k = 0; k < 48; k++) {
    const a = (k * 7919) ^ 0x1234567;
    hashes.push([hash4(a, k, k * 31 - 500, 1000 - k * 17), hash3(a, k + 3, k * 1009 - 77), pcg3(k - 20, a, -k * 13)]);
  }
  const strings = ['cellgen', '', 'a', 'Sandbox 5', 'æøå ✓', '123', ' 42 ', '1234567890', '007'];
  const rng = sfc32(0xc0ffee);
  const stream: number[] = [];
  for (let k = 0; k < 24; k++) stream.push(rng());
  const ints: number[] = [];
  for (let k = 0; k < 12; k++) ints.push(rng.int(1000));
  const xs = [-37.25, -3.2, -1, -0.37, 0, 1e-9, 0.1, 0.5, 1, 1.4142135623730951, 2, 2.718281828459045, 7.3, 100, 1660, 12000, 123456.789];
  const maths = xs.map((x) => ({
    x,
    exp: dexp(x / 20),
    log: x > 0 ? dlog(x) : null,
    sin: dsin(x),
    cos: dcos(x),
    pow: x >= 0 ? [dpow(x, 0.4375), dpow(x, 3), dpow(x, 1.7), dpow(x, 0.5), x > 0 ? dpow(x, -2) : null] : null,
  }));
  const noise: number[][] = [];
  const p = { octaves: 3, lacunarity: 2.2, gain: 0.55 };
  for (let k = 0; k < 40; k++) {
    const x = (k - 20) * 0.731 + 0.05;
    const y = (k * 37) % 11 - 5.3 + k * 0.011;
    const seed = (k * 2654435761) | 0;
    noise.push([x, y, seed, simplex2(seed, x, y), perlin2(seed, x, y), fbm(seed, x, y, p), perlinFbm(seed, x, y, p), ridged(seed, x, y, p)]);
  }
  return {
    hashes,
    strings: strings.map((s) => ({ s, hash: hashString(s), seed: seedFromText(s) })),
    stream,
    ints,
    maths,
    noise,
  };
}

/** The three-level base map and the climate fields. */
export function world(s: GoldenSettings): object {
  const seed = seedFromText(s.seed);
  const w = new World(toWorldParams(s.params, seed));
  const cl = new Climate(toClimateParams(s.params, seed));
  const N = 44;
  const half = 330000;
  const grid: number[][] = [];
  const climate: number[][] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const wx = -half + ((x + 0.37) / N) * 2 * half;
      const wy = -half + ((y + 0.61) / N) * 2 * half;
      const c = w.cellAt(wx, wy, true);
      grid.push([c.patchRaw, c.patch, c.elevationZoneRaw, c.elevationZone, c.region, c.ocean ? 1 : 0, c.origin, c.patchMerged ? 1 : 0, c.elevationZoneMerged ? 1 : 0, elevationZoneType(c.elevationZone, c.ocean)]);
      if ((x + y) % 7 === 0) climate.push([wx, wy, cl.temperatureAt(wx, wy), cl.precipitationAt(wx, wy), cl.prosperityAt(wx, wy), cl.supernaturalAt(wx, wy)]);
    }
  }
  const regions = [];
  for (let j = -2; j <= 1; j++) {
    for (let i = -2; i <= 1; i++) {
      const r = w.region(packKey(i, j));
      regions.push({
        key: r.key,
        x: r.x,
        y: r.y,
        elevationZones: r.elevationZones,
        seeds: r.seeds,
        merges: [...r.merges].sort((a, b) => a - b),
        links: w.links(r.key).map((l) => ({ from: l.from, to: l.to, chain: l.chain })),
        zones: r.elevationZones.map((zk) => {
          const z = w.elevationZone(zk);
          return { key: zk, x: z.x, y: z.y, nbrs: w.elevationZoneNbrs(z), root: w.elevationZoneRoot(zk), ocean: w.ocean(zk) ? 1 : 0, origin: w.origin(zk), patches: w.elevationZonePatches(z).length, patchFp: fp(w.elevationZonePatches(z)) };
        }),
      });
    }
  }
  return { seed, fingerprint: w.fingerprint(), half, n: N, grid, climate, regions };
}

/** The river network of the four central regions. */
export function rivers(s: GoldenSettings): object {
  const seed = seedFromText(s.seed);
  const w = new World(toWorldParams(s.params, seed));
  const rv = new Rivers(w, toRiverParams(s.params, seed));
  return {
    regions: REGIONS.map(([i, j]) => {
      const key = packKey(i, j);
      const r = rv.get(key);
      const att = rv.attractors(key);
      const head = [];
      for (let k = 0; k < Math.min(r.n, 40); k++) head.push([r.x[k], r.y[k], r.parent[k], r.own[k], r.flow[k], r.wet[k]]);
      return {
        key,
        zones: rv.regionElevationZones(key),
        pairs: rv.rootPairs(key).pairs.map((p) => [p.ocean, p.land]),
        attractors: att.ax.length,
        attractorFp: fp(att.ax, att.ay),
        n: r.n,
        roots: r.roots,
        rootOcean: r.rootOcean,
        reached: r.reached,
        iterations: r.iterations,
        bridges: r.bridges,
        landlocked: r.landlocked,
        xyFp: fp(r.x, r.y),
        treeFp: fp(r.parent, r.own, r.flow, r.tree, r.wet),
        reachedFp: fp(r.reachedBy),
        box: [r.x0, r.y0, r.x1, r.y1],
        head,
      };
    }),
  };
}

/** The height map: the river beds of the four central regions and the tiles that own them. */
export function terrain(s: GoldenSettings): object {
  const seed = seedFromText(s.seed);
  const w = new World(toWorldParams(s.params, seed));
  const rv = new Rivers(w, toRiverParams(s.params, seed));
  const t = new Terrain(w, rv, toTerrainParams(s.params));
  return {
    k: t.k,
    regions: REGIONS.map(([i, j]) => {
      const key = packKey(i, j);
      const bed = t.bed(key);
      const tile = t.get(key);
      const samples: number[][] = [];
      for (let n = 0; n < 24; n++) {
        const q = Math.floor(((n + 0.5) / 24) * tile.nx * tile.ny);
        samples.push([q, tile.h[q], tile.cls[q], tile.reg[q]]);
      }
      const r = w.region(key);
      return {
        key,
        bedFp: fp(bed),
        bedHead: Array.from(bed.subarray(0, 60)),
        tile: tile.tile,
        x0: tile.x0,
        y0: tile.y0,
        res: tile.res,
        nx: tile.nx,
        ny: tile.ny,
        filled: tile.filled,
        maxFill: tile.maxFill,
        hFp: fp(tile.h),
        clsFp: fp(tile.cls),
        regFp: fp(tile.reg),
        regKeys: Array.from(tile.regKeys),
        patches: tile.patchKeys.length,
        patchKeyFp: fp(tile.patchKeys),
        patchHFp: fp(tile.patchH),
        samples,
        heights: [0.13, 0.41, 0.77].map((f) => t.heightAt(r.x + (f - 0.5) * 60000, r.y + (0.5 - f) * 45000)),
      };
    }),
  };
}

/** The biome classifier and the cooling curve. */
export function biomes(s: GoldenSettings): object {
  const bp = toBiomeParams(s.params);
  const cool = coolingCurve(bp.coolH, bp.coolT);
  const table: number[][] = [];
  for (let t = -16; t <= 32; t += 1.5) {
    for (const p of [20, 60, 110, 190, 260, 340, 520, 800, 1150, 1700, 2400, 3600, 6000, 11000]) {
      const c = classify(t, p);
      table.push([t, p, c.biome, c.belt, c.moisture, c.aridity]);
    }
  }
  const cooling: number[][] = [];
  for (let h = -50; h <= 2600; h += 37.5) cooling.push([h, cool(h)]);
  // sea-level biomes and coasts of the patches around the origin (no terrain: estimated heights)
  const seed = seedFromText(s.seed);
  const w = new World(toWorldParams(s.params, seed));
  const rv = new Rivers(w, toRiverParams(s.params, seed));
  const b = new Biomes(w, rv, new Climate(toClimateParams(s.params, seed)), null, bp);
  const patches: (number | boolean)[][] = [];
  for (let j = -14; j < 14; j++) {
    for (let i = -14; i < 14; i++) {
      const info = b.ofPatch(packKey(i, j));
      patches.push([info.key, info.biome, info.seaLevel, info.belt, info.moisture, info.zoneType, info.t0, info.p0, info.height, info.t, info.p, info.aridity, info.sparse, info.coastal]);
    }
  }
  return { table, cooling, patches };
}

/** The lakes of the four central regions. */
export function lakes(s: GoldenSettings): object {
  const seed = seedFromText(s.seed);
  const w = new World(toWorldParams(s.params, seed));
  const rv = new Rivers(w, toRiverParams(s.params, seed));
  const b = new Biomes(w, rv, new Climate(toClimateParams(s.params, seed)), null, toBiomeParams(s.params));
  const lk = new Lakes(w, rv, b, toLakeParams(s.params));
  return {
    regions: REGIONS.map(([i, j]) => {
      const key = packKey(i, j);
      const r = lk.get(key);
      return {
        key,
        candidates: r.candidates,
        tries: r.tries,
        crowded: r.crowded,
        tooSmall: r.tooSmall,
        lakes: r.lakes.map((l) => ({ id: l.id, patch: l.patch, node: l.node, flow: l.flow, cx: l.cx, cy: l.cy, nominal: l.nominal, size: l.size, area: l.area, outlineFp: fp(l.x, l.y), box: [l.x0, l.y0, l.x1, l.y1] })),
      };
    }),
  };
}

/**
 * The resources of every patch of the four central regions, on exact patch heights (the
 * terrain tiles are computed first, as scripts/export-map.ts does), with the biome record
 * and the river and lake site behind them. Unrounded.
 */
export function resources(s: GoldenSettings): object {
  const seed = seedFromText(s.seed);
  const w = new World(toWorldParams(s.params, seed));
  const rv = new Rivers(w, toRiverParams(s.params, seed));
  const cl = new Climate(toClimateParams(s.params, seed));
  const t = new Terrain(w, rv, toTerrainParams(s.params));
  const b = new Biomes(w, rv, cl, t, toBiomeParams(s.params));
  const lk = new Lakes(w, rv, new Biomes(w, rv, cl, null, toBiomeParams(s.params)), toLakeParams(s.params));
  const res = new Resources(w, rv, lk, b, cl);
  const keys = REGIONS.map(([i, j]) => packKey(i, j));
  for (const rk of keys) t.get(rk);
  return {
    regions: keys.map((rk) => ({
      key: rk,
      zones: rv.regionElevationZones(rk).map((zk) => {
        const z = w.elevationZone(zk);
        return {
          key: zk,
          root: w.elevationZoneRoot(zk),
          bedrock: res.bedrock(w.elevationZoneRoot(zk)),
          patches: w
            .elevationZonePatches(z)
            .filter((pk) => w.patchRoot(pk) === pk && w.patchCell(pk).region === rk)
            .map((pk) => {
              const info = b.ofPatch(pk);
              const r = res.ofPatch(pk);
              return {
                key: pk,
                biome: [info.biome, info.belt, info.moisture, info.seaLevel, info.zoneType],
                climate: [info.t0, info.p0, info.height, info.cooling, info.t, info.p, info.aridity],
                flags: [info.ocean, info.heightExact, info.sparse, info.coastal],
                bedrock: r.bedrock,
                prosperity: r.prosperity,
                food: r.food,
                wealth: r.wealth,
                site: [r.site.river, r.site.mouth, r.site.lake, r.site.harbour ? 1 : 0, r.site.goldLoad, r.site.tinLoad],
                amounts: r.amount,
                variants: r.variant,
                list: r.list.map((h) => h.resource),
              };
            }),
        };
      }),
    })),
  };
}

/** The model the locations and the travel network are built on: terrain-less biomes, as in the app. */
function siteModel(s: GoldenSettings) {
  const seed = seedFromText(s.seed);
  const w = new World(toWorldParams(s.params, seed));
  const rv = new Rivers(w, toRiverParams(s.params, seed));
  const cl = new Climate(toClimateParams(s.params, seed));
  const bio = new Biomes(w, rv, cl, null, toBiomeParams(s.params));
  const lk = new Lakes(w, rv, bio, toLakeParams(s.params));
  const loc = new Locations(w, rv, lk, bio, cl, toLocationParams(s.params));
  return { w, rv, cl, bio, lk, loc };
}

const candidateRow = (c: Candidate): number[] => [
  c.patch, c.zone, c.zoneType, c.biome, c.x, c.y, c.onRiver ? 1 : 0, c.depth, c.coast ? 1 : 0, c.harbour ? 1 : 0, c.oceanFrac, c.lake, c.river, c.mouth, c.confluence, c.head ? 1 : 0,
  c.food, c.water, c.materials, c.fish, c.goods, c.buildable, c.waterside, c.defence, c.gateway, c.centrality, c.comfort,
  c.resources, c.geography, c.trade, c.climate, c.prosperity, c.need, c.score,
];

/** The city and town locations of the four central regions, with every candidate's factors. */
export function locations(s: GoldenSettings): object {
  const { loc } = siteModel(s);
  return {
    regions: REGIONS.map(([i, j]) => {
      const key = packKey(i, j);
      const r = loc.get(key);
      return {
        key,
        eligible: r.eligible,
        spacing: r.spacing,
        list: r.list.map((l) => ({ patch: l.patch, kind: l.kind, rank: l.rank, score: l.score, x: l.x, y: l.y })),
        candidates: r.candidates.map(candidateRow),
        features: r.candidates.map((c) => c.features.join('|')),
      };
    }),
  };
}

/** The travel grids and the travel network of the four central regions. */
export function travel(s: GoldenSettings): object {
  const { w, rv, bio, lk, loc } = siteModel(s);
  const grid = new TravelGrid(w, rv, lk, bio, new Terrain(w, rv, toTerrainParams(s.params)));
  const net = new Travel(grid, loc, { minScore: s.params['view.locMin'] as number, citiesOnly: false });
  return {
    regions: REGIONS.map(([i, j]) => {
      const key = packKey(i, j);
      const g = grid.get(key);
      const r = net.get(key);
      return {
        key,
        grid: { i0: g.i0, j0: g.j0, nx: g.nx, ny: g.ny, land: g.land, sea: g.sea, kindFp: fp(g.kind), costFp: fp(g.cost), hFp: fp(g.h), linkFp: fp(g.links), links: g.links.length / 5 },
        shown: net.shown(key).map((l) => l.patch),
        nodes: r.nodes,
        candidates: r.candidates,
        pruned: r.pruned,
        edges: r.edges.map((e) => ({
          a: e.a.patch,
          b: e.b.patch,
          mode: e.mode,
          cost: e.cost,
          length: e.length,
          major: e.major,
          box: [e.x0, e.y0, e.x1, e.y1],
          parts: e.parts.map((p) => ({ mode: p.mode, points: p.pts.length / 2, ptsFp: fp(p.pts), runs: Array.from(p.runs) })),
        })),
      };
    }),
  };
}

export const PARTS: Record<string, (s: GoldenSettings) => object> = {
  numerics: () => numerics(),
  world,
  rivers,
  terrain,
  biomes,
  lakes,
  resources,
  locations,
  travel,
};
