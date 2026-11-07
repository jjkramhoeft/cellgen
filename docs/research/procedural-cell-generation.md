# Procedural Cell Generation for World Generation: A First-Pass Survey

*Research date: 2026-11-07. Scope: techniques an engineer can implement in a world-generation sandbox.*

**How to read the citations**

- Each claim links to the source it came from. Primary sources (papers, the author's own pages, the author's source code) were preferred and were read directly unless noted.
- **[unverified]** means the claim could not be checked against a primary source during this pass. It is either general knowledge or from a secondary or bibliographic record only.
- **[partially verified]** means the primary source exists and is cited, but only part of the claim could be confirmed (for example, from the abstract or from an implementation rather than the paper body).
- Where a primary page was unreachable, the note says so. Two examples: Amit Patel's 2010 Stanford-hosted article refused connections, and Inigo Quilez's site returned 404 for every article on the research date.
- Text marked "Recommendation" or "Design note" is my own engineering judgement, not a sourced claim.

---

## 1. Overview

"Cell" means at least four different things in procedural world generation. A sandbox will probably need more than one of them at once.

| Meaning | The cell is... | Typical job |
|---|---|---|
| **Space partition** | A Voronoi polygon (or Delaunay triangle) around an irregularly placed point | Organic map regions: land/water, elevation, rivers, biomes, political regions |
| **Grid cell** | A square, hex or triangle tile on a regular lattice, often grouped into chunks | Indexing, storage, on-demand or infinite generation, tile-level gameplay |
| **Automaton cell** | A grid cell whose state is updated by a local rule each step | Caves, smoothing, erosion, fluid and water flow |
| **Constraint cell** | A grid slot holding a set of still-possible tiles until it "collapses" | Tile layouts (towns, dungeons, decoration) that obey adjacency rules |

Across all four, per-cell attributes (elevation, moisture, temperature, biome) usually come from coherent noise (Perlin, Simplex, Worley, fBm, domain warping). Simulation passes then refine them: drainage, erosion, wind and rain.

The main architectural decision is *which cell structure owns which layer of the world*. Section 9 proposes an answer.

---

## 2. Cell-based space partitioning (Voronoi / Delaunay)

### 2.1 What it is

You scatter points (sites), then partition the plane so that each location belongs to its nearest site. The result is the Voronoi diagram. Its dual, connecting sites whose cells share an edge, is the Delaunay triangulation.

Map generators use this dual pair as an irregular "grid":

- Voronoi polygons are the regions.
- Delaunay edges are region adjacency.
- Triangles, or Voronoi vertices, are the corners where rivers and coastlines can run.

Red Blob Games' mapgen2 builds each point into a polygonal region and each Delaunay triangle into a "corner". It places the triangle's vertex at the **centroid** rather than the circumcenter, because centroids are more evenly spaced ([Red Blob Games, mapgen2 polygon map generation, 2017–2023](https://www.redblobgames.com/maps/polygon-map-generation/)).

### 2.2 Step 1: choosing the points

| Method | How | Notes |
|---|---|---|
| Uniform random | `n` independent uniform points | Clumps and gaps. Red Blob rejects it as unevenly distributed ([Red Blob mapgen2](https://www.redblobgames.com/maps/polygon-map-generation/)). |
| Jittered grid | One point per lattice square, offset randomly | Azgaar's Fantasy Map Generator (FMG) uses a square lattice with spacing `sqrt(width*height/points)`. Each point is shifted by up to ±0.9 × half the spacing per axis, and pseudo-points are added one spacing outside the map so edge cells are bounded ([FMG `docs/prd/grid-sampling.md`](https://github.com/Azgaar/Fantasy-Map-Generator/blob/master/docs/prd/grid-sampling.md)). The same document reports that, with jitter set to 0 on a hex lattice, the Voronoi step yields perfect hexagons in the interior. Jitter is therefore a single knob from "regular grid" to "organic". |
| Lloyd relaxation | Repeatedly move each site to the centroid of its Voronoi cell | Lloyd's 1982 paper is about optimal (least-squares) quantization in PCM ([Lloyd, IEEE Trans. Inf. Theory 28(2), 1982, DOI 10.1109/TIT.1982.1056489](https://doi.org/10.1109/TIT.1982.1056489)). The 2D "Voronoi relaxation" use is the same centroid-iteration idea **[partially verified: bibliographic record and secondary summaries only]**. Martin O'Leary's generator does exactly **one** relaxation pass on uniform random points ([mewo2/terrain `terrain.js`, `generateGoodPoints` → `improvePoints(pts, 1)`](https://github.com/mewo2/terrain/blob/master/terrain.js)). Red Blob's first (2010) version used Lloyd relaxation ([Red Blob mapgen2](https://www.redblobgames.com/maps/polygon-map-generation/)). |
| Poisson-disc (Bridson) | Blue-noise samples, at least `r` apart | This is the current Red Blob choice ([Red Blob mapgen2](https://www.redblobgames.com/maps/polygon-map-generation/)). Details below. |

**Bridson's algorithm** ([Bridson, "Fast Poisson Disk Sampling in Arbitrary Dimensions", SIGGRAPH 2007 sketch](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf)):

- **Inputs:** the domain in Rⁿ, the minimum distance `r`, and the attempt limit `k`. The paper says `k` is typically 30.
- **Step 0:** make a background grid with cell size bounded by `r/√n`, so each cell holds at most one sample. Store it as an n-D int array, with -1 meaning empty.
- **Step 1:** pick a random initial sample, put it in the grid, and start the "active list" with it.
- **Step 2:** while the active list is non-empty, choose a random active sample. Try up to `k` candidates drawn uniformly from the annulus between `r` and `2r` around it. Accept the first candidate that is at least `r` from all neighbours (checked through the grid). If none of the `k` succeeds, remove the sample from the active list.
- **Complexity:** step 2 runs exactly `2N-1` times for `N` samples, so the whole algorithm is **O(N)** for constant `k`.

Design note: Bridson produces a *global* sample set grown from one seed. That works for finite maps. Infinite or chunked worlds need a locally computable variant, such as a per-chunk Poisson set with boundary handling, or a hashed jittered grid (see 3.4).

### 2.3 Step 2: triangulating

| Algorithm | Idea | Complexity | Notes |
|---|---|---|---|
| **Fortune's sweepline** | Sweep a line across the sites, maintaining a "beach line" of parabolic arcs. Emits Voronoi vertices at circle events. | O(n log n) time, O(n) space ([Fortune, "A sweepline algorithm for Voronoi diagrams", Algorithmica 2:153–174, 1987, DOI 10.1007/BF01840357](https://doi.org/10.1007/BF01840357)) **[partially verified: bounds from the abstract and indexed copies; paper body not read]** | Builds Voronoi directly. Fiddly to implement robustly. |
| **Bowyer–Watson** (incremental) | Insert points one at a time. Delete every triangle whose circumcircle contains the new point, then re-triangulate the hole as a star from the new point. | Expected ~O(n log n) with good point location, O(n²) worst case **[unverified: neither abstract states a bound]** | Published back to back: [Bowyer, "Computing Dirichlet tessellations", Comput. J. 24(2):162–166, 1981](https://doi.org/10.1093/comjnl/24.2.162) and [Watson, "Computing the n-dimensional Delaunay tessellation with application to Voronoi polytopes", Comput. J. 24(2):167–172, 1981](https://doi.org/10.1093/comjnl/24.2.167). Both are k-/n-dimensional. Easy to write and a good teaching implementation. |
| **Sweep-hull (Delaunator)** | Radial sweep plus edge flips | Delaunator's README reports about 1.07 s for 1M uniform points and about 25–82 ms for 100k points (2017 MacBook Pro) | The library cites S-hull (Sinclair 2010), Liu Yonghe et al. 2013 and Biniaz & Dastghaibyfard 2011 as influences. It uses Shewchuk-style robust predicates, so it should handle degenerate input ([mapbox/delaunator](https://github.com/mapbox/delaunator)). Ports exist for Rust, C++, C#, Go, Python, Java, Kotlin, Julia and more. Both mapgen2 and mapgen4 use it. |

**Delaunator's representation**, which is worth copying as the sandbox's mesh format ([Delaunator guide](https://mapbox.github.io/delaunator/)):

- `triangles[e]` is the start point of half-edge `e`.
- `halfedges[e]` is the opposite half-edge, or `-1` on the convex hull.
- Triangle `t` owns half-edges `3t`, `3t+1` and `3t+2`.
- **Voronoi edges** join the circumcenters (or centroids) of `floor(e/3)` and `floor(halfedges[e]/3)`.
- To **circulate around a point**, alternate `nextHalfedge` and `halfedges`.
- Hull cells need special handling: skip them, add ghost triangles, or clip them.

All of this is flat integer arrays, so it is cache- and serialization-friendly.

### 2.4 Polygon-map pipelines (worked examples)

**Red Blob Games, mapgen2** (an HTML5 recreation of the 2010 "Polygonal Map Generation for Games", built for *Realm of the Mad God*) ([page](https://www.redblobgames.com/maps/polygon-map-generation/), [mapgen2 landing page](https://www.redblobgames.com/maps/mapgen2/), [source, Apache-2](https://github.com/redblobgames/mapgen2)):

The original 2010 article at `www-cs-students.stanford.edu/~amitp/game-programming/polygon-map-generation/` was unreachable on the research date. The summary below comes from the author's own 2017 recreation.

1. **Points:** Poisson disc.
2. **Mesh:** Delaunay plus centroid dual.
3. **Water:** noise plus a falloff toward the map edge decides water and land. Water connected to the border is ocean, enclosed water is lake, and coast is any land/ocean edge.
4. **Elevation:** a breadth-first search (BFS) from the coastline gives distance to coast. It is mapped to -1..0 in the ocean and 0..1 on land, and stored on corners; a region's elevation is the average of its corners. The author calls the result simplistic and "volcanic". Reshaping the distribution is listed as TODO.
5. **Drainage:** each corner points to its lowest neighbour, forming an acyclic drainage graph. Lakes are handled imperfectly.
6. **Rivers:** choose a random subset of drainage leaves as sources, then follow drainage downstream.
7. **Moisture:** BFS distance from fresh water over land, then a sqrt rescale.
8. **Biome:** a Whittaker-style lookup on temperature (elevation and latitude) and moisture.
9. **Noisy edges:** recursive subdivision of boundaries, controlled by levels and amplitude.

**Red Blob Games, mapgen4** ([page](https://www.redblobgames.com/maps/mapgen4/), [source](https://github.com/redblobgames/mapgen4)):

- **Elevation:** simplex noise sets the large-scale land and water. Individual mountains come from distance fields on blue-noise points, with Worley noise used in places. Painted constraints are added on top. The author notes the mountain look depends on point density (a "sampling artifact"), and reports cutting generation from 5500 ms to 600 ms, aiming for under 100 ms for interactive painting ([elevation post, 2018](https://simblob.blogspot.com/2018/08/mapgen4-elevation.html)).
- **Wind and rain:** regions are sorted along the wind direction with key `cos θ·x + sin θ·y` and visited in that order, so each takes humidity from upwind neighbours. Moisture is capped at `1 − elevation`, and the excess falls as orographic rain; a fraction also falls as ordinary rain. This produces rain shadows. The author calls it fast but approximate, with artifacts such as moisture leaking through mountain passes ([rainfall post](https://simblob.blogspot.com/2018/09/mapgen4-rainfall.html)).
- **Rivers:** rivers live on **triangles** as a forest of binary trees grown from river mouths upstream. The tree is stored as a flat breadth-first array plus parent indices. Flow is accumulated by walking the array in reverse (children before parents), adding rainfall and passing it to the parent ([river representation post](https://simblob.blogspot.com/2018/10/mapgen4-river-representation.html)).

**Martin O'Leary, "Generating fantasy maps"** (@unchartedatlas). The notes page `mewo2.com/notes/terrain/` returned 404 on the research date, so this summary is from the author's code ([mewo2/terrain `terrain.js`, MIT](https://github.com/mewo2/terrain/blob/master/terrain.js)):

- **Mesh:** 16,384 uniform points with one Lloyd pass, then a d3 Voronoi. **Heights live on the Voronoi vertices** (`mesh.vxs`), not on the cells.
- **Heightmap:** a sum of primitives — a random-direction slope, a cone, and 50 Gaussian "mountains" with radius 0.05. It is smoothed 10× by neighbour averaging, then `peaky` = sqrt of the normalized height.
- **Erosion:** first fill sinks. Flux is computed by sorting vertices by descending height and pushing each vertex's flux (initially `1/N`) to its downhill neighbour. The erosion rate is `min(1000·sqrt(flux)·slope + slope², 200)`, normalized and scaled by a random amount in [0, 0.1]. This repeats 5×, with a sink fill each time. This is effectively a stream-power-style incision plus a creep term.
- **Sink filling:** an iterative epsilon-raise fill (ε = 1e-5). Border vertices keep their height; others start at "infinity" and are lowered until every vertex has a strictly downhill path out. This matches the Planchon–Darboux scheme **[unverified attribution: the code does not name it]**.
- **Sea level:** set at a random height quantile in [0.2, 0.6].
- **Later stages:** coast cleanup, then cities placed by a score built from sqrt(flux), territories, and labels.

**Azgaar's Fantasy Map Generator** ([repo](https://github.com/Azgaar/Fantasy-Map-Generator)):

- **Grid:** a jittered square-lattice Voronoi grid, as in 2.2. A second "pack" graph refines it by dropping deep-ocean points and adding coastal midpoints ([grid-sampling PRD](https://github.com/Azgaar/Fantasy-Map-Generator/blob/master/docs/prd/grid-sampling.md)).
- **Heightmap:** built from *templates* — sequences of operations such as `addHill`, `addPit`, `addRange`, `addTrough`, `addStrait`, `modify`, `smooth`, `mask` and `invert`. A hill is a BFS "blob": the start cell gets height `h`, and each neighbour gets `parent^blobPower × U(0.9, 1.1)` until the value drops below 1 ([`heightmap-generator.ts`](https://github.com/Azgaar/Fantasy-Map-Generator/blob/master/src/model/physical/heightmap-generator.ts)).
- **Precipitation:** winds enter from the map edges and are passed along rows and columns of the lattice. They gain humidity over water and lose it over land. Uphill steps add an orographic term, and a per-5°-latitude modifier table approximates the Hadley, Ferrel and polar cells ([`precipitation-generator.ts`](https://github.com/Azgaar/Fantasy-Map-Generator/blob/master/src/model/physical/precipitation-generator.ts)).
- **Rivers:** depressions are resolved by iteratively raising each land cell to just above its lowest neighbour (+0.1), processing cells lowest-first, with lake handling and a bad-progress abort. Flux then flows downhill from high to low cells, and lake outlets are added where inflow exceeds evaporation ([`river-generator.ts`](https://github.com/Azgaar/Fantasy-Map-Generator/blob/master/src/model/physical/river-generator.ts)).
- **Biomes:** a 5 (moisture band) × 26 (temperature band) lookup matrix, plus overrides for marine, permafrost (< −5 °C), hot desert and wetland ([`biomes-generator.ts`](https://github.com/Azgaar/Fantasy-Map-Generator/blob/master/src/model/physical/biomes-generator.ts)).

### 2.5 Key parameters

- Number of cells. O'Leary uses 16k; FMG exposes a "points" setting.
- Point distribution and jitter, or the Poisson `r`.
- Lloyd iterations (0–2 is typical in practice).
- Corner placement: circumcenter or centroid.
- Whether attributes live on regions, corners or both.

### 2.6 Pros and cons

- **Pros:**
  - Organic shapes with no grid artifacts.
  - Far fewer cells than pixels for the same visual detail, so graph algorithms (BFS, flow, territory growth) are cheap.
  - A natural adjacency graph for rivers, borders and pathing.
- **Cons:**
  - Neighbour lookup by coordinates needs a spatial index; FMG keeps a lattice for exactly this reason.
  - Irregular neighbour counts complicate cellular automata and WFC.
  - Global construction makes infinite or chunked worlds harder.
  - Rendering needs polygon fill or rasterization.

---

## 3. Grid cells: square vs hex, chunks, deterministic seeding

### 3.1 Square vs hex vs triangle

Red Blob's grid "parts" article treats squares as the default because they are easy to work with. It treats hexes and triangles as duals, so a coordinate system for one can be adapted to the other, and calls triangles less common for maps ([Red Blob, "Grid parts and relationships"](https://www.redblobgames.com/grids/parts/)).

| | Square | Hex |
|---|---|---|
| Neighbours | 4 by edge, or 8 with diagonals, at two different distances | 6, all sharing an edge |
| Storage | Trivial 2D array | 2D array with offset or axial coordinates (see below) |
| Algorithms | CA rules (Moore and von Neumann neighbourhoods) and WFC are usually defined on squares | Distance, rings and line drawing are clean in cube/axial coordinates |
| Best for | Pixel or tile data, CA, WFC, chunk storage | Strategy maps, movement ranges, more isotropic flow |

**Hex coordinates** ([Red Blob, "Hexagonal Grids"](https://www.redblobgames.com/grids/hexagons/)):

- **Systems:**
  - *Cube* coordinates `(q, r, s)` with `q + r + s = 0` support vector arithmetic.
  - *Axial* is cube with `s` dropped; it is the recommended storage form.
  - *Offset* (odd/even rows or columns) and *doubled* coordinates suit rectangular maps.
- **Distance:** `(|dq| + |dq+dr| + |dr|)/2`, or the maximum of the cube deltas.
- **Pixel to hex:** convert to fractional cube coordinates, round each component, then reset the component with the largest rounding error so the constraint holds.
- **Storage options:** a 2D array with sentinels, a hash map (any shape), or shifted and trimmed row arrays.

### 3.2 Chunked / infinite worlds

The pattern: split the world into fixed-size chunks of N×N cells. Generate a chunk only when it is needed, cache it, and evict or persist it.

The key requirement is that **chunk content is a pure function of (world seed, chunk coordinate)**, plus any lower-resolution global data it reads.

- Red Blob notes that noise-based maps compute each location independently, so any region can be generated on demand by offsetting coordinates ([Red Blob, "Making maps with noise functions"](https://www.redblobgames.com/maps/terrain-from-noise/)).
- Johnson, Yannakakis & Togelius' infinite cave game is a primary example ([Johnson et al., "Cellular automata for real-time generation of infinite cave levels", PCGames 2010](https://www.um.edu.mt/library/oar/bitstream/123456789/22895/1/Cellular_automata_for_real-time_generation_of.pdf)). Its parameters are covered in 4.1.
  - The world is a set of 50×50 "base grids". Each grid's data structure holds its own seed and pointers to its neighbours.
  - The authors state that the same seed and parameters `(r, n, T, M)` regenerate the same cave.
  - When a new grid is created, a few extra CA iterations run across the new grid and its neighbour together to remove seams. If two neighbouring grids are not connected, a tunnel is dug between the closest floor cells near the border.

Design note: neighbour-dependent operations (CA smoothing, WFC, erosion, flow) break pure per-chunk generation. Common fixes:

- (a) Generate with a **halo** (apron) of extra cells, and keep only the interior.
- (b) Run the operation in **phases**, where phase k of a chunk may read phase k−1 of its neighbours (a dependency pyramid).
- (c) Push long-range processes (rivers, climate) into a coarser **global layer** that chunks only sample.

Option (a) is cheapest for CA. Option (c) is needed for rivers. The Johnson et al. seam-smoothing step is a variant of (b), but it makes the result depend on generation order. A sandbox that wants exact reproducibility should avoid that.

### 3.3 Deterministic per-cell randomness (hashing instead of stateful RNGs)

To generate any cell independently and in any order, draw randomness from a **hash of the coordinates** rather than from a sequential RNG. For example, `rand(cell) = hash(seed, stage, x, y)`.

- Jarzynski & Olano evaluated over 100 GPU hash variants for quality (TestU01) and speed ([Jarzynski & Olano, "Hash Functions for GPU Rendering", JCGT 9(3), 2020](https://jcgt.org/published/0009/03/02/paper.pdf)).
  - Their conclusion lists exemplars from fastest to highest quality, for example **pcg3d/pcg4d** for N-D in → N-D out, and **xxhash32** / **pcg** for 1D.
  - They note that the fastest options (LCG, xorshift128) are too low-quality without extra scrambling.
  - They warn that stateful PRNGs which are good sequentially "fall short" when used in parallel with neighbouring seeds. That is exactly the per-cell use case.
- Squirrel Eiserloh's GDC 2017 talk "Math for Game Programmers: Noise-Based RNG" ([GDC Vault](https://gdcvault.com/play/1024365/Math-for-Game-Programmers-Noise)) popularized the same idea for games with the "Squirrel" noise hash, later revised as SquirrelNoise5 **[partially verified: talk listing only; content known through secondary implementations]**.
- Worley's cellular noise already uses this pattern. Each unit cube's feature points come from a fast RNG seeded by the hashed cube ID, so no tables or precalculation are needed ([Worley 1996](https://cedric.cnam.fr/~cubaud/PROCEDURAL/worley.pdf)).

Design note: this same trick gives **infinite Voronoi**. If each lattice cell deterministically owns one (or a few) jittered points, as in Worley noise and FMG's jittered grid, the Voronoi cell containing any location can be found by checking the 3×3 neighbourhood of lattice cells. No global triangulation is needed. Poisson-disc spacing is lost, but jitter ≤ 0.9 keeps cells reasonably regular.

### 3.4 Pros and cons

- **Pros:** O(1) addressing, trivial storage and serialization, native fit for CA and WFC, easy chunking and hashing.
- **Cons:** visible axis artifacts; square grids are anisotropic (diagonal distance is √2); more cells are needed for the same visual detail than with Voronoi; hexes complicate rectangular storage.

---

## 4. Cellular automata

### 4.1 Cave generation (the "4-5 rule")

**RogueBasin method** ([RogueBasin, "Cellular Automata Method for Generating Random Cave-Like Levels"](https://www.roguebasin.com/index.php/Cellular_Automata_Method_for_Generating_Random_Cave-Like_Levels); C code by Jim Babcock):

- **Initial fill:** each cell starts as wall with probability about 45% (40% in the tuned example).
- **Base rule:** a cell becomes wall if its 3×3 neighbourhood *including itself* has at least 5 walls. Repeating it smooths noise into blobs; the intro example uses 5 iterations.
- **Large-hall fix:** `wall if R1(p) ≥ 5 or R2(p) ≤ 1`, where `R2` counts walls within 2 steps (5×5). This seeds pillars in big empty areas. The tuned recipe is 4 iterations with the R2 rule using cutoff 2 (`R2 ≤ 2`), then 3 with plain R1 ≥ 5.
- **Connectivity:** flood fill from a random floor cell, turn unreached floor into wall, and regenerate if the kept area is below about 45% of the map. An alternative is to blank a horizontal strip before iterating so no wall can split the map.
- **Stated weaknesses:** disconnected pockets, occasional giant open spaces, leftover single-tile walls, retries that are impractical on large maps, and unsuitability for towns.

**Johnson et al. 2010** ([paper](https://www.um.edu.mt/library/oar/bitstream/123456789/22895/1/Cellular_automata_for_real-time_generation_of.pdf)):

- **Parameters:**
  - `r` = 50% initial rock.
  - Moore neighbourhood of size `M`.
  - Threshold `T` = 5 ("rock if the neighbourhood value ≥ T").
  - `n` iterations; more iterations give wider caves.
- **Wall cells:** rock cells adjacent to floor are marked as walls.
- **Cost:** `n · w · h · (2M+1)²`. They report about 0.41 ms per 50×50 map on 2010 hardware (C#/XNA).

### 4.2 Conway-style ("Life-like") rules

Life-like CAs are written as birth/survival sets on the Moore neighbourhood. Conway's Life is B3/S23 (popularized by Gardner, "Mathematical Games", *Scientific American* 223(4), Oct 1970) **[unverified: bibliographic only]**.

The 4-5 cave rule is the same family with a threshold rule rather than a birth/survival table. A sandbox CA engine should therefore take:

- the neighbourhood (von Neumann, Moore or radius-R),
- the rule (birth/survival sets or a threshold),
- the iteration count,
- boundary handling (wall, wrap or halo).

### 4.3 Erosion and fluid simulation on grids (CA-like)

- **Pipe-model hydraulic erosion** ([Mei, Decaudin & Hu, "Fast Hydraulic Erosion Simulation and Visualization on GPU", Pacific Graphics 2007](https://inria.hal.science/inria-00402079/document)):
  - **State per cell:** terrain height `b`, water height `d`, suspended sediment `s`, outflow flux to the 4 neighbours `f = (fL, fR, fT, fB)`, and velocity `v`.
  - **Five steps per iteration:**
    1. Add water (rain or sources).
    2. Run shallow-water flow through *virtual pipes*, driven by hydrostatic height differences (the pipe model is credited to O'Brien & Hodgins 1995).
    3. Erode or deposit against the transport capacity `C = Kc · sin(tilt) · |v|`, eroding with `Ks` when `C > s` and depositing with `Kd` when `C < s`.
    4. Advect sediment semi-Lagrangianly, which is unconditionally stable.
    5. Evaporate: `d ← d·(1 − Ke·Δt)`.
  - Every step is a local, data-parallel cell update, which is why it maps well to GPU.
  - **Stated limitation:** on very flat terrain `C → 0`, so flat areas barely erode.
- **Particle ("droplet") hydraulic erosion:**
  - Each droplet runs down the gradient with inertia, picks up sediment up to a capacity, and deposits on slowdown or uphill moves; it evaporates over its lifetime.
  - Parameters: particle count, lifetime, erosion radius, inertia, capacity, erosion, deposition and evaporation rates.
  - Usually credited to H. T. Beyer's thesis "Implementation of a method for hydraulic erosion" **[partially verified: from the [erodr](https://github.com/henrikglass/erodr) implementation README, not the thesis itself]**.
  - Simple to write, CPU-friendly, and good for detail on a heightmap tile.
- **Flux-based erosion on a cell graph:** O'Leary's `sqrt(flux)·slope` plus creep, described in 2.4. It is cheap, works on irregular meshes, and is good for continental scale ([terrain.js](https://github.com/mewo2/terrain/blob/master/terrain.js)).
- **Thermal erosion** (material slumping above a talus angle) is the other classic CA-style pass **[unverified: commonly attributed to Musgrave et al. 1989; not checked]**.

### 4.4 Pros and cons

- **Pros:** tiny code, local rules (GPU-friendly), organic results, deterministic given a seed.
- **Cons:**
  - Needs a grid with a regular neighbourhood.
  - No global guarantees such as connectivity, so a post-pass is needed.
  - Results depend heavily on tuning.
  - Chunk seams need a halo or cross-chunk iterations.
  - Erosion is iterative and expensive at fine resolution.

---

## 5. Constraint-based cell filling: Wave Function Collapse and Model Synthesis

### 5.1 What it is

A grid of cells. Each cell holds a *set* of still-allowed labels (tiles or patterns), and adjacency rules say which labels may be neighbours. The algorithm repeatedly picks a cell, fixes it to one label, and *propagates* the consequences, removing incompatible labels from neighbours, transitively.

### 5.2 How WFC works

From [mxgmn/WaveFunctionCollapse README](https://github.com/mxgmn/WaveFunctionCollapse) and [`Model.cs`](https://github.com/mxgmn/WaveFunctionCollapse/blob/master/Model.cs):

- **Models:**
  - **Overlapping:** extracts every N×N pattern from a sample bitmap (N is typically 3), optionally with rotations and reflections. Adjacency means two patterns agree on their overlap.
  - **Simple tiled:** an explicit tile list plus adjacency data. Tiles carry a D4 symmetry type so only adjacencies up to symmetry need listing.
  - The README compares overlapping to tiled as higher-order to first-order Markov chains.
- **State:** the "wave" holds a boolean per (cell, label), all true at start.
- **Loop:**
  1. **Observe:** pick the unobserved cell with minimal entropy and choose a label weighted by input frequency.
  2. **Propagate:** remove incompatible labels using AC-4-style support counts (`compatible[i][t][d]`), driven by a stack of bans.
  3. Stop when every cell has one label (success) or any cell has zero (contradiction).
- **Heuristics** in code: `Entropy` (weighted Shannon entropy of the remaining labels, with tiny random noise to break ties), `MRV` (fewest remaining values) and `Scanline` (first undecided cell in raster order).
- **Options:** `periodic` (wrapping output), `periodicInput`, `ground` (forces a bottom-row tile), `symmetry`, and `limit`.
- **Contradictions:** the core algorithm does not backtrack; it fails and the caller retries. `Program.cs` tries up to 10 seeds ([`Program.cs`](https://github.com/mxgmn/WaveFunctionCollapse/blob/master/Program.cs)). The README says contradictions are "surprisingly rare" for its examples. It also notes that deciding solvability in general is NP-hard, and that backtracking exists only in forks.
- **Known limitations** (README):
  - "Easy" tilesets that can never contradict give boring, weakly correlated layouts.
  - Poor fit for large full-colour textures.
  - Long-range structure is hard; the README suggests generating a blueprint first.
- **Ecosystem:** used by Bad North, Caves of Qud and Townscaper, among others. Integrations exist for Unity, Unreal 5, Godot 4 and Houdini, and fast-wfc is reported about 10× faster on the overlapping model.

### 5.3 Model synthesis (Paul Merrell) and how it differs

Merrell's model synthesis predates WFC. It was created in 2005 and published in 2007 ([Merrell, "Example-Based Model Synthesis", I3D 2007](https://paulmerrell.org/model-synthesis/); [PhD dissertation "Model Synthesis", UNC 2009](https://paulmerrell.org/wp-content/uploads/2021/06/thesis.pdf); [TVCG 2010](https://paulmerrell.org/wp-content/uploads/2021/06/tvcg.pdf)). Merrell describes the two as "nearly identical" ([model synthesis page](https://paulmerrell.org/model-synthesis/)).

His comparison paper names two algorithmic differences ([Merrell, "Comparing Model Synthesis and Wave Function Collapse"](https://paulmerrell.org/wp-content/uploads/2021/07/comparison.pdf)):

1. **Cell order:**
   - Model synthesis sweeps in **scanline** order; WFC picks the **lowest-entropy** cell.
   - On small outputs the difference is small.
   - On some large textures, min-entropy *greatly* raises the failure rate. His Table 1 has cases where model synthesis succeeds in seconds and WFC fails after more than 20 minutes.
   - He says ordering is the more important of the two differences.
2. **Modifying in blocks:**
   - Model synthesis solves the output in overlapping sub-blocks rather than all at once.
   - For some inputs the problem is NP-hard (dissertation Thm 3.3.4), and the chance of a one-shot success drops off steeply as output size grows.
   - Solving blocks keeps the failure rate low, and when failures occur you shrink the block.
   - Essential for large 3D outputs, which in the dissertation ranged from 9K to 72K voxels.

The comparison also says:

- Both use **AC-4**-style propagation. AC-4 beats AC-3 here because every neighbour pair has the same constraints, so its pre-processing pays off.
- WFC's genuine contribution is the **overlapping-pattern** input, which model synthesis now supports too.

### 5.4 Key parameters

- Label set: tiles or N×N patterns; N controls fidelity versus variety.
- Weights.
- Symmetry.
- Periodic boundaries.
- Cell-order heuristic.
- Block size (model synthesis).
- Pre-constraints: fixed cells such as roads, doors or a ground row.
- Retry or backtrack budget.

### 5.5 Pros and cons

- **Pros:**
  - Local rules give convincing local structure.
  - Easy to author: draw a sample or define tiles and edges.
  - Pre-constraining cells lets you blend WFC with other layers, for example "this cell is a road" coming from a Voronoi or graph layer.
- **Cons:**
  - Can fail; failure grows with size and constraint density.
  - Little global structure.
  - Propagation dominates cost.
  - Large or infinite outputs need block or chunk solving with fixed borders (Merrell's approach), which fits naturally with chunking.

---

## 6. Noise for per-cell attributes

### 6.1 Gradient noise: Perlin

Pseudo-random gradients sit at integer lattice points. A sample point takes the dot product of each surrounding corner's gradient with its offset to that corner, then blends the corners with a smooth fade curve.

**Improved Noise** ([Perlin, reference implementation, © 2002](https://mrl.cs.nyu.edu/~perlin/noise/); companion SIGGRAPH 2002 paper):

- Fade function `6t⁵ − 15t⁴ + 10t³`, replacing the original `3t² − 2t³`. The newer curve gives a continuous second derivative, which matters for displacement and bump mapping ([Gustavson 2005](https://cgvr.cs.uni-bremen.de/teaching/cg_literatur/simplexnoise.pdf)).
- A 256-entry permutation table, doubled to 512 to avoid wrapping.
- Hash `& 15` selects among 12 gradient directions (cube-edge midpoints).
- Interpolation cost is O(2ⁿ) corners in n dimensions. It has visible axis-aligned artifacts.

### 6.2 Simplex and OpenSimplex

**Simplex noise** ([Gustavson, "Simplex noise demystified", 2005](https://cgvr.cs.uni-bremen.de/teaching/cg_literatur/simplexnoise.pdf)):

- Uses the simplex grid: n+1 corners instead of 2ⁿ.
- **Sums** radially attenuated corner contributions ("surflets") instead of interpolating along each axis.
- Cost is O(n) per dimension count rather than O(2ⁿ). It has no noticeable directional artifacts and a cheap continuous gradient.

**2D details** (Gustavson's code):

- Skew factor `F2 = (√3 − 1)/2`, unskew `G2 = (3 − √3)/6`.
- Kernel `(0.5 − d²)⁴ · (g·d)`, output scaled by 70.
- 3D uses `F3 = 1/3`, `G3 = 1/6`, kernel radius² 0.6, scale 32.
- Caveat: simplex is *not* a drop-in replacement. Feature size, range and statistics differ, and a 3D slice of 4D simplex differs from 3D simplex.

**Patent:** Perlin held US patent 6,867,776 on simplex noise **[unverified: whether it has expired; it is commonly reported to have expired in 2022]**.

**OpenSimplex2** ([KdotJPG/OpenSimplex2](https://github.com/KdotJPG/OpenSimplex2), mostly CC0) offers two variants:

- **OpenSimplex2 (F):** Simplex-like and about as fast.
- **OpenSimplex2S:** smoother, with larger kernels; recommended for ridged noise.

It supports 2D, 3D and 4D, and offers an "ImproveXY" orientation so 2D slices of 3D noise behave consistently when Z is time or a seed axis. The author states, as a non-lawyer, that no patent claims cover the implementations. For a new codebase, OpenSimplex2 (or a vetted Simplex port) is the safe default.

### 6.3 Worley / cellular noise

**Definition** ([Worley, "A Cellular Texture Basis Function", SIGGRAPH 1996, DOI 10.1145/237170.237267](https://cedric.cnam.fr/~cubaud/PROCEDURAL/worley.pdf)):

- Scatter feature points through space. `F1(x)` is the distance to the nearest point, `F2(x)` to the second nearest, and so on, with `0 ≤ F1 ≤ F2 ≤ …`.
- F1 is continuous, but its derivative jumps on Voronoi boundaries.
- Combinations such as `F2 − F1` give cell walls, cracks and flagstones.

**Computation:**

- Space is divided into unit cubes. Each cube's point count is drawn from a Poisson distribution, using an LCG seeded by the hashed cube ID. Worley forbids empty cubes, trading a little isotropy to bound the search.
- Neighbouring cubes are searched only if they could hold a closer point, typically 1–3 extra cubes.
- Computing F1 and F2 together costs about one octave of Perlin noise. Worley found a mean density λ ≈ 3 most efficient.

**Use in world generation:** Voronoi-style region IDs without a mesh (an infinite plates or provinces layer), crater and mountain fields (mapgen4 uses it for peaks), and biome patchiness.

### 6.4 fBm, ridged noise, redistribution, islands

Red Blob's noise article gives concrete formulas ([Red Blob, "Making maps with noise functions"](https://www.redblobgames.com/maps/terrain-from-noise/)):

- **fBm (octaves):**
  - `e = Σ aᵢ·noise(fᵢ·p) / Σ aᵢ`, with `fᵢ = 2ⁱ` and amplitudes 1, ½, ¼ (the page also uses 1, ½, ⅓, ¼, ⅕).
  - Offset or reseed each octave to decorrelate it, and rotate octaves (or use simplex) to hide grid alignment.
  - Key parameters: octaves, lacunarity (frequency ratio, usually 2), gain or persistence (amplitude ratio, usually ½), and base frequency (`wavelength = map_size / frequency`).
- **Redistribution:** `e = pow(e·fudge, exponent)`. Exponents above 1 flatten valleys and sharpen peaks. Terraces come from `round(e·n)/n`.
- **Ridged noise:** `2·(0.5 − |0.5 − noise|)`. Higher octaves can be weighted by the lower ones so detail appears only on ridges.
- **Islands:** mix `e = lerp(e, 1 − d, mix)` with a distance shape. Options are a square bump `d = 1 − (1 − nx²)(1 − ny²)` or Euclidean² `d = min(1, (nx² + ny²)/√2)`.
- **Wraparound:**
  - A cylinder samples 3D noise on a circle, e.g. `(cos(2πx)/2π, sin(2πx)/2π, y)`.
  - A torus samples 4D noise on two circles.
  - Rescale by √1.5 (3D) or √2 (4D), because higher-dimensional noise has a narrower range.
- **Object placement:** use a local maximum of high-frequency noise within radius R, though the page recommends Poisson disc or jittered grids instead.

### 6.5 Domain warping

Domain warping evaluates a pattern at a displaced position, `f(p + h(p))`. It is typically fBm warped by fBm, sometimes twice, using intermediate vector fields `q` and `r` (with arbitrary offset vectors to decorrelate components). The result is swirly, flowing, geologically folded-looking structure ([Inigo Quilez, "Domain warping"](https://iquilezles.org/articles/warp/)).

**[partially verified]** The article returned 404 on the research date. The structure above (fBm of fBm, double warp through `q` and `r`) is confirmed only through search-index excerpts of that page, not a full read. Exact constants are not reproduced here.

Inigo Quilez's fBm article (Hurst exponent H, gain G = 2^−H, with H = 1 giving terrain-like spectra) was also unreachable **[unverified]**.

### 6.6 From elevation and moisture to biomes (Whittaker)

Whittaker's biome diagram classifies biomes by mean annual temperature and precipitation (R. H. Whittaker, *Communities and Ecosystems*, 1975) **[unverified: book not consulted; the generators below cite it]**.

Generators approximate it in three ways:

- **Elevation + moisture table** (Red Blob):
  - Elevation stands in for temperature, and moisture for precipitation.
  - Example thresholds (to be tuned): `e < 0.1` ocean, `< 0.12` beach. In the high band (`e > 0.8`), moisture runs scorched → bare → tundra → snow at 0.1/0.2/0.5. Lower bands step through temperate desert, shrubland, taiga, grassland, deciduous and rain forest, and subtropical desert to tropical rain forest.
  - The triangular diagram is stretched into a square by using *relative* moisture.
  - A latitude term can be added, e.g. `10e² + poles + (equator − poles)·sin(π·y/height)`, which the author says is "not necessarily the best" ([Red Blob noise article](https://www.redblobgames.com/maps/terrain-from-noise/)).
- **Temperature × moisture matrix** (FMG):
  - Temperature from latitude and elevation, precipitation from the wind model.
  - Lookup in a 5×26 matrix, with special cases for water, glacier, hot desert and wetland ([`biomes-generator.ts`](https://github.com/Azgaar/Fantasy-Map-Generator/blob/master/src/model/physical/biomes-generator.ts)).
- **Simulated moisture** (mapgen4): rainfall from a wind sweep, as in 2.4.

**Moisture sources compared:**

- *Independent noise* (cheap, but uncorrelated with terrain).
- *Distance to fresh water* (mapgen2).
- *Wind/rain sweep* (mapgen4, FMG). This gives rain shadows and wet coasts and costs a sort plus one pass.

### 6.7 Pros and cons

- **Pros:** stateless and evaluable at any point (perfect for chunks and infinite worlds), cheap, smooth, controllable through a few parameters.
- **Cons:**
  - No physical meaning: rivers do not flow downhill to the sea on their own, mountain ranges are not linear, and biomes ignore rain shadows.
  - Needs redistribution and masks to look intentional.
  - Statistically homogeneous ("everywhere looks the same").
  - Hence usually combined with simulation passes on a cell graph.

---

## 7. Other notable approaches

- **Tectonic plates:**
  - Cortial, Peytavie, Galin & Guérin ([Procedural Tectonic Planets, Computer Graphics Forum 38(2), Eurographics 2019, DOI 10.1111/cgf.13614](https://doi.org/10.1111/cgf.13614)) replace physical simulation with procedural approximations of plate motion, subduction, collision and rifting.
  - The output is continents, ridges, mountain ranges and island arcs on a planet, which can then be amplified with procedural or real elevation data.
  - **[partially verified: abstract only]**
  - Cheap sandbox approximation (design note): grow plates as Voronoi or flood-fill regions on the cell graph, give each a random velocity, and raise or lower elevation along boundaries by the sign of relative convergence.
- **Rivers and watersheds on cell graphs:** all four generators in 2.4 follow the same core recipe:
  1. Make the heightfield drainable by filling depressions (or carving outlets, or keeping lakes).
  2. Point each cell to its lowest neighbour, giving a forest of drainage trees.
  3. Accumulate flow by processing cells from high to low (sort by height, O(n log n)) or in reverse topological order. mapgen4 uses a breadth-first array walked backwards.
  4. Rivers are cells or edges with flow above a threshold, and width is a function of flow.
- **Depression filling options:**
  - The iterative epsilon fill used by mewo2: simple, but potentially many passes.
  - FMG's lowest-first raise loop with an iteration cap.
  - Priority-Flood, the standard O(n log n) algorithm in the DEM literature ([Barnes, Lehman & Mulla, Computers & Geosciences 62, 2014](https://doi.org/10.1016/j.cageo.2013.04.024)) **[unverified: not read in this pass]**. Priority-Flood also labels watersheds for free.
- **Erosion as a finishing pass:** see 4.3. Cheap graph-based flux erosion works at continent scale; pipe or particle erosion works on high-resolution heightmap tiles.

---

## 8. Comparison of approaches

| Approach | Cell type | Output | Determinism / chunk-friendly | Cost | Strengths | Weaknesses | Implement effort |
|---|---|---|---|---|---|---|---|
| Poisson-disc (Bridson) | Points | Evenly spaced sites | Global; needs per-chunk variant | O(N) | Blue noise, single parameter `r` | Global growth order | Low |
| Jittered grid | Points on lattice | Sites with O(1) lookup | Yes (hash per lattice cell) | O(N) | Infinite and local; jitter knob from regular to organic | Slight lattice bias | Very low |
| Lloyd relaxation | Voronoi | More uniform cells | Global | O(N log N) per iteration | Pretty, regular cells | Iterative; global | Low (given Voronoi) |
| Delaunay/Voronoi (Delaunator) | Polygons + triangles | Region adjacency graph | Global per map or chunk | O(N log N); ~1 s per 1M points | Organic regions, cheap graph algorithms | Hull cells, spatial lookup needed | Low (use library) |
| Square/hex grid | Tiles | Arrays | Yes, trivially | O(1) access | Simple; CA/WFC native (square); hex isotropic | Grid artifacts | Very low |
| Noise (Perlin/Simplex/fBm/warp) | Any (point-evaluated) | Scalar fields | Yes, stateless | O(octaves) per sample | Infinite, smooth, cheap | No physics or structure | Low |
| Worley noise | Implicit Voronoi | F1/F2 fields, cell IDs | Yes, stateless | About one Perlin octave | Infinite Voronoi-like regions | Distance-only features | Low |
| Cellular automata (caves) | Square grid | Binary maps | Yes, with halo | O(n·w·h·(2M+1)²) | Organic caves, tiny code | Connectivity post-pass, tuning | Very low |
| Pipe-model erosion | Grid | Eroded heightfield, water, sediment | Halo needed; iterative | Many iterations; GPU-friendly | Physically plausible valleys | Expensive, flat-terrain issue | Medium–high |
| Particle erosion | Grid | Eroded heightfield | Order-dependent | Number of particles × lifetime | Simple, good detail | Not parallel-pure; seams | Medium |
| Flux erosion on graph | Voronoi/grid | Eroded heightfield + flux | Global | O(N log N) per iteration | Cheap at continent scale | Approximate | Low |
| WFC (overlapping/tiled) | Square grid | Tile layouts | Seeded; chunks need fixed borders | Propagation-bound; can fail | Authorable local style | Failures at scale, no global structure | Medium |
| Model synthesis (blocks, scanline) | Grid / 3D | Tile layouts, 3D models | Block-wise suits chunks | Similar; far fewer failures at size | Scales to large outputs | More complex to implement | Medium–high |
| Drainage + flow accumulation | Graph | Rivers, watersheds, lakes | Global (or coarse global layer) | O(N log N) | Rivers that make sense | Needs depression handling | Low–medium |
| Wind/rain sweep | Graph/grid | Precipitation, rain shadow | Global | Sort + one pass | Believable climate cheaply | Directional artifacts | Low |
| Tectonic plates | Graph | Continents, ranges | Global | Varies | Large-scale plausibility | Research-grade to do well | Medium–high |

---

## 9. Recommendations for the sandbox

### 9.1 Starting architecture (recommendation)

Build the sandbox around **one abstraction and two scales**.

1. **`CellGraph` interface.**
   - Required: `count`, `neighbors(i)`, `position(i)`, `area(i)`, `cellAt(x, y)`.
   - Optional: dual corners and edges.
   - Implementations:
     - `SquareGrid` (4- or 8-neighbour)
     - `HexGrid` (axial storage, per Red Blob)
     - `VoronoiMesh` (Delaunator-style flat `triangles`/`halfedges` arrays plus centroids)
     - Later, `JitteredLatticeVoronoi`, which is FMG's approach and gives O(1) `cellAt` and locally computable infinite Voronoi.
   - Every algorithm below (BFS distance, drainage, CA, smoothing, territory growth) is written against `CellGraph`, so it runs on all of them.
2. **`Field<T>`:** a typed per-cell attribute array (elevation, moisture, temperature, flux, biome ID). It is serializable and visualizable, and it is the unit you inspect in the sandbox UI.
3. **Stages as pure functions:** `stage(params, seed, graph, inputFields) → outputFields`.
   - Randomness comes only from `hash(worldSeed, stageId, cellKey)`, using pcg3d/pcg4d or xxhash32 per Jarzynski & Olano.
   - No global RNG state, so any stage can be re-run, cached or computed per chunk.
   - Add golden-hash tests on outputs to catch determinism regressions.
4. **Two scales:**
   - **World layer (finite, global):** about 10k–50k Voronoi cells over the whole map. It owns everything that needs long-range information: land/water, plates (optional), elevation, depression filling, drainage, rivers, wind/rain, temperature and biomes. Each run is milliseconds to a few hundred milliseconds, judging by mapgen4's reported 600 ms → 100 ms target, so it can be regenerated interactively.
   - **Local layer (chunked, on demand):** fixed N×N square-grid chunks, generated as `f(worldSeed, chunkXY, sampled world fields)`. This layer owns detail: noise refinement of the world elevation, CA caves, WFC or model-synthesis tile layouts (towns, dungeons, decoration) pre-constrained by world data, and optional particle or pipe erosion on a heightmap tile. Neighbour-dependent passes run on a halo.
5. **Pipeline visualizer:** every stage's fields are viewable as heatmaps or overlays (mesh, drainage arrows, river widths), with every parameter on a slider and the seed in the URL. Red Blob and FMG show this is where most tuning value comes from.

### 9.2 What to prototype first (in order)

1. **Noise-on-grid baseline (about 1 day).**
   - Square grid, OpenSimplex2 fBm elevation with redistribution and an island mask, separate moisture noise, and Red Blob's elevation × moisture biome table.
   - This establishes `CellGraph`, `Field`, hashing, the visualizer and determinism tests.
2. **Voronoi world layer.**
   - Poisson-disc (Bridson) or jittered-lattice points, then Delaunator, then a dual mesh with centroids. Run the same noise stages on it and compare with step 1.
   - Then try FMG-style template heightmaps (hill/pit/range blobs) as an alternative to pure noise.
3. **Hydrology.**
   - Depression filling (start with the simple iterative fill, then Priority-Flood if it is slow), downhill pointers, flow accumulation by height sort, and river extraction with thresholds and widths.
   - Then the mapgen4-style wind sweep for precipitation, feeding flux and biomes.
   - This is the step that most improves believability.
4. **Chunked local layer plus CA caves.**
   - 64×64 chunks seeded by hash, with the RogueBasin tuned rule (40% fill, 4× R1≥5‖R2≤2, then 3× R1≥5), a halo for seams, and flood-fill connectivity.
   - Validates on-demand and infinite generation.
5. **Constraint filling.**
   - Simple tiled WFC on one chunk with pre-constrained cells from the world layer (coast, river, road).
   - Make the heuristic switchable (`Entropy`/`MRV`/`Scanline`). Add Merrell-style block modification once outputs grow, since his data shows scanline order plus blocks matters at size.
6. **Later and optional:** O'Leary-style flux erosion on the world graph (cheap), pipe or particle erosion on local heightmap tiles, Worley-based plates and provinces, domain warping for coastlines, and a hex grid for gameplay overlays.

### 9.3 Default choices (recommendation, revisit after prototypes)

| Decision | Default | Why |
|---|---|---|
| World-layer cells | Voronoi from Poisson-disc, centroid dual | Even cells; matches Red Blob, which reports better spacing with centroids |
| Infinite-world alternative | Jittered lattice (jitter about 0.9) | O(1) lookup and locally computable (FMG, Worley) |
| Local-layer cells | Square grid chunks | CA and WFC are native; trivial storage |
| Noise | OpenSimplex2 / OpenSimplex2S | Quality, CC0 licence, 2D–4D |
| Per-cell RNG | pcg3d / pcg4d hash | Best quality across N-D in/out (JCGT 2020) |
| Mesh library | Delaunator (or a port) | Fast, robust, flat arrays |
| Moisture | Wind sweep | Rain shadows for little cost |

---

## 10. Open questions

1. **Target world type?** Island, continent, planet (sphere) or infinite plane. A sphere changes the mesh (a spherical Delaunay or icosphere) and the noise (3D sampling).
2. **Finite world layer vs truly infinite?** If truly infinite, rivers and climate need a coarse infinite layer, for example hashed lattice Voronoi at continent scale, with bounded-range hydrology. That is an unsolved design area for this project.
3. **Where do region attributes live:** on cells, corners or both? Red Blob stores elevation on corners and averages to regions. O'Leary stores everything on Voronoi vertices. This affects river rendering.
4. **Exact reproducibility across platforms?** Floating-point differences in noise and triangulation across languages or GPUs may break golden-hash tests. The options are fixed-point math or tolerance-based tests.
5. **How strongly should the local layer obey the world layer?** Hard constraints (pre-collapsed WFC cells) or soft ones (biased weights)?
6. **WFC failure policy:** retry, backtrack, or Merrell-style blocks. What failure rate and latency budget is acceptable per chunk?
7. **Is erosion worth it at sandbox scale?** Pipe-model and particle erosion are costly and need tiles with halos. Is graph-level flux erosion enough?
8. **Verification gaps to close later:** read Perlin 2002 and Lloyd 1982 in full, Inigo Quilez's warp and fBm articles once reachable, the original 2010 Red Blob article, O'Leary's notes, Beyer's thesis, and Priority-Flood. Also confirm the simplex patent status.

---

## 11. References

**Space partitioning and sampling**

- Bridson, R. "Fast Poisson Disk Sampling in Arbitrary Dimensions." SIGGRAPH 2007 Sketches. https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf
- Fortune, S. "A sweepline algorithm for Voronoi diagrams." *Algorithmica* 2:153–174, 1987. https://doi.org/10.1007/BF01840357
- Bowyer, A. "Computing Dirichlet tessellations." *The Computer Journal* 24(2):162–166, 1981. https://doi.org/10.1093/comjnl/24.2.162
- Watson, D. F. "Computing the n-dimensional Delaunay tessellation with application to Voronoi polytopes." *The Computer Journal* 24(2):167–172, 1981. https://doi.org/10.1093/comjnl/24.2.167
- Lloyd, S. P. "Least squares quantization in PCM." *IEEE Trans. Information Theory* 28(2):129–137, 1982. https://doi.org/10.1109/TIT.1982.1056489
- Mapbox. Delaunator (library and README). https://github.com/mapbox/delaunator
- Mapbox. "Delaunator guide" (data structures). https://mapbox.github.io/delaunator/

**Polygon and fantasy map generators**

- Patel, A. (Red Blob Games). "Polygonal Map Generation for Games" (2010; original unreachable at research time). http://www-cs-students.stanford.edu/~amitp/game-programming/polygon-map-generation/
- Patel, A. "Polygon map generation" (mapgen2 recreation, 2017–2023). https://www.redblobgames.com/maps/polygon-map-generation/
- Patel, A. mapgen2 landing page and source. https://www.redblobgames.com/maps/mapgen2/ and https://github.com/redblobgames/mapgen2
- Patel, A. mapgen4 page and source. https://www.redblobgames.com/maps/mapgen4/ and https://github.com/redblobgames/mapgen4
- Patel, A. "Mapgen4: elevation." https://simblob.blogspot.com/2018/08/mapgen4-elevation.html
- Patel, A. "Mapgen4: rainfall." https://simblob.blogspot.com/2018/09/mapgen4-rainfall.html
- Patel, A. "Mapgen4: river representation." https://simblob.blogspot.com/2018/10/mapgen4-river-representation.html
- O'Leary, M. mewo2/terrain (`terrain.js`). https://github.com/mewo2/terrain. Notes, 404 at research time: https://mewo2.com/notes/terrain/
- Azgaar. Fantasy Map Generator. https://github.com/Azgaar/Fantasy-Map-Generator. Files read: `docs/prd/grid-sampling.md` and `src/model/physical/{heightmap,precipitation,river,biomes}-generator.ts`

**Grids, chunks, hashing**

- Patel, A. "Hexagonal Grids." https://www.redblobgames.com/grids/hexagons/
- Patel, A. "Grid parts and relationships." https://www.redblobgames.com/grids/parts/
- Jarzynski, M. and Olano, M. "Hash Functions for GPU Rendering." *JCGT* 9(3), 2020. https://jcgt.org/published/0009/03/02/
- Eiserloh, S. "Math for Game Programmers: Noise-Based RNG." GDC 2017. https://gdcvault.com/play/1024365/Math-for-Game-Programmers-Noise

**Cellular automata and erosion**

- RogueBasin. "Cellular Automata Method for Generating Random Cave-Like Levels." https://www.roguebasin.com/index.php/Cellular_Automata_Method_for_Generating_Random_Cave-Like_Levels
- Johnson, L., Yannakakis, G. N., and Togelius, J. "Cellular automata for real-time generation of infinite cave levels." PCGames 2010. https://www.um.edu.mt/library/oar/bitstream/123456789/22895/1/Cellular_automata_for_real-time_generation_of.pdf
- Gardner, M. "Mathematical Games: The fantastic combinations of John Conway's new solitaire game 'life'." *Scientific American* 223(4), 1970. [unverified]
- Mei, X., Decaudin, P., and Hu, B.-G. "Fast Hydraulic Erosion Simulation and Visualization on GPU." Pacific Graphics 2007. https://inria.hal.science/inria-00402079/document
- Beyer, H. T. "Implementation of a method for hydraulic erosion" (thesis). [partially verified via https://github.com/henrikglass/erodr]
- Barnes, R., Lehman, C., and Mulla, D. "Priority-flood: An optimal depression-filling and watershed-labeling algorithm for digital elevation models." *Computers & Geosciences* 62, 2014. https://doi.org/10.1016/j.cageo.2013.04.024 [unverified]

**Constraint-based generation**

- Gumin, M. (mxgmn). WaveFunctionCollapse (README, `Model.cs`, `Program.cs`). https://github.com/mxgmn/WaveFunctionCollapse
- Merrell, P. Model synthesis page (papers, code). https://paulmerrell.org/model-synthesis/
- Merrell, P. "Comparing Model Synthesis and Wave Function Collapse." https://paulmerrell.org/wp-content/uploads/2021/07/comparison.pdf
- Merrell, P. "Model Synthesis." PhD dissertation, UNC Chapel Hill, 2009. https://paulmerrell.org/wp-content/uploads/2021/06/thesis.pdf
- Merrell, P. and Manocha, D. "Model Synthesis: A General Procedural Modeling Algorithm." *IEEE TVCG*, 2010. https://paulmerrell.org/wp-content/uploads/2021/06/tvcg.pdf

**Noise**

- Perlin, K. Improved Noise reference implementation, 2002. https://mrl.cs.nyu.edu/~perlin/noise/
- Gustavson, S. "Simplex noise demystified," 2005. https://cgvr.cs.uni-bremen.de/teaching/cg_literatur/simplexnoise.pdf
- KdotJPG. OpenSimplex2. https://github.com/KdotJPG/OpenSimplex2
- Worley, S. "A Cellular Texture Basis Function." SIGGRAPH 1996. https://doi.org/10.1145/237170.237267 (PDF: https://cedric.cnam.fr/~cubaud/PROCEDURAL/worley.pdf)
- Patel, A. "Making maps with noise functions." https://www.redblobgames.com/maps/terrain-from-noise/
- Quilez, I. "Domain warping." https://iquilezles.org/articles/warp/ [partially verified: 404 at research time]
- Quilez, I. "fBM." https://iquilezles.org/articles/fbm/ [unverified: 404 at research time]
- Whittaker, R. H. *Communities and Ecosystems*, 2nd ed., 1975. [unverified]

**Tectonics**

- Cortial, Y., Peytavie, A., Galin, E., and Guérin, E. "Procedural Tectonic Planets." *Computer Graphics Forum* 38(2), 2019. https://doi.org/10.1111/cgf.13614 [partially verified: abstract]
