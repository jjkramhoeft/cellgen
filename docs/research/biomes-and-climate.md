# Biomes and Climate: Temperature, Moisture and Elevation

*Research date: 2026-11-08. Scope: which biomes the main classification schemes recognise, which climate variables and numeric thresholds define them, how temperature and moisture act together (and why aridity matters more than raw rainfall or relative humidity), how elevation changes temperature, treeline and precipitation, and which other drivers decide where climate alone does not. The goal is a reference for mapping the climate fields of `sandboxes/sandbox4` (temperature and humidity, added in commit `eaafe81` "climate init"), plus elevation, to biomes. The infinite, lazily evaluated, bit-exact map constrains the design notes in §7.*

**How to read the citations**

- Each claim cites the source that owns it: paper plus section, table, figure or page, or repo plus file and lines. Primary sources were read directly unless noted.
- **[unverified]** means the claim is general or bibliographic knowledge that was not checked against the primary text in this pass.
- **[partially verified]** means the primary source exists and is cited, but only part of the claim was confirmed, for example from an abstract, a search-index copy of it, or a secondary source that reproduces it.
- Page numbers for Holdridge 1967 are **PDF pages** of the INGEMMET library copy (the revised edition with Tosi's photographic supplement), not printed page numbers.
- Primary texts that could not be read on the research date:
  - Whittaker 1975 (*Communities and Ecosystems*, 2nd ed.) and Ricklefs 2008 (*The Economy of Nature*, Fig. 5.5): books, not online. The Whittaker diagram is cited through the `plotbiomes` digitisation of Ricklefs' Fig. 5.5 (§2.1).
  - Köppen 1936: cited through Peel et al. 2007 and Beck et al. 2018, who both state their rules follow it.
  - Holdridge 1947 (*Science* 105:367): not read. The 1967 book, which supersedes it, was read in full.
  - Olson et al. 2001 (*BioScience* 51:933): paywalled. The 14-biome list is taken from Dinerstein et al. 2017, which uses the same biomes.
  - Körner & Paulsen 2004, Paulsen & Körner 2014, Minder et al. 2010, Rolland 2003: only abstracts (repository or search-index copies).
  - ICAO Doc 7488 and ISO 2533: not read. The standard atmosphere is cited from the *U.S. Standard Atmosphere, 1976*, Table 4, which the NASA record says is identical to them in the troposphere.
  - UNEP 1997, *World Atlas of Desertification*: not read. The aridity classes are cited through Zomer et al. 2022.
- Text marked "Design note" is my own engineering judgement, not a sourced claim.

**Implementation status** (added later; the code table below is the state at `eaafe81`, before any biome code). At commit `397f779`, `sandboxes/sandbox4/src/world/biomes.ts` implements §7.3's "aridity × thermal belt" table with precipitation in mm/yr (the humidity field was replaced), the lapse-rate step of §7.2 as a configurable cooling spline, and one azonal override of §7.2 step 6: **mangrove** (commit `dc52798`). It differs from the step-6 wording in three ways: there is no seasonality field, so it tests the annual mean T ≥ 20 °C (`bio.mangroveT`) instead of T_cold ≥ 18 °C; it also needs m ≥ 0.5 (`bio.mangroveM`), so desert coasts stay bare; and it is limited to flat and lowland elevation zones. "Coastal" means one of the subbiome's cells borders an ocean subbiome. **Lakes** (the WWF "Lake" code, §2.4) are not a biome: `lakes.ts` (commit `4766597`) places them as polygons on the rivers, outside deserts, mountains and river-poor flat zones. The other overrides (alpine, flooded grassland, savanna-or-forest by fire) are not implemented.

**Code locations used below** (working tree at commit `eaafe81`)

| Hook | File, lines | What it gives a biome pass |
|---|---|---|
| Climate model | `src/world/climate.ts` L1–6, L60–78 | `temperatureAt(x, y)` in **°C** and `humidityAt(x, y)` as **relative humidity, %**. Each is an fBm of classic Perlin noise stretched to [min, max]. Both are "pure functions of the seed, the parameters and the point (metres)" and do not depend on the map yet. |
| Field mapping | `src/world/climate.ts` L29–45 | `NOISE_EXTREME = 0.8`. Values beyond it are clamped, so min and max are reached only at about the 0.3 % strongest lows and highs. |
| Defaults | `defaults.json` L71–82 | Temperature: feature size 110 km, 2 octaves, −10 to 30 °C. Humidity: 80 km, 2 octaves, 25 to 95 %. |
| Parameter ranges | `src/params.ts` L335–376 | Feature size 20–4000 km; temperature −60 to 60 °C; humidity 0–100 %. |
| Tests | `tests/climate.test.ts` | Defaults reach ≈ −10…30 °C and 25…95 %; means 5–15 °C and 52–68 %; the two fields are nearly uncorrelated (abs. r < 0.3). |
| Biome hook | `src/world/zones.ts` L7 | "Biomes are not modelled yet: they need temperature and humidity, which come later." Today's zone types (ocean, flat, lowland, hills, mountains) are relief classes, not biomes. |
| Height | `src/world/terrain.ts` L1–35 | Heights in metres, per tile, fitted to rivers. Includes a floodplain whose half-width follows the bed height. |
| Noise | `shared/core/noise.ts` L85–104, L136–139 | `perlin2` and `perlinFbm`: arithmetic, `Math.floor` and `Math.SQRT2` only. |
| Bit-exactness rule | `docs/research/heightmap-from-biomes-and-rivers.md`, criterion C4 | Only IEEE `+ − × ÷ √`. `Math.exp` is "implementation-approximated" in ECMA-262 §21.3.2.14, so exp-, log- and trig-based kernels are out. |

---

## 1. Overview

A biome is a large-scale vegetation formation, such as tropical rainforest, savanna, boreal forest or tundra. Every major scheme agrees on four points:

1. **Heat** and **water** come first. Every scheme below uses a temperature variable and a precipitation variable. Holdridge adds their ratio as a third axis.
2. **Water availability is relative to evaporative demand.** The same annual rainfall is "wet" in the cold and "arid" in the heat. Holdridge calls this humidity and measures it with the potential evapotranspiration ratio (§2.2). Köppen's dryness threshold rises with temperature (§2.3). The modern aridity index is P / PET (§3.2).
3. **Elevation acts like latitude.** Temperature drops about 5–6.5 °C per km (§4.1), so mountains carry a compressed version of the pole-to-equator sequence (§4.2). Holdridge uses the same temperature guide lines for latitudinal regions and altitudinal belts.
4. **Climate does not decide everything.** In a wide band of intermediate rainfall, fire decides between savanna and forest (§5.3). Soil, flooding and salt water create azonal biomes such as mangroves and flooded grasslands (§2.4).

The schemes differ in their inputs:

| Scheme | Inputs | Output | Thresholds |
|---|---|---|---|
| Whittaker (1975, via Ricklefs 2008) | Mean annual temperature (°C), mean annual precipitation (cm) | 9 biomes | Polygons on a 2-D chart, no formulas |
| Holdridge (1947, 1967) | Mean annual **biotemperature**, annual precipitation, **PET ratio**, plus elevation to pick the belt | 38 named hexagons in the basal chart (about 120 counting altitudinal belts) | Logarithmic guide lines (powers of 2) |
| Köppen–Geiger (1936; Peel 2007; Beck 2018) | **Monthly** temperature and precipitation | 5 main classes, 30 types | Explicit inequalities |
| WWF / Olson 2001 (RESOLVE 2017) | Expert-mapped ecoregions | 14 biomes, 846–867 ecoregions | None. Vegetation-defined, not climate-defined |
| IUCN Global Ecosystem Typology (Keith 2022) | Ecological drivers (water, temperature, seasonality, fire, nutrients) | 7 terrestrial biomes, 28 terrestrial functional groups | None. Process-defined |

---

## 2. Classification schemes and their biome lists

### 2.1 Whittaker biome diagram (mean annual temperature × precipitation)

- **Source chain:** Whittaker's biome diagram appeared in *Communities and Ecosystems* (1970; revised 1975) **[unverified: the book was not read]**. The version most often reproduced is Ricklefs 2008, *The Economy of Nature*, Fig. 5.5. The `plotbiomes` R package digitised that figure into polygons: "Digitized from Figure 5.5 in Ricklefs, R. E. (2008)" ([plotbiomes `R/data.R`](https://github.com/valentinitnelav/plotbiomes/blob/master/R/data.R)).
- **Axes:** mean annual temperature (°C) and mean annual precipitation (cm). The digitised chart spans −10 to 30 °C and 0 to 400 cm on its grid ([plotbiomes `html/Whittaker_biomes_dataset.Rmd`](https://github.com/valentinitnelav/plotbiomes/blob/master/html/Whittaker_biomes_dataset.Rmd), section "Convert coordinates").
- **Biome list (9):** the same Rmd ("Assigns the biome names") lists Tundra, Boreal forest, Temperate seasonal forest, Temperate rain forest, Tropical rain forest, Tropical seasonal forest/savanna, Subtropical desert, Temperate grassland/desert, and Woodland/shrubland.
- **Bounding boxes:** I parsed `data/Whittaker_biomes.rda` (775 polygon vertices). The table gives each polygon's extent; it is not a set of exact limits.

| Biome | MAT range (°C) | MAP range (cm) |
|---|---|---|
| Tundra | −15.6 to −4.1 | 1.6 to 108 |
| Boreal forest | −6.7 to 4.4 | 19 to 201 |
| Temperate grassland/desert | −10.2 to 17.9 | 0 to 53 |
| Woodland/shrubland | −10.2 to 19.1 | 1.6 to 126 |
| Temperate seasonal forest | −0.7 to 19.2 | 38 to 235 |
| Temperate rain forest | 3.2 to 20.6 | 161 to 343 |
| Tropical seasonal forest/savanna | 17.9 to 29.6 | 53 to 281 |
| Tropical rain forest | 19.2 to 28.5 | 235 to 444 |
| Subtropical desert | 14.1 to 30.0 | 0 to 100 |

**Lookup grid derived from the polygons.** This table is my own rasterisation, not a published table: a point-in-polygon test on the `plotbiomes` vertices at each grid point. No grid point fell in two polygons; "·" means outside every polygon. The chart is triangular: no climate on Earth is both very cold and very wet.

Codes: TU tundra, BF boreal forest, TS temperate seasonal forest, TR temperate rain forest, RF tropical rain forest, SS tropical seasonal forest/savanna, WS woodland/shrubland, GD temperate grassland/desert, SD subtropical desert.

| P (cm) \ T (°C) | −14 | −12 | −10 | −8 | −6 | −4 | −2 | 0 | 2 | 4 | 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20 | 22 | 24 | 26 | 28 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 425 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | RF | RF | · |
| 350 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | RF | RF | RF | · |
| 300 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | TR | RF | RF | RF | RF | RF |
| 275 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | TR | TR | TR | RF | RF | RF | RF | RF |
| 250 | · | · | · | · | · | · | · | · | · | · | · | · | · | TR | TR | TR | TR | RF | RF | RF | SS | SS |
| 225 | · | · | · | · | · | · | · | · | · | · | · | TR | TR | TR | TR | TS | TS | SS | SS | SS | SS | SS |
| 200 | · | · | · | · | · | · | · | · | · | · | TR | TS | TS | TS | TS | TS | TS | SS | SS | SS | SS | SS |
| 175 | · | · | · | · | · | · | · | · | BF | TS | TS | TS | TS | TS | TS | TS | TS | SS | SS | SS | SS | SS |
| 150 | · | · | · | · | · | · | · | BF | BF | TS | TS | TS | TS | TS | TS | TS | TS | SS | SS | SS | SS | SS |
| 125 | · | · | · | · | · | · | BF | BF | BF | TS | TS | TS | TS | TS | TS | TS | TS | SS | SS | SS | SS | SS |
| 100 | · | · | · | · | · | BF | BF | BF | BF | TS | TS | TS | TS | WS | WS | WS | WS | SS | SS | SS | SS | SS |
| 75 | · | · | · | · | TU | BF | BF | BF | BF | TS | TS | WS | WS | WS | WS | WS | WS | SS | SS | SS | SS | SD |
| 50 | · | · | · | TU | TU | BF | BF | BF | TS | WS | WS | WS | WS | WS | WS | WS | SD | SD | SD | SD | SD | SD |
| 25 | · | TU | TU | TU | BF | WS | WS | WS | GD | GD | GD | GD | GD | GD | GD | GD | SD | SD | SD | SD | SD | SD |
| 10 | TU | TU | TU | WS | GD | GD | GD | GD | GD | GD | GD | GD | GD | GD | GD | SD | SD | SD | SD | SD | SD | SD |

**Caveats**

- Whittaker marked a zone where grassland, shrubland or woodland can each prevail depending on soil, fire and seasonality **[unverified: commonly reported, but the 1975 caption was not read]**. That zone is the WS band, between GD below and the forests above. It is the same climate-indeterminate zone that §5.3 quantifies for savanna versus forest.
- The `plotbiomes` author notes digitisation artefacts: overlapping neighbours, fixed by hand in QGIS (Rmd section "Fix overlaps").
- The chart uses annual means only. It cannot tell a Mediterranean (winter-wet) climate from a summer-wet one with the same totals.

### 2.2 Holdridge life zones (biotemperature, precipitation, PET ratio)

All of §2.2 is from Holdridge 1967, *Life Zone Ecology*, revised edition, Tropical Science Center, San José ([INGEMMET copy](https://app.ingemmet.gob.pe/biblioteca/pdf/Amb-56.pdf)).

**Inputs**

- **Biotemperature:** "an average of the temperature between 0 and 30 °C relative to the total period", with temperatures below 0 and above 30 counted as zero (PDF p. 18; Chapter III "Heat", pp. 23–25).
  - In cold regions a rough value is the sum of the positive monthly means divided by 12. In the worked example, Verkhoyansk's positive months sum to 36.6, giving about 3.05 °C (p. 23–24). The precise value uses hourly readings.
  - The 30 °C cut-off was added after work on Hispaniola showed that hot lowlands carry vegetation of a cooler zone (pp. 24–25).
- **Precipitation:** mean annual total in mm (p. 30).
- **PET and PET ratio:** "the mean annual potential evapotranspiration in mm … may be determined by multiplying the mean annual biotemperature by the factor 58.93" (p. 31). The PET ratio is PET / precipitation, "a definite measure of humidity" (pp. 31–32). It increases towards drier conditions.
- **Why a ratio:** "humidity is determined by the relation of temperature to precipitation." The same precipitation is wet in the Subpolar region and arid in the lowland tropics (p. 31).

**Guide lines.** All three axes are logarithmic. Steps double because heat and water act as limiting factors, following Mitscherlich (p. 18).

| Axis | Guide-line values (Fig. 1, p. 20) |
|---|---|
| Biotemperature (°C) | 1.5, 3, 6, 12, 24 (and theoretically 48) |
| Annual precipitation (mm) | 62.5, 125, 250, 500, 1000, 2000, 4000, 8000 (16000 at the edge) |
| PET ratio | 32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125 (extended to 64 and 0.03125) |

**Regions and belts.** The same temperature guide lines bound the latitudinal regions and the altitudinal belts. Only the Tropical region can have every belt; above the Boreal basal region only Alpine and Nival occur (pp. 25–26).

| Biotemperature (°C) | Latitudinal region | Altitudinal belt | Approx. latitude band, theoretical (Table 1, p. 30) | Max. elevation range of the belt (p. 32–33) |
|---|---|---|---|---|
| 0–1.5 | Polar | Nival | 67°22.5′ to 90° | unlimited |
| 1.5–3 | Subpolar | Alpine | 63°45′ to 67°22.5′ | 250 m |
| 3–6 | Boreal | Subalpine | 56°30′ to 63°45′ | 500 m |
| 6–12 | Cool Temperate | Montane | 42° to 56°30′ | 1000 m |
| 12 to the frost line | Warm Temperate | Lower Montane | 27°30′ to 42° | 1000 m |
| Frost line to 24 | Subtropical | Premontane | 13° to 27°30′ | 1000 m |
| > 24 | Tropical | (basal) | 0° to 13° | about 1000 m |

**The frost line (critical temperature line)**

- It splits the 12–24 °C row in two. Its biotemperature "should be between 16° and 18° C" (pp. 26–27). Fig. 2 places it at about 18 °C at sea level (p. 21).
- On the warm side, most plants cannot survive frost.
- It is "tentatively defined" as the limit of the area hit by a severe killing frost at least once every three years (p. 27).
- Holdridge treats the two halves as nomenclatural sub-zones of one physiognomic set (p. 28).

**Humidity provinces** (Fig. 1 bottom axis), between PET-ratio lines:

| PET ratio | 32–16 | 16–8 | 8–4 | 4–2 | 2–1 | 1–0.5 | 0.5–0.25 | 0.25–0.125 |
|---|---|---|---|---|---|---|---|---|
| Province | Superarid | Perarid | Arid | Semiarid | Subhumid | Humid | Perhumid | Superhumid |

Extensions beyond the main chart: Semiparched (64–32), and Semisaturated, Subsaturated and Saturated below 0.125.

**Life zones in Fig. 1** (basal names, from dry to wet, read from the chart):

| Region (belt) | Life zones, dry → wet |
|---|---|
| Polar (Nival) | No hexagons (polar desert / ice) |
| Subpolar (Alpine) | Dry tundra, Moist tundra, Wet tundra, Rain tundra |
| Boreal (Subalpine) | Desert, Dry scrub, Moist forest, Wet forest, Rain forest (tropical subalpine: Puna, Páramo) |
| Cool Temperate (Montane) | Desert, Desert scrub, Steppe, Moist forest, Wet forest, Rain forest |
| Warm Temperate / Subtropical (Lower Montane / Premontane) | Desert, Desert scrub, Thorn steppe / Thorn woodland, Dry forest, Moist forest, Wet forest, Rain forest |
| Tropical | Desert, Desert scrub, Thorn woodland, Very dry forest, Dry forest, Moist forest, Wet forest, Rain forest |

**More detail from the text**

- **Count:** the three-dimensional chart "separates 120 distinct life zones", counting the Subtropical and Premontane sub-units (p. 18).
- **Transitional triangles:** each hexagon contains 6 triangles in which one of the three factors already belongs to a neighbouring zone. These are "zones of transition" (p. 33).
- **Elevation and lapse rate:** to decide basal versus altitudinal, reduce the site to sea level using "a rough equivalence of 6 °C for each 1000 meters". Worked example: 8 °C at 1200 m becomes 15.2 °C at sea level, so the site is Warm Temperate Montane, not Cool Temperate basal (p. 33). Fig. 2 is "based on average lapse rate of 6 °C per 1000 m".
- **Precipitation dominates in the tropics:** the hottest mean annual biotemperatures "scarcely exceed 27 °C" anywhere (p. 28).
- **Second-order factors** (soils, drainage, wind, mist, rainfall seasonality) split life zones into "associations". A Mediterranean or monsoon rainfall regime is an association-level property, not a life-zone property (pp. 35–36).

### 2.3 Köppen–Geiger climate classes (threshold rules)

- **Sources:** Peel, Finlayson & McMahon 2007 ([HESS 11:1633, Table 1 and §2](https://hess.copernicus.org/articles/11/1633/2007/)) give the rules. They follow Köppen 1936 except the C/D boundary: "We have followed Russell (1931) and used the temperature of the coldest month > 0 °C, rather than > −3 °C as used by Köppen" (§2).
- **Same rules in Beck 2018:** Beck et al. 2018 ([Sci. Data 5:180214](https://pmc.ncbi.nlm.nih.gov/articles/PMC6207062/), criteria table) use the same rules for their 1-km maps (1980–2016 and 2071–2100).

**Variables** (Peel Table 1 footnote)

| Symbol | Meaning |
|---|---|
| MAT, MAP | Mean annual temperature (°C) and precipitation (mm) |
| T_hot, T_cold | Mean temperature of the warmest and coldest month |
| T_mon10 | Number of months with mean temperature above 10 °C |
| P_dry | Precipitation of the driest month |
| P_sdry, P_wdry, P_swet, P_wwet | Driest and wettest month in summer and in winter. Summer is the warmer six-month half, ONDJFM or AMJJAS |
| P_th | 2·MAT if ≥ 70 % of MAP falls in winter; 2·MAT + 28 if ≥ 70 % falls in summer; otherwise 2·MAT + 14 |

**Rules.** B is tested first; A, C, D and E use temperature only and are mutually exclusive (Peel §2, p. 1637).

| Class | Rule | Subtypes |
|---|---|---|
| **B** Arid | MAP < 10·P_th | **W** desert: MAP < 5·P_th; **S** steppe: otherwise. **h**: MAT ≥ 18; **k**: MAT < 18 |
| **A** Tropical | T_cold ≥ 18 | **f** rainforest: P_dry ≥ 60; **m** monsoon: not Af and P_dry ≥ 100 − MAP/25; **w** savannah: not Af and P_dry < 100 − MAP/25 |
| **C** Temperate | T_hot > 10 and 0 < T_cold < 18 | **s**: P_sdry < 40 and P_sdry < P_wwet/3; **w**: P_wdry < P_swet/10; **f**: neither. **a**: T_hot ≥ 22; **b**: not a and T_mon10 ≥ 4; **c**: not a or b and 1 ≤ T_mon10 < 4 |
| **D** Cold | T_hot > 10 and T_cold ≤ 0 | s, w, f, a, b, c as for C; **d**: not a or b and T_cold < −38 |
| **E** Polar | T_hot ≤ 10 | **T** tundra: T_hot > 0; **F** frost (ice cap): T_hot ≤ 0 |

**Worked numbers and land shares**

- **Worked dryness threshold** (Peel §2): at MAT 19.9 °C with summer rain, the arid/non-arid line is 10·(2·19.9 + 28) = 678 mm.
  - In general, for evenly spread rain the B boundary is MAP = 20·MAT + 140 mm.
  - So 500 mm is steppe at 20 °C (threshold 540) but not arid at 10 °C (threshold 340). Temperature sets how much rain counts.
- **Global land shares** (Peel §4): B 30.2 %, D 24.6 %, A 19.0 %, C 13.4 %, E 12.8 %. The most common types are BWh (14.2 %) and Aw (11.5 %).

**Elevation**

- Peel deliberately uses no highland class (H): it "provides little information about the climate at those locations" compared with applying A–E to the local temperatures (§3, p. 1637–1638).
- In Greenland, Peel set land below 1000 m to ET and land at 1000 m or higher to EF (§3.7).
- **Design note:** the Köppen route therefore handles mountains by lowering T with the lapse rate and re-running the rules. It never adds a special class.

**Link to vegetation.** Köppen's scheme was built around vegetation boundaries. Peel notes his 1900 classification "owed much to the global vegetation" map of Grisebach (1866) (§1).

### 2.4 WWF terrestrial biomes (Olson et al. 2001; RESOLVE Ecoregions 2017)

- **Olson 2001:** Olson et al. 2001, "Terrestrial Ecoregions of the World: A New Map of Life on Earth", *BioScience* 51(11):933–938, maps **867 terrestrial ecoregions** classified into **14 biomes** ([USF repository abstract](https://digitalcommons.usf.edu/kip_articles/4884)) **[partially verified: abstract only; full text paywalled]**.
- **RESOLVE 2017:** Dinerstein et al. 2017 ([*BioScience* 67(6):534, Table 1 and Fig. 1](https://pmc.ncbi.nlm.nih.gov/articles/PMC5451287/)) revised the map to **846 ecoregions "nested within 14 terrestrial biomes"**. It differs from the original in four regions: the Arabian Peninsula, some drier African ecoregions, Antarctica and the south-eastern USA.

| # | Biome (Dinerstein 2017 Table 1) | Main climatic or non-climatic control (Design note, not from the source) |
|---|---|---|
| 1 | Tropical and subtropical moist broadleaf forests | Frost-free and humid |
| 2 | Tropical and subtropical dry broadleaf forests | Frost-free with a long dry season |
| 3 | Tropical and subtropical coniferous forests | Frost-free; mostly uplands |
| 4 | Temperate broadleaf and mixed forests | Cool to warm temperate, humid |
| 5 | Temperate conifer forests | Temperate; often montane or summer-dry |
| 6 | Boreal forests / taiga | Cold, short summers |
| 7 | Tropical and subtropical grasslands, savannas and shrublands | Frost-free, seasonal rain, **fire** |
| 8 | Temperate grasslands, savannas and shrublands | Temperate, semi-arid, continental |
| 9 | Flooded grasslands and savannas | **Hydrology** (seasonal flooding) |
| 10 | Montane grasslands and shrublands | **Elevation** (above treeline) |
| 11 | Tundra | Polar or alpine, treeless |
| 12 | Mediterranean forests, woodlands and scrub | **Seasonality**: winter rain, summer drought |
| 13 | Deserts and xeric shrublands | Arid |
| 14 | Mangroves | **Coast** (tropical intertidal) |

- **Not climate-defined:** the WWF biomes are drawn from expert-mapped vegetation, not from climate thresholds. No source gives a temperature or rainfall rule for them.
- **Azonal biomes:** three of the 14 are set by something other than macroclimate (9 flooding, 10 elevation, 14 coast).
- **Codes for rock and ice and for lakes:** the original shapefile also carries "Rock and Ice" and "Lake" codes **[unverified]**.

### 2.5 IUCN Global Ecosystem Typology (Keith et al. 2022)

- **Structure:** Keith et al. 2022 ([*Nature* 610:513, "Hierarchical levels"](https://doi.org/10.1038/s41586-022-05318-4)) define five core realms (terrestrial, freshwater, marine, subterranean, atmospheric) plus transitional realms, then **25 functional biomes** and **110 ecosystem functional groups**. Fig. 2 counts "10 Realms, 25 Biomes, 110 EFGs".
- **Drivers:** "Terrestrial functional groups are distinguished primarily by gradients in water and nutrient availability and by temperature and seasonality … Disturbance regimes, notably fire, are important global drivers in assembly of some terrestrial ecosystem functional groups."
- **Example gradient:** Fig. 3a arranges the Tropical forests biome along temperature, elevation and water-availability gradients. T1.3 montane rainforests sit at lower temperature; T1.4 heath forests split off on an edaphic (soil) gradient.
- **Not climate-only:** functional biomes are defined by "dominant assembly filters and processes … rather than the more restricted basis of climate–vegetation relationships that traditionally underpin biome definition on land."

The terrestrial biomes and their functional groups ([IUCN GET EFG list](https://red-list-ecosystem.github.io/typology-map-info/efg-info.html)):

| Biome | Functional groups |
|---|---|
| **T1** Tropical-subtropical forests | T1.1 lowland rainforests; T1.2 dry forests and thickets; T1.3 montane rainforests; T1.4 heath forests |
| **T2** Temperate-boreal forests and woodlands | T2.1 boreal and temperate high-montane forests; T2.2 deciduous temperate forests; T2.3 oceanic cool temperate rainforests; T2.4 warm temperate laurophyll forests; T2.5 temperate pyric humid forests; T2.6 temperate pyric sclerophyll forests and woodlands |
| **T3** Shrublands and shrubby woodlands | T3.1 seasonally dry tropical shrublands; T3.2 seasonally dry temperate heath and shrublands; T3.3 cool temperate heathlands; T3.4 young rocky pavements, lava flows and screes |
| **T4** Savannas and grasslands | T4.1 trophic savannas; T4.2 pyric tussock savannas; T4.3 hummock savannas; T4.4 temperate woodlands; T4.5 temperate subhumid grasslands |
| **T5** Deserts and semi-deserts | T5.1 semi-desert steppe; T5.2 succulent or thorny deserts; T5.3 sclerophyll hot deserts; T5.4 cool deserts; T5.5 hyper-arid deserts |
| **T6** Polar/alpine (cryogenic) | T6.1 ice sheets, glaciers, perennial snow; T6.2 polar/alpine cliffs, screes, outcrops; T6.3 polar tundra and deserts; T6.4 temperate alpine grasslands and shrublands; T6.5 tropical alpine grasslands and herbfields |
| **T7** Intensive land-use | T7.1 annual croplands; T7.2 sown pastures; T7.3 plantations; T7.4 urban and industrial; T7.5 derived semi-natural pastures |

- **Design note:** the GET names the drivers explicitly. "Pyric" (fire-driven), "seasonally dry", "oceanic" and "alpine" each correspond to a variable the generator would need beyond annual T and P.

### 2.6 How the lists line up (Design note)

The rows are approximate equivalences for a generator's palette, not a sourced crosswalk.

| Generator class | Whittaker | Holdridge (basal) | Köppen | WWF # | GET |
|---|---|---|---|---|---|
| Ice / polar desert | (off chart) | Polar | EF | (rock and ice) | T6.1, T6.3 |
| Tundra | Tundra | Subpolar dry → rain tundra | ET | 11 | T6.3 |
| Boreal forest | Boreal forest | Boreal moist → rain forest | Dfc, Dfd, Dwc | 6 | T2.1 |
| Cold steppe / desert | Temperate grassland/desert | Cool temperate desert, desert scrub, steppe | BSk, BWk | 8, 13 | T4.5, T5.1, T5.4 |
| Temperate forest | Temperate seasonal forest | Cool / warm temperate moist forest | Cfb, Dfb, Cfa | 4, 5 | T2.2, T2.4 |
| Temperate rainforest | Temperate rain forest | Cool temperate wet / rain forest | Cfb, Cfc (very wet) | 4, 5 | T2.3 |
| Mediterranean | Woodland/shrubland | Warm temperate dry forest (Mediterranean association) | Csa, Csb | 12 | T3.2, T2.6 |
| Hot desert | Subtropical desert | Subtropical / tropical desert, desert scrub | BWh | 13 | T5.2, T5.3, T5.5 |
| Savanna / dry tropical forest | Tropical seasonal forest/savanna | Tropical thorn woodland, very dry and dry forest | Aw, BSh | 2, 7 | T1.2, T4.1–T4.3 |
| Tropical rainforest | Tropical rain forest | Tropical moist, wet and rain forest | Af, Am | 1 | T1.1 |
| Montane / alpine | (via lapse rate) | Altitudinal belts | (via lapse rate) | 10 | T6.4, T6.5, T1.3 |

---

## 3. How temperature and moisture act together

### 3.1 Temperature sets the demand; precipitation is only the supply

- **Holdridge (p. 31):** "humidity is determined by the relation of temperature to precipitation". The same rainfall gives wet conditions in the Subpolar region and arid conditions in the lowland tropics.
- **Holdridge's PET is linear in biotemperature** (58.93 mm per °C), so his humidity axis is effectively P / T_bio.
- **Example:**
  - At T_bio = 3 °C, PET ≈ 177 mm. 500 mm of rain gives a PET ratio of 0.35 (perhumid), which is wet tundra or wet forest.
  - At T_bio = 24 °C, PET ≈ 1414 mm. The same 500 mm gives a ratio of 2.8 (semiarid), which is thorn woodland. This follows from Fig. 1 and the formula on p. 31.
- **Köppen's arid threshold** rises linearly with MAT (P_th = 2·MAT + 0/14/28; §2.3). That is the same idea in another form: warmer air needs more rain to stay out of class B.
- **Whittaker's chart** shows it geometrically. At 0–5 °C, about 50 cm of rain supports boreal or temperate forest; at 20–25 °C the same 50 cm is subtropical desert (§2.1 grid).

### 3.2 Aridity index (P / PET)

- **Definition:** Zomer, Xu & Trabucco 2022 ([*Sci. Data* 9:409, Eq. 20 and the class table](https://doi.org/10.1038/s41597-022-01493-1)) define the aridity index as AI = MA_Prec / MA_ET0. ET0 is FAO-56 Penman–Monteith reference evapotranspiration. "AI values are unitless, increasing with more humid condition and decreasing with more arid conditions."
- **Classes:** Zomer cites the UNEP *World Atlas of Desertification* (1997) for the scheme.

| AI (P / PET) | Class |
|---|---|
| < 0.03 | Hyper-arid |
| 0.03–0.2 | Arid |
| 0.2–0.5 | Semi-arid |
| 0.5–0.65 | Dry sub-humid |
| > 0.65 | Humid |

- **Note on the hyper-arid limit:** UNEP's own table uses 0.05 for the hyper-arid limit **[unverified: UNEP 1997 not read; Zomer prints 0.03]**.
- **Same axis, inverted:** Holdridge's PET ratio is the reciprocal, 1 / AI. His unity line (ratio 1) separates the dry and moist provinces. 19 of the 21 American capitals lie in the life zones next to it (p. 18).
- **Bit-exactness:** Penman–Monteith needs radiation, wind and vapour pressure, and Thornthwaite's PET uses a power law **[unverified]**. Both are heavier than Holdridge's linear PET; see §7.3.

### 3.3 Seasonality: when the rain falls

Annual totals hide the timing of rain. The sources use it in three ways:

- **Köppen:**
  - The subtypes s, w, f and m test the driest month against the wettest (§2.3).
  - P_th itself shifts by 28 mm between winter-rain and summer-rain regimes. Summer rain is less effective because it falls when PET is high.
- **Holdridge:** monsoon and Mediterranean regimes split life zones into associations, not separate zones (pp. 35–36).
- **Staver et al. 2011 (*Science*):** savanna–forest bistability holds where the dry season is "less than 7 months" (§5.3) **[partially verified]**.

### 3.4 "Humidity": relative humidity vs. moisture availability

- **Relative humidity (RH)** is the ratio of the air's vapour pressure e to the saturation vapour pressure e_sat. Air saturates when RH reaches 100 %.
- **e_sat depends strongly on temperature** (Clausius–Clapeyron). Roe 2005 ([*Annu. Rev. Earth Planet. Sci.* 33:645, Eq. 1](https://earthweb.ess.washington.edu/roe/GerardWeb/Publications_files/Roe_OrogPrec_AnnRev05.pdf)) gives the Bolton fit:
  - e_sat(T) = 6.112·exp(17.67·T / (T + 243.5)) mb, accurate to 0.3 % between −35 and 35 °C.
  - It roughly doubles every 10 °C **[derived from the formula]**.
- **RH is a state of the air, not a water budget.** It swings daily as temperature changes, and the same RH holds several times more water in warm air.
- **None of the biome schemes above uses RH.** They use precipitation and its ratio to PET (§3.1–3.2).
- **Implication for `climate.ts`.** The second field is documented as "relative humidity, %" (`climate.ts` L20–21; `params.ts` L356).
  - **Design note:** for biomes it is better read as an abstract **moisture index** that stands in for AI.
  - An alternative is a precipitation field in mm/yr, from which AI follows with a PET.
  - Mapping 25–95 % straight onto Whittaker's precipitation axis would ignore temperature-dependent demand, which is exactly the effect in §3.1.

---

## 4. Elevation

### 4.1 Temperature lapse rate

- **Standard atmosphere:** the *U.S. Standard Atmosphere, 1976* (NOAA-S/T 76-1562 / NASA-TM-X-74335, [NTRS](https://ntrs.nasa.gov/citations/19770009539)), Table 4 (p. 3), defines the temperature gradient from 0 to 11 km geopotential as **−6.5 K/km**. It is 0.0 K/km from 11 to 20 km.
  - The sea-level temperature is 288.15 K (15 °C) **[partially verified: quoted in the errata sheet appended to the NTRS PDF; the defining table was not read]**.
  - The NTRS record states the 1976 standard is identical to the ICAO standard up to 32 km and to ISO up to 50 km **[partially verified: search-index copy of the record]**.
- **Holdridge** uses "a rough equivalence of 6 °C for each 1000 meters" (p. 33; Fig. 2).
- **Observed near-surface lapse rates are usually smaller than 6.5 and vary by season and slope:**
  - **Cascades, USA:** annual means of 3.9–5.2 °C/km on the windward side, "substantially smaller than the often-assumed 6.5". Seasonal extremes run from 2.5–3.5 °C/km (late-summer minima) to 6.5–7.5 °C/km (spring maxima). Lee and windward sides differ substantially (Minder, Mote & Lundquist 2010, *JGR* 115:D14122, abstract) **[partially verified: search-index copy of the abstract]**.
  - **Alps (northern Italy):** yearly 5.4–5.8 °C per km, steeper in summer (Rolland 2003, *J. Climate* 16:1032, abstract) **[partially verified: search-index copy]**.
- **Dry adiabatic rate:** rising unsaturated air cools at about g/c_p ≈ 9.8 K/km. Saturated air cools more slowly because condensation releases latent heat **[unverified: textbook physics, not checked in a source here]**. This asymmetry drives the warm, dry föhn on lee slopes.

### 4.2 Altitudinal zonation mirrors latitudinal zonation

- **Holdridge (pp. 25–26, Fig. 2):** the biotemperature guide lines 1.5, 3, 6, 12 and 24 °C bound both the latitudinal regions and the altitudinal belts:

| Altitudinal belt | Latitudinal region |
|---|---|
| Premontane | Subtropical |
| Lower Montane | Warm Temperate |
| Montane | Cool Temperate |
| Subalpine | Boreal |
| Alpine | Subpolar |
| Nival | Polar |

- **Belt thickness:** at 6 °C/km the 3–6, 6–12 and 12–24 °C bands are 500, 1000 and 2000 m thick, a "logarithmic progression" (p. 28).
- **Observed belts are thicker:** "the theoretical elevational ranges tend to expand considerably at higher altitudes and especially so with increasing latitudes" (p. 29).
  - Holdridge attributes this to short plants feeling soil and rock temperature rather than air temperature measured at 1–2 m.
- **Köppen:** Peel applies the ordinary A–E rules at altitude (§2.3), so a tropical mountain passes through A → C → E (ET, EF) as T falls.
- **IUCN GET:**
  - T6.4 and T6.5 are temperate and tropical alpine grasslands above the treeline.
  - T1.3 tropical montane rainforests sit on the temperature/elevation gradient of the T1 biome (Keith 2022, Fig. 3a).

Generic belt names used in the literature (my summary of the Holdridge belts, which are the only sourced definitions here):

| Belt | Holdridge biotemperature | Vegetation |
|---|---|---|
| Colline / premontane | 18–24 °C | Lowland forest types (frost-free side) |
| Montane (lower and upper) | 6–18 °C | Montane forest |
| Subalpine | 3–6 °C | Upper forest up to the treeline |
| Alpine | 1.5–3 °C | Tundra, alpine grassland, páramo / puna |
| Nival | < 1.5 °C | Snow, ice, rock |

### 4.3 The treeline isotherm

- **Körner & Paulsen 2004** (*J. Biogeogr.* 31:713; [Basel repository abstract](https://edoc.unibas.ch/8594)) **[partially verified: abstract]**:
  - **Data:** root-zone temperatures logged hourly for 1–3 years at 46 treeline sites from 68° N to 42° S.
  - **Result:** climatic high-altitude treelines are associated with a seasonal mean ground temperature of **6.7 °C (± 0.8 SD)**. Zonal means span 2.2 K: temperate and Mediterranean 7–8 °C, equatorial 5–6 °C, subarctic and boreal 6–7 °C.
  - **What does not predict treeline:** "length of the growing season, thermal extremes or thermal sums" do not predict treeline altitude at the global scale.
  - **Exceptions:** some *Fagus*, *Nothofagus* and *Metrosideros* treelines sit at higher, genus-specific isotherms.
- **Paulsen & Körner 2014** (*Alpine Botany* 124:1; [Basel repository abstract](https://edoc.unibas.ch/33369)) **[partially verified: abstract]**:
  - **Data:** 376 treelines from satellite images.
  - **TREELIM model:** best fit when the season is all days with a daily mean above **0.9 °C**, requiring a mean of **6.4 °C** over those days and at least **94 days**.
- **Holdridge equivalent:** in Fig. 1 the Boreal row (3–6 °C) holds forests and the Subpolar row (1.5–3 °C) holds tundra. His treeline is the **3 °C biotemperature** line, the Subalpine/Alpine boundary.
- **Design note: why the two numbers differ.**
  - Körner's isotherm is a mean over the growing season only. Holdridge's biotemperature averages the whole year with sub-zero values counted as zero.
  - In an aseasonal tropical climate both are close to the annual mean. In a strongly seasonal climate the annual mean at treeline is far below 6 °C.
  - With a single annual-mean temperature field, a treeline rule therefore needs either a seasonality field or a latitude-like proxy (§7.2).

### 4.4 Orographic precipitation and rain shadows

All of §4.4 is from Roe 2005 ([*Annu. Rev. Earth Planet. Sci.* 33:645](https://earthweb.ess.washington.edu/roe/GerardWeb/Publications_files/Roe_OrogPrec_AnnRev05.pdf)).

- **Mechanism:**
  - Unsaturated air forced up terrain "will expand adiabatically as the pressure drops and cool, and eventually the vapor it contains will reach saturation" (§ on the physics, after Eq. 1).
  - The condensation rate follows the vertical velocity times the change in saturated moisture content.
  - How that condensation lands on the ground depends on airflow and microphysics. Fall speeds range from about 1 m/s for snow to about 10 m/s for heavy rain, so precipitation drifts downwind.
- **Classic picture:** "the windward flank of the mountain range receives much more precipitation than the leeward flank, resulting in the well-known rain shadow that is reflected in sharp transitions in climate, flora, and fauna across the divide" (Introduction).
- **Numbers:**
  - **Southern Alps, New Zealand:** a maximum of 11–12 m/yr about 20 km upwind of the divide, falling to under 1 m/yr over the eastern plains (Fig. 1, after Wratt et al. 2000).
  - **Hawaii:** trade winds bring 7.5 m on the north-east side. A temperature inversion caps the moist layer, so the 4000 m peaks of Mauna Loa and Mauna Kea get under 50 cm/yr (Introduction).
- **Where the maximum falls:** "for large mountain ranges, precipitation maximizes over windward slopes, whereas for smaller hills the maximum tends to occur nearer the crest" (Summary). The Alps example has no clear rain shadow: the north and south flanks are about equal and roughly twice the interior (Fig. 2 discussion).
- **Rain shadow is robust:** "one of the most confident expectations in atmospheric science". Its amplitude and small-scale structure are still active research (Summary).
- **Models:** simple diagnostic upslope models "are generally able to achieve a good match with observed precipitation rates at the scale of tens of kilometers" with tuned parameters (modelling section).
- **Design note: the mountain wet belt.** Precipitation rising with height on windward slopes, together with temperature falling, makes mountains wetter in Holdridge terms. The PET ratio falls on both counts, which is why tropical montane belts are often wet or rain forest (Fig. 1 upper rows).

---

## 5. Other drivers worth modelling

### 5.1 Latitude and insolation

- Annual mean temperature falls from the equator to the poles because of insolation **[unverified: general knowledge]**.
- **Holdridge's Table 1 (p. 30)** puts the theoretical latitude bands at:

| Region | Latitude | Biotemperature |
|---|---|---|
| Tropical | 0–13° | above 24 °C |
| Subtropical | 13–27.5° | |
| Warm Temperate | 27.5–42° | down to 12 °C |
| Cool Temperate | 42–56.5° | down to 6 °C |
| Boreal | 56.5–63.75° | down to 3 °C |
| Subpolar | 63.75–67.4° | |
| Polar | above 67.4° | |

- **Design note:** that implies roughly 0.4 °C of biotemperature per degree of latitude (24 → 12 °C over 29°, 12 → 6 °C over 14.5°), about 0.004 °C per km.
- **Regional widths are irregular:** Holdridge stresses they are shaped by continents, ocean currents and mountain ranges relative to winds (p. 29).
- **Day length, seasonal radiation and pressure** vary with latitude and elevation. Holdridge treats them as correlated with biotemperature and elevation, not as extra chart axes (p. 22).

### 5.2 Continentality

- Distance from the sea raises the annual temperature range and usually lowers precipitation **[unverified: general knowledge; not checked in a primary source here]**.
- **Köppen** captures it through T_cold and T_hot: D climates (T_cold ≤ 0) and the d subtype (T_cold < −38) are continental (§2.3).
- **Holdridge's biotemperature** captures it indirectly: Verkhoyansk has a very low annual mean, yet a biotemperature of about 3 °C because its summers are warm (pp. 23–24).

### 5.3 Fire and savanna–forest bistability

- **Staver, Archibald & Levin 2011, *Ecology* 92:1063** ([author manuscript](https://researchspace.csir.co.za/bitstream/handle/10204/4802/Staver_2011.pdf), Results):
  - **Bimodal tree cover:** across sub-Saharan Africa, tree cover has "two clear maxima at about 15 % and 80 % cover with a frequency minimum at about 60 %", while rainfall is not bimodal.
  - **Rainfall bands:** tree cover is "distinctly bimodal between MAR 1000 mm and 2000 mm". Rainfall limits tree cover below 1000 mm. Fire is rare above 2000 mm, where forest dominates. Savannas occur up to 2000 mm, and forests from as little as 800–1000 mm.
  - **Fire decides in between:** at intermediate rainfall, "tree cover was strongly reduced when fire was present".
  - **Earlier work:** Sankaran et al. (2005) found rainfall limits maximum tree cover up to about 650 mm in Africa.
- **Staver et al. 2011, *Science* 334:230** (global): at 1000–2500 mm with a dry season under 7 months, tree cover is bimodal and "only fire differentiates between savanna and forest". These may be alternative states over large parts of Amazonia and the Congo **[partially verified: abstract via search index]**.
- **IUCN GET** names fire as a global driver for some terrestrial functional groups (Keith 2022, "Hierarchical levels"). "Pyric" groups exist in T2 and T4 (§2.5).
- **Design note:** this is the most direct evidence that a climate → biome function should be **one-to-many** in places. In the 1000–2000 mm band of hot climates, the choice of savanna or forest can come from a hash or a fire-frequency field, not from climate.

### 5.4 Soil, hydrology and coast (azonal biomes)

- **Holdridge (pp. 35–36):** edaphic and hydrological factors (soils, drainage, elevated water tables, limestone, serpentine, salinity, tidal estuaries) define associations inside a life zone. He cautions that they are "still secondary to the broad climatic factors". His example: mangroves are linked to tidal estuaries, yet temperate estuaries carry other vegetation.
- **WWF:** flooded grasslands (#9) and mangroves (#14) are separate biomes (§2.4).
- **IUCN GET:** T1.4 heath forests split off on an edaphic gradient (Keith 2022, Fig. 3a).

---

## 6. Numeric quick reference

| Quantity | Value | Source |
|---|---|---|
| Standard tropospheric lapse rate | −6.5 K/km, 0–11 km | US Std. Atm. 1976, Table 4 |
| Holdridge working lapse rate | 6 °C per 1000 m | Holdridge 1967, p. 33, Fig. 2 |
| Observed surface lapse rates | 3.9–5.2 °C/km (Cascades, annual); 5.4–5.8 (Alps) | Minder 2010; Rolland 2003 [partially verified] |
| Treeline, growing-season mean | 6.7 ± 0.8 °C (soil); 6.4 °C (air, days > 0.9 °C, ≥ 94 days) | Körner & Paulsen 2004; Paulsen & Körner 2014 [partially verified] |
| Treeline, Holdridge | Biotemperature 3 °C (Subalpine / Alpine) | Holdridge 1967, Fig. 1 |
| Frost line | Biotemperature ≈ 16–18 °C | Holdridge 1967, pp. 26–27, Fig. 2 |
| Tropical (Köppen A) | Coldest month ≥ 18 °C | Peel 2007, Table 1 |
| Temperate / cold (C / D) | Coldest month 0 °C (Köppen used −3 °C) | Peel 2007, §2 |
| Polar (E) | Warmest month ≤ 10 °C; ice cap if ≤ 0 °C | Peel 2007, Table 1 |
| Arid (B) | MAP < 10·(2·MAT + 0/14/28) mm; desert if < half of that | Peel 2007, Table 1 |
| Aridity classes (P / PET) | 0.03 / 0.2 / 0.5 / 0.65 | Zomer 2022 (after UNEP 1997) |
| Holdridge PET | 58.93 mm × biotemperature (°C) | Holdridge 1967, p. 31 |
| Savanna–forest bistable band | 1000–2000 mm (Africa); 1000–2500 mm, dry season < 7 months (global) | Staver 2011 *Ecology*; Staver 2011 *Science* [partially verified] |
| Rainfall-limited tree cover | Up to about 650 mm (Africa) | Sankaran 2005, cited in Staver 2011 *Ecology* |

---

## 7. Mapping climate to biomes in a procedural generator (Design notes)

Everything in this section is my own engineering judgement, not sourced science.

### 7.1 What the generator has now, and the scale gap

`Climate` (`climate.ts` L60–78) returns one annual-mean-like temperature in °C and one "relative humidity" in %, as smooth noise independent of the map.

**Units:**

- **Temperature** is already in Whittaker's and Köppen's units. The default −10 to 30 °C (`defaults.json` L75–76) matches Whittaker's chart axis exactly (§2.1).
- **Humidity** has no counterpart in any scheme (§3.4). Treat it as a moisture index m ∈ [0, 1] = (h − 0) / 100, or replace it with precipitation P in mm/yr.

**Scale gap:**

- With a 110 km feature size, the field goes from its coldest to its warmest over about half a wavelength. That is up to roughly 40 °C in 55 km, about 0.7 °C/km.
- Earth's equator-to-pole gradient is about 0.004 °C/km (§5.1), and real biome belts are hundreds to thousands of km wide.
- At the defaults, the whole tundra-to-rainforest sequence fits inside one or two elevation zones (32 km, `README.md` L70).
- That may be intended for a game-scale map. If not, the 20–4000 km feature-size range (`params.ts` L343) already allows Earth-like scales.

**Elevation competes with the noise:** at 6.5 K/km, a 1 km mountain changes temperature as much as 9 km of horizontal noise at the default gradient. Lapse-rate cooling will therefore be visible but will not dominate unless the noise is made smoother.

### 7.2 A pipeline that follows the sources

1. **Sea-level temperature:** T₀(x) = the current temperature field.
2. **Local temperature:** T(x) = T₀(x) − Γ·z(x) for land, with z from `terrain.ts` (metres) and Γ a parameter. Defaults to consider:
   - 6.5 K/km (standard atmosphere);
   - 6 K/km (Holdridge);
   - about 5 K/km (observed surface).
   
   There is no cycle: biomes depend on height, and height depends on elevation zone types and rivers (`terrain.ts`), not on biomes.
3. **Moisture:** either
   - (a) m(x) from the humidity field, mapped to an aridity index through a monotone table, for example 25 % → AI 0.05 and 95 % → AI 2; or
   - (b) P(x) in mm/yr from noise, times an orographic factor that rises on windward slopes and falls in the lee (§4.4). The factor needs a prevailing-wind direction and the terrain gradient, both local, and keeps per-tile evaluation.
4. **Seasonality (optional):** an amplitude field A(x), either from noise or increasing with distance from the ocean as a continentality proxy (§5.2). With it, synthesise a 12-month year T_k = T + A·c_k using a **literal table of 12 cosine constants**, which avoids `Math.cos`. A precipitation regime field could set summer-, winter- or even rainfall.
   - This makes Holdridge biotemperature (mean of clamp(T_k, 0, 30)) and the full Köppen rules computable.
   - Without seasonality, use T_bio ≈ clamp(T, 0, 30), which is right only for aseasonal climates. It is badly wrong at high latitude: Verkhoyansk's annual mean is far below 0 °C, yet its biotemperature is 3 °C (§2.2).
5. **Classify:** see §7.3.
6. **Overrides for azonal biomes** (§5.3–5.4, WWF #9, #10, #14):
   - above the treeline isotherm (T_bio < 3 °C, or growing-season T < 6.4 °C): alpine; below 1.5 °C: nival or ice;
   - river floodplain (already computed in `terrain.ts`) in a warm, seasonal climate: flooded grassland;
   - coastal subbiome with T_cold ≥ 18 °C (frost-free): mangrove (implemented with an annual-mean test instead, see Implementation status at the top);
   - in the hot 1000–2000 mm band: savanna or forest by a per-subbiome hash or a fire field.

### 7.3 Choosing a classifier

| Option | Inputs needed | Pros | Cons |
|---|---|---|---|
| **Whittaker table** (§2.1 grid) | T, P (or m) | Simplest; 2-D lookup; 9 recognisable biomes | Ignores seasonality; P axis in cm; the triangle leaves cold-wet corners undefined (clamp to the nearest cell) |
| **Holdridge** (§2.2) | T_bio, P, elevation | Explicit thresholds; PET built in; altitudinal belts native; about 30 basal hexagons give rich variety | Needs biotemperature (a seasonality proxy); hexagon tiling in log space |
| **Köppen** (§2.3) | 12 monthly T and P | Exact published inequalities; Mediterranean and monsoon variants | Needs a synthetic year; outputs climate classes, so a class → biome table is still needed (§2.6) |
| **Aridity × thermal belt** (§3.2 × §4.2) | AI, T_bio | Two 1-D threshold lists, easy to tune | Coarser; my own composition |

**Recommendation (Design note):**

1. Start with a **two-axis thermal belt × aridity class** table: the Holdridge temperature guide lines × the UNEP or Holdridge humidity provinces. Its cells take the life-zone names of §2.2 and WWF-like colours.
2. Use Whittaker's grid as a cross-check.
3. Add the Köppen rules later, once a seasonality field exists.

### 7.4 Bit-exactness

The repo rule allows only IEEE `+ − × ÷ √` in world code. `Math.exp`, logs and trig are implementation-approximated (`heightmap-from-biomes-and-rivers.md`, C4).

**Thresholds are safe.**

- Every rule in §2–6 is a comparison of correctly rounded `+ − × ÷` results against constants.
- The Köppen inequalities, the Holdridge PET (58.93·T_bio), the aridity index P / PET and the lapse-rate correction T₀ − Γ·z are all bit-exact.
- Constants such as 0.0065 are not exactly representable in binary, but they are the same double on every engine, so results stay deterministic.

**Holdridge's logarithmic axes need no `Math.log`.**

- **Bands:** compare T_bio against 1.5·2ᵏ and P against 62.5·2ᵏ, a short chain of comparisons. For the humidity province, compare 58.93·T_bio / P against 2ᵏ.
- **Hexagons:** a hexagon edge in (log T, log P) space is a line a·log T + b·log P = c with small integer a and b. That is equivalent to comparing T^a·P^b against a constant, which is a product of a few multiplications.
- **Nearest-centre classification:** if you prefer it, a fixed polynomial or table-interpolated log2 is still deterministic, because it is built from `+` and `×` only.

**Avoid as written:**

- Bolton/Clausius–Clapeyron (Roe Eq. 1 uses `exp`);
- Thornthwaite PET (power law) **[unverified formula]**;
- any `Math.pow` with non-integer exponents;
- `Math.sin` or `Math.cos` for seasonal cycles. Use literal constant tables instead (§7.2 step 4).

**Smooth biome transitions** can reuse the polynomial weights already recommended for relief blending: Génevaux's (1 − d²/r²)² in `heightmap-from-biomes-and-rivers.md` §7.3. Holdridge's transitional triangles (p. 33) give an ecological reason to blend near hexagon edges.

**Locality:**

- T, P, AI and the classification are point functions, as `Climate` is today.
- The elevation correction needs z, which today comes from per-tile terrain rasters computed in a worker (`terrain.ts` L5–11). Biome lookup is therefore per tile, like height.
- An orographic factor needs the local terrain gradient and a wind direction: a bounded halo, so C1-local in the terms of the heightmap note.

---

## 8. Sources

**Classification schemes**

- Holdridge, L. R. *Life Zone Ecology*, revised edition, with photographic supplement by J. A. Tosi Jr. Tropical Science Center, San José, Costa Rica, 1967. Read in full (Fig. 1 and Fig. 2 extracted from the PDF). https://app.ingemmet.gob.pe/biblioteca/pdf/Amb-56.pdf
- Holdridge, L. R. "Determination of world plant formations from simple climatic data." *Science* 105(2727):367–368, 1947. https://doi.org/10.1126/science.105.2727.367 **[not read]**
- Peel, M. C., Finlayson, B. L. & McMahon, T. A. "Updated world map of the Köppen-Geiger climate classification." *Hydrol. Earth Syst. Sci.* 11:1633–1644, 2007. Read in full (PDF). https://hess.copernicus.org/articles/11/1633/2007/
- Beck, H. E. et al. "Present and future Köppen-Geiger climate classification maps at 1-km resolution." *Scientific Data* 5:180214, 2018. Criteria table read via PMC. https://pmc.ncbi.nlm.nih.gov/articles/PMC6207062/
- Köppen, W. "Das geographische System der Klimate." In Köppen & Geiger (eds.), *Handbuch der Klimatologie*, Vol. 1, Part C, 1936 **[not read; cited via Peel 2007]**.
- Whittaker, R. H. *Communities and Ecosystems*, 2nd ed. Macmillan, 1975 **[not read]**.
- Ricklefs, R. E. *The Economy of Nature*, 6th ed. W. H. Freeman, 2008, Fig. 5.5 **[not read; via plotbiomes]**.
- Stefan, V. & Levin, S. `plotbiomes` R package: `R/data.R`, `html/Whittaker_biomes_dataset.Rmd`, `data/Whittaker_biomes.rda` (parsed for §2.1). https://github.com/valentinitnelav/plotbiomes
- Olson, D. M. et al. "Terrestrial Ecoregions of the World: A New Map of Life on Earth." *BioScience* 51(11):933–938, 2001. https://doi.org/10.1641/0006-3568(2001)051[0933:TEOTWA]2.0.CO;2 **[abstract only: https://digitalcommons.usf.edu/kip_articles/4884]**
- Dinerstein, E. et al. "An Ecoregion-Based Approach to Protecting Half the Terrestrial Realm." *BioScience* 67(6):534–545, 2017. Table 1 and Fig. 1 read. https://pmc.ncbi.nlm.nih.gov/articles/PMC5451287/
- Keith, D. A. et al. "A function-based typology for Earth's ecosystems." *Nature* 610:513–518, 2022. Read in full (PDF). https://doi.org/10.1038/s41586-022-05318-4
- IUCN Global Ecosystem Typology, ecosystem functional group list. https://red-list-ecosystem.github.io/typology-map-info/efg-info.html

**Moisture and aridity**

- Zomer, R. J., Xu, J. & Trabucco, A. "Version 3 of the Global Aridity Index and Potential Evapotranspiration Database." *Scientific Data* 9:409, 2022. Read in full (PDF). https://doi.org/10.1038/s41597-022-01493-1
- UNEP. *World Atlas of Desertification*, 2nd ed., 1997 **[not read; via Zomer 2022]**.

**Elevation and mountains**

- COESA. *U.S. Standard Atmosphere, 1976*. NOAA-S/T 76-1562 / NASA-TM-X-74335. Table 4 read (scanned PDF page 3). https://ntrs.nasa.gov/citations/19770009539
- ICAO Doc 7488, *Manual of the ICAO Standard Atmosphere*; ISO 2533:1975 **[not read; identity stated by the NTRS record]**.
- Minder, J. R., Mote, P. W. & Lundquist, J. D. "Surface temperature lapse rates over complex terrain: Lessons from the Cascade Mountains." *J. Geophys. Res.* 115:D14122, 2010. https://doi.org/10.1029/2009JD013493 **[partially verified: abstract via search index]**
- Rolland, C. "Spatial and seasonal variations of air temperature lapse rates in Alpine regions." *J. Climate* 16(7):1032–1046, 2003. https://doi.org/10.1175/1520-0442(2003)016<1032:SASVOA>2.0.CO;2 **[partially verified: abstract via search index]**
- Körner, C. & Paulsen, J. "A world-wide study of high altitude treeline temperatures." *J. Biogeography* 31(5):713–732, 2004. https://doi.org/10.1111/j.1365-2699.2003.01043.x **[partially verified: abstract, https://edoc.unibas.ch/8594]**
- Paulsen, J. & Körner, C. "A climate-based model to predict potential treeline position around the globe." *Alpine Botany* 124:1–12, 2014. https://doi.org/10.1007/s00035-014-0124-0 **[partially verified: abstract, https://edoc.unibas.ch/33369]**
- Roe, G. H. "Orographic precipitation." *Annu. Rev. Earth Planet. Sci.* 33:645–671, 2005. Read in full (PDF). https://earthweb.ess.washington.edu/roe/GerardWeb/Publications_files/Roe_OrogPrec_AnnRev05.pdf

**Fire and alternative states**

- Staver, A. C., Archibald, S. & Levin, S. "Tree cover in sub-Saharan Africa: rainfall and fire constrain forest and savanna as alternative stable states." *Ecology* 92(5):1063–1072, 2011. Author manuscript read. https://researchspace.csir.co.za/bitstream/handle/10204/4802/Staver_2011.pdf
- Staver, A. C., Archibald, S. & Levin, S. A. "The global extent and determinants of savanna and forest as alternative biome states." *Science* 334:230–232, 2011. https://doi.org/10.1126/science.1210465 **[partially verified: abstract via search index]**
- Sankaran, M. et al. "Determinants of woody cover in African savannas." *Nature* 438:846–849, 2005 **[not read; cited via Staver 2011 *Ecology*]**.

**Determinism**

- ECMA-262, §21.3.2 (Math functions; `exp` and the trigonometric functions are implementation-approximated; `sqrt` is exact). https://tc39.es/ecma262/multipage/numbers-and-dates.html (as cited in `heightmap-from-biomes-and-rivers.md`)
