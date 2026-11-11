# Sandbox 4: generating the map tile by tile

*Analysis date: 2026-11-07, commit `0591f46`. Question: what has to change so that Sandbox 4 generates the map in tiles four regions wide, and panning only computes the tiles that are newly needed?*

**Status:** part 1 (terrain per tile, in a Web Worker) is implemented: `world/terrain.ts`, `world/terrain.worker.ts`, `main.ts`. Since then:

- Tiles aim for about 256 km: `tileSide(regionSize)` gives 2 × 2 for the default 128 km regions, 1 from 256 km up, and up to 4 × 4 for small regions.
- `HALO` is 24 km, not 48 km.
- The main thread also requests a look-ahead ring of tiles, one tile span beyond the view (and beyond the 3D mesh's margin).
- The 3D view follows pans immediately.

The bit-equality check is a test in `tests/terrain.test.ts`. Part 2 (2D render tiles) is not started. The note below describes the original 4 × 4 analysis.

**Tile** in this note means a 4 × 4 block of region lattice cells. Tile `(I, J)` owns the regions `(i, j)` with `⌊i/4⌋ = I` and `⌊j/4⌋ = J`. With the default 128 km regions, a tile spans 512 km.

## Verdict

| Layer | Already local? | Change needed for tiles |
|---|---|---|
| World: regions, biomes, patches, oceans, merges (`world.ts`, `level.ts`) | Yes. A pure function of the point, memoised, and independent of exploration order (`tests/world.test.ts`). | **None.** |
| Rivers (`rivers.ts`) | Yes. Computed per region, a pure function of the region. | **None** to the algorithm. A tile is 16 region computes. |
| Terrain (`terrain.ts`) | Per region, with a large halo. | **Yes.** One raster per tile instead of per region (see below). The result is bit-identical. |
| 2D map raster (`render/source.ts`, `shared/render/raster.ts`) | No. Every camera change re-renders the whole viewport. | **Yes.** This is where panning actually costs time. |
| Overlays, stats, 3D | Drawn per frame from caches, or through `heightAt`. | Only through the terrain lookup (`heightAt`, `peek`). |

Generation is already tileable: nothing in the world or the rivers depends on what was computed before. The work is in how terrain and the 2D picture are **cut up and cached**.

## Measurements

These come from a throwaway vitest probe (seed 12345, default parameters, Node; the probe has been deleted):

- **Per-pixel classification:** a 1600 × 1000 viewport costs about **0.9 s** of `World.cellAt` at 1 km/px and at 100 m/px, warm or cold. The memo caches barely help, because the cost is the per-pixel Voronoi query plus the warp fBm. Today every pan restarts it.
- **World halo:** the first query in new territory sources ocean data for 428 regions and 8,477 biomes in 20 ms. The ocean source radius is `connectRange + 5` = 7 regions. This is cheap, so it does not need changing.
- **Rivers:** about 14 ms per region on average. On its first visit a terrain tile needs the rivers of about 8 × 8 = 64 regions: its 16 own regions plus a ring.
- **Per-region terrain overhead:** one region's raster is about 190 × 185 cells at 2 km (~380 km square) for a 128 km region. Raster cells per own land cell is **9.3×**.
- **Tile vs per-region terrain** (16 regions, rivers pre-warmed):

  | res | 16 region rasters | one tile raster | time, 16 regions | time, tile steps 1–4 (+1 fill) |
  |---|---|---|---|---|
  | 2 km | 519,894 cells | 401 × 401 = 160,801 | 1,329 ms | 683 ms |
  | 1 km | 2,068,808 cells | 801 × 801 = 641,601 | 3,801 ms | 1,567 ms |

  That is 3.2× fewer cells and about 2.4× less time. The other 15 fills were not timed separately.
- **Equality:** heights on every own-land cell are **bit-identical** between the tile raster and the per-region rasters. Max |Δh| = 0 over 202,671 cells at 1 km and 50,643 at 2 km.
- **Steps 1–4 are not exactly pure.** The heights before the fill (`pre`) differ between overlapping rasters, but only near a raster edge:

  | distance to raster edge | max |Δpre| |
  |---|---|
  | 0–10 km | 3,706 m |
  | 10–20 km | 0.2 m |
  | ≥ 20 km | 0 |

  The 48 km `HALO` covers this with room to spare, which is why tile and region results match exactly. `HALO` could shrink to about 24 km.

## Required changes

### 1. Terrain per tile (`world/terrain.ts`)

1. **Ownership by region lattice index, never by point.**
   - Regions spill out of their lattice cell (jitter 1), and a merged biome is drawn in its neighbour's region, so a tile's land is ragged, not a square.
   - Look up a height as point → `cellAt(…).region` → tile `(⌊i/4⌋, ⌊j/4⌋)` → sample.
2. **`computeTile(I, J)`:**
   - Raster bbox = the union of the 16 existing per-region `bbox()` boxes.
   - Run steps 1–4 (envelope, divides, noise, burn) once.
   - Then run step 5 (Priority-Flood) once per owned region on the same raster. It only writes that region's own cells and is seeded from its border, so the regions do not interact.
   - The fill is already independent of raster layout. Heap ties break on the cell index `j·nx + i`, and on world-aligned rasters that is world row-major order.
3. **Result type.**
   - `RegionTerrain` becomes a tile result.
   - Store `reg` as an `Int32Array` index into a table of region keys. A `Float64Array` is 5 MB at 801².
   - Drop `pre` from what is cached (it is only for debugging). That takes a 1 km tile from about 11 MB to about 6 MB.
   - Replace the "clear at 240 regions" cache with LRU or distance-from-view eviction, capped at a few dozen tiles.
4. **Callers.**
   - Route through region → tile: `heightAt`, `peek` (used per pixel in `render/source.ts`), the inspector, and `bed()`.
   - `prepareTerrain` in `main.ts` iterates the tiles of the regions around the view, not the regions themselves.
5. **Off the main thread.**
   - Today terrain is sliced per region against a 120 ms deadline.
   - A tile is about 1.6 s at 1 km, plus up to 64 river regions (~0.9 s) on its first visit. It cannot be sliced that way and would freeze panning.
   - Run tiles in a Web Worker. `World`, `Rivers` and `Terrain` are pure and use no DOM; the worker builds its own `World` from the parameters. Return transferable typed arrays.
6. **Budget.**
   - `TERRAIN_MAX_REGIONS = 64` is about 4 tiles at 1 km.
   - "Four regions wide" scales with `reg.size` (32–512 km). At 512 km a tile is 2,048 km, about 2,300² cells at 1 km: too big.
   - Decide whether the tile is k × k regions with k chosen for a roughly constant world size, or always 4 (open decision).
7. **Test.** Add the probe as a regression test: tile heights must equal per-region heights on own land, bit for bit. Keep the existing border seam test.

### 2. 2D raster in tiles (`render/source.ts`, `shared/render/raster.ts`)

The terrain change makes new ground cheaper. Panning itself only gets cheap with this change.

1. **Use a tile pyramid, not one fixed tile size.**
   - Level 0 = 4R of world, aligned to the region lattice, so it is the same grid as the terrain tiles.
   - Level z = 4R / 2^z, each tile about 256 px. Pick z so tiles are drawn at 1–2× their pixel size.
   - A fixed 512 km render tile cannot work: at `MAX_ZOOM` (0.25 px/m) it would be 128,000 px wide.
2. **Render each tile with an apron.**
   - The `RowFn` keeps state from the rows above: region borders look 3 rows up, coast and biome edges look at the left and upper neighbours, and hillshade uses the left and upper heights.
   - Render 3 px extra at the top and left and 1 px at the right, then discard the apron.
   - The dash phase is already anchored to the world, so dashes join across tiles.
3. **Cache key per tile:** `genKey | viewKey | z, tx, ty`, plus the state of the terrain tiles it overlaps.
   - Today the global `terrainVer` bump re-renders the whole view whenever any region's terrain arrives.
   - Re-render only the tiles that were drawn without heights.
4. **Coarse first:** draw parent-level tiles scaled up as placeholders. This replaces the low-resolution preview pass.
5. **Trade-off:** at fractional zoom, tiles are resampled, so the 1–3 px borders get blurred or thickened.
   - Option A: render one level finer and downscale.
   - Option B: re-render at the exact zoom when idle.

### Not needed

- **World:** nothing.
  - `trim()` clears all caches at once when over budget. Results are pure, so this is safe, but tiles would then recompute the ocean halo; LRU eviction is optional.
- **Rivers:** nothing.
  - The cache clears completely at 4,000 regions. That is optional to change too, but it should not evict rivers that a pending terrain tile still needs.
- **Overlays** (rivers as vectors, links, growth, merges, sites): drawn per frame from caches. They stay as they are.

## Suggested order

1. **Terrain tiles in a worker:** steps 1.1–1.7. This is a self-contained change, it is verified by the bit-equality test, and it removes the per-region stalls.
2. **2D render tiles:** step 2. This is the larger change and the one that makes panning incremental.

The two are independent and can be done in either order.
