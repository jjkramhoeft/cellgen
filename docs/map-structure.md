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
and (0, 0). With the defaults of 2026-11-11 it holds 51 elevation zones and 818 biome
patches, one patch per line.

Regenerate it with `npm run export-map` (scripts/export-map.ts, about 20 s) after changing
`defaults.json` or the generator.

- Cells are listed after merging. A merged zone or patch appears once, under the key, lattice
  cell and site of the cell the others merged into, so zones and patches vary in size.
- A zone is listed under the region that contains that site. A zone of these four regions
  that merged into a zone outside them is therefore missing, and a zone from outside that
  merged into one of theirs is included.
- Heights are the mean land height of each patch from the 1 km terrain raster.

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

Ocean patches have `biome: "ocean"` and `null` for the climate fields.

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
