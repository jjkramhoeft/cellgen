# cellgen

Procedural world-map generation in the browser, built from Voronoi cells. The site has one sandbox, **Sandbox 4 · Terrain**: an unbounded, deterministic base map from three nested levels of Voronoi cells (regions, biomes, subbiomes) with oceans and space-colonization rivers, plus a height map fitted to it and a 3D landscape view. You set the parameters on the left and inspect the result on the right, with zoom, pan, an inspector and statistics.

**Live site:** <https://jjkramhoeft.github.io/cellgen/>

Sandboxes 1 to 3 were earlier experiments and have been removed. Sandbox 4 contains everything from Sandbox 3; Sandboxes 1 and 2 remain in the git history.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173: landing page linking the sandbox
npm test         # vitest: shared core, the sandbox, and the sandbox registry
npm run build    # typecheck + multi-page production build into dist/
```

## How it is built

- TypeScript and Vite, with no UI framework and no runtime dependencies.
- Canvas 2D rendering, plus WebGL2 for the 3D view.
- **Deterministic.** Generation uses only hashing, seeded PRNGs and exactly specified arithmetic (+ − × ÷ √), never `Math.sin`, `exp` or `pow`, whose results can differ between engines (`shared/core/dmath.ts` has deterministic replacements for when they are needed). So the same seed and parameters give a bit-identical world in every browser. The sandbox shows a fingerprint of its world, and the tests check that it is stable.
- **Shareable.** The seed and every non-default parameter live in the URL hash.

## Repository layout

The repo is one Vite multi-page site: a landing page plus one page per sandbox, all built on a shared core, so further sandboxes can be added next to Sandbox 4.

```
index.html, landing/        landing page (lists the sandboxes in sandboxes/registry.ts)
shared/core/                deterministic core: hashing and PRNGs, deterministic maths,
                            simplex/fBm/ridged noise, point sampling, heap
shared/render/              camera (zoom/pan maths), colour helpers and pixel packing, progressive raster layer
shared/params/              parameter schema types and helpers, URL hash state
shared/ui/                  schema-driven parameter panel, HTML escaping, base theme (base.css)
shared/tests/               tests for the shared core
sandboxes/registry.ts       title, summary and status of every sandbox
sandboxes/<id>/             one sandbox: index.html, defaults.json, src/, tests/  → served at /sandboxes/<id>/
sandboxes/_template/        skeleton copied by the scaffold script (not built or listed)
scripts/new-sandbox.mjs     scaffolder
docs/research/              research notes behind the sandboxes
sandbox3.md                 the original spec of the three-level base map (used by Sandbox 4)
```

Import shared code with the `@shared/…` alias, for example `import { fbm } from '@shared/core/noise'`. Keep sandbox-specific code inside its own folder, and move something into `shared/` once a second sandbox needs it.

### Default settings

Every sandbox keeps its default settings in `sandboxes/<id>/defaults.json`: the default `seed` and the default value of every parameter in `params`, by key. Edit that file to change what a sandbox starts with. The parameter schema (`src/params.ts`) describes each parameter's label, range and options but holds no defaults. `bindDefaults` in `shared/params/schema.ts` attaches them when the page loads, and it throws if a parameter has no default, if a value has the wrong type, is out of range or is not one of the options, or if the file has a key that no parameter uses. Any of these makes the tests fail, so the file and the schema stay in step.

### Adding a sandbox

```bash
npm run new-sandbox -- sandbox5 "Sandbox 5 · <topic>"
```

This copies `sandboxes/_template` (parameter panel, seed and URL state, zoomable canvas, `defaults.json`) into `sandboxes/sandbox5/` and registers it as ready. Add each new parameter to both the schema and `defaults.json`. Vite picks up any `sandboxes/<id>/index.html` automatically. `sandboxes/registry.test.ts` fails if the pages and the registry disagree.

## Sandbox 4 · Terrain

An unbounded base map from three nested levels of Voronoi cells, with a **height map fitted to its rivers and biomes** and a **3D landscape view**. The base map follows the spec in [sandbox3.md](sandbox3.md). The height map follows "Option B" of [docs/research/heightmap-from-biomes-and-rivers.md](docs/research/heightmap-from-biomes-and-rivers.md).

### Base map

The world is unbounded and measured in metres. Every level is a stateless lattice Voronoi diagram (the Worley / Quilez construction: one site per lattice cell at a hashed offset, so a cell is a pure function of position), and every decision is a memoised pure function of the seed and a bounded neighbourhood. So you can pan anywhere, in any order, and get the same map. A test explores the map in two different orders, clearing the caches in between, and checks that both give the same result.

| Level | Default | Role |
|---|---|---|
| **Regions** | 128 km grid, no warp | Own the biomes whose site lies inside them. Pick **0–2 ocean seeds** and **2–4 biome merges** among them |
| **Biomes** | 32 km grid, border warp | The land/ocean unit (also meant for factions). Own their subbiomes and pick **2–4 subbiome merges**. Colours are cosmetic |
| **Subbiomes** | 8 km grid, border warp | Detail cells (sub-biomes, towns, ore, factions) |

| Area | Methods and parameters |
|---|---|
| **Oceans** | Seeds per region (min/max) → each seed **links** to its nearest other seed with a 40 % chance, or with a 5 % **double link** chance to its two nearest seeds, and every biome on the straight line between them turns into ocean, so chains of seeds join into one ocean → **growth**: every linked ocean biome converts its 3 / 2 / 1 / 0 closest land neighbours with chances 10 / 33 / 33 / 23 %. Options: link search radius, grow from linked or from all ocean biomes, and 0–4 growth passes (each later pass grows from the previous pass's new ocean) |
| **Merges** | Chosen cells join their nearest neighbour (Gabriel graph, by site distance). Chains merge into one cell, and cycles resolve to the smallest key. Biome merges stay on one side of the coast (optional); subbiome merges stay inside one biome |
| **Cells** | Grid size, jitter (0 = squares), border warp amplitude and frequency per level. **Nesting**: every point is classified through its subbiome, so biome and region borders, and coasts, follow subbiome cells. Turn it off to look each level up independently |
| **Rivers** | Space colonization (Runions et al., open venation), computed **per region**. A **root** sits at the site of every ocean biome that touches the region's land, so each river first crosses the water to the coast (that stretch is hidden unless *River paths over sea* is on); a landlocked region searches up to 4 biome steps out for the nearest ocean. Every land, **non-coastal subbiome** of the region gets **10 attraction points** inside its cell. Each step, every attractor pulls on its nearest node within the influence radius dᵢ; pulled nodes grow one step D towards the mean pull plus a configurable amount of **random motion** (a random unit vector, weight 0–2); attractors within the kill distance dₖ are reached. Growth runs **until every attractor in the region is reached**: a gap wider than dᵢ is bridged with a straight run, and a stalled node steps straight to its closest attractor. Each node counts the attractors it reached; summed upstream this **flow** sets the **line width** (∝ √flow). Options: attractors per subbiome, D, dᵢ, dₖ, random motion, skip coast subbiomes; display width, minimum flow and attractor points |

### Height map

The height map is computed in **tiles** of about 256 km (2 × 2 regions at the default size) on a raster with a 24 km halo. A Web Worker computes them while you look, nearest first, plus a ring of tiles just outside the view so that pans usually find them ready. A tile takes about a second at the default 1 km cells. The view computes at most 64 regions at 1 km (scaled by cell area); zoom in further to see the height.

| Step | Method |
|---|---|
| **River beds** | Steady-state stream-power law integrated upstream from the sea (the χ integral): each step adds `Δx · S₀ · factor(land type) · flow^−θ`. Beds rise strictly upstream, and big rivers are flatter. The gradient factor of each of the 13 land types is a setting. θ is ⅜, 7⁄16 or ½, computed with √ only (bit-exact) |
| **Hillslopes** | A geodesic distance (8-connected Dijkstra) from every river bed and the coast, with the hillslope steepness of each land type as the cost, so every cell drains to a river or the sea. Rivers get a flat **floodplain** whose half-width is a monotone cubic spline over the bed height, through 4 configurable points (wide in the lowlands, narrow in the mountains), optionally × √(flow/100). A slow, region-scale relief field makes mountain belts span several biomes. Land-type parameters are blended across biome borders |
| **Divides** | A ridge along region borders (rivers never cross them), and a smaller one where two river systems' basins meet. Both fade out near rivers |
| **Detail** | fbm or ridged noise per land type, masked to zero on the river beds |
| **Repair** | Rivers burnt in (AGREE: a trench plus a linear buffer), then an ε-Priority-Flood over each region's own land, seeded from the sea and the region border, so there are no pits |

The result is **seamless**. Steps 1–4 are a pure function of position, and the fill keeps each region's border cells. The tests check that a tile is bit-identical to computing each region separately, and that neighbouring rasters agree exactly along shared borders.

### Evaluating the map

- **Colour by:** cosmetic map, land & ocean, **ocean genesis** (lone seed, linked seed, link chain, growth pass), **merged cells**, regions, biomes, subbiomes, the hierarchy (region hue × biome lightness × subbiome shading), and **height** (hypsometric tint and hillshade). A **Hillshade** overlay works on any colour mode.
- **3D landscape** (`T`): a WebGL2 height mesh over the current view, draped with the 2D map (rivers and borders included). Drag to orbit, scroll to zoom, Shift- or right-drag to pan. Vertical exaggeration is a setting.
- **Overlays:** pixel-exact region, biome and subbiome borders and the coastline; rivers (width from flow), attractor points (unreached in red) and river roots; ocean seeds and links, growth arrows, merge arrows, sites per level, and a kilometre grid with the origin marked.
- **Inspector:** hover or click a point to see its region (owned biomes, seeds, links, merges), biome (genesis, merged group, neighbours, owned subbiomes), subbiome and the river under the cursor (flow here, whole river, root, the ocean biome it drains into). Click pins the biome and subbiome.
- **Ruler:** Shift+drag or `M` measures a straight-line distance, with travel days for a horse (32–48 km/day), a marching legion (24–32) and a long-distance hiker (16–24).
- **In view:** ocean share, cell counts, biomes per region, subbiomes per biome, seeds and links, ocean biomes by genesis, merged groups, rivers and attractors reached, render time, cache size, and a determinism fingerprint of a fixed window around the origin.
- **Sharing:** the URL hash also holds the camera. 10 presets and PNG export. Subbiomes smaller than ~3 px are skipped automatically.

Keyboard: `+`/`−` zoom · `0`/`H` origin · arrows pan · `R` random seed · `1`–`9` or `[`/`]` colour mode · `T` 3D landscape · `B` biome borders · `N` subbiome borders · `L` links · `W` growth · `J` merges · `V` rivers · `S` sites · `G` grid · `M` measure · `Esc` unpin · `?` help.

**Code map** (`sandboxes/sandbox4/`):

```
src/world/     level (stateless warped lattice Voronoi, Gabriel neighbours),
               world (regions, ocean seeds/links/growth, merges, nesting, caches),
               rivers (per-region space colonization: attractors, coastal roots, flow),
               terrain (river profiles and the per-tile height pipeline),
               terrain.worker (height tiles computed off the main thread)
src/render/    per-pixel raster source with borders per level, vector overlays and ruler,
               view3d (WebGL2 mesh, draped texture, orbit camera)
src/ui/        legend, level box, inspector, view statistics
src/params.ts  parameter schema and presets
tests/         nearest-site and neighbour checks, determinism and order independence, ocean and merge rules,
               rivers (attractor placement, every attractor reached, roots at ocean biome points, flow conservation),
               terrain (monotone beds, drainage of every cell, burnt-in rivers, seamless tiles, determinism)
```

## Research

The work builds on these notes in `docs/research/`:

| Note | Covers |
|---|---|
| [procedural-cell-generation.md](docs/research/procedural-cell-generation.md) | First survey: Voronoi / Delaunay partitions, square and hex grids, cellular automata, Wave Function Collapse, noise for cell attributes, and recommendations for the sandboxes |
| [readme-topics-gaps.md](docs/research/readme-topics-gaps.md) | Second pass: space colonization for river networks, distance functions, line networks from intersecting noise fields, deterministic noise in the browser, GitHub Pages delivery |
| [space-colonization-branch-variants.md](docs/research/space-colonization-branch-variants.md) | Knobs that change the branching and look of the space-colonization rivers |
| [heightmap-from-biomes-and-rivers.md](docs/research/heightmap-from-biomes-and-rivers.md) | Methods that fit a height map to an existing map and river network; Option B is implemented in Sandbox 4 |
| [sandbox4-tiling.md](docs/research/sandbox4-tiling.md) | Generating Sandbox 4 tile by tile; the terrain part (tiles in a Web Worker) is implemented |

## Deployment

`.github/workflows/deploy.yml` runs on every push to `main`: it runs the tests, builds, and publishes `dist/` to GitHub Pages. To set it up in a fork, go to **Settings → Pages → Source** in the repository and choose **GitHub Actions**. The build uses a relative base path, so it works under any repository name.
