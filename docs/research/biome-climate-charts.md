# Biome–Climate Charts: A Catalog of Temperature × Precipitation Diagrams

*Research date: 2026-11-12. Scope: a catalog of the charts, diagrams and rule tables that place biomes in temperature × precipitation space. For each one: where it comes from, its axes and units (linear or log, annual or monthly, cm or mm, air temperature or biotemperature), which biomes it names, how its boundaries are drawn, whether its boundaries exist as machine-readable data (digitised polygons, tables, code), and its licence. It extends `biomes-and-climate.md`, which already covers three charts in depth: the Whittaker diagram through the `plotbiomes` digitisation (§2.1), the Holdridge life-zone chart (§2.2) and the Köppen–Geiger rules (§2.3). This note refers to those sections instead of repeating them. Its value is the wider set of chart variants and where to find them. §8 is a design note on which charts are useful for `sandboxes/sandbox4/src/world/biomes.ts`.*

**How to read the citations**

- Each claim cites the source that owns it: a paper or book with its figure or page, a Wikimedia Commons file page (for author and licence), or a repository with commit SHA, file and line numbers. Every code permalink was fetched at the SHA given.
- **[unverified]** means the claim is general or bibliographic knowledge that was not checked against the primary text in this pass.
- **[partially verified]** means the primary source exists and is cited, but only part of the claim was confirmed, for example from an abstract, a search-index copy, or a secondary source that reproduces it.
- **(read from image)** marks numbers I read off a chart image by eye. They are approximate, to about ±1 °C and ±10 % of precipitation, and are not published values.
- Commons licences, authors and dates come from the Commons API (`prop=imageinfo&iiprop=extmetadata`) and the file pages' wikitext, read on the research date. Wikipedia usage comes from the Commons `globalusage` API.
- Primary texts that could not be read on the research date:
  - Whittaker, *Communities and Ecosystems* (1970; 2nd ed. 1975), the original biome diagram. It is cited through Ricklefs' reproduction (§2.2).
  - Dansereau 1957 and Strasburger 1978, cited through a Commons file description (§2.3).
  - Prentice et al. 1992, *J. Biogeogr.* 19:117 (BIOME model, Table 1): paywalled. Its plant-type limits are cited through the `macroBiome` package's transcription (§5.1).
  - Chapin, Matson & Vitousek, *Principles of Terrestrial Ecosystem Ecology*: the biome–climate figure could not be located (§7).
  - Bonan's *Ecological Climatology* and the CLM-DGVM technical note (Levis et al. 2004): not read (§7).
  - Jiang et al. 2017 and Moncrieff et al. 2015 (*Global Ecol. Biogeogr.*): paywalled; abstracts, repository metadata and code only (§6).
  - The Red Blob Games article host (`www-cs-students.stanford.edu`) refused connections, so its biome diagram image was not seen. The rules are cited from the author's code and blog (§4.1).
- Text marked **Design note** is my own engineering judgement, not a sourced claim.

**What the user already has.** `docs/Biomes by temperature and precipitation.png` (and `docs/Biome climate chart.html`, commits `29786b9` and `a7e84fd`) draws the rasterised lookup grid of `biomes-and-climate.md` §2.1: the 9 `plotbiomes` polygons sampled on a −14…28 °C × 10…425 cm grid, with evenly spaced (not to scale) precipitation rows and blank cells outside every polygon. It is a Whittaker–Ricklefs chart (lineage A below).

**Code locations used below** (working tree at commit `a7e84fd`)

| Hook | File, lines | Relevance |
|---|---|---|
| Thermal belts | `sandboxes/sandbox4/src/world/biomes.ts` L102–108 | Lower bounds −10, −3, 3, 18 °C (after height cooling) |
| Köppen dryness threshold | `biomes.ts` L125–127 | P_th = max(40, 20·T + 140) mm/yr |
| Classifier | `biomes.ts` L148–169 | Aridity m = P / P_th; bounds 0.5 / 1 / 2 / 6 (temperate) and 0.5 / 1 / 2 / 4 (tropical), L121–122 |

---

## 1. Summary

The charts fall into six lineages:

- **A. Whittaker–Ricklefs**: mean annual temperature × mean annual precipitation, hand-drawn regions.
- **B. Holdridge**: biotemperature × precipitation × PET ratio on log₂ axes, a hexagon tiling.
- **C. Walter**: monthly climate diagrams per station, plus a zone ↔ biome crosswalk. Not a T × P map.
- **D. Model rule tables**: bioclimatic limits per plant type (BIOME model). Not a chart.
- **E. Empirical**: real biome maps (WWF/Olson, CHELSA, CRU) placed in climate space.
- **F. Procedural generation**: game generators' lookup tables.

| # | Chart | Lineage | x / y axes and units | Biomes | Boundaries | Machine-readable | Licence | Link |
|---|---|---|---|---|---|---|---|---|
| A1 | Whittaker 1970/1975 original | A | MAT °C, MAP cm [unverified] | ~9 [unverified] | Hand-drawn | No | © Macmillan | (book) |
| A2 | Ricklefs 2008, Fig. 5.5 | A | MAT °C **reversed** (30 → −10), MAP 0–400 cm, linear | 9 | Hand-drawn regions; caption names a fire/soil/seasonality zone | Via A3, A4 | © W. H. Freeman | [chapter PDF, p. 92](https://www.ecologia.polimi.it/wp-content/uploads/2016/03/chap5_ricklefs_biomes.pdf) |
| A3 | `plotbiomes` (digitised A2) | A | MAT °C, MAP cm, linear | 9 | 775 polygon vertices | **Yes** (`.rda`, MIT) | MIT | [repo](https://github.com/valentinitnelav/plotbiomes), [image](https://github.com/valentinitnelav/plotbiomes/raw/develop/man/figures/README-example-1.png) |
| A4 | `BIOMEplot` / `ggbiome` | A | MAT °C, MAP (stored in dm, ×10 → cm) | 9 | 106 polygon vertices | **Yes** (CSV) | GPL ≥ 2 / GPL-2 | [BIOMEplot](https://github.com/kunstler/BIOMEplot), [ggbiome](https://github.com/guillembagaria/ggbiome) |
| A5 | Commons "Climate influence on terrestrial biome" (Navarras 2017) | A | MAT °C −10…32, MAP cm 0…440, linear | 9 | Smooth hand-drawn regions | No (SVG paths only) | **CC0** | [file page](https://commons.wikimedia.org/wiki/File:Climate_influence_on_terrestrial_biome.svg) |
| A6 | Commons "Modification of Whittaker Biome Map for Global Climate Space" (Jcraine 2013) | A + E | MAT °C −30…30, MAP **mm** 0…8000, linear; grey point cloud | 9 incl. Ice | Hand-drawn outlines over data points | No | CC BY-SA 3.0 | [file page](https://commons.wikimedia.org/wiki/File:Modification_of_Whittaker_Biome_Map_for_Global_Climate_Space.jpg) |
| A7 | Commons "Dansereau-Whittaker (1957 & 1970)" (Fährtenleser 2022) | A | MAP mm 0…4500 (x); MAT °C **inverted**, −15 top → 30 bottom (y) | 16 | Hand-drawn | No | CC BY-SA 3.0 | [file page](https://commons.wikimedia.org/wiki/File:Gliederung_der_Klimavegetation_nach_Dansereau-Whittaker_(1957_%26_1970).png) |
| A8 | Commons "Klimatische Gliederung … (1961–1990)" (Fährtenleser 2022) | A | MAP mm 0…4500, ">10000" (x); MAT °C −40…35 inverted (y) | 14 | Hand-drawn, wet edge faded | No | CC BY-SA 3.0 | [file page](https://commons.wikimedia.org/wiki/File:Klimatische_Gliederung_terrestrischer_Pflanzenformationen_(1961%E2%80%931990).png) |
| A9 | Commons "Mittlere jährliche … (1961–1990)" (Fährtenleser 2022) | A + E | As A8 | 20 | Typical value + range bars per formation, from literature | Partly (ranges readable, not tabulated) | CC BY-SA 3.0 | [file page](https://commons.wikimedia.org/wiki/File:Mittlere_j%C3%A4hrliche_Temperatur-_und_Niederschlagswerte_terrestrischer_Pflanzenformationen_(1961%E2%80%931990).png) |
| B1 | Holdridge 1967, Fig. 1 | B | Biotemperature, P mm, PET ratio; all log₂ | 38 hexagons | Guide lines at powers of 2 | Lines are explicit; see `biomes-and-climate.md` §2.2 | © Tropical Science Center | [INGEMMET PDF](https://app.ingemmet.gob.pe/biblioteca/pdf/Amb-56.pdf) |
| B2 | Commons "Lifezones Pengo" (Peter Halasz 2007) | B | As B1; 4 languages | 38 hexagons + belts | Redrawn hexagons | No (SVG) | CC BY-SA 4.0 (also 1.0–3.0) | [file page](https://commons.wikimedia.org/wiki/File:Lifezones_Pengo.svg) |
| B3 | `Ternary::HoldridgePlot()` | B | PET ratio, P; log₂ ternary geometry | 38 | **Computed** hexagons | **Yes** (code) | GPL ≥ 2 | [vignette](https://ms609.github.io/Ternary/articles/Holdridge.html) |
| B4 | `macroBiome::cliHoldridgePoints()` | B | Biotemperature (from monthly T), P, PET ratio | 37 core + transitional | Nearest hexagon centre in log₂ space | **Yes** (CSV table + code) | GPL ≥ 3 | [repo](https://github.com/szelepcsenyi/macroBiome) |
| B5 | Navarro et al. 2025, `hlz.ncl` | B | Biotemperature, P, PET ratio, **linear** distance | 33 centroids → 13 groups | Nearest centroid (Sisneros et al. 2011) | **Yes** (centroid table) | No licence stated | [repo](https://github.com/navarro-esm/uncertainty_maps_library) |
| C1 | Walter climate diagram; Walter zones ↔ Whittaker biomes | C | Month × (T °C, P mm), 10 °C ≙ 20 mm | 9 zones ↔ 9 biomes | Per station; no T × P regions | `climatol` draws them | © (Ricklefs figs.); GPL ≥ 3 (`climatol`) | [chapter PDF, pp. 91–93](https://www.ecologia.polimi.it/wp-content/uploads/2016/03/chap5_ricklefs_biomes.pdf) |
| D1 | Prentice et al. 1992 BIOME plant-type limits | D | T_coldest, T_warmest, GDD5, GDD0, Priestley–Taylor α | 17 biomes from 14 plant types | Explicit thresholds | **Yes** (`macroBiome` CSV) | Paper ©; CSV GPL ≥ 3 | [`vegCbioPFTDefinitions.csv`](https://github.com/szelepcsenyi/macroBiome/blob/4e33f3d47861cc9ed1fd38d545b4b381fbfa7090/data-raw/functions/vegCbioPFTDefinitions.csv) |
| E1 | Beierkuhnlein & Fischer 2021, Fig. 6 + Appendix III | E | MAT °C −40…30, MAP mm 0…3000 | 12 biome clusters | Mean ± IQR bars; 2-D kernel densities | No (figures only) | CC BY 4.0 [partially verified] | [PDF](https://www.erdkunde.uni-bonn.de/article/download/2918/2908/2922) |
| E2 | Jiang et al. 2017 | E | MAT, MAP plus predictability (CRU 0.5°) | 14 WWF biomes | Data clouds | **Yes**: WWF biome per CRU 0.5° cell (CSV) | Code and CSV GPL-3; paper © | [repo](https://github.com/mingkaijiang/biome_specific_predictability) |
| E3 | Poppenwimer et al. 2023, Fig. 2B | E | Mean yearly T, total yearly P, ecoregion points on a Whittaker outline | 9 (Whittaker) | Points; nearest biome outside | No | CC BY 4.0 (arXiv) | [arXiv](https://arxiv.org/abs/2304.13101) |
| E4 | Navarro et al. 2025, Fig. 2 and Whittaker maps | A + E | `plotbiomes` axes | 9 | `plotbiomes` polygons; nearest polygon outside | Code (R) | Article CC BY 4.0 | [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC11711615/) |
| F1 | Red Blob Games, polygon map generation (2010) | F | **Elevation** (as temperature proxy) × moisture, both 0–1 | 13 land + water types | Explicit thresholds | **Yes** (code) | MIT | [`Map.as`](https://github.com/amitp/mapgen2/blob/d0b09469777fcaa211c31edcefa59f13f416141f/Map.as#L718-L747) |
| F2 | Red Blob Games, mapgen2 (2017) | F | Temperature 0–1 × moisture 0–1 | Same as F1 | Explicit thresholds | **Yes** (code) | Apache-2.0 | [`biomes.js`](https://github.com/redblobgames/mapgen2/blob/f16f485a62510344afe13e9c6aa01f7fa25be17e/biomes.js#L9-L38) |
| F3 | Azgaar's Fantasy Map Generator `biomesMatrix` | F | Integer °C (26 columns, ≥ 20 to ≤ −5) × 5 moisture bands (precipitation units of 100 mm) | 12 incl. glacier and wetland | Lookup matrix + overrides | **Yes** (code) | MIT | [`biomes-generator.ts`](https://github.com/Azgaar/Fantasy-Map-Generator/blob/5aa93ef591e1a111a32b290da23dc944090652f7/src/model/physical/biomes-generator.ts#L149-L156) |
| F4 | Minecraft multi-noise biome table | F | Abstract noise levels (temperature, humidity), 5 × 5 | Dozens | Level table | Wiki table | Wiki CC BY-NC-SA [unverified]; game code © Mojang | [Minecraft Wiki](https://minecraft.wiki/w/World_generation) |

**Five things the catalog shows**

1. **The Whittaker-type charts disagree on where the boundaries sit in °C.** Boreal forest spans −6.7…4.4 °C in `plotbiomes` (`biomes-and-climate.md` §2.1), about 1…8 °C in the Navarras chart (A5) and about −10…1 °C in the Jcraine chart (A6) (read from image). The tropical biomes start at about 18–19 °C in `plotbiomes`, about 23 °C in A5 and about 19–20 °C in A6 (read from image). Ricklefs' text puts boreal forest at 0–5 °C and tropical climates at 20–30 °C (§2.2). The regions are hand-drawn; no version is "the" Whittaker boundary set.
2. **Only three packages ship Whittaker-type boundaries as data:** `plotbiomes` (MIT, 775 vertices), and `BIOMEplot` and `ggbiome` (GPL, 106 vertices). Every other tool found (Navarro 2025, the `geco-bern` textbook) reuses `plotbiomes`. All of them trace the same Ricklefs figure.
3. **Holdridge is the only chart whose boundaries are defined by numbers rather than drawn.** Two packages compute it (Ternary for drawing, macroBiome for classifying). Navarro's implementation measures distance on linear axes, which does not match Holdridge's log axes (§3.5).
4. **Climate-only charts overlap in reality.** Empirical studies (E1, E2, and Moncrieff et al. 2015) find wide overlap of real biomes in MAT × MAP space. Jiang et al. add predictability axes to separate them.
5. **Game generators use a coarse grid of explicit thresholds** (F1–F3). Azgaar's is the only one in real units (°C and a precipitation proxy in 100 mm units).

---

## 2. Lineage A: Whittaker–Ricklefs charts (MAT × MAP)

### 2.1 Whittaker's original (1970, 1975)

- **Source:** R. H. Whittaker, *Communities and Ecosystems*, Macmillan, 1970; 2nd ed. 1975. Ricklefs credits the 2nd edition for his Fig. 5.5 (§2.2). The book was not read **[unverified: figure number, axes and exact boundaries]**.
- **Figure number:** a secondary page calls it Whittaker's Figure 4.10 ([appstate.edu](https://www.appstate.edu/~neufeldhs/ecosystems/biomessynthesis.htm)) **[unverified]**.
- **Dansereau precursor:** a Commons file credits the scheme to "a suggestion by Pierre Dansereau (1957), revised by Robert Whittaker (1970)", taken from Strasburger 1978 (A7) **[unverified: Dansereau and Strasburger not read]**.

### 2.2 Ricklefs, *The Economy of Nature*, Fig. 5.5 (verified)

Read from a course copy of Chapter 5, "The Biome Concept in Ecology", printed pp. 87–112 ([polimi.it PDF](https://www.ecologia.polimi.it/wp-content/uploads/2016/03/chap5_ricklefs_biomes.pdf)). The copy has no title page. Its page range and reference list (latest 2005) fit the 6th edition, 2008, which `plotbiomes` cites **[partially verified: edition]**.

- **Axes** (p. 92): "Average temperature (ºC)" runs **30 → −10 from left to right** (an arrow reads "Decreasing temperature"). "Annual precipitation (cm)" runs 0–400, linear. Most redraws flip the temperature axis to increase to the right (A3, A5).
- **Biomes (9):** tropical rain forest; tropical seasonal forest/savanna; subtropical desert; temperate rain forest; temperate seasonal forest; woodland/shrubland; temperate grassland/desert; boreal forest; tundra.
- **Caption (p. 92, paraphrased):** Whittaker plotted the boundaries of observed vegetation types against average temperature and precipitation. In climates between forest and desert, "climatic seasonality, fire, and soils determine whether woodland, grassland, or shrubland develops." An inset plots localities spread over the land surface; most fall within a triangle, and only high mountains fall outside it. Credit: Whittaker 1975.
  - This confirms, for the Ricklefs version, the indeterminate woodland/shrubland zone that `biomes-and-climate.md` §2.1 marks **[unverified]** for Whittaker 1975.
- **Text thresholds (p. 92):** at 20–30 °C, rain forest generally above 250 cm, desert below 50 cm, seasonal forest 150–250 cm, scrub and savanna 50–150 cm. Boreal forest predominates between 0 and 5 °C.
- **Why the triangle (p. 92):** cold regions with high rainfall are rare, because water evaporates slowly in the cold and cold air holds little water vapour.
- **Licence:** © W. H. Freeman (textbook). Not reusable.

### 2.3 Digitised Ricklefs polygons: `plotbiomes`, `BIOMEplot`, `ggbiome`

- **`plotbiomes`:** see `biomes-and-climate.md` §2.1 for the dataset, its bounding boxes and the rasterised grid. Additional facts:
  - `R/data.R` L16–17: "Digitized from **Figure 5.5** in Ricklefs (2008)"; L25: precipitation is in cm; L31–32: the values "represent the vertices of the borders between biome polygons as they were digitized" ([commit `19dfcaf`](https://github.com/valentinitnelav/plotbiomes/blob/19dfcaf26a8304b9812093471438ace2f9966bb8/R/data.R#L16-L32)).
  - Licence: `DESCRIPTION` says "MIT + file LICENSE"; the README says the implementation is independent of Ricklefs' work ([README](https://github.com/valentinitnelav/plotbiomes)). Version 0.0.0.9001. The digitised coordinates are traced from a copyrighted figure, which the MIT licence does not settle **[Design note]**.
  - README example image (temperature increasing to the right, P in cm): [README-example-1.png](https://github.com/valentinitnelav/plotbiomes/raw/develop/man/figures/README-example-1.png).
- **`BIOMEplot`** (Georges Kunstler, 2014): "R package to plot Whittaker' biomes (Whittaker 1975)"; "The biomes MAP and MAT were digitalized from the modified biomes of Ricklefs (2008)" ([README](https://github.com/kunstler/BIOMEplot)).
  - Data: `inst/extdata/biomes.csv`, 106 vertices in 9 biomes. Columns `x` = MAT (°C), `y` = MAP in **dm**: `R/biomes-plot.R` L22 multiplies `y` by 10 to get cm ([commit `3edd582`](https://github.com/kunstler/BIOMEplot/blob/3edd582d7985a7330c411201289dc1076afb845b/R/biomes-plot.R#L22)). Tropical rain forest reaches y = 44.3 (443 cm).
  - It is coarser than `plotbiomes` (106 vs. 775 vertices); I computed the vertex counts and extents from the CSV.
  - Licence: GPL (≥ 2) (`DESCRIPTION`).
- **`ggbiome`** (Bagaria, Granda, Kunstler): returns MAT, MAP and Whittaker biome for coordinates and plots them. "Some functionalities … are based on `BIOMEplot`"; the polygons have the same Ricklefs source ([README](https://github.com/guillembagaria/ggbiome)). Licence GPL-2.0 (GitHub metadata).
- **No Python package** shipping Whittaker polygons was found. Python users export the `plotbiomes` data.

### 2.4 Navarras (Commons, CC0), the chart on Wikipedia's "Biome" article

- **File:** [Climate_influence_on_terrestrial_biome.svg](https://commons.wikimedia.org/wiki/File:Climate_influence_on_terrestrial_biome.svg) ([image](https://upload.wikimedia.org/wikipedia/commons/6/68/Climate_influence_on_terrestrial_biome.svg)). Author Navarras, 2017-07-10, "Own work", **CC0**. Description: "Average annual temperature and precipitation needed for different categories of common terrestrial biomes."
- **Use:** the English Wikipedia article "Biome" uses it (Commons `globalusage`). There are Norwegian (`… no.svg`) and Spanish (`….es.svg`) versions.
- **Axes:** x "Average annual temperature (°C)" −10 to 32, increasing to the right; y "Annual precipitation (cm)" 0 to about 440, linear.
- **Biomes (9):** the Ricklefs set, with "Temperate grassland/cold desert" instead of "temperate grassland/desert".
- **Boundaries:** smooth hand-drawn regions without vertices or a stated source. They are noticeably warmer than `plotbiomes` (read from image):

| Biome | Navarras A5, MAT (°C) | `plotbiomes` extent, MAT (°C) |
|---|---|---|
| Tundra | about −9 to 1 | −15.6 to −4.1 |
| Boreal forest | about 1 to 8 | −6.7 to 4.4 |
| Temperate seasonal forest | about 6 to 23 | −0.7 to 19.2 |
| Tropical seasonal forest/savanna | about 22 to 31 | 17.9 to 29.6 |
| Subtropical desert | about 18 to 32 | 14.1 to 30.0 |

- **Licence:** CC0, the only freely reusable Whittaker-type image found that needs no attribution.
- Navarro et al. 2025 (E4) also draw a Whittaker diagram (their Fig. 2). Whether it is the same artwork was not checked.

### 2.5 Jcraine (Commons): Whittaker regions over global climate space

- **File:** [Modification_of_Whittaker_Biome_Map_for_Global_Climate_Space.jpg](https://commons.wikimedia.org/wiki/File:Modification_of_Whittaker_Biome_Map_for_Global_Climate_Space.jpg) ([image](https://upload.wikimedia.org/wikipedia/commons/d/d9/Modification_of_Whittaker_Biome_Map_for_Global_Climate_Space.jpg)). Author Jcraine, 2013-05-28, "Own work", CC BY-SA 3.0. Description: "Modification of Whittaker biome figure to show global climate space." It is not used on any wiki.
- **Axes:** "MAT (°C)" −30 to 30; "MAP (mm)" 0 to 8000, linear. The grey points appear to be land grid cells **[unverified: the data source is not stated]**.
- **Regions (9):** Ice, Tundra, Boreal forest, Temperate forest, Temperate wet forest, Tropical dry forest, Tropical wet forest, Grassland/savanna, Desert.
- **Differences from Ricklefs (read from image):**
  - The chart extends to −30 °C and adds an "Ice" region for cold climates up to about 1500 mm.
  - It merges woodland/shrubland and grassland into one "Grassland/savanna" band across all temperatures.
  - The temperate/tropical line is at about 19–20 °C; the boreal/temperate line is at about 0–2 °C.
  - It extends the wet edge to about 7000 mm in the tropics.

### 2.6 Fährtenleser's German charts (Commons, CC BY-SA 3.0)

All three are by Commons user Fährtenleser, 2022-09-07, "Own work", CC BY-SA 3.0. All put **precipitation (mm) on x** and **temperature on y, increasing downwards**.

- **A7, "Gliederung der Klimavegetation nach Dansereau-Whittaker (1957 & 1970)"** ([file page](https://commons.wikimedia.org/wiki/File:Gliederung_der_Klimavegetation_nach_Dansereau-Whittaker_(1957_%26_1970).png), [image](https://upload.wikimedia.org/wikipedia/commons/2/24/Gliederung_der_Klimavegetation_nach_Dansereau-Whittaker_%281957_%26_1970%29.png)).
  - Source line: Nolzen (ed.), *Handbuch des Geographieunterrichts* Bd. 12/I, 1995, p. 57. Description: "based on a suggestion by Pierre Dansereau (1957), revised by Robert Whittaker (1970), from Eduard Strasburger (1978). Simplified and colored."
  - Axes: MAT −15 (top) to 30 °C (bottom); MAP 0–4500 mm.
  - 16 formations, among them tropical, subtropical–warm-temperate and cool-temperate rain forests, monsoon forests, summer-green broadleaf, (cold-)temperate conifer, thorn woodland, savanna, **sclerophyll (Hartlaubgehölze)**, forest steppe, (sub)tropical grassland, temperate steppe, tundra, hot desert, dry desert and cold desert.
  - Unlike Ricklefs, it gives sclerophyll (Mediterranean-type) vegetation its own region (about 13–20 °C, 700–1300 mm, read from image).
- **A8, "Klimatische Gliederung terrestrischer Pflanzenformationen (1961–1990)"** ([file page](https://commons.wikimedia.org/wiki/File:Klimatische_Gliederung_terrestrischer_Pflanzenformationen_(1961%E2%80%931990).png), [image](https://upload.wikimedia.org/wikipedia/commons/4/41/Klimatische_Gliederung_terrestrischer_Pflanzenformationen_%281961%E2%80%931990%29.png)).
  - Description: a classification "in Anlehnung an Dansereau & Whittaker, jedoch auf der Grundlage aktuellerer Daten" (after Dansereau & Whittaker, but based on more recent data). The sources are A7 and A9.
  - Axes: MAT −40 to 35 °C (inverted); MAP 0–4500 mm, with a ">10000" marker.
  - 14 formations; the wet edges fade out rather than end on a line.
  - Horizontal bands (read from image): boreal colder than about 3 °C; temperate about 3–13 °C; subtropical laurel and sclerophyll about 13–20 °C; tropical warmer than about 20 °C.
- **A9, "Mittlere jährliche Temperatur- und Niederschlagswerte terrestrischer Pflanzenformationen (1961–1990)"** ([file page](https://commons.wikimedia.org/wiki/File:Mittlere_j%C3%A4hrliche_Temperatur-_und_Niederschlagswerte_terrestrischer_Pflanzenformationen_(1961%E2%80%931990).png), [image](https://upload.wikimedia.org/wikipedia/commons/0/03/Mittlere_j%C3%A4hrliche_Temperatur-_und_Niederschlagswerte_terrestrischer_Pflanzenformationen_%281961%E2%80%931990%29.png)).
  - It shows 20 formations as a typical value with temperature and precipitation range bars (dotted where the range continues). There are English and German legends on the file page.
  - Sources listed in the wikitext:
    - the framework: Beierkuhnlein & Fischer 2021 (E1) and Jiang et al. 2017 (E2);
    - the detailed subdivision: Post et al. 1982 (Holdridge life zones, via Schultz 2008) and Müller-Hohenstein 1989;
    - checks for single formations: DellaSala 2011, Pfadenhauer & Klötzli 2014, FAO 2001 ecological zones, Nolzen 1996.
  - A9 is a compilation by a Wikipedia editor, not a published figure.

---

## 3. Lineage B: Holdridge life-zone charts

For the system itself (guide lines 1.5·2ᵏ °C, 62.5·2ᵏ mm and PET-ratio powers of 2; the frost line; altitudinal belts; the 58.93 PET factor), see `biomes-and-climate.md` §2.2. This section catalogues the images and implementations.

### 3.1 Holdridge 1967, Fig. 1 (and 1947)

The authoritative chart: `biomes-and-climate.md` §2.2, from the [INGEMMET copy](https://app.ingemmet.gob.pe/biblioteca/pdf/Amb-56.pdf). The 1947 *Science* chart ([doi:10.1126/science.105.2727.367](https://doi.org/10.1126/science.105.2727.367)) was not read.

### 3.2 Peter Halasz, "Lifezones Pengo" (Commons)

- **File:** [Lifezones_Pengo.svg](https://commons.wikimedia.org/wiki/File:Lifezones_Pengo.svg) ([image](https://upload.wikimedia.org/wikipedia/commons/c/cb/Lifezones_Pengo.svg)). Author Peter Halasz, dated 2007-03-03.
- **Licence:** CC BY-SA 4.0, with CC BY-SA 3.0, 2.5, 2.0 and 1.0 Generic also offered on the file page (attribution and share-alike required).
- **Basis:** "Own work based on" OAS and other web copies of the Holdridge diagram, Stiling's *Ecology* (4th ed., p. 236) and Krishnamurthy 2003 (p. 55) (Commons Credit field).
- **Use:** used on 42 wiki pages, including English Wikipedia's "Biome", "Life zone", "Leslie Holdridge" and "Polar desert". It was a featured picture candidate in March 2007.
- **Content** (text labels extracted from the SVG):
  - Edge axes: "annual precipitation (mm)" 62.5 … 16000 and "potential evapotranspiration ratio" 0.125 … 32.
  - Bottom: "humidity provinces", super-humid … super-arid.
  - Left: "latitudinal regions" polar … tropical, with biotemperature 1.5, 3, 6, 12 and 24 °C, a "critical temperature line", and "altitudinal belts" alvar/alpine, subalpine, montane, lower montane and premontane.
  - Labels in English, Portuguese, Catalan and Malay, switched by SVG `systemLanguage`.
  - Hexagons: desert, desert scrub, dry/moist/wet/rain tundra and forests, steppe, thorn steppe/woodland, very dry forest. The polar row is labelled "desert".
- **Variants by the same author:** [`Lifezones Pengo, by type.svg`](https://commons.wikimedia.org/wiki/File:Lifezones_Pengo,_by_type.svg) (CC BY-SA 2.5) and [`Lifezones Pengo, FAO.svg`](https://commons.wikimedia.org/wiki/File:Lifezones_Pengo,_FAO.svg) (CC BY-SA 4.0). Also [`Holdridge FR.png`](https://commons.wikimedia.org/wiki/File:Holdridge_FR.png) (Lucquessoy, CC BY-SA 3.0, French).

### 3.3 `Ternary::HoldridgePlot()` (R): computed geometry

- **Package:** Martin Smith's `Ternary`, version 2.3.7, GPL (≥ 2). The function draws "a blank triangular plot, as proposed by Holdridge (1947, 1967)" for PET ratio and precipitation data ([`R/Holdridge.R` L1–7](https://github.com/ms609/Ternary/blob/f22bed262c148eb0afa0dc7d592c29937c140fd1/R/Holdridge.R#L1-L7)). Example output: [vignette](https://ms609.github.io/Ternary/articles/Holdridge.html).
- **Geometry is computed, not digitised.** `HoldridgeToXY()` maps `log2(pet) + 3` and `log2(prec / 1000) + 4` onto ternary coordinates ([L423–425](https://github.com/ms609/Ternary/blob/f22bed262c148eb0afa0dc7d592c29937c140fd1/R/Holdridge.R#L423-L425)). `HoldridgeHexagons()` lays out the hexagons from an index matrix and fixed offsets (`e <- 1/16`) on that log grid ([L342–385](https://github.com/ms609/Ternary/blob/f22bed262c148eb0afa0dc7d592c29937c140fd1/R/Holdridge.R#L342-L385)).
- **Data:** `holdridgeClasses` lists 38 names, "Polar desert" … "Tropical rain forest" ([`data-raw/Holdridge.R`](https://github.com/ms609/Ternary/blob/f22bed262c148eb0afa0dc7d592c29937c140fd1/data-raw/Holdridge.R)). `holdridge` is example site data (PET, precipitation, latitude), not boundaries.

### 3.4 `macroBiome` (R): Holdridge classification table and rules

- **Package:** Zoltán Szelepcsényi's `macroBiome`, version 0.3.0 on GitHub, GPL (≥ 3). It implements Holdridge, Köppen–Geiger and the BIOME model from monthly climate ([repo](https://github.com/szelepcsenyi/macroBiome); [CRAN README](https://cloud.r-project.org/web/packages/macroBiome/readme/README.html)).
- **Table:** [`data-raw/functions/vegChlzDefinitions.csv`](https://github.com/szelepcsenyi/macroBiome/blob/4e33f3d47861cc9ed1fd38d545b4b381fbfa7090/data-raw/functions/vegChlzDefinitions.csv) lists 37 "core" zones (codes 2–38; polar desert and bare soil are assigned by rule), e.g. `SpDt;Subpolar dry tundra;…;1.5;62.5;1`, plus transitional "forest-steppe" classes.
  - Columns `abt`, `tap` and `per` hold each hexagon's lower guide values for biotemperature, precipitation and PET ratio.
  - The table has a separate Warm temperate row (e.g. `WtTs` "thorn steppe") and Subtropical row (`StTw` "thorn woodland"), both with `abt` = 12.
- **Classifier** ([`R/cliHoldridge.R`](https://github.com/szelepcsenyi/macroBiome/blob/4e33f3d47861cc9ed1fd38d545b4b381fbfa7090/R/cliHoldridge.R#L111-L140)):
  - Each hexagon's centre is `log2(guide) + 0.5` on all three axes; the distance is Euclidean in log₂ space (L111–117).
  - Constants: polar line `plTL <- 1.5` (L131), minimum precipitation 62.5 mm (L134), minimum PET ratio 0.125 (L137). The frost line is `2 ** (log2(12) + 0.5)` ≈ 16.97 °C (L140), the geometric midpoint of the 12–24 °C row, which splits warm temperate from subtropical.
  - Below the minima the class is bare soil; below 1.5 °C, polar desert.
- **Inputs:** monthly mean temperature and precipitation; `abt` is mean annual biotemperature ("Eq 1 in Szelepcsényi et al. (2014)"), `per` the PET ratio (L16–18).

### 3.5 Navarro et al. 2025 `hlz.ncl` (NCL): a centroid table, with two deviations

- **Source:** the code for Navarro et al. 2025 (E4) ([`holdridge/hlz.ncl`](https://github.com/navarro-esm/uncertainty_maps_library/blob/ccc1b835fcea49640772b178b8626125bdd45336/holdridge/hlz.ncl#L174-L222)). It is "Based on Sisneros et al. (2011)" (L3) **[unverified: Sisneros not read]**, with the Monserud & Leemans 1992 13-class grouping (L174).
- **Centroids:** 33, given explicitly (L178–186). Precipitation centroids are 88.39, 176.78, … 11313.71 mm (62.5·√2·2ᵏ), biotemperature 0, 2.12, 4.24, 8.49, 16.97, 26.83 °C, and PET ratio 0.18 … 22.63, i.e. geometric hexagon centres.
- **Deviation 1, linear distance:** the code computes `(APP − APPr)² + (ABT − ABTr)² + (PER − PERr)²` on the raw values (L199–202, L219–222), not on logarithms. Precipitation in mm then dominates the distance. Holdridge's axes are logarithmic (`biomes-and-climate.md` §2.2), so this is not the same partition. This is my reading of the code, not a claim of the paper.
- **Deviation 2, the 30 °C rule:** monthly temperatures ≥ 30 °C are clamped to 30 (L120, whose comment says "to 0 degrees"). Holdridge counts them as 0 (`biomes-and-climate.md` §2.2).
- **Licence:** the repository has no licence file, so the default applies: all rights reserved.

---

## 4. Lineage F: procedural-generation tables

### 4.1 Red Blob Games (Amit Patel): polygon map generation, 2010, and mapgen2, 2017

- **Blog:** for land polygons he "started with the Whittaker diagram and adapted it to my needs", with **elevation as a proxy for temperature** and moisture from distance to fresh water ([simblob part 2](https://simblob.blogspot.com/2010/09/polygon-map-generation-part-2.html)). The article with the diagram image (`www-cs-students.stanford.edu/~amitp/game-programming/polygon-map-generation/`) could not be reached **[unverified: the image]**.
- **2010 rules** (ActionScript, MIT licence, [`Map.as` L718–747](https://github.com/amitp/mapgen2/blob/d0b09469777fcaa211c31edcefa59f13f416141f/Map.as#L718-L747)). Elevation and moisture are both in 0–1.

| Elevation \ moisture | < 0.16 | 0.16–0.33 | 0.33–0.50 | 0.50–0.66 | 0.66–0.83 | > 0.83 |
|---|---|---|---|---|---|---|
| > 0.8 | Scorched | Bare | Tundra | Snow | Snow | Snow |
| 0.6–0.8 | Temperate desert | Temperate desert | Shrubland | Shrubland | Taiga | Taiga |
| 0.3–0.6 | Temperate desert | Grassland | Grassland | Temperate deciduous forest | Temperate deciduous forest | Temperate rain forest |
| < 0.3 | Subtropical desert | Grassland | Tropical seasonal forest | Tropical seasonal forest | Tropical rain forest | Tropical rain forest |

  Before this table: ocean; lakes (marsh if elevation < 0.1, ice if > 0.8); and beach on coast polygons.
- **2017 HTML5 version** ([`biomes.js` L9–38](https://github.com/redblobgames/mapgen2/blob/f16f485a62510344afe13e9c6aa01f7fa25be17e/biomes.js#L9-L38), Apache-2.0): the same table, but driven by a **temperature** in 0–1 ("based on elevation and latitude", L64–69). The bands are < 0.2, 0.2–0.4, 0.4–0.7 and > 0.7, with the coldest at the top.
- **Units:** none. Both axes are normalised ranks, so the table carries no °C or mm.

### 4.2 Azgaar's Fantasy Map Generator: `biomesMatrix`

Source: [`src/model/physical/biomes-generator.ts`](https://github.com/Azgaar/Fantasy-Map-Generator/blob/5aa93ef591e1a111a32b290da23dc944090652f7/src/model/physical/biomes-generator.ts) at `5aa93ef` (MIT, © 2017–2024 Max Haniyeu).

- **Biomes (L23–147):** Marine, Hot desert, Cold desert, Savanna, Grassland, Tropical seasonal forest, Temperate deciduous forest, Tropical rainforest, Temperate rainforest, Taiga, Tundra, Glacier, Wetland.
- **Matrix (L149–156):** 5 moisture rows × 26 temperature columns. The comment reads "hot ↔ cold [>19°C; <-4°C]; dry ↕ wet".
- **Lookup (L272–281):**
  - `moistureBand = min(floor(moisture / 5), 4)`, where `moisture = round(4 + mean(prec of the cell and its land neighbours))`, plus a river bonus `max(flux/10, 2)` (L177–186).
  - `temperatureBand = min(max(20 − T, 0), 25)` with T in °C. Column 0 is T ≥ 20 °C and column 25 is T ≤ −5 °C.
- **Overrides, in order:**
  - water → Marine;
  - T < −5 → Glacier;
  - T ≥ 25 with no river and moisture < 8 → Hot desert;
  - wetland if T > −2 and (moisture > 40 at height < 25, or moisture > 24 at height 25–59) (L283–288).
- **Precipitation units:** the UI shows `prec * 100` mm ([`src/model/units.ts` L64](https://github.com/Azgaar/Fantasy-Map-Generator/blob/5aa93ef591e1a111a32b290da23dc944090652f7/src/model/units.ts#L64)). `prec` is a wind-driven Uint8 accumulation, not a physical model ([`precipitation-generator.ts`](https://github.com/Azgaar/Fantasy-Map-Generator/blob/5aa93ef591e1a111a32b290da23dc944090652f7/src/model/physical/precipitation-generator.ts)).

**The matrix in °C and approximate mm/yr.** This is my own translation of L150–156. The mm bands use 100 mm per `prec` unit and the rounding of `4 + mean`; they ignore the river bonus and neighbour averaging.

| Band (approx. P) | Biomes from hot to cold |
|---|---|
| 0 (< ~50 mm) | Hot desert T ≥ 13; Cold desert 12 … −4; Tundra ≤ −5 |
| 1 (~50–550 mm) | Savanna T ≥ 18; Grassland 17 … 2; Taiga 1 … −2; Tundra ≤ −3 |
| 2 (~550–1050 mm) | Tropical seasonal forest T ≥ 20; Temperate deciduous 19 … 3; Taiga 2 … −2; Tundra ≤ −3 |
| 3 (~1050–1550 mm) | Tropical seasonal forest T ≥ 20; Temperate deciduous 19 … 14; Temperate rainforest 13 … 4; Taiga 3 … −2; Tundra ≤ −3 |
| 4 (≥ ~1550 mm) | Tropical rainforest T ≥ 20; Temperate rainforest 19 … 4; Taiga 3 … −3; Tundra ≤ −4 |

Unlike Whittaker and Köppen, the moisture bands do not depend on temperature. 600 mm counts as "forest" at both 5 °C and 19 °C.

### 4.3 Minecraft multi-noise biome table

- **Levels:** the Overworld places biomes from six noise parameters. Temperature and humidity each have five levels on [−1, 1]: temperature at −0.45, −0.15, 0.2 and 0.55; humidity at −0.35, −0.1, 0.1 and 0.3 ([Minecraft Wiki, "World generation"](https://minecraft.wiki/w/World_generation), Biomes > Overworld) **[partially verified: the level bounds were read; the 5 × 5 "middle biome" table did not survive text extraction and is not reproduced]**.
- **Units:** abstract noise levels, not °C or mm.
- **Licence:** game code © Mojang; wiki text CC BY-NC-SA **[unverified]**.

---

## 5. Lineage C and D: Walter diagrams and the BIOME model's limits

### 5.1 Prentice et al. 1992 (BIOME1): plant-type limits

- **Not a T × P chart.** Each plant functional type (PFT) has limits on the coldest-month temperature `tc`, the warmest-month temperature `tw`, growing degree-days above 5 °C (`gdd5`) and 0 °C (`gdd0`), and the Priestley–Taylor coefficient `ptc` (an actual/potential evapotranspiration ratio, the moisture axis). Biomes are combinations of the dominant PFTs ([`macroBiome` `R/cliBIOME.R` L53–75](https://github.com/szelepcsenyi/macroBiome/blob/4e33f3d47861cc9ed1fd38d545b4b381fbfa7090/R/cliBIOME.R#L53-L75), citing "Table 1" and "Table 5 in Prentice et al. (1992)").
- **Machine-readable:** [`vegCbioPFTDefinitions.csv`](https://github.com/szelepcsenyi/macroBiome/blob/4e33f3d47861cc9ed1fd38d545b4b381fbfa7090/data-raw/functions/vegCbioPFTDefinitions.csv) (limits) and [`vegCbioBiomeDefinitions.csv`](https://github.com/szelepcsenyi/macroBiome/blob/4e33f3d47861cc9ed1fd38d545b4b381fbfa7090/data-raw/functions/vegCbioBiomeDefinitions.csv) (17 biomes: tropical rain forest … polar desert). These are macroBiome's transcription, **[partially verified]** against the paywalled paper. Examples:

| PFT | tc (°C) | gdd5 min | tw min (°C) | ptc |
|---|---|---|---|---|
| Tropical evergreen tree | ≥ 15.5 | — | — | ≥ 0.80 |
| Tropical raingreen tree | ≥ 15.5 | — | — | 0.45–0.95 |
| Warm-temperate evergreen | ≥ 5 | — | — | ≥ 0.65 |
| Temperate summergreen | −15 to 15.5 | 1200 | — | ≥ 0.65 |
| Cool-temperate conifer | −19 to 5 | 900 | — | ≥ 0.65 |
| Boreal evergreen conifer | −35 to −2 | 350 | — | ≥ 0.75 |
| Sclerophyll/succulent | ≥ 5 | — | — | ≥ 0.28 |
| Warm grass/shrub | — | — | 22 | ≥ 0.18 |
| Cool grass/shrub | — | 500 | — | ≥ 0.33 |
| Hot desert shrub | — | — | 22 | — |

- **Variant:** macroBiome replaces the original water balance with SPLASH v1.0 and makes the bucket size adjustable (CRAN README).

### 5.2 Walter climate diagrams and Walter's nine zones

- **What it is:** a per-station plot of monthly temperature (left scale) and precipitation (right scale), scaled so that **10 °C ≙ 20 mm**. Where the precipitation line lies above the temperature line, water is not limiting (Ricklefs Fig. 5.6, p. 93, [chapter PDF](https://www.ecologia.polimi.it/wp-content/uploads/2016/03/chap5_ricklefs_biomes.pdf)). It needs monthly data, which `sandbox4` lacks. It is a diagnostic per site, not a map of T × P.
- **Zones ↔ biomes crosswalk** (Ricklefs Fig. 5.4, p. 91). Walter's 9 zones map one-to-one onto Whittaker's 9 biomes:

| Walter zone | Whittaker biome |
|---|---|
| I Equatorial | Tropical rain forest |
| II Tropical | Tropical seasonal forest/savanna |
| III Subtropical (hot deserts) | Subtropical desert |
| IV Mediterranean | Woodland/shrubland |
| V Warm temperate | Temperate rain forest |
| VI Nemoral | Temperate seasonal forest |
| VII Continental (cold deserts) | Temperate grassland/desert |
| VIII Boreal | Boreal forest |
| IX Polar | Tundra |

  The Mediterranean row is the one Whittaker's annual-mean axes cannot place.
- **Code:** the R package `climatol` (GPL ≥ 3) draws Walter & Lieth diagrams ([CRAN](https://cran.r-project.org/web/packages/climatol/index.html)).

---

## 6. Lineage E: empirical biome climate space

### 6.1 Beierkuhnlein & Fischer 2021 (*Erdkunde* 75:249)

- **Method:** they digitised 12 global biome concepts, clustered 287 biomes into 12 "condensed" clusters, and linked them to CHELSA climate (Karger et al. 2017), not WorldClim (p. 8 of the [PDF](https://www.erdkunde.uni-bonn.de/article/download/2918/2908/2922)).
- **Fig. 6 (p. 13):** "Mean annual temperature and precipitation values for 12 condensed biome clusters". It shows means with 25–75 % quantile bars. Axes: MAT −40…30 °C, MAP 0…3000 mm.
- **Clusters:** Ice; Tundra and Polar Desert; Boreal Forest; Temperate-Boreal Forest Ecotone; High Mountain Plateau; Temperate Forest; Nemoral Forest; Steppe; Subtropical Forest; Savanna; Deserts and Semideserts; Tropical Rainforest.
- **Kernels:** 2-D kernel density plots for every cluster are in Appendix III ([doi:10.3112/erdkunde.2021.04.01b](https://doi.org/10.3112/erdkunde.2021.04.01b)).
- **Licence:** the journal site shows a CC BY 4.0 badge ([erdkunde.uni-bonn.de](https://www.erdkunde.uni-bonn.de/)) **[partially verified: not printed in the article]**.
- **Related:** Fischer et al. 2022 (*Global Ecol. Biogeogr.*), "The biome inventory", standardises the digitised biome maps ([PDF](https://epub.uni-bayreuth.de/7130/1/Global%20Ecology%20and%20Biogeography%20-%202022%20-%20Fischer%20-%20The%20biome%20inventory%20Standardizing%20global%20biogeographical%20land%20units.pdf)) **[not read]**.

### 6.2 Jiang, Felzer, Nielsen & Medlyn 2017 (*Global Ecol. Biogeogr.* 26:1270)

- **Paper:** biomes are usually classified by MAT and MAP, "but there is significant overlap between biomes". Temperature and precipitation **predictability** separate them better (abstract via [Western Sydney University](https://researchers.westernsydney.edu.au/en/publications/biome-specific-climatic-space-defined-by-temperature-and-precipit/)) **[partially verified: abstract]**.
- **Data:** the code repository ([GPL-3.0](https://github.com/mingkaijiang/biome_specific_predictability)) ships `data/cru_biome_data/CRU_biome.csv` (1.5 MB), with columns `CRU_Site, lon, lat, BIOME, REALM`. It gives the WWF/Olson biome code (1–14) for each CRU 0.5° land cell. Joined with a CRU climatology, it gives an empirical MAT × MAP cloud per WWF biome.
- **Plots:** the plotting functions include `plot_biome_density_plot.R` and `plot_biome_bagplot.R` (file list).

### 6.3 Poppenwimer, Mayrose & DeMalach 2023 (*Nature*; arXiv CC BY 4.0)

- **Fig. 2B:** each ecoregion is plotted in "total yearly precipitation and mean yearly temperature space" against an orange Whittaker outline. Ecoregions outside the outline take the closest biome; ambiguous ones are enlarged "until one biome had a plurality of the circle's area" (Methods, pp. 19–20 of [arXiv:2304.13101](https://arxiv.org/pdf/2304.13101)).
- **Why Whittaker:** chosen "for its simplicity of using only temperature and precipitation".

### 6.4 Navarro, Merino, García-Ortega & Tapiador 2025 (*Sci. Data* 12)

- **Scope:** uncertainty maps for Whittaker–Ricklefs, Holdridge, Thornthwaite–Feddema and Köppen from 52 CMIP6 models ([PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC11711615/), CC BY 4.0).
- **Whittaker:** "We followed the delineation of Whittaker's biomes as described by Ricklefs"; "Outliers were assigned the climate type of the closest biome".
- **Code:** `whittaker/whittaker.R` loads `plotbiomes::Whittaker_biomes_poly` (L28), divides mm by 10 because "biomeplot use cm not mm" (L35), and takes the nearest polygon by `gDistance` (L47–49) ([commit `ccc1b83`](https://github.com/navarro-esm/uncertainty_maps_library/blob/ccc1b835fcea49640772b178b8626125bdd45336/whittaker/whittaker.R#L28-L49)).
- **Holdridge:** see §3.5. Fig. 2 is a Whittaker diagram.

### 6.5 Moncrieff, Hickler & Higgins 2015 (*Global Ecol. Biogeogr.* 24:324)

Biomes occupy different climate envelopes on different continents. Mediterranean-type and treeless biomes diverge most; savanna and boreal forest overlap most. The paper uses nine climatic and two soil variables (abstract and summaries, e.g. [Peeref](https://www.peeref.com/works/9963100)) **[partially verified]**. It is context for why any single T × P chart is approximate.

---

## 7. Searched for, not found or not verified

- **Chapin, Matson & Vitousek, *Principles of Terrestrial Ecosystem Ecology*:** a Whittaker-style figure is widely attributed to the book, but its figure number and content were not found **[unverified]**.
- **Bonan, *Ecological Climatology*, and the CLM-DGVM bioclimatic limits:** the CLM-DGVM technical description (Levis et al. 2004, NCAR/TN-459+IA) probably holds the PFT limit table. It was not read **[unverified]**.
- **IGBP/MODIS land cover in T × P space:** no open figure was found. A recipe exists: MCD12C1 plus WorldClim or CHELSA, as E2 does with WWF biomes.
- **A Python package with biome polygons:** none found. The `geco-bern` textbook "Land ecosystems and climate" (Fig. 2.12) draws its Whittaker chart with `plotbiomes` ([page](https://geco-bern.github.io/les/biogeography.html)).
- **OpenStax "Major terrestrial biomes in the world" (Commons):** a map, not a climate chart ([file page](https://commons.wikimedia.org/wiki/File:Major_terrestrial_biomes_in_the_world.png)).

---

## 8. Which charts to use for sandbox4 (Design note)

Everything in this section is my own judgement.

**What sandbox4 does now.** `classify()` (`biomes.ts` L148–169) is a thermal-belt × aridity table. The belts are −10 / −3 / 3 / 18 °C; aridity is m = P / (20·T + 140). This is closer to Holdridge (humidity relative to a temperature-dependent demand) than to Whittaker or Azgaar, whose moisture bands ignore temperature. Its thresholds were calibrated against the `plotbiomes` grid (`biomes.ts` L19–22).

1. **Keep `plotbiomes` (A3) as the Whittaker reference, but treat its boundaries as soft.** It is the only MIT-licensed, finely digitised Whittaker set. The catalog shows that redraws disagree by about 4–5 °C on the cold boundaries (§1, finding 1).
   - So matching `plotbiomes` cell by cell is not a goal.
   - Matching its *topology* is: tundra → boreal → temperate → tropical with rising T; desert → grassland/woodland → forest → rain forest with rising P; the triangle's empty cold–wet corner.
2. **Draw sandbox4's own chart.** The user's PNG shows the `plotbiomes` grid. A matching chart of `classify(t, p)` on the same axes (−14…30 °C × 0…4500 mm), with the `plotbiomes` outlines overlaid, would show directly where the generator departs from Whittaker. A Köppen B line (P = 10·P_th) and Holdridge guide lines can be overlaid as well.
3. **Holdridge is the best source of explicit, reusable thresholds.** The numbers (guide lines at powers of 2, centres at √2 offsets, the frost line ≈ 16.97 °C) are facts from Holdridge 1967 and can be reimplemented. The GPL code of `macroBiome` and `Ternary` should not be copied.
   - Use log-space distances, as macroBiome does (§3.4), not Navarro's linear distances (§3.5).
   - For bit-exactness, the log₂ comparisons become comparisons of products against powers of 2 (`biomes-and-climate.md` §7.4).
4. **Mediterranean (sclerophyll) needs seasonality.** A7 and A8 give sclerophyll a T × P region (about 13–20 °C, 700–1300 mm). Ricklefs and Walter tie it to winter rain (§5.2). If sandbox4 wants a Mediterranean biome without a seasonality field, a small A7-like region (with a hash-based patchiness) is a defensible approximation.
5. **Use the empirical sources only as a reality check.** E1 Fig. 6 (means and interquartile ranges per biome cluster) and E2's `CRU_biome.csv` show where real biomes sit and how much they overlap. They suit a sanity test of sandbox4's class areas, not a lookup table.
6. **Game tables (F1–F3) are good models for the code, not for the numbers.** Azgaar's matrix is the closest analogue (°C columns × precipitation bands, plus glacier/wetland overrides). Its temperature-independent moisture bands are what sandbox4's aridity ratio deliberately improves on.
7. **For an image in the docs or UI:** the Navarras chart (A5) is CC0 and needs no attribution. Pengo (B2) is CC BY-SA 4.0 and the Fährtenleser charts (A7–A9) are CC BY-SA 3.0; both need attribution and share-alike. The Ricklefs figure and the `plotbiomes` README image derive from a copyrighted textbook figure.

---

## 9. Sources

**Charts and books**

- Ricklefs, R. E. *The Economy of Nature*, Chapter 5, "The Biome Concept in Ecology", pp. 87–112 (Figs. 5.4–5.6). Read from a course copy: https://www.ecologia.polimi.it/wp-content/uploads/2016/03/chap5_ricklefs_biomes.pdf **[partially verified: edition]**
- Whittaker, R. H. *Communities and Ecosystems*, Macmillan, 1970; 2nd ed. 1975 **[not read]**.
- Holdridge, L. R. *Life Zone Ecology*, rev. ed., 1967 (see `biomes-and-climate.md` §2.2). https://app.ingemmet.gob.pe/biblioteca/pdf/Amb-56.pdf
- Wikimedia Commons files (author, date, licence from the Commons API):
  - Climate_influence_on_terrestrial_biome.svg (Navarras, CC0). https://commons.wikimedia.org/wiki/File:Climate_influence_on_terrestrial_biome.svg
  - Modification_of_Whittaker_Biome_Map_for_Global_Climate_Space.jpg (Jcraine, CC BY-SA 3.0). https://commons.wikimedia.org/wiki/File:Modification_of_Whittaker_Biome_Map_for_Global_Climate_Space.jpg
  - Gliederung der Klimavegetation nach Dansereau-Whittaker (1957 & 1970).png; Klimatische Gliederung terrestrischer Pflanzenformationen (1961–1990).png; Mittlere jährliche Temperatur- und Niederschlagswerte terrestrischer Pflanzenformationen (1961–1990).png (Fährtenleser, CC BY-SA 3.0). Links in §2.6.
  - Lifezones_Pengo.svg and variants (Peter Halasz, CC BY-SA 4.0 / 2.5); Holdridge_FR.png (Lucquessoy, CC BY-SA 3.0). Links in §3.2.

**Packages and code** (fetched at the SHAs given)

- `plotbiomes`, valentinitnelav, `19dfcaf`, MIT. https://github.com/valentinitnelav/plotbiomes
- `BIOMEplot`, kunstler, `3edd582`, GPL ≥ 2. https://github.com/kunstler/BIOMEplot
- `ggbiome`, guillembagaria, GPL-2.0. https://github.com/guillembagaria/ggbiome
- `Ternary`, ms609, `f22bed2`, v2.3.7, GPL ≥ 2. https://github.com/ms609/Ternary
- `macroBiome`, szelepcsenyi, `4e33f3d`, v0.3.0, GPL ≥ 3. https://github.com/szelepcsenyi/macroBiome
- `uncertainty_maps_library`, navarro-esm, `ccc1b83`, no licence. https://github.com/navarro-esm/uncertainty_maps_library
- `biome_specific_predictability`, mingkaijiang, GPL-3.0. https://github.com/mingkaijiang/biome_specific_predictability
- `mapgen2` (ActionScript), amitp, `d0b0946`, MIT. https://github.com/amitp/mapgen2
- `mapgen2` (HTML5), redblobgames, `f16f485`, Apache-2.0. https://github.com/redblobgames/mapgen2
- Fantasy Map Generator, Azgaar, `5aa93ef`, MIT. https://github.com/Azgaar/Fantasy-Map-Generator
- `climatol` (CRAN), GPL ≥ 3. https://cran.r-project.org/web/packages/climatol/index.html

**Papers**

- Beierkuhnlein, C. & Fischer, J.-C. "Global biomes and ecozones – conceptual and spatial communalities and discrepancies." *Erdkunde* 75(4):249–270, 2021. https://www.erdkunde.uni-bonn.de/article/download/2918/2908/2922 (Fig. 6 and Methods read)
- Jiang, M., Felzer, B., Nielsen, U. N. & Medlyn, B. E. "Biome-specific climatic space defined by temperature and precipitation predictability." *Global Ecol. Biogeogr.* 26:1270–1282, 2017. https://doi.org/10.1111/geb.12635 **[partially verified: abstract and code]**
- Poppenwimer, T., Mayrose, I. & DeMalach, N. "Revising the global biogeography of annual and perennial plants." *Nature*, 2023; arXiv:2304.13101 (CC BY 4.0). https://arxiv.org/abs/2304.13101 (Fig. 2 and Methods read)
- Navarro, A., Merino, A., García-Ortega, E. & Tapiador, F. J. "Uncertainty maps for model-based global climate classification systems." *Sci. Data* 12, 2025. https://pmc.ncbi.nlm.nih.gov/articles/PMC11711615/
- Moncrieff, G. R., Hickler, T. & Higgins, S. I. "Intercontinental divergence in the climate envelope of major plant biomes." *Global Ecol. Biogeogr.* 24:324–334, 2015. https://doi.org/10.1111/geb.12257 **[partially verified: abstract summaries]**
- Prentice, I. C. et al. "A global biome model based on plant physiology and dominance, soil properties and climate." *J. Biogeogr.* 19:117–134, 1992. https://doi.org/10.2307/2845499 **[not read; via macroBiome]**
- Sisneros, R. et al. 2011 (Holdridge centroids), cited by Navarro's `hlz.ncl` **[not read]**.

**Procedural generation**

- Patel, A. "Polygon map generation, part 2" (blog), 2010. https://simblob.blogspot.com/2010/09/polygon-map-generation-part-2.html
- Minecraft Wiki, "World generation". https://minecraft.wiki/w/World_generation **[partially verified]**
