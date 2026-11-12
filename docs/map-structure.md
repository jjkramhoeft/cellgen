# Map structure

Describes [map-structure.json](map-structure.json): the map as three nested levels of cells.
The values in the JSON are samples, not generator output.

```
Region  →  ElevationZone  →  BiomePatch
128 km      32 km             8 km        (default cell sizes)
```

Each level is a jittered lattice of sites. A cell belongs to the parent whose area contains
its site.

## Real data

[map-default-structure.json](map-default-structure.json) has the same structure with values
from a run of sandbox4 at the default seed and settings (`sandboxes/sandbox4/defaults.json`),
for the four regions that meet at the map origin: lattice cells (−1, −1), (0, −1), (−1, 0)
and (0, 0). With the defaults of 2026-11-12 it holds 51 elevation zones and 818 biome
patches (593 land), one patch per line, which list 4 810 resources between them (about 7.6 per
land patch).

Regenerate it with `npm run export-map` (scripts/export-map.ts, about 20 s) after changing
`defaults.json` or the generator.

- Cells are listed after merging. A merged zone or patch appears once, under the key, lattice
  cell and site of the cell the others merged into, so zones and patches vary in size.
- A zone is listed under the region that contains that site. A zone of these four regions
  that merged into a zone outside them is therefore missing, and a zone from outside that
  merged into one of theirs is included.
- Heights are the mean land height of each patch from the 1 km terrain raster.
- Resources are read on those exact heights too, so they fit the biome and climate listed
  with them.

The travel network of the same four regions and the regions around them, with the city and
town locations as nodes, is in [network-default-structure.json](network-default-structure.json),
described in [network-structure.md](network-structure.md).

## Root

| Field     | Description                                         |
| --------- | --------------------------------------------------- |
| `seed`    | World seed; the same seed always gives the same map |
| `units`   | Units used by the numeric fields below              |
| `regions` | List of Region                                      |

## Common fields

Region, ElevationZone and BiomePatch all carry these.

| Field    | Description                                                          |
| -------- | -------------------------------------------------------------------- |
| `key`    | Unique id of the cell within its level (placeholder numbers in the sample) |
| `i`, `j` | Column and row of the cell on its level's lattice                    |
| `x`, `y` | Position of the cell's site, metres                                  |

## Region

The largest cell. Groups elevation zones and is the unit oceans are laid out in.

| Field            | Description                                        |
| ---------------- | -------------------------------------------------- |
| `elevationZones` | The elevation zones whose site lies in this region |

## ElevationZone

A medium cell with one terrain character, which sets slopes, river gradient and detail noise.

| Field          | Description                                                 |
| -------------- | ----------------------------------------------------------- |
| `type`         | `ocean`, `flat`, `lowland`, `hills` or `mountains`          |
| `ocean`        | `true` when the zone is sea (same as `type` being `ocean`)  |
| `bedrock`      | Bedrock class of a land zone, see below; `null` for ocean   |
| `biomePatches` | The biome patches whose site lies in this zone              |

## BiomePatch

The smallest cell. Has one biome, derived from its climate and height.

| Field           | Description                                                                      |
| --------------- | -------------------------------------------------------------------------------- |
| `biome`         | Biome id, see below                                                              |
| `belt`          | Thermal belt from `temperature`: `polar`, `subpolar`, `boreal`, `temperate`, `tropical` |
| `moisture`      | Moisture class from `aridity`: `Arid`, `Semi-arid`, `Subhumid`, `Humid`, `Perhumid` |
| `aridity`       | `precipitation` ÷ dryness threshold, where the threshold is `max(40, 20 × temperature + 140)`; below 1 is dry |
| `temperature`   | Mean temperature after cooling for height, °C                                    |
| `precipitation` | Yearly precipitation, mm/yr                                                      |
| `height`        | Mean land height of the patch, metres (0 for ocean)                              |
| `coastal`       | `true` for a land patch that borders the ocean                                   |
| `prosperity`    | The prosperity map at the patch's site, from 0 (the map's minimum) to 1 (its maximum). It sets how often gold, silver, gems and luxuries turn up, see Resource |
| `resources`     | List of Resource: what the patch holds, largest amount first (may be empty)      |

Ocean patches have `biome: "ocean"` and `null` for the climate fields. They have a
`prosperity` and list resources too: fish, and next to land seaweed, seals, pearls or coral.

### Biome ids

| Belt      | Driest → wettest                                                                |
| --------- | ------------------------------------------------------------------------------- |
| polar     | `ice`                                                                           |
| subpolar  | `tundra`                                                                        |
| boreal    | `coldDesert`, `coldSteppe`, `taiga`                                             |
| temperate | `coldDesert`, `grassland`, `shrubland`, `mixedForest` / `broadleaf`, `tempRainforest` |
| tropical  | `hotDesert`, `thornScrub`, `savanna`, `dryForest`, `rainforest`                 |

`mixedForest` is the humid temperate forest below 10 °C, `broadleaf` from 10 °C up.
`mangrove` replaces the biome of warm, wet coastal patches in flat and lowland zones.
`ocean` is used for sea patches.

## Resource

One raw resource of a patch (world/resources.ts). A patch lists a resource from an amount
of 0.25; most land patches list six to ten of the 24.

| Field     | Description                                                                          |
| --------- | ------------------------------------------------------------------------------------ |
| `id`      | Resource id, see below                                                               |
| `amount`  | 0.25 to 1. For a potential: how well the patch suits it. For a deposit: how rich it is |
| `variant` | The kind that fits this patch best, for example `barley`, `teak`, `bog iron`, `solar sea salt` (names from the catalogue in research/patch-resources.md) |

### Resource ids

| Group     | Id           | Name                  | Kind      | Where                                                              |
| --------- | ------------ | --------------------- | --------- | ------------------------------------------------------------------ |
| Food      | `grain`      | Grain                 | potential | The best cereal for the temperature and water; rivers irrigate     |
| Food      | `produce`    | Produce               | potential | Roots, pulses and vegetables, the same way                         |
| Food      | `orchard`    | Orchard               | potential | Fruit, nuts, olives, vines, palms and oilseeds                     |
| Food      | `livestock`  | Livestock             | potential | Pasture by biome: grassland, steppe and savanna most               |
| Food      | `fish`       | Fish                  | potential | Coast and harbour, river by size, a lake                           |
| Food      | `wildFood`   | Wild food & game      | potential | Forests most; berries, mushrooms, deer, boar, waterfowl            |
| Materials | `timber`     | Timber                | potential | Forest biomes; gallery woods along rivers in open land             |
| Materials | `stone`      | Stone                 | deposit   | Common in hills and mountains, scarce in flat land; kind by bedrock |
| Materials | `clay`       | Clay & earth          | both      | Flat and lowland, more along rivers; kaolin as a rare deposit      |
| Materials | `crystal`    | Crystal               | deposit   | Rock crystal in hills and mountains, glass sand on coasts and large rivers |
| Materials | `fibre`      | Fibre                 | potential | Flax and hemp in the temperate belt, cotton and jute in the tropics |
| Fuel      | `fuel`       | Fuel                  | both      | Firewood and charcoal, peat, dung; coal and lignite in clastic basins |
| Salt      | `salt`       | Salt                  | deposit   | Dry warm coasts, salt flats, rock salt and brine in a few basins; scarce |
| Metals    | `ironOre`    | Iron ore              | deposit   | Bog iron in wet cool forest, laterite in the tropics, ores by bedrock |
| Metals    | `copperOre`  | Copper ore            | deposit   | Volcanic arc, ophiolite, flood basalt, clastic basin               |
| Metals    | `tin`        | Tin                   | deposit   | Granite intrusions, and the streams below them; never in a copper zone |
| Metals    | `silverLead` | Silver & lead         | deposit   | Fold belts, carbonate platforms, volcanic mountains                |
| Metals    | `gold`       | Gold                  | deposit   | Lodes in fold belts, shields and arcs; placers where their rivers reach flatter ground |
| Luxuries  | `gems`       | Gems & pearls         | deposit   | By bedrock; turquoise and opal in deserts; pearls, coral and amber on coasts |
| Luxuries  | `spices`     | Spices & incense      | potential | Tropical belt only, and only in some zones                         |
| Luxuries  | `stimulants` | Stimulants & sugar    | potential | Sugar cane, tea, coffee, cacao, tobacco in some zones; honey       |
| Luxuries  | `furs`       | Furs & ivory          | potential | Furs in some zones of taiga, tundra and cool forest; ivory and feathers in some hot zones |
| Luxuries  | `dyes`       | Dyes                  | both      | Dye crops in some zones; murex and kermes as rare finds            |
| Animals   | `horses`     | Horses & pack animals | potential | Grassland and steppe (horses), deserts (camels), hills (mules)     |

A potential is a suitability every patch has; a deposit is a rare hashed find; `both` is a
potential with deposits on top.

**Prosperity.** The chances of `silverLead`, `gold` and `gems`, and the share of elevation
zones in which `spices`, `stimulants`, `dyes` and `furs` occur, are multiplied by
(2 × `prosperity`)²: 0.25 at a prosperity of 0.25, 1 at 0.5, 2.25 at 0.75 and 4 at 1. At 0.5,
half of the cold zones have furs and three tenths of the hot zones have ivory. The other
resources do not read it, nor does honey (under `stimulants`).

### Bedrock ids

`bedrock` of an ElevationZone is hashed by weight from its `type`, and decides which stone,
ores and gems the zone's patches can hold.

| Id          | Name                 | Mostly under            | Gives                                                    |
| ----------- | -------------------- | ----------------------- | -------------------------------------------------------- |
| `shield`    | Crystalline shield   | flat, lowland, hills    | Granite, banded iron, lode gold (hills), diamonds, kaolin |
| `foldBelt`  | Fold belt            | hills, mountains        | Slate, marble, silver, lode gold, garnet, emerald        |
| `granite`   | Granite intrusion    | hills, mountains        | Granite, tin lodes, skarn iron, topaz and beryl, kaolin  |
| `volcanic`  | Volcanic arc         | mountains               | Basalt, obsidian, pumice, porphyry copper, gold, rock crystal |
| `basalt`    | Flood basalt         | flat, lowland, hills    | Basalt, native copper, agate, black sands                |
| `ophiolite` | Ophiolite            | hills, mountains        | Soapstone, massive-sulfide copper, jade                  |
| `carbonate` | Carbonate platform   | lowland, hills          | Limestone, chalk, flint, lead and zinc, skarn iron       |
| `clastic`   | Clastic basin        | flat, lowland           | Sandstone, coal, lignite, red-bed copper, rock salt, amber |
| `alluvium`  | Unconsolidated cover | flat, lowland           | Field stone only; clay                                   |
