# cellgen

Procedural world-map generation in the browser, built from Voronoi cells. The site has one sandbox, **Sandbox 4 · Terrain**: an unbounded, deterministic base map from three nested levels of Voronoi cells (regions, elevation zones, patches) with oceans, space-colonization rivers and lakes, a biome per patch (including coastal mangrove), resources per patch (crops, timber, fish, stone, salt, ores, luxuries) and city and town locations per region scored on them, and a travel network of roads, river routes and sea lanes between them, plus a height map fitted to it and a 3D landscape view. You set the parameters on the left and inspect the result on the right, with zoom, pan, an inspector and statistics.

**Live site:** <https://jjkramhoeft.github.io/cellgen/>

**Sandbox 5 · Map service** is the same generator in C#, behind a domain model and a REST API that delivers the map as PNG images and as JSON, with a demo site that pans, zooms and inspects it. It runs as a local service and is not part of the site: see [Sandbox 5](#sandbox-5--map-service-c).

Sandboxes 1 to 3 were earlier experiments and have been removed. Sandbox 4 contains everything from Sandbox 3; Sandboxes 1 and 2 remain in the git history.

## Goal

cellgen is a sandbox, prototype and research repo for a larger PC game. It explores new gameplay and generation algorithms for map-based generated worlds, using diffusion models and LLMs to populate huge worlds on demand. The first priority is an aesthetically pleasing and believable base map that can support the desired gameplay.

## Roadmap

The build follows this general order:

1. ✅ A structure that supports generation on demand: regions, elevation zones and patches
2. ✅ Rivers (impractical to add after the height, so they come first and drive the height)
3. ✅ Height (from rivers, regions and elevation zone types)
4. ✅ Climate (initial temperature and precipitation, cooled by height)
5. ✅ Biomes
6. ✅ Resources (the raw resources per patch; processed goods and the fantasy layer are not done yet)
7. ✅ City location candidates
8. ✅ Travel network (roads, river routes, sea lanes); trade itself is not done yet
9. Flora and fauna
10. Races
11. Wealth (only the prosperity map so far)
12. Factions
13. Rulers and leading families

**Resources (6) are in place in a first form**: every patch has its raw resources, and the city locations are scored on them ([Resources](#resources)). Still open under that step: the processed goods and the fantasy resources of the research notes (the supernatural map still feeds nothing). The next open items are trade itself (goods, prices and flows on the travel network, step 8) and flora and fauna (9).

## Getting started

Needs Node 22.12 or newer (the deploy workflow uses the current LTS).

```bash
npm install
npm run dev        # http://localhost:5173: landing page linking the sandbox
npm test           # vitest: shared core, the sandbox, and the sandbox registry (about 40 s)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + multi-page production build into dist/
npm run preview    # serve the built dist/ locally
```

Two more scripts write the default world to JSON, see [Exported data](#exported-data).

Sandbox 5 needs the .NET 10 SDK instead:

```bash
dotnet run --project sandboxes/sandbox5/src/Sandbox5.Api   # http://localhost:5250: demo site and REST API
dotnet test sandboxes/sandbox5                              # the C# tests (about 20 s)
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
shared/tests/               tests for the shared core and for the defaults binding
sandboxes/registry.ts       title, summary and status of every sandbox (the text on the landing page)
sandboxes/<id>/             one sandbox: index.html, defaults.json, src/, tests/  → served at /sandboxes/<id>/
sandboxes/sandbox5/         the C# map service: defaults.json, domain model, REST API, demo site, tests
                            (a .NET solution, not a page of the site; see sandboxes/sandbox5/README.md)
sandboxes/_template/        skeleton copied by the scaffold script (not built or listed)
scripts/new-sandbox.mjs     scaffolder
scripts/export-*.mjs, .ts   write the default map and travel network to docs/ as JSON (see Exported data),
                            and the golden data the Sandbox 5 tests compare with
docs/                       structure of the exported map and network (.md) and the exported JSON
docs/research/              research notes behind the sandboxes
sandbox3.md                 the original spec of the three-level base map (used by Sandbox 4)
.github/workflows/          test, build and deploy to GitHub Pages; the Sandbox 5 tests
.claude/launch.json         dev-server entries for the Claude Code preview (the site on port 5174, Sandbox 5 on 5250)
```

`sandbox3.md` and the exported data use older or longer names for two of the levels: the spec's *Biomes* and *Subbiomes* are today's **elevation zones** and **patches**, and the JSON calls a patch a `BiomePatch`.

Import shared code with the `@shared/…` alias, for example `import { fbm } from '@shared/core/noise'`. Keep sandbox-specific code inside its own folder, and move something into `shared/` once a second sandbox needs it.

### Default settings

Every sandbox keeps its default settings in `sandboxes/<id>/defaults.json`: the default `seed` and the default value of every parameter in `params`, by key. Edit that file to change what a sandbox starts with. The parameter schema (`src/params.ts`) describes each parameter's label, range and options but holds no defaults. `bindDefaults` in `shared/params/schema.ts` attaches them when the page loads, and it throws if a parameter has no default, if a value has the wrong type, is out of range or is not one of the options, or if the file has a key that no parameter uses. Any of these makes the tests fail, so the file and the schema stay in step.

`defaults.json` is tuned for how the map looks and changes often. The Sandbox 4 tests therefore do not run on the live defaults but on a frozen baseline (`sandboxes/sandbox4/tests/fixture.ts`), so retuning the defaults does not break them.

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
| **Elevation zones** | 32 km grid, border warp off (0) | The land/ocean unit (also meant for factions). Each is **ocean, flat, lowland, hills or mountains**; the land types are hashed per zone with weights 5 / 6 / 1 / 1 (biomes are per patch, see [Climate and biomes](#climate-and-biomes)). Own their patches and pick **2–4 patch merges** |
| **Patches** | 8 km grid, border warp 0.26 | Detail cells: each has a **biome**; also meant for towns, ore, factions |

With nesting on (the default), elevation zone and region borders follow the warped patch cells, so they look organic even though the zones themselves are not warped.

| Area | Methods and parameters |
|---|---|
| **Oceans** | Seeds per region (min/max) → each seed **links** to its nearest other seed with a 40 % chance, or with a 5 % **double link** chance to its two nearest seeds, and every elevation zone on the straight line between them turns into ocean, so chains of seeds join into one ocean → **growth**: every linked ocean elevation zone converts its 3 / 2 / 1 / 0 closest land neighbours with chances 10 / 33 / 33 / 23 %. Options: link search radius, grow from linked or from all ocean elevation zones, and 0–4 growth passes (each later pass grows from the previous pass's new ocean) |
| **Merges** | Chosen cells join their nearest neighbour (Gabriel graph, by site distance). Chains merge into one cell, and cycles resolve to the smallest key. Elevation zone merges stay on one side of the coast (optional); patch merges stay inside one elevation zone |
| **Cells** | Grid size, jitter (0 = squares), border warp amplitude and frequency per level. **Nesting**: every point is classified through its patch, so elevation zone and region borders, and coasts, follow patch cells. Turn it off to look each level up independently |
| **Rivers** | Space colonization (Runions et al., open venation), computed **per region**. A **root** sits at the site of every ocean elevation zone that touches the region's land, so each river first crosses the water to the coast (that stretch is hidden unless *River paths over sea* is on); a landlocked region searches up to 4 elevation zone steps out for the nearest ocean. Every land, **non-coastal patch** of the region gets **10 attraction points** inside its cell; a patch of a **river-poor flat** elevation zone (site precipitation below *Flat: sparse river precipitation cutoff*, about three quarters of the flat zones at the current defaults) gets only 0 or 1. Each step, every attractor pulls on its nearest node within the influence radius dᵢ; pulled nodes grow one step D towards the mean pull plus a configurable amount of **random motion** (a random unit vector, weight 0–2); attractors within the kill distance dₖ are reached. Five more knobs shape the branching ([space-colonization-branch-variants.md](docs/research/space-colonization-branch-variants.md)): **pull power** (equal pulls, or weighted by distance² or √distance), **inertia** (keep the current direction), a **perception cone** (120° by default: no hooking back), **wander** (the random motion carries over from step to step, for long bends) and **main-stem dominance** (weak side branches do not sprout). Growth runs **until every attractor in the region is reached**: a gap wider than dᵢ is bridged with a straight run, and a stalled node steps straight to its closest attractor. Each node counts the attractors it reached; summed upstream this **flow** sets the **line width** (∝ flow^b; b = 0.4 by default, ½ is the hydraulic-geometry value). Options: attractors per patch, D, dᵢ, dₖ, random motion, the five branching knobs, skip coast patches; display width, width exponent, minimum flow and attractor points |
| **Lakes** | Placed **per region after the rivers**, and **always on a river**: every patch drawn in the region that may hold a lake and has a river running through it (a land node with a flow of at least 4) gets one try with chance **frequency**, centred on one of its river nodes, so the river runs in and out of the lake. Lakes are shown with the rivers. No lakes in **ocean** or **mountains** elevation zones, in **desert** patches (hot or cold desert at sea level, the warmest and most arid a patch can be, so never where the map shows desert at any height) or in **restricted** patches (those of a **river-poor flat** elevation zone, whose site gets less initial precipitation than *Flat: sparse river precipitation cutoff*). A lake's nominal size (diameter) is drawn between the **minimum** and **maximum size**, favouring small lakes. Its outline is 64 rays: a randomly oriented ellipse (elongation 1–2.2) × (1 ± low-frequency fBm noise read on a small circle), so lakes range from round ponds over ovals to kidney and lobed shapes with a few broad bays. Each ray and each outline edge is walked and clipped to eligible land of the region, so a lake **never crosses a region border**; then the rays are tapered (neighbours differ by at most 9 % of the radius) and rounded, only ever shortening them, so clipped sides bend in gently instead of in notches. Lakes keep a gap from each other; one left below the minimum size (or squeezed against its centre) is dropped, one above the maximum is scaled down. Lakes do not depend on the terrain tiles, so they never change as tiles arrive; the height map does not level them (yet) |

### Height map

The height map is computed in **tiles** of about 256 km (2 × 2 regions at the default size) on a raster with a 24 km halo. A Web Worker computes them while you look, nearest first, plus a ring of tiles just outside the view so that pans usually find them ready. A tile takes half a second to a second at the default 1 km cells, the longer time when its rivers are not computed yet (the resolution can be 2 km, 1 km or 500 m). The view computes at most 64 regions at 1 km (scaled by cell area); zoom in further to see the height. Tiles are only computed while something needs them: the height or biome colours, the hillshade, the 3D view or the open Statistics section.

| Step | Method |
|---|---|
| **River beds** | Steady-state stream-power law integrated upstream from the sea (the χ integral): each step adds `Δx · S₀ · factor(zone type) · flow^−θ`. Beds rise strictly upstream, and big rivers are flatter. The gradient factor of each land elevation zone type (flat, lowland, hills, mountains) is a setting. θ is ⅜, 7⁄16 or ½, computed with √ only (bit-exact). With **Level flat zones** (on by default) an elevation zone whose gradient factor is below 1 sits at one level: the rivers entering it are lowered towards its lowest entry, which cuts gorges through the steeper land downstream |
| **Hillslopes** | A geodesic distance (8-connected Dijkstra) from every river bed and the coast, with the hillslope steepness of each elevation zone type as the cost, so every cell drains to a river or the sea. Rivers get a flat **floodplain** whose half-width is a monotone cubic spline over the bed height, through 4 configurable points (wide in the lowlands, narrow in the mountains), optionally × √(flow/100). A slow, region-scale relief field makes mountain belts span several elevation zones. Zone-type parameters are blended across elevation zone borders |
| **Divides** | A ridge along region borders (rivers never cross them), and a smaller one where two river systems' basins meet. Both fade out near rivers |
| **Detail** | fbm or ridged noise per elevation zone type, masked to zero on the river beds || **Repair** | Rivers burnt in (AGREE: a trench plus a linear buffer), then an ε-Priority-Flood over each region's own land, seeded from the sea and the region border, so there are no pits |

The sea floor simply deepens away from the coast, down to *Sea depth* (300 m) at 40 km and beyond.

The result is **seamless**. Steps 1–4 are a pure function of position, and the fill keeps each region's border cells. The tests check that a tile is bit-identical to computing each region separately, and that neighbouring rasters agree exactly along shared borders.

### Climate and biomes

The **initial climate** is two fBm Perlin-noise maps, independent of the map: temperature (−10 to 30 °C by default) and precipitation (100 to 12 000 mm per year on a log scale, so the middle is about 1 100 mm). Every land **patch** gets one **biome** from them, read at its site ([docs/research/biomes-and-climate.md](docs/research/biomes-and-climate.md) §7):

| Step | Method |
|---|---|
| **Height** | The mean height of the patch's land, recorded by its terrain tile. Until the tile is computed, a typical height for the elevation zone type stands in (flat 70 m, lowland 140 m, hills 270 m, mountains 470 m), and the inspector says so. These were the medians of the terrain at earlier defaults; at the current defaults the medians are about 80, 190, 330 and 580 m, so the stand-in runs a little low |
| **Temperature** | The initial temperature minus a **cooling curve** over that height: T = T₀ − cooling(h). The curve is a monotone spline through 5 configurable points (height → °C cooler), drawn live in the panel; it continues along its last slope above the highest point. The default points give the standard atmosphere's 6.5 °C per km |
| **Moisture** | The initial precipitation; in a **river-poor flat elevation zone** (site precipitation below *Flat: sparse river precipitation cutoff*) it is × 0.2 by default, so those zones favour **desert** (about half of their patches, against about 1 % elsewhere) |
| **Classify** | Aridity m = P / (20·T + 140), Köppen's dryness threshold for evenly spread rain (never below 40 mm, for cold air). A thermal belt (ice below −10 °C, tundra to −3, boreal to 3, temperate to 18, then tropical) × a moisture class (m < 0.5 cold or hot desert, 0.5–1 steppe or scrub, 1–2 woodland or savanna, then forest and, from m ≥ 6 temperate or ≥ 4 tropical, rainforest) picks one of 15 land biomes, from ice and tundra over taiga, temperate forests and grassland to hot desert, savanna and tropical rainforest |
| **Mangrove** | An azonal override: a **coastal** patch (one of its cells borders an ocean patch) in a **flat or lowland** elevation zone becomes **mangrove** when its temperature after the height cooling is at least *Mangrove: min temperature* (20 °C) and its aridity at least *Mangrove: min aridity* (0.5, so desert coasts stay bare). Never inland and never in hills or mountains; about 4 % of coastal patches at the defaults. Zoomed far out (elevation zones only) there is no mangrove |

**Colour by → Biomes** shows them in colours that look like the land (sand, dry grass, olive scrub, forest greens, grey tundra, white ice), slightly varied per patch. The biome view computes the terrain like the height view; zoomed far out each elevation zone shows the biome at its site. The inspector lists the biome with every input: belt, moisture class, aridity, height (exact or estimated), the temperature before and after the height cooling, the precipitation (and the dry-flat factor), whether it borders the ocean (and why it is or is not mangrove), and the biome the patch would have at sea level.

### Supernatural

A **supernatural map** is a third noise layer for fantasy game play: how strong magic is at every point (a unitless index, 0 to 100 by default), meant for magic resources and other supernatural features. It is the same fBm of Perlin noise as the climate, with its own seed and much finer features: **feature size 10 km, 3 octaves** (lacunarity 2, gain 0.5) by default, all configurable in the left panel (**Supernatural**). It does not feed anything yet. Turn on **Supernatural overlay** under Display to see it (near black = mundane, deep indigo → violet → magenta → glowing cyan = strong magic); the inspector shows its value under the cursor. A **prosperity map** (1 to 100, 200 km features) is built the same way; it sets how often gold, silver, gems and luxuries turn up among the [resources](#resources), and it is one of the five factors of the [city locations](#city-locations).

### Resources

Every patch gets an **amount from 0 to 1 for each of 24 raw resources**, and with it the **variant** that fits the patch best ("grain: barley", "timber: teak", "iron ore: bog iron"), as a pure function of the seed and the patch. A resource is **listed** for a patch from an amount of 0.25; a typical land patch lists about eight. This is the tier-1 set of [game-resources-and-trade.md](docs/research/game-resources-and-trade.md) §5.2, with variants and placement rules from the catalogue in [patch-resources.md](docs/research/patch-resources.md).

| Group | Resources |
|---|---|
| Food | Grain, produce, orchard, livestock, fish, wild food & game |
| Materials | Timber, stone, clay & earth, crystal, fibre |
| Fuel | Fuel |
| Salt | Salt |
| Metals | Iron ore, copper ore, tin, silver & lead, gold |
| Luxuries | Gems & pearls, spices & incense, stimulants & sugar, furs & ivory, dyes |
| Animals | Horses & pack animals |

There are two kinds:

- **Potentials** are what the land can yield; the amount is a suitability.
  - *Crops* (grain, produce, orchard, fibre, spices, stimulants, dyes): the best of a table of crops, each an ECOCROP trapezoid over the growing-season temperature and the yearly water (0 outside the crop's absolute limits, 1 inside its optimum), times the farmland of the zone type (field crops like flat ground, vines and tea like slopes), the soil of the biome (leached under rainforest, podzol under taiga) and the length of the growing season. A **river irrigates**: it adds 100 mm of water a year per patch it drains beyond the first (up to 1 200 mm), so desert rivers grow wheat and dates. The luxury crops grow only in some elevation zones (a hashed gate per crop and zone), which makes them regional specialities, and spices only in the tropical belt.
  - *The rest* (livestock, wild food, timber, clay, fuel, furs, horses, fish) come from tables by biome and zone type and from the water of the patch: coast and harbour, river size, a lake.
- **Deposits** are rare finds: stone, crystal, salt, the ores and gems. Each is a hashed draw per patch against a chance, and the amount is the richness of the deposit.
  - Every land elevation zone has one **bedrock** class (crystalline shield, fold belt, granite intrusion, volcanic arc, flood basalt, ophiolite, carbonate platform, clastic basin, unconsolidated cover), hashed by weight from its zone type: basins and loose cover under flat land, fold belts and volcanic arcs under mountains. The bedrock decides which stone, ores and gems its patches can hold. Copper and tin come from different classes, so **no zone has both** (bronze needs trade).
  - **Placers**: gold and tin wash down the rivers. Each river node knows the share of its upstream network that lies in gold-bearing or tin-bearing hills and mountains; where such a river reaches flatter ground, the patch may hold placer gold or stream tin.
  - **Salt is scarce**: solar pans on dry, warm, low coasts, salt flats in a few of the arid river-poor flat zones, rock salt and brine in a few of the clastic basins. At the defaults about half of the regions have none.

**Prosperity sets how often the valuable things turn up.** The [prosperity map](#supernatural) is read at the patch's site and taken from 0 (its minimum) to 1 (its maximum). The deposit chances of **gold, silver & lead and gems & pearls**, and the share of elevation zones in which a **luxury** grows or lives (spices, stimulants, dyes, furs and ivory; also murex, kermes and musk deer), are multiplied by **(2 × prosperity)²**: a quarter in poor land, 1 in the middle, 2.25 in rich land, 4 at the very top. So rich country is rich because it has gold, furs and spices, and poor country has few of them. Furs and ivory are regional like the other luxuries: at the middle of the prosperity map, half of the cold zones (taiga, tundra, cool forest, cold coasts) have fur animals worth trapping and three tenths of the hot zones have ivory, ostriches or big cats; from a prosperity of about 0.7 every cold zone has furs. Food, materials, fuel, salt, iron, copper and tin ignore prosperity, and so does honey, which every fitting patch has anyway. In the four regions of the exported map, the poorest third of the land patches holds 49 such finds, the middle third 66 and the richest third 115.

Ocean patches have fish, more on the shelf (next to land), and there seaweed, seals, pearls and coral by the water temperature (pearls, coral, seals and whales follow the prosperity too).

The resources read the rivers and lakes of the patch's region and its biome record. The city locations use them on zone-typical heights (so they never change as terrain tiles arrive); the inspector and the map export use the map's own biomes, at the exact patch height once its terrain tile is computed, so the resources fit the biome shown next to them.

Not done yet: the processed goods (tiers 2 and 3: iron, cloth, tools and so on), the fantasy resources on the supernatural map, quantities and populations, and a resource colour mode on the map (the inspector lists them per patch).

### City locations

Every region gets a list of about **20 potential city and town locations**, each with a combined **viability score** (0–100). This is the map-level part ("Tier M") of [settlement-siting.md](docs/research/settlement-siting.md) in a first, simpler form: a ranked list of scored sites, not yet a full settlement hierarchy with populations.

Every land patch of the region is a candidate and gets five factor scores, each 0–1, read from the map alone (rivers, lakes, zone types, climate, estimated biomes and the resources on them; no terrain tiles, so the list never changes as tiles arrive):

| Factor | Default weight | What it measures |
|---|---|---|
| **Resources** | 30 % | Read from the [resource layer](#resources): **food** of the catchment (grain, or roots and pulses at four fifths, plus herds, orchards and game; the patch counts twice, then its land neighbours; 45 % of the factor), **fresh water** (river, lake, humid climate; the coast counts half; 20 %), **building material and fuel** (timber, stone or clay, and fuel against what the thermal belt needs; a neighbour's count 0.7; 15 %), **fish** (10 %) and **trade goods** (salt, ores, gems, crystal, spices, stimulants, furs, dyes, horses and cash crops by value, the patch's own plus half of its best neighbour's; 10 %): what a town can specialise in |
| **Geography** | 15 % | Buildable ground (flat and lowland over hills and mountains; mangrove is swamp), a waterside site (river, harbour, coast, lake), defence (high ground, a peninsula, a confluence) and the depth inside the region (region borders are ridges) |
| **Trade & travel** | 25 % | The better of a **gateway** (river mouth, sheltered harbour, navigable river, head of navigation, confluence, lake: one dominant feature plus a quarter of the rest) and a **central place** (Hansen accessibility: how much of the region's food lies within a day or two of travel, over land by zone type and vegetation and faster along navigable rivers) |
| **Climate** | 15 % | Comfort of the temperature (at the zone type's typical height; best between 4 and 24 °C) and of the aridity |
| **Prosperity** (wealth) | 15 % | The prosperity map at the spot. It also reaches the score through the resources factor: prosperous land has more gold, silver, gems and luxuries, which count as trade goods |

**Viability = 100 × need × the weighted mean of the five factors.** `need` is the limiting necessity, min(fresh water, temperature comfort) × 2 capped at 1, so a site with no water or an unlivable temperature scores 0 whatever else it has. A river counts as navigable from 8 patches drained upstream and as large from 80.

**Selection**, inside one region (so it is order-independent): candidates need a score above 0 and must not touch another region's land, which keeps locations apart across region borders without reading the neighbour. First up to **4 cities**: the best scores that lie at least two patches inside the region and 2.5 × the spacing apart. Then **towns**, best first, each at least the **spacing** (20 km) from every location chosen so far. When that leaves fewer than 20, the spacing is relaxed step by step (down to one patch size) and the towns are picked again; regions with little habitable land end up with fewer. Each location sits on its patch's river (at the mouth, or where the river is largest, never in a lake) or else at the patch's site. The count, the number of cities, the spacing and the five weights are settings (left panel, **City & town locations**).

**Display → City & town locations** (`C`) draws them: cities as diamonds, towns as dots, coloured by viability (purple = poor, orange, pale yellow = excellent), with the score next to each when zoomed in. The **Location viability** slider hides every location below a score. The inspector shows a location's rank, score, the five factors with the terms behind each, and what stands out about it ("river mouth", "sheltered harbour", "central place", and a rich deposit on the patch such as "salt", "iron ore" or "gold"); over any other land patch it shows the same breakdown and why it is not a location.

Not done yet: the settlement hierarchy and populations, fall lines and bridging points (they need the river bed heights), and refining the spot on the height raster (the note's "Tier T"). Roads, river routes and sea lanes between the locations are the [travel network](#travel-network).

### Travel network

A **travel network** connects the cities and towns that are on show (those at or above the **Location viability** slider; zoomed far out, where only the cities are drawn, only the cities). Travel goes three ways:

| Kind | Where | Cost, in km of open flat road |
|---|---|---|
| **Road** | Any land | Per km: elevation zone type (flat 1, lowland 1.15, hills 1.8, **mountains 4**) × biome (grassland 1, forest 1.3, rainforest 2.2, mangrove 3, **deserts 3.5–4, ice 5**) × slope (1 + (slope / 5 %)², at most 13 ×) × height (twice at 1 500 m) × 8 across a lake; + 3 km to cross a navigable river |
| **River route** | Navigable rivers (8 patches drained upstream, as for the locations) | 0.4 per km, + 6 km at each end for loading |
| **Sea lane** | Open sea, from the harbour of every coastal location and through every river mouth up the navigable rivers | 0.3 per km (0.6 right at the shore, so lanes keep clear of capes), + 12 km at each end |

All of it runs on a **2 km grid** per region, which needs no terrain tile: heights are estimated the way the height map builds them, coarsely (river beds rise upstream from the sea by the stream-power law, the land rises from every river and the coast at its zone type's hillslope). So rivers are the valleys and region borders the ridges, as in the height map, and the network never changes as tiles arrive.

**Which places are linked.** Two shortest-path forests are grown over a region and its eight neighbours, one over land from every location and one over water from every location on a navigable river or the coast. Each cell ends up with its cheapest location, which is a Voronoi diagram under travel cost; two locations whose cells touch are neighbours, and their candidate link is the cheapest route through their common border. A link is then **dropped when cheaper links make a detour of at most 1.6 × its cost** (through other places, or the other kind of link between the same two); a road only gives way to a route that uses water when that costs at most 0.35 × the road, which is how a mountain road loses to the sea lane round it. Only the dearest link of a cycle is ever dropped, and the neighbour graph contains the minimum spanning tree, so whatever can be reached stays connected. Because loading costs are per link, short hops go by road and long hauls by water.

Every pair of regions has one owner (the smaller key of two neighbours, the region between two that are two apart), which decides the links between their locations from its own 3 × 3 regions, so the network does not depend on the order regions are computed in.

**Display → Travel network** (`P`) draws it: roads solid, river routes as short dashes along the river, sea lanes as long dashes, all heavier between two cities. **Travel routes** switches between **straight lines** from place to place and routes that **follow the terrain**: roads wind along valleys and over the lowest passes (the grid path, smoothed, drawn as a spline; the stretch several roads share out of a town is drawn once), river routes follow the river's own course, and sea lanes are pulled straight wherever the line of sight is open water.

Not done yet: trade itself (goods, prices, flows, see [game-resources-and-trade.md](docs/research/game-resources-and-trade.md)), road classes beyond city-to-city and the rest, bridges and fords as places, and routing on the real height raster.

### Evaluating the map

- **Colour by**, in menu order (keys `1`–`9`): map (elevation zone types), **biomes** (one per patch), land & ocean, **ocean genesis** (lone seed, linked seed, link chain, growth pass), **merged cells**, regions, elevation zones, patches, the hierarchy (region hue × elevation zone lightness × patch shading), and as the tenth **height** (hypsometric tint and hillshade; reach it with `]` or the menu). A **Hillshade** overlay works on any colour mode.
- **3D landscape** (`T`): a WebGL2 height mesh over the current view, draped with the 2D map (rivers and borders included). Drag to orbit, scroll to zoom, Shift- or right-drag to pan. Vertical exaggeration is a setting.
- **Overlays:** the noise maps (temperature, precipitation, prosperity, supernatural), each 50 % transparent with a legend bar; pixel-exact region, elevation zone and patch borders and the coastline; rivers (width from flow), attractor points (unreached in red) and river roots; lakes; **city and town locations** with a viability slider; the **travel network** between them (roads, river routes, sea lanes; straight lines or following the terrain); ocean seeds and links, growth arrows, merge arrows, sites per level, and a kilometre grid with the origin marked.
- **Inspector:** hover or click a point to see its region (owned elevation zones, seeds, links, merges), elevation zone (genesis, merged group, neighbours, owned patches), patch, its **biome** (with the temperature, precipitation, height and aridity that picked it), its **resources** (the bedrock of its zone, every listed resource with its variant and amount, and the food and trade goods the locations read), the river under the cursor (flow here, whole river, root, the ocean elevation zone it drains into) and the lake under the cursor (size, area, the river's flow, host patch); every patch says whether it may hold a lake, or why not; the **location** under the cursor, or the patch as a site (viability score and its five factors). Click pins the elevation zone and patch.
- **Ruler:** Shift+drag or `M` measures a straight-line distance, with travel days for a horse (32–48 km/day), a marching legion (24–32) and a long-distance hiker (16–24).
- **In view:** ocean share, cell counts, elevation zones per region, patches per elevation zone, seeds and links, ocean elevation zones by genesis, merged groups, rivers and attractors reached, render time, cache size, and a determinism fingerprint of a fixed window around the origin.
- **Statistics** (collapsed by default): how the map is spread, to spot under-represented biomes while tuning. The share of land per biome (in legend order or largest first, with biomes under 1 % of the land flagged as rare and missing ones listed), the share of each elevation zone type against its weight, a thermal belt × moisture class grid, and min / mean / max with histograms for temperature, precipitation and height; click a min or max to go there. Taken over the current view or over a fixed 2 048 km square at the origin, so that parameter changes compare like with like. Heights come only from tiles that are already computed.
- **Sharing:** the URL hash also holds the camera, and **Share link** copies it. 10 presets, PNG export of the current view, and **Reset** (all parameters back to the defaults, keeping the seed). Patches smaller than ~3 px are skipped automatically (**Detail** → always full detail turns that off).

Keyboard: `+`/`−` zoom · `0`/`H` origin · arrows pan · `R` random seed · `1`–`9` colour mode (the first nine) · `[`/`]` previous / next colour mode · `T` 3D landscape · `B` elevation zone borders · `N` patch borders · `L` links · `W` growth · `J` merges · `V` rivers on / off · `S` sites (cycles the levels) · `G` grid · `C` city and town locations · `P` travel network · `M` measure · `Esc` unpin · `?` help.

**Code map** (`sandboxes/sandbox4/`):

```
src/world/     level (stateless warped lattice Voronoi, Gabriel neighbours),
               world (regions, ocean seeds/links/growth, merges, nesting, caches),
               zones (elevation zone types: ocean, flat, lowland, hills, mountains),
               rivers (per-region space colonization: attractors, coastal roots, flow),
               lakes (per-region lakes after the rivers: eligibility, noise-shaped outlines, clip),
               locations (per-region city and town locations: five factor scores per patch, the resources one from the resource layer, combined viability, spaced selection),
               travel (2 km cost grid per region with estimated heights; per-region roads, river routes and sea lanes between the locations on show),
               terrain (river profiles and the per-tile height pipeline, mean height per patch),
               terrain.worker (height tiles computed off the main thread),
               climate (initial temperature and precipitation maps, prosperity and supernatural maps),
               biomes (height cooling curve, dry flat zones, aridity × thermal belt → biome per patch, coastal mangrove),
               resources (24 raw resources per patch: crop tables, biome tables, bedrock per zone, hashed deposits, river placers, prosperity for the precious and luxury ones),
               mapstats (time-sliced statistics over a rectangle: biomes, zone types, climate, heights)
src/render/    source (per-pixel raster source with borders per level, the colour modes),
               overlays (vector overlays: rivers, lakes, locations, travel network, seeds, arrows, grid, ruler),
               climate (raster sources and colour ramps of the four noise-map overlays),
               view3d (WebGL2 mesh, draped texture, orbit camera)
src/ui/        widgets (legend, level box, inspector, "In view" statistics, ruler readout),
               mapstats (the Statistics section)
src/main.ts    the page: state and URL, panels, camera, render loop, terrain worker, keyboard
src/params.ts  parameter schema, presets, and the mapping from parameters to each model's settings
tests/         fixture (the frozen parameter baseline the tests run on),
               world (nearest-site and neighbour checks, determinism and order independence, ocean and merge rules),
               rivers (attractor placement, every attractor reached, roots at ocean elevation zone points, flow conservation),
               terrain (monotone beds, drainage of every cell, burnt-in rivers, seamless tiles, determinism),
               zones (zone type picks and weights), climate (ranges, independence, supernatural feature size),
               biomes (belts and aridity classes, cooling curve, dry flat zones favour desert, tile heights,
                       coastal patches, mangrove only on warm, not-desert coasts of flat and lowland zones),
               lakes (only eligible land of their own region, on a river that runs through them, smooth outlines, sizes, no overlaps, frequency, varied shapes, determinism),
               resources (amounts and variants that fit biome, climate and position, irrigation, placers, bedrock by zone type, tin and copper apart, scarce salt, prosperity raising gold, silver, gems and luxuries and nothing else, furs by zone, ocean patches, determinism, exact heights),
               locations (about 20 per region, scores from five factors, the resources factor from the resource layer, own-region land off the border, spacing, order independence, weights, viability threshold),
               travel (one connected network, one owner per link, routes from place to place, roads off mountains and deserts, boats only from coasts and navigable rivers, order independence, threshold and cities-only),
               mapstats (every sample accounted for, the same in time slices as in one go, sampling stride, heights only from computed tiles)
```

### Exported data

Two scripts run the generator outside the browser, at the default seed and settings, and write the result to `docs/` as JSON, for use by other tools and as a reference of what the generator produces. Both are deterministic: the same defaults give the same file.

| Command | Writes | Described in |
|---|---|---|
| `npm run export-map` (10 to 20 s) | `docs/map-default-structure.json`: Region → ElevationZone → BiomePatch for the four regions that meet at the origin, with type and bedrock per zone and biome, climate, exact mean height, prosperity and **resources** per patch | [docs/map-structure.md](docs/map-structure.md) |
| `npm run export-network` (about 12 s) | `docs/network-default-structure.json`: the travel network of those four regions and the twelve around them as a graph, with cities and towns as nodes and roads, river routes and sea lanes as weighted links | [docs/network-structure.md](docs/network-structure.md) |

A node's `key` in the network file is the key of its patch in the map file. `docs/map-structure.json` is a small hand-written sample of the map structure, not generator output. Run both scripts again after changing `defaults.json` or the generator; nothing checks that the committed files are current.

## Sandbox 5 · Map service (C#)

The Sandbox 4 generator in C#, as a service ([sandboxes/sandbox5/README.md](sandboxes/sandbox5/README.md) has the details):

- **Domain model** (`Sandbox5.Domain`): `WorldMap` → `Region` → `ElevationZone` → `Patch`, with the biomes, resources, bedrocks and zone types as catalogues, and the rivers, lakes, city and town locations and the travel network per region. The generation layers are ports of `sandboxes/sandbox4/src/world` and give **bit-identical results**: the tests compare them with values from the TypeScript generator, down to every height cell, resource amount and travel route, and at Sandbox 4's defaults the C# exports equal `docs/map-default-structure.json` and `docs/network-default-structure.json`.
- **Settings** in `sandboxes/sandbox5/defaults.json`, in the format every sandbox uses and with **the same values as Sandbox 4's**: the seed and every generation parameter, plus the display defaults the images use. So it starts with the same map as Sandbox 4. The file is validated when it is loaded and re-read when it changes.
- **REST API** (`Sandbox5.Api`): map images as PNG (`/api/map/tiles/{z}/{x}/{y}.png` and `/api/map/image.png`, drawn like the Sandbox 4 canvas, with colour modes and layers as query parameters) and map data as JSON (`/api/map/at?x=&y=` for a point; a region with its zones and patches, rivers, lakes, locations and travel links; the two documented exports). `/api` lists everything.
- **Demo site** at the root of the service: a pan and zoom map of the tiles, a layer panel and legend, and an inspector that shows what the API knows about a clicked point.

```bash
dotnet run --project sandboxes/sandbox5/src/Sandbox5.Api   # then open http://localhost:5250
```

`npm run export-sandbox5-golden` regenerates the golden data of its tests from the TypeScript generator.

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
| [patch-resources.md](docs/research/patch-resources.md) | A catalogue of about 370 natural resources (food, building materials, wealth) and fantasy resources, keyed to the map's fields; how lakes, mangrove and the supernatural map plug in. Its potentials, deposits, bedrock classes and placer rule are implemented as the resources per patch |
| [game-resources-and-trade.md](docs/research/game-resources-and-trade.md) | How games choose, place and trade resources, trade theory, and a 39-resource set for the generator; its 24 raw resources are implemented |
| [settlement-siting.md](docs/research/settlement-siting.md) | Where villages, towns and cities form, and a deterministic siting design for the map (water from rivers and lakes, coasts, mangrove as poor farmland); its map-level scoring is implemented in a first form as the city and town locations |

## Deployment

`.github/workflows/deploy.yml` runs on every push to `main`: it runs the tests, builds, and publishes `dist/` to GitHub Pages. Sandbox 5 is not deployed; `.github/workflows/sandbox5.yml` runs its tests when its files change. To set it up in a fork, go to **Settings → Pages → Source** in the repository and choose **GitHub Actions**. The build uses a relative base path, so it works under any repository name.
