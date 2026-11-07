# README Topics: Gap Research (Second Pass)

*Research date: 2026-11-07. Companion to [procedural-cell-generation.md](./procedural-cell-generation.md) (the "first survey"). This pass covers only what the first survey left open from the README's research list: space colonization, distance functions, line networks from noise, deterministic noise in the browser, and browser/GitHub Pages delivery.*

**How to read the citations** (same conventions as the first survey)

- Each claim links to its source. Primary sources (papers, authors' pages and code, specs, MDN, official docs) were read directly unless noted.
- **[unverified]** means the claim could not be checked against a primary source in this pass.
- **[partially verified]** means the primary source exists and is cited, but only part of the claim was confirmed (for example, abstract or metadata only).
- "Design note" or "Recommendation" marks my own engineering reasoning, not a sourced claim. Where a design note is a small derivation, the derivation is given so it can be checked.
- Access note: Inigo Quilez's site, reported as 404 in the first survey, **is reachable** when requested with a browser-like `User-Agent` header. The pages cited below were read in full on the research date.

---

## Contents

1. [Space Colonization Algorithm](#1-space-colonization-algorithm)
2. [Distance functions](#2-distance-functions)
3. [Lines and networks from noise](#3-lines-and-networks-from-noise)
4. [Deterministic noise in the browser](#4-deterministic-noise-in-the-browser)
5. [Browser and GitHub Pages delivery](#5-browser-and-github-pages-delivery)
6. [How this fits the sandbox](#6-how-this-fits-the-sandbox)
7. [Open questions](#7-open-questions)
8. [References](#8-references)

---

## 1. Space Colonization Algorithm

### 1.1 Origin

Two papers by Runions et al. introduced the algorithm:

- **Leaf venation (2005).** Runions, Fuhrer, Lane, Federl, Rolland-Lagan & Prusinkiewicz, "Modeling and visualization of leaf venation patterns", *ACM TOG* 24(3):702–711 (SIGGRAPH 2005), [DOI 10.1145/1073204.1073251](https://doi.org/10.1145/1073204.1073251) ([author page and PDF](http://algorithmicbotany.org/papers/venation.sig2005.html)).
  - Veins grow toward point "auxin sources" in a growing leaf blade. The sources are removed when veins reach them.
  - The paper gives an *open* (tree) variant and a *closed* (looping) variant.
- **Trees (2007).** Runions, Lane & Prusinkiewicz, "Modeling Trees with a Space Colonization Algorithm", Eurographics Workshop on Natural Phenomena 2007, pp. 63–70, [DOI 10.2312/NPH/NPH07/063-070](https://doi.org/10.2312/NPH/NPH07/063-070) ([author page and PDF](http://algorithmicbotany.org/papers/colonization.egwnp2007.html)).
  - This paper extends the open venation algorithm to 3D tree crowns, and is where the name "space colonization" comes from.
- Runions' 2008 M.Sc. thesis gathers both under the same name ([Runions 2008, University of Calgary](https://algorithmicbotany.org/papers/runionsa.th2008.html)).

### 1.2 The core loop (open variant)

Inputs:

- A set of **attraction points** (2005: "auxin sources"). They mark empty space to be colonized.
- One or more **root nodes**.
- Three numeric parameters:
  - **Segment length `D`:** the distance between consecutive nodes.
  - **Radius of influence `d_i`:** also called the *attraction distance*.
  - **Kill distance `d_k`.**

Each iteration does the following ([Runions et al. 2007, §2](http://algorithmicbotany.org/papers/colonization.egwnp2007.html); [Runions et al. 2005, §3.3–3.4](http://algorithmicbotany.org/papers/venation.sig2005.html)):

1. **Associate.** Each attraction point `s` finds its *closest* node `v`. If `|s − v| < d_i`, then `s` joins the influence set `S(v)`.
   - In the 2005 open-venation algorithm there is no `d_i`: every source influences its closest vein node.
   - The 2005 paper breaks ties between equidistant nodes at random.
2. **Grow.** For every node with a non-empty `S(v)`, sum the *unit* vectors `(s − v)/|s − v|`, normalize the sum to get `n̂`, and add a child node at `v + D·n̂`.
   - The 2007 paper adds an optional tropism or weight vector `g`, so the direction becomes `(n̂ + g)/|n̂ + g|`.
3. **Kill.** Remove every attraction point that now has a node closer than `d_k`.
4. **Terminate** when one of these holds:
   - no attraction points remain;
   - no node lies within `d_i` of any remaining point;
   - an iteration limit is reached.

   The first two conditions are stated in the 2007 paper. The iteration limit is my practical addition.

Placing attraction points:

- The 2005 paper places sources by **dart throwing**. A candidate is accepted only if it is farther than birth distance `b_s` from other sources and farther than `b_v` from vein nodes ([2005, §3.3](http://algorithmicbotany.org/papers/venation.sig2005.html)). This is Poisson-disc sampling by rejection.
- The number of darts per step per unit area controls how regular the pattern is.
- With marginal (edge) growth, new sources appear only along the margin.

**Width.**

- Both papers set branch or vein radius with a Murray/pipe-model rule, `rⁿ = r₁ⁿ + r₂ⁿ`, accumulated from the tips back toward the root.
- 2005: Murray's original exponent is `n = 3`, but the paper treats `n` as a free parameter. 2007: `n` is "usually between 2 and 3".

**Closed (looping) variant (2005, §4).**

- A source influences *every* vein node in its **relative neighbourhood**, not only the closest one.
- A source is removed only after all the veins heading toward it have arrived. That lets two veins meet at the same source and form loops (anastomoses).

### 1.3 What the parameters do

From the 2007 paper's figures and discussion:

| Parameter | Effect | Values shown in the paper |
|---|---|---|
| `N` (number of attraction points) | Fewer points give a sparser, more irregular structure, because adding or removing one point swings a tip's direction | N = 12000, 1500, 375 |
| `d_k` (kill distance), as a multiple of `D` | Larger values give a sparser crown with smoother branches, because each tip averages over more points | `d_k` = 2D and 20D |
| `d_i` (radius of influence) | Smaller values make tips meander into and out of zones of influence, producing gnarly, wiggly branches. `d_i = ∞` gives the smoothest result | `d_i` = ∞, 17D, 8D |
| `D` (segment length) | Unit of resolution. Run time "strongly depends" on it, and the authors had no criterion for choosing it | (none given) |

In the 2005 leaf figures, decreasing the kill distance (40, 20, 10, 5, 1) makes the venation denser ([2005, Fig. 9](http://algorithmicbotany.org/papers/venation.sig2005.html)).

Shaping:

- The attraction-point envelope sets the overall shape.
- Concentrating points near the envelope gives denser outer branching ([2007, §3](http://algorithmicbotany.org/papers/colonization.egwnp2007.html)).
- Removing points inside obstacles, or outside a boundary polygon, makes growth avoid or fill them. This is how Jason Webb's 2D implementation does bounds and obstacles ([Webb, Medium write-up](https://medium.com/@jason.webb/space-colonization-algorithm-in-javascript-6f683b743dc5); [code](https://github.com/jasonwebb/2d-space-colonization-experiments)).

### 1.4 Complexity and acceleration

From the 2005 paper, §5.1, with `k` attraction points, `n` nodes and `c` candidate sources per step ([source](http://algorithmicbotany.org/papers/venation.sig2005.html)):

- **Naive cost.** Finding each source's closest node costs O(k·n) per iteration. Candidate insertion costs O(c·(k + n)).
- **Voronoi acceleration.** The authors maintain Voronoi diagrams of sources and nodes and update them incrementally between steps. Nearest-node queries drop to O(k log n) per iteration. Rebuilding from scratch would cost O(n log n + k log k).
- **Grids.** The paper names uniform grids as the alternative space subdivision.
- **Closed variant.** Computing relative neighbourhoods is O(n) average per source with the Delaunay restriction, and approximately constant time with Urquhart's approximation.

Other implementations:

- The 2007 tree implementation used CGAL's 3D Delaunay triangulation. It took seconds to minutes per tree on a 3 GHz desktop ([2007, §4](http://algorithmicbotany.org/papers/colonization.egwnp2007.html)).
- Webb's JavaScript version rebuilds a **KDBush** k-d tree index of the nodes every frame and queries it per attractor. He reports a large but unbenchmarked speed-up. He also notes that a larger attraction distance gives smoother curves but costs more ([Medium](https://medium.com/@jason.webb/space-colonization-algorithm-in-javascript-6f683b743dc5)).

Design note (incremental nearest-node cache):

- Nodes are only ever added, never moved, during growth. So each attraction point can cache its current nearest node and distance.
- After a growth step, query a uniform grid of attraction points (cell size ≈ `d_i`) around each *new* node, and update only the points it improves.
- Kill testing comes for free: if the updated distance is below `d_k`, remove the point.
- Per-iteration cost becomes O(new nodes × local points) instead of O(k·n). This is the same "time coherence" idea the 2005 paper used with Voronoi diagrams, but much simpler to write in JavaScript.

### 1.5 Pitfalls

**Stalled or oscillating tips** (design note).

- If a tip's influencing points lie on opposite sides, the summed unit vectors nearly cancel. `n̂` then becomes noisy or undefined, and the tip can add nodes on top of earlier ones.
- Guards:
  - skip growth when `|Σ| < ε`;
  - reject a new node that falls within about `D/2` of an existing node;
  - choose `d_k > D`. The paper's examples use `d_k ≥ 2D`, and if `d_k < D` a tip can step over a point without killing it.
- None of these guards is described in the papers. They are common-sense fixes **[unverified as standard practice]**.

**Too few points** gives irregular, kinked branches. The 2007 paper explains this as single points swinging the growth direction.

**Determinism** (design note).

- The 2005 paper breaks ties *at random*, and floating-point sums depend on order.
- For reproducible output:
  - break ties by node index;
  - iterate attraction points and nodes in a fixed order;
  - seed attraction-point placement from the stage hash (see §4).

**It is a global, sequential algorithm.**

- The result depends on growth order across the whole domain, so it cannot be computed chunk by chunk like noise.
- In the sandbox's two-scale design (first survey §9.1) it belongs in the **world layer**.

### 1.6 Space colonization for rivers and roads

**Rivers: Feng, Wünsche & Shaw (WSCG 2023).**

- Citation: "Generating Realistic River Patterns with Space Colonization", WSCG 2023 full papers, CSRN 3301, pp. 222–231, [DOI 10.24132/CSRN.3301.26](https://doi.org/10.24132/CSRN.3301.26). Abstract verified via [Crossref](https://api.crossref.org/works/10.24132/CSRN.3301.26).
- The authors modify space colonization with "several extensions" to generate 2D river patterns.
- In a user study with n = 55, some variants produced patterns that participants could not distinguish from real river patterns.
- They state that the method cannot produce all natural river types. They suggest it may suit plausible 2D maps and could become a basis for terrain generation.
- **[partially verified]** Only the abstract and metadata could be read. The University of West Bohemia repository hosting the PDF ([record](https://dspace.zcu.cz/items/0bf59ad5-a46f-4d45-9295-31bf29cac1e2/full)) returned 503 or DNS errors on the research date.
- A search snippet mentions a "Momentum" variant that adds curvature to branches **[unverified]**.
- The parameter values, the attraction-point placement and the growth direction are **not known from this pass**.
- No public code was found.

**Roads: Fernandes & Fernandes (ICGI 2018, Best Paper).**

- Citation: "Space colonisation for procedural road generation", University of Minho ([project page](https://uce-cg.di.uminho.pt/?p=925); [repository record](https://repositorium.uminho.pt/handle/1822/72032); [MSc dissertation PDF](http://www.di.uminho.pt/~arf/storage/gabrielDiasFernandesdissertation.pdf)).
- Phase 1 grows a mostly tree-shaped road layout from user-given seed segments using attraction points. Phase 2 adds interconnections to turn the tree into a network.
- Controls:
  - Kill radius sets how finely the network branches ("capillarity").
  - The number of attraction points per segment sets road hierarchy.
  - An angle control moves the layout between grid-like and organic.
  - Boundary, population-density, flow-field and elevation maps add constraints.
- Output is GeoJSON.
- **[partially verified]** Only the project page could be read. The repository PDF is image-only, so its text could not be extracted, and the dissertation was not read.

**Design note: river-first SCA on a cell world.** This is my own synthesis, untested.

1. **Domain.** Use the land cells of the world-layer `CellGraph`. Voronoi sites from Poisson-disc sampling are already a dart-thrown point set, the same placement the 2005 paper uses for sources.
2. **Attraction points.** Use a subset of land-cell centres. Weight their density by rainfall or moisture, so wetter regions get denser drainage.
3. **Roots.** Use river mouths: coastal cells chosen by hashed selection, with a minimum spacing.
4. **Direction.** Growth runs *upstream*, from mouth to source. Flow is the reverse of the parent links.
   - Optionally bias growth with `g = +k·∇elevation` (uphill) if a heightfield exists.
   - Or build elevation *after* the network, rising with path distance from the mouth. That is the river-first ordering used in hydrology-based terrain work such as Génevaux et al., SIGGRAPH 2013 **[unverified: not read]**.
5. **Width.** Accumulate tip counts or rainfall up the parent chain, then apply the Murray rule with `n ≈ 2–3`.
6. **Snapping (optional).** Snap each new node to the neighbouring cell whose direction best matches `n̂`. Then rivers are edge paths on the cell graph and can share code with the first survey's drainage stages.

Compared with the first survey's flow-accumulation rivers (§7):

- SCA does not need a drainable heightfield or depression filling.
- It gives direct control over density (`d_k`) and wiggliness (`d_i`).
- Nothing guarantees that the rivers run downhill on a pre-existing terrain. That consistency must be enforced (river-first terrain) or checked.

---

## 2. Distance functions

### 2.1 Metrics for cells and Worley/Voronoi

For an offset `d = x − p` from a feature point, standard definitions **[definitions; general knowledge]**:

| Metric | Formula (2D) | Cell shape in a Voronoi/Worley pattern |
|---|---|---|
| Euclidean (L2) | `√(dx² + dy²)` | Convex polygons with straight bisector edges at any angle |
| Squared Euclidean | `dx² + dy²` | *Same* nearest point and same Voronoi diagram as L2, because squaring is monotone. Cheaper (no `sqrt`). Values are no longer linear in distance |
| Manhattan (L1) | `\|dx\| + \|dy\|` | Worley: regions that are "rigidly rectangular, but still random", like right-angle channels ([Worley 1996](https://cedric.cnam.fr/~cubaud/PROCEDURAL/worley.pdf)). Bisectors are made of axis-aligned and 45° pieces |
| Chebyshev (L∞) | `max(\|dx\|, \|dy\|)` | Blocky cells with edges at 0°, 45° and 90° **[unverified: no primary source read; follows from the definition]** |
| Minkowski (Lp) | `(\|dx\|ᵖ + \|dy\|ᵖ)^(1/p)` | p = 1 → L1, p = 2 → L2, p → ∞ → L∞. Intermediate p blends them. For p < 1 it is no longer a metric (the triangle inequality fails) but still makes star-like patterns **[design note]** |
| Graph / hop distance | BFS steps on the `CellGraph` | Natural on irregular meshes. Used for "distance from coast" and territory growth |

Other metrics worth knowing:

- **Power diagrams** use `|d|² − w` with per-site weights. They give variable-size cells that keep straight edges **[unverified: Aurenhammer 1987 not read]**.
- **Non-Euclidean metrics change SDF behaviour.** Swapping the Euclidean length for an Lp norm inside an SDF turns exact distances into *bounds* ([Quilez, "distance functions", "Change of Metric"](https://iquilezles.org/articles/distfunctions/)).

### 2.2 F1, F2, F2−F1 and what they look like

From [Worley 1996](https://cedric.cnam.fr/~cubaud/PROCEDURAL/worley.pdf):

- `F1`, `F2`, … `Fn` are the distances to the 1st, 2nd, … nth nearest feature points, with `0 ≤ F1 ≤ F2 ≤ …`.
- **`F1`** rises radially around each point, giving spots or polka dots. Its derivative is discontinuous on Voronoi edges.
- **`F2`, `F3`** have faster changes and internal structure.
- **`F2 − F1`** is 0 exactly where `F1 = F2`, which is on Voronoi boundaries. It gives a "latticework of connected ridges" or vein-like tracery.
- **Linear combinations** `C1·F1 + C2·F2 + …` widen the palette. Worley tried about 40. He notes that `F4` and higher become less distinct.
- **Cell ID.** If `F1` also returns the nearest point's ID, the ID can drive a constant per-cell colour, giving flat-shaded Voronoi regions.
- **Fractal F1** used as a bump map gives a "crumpled" look. Worley reports it resembles seawater.

**Pitfall: `F2 − F1` is not a distance.**

- Thresholding `F2 − F1` to draw cell borders gives **uneven line widths**.
- The value stretches and shrinks with the spacing of the two nearest points, so some borders come out thin and others swallow whole cells ([Quilez, "Voronoi edges"](https://iquilezles.org/articles/voronoilines/)).
- Quilez's fix:
  1. **Pass 1 (3×3 cells):** find the nearest point `m` (relative offset `mr`) and its lattice cell.
  2. **Pass 2 (5×5 cells, centred on `m`'s cell):** for each other point `r`, compute `dot(0.5·(mr + r), normalize(r − mr))`. This is the exact distance to the bisector between `m` and `r`. Take the minimum.
- This gives constant-width borders and correct isolines at constant cost.

Design note (why the formula works):

- In coordinates relative to `x`, `F2² − F1² = |b|² − |a|²`.
- That difference is an *affine* function of `x`. It is zero on the bisector, and its gradient has magnitude `2|b − a|`.
- So `(|b|² − |a|²) / (2|b − a|)` is the exact distance to the bisector. It equals Quilez's `dot(0.5(a + b), normalize(b − a))`.
- In other words, the squared-distance difference, normalized by its gradient, is exact. This is the same gradient-normalization idea as in §3.3.

Design note (search neighbourhood per metric). Applies to the first survey's §3.3 infinite-Voronoi trick and the 3×3 search.

- With one jittered point per unit lattice cell, every point outside the 3×3 block around `x`'s cell is at least 1 away in L∞.
- Every Lp distance is ≥ the L∞ distance, so those points are at least 1 away in any Lp.
- The point in `x`'s own cell is within 1 (L∞), √2 (L2) or 2 (L1). So 3×3 is provably exact for F1 only under L∞.
- For L2 and L1, a closer point outside the block is possible but rare.
- `F2` and the 5×5 border pass need wider rings.
- A metric-agnostic exact method is Worley's pruning: visit neighbour cells in order of their minimum *box distance* to `x`, measured in the same metric, and stop when that distance exceeds the current `Fn`. Worley describes this pruning for the Euclidean case ([Worley 1996](https://cedric.cnam.fr/~cubaud/PROCEDURAL/worley.pdf)).

### 2.3 Signed distance functions (2D) for shaping cells, coastlines and masks

Definitions:

- An **SDF** returns the distance to a shape's boundary, negative inside and positive outside.
- Quilez distinguishes **exact** SDFs from **bounds**, which are lower bounds that are only zero on the surface ([Quilez, "distance functions"](https://iquilezles.org/articles/distfunctions/)).

**2D primitives** ([Quilez, "2D distance functions"](https://iquilezles.org/articles/distfunctions2d/)):

- All are centred at the origin, and almost all are listed as *exact*.
- The list includes circle, box, rounded box, segment, rhombus, trapezoids, triangles, regular polygons, stars, arcs, rings, ellipse, parabola and quadratic Bézier.
- The most useful for maps:
  - `sdCircle(p, r) = length(p) − r`
  - `sdBox(p, b)`: with `d = abs(p) − b`, return `length(max(d, 0)) + min(max(d.x, d.y), 0)`
  - `sdSegment(p, a, b)`: distance to the clamped projection onto `ab`. This is the capsule core for rivers and roads.
  - `sdPolygon(v[N], p)`: an exact signed distance to an arbitrary simple polygon. It takes the minimum squared distance to the edges and gets the sign from a winding/crossing test. This is the one that turns a **Voronoi cell polygon or a coastline polygon** into a smooth field.

**Operators** ([Quilez, "distance functions"](https://iquilezles.org/articles/distfunctions/); [2D page](https://iquilezles.org/articles/distfunctions2d/)):

| Operator | Formula | Notes |
|---|---|---|
| Union | `min(a, b)` | Exact outside only. The interior distance can be badly wrong ([Quilez, "interior distances"](https://iquilezles.org/articles/interiordistance/)) |
| Intersection | `max(a, b)` | Bound |
| Subtraction | `max(a, −b)` | Bound, and not commutative |
| Xor | (see source) | Exact outside, like union |
| Round | `d − r` | Exact. Inflates the shape and rounds its corners |
| Onion / annular | `abs(d) − r` | Exact. Gives a ring or shell. Repeat it for concentric bands |
| Smooth union | `smin(a, b, k)` | A bound. `k` is in distance units. Quilez lists exponential, root, sigmoid, polynomial (quadratic, cubic, quartic) and circular forms, normalized so that a given `k` blends over about the same width ([Quilez, "smooth minimum"](https://iquilezles.org/articles/smin/)) |
| Rotation, translation, uniform scale | (transform `p`) | Exact. Non-uniform scale is only a bound |

**Uses in a cell world** (design notes):

- **Island or continent masks.** Replace the first survey's square-bump or Euclidean² island shapes (§6.4) with `e = fbm(p) − α·sdf(p)`.
  - `sdf` can be a smooth union of a few circles and boxes, or a hand-drawn polygon.
  - Because it is a true distance near the boundary, `α` has a meaning: elevation falloff per unit distance.
- **Coastal bands and shelves.** `onion(sdf_coast, w)` gives beaches, shelves or reefs at a controlled width.
- **River and road corridors.**
  - Take the union of `sdSegment` capsules along each SCA or drainage edge, with radius taken from width.
  - The result is a field usable for carving valleys, for example lowering elevation by `smoothstep(w, 0, d)`, and for drawing banks.
- **Per-cell values.**
  - On a `CellGraph`, evaluate the SDF at each cell centre. Or, for graph-consistent distances, run BFS or Dijkstra from boundary cells.
  - On fine square grids, an exact Euclidean distance transform is available in linear time ([Felzenszwalb & Huttenlocher, *Theory of Computing* 8:415–428, 2012, DOI 10.4086/toc.2012.v008a019](https://doi.org/10.4086/toc.2012.v008a019)). **[partially verified: bibliographic record only; the linear-time claim is from memory]**
- **Domain-warped SDFs** (`sdf(p + h(p))`) give organic coastlines. They are bounds, not exact, so widths derived from them drift.

---

## 3. Lines and networks from noise

### 3.1 One field: the zero isoline (`|n| < t`)

- A smooth noise field `n(p)` with zero mean has zero isolines that wind across the plane.
- The test `|n(p)| < t` keeps a band around them. This is the same folding that makes "ridged" noise: `1 − |n|` peaks on the isoline (first survey §6.4).
- In 2D, a zero isoline of a smooth function is a closed curve or runs off the domain. It has **no endpoints and no T-junctions** **[design note: follows from it being a regular level set]**.
  - A single field therefore gives meandering lines and loops, not branching networks.

**Production example: Minecraft's rivers and valleys.**

- Minecraft builds "peaks and valleys" from the *weirdness* (ridges) noise `W`. The vanilla data defines `ridges_folded = −3·(||W| − 2/3| − 1/3)`, which equals `1 − |3|W| − 2|` ([vanilla `overworld/ridges_folded.json`, via the misode/mcmeta mirror](https://raw.githubusercontent.com/misode/mcmeta/data/data/minecraft/worldgen/density_function/overworld/ridges_folded.json)).
- Per the [Minecraft Wiki](https://minecraft.wiki/w/World_generation), PV = −1 (valleys) where `W ≈ 0`. In the coast column, valleys at the right continentalness and erosion give river biomes.
- So Minecraft rivers sit near the zero isoline of one noise field. The *terrain is built around the line*, rather than the line being traced over terrain.
- **[partially verified]** The formula is from Mojang's data as mirrored. The river interpretation comes from the wiki, which is secondary.
- The coordinates passed to the `ridge` noise are offset by `shift_x`/`shift_z`, which are themselves noise (`shift_a` over the `offset` noise). That is a form of domain warping ([`ridges.json`](https://raw.githubusercontent.com/misode/mcmeta/data/data/minecraft/worldgen/density_function/overworld/ridges.json); [`shift_x.json`](https://raw.githubusercontent.com/misode/mcmeta/data/data/minecraft/worldgen/density_function/shift_x.json)).

### 3.2 Two fields: intersection vs union, 2D vs 3D

The README idea is to "intersect two noise maps". What you get depends on the dimension, and the first point is easy to get wrong.

**Correction: 2D intersection makes dots, not lines.** In 2D, `|n1| < t AND |n2| < t` keeps only small diamond-shaped patches where the two isolines *cross*.

- Two curves in a plane meet at points, so this gives isolated dots, not paths **[design note: dimension counting, 1 + 1 − 2 = 0]**.
- It is useful for placing *junction features* such as towns at crossroads or lakes, not for paths.

**2D union: `|n1| < t OR |n2| < t`.**

- This gives a **network**: two independent families of winding lines that cross with X-junctions.
- To get dead ends or T-junctions, gate a family with a third field, for example `|n1| < t AND n3 > 0`. That cuts lines into segments **[design note]**.
- These lines know nothing about elevation. For roads that is often fine. For rivers, either build terrain around the lines (Minecraft's approach) or use drainage or SCA instead.

**3D intersection makes tubes. Production example: Minecraft "noodle caves".**

- In 3D, two zero isosurfaces meet along *curves*. Thickening the intersection gives winding tunnels.
- Vanilla Minecraft's `overworld/caves/noodle` density function does exactly this ([`noodle.json` in Mojang's data, via the misode/mcmeta mirror, version "26.4 Snapshot 7", built 2026-11-03](https://raw.githubusercontent.com/misode/mcmeta/data/data/minecraft/worldgen/density_function/overworld/caves/noodle.json)):
  - A selector noise `noodle` must be ≥ 0, and Y must lie in [−60, 321). Otherwise the function returns +64, which is solid (positive density is solid).
  - Where active, the density is `(−0.075 − 0.025·noodle_thickness) + 1.5·max(|noodle_ridge_a|, |noodle_ridge_b|)`.
  - Both ridge noises are sampled at 2.666… × the base frequency.
  - All terms are evaluated on 4 × 8 × 4 cells and linearly interpolated (`upscale`).
  - Air occurs where `max(|a|, |b|) < (0.075 + 0.025·thickness)/1.5 ≈ 0.05 ± 0.017`. That is, both ridge noises are near zero at once: the intersection of two zero isosurfaces.
- The overworld's `final_density` combines terrain and noodles with `min(terrain, noodle)`, so noodles carve air out of solid ground ([`final_density.json`](https://raw.githubusercontent.com/misode/mcmeta/data/data/minecraft/worldgen/density_function/overworld/final_density.json)).
- Noodle caves are 1–5 blocks wide. They first appeared in the 21w18a Caves & Cliffs prototype data pack, and later generated at all heights ([Minecraft Wiki, "Noise cave"](https://minecraft.wiki/w/Noise_cave)) **[secondary source]**.
- Mojang's 21w06a snapshot post introduced noise caves ("cheese" and "spaghetti") but did not yet mention noodles ([Minecraft.net, Snapshot 21w06a](https://www.minecraft.net/en-us/article/minecraft-snapshot-21w06a)).
- **Source caveat.** mcmeta is a community mirror of the data files in Mojang's jar, not a Mojang publication. The values may change between versions. The `max(|a|, |b|)` structure is the stable idea.

**Link to §2.** `max(|a|, |b|)` is the **L∞ norm** of the vector `(a, b)`, so noodle cross-sections are roughly parallelograms. `√(a² + b²)` (L2) gives rounder tubes **[design note]**.

**2D use of the noodle idea** (design note).

- Take a 2D slice of the 3D construction, using 3D noise with `z` = a constant per layer.
- Where the 3D tunnel curves cross the slice plane you get dots. Where a tunnel runs nearly parallel to the plane you get short dashes.
- This is mostly useful for multi-layer (underground) maps.

### 3.3 Keeping line width constant: gradient normalization

**Why widths vary.**

- A fixed threshold `|n| < t` gives a band whose width is about `2t/|∇n|`.
- Where noise changes slowly, lines get fat. Where it changes fast, they get thin or break.
- Quilez shows the same artefact for implicit curves, and also for `|y − f(x)|` plots with steep slopes ([Quilez, "distance estimation"](https://iquilezles.org/articles/distance/)).

**Fix: divide by the gradient.**

- Use the first-order distance estimate `de = |f(x)| / |∇f(x)|`, then threshold `de < w`. Here `w` is the half-width in world units.
- The gradient can be analytic (best) or from central differences. Central differences cost 4 extra evaluations in 2D, and the step `h` needs care ([same source](https://iquilezles.org/articles/distance/)).
- Simplex noise has a cheap analytic gradient (first survey §6.2), so the extra cost can be small.

**Two fields, linearized** (design note, derivation).

- For the intersection of `a = 0` and `b = 0`, linearize both and find the smallest offset `e` with `a + ∇a·e = 0` and `b + ∇b·e = 0`.
- With `J` the 2×D matrix whose rows are `∇a` and `∇b`, the minimum-norm solution gives `|e|² = [a b]·(J·Jᵀ)⁻¹·[a b]ᵀ`.
- When the gradients are orthogonal, this reduces to `√((a/|∇a|)² + (b/|∇b|)²)`. That is the gradient-normalized L2 version of the noodle test.
- When the gradients are nearly parallel, `J·Jᵀ` is close to singular and the estimate blows up. In 2D those are tangential, grazing crossings, so clamp the estimate there.

**Domain warping for organic lines.**

- Evaluate the line field at a warped position, `n(p + s·h(p))`, where `h` is a 2-vector built from two fBm calls with different offsets.
- Quilez's canonical construction ([Quilez, "domain warping"](https://iquilezles.org/articles/warp/)):

  ```
  q = (fbm(p), fbm(p + (5.2, 1.3)))
  r = (fbm(p + 4q + (1.7, 9.2)), fbm(p + 4q + (8.3, 2.8)))
  value = fbm(p + 4r)
  ```

  This now **verifies** the first survey's §6.5, which was only partially verified.
- Warping changes the local stretch, so `|∇|` must be taken of the *warped* function, not the base noise. Otherwise widths drift again **[design note]**.
- Minecraft uses noise-based coordinate shifts in the same spirit (§3.1).

### 3.4 Choosing the threshold

- With gradient normalization, `t` *is* the half-width (`w`) in world units. Choose it from the cell size: about 0.5–1 cell for a one-cell-wide road on a grid.
- Without normalization, `t` sets *coverage* rather than width. For noise with roughly uniform values near 0, the fraction of area kept grows roughly linearly with `t` **[design note]**.
- **Frequency** sets how far apart the lines are. **Octaves** add wiggle but also add small closed loops ("islands" of line). Use 1–2 octaves for roads and paths. Minecraft's noodle and ridge noises use few octaves; the `noise` definitions list a single base octave **[partially verified from the noise JSON; not checked in depth]**.
- On a cell world, evaluate at cell centres, then post-process:
  - thin the band to a 1-cell skeleton, or extract the polyline with marching squares;
  - drop tiny loops by length.

  Without that step the result is thick blobs, not a network.

---

## 4. Deterministic noise in the browser

### 4.1 What ECMAScript guarantees

**Arithmetic is exactly specified.**

- Numbers are IEEE 754-2019 binary64 values.
- `Number::add`, `subtract`, `multiply` and `divide` are each defined by the IEEE 754-2019 rules, and rounding is roundTiesToEven ([ECMA-262 §6.1.6.1](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-add)).
- `Math.sqrt` returns "the Number value for" the exact square root, so it is correctly rounded ([§21.3.2.33](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.sqrt)).
- `Math.floor`, `Math.round`, `Math.fround` and `Math.imul` are also exactly specified.
- Design note: because each operation is specified on its own, a conforming engine cannot fuse `a*b + c` into an FMA or keep extended precision. **The same JS arithmetic gives bit-identical results in every conforming engine.**

**Transcendental functions are not.**

- The spec leaves `acos, acosh, asin, asinh, atan, atanh, atan2, cbrt, cos, cosh, exp, expm1, hypot, log, log1p, log2, log10, pow, random, sin, sinh, tan, tanh` "not precisely specified". They are "implementation-approximated".
- It *recommends* but does not require fdlibm ([§21.3.2](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-function-properties-of-the-math-object)).
- The `**` operator uses `Number::exponentiate`, which is implementation-approximated too ([§6.1.6.1.3](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-exponentiate)).
- V8 ships its own fdlibm-derived `ieee754` routines ([v8 `src/base/ieee754.h`](https://github.com/v8/v8/blob/main/src/base/ieee754.h)).
- At least one build option has switched V8's trig functions to glibc-derived code ([openSUSE packaging notes](https://build.opensuse.org/request/show/1120770)) **[partially verified]**. So `Math.sin` can differ between engines, and even between builds.
- **Consequence:** never put `sin`, `exp`, `pow` or `**` on a path whose output must be reproducible.
  - This rules out the shader-style hash `fract(sin(x)·43758.5453)`.
  - Use integer hashes. Use polynomials or lookup tables instead of trig.
  - `x*x` and the like are safe.

**`Math.random` is not seedable** and is implementation-defined ([§21.3.2.28](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.random)).

**Integer hashing in JS.**

- Bitwise operators convert to 32-bit integers: `| 0` → ToInt32, `>>> 0` → ToUint32 ([`Number::unsignedRightShift`](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-unsignedRightShift)).
- `Math.imul(a, b)` returns the low 32 bits of the product as a signed int32 ([§21.3.2.20](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.imul)).
- Pitfall: a plain `a * b` on two 32-bit values can exceed 2⁵³ and silently lose the low bits that a hash depends on. Always use `Math.imul` for 32×32 multiplies, and `>>> 0` to read the result as unsigned **[design note; follows from the 53-bit significand]**.
- Tommy Ettinger's Mulberry32 gist warns about the same thing for JS ports: without `| 0`, a JS port's counter loses low bits after about 3.4 million iterations ([gist](https://gist.github.com/tommyettinger/46a874533244883189143505d203312c)).
- The first survey's pcg3d (Jarzynski & Olano) uses only 32-bit multiply, add, xor and shift, so it maps directly to `Math.imul` / `>>> 0` **[design note]**.

### 4.2 Seedable PRNGs (for sequential stages)

Use these where a stage is inherently sequential: Poisson-disc dart throwing, SCA attraction-point placement, and shuffles. Seed them from `hash(worldSeed, stageId)`. Per-cell values should still use stateless hashes (first survey §3.3).

| PRNG | State | Original source | Quality notes |
|---|---|---|---|
| **sfc32** | 128-bit | Chris Doty-Humphrey's PractRand suite ([pracrand](https://pracrand.sourceforge.net/)) **[not read directly; attribution per bryc]** | Passes PractRand and TestU01 BigCrush per bryc's notes. The original seeding runs 12 warm-up outputs ([bryc/code PRNGs.md](https://github.com/bryc/code/blob/master/jshash/PRNGs.md)) |
| **xoshiro128\*\*** | 128-bit | Blackman & Vigna, "Scrambled Linear Pseudorandom Number Generators" ([prng.di.unimi.it](https://prng.di.unimi.it/)) | Vigna lists it as a 32-bit generator without linearity failures (xoshiro128+ fails them). Seed the state with SplitMix |
| **SplitMix32** | 32-bit | SplitMix (Steele, Lea & Flood 2014); the JS variant's mixer is MurmurHash3 `fmix32` ([bryc](https://github.com/bryc/code/blob/master/jshash/PRNGs.md)) | bryc prefers it over Mulberry32. Good as a *seeder* for larger-state generators |
| **Mulberry32** | 32-bit, period 2³² | Tommy Ettinger, 2017, public domain ([gist](https://gist.github.com/tommyettinger/46a874533244883189143505d203312c)) | The author reports it passes gjrand. His 2022 revision says it is **not equidistributed**: about 1/3 of 32-bit outputs never occur, and PractRand fails it at 32 GB. Fine for small sandbox jobs, but not a first choice |
| **jsf32** | 128-bit | Bob Jenkins, smallprng ([via bryc](https://github.com/bryc/code/blob/master/jshash/PRNGs.md)) | The author's seeding sets a constant in the first word and discards 20 outputs |

Seeding advice:

- bryc recommends filling the *whole* state from a separate hash (his `xmur3` string hash). A generator's built-in seeding can reduce the effective number of starting states ([PRNGs.md, Addendum A](https://github.com/bryc/code/blob/master/jshash/PRNGs.md)).
- Vigna recommends SplitMix to expand a seed ([prng.di.unimi.it](https://prng.di.unimi.it/)).

**Recommendation:** sfc32, seeded with four words from SplitMix32 applied to `hash(worldSeed, stageId)`.

### 4.3 Noise libraries and seeding

**`simplex-noise` (Jonas Wagner), v4.0.3, MIT** ([repo](https://github.com/jwagner/simplex-noise.js)):

- Last publish 2024-07-26 per `npm view`.
- API: `createNoise2D/3D/4D(random = Math.random)`.
  - It **accepts any `() => number` PRNG** and uses it only to shuffle a 256-entry permutation table (`buildPermutationTable`).
  - The README recommends the `alea` package, as in `createNoise2D(alea('seed'))`. A closure around sfc32 works the same way.
- Output is in [−1, 1]. Size is about 2 kB gzipped and tree-shakable. It ships ESM and CJS. The author benchmarks about 73 M 2D samples/s on one core.
- Its source uses only arithmetic, `Math.floor` and `Math.sqrt` (constants), so outputs are reproducible across engines for a given PRNG sequence **[design note from reading the source]**.
- Caveats from the changelog: v4 output differs from v3, and coordinates above 2³¹ may stop being noisy because of `| 0` flooring.
- A 256-entry permutation implies the pattern repeats every 256 lattice units **[unverified; inferred from table size]**.

**`open-simplex-noise` (Josh Forisha), v3.0.0, Unlicense** ([repo](https://github.com/joshforisha/open-simplex-noise-js)):

- API: `makeNoise2D(seed: number)` and the 3D/4D equivalents. It takes a numeric seed, *not* a PRNG.
- Output is in (−1, 1). The repository was pushed 2026-08-23.
- It implements the *original* OpenSimplex. The README does not say whether it is OpenSimplex2.

**OpenSimplex2 / OpenSimplex2S** (KdotJPG, the first survey's recommended noise) ([repo](https://github.com/KdotJPG/OpenSimplex2)):

- The reference implementations are Java, C#, GLSL, HLSL and Rust (C/C++ under `_old`). **There is no official JS port.**
- The Java reference takes a `long` seed and hashes with **64-bit** constants and multiplies (`PRIME_X = 0x5205402B9270C86FL`, `HASH_MULTIPLIER = 0x53A3F72DEEC546F5L`). It also uses `float` gradients.
- A faithful JS port needs `BigInt`, which is slow, or a 32-bit redesign of the hash. A redesign gives *different* output from the reference **[design note]**.

---

## 5. Browser and GitHub Pages delivery

### 5.1 Rendering options (support per MDN browser-compat-data, read 2026-11-07)

| API | Support | Fit for the sandbox |
|---|---|---|
| **Canvas 2D** | Universal | Square grids via `ImageData` (one pixel per cell, then scale up with CSS). Voronoi via `Path2D` fills. MDN's tips: batch draw calls, minimise state changes, use layered canvases, set `alpha: false`, scale with CSS, handle `devicePixelRatio` ([MDN, Optimizing canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)) |
| **WebGL2** | Chrome 56, Firefox 51, Safari 15 ([BCD `WebGL2RenderingContext`](https://github.com/mdn/browser-compat-data/blob/main/api/WebGL2RenderingContext.json)) | Instanced or triangulated cells, field textures plus a colour-map shader, smooth pan and zoom, 100k+ cells |
| **WebGPU** | Chrome 113 (ChromeOS, macOS, Windows), Linux since Chrome 144 (Intel Gen12+ only). Chrome Android 121. Safari 26 (macOS and iOS). Firefox 141 **Windows only**. Firefox's worker notes add macOS Tahoe on Apple silicon from 145 and older macOS on Apple silicon from 147, but no Intel Mac and no Linux. No Firefox Android ([BCD `Navigator.gpu`](https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json), [`WorkerNavigator.gpu`](https://github.com/mdn/browser-compat-data/blob/main/api/WorkerNavigator.json)). MDN marks WebGPU **"limited availability", not Baseline**, and secure-context only ([MDN WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)). caniuse shows about 87% global support (Oct 2026 StatCounter data) ([caniuse](https://caniuse.com/webgpu)) | Optional progressive enhancement only. Do not make it a requirement |

Notes on the WebGPU data:

- The two BCD entries disagree on Firefox's platforms: `Navigator.gpu` says Windows only, while `WorkerNavigator.gpu` lists Apple silicon as well. Treat Firefox-on-Mac support as **uncertain**.
- Mozilla's own announcement for 141 said Windows first, with Mac and Linux "in the coming months" ([Mozilla intent to ship](https://groups.google.com/a/mozilla.org/g/dev-platform/c/21W7YWSvYIM)) **[not read; via search summary]**.

### 5.2 Generation off the main thread

**Workers.**

- Module workers (`new Worker(url, { type: 'module' })`) are supported in Chrome 80, Firefox 114 and Safari 15 ([BCD `Worker`](https://github.com/mdn/browser-compat-data/blob/main/api/Worker.json)).
- Vite detects `new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' })` and bundles the worker as its own chunk. The `new URL(...)` must appear *inline* with static options. `?worker` imports are also supported ([Vite, Features → Web Workers](https://vite.dev/guide/features)).

**Moving data.**

- Post `Field` typed arrays with their `.buffer` in the transfer list. The transfer is zero-copy, and the sender's view is detached.
- Typed arrays themselves are *not* transferable; only their `ArrayBuffer` is ([MDN, Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)).

**OffscreenCanvas.**

- `OffscreenCanvas` is supported in Chrome 69, Firefox 105 and Safari 16.4. Its `2d` context has the same support. Its `webgl`/`webgl2` contexts need Safari 17 ([BCD `OffscreenCanvas`](https://github.com/mdn/browser-compat-data/blob/main/api/OffscreenCanvas.json)).
- A canvas can be transferred to a worker so that worker renders directly.

**Avoid `SharedArrayBuffer` on GitHub Pages.**

- `SharedArrayBuffer` needs a secure, **cross-origin isolated** page, which requires COOP and COEP response headers. You can check isolation with `crossOriginIsolated` ([MDN SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)).
- GitHub Pages cannot set custom headers. The feature request ([community discussion #13309](https://github.com/orgs/community/discussions/13309), opened 2022) is still unanswered. A GitHub responder said in July 2023 that custom headers would support this, with "no ETA".
- The `coi-serviceworker` workaround has mixed reports in that thread, including a 2025 report that it no longer worked in Firefox.
- **Design:** transfer whole buffers between stages, or run the whole pipeline inside one worker.

**GPU compute is not deterministic** (design note).

- Do not move *generation* to WebGPU or WebGL shaders if outputs must be golden-hash stable.
- GPU float rules (precision, FMA contraction, denormals) are looser than ECMAScript's per-operation rules **[unverified: the WGSL/GLSL precision clauses were not read in this pass]**.
- Keep generation on the CPU in workers. Use the GPU for display.

### 5.3 Static build and deploy (Vite + GitHub Actions)

**Vite** (docs for v8.3.6) ([Vite, Deploying a Static Site → GitHub Pages](https://vite.dev/guide/static-deploy)):

- For a project site at `https://<USER>.github.io/<REPO>/`, set `base: '/<REPO>/'`. For this repo that is `base: '/cellgen/'`. User sites and custom domains use `'/'`.
- In repo **Settings → Pages → Source**, choose **GitHub Actions**.
- The documented workflow:
  - triggers on push to `main` and `workflow_dispatch`;
  - sets permissions `contents: read`, `pages: write`, `id-token: write`;
  - uses concurrency group `pages` with `cancel-in-progress: true`;
  - runs these steps: `actions/checkout`, then `actions/setup-node` (`lts/*`, npm cache), then `npm ci`, then `npm run build`, then `actions/configure-pages`, then `actions/upload-pages-artifact` (`path: ./dist`), then `actions/deploy-pages`.
  - The docs pin each action to a commit SHA, currently v7 / v7 / v6 / v5 / v5.

**GitHub Pages constraints:**

- **Static only.** It is "a static site hosting service that takes HTML, CSS, and JavaScript files straight from a repository" ([GitHub Docs, What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)). No server code runs, so everything happens client-side.
- **URL.** Project sites are served at `<owner>.github.io/<repo>` ([same page](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)). Hence the `base` setting. Asset URLs inside code should use `import.meta.env.BASE_URL` **[unverified: not read in the Vite docs this pass]**.
- **Limits** ([GitHub Docs, Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)):
  - published site ≤ 1 GB;
  - source repository recommended ≤ 1 GB;
  - deployments time out after 10 minutes;
  - 100 GB/month bandwidth (soft limit);
  - 10 builds/hour (soft limit), which does *not* apply to custom Actions workflows;
  - possible HTTP 429 rate limiting.
- **Use restrictions.** No commercial SaaS or e-commerce. No sensitive transactions such as passwords or payment details.
- **Routing** (design note). There is no server-side routing, so keep the app single-page. Put the seed and parameters in the **query string or hash**, e.g. `?seed=123&stage=rivers`. Both survive reloads without any server rewrite.
- **Headers.** You cannot set custom headers (see §5.2).

---

## 6. How this fits the sandbox

This section maps the findings onto the first survey's §9 recommendations. Each item says whether it **confirms**, **amends** or **contradicts** that survey.

1. **Noise library choice — amends §9.3 "Noise: OpenSimplex2 / OpenSimplex2S".**
   - The OpenSimplex2 reference relies on 64-bit integer hashing, and there is no official JS port (§4.3).
   - Recommendation: start with **`simplex-noise` v4**, seeded through its PRNG argument with sfc32. It is small, MIT-licensed and arithmetic-only, so it is reproducible.
   - Alternatively, write an in-house 2D simplex using a `Math.imul` lattice hash (pcg-style) instead of a permutation table. That avoids the 256-unit repetition and ties noise to the same `hash(seed, stage, x, y)` used everywhere else.
   - Keep OpenSimplex2S on the list for ridged noise. Expect a 32-bit port's output to differ from the Java reference.
2. **Per-cell RNG — confirms §9.3 "pcg3d/pcg4d"**, implemented with `Math.imul` and `>>> 0`.
   - **Adds** a seeded sfc32 stream (seeded via SplitMix32 from the stage hash) for sequential stages: Poisson disc and SCA.
3. **Cross-platform reproducibility — answers §10 open question 4.**
   - Inside JS, `+ − × ÷` and `sqrt` are bit-identical across conforming engines. So golden-hash tests on generator output are viable, provided no stage uses `sin`/`cos`/`exp`/`log`/`pow`/`**`/`atan2`/`hypot`/`Math.random`.
   - Add a lint rule or a code-review checklist item for this.
   - Keep generation off the GPU.
4. **Rivers — confirms §7 (flow accumulation) as the default**, and **adds** space colonization as a second river mode (§1.6):
   - a *river-first* layer on the world `CellGraph` (attraction points on land-cell centres, roots at coastal mouths, growth upstream, Murray widths);
   - followed by elevation derived from the network, or checked against it.
   - Prototype this after the hydrology step in §9.2, as "3b". Its parameters (`d_i`, `d_k`, `D`, density) are exactly the kind of sliders the pipeline visualizer is for.
   - The same code with different attraction-point weights gives road networks (Fernandes & Fernandes).
5. **Worley/Voronoi borders — amends §6.3** ("`F2 − F1` gives cell walls").
   - It does, but with uneven widths.
   - For drawn borders on the implicit (lattice) Voronoi, use Quilez's two-pass exact border distance. On the explicit `VoronoiMesh`, compute the distance to the cell's own polygon edges with `sdPolygon`.
   - **Amends** the §3.3 design note on 3×3 search: it is exact for F1 only under the L∞ metric. Use box-distance pruning when exactness matters (F2, non-Euclidean metrics).
6. **Distance metric as a parameter.** Add `metric: L2 | L1 | Linf | Lp(p)` to the Worley/implicit-Voronoi stage, and hop distance to graph stages. These are cheap and give visibly different styles (Worley's "rigid" Manhattan cells).
7. **Island masks and coastlines — amends §6.4**, which uses square-bump and Euclidean² shapes.
   - Define masks as 2D SDFs: smooth unions of primitives, or polygons.
   - Combine them as `e = fbm − α·sdf`, so falloff is in world units and coastal bands come from `onion`.
8. **Line networks from noise — new stage.**
   - "Noise paths": the union of gradient-normalized zero isolines from two or more fields, optionally gated by a third, then skeletonized onto cells.
   - Use it for roads, trails and fault lines.
   - Do **not** use the 2D AND of two fields for paths, because it yields dots (§3.2). Use AND for 3D tunnels in multi-layer or underground modes, as Minecraft's noodle caves do.
9. **Domain warping — the first survey's §6.5 is now verified.** Quilez's constants are 4.0 for the warp scale and the offsets (5.2, 1.3), (1.7, 9.2) and (8.3, 2.8).
   - IQ's fBm article is also now readable. It confirms `G = 2^(−H)`, with `G = 0.5` (`H = 1`) recommended for terrain ([Quilez, "fBm"](https://iquilezles.org/articles/fbm/)).
10. **Delivery — new.**
    - Use Vite with `base: '/cellgen/'` and the official Pages workflow.
    - Run generation in one module worker, posting transferable buffers.
    - Render with Canvas 2D (`ImageData` for grids, `Path2D` for meshes) first. Move to WebGL2 when cell counts or zooming demand it. Treat WebGPU as optional.
    - Keep the seed and parameters in the URL query. Do not use `SharedArrayBuffer`.

---

## 7. Open questions

1. **Feng et al. details.** Which SCA extensions did they use ("Momentum"), and with what parameters, attraction-point placement and growth direction? The PDF was unreachable. Retry the [West Bohemia repository](https://dspace.zcu.cz/items/0bf59ad5-a46f-4d45-9295-31bf29cac1e2/full) or the WSCG 2023 proceedings.
2. **SCA on a graph.** Does snapping growth to `CellGraph` neighbours keep SCA's character, or does it introduce grid bias? Prototype on hex grids and Voronoi meshes.
3. **River-first vs terrain-first.** If SCA rivers come first, what is the cheapest way to make elevation consistent with them? Options are path-distance-from-mouth plus noise, or a Priority-Flood pass constrained by the network.
4. **Road networks.** How does Fernandes & Fernandes' phase 2 make interconnections? The dissertation was not read.
5. **Noise-path skeletons.** What is the best way to turn `de < w` bands into clean polylines on irregular cells: marching squares on a raster, or edge tracing on the mesh?
6. **Determinism scope.** Is "same output in every browser" required, or only "same output in the same browser"? This decides how strictly to ban `Math.sin` and the like (for example, in rendering-only code).
7. **Firefox WebGPU on macOS.** The BCD entries disagree. Recheck before relying on WebGPU even as an enhancement.
8. **GPU determinism.** Read the WGSL and GLSL ES precision rules if GPU generation is ever wanted.
9. **simplex-noise periodicity.** Confirm the 256-unit repeat, and check whether it is visible at world scale.
10. **Vite `BASE_URL`.** Confirm how assets and worker URLs resolve under a non-root `base`. Build once and test on Pages.

---

## 8. References

**Space colonization**

- Runions, A., Fuhrer, M., Lane, B., Federl, P., Rolland-Lagan, A.-G., Prusinkiewicz, P. "Modeling and visualization of leaf venation patterns." *ACM TOG* 24(3):702–711, 2005. https://doi.org/10.1145/1073204.1073251. Author page: http://algorithmicbotany.org/papers/venation.sig2005.html
- Runions, A., Lane, B., Prusinkiewicz, P. "Modeling Trees with a Space Colonization Algorithm." Eurographics Workshop on Natural Phenomena, 2007, pp. 63–70. https://doi.org/10.2312/NPH/NPH07/063-070. Author page: http://algorithmicbotany.org/papers/colonization.egwnp2007.html
- Runions, A. *Modeling Biological Patterns using the Space Colonization Algorithm.* M.Sc. thesis, University of Calgary, 2008. https://algorithmicbotany.org/papers/runionsa.th2008.html [abstract only]
- Feng, H., Wünsche, B. C., Shaw, A. "Generating Realistic River Patterns with Space Colonization." WSCG 2023, CSRN 3301, pp. 222–231. https://doi.org/10.24132/CSRN.3301.26 [partially verified: abstract via Crossref]
- Fernandes, G. D., Fernandes, A. R. "Space colonisation for procedural road generation." ICGI 2018. https://repositorium.uminho.pt/handle/1822/72032 and https://uce-cg.di.uminho.pt/?p=925 [partially verified: project page]
- Webb, J. "Space Colonization Algorithm in JavaScript" (Medium) and `2d-space-colonization-experiments`. https://medium.com/@jason.webb/space-colonization-algorithm-in-javascript-6f683b743dc5 and https://github.com/jasonwebb/2d-space-colonization-experiments
- Génevaux, J.-D., et al. "Terrain generation using procedural models based on hydrology." SIGGRAPH 2013. [unverified: not read]

**Distance functions and SDFs**

- Worley, S. "A Cellular Texture Basis Function." SIGGRAPH 1996. https://cedric.cnam.fr/~cubaud/PROCEDURAL/worley.pdf
- Quilez, I. "2D distance functions." https://iquilezles.org/articles/distfunctions2d/
- Quilez, I. "distance functions" (3D, operators). https://iquilezles.org/articles/distfunctions/
- Quilez, I. "interior SDFs / interior distances." https://iquilezles.org/articles/interiordistance/
- Quilez, I. "smooth minimum." https://iquilezles.org/articles/smin/
- Quilez, I. "Voronoi edges." https://iquilezles.org/articles/voronoilines/
- Quilez, I. "distance estimation" (gradient normalization). https://iquilezles.org/articles/distance/
- Felzenszwalb, P. F., Huttenlocher, D. P. "Distance Transforms of Sampled Functions." *Theory of Computing* 8:415–428, 2012. https://doi.org/10.4086/toc.2012.v008a019 [partially verified: bibliographic record]

**Noise lines, warping, Minecraft**

- Quilez, I. "domain warping." https://iquilezles.org/articles/warp/
- Quilez, I. "fBm." https://iquilezles.org/articles/fbm/
- Mojang vanilla data (via the misode/mcmeta mirror, "26.4 Snapshot 7"): `overworld/caves/noodle.json`, `overworld/final_density.json`, `overworld/ridges.json`, `overworld/ridges_folded.json`, `shift_x.json`, `noise/noodle*.json`. https://github.com/misode/mcmeta/tree/data/data/minecraft/worldgen
- Mojang. "Minecraft Snapshot 21w06a." https://www.minecraft.net/en-us/article/minecraft-snapshot-21w06a
- Minecraft Wiki. "Noise cave" and "World generation." https://minecraft.wiki/w/Noise_cave and https://minecraft.wiki/w/World_generation [secondary]

**Determinism, PRNGs, noise libraries**

- ECMA International. *ECMA-262, ECMAScript® 2027 Language Specification* (draft), §6.1.6.1 (Number operations) and §21.3 (Math). https://tc39.es/ecma262/
- V8. `src/base/ieee754.h`. https://github.com/v8/v8/blob/main/src/base/ieee754.h
- Vigna, S. (with Blackman, D.). xoshiro/xoroshiro generators page. https://prng.di.unimi.it/
- Ettinger, T. Mulberry32 (gist, 2017, revised 2022). https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
- bryc. "Pseudorandom number generators" (JS implementations and attributions). https://github.com/bryc/code/blob/master/jshash/PRNGs.md
- Doty-Humphrey, C. PractRand (sfc32). https://pracrand.sourceforge.net/ [not read directly]
- Wagner, J. simplex-noise.js. https://github.com/jwagner/simplex-noise.js
- Forisha, J. open-simplex-noise-js. https://github.com/joshforisha/open-simplex-noise-js
- KdotJPG. OpenSimplex2. https://github.com/KdotJPG/OpenSimplex2

**Browser and deployment**

- MDN. WebGPU API. https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- MDN browser-compat-data: `api/Navigator.json`, `api/WorkerNavigator.json`, `api/OffscreenCanvas.json`, `api/WebGL2RenderingContext.json`, `api/Worker.json`. https://github.com/mdn/browser-compat-data
- caniuse. WebGPU. https://caniuse.com/webgpu
- MDN. Optimizing canvas. https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas
- MDN. Transferable objects. https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
- MDN. SharedArrayBuffer. https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
- Vite. "Deploying a Static Site." https://vite.dev/guide/static-deploy
- Vite. "Features" (Web Workers). https://vite.dev/guide/features
- GitHub Docs. "What is GitHub Pages?" https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- GitHub Docs. "GitHub Pages limits." https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- GitHub Community. "Allow setting COOP and COEP headers in GitHub Pages" (#13309). https://github.com/orgs/community/discussions/13309
