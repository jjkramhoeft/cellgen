# Natural Resources per Subbiome: Food, Building Materials and Wealth

*Research date: 2026-11-10. Scope: a long, preliminary catalogue of the natural resources a single **subbiome** could hold, sorted into three economic roles (food, construction, wealth) and into above-ground and underground resources. Each one is keyed to what `sandboxes/sandbox4` already computes per subbiome: elevation zone type, biome, thermal belt, moisture class, temperature, precipitation, height, rivers and floodplains, coast. Where a resource needs something the map does not have yet (wetlands, karst, volcanoes, bedrock, salt flats and so on), §3 lists that as a missing feature instead of forcing it onto a biome. A small, separate set of fantasy resources (§5) follows the same rules. The aim is a believable economy: where settlements go, what they must trade for, and what they can specialise in.*

**How to read the citations**

- Each claim cites the source that owns it: a database row, a deposit model by number, a paper, or repo plus file and lines. The source keys in the tables (`EC`, `M39a`, `MCS-salt` and so on) are listed in §9.
- **[unverified]** means the claim is general or bibliographic knowledge that was not checked against a primary text in this pass. Most rows about livestock, game, fish, furs, dyes, stone types and historical trade are of this kind; the table marks them with the source key `U`.
- **[partially verified]** means the primary source exists and is cited, but only part of the claim was confirmed, for example from an abstract, a search-index copy, or a fetch tool that returned extracted quotes rather than the page.
- **ECOCROP numbers (`EC`)** were read directly from the FAO ECOCROP table as redistributed in the OpenCLIM `ecocrop` repository (`EcoCrop_DB.csv`). Read the `EC` cells like this: `T 15–23 (5–27)` means optimal temperature 15–23 °C, absolute limits 5–27 °C (columns TOPMN, TOPMX, TMIN, TMAX); `P 750–900 (300–1600)` is optimal and absolute **annual** rainfall in mm (ROPMN, ROPMX, RMIN, RMAX); `alt` is the maximum altitude in m (ALTMX); `kill` is the killing temperature in °C (KTMP).
  - The ECOCROP temperatures are **crop-cycle temperatures** (the mean over the growing season), not annual means. The map's temperature is an annual mean (§2). The Recocrop R package, which implements the ECOCROP model, applies them to monthly means, and states that the FAO parameters are "expert opinion and not necessarily optimal" **[partially verified: search-index copy of the Recocrop reference manual]**.
  - A few ECOCROP rows are obviously damaged (for example *Lavandula angustifolia* has 1400–1700 in its latitude columns, and *Phragmites australis* an optimum of 30–35 °C). I copied the numbers anyway and flagged the suspicious ones.
  - The original FAO ECOCROP website has been retired. I did not check that the CSV copy matches it row by row.
- **USGS deposit models (`M` + number)** are from Cox & Singer (eds.) 1986, *Mineral Deposit Models*, USGS Bulletin 1693, read in full from the USGS PDF (third printing, 1992). The model number is the one in the bulletin's contents (for example `M39a` placer Au-PGE). Quoted phrases are from each model's "Geological environment" block (rock types, depositional environment, tectonic setting).
- **The Biomes and Zones columns are my mapping**, not a sourced claim: they translate the sourced conditions into the map's own categories (Design note). The **Rarity**, **Value** and **Chain** columns are also my judgement unless a source key says otherwise.
- Primary texts that could not be read on the research date are listed in §9.4.
- Text marked "Design note" is my own engineering judgement, not a sourced claim.

**Code locations used below** (working tree at commit `b94e28d`)

| Hook | File, lines | What it gives a resource pass |
|---|---|---|
| Map hierarchy | `src/world/world.ts` L1–35; `defaults.json` L4, L19, L27 | Regions on a 128 km lattice, elevation zones on 32 km, subbiomes on **8 km** (Voronoi, border warp). |
| What subbiomes are for | `README.md` L71 | "Detail cells: each has a **biome**; also meant for towns, ore, factions". |
| Elevation zone types | `src/world/zones.ts` L13, L25–31, L45–53 | `ocean`, `flat`, `lowland`, `hills`, `mountains`; land types hashed per zone with weights 5 / 6 / 1 / 1. These are relief classes, not geology. |
| Biome pipeline | `src/world/biomes.ts` L1–27 | T = T₀ − cooling(height); P × `sparseDry` in river-poor flat zones; aridity m = P / (20·T + 140); thermal belt × moisture class → biome. |
| Biome list | `src/world/biomes.ts` L35–51, L61–78 | The 16 biome ids used in this note (codes in §4.0). |
| Thermal belts | `src/world/biomes.ts` L88–94, L97 | polar < −10 °C ≤ subpolar < −3 ≤ boreal < 3 ≤ temperate < 18 ≤ tropical. Cool and warm temperate forest split at 10 °C. |
| Moisture classes | `src/world/biomes.ts` L100, L107–108, L111–113 | Arid, Semi-arid, Subhumid, Humid, Perhumid. Bounds on m: 0.5 / 1 / 2 / 6 (temperate) and 0.5 / 1 / 2 / 4 (tropical). `dryThreshold(t) = max(40, 20t + 140)`. |
| Per-subbiome record | `src/world/biomes.ts` L197–222 (`BiomeInfo`) | `zoneType`, `t0`, `p0`, `height`, `t`, `p`, `aridity`, `belt`, `moisture`, `sparse`, and **`seaLevel`**, the biome the subbiome would have at sea level. A tropical `seaLevel` with a temperate `belt` marks a **tropical highland**, which several crops need (coffee, tea, quinoa, enset). |
| Typical heights | `src/world/biomes.ts` L194 | Median subbiome height per zone type: flat 70 m, lowland 140, hills 270, mountains 470. |
| Climate fields | `src/world/climate.ts` L1–10, L94–107 | `temperatureAt` (°C), `precipitationAt` (mm/yr, log scale), and `prosperityAt`, a unitless index "there for later use (settlements, roads)". |
| Climate defaults | `defaults.json` L76–77, L82–83, L88–89 | Temperature −10 to 30 °C, precipitation 100 to 10 000 mm/yr, prosperity 1 to 100. |
| Height cooling | `defaults.json` L90–100 | Cooling spline 0 m → 0 °C, 200 → 1, 400 → 5, 900 → 11, 1250 → 20; `bio.sparseDry` 0.2. Note: the `biomes.ts` header (L8–9) calls the default "the standard atmosphere's 6.5 °C per km", but these defaults are steeper: 16 °C/km on average up to 1250 m, about 26 °C/km between 900 and 1250 m. |
| Coast | `src/world/rivers.ts` L237–242 | `isCoastSub(skey)`: the subbiome touches a cell of the other kind (land vs ocean). |
| Dry flat zones | `src/world/rivers.ts` L272–276; `defaults.json` L26 | `isSparseFlat(zkey)`: a flat zone whose site precipitation is below 1660 mm. Fewer river attractors, and P × 0.2 for the biome. |
| River flow | `src/world/rivers.ts` L32–35, L139–145, L858–860 | Each node's `flow` = attractors reached upstream, a drainage-area proxy. Parent links give the downstream direction. |
| Terrain and floodplain | `src/world/terrain.ts` L12–30, L278–279; `defaults.json` L63–71 | Heights in metres per 1 km raster cell (`hgt.res` 1000). River beds from the stream-power law; flat floodplain whose half-width is a spline of bed height (400 m at sea level, 30 m at 1000 m), optionally ∝ √flow. |
| Filled depressions | `src/world/terrain.ts` L231–233 | `filled` and `maxFill`: cells the Priority-Flood raised ("lakes / flats"). The only lake-like signal at `b94e28d`; lakes are now a feature of their own (next table). |
| Subbiome height | `src/world/terrain.ts` L371 | `subHeight(skey, rkey)`: mean land height of the subbiome from its tile. |

**Added since `b94e28d`** (lines at commit `397f779`)

| Hook | File, lines | What it gives a resource pass |
|---|---|---|
| Lakes | `src/world/lakes.ts` L1–39 (header), L57–82 (`Lake`), L84–95 (`RegionLakes`), L189 (`get`), L200 (`block`), L237 (`lakeAt`); commit `4766597` | Real lake polygons, placed per region after the rivers and **always on a river** (a node of flow ≥ `LAKE_MIN_FLOW` = 4, L118). Each `Lake` records its host subbiome (`sub`), the river node and its `flow`, its size (diameter of the equal-area circle) and `area`. Defaults: chance 0.06 per eligible river subbiome, size 1.5–5 km (`lake.*` in `defaults.json`). Never in ocean or mountains zones, desert subbiomes (hot or cold desert at sea level) or river-poor flat zones (`block()` says which). The terrain does not level them: `maxFill` (above) is a separate signal. |
| Mangrove | `src/world/biomes.ts` L23–28 (header step 5), L85 (`mangrove` id), L90–95 (`MANGROVE_BIOME`, `MANGROVE_ZONES`), L298–321 (`isCoastal`), L343 (override); commit `dc52798` | A 17th biome id, `mangrove`. A coastal land subbiome (a raw member borders an ocean subbiome) in a flat or lowland zone becomes mangrove when T ≥ `bio.mangroveT` (20 °C) and m ≥ `bio.mangroveM` (0.5). About 5 % of coastal subbiomes at the defaults. |
| Coastal flag per biome record | `src/world/biomes.ts` L238 (`BiomeInfo.coastal`) | Coast for the **merged** subbiome, cached with the biome. `isCoastSub` (above) is the same test on one raw subbiome. |
| Supernatural map | `src/world/climate.ts` L11–13, L121–123 (`supernaturalAt`); commit `397f779` | A unitless 0–100 Perlin fBm (10 km features, 3 octaves) "for magic resources and other fantasy game play". It feeds nothing yet. |

**Scale.** The task brief says a subbiome is "roughly 1 km across". In the code it is an 8 km lattice cell (`defaults.json` L27, `README.md` L71), so a typical subbiome covers about 50–65 km². The 1 km figure is the terrain raster (`hgt.res`). This matters for §7: an 8 km cell is big enough to hold a staple-food profile *and* one to three point resources (a quarry, a mine, a salt pan), not just one.

---

## 1. Overview

A world economy needs three things from the land. **Food** decides how many people a place can feed. **Construction materials** decide what they build with. **Wealth** resources (metals, salt, fibres, dyes, spices, gems, furs) are what they trade. The catalogue in §4 lists 370 resources with the conditions that decide where each can occur.

Four points shape everything below:

1. **Climate decides most of the above-ground list.** Crops, timber, wild plants, livestock and game follow temperature and rainfall. For 150+ plants, ECOCROP gives numeric limits that map almost directly onto the map's `t` and `p` (§4).
2. **Geology decides most of the underground list.** Ores, gems, building stone, coal and salt beds depend on rock type and tectonic history, which the map does not model. The USGS deposit models describe each type by "rock types", "depositional environment" and "tectonic setting" (M17, M39a, …). §3.2 and §7.3 propose a minimal geology attribute.
3. **Water and coast are the cheapest wealth.** Rivers give irrigation, fish, mill power, clay, gravel, reeds and placer gold. Coasts give fish, shellfish, salt, seaweed and trade. The map already has both (`isCoastSub`, river flow, floodplains).
4. **What a place lacks makes trade.** Salt, iron, timber in the steppe and desert, and fuel for smelting are the classic deficits (§6). A believable economy follows from making these scarce in the right places.

---

## 2. What the map gives per subbiome

| Variable | Where | Range at defaults | Used for |
|---|---|---|---|
| Elevation zone type | `zones.ts` L13 | ocean, flat, lowland, hills, mountains | Relief, terrain energy, a stand-in for geology (§7.3) |
| Height h (m) | `terrain.ts` L371; `biomes.ts` L194 | 0 to a few thousand m | Altitude limits (ECOCROP `alt`), treeline, cooling |
| Temperature t (°C) | `BiomeInfo.t` | about −10…30 at sea level, colder with height | Thermal belt; crop and tree limits |
| Precipitation p (mm/yr) | `BiomeInfo.p` | 100…12 000 (10 000 at `b94e28d`), × 0.2 in dry flat zones | Directly comparable with ECOCROP annual rainfall |
| Aridity m | `BiomeInfo.aridity` | p / (20t + 140) | Moisture class |
| Belt, moisture class, biome | `biomes.ts` L88–155 | 5 belts, 5 classes, 17 biomes (16 at `b94e28d`, plus mangrove) | Biome codes in the tables |
| Sea-level biome | `BiomeInfo.seaLevel` | as biome | Tropical highland test |
| Sparse flat | `BiomeInfo.sparse` | boolean | Dry plains, desert pavements, salt flats candidates |
| Coast | `rivers.ts` L237; `BiomeInfo.coastal` | boolean per subbiome | Fishing, salt, shellfish, trade ports |
| Mangrove | `BiomeInfo.biome` = `mangrove` (MG) | warm, not-desert coast of a flat or lowland zone | Mangrove timber and charcoal, tannin bark, crabs, oysters, nipa (§3.1) |
| Lake | `Lakes.get(region).lakes`, `Lake.sub`; `Lakes.block(skey)` | 0 or 1 per river subbiome (chance 0.06); 1.5–5 km across | Lake fish, reeds, wild rice, lotus, ice harvest, transport (§3.1) |
| River and flow | `rivers.ts` L139–145 | flow = attractors upstream | Water, mills, fish, placers, floodplain soils |
| Floodplain | `terrain.ts` L22–23, L278 | half-width 30–400 m (× √flow) | Alluvial soils, clay, rice, hay, reeds |
| Prosperity | `climate.ts` L104–107 | 1…100 | Free index for settlements; could become a resource-wealth score |
| Supernatural | `climate.ts` `supernaturalAt` (at `397f779`) | 0…100, 10 km features | Strength of magic; a trigger for the fantasy resources (§5) |

---

## 3. Missing biomes and map features

A resource that depends on one of these should not be forced onto an existing biome. Each row gives what would define the feature from quantities the map already has, or the new input it would need. All definitions are Design notes.

### 3.1 Surface features

| Feature | Resources that need it | Proposed definition |
|---|---|---|
| **Freshwater wetland: marsh, fen, swamp** | Reeds, cattail, wild rice, wildfowl, eels, bog iron, sago, papyrus, peat (fen) | Floodplain or filled-depression cells (`terrain.ts` L231) with low slope, in Subhumid–Perhumid classes. Swamp when the belt is tropical. |
| **Peat bog (mire)** | Peat fuel, bog iron, cloudberry, bog oak, sphagnum | Boreal or temperate belt, Humid–Perhumid, low gradient (flat or lowland, or filled cells). Xu et al. 2018: peatlands cover about 4.23 million km², about 2.84 % of land **[partially verified: abstract]**. USGS Circular 1143: a wet climate lets peat "pile up above the surrounding area" (Fig. 8 caption) **[partially verified: figure page]**. |
| **Lake** | Lake fish, freshwater pearl mussels, ice harvest, lotus, water chestnut, transport | **Implemented** (`lakes.ts`, commit `4766597`): per-region lake polygons on rivers, recorded per host subbiome (`Lake.sub`), with area and the river's flow. They are open, river-fed (freshwater) lakes; endorheic ones are not modelled (next row). |
| **Endorheic lake, salt flat, playa** | Lake salt, natron, soda, gypsum, borax, brine shrimp | Sparse flat zone (`isSparseFlat`) in the Arid class with no river outlet. Warren 2010 links evaporites to "belts of suitable aridity" **[partially verified: abstract]**. Still open: the lakes exclude exactly these places (desert and river-poor flat subbiomes), so a playa needs its own rule. |
| **Oasis** | Date palm, irrigated grain, caravan water | Hot or cold desert subbiome with a river (exotic river from wetter uplands) or a spring at the foot of hills or mountains. |
| **Estuary, delta, salt marsh** | Oysters, eels, salt meadows, reeds, wildfowl, sea salt | Coast subbiome where a river with high flow reaches the sea (river root, `rivers.ts` L148–149). Delta when flow is high and the coast is flat. |
| **Mangrove** | Mangrove timber and charcoal, tannin bark, crabs, oysters, nipa thatch | **Implemented** as the biome `mangrove` (MG; `biomes.ts`, commit `dc52798`): a coastal subbiome of a flat or lowland zone with T ≥ 20 °C and m ≥ 0.5, both configurable. It does not yet ask for an estuary or a sheltered coast. Proposed originally: tropical-belt estuary or sheltered coast. Osland et al. 2017 found minimum-temperature range limits on some coasts and rainfall limits on others **[partially verified: USGS abstract page]**. Nipa palm tolerates high salinity, > 10 dS/m (`EC`). |
| **Beach and dunes** | Shoreline placers (Ti, Zr), glass sand, amber strand, shellfish | Coast subbiome on a flat or lowland zone. |
| **Rocky coast and cliffs** | Seabird eggs, seals, murex, kelp, building stone | Coast subbiome on a hills or mountains zone. |
| **Coral reef** | Reef fish, pearl oysters, sponges, turtles, precious coral, lime | Shallow ocean next to tropical coast. NOAA: reef-building corals live from 35° N to 35° S, grow best at 23–29 °C, need 32–42 ‰ salinity and light to about 30 m. |
| **Kelp coast** | Seaweed, kelp ash (soda, iodine), sea otters, abalone | Cold-water rocky coast. Steneck et al. 2002: kelp is limited "by light at high latitudes and by nutrients, warm temperatures and other macrophytes at low latitudes" **[partially verified: abstract]**. |
| **Upwelling coast** | Large pelagic fisheries (anchovy, sardine), guano islands | Coast with cold water next to a dry land climate. Needs a wind or current direction; could be hashed per ocean elevation zone. |
| **Sea ice and polar coast** | Seals, walrus, polar bear, narwhal | Ocean next to ice or tundra subbiomes. |
| **Alpine meadow** (above treeline, not ice) | Summer pasture (transhumance), alpine herbs, marmots | Mountains zone with belt subpolar or boreal while `seaLevel` is temperate or tropical. Today these become tundra or taiga; a separate id would let them carry pasture, not reindeer. |
| **Tropical montane cloud forest** | Coffee, tea, cinchona, orchids, tree ferns | `seaLevel` tropical, belt temperate, Humid–Perhumid. |
| **Mediterranean (winter-rain) climate** | Olive, vine, cork oak, kermes, wheat without irrigation | Needs a precipitation-seasonality field (`biomes-and-climate.md` §7.2 step 4). Without it, use warm-temperate Semi-arid–Subhumid (the WS biome) as a proxy. |
| **Monsoon (summer-rain) climate** | Rice without irrigation, jute, indigo | Seasonality field again; proxy: tropical Subhumid–Humid near coasts. |
| **Permafrost** | Mammoth ivory, ice cellars, frozen preservation | Subpolar and boreal belts with low t. |
| **Glacier** | Glacial sand and gravel downstream, ice | Ice biome in mountains zones; glacial meltwater rivers. |
| **Gorge, rapids, waterfalls** | Water-power sites, fish weirs, placer traps | River segments where bed gradient jumps (zone type changes along the river). |
| **Fire regime** | Savanna vs dry forest, charcoal sites | `biomes-and-climate.md` §5.3: hash or fire field in the 1000–2000 mm hot band. |

### 3.2 Underground and geological features

| Feature | Resources that need it | Proposed definition |
|---|---|---|
| **Bedrock class** | Every ore, gem, stone, coal and salt bed | A per-elevation-zone attribute (§7.3). The single most important missing input. |
| **Karst and caves** | Cave shelter, saltpetre, bat guano, springs, cave fungi, MVT lead-zinc, karst bauxite | Carbonate bedrock in Humid classes (dissolution), hills or lowland zones. |
| **Volcanic ground** | Obsidian, pumice, pozzolana, sulfur, hot springs, epithermal gold, fertile soils | A volcanic flag on mountains (and some hills) zones, clustered along arcs (§7.3). |
| **Hot and mineral springs** | Spas, sulfur, alum, salt, mercury | Volcanic flag or major faults (region borders, the divide ridges of `terrain.ts` L26–27). |
| **Aquifer** | Wells in dry plains, qanats | Alluvium under flat and lowland zones; recharge from neighbouring hills and mountains. |
| **Salt diapir and brine spring** | Rock salt, brine | Evaporite member of a sedimentary-basin bedrock class. |
| **Coal basin** | Coal, lignite, oil seeps | Clastic sedimentary basin bedrock (old coal swamps; USGS Circular 1143). |
| **Craton, fold belt, ophiolite, granite intrusion** | Diamonds, gold, tin, chromite, nickel, copper | Sub-classes of the bedrock attribute (§7.3). |

---

## 4. The catalogue

### 4.0 Column codes

- **Role**: F food, C construction, W wealth (trade, luxury, industry, fuel). Several letters when it serves several.
- **Pos**: A above ground, U underground, A/U both, W water (river, lake, sea).
- **Zones**: Fl flat, Fl\* dry (sparse) flat, Lo lowland, Hi hills, Mo mountains, any = all land; `cst` coast subbiome, `riv` river present, `fp` floodplain, `hiT` tropical highland (`seaLevel` tropical, belt temperate).
- **Biomes**: IC ice, TU tundra, CS cold steppe, TA taiga, CD cold desert, GR temperate grassland, WS woodland & shrubland, MF temperate mixed forest, BL temperate broadleaf, TR temperate rainforest, HD hot desert, TS thorn scrub, SV savanna, DF tropical dry forest, RF tropical rainforest, MG mangrove (added after this catalogue was written; rows that said *mangrove* now say MG), OC ocean. Belts: Po, Sp, Bo, Te (Te-c below 10 °C, Te-w above), Tr. Moisture: Ar, SAr, SHu, Hu, PHu. *Missing features* from §3 are in italics. *lake* is no longer missing: read it as "a `Lake` in the subbiome" (`lakes.ts`).
- **Rar** (in a subbiome where the conditions hold): C common, U uncommon, R rare, VR very rare.
- **Val**: S subsistence, B bulk (traded locally and by water), T trade good, L luxury.
- **Chain**: what turning it into a usable good needs.
- **Src**: source key (§9). `U` = [unverified] general knowledge.

### 4.1 Cereals and grains

| # | Resource | Role | Pos | Zones | Biomes | Conditions (sourced) | Rar | Val | Chain | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Bread wheat | F W | A | Fl Lo Hi | GR, WS, MF, BL; CS edge | T 15–23 (5–27); P 750–900 (300–1600); alt 4500; kill 0 | C | B T | Mill (water, wind or animal) → flour; oven fuel | EC |
| 2 | Durum wheat | F W | A | Fl Lo | WS, GR (Te-w) | T 17–25 (6–30); P 500–700 (400–800) | U | B T | Mill; pasta, bulgur | EC |
| 3 | Spelt and emmer | F | A | Lo Hi | MF, BL (Te-c) | Spelt T 10–17 (4–24); P 700–1000 (300–1600) | U | S B | Dehusking, mill | EC |
| 4 | Barley | F W | A | any | CS, GR, WS, MF, TA edge; Hi, Mo | T 15–20 (2–40); P 500–1000 (200–2000); alt 4400; kill 0 | C | S B | Malting → beer; mill | EC |
| 5 | Rye | F | A | Fl Lo Hi | TA, MF, CS | T 15–20 (3–31); P 600–1000 (400–2000); alt 4300; kill −1 | C | S B | Mill; rye bread | EC |
| 6 | Oats | F | A | Lo Hi | MF, TR, TA edge | T 16–20 (5–30); P 600–1000 (250–1500) | C | S B | Horse fodder; porridge | EC |
| 7 | Rice (paddy) | F W | A | Fl Lo fp riv; terraced Hi | DF, RF, SV (irrigated), BL Te-w | T 20–30 (10–36); P 1500–2000 (1000–4000); alt 2500 | C on fp | B T | Water control, terraces, hulling | EC |
| 8 | Maize | F | A | Fl Lo Hi | BL Te-w, SV, DF, GR Te-w | T 18–33 (10–47); P 600–1200 (400–1800); alt 4000 | C | B | Nixtamalisation (lime/ash) [unverified] | EC |
| 9 | Sorghum | F | A | Fl Lo | TS, SV | T 22–35 (8–40); P 400–600 (300–700) | C | S B | Grinding; beer | EC |
| 10 | Pearl millet | F | A | Fl Fl\* Lo | TS, SV, HD edge | T 25–35 (12–40); P 400–900 (200–1700); alt 1800 | C | S | Grinding | EC |
| 11 | Finger millet | F | A | Hi Mo hiT | SV, DF, tropical highland | T 18–30 (8–35); P 500–1100 (300–4300); alt 2500 | U | S | Grinding; beer | EC |
| 12 | Proso millet | F | A | Fl Lo | CS, GR (dry, short season) | T 20–32 (15–45); P 500–750 (200–1000); cycle 55–280 d | U | S | Grinding | EC |
| 13 | Foxtail millet | F | A | Fl Lo | GR, CS | T 16–26 (5–35); P 500–700 (300–4000) | U | S | Grinding | EC |
| 14 | Teff | F W | A | Hi Mo hiT | tropical highland | T 22–28 (2–30); P 600–1200 (300–2500); alt 2800 | R | S T | Grinding; flatbread | EC |
| 15 | Buckwheat | F | A | Hi Mo | TA, MF, short summers | T 17–27 (7–40); P 700–1000 (400–1300); cycle 55–85 d | U | S | Dehusking | EC |
| 16 | Quinoa | F | A | Mo hiT | cold semi-arid highland | T 14–18 (2–35); P 500–1000 (250–2600); alt 4000; kill −8 | R | S | Washing off saponins [unverified] | EC |
| 17 | Fonio | F | A | Fl Lo | SV | T 22–27 (18–31); P 900–1600 (400–2800) | R | S | Dehusking | EC |
| 18 | Wild rice (*Zizania*) | F W | W | *lake, marsh* | Te-w, BL, MF | *Z. latifolia* T 22–32 (14–35); P 600–2500 (400–3500) | R | S T | Parching | EC |

### 4.2 Roots, tubers, pulses, oilseeds and vegetables

| # | Resource | Role | Pos | Zones | Biomes | Conditions (sourced) | Rar | Val | Chain | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| 19 | Potato | F | A | Lo Hi Mo hiT | MF, BL, TR; tropical highland | T 15–25 (7–30); P 500–800 (250–2000); alt 2800; kill 0 | C | S B | Freeze-drying (chuño) in Mo [unverified] | EC |
| 20 | Cassava | F | A | Fl Lo Hi | DF, RF, SV | T 20–29 (10–35); P 1000–1500 (500–5000); kill 0 | C | S | Soaking or grating to remove cyanogens [unverified] | EC |
| 21 | Sweet potato | F | A | Fl Lo Hi | SV, DF, RF, BL Te-w | T 18–28 (10–38); P 750–2000 (350–5000); alt 2800; kill 5 | C | S | — | EC |
| 22 | Greater yam | F | A | Lo Hi | RF, DF | T 20–32 (14–40); P 1200–4000 (700–8000); kill 9 | C | S | Storage barns | EC |
| 23 | Taro | F | A | fp Lo | RF, wet floodplain | T 21–28 (10–35); P 1800–2700 (1000–4100) | U | S | Cooking (oxalate) [unverified] | EC |
| 24 | Banana and plantain | F | A | Lo Hi | RF, DF | *Musa acuminata* T 23–33 (12–42); P 1200–3600 (650–5000); kill 1 | C | S B | — | EC |
| 25 | Enset | F | A | Hi Mo hiT | tropical highland | T 16–24 (8–30); P 1100–1500 (900–1700); alt 3100 | R | S | Fermented pulp | EC |
| 26 | Sago palm | F | A | Fl Lo | RF; *swamp* | T 25–36 (18–40); P 3000–4500 (2100–5800); alt 700 | U | S | Pith washing → starch | EC |
| 27 | Breadfruit | F | A | Lo cst | RF | T 21–33 (16–40); P 1500–3000 (1000–3500) | U | S | Fermented storage pits [unverified] | EC |
| 28 | Faba bean | F | A | Fl Lo Hi | MF, BL, GR | T 18–28 (5–32); P 650–1000 (250–2600); alt 2700 | C | S | Fodder too | EC |
| 29 | Pea | F | A | Lo Hi | MF, BL, TA edge | T 10–24 (4–30); P 800–1200 (350–2500); kill 0 | C | S | Drying | EC |
| 30 | Lentil | F W | A | Fl Lo Hi | GR, WS Te-w | T 15–29 (5–32); P 600–1000 (250–2500); alt 3800 | U | S T | — | EC |
| 31 | Chickpea | F W | A | Fl Lo | WS, GR, SV dry season | T 15–29 (7–35); P 600–1000 (300–1800) | U | S T | — | EC |
| 32 | Common bean | F | A | Lo Hi hiT | BL Te-w, DF, tropical highland | T 16–25 (7–32); P 500–2000 (300–4300); alt 3000 | C | S | — | EC |
| 33 | Cowpea | F | A | Fl Lo | SV, TS | T 25–35 (15–40); P 500–1500 (300–4100) | C | S | — | EC |
| 34 | Pigeon pea | F | A | Fl Lo Hi | SV, DF | T 18–38 (10–45); P 600–1500 (400–4000) | U | S | — | EC |
| 35 | Soybean | F W | A | Fl Lo | BL Te-w | T 20–33 (10–38); P 600–1500 (450–1800) | U | S T | Fermenting, pressing | EC |
| 36 | Groundnut | F W | A | Fl Lo | SV, DF | T 22–32 (10–45); P 600–1500 (400–4000) | U | S T | Oil press | EC |
| 37 | Sesame | F W | A | Fl Lo | SV, TS, WS Te-w | T 20–30 (10–40); P 500–1000 (300–1500) | U | T | Oil press | EC |
| 38 | Rapeseed and turnip rape | F W | A | Fl Lo | MF, GR, TA edge | *B. napus* T 15–25 (5–41); P 500–1000 (400–2800); kill −6 | U | B | Oil press → lamp oil | EC |
| 39 | Sunflower | F W | A | Fl Lo | GR, CS | T 17–34 (5–45); P 600–1000 (300–1600) | U | B | Oil press | EC |
| 40 | Onion and other alliums | F | A | any | broad | T 12–25 (4–30); P 350–600 (300–2800) | C | S | Drying | EC |
| 41 | Cabbage and kale | F | A | Lo Hi | MF, BL, TR | *B. oleracea* T 10–25 (5–30); P 600–1100 (450–1900); kill −5 | C | S | Fermentation (salt) | EC |
| 42 | Carrot and root vegetables | F | A | any | Te, Bo edge | T 15–24 (3–30); P 600–1200 (400–4000) | C | S | Root cellars | EC |
| 43 | Beet (sugar, fodder) | F W | A | Fl Lo | GR, MF | T 15–25 (4–35); P 600–800 (500–1000) | U | B | Sugar boiling (late technology) | EC |
| 44 | Melons and watermelon | F | A | Fl Fl\* fp | WS, TS, *oasis* | *Citrullus* T 20–35 (15–40); P 500–700 (400–1800) | U | S T | — | EC |
| 45 | Tiger nut (chufa) | F | A | fp Lo | WS, SV | T 14–26 (4–30); P 500–1000 (300–1700) | U | S | — | EC |
| 46 | Bottle gourd | F C | A | Lo | SV, DF | T 19–27 (12–38); P 1200–1800 (700–2800) | C | S | Containers, floats | EC |

### 4.3 Tree crops, fruit and nuts

| # | Resource | Role | Pos | Zones | Biomes | Conditions (sourced) | Rar | Val | Chain | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| 47 | Olive | F W | A | Lo Hi | WS (Te-w, SAr–SHu); *Mediterranean* | T 20–34 (5–40); P 400–700 (200–1200); alt 1200; kill 0 | C | T | Press → oil; amphorae (clay) | EC |
| 48 | Grape (wine, raisins) | F W | A | Hi Lo | WS, BL Te-w | T 18–30 (10–38); P 700–850 (400–1200); alt 2000; kill −3 | U | T L | Press, cooperage (oak), pottery | EC |
| 49 | Date palm | F W | A | Fl Fl\* riv | HD, TS; *oasis* | T 26–45 (10–52); P 200–300 (100–400); kill −4. Needs groundwater or river water [unverified] | U | T | Drying; palm fibre, timber | EC |
| 50 | Fig | F W | A | Lo Hi | WS, BL Te-w | T 16–26 (4–38); P 700–1500 (300–2700); kill −1 | C | S T | Drying | EC |
| 51 | Pomegranate | F W | A | Lo Hi | WS, TS | T 23–32 (8–40); P 900–1200 (400–4200); kill 0 | U | T | Rind is a tannin and dye [unverified] | EC |
| 52 | Almond | F W | A | Hi Lo | WS, GR Te-w | *P. amygdalus* T 12–35 (10–40); P 600–900 (250–1500); kill −1 | U | T | — | EC |
| 53 | Pistachio | F W | A | Hi | WS dry, CD edge Te-w | T 25–35 (12–40); P 400–700 (250–1100); alt 1200 | R | L | — | EC |
| 54 | Carob | F | A | Lo Hi cst | WS | T 20–32 (10–39); P 400–1000 (200–2000) | U | S | Fodder | EC |
| 55 | Apple | F W | A | Lo Hi | MF, BL | T 14–27 (8–33); P 700–2500 (500–3200); kill −2 | C | S T | Cider press | EC |
| 56 | Pear | F | A | Lo Hi | MF, BL | T 20–35 (10–37); P 600–900 (400–2100); kill −9 | U | S | Perry | EC |
| 57 | Peach and stone fruit | F | A | Lo Hi | BL Te-w | T 20–33 (7–35); P 900–1100 (750–1600); kill −5 | U | T | Drying | EC |
| 58 | Citrus | F W | A | Lo | BL Te-w frost-free, DF, WS | *C. sinensis* T 20–30 (13–38); P 1200–2000 (450–2700); kill 0 | U | T | — | EC |
| 59 | Walnut | F W C | A | Lo Hi | BL, Hi | T 15–30 (7–40); P 800–1700 (400–2200); alt 3650; kill −2 | U | T | Oil; prized furniture wood | EC |
| 60 | Sweet chestnut | F C | A | Hi Lo | BL | T 15–25 (7–30); P 900–1300 (500–1600) | U | S | Flour; coppice poles | EC |
| 61 | Hazel | F C | A | any | MF, BL understorey | T 10–24 (5–35); P 900–1100 (600–1400); kill −3 | C | S | Coppice for wattle, hurdles | EC |
| 62 | Stone pine nuts | F W | A | Lo cst | WS | *P. pinea* T 18–32 (8–38); P 500–700 (400–800) | U | T | — | EC |
| 63 | Cedar-pine nuts (Siberian, Korean) | F W | A | Hi Mo | TA, MF | — | U | T | — | U |
| 64 | Coconut | F C W | A | cst Lo | tropical coast | T 22–34 (14–38); P 1200–2400 (650–4000); alt 1500; kill 0 | C on cst | S T | Copra, coir, toddy, thatch | EC |
| 65 | Oil palm | F W | A | Lo | RF | T 20–35 (12–38); P 1500–3000 (1000–8000) | C | B T | Boiling and pressing | EC |
| 66 | Mango | F | A | Lo | DF, SV | T 24–30 (8–48); P 600–1500 (300–2600); kill 0 | C | S | — | EC |
| 67 | Avocado | F | A | Hi hiT | tropical highland, DF | T 14–40 (10–45); P 500–2000 (300–2500); kill −1 | U | S | — | EC |
| 68 | Tamarind | F W | A | Lo | DF, SV | T 20–35 (12–45); P 800–3000 (300–4500) | U | T | — | EC |
| 69 | Baobab | F W | A | Fl Lo | SV, TS | T 26–36 (14–42); P 600–1500 (250–4200) | U | S | Leaves, fruit, bark fibre | EC |
| 70 | Shea | F W | A | Fl Lo | SV | *Vitellaria* T 24–38 (18–43); P 500–1000 (300–1800) | U | T | Butter (boiling, fuel) | EC |
| 71 | Brazil nut | F W | A | Lo | RF | T 20–36 (12–40); P 2400–2800 (1400–3500); alt 200 | R | T | — | EC |
| 72 | Cashew | F W | A | Lo cst | DF, SV | T 15–35 (5–46); P 750–1600 (400–4000) | U | T | Roasting (caustic shell) [unverified] | EC |
| 73 | Palmyra palm | F C | A | Fl Lo | SV, DF | *Borassus* T 24–32 (16–36); P 1000–1500 (700–4200) | U | S | Palm sugar, leaf thatch | EC |
| 74 | Prickly pear | F W | A | Hi Lo | WS, TS | T 18–26 (10–30); P 700–1300 (300–1700) | U | S | Host of cochineal (#156) | EC |
| 75 | Jujube | F | A | Lo Hi | TS, WS | *Ziziphus mucronata* T 12–30 (8–36); P 400–800 (300–1000) | U | S | Drying | EC |
| 76 | Mesquite pods | F | A | Fl\* riv | TS, HD wadis | *Prosopis alba* T 10–20 (7–28); P 200–500 (100–700) | U | S | Pod flour; fuelwood | EC |
| 77 | Desert date | F | A | Fl Lo | TS, SV | *Balanites* T 20–35 (15–41); P 300–800 (200–1700) | U | S | Oil | EC |
| 78 | Guava, papaya, pineapple | F | A | Lo | RF, DF | Guava T 20–33 (10–45); papaya P 1500–2500; pineapple P 800–2500 | C | S | — | EC |

### 4.4 Wild plant foods and foraging

| # | Resource | Role | Pos | Zones | Biomes | Conditions (sourced) | Rar | Val | Chain | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| 79 | Bilberry and blueberry | F | A | any | TA, MF, TU edge, Mo | *V. myrtillus* T 8–17 (5–25); P 500–700 (250–1700); alt 3500 | C | S | Drying | EC |
| 80 | Cloudberry and crowberry | F | A | Fl Lo | TU, TA; *bog* | — | U | S | — | U |
| 81 | Raspberry and bramble | F | A | Lo Hi | MF, BL clearings | *R. idaeus* T 17–23 (5–28); P 800–1200 (300–1700) | C | S | — | EC |
| 82 | Sea buckthorn | F W | A | riv Mo | CS, CD, Mo, river gravels | T 8–20 (4–39); P 300–600 (200–800); alt 4500 | U | S T | Oil, juice | EC |
| 83 | Elderberry | F | A | Lo | BL, MF | T 12–22 (5–30); P 400–2000 (abs) | C | S | — | EC |
| 84 | Forest mushrooms | F W | A | any | TA, MF, BL | — | C | S T | Drying | U |
| 85 | Acorns | F | A | Lo Hi | BL, WS (oak) | — | C | S | Leaching; pannage for pigs | U |
| 86 | Wild grass seed and wild cereals | F | A | Fl Lo | GR, CS, SV | — | C | S | — | U |
| 87 | Lotus (root, seed) | F | W | *lake, marsh* | Tr, Te-w | *Nelumbo* T 25–30 (10–40); P 2000–2800 (700–4000) | U | S T | — | EC |
| 88 | Water chestnut (*Trapa*) | F | W | *lake*, slow riv | Te | T 15–25 (10–35); P 500–1200 (300–1600) | U | S | — | EC |
| 89 | Cattail (rhizome, pollen) | F C | W | fp, *marsh* | Te, Bo | *Typha angustifolia* T 10–24 (7–28); P 500–1500 (300–4000) | C in marsh | S | Also matting, thatch | EC |
| 90 | Arrowhead | F | W | *marsh* | Te | *Sagittaria* T 16–24 (12–28); P 900–1200 (600–1500) | U | S | — | EC |
| 91 | Maple and birch sap | F W | A | Lo Hi | MF, BL (Te-c, continental) | — | U | S T | Boiling (fuel) | U |
| 92 | Edible seaweed and kelp | F W | W | cst | cold rocky coast; *kelp coast* | Kelp limited by light at high latitudes, warmth and nutrients at low latitudes | U | S B | Kelp ash → soda, iodine [unverified] | STEN |
| 93 | Wild herbs and medicinal plants | F W | A | any | all forest and grassland | — | C | S T | Drying, distillation | U |

### 4.5 Livestock, pasture and fodder

| # | Resource | Role | Pos | Zones | Biomes | Conditions (sourced) | Rar | Val | Chain | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| 94 | Cattle (milk, meat, draught) | F W | A | Fl Lo Hi | GR, MF, BL, SV, WS | Excluded by tsetse fly in much of humid tropical Africa [unverified] | C | B T | Hides → leather (needs tannin, #241) | U |
| 95 | Sheep (meat, milk, wool) | F W | A | any | GR, CS, WS, Hi, Mo | — | C | B T | Shearing, spinning, fulling (#215) | U |
| 96 | Goats | F W | A | Hi Mo | TS, WS, HD edge, Mo | — | C | S | Cashmere in cold Mo (#227) | U |
| 97 | Pigs | F | A | Lo | BL, MF (acorns), near settlements | — | C | S | Salt pork (needs salt) | U |
| 98 | Horses | W | A | Fl Lo | GR, CS | — | U | T | Cavalry, post, ploughing | U |
| 99 | Donkeys and mules | W | A | Hi Mo | TS, WS, HD, Mo | — | U | T | Pack transport | U |
| 100 | Dromedary camel | F W | A | Fl Fl\* | HD, TS | — | U | T | Caravans | U |
| 101 | Bactrian camel | F W | A | Fl Hi | CD, CS | — | R | T | Caravans | U |
| 102 | Yak | F W | A | Mo Hi | Mo above ~3000 m; CS, TU at altitude | Mostly above 3000 m; fine when annual mean < 5 °C and warmest month ≤ 13 °C; densest at −3 to +3 °C; heat stress from 13–16 °C | R | S T | Butter, hair, pack animal | YAK |
| 103 | Reindeer (herded) | F W | A | Fl Lo Hi | TU, TA | — | U | S T | Sledges, hides | U |
| 104 | Water buffalo | F | A | fp Fl Lo | DF, RF, BL Te-w with rice | — | U | B | Draught for paddies | U |
| 105 | Llama and alpaca-like camelids | F W | A | Mo hiT | tropical highland grassland | — | R | T | Fine wool, pack | U |
| 106 | Poultry (chicken, duck, goose) | F W | A | any settled | all except IC | Ducks and geese favour floodplain and *marsh* [unverified] | C | S | Feathers, down | U |
| 107 | Honey and beeswax | F W | A | any | WS, BL, GR, SV; forest bees in TA, MF | — | C | T | Wax → candles, lost-wax casting, seals | U |
| 108 | Alfalfa (lucerne) | F | A | Fl Lo fp | GR, WS (irrigated) | T 21–27 (5–45); P 600–1200 (350–2700); alt 4000 | U | B | Hay | EC |
| 109 | Pasture grass and clover | F | A | Lo Hi | MF, TR, BL meadows | *Lolium perenne* T 14–25 (4–35), P 700–1750; *Trifolium repens* T 14–22 (4–26), P 700–1200 | C | B | Hay → winter fodder | EC |
| 110 | Floodplain hay meadow | F | A | fp | Te, Bo | — (Design note: floodplain cells in Te or Bo) | C | B | Scythe, hay barns | U |
| 111 | Alpine summer pasture | F | A | Mo | *alpine meadow* | — | U | B | Transhumance, cheese | U |
| 112 | Dairy products (cheese, butter) | F W | A | — | from #94–96, #102 | — | — | T | Needs salt; storable trade good | U |

### 4.6 Game and wild animals

| # | Resource | Role | Pos | Zones | Biomes | Conditions (sourced) | Rar | Val | Chain | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| 113 | Deer (red, roe, elk/moose) | F W | A | any | MF, BL, TA, TR | — | C | S | Venison, hides, antler | U |
| 114 | Wild boar | F | A | Lo Hi | BL, MF | — | C | S | — | U |
| 115 | Caribou and wild reindeer | F W | A | Fl Lo | TU, TA | — | U | S | Migratory | U |
| 116 | Bison and wild cattle | F W | A | Fl Lo | GR, CS, BL edge | — | U | S T | Hides, robes | U |
| 117 | Antelope and gazelle | F | A | Fl Lo | SV, TS, HD, CS | — | C | S | — | U |
| 118 | Wild sheep and ibex | F | A | Mo Hi | Mo | — | U | S | Horn | U |
| 119 | Waterfowl | F W | W | fp cst | *marsh*, *estuary*, lakes | — | C | S | Down, feathers | U |
| 120 | Upland game birds | F | A | any | GR, WS, TA, TU | — | C | S | — | U |
| 121 | Hares and rabbits | F | A | any | GR, WS, TU | — | C | S | Cheap fur | U |
| 122 | Sable and marten (fur) | W | A | Lo Hi | TA | — | U | L | Pelts | U |
| 123 | Beaver (fur, castoreum) | W | A | riv | TA, MF with rivers | — | U | L | Pelts, perfume base | U |
| 124 | Fox and Arctic fox (fur) | W | A | any | TU, TA | — | U | T | Pelts | U |
| 125 | Ermine (fur) | W | A | any | TA, TU | — | R | L | Pelts | U |
| 126 | Squirrel (fur) | W | A | Lo Hi | TA, MF | — | C | T | Pelts in bulk | U |
| 127 | Bear (fur, fat) | F W | A | Hi Mo | TA, MF, TR | — | U | T | — | U |
| 128 | Big cats (fur) | W | A | any | SV, RF, DF, Mo | — | R | L | — | U |
| 129 | Seals (oil, fur, meat) | F W | W | cst | Po, Sp, Bo coasts | — | U | B T | Rendering → lamp oil | U |
| 130 | Walrus (ivory, hide, oil) | W | W | cst | *sea ice*, IC, TU coasts | — | R | L | Ivory carving; hide rope | U |
| 131 | Narwhal tusk | W | W | cst | *sea ice* | Sold in medieval Europe as "unicorn horn" [unverified] | VR | L | — | U |
| 132 | Elephant ivory | W | A | Lo | SV, RF, DF | — | R | L | Carving | U |
| 133 | Hippopotamus ivory | W F | W | riv fp | SV, DF rivers | — | R | L | — | U |
| 134 | Ostrich (feathers, eggs) | W F | A | Fl Fl\* | SV, TS, HD | — | U | L | — | U |
| 135 | Exotic feathers (parrots, birds of paradise) | W | A | Lo Hi | RF | — | R | L | — | U |
| 136 | Fossil mammoth ivory | W | U | riv | TU, TA; *permafrost* river banks | — | VR | L | Found where rivers cut frozen sediments [unverified] | U |
| 137 | Whales (oil, baleen, meat) | F W | W | cst OC | cold and upwelling seas | — | U | B L | Rendering; baleen for stays | U |
| 138 | Ambergris | W | W | cst | beaches of warm seas | — | VR | L | Perfume fixative | U |
| 139 | Eider down | W | A | cst | TU, Bo coasts | — | R | L | Collected from nests | U |
| 140 | Turtles (meat, tortoiseshell) | F W | W | cst | tropical coast; *coral reef* | — | U | L | Tortoiseshell inlay | U |
| 141 | Seabird colonies (eggs, birds) | F | A | cst Hi Mo | *rocky coast* | — | U | S | — | U |
| 142 | Musk deer (musk) | W | A | Mo | Mo forests, Te-c / Bo | — | VR | L | Perfume | U |

### 4.7 Fish, shellfish and other aquatic and insect products

| # | Resource | Role | Pos | Zones | Biomes | Conditions (sourced) | Rar | Val | Chain | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| 143 | River fish (carp, catfish, pike, etc.) | F | W | riv | any non-ice | Design note: catch ∝ river flow | C | S | Smoking, salting (salt, fuel) | U |
| 144 | Salmon runs | F W | W | riv cst | TA, MF, TR rivers to a cold sea | — | U | S B | Smoked, dried | U |
| 145 | Sturgeon (meat, caviar, isinglass) | F W | W | riv | large rivers in Te, Bo | — | R | L | Caviar needs salt | U |
| 146 | Eels | F W | W | riv cst | Te; *estuary* | — | U | T | Smoked | U |
| 147 | Lake fish (whitefish, perch, trout) | F | W | *lake* | Bo, Te | — | U | S | — | U |
| 148 | Cod banks | F W | W | cst OC | cold shelf seas next to Bo, Te | — | U | B T | Stockfish (cold dry wind) or salt cod (salt) [unverified] | U |
| 149 | Herring, sardine, anchovy | F W | W | cst OC | *upwelling coast*, temperate shelf | Primary production predicts fish yield across systems | U | B | Salting in barrels | RYTH |
| 150 | Tuna and other large pelagics | F W | W | OC | warm seas | — | U | T | — | U |
| 151 | Oysters and mussels | F W | W | cst | *estuary*, Te and Tr coasts | — | C on cst | S T | Shells → lime (as #297) | U |
| 152 | Clams and cockles | F | W | cst Fl Lo | tidal flats | — | C | S | — | U |
| 153 | Crabs, lobsters, shrimp | F W | W | cst | all coasts; MG | — | U | T | — | U |
| 154 | Reef fish and shellfish | F | W | cst | *coral reef* | Reefs 35° N–35° S; best 23–29 °C; salinity 32–42 ‰; light to ~30 m | U | S | — | NOAA-C |
| 155 | Octopus and squid | F | W | cst | warm and temperate coasts | — | U | S | Drying | U |
| 156 | Cochineal (insect dye) | W | A | Hi Lo | WS, TS on prickly pear (#74) | — | R | L | Drying insects | U |
| 157 | Kermes (insect dye) | W | A | Hi | WS on kermes oak | — | R | L | — | U |
| 158 | Lac (shellac, red dye) | W | A | Lo Hi | DF, SV host trees | — | U | T | Varnish, sealing wax | U |
| 159 | Freshwater pearl mussel | W | W | riv | cold clear rivers (Bo, Te-c) | — | R | L | — | U |
| 160 | Pearl oyster | W | W | cst | warm shallow seas; *coral reef* | — | R | L | Diving | U |
| 161 | Murex (Tyrian purple) | W | W | cst | warm-temperate rocky coast | — | R | L | Thousands of shells per gram [unverified] | U |
| 162 | Precious red coral | W | W | cst | warm-temperate rocky sea floor | — | VR | L | — | U |
| 163 | Sponges | W | W | cst | warm shallow seas | — | U | T | — | U |
| 164 | Guano (seabird) | W | A | cst Fl | rainless coast next to *upwelling* | — | R | T | Fertiliser; saltpetre source | U |
| 165 | Fish oil and fish sauce (garum) | F W | W | cst | from #143–150 | — | — | T | Salt, fermentation vats | U |

### 4.8 Salt, sweeteners and preservatives

| # | Resource | Role | Pos | Zones | Biomes | Conditions (sourced) | Rar | Val | Chain | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| 166 | Sea salt, solar pans | F W | A | cst Fl Lo | coast in Ar, SAr, warm (Te-w, Tr) | One of four production routes (rock, brine, solar, vacuum pan); ocean salt "nearly unlimited" | U | T | Shallow pans; Design note: needs evaporation > precipitation | MCS-salt |
| 167 | Sea salt, boiled | F W | A | cst | any coast | — | U | T | Fuel-hungry: wood or peat [unverified] | U |
| 168 | Rock salt (halite) | F W | U | Lo Hi Fl | any; *evaporite bedrock* | Evaporite belts tied to aridity; halite and gypsum also accompany sediment-hosted Cu (M30b) | R | T | Mining | WARR, M30b |
| 169 | Brine springs | F W | A/U | Lo Hi | over *salt beds* | — | R | T | Boiling (fuel) | U |
| 170 | Lake and playa salt | F W | A | Fl\* | HD, CD; *salt flat* | Evaporites need aridity | U | T | Scraping crusts | WARR |
| 171 | Natron and soda | W | A | Fl\* | HD, CD; *alkaline lake* | — | R | T | Glass flux, soap, embalming | U |
| 172 | Saltpetre (nitre) | W | A/U | Hi Lo | *caves*, stables, dry soils; Atacama-type caliche in hyper-arid desert | The Chilean nitrate deposits are the classic hyper-arid case | R | T | Gunpowder, meat curing | ERIC [partially verified] |
| 173 | Alum | W | U | Hi Mo | *volcanic* (altered rocks), alum shales | — | R | T | Mordant for dyes, tawing leather | U |
| 174 | Sugar cane | F W | A | Fl Lo fp | RF, DF, SV irrigated | T 24–37 (15–41); P 1500–2000 (1000–5000); alt 1600 | U | T | Mill and boiling house (fuel) | EC |
| 175 | Palm sugar and toddy | F W | A | Lo cst | SV, DF, RF; *estuary* (nipa) | Palmyra, coconut, nipa (see #64, #73, #240) | U | S T | Boiling, fermenting | EC |
| 176 | Smoke and smokehouses | F | — | any forest | — | — | — | — | Preservation without salt; needs wood | U |

### 4.9 Spices, stimulants, drugs, aromatics and resins

| # | Resource | Role | Pos | Zones | Biomes | Conditions (sourced) | Rar | Val | Chain | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| 177 | Black pepper | W | A | Lo Hi | RF | T 22–35 (10–40); P 2500–4000 (2000–5500) | R | L | Drying | EC |
| 178 | Clove | W | A | Lo cst | RF (islands) | *Eugenia aromatica* T 24–34 (20–38); P 1500–3600 (1200–4000); alt 900 | VR | L | Drying | EC |
| 179 | Nutmeg and mace | W | A | Lo cst | RF lowland | T 22–34 (12–38); P 1500–3500 (1200–4000); alt 500 | VR | L | Drying | EC |
| 180 | Cinnamon | W | A | Lo | RF | T 24–30 (18–36); P 2000–2600 (1200–3000) | R | L | Bark peeling | EC |
| 181 | Cardamom | W | A | Hi | RF montane | T 22–30 (10–35); P 3000–6000 (1500–7000); alt 1500 | R | L | — | EC |
| 182 | Ginger | W | A | Lo Hi | RF, DF | T 19–29 (13–35); P 1400–3000 (700–4000) | U | T | — | EC |
| 183 | Turmeric | W | A | Lo | DF, RF | T 20–28 (18–32); P 1000–2000 (800–3000) | U | T | Also a yellow dye | EC |
| 184 | Vanilla | W | A | Lo | RF | T 21–30 (10–33); P 2000–2500 (1500–3000); alt 600 | VR | L | Curing | EC |
| 185 | Allspice | W | A | Lo | RF, DF | T 15–32 (10–35); P 1500–2500 (1000–3500) | R | T | — | EC |
| 186 | Chili pepper | F W | A | Lo Hi | DF, BL Te-w | *Capsicum annuum* T 17–30 (8–35); P 600–1250 (500–1700) | U | T | — | EC |
| 187 | Saffron | W | A | Hi | WS, GR, Te-c/Te-w highland | T 7–19 (4–23); P 800–900 (400–1100) | VR | L | Labour: hand-picked stigmas | EC |
| 188 | Cumin | W | A | Fl Lo | WS, GR | T 17–26 (9–30); P 1200–1800 (800–2700) — ECOCROP rainfall looks high for an arid-land spice | U | T | — | EC |
| 189 | Coriander and caraway | W F | A | Lo Hi | WS, GR, MF | Coriander T 15–25 (4–32); caraway T 16–20 (7–26) | U | T | — | EC |
| 190 | Mustard | F W | A | Fl Lo | MF, GR | *Sinapis alba* T 10–25 (5–30); P 700–1100 (500–1300) | C | S T | — | EC |
| 191 | Tea | W | A | Hi Mo hiT | BL Te-w humid; tropical highland | T 20–30 (8–35); P 1400–2000 (1000–5000); alt 2200 | R | L T | Withering, firing, bricks | EC |
| 192 | Coffee (arabica) | W | A | Hi Mo hiT | tropical highland, *cloud forest* | T 14–28 (10–34); P 1400–2300 (750–4200); alt 2800 | R | L T | Drying, roasting | EC |
| 193 | Cacao | W | A | Lo | RF lowland | T 21–32 (10–38); P 1200–3000 (900–7600); alt 900; kill 0 | R | L | Fermenting, drying | EC |
| 194 | Kola nut | W | A | Lo | RF | T 21–30 (10–35); P 1400–2500 (1200–3500) | R | T | — | EC |
| 195 | Betel (areca) nut | W | A | Lo | RF, DF | T 16–33 (7–39); P 1500–3000 (750–5000) | U | T | — | EC |
| 196 | Coca | W | A | Mo hiT | tropical highland slopes | T 17–23 (14–27); P 1000–2100 (700–4000) | R | T | — | EC |
| 197 | Tobacco | W | A | Lo Hi | BL Te-w, DF, WS | T 15–30 (7–35); P 500–750 (350–3000); kill −1 | U | T | Curing barns | EC |
| 198 | Opium poppy | W | A | Hi | WS, Hi Te-w | T 15–24 (3–28); P 800–1200 (300–1700) | R | L | Latex scoring | EC |
| 199 | Hops | W | A | Lo Hi | MF, BL | T 15–19 (8–35); P 400–700 (300–1300) | U | T | Brewing | EC |
| 200 | Frankincense | W | A | Hi | HD, TS uplands | *B. sacra* is not in ECOCROP; the Indian *B. serrata* row is T 33–42 (7–47), P 1000–1500 | VR | L | Tapping resin | EC [partially] |
| 201 | Myrrh | W | A | Hi Lo | TS | *Commiphora africana* T 23–33 (18–40); P 400–800 (250–1000) | R | L | Tapping resin | EC |
| 202 | Gum arabic | W | A | Fl Lo | TS, SV | *Acacia senegal* T 24–32 (14–48); P 300–800 (200–2300) | U | T | Glue, ink binder | EC |
| 203 | Sandalwood | W | A | Lo Hi | DF | *Santalum album* T 22–30 (10–38); P 800–1400 (450–3000) | R | L | Oil distillation | EC |
| 204 | Agarwood (oud) | W | A | Lo | RF | *Aquilaria malaccensis* T 18–24 (12–34) | VR | L | Only infected wood is resinous [unverified] | EC |
| 205 | Pine resin, tar and pitch | W C | A | any | TA, MF, WS (pine) | — | C | B T | Tar kilns; naval stores | U |
| 206 | Copal and dammar resins | W | A | Lo | RF | — | R | T | Varnish, incense | U |
| 207 | Camphor | W | A | Lo Hi | BL Te-w humid | — | R | L | Distillation | U |
| 208 | Lavender and rose oil | W | A | Hi | WS | *Lavandula angustifolia* T 15–24 (7–28); P 500–1000 (300–1300); kill −20 (row partly damaged) | R | L | Distillation | EC |
| 209 | Cinchona bark | W | A | Mo hiT | tropical montane | *C. pubescens* T 17–25 (9–28); P 2500–3500 (1400–4000); alt 3500 | VR | L | Medicine (quinine) | EC |
| 210 | Mastic and balsams | W | A | Hi cst | WS | — | R | L | — | U |
| 211 | Rubber latex | W | A | Lo | RF | *Hevea* T 24–33 (10–45); P 2000–4000 (1200–6000); alt 500 | R | T | Coagulation, smoking | EC |

### 4.10 Fibres and textiles

| # | Resource | Role | Pos | Zones | Biomes | Conditions (sourced) | Rar | Val | Chain | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| 212 | Flax (linen, linseed) | W F | A | Fl Lo riv | MF, BL Te-c | T 16–24 (5–30); P 500–800 (250–1300); kill −1 | C | T | Retting in water, scutching, weaving | EC |
| 213 | Hemp (rope, sailcloth) | W | A | Fl Lo | MF, BL, GR | T 15–28 (6–32); P 600–1200 (350–4000) | C | B T | Retting; ropewalks | EC |
| 214 | Cotton | W | A | Fl Lo riv | SV, TS irrigated, DF | *G. hirsutum* T 22–36 (15–42), P 750–1200 (450–1500); *G. herbaceum* P 750–1250 (200–1500) | U | T | Ginning, spinning | EC |
| 215 | Wool | W | A | — | from sheep, camels, yak, camelids | — | — | T | Fulling (fuller's earth #318, urine), dyeing | U |
| 216 | Silk (mulberry + silkworm) | W | A | Lo Hi | BL Te-w, WS | *Morus alba* T 20–28 (13–45); P 700–2500 (300–5100) | R | L | Labour: rearing, reeling | EC |
| 217 | Wild silk (tussar) | W | A | Lo | DF | — | R | T | — | U |
| 218 | Jute | W | A | fp Fl | tropical floodplain | T 20–37 (13–45); P 1500–3000 (900–3600) | U | B | Retting; sacking | EC |
| 219 | Ramie | W | A | Lo | BL Te-w humid, DF | T 17–27 (10–34); P 1500–2500 (1000–4000) | U | T | Degumming | EC |
| 220 | Kenaf | W | A | Fl Lo | SV | T 15–28 (10–35); P 600–2000 (450–3000) | U | B | Retting | EC |
| 221 | Sisal and agave fibre | W | A | Hi Lo | TS, WS | *A. sisalana* T 15–27 (10–45); P 900–1250 (500–1800); kill −5 | U | B | Cordage | EC |
| 222 | Abaca (Manila hemp) | W | A | Lo | RF | T 20–29 (16–33); P 1800–3000 (700–4400) | R | T | Ship rope | EC |
| 223 | New Zealand flax | W | A | Lo | TR, BL wet | *Phormium* T 13–25 (9–30); P 750–2000 (500–3800) | U | B | Cordage, weaving | EC |
| 224 | Esparto (alfa) grass | W C | A | Hi Fl\* | dry WS, GR Te-w, CD edge | *Stipa tenacissima* T 15–25 (3–35); P 200–500 (100–600) | U | B | Cordage, matting, paper | EC |
| 225 | Kapok | W | A | Lo | DF, RF | *Ceiba* T 17–38 (12–40); P 1500–2500 (750–3000) | U | T | Stuffing | EC |
| 226 | Nettle and lime-bast fibre | W | A | Lo | MF, BL | *Tilia cordata* T 12–22 (5–28); P 500–700 (400–800) | C | S | Bast rope, mats | EC |
| 227 | Cashmere and qiviut (fine underwool) | W | A | Mo Hi | cold Mo, CS (goats), TU (musk ox) | — | R | L | Combing | U |
| 228 | Leather and hides | W C | A | — | from #94–103, game | — | — | T | Tanning: bark (#241), alum, salt | U |
| 229 | Felt | W C | A | — | from wool, steppe | — | — | T | Yurt covers, boots | U |

### 4.11 Dyes, pigments and tannins (plant and animal)

| # | Resource | Role | Pos | Zones | Biomes | Conditions (sourced) | Rar | Val | Chain | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| 230 | Woad (blue) | W | A | Fl Lo | MF, BL, GR | Not in the ECOCROP copy | U | T | Fermenting vats | U |
| 231 | Indigo (blue) | W | A | Fl Lo | DF, SV, RF | *Indigofera tinctoria* T 22–28 (7–32); P 1300–1700 (640–3000) | U | T L | Fermenting vats | EC |
| 232 | Madder (red) | W | A | Lo | WS, BL Te-w | ECOCROP row has no climate values | U | T | Needs alum mordant (#173) | U |
| 233 | Weld (yellow) | W | A | Lo | WS, BL | — | U | T | — | U |
| 234 | Safflower (red, yellow; oil) | W F | A | Fl Lo | WS, TS, SV dry | T 20–32 (5–45); P 600–1000 (300–1400); kill −2 | U | T | — | EC |
| 235 | Henna | W | A | Fl\* riv | TS, HD *oasis*, SV | *Lawsonia* T 19–27 (13–33); P 500–1500 (250–4200) | U | T | — | EC |
| 236 | Annatto (orange) | W | A | Lo | RF, DF | *Bixa* T 20–28 (15–36); P 1500–2000 (1250–2500) | U | T | — | EC |
| 237 | Red sanders and brazilwood (red dyewoods) | W | A | Lo Hi | DF; RF coast | *Pterocarpus santalinus* T 26–32 (7–46); P 1000–1900 (875–2800) | R | L | Rasping | EC |
| 238 | Logwood (black, purple) | W | A | Lo cst | DF, RF coast | — | R | L | — | U |
| 239 | Lichen dyes (orchil, crottle) | W | A | any | TU, TR, *rocky coast* | — | U | T | Fermented in urine [unverified] | U |
| 240 | Nipa palm (thatch, sugar) | C F | W | cst | MG, *estuary* (Tr) | *Nypa* T 23–27 (20–35); P 2000–2800 (1500–3500); salinity high (> 10 dS/m) | C there | S | — | EC |
| 241 | Oak bark and oak galls | W | A | Lo Hi | BL, MF | — | C | B | Tanning; iron-gall ink | U |
| 242 | Sumac | W | A | Hi | WS | — | U | T | Tanning | U |
| 243 | Mangrove bark (tannin) | W | A | cst | MG | — | C there | B | Tanning | U |
| 244 | Acacia pods and bark (tannin) | W | A | Fl Lo | TS, SV | *Acacia nilotica* T 19–34 (10–50); P 400–1200 (200–2300) | C | B | Tanning; fuel, gum | EC |
| 245 | Chestnut and hemlock bark (tannin) | W | A | Hi | BL, TR | — | U | B | Tanning | U |
| 246 | Birch bark (tar, containers, roofing) | W C | A | any | TA, MF | ECOCROP *Betula pendula* row has no climate values | C | S | Dry distillation → birch tar | U |

### 4.12 Timber and wood

| # | Resource | Role | Pos | Zones | Biomes | Conditions (sourced) | Rar | Val | Chain | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| 247 | Oak | C W | A | Lo Hi | BL, MF | *Q. robur* T 10–18 (5–41); P 600–950 (350–1000); alt 1500 | C | B T | Frames, ships, barrels; slow seasoning | EC |
| 248 | Beech | C W | A | Hi Lo | BL, MF | *Fagus sylvatica* T 10–20 (6–35); P 500–1000 (300–1500); alt 1700 | C | B | Fuel, charcoal, tools | EC |
| 249 | Ash | C W | A | Lo fp | BL | *Fraxinus excelsior* T 8–20 (5–33); P 500–1000 (300–1500) | C | B | Handles, spear shafts, wheels | EC |
| 250 | Elm | C | A | fp Lo | BL | — | U | B | Water pipes, keels (rot resistant wet) | U |
| 251 | Lime / linden | C W | A | Lo | MF, BL | *Tilia cordata* T 12–22 (5–28) | C | B | Carving; bast (#226) | EC |
| 252 | Willow and osier | C | A | fp riv | BL, MF, TA, CS rivers | — | C | S B | Basketry, wattle | U |
| 253 | Poplar (incl. desert poplar) | C | A | riv fp | BL; HD, TS gallery forest | *Populus euphratica* T 20–40 (10–52); P 200–300 (75–400) | U | B | The only timber along desert rivers | EC |
| 254 | Scots pine | C W | A | Fl Lo Hi | TA, MF (sandy) | T 14–23 (2–35); P 600–1000 (300–2000); alt 1500 | C | B T | Masts, tar | EC |
| 255 | Spruce | C W | A | Lo Hi Mo | TA, MF, Mo | *Picea abies* T 5–15 (3–25); P 400–700 (300–900); alt 2000 | C | B | Construction, tonewood | EC |
| 256 | Fir | C | A | Hi Mo | MF, Mo | *Abies alba* ECOCROP alt 2000, no climate values | C | B | — | EC [partial] |
| 257 | Larch | C W | A | Hi Mo | TA, Mo | *Larix decidua* T 8–22 (5–30); P 450–1100 (350–1400); alt 2500 | C | B T | Rot-resistant posts, boats | EC |
| 258 | Giant conifers (Douglas fir, cedar types) | C W | A | Lo Hi Mo | TR | — | U | T | Large beams, masts, canoes | U |
| 259 | Cedar (*Cedrus*) | C W | A | Mo Hi | Mo Te-w | *C. deodara* T 22–32 (4–38); P 1000–1800 (800–2000); alt 3300 | R | L | Temple and palace timber | EC |
| 260 | Yew | W | A | Hi | BL, MF (often on limestone) | ECOCROP row has no climate values | R | T | Longbows | U |
| 261 | Cypress | C | A | Hi | WS | — | U | T | Durable beams, doors | U |
| 262 | Mediterranean pines | C W | A | Lo Hi | WS | *P. halepensis* T 18–34 (6–38), P 400–600; *P. pinaster* P 800–1100 | C | B | Resin (#205) | EC |
| 263 | Cork oak (cork) | W | A | Lo Hi | WS | *Q. suber* T 14–32 (5–42); P 600–1000 (310–2000) | U | T | Bark stripping on a ~9-year cycle [unverified] | EC |
| 264 | Teak | C W | A | Lo Hi | DF | T 22–32 (14–43); P 1200–3000 (500–4000); alt 1200; kill 3 | U | T L | Shipbuilding | EC |
| 265 | Sal | C | A | Lo Hi | DF | *Shorea robusta* T 28–34 (7–47); P 1500–3500 (1000–7300) | C | B | — | EC |
| 266 | Mahogany | C W | A | Lo | RF | *Swietenia* T 20–30 (11–39); P 2000–4000 (1400–6000) | R | L | Furniture | EC |
| 267 | Spanish cedar | C W | A | Lo | DF, RF | *Cedrela* T 22–32 (11–39); P 1000–2500 (600–3700) | U | T | Chests, cigar boxes | EC |
| 268 | Rosewood | W | A | Lo | DF, RF | *Dalbergia latifolia* T 16–35 (5–48); P 1500–2500 (750–5000) | R | L | — | EC |
| 269 | Ebony | W | A | Lo | RF, DF | — | VR | L | Inlay | U |
| 270 | African mahogany (*Khaya*) | C W | A | Lo | SV, DF | *K. senegalensis* T 29–38 (13–42); P 800–1300 (650–1500) | U | T | — | EC |
| 271 | Iroko | C | A | Lo | RF | *Chlorophora excelsa* T 18–33 (12–36); P 1000–1800 (700–2500) | U | T | — | EC |
| 272 | Balsa | C | A | Lo | RF | *Ochroma* T 18–35 (15–38); P 2500–3000 (1500–4000) | U | S | Rafts, floats | EC |
| 273 | Eucalypt-type sclerophyll hardwood | C | A | Lo Hi | WS, BL | *E. globulus* T 18–23 (6–30); P 700–1400 (550–1800) | U | B | — | EC |
| 274 | Thorn-scrub wood | C W | A | Fl Lo | TS, SV | see #244 | C | S | Fuel, fences, charcoal | EC |
| 275 | Juniper | C W | A | Hi Mo | CS, Mo, WS | — | U | S | Posts, incense | U |
| 276 | Mangrove timber | C W | A | cst | MG | — | C there | B | Poles, charcoal | U |
| 277 | Driftwood | C | A | cst | TU, IC coasts | Design note: from boreal rivers to a cold sea | U | S | The only timber on treeless Arctic coasts [unverified] | U |
| 278 | Bog oak (subfossil) | W | U | Fl Lo | *peat bog* | — | R | T | Black inlay wood | U |

### 4.13 Non-wood plant and earth building materials

| # | Resource | Role | Pos | Zones | Biomes | Conditions (sourced) | Rar | Val | Chain | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| 279 | Common reed | C | W | fp cst | *marsh*, *estuary*, floodplain | *Phragmites* T 30–35 (7–40) (suspect); P 500–1000 (300–2400) | C there | B | The best thatch [unverified] | EC |
| 280 | Straw thatch | C | A | Fl Lo | any grain land | — | C | S | By-product of #1–6 | U |
| 281 | Papyrus | C W | W | fp | *tropical swamp* | — | U | T | Writing sheets, boats, mats | U |
| 282 | Bamboo | C W | A | Lo Hi | RF, DF, BL Te-w humid | *Bambusa vulgaris* T 22–28 (9–32), P 1200–2500 (700–4500); *Dendrocalamus giganteus* T 20–27 (15–34), P 1800–3600 | C | B | Scaffolding, pipes, houses | EC |
| 283 | Rattan | C W | A | Lo | RF | *Calamus caesius* T 23–30 (16–34); P 2500–3200 (1700–4200); alt 800 | U | T | Furniture, lashing | EC |
| 284 | Raffia palm | C W | A | Lo fp | RF swamp | *Raphia hookeri* T 24–30 (14–36); P 3000–4000 (2000–5000); alt 200 | U | T | Fibre, thatch, palm wine | EC |
| 285 | Giant cane (*Arundo*) | C | A | riv | WS, BL Te-w rivers | ECOCROP row has no climate values | U | B | Trellis, roof laths | U |
| 286 | Turf and sod | C | A | Fl Lo | GR, TU, TR treeless; *peat bog* | — | C | S | Turf houses | U |
| 287 | Heather (thatch, bedding) | C | A | Hi | cool oceanic heath | — | U | S | — | U |
| 288 | Moss (caulking, insulation) | C | A | any | TA, TR | — | C | S | — | U |
| 289 | Snow and ice blocks | C | A | any | IC, TU | — | C | S | — | U |
| 290 | Ice harvest | F W | W | *lake* | Bo, Te-c with freezing winters | — | U | T | Ice houses (sawdust, straw) | U |
| 291 | Adobe and mud-brick earth | C | A | Fl fp | HD, TS, SV, CD, GR (Ar–SHu) | — | C | S | Sun-drying; straw temper | U |
| 292 | Rammed earth and cob | C | A | Fl Lo | GR, WS, CS | — | C | S | Formwork | U |
| 293 | Wattle and daub | C | A | Lo | MF, BL | — | C | S | Hazel or willow wattle + clay | U |

### 4.14 Stone, clay and industrial minerals

| # | Resource | Role | Pos | Zones | Biomes | Conditions (sourced) | Rar | Val | Chain | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| 294 | Field stone and boulders | C | A | Hi Mo; glacial Lo | any | — | C | S | Dry-stone walls | U |
| 295 | Granite | C W | A/U | Mo Hi | any; *crystalline bedrock* | Tin greisens sit in "specialized … leucogranite" | U | B T | Hard to work; millstones, columns | M15c, U |
| 296 | Basalt | C | A/U | Mo Hi | *volcanic* | — | U | B | Querns, paving | U |
| 297 | Limestone | C W | A/U | Hi Lo | any; *carbonate bedrock* | Carbonate hosts: "shallow-water marine carbonates" on a "stable cratonic platform" (M32a) | C there | B | Building; lime kilns (fuel) | M32a, U |
| 298 | Chalk | C W | A/U | Lo Hi | *carbonate bedrock* | — | U | B | Lime, marl, whiting | U |
| 299 | Marble | C W | U | Mo Hi | *metamorphic carbonate* | — | R | L | Sculpture, facing | U |
| 300 | Sandstone | C | A/U | Hi Lo | *clastic basin* | — | C | B | Easy to dress; grindstones | U |
| 301 | Slate | C W | U | Hi Mo | *fold belt* | — | U | T | Roofing, writing slates | U |
| 302 | Flint and chert | W C | U | Lo Hi | in chalk and limestone | — | U | T | Tools, gunflints, fire-making | U |
| 303 | Obsidian | W | A | Mo | *volcanic* (rhyolite) | Rhyolite domes are the setting of hot-spring Au-Ag (M25a) | R | T L | Blades, mirrors | U |
| 304 | Pumice and pozzolana | C W | A | Mo Hi | *volcanic* | — | R | T | Hydraulic mortar, abrasive | U |
| 305 | Soapstone (steatite) | W | U | Mo Hi | *ultramafic/metamorphic* | — | R | T | Pots, moulds, lamps | U |
| 306 | Millstone and quern stone | W | U | Hi Mo | *coarse sandstone, basalt, granite* | — | R | T | Every grain settlement needs one | U |
| 307 | Whetstone | W | U | Hi | *fine sedimentary/metamorphic* | — | R | T | — | U |
| 308 | Brick and pottery clay | C W | A | fp Fl Lo | any non-ice | Alluvium and river terrace deposits (BGS mineral resource maps) | C | B | Kiln firing (fuel) | BGS-B [partially], U |
| 309 | Kaolin (porcelain clay) | W | A/U | Hi Lo | BL Te-w, RF; weathered granite | — | R | L | High-fire kilns | U |
| 310 | Sand and gravel | C | A | riv fp Lo Fl | any | River terrace and sub-alluvial deposits; glaciofluvial sands | C | B | Mortar, roads | BGS-B [partially] |
| 311 | Glass sand (pure quartz) | W | A | cst Lo | dunes, rivers | — | U | T | Needs a flux (#171, #320) + fuel | U |
| 312 | Gypsum and alabaster | C W | U | Lo Hi | *evaporite bedrock* | Gypsum and anhydrite accompany sediment-hosted Cu in red beds (M30b) | U | T | Plaster (low-fire kiln) | M30b |
| 313 | Ochre and earth pigments | W | A | any | RF, SV, DF laterites; Fe-rich soils | — | C | T | Roasting changes yellow → red [unverified] | U |
| 314 | Bitumen and asphalt seeps | W C | A | Lo Fl | *sedimentary basin* | — | R | T | Waterproofing, mortar | U |
| 315 | Sulfur | W | A/U | Mo | *volcanic*; *evaporite* | Elemental sulfur occurs in "evaporite and volcanic deposits" | R | T | Gunpowder, fumigation | MCS-sulfur |
| 316 | Mica | W | U | Mo Hi | pegmatites, *crystalline* | — | R | T | Windows, lamps | U |
| 317 | Graphite | W | U | Hi Mo | *metamorphic* | — | R | T | Crucibles, pencils | U |
| 318 | Fuller's earth | W | A/U | Lo | *clastic basin* | — | R | T | Cleaning wool (#215) | U |
| 319 | Asbestos (curiosity) | W | U | Mo | *ultramafic* (serpentine) | Serpentine-hosted asbestos (M8d) | VR | L | "Fireproof cloth" | M8d |
| 320 | Plant ash and potash | W | A | any forest; *salt marsh* | TA, MF, BL; halophytes | — | C | T | Leaching ash → soap, glass flux | U |
| 321 | Marl | F C | A | Lo | *carbonate* | — | U | B | Field liming | U |
| 322 | Phosphate rock | W | U | Lo Hi | *marine sedimentary* | Upwelling-type and warm-current-type phosphate (M34c, M34d) | R | B (late) | Fertiliser (industrial era) | M34c |

### 4.15 Fuels

| # | Resource | Role | Pos | Zones | Biomes | Conditions (sourced) | Rar | Val | Chain | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| 323 | Firewood | W | A | any wooded | forests; sparse in SV, TS, WS | — | C | S B | — | U |
| 324 | Charcoal | W | A | Lo Hi | BL, MF, DF, TA | — | C | B | Charcoal clamps; required by bloomeries | U |
| 325 | Peat | W C | A/U | Fl Lo | *peat bog* (Bo, Te Hu–PHu) | Peatlands ≈ 4.23 M km² (≈ 2.84 % of land); peat "continuing to accumulate on 60 % of global peatlands" | U | B | Cutting, drying | PEAT, MCS-peat |
| 326 | Dung fuel | W | A | Fl Hi Mo | CS, GR, CD, Mo, TU (pastoral) | — | C | S | Drying cakes | U |
| 327 | Coal (outcrop) | W | U | Hi Lo | *coal basin* | Coal forms from thick peat in a wet climate | R | B | Early uses: smithing, lime and salt boiling [unverified] | C1143 [partially] |
| 328 | Lignite | W | U | Lo Fl | *clastic basin* | — | U | B | Low heat | U |
| 329 | Oil and naphtha seeps | W | A | Lo Fl | *sedimentary basin* | Sulfur also occurs with petroleum and tar sands | R | T | Lamp oil, incendiaries | MCS-sulfur, U |
| 330 | Natural gas seeps ("eternal fires") | W | A | Hi Lo | *sedimentary basin* | — | VR | L | Shrines | U |
| 331 | Animal fats and oils | W | A | — | from #94–97, #129, #137 | — | — | T | Tallow candles, lamp oil | U |

### 4.16 Metals and ores

Every row here depends on bedrock (§3.2). The Zones column says where the deposit *outcrops or is worked*, which is mostly where erosion has exposed it.

| # | Resource | Role | Pos | Zones | Biomes | Conditions (sourced) | Rar | Val | Chain | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| 332 | Placer gold (river) | W | A | riv Lo Hi (below Mo) | any | "High-energy alluvial where gradients flatten and river velocities lessen, as at the inside of meanders, below rapids and falls"; derives from Au veins, porphyry Cu, Cu skarn | U | L | Panning, sluices (water) | M39a |
| 333 | Beach gold | W | A | cst | any | "Winnowing action of surf caused Au concentrations in raised, present, and submerged beaches" | R | L | — | M39a |
| 334 | Lode gold (quartz veins) | W | U | Mo Hi | *fold belt, greenstone* | "Greenstone belts …"; "continental margin mobile belts, accreted margins"; "fault and joint systems produced by regional compression" | R | L | Crushing (stamps, water power), fire | M36a |
| 335 | Epithermal and hot-spring gold-silver | W | U | Mo | *volcanic* | "Subaerial rhyolitic volcanic centers"; "volcanism above subduction zones, rifted continental margins" | R | L | — | M25a |
| 336 | Silver (argentiferous galena, veins) | W | U | Mo Hi | *fold belt, volcanic* | Polymetallic veins (M22c); polymetallic replacement in carbonates (M19a) | R | L | Cupellation (lead + fuel) | M22c, M19a |
| 337 | Porphyry copper (oxide outcrops) | W | U | Mo | *volcanic arc* | "Convergent plate boundaries. Uplift and erosion to expose subvolcanic rocks" | U | T | Smelting (charcoal); malachite (#365) on top | M17 |
| 338 | Red-bed (sediment-hosted) copper | W | U | Lo Hi | *clastic basin, evaporites* | "Red-bed sequence"; "near paleo-equator. Sabkhas. High evaporation rate"; "intracontinental rift" | U | T | — | M30b |
| 339 | Massive-sulfide copper (ophiolite) | W | U | Mo Hi | *ophiolite* | Cyprus type: "submarine hot spring along axial grabens", in ophiolites | R | T | Roasting sulfides | M24a |
| 340 | Native copper | W | U | Hi Mo | *flood basalt* | Basaltic Cu (M23) | R | T | Cold-hammering | M23 |
| 341 | Tin lode (veins, greisen) | W | U | Mo Hi | *granite intrusion* | Sn veins: "foldbelts and accreted margins with late orogenic to postorogenic granitoids" | R | L | Bronze needs it: long-distance trade | M15b, M15c |
| 342 | Stream tin (placer cassiterite) | W | A | riv Hi Lo | below tin granite | "Moderate to high-level alluvial, where stream gradients lie within the critical range"; also offshore in submerged valleys | R | L | Panning, streaming | M39e |
| 343 | Bog iron | W | A | Fl Lo fp | TA, MF, BL, TR; *fen, bog* | Iron oxyhydroxides precipitate where groundwater with dissolved iron meets oxygen; groundwater-fed fen beside a bloomery site | U | B | Bloomery: charcoal-hungry | BOG [partially] |
| 344 | Lateritic iron and ironstone | W | A | Fl Lo Hi | RF, SV, DF | — | C | B | Bloomery | U |
| 345 | Banded iron formation | W | U | Hi Lo | *craton* | Superior Fe: "stable, shallow-water marine … continental shelf or intracratonic basin" | U | B | — | M34a |
| 346 | Magnetite skarn iron | W | U | Mo Hi | *intrusion + carbonate* | Fe skarn: "contacts of intrusion and carbonate rocks" | U | B | — | M18d |
| 347 | Black sands (magnetite, ilmenite) | W | A | cst riv | any | "Black sands (magnetite, ilmenite, chromite)" accompany placer gold | U | B | — | M39a |
| 348 | Lead-zinc in carbonates (MVT) | W | U | Hi Lo | *carbonate platform* | SE Missouri type: dolomite; "stable cratonic platform" | U | T | Lead: pipes, roofing, cupellation | M32a |
| 349 | Lead-zinc skarns and veins | W | U | Mo | *intrusion + carbonate* | Zn-Pb skarn (M18c); polymetallic veins (M22c) | U | T | — | M18c, M22c |
| 350 | Calamine (zinc ore for brass) | W | U | Hi | oxidised top of #348 | — | U | T | Cementation with copper | U |
| 351 | Mercury (cinnabar) | W | U | Mo Hi | *volcanic*, hot springs | Hot-spring Hg is an associated type of hot-spring Au (M25a) | VR | L | Gold amalgam, vermilion, gilding | M25a |
| 352 | Antimony (stibnite) | W | U | Mo Hi | *fold belt* | Simple Sb deposits (M27d) | R | T | Kohl, hardening lead | M27d |
| 353 | Arsenic minerals (realgar, orpiment) | W | U | Mo | *volcanic*, veins | — | R | T | Pigment, arsenical bronze | U |
| 354 | Manganese | W | U | Lo Hi | *marine sedimentary* | "Shallow (50–300 m) marine"; "stable cratonic interior basin or margin" | R | T | Glass decolouriser, black pigment | M34b |
| 355 | Cobalt (blue colorant) | W | U | Mo | *ophiolite, mafic* | Limassol Forest Co-Ni (M8c); Blackbird Co-Cu (M24d) | VR | L | Smalt, blue glaze | M8c |
| 356 | Platinum (placer PGE) | W | A | riv | below *ultramafic* | "Heavy minerals indicative of ultramafic sources"; rivers of "medium to low gradient" | VR | L | Hard to melt pre-industrially [unverified] | M39b |
| 357 | Meteoric iron | W | A | any | any; best kept in HD, CD, IC | — | VR | L | Cold-worked or forged | U |
| 358 | Bauxite (aluminium; late tech) | W | A | Fl Lo Hi | RF, SV, DF | Laterite type: "well-drained plateaus in region with warm to hot and wet climates"; karst type: "mainly in wet tropical area" | U | B (late) | Industrial only; alum pre-industrially | M38b, M38c |
| 359 | Lateritic nickel (late tech) | W | A | Hi Lo | RF, DF over *ultramafic* | "Warm-humid climates and relatively low rates of physical erosion" | R | B (late) | Industrial only | M38a |
| 360 | Chromite (late tech) | W | U | Mo Hi | *ophiolite* | Podiform chromite (M8a) | R | T (late) | — | M8a |
| 361 | Shoreline titanium sands (late tech) | W | A | cst Fl Lo | any | "Stable coastal region receiving sediment from deeply weathered metamorphic terranes" | R | B (late) | — | M39c |
| 362 | Tungsten (late tech) | W | U | Mo | *granite + carbonate* | W skarn (M14a), W veins (M15a) | R | T (late) | — | M14a, M15a |

### 4.17 Gems, ornamental stones and precious organics

| # | Resource | Role | Pos | Zones | Biomes | Conditions (sourced) | Rar | Val | Chain | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| 363 | Diamond (kimberlite pipe) | W | U | Fl Lo Hi | *craton* | "Most pipes intrude cratonal areas, stable since Early Proterozoic" | VR | L | Deep digging; washing | M12 |
| 364 | Alluvial and beach diamonds | W | A | riv cst | below *craton* pipes | Streams draining kimberlite; "may be 1,000 km from source" | VR | L | Washing gravels | M39d |
| 365 | Malachite and azurite | W | A/U | Mo Hi | oxidised top of copper deposits | — | U | T | Pigment, ornament; also Cu ore | U |
| 366 | Turquoise | W | U | Hi Mo | arid (HD, CD, TS) over copper | — | R | L | — | U |
| 367 | Emerald | W | U | Mo Hi | *black shale + evaporite, faults* | "Black shale …"; "evaporites may have provided saline solutions"; "major faults" | VR | L | — | M31c |
| 368 | Topaz, beryl, tourmaline, fluorite | W | U | Mo Hi | *granite intrusion* | Greisen accessory minerals "topaz, fluorite, tourmaline, and beryl" | R | L | — | M15c |
| 369 | Ruby and sapphire (corundum) | W | A/U | Mo; riv placers | *marble, basalt* | — | VR | L | Placers below | U |
| 370 | Garnet | W | A/U | Hi Mo; riv | *metamorphic* | — | U | T | Abrasive, gems | U |
| 371 | Quartz crystal, amethyst, agate | W | U | Hi Mo | *volcanic* cavities, veins | — | U | T | Carving, seals | U |
| 372 | Jade (nephrite, jadeite) | W | A/U | Mo; riv boulders | *ophiolite / serpentinite* | — | R | L | Abrasive carving | U |
| 373 | Lapis lazuli | W | U | Mo | *contact-metamorphic marble* | — | VR | L | Ultramarine pigment | U |
| 374 | Opal | W | U | Lo Hi | arid weathering (HD, TS) | — | R | L | — | U |
| 375 | Jet | W | A/U | cst Hi | *marine shale* | — | R | L | Mourning jewellery | U |
| 376 | Amber | W | A | cst Lo | Bo, Te coasts on *clastic basin* | Fossil resin from old sediments, washed up on beaches [unverified] | VR | L | Beads, amulets | U |
| 377 | Pearls, coral, ivory, tortoiseshell | W | — | — | see #130–133, #140, #159–162 | — | — | L | — | — |

### 4.18 Water and subsurface features (enablers)

These are not traded, but they decide where people can live and what they can process.

| # | Resource | Role | Pos | Zones | Biomes | Conditions (sourced) | Rar | Val | Chain | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| 378 | Perennial river | F W | W | riv | all non-ice | `flow` from `rivers.ts` | C | — | Irrigation, mills, transport, fish | repo |
| 379 | Water-power site | W | W | riv Hi Mo | any with flow above a threshold | Design note: river with bed gradient ≥ g and flow ≥ f | U | — | Grain mills, fulling, stamps, bellows | repo, U |
| 380 | Navigable river | W | W | riv Fl Lo | any | Design note: flow ≥ f, low gradient | U | — | Bulk trade route | repo, U |
| 381 | Springs | F | A | Hi Mo foot; karst | any | — | C | — | Village sites | U |
| 382 | Alluvial aquifer and wells | F | U | Fl Lo | Ar, SAr dry plains | — | U | — | Wells, qanats from Mo/Hi piedmont | U |
| 383 | Hot and mineral springs | W | A | Mo Hi | *volcanic*, faults | — | R | T | Spas, salt, sulfur | U |
| 384 | Caves | C W | U | Hi Lo | *karst* | — | U | S | Shelter, storage, saltpetre (#172), guano | U |
| 385 | Natural harbour | W | W | cst | sheltered coast (rocky, estuary) | — | U | — | Port; fishing fleets | U |

**Counts.** 385 numbered rows. Excluding the cross-reference rows (#112, #176, #215, #228, #229, #331, #377) and the enablers (#378–385), there are **370 resource rows**. By role letter: **food (F) 154**, **construction (C) 68**, **wealth (W) 273**; many rows carry two or three letters. By position: 273 above ground, 44 underground, 16 both, 37 in water. Plus 28 fantasy rows in §5.

---

## 5. Fantasy and magical resources

Everything in this section is **design, not sourced**. Each entry uses the same columns and adds a **Trigger** built only from map quantities (§2) or the proposed geology (§7.3), so a fantasy resource is placed by the same deterministic rules as a real one. Most are a rare variant of a real resource, so they inherit its chain and its trade route.

Since commit `397f779` the map also has a **supernatural** field (`Climate.supernaturalAt`, 0–100, 10 km features). A trigger can add a threshold on it (for example "supernatural ≥ 80 at the subbiome's site") to make a fantasy resource cluster where magic is strong, without changing the rest of its rule (Design note).

| # | Resource | Role | Pos | Zones | Biomes | Trigger (design) | Rar | Val | Chain |
|---|---|---|---|---|---|---|---|---|---|
| F1 | Truesilver (mithril-like light metal) | W | U | Mo | any | Lode-silver subbiome (#336) with the volcanic flag, height in the top 5 % of its region, and a granite-intrusion bedrock | VR | L | Needs a forge hotter than charcoal (coal + bellows + rune-craft) |
| F2 | Sky-iron (star metal) | W | A/U | any | best in HD, CD, IC | Rare per-region hash places an impact crater; ring of subbiomes around it; preserved where dry or frozen | VR | L | Cold-forged; weapons resist magic |
| F3 | Mana crystal geodes | W | U | Hi Mo | any | Volcanic flag × hot spring (#383) × Humid–Perhumid: water-laid geodes "charge" in wet volcanic ground | R | L | Cutting; focus stones |
| F4 | Ley-line nodes | W | A | any | any | Points where region-border divide ridges (`terrain.ts` L26–27) meet a river confluence; at most one per elevation zone | R | L | Sites for towers, temples, not a carried good |
| F5 | Dragonbone | W C | A/U | Hi Mo | HD, CD, TS (badlands) | Fossil-bed rule: clastic-basin bedrock exposed in hills under Arid/Semi-arid classes (erosion without cover) | VR | L | Armour, siege engines; scrimshaw |
| F6 | Glowcap fungi | F W | U | Hi Lo | Hu, PHu | Karst caves (carbonate bedrock, Humid or wetter); grows in the dark, so only underground | U | T | Light source; dried for alchemy |
| F7 | Moonpearls | W | W | cst | *coral reef* | Pearl-oyster coast (#160) where a per-subbiome hash < p and the sea-level temperature ≥ 26 °C | VR | L | Diving; scrying |
| F8 | Frost-lotus | W | A | Mo | tundra, ice margin | Subbiome where belt is subpolar, the next colder belt (ice) is a neighbour, and there is a lake or spring | R | L | Cold-alchemy reagent; spoils when warm (must travel by cold route) |
| F9 | Ember-salt | W | A | Fl\* Mo | HD, CD | Playa salt (#170) inside a zone with the volcanic flag | R | T L | Fire runes, everburning lamps |
| F10 | Sunstone | W | A | Fl\* | HD | t ≥ 28 °C and P < 200 mm: the hottest, driest subbiomes of a region | R | L | Stores heat; desert trade staple |
| F11 | Elderwood (heartwood of ancient trees) | C W | A | Lo Hi | TR, RF, BL | Forest subbiome in the Perhumid class whose prosperity index is lowest in its zone (no settlement nearby, "untouched") | R | L | Staves, ship keels that never rot |
| F12 | Spirit amber | W | A | cst | Bo, Te coast | Amber coast (#376) next to an elderwood forest | VR | L | Holds a trapped spirit; charms |
| F13 | Bloodiron | W | A | Fl Lo | *peat bog* | Bog iron (#343) in a bog that borders a battlefield or barrow site (game-history layer); otherwise hash | R | T | Smelts to a red steel |
| F14 | Leviathan oil | W | W | OC cst | *upwelling* | Ocean zone with upwelling and the deepest water in the region | R | L | Lamps that burn under water |
| F15 | Kraken ink | W | W | OC | deep ocean | Ocean elevation zones farther than k zones from land | VR | L | Spell ink; dye |
| F16 | Griffin and wyvern eyries | W | A | Mo Hi | next to GR or CS | Cliff subbiome (mountains, high relief) adjacent to open grassland where the mounts hunt | R | L | Eggs → trained mounts |
| F17 | Dreamleaf | W | A | Mo hiT | *cloud forest* | Tropical highland, Perhumid | R | L | Visionary drug |
| F18 | Quicksilver springs | W | A | Mo | *volcanic* | Hot spring (#383) with cinnabar (#351) | VR | L | Alchemy |
| F19 | Starsalt | W | A | Fl\* Mo | CD | Playa salt at height ≥ 2000 m under the Arid class (thin, clear air) | VR | L | Preserves anything, including the dead |
| F20 | Unicorn horn | W | A | Lo | BL, MF old growth | Elderwood rule (F11) in the temperate belt; real narwhal tusk (#131) is the counterfeit | VR | L | Antidote |
| F21 | Golem clay | C W | A | fp | any | Clay (#308) at a river confluence where both branches have flow ≥ f | R | T | Animate servants; potters' guilds |
| F22 | Voidglass | W | A | Mo | *volcanic* | Obsidian (#303) in a zone that also has F4 or F3 | VR | L | Mirrors that show elsewhere |
| F23 | Windcrystal | W | A | Mo | IC, TU | Highest subbiome of each mountains zone, if its belt is polar or subpolar | R | L | Sails, flying ships |
| F24 | Silkspider canopy | W | A | Lo Hi | RF | Rainforest, Perhumid, distance to coast > d | R | L | Fine silk stronger than wool or silk |
| F25 | Healing moss | F W | A | Lo Hi | TR | Temperate rainforest with a spring | U | T | Poultices |
| F26 | Ghostlight peat | W | A | Fl | *peat bog* (Bo, Sp) | Peat bog in the boreal or subpolar belt; burns cold | R | T | Lamps that do not attract beasts |
| F27 | Titan bones (giant fossils) | W C | U | Hi riv | any | River cutting through clastic-basin bedrock in hills | R | T | Building material for bone-houses |
| F28 | Elemental geyser field | W | A | Mo Hi | any | Volcanic flag × hot springs × Humid | VR | L | Power source for workshops (fantasy water-mill) |

**Design note.** Keep fantasy resources mostly downstream of real ones (F1 needs #336, F7 needs #160, F9 needs #170 …). Then the fantasy layer cannot appear where the real world would be implausible, and turning it off leaves a consistent real economy.

---

## 6. Economic interdependencies

### 6.1 What every settlement needs

| Need | Local if | Otherwise imported from | Why it creates trade |
|---|---|---|---|
| Water | River, spring, lake, aquifer | — (no settlement) | Decides settlement sites, not trade |
| Staple calories | A grain or root crop fits (§4.1–4.2), or herds or fish | Grain lands on navigable rivers or coasts | Famine years; cities exceed local supply |
| **Salt** | Coast in a dry warm climate (#166), salt beds (#168–170), brine (#169) | Coasts, playas, salt mines | People and herds need it, and preserving fish, meat and cheese uses a lot [unverified]. Most inland, humid places have none, so salt is the archetypal trade good |
| **Fuel** | Forest, peat, dung | Wooded hills | Cooking, heating, and above all smelting, lime, salt boiling, pottery, glass |
| Building material | Timber, stone, clay or earth | Timber from forests to steppe, desert and treeless coast | Timber is heavy: moves by river |
| **Iron** | Bog iron, laterite, ironstone + charcoal | Ore-and-forest regions | Tools and weapons; the ore must sit near fuel |
| Clay for pots | Floodplain or lowland clay | — (nearly everywhere) | Fine wares (kaolin) are luxury |
| Fibre for clothing | Flax, hemp, wool, cotton, hides | Flocks and fibre lands | Cloth is the main manufactured trade good |
| Millstones | Coarse stone in hills or mountains | Specific quarries (#306) | Every grain village needs them, few places make good ones |
| Draught and pack animals | Grassland or steppe | Horse and camel breeders | Transport, ploughing, war |

### 6.2 Typical deficits that drive trade (Design note)

- **Steppe and desert lack timber and fuel**, have animals, salt and transit routes. They import grain and iron and export horses, wool, hides, salt and caravan services.
- **Forest lacks salt and often grain surplus**, has timber, fuel, furs, honey, wax, tar and bog iron. It imports salt and cloth.
- **Mountains have ore, stone and pasture**, lack grain. Metals and stone go down the rivers; grain and salt come up.
- **Coasts have salt and fish**, often lack timber (dry coasts) or grain (rocky coasts).
- **Tropical lowlands have spices, dyes and hardwoods**, lack salt and iron. The high-value, low-weight spices travel farthest.
- **Smelting needs ore + fuel + often flux in one place.** Where ore sits above the treeline or in a desert, the ore travels to the fuel, or charcoal travels to the ore. Either way a trade link forms.
- **Bronze needs copper and tin**, which rarely share a deposit (M17 vs M15). That alone creates a long-distance trade route.

### 6.3 Per-biome summary

| Biome | Staples | Building materials | Fuel | Typical exports | Typical imports |
|---|---|---|---|---|---|
| Ice (IC) | Seals, fish (coast only) | Snow, stone, driftwood | Blubber | Walrus ivory, narwhal, eider down, furs | Everything else |
| Tundra (TU) | Reindeer, caribou, fish, berries | Turf, stone, driftwood, hides | Peat, driftwood, blubber | Arctic fox fur, walrus and mammoth ivory, down | Grain, iron, salt, timber |
| Cold steppe (CS) | Sheep, horses, yak (Mo), barley, proso millet | Felt and hides (yurts), turf, earth | Dung | Horses, wool, hides, cashmere | Grain, iron, timber, tea |
| Boreal forest (TA) | Rye, barley, oats; game, fish, berries, mushrooms | Log construction (pine, spruce, larch), birch bark | Wood, charcoal, peat | Furs, tar and pitch, timber, honey and wax, bog iron | Salt, grain, cloth |
| Cold desert (CD) | Oasis barley and wheat, sheep, Bactrian camels | Earth, stone | Dung, scrub | Salt, wool, caravans, jade, turquoise | Timber, grain, iron |
| Grassland (GR) | Wheat, barley, cattle, horses | Sod, earth, stone in hills | Dung, straw | Grain, horses, hides, wool | Timber, iron, salt |
| Woodland & shrubland (WS) | Wheat, barley, olive, grape, goats | Stone, limestone, tiles | Brushwood, charcoal | Olive oil, wine, wool, cork, kermes, murex (coast) | Large timber, metals, grain in bad years |
| Mixed forest (MF) | Rye, oats, wheat, pigs, cattle | Timber frame, wattle and daub, thatch | Wood, charcoal, peat | Timber, linen, furs, honey, iron | Salt, wine |
| Broadleaf forest (BL) | Wheat, maize (warm), fruit, pigs | Oak frame, brick, stone | Wood, charcoal | Wine, fruit, silk (warm), iron, oak timber | Salt, fish |
| Temperate rainforest (TR) | Oats, potatoes, salmon, shellfish | Large conifer timber | Wood | Masts and timber, fish, furs | Grain, salt (if no dry coast) |
| Hot desert (HD) | Dates (oasis), camels, goats | Mud brick, stone | Dung, palm fronds | Salt, natron, gold (placers), incense, caravans | Grain, timber, iron, cloth |
| Thorn scrub (TS) | Sorghum, millet, goats, cattle | Mud brick, thatch | Acacia wood | Gum arabic, myrrh, frankincense, ostrich feathers, hides | Salt, iron, grain |
| Savanna (SV) | Sorghum, millet, maize, yams (wetter), cattle | Mud, thatch, gallery-forest timber | Wood | Ivory, shea, cotton, placer gold, hides | Salt, iron, cloth |
| Tropical dry forest (DF) | Rice (irrigated), yams, cassava, cattle | Teak, sal, bamboo | Wood | Teak, cotton, indigo, sandalwood, lac | Salt, metals |
| Tropical rainforest (RF) | Cassava, yams, bananas, sago, taro | Bamboo, rattan, palm thatch, hardwood | Wood | Spices, cacao, rubber, hardwoods, feathers | Salt, iron, cloth |
| Mangrove (MG) | Fish, crabs, oysters, shellfish (#153) | Mangrove poles (#276), nipa thatch (#240) | Mangrove wood and charcoal (#276) | Tannin bark (#243), charcoal, poles, dried shellfish | Grain, salt, iron, fresh water in dry seasons |
| Coast (any, `cst`) | Fish, shellfish, seaweed | Driftwood, shell lime | — | Salt, dried fish, pearls, dyes | Depends on the hinterland |
| Lake (any, `Lake.sub`) | Lake fish (#147), wild rice (#18), lotus (#87), water chestnut (#88) | Reeds | — | Dried fish, freshwater pearls, ice (#290, cold belts) | Depends on the shore biome |

---

## 7. Design notes for generation

Everything in this section is my own engineering judgement, not sourced science.

### 7.1 Two kinds of resources

1. **Potentials** (crops, timber, pasture, game, fish, wild foods): every subbiome has a suitability score for each, from climate and position. They are not "placed"; a settlement picks the best few.
   - Use the ECOCROP trapezoid: 0 outside the absolute limits, 1 inside the optimum, linear between. This is the shape the ECOCROP model uses (Recocrop) **[partially verified]**, and it is bit-exact (+ − × ÷ only, like `biomes.ts`).
   - Rainfall: compare ECOCROP's annual P directly with `BiomeInfo.p`. Add an irrigation bonus on floodplains and next to rivers, so desert rivers grow wheat and dates.
   - Temperature: ECOCROP gives crop-cycle temperatures, the map gives annual means. Until there is a seasonality field, use a belt-dependent offset (the growing season is warmer than the annual mean outside the tropics), or score the belt and moisture class directly from the Biomes column of §4.
   - Altitude: use `height` against ECOCROP `alt`.
2. **Deposits** (ores, gems, stone, salt beds, coal, springs, caves): rare point resources. Each is a hashed draw against a probability from geology × climate × zone type. A subbiome gets 0–3 of them.

### 7.2 Deterministic selection

- Draw per subbiome with `hash4(seed, salt, keyI(skey), keyJ(skey))`, as `zones.ts` L45–53 does for zone types. One salt per resource family, so adding a resource does not reshuffle the others.
- Rarity as a probability per eligible subbiome, as a starting calibration: C ≈ 0.3–0.6, U ≈ 0.05–0.2, R ≈ 0.005–0.03, VR < 0.002. With about 16 subbiomes per elevation zone (32 km / 8 km, squared), an R deposit appears in roughly every 2nd to 12th eligible zone, and a VR one in fewer than one zone in 30.
- Keep the result a pure function of the seed, the parameters and the subbiome, so the lazy, order-independent map stays deterministic.

### 7.3 Geology: the minimal attribute

The map has relief classes, not rocks. A minimal **bedrock class per elevation zone**, drawn like the zone type and correlated with it, would unlock most of §4.14–4.17:

| Bedrock class | Typical zone types | Unlocks |
|---|---|---|
| Crystalline shield (granite, gneiss) — *craton* | flat, lowland, hills | Granite, kaolin, BIF iron (M34a), diamonds (M12), lode gold in greenstone belts (M36a) |
| Fold belt (slate, schist, quartzite, marble) | hills, mountains | Slate, marble, lode gold (M36a), Pb-Zn and Ag veins (M22c), antimony |
| Granite intrusion (inside a fold belt) | mountains, hills | Tin veins and greisen (M15), tungsten, topaz and beryl, kaolin |
| Volcanic arc (andesite, rhyolite) | mountains | Porphyry Cu (M17), epithermal Au-Ag (M25a), obsidian, pumice, sulfur, hot springs, mercury |
| Flood basalt | hills, lowland, flat | Basalt, native copper (M23), agate |
| Ophiolite / ultramafic | mountains, hills | Chromite (M8a), Cyprus Cu (M24a), jade, soapstone, asbestos, PGE placers, nickel laterite in the tropics |
| Carbonate platform (limestone, dolomite) | hills, lowland | Limestone, lime, karst and caves, MVT Pb-Zn (M32a), springs, karst bauxite (M38c) |
| Clastic basin (sandstone, shale) | lowland, flat, hills | Sandstone, coal (C1143), oil and gas seeps, red-bed Cu (M30b), evaporites, emerald (M31c) |
| Unconsolidated cover (alluvium, glacial, loess) | flat, lowland | Clay, sand and gravel, peat, bog iron, aquifers, fertile soils |

Plus two flags: **active margin** (arc volcanism, faulting; for M17, M25a, M36a) and **volcanic** (per zone).

**Coherence across zones.**

- **Metallogenic provinces.** Real ore types cluster in belts tens to hundreds of km long (the tectonic settings in M17, M36a and M15b are all belt-scale) **[unverified as a general statement]**. Give each region (128 km) a low-frequency "province" noise, like the climate fields, that biases its zones' bedrock: an arc province makes mountains volcanic and porphyry-rich; a shield province makes flat zones crystalline.
- **Mountains → hills → rivers → lowlands.** This is the sediment route the deposit models describe:
  - Lodes form and are exposed in mountains and hills (M17 needs "uplift and erosion to expose subvolcanic rocks").
  - Rivers carry the heavy minerals down. Placer gold collects "where gradients flatten" (M39a); stream tin where gradients are "within the critical range" (M39e); diamonds travel up to 1000 km (M39d).
  - Lowlands and flats collect fine sediment: clay, sand and gravel (BGS), and in wet climates peat and bog iron.
  - Coasts collect the most resistant grains: beach gold (M39a), titanium sands (M39c), diamonds (M39d).
- **Placer rule (sketch).** Rivers are already computed per region with parent links and flow (`rivers.ts` L139–145). For each river node, carry a "heavy-mineral load" = sum over upstream nodes in lode-bearing subbiomes. Deposit a placer where the bed gradient drops (the zone type changes from mountains or hills to lowland or flat along the river, or the bed slope falls below a threshold). This stays inside the region computation, so it keeps the locality of the river pass.
- **Weathering rules** use climate on top of bedrock: laterite iron, bauxite and nickel laterite need warm-wet (RF, DF, wet SV) and a stable flat or lowland (M38a–c); evaporites need Arid and no outlet or a coast (Warren 2010); peat needs Humid–Perhumid and a low gradient.

### 7.4 Using the existing fields

- **Prosperity** (`climate.ts` L104–107) could be replaced or complemented by a resource-wealth score: the sum of the subbiome's best food potential, its deposits weighted by value tier, and its position (coast, navigable river).
- **Travel days** in the README ruler (`README.md` L131: horse 32–48 km/day, legion 24–32, hiker 16–24) give a natural trade radius: bulk goods within one or two days by land, much farther by river or sea.
- **Lakes** (`Lakes.get(region).lakes`) give the *lake* rows directly: one lake per host subbiome (`Lake.sub`), with its area for a yield and the river's `flow` for an inflow. Lakes in cold belts carry ice harvest (#290).
- **Mangrove** (`BiomeInfo.biome` = MG) gives the *mangrove* rows; `BiomeInfo.coastal` gives `cst` for merged subbiomes without a second neighbour walk.
- **Sea-level biome** (`BiomeInfo.seaLevel`) finds tropical highlands for coffee, tea, quinoa and coca without a new field.

### 7.5 Open questions

1. **Subbiome size.** The brief says ~1 km; the code says 8 km. At 8 km, one subbiome can hold a village and its fields; at 1 km it holds one field or one mine. Which scale should own a deposit?
2. **Seasonality.** Mediterranean and monsoon resources (olive, vine, cork, unirrigated rice, jute) are only proxies without a seasonality field (`biomes-and-climate.md` §7.2 step 4).
3. **Technology level.** Should late-technology resources (bauxite, nickel, chromite, titanium, phosphate, tungsten) exist as dormant deposits, or be left out?
4. **Wetlands and lakes as biomes or overlays?** A marsh changes the land cover (§3.1) but is local. An overlay flag per subbiome is simpler than new biome ids. *Partly settled since:* lakes became polygons with a host subbiome (an overlay, `lakes.ts`), and mangrove became a biome id (`biomes.ts`). Marsh, fen and swamp are still open.
5. **Quantities.** This note gives occurrence, not yield. A later pass needs carrying capacity (people per km² by staple and biome) and deposit size classes.
6. **Cooling curve.** The defaults cool 20 °C by 1250 m, more than the 6.5 °C/km the `biomes.ts` header describes. Crop altitude limits from ECOCROP (`alt`) were set for real lapse rates, so with these defaults crops will drop out lower than their `alt` suggests.
7. **Fantasy share.** How rare should the fantasy layer be relative to real luxuries, and should it be a separate toggle?

---

## 8. Quick reference: resources by map feature

| Map feature | Most characteristic resources |
|---|---|
| Floodplain (`fp`) | Rice, hay meadow, clay, reeds, willow, water buffalo, jute, flax retting, eels |
| River with flow (`riv`) | Fish, water power, placer gold and tin, sand and gravel, navigation, irrigation |
| Coast (`cst`) | Fish, shellfish, salt, seaweed, coconut (Tr), amber (Bo/Te), black sands, harbour |
| Mangrove (MG) | Mangrove timber and charcoal, tannin bark, crabs, oysters, nipa palm |
| Lake (`Lake.sub`) | Lake fish, reeds, wild rice, lotus, water chestnut, freshwater pearls, ice harvest (cold), transport |
| Dry flat zone (`sparse`) | Playa salt, natron, dates (with water), camels, esparto, sunstone (F10) |
| Mountains zone | Lode metals, gems, building stone, slate, marble, yak, alpine pasture, larch, cedar |
| Hills zone | Vines, olives, quarries, millstones, sheep, chestnut, lead-zinc in limestone |
| Tropical highland (`hiT`) | Coffee, tea, potato, quinoa, teff, enset, cinchona, coca |
| Tropical lowland humid (RF) | Spices, cacao, rubber, hardwoods, bamboo, rattan, sago |
| Boreal (TA) | Furs, tar, pine and spruce, bog iron, rye, berries, peat |

---

## 9. Sources

### 9.1 Databases and primary documents read

- **EC** — FAO ECOCROP database, as `EcoCrop_DB.csv` in the OpenCLIM `ecocrop` repository. Read directly (columns TOPMN, TOPMX, TMIN, TMAX, ROPMN, ROPMX, RMIN, RMAX, ALTMX, KTMP, GMIN, GMAX). https://github.com/OpenCLIM/ecocrop (raw file `EcoCrop_DB.csv` on branch `main`).
- **RC** — `Recocrop` R package (CRAN) reference manual (parameter meanings; "expert opinion and not necessarily optimal"; FAO rainfall values are annual). https://cran.r-project.org/web/packages/Recocrop/refman/Recocrop.html **[partially verified: search-index copy]**
- **M + number** — Cox, D. P. & Singer, D. A. (eds.) *Mineral Deposit Models*. U.S. Geological Survey Bulletin 1693, 1986 (third printing 1992). Read from the PDF: contents list and the "Geological environment" blocks of models 8a, 8c, 8d, 12, 14a, 15a–c, 17, 18c, 18d, 19a, 22c, 23, 24a, 24d, 25a, 27d, 30b, 31c, 32a, 34a–d, 36a, 38a–c, 39a–e. https://pubs.usgs.gov/bul/1693/report.pdf
- **MCS-salt, MCS-peat, MCS-sulfur, MCS-tin, MCS-gemstones** — U.S. Geological Survey, *Mineral Commodity Summaries 2025*, commodity sheets (salt: production types and "World Resources"; peat: "continuing to accumulate on 60 % of global peatlands"; sulfur: "evaporite and volcanic deposits"). Read from the PDFs, e.g. https://pubs.usgs.gov/periodicals/mcs2025/mcs2025-salt.pdf
- **YAK** — Wiener, G., Han, J. & Long, R. *The Yak*, 2nd ed. FAO Regional Office for Asia and the Pacific, RAP Publication 2003/06, Chapter 4 (Table 4.1; temperature tolerance). https://www.fao.org/4/AD347E/ad347e08.htm **[partially verified: read through a fetch tool that returned extracted figures]**
- **NOAA-C** — NOAA Ocean Service, *Corals tutorial: distribution* (35° N–35° S; 23–29 °C; 32–42 ‰; ~30 m). https://oceanservice.noaa.gov/education/tutorial_corals/coral05_distribution.html **[partially verified: read through a fetch tool that returned quotes]**

### 9.2 Papers and reports cited from abstracts or record pages

- **PEAT** — Xu, J., Morris, P. J., Liu, J. & Holden, J. "PEATMAP: Refining estimates of global peatland distribution based on a meta-analysis." *Catena* 160:134–140, 2018. https://doi.org/10.1016/j.catena.2017.09.010 **[partially verified: abstract via search index]**
- **C1143** — U.S. Geological Survey Circular 1143, *Coal—A Complex Natural Resource*, figure pages (peat–sediment–climate models; Okefenokee as a modern peat swamp). https://pubs.usgs.gov/circ/c1143/html/contents.html **[partially verified: figure captions via search index]**
- **STEN** — Steneck, R. S. et al. "Kelp forest ecosystems: biodiversity, stability, resilience and future." *Environmental Conservation* 29(4):436–459, 2002. https://doi.org/10.1017/S0376892902000322 **[partially verified: abstract]**
- **OSL** — Osland, M. J. et al. "Climatic controls on the global distribution, abundance, and species richness of mangrove forests." *Ecological Monographs* 87(2):341–359, 2017. https://doi.org/10.1002/ecm.1248 **[partially verified: USGS abstract page]**
- **KLEY** — Kleypas, J. A., McManus, J. W. & Meñez, L. A. B. "Environmental limits to coral reef development: where do we draw the line?" *American Zoologist* 39(1):146–159, 1999. **[partially verified: abstract only; the numeric limits were not readable]** Not used for numbers; NOAA-C is.
- **RYTH** — Ryther, J. H. "Photosynthesis and fish production in the sea." *Science* 166:72–75, 1969. **[partially verified: bibliographic record and a review that cites it for "a good correlation between 14C uptake and fishery landings"]**
- **WARR** — Warren, J. K. "Evaporites through time: Tectonic, climatic and eustatic controls in marine and nonmarine deposits." *Earth-Science Reviews* 98(3):217–268, 2010. https://doi.org/10.1016/j.earscirev.2009.11.004 **[partially verified: abstract]**
- **ERIC** — Ericksen, G. E. *Geology and origin of the Chilean nitrate deposits*. USGS Professional Paper 1188, 1981. https://doi.org/10.3133/pp1188 **[partially verified: record page only; the text was not read]**
- **BOG** — *Vegetation History and Archaeobotany*, 2016, on bloomery iron from secondary iron minerals precipitated from groundwater, with a groundwater-fed fen beside a bloomery site. https://doi.org/10.1007/s00334-016-0567-x **[partially verified: search-index excerpt; authors not checked]**
- **BGS-B** — British Geological Survey, *Mineral resource information for development plans: Bedfordshire* (river terrace and glacial sand and gravel; alluvium). https://nora.nerc.ac.uk/id/eprint/535098/1/bedfordshire.pdf **[partially verified: search-index excerpt]**

### 9.3 Repository

- `sandboxes/sandbox4/src/world/{zones,biomes,climate,rivers,terrain,world}.ts`, `sandboxes/sandbox4/defaults.json`, `README.md`, at commit `b94e28d` (lines as in the code hooks table).
- `docs/research/biomes-and-climate.md` (seasonality, fire, azonal biomes, bit-exactness).

### 9.4 Not accessible on the research date

- The **original FAO ECOCROP website** is retired; the CSV copy was used instead.
- **USGS publication landing pages** (`pubs.usgs.gov/publication/...`) returned HTTP 403 to the fetch tool; the PDFs themselves downloaded fine.
- **Full texts** of Kleypas 1999, Osland 2017, Steneck 2002, Warren 2010, Xu 2018 and Ryther 1969: paywalled or not found; abstracts only.
- **Ericksen 1981** (USGS PP 1188): only the record page was read.
- **BGS mineral planning factsheets** (aggregates, building stone, brick clay): not found in this pass; a county resource report stands in.
- **Historical-economics sources** (salt consumption, spice, tin, amber and fur trades, tsetse limits on cattle): not read. Every such claim above is marked [unverified]; this is the weakest part of the note and the first thing to source in a follow-up.
