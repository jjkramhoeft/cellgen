# cellgen

A Procedural Cell Generation Sandbox

## Tech

Should run in a browser

Be deployable from GitHub Pages

- TypeScript + Vite, no UI framework. The only runtime dependency is [Delaunator](https://github.com/mapbox/delaunator).
- Canvas 2D rendering. Generation runs on the CPU and is deterministic: the same seed and parameters give a bit-identical world in every browser.
- Deployed by `.github/workflows/deploy.yml`, which runs the tests, builds, and publishes `dist/` to GitHub Pages. In the repository settings, go to **Settings → Pages → Source** and choose **GitHub Actions**.

```bash
npm install
npm run dev      # http://localhost:5173 — landing page linking every sandbox
npm test         # vitest: shared core, every sandbox, and the sandbox registry
npm run build    # typecheck + multi-page production build into dist/
```

### Repository layout: multiple sandboxes

The repo is one Vite multi-page site: a landing page plus one page per sandbox, all built on a shared core.

```
index.html, landing/        landing page (lists sandboxes from sandboxes/registry.ts)
shared/core/                deterministic core: hashing + PRNGs, deterministic sin/cos/exp/log/pow,
                            simplex/fBm/warp noise, point sampling, spatial index + metrics, SDFs, heap
shared/render/              camera (zoom/pan maths), colour maps, progressive raster layer
shared/params/              parameter schema types + helpers, URL hash state
shared/ui/                  schema-driven parameter panel, base theme (base.css)
shared/tests/               tests for the shared core
sandboxes/registry.ts       title, summary and status of every sandbox
sandboxes/<id>/             one sandbox: index.html, src/, tests/  → served at /sandboxes/<id>/
sandboxes/_template/        skeleton copied by the scaffold script (not built or listed)
scripts/new-sandbox.mjs     scaffolder
```

Import shared code with the `@shared/…` alias (for example `import { fbm } from '@shared/core/noise'`). Keep sandbox-specific code inside its own folder; move something into `shared/` once a second sandbox needs it.

**Adding a sandbox**

```bash
npm run new-sandbox -- sandbox2 "Sandbox 2 · <topic>"
```

This copies `sandboxes/_template` (parameter panel, seed and URL state, zoomable canvas) into `sandboxes/sandbox2/` and marks its registry entry as ready. Vite discovers any `sandboxes/<id>/index.html` automatically, and `sandboxes/registry.test.ts` fails if a page and the registry disagree. Old links of the form `/#seed=…` are forwarded to Sandbox 1.

### Sandbox 1

Focus on Cell generation and the ability to configure params and methods and then visually evaluate the cells

Include zoom and pan on the resulting cells

**What is implemented** (left panel = methods and parameters, right panel = evaluation):

| Area | Methods and parameters |
|---|---|
| **Cell structure** | Voronoi mesh (Delaunator; corners at circumcenters or triangle centroids; Lloyd relaxation) · square grid (4/8 neighbours) · pointy-top hex grid (odd-r) · triangle grid · **distance-function cells**: per-pixel nearest site under L2 / L1 / L∞ / Minkowski Lp, with additive, multiplicative or power weights and domain-warped borders |
| **Site sampling** | Bridson Poisson disc (with variable density) · jittered square / hex lattice (jitter 0 gives perfect squares or hexagons) · Mitchell best-candidate · uniform · Vogel sunflower spiral · density maps (noise, radial, gradient) |
| **Elevation** | Hash-based simplex fBm · ridged multifractal · Quilez domain warping · FMG-style template blobs (hills, pits, ranges) · tectonic plates (convergent, divergent and transform boundaries) · SDF island masks (circle, rounded box, smooth union of circles, atoll, continent edge) · smoothing · sea level by area quantile · redistribution · terraces |
| **Erosion** | O'Leary-style flux erosion on the cell graph |
| **Climate** | Temperature from latitude, lapse rate and noise · moisture from a mapgen4 wind sweep (orographic rain, rain shadows), mapgen2 distance to water, or noise |
| **Hydrology** | Priority-Flood depression filling · steepest descent · flow accumulation · rivers · lakes · watersheds |
| **Biomes** | Whittaker-style temperature × moisture table |
| **Space colonization** | Runions et al. open variant growing river networks upstream from the coast (or the border, the centre, or random roots) · attraction-point density from moisture or elevation · D, dᵢ, dₖ · uphill tropism · Murray widths · Strahler order · optional valley carving via capsule SDFs |
| **Noise networks** | Zero isolines of 1–3 noise fields with gradient-normalised width · union gives a network, intersection gives junction dots · gating gives dead ends · per-cell membership and the exact raster band |
| **Cellular automata** | RogueBasin 4-5 cave rule generalised to any graph (wall fraction of the closed neighbourhood) · 2-ring hall fix · keep the largest cave |

**Evaluating the cells:**

- **Zoom and pan:** wheel, drag, pinch, double-click, keyboard, minimap and scale bar. Zoom in far enough and every cell is labelled with its value.
- **Colour by:** biomes, elevation, moisture, temperature, flux, watersheds, plates, CA state, network cells, coast distance, and cell-quality fields (area, neighbour count, compactness 4πA/P², site→centroid offset). There are also raster fields: Worley F1, F2, F2−F1, Quilez's exact border distance, the continuous elevation function before sampling, and the island-mask SDF.
- **Overlays:** cell edges, sites, centroids, Voronoi corners, adjacency (dual graph), sampling lattice, coastline, rivers, drainage arrows, colonization network, attraction points, plate boundaries and velocities.
- **Inspector:** hover shows every field of a cell. Click pins the cell and highlights its neighbours.
- **Statistics:** neighbour-count histogram, area CV, max/min area, compactness, land, lakes, rivers, per-stage timings, and a determinism fingerprint.
- **Compare A/B:** pin the current world, keep changing parameters, and drag a split line to compare both at the same camera position.
- **Sharing:** the seed and every non-default parameter live in the URL hash. You can also export PNG or JSON (cells, adjacency, polygons and fields) and start from 13 presets.

Keyboard: `+`/`−` zoom · `0`/`F` fit · arrows pan · `R` random seed · `E` edges · `[`/`]` cycle field · `C` compare · `Esc` unpin · `?` help.

**Code map** (`sandboxes/sandbox1/`):

```
src/graph/     CellGraph abstraction; grids, Voronoi (Delaunator), implicit distance cells
src/gen/       pipeline stages: elevation, plates, hydrology, climate, biomes,
               space colonization, noise networks, cellular automata
src/render/    colourisation, raster sources, vector + raster renderer
src/ui/        legend, inspector, statistics
src/params/    parameter schema and presets
tests/         geometry invariants, pipeline determinism, golden fingerprint
```

Every stage is written against the `CellGraph` interface (research §9.1), so every stage runs on every cell structure.

### Sandbox 2

Focus on Voronoi Cell generation

* Include minimum five different distance options
* Include zoom and pan on the resulting cells
* One use case is determaning water from land. The water/land ration should be variable
* Include a "fractal" version - with multiple (2-3) octaves of Voronoi cells

**What is implemented** (left panel = generation, right panel = display and analysis):

The cells are a stateless lattice Voronoi diagram, the Worley / Quilez construction. Each lattice cell holds one site at a hashed offset, so the diagram is a pure function of position. It needs no mesh, has no edge, and stays pixel-exact at any zoom. The nearest and second-nearest sites come from a ring search with Worley's pruning. One lower-bound factor per metric keeps that search exact for every distance function, jitter and weighting. The tests check this against brute force.

| Area | Methods and parameters |
|---|---|
| **Distance functions (8)** | Euclidean L2 · squared Euclidean (same cells, different F-values) · Manhattan L1 · Chebyshev L∞ · Minkowski Lp (p 0.3–8; below 1 gives star shards) · octagonal · hexagonal · triangular (asymmetric quasi-metric). All of them can be rotated and anisotropically stretched. Octaves 2+ can use a different metric |
| **Sites** | Cell size · jitter (0 = perfect squares) · additive or multiplicative per-site weights (squared Euclidean + additive = power diagram) |
| **Fractal octaves** | 1–4 layered Voronoi diagrams · lacunarity (cell-size ratio) · gain (octave weight) · per-octave domain warp that bends the cell borders |
| **Land & water** | Every cell takes a value from fBm or ridged noise at its site, plus per-cell randomness and an optional island / twin / atoll / west-coast shape. The field is the gain-weighted sum over octaves. The land/water threshold is the quantile that gives the **target land %** (0–100), so coastlines run along Voronoi edges at every scale. **Random oceans** shape: ⌈water % / 10⌉ random octave-1 cells seed oceans (≤ 10 % water → 1, 10–20 % → 2, …). A multi-source flood then turns neighbouring cells to water, cheapest first, until the water share is met; value noise and cell randomness set the flood cost. Finer octaves follow the octave-1 cell their site lies in |

**Evaluating the cells:**

- **Zoom and pan:** wheel, drag, pinch, double-click, keyboard, minimap and scale bar. Zoom goes from the whole map down to single pixels of the finest octave. A coarse preview renders first, then full resolution.
- **Colour by:** land & water (relief or flat), cell value, cell IDs, an octave mosaic, Worley F1, F2, F2−F1, F1/F2 and fractal F1 (Σ octaves). Overlays: cell edges (octave 1, all octaves or the selected one), coastline, sites, lattice grid and a cell bevel.
- **Distance probe:** under the cursor, the metric balls of radius F1 and F2. They touch the nearest and second-nearest sites, so you can see the metric's geometry.
- **Metric gallery:** the same seed and parameters rendered under all eight metrics, each with its unit ball. Click one to switch.
- **Inspector:** per-octave cell, F1, F2 and cell value, plus the field value, threshold and cells searched. Click pins a cell.
- **Statistics:** achieved vs target land %, islands, lakes, largest island, coastline length, the coastline's box-counting dimension, a value histogram with the threshold, cells per octave, search cost, timings and a determinism fingerprint.
- **Sharing:** the seed and every non-default parameter live in the URL hash. There are 13 presets and PNG export.

Keyboard: `+`/`−` zoom · `0`/`F` fit · arrows pan · `R` random seed · `M`/`Shift+M` next/previous metric · `[`/`]` colour mode · `1`–`4` octaves · `E` edges · `S` sites · `G` lattice · `P` probe · `Esc` unpin · `?` help.

**Code map** (`sandboxes/sandbox2/`):

```
src/voronoi/   metrics (8 distance functions + pruning bound), lattice (stateless Voronoi query),
               field (fractal octaves, cell values, land/water calibration), analysis (map statistics)
src/render/    per-pixel raster source (pixel-exact edges and coast), vector overlays and probe
src/ui/        legend, inspector, statistics, metric gallery
src/params.ts  parameter schema; src/presets.ts presets
tests/         metric invariants, brute-force search check for every metric, determinism, land ratio
```

### Sandbox 4

A base map built from Voronoi cells, with a **height map fitted to its rivers and biomes** and a **3D landscape view**. Three nested levels of cells decide land and ocean and give the map its cell structure (spec: [sandbox3.md](sandbox3.md)). The height map is computed on top of that map.

#### Base map

The world is unbounded and measured in metres. Every level is a stateless lattice Voronoi diagram, as in Sandbox 2, and every decision is a memoised pure function of the seed and a bounded neighbourhood. So you can pan anywhere, in any order, and get the same map. A test explores the map in two different orders, clearing the caches in between, and checks that both give the same result.

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
| **Rivers** | Space colonization (Runions et al., open venation), computed **per region**. A **root** sits at the point (site) of every ocean biome that touches the region's land, so each river first crosses the water to the coast (that stretch is hidden unless *River paths over sea* is on); a landlocked region searches up to 4 biome steps out for the nearest ocean. Every land, **non-coastal subbiome** of the region gets **10 attraction points** inside its cell. Each step, every attractor pulls on its nearest node within the influence radius dᵢ; pulled nodes grow one step D towards the mean pull plus a configurable amount of **random motion** (a random unit vector, weight 0–2); attractors within the kill distance dₖ are reached. Growth runs **until every attractor in the region is reached**: a gap wider than dᵢ is bridged with a straight run, and a stalled node steps straight to its closest attractor. Each node counts the attractors it reached; summed upstream this **flow** sets the **line width** (∝ √flow), and a river's root carries every attractor its tree reached. Options: attractors per subbiome, D, dᵢ, dₖ, random motion, skip coast subbiomes; display width, minimum flow and attractor points |

**Evaluating the map:**

- **Colour by:** cosmetic map, land & ocean, **ocean genesis** (lone seed, linked seed, link chain, growth pass), **merged cells**, regions, biomes, subbiomes, the hierarchy (region hue × biome lightness × subbiome shading), and height (see the height map below).
- **Overlays:** pixel-exact region, biome and subbiome borders and the coastline. Also rivers (width from flow), attractor points (unreached in red) and river roots, ocean seeds and links, growth arrows, merge arrows, sites per level, and a kilometre grid with the origin marked. Rivers are grown region by region while you look, and stay cached.
- **Rivers in the inspector and statistics:** the river under the cursor (flow here, whole river, root, the ocean biome it drains into); per region the rivers, attractors reached, iterations, nodes and compute time; in view the rivers, attractors reached, the largest river and the time per region.
- **Inspector:** hover or click a point to see its region (owned biomes, seeds, links, merges), biome (genesis, merged group, neighbours, owned subbiomes) and subbiome. Click pins the biome and subbiome.
- **Ruler:** Shift+drag or `M` measures a straight-line distance, with travel days for a horse (32–48 km/day), a marching legion (24–32) and a long-distance hiker (16–24).
- **In view:** ocean share, cell counts, biomes per region, subbiomes per biome, seeds and links, ocean biomes by genesis, merged groups, render time, cache size, and a determinism fingerprint of a fixed window around the origin.
- **Sharing:** the seed, every non-default parameter and the camera live in the URL hash. There are 10 presets and PNG export. Subbiomes smaller than ~3 px are skipped automatically.

Keyboard: `+`/`−` zoom · `0`/`H` origin · arrows pan · `R` random seed · `1`–`9` or `[`/`]` colour mode · `T` 3D landscape · `B` biome borders · `N` subbiome borders · `L` links · `W` growth · `J` merges · `V` rivers · `S` sites · `G` grid · `M` measure · `Esc` unpin · `?` help.

#### Height map

The height map implements "Option B" of [docs/research/heightmap-from-biomes-and-rivers.md](docs/research/heightmap-from-biomes-and-rivers.md). It is computed per region, on a raster with a 48 km margin, while you look.

| Step | Method |
|---|---|
| **River beds** | Steady-state stream-power law integrated upstream from the sea (the χ integral): each step adds `Δx · S₀ · factor(land type) · flow^−θ`. Beds rise strictly upstream; big rivers are flatter. The gradient factor of each of the 13 land types (now including **Mountains**) is a setting. θ is ⅜, 7⁄16 or ½, computed with √ only (bit-exact) |
| **Hillslopes** | A geodesic distance (8-connected Dijkstra) from every river bed and the coast, with the hillslope steepness of each land type as the cost, so every cell drains to a river or the sea. Rivers get a flat **floodplain** whose half-width is a monotone cubic spline over the bed height, through 4 configurable points (wide in the lowlands, narrow in the mountains), optionally × √(flow/100). A slow, region-scale relief field makes mountain belts span several biomes. Land-type parameters are blended across biome borders |
| **Divides** | A ridge along region borders (rivers never cross them), and a smaller one where two river systems' basins meet. Both fade out near rivers |
| **Detail** | fbm or ridged noise per land type, masked to zero on the river beds |
| **Repair** | Rivers burnt in (AGREE: a trench plus a linear buffer), then an ε-Priority-Flood over the region's own land, seeded from the sea and the region border, so there are no pits |

- **Seamless:** steps 1–4 are a pure function of position, and the fill keeps the border cells. A test checks that neighbouring regions' rasters agree exactly along their shared border.
- **Views:**
  - Colour by **Height** (hypsometric tint and hillshade), or a **Hillshade** overlay on any colour mode.
  - **3D landscape** (`T`): a WebGL2 height mesh over the current view, draped with the 2D map (rivers and borders included). Drag to orbit, scroll to zoom, Shift- or right-drag to pan. Vertical exaggeration is a setting.
- **Cost:** about 0.1 s per region at 2 km cells and 0.25 s at 1 km. The view computes at most 64 regions at 1 km, scaled by cell area; zoom in beyond that.

**Code map** (`sandboxes/sandbox4/`):

```
src/world/     level (stateless warped lattice Voronoi, Gabriel neighbours),
               world (regions, ocean seeds/links/growth, merges, nesting, caches),
               rivers (per-region space colonization: attractors, coastal roots, flow),
               terrain (river profiles and the per-region height pipeline),
               terrain.worker (height tiles computed off the main thread)
src/render/    per-pixel raster source with borders per level, vector overlays and ruler,
               view3d (WebGL2 mesh, draped texture, orbit camera)
src/ui/        legend, level box, inspector, view statistics
src/params.ts  parameter schema and presets
tests/         nearest-site and neighbour checks, determinism and order independence, ocean and merge rules,
               rivers (attractor placement, every attractor reached, roots at ocean biome points, flow conservation),
               terrain (monotone beds, drainage of every cell, burnt-in rivers, seamless borders, determinism)
```

## Research

* Deterministic Noise
* Voronoi Diagram
* Worley Noise
* Distance functions
* The Space Colonization Algorithm (and its usage to generate river networks)
* Using the intersection of two noise maps to generate lines/networks

See [docs/research/procedural-cell-generation.md](docs/research/procedural-cell-generation.md) and [docs/research/readme-topics-gaps.md](docs/research/readme-topics-gaps.md).
