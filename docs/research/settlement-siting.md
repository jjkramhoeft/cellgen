# Settlement Siting: Where Cities, Towns and Villages Form, and How to Compute It

*Research date: 2026-11-10. Scope: how the generator should compute potential **city, town and village locations in each region** from resources, geography, trade and travel, and climate. §2 collects the settlement-siting factors from historical and economic geography and archaeology: site and situation, catchments, break of bulk, central places, rank-size, and empirical studies of where cities formed. §3 covers the quantitative tools: weighted-overlay suitability, predictive models, walking-time and cost-distance functions, accessibility and gravity indices, and a floodplain descriptor. §4 reads the source code of procedural generators and games that place settlements: Azgaar's Fantasy Map Generator, Martin O'Leary's generator, and the Civilization IV and V AI site evaluators. §5 covers spacing and hierarchy. §6 is a design note: a calculation approach for `sandboxes/sandbox4` that fits its constraints (infinite, lazily evaluated, order-independent, bit-exact). It slots into the generation order of `game-resources-and-trade.md` §5.8.*

**How to read the citations**

- Each claim cites the source that owns it, by key. The keys are listed in §8. Code is cited by repository, commit SHA, file and line numbers. Every code permalink in §4 was fetched at the SHA given.
- **[unverified]** means the claim is general or bibliographic knowledge that was not checked against a primary text in this pass.
- **[partially verified]** means the primary source exists and is cited, but only part of the claim was confirmed, for example from an abstract, a working-paper version, a search-index excerpt or a secondary source that reproduces it.
- Christaller's distances come in **two published series** that are offset by one order: 4 → 108 km and 7 → 186 km (§2.5). This note uses the 4 km series (King 1984, Chen 2011) and says so wherever it matters.
- Bosker & Buringh were read in their 2012 conference version, not the 2017 journal article (§2.4).
- Text marked **Design note** is my own engineering judgement, not a sourced claim. All numeric defaults in §6 are starting calibrations.

**Code locations used below** (working tree at commit `b94e28d`)

| Hook | File, lines | What it gives a settlement pass |
|---|---|---|
| Map hierarchy | `src/world/world.ts` L1–35; defaults `reg.size` 128, `ez.size` 32, `patch.size` 8 (`defaults.json`) | Regions own zones, zones own patches, all by site. Each lattice cell has one site, so the mean cell area is exactly size², and a region holds 16 zones and 256 patches on average |
| Region, zone, patch records | `world.ts` L89–140; `region()` L239; `elevationZonePatches()` L502; `patch()` L534; `patchNbrs()` L547 (Gabriel neighbours); `patchCell()` L608; `cellAt()` L623 | Candidate sets, adjacency for catchments and travel graphs, and drawn region and zone per patch |
| Ocean sourcing radius | `world.ts` L280–317 (`source`), L348–364 (`sourceRadius`, `baseFlags`) | Ocean needs the sources of a (2·(`oc.range`+5)+1)² block of regions. That cost is already paid by `patchCell().ocean`, so it does not add to the settlement pass |
| Zone types | `src/world/zones.ts` L27–33 (weights 5/6/1/1), L45–53 (`elevationZoneType`) | Relief class per zone: flat, lowland, hills, mountains |
| Rivers per region | `src/world/rivers.ts` L1–37 (header), L137–169 (`RegionRivers`), L237 (`isCoastPatch`), L249 (`regionElevationZones`), L272 (`isSparseFlat`), L279–325 (`attractors`), L859–860 (flow summed upstream) | Node positions, parent links, `flow` (attractors reached upstream), `wet` (node over sea), roots. **Rivers never enter another region's land** (L21–26), so mouths, confluences and heads of navigation are region-local |
| River beds | `src/world/terrain.ts` L412–420 (`bed`) | Bed height per river node, "a pure function of the region (its rivers and the map)". This needs no height tile, and it gives river gradients for fall lines |
| Floodplain width | `terrain.ts` L278–288 (`flood` spline), L575–576 (`× √(flow/100)`) | Floodplain half-width from bed height. Used to find the lowest bridging point |
| Height tiles | `terrain.ts` L208–236 (`TerrainTile`), L371–382 (`patchHeight`), L936–942 (`patchOf`), L985–987 (`E`, `src`: "bed / coast height the cell's path starts from"), L1178–1195 (per-patch mean height loop) | Exact heights, plus height above the nearest river bed (h − src, a HAND-like value, §3.5). Available only after a tile is computed, which takes about 1 s per 2×2 regions in a worker |
| Worker | `src/world/terrain.worker.ts` L34–64 | Tiles are posted with a transfer list, so new per-patch arrays can ride along |
| Climate | `src/world/climate.ts` L95–107; `prosperityAt` L105–107 | T₀ and P per point. `prosperityAt` is a noise placeholder "for later use (settlements, roads)". A settlement potential can replace it |
| Biomes | `src/world/biomes.ts` L88–94 (belts), L111 (`dryThreshold`), L134 (`classify`), L194 (`TYPICAL_HEIGHT`), L247–260 (`ofPatch`), L278 (`info`) | Biome, belt and aridity per patch. They are **exact once the tile exists and an estimate before**, which matters for determinism (§6.1) |
| Deterministic maths | `shared/core/dmath.ts` L1–8, L31 (`dexp`); `shared/core/hash.ts` L37 (`hash4`); `shared/core/heap.ts` L1–15 (ties on the smaller value) | Bit-exact exp for Tobler's function; hashes for tie-breaking; a deterministic heap for Dijkstra |
| Prosperity overlay | `src/main.ts` L119, L319, L367 | Where a settlement-potential view would plug in |

**Added since `b94e28d`** (lines at commit `397f779`)

| Hook | File, lines | What it gives a settlement pass |
|---|---|---|
| Lakes | `src/world/lakes.ts` L1–39 (header), L57–82 (`Lake`), L189 (`get`), L237 (`lakeAt`); commit `4766597` | River-fed lakes per region, after the rivers and on them, each with a host patch (`Lake.patch`), area and the river's flow. Like the rivers they are region-local and do not depend on the terrain tiles, so they are safe for Tier M (§6.1). Fresh water, fish and a lakeshore site |
| Mangrove | `src/world/biomes.ts` L23–28, L85, L343; commit `dc52798` | Biome `mangrove` on warm, not-desert coasts of flat and lowland zones (T ≥ 20 °C, m ≥ 0.5). Tidal swamp: little farmland, hard going, but fish and timber |
| Coast per merged patch | `src/world/biomes.ts` L238 (`BiomeInfo.coastal`), L298–321 (`isCoastal`) | The `coast` feature (§6.3) for a merged patch, already cached with its biome |
| Tests | `tests/fixture.ts` (`testParams`, frozen baseline); `tests/world.test.ts` L74 (order independence); `tests/terrain.test.ts` L127, L158, L200 (seamless, per-region, deterministic) | Patterns for the settlement tests in §6.12 |
| Ruler | `README.md` L131 | Horse 32–48 km/day, legion 24–32, hiker 16–24 |

---

## 1. Overview

Seven findings shape the design.

1. **Site and situation are different questions at different scales.** *Situation* means which part of the region has the food, water and routes. *Site* means which exact spot inside it is dry, flat, defensible and next to the water. In the repo, situation is a patch-level question (8 km), answerable from the map. Site is a raster question (1 km), answerable only from the height tile. §6 keeps the two apart: choices never depend on whether a tile has been computed.
2. **Agriculture explains where people are; trade explains where cities are.** Henderson et al. 2018 find that for early-developing countries the agricultural variables add more than 6 times the explanatory power of the trade variables for the distribution of economic activity (HSSW). Bosker & Buringh find that, for which locations in Europe became cities in 800–1800, a **navigable river** was the main positive geographic effect: about +6 percentage points on an unconditional chance of about 12 %. Rugged terrain lowered the chance (BB). Bleakley & Lin find that portage sites on the US fall line are 50–110 % denser today (BL). Cooley's 1894 rule: "Population and wealth tend to collect wherever there is a break in transportation" (COOL, p. 76). So the score should be **food catchment × water × (1 + trade bonus)**: multiplicative necessities and a bounded trade multiplier.
3. **The repo's hierarchy is Christaller's K = 4 system, two orders per level.** In the K = 4 (traffic) principle, market-area spacings double per order: 4, 8, 16, 32, 64, 128, 256 km (CHEN, Table 1, after Christaller 1966) [partially verified]. The defaults (8 km patches, 32 km zones, 128 km regions) are exactly orders 2, 4 and 6. K = 4 also predicts 16 lower areas per area two orders up, which is the repo's 16 patches per zone and 16 zones per region (§5.2). The design uses this directly: 1 city, 3 second-rank towns and 12 market towns per region, and 1 town and 3 market villages per zone.
4. **The 8 km patch is a farming catchment.** Its mean area is 64 km², a circle of radius 4.5 km. That matches the 1-hour, ~5 km catchment that site-catchment analysis assigns to farming sites (VFH) [partially verified]. It also matches the 2–4 km farm-to-field drop-off reported from Chisholm (CHIS) [unverified]. A zone (~1,000 km², radius ~18 km) matches Bosker & Buringh's 20 km "one-day round trip" (BB, fn. 26) and Bracton's market rule of 6⅔ miles (10.7 km) between markets (BLACK).
5. **Generators use the same recipe with different constants.**
   - Azgaar scores each cell by biome habitability + normalised river flux and confluence × 250 − elevation + coast, estuary and safe-harbour bonuses, then places capitals greedily with a quadtree minimum distance (AZ).
   - O'Leary scores by √flux minus the sum of 0.02/d over existing cities and takes the argmax repeatedly (OL).
   - Civilization V sums ring-weighted yields (6/3/2/1/1), adds +15 % for a river and +40 % for a coast, and has a preferred spacing of 5 tiles (CIV5).
   - Civilization IV adds +200 for hills and +40 for a river or fresh water (CIV4).
   
   None of them is order-independent on an infinite map. All rely on a global greedy pass.
6. **A global greedy pass does not fit a lazy map, but a per-owner one does.** Rivers never cross region borders, and the terrain puts a ridge along them (`terrain.ts` header, step 2). Region borders are therefore drainage divides, where real towns rarely sit. That makes a cheap, exactly local rule defensible: towns and cities need a minimum **border depth** in patch steps. Selection then becomes an ordinary greedy non-maximum suppression *inside* one region, which is order-independent by construction (§5.3, §6.5).
7. **Sizes follow from catchments if every order takes the same urban share.** With K = 4 nesting, if each centre of order k houses a fixed share *a* of its market area's population, each order is 4 times larger than the one below. That is Zipf's law with exponent 1 (§6.7). The trade multiplier then spreads the sizes. Gabaix 1999 explains exponent ≈ 1 from proportional growth (GAB). Soo finds national exponents averaging about 1.1 (SOO).

---

## 2. Real settlement-siting factors

### 2.1 Site and situation: the classic factors

The textbook split is between **site**, the physical ground a settlement stands on, and **situation**, its position relative to resources, routes and other places [unverified: standard textbook terms; no reachable textbook was read]. The table lists the classic factors with the best source found for each.

| Factor | What it means | Source | Map signal in sandbox4 |
|---|---|---|---|
| **Water supply** | Perennial river, spring, well or lake within short carrying distance | General; the top variable in archaeological predictive models (§3.2) [unverified as a general statement] | River node or a lake in the patch (`Lake.patch`, `lakes.ts`); aridity m = P/(20T+140) (`biomes.ts` L111) as a proxy for wells and springs |
| **Wet point / dry point** | Dry areas favour wet points (oasis, river); wet areas favour dry points (terrace, levee, island above floods) | [unverified: textbook concept] | Aridity × river; HAND (h − src, §3.5) |
| **Floodplain vs terrace** | Fields on the floodplain, houses on the first terrace above flood level | HAND classes: 0–5 m above the drainage is near-surface water table, 5–15 m shallow, > 15 m deep (NOB via GRASS r.hand) [partially verified] | `terrain.ts` L986 `src` gives the base height of each cell's drainage path |
| **Defensibility** | Hilltop, spur between two rivers (confluence), meander loop, island, peninsula | Civ IV gives a hill city site +200 (CIV4 L2170). Civ V gives hills in ring 1 a strategic value of 3 (CIV5 L1011–1052). Emilien et al. score "geographical domination" (EMI §4) | Zone type; relative height (TPI); confluence; peninsula (mostly ocean neighbours) |
| **River crossing / ford / lowest bridging point** | Where a land route crosses a river: wadeable, narrow or firm-banked; the lowest bridge on a river collects all coastwise land traffic | [unverified: textbook concept, e.g. London, the lowest bridging point of the Thames] | First node upstream from the mouth where the floodplain is narrow (`terrain.ts` L575–576) |
| **Confluence** | Two navigable or fertile valleys meet; it is also a defensive spur | Azgaar adds confluence flux to river flux (AZ L41) | Node with two children whose upstream drainage is large |
| **Head of navigation / fall line** | Boats must stop and unload (break of bulk); falls provide water power | Britannica: the fall line marks the head of navigation; Trenton, Philadelphia, Baltimore, Washington, Richmond and Augusta lie on it (BRIT-FL). Bleakley & Lin: portage sites are 50–110 % denser today, an effect that persists after controls (BL) | Upstream end of the navigable river; a knickpoint in bed slope (`bed()`); a river leaving hills or mountains into a lowland or flat zone |
| **Natural harbour, sheltered bay** | Protected water, ideally with a navigable river behind it | Henderson et al. include natural harbours among the trade variables (HSSW). Azgaar counts a "safe harbour" when a land cell has exactly one adjacent water cell, +20 (AZ) | Coastal patch next to an ocean patch that is mostly enclosed by land |
| **Estuary / river mouth** | Sea and river traffic meet: the classic break of bulk | Cooley (COOL); Azgaar +15 for a coastal cell with a river (AZ L1191); EU4 gives estuaries +10 trade power (`game-resources-and-trade.md` §2.1) | River node where `wet` switches from 1 to 0 |
| **Mountain pass approach / gap town** | Foot of a pass, or a gap through a ridge | [unverified: textbook concept] | Low point on a region border between two land regions (needs heights: Tier T, §6.6) |
| **Agricultural catchment** | Enough fields within a walk to feed the settlement | Vita-Finzi & Higgs (§2.2) | Food density × patch area |

### 2.2 Catchments: how far people walk to their fields

- **Site catchment analysis** (Vita-Finzi & Higgs 1970). This compares the territory within walking reach of a site under hunting-gathering and farming economies (VFH, abstract). The radii usually quoted are 10 km (about 2 hours) for hunter-gatherers and 5 km (about 1 hour) for farmers. Some summaries give 2 h, 1.5 h and 1 h for hunter-gatherers, pastoralists and cereal farmers [partially verified: search-index secondary sources; the paper's text was not read].
- **Chisholm 1962.** Returns from fields fall off with distance from the farmstead. Secondary reviews give the practical limit at roughly 2–4 km, about an hour's walk (CHIS) [unverified: the book was not readable].
- **Market reach.** Bracton's 13th-century rule, as reported by Blackstone: a reasonable day's journey (*dieta*) is 20 miles, and a new market within a third of that (6⅔ miles ≈ 10.7 km) of an existing one is a nuisance. The rationale is that everyone should have a market within a third of a day's journey (BLACK, bk. 3 ch. 13, pp. 218–219). Bosker & Buringh treat 20 km as roughly a one-day round trip (BB, fn. 26).
- **A caution from Skinner.** Walking distance does not by itself set the size of a Chinese standard marketing area. Most such areas are far smaller than walking would allow (SKIN, fn. 69).

**Design note.** The map scales line up with these numbers:

| Map unit | Mean area | Equal-area radius | Real analogue |
|---|---|---|---|
| Patch (8 km) | 64 km² | 4.5 km | Farming catchment of 1 h / 5 km (VFH) |
| 1-ring of patches | ~450 km² | ~12 km | Bracton's ⅓-day market reach (10.7 km) |
| Zone (32 km) | 1,024 km² | 18 km | Half a day's walk, a 20 km round trip (BB) |
| Region (128 km) | 16,384 km² | 72 km | 2–3 days on foot, 1.5–2 days on a horse (`README.md` L131) |

### 2.3 Break of bulk, gateways and portage

- **Cooley 1894.** "Population and wealth tend to collect wherever there is a break in transportation" (COOL, §X "The Location of Towns and Cities", p. 76). Cooley separates *mechanical* breaks (a change of vehicle or mode) from *commercial* breaks (a change of ownership) (COOL, p. 82 summary).
- **Vance 1970, the mercantile model.** Settlement grows from the coast inward: exploration, then staple harvesting, then farm staples, then interior **depot or gateway** centres, then central-place infilling (VANCE) [partially verified: secondary summaries; the stage count varies between 4 and 5].
- **Burghardt 1971, gateway cities.** Gateways form between areas of different production. They sit at **one end** of their tributary area and specialise in transport and wholesaling. A central place sits in the **middle** of its area (BURG) [partially verified: abstract].
- **Bleakley & Lin 2012.** The fall line is the last falls or rapids before a river reaches the Atlantic or the Gulf (BL, pp. 588–589). Areas within 15 miles of a portage site are 50–110 % denser (BL, Table I, p. 607). A 10 % greater distance from a portage means about 6 % lower density at tract level and about 2 % at county level. Placebo sites farther upriver show no effect. A larger upstream watershed gives a denser site today.

**Design note.** Two kinds of city follow from this:

- A **central place** sits at the centre of its catchment (Christaller).
- A **gateway** sits on the edge, at a mode change: a river mouth, harbour, head of navigation or pass.

The city score in §6.4 takes the **maximum** of a centrality term and a gateway term, so both kinds arise.

### 2.4 What the empirical studies say about city locations

| Study | Data | Finding relevant to siting |
|---|---|---|
| **Bosker & Buringh** (BB; 2012 conference version read, JUE 2017 not accessible) | Probit model on randomly drawn potential locations in Europe, 800–1800 | Unconditional chance of becoming a city is about 12 %. With country-century fixed effects, a **navigable river adds about 6 points**, the main positive effect. Sea location loses significance. Roman roads give no benefit except at hubs. **Ruggedness lowers** the chance. Agricultural suitability helps early on and becomes insignificant from about the 15th century. An existing city 20–100 km away adds about 1 point; a competing potential site within 20 km subtracts about 1.5 points |
| **Henderson, Squires, Storeygard & Weil** (HSSW) | ~240,000 grid cells, night lights | 24 physical-geography attributes explain 47 % of worldwide variation. Within countries, the agricultural variables add over 6 times the explanatory power of the trade variables for early developers (about 1.5 times for late developers). The trade variables are: within 25 km of a coast, a navigable river, a major lake or a natural harbour, plus distance to the coast |
| **Motamed, Florax & Masters** (MFM) [partially verified: abstract] | 62,290 half-degree cells | Earlier urbanisation goes with agro-climatic suitability, seasonal frost, access to the ocean or a navigable river, and lower elevation. The effects weaken as urbanisation proceeds |
| **Bleakley & Lin** (BL) | US census tracts, night lights | Portage and fall-line effect, §2.3 |

**Design note.** Read together:

- Population density is mainly an agricultural catchment question, so it drives village and town sizes.
- Cities need a trade feature on top, especially navigable water.
- Rugged ground hurts cities even though it helps defence. Defence therefore gets a small weight, applied only to towns and cities as a bonus, never as a necessity.
- A competitor within about 20 km hurts, while cities 20–100 km away help. This is a short-range repulsion plus a mid-range attraction, which a nested hierarchy reproduces and uniform Poisson-disk spacing does not.

### 2.5 Central places, market areas and rings

- **Christaller (1933; trans. Baskin 1966).** A good's **threshold** is the smallest market that supports it; its **range** is the farthest distance people travel for it. Higher orders are fewer and farther apart (CHR via Rodrigue, King) [partially verified: the original was not read]. There are seven orders: Marktort (M), Amtsort (A), Kreisstadt (K), Bezirksstadt (B), Gaustadt (G), Provinzstadt (P) and Landstadt (L). Their populations are about 1,000, 2,000, 4,000, 10,000, 30,000, 100,000 and 500,000 (VRI, pp. 143–144; Rodrigue gives the two ends). Under K = 3 there are 486, 162, 54, 18, 6, 2 and 1 places, with tributary areas of 729 … 1 (KING, Table 3.1).

  | Principle | Nesting | Spacing per order (km), 4 km base (KING, CHEN) | Alternative series (VRI; lecture notes) |
  |---|---|---|---|
  | K = 3, marketing | 1-3-9-27 | 4.0, 6.9, 12.0, 20.7, 36.0, 62.1, 108 | 7, 12, 21, 36, 62, 108, 186 |
  | K = 4, traffic | 1-4-16-64 | **4, 8, 16, 32, 64, 128, 256** | — |
  | K = 7, administrative | 1-7-49-343 | 4, 10.6, 28, 74, 196, 519, 1372 | — |

  The two K = 3 series are both √3 progressions, offset by one order. The Baskin translation, which would settle the question, was not reachable.
- **Lösch (1940; trans. 1954).** K = 3 is a special case. Lösch lists the smallest market nets K = 3, 4, 7, 9, 12, 13, 16, 19, 21, 25. Overlaying the nets and rotating them around a metropolis produces **city-rich and city-poor sectors** (LOSCH via KING §3.2, pp. 29–30; Fig. 3.9 after Saey 1973) [partially verified].
- **Skinner (1964).** A Chinese standard marketing area holds about 18 villages, ideally in rings of 6 and 12 (SKIN via CSISS). Markets meet on a 10-day cycle (e.g. days 1-4-7), and the intermediate markets avoid clashing days (e.g. 2-5-8). The footnotes give a central market town of about 2,650 households and intermediate market towns of 360–900 households (SKIN, fn. 19). Household counts and areas of the standard area: [unverified].
- **Von Thünen (1826).** Land-use rings around a market by rent R = Y(p − c) − Y f m. This note does not add to `game-resources-and-trade.md` §4.4. It matters here only because towns create their own rings, so town placement should not need fixed rings.

### 2.6 City-size distributions

- **Auerbach 1913.** Rank × population is roughly constant. Ciccone's re-fit on German cities in 1910 gives a slope of −1.15 (s.e. 0.03) (AUER, Ciccone translation).
- **Zipf 1949.** Rank-size with exponent 1 (ZIPF) [unverified: book not read].
- **Gabaix 1999.** The number of cities larger than S is proportional to 1/S, i.e. exponent ≈ 1. Proportional (Gibrat) growth in the upper tail produces it (GAB, abstract).
- **Soo 2004/2005.** Across 73 countries the mean exponent for cities is about 1.11 (OLS) or 1.17 (Hill), and about 0.87 for urban agglomerations. The OLS range is Kuwait 1.72 to Guatemala 0.73. Political-economy variables explain the exponent better than geography (SOO, working-paper version).

### 2.7 Densities and urban shares (calibration anchors)

| Quantity | Value | Source |
|---|---|---|
| England 1086 (Domesday) | 268,279 people enumerated; about 1.1–1.5 million in total depending on the multiplier; at least doubled to 3–4 million by about 1300 | BAILEY, pp. 1–2. The England area (~130,000 km²) used for density is [unverified]. That gives about 9–12/km² in 1086 and about 25–30/km² in 1300 |
| Hunter-gatherer density | about 0.8 per km² (82.7 per 100 km²) for terrestrial plant users | BIN [partially verified: review snippet] |
| Europe urban share | about 3 % (800) → about 15 % (1800) | BB, fn. 1 |
| Europe in cities ≥ 10,000 | about 10 % in 1800 | DEV, p. 45 [partially verified] |
| Pastoral, irrigated and wet-rice densities | — | [unverified]; §6.4 uses design values |

---

## 3. Quantitative suitability methods

### 3.1 Multi-criteria evaluation and weighted overlay

- **GIS land-use suitability analysis** combines criterion maps by Boolean overlay (constraints), weighted linear combination (WLC, S = Σ wᵢ xᵢ with xᵢ normalised to [0, 1]), or more flexible operators (ordered weighted averaging, fuzzy) (MAL) [partially verified: citation and chapter structure; ScienceDirect blocked the text]. The usual form is **S = Π constraintsⱼ × Σ wᵢ xᵢ** [unverified as Malczewski's notation].
- **Emilien et al. 2012** use the same structure for building placement. Each criterion fᵢ is in [−1, 1], −1 acts as a veto, and the interest is I(B) = 0 if any fᵢ = −1, otherwise max(0, Σ wᵢ fᵢ(B)) (EMI §4, pp. 4–5).

**Design note.** WLC lets a surplus in one criterion make up for a deficit in another, which is wrong for necessities: a site with no water is not half good. This design uses a **multiplicative core** (water × food × climate, the necessities), a Liebig-style limiting-factor structure, times **(1 + bounded bonuses)** for trade and defence. Products and sums of [0, 1] terms are bit-exact.

### 3.2 Archaeological predictive models

- Predictive modelling has been used in cultural-resource management for over 20 years. It is criticised for its "perceived theoretical poverty", and its critics propose paleo-economic and cognitive models instead (VW, abstract) [partially verified; the volume and page numbers differ between records].
- Typical predictors are distance to water, slope, aspect, elevation and local relief [unverified].
- A standing critique is that the models rest on correlations with *present-day* physical parameters (Kamermans et al. 1999, via secondary sources) [partially verified].
- The site-selection lesson carries over: use the generator's own palaeo-state (its rivers, its climate), not a modern proxy. In a generated world the "present-day parameters" are the true ones, so the critique does not bite.

### 3.3 Walking time and travel cost

| Rule | Formula | Bit-exact? | Source |
|---|---|---|---|
| **Tobler's hiking function** (1993) | W = 6·exp(−3.5·\|S + 0.05\|) km/h, with S = dh/dx. Flat ground gives 5 km/h and the peak of 6 km/h is at S = −0.05. Multiply by 3/5 off path and 5/4 on horseback | Needs exp. Use `dexp` from `shared/core/dmath.ts` L31, which uses only + − × ÷, `Math.round` and bit manipulation, or the rational form below | TOB, Fig. II, PDF p. 4 |
| **Naismith's rule** (1892) | t = d / 5 km/h + ascent / 600 m/h (1 h per 3 miles + 1 h per 2,000 ft) | Yes, linear | NAI [partially verified: via Wikipedia] |
| **Langmuir's corrections** | Descent on 5–12° slopes: −10 min per 300 m; above 12°: +10 min per 300 m | Yes | LANG [partially verified] |

**Bit-exact Tobler without exp.** With a = 3.5·|S + 0.05|:

```
W(S) ≈ 6 / (1 + a + a²/2 + a³/6 + a⁴/24)          (+ − × ÷ only)
```

This is the Taylor series of e^a in the denominator. It is strictly positive and decreasing in |S + 0.05|. Its relative error is under 0.4 % for a ≤ 1 (|S| up to about 0.24) and about 25 % at a = 3.5 (S = 1), where W is under 0.2 km/h either way. That is my own calculation, not a sourced value. On the 8 km patch graph the slopes are mostly below 0.05, so Naismith's linear rule is good enough. Tobler, through `dexp`, is for 1 km raster paths.

**Mode costs for goods.** Freight cost per km follows `game-resources-and-trade.md` §4.2: sea 1, river downstream 2–3, river upstream 4–6, road 10–20, trackless land 20–40. A **mode change costs a fixed transshipment charge**. That charge is what makes break-of-bulk points attract cities in a routing model (COOL).

### 3.4 Accessibility and gravity

- **Hansen 1959 accessibility.** Aᵢ = Σⱼ Sⱼ · f(dᵢⱼ), the opportunities Sⱼ weighted by a decreasing function of distance or cost (HAN) [partially verified: general form from the REAT package documentation; Hansen's own exponent was not checked]. With f = 1/(1 + c/c₀)² it uses only + − × ÷.
- **Reilly 1931, breaking point.** The boundary between the market areas of towns A and B lies at d_A = D / (1 + √(P_B/P_A)) from A. It follows from inverse-square attraction and needs only √ (REI) [partially verified].
- **Huff 1963.** Pᵢⱼ = Aⱼ^α Dᵢⱼ^−β / Σₖ Aₖ^α Dᵢₖ^−β. With α = 1 and β = 2 it is bit-exact (HUFF) [partially verified: Wikipedia form].

**Design note.** Hansen accessibility over a region's patch graph gives the "centrality" of a candidate city, and Reilly's breaking point can assign zones to towns. Both are region-local.

### 3.5 Height above the nearest drainage (HAND)

HAND is a cell's height minus the height of the drainage cell its flow path reaches (REN) [partially verified: abstract]. Nobre et al. use thresholds of 0–5 m (water table near the surface), 5–15 m (shallow) and above 15 m (deep) (NOB via the GRASS `r.hand` manual) [partially verified].

The terrain pipeline already stores, for each raster cell, "the bed / coast height the cell's path starts from" (`terrain.ts` L986, `src`). So h − src is a HAND value with no extra pass. It is computed before detail noise and fill, so it is approximate there. A good village site is one with HAND of about 3–15 m within about 1 km of a river: a dry-point terrace by a wet-point river.

---

## 4. How procedural generators and games do it

### 4.1 Azgaar's Fantasy Map Generator (AZ)

Read at HEAD `4b34afc` (TypeScript rewrite) and at `c04fb2b` (the last commit with the legacy JS layout).

**Suitability**, `src/model/society/population-generator.ts` L9–67 (`rankCells`):

```
score  = biome habitability                                   L38   (0 → skip)
score += normalize(flux + confluence, meanFlux, maxFlux) × 250 L41
score −= (height − 50) / 5                                    L42
coastline: +15 estuary (river), +5 ocean coast, +20 safe harbour (harbour == 1),
           lake: freshwater +30, salt +10, frozen +1, dry −5, sinkhole −5, lava −30   L10–20, L44–53
s      = score / 5                                            L55
pop    = s > 0 ? s × area / meanArea : 0                      L65
```

- `normalize(v, min, max) = clamp((v − min)/(max − min), 0, 1)`.
- `harbor` counts a land cell's adjacent water cells. `harbor === 1` is a sheltered harbour (`features-generator.ts` L161–167).
- Habitability per biome: temperate deciduous forest 100, temperate rainforest 90, tropical rainforest 80, tropical seasonal forest 50, grassland 30, savanna 22, taiga 12, wetland 12, cold desert 10, hot desert 4, tundra 4, glacier and marine 0 (`biomes-generator.ts` L25–140).
- The legacy `main.js` L1173–1212 has the same constants.

**Placement**, `src/model/political/burgs-generator.ts` L84–200:

- **Capitals.** Cells are sorted by `score × (0.5 + rand × 0.5)` (L100). Initial spacing is `(W + H) / 2 / nCapitals` (L105). A capital is accepted if a quadtree finds no burg within `spacing` (L111). If placement fails, everything resets and `spacing /= 1.2` (L117–122).
- **Towns.** The score is multiplied by `gauss(1, 3, 0, 20, 3)` (L140). Spacing is `(W + H) / 150 / (n^0.7 / 66)` (L145). Each candidate draws its own `spacing × gauss(1, 0.3, 0.2, 2, 2)` (L153). Spacing is halved after each pass (L176).
- **Ports.** `harbor === 1`, or `harbor > 0` for a capital (L280). A water body needs at least 2 ports (L320).
- **Population.** `s / 5`, × 1.5 for a capital, × a route connectivity rate (0.8 + 0.2 per road, 0.2 per sea route …), × `gauss(1, 1, 0.25, 4, 5)` (L396–405).

**Assessment.** The terms map one-to-one onto the factors in §2.1, with a strong flux term (×250 against a habitability of at most 100, then ÷5). The randomisation (`Math.random`, Gaussian jitter) and the global shrinking spacing loop make it non-deterministic and order-dependent.

### 4.2 Martin O'Leary, `mewo2/terrain` (OL)

Commit `a2511d6`, `terrain.js` L478–507:

```
score[i]  = √flux[i]                                              L479
score[i]  = −999999 if h ≤ 0 or near the map edge                 L481–482
score[i] += 0.01 / (1e−9 + |x| − w/2)   (and the same for y)      L485–486, an edge penalty
score[i] −= Σ_cities 0.02 / (d(city, i) + 1e−9)                   L488
placeCity: argmax; placeCities: repeat ncities = 15 times          L493–507, L1065
```

This is greedy argmax with soft inverse-distance repulsion. River size is the only attractor.

### 4.3 Civilization V and IV AI site evaluation (CIV5, CIV4)

**Civ V**, `CvGameCoreDLL_Expansion2/CvSiteEvaluationClasses.cpp` (Gedemon/Civ5-DLL `aa29e80`, the Firaxis SDK 1.0.3.144):

- **Ring weights** `{1, 6, 3, 2, 1, 1, 0, 0}` (L38–45). Each tile within 5 rings adds `ring × (15·food + 3·production + 2·gold + 1·science + 1·faith)` (L376–392).
- **City plot.** River +15 % (L600), coast +40 % (L608), building on a resource −50 % (L595).
- **Strategic value.** Hills in ring 1 add 3, chokepoints 5 (L1011–1052).
- **Spacing.** The sweet spot is 5 tiles (clamped to 4–6). At the sweet spot the value is × 1.75; closer is ÷ 2; farther than 7 is × ⅔ (L637–659). A minimum city range is a hard rule (L147–173).

**Civ IV**, `CvPlayerAI::AI_foundValue` (beyond-the-sword-sdk `3c14d26`, `CvPlayerAI.cpp` L1588–2491):

- Base 1000. Per-tile weights of 40/40/30 for tiles that feed a citizen (L1980–1982); a river tile +10 (L2022).
- City plot: hills +200 (L2170), river +40 (L2175), fresh water +40 + 30 × health (L2180–2181).
- Distance to the nearest own city d: −(d − 5) × 500 if d > 5, −(4 − d) × 2000 if d < 4 (L2345–2356).
- A food-balance multiplier (L2436–2437).

**Assessment.** Both are catchment sums with a strong food weight (Civ V weights food 15 against production 3), plus site multipliers for water and coast, plus a preferred spacing band. Civ IV's "too close" penalty is 4 times steeper than its "too far" penalty, which is the same shape as Bosker & Buringh's −1.5 within 20 km against +1 at 20–100 km (§2.4).

### 4.4 Emilien et al. 2012, villages on arbitrary terrain (EMI)

- Seeds are random positions. A buildable position is accepted with a probability that depends on its interest I(B), defined in §3.1.
- The criteria are sociability (attraction and repulsion by distance to neighbours), worship, accessibility (an asymmetric bell of distance to a road), slope (a bell around a preferred slope), water (a decreasing function of distance), fortification, and **geographical domination** f(x) = Σ_{p: |x−p|<r} (h(x) − h(p)) / (1 + |x − p|²).
- Road cost is C(R) = Σ wⱼ gⱼ(R), discounted on existing roads.

The domination function is + − × ÷ only. §6.6 uses it for defence in site refinement.

### 4.5 Others

| Project | What could be verified |
|---|---|
| **Dwarf Fortress** | No first-hand description by Tarn Adams of site placement was found. Community wiki snippets say human towns are "usually near some source of water" and that sites need a non-mountain land biome next to them [unverified: DF wiki returned 429] |
| **Ultima Ratio Regum** (IndieDB, 22 Dec 2012) | Civilizations are seeded where "food, water, resources" are; over about 1,700 simulated years they expand, preferring rivers, coasts and temperate climates. No formula [partially verified: read through a summariser] |
| **Songs of Syx** | Devlogs mention world regions with resource potentials. No placement algorithm found |
| **Red Blob Games** (mapgen4) | No settlements: towns and nations "could be added on top" |
| **Here Dragons Abound** | No site-selection post found. Its "City Symbols (Part 9)" (Jan 2018) only moves already-placed cities with the label placer (land and on-screen constraints) |

### 4.6 What they share

| Ingredient | Azgaar | O'Leary | Civ V | Civ IV | Emilien | This design (§6) |
|---|---|---|---|---|---|---|
| Food or biome catchment | Habitability (cell only) | — | Ring-weighted yields | Tile yields in radius | — | Food density × patch area, with rings by level |
| River | Flux + confluence ×250 | √flux | +15 % | +40, tile +10 | Water distance | Water gate + navigable river, mouth, confluence, head of navigation, bridge |
| Coast and harbour | +5, harbour +20, estuary +15 | — | +40 % | Water-tile terms | — | Harbour, mouth (gateway) |
| Elevation and defence | −(h−50)/5 | — | Hills +3 | Hills +200 | Domination | Small bonus; ruggedness not rewarded for cities |
| Spacing | Quadtree radius that shrinks | 0.02/d repulsion | Sweet spot 5 tiles | Penalty band 4–5 | Sociability | Hierarchy-aware NMS per owner, plus border depth |
| Randomness | `Math.random`, Gaussian | none | none | none | Random seeding | Hash tie-breaks only |
| Infinite, order-independent | no | no | no | no | no | yes |

---

## 5. Spacing and hierarchy

### 5.1 Picking sites from a suitability field

| Method | How | Deterministic on a lazy infinite map? |
|---|---|---|
| **Greedy argmax + repulsion** (OL) | Re-score after each placement | Needs a global order; no |
| **Greedy with minimum distance** (AZ, Civ hard range) | Sort by score; accept if no accepted site within r | Yes, **if the candidate set is a closed, bounded owner set** and ties break by hash (§5.3) |
| **Poisson-disk sampling** (Bridson 2007 [unverified]) | Random darts with a minimum distance | Order-dependent unless it is lattice-based. It ignores suitability unless weighted |
| **Non-maximum suppression** (NMS) | Keep a candidate if it is the maximum within radius r | **Local-maximum NMS** ("best within r of all candidates", without removing suppressed ones) is order-free but can leave gaps. Greedy NMS removes suppressed candidates and fills better |
| **Lloyd relaxation** | Move sites to the centroids of their cells | Iterative and global. Useful only to smooth within one owner |
| **Lattice + hash** | One candidate per lattice cell (the repo's Worley construction) | Yes. The repo already does this for its sites |

**Design note.** The repo's levels are already a lattice-with-hash hierarchy, so "one centre per cell of each level" is the natural spine. Within a region the candidate set is closed, so greedy NMS in a total order is a pure function of the region. Across region borders, §6.5 uses border depth instead of cross-region suppression.

### 5.2 The repo's hierarchy is K = 4, two orders per level

In K = 4 (CHEN Table 1; KING §3.1.7) [partially verified], spacings are 4·2^(k−1) km and each area holds 4 areas of the next order down. Mapping the orders onto the repo:

| Christaller order (K = 4, 4 km base) | Spacing | Repo level | Count per region | Name used here |
|---|---|---|---|---|
| 1 | 4 km | — (sub-cell hamlets) | ~1,024 | hamlet (not placed) |
| 2 | 8 km | **patch** | 256 | village |
| 3 | 16 km | 4 patches | 64 (48 new) | market village |
| 4 | 32 km | **elevation zone** | 16 (12 new) | market town |
| 5 | 64 km | 4 zones | 4 (3 new) | county town |
| 6 | 128 km | **region** | 1 | city |

So per zone the ideal is **1 market town + 3 market villages + 12 villages** (16 patches). Per region it is **1 city + 3 county towns + 12 market towns** (16 zones). These are ideal counts. Merges (2–4 per level), ocean and uninhabitable land lower them. They are caps, not quotas. This holds whenever `ez.size / patch.size = reg.size / ez.size = 4`. For other ratios r, the order-3 and order-5 counts per area become r² − 1 instead of 3 + 12 [Design note].

Lösch's city-rich and city-poor sectors (§2.5) and the Bosker & Buringh 20–100 km attraction (§2.4) both argue against forcing exact counts. Thresholds (§6.5) decide whether a slot is filled.

### 5.3 Ownership and tie-breaking

- **A site belongs to the owner that contains it.** The village belongs to the patch, the town to the (merged) zone of its patch, the city to the **drawn** region of its patch (`patchCell().region`). The rivers use the drawn region too (`rivers.ts` L243–260).
- **Total order.** Sort by score descending, then `hash4(seed, ST_SETTLE, keyI(s), keyJ(s))`, then key. Floating-point ties are rare but must not depend on iteration order.
- **Sum in a fixed order.** Every Σ over patches uses lattice-sorted keys, as `regionElevationZones` sorts its result (`rivers.ts` L258), so the float results are bit-identical.
- **Cross-owner spacing without lookups.** A region border is a drainage divide with a ridge (`terrain.ts` header, step 2; rivers never cross it, `rivers.ts` L21–26). Requiring **border depth** ≥ d (patch steps to the nearest patch of another *land* region) for towns and cities keeps them about 2·d·patch.size apart across borders without reading the neighbour's results. Sea is open: ocean patches of other regions do not count.

---

## 6. Design note: settlement siting for sandbox4

### 6.1 Contract: two tiers

| Tier | Decides | Inputs | Available | Rule |
|---|---|---|---|---|
| **M (map)** | Which patches hold a village, market village, town, county town or city; their rank and population | World, zone types, coast, region rivers, river beds (`bed()`), climate, **height-estimated** biome | At any zoom, without height tiles | A pure function of (seed, params, region), using only the region's own rivers and beds |
| **T (terrain)** | The exact point inside the chosen patch (1 km raster cell); a pass-foot flag | Height tile: h, HAND (h − src), slope, relative height | After the region's tile exists | **Never changes a Tier M choice.** It only moves the point inside its patch |

**Why not use exact heights in Tier M?** `Biomes.ofPatch` returns an estimate until the tile arrives and exact values after (`biomes.ts` L247–260). A city choice that read it would change when the user zooms in, breaking "same map in any order" (`README.md`, base map). Tier M therefore always uses the zone type's typical height (`TYPICAL_HEIGHT`, `biomes.ts` L194) through a forced-estimate entry point (§6.11). The price is that a few patches near a belt threshold are scored with a different biome than the one drawn. **Open question 1** (§6.14) proposes a fix.

### 6.2 Candidates: patches, refined on the raster

Recommendation: **the candidate is the patch** (Tier M), refined to a **raster cell** (Tier T).

- The 256 patches per region make an O(n log n) selection trivial. The 16,384 raster cells per region would need the tile.
- The patch is the farming catchment (§2.2), so its food is the village's food.
- River features (mouth, confluence, head of navigation, bridge) are points. Each is attached to the patch containing the node (`world.cellAt(x, y, true).patch`). The rivers already classify every node this way to set `wet` (`rivers.ts` L862).

### 6.3 Per-patch features (Tier M)

Notation:

- For a land patch s (merged root), R is its drawn region and z its (merged) zone.
- S² is the mean patch area in km² (`patch.size`²; 64).
- `perPatch` is `riv.points` (10).
- **a = flow / perPatch** is the number of inland patches upstream, a drainage-area proxy (× S² km²). In a river-poor flat zone each patch has 0 or 1 attractor (`rivers.ts` L294–296), so *a* is low there. That fits low discharge.

| Feature | Formula (+ − × ÷ √, comparisons) | Source of data |
|---|---|---|
| `zt` | `elevationZoneType(cell.elevationZone, false)` | `zones.ts` L45 |
| `T, P, m, belt, biome` | `info(..., h = NaN)`: T = T₀ − cooling(TYPICAL_HEIGHT[zt]); m = P / max(40, 20T + 140) | `biomes.ts` L278 |
| `coast` | `rivers.isCoastPatch(s)`, or `BiomeInfo.coastal` for the merged patch | `rivers.ts` L237; `biomes.ts` L238 (at `397f779`) |
| `lake` | the largest `Lake` with `patch = s` in `lakes.get(R)`: its area, or 0 | `lakes.ts` L57–82, L189 (at `397f779`) |
| `oceanFrac` | ocean Gabriel neighbours / all Gabriel neighbours | `world.patchNbrs` |
| `harbour` | coast and some adjacent ocean patch o has landFrac(o) ≥ 0.5 (an enclosed bay) → 1; coast only → 0.4; else 0 | analogue of Azgaar `harbor === 1` |
| `aMax` | max *a* over dry nodes in s | `RegionRivers.flow`, `wet` |
| `aMouth` | *a* at a dry node whose parent is wet or a root (the river crosses the coast) | `parent`, `wet` |
| `aConf` | max over nodes in s of the **second-largest** *a* among its dry children (both branches matter) | `parent` (children by inverse scan) |
| `head` | node with a ≥ A_nav whose children all have a < A_nav (the last navigable node) → 1 | |
| `fall` | navigable node (a ≥ A_nav) where the upstream bed slope ≥ κ × the downstream bed slope (a knickpoint), **or** where the river passes from a hills or mountains zone into a flat or lowland zone → 1 | `terrain.bed(R)`, zone types |
| `bridge` | on each river with aMouth ≥ A_nav: the first node upstream from the mouth where floodplain half-width × √(flow / 100) ≤ W_bridge → 1 | `terrain.flood`, `bed`; `terrain.ts` L575–576 |
| `depth` | BFS steps over the region's patch graph from the patches that touch another land region (those have depth 0) | `patchNbrs`, `patchCell().region` |

Defaults (new `set.*` parameters, §6.11):

| Parameter | Default | Meaning |
|---|---|---|
| A_nav | 30 patches (≈ 1,900 km²) | Navigable by river boats |
| A_big | 120 patches (≈ 7,700 km²) | Large river |
| κ | 3 | Knickpoint slope ratio |
| W_bridge | 150 m | Floodplain half-width a bridge can span |

The real thresholds depend on runoff. These are design values.

### 6.4 Score terms

All terms are in [0, 1] unless noted. `sat(x) = min(1, max(0, x))`. `ramp(x, x0, x1) = sat((x − x0)/(x1 − x0))`. `trap(x, a, b, c, d)` is the ECOCROP trapezoid (`patch-resources.md` §7.1).

| Term | Formula | Real factor (§2) | Notes |
|---|---|---|---|
| **K** food density, people/km² | `K_biome[biome] × K_zone[zt] + irrig + fish`. Irrigation: `irrig = (m < 1) ? K_irr × sat(aMax / A_big) : 0`, the wet point in dry land. Fish: `fish = 2 × coast + 1 × (aMax ≥ A_nav) + 1 × (lake > 0)` | Catchment (VFH); densities §2.7 | Replace by Σ potentials × yields once the resource layer exists (`game-resources-and-trade.md` §5.8 step 1) |
| **P_v** village catchment, people | `K × S²` | The patch is the 1 h catchment | |
| **W** water (necessity) | `max(sat(aMax / 2), ramp(m, 0.5, 1.5), 0.5 × coast, 1 × (lake > 0))` | Water supply | Any stream with 2+ patches upstream, or a humid climate, or the coast (brackish: half) |
| **C** climate comfort (necessity) | `trap(T, −8, 4, 24, 34)` | Cold and heat limits | Polar belt → 0. Aridity is already in W and K |
| **M** material and fuel | `0.5 × build + 0.5 × max(fuel, 1 − need)`. `build = max(wood[biome], stoneZ[zt], clay)`, `clay = (zt ∈ {flat, lowland} and aMax ≥ 1) ? 0.8 : 0.3`. `need = [1, 1, 0.8, 0.5, 0.1][belt]` | Building material and fuel (`game-resources-and-trade.md` §5.5) | `wood` from biome, `stoneZ` = [_, 0.2, 0.3, 0.8, 1] |
| **D** defence | `max(Dz[zt], 0.5 × (oceanFrac ≥ 0.5), 0.4 × (aConf ≥ A_nav / 2))`, with Dz = [_, 0, 0.1, 0.6, 0.7] | Hill, peninsula, confluence spur | A bonus only. Ruggedness is not rewarded for cities (BB) |
| **X** trade (gateway) | Items xᵢ·wᵢ: mouth `sat(aMouth / A_big)·1.0`; harbour `harbour·0.6`; navigable `ramp(aMax, A_nav, A_big)·0.5`; head or fall `max(head, fall)·0.6`; confluence `sat(aConf / A_nav)·0.4`; bridge `bridge·0.3`; coast `coast·0.2`. `X = max_i + 0.25 × (Σ_i − max_i)`, at most about 2 | Break of bulk (COOL), navigable river (BB), portage and fall line (BL), harbour (HSSW) | Diminishing returns: one dominant feature plus a quarter of the rest |
| **Acc** centrality, region level | `Σ_t P_v(t) / (1 + c(s, t) / c₀)²` over the region's patches t, ÷ Σ P_v(t). c is the least travel cost (§6.8) and c₀ = one day | Hansen (HAN); Christaller's central place | Computed only for the top ~8 town candidates (8 Dijkstras on ~256 nodes) |

**Design calibration tables.** These are not sourced. Anchors: Domesday England at about 10/km² in 1086 and about 25/km² in 1300; hunter-gatherers below 1/km² (§2.7).

| Biome | `K_biome` (people/km²) | `wood` |
|---|---|---|
| Broadleaf, mixed forest (cleared farmland) | 30 | 1.0 |
| Grassland, shrubland (Mediterranean) | 20 | 0.4 |
| Dry forest, savanna | 18, 12 | 0.7, 0.4 |
| Temperate rainforest, tropical rainforest | 8, 8 | 1.0 |
| Taiga | 2 | 1.0 |
| Mangrove (added with the biome, `dc52798`) | 3 | 0.5 (poles, charcoal) |
| Cold steppe, thorn scrub | 3, 4 | 0.2, 0.3 |
| Hot desert, cold desert, tundra | 0.3 | 0.05 |
| Ice | 0 | 0 |

`K_zone` = [_, 1, 1, 0.6, 0.3] for flat, lowland, hills, mountains. `K_irr` = 60 people/km², the river oasis.

**Composite scores per level.** The necessities multiply, the bonuses are bounded.

```
village(s) = P_v · W · C · (0.8 + 0.2·M) · (1 + 0.2·X)
market(s)  = P_ring(s) · W · C · (0.7 + 0.3·M) · (1 + 0.1·D) · (1 + 0.6·X)      orders 3–4
city(s)    = W · C · (0.7 + 0.3·M) · (1 + 0.1·D) · max(Acc(s), γ_g · X / X_max)  order 6, ranks only
```

- `P_ring(s)` is the sum of P_v over s and its Gabriel neighbours in the same region. That is the ~12 km market reach, Bracton's ⅓ day.
- The city score ranks only candidates that are already towns. Their catchments were credited in `market`, so the city score looks at **position**: central place (Acc) or gateway (X).
- γ_g = 1 makes a perfect gateway equal to a perfect central place. Raise it to favour ports.

### 6.5 Selection

All of this happens inside one region R (drawn land patches, lattice-sorted). Ranking uses the total order of §5.3.

1. **Villages (order 2).** Every land patch with `village(s) ≥ τ_v` (default 50 people) gets one. Below that the land holds dispersed farms, camps or herders, flagged `sparse`.
2. **Market towns (order 4).** Candidates are villages with `depth ≥ 1`. Sort by `market` and go through them greedily. Accept s if its zone has no town yet and no accepted town lies within r₄ = 0.6 × 2 × `ez.size`/2 = 19 km (0.6 × the K = 4 spacing of 32 km). A zone gets a town only if `a × P_zone ≥ τ_t` (default 300 people), the Christaller threshold. Steppe and desert zones may get none, and can carry a "seasonal fair" flag instead (Skinner's periodic markets).
3. **Market villages (order 3).** Within each zone, in `market` order, accept up to 3 more villages (K = 4: 4 − 1). Each must be at least r₃ = 0.6 × 16 km ≈ 9.6 km from every accepted order-3 and order-4 centre in R. That is close to Bracton's 10.7 km. `depth ≥ 0`, since the Tier T inset (§6.6) keeps them at least about 3 km from any other village.
4. **City (order 6).** Candidates are towns with `depth ≥ 2`. Take the argmax of `city(s)`. If `a × P_region × (1 + X) < τ_c` (default 5,000), the region has **no city**: its best town is a "regional centre". If R has no habitable land, nothing is placed.
5. **County towns (order 5).** The remaining towns are ranked by `market × Acc`. Accept up to 3 with r₅ = 0.6 × 64 km ≈ 38 km from the city and from each other.

**Order independence.** Every step reads only R's own data (features, rivers, beds) and a fixed total order. The results are cached per region like `Rivers.get`.

**Cross-border spacing.**

- Towns have depth ≥ 1 and cities depth ≥ 2. Across a border, towns are at least about 1–2 × `patch.size` (8–16 km) apart and cities at least about 3–4 × `patch.size` apart.
- The town distance is below r₄. This is a deliberate relaxation: the border is a ridge.
- **Variant B** (optional, k = 1). A depth-1 town candidate is dropped if a neighbouring region's **raw top-1** town candidate (computed from that region's own features, not its final result) lies within r₄ and ranks higher. Using raw, not final, candidates avoids chains (A suppresses B, which would have suppressed C) and keeps the dependency to the 1-ring. It costs the neighbours' rivers.

### 6.6 Site refinement on the raster (Tier T)

This step runs per region inside the tile computation (worker), after the fill, over the cells of each chosen patch (`patchOf`, `terrain.ts` L936). Cells within 1 cell of the patch border are excluded. With 1 km cells that keeps sites at least about 3 km apart across patch borders.

```
hand(q)   = h[q] − src[q]                                     terrain.ts L986
dry(q)    = ramp(hand, 2, 5)                 off the floodplain (Nobre 0–5 m class)
wet(q)    = 1 / (1 + dWater(q) / 1000)       dWater: chamfer distance to a river cell or coast, m
flat(q)   = 1 − ramp(slope(q), 0.05, 0.20)
dom(q)    = Σ_{p: |q−p| ≤ 3 cells} (h[q] − h[p]) / (1 + |q−p|²)    Emilien's domination (EMI)
anchor(q) = 1 / (1 + d(q, featureNode) / 1000)     towns and cities with X > 0: mouth, confluence, bridge, head
site(q)   = wet · dry · flat · (1 + wD · sat(dom / 30)) · (1 + wA · anchor)
```

- `wD` is 0 for villages, 0.3 for towns and cities. `wA` is 0 for villages, 1 otherwise.
- Take the argmax. Ties go to the lowest cell index, which is world order as in the fill.
- In arid belts (m < 0.5), set `dry = 1`: there the wet point is the point.
- **Pass foot** (optional flag). On each border shared with another land region, find the lowest own border cell. If it is at least 150 m below the mean border height there, flag the nearest chosen town as "pass town" and give it a small population bonus at the next Tier T read. It never changes Tier M.

Output: a few typed arrays added to `TerrainTile`, which the worker can transfer: `setPatch: Float64Array`, `setX`, `setY: Float32Array`, `setFlags: Uint8Array`.

### 6.7 Population and the rank-size check

Let *a* be the urban share per order (`set.urban`, default 0.035) and A_k the market area of an order-k centre within R, assigned by nearest centre on the travel graph (§6.8), ties by key.

```
pop_village(s) = v · P_v(s)                         v = 0.6 (the rest in hamlets and farms)
pop_k(s)       = a · P(A_k(s)) · (1 + γ · X(s))     k = 3, 4, 5, 6;  γ = 0.5
```

**Why this gives Zipf.** In the homogeneous case P(A_k) = 4^(k−2) × P_v. Each order is then 4 times larger, while K = 4 nesting makes each order 4 times as numerous going down. Rank-size exponent α = ln q / ln 4 with q = 4 gives α = 1, the Zipf value (GAB). Soo's mean of about 1.1 (SOO) corresponds to q ≈ 4.6. The X multiplier and the uneven food density spread the sizes around this line.

Total urban share is a × (1 + 3 × 3/4) = 3.25a ≈ 11 % for a = 0.035, of which the city alone holds a(1 + γX) ≈ 3.5–7 %. That is within Europe's 3 → 15 % over 800–1800 (BB).

Example: a temperate region at about 20/km² holds about 330,000 people. Its city would have about 12,000–25,000 people, a typical market town about 700–1,400, a market village about 200.

**Check (test, §6.12).** Over a fixed 8 × 8 region window, fit log(pop) against log(rank) for all centres of order ≥ 3. Expect a slope magnitude in [0.8, 1.4].

### 6.8 Travel cost model

The graph has one node per land patch, with Gabriel edges (`world.patchNbrs`), plus water edges. It is used for Acc (§6.4), market-area assignment (§6.7) and later roads (`README.md` "Trade network").

| Edge | Time (h), for travel days | Freight (cost units), for prices | Notes |
|---|---|---|---|
| Land a → b | `d / 5 + max(0, h_b − h_a) / 600` (Naismith), `× rough[zt] × veg[biome]` | `d × 25 × rough × veg` | `h` = TYPICAL_HEIGHT in Tier M (bed height where a river is present). rough = [_, 1, 1, 1.3, 2]; veg 1, forest 1.3, rainforest 2, mangrove 2 [Design] |
| Land, undirected | `d / 5 + \|Δh\| / 1200` | as above | Ascent split evenly over both directions; Langmuir descent is ignored |
| River downstream / upstream (both ends on a node chain with a ≥ A_nav) | `d / 6` / `d / 3` | `d × 2.5` / `d × 5` | `game-resources-and-trade.md` §4.2 ratios |
| Sea (coastal s to coastal t through ocean patches) | `d / 6` | `d × 1` | Path over the ocean patch graph inside the k-ring |
| Mode change (land ↔ river ↔ sea) | + 2 h | + 50 (≈ 2 km of land freight) | Transshipment: makes break-of-bulk points central (COOL) |

- c₀ = 8 h (one travel day).
- Dijkstra uses `MinHeap` with ties on the smaller value (`heap.ts` L1–15). Values are node indices in lattice-sorted order, so the result is deterministic.
- For 1 km raster paths in Tier T, use Tobler through `dexp`, or the rational form of §3.3.

### 6.9 Interaction with prices and flows (`game-resources-and-trade.md` §5.7)

**The order is one-directional.** Settlement reads static supply (potentials) and topology. Prices read settlement populations as demand. No step reads its own output, so there is no fixed point and no global iteration.

| Step (§5.8 there) | Reads | Locality |
|---|---|---|
| 1. Patch potentials, deposits | Climate, zone, biome (estimated) | Patch |
| 2–3. **Settlement Tier M** (this note): villages, towns, city, populations | Step 1 + own rivers and beds | Region (k = 0) |
| 4a. Prices, Model A | Supply and demand (demand = Σ pop × need) of the k-ring | k = 1 → needs settlement of 3 × 3 regions |
| 4b. Flows, Model B, rounds 1–3 | Prices of neighbours | k ≤ 3 |
| 5. *Optional* trade bonus: pop′ = pop × (1 + β × throughput / pop), β ≤ 0.3, for towns on flow edges | Round-1 flows only | Bounded (k ≤ 4); applied once, never fed back |
| 6. Tier T site refinement | Tile | Region |

- Step 5 is the only feedback. It runs **once**, reads a frozen earlier round, and changes sizes but **not sites or ranks**. This keeps city choice stable and the dependency radius bounded.
- `thrive` (§5.5 there) can use the region's settlement potential, Σ village(s) / Σ P_v(s), in place of `prosperityAt` (`climate.ts` L105–107).

### 6.10 Pseudocode

```ts
// src/world/settlements.ts (new)
export type Order = 2 | 3 | 4 | 5 | 6;
export interface Settlement { patch: number; zone: number; order: Order; pop: number; score: number; x: number; y: number; flags: number }
export interface RegionSettlements { region: number; list: Settlement[]; potential: number }

export class Settlements {
  private cache = new Map<number, RegionSettlements>();
  constructor(readonly world: World, readonly rivers: Rivers, readonly terrain: Terrain,
              readonly biomes: Biomes, readonly p: SettlementParams) {}

  get(rkey: number): RegionSettlements {
    let r = this.cache.get(rkey);
    if (!r) { if (this.cache.size > 4000) this.cache.clear(); r = this.compute(rkey); this.cache.set(rkey, r); }
    return r;
  }

  private compute(rkey: number): RegionSettlements {
    const w = this.world, P = this.p;
    const patches = this.landPatches(rkey);                   // drawn in rkey, merged roots, sorted by key
    const rr = this.rivers.get(rkey), bed = this.terrain.bed(rkey);
    const riv = riverFeatures(w, rr, bed, this.terrain.flood, P);   // Map<patch, {aMax,aMouth,aConf,head,fall,bridge}>
    const depth = borderDepth(w, patches, rkey);           // BFS from patches touching another land region
    const f = patches.map((s) => this.features(s, riv.get(s), depth.get(s)!));  // §6.3–6.4, estimate-height biome
    const tie = (s: number) => hash4(w.p.seed, ST_SETTLE, keyI(s), keyJ(s));
    const byScore = (k: 'village' | 'market' | 'city') => (a: Feat, b: Feat) =>
      b[k] - a[k] || tie(a.patch) - tie(b.patch) || a.patch - b.patch;

    const villages = f.filter((x) => x.village >= P.minVillage);
    // order 4: one town per zone, greedy NMS inside the region
    const towns: Feat[] = [];
    for (const x of villages.filter((v) => v.depth >= 1).sort(byScore('market'))) {
      if (towns.some((t) => t.zone === x.zone || dist2(t, x) < P.r4 * P.r4)) continue;
      if (P.urban * zonePop(f, x.zone) < P.minTown) continue;
      towns.push(x);
    }
    // order 3: up to 3 more per zone
    const markets: Feat[] = [];
    for (const x of villages.sort(byScore('market'))) {
      if (towns.includes(x) || markets.filter((m) => m.zone === x.zone).length >= 3) continue;
      if ([...towns, ...markets].some((t) => dist2(t, x) < P.r3 * P.r3)) continue;
      markets.push(x);
    }
    // order 6: city among deep towns, by position (centrality or gateway)
    const acc = accessibility(w, f, towns.filter((t) => t.depth >= 2), P);   // Hansen, Dijkstra per candidate
    for (const t of towns) t.city = t.W * t.C * (0.7 + 0.3 * t.M) * (1 + 0.1 * t.D) * Math.max(acc.get(t.patch) ?? 0, P.gGate * t.X / X_MAX);
    const city = towns.filter((t) => t.depth >= 2).sort(byScore('city'))[0];
    // order 5: up to 3 county towns, NMS from the city
    // populations: market areas by nearest centre on the travel graph, pop_k = a · P(A_k) · (1 + γX)
    return assemble(rkey, villages, markets, towns, city, P);
  }
}
```

Tier T, in `Terrain.compute` after the fill: for each owned region, call `settlements.get(r)`, then `refineSites(...)` (§6.6), and write the `set*` arrays into the tile.

### 6.11 Hook points

| Change | Where |
|---|---|
| New module `Settlements` (Tier M) and `refineSites` (Tier T) | `sandboxes/sandbox4/src/world/settlements.ts` (new) |
| Forced-estimate biome entry point, so Tier M never reads tile heights | `biomes.ts`: a public `estimatePatch(skey)` that calls `info(..., NaN)` (L278) |
| Children of river nodes, mouth, confluence, head and bridge detection | `settlements.ts` `riverFeatures()`, from `RegionRivers` (`rivers.ts` L137–169) and `Terrain.bed` (L412) and `flood` (L279) |
| Per-patch tile stats and refined sites | `terrain.ts`: next to the patch mean loop (L1178–1195), add the HAND, slope and domination pass for chosen patches. Extend `TerrainTile` (L208–236) with `setPatch`, `setX`, `setY`, `setFlags`. Add the buffers to the worker transfer list (`terrain.worker.ts` L64) |
| Parameters (`set.urban`, `set.navPatches`, `set.bigPatches`, `set.minVillage`, `set.minTown`, `set.minCity`, `set.r3`, `set.r4`, `set.r5`, `set.gateway`) | `src/params.ts` schema + `defaults.json` (the README requires both) + `tests/fixture.ts` BASELINE if the tests pin them |
| Settlement potential replacing the prosperity noise | `climate.ts` L105–107 stays as a fallback; `main.ts` L119, L319, L367 switch the overlay source |
| Overlay and inspector (symbols by order, population, the dominant X term: "river mouth", "fall line", …) | `src/render/` overlays, `src/ui/` inspector |
| Cache trimming | `World.trim`-style limit, as `Rivers.get` does (`rivers.ts` L226–235) |

### 6.12 Tests (`sandboxes/sandbox4/tests/settlements.test.ts`, with `testParams()`)

1. **Pure and order-independent.** Compute the settlements of a 4 × 4 region window in two orders (row-major, then spiral), clearing the World, Rivers and Settlements caches in between. The results must be identical, the same pattern as `world.test.ts` L74.
2. **Tier contract.** For a region, the Tier M list is identical before and after its terrain tile is computed. Tier T moves each site only within its patch (`world.cellAt(x, y, true).patch === s.patch`).
3. **Locality.** The settlements of R do not change when neighbouring regions' rivers are or are not in the cache. A spy on `Rivers.get` checks that only R is requested in variant A.
4. **Nesting and caps.**
   - Every town, county town and city is also a village.
   - At most 1 town and 3 market villages per zone.
   - At most 1 city and 3 county towns per region.
   - Every region with `P_region × a ≥ τ_c` has exactly one city.
5. **Spacing.** Within a region: towns ≥ r₄ apart, market centres ≥ r₃, county towns and the city ≥ r₅. Across a window: towns ≥ 1 × `patch.size` apart and cities ≥ 3 × `patch.size`.
6. **Geography sanity**, on the frozen baseline:
   - At least 60 % of cities have X > 0 (coast, navigable river or confluence) (BB, HSSW).
   - No village where W = 0 or C = 0.
   - Village density is higher in temperate forest than in taiga.
7. **Rank-size.** On an 8 × 8 region window, the OLS slope of log pop on log rank for orders ≥ 3 lies in [−1.4, −0.8].
8. **Feature detectors on synthetic rivers.** A hand-built `RegionRivers` with a known mouth, a two-branch confluence and a slope step must yield those features in the right patches.
9. **Fingerprint.** A settlement fingerprint over a fixed window (`fingerprint` in `shared/core/hash.ts` L134), pinned to the baseline.
10. **Bit-exactness lint.** `settlements.ts` contains no `Math.exp|log|pow|sin|cos|tan|hypot|cbrt` and no `**`. Use `x * x`, `Math.sqrt` and `dexp`.

### 6.13 Bit-exactness notes found while reading the code

These are not part of the settlement design, but they affect anything that reads these fields.

- `climate.ts` L52–57 (`fieldAt`, log-scale fields such as precipitation) uses `Math.log` and `Math.exp`. ECMA-262 calls both "implementation-approximated" (criterion C4, `heightmap-from-biomes-and-rivers.md`). `dlog` and `dexp` in `shared/core/dmath.ts` would make the precipitation field bit-exact. Precipitation feeds W, K and m.
- `world.ts` L333 (`trace`) uses `Math.hypot`, and `rivers.ts` uses `** 2` (L418, L524, L554, L595, L816). Neither is guaranteed bit-exact by the spec, though results agree in practice in current engines [unverified]. `Math.sqrt(dx * dx + dy * dy)` and `x * x` are exact.

### 6.14 Open questions

1. **Estimated vs exact biome.** Tier M scores with the zone-type typical height (§6.1). How often does that change a patch's belt or moisture class at the baseline? Two possible fixes: (a) a cheap height estimate that does not need the tile (bed heights + hillslope × distance to the river, from `bed()`), or (b) accept it and show both in the inspector.
2. **Rivers at zoomed-out views.** Tier M needs `rivers.get` and `bed()` for every region in view. Is that affordable at the farthest zoom, or should cities appear only below some zoom level?
3. **Variant A vs B** for cross-border town spacing (§6.5). Is the depth-1 relaxation visible on the map?
4. **Navigability thresholds.** A_nav and A_big are in patch counts. Should they scale with precipitation (runoff), so desert rivers are not navigable at the same drainage area?
5. **Pass towns** need two regions' heights. Is a Tier T flag enough, or should passes feed the travel graph (§6.8) as cheap land edges?
6. **Christaller series.** Should the order names follow the 4 km series (used here) or the 7 km series (§2.5)? This only affects labels and r₃ defaults.
7. **Resource coupling.** When the game layer exists, K becomes Σ potentials × yields. Should salt or iron access (`game-resources-and-trade.md` §5.5 rules 1–2) add to X, as a "salt road" town term?
8. **Factions.** Zones are "also meant for factions" (`README.md`). Should the county towns (order 5) seed faction capitals?

---

## 7. Quick reference

| Map situation | Expected settlement |
|---|---|
| River mouth of a large river (aMouth ≥ A_big) on a sheltered bay | Gateway **city** (X ≈ 1.6) |
| Navigable river leaving hills into a lowland | Fall-line or head-of-navigation **town**, often a county town |
| Confluence of two navigable rivers in a lowland | **Town**, defensive spur; city if central |
| Temperate forest or grassland plain, no big river | Dense **villages**, market villages every ~10 km, a town per zone; city by centrality |
| Mountains and hills | Sparse villages along rivers; towns at valley mouths; rarely a city |
| Dry steppe, no river | Herder camps (`sparse`), seasonal fairs, no towns |
| Desert river | Linear oasis **villages** along the river (irrigation term); town at the mouth or head |
| Taiga, tundra | Few villages, on rivers and coasts only |

| Constant | Default | From |
|---|---|---|
| Spacing per order (K = 4) | 8 / 16 / 32 / 64 / 128 km | CHEN, KING; repo sizes |
| NMS radius | 0.6 × spacing (r₃ ≈ 9.6 km, r₄ ≈ 19 km, r₅ ≈ 38 km) | Bracton 10.7 km (BLACK); BB 20 km |
| Border depth, town / city | 1 / 2 patch steps | §5.3 |
| Urban share per order *a* | 0.035 (≈ 11 % urban in total) | BB, DEV |
| Rank-size target | slope magnitude 0.8–1.4 | GAB, SOO, AUER |

---

## 8. Sources

### 8.1 Geography, economics and archaeology

- **VFH** — C. Vita-Finzi, E. S. Higgs (with Sturdy, Harriss, Legge, Tippett), "Prehistoric economy in the Mount Carmel area of Palestine: site catchment analysis", *Proceedings of the Prehistoric Society* 36:1–37, 1970, doi:10.1017/S0079497X00013074. Abstract read at https://www.cambridge.org/core/journals/proceedings-of-the-prehistoric-society/article/prehistoric-economy-in-the-mount-carmel-area-of-palestine-site-catchment-analysis/7AFF7937750FF5D3377D6600E3A86173 **[partially verified: radii from secondary sources]**
- **CHIS** — M. Chisholm, *Rural Settlement and Land Use*, Hutchinson, 1962 **[unverified]**
- **COOL** — C. H. Cooley, "The Theory of Transportation", *Publications of the American Economic Association* 9, 1894, §X p. 76, summary p. 82. https://brocku.ca/MeadProject/Cooley/Cooley_1894.html
- **VANCE** — J. E. Vance Jr., *The Merchant's World: The Geography of Wholesaling*, Prentice-Hall, 1970 **[partially verified]**
- **BURG** — A. F. Burghardt, "A hypothesis about gateway cities", *Annals of the AAG* 61(2):269–285, 1971, doi:10.1111/j.1467-8306.1971.tb00782.x **[partially verified: abstract]**
- **BL** — H. Bleakley, J. Lin, "Portage and Path Dependence", *QJE* 127(2):587–644, 2012, doi:10.1093/qje/qjs011, pp. 588–589, eq. 1 p. 606, Table I p. 607. https://personal.lse.ac.uk/sturmd/brixen/pdf/Bleakley-Lin-QJE-2012.pdf
- **BB** — M. Bosker, E. Buringh, "City seeds: Geography and the origins of the European city system", *J. Urban Economics* 98:139–157, 2017, doi:10.1016/j.jue.2015.09.003. Read in the 2012 AEA conference version, Table 1 and fn. 1, 26: http://www.aeaweb.org/conference/2012/retrieve.php?pdfid=203 **[partially verified: journal version not read]**
- **HSSW** — J. V. Henderson, T. Squires, A. Storeygard, D. Weil, "The global distribution of economic activity: nature, history, and the role of trade", *QJE* 133(1):357–406, 2018, doi:10.1093/qje/qjx030, Table II. Accepted manuscript: https://researchonline.lse.ac.uk/id/eprint/79709/1/Henderson_Global%20distribution_2017.pdf
- **MFM** — M. Motamed, R. Florax, W. Masters, "Agriculture, transportation and the timing of urbanization: global analysis at the grid cell level", *J. Economic Growth* 19(3):339–368, 2014, doi:10.1007/s10887-014-9104-x. https://econpapers.repec.org/paper/tinwpaper/20140002.htm **[partially verified: abstract]**
- **CHR** — W. Christaller, *Die zentralen Orte in Süddeutschland*, 1933; trans. C. W. Baskin, *Central Places in Southern Germany*, 1966. Via Rodrigue, *The Geography of Transport Systems* (6th ed., 2024), https://transportgeography.org/contents/chapter2/transport-and-spatial-organization/central-places-theory-urban-system/ **[partially verified: original not read]**
- **KING** — L. J. King, *Central Place Theory*, Sage 1984 (WVU Research Repository reprint 2020), Table 3.1 pp. 22–23, §3.1.6–3.1.7, §3.2 pp. 29–30. https://researchrepository.wvu.edu/cgi/viewcontent.cgi?article=1007&context=rri-web-book
- **CHEN** — Y. Chen, "Fractal systems of central places based on intermittency of space-filling", arXiv:1105.0589, Table 1 (after Christaller 1966). https://arxiv.org/abs/1105.0589 **[partially verified: reproduces Christaller]**
- **VRI** — I. Vrišer, *Geografski vestnik* 39:143–155, 1967, pp. 143–144 (in Slovene). https://zgs.zrc-sazu.si/Portals/8/Geografski_vestnik/Pred1999/GV_3901_143_155.pdf
- **LOSCH** — A. Lösch, *Die räumliche Ordnung der Wirtschaft*, 1940; trans. *The Economics of Location*, 1954. Via KING §3.2 **[partially verified]**
- **SKIN** — G. W. Skinner, "Marketing and Social Structure in Rural China, Part I", *J. Asian Studies* 24(1):3–43, 1964, doi:10.2307/2050412; footnotes 19, 68, 69 read. **CSISS** — Corbett & Rebich, CSISS Classics, 2004, https://escholarship.org/content/qt51x4g3qh/qt51x4g3qh.pdf **[partially verified: body text not read]**
- **BLACK** — W. Blackstone, *Commentaries on the Laws of England*, bk. 3 ch. 13, pp. 218–219 (Bracton's market distance, Hale's 20-mile *dieta*). https://avalon.law.yale.edu/18th_century/blackstone_bk3ch13.asp
- **AUER** — F. Auerbach, "Das Gesetz der Bevölkerungskonzentration", *Petermanns Geographische Mitteilungen* 59:74–76, 1913. Read in A. Ciccone's translation (2021): https://www.vwl.uni-mannheim.de/media/Lehrstuehle/vwl/Ciccone/auerbach_1913_translation_march2021.pdf
- **ZIPF** — G. K. Zipf, *Human Behavior and the Principle of Least Effort*, Addison-Wesley, 1949 **[unverified]**
- **GAB** — X. Gabaix, "Zipf's Law for Cities: An Explanation", *QJE* 114(3):739–767, 1999, doi:10.1162/003355399556133. https://academic.oup.com/qje/article/114/3/739/1848099 (abstract)
- **SOO** — K. T. Soo, "Zipf's Law for Cities: A Cross Country Investigation", CEP DP 641, 2004 (journal: *Regional Science and Urban Economics*, 2005). https://researchonline.lse.ac.uk/id/eprint/19947/
- **BAILEY** — K. A. Bailey, "The population of Buckinghamshire in 1086", *Records of Buckinghamshire* 42, pp. 1–2. https://archaeologydataservice.ac.uk/catalogue/adsdata/arch-6172-1/dissemination/Records_42/rob_42_0_1.pdf
- **DEV** — J. de Vries, *European Urbanization 1500–1800*, 1984, p. 45 **[partially verified: secondary]**
- **BIN** — L. R. Binford, *Constructing Frames of Reference*, 2001 **[partially verified: review snippet]**
- **BRIT-FL** — *Encyclopaedia Britannica*, "Fall line". https://www.britannica.com/science/fall-line

### 8.2 Methods

- **MAL** — J. Malczewski, "GIS-based land-use suitability analysis: a critical overview", *Progress in Planning* 62(1):3–65, 2004, doi:10.1016/j.progress.2003.09.002 **[partially verified: text blocked]**
- **VW** — P. Verhagen, T. G. Whitley, "Integrating archaeological theory and predictive modeling: a live report from the scene", *J. Archaeological Method and Theory*, doi:10.1007/s10816-011-9102-7 (records disagree: 18:1–52 online 2011, or 19(1):49–100, 2012). Abstract: https://research.vu.nl/en/publications/integrating-archaeological-theory-and-predictive-modeling-a-live- **[partially verified]**
- **TOB** — W. Tobler, "Three presentations on geographical analysis and modeling", NCGIA Technical Report 93-1, 1993, Fig. II, PDF p. 4. https://escholarship.org/content/qt05r820mz/qt05r820mz.pdf
- **NAI** — W. W. Naismith, *Scottish Mountaineering Club Journal* 2(3):136, 1892 **[partially verified: via Wikipedia "Naismith's rule"]**
- **LANG** — E. Langmuir, *Mountaincraft and Leadership*, 1984 **[partially verified: via Wikipedia]**
- **HAN** — W. G. Hansen, "How accessibility shapes land use", *J. American Institute of Planners* 25(2):73–76, 1959, doi:10.1080/01944365908978307 **[partially verified: general form]**
- **REI** — W. J. Reilly, *The Law of Retail Gravitation*, 1931; P. D. Converse, *J. Marketing* 14(3):379–384, 1949 **[partially verified]**
- **HUFF** — D. L. Huff, "A probabilistic analysis of shopping center trade areas", *Land Economics* 39(1):81–90, 1963, doi:10.2307/3144521 **[partially verified]**
- **REN** — C. D. Rennó et al., "HAND, a new terrain descriptor using SRTM-DEM", *Remote Sensing of Environment* 112(9):3469–3481, 2008, doi:10.1016/j.rse.2008.03.018 **[partially verified: abstract]**
- **NOB** — A. D. Nobre et al., "Height Above the Nearest Drainage – a hydrologically relevant new terrain model", *J. Hydrology* 404:13–29, 2011, doi:10.1016/j.jhydrol.2011.03.051. Thresholds via the GRASS `r.hand` manual: https://grass.osgeo.org/grass86/manuals/addons/r.hand.html **[partially verified]**
- **EMI** — A. Emilien, A. Bernhardt, A. Peytavie, M.-P. Cani, E. Galin, "Procedural Generation of Villages on Arbitrary Terrains", *The Visual Computer* 28:809–818, 2012, §4 pp. 4–5. https://perso.liris.cnrs.fr/egalin/Articles/2012-villages.pdf

### 8.3 Generators and games (code read)

- **AZ** — Azgaar, *Fantasy Map Generator*:
  - `src/model/society/population-generator.ts` L9–67: https://github.com/Azgaar/Fantasy-Map-Generator/blob/4b34afc50a9797ed343f19f71bd15967a8254ccc/src/model/society/population-generator.ts#L9-L67
  - `src/model/political/burgs-generator.ts` L84–200, L261–323, L396–405: https://github.com/Azgaar/Fantasy-Map-Generator/blob/4b34afc50a9797ed343f19f71bd15967a8254ccc/src/model/political/burgs-generator.ts#L84-L200
  - `src/model/physical/features-generator.ts` L161–167 and `biomes-generator.ts` L25–140 (same commit)
  - Legacy `main.js` L1173–1212: https://github.com/Azgaar/Fantasy-Map-Generator/blob/c04fb2bfcae07b16829f26b5ecfc0b35004921e7/main.js#L1173-L1212
  - Legacy `modules/burgs-and-states.js` L26–190: https://github.com/Azgaar/Fantasy-Map-Generator/blob/c04fb2bfcae07b16829f26b5ecfc0b35004921e7/modules/burgs-and-states.js#L26-L190
- **OL** — M. O'Leary, `mewo2/terrain`, `terrain.js` L149–155, L478–507, L1065–1066: https://github.com/mewo2/terrain/blob/a2511d6b673ae92f5983f3343365ba9326c03b63/terrain.js#L478-L507
- **CIV5** — Firaxis, *Civilization V* SDK 1.0.3.144 (Gedemon/Civ5-DLL), `CvGameCoreDLL_Expansion2/CvSiteEvaluationClasses.cpp` L38–45, L147–173, L272–705, L737–842, L1011–1052: https://github.com/Gedemon/Civ5-DLL/blob/aa29e80751f541ae04858b6d2a2c7dcca454201e/CvGameCoreDLL_Expansion2/CvSiteEvaluationClasses.cpp#L272-L705. The value of `NUM_CITY_RINGS` was not checked.
- **CIV4** — Firaxis, *Civilization IV: Beyond the Sword* SDK (dguenms/beyond-the-sword-sdk), `CvGameCoreDLL/CvPlayerAI.cpp` `AI_foundValue` L1588–2491: https://github.com/dguenms/beyond-the-sword-sdk/blob/3c14d26e21e6e335a19af00fc2c0d7acf207fd14/CvGameCoreDLL/CvPlayerAI.cpp#L1588-L2491
- **URR** — M. Johnson, "Ultima Ratio Regum: Territory Generation", IndieDB, 22 Dec 2012. https://www.indiedb.com/news/ultima-ratio-regum-territory-generation **[partially verified]**
- **HDA** — S. Turner, *Here Dragons Abound*, "City Symbols (Part 9): Using City Icons on a Map", Jan 2018. https://heredragonsabound.blogspot.com/2018/01/city-symbols-part-9-using-city-icons-on.html
- **RBG** — A. Patel, Red Blob Games, mapgen4. https://www.redblobgames.com/maps/mapgen4/

### 8.4 Repository

- `sandboxes/sandbox4/src/world/{world,zones,climate,biomes,rivers,terrain,terrain.worker}.ts`, `shared/core/{dmath,hash,heap}.ts`, `sandboxes/sandbox4/tests/{fixture,world.test,terrain.test}.ts`, `sandboxes/sandbox4/defaults.json`, `README.md`, at commit `b94e28d` (lines as in the code table).
- `docs/research/game-resources-and-trade.md` (§4.2 mode costs, §5.4 hierarchy, §5.5 thrive, §5.7 price and flow models, §5.8 generation order), `docs/research/patch-resources.md` (§7.1 potentials and trapezoid, §7.3 geology), `docs/research/biomes-and-climate.md` (bit-exactness), `docs/research/heightmap-from-biomes-and-rivers.md` (criterion C4).

### 8.5 Not accessible on the research date

- **Full texts.**
  - Vita-Finzi & Higgs 1970 (Cambridge; the catchment radii come from secondary sources).
  - Chisholm 1962 (archive.org lending only).
  - Skinner 1964 body text (only abstract and footnotes).
  - Bosker & Buringh 2017 journal version and CEPR DP 8066 (HTTP 403).
  - Motamed et al. 2014 PDF (over the fetch size limit).
  - Malczewski 2004 (ScienceDirect 403).
  - Verhagen & Whitley (403).
  - Hansen 1959 and his MIT thesis (429).
  - Rennó 2008 and Nobre 2011 (abstracts only; the INPE HAND site did not resolve).
  - The Bracton translation on the Ames Foundation site (offline).
- **Books.** Christaller/Baskin, Lösch, Vance, Zipf, de Vries, Bairoch, Binford, Kelly and Langmuir were not read. Neither were the originals of Reilly, Converse, Huff and Burghardt, or Kvamme's predictive-modelling chapters.
- **Christaller distances.** The conflict between the 4 km series and the 7 km series (§2.5) could not be settled against Baskin's translation.
- **Dwarf Fortress.** The DF Wiki and its mirror returned HTTP 429. No first-hand Tarn Adams description of site placement was found in the Game Developer interviews read (2008 "The Making of Dwarf Fortress"; 2016 "Figuring out how to simulate the universe").
- **Other generators.** No Here Dragons Abound post on choosing city sites, no Songs of Syx placement documentation, and no Red Blob Games settlement article was found. The Stanford-hosted polygon-map page timed out.
- **Not inspected.** The Community-Patch-DLL (Vox Populi) version of the Civ V evaluator. The values of Civ V `NUM_CITY_RINGS` and Civ IV `CITY_PLOTS_RADIUS`.
- **Not found in the sources read.** Pre-industrial densities for pastoral, irrigated and wet-rice farming; ORBIS per-mode daily speeds.
