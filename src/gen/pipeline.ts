/**
 * The generation pipeline. Every stage is a pure function of (graph, params, seed,
 * earlier fields) and draws randomness only from hash(seed, stage, …), so any run
 * is reproducible bit-for-bit (see the fingerprint in the UI).
 */
import { fingerprint } from '../core/hash';
import type { CellGraph } from '../graph/types';
import { bool, num, type Params } from '../params/schema';
import { assignBiomes, BIOMES } from './biomes';
import { runCA, type CaResult } from './ca';
import { moisture as computeMoisture, temperature as computeTemperature } from './climate';
import { computeElevation } from './elevation';
import {
  classifyWater,
  drain,
  erode,
  extractRivers,
  watersheds,
  WATER_LAKE,
  WATER_LAND,
  WATER_OCEAN,
  type Drainage,
  type RiverNet,
} from './hydrology';
import { pathCells } from './noisepaths';
import type { PlateResult } from './plates';
import { carve, colonize, type ScaNet } from './sca';
import { bfsHops, cellGradient } from './util';

export type ColormapId = 'terrain' | 'viridis' | 'magma' | 'moisture' | 'temperature' | 'gray' | 'diverging' | 'flux';

export interface FieldDef {
  id: string;
  label: string;
  values: ArrayLike<number>;
  kind: 'scalar' | 'category';
  colormap?: ColormapId;
  min?: number;
  max?: number;
  /** fixed category list (index = value) */
  categories?: { label: string; color: string }[];
  /** for id-like categories without a fixed list: colour by hash */
  hashColors?: boolean;
  format?: (v: number) => string;
}

export interface Timing {
  name: string;
  ms: number;
}

export interface WorldStats {
  cells: number;
  edges: number;
  meanDegree: number;
  degreeHist: [number, number][];
  areaMean: number;
  areaCV: number;
  areaMinMax: [number, number];
  compactnessMean: number;
  landFrac: number;
  lakes: number;
  riverMouths: number;
  riverCells: number;
}

export interface World {
  graph: CellGraph;
  params: Params;
  seed: number;
  elevation: Float64Array;
  water: Uint8Array;
  temperature: Float64Array;
  moisture: Float64Array;
  biome: Int32Array;
  coastDist: Int32Array;
  grad: { gx: Float64Array; gy: Float64Array };
  drainage: Drainage | null;
  rivers: RiverNet | null;
  plates: PlateResult | null;
  sca: ScaNet | null;
  paths: { cells: Uint8Array; count: number } | null;
  ca: CaResult | null;
  wind: [number, number] | null;
  elevNorm: { lo: number; span: number; sea: number } | null;
  fields: Record<string, FieldDef>;
  timings: Timing[];
  fingerprint: string;
  stats: WorldStats;
}

/** Greedy graph colouring so neighbouring cells get different colours. */
export function greedyColoring(g: CellGraph): Int32Array {
  const c = new Int32Array(g.n).fill(-1);
  const used = new Uint8Array(64);
  for (let i = 0; i < g.n; i++) {
    used.fill(0);
    for (let k = g.nbrOff[i]; k < g.nbrOff[i + 1]; k++) {
      const q = c[g.nbr[k]];
      if (q >= 0 && q < 64) used[q] = 1;
    }
    let col = 0;
    while (col < 63 && used[col]) col++;
    c[i] = col;
  }
  return c;
}

export function runPipeline(g: CellGraph, p: Params, seed: number, graphMs: number): World {
  const timings: Timing[] = [{ name: 'Cells', ms: graphMs }];
  let t0 = performance.now();
  const lap = (name: string) => {
    const t = performance.now();
    timings.push({ name, ms: t - t0 });
    t0 = t;
  };
  const n = g.n;

  const er = computeElevation(g, p, seed);
  const elevation = er.elevation;
  lap('Elevation');
  if (bool(p, 'erosion.enabled')) {
    erode(g, elevation, num(p, 'erosion.iterations'), num(p, 'erosion.rate'));
    lap('Erosion');
  }
  let water = classifyWater(g, elevation);
  const temperature = computeTemperature(g, p, seed, elevation);
  const mres = computeMoisture(g, p, seed, elevation, water);
  const moisture = mres.moisture;
  lap('Climate');
  let grad = cellGradient(g, elevation);

  let sca: ScaNet | null = null;
  if (bool(p, 'sca.enabled')) {
    sca = colonize(g, p, seed, elevation, water, moisture, grad);
    if (bool(p, 'sca.carve')) {
      carve(g, sca, elevation, water, num(p, 'sca.carveDepth'), num(p, 'sca.carveWidth'));
      grad = cellGradient(g, elevation);
    }
    lap('Space colonization');
  }

  let drainage: Drainage | null = null;
  let rivers: RiverNet | null = null;
  let basin: Int32Array | null = null;
  if (bool(p, 'hydro.enabled')) {
    drainage = drain(g, elevation, water, bool(p, 'hydro.rainWeighted') ? moisture : null);
    if (bool(p, 'hydro.lakes')) {
      const depth = num(p, 'hydro.lakeDepth');
      water = Uint8Array.from(water);
      for (let i = 0; i < n; i++) {
        if (water[i] === WATER_LAND && drainage.filled[i] - elevation[i] > depth) water[i] = WATER_LAKE;
      }
    }
    rivers = extractRivers(g, drainage, water, num(p, 'hydro.threshold'));
    basin = watersheds(g, drainage);
    lap('Hydrology');
  }

  // signed hop distance to the coast: land > 0, water ≤ 0
  const isOcean = new Uint8Array(n);
  const isLand = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    isOcean[i] = water[i] === WATER_OCEAN ? 1 : 0;
    isLand[i] = water[i] === WATER_OCEAN ? 0 : 1;
  }
  const dl = bfsHops(g, isOcean);
  const dw = bfsHops(g, isLand);
  const coastDist = new Int32Array(n);
  for (let i = 0; i < n; i++) coastDist[i] = isOcean[i] ? -(dw[i] < 0 ? 0 : dw[i] - 1) : dl[i] < 0 ? 0 : dl[i];

  // biomes, with extra moisture next to rivers
  const bm = Float64Array.from(moisture);
  const rm = num(p, 'climate.riverMoisture');
  if (rivers && rm > 0) {
    for (let i = 0; i < n; i++) {
      if (!rivers.isRiver[i]) continue;
      bm[i] = Math.min(1, bm[i] + rm);
      for (let k = g.nbrOff[i]; k < g.nbrOff[i + 1]; k++) {
        const j = g.nbr[k];
        bm[j] = Math.min(1, Math.max(bm[j], moisture[j] + rm * 0.5));
      }
    }
  }
  const biome = assignBiomes(g, elevation, water, temperature, bm);
  lap('Biomes');

  let paths: World['paths'] = null;
  if (bool(p, 'paths.enabled')) {
    paths = pathCells(g, p, seed, water);
    lap('Noise networks');
  }
  let ca: CaResult | null = null;
  if (bool(p, 'ca.enabled')) {
    ca = runCA(g, p, seed, water);
    lap('Cellular automata');
  }

  // ---- cell-quality fields & stats
  let areaSum = 0;
  for (let i = 0; i < n; i++) areaSum += g.area[i];
  const areaMean = areaSum / n;
  const relArea = new Float64Array(n);
  const deg = new Float64Array(n);
  const compact = new Float64Array(n);
  const offset = new Float64Array(n);
  let var_ = 0;
  let cSum = 0;
  let aMin = Infinity;
  let aMax = 0;
  const hist = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    relArea[i] = g.area[i] / areaMean;
    var_ += (g.area[i] - areaMean) * (g.area[i] - areaMean);
    aMin = Math.min(aMin, g.area[i]);
    aMax = Math.max(aMax, g.area[i]);
    deg[i] = g.nbrOff[i + 1] - g.nbrOff[i];
    hist.set(deg[i], (hist.get(deg[i]) ?? 0) + 1);
    const P = g.perimeter[i];
    compact[i] = P > 0 ? Math.min(1, (4 * Math.PI * g.area[i]) / (P * P)) : 0;
    cSum += compact[i];
    const dx = g.sx[i] - g.x[i];
    const dy = g.sy[i] - g.y[i];
    offset[i] = Math.sqrt(dx * dx + dy * dy) / g.spacing;
  }
  let landArea = 0;
  for (let i = 0; i < n; i++) if (water[i] !== WATER_OCEAN) landArea += g.area[i];
  let lakes = 0;
  {
    const seen = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (water[i] !== WATER_LAKE || seen[i]) continue;
      lakes++;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        for (let k = g.nbrOff[c]; k < g.nbrOff[c + 1]; k++) {
          const j = g.nbr[k];
          if (water[j] === WATER_LAKE && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
  }
  let riverCells = 0;
  if (rivers) for (let i = 0; i < n; i++) riverCells += rivers.isRiver[i];

  const fmt2 = (v: number) => v.toFixed(2);
  const fmt3 = (v: number) => v.toFixed(3);
  const fields: Record<string, FieldDef> = {
    cellId: { id: 'cellId', label: 'Cell id', values: greedyColoring(g), kind: 'category', hashColors: false },
    area: { id: 'area', label: 'Area / mean', values: relArea, kind: 'scalar', colormap: 'viridis', format: fmt2 },
    neighbors: { id: 'neighbors', label: 'Neighbours', values: deg, kind: 'scalar', colormap: 'magma', format: (v) => String(v) },
    compactness: { id: 'compactness', label: 'Compactness', values: compact, kind: 'scalar', colormap: 'viridis', min: 0.4, max: 1, format: fmt3 },
    siteOffset: { id: 'siteOffset', label: 'Site offset / spacing', values: offset, kind: 'scalar', colormap: 'magma', min: 0, format: fmt3 },
    elevation: { id: 'elevation', label: 'Elevation', values: elevation, kind: 'scalar', colormap: 'terrain', min: -1, max: 1, format: fmt3 },
    biome: {
      id: 'biome',
      label: 'Biome',
      values: biome,
      kind: 'category',
      categories: BIOMES.map((b) => ({ label: b.name, color: b.color })),
    },
    moisture: { id: 'moisture', label: 'Moisture', values: bm, kind: 'scalar', colormap: 'moisture', min: 0, max: 1, format: fmt2 },
    temperature: { id: 'temperature', label: 'Temperature', values: temperature, kind: 'scalar', colormap: 'temperature', min: 0, max: 1, format: fmt2 },
    coastDist: { id: 'coastDist', label: 'Hops to coast', values: coastDist, kind: 'scalar', colormap: 'diverging', format: (v) => String(v) },
  };
  if (drainage) {
    const lf = new Float64Array(n);
    for (let i = 0; i < n; i++) lf[i] = Math.log10(1 + drainage.flux[i]);
    fields.flux = { id: 'flux', label: 'log₁₀(1 + flux)', values: lf, kind: 'scalar', colormap: 'flux', min: 0, format: fmt2 };
  }
  if (basin) fields.watershed = { id: 'watershed', label: 'Watershed (outlet id)', values: basin, kind: 'category', hashColors: true };
  if (er.plates) {
    fields.plates = { id: 'plates', label: 'Plate', values: er.plates.plateId, kind: 'category', hashColors: true };
  }
  if (ca) {
    fields.cave = {
      id: 'cave',
      label: 'CA state',
      values: ca.state,
      kind: 'category',
      categories: [
        { label: 'Floor', color: '#d9cfb8' },
        { label: 'Wall', color: '#3a3532' },
        { label: 'Outside', color: '#2b3c5a' },
      ],
    };
  }
  if (paths) {
    fields.paths = {
      id: 'paths',
      label: 'Network cell',
      values: paths.cells,
      kind: 'category',
      categories: [
        { label: 'Off network', color: '#2c3138' },
        { label: 'On network', color: '#f0b44c' },
      ],
    };
  }
  lap('Analysis');

  const fpArrays: ArrayLike<number>[] = [g.x, g.y, elevation, temperature, moisture, biome, water];
  if (drainage) fpArrays.push(drainage.flux);
  if (sca) fpArrays.push(sca.nx, sca.ny);
  if (ca) fpArrays.push(ca.state);
  if (paths) fpArrays.push(paths.cells);

  return {
    graph: g,
    params: p,
    seed,
    elevation,
    water,
    temperature,
    moisture: bm,
    biome,
    coastDist,
    grad,
    drainage,
    rivers,
    plates: er.plates,
    sca,
    paths,
    ca,
    wind: mres.wind ?? null,
    elevNorm: er.norm,
    fields,
    timings,
    fingerprint: fingerprint(fpArrays),
    stats: {
      cells: n,
      edges: g.nbr.length / 2,
      meanDegree: g.nbr.length / n,
      degreeHist: Array.from(hist.entries()).sort((a, b) => a[0] - b[0]),
      areaMean,
      areaCV: Math.sqrt(var_ / n) / areaMean,
      areaMinMax: [aMin, aMax],
      compactnessMean: cSum / n,
      landFrac: landArea / areaSum,
      lakes,
      riverMouths: rivers?.count ?? 0,
      riverCells,
    },
  };
}
