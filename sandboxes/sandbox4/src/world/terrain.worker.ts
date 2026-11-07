/**
 * Terrain tiles off the main thread. A tile (4 × 4 regions) takes seconds to compute,
 * which cannot be sliced between frames, so it runs here.
 *
 * The worker builds its own World / Rivers / Terrain from the parameters (all pure, no
 * DOM, so it computes exactly what the main thread would) and computes the tiles the
 * main thread last asked for, nearest first, one at a time. Results are posted with
 * their typed arrays transferred; the main thread caches them (`Terrain.put`).
 *
 *   main → worker  { kind: 'gen', gen, world, rivers, terrain }   new parameters (drops the queue)
 *                  { kind: 'want', gen, tiles }                   replaces the queue
 *   worker → main  { kind: 'tile', gen, tile }
 */
import { Rivers, type RiverParams } from './rivers';
import { Terrain, type TerrainParams, type TerrainTile } from './terrain';
import { World, type WorldParams } from './world';

export type ToTerrainWorker =
  | { kind: 'gen'; gen: number; world: WorldParams; rivers: RiverParams; terrain: TerrainParams }
  | { kind: 'want'; gen: number; tiles: number[] };

export type FromTerrainWorker = { kind: 'tile'; gen: number; tile: TerrainTile };

/** memoised world objects kept between tiles (as on the main thread) */
const WORLD_CACHE = 900_000;

let gen = -1;
let terrain: Terrain | null = null;
let queue: number[] = [];
/** tiles posted since the last 'want': a 'want' sent before they arrived still lists them */
const posted = new Set<number>();
let scheduled = false;

self.onmessage = (e: MessageEvent<ToTerrainWorker>) => {
  const m = e.data;
  if (m.kind === 'gen') {
    gen = m.gen;
    const world = new World(m.world);
    terrain = new Terrain(world, new Rivers(world, m.rivers), m.terrain);
    queue = [];
    posted.clear();
  } else if (m.kind === 'want' && m.gen === gen) {
    queue = m.tiles.filter((k) => !posted.has(k));
    posted.clear();
    schedule();
  }
};

/** One tile per macrotask, so new messages are handled between tiles. */
function schedule(): void {
  if (scheduled || queue.length === 0) return;
  scheduled = true;
  setTimeout(step, 0);
}

function step(): void {
  scheduled = false;
  const key = queue.shift();
  if (terrain === null || key === undefined) return;
  const tile = terrain.compute(key);
  terrain.world.trim(WORLD_CACHE);
  posted.add(key);
  const msg: FromTerrainWorker = { kind: 'tile', gen, tile };
  (self as unknown as Worker).postMessage(msg, [tile.h.buffer, tile.cls.buffer, tile.reg.buffer, tile.regKeys.buffer]);
  schedule();
}
