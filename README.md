# cellgen

Procedural world-map generation in the browser, built from Voronoi cells. The site has one sandbox, **Sandbox 4 · Terrain**: an unbounded, deterministic base map from three nested levels of Voronoi cells (regions, elevation zones, patches) with oceans, space-colonization rivers and lakes, a biome per patch (including coastal mangrove) and scored city and town locations per region and a travel network of roads, river routes and sea lanes between them, plus a height map fitted to it and a 3D landscape view. You set the parameters on the left and inspect the result on the right, with zoom, pan, an inspector and statistics.

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

An unbounded base map from three nested levels of Voronoi cells, with a **height map fitted to its rivers and elevation zones** and a **3D landscape view**. The base map follows the spec in [sandbox3.md](sandbox3.md). The height map follows "Option B" of [docs/research/heightmap-from-biomes-and-rivers.md](docs/research/heightmap-from-biomes-and-rivers.md).

### Base map

The world is unbounded and measured in metres. Every level is a stateless lattice Voronoi diagram (the Worley / Quilez construction: one site per lattice cell at a hashed offset, so a cell is a pure function of position), and every decision is a memoised pure function of the seed and a bounded neighbourhood. So you can pan anywhere, in any order, and get the same map. A test explores the map in two different orders, clearing the caches in between, and checks that both give the same result.

| Level | Default | Role |
|---|---|---|
| **Regions** | 128 km grid, no warp | Own the elevation zones whose site lies inside them. Pick **0–2 ocean seeds** and **2–4 elevation zone merges** among them |
| **Elevation zones** | 32 km grid, border warp | The land/ocean unit (also meant for factions). Each is **ocean, flat, lowland, hills or mountains**; the land types are hashed per zone with weights 5 / 6 / 1 / 1 (biomes are per patch, see [Climate and biomes](#climate-and-biomes)). Own their patches and pick **2–4 patch merges** |
| **Patches** | 8 km grid, border warp | Detail cells: each has a **biome**; also meant for towns, ore, factions |

| Area | Methods and parameters |
|---|---|
| **Oceans** | Seeds per region (min/max) → each seed **links** to its nearest other seed with a 40 % chance, or with a 5 % **double link** chance to its two nearest seeds, and every elevation zone on the straight line between them turns into ocean, so chains of seeds join into one ocean → **growth**: every linked ocean elevation zone converts its 3 / 2 / 1 / 0 closest land neighbours with chances 10 / 33 / 33 / 23 %. Options: link search radius, grow from linked or from all ocean elevation zones, and 0–4 growth passes (each later pass grows from the previous pass's new ocean) |
| **Merges** | Chosen cells join their nearest neighbour (Gabriel graph, by site distance). Chains merge into one cell, and cycles resolve to the smallest key. Elevation zone merges stay on one side of the coast (optional); patch merges stay inside one elevation zone |
| **Cells** | Grid size, jitter (0 = squares), border warp amplitude and frequency per level. **Nesting**: every point is classified through its patch, so elevation zone and region borders, and coasts, follow patch cells. Turn it off to look each level up independently |
| **Rivers** | Space colonization (Runions et al., open venation), computed **per region**. A **root** sits at the site of every ocean elevation zone that touches the region's land, so each river first crosses the water to the coast (that stretch is hidden unless *River paths over sea* is on); a landlocked region searches up to 4 elevation zone steps out for the nearest ocean. Every land, **non-coastal patch** of the region gets **10 attraction points** inside its cell. Each step, every attractor pulls on its nearest node within the influence radius dᵢ; pulled nodes grow one step D towards the mean pull plus a configurable amount of **random motion** (a random unit vector, weight 0–2); attractors within the kill distance dₖ are reached. Growth runs **until every attractor in the region is reached**: a gap wider than dᵢ is bridged with a straight run, and a stalled node steps straight to its closest attractor. Each node counts the attractors it reached; summed upstream this **flow** sets the **line width** (∝ √flow). Options: attractors per patch, D, dᵢ, dₖ, random motion, skip coast patches; display width, minimum flow and attractor points |
| **Lakes** | Placed **per region after the rivers**, and **always on a river**: every patch drawn in the region that may hold a lake and has a river running through it (a land node with a flow of at least 4) gets one try with chance **frequency**, centred on one of its river nodes, so the river runs in and out of the lake. Lakes are shown with the rivers. No lakes in **ocean** or **mountains** elevation zones, in **desert** patches (hot or cold desert at sea level, the warmest and most arid a patch can be, so never where the map shows desert at any height) or in **restricted** patches (those of a **river-poor flat** elevation zone, whose site gets less initial precipitation than *Flat: sparse river precipitation cutoff*). A lake's nominal size (diameter) is drawn between the **minimum** and **maximum size**, favouring small lakes. Its outline is 64 rays: a randomly oriented ellipse (elongation 1–2.2) × (1 ± low-frequency fBm noise read on a small circle), so lakes range from round ponds over ovals to kidney and lobed shapes with a few broad bays. Each ray and each outline edge is walked and clipped to eligible land of the region, so a lake **never crosses a region border**; then the rays are tapered (neighbours differ by at most 9 % of the radius) and rounded, only ever shortening them, so clipped sides bend in gently instead of in notches. Lakes keep a gap from each other; one left below the minimum size (or squeezed against its centre) is dropped, one above the maximum is scaled down. Lakes do not depend on the terrain tiles, so they never change as tiles arrive; the height map does not level them (yet) |

### Height map

The height map is computed in **tiles** of about 256 km (2 × 2 regions at the default size) on a raster with a 24 km halo. A Web Worker computes them while you look, nearest first, plus a ring of tiles just outside the view so that pans usually find them ready. A tile takes about a second at the default 1 km cells. The view computes at most 64 regions at 1 km (scaled by cell area); zoom in further to see the height.

| Step | Method |
|---|---|
| **River beds** | Steady-state stream-power law integrated upstream from the sea (the χ integral): each step adds `Δx · S₀ · factor(zone type) · flow^−θ`. Beds rise strictly upstream, and big rivers are flatter. The gradient factor of each land elevation zone type (flat, lowland, hills, mountains) is a setting. θ is ⅜, 7⁄16 or ½, computed with √ only (bit-exact) |
| **Hillslopes** | A geodesic distance (8-connected Dijkstra) from every river bed and the coast, with the hillslope steepness of each elevation zone type as the cost, so every cell drains to a river or the sea. Rivers get a flat **floodplain** whose half-width is a monotone cubic spline over the bed height, through 4 configurable points (wide in the lowlands, narrow in the mountains), optionally × √(flow/100). A slow, region-scale relief field makes mountain belts span several elevation zones. Zone-type parameters are blended across elevation zone borders |
| **Divides** | A ridge along region borders (rivers never cross them), and a smaller one where two river systems' basins meet. Both fade out near rivers |
| **Detail** | fbm or ridged noise per elevation zone type, masked to zero on the river beds |
| **Repair** | Rivers burnt in (AGREE: a trench plus a linear buffer), then an ε-Priority-Flood over each region's own land, seeded from the sea and the region border, so there are no pits |

The result is **seamless**. Steps 1–4 are a pure function of position, and the fill keeps each region's border cells. The tests check that a tile is bit-identical to computing each region separately, and that neighbouring rasters agree exactly along shared borders.

### Climate and biomes

The **initial climate** is two fBm Perlin-noise maps, independent of the map: temperature (−10 to 30 °C by default) and precipitation (100 to 12 000 mm per year on a log scale, so the middle is about 1 100 mm). Every land **patch** gets one **biome** from them, read at its site ([docs/research/biomes-and-climate.md](docs/research/biomes-and-climate.md) §7):

| Step | Method |
|---|---|
| **Height** | The mean height of the patch's land, recorded by its terrain tile. Until the tile is computed, a typical height for the elevation zone type stands in (flat 70 m, lowland 140 m, hills 270 m, mountains 470 m: the medians of the default terrain), and the inspector says so |
| **Temperature** | The initial temperature minus a **cooling curve** over that height: T = T₀ − cooling(h). The curve is a monotone spline through 5 configurable points (height → °C cooler), drawn live in the panel; it continues along its last slope above the highest point. The default points give the standard atmosphere's 6.5 °C per km |
| **Moisture** | The initial precipitation; in a **river-poor flat elevation zone** (site precipitation below *Flat: sparse river precipitation cutoff*) it is × 0.2 by default, so those zones favour **desert** (about two thirds of their patches, against a few percent elsewhere) |
| **Classify** | Aridity m = P / (20·T + 140), Köppen's dryness threshold for evenly spread rain. A thermal belt (ice below −10 °C, tundra to −3, boreal to 3, temperate to 18, then tropical) × a moisture class (m < 0.5 cold or hot desert, 0.5–1 steppe or scrub, 1–2 woodland or savanna, then forest and, from m ≥ 6 temperate or ≥ 4 tropical, rainforest) picks one of 15 land biomes, from ice and tundra over taiga, temperate forests and grassland to hot desert, savanna and tropical rainforest |
| **Mangrove** | An azonal override: a **coastal** patch (one of its cells borders an ocean patch) in a **flat or lowland** elevation zone becomes **mangrove** when its temperature after the height cooling is at least *Mangrove: min temperature* (20 °C) and its aridity at least *Mangrove: min aridity* (0.5, so desert coasts stay bare). Never inland and never in hills or mountains; about 5 % of coastal patches at the defaults. Zoomed far out (elevation zones only) there is no mangrove |

**Colour by → Biomes** shows them in colours that look like the land (sand, dry grass, olive scrub, forest greens, grey tundra, white ice), slightly varied per patch. The biome view computes the terrain like the height view; zoomed far out each elevation zone shows the biome at its site. The inspector lists the biome with every input: belt, moisture class, aridity, height (exact or estimated), the temperature before and after the height cooling, the precipitation (and the dry-flat factor), whether it borders the ocean (and why it is or is not mangrove), and the biome the patch would have at sea level.

### Supernatural

A **supernatural map** is a third noise layer for fantasy game play: how strong magic is at every point (a unitless index, 0 to 100 by default), meant for magic resources and other supernatural features. It is the same fBm of Perlin noise as the climate, with its own seed and much finer features: **feature size 10 km, 3 octaves** (lacunarity 2, gain 0.5) by default, all configurable in the left panel (**Supernatural**). It does not feed anything yet. Turn on **Supernatural overlay** under Display to see it (near black = mundane, deep indigo → violet → magenta → glowing cyan = strong magic); the inspector shows its value under the cursor. A **prosperity map** (1 to 100, 200 km features) is built the same way; it is one of the five factors of the [city locations](#city-locations).

### Resources

For each patch a set of resources are calcutated (Ore, Minirals, Fish, Wood, Farmable land etc.)

Not done yet. Research: [patch-resources.md](docs/research/patch-resources.md) (catalogue keyed to the map's fields, including lakes, mangrove and the supernatural map) and [game-resources-and-trade.md](docs/research/game-resources-and-trade.md) (a game resource set).

### City Locations

Every region gets a list of about **20 potential city and town locations**, each with a combined **viability score** (0–100). This is the map-level part ("Tier M") of [settlement-siting.md](docs/research/settlement-siting.md) in a first, simpler form: a ranked list of scored sites, not yet a full settlement hierarchy with populations.

Every land patch of the region is a candidate and gets five factor scores, each 0–1, read from the map alone (rivers, lakes, zone types, climate, estimated biomes; no terrain tiles, so the list never changes as tiles arrive):

| Factor | Default weight | What it measures |
|---|---|---|
| **Resources** | 30 % | Food of the catchment (farmland by biome and zone type, river irrigation where the climate is dry; the patch and its neighbours), fresh water (river, lake, humid climate; the coast counts half), building material and fuel (wood, stone in hills and mountains, river clay) and fish (coast, harbour, large river, lake). The resource layer does not exist yet, so these come from the biome and zone tables of the research note |
| **Geography** | 15 % | Buildable ground (flat and lowland over hills and mountains; mangrove is swamp), a waterside site (river, harbour, coast, lake), defence (high ground, a peninsula, a confluence) and the depth inside the region (region borders are ridges) |
| **Trade & travel** | 25 % | The better of a **gateway** (river mouth, sheltered harbour, navigable river, head of navigation, confluence, lake: one dominant feature plus a quarter of the rest) and a **central place** (Hansen accessibility: how much of the region's food lies within a day or two of travel, over land by zone type and vegetation and faster along navigable rivers) |
| **Climate** | 15 % | Comfort of the temperature (at the zone type's typical height; best between 4 and 24 °C) and of the aridity |
| **Prosperity** (wealth) | 15 % | The prosperity map at the spot |

**Viability = 100 × need × the weighted mean of the five factors.** `need` is the limiting necessity, min(fresh water, temperature comfort) × 2 capped at 1, so a site with no water or an unlivable temperature scores 0 whatever else it has. A river counts as navigable from 20 patches drained upstream and as large from 80.

**Selection**, inside one region (so it is order-independent): candidates need a score above 0 and must not touch another region's land, which keeps locations apart across region borders without reading the neighbour. First up to **4 cities**: the best scores that lie at least two patches inside the region and 2.5 × the spacing apart. Then **towns**, best first, each at least the **spacing** (20 km) from every location chosen so far. When that leaves fewer than 20, the spacing is relaxed step by step (down to one patch size) and the towns are picked again; regions with little habitable land end up with fewer. Each location sits on its patch's river (at the mouth, or where the river is largest, never in a lake) or else at the patch's site. The count, the number of cities, the spacing and the five weights are settings (left panel, **City & town locations**).

**Display → City & town locations** (`C`) draws them: cities as diamonds, towns as dots, coloured by viability (purple = poor, orange, pale yellow = excellent), with the score next to each when zoomed in. The **Location viability** slider hides every location below a score. The inspector shows a location's rank, score, the five factors with the terms behind each, and what stands out about it ("river mouth", "sheltered harbour", "central place", …); over any other land patch it shows the same breakdown and why it is not a location.

Not done yet: the settlement hierarchy and populations, fall lines and bridging points (they need the river bed heights), and refining the spot on the height raster (the note's "Tier T"). Roads, river routes and sea lanes between the locations are the [trade network](#trade-network).

### Trade network

A **travel network** connects the cities and towns that are on show (those at or above the **Location viability** slider; zoomed far out, where only the cities are drawn, only the cities). Travel goes three ways:

| Kind | Where | Cost, in km of open flat road |
|---|---|---|
| **Road** | Any land | Per km: elevation zone type (flat 1, lowland 1.15, hills 1.8, **mountains 4**) × biome (grassland 1, forest 1.3, rainforest 2.2, mangrove 3, **deserts 3.5–4, ice 5**) × slope (1 + (slope / 5 %)², at most 13 ×) × height (twice at 1 500 m) × 8 across a lake; + 3 km to cross a navigable river |
| **River route** | Navigable rivers (20 patches drained upstream, as for the locations) | 0.4 per km, + 6 km at each end for loading |
| **Sea lane** | Open sea, from the harbour of every coastal location and through every river mouth up the navigable rivers | 0.3 per km (0.6 right at the shore, so lanes keep clear of capes), + 12 km at each end |

All of it runs on a **2 km grid** per region, which needs no terrain tile: heights are estimated the way the height map builds them, coarsely (river beds rise upstream from the sea by the stream-power law, the land rises from every river and the coast at its zone type's hillslope). So rivers are the valleys and region borders the ridges, as in the height map, and the network never changes as tiles arrive.

**Which places are linked.** Two shortest-path forests are grown over a region and its eight neighbours, one over land from every location and one over water from every location on a navigable river or the coast. Each cell ends up with its cheapest location, which is a Voronoi diagram under travel cost; two locations whose cells touch are neighbours, and their candidate link is the cheapest route through their common border. A link is then **dropped when cheaper links make a detour of at most 1.6 × its cost** (through other places, or the other kind of link between the same two); a road only gives way to a route that uses water when that costs at most 0.35 × the road, which is how a mountain road loses to the sea lane round it. Only the dearest link of a cycle is ever dropped, and the neighbour graph contains the minimum spanning tree, so whatever can be reached stays connected. Because loading costs are per link, short hops go by road and long hauls by water.

Every pair of regions has one owner (the smaller key of two neighbours, the region between two that are two apart), which decides the links between their locations from its own 3 × 3 regions, so the network does not depend on the order regions are computed in.

**Display → Travel network** (`P`) draws it: roads solid, river routes as short dashes along the river, sea lanes as long dashes, all heavier between two cities. **Travel routes** switches between **straight lines** from place to place and routes that **follow the terrain**: roads wind along valleys and over the lowest passes (the grid path, smoothed, drawn as a spline; the stretch several roads share out of a town is drawn once), river routes follow the river's own course, and sea lanes are pulled straight wherever the line of sight is open water.

Not done yet: trade itself (goods, prices, flows, see [game-resources-and-trade.md](docs/research/game-resources-and-trade.md)), road classes beyond city-to-city and the rest, bridges and fords as places, and routing on the real height raster.

### Evaluating the map

- **Colour by:** map (elevation zone types), land & ocean, **ocean genesis** (lone seed, linked seed, link chain, growth pass), **merged cells**, regions, elevation zones, patches, the hierarchy (region hue × elevation zone lightness × patch shading), **biomes** (one per patch), and **height** (hypsometric tint and hillshade). A **Hillshade** overlay works on any colour mode.
- **3D landscape** (`T`): a WebGL2 height mesh over the current view, draped with the 2D map (rivers and borders included). Drag to orbit, scroll to zoom, Shift- or right-drag to pan. Vertical exaggeration is a setting.
- **Overlays:** the noise maps (temperature, precipitation, prosperity, supernatural), each 50 % transparent with a legend bar; pixel-exact region, elevation zone and patch borders and the coastline; rivers (width from flow), attractor points (unreached in red) and river roots; lakes; **city and town locations** with a viability slider; the **travel network** between them (roads, river routes, sea lanes; straight lines or following the terrain); ocean seeds and links, growth arrows, merge arrows, sites per level, and a kilometre grid with the origin marked.
- **Inspector:** hover or click a point to see its region (owned elevation zones, seeds, links, merges), elevation zone (genesis, merged group, neighbours, owned patches), patch, its **biome** (with the temperature, precipitation, height and aridity that picked it) the river under the cursor (flow here, whole river, root, the ocean elevation zone it drains into) and the lake under the cursor (size, area, the river's flow, host patch); every patch says whether it may hold a lake, or why not; the **location** under the cursor, or the patch as a site (viability score and its five factors). Click pins the elevation zone and patch.
- **Ruler:** Shift+drag or `M` measures a straight-line distance, with travel days for a horse (32–48 km/day), a marching legion (24–32) and a long-distance hiker (16–24).
- **In view:** ocean share, cell counts, elevation zones per region, patches per elevation zone, seeds and links, ocean elevation zones by genesis, merged groups, rivers and attractors reached, render time, cache size, and a determinism fingerprint of a fixed window around the origin.
- **Sharing:** the URL hash also holds the camera. 10 presets and PNG export. Patches smaller than ~3 px are skipped automatically.

Keyboard: `+`/`−` zoom · `0`/`H` origin · arrows pan · `R` random seed · `1`–`9` or `[`/`]` colour mode · `T` 3D landscape · `B` elevation zone borders · `N` patch borders · `L` links · `W` growth · `J` merges · `V` rivers · `S` sites · `G` grid · `C` city and town locations · `P` travel network · `M` measure · `Esc` unpin · `?` help.

**Code map** (`sandboxes/sandbox4/`):

```
src/world/     level (stateless warped lattice Voronoi, Gabriel neighbours),
               world (regions, ocean seeds/links/growth, merges, nesting, caches),
               zones (elevation zone types: ocean, flat, lowland, hills, mountains),
               rivers (per-region space colonization: attractors, coastal roots, flow),
               lakes (per-region lakes after the rivers: eligibility, noise-shaped outlines, clip),
               locations (per-region city and town locations: five factor scores per patch, combined viability, spaced selection),
               travel (2 km cost grid per region with estimated heights; per-region roads, river routes and sea lanes between the locations on show),
               terrain (river profiles and the per-tile height pipeline, mean height per patch),
               terrain.worker (height tiles computed off the main thread),
               climate (initial temperature and precipitation maps, prosperity and supernatural maps),
               biomes (height cooling curve, dry flat zones, aridity × thermal belt → biome per patch, coastal mangrove)
src/render/    per-pixel raster source with borders per level, vector overlays and ruler,
               view3d (WebGL2 mesh, draped texture, orbit camera)
src/ui/        legend, level box, inspector, view statistics
src/params.ts  parameter schema and presets
tests/         nearest-site and neighbour checks, determinism and order independence, ocean and merge rules,
               rivers (attractor placement, every attractor reached, roots at ocean elevation zone points, flow conservation),
               terrain (monotone beds, drainage of every cell, burnt-in rivers, seamless tiles, determinism),
               zones (zone type picks and weights), climate (ranges, independence, supernatural feature size),
               biomes (belts and aridity classes, cooling curve, dry flat zones favour desert, tile heights,
                       coastal patches, mangrove only on warm, not-desert coasts of flat and lowland zones),
               lakes (only eligible land of their own region, on a river that runs through them, smooth outlines, sizes, no overlaps, frequency, varied shapes, determinism),
               locations (about 20 per region, scores from five factors, own-region land off the border, spacing, order independence, weights, viability threshold),
               travel (one connected network, one owner per link, routes from place to place, roads off mountains and deserts, boats only from coasts and navigable rivers, order independence, threshold and cities-only)
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
| [biomes-and-climate.md](docs/research/biomes-and-climate.md) | Biome schemes (Whittaker, Holdridge, Köppen, WWF), aridity, lapse rates; its aridity × thermal belt classifier, height cooling and the mangrove override are implemented |
| [patch-resources.md](docs/research/patch-resources.md) | A catalogue of about 370 natural resources (food, building materials, wealth) and fantasy resources, keyed to the map's fields; how lakes, mangrove and the supernatural map plug in |
| [game-resources-and-trade.md](docs/research/game-resources-and-trade.md) | How games choose, place and trade resources, trade theory, and a 37-resource set for the generator |
| [settlement-siting.md](docs/research/settlement-siting.md) | Where villages, towns and cities form, and a deterministic siting design for the map (water from rivers and lakes, coasts, mangrove as poor farmland); its map-level scoring is implemented in a first form as the city and town locations |

## Deployment

`.github/workflows/deploy.yml` runs on every push to `main`: it runs the tests, builds, and publishes `dist/` to GitHub Pages. To set it up in a fork, go to **Settings → Pages → Source** in the repository and choose **GitHub Actions**. The build uses a relative base path, so it works under any repository name.
