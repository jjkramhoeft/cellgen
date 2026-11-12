# Sandbox 5 · Map service (C#)

The cellgen world map as a service. Sandbox 5 is the Sandbox 4 generator in C#, behind a domain model, with a REST API that delivers the map as PNG images and as JSON, and a demo site that pans and zooms the map and inspects the data.

It generates the same world as Sandbox 4: for the same seed and parameters the C# generator gives bit-identical results (see [Parity with Sandbox 4](#parity-with-sandbox-4)), and its default seed and parameters are Sandbox 4's (see [Settings](#settings)).

## Getting started

Needs the .NET 10 SDK.

```bash
dotnet run --project sandboxes/sandbox5/src/Sandbox5.Api
```

Then open <http://localhost:5250>: the demo site. The API index is at <http://localhost:5250/api>.

```bash
dotnet test sandboxes/sandbox5
```

runs the tests (about 20 s).

Unlike the other sandboxes this one is not part of the GitHub Pages site: it needs its server.

## Layout

```
defaults.json                 the settings file: default seed and every parameter
src/Sandbox5.Domain/          the domain model and the generator (no dependencies)
  WorldMap.cs                 the aggregate root: one unbounded map for one set of settings
  Model/                      Region, ElevationZone, Patch; Biome, ThermalBelt, ElevationZoneType,
                              ResourceType, Bedrock (the catalogues)
  Generation/                 the generation layers, ported from sandboxes/sandbox4/src/world:
                              Level, World, Climate, Rivers, Lakes, Terrain, Biomes, Resources,
                              Locations, Travel
  Numerics/                   hashing, sfc32, deterministic exp / log / sin / cos, noise, heap
  Settings/                   defaults.json → validated model parameters
  Export/                     the documented JSON structures (docs/map-structure.md, network-structure.md)
src/Sandbox5.Api/             the REST API and the demo site
  Api/                        endpoints and their JSON documents
  Rendering/                  map images: colours, borders, hillshade, rivers, lakes, routes, markers, PNG
  wwwroot/                    the demo site (plain HTML, CSS and JavaScript, no build step)
tests/Sandbox5.Tests/         parity with the TypeScript generator, exports, rendering, the API over HTTP
  Golden/                     values computed by the TypeScript generator, and the frozen settings they use
```

## Domain model

`WorldMap` is the aggregate root: an unbounded map that is a pure function of its settings, generated lazily as it is explored.

```
WorldMap
 └─ Region            128 km cells. Oceans, rivers, lakes, locations and travel links are laid out per region
     └─ ElevationZone  32 km cells, after merging. Ocean, flat, lowland, hills or mountains; one bedrock class
         └─ Patch      8 km cells, after merging. A biome with its climate and height, and its resources
```

```csharp
var map = new WorldMap(MapSettings.Load("sandboxes/sandbox5/defaults.json"));

Patch patch = map.PatchAt(12_000, -34_000);      // metres; x east, y south
Console.WriteLine(patch.Biome.Name);             // "Tundra"
Console.WriteLine(patch.ElevationZone.Type.Name);// "Hills"
Console.WriteLine(patch.Height);                 // mean height of the patch's land, metres
foreach (ResourceYield r in patch.Resources)     // largest amount first
    Console.WriteLine($"{r.Type.Name}: {r.Variant} ({r.Amount:0.00})");

Region region = map.Region(0, 0);                // by lattice column and row
foreach (PlacedLocation l in region.Locations)   // cities and towns, best score first
    Console.WriteLine($"{l.Kind} {l.Score:0.0} at {l.X:0}, {l.Y:0}");
```

| Type | What it is |
|---|---|
| `Region`, `ElevationZone`, `Patch` | The three nested levels of cells. A zone has a type, an ocean genesis and a bedrock; a patch has a biome, thermal belt, moisture class, climate, height, prosperity and its resources |
| `Biome`, `ThermalBelt`, `MoistureClass`, `ElevationZoneType` | The catalogues behind a patch's biome: 17 biomes, 5 belts, 5 moisture classes, 5 zone types |
| `ResourceType`, `ResourceYield`, `Bedrock` | The 24 raw resources, the amount and variant a patch has of one, and the 9 bedrock classes that place the deposits |
| `RegionRivers`, `LakeShape` | A region's river network (nodes with parent and flow) and its lakes (outlines) |
| `PlacedLocation`, `LocationCandidate` | City and town locations with the viability score and the five factors behind it |
| `TravelEdge`, `TravelPart` | Links of the travel network (road, river route, sea lane) with their routes |
| `PointInfo` | Everything at one point: `map.At(x, y)` |

The entities are views on the generation layers (`map.World`, `map.Rivers`, `map.Terrain`, `map.Biomes`, `map.Resources`, `map.Locations`, `map.Travel`), which hold the algorithms. Each layer is documented in its file and described in the repository README under Sandbox 4.

Everything is thread-safe. Results are memoised, and each region, terrain tile and network is computed once even when several requests ask for it at the same time.

## Settings

The seed and every parameter are in [`defaults.json`](defaults.json), in the format all cellgen sandboxes use: a `seed` and the value of every parameter in `params`, by key.

**The defaults are those of Sandbox 4.** The seed and all 129 parameters hold the values of `sandboxes/sandbox4/defaults.json`, key for key: 116 generation parameters (regions, oceans, elevation zones, patches, rivers, lakes, height map, climate, prosperity and supernatural maps, biomes, locations) and 13 display defaults (`view.*`). So Sandbox 5 starts with the same map as Sandbox 4, and its fingerprint is the one Sandbox 4 shows. Sandbox 4's other 14 `view.*` keys (3D view, noise-map overlays, arrows, sites, grid, attractors, detail) have no counterpart here and are left out.

The two files are separate: retuning Sandbox 4's defaults does not change Sandbox 5's. To bring them in line again, copy the values over (every key of this file exists in Sandbox 4's).

`MapSettings` validates the file when it is loaded: a missing parameter, a wrong type, a value out of range or an unknown key is an error, and the service does not start. Sizes are in kilometres and chances in per cent in the file, as in the Sandbox 4 panels.

The service re-reads the file when it changes, so editing it and reloading the page shows the new map. Another file can be named with the `Map:SettingsFile` setting (`appsettings.json`, or `--Map:SettingsFile=<path>`).

## REST API

All endpoints are `GET`. Positions are metres, x eastwards and y southwards. Every endpoint takes an optional `seed`; without it the seed of the settings file is used. A bad request gets `400` with `{ "error": "…" }`.

### Images

| Endpoint | Returns |
|---|---|
| `/api/map/tiles/{z}/{x}/{y}.png` | A 256 px tile. Zoom 0 is 8 192 m per pixel and every level halves it, up to 10 (8 m per pixel). Tile (x, y) covers the square from (x, y) × 256 px × metres per pixel; x and y may be negative |
| `/api/map/image.png?x=&y=&mpp=&width=&height=` | An image of any size (up to 4 096 px a side) centred on (x, y) at `mpp` metres per pixel |

Both take the layers as query parameters; what is left out comes from the `view.*` defaults:

| Parameter | Values |
|---|---|
| `color` | `map` (elevation zone types), `biomes`, `landsea`, `genesis`, `regions`, `elevationZones`, `patches`, `height`, `temperature`, `precipitation`, `prosperity`, `supernatural` |
| `hillshade`, `rivers`, `lakes`, `locations`, `travel`, `regEdges`, `zoneEdges`, `patchEdges`, `coast` | `1` or `0` |
| `locMin` | 0–100: hide locations below this viability score; the travel network connects those on show |
| `travelStyle` | `terrain` (routes follow the terrain) or `simple` (straight lines) |
| `pin` | A patch key: outline that patch |

An image is drawn the way Sandbox 4 draws its canvas, with the same colours. Neighbouring tiles join without a seam. Images carry an `ETag` and are kept in a memory cache.

Zoomed far out the server leaves things out, as Sandbox 4 does: patches are classified from 2 667 m per pixel down (above that every elevation zone is one colour), and rivers, lakes, locations, the travel network and heights are drawn from 2 048 m per pixel down.

### Data

| Endpoint | Returns |
|---|---|
| `/api` | The index: seed, determinism fingerprint, tile scheme, the list of endpoints |
| `/api/settings` | The settings in use: the seed and every parameter |
| `/api/catalog` | The catalogues: zone types, biomes, belts, resources, bedrocks, colour modes with their legends |
| `/api/map/at?x=&y=` | Everything at a point: region, elevation zone, patch (biome with every input, resources, waters, site score), the noise maps and height there, and the river, lake and location within `tolerance` metres |
| `/api/map/regions?x0=&y0=&x1=&y1=` | Summaries of the regions that reach into a rectangle |
| `/api/map/regions/{i},{j}` | One region as Region → ElevationZone → BiomePatch, the structure of [docs/map-structure.md](../../docs/map-structure.md). `patches=0` leaves the patches out. A region can also be named by its key |
| `/api/map/regions/{i},{j}/rivers` | The region's river network: node positions, parents and flows |
| `/api/map/regions/{i},{j}/lakes` | The region's lakes with their outlines |
| `/api/map/regions/{i},{j}/locations` | The region's city and town locations, best first. `all=1` lists every candidate patch with its score |
| `/api/map/regions/{i},{j}/travel` | The travel links the region owns, with their routes |
| `/api/map/zones/{key}`, `/api/map/patches/{key}` | One elevation zone with its patches; one patch in full |
| `/api/map/structure?regions=i,j;i,j` | The map structure export of [docs/map-structure.md](../../docs/map-structure.md). Without `regions`: the four regions at the origin, the same document as [docs/map-default-structure.json](../../docs/map-default-structure.json) while the two sandboxes' defaults are the same |
| `/api/map/network?regions=i,j;i,j&margin=1` | The travel network export of [docs/network-structure.md](../../docs/network-structure.md). Without parameters: the same document as [docs/network-default-structure.json](../../docs/network-default-structure.json) while the two sandboxes' defaults are the same |

```bash
curl "http://localhost:5250/api/map/at?x=12000&y=-34000"
curl -o tile.png "http://localhost:5250/api/map/tiles/4/0/0.png?color=biomes&hillshade=1"
curl -o map.png "http://localhost:5250/api/map/image.png?x=0&y=0&mpp=600&width=1600&height=1000"
```

Biomes and resources always rest on exact patch heights: the terrain tile of a patch is computed when it is first needed, so the data of a patch never depends on what was asked before. The first request in a new area is therefore the slow one. On the development machine a screen of tiles at 512 m per pixel took about 0.4 s cold with the default layers and about 2.3 s with biomes and hillshade (which need the terrain); afterwards a tile takes milliseconds.

## Demo site

`wwwroot/` is a small viewer on top of the API, served at the root of the service.

- **Map:** drag to pan, scroll or `+` / `−` to zoom, click to inspect. The scale bar, position and zoom are shown below the map; hovering shows the region, zone type, biome and height under the cursor.
- **Layers** (left): hillshade, rivers, lakes, locations with the viability threshold, travel network and route style, the borders of each level and the coastline. **Colour by** in the top bar picks the colour mode; the legend follows it.
- **Inspector** (right): the clicked point's biome with its climate and height, the river, lake or location there, the patch's resources with amounts and variants, its score as a site with the five factors, the elevation zone and the region, and links to the JSON of each. **JSON** shows the document the API returned. The inspected patch is outlined on the map.
- **Seed:** type one, or roll a random one. **Share link** copies a link to the view: the URL hash holds the seed, the camera, every layer that differs from the defaults and the inspected point. **PNG** opens the current view as one image from the API.

Keyboard: `+` / `−` zoom · `0` origin · arrows pan · `R` random seed · `1`–`9` colour mode · `[` / `]` previous / next colour mode · `H` hillshade · `V` rivers · `C` locations · `P` travel network · `B` zone borders · `N` patch borders · `Esc` clear the selection · `?` help.

## Parity with Sandbox 4

The generator is a port of `sandboxes/sandbox4/src/world` and `shared/core`, kept bit-exact: the same hashes and PRNG, the same deterministic maths (no `Math.Exp`, `Log`, `Pow` or `Sin` in the generator), the same visiting orders, and float32 where the TypeScript uses `Float32Array`.

The tests check it against golden data computed by the TypeScript generator at a frozen copy of Sandbox 4's defaults (`tests/Sandbox5.Tests/Golden/settings.json`), so retuning either sandbox's defaults does not break them:

| Tests | What must match exactly |
|---|---|
| Numerics | Hashes, the sfc32 stream, exp / log / sin / cos / pow, simplex and Perlin noise |
| World | The determinism fingerprint; cells, oceans, genesis and merges on a grid of points; regions' zones, seeds, merges and links; the climate fields. Also: the map does not depend on the order it is explored in, nor on being explored from several threads |
| Rivers, lakes | Every river node, parent and flow of four regions; every lake outline |
| Terrain | River bed profiles and the height rasters of four tiles (every cell), and the mean patch heights |
| Biomes, resources | The classifier and cooling curve; for all 818 patches of four regions the biome with its inputs, the river and lake site and all 24 resource amounts and variants, unrounded |
| Locations, travel | Every candidate's factors, the chosen locations, the travel cost grids, and every link with its cost and route |
| Exports | At Sandbox 4's defaults, `MapStructure` and `NetworkStructure` equal Sandbox 4's `docs/map-default-structure.json` and `docs/network-default-structure.json` |
| Settings | The shipped `defaults.json` is valid (its values are not pinned, so it can be retuned); a file with a missing, mistyped, out-of-range or unknown parameter is refused with a reason; units are converted; a seed and parameters can be replaced |
| Rendering | An image is a pure function of view and options; neighbouring tiles join without a seam; the PNG decodes to the same pixels |
| API | Every endpoint over HTTP, bad requests, caching |

Regenerate the golden data after changing the generator in Sandbox 4 (from the repository root):

```bash
npm run export-sandbox5-golden            # every part
npm run export-sandbox5-golden -- rivers  # only the named parts
```

and copy `docs/map-default-structure.json` and `docs/network-default-structure.json` to `Golden/map-structure.json` and `Golden/network-structure.json` when the frozen settings equal Sandbox 4's defaults.

### Where it differs from Sandbox 4

- **Heights are always exact.** Sandbox 4 shows a biome on an estimated height until its terrain tile arrives; here the tile is computed on demand, as its export scripts do.
- **Not ported:** the 3D view, the Statistics panel, the parameter panels and presets (parameters come from `defaults.json`), the `merges` and `hierarchy` colour modes, and the overlays for seeds, links, growth, merges, sites, attractors and the kilometre grid.
- **Noise maps are colour modes** (`temperature`, `precipitation`, `prosperity`, `supernatural`) instead of overlays; they are drawn at half strength over the plain map, like the overlays.
- **Location scores are not written on the map**; the inspector shows them.
- Far zoomed out, features are left out rather than computed progressively (see [Images](#images)).
