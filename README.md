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

Future work - not defined yet.

## Research

* Deterministic Noise
* Voronoi Diagram
* Worley Noise
* Distance functions
* The Space Colonization Algorithm (and its usage to generate river networks)
* Using the intersection of two noise maps to generate lines/networks

See [docs/research/procedural-cell-generation.md](docs/research/procedural-cell-generation.md) and [docs/research/readme-topics-gaps.md](docs/research/readme-topics-gaps.md).
