# Travel network structure

Describes [network-default-structure.json](network-default-structure.json): the travel network
of sandbox4 as a graph. The city and town locations are the **nodes**; the roads, river routes
and sea lanes between them are the **links**.

```
node (city / town)  ──  link (road | river | sea)  ──  node
```

- The graph is **undirected**: a link costs the same both ways (rivers too), and `a` / `b`
  carry no direction (`a` is the smaller key).
- It is a **multigraph**: two nodes can have a road and a water link between them (never two
  of the same kind). A link is identified by its `id`, not by its two ends.
- Every link has a `length` (how far) and a `weight` (how hard): use `weight` for shortest
  paths.

## Real data

The file holds the network of a run of sandbox4 at the default seed and settings
(`sandboxes/sandbox4/defaults.json`), the same world as
[map-default-structure.json](map-default-structure.json) ([map-structure.md](map-structure.md)).

**Coverage.** The four regions of the map file, lattice cells (−1, −1), (0, −1), (−1, 0) and
(0, 0), are the **core**. The file adds the twelve regions around them, so it covers the
4 × 4 block of lattice cells (−2 … 1, −2 … 1). A link is in the file when both its ends lie
in the block. Links from a block location to a location outside it are left out, so nodes
near the outer edge of the block can have fewer links here than on the map.

**Which locations.** The locations at or above the default **Location viability**
(`view.locMin`, 59), towns included: the network the sandbox draws with its default display
settings when zoomed in. Raising the viability or showing the cities only gives a different
network, not a subset of this one, because the links are decided among the locations on show.

With the defaults of 2026-11-12:

| | Block (16 regions) | Core (4 regions) |
|---|---|---|
| Nodes | 198 (39 cities, 159 towns) | 34 |
| Links | 393 (267 road, 98 river, 28 sea) | 61 between two core nodes, 81 touching one |
| Route length | 13 859 km (8 630 road, 3 415 river, 1 814 sea) | |

The graph is one connected component. A node has 1 to 9 links (median 4). 71 pairs of nodes
have both a road and a water link, 66 links cross a region border and 2 join two cities. 26
links leave the block and are left out.

Regenerate it with `npm run export-network` (scripts/export-network.ts, about 12 s) after
changing `defaults.json` or the generator. The output is deterministic: the same seed and
settings give the same file, byte for byte.

**Joining with the map file.** A node's `key` is the key of its biome patch, so a core node
is found in `map-default-structure.json` as the `BiomePatch` with the same `key`. Biomes,
zone types and the coast flag agree between the two files.

## Root

| Field      | Description                                                                 |
| ---------- | --------------------------------------------------------------------------- |
| `seed`     | World seed; the same seed always gives the same network                     |
| `units`    | Units of positions (`distance`), link `length` and link `weight`            |
| `settings` | What the network was built with, see below                                  |
| `regions`  | The regions covered, row by row (one per line)                              |
| `nodes`    | List of Node, region by region, best score first (one per line)             |
| `links`    | List of Link, ordered by `a`, `b`, then road before river before sea (one per line) |

`settings`:

| Field        | Description                                                              |
| ------------ | ------------------------------------------------------------------------ |
| `minScore`   | Only locations with at least this viability score (0–100) are nodes      |
| `citiesOnly` | `false`: towns are nodes too                                             |
| `cell`       | Cell size of the travel cost grid, metres                                |
| `detour`     | A link is dropped for a detour over cheaper links of at most this × its weight |

## Region

| Field    | Description                                                    |
| -------- | -------------------------------------------------------------- |
| `key`    | Unique id of the region (as in the map file)                   |
| `i`, `j` | Column and row of the region on the region lattice             |
| `x`, `y` | Position of the region's site, metres                          |
| `core`   | `true` for the four regions of `map-default-structure.json`    |
| `nodes`  | Number of nodes in the region                                  |

A region with little habitable land has few nodes: two regions of the block have one each.

## Node

A city or town location: the best-scoring land patches of a region (see the README, "City
and town locations"). A region aims for 20 locations, at most 4 of them cities; those below
the viability threshold are not nodes.

| Field       | Description                                                                          |
| ----------- | ------------------------------------------------------------------------------------ |
| `key`       | Node id: the key of the biome patch the location is in (links refer to it)           |
| `region`    | Key of the region the patch belongs to                                               |
| `core`      | `true` when that region is one of the four core regions                              |
| `kind`      | `city` or `town`                                                                     |
| `rank`      | Rank by score among all locations of its region, 1 = best (ranks of locations below the threshold are missing) |
| `score`     | Viability, 0–100                                                                     |
| `x`, `y`    | The spot, metres: on the patch's river when it has one, otherwise the patch's site   |
| `biome`     | Biome of the patch (ids in [map-structure.md](map-structure.md#biome-ids))           |
| `zoneType`  | Type of its elevation zone: `flat`, `lowland`, `hills` or `mountains`                |
| `coast`     | The patch borders the ocean: the location has a sea harbour                          |
| `harbour`   | A sheltered harbour: the patch borders a bay, an ocean patch with at least 3 land neighbours and more land than ocean ones |
| `onRiver`   | The spot is on a river                                                               |
| `navigable` | The patch's river is navigable (drains at least 8 patches upstream)                  |
| `features`  | What stands out about the place, see below                                           |

`features` holds any of: `mouth of a navigable river`, `river mouth`, `sheltered harbour`,
`coast`, `large river`, `navigable river`, `river`, `head of navigation`, `confluence`,
`lake`, `central place`, `high ground`, `peninsula`, `rich farmland`, and the names of up to
two rich deposits on the patch: `salt`, `crystal`, `iron ore`, `copper ore`, `tin`,
`silver & lead`, `gold`, `gems & pearls`.

A node can start a water link when it has a sea harbour (`coast`) or a navigable river runs
within two grid cells (4 km) of its spot. That is nearly, but not exactly, the `navigable`
flag: the flag is about the patch, the test about the spot.

### Features

River size is the number of patches a river drains above a point. A river is navigable
from 8 patches and large from 80. A patch's river size, mouth and confluence are the
largest found at any river node on the patch.

**Sea and coast.** Only one of each pair is listed: a mouth of either size, and a
sheltered harbour or the coast.

| Feature                      | Set when                                                                                     | What it means                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `mouth of a navigable river` | A river draining 8 or more patches reaches the sea on the patch                              | Where river and sea traffic meet, the strongest gateway. Its trade value grows with the river and is full at 80 patches. The spot is put at the mouth |
| `river mouth`                | The same for a river draining 2–7 patches                                                    | Fresh water and a landing place, but no route inland; little trade value                                        |
| `sheltered harbour`          | The patch borders an ocean patch that is a bay: one with at least 3 land neighbours, and more land than ocean ones | A protected anchorage: the most fish (1), full waterside value, trade 0.6                                       |
| `coast`                      | The patch borders the ocean, but no bay                                                      | An open shore. It still has a sea harbour (it can start sea lanes), but less: fish 0.8, waterside 0.7, trade 0.24 |

**Rivers.** At most one of these, and none when a mouth already describes the river.

| Feature           | Set when                                                | What it means                                                                                                    |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `large river`     | The river drains 80 or more patches, and no navigable mouth | A major waterway, at the top of the trade scale (0.5). It also irrigates fully: a river adds 100 mm of water a year per patch it drains beyond the first, up to 1 200 mm, to the crops that lack it |
| `navigable river` | The river drains 8–79 patches, and no navigable mouth   | Boats can use it: it carries river routes and makes travel to central places cheaper (0.4 × the land cost). Its trade value grows from 0 at 8 patches to 0.5 at 80 |
| `river`           | The river drains 2–7 patches, and no river mouth        | Fresh water, some fish (0.3), waterside 0.7, and clay in flat and lowland zones. No boat traffic                  |

**River structure.**

| Feature              | Set when                                                                                   | What it means                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `head of navigation` | A river node is navigable, but its largest tributary is not                                | The furthest point boats reach upstream, where goods are unloaded (break of bulk); trade 0.6. Fall lines from the river bed heights are not modelled yet |
| `confluence`         | The second-largest stream joining at a node drains at least 4 patches (half of navigable)  | Two real rivers meet: trade up to 0.4, and defence 0.4 (water on two sides)                                      |
| `lake`               | A lake lies on the patch                                                                   | Water 1, fish 0.45 to 0.75 by the lake's area, waterside 0.8; only a little trade (0.15)                                                     |

**Land.** Only one of `high ground` and `peninsula` is listed.

| Feature         | Set when                                                                     | What it means                                                                                                    |
| --------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `central place` | The central-place term is at least 0.6 and at least the gateway score        | The place trades by where it is, not by a water gateway. The term is Hansen accessibility: the region's food, each patch weighted by 1 / (1 + travel days)², one day being 35 km of open flat road; it reaches 1 at 0.55 of an ideal region (a disc of farmland seen from its centre). Typically an inland market town in good farmland |
| `high ground`   | The zone type is hills or mountains                                          | A defensible site with stone, but harder to build on (buildable 0.55 or 0.25) and with less farmland             |
| `peninsula`     | At least half the patch's neighbours are ocean                               | Defence 0.5 (water on most sides); less farmland around it, as ocean neighbours count as empty land              |
| `rich farmland` | The food of the catchment is at least 0.7                                    | The patch counts twice, then its land neighbours; ocean neighbours dilute it. A patch's food comes from its resources: its grain (or roots and pulses at four fifths), plus herds, orchards and game. Typically wheat, barley or rice land on flat or lowland ground, or dry land irrigated by a river |

**Resources.** The names of the richest deposits on the patch, at most two.

| Feature                                                                              | Set when                                                                 | What it means                                                                                                   |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `salt`, `crystal`, `iron ore`, `copper ore`, `tin`, `silver & lead`, `gold`, `gems & pearls` | The patch lists that deposit with an amount (richness) of at least 0.5   | A salt works or a mining town. The deposit counts in the trade goods of the resources factor, by value (gold 1, tin and silver 0.9, gems 0.8, salt 0.7, copper 0.6, iron 0.5, crystal 0.4). The resources themselves are in the map file ([map-structure.md](map-structure.md#resource)) |

**How they add up to trade.** The gateway score is the best of the water features'
values plus a quarter of the others, divided by 1.5. The trade factor is the larger of the
gateway and the central place plus a quarter of the smaller. So a place with several
features ("navigable river, head of navigation, confluence, central place") beats one with
a single strong feature, which is why that combination tops many regions.

## Link

One route between two nodes.

| Field    | Description                                                                             |
| -------- | --------------------------------------------------------------------------------------- |
| `id`     | Link id: its index in `links`                                                           |
| `a`, `b` | Keys of the two nodes, `a` < `b`                                                        |
| `mode`   | `road`, `river` or `sea`, see below                                                     |
| `length` | Length of the route, metres                                                             |
| `weight` | Travel cost, in km of open flat road, see below                                         |
| `biome`  | The biome most of the route runs through (`ocean` for most sea lanes)                   |
| `major`  | `true` between two cities                                                               |
| `modes`  | Metres of the route by kind of travel; only the kinds it uses                           |
| `biomes` | Metres of the route by biome, longest first; `biome` is the first one                   |

### Mode

| Mode    | Route                                                                                    |
| ------- | ---------------------------------------------------------------------------------------- |
| `road`  | Over land all the way, along the cheapest path on the cost grid                          |
| `river` | By boat, mostly along navigable rivers                                                   |
| `sea`   | By boat, mostly over open sea                                                            |

A water route can use both: down a river, through its mouth and along the coast to the next
harbour. `mode` is then the kind with the longer stretch, and `modes` gives both lengths
(27 of the 68 water links are mixed). A road link is road only.

### Length

The length of the route as drawn with "Follow the terrain", not the straight-line distance
(that one follows from the two nodes' `x`, `y`):

- a road is the path over the 2 km grid, smoothed;
- a river stretch follows the river's own course, node by node;
- a sea stretch is pulled straight wherever the line of sight is open water.

A route starts and ends at the two spots. On a water route the short hop between a spot and
its landing or harbour is counted with the stretch it joins, which is why a pure sea lane
still shows a few km of land biome in `biomes`.

### Weight

The cost of travelling the link, expressed as the length of open flat road that costs the
same. A weight of 50 is as much effort as 50 km on flat grassland, about a day and a half at
the 35 km a day the location scoring uses. It is what the network was built from.

| Kind | Cost |
| --- | --- |
| Road, per km | elevation zone type (flat 1, lowland 1.15, hills 1.8, mountains 4) × biome (see below) × slope (1 + (slope / 5 %)², at most 13 ×) × height (1 + height / 1 500 m) × 8 across a lake |
| Road, crossing a navigable river | + 3 km (a bridge or ferry) |
| River, per km | 0.4 |
| Sea, per km | 0.3 (0.6 in the cells right at the shore) |
| Loading at a river landing | + 6 km at each end of a water link |
| Loading at a sea harbour | + 12 km at each end of a water link |
| From the spot to its landing or harbour | + the straight distance, km |

Road cost by biome: grassland 1, savanna 1.05, cold steppe and shrubland 1.1, mixed forest,
broadleaf and dry forest 1.3, taiga 1.4, thorn scrub 1.5, tundra 1.6, temperate rainforest 2,
rainforest 2.2, mangrove 3, cold desert 3.5, hot desert 4, ice 5.

In the default export a km of road costs 1.15 to 5.6 (median 1.7), a km of river link 0.5 to
1.8 (median 0.95) and a km of sea link 0.5 to 1.3 (median 0.63), loading included. Water is
cheap per km but pays to load at both ends, so short hops go by road and long hauls by water.

Two things to know when adding weights along a path:

- Loading is paid per link. A journey over two water links through a town pays to unload
  and load there, as if the cargo changed boats.
- Road weights are plain path costs and add up as they are.

### Biome

`biomes` is found by walking the route in steps of at most 250 m and looking up the biome
patch under each step; sea is `ocean`. A river link reports the land the river runs through.

The biomes in this file are the map's own (patch heights from the terrain), so they agree
with `map-default-structure.json`. The weights were computed from a cheaper estimate of the
same biomes, at a typical height for each elevation zone type, so that the network never
depends on terrain tiles. The two differ in some patches (5 of the 32 core nodes), so a
link's weight can reflect a slightly different biome than the one listed.

## How the network is built

The source is `sandboxes/sandbox4/src/world/travel.ts`; the README section "Travel network"
has the design reasoning.

1. **Cost grid.** Every region gets a 2 km grid of its own cells: land (with the road cost
   per km and an estimated height) or sea, plus its navigable rivers as links between the
   cells each river segment crosses. Heights are estimated without terrain tiles: river beds
   rise upstream from the sea, and the land rises from every river and the coast at its zone
   type's hillslope. Rivers are the valleys and region borders the ridges.
2. **Two forests.** For a region and its eight neighbours, two shortest-path forests are
   grown at once: one over land from every node, one over water from every node on a
   navigable river and from the harbour of every coastal node. Each grid cell ends up with
   its cheapest node. That is a Voronoi diagram under travel cost, one for roads and one for
   water.
3. **Candidate links.** Two nodes whose Voronoi cells touch are neighbours. Their candidate
   link runs through the cheapest crossing of the common border and down both trees to the
   two nodes. Links out of one place therefore share their first stretch, like real roads.
   These neighbour graphs contain the minimum spanning tree of all travel costs.
4. **Pruning.** A candidate is dropped when cheaper links make a detour of at most 1.6 × its
   weight, through other nodes or over the other kind of link between the same two. A road
   only gives way to a route that uses water when that costs at most 0.35 × the road. Only
   the dearest link of a cycle is ever dropped, so whatever was connected stays connected.
5. **Ownership.** Every pair of regions has one owner that decides the links between their
   locations: the smaller key of two neighbours, the region in the middle of two that are
   two apart. Regions three or more apart are never linked directly. The result does not
   depend on the order regions are computed in.
6. **Routes.** The kept links get their route (road cells, river nodes, sea path), from
   which the length comes.

What this means for the graph:

- It is sparse: links only join neighbours under travel cost, and a link that cheaper ones
  can replace is gone. The default export links 271 pairs of its 169 nodes, about 1.6 per
  node.
- It is connected wherever travel is possible at all, by road or by water. Three nodes of the
  default export have water links only; of the 6 nodes with a single link, 5 hang on by a road.
- It is not a tree. A third link between three neighbours survives when the detour over the
  other two costs more than 1.6 × as much, which leaves 51 triangles in the default export.
- The pruning saw the locations outside the block too, so the block is a window on a larger
  network, not a network built for the block alone.

## Not in the file

- The route geometry (the points of each road, river stretch and sea lane). It exists in the
  generator as `TravelEdge.parts` and could be added to the export.
- Which stretches several links share (roads out of one town share their first kilometres).
  Each link carries its full length.
- Locations below the viability threshold and the links they would have.
