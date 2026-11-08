# Height Maps That Fit an Existing Map: Coasts, Biomes and Rivers

*Research date: 2026-11-07. Scope: methods that take a map that already exists (land/ocean, biome cells, a river network with flow) and compute a height map that fits it. Rivers must run downhill to the sea, valleys must lie under rivers, and relief should be plausible for each biome. Each method is judged against the infinite, lazily evaluated, bit-exact map in `sandboxes/sandbox3` (now part of `sandboxes/sandbox4`).*

**How to read the citations**

- Each claim cites the source that owns it: paper plus section, figure or equation, or repo plus file, lines and commit. Primary sources were read directly unless noted.
- **[unverified]** means the claim is general or bibliographic knowledge that was not checked against the primary text in this pass.
- **[partially verified]** means the primary source exists and is cited, but only part of the claim was confirmed, for example from an abstract or a search-index copy of it.
- Three primary texts could not be read on the research date:
  - Cordonnier et al. 2016: HAL returned a bot-protection page, and the Purdue PDF is over the 10 MB fetch limit.
  - Tzathas et al. 2024: the Eurographics library returned 403.
  - Braun & Willett 2013: paywalled.
  
  Their numerics are cited through the `fastscapelib` source, which implements Braun & Willett and says so.
- Text marked "Design note" or "Recommendation" is my own engineering judgement, not a sourced claim.
- Sandbox line numbers refer to the working tree on the research date: commit `f48345f`, plus uncommitted edits to `rivers.ts`.

**The five constraints each method is checked against**

| Key | Question |
|---|---|
| **C1 Local** | Can it be computed per region or per tile with a bounded halo, so the infinite lazy map stays order-independent and seamless across region borders? |
| **C2 Downhill** | Does it guarantee that every river runs monotonically downhill to the sea? If not, how is it repaired? |
| **C3 Cost** | What does it cost at about 100k river nodes, and for per-pixel sampling when rendering? |
| **C4 Bit-exact** | Can it be built from IEEE `+ − × ÷ √` only? `Math.sqrt` is exact by specification: it returns "the square root", with no approximation clause ([ECMA-262 §21.3.2.33](https://tc39.es/ecma262/multipage/numbers-and-dates.html)). `Math.exp` is explicitly "implementation-approximated" (§21.3.2.14), so exp-, log- and trig-based kernels are out. |
| **C5 Height after rivers** | Does it work when height is derived *from* the given rivers, rather than rivers from height? |

**Code locations used below**

| Hook | File, lines | What it gives a height pass |
|---|---|---|
| Level sizes and nesting | `world/world.ts` L4–9, L27–29 | Regions ~128 km (no warp), biomes ~32 km, subbiomes ~8 km. With `nest`, coasts follow 8 km cells. |
| Order independence | `world/world.ts` L31–33 | "Every value only depends on a bounded neighbourhood". |
| River header | `world/rivers.ts` L1–38 | Roots at ocean-biome sites, attractors in inland subbiomes, the region border rule, flow, bit-exactness. |
| Coast subbiomes skipped | `world/rivers.ts` L221–227, L265 | No attractors in subbiomes that touch the ocean (`skipCoast`, on by default). |
| Landlocked exemption | `world/rivers.ts` L321–338, L405–414 | A region with no ocean neighbour searches outward, and its rivers may cross other regions' land. |
| Unreached pockets | `world/rivers.ts` L24–25 | Land walled off from the sea by other regions keeps its attractors unreached. |
| Flow sweep | `world/rivers.ts` L828–830 | `flow[par[k]] += flow[k]` in reverse index order: a parent always has a lower index than its children. |
| `wet`, `tree` | `world/rivers.ts` L831–834 | Whether a node lies over ocean, and the root of each node's tree. |
| Defaults | `params.ts` L77, L104–118 | Subbiome 8 km, 10 attractors per subbiome, D = 2 km, dᵢ = 16 km, dₖ = 3 km. |
| Land types | `render/source.ts` L49–67 | 12 cosmetic types, chosen by `keyHash(biomeKey) % 12`, so they are spatially uncorrelated. |
| Per-pixel render | `render/source.ts` L209 | One `world.cellAt` call per raster pixel. |
| Noise | `shared/core/noise.ts` L8, L29–123 | In-house simplex, `fbm` and `ridged`. "Arithmetic only — deterministic": hashed gradients from a literal table, so they are already bit-exact. |

---

## 1. Overview

Almost every game map generator in the literature builds height first and derives rivers from it. Examples:

- Red Blob mapgen2 and mapgen4
- Martin O'Leary's generator
- Azgaar's Fantasy Map Generator
- every stream-power simulation

Sandbox 3 has the opposite order: rivers exist first and height must fit them. The literature that works in this order is small:

- Kelley, Malin & Nielson 1988 grew a stream network and then fitted a "surface under tension" to it ([SIGGRAPH 1988, Computer Graphics 22(4):263–268](https://history.siggraph.org/?p=119585)) **[partially verified: abstract and secondary descriptions only]**.
- Prusinkiewicz & Hammel 1993 built the river and the mountain together by subdivision.
- Génevaux et al. 2013 build the river network first and the terrain second. They note that Kelley et al.'s approach "resembles ours because the river network is generated first and the terrain second" ([Génevaux 2013, §2](https://www.cs.purdue.edu/homes/bbenes/papers/Genevaux13ToG.pdf)).

Two observations shape the rest of this report.

1. **River bed elevation follows from flow alone.** Hold the drainage network fixed. Then the steady-state stream-power law fixes the channel slope from drainage area, and integrating it from the coast gives every river node's elevation (the "χ" integral, §3.2). The rivers here already carry `flow`, an upstream attractor count that is proportional to drainage area. So river elevations can be computed exactly, monotonically and per region, before any terrain exists. Everything else is "fill the land between the channels so that it drains into them".
2. **The map already has its main drainage divides.** Rivers never enter another region's land (`rivers.ts` L21–26). Every non-landlocked region is therefore a closed hydrological unit that drains only to the sea, and its land border is a divide. That makes per-region computation hydrologically valid (C1). Any global-looking step (filling, diffusion, erosion) can run per region, as long as both sides agree on the border values.

---

## 2. What the existing map provides

| Input | Where | Use for height |
|---|---|---|
| Land/ocean per subbiome (nested) | `world.cellAt`, `world.ts` L622–638 | Sea-level base, the coast as the zero contour, ocean depth |
| River nodes `x, y, parent` | `RegionRivers`, `rivers.ts` L127–159 | Channel geometry. Segments are ~D = 2 km long. |
| `flow` (attractors upstream, including the node itself) | `rivers.ts` L828–830 | Drainage-area proxy |
| `wet` (node over ocean) | L831–832 | The first dry node on each path is the river's base level (coast crossing) |
| `tree` (root id) | L833–834 | Which basin a node belongs to, for divides between basins (§6.2) |
| Region of each pixel | `cellAt(...).region` | The primary divides (§6.1) |
| Land type per biome | `render/source.ts` L65–67 | Relief style (§7) |

**Drainage-area scale (Design note):** attractors sit `perSub` per inland subbiome, so one attractor stands for about `subSize² / perSub` = 8² / 10 ≈ **6.4 km²**. Use `A_k = a · max(flow_k, 1)`, with `a` derived from params. Coastal subbiomes carry no attractors, so `A` under-counts the lowest reaches a little.

**Gaps a height pass must cover (from the code):**

- The coastal strip has no rivers (`skipCoast`).
- Pockets of land are walled off from the sea by other regions (L24–25).
- Landlocked regions have rivers that cross region borders (L321–338, L410–414).
- Tip nodes can have `own = 0`, hence the `max(flow, 1)` above.

---

## 3. River bed elevations from the given network

### 3.1 The stream-power law and its steady state

- **Sources:**
  - The channel evolution law is `∂z/∂t = U − K·A^m·|∂z/∂x|^n`. U is uplift, K is erodibility, and m and n are empirical exponents; n has been proposed between 2/3 and 7/3 ([Mudd et al. 2014, JGR-ES 119:138, Eq. 1, ¶4](https://www.pure.ed.ac.uk/ws/files/13521459/jgrf20188.pdf), citing Howard & Kerby 1983 and Whipple & Tucker 1999).
  - At steady state (U = erosion), **`|dz/dx| = (U/K)^{1/n} · A^{−m/n}`** (Eq. 2). That is the slope–area relation `S = k_s·A^{−θ}`, with concavity θ = m/n. "A value of 0.45–0.5 is frequently used" as a reference concavity (¶7, citing Wobus et al. 2006).
  - The same power-law decline of gradient with area or discharge was reported by Flint, with exponents of about −0.6 ([Flint 1974, WRR 10(5):969](https://doi.org/10.1029/wr010i005p00969)) **[partially verified: abstract via index only]**.
- **The χ integral (the key formula for this report):** integrating Eq. 2 upstream from a base level x_b gives `z(x) = z(x_b) + (U / (K·A₀^m))^{1/n} · χ`, with **`χ = ∫_{x_b}^{x} (A₀/A(x'))^{m/n} dx'`** ([Mudd 2014, Eq. 4a–4b](https://www.pure.ed.ac.uk/ws/files/13521459/jgrf20188.pdf); the integral method is from Perron & Royden 2013, ESPL 38:570 **[partially verified: abstract; equations read in Mudd 2014]**).
  - At steady state with uniform U and K, all channels in a network are straight and collinear in χ–z space (Mudd 2014, Fig. 1).
- **The implicit solver:** `fastscapelib` solves `∂h/∂t = −K·A^m·(∇h)^n` with "an implicit finite difference scheme… detailed in Braun and Willet's (2013)".
  - It visits nodes bottom-up (receivers first) and sets erosion at base-level nodes to zero ([`spl.hpp` L26–52, L253 @b85cc6b](https://github.com/fastscape-lem/fastscapelib/blob/b85cc6b1341241cbe4a1d3458ed7e3fa5a857f48/include/fastscapelib/eroders/spl.hpp#L26-L52)).
  - For n = 1 each node is updated as `h ← (h + F·h_r') / (1 + F)`, with `F = K·dt·A^m / Δx` (L311–320, L355).
  - For n ≠ 1 it uses Newton iterations (L321–351).
  - Erosion is clamped so that no new depressions form (L357–364).
- **Design note:** with fixed receivers, the fixed point of that update plus uplift U satisfies `K·A^m·(h_i − h_r)/Δx = U`, i.e. `h_i = h_r + (U/K)·A^{−m}·Δx`. That is the discrete χ step. **So running the stream-power solver with the drainage network pinned to the given rivers converges to §3.2.** Simulating is only worth it for the land *between* rivers (§4.6).

### 3.2 χ integration along the given trees (recommended core)

- **Idea:** walk each tree from its base level upstream, and give each node its parent's elevation plus `Δx · S(A)`.
- **Inputs:** `x, y, parent, flow, wet`, and the area per attractor `a`.
- **Algorithm (Design note):**
  1. **Base level.** A `wet` node is over the sea. Give it `z = −seaDepth(d_coast)`, or simply `0`. The first dry node on each path is x_b, with `z_b = z₀` (e.g. 0 to a few metres).
  2. **Sweep.** Visit nodes in **increasing** index order, so parents come before children (the reverse of the flow sweep at L830). For a dry node k with parent p:
     - `Δx = |x_k − x_p|`
     - `z_k = z_p + Δx · S₀ · (A₀/A_k)^θ`
     
     S₀ is the "channel slope at reference area A₀"; take A₀ = 1 attractor.
  3. **Per-biome steepness (optional).** S₀ can vary with the node's subbiome (§7). The Mudd form is `(U/K)^{1/n}`, a steepness index, and it may vary in space.
- **C1 Local:** yes. One region's trees only, O(n), no halo. Region rivers are already computed per region.
- **C2 Downhill:** **guaranteed by construction.** `Δx > 0` and `S > 0`, so `z_child > z_parent` strictly.
  - Landlocked trees work the same way: their roots sit in a real ocean biome.
- **C3 Cost:** one pass, about 10 flops per node. 100k nodes is well under 1 ms.
- **C4 Bit-exact:** yes, if θ is **dyadic**, i.e. built from nested `√`:
  - θ = ½ is `1/√A`.
  - θ = ⅜ is `1/(⁴√A · ⁸√A)`.
  - **θ = 7⁄16 = 0.4375** (closest to the reference 0.45) is `1/(⁴√A · ⁸√A · ¹⁶√A)`, with ⁴√ = √√ and so on.
  - `Math.pow(A, -0.45)` is not covered by the exactness guarantee.
- **C5:** this is exactly the "height after rivers" direction.
- **Look (Design note):** concave long profiles. Steep headwaters, nearly flat lower trunks. The interior rises with river length.
  - Rough scale, using Hack-like growth `A ∝ L^{1.67}` ([Hack 1957, USGS PP 294-B, Eq. 3](https://pubs.usgs.gov/pp/0294b/report.pdf)), θ = ½, S₀ = 0.02 and D = 2 km: a 100 km main stem rises to about **450 m**. S₀ is the knob for overall relief.
- **Proposed params:** `hgt.chSlope` (S₀), `hgt.theta` (select ⅜ / 7⁄16 / ½ / ⅝), `hgt.seaDepth`, `hgt.baseZ`.

### 3.3 Génevaux's slope-map variant

- **Source:**
  - In Génevaux 2013, each new river node gets an elevation "higher than its ancestors to guarantee a consistent water flow", from a scalar river slope map ([§4.2.2, "River Slope map"](https://www.cs.purdue.edu/homes/bbenes/papers/Genevaux13ToG.pdf)).
  - New nodes must satisfy a Lipschitz condition `|p_z − p_iz| < α(p)·d(p, p_i)` against nearby nodes. It "prevents the creation of huge cliffs" (§4.2.2).
  - River flow comes from watershed area as `Q = 0.42·A^0.69` (after Dunne & Leopold 1978) (§5.1).
- **Difference from 3.2:** slope is set by position (a map), not by drainage area. Trunks and headwaters at the same place get the same gradient.
- **Design note:** use it only as a per-biome multiplier on S₀. The area dependence in 3.2 gives the concave profiles that the slope map alone lacks.
- **Constraints:** same as 3.2. The Lipschitz check against *other* branches is the useful extra (§4.1).

### 3.4 Monotone repair by carving (when river heights are edited afterwards)

- **Sources:**
  - mapgen4 accumulates flow from leaves to roots. Where a trunk is higher than its tributary, it **lowers the trunk** to the tributary's elevation ([`map.ts` L373–383 @c1d8cb0](https://github.com/redblobgames/mapgen4/blob/c1d8cb018a11a8b9e17d59233c36c176429d37eb/map.ts#L373-L383)).
  - Azgaar "downcuts" river cells at height ≥ 35 by `floor(flux / mean flux of higher neighbours)`, capped at 5 ([`river-generator.ts` L409–423 @83838f1](https://github.com/Azgaar/Fantasy-Map-Generator/blob/83838f14f1fb0523aed0b5fbb252f4595443c7f9/src/model/physical/river-generator.ts#L409-L423)).
- **Design note:** if anything later lowers or raises nodes (noise, the Lipschitz clamp in §4.1, user edits), restore monotonicity with **one reverse sweep**: for k = n−1…0, `z[par[k]] = min(z[par[k]], z[k] − ε)`.
  - This is the same loop shape as the flow sweep (L830). It only *lowers*, and it makes every path non-increasing toward the root in O(n).
  - Clamp dry nodes at `z ≥ 0`. Near the coast that can leave a flat estuary at sea level, which is non-increasing rather than strictly decreasing.

---

## 4. Filling the land between the rivers

### 4.1 Lower envelope of slope cones from channels and coast (distance-field method)

- **Idea:** every land point sits on a hillslope that rises from its "cheapest" channel:
  - **`h(p) = min( min over river segments s: z_s(p) + g_s(d(p, s)),  g_c(d_coast(p)) )`**
  - `z_s(p)` is the segment's bed elevation interpolated at the projection of p.
  - `g` is an increasing hillslope profile, for example `s·max(0, d − w)` with a flat valley floor of half-width w, or a parabola `c·d²`.
- **Sources for the ingredients:**
  - **Distance transform of a sampled function:** `D_f(p) = min_q (d(p,q) + f(q))` is the lower envelope of one cone or parabola per sample. It runs in linear time for squared Euclidean distance; min-convolution with a convex function is O(n) ([Felzenszwalb & Huttenlocher 2012, Theory of Computing 8:415–428](https://theoryofcomputing.org/articles/v008a019/)) **[partially verified: abstract and search-index text; the site refused connections]**.
  - **mapgen2:** elevation is a breadth-first distance from the coast, normalised by the *global* maximum distance: `elevation = d / maxDistance` ([`elevation.js` L41–87 @f16f485](https://github.com/redblobgames/mapgen2/blob/f16f485a62510344afe13e9c6aa01f7fa25be17e/elevation.js#L41-L87)).
  - **mapgen4:** mountains come from a BFS distance from peak triangles with a random per-step increment `spacing·(1 + jaggedness·(r₁ − r₂))` ([`map.ts` L40–55 @c1d8cb0](https://github.com/redblobgames/mapgen4/blob/c1d8cb018a11a8b9e17d59233c36c176429d37eb/map.ts#L40-L55)).
- **Inputs:** the channel z from §3.2, coast points, and a hillslope slope field `s(p)` from land types (§7).
- **C2 Downhill (Design note):**
  - **Drainage.** With constant s, moving from p toward its argmin source lowers h at rate s. So **h has no local minima except at sources**: every pixel drains to a channel or the coast.
  - **Varying s.** This still holds when s varies slowly (`|∇s|·d < s`), so smooth s over at least the valley half-width.
  - **Perched rivers.** A river node can end up *above* the envelope, when a lower trunk of another branch lies close by: `z_a > z_b + s·d_ab`. Avoid it the way Génevaux does, with the Lipschitz condition (§3.3). Either keep `s` ≫ the channel slopes, which is physically normal (hillslopes are 0.1–0.6, channels 0.001–0.05) **[unverified: typical ranges]**, or clamp `z_k ← min(z_k, env(x_k))` and then run the carve sweep (§3.4). Repeat both until stable; both steps only lower values.
- **C1 Local:** yes, provably.
  - Every dry source has `z ≥ 0`, so a source farther than R contributes at least `s_min·R`. If the minimum found within R is ≤ `s_min·R`, it is exact.
  - Choose `R ≥ h_max/s_min` and cap h there. For example, h_max = 600 m and s_min = 0.02 give R = 30 km. That is ≪ 128 km, so a 3×3 block of regions' rivers is always enough.
  - The result is one global function evaluated locally, so it is **seamless by construction**: it is a min of continuous functions.
  - mapgen2's global normalisation (`/ maxDistance`) must be replaced by constant scales.
- **C3 Cost:**
  - **Per pixel:** a segment grid lookup, about 50–200 candidate segments within R at D = 2 km. That is too slow for a full raster in JS at ~10⁸ operations per frame.
  - **Per-region raster (Design note):** at 250 m, with a halo of R, the raster is about 750² cells. Use a Dijkstra or chamfer pass seeded with the stamped `z` (edge costs `s·h`, `s·h·√2`), or Felzenszwalb's two-pass transform for the parabolic `g`. That is O(N log N) or O(N), roughly tens of ms. Sample the raster bilinearly per pixel.
- **C4 Bit-exact:** yes. Distances need only `√`, and heap ties break by index.
- **C5:** yes.
- **Look:**
  - Linear `g` gives V valleys and straight, creased divides along cone intersections. These are like Voronoi bisectors between channels, "pyramidal" without noise.
  - Parabolic `g` gives U valleys.
  - A flat floor `w ∝ √flow` gives floodplains along big rivers. This matches the √flow river width (`overlays.ts` L315–317) and hydraulic geometry `w ∝ Q^0.5` ([Leopold & Maddock 1953, USGS PP 252, Eq. 1](https://pubs.usgs.gov/pp/0252/report.pdf)).
- **Rounded crests (Design note):** replace the hard `min` with a polynomial smooth-min of radius k. It only acts where two candidates are within k of each other, which happens at divides, not at channels. It is bit-exact. Its source is a blog post (Inigo Quilez, "smooth minimum") **[blog only, unverified]**.

### 4.2 Eikonal / fast marching for spatially varying hillslope steepness

- **Source:** fast marching solves the Eikonal equation for monotonically advancing fronts ([Sethian 1996, PNAS 93(4):1591](https://pmc.ncbi.nlm.nih.gov/articles/PMC39986)) **[partially verified: abstract]**. The O(N log N) heap complexity is general knowledge **[unverified]**.
- **Idea:** solve `|∇h| = s(x)` from sources with initial values `z_k`. This is the "correct" version of 4.1 when s varies between biomes: it is a geodesic distance, so the descent property holds for any positive s, including sharp biome changes.
- **C1:** per region raster with an R halo, as in 4.1.
- **C2:** every non-source cell has a downhill neighbour by construction. **C3:** O(N log N). **C4:** yes, `√` only.
- **Look:** like 4.1, but slopes change exactly at biome borders: cliffs where a marsh meets hills, unless s is smoothed.

### 4.3 Génevaux: Voronoi cells of river nodes, crest heights, blended primitives

- **Source** ([Génevaux 2013](https://www.cs.purdue.edu/homes/bbenes/papers/Genevaux13ToG.pdf)):
  - **Cells and crests (§5.1).** The domain is split into Voronoi cells of river node positions. "Some Voronoi cell boundaries correspond to the ridges". Each crest vertex q, equidistant d from nodes a, b and c, gets **`q_z = max(a_z, b_z, c_z) + α(q)·d`**, with α ∈ [0, 0.25] a "terrain slope map" (§5.1, Fig. 11).
  - **Primitive placement (§6.2).** Terrain primitives are Poisson-sampled (50 per cell). Each primitive's elevation is a distance-weighted mix of the projection onto the river and onto the cell's ridge lines.
  - **Noise (§6.2).** Noise amplitude grows with distance from the river and with the river-to-crest height difference, "more roughness for the mountains than for the valleys". "Using noise can produce small local minima, but they remain negligible".
  - **Combination (§7).** Primitives combine in a construction tree:
    - blend: `h = (w_A·h_A + w_B·h_B)/(w_A + w_B)`;
    - replace (rivers carved on top): `h = (1−w_B)·h_A + w_B·h_B`;
    - river primitive: `h(p) = u_z(p) + profile(d(p))`.
    
    Weights have compact support: `w = (1 − d²/r²)²` for d < r, else 0 **[partially verified: the formula's layout was garbled in text extraction; the compact support was confirmed]**.
- **Inputs:** river nodes with z (§3.2), α per biome.
- **C1:** yes. Voronoi cells and compact primitives are local; a pixel needs nodes within ~2 cell radii.
- **C2:**
  - **Rivers.** Monotone, because node z is (§4.2.2).
  - **Crests.** Always above the three nodes, which guarantees ridges between basins.
  - **Hillslopes.** Can hold small pits from noise, which the authors accept.
- **C3:** ~5 s for a few hundred to a few thousand km² on 2013 hardware (Table 2). Compact: Hoya Island is 3368 km² with 81,853 primitives (Table 3).
- **C4:** yes. The kernel is polynomial; avoid Perlin variants that use trig.
- **C5:** yes. This is the method closest to the brief. Its §4 (growing the network) is replaced here by space colonization.
- **Look:** analytic and continuous, with ridges along Voronoi edges. The authors report "meandering crests and outcroppings of unnatural-looking hills" from the greedy construction (§8, Limitations).

### 4.4 Diffusion: Laplace or gradient-guided interpolation with constraints

- **Sources:**
  - Hnaidi et al. rasterise feature curves (ridges, riverbeds, cliffs) with elevation, slope-angle and noise constraints. They solve Laplace `ΔF = 0` where no gradient is given, and a gradient equation `∇F = G` near slope constraints. They deliberately avoid Poisson, because it would lose the gradient direction ([Hnaidi 2010, CGF 29(7), §4.2](https://perso.liris.cnrs.fr/egalin/Articles/2010-terrain.pdf)).
  - Noise **amplitude and roughness** are themselves diffused from the curves, then one noise is synthesised from the diffused fields (§4.3).
  - A multigrid solver with Jacobi relaxation runs at 512²–2048² in 0.17–0.81 s on a 2010 GPU (§5.2, Table 2).
  - The diffusion follows Orzan et al.'s diffusion curves (cited as [OBW08] in §4.2) **[unverified: Orzan 2008 not read]**.
  - Kelley 1988's "surface under tension" is the same family **[partially verified]**.
- **Inputs:** Dirichlet values on river segments (§3.2), the coast (0) and region borders (§6.1). Optionally gradient constraints across rivers to get V-shaped banks.
- **C1 (Design note):** a solve over a region, which is a global PDE. It becomes local because the region border is a divide.
  - Fix border cells to a deterministic ridge function that both neighbours compute identically (§6.1). Solve each region independently.
  - The result is C⁰ across borders, with a crease, which is what a divide looks like.
- **C2 (Design note):** a pure Laplace solution has **no interior local extrema** (maximum principle) **[unverified: standard PDE result]**, so pure diffusion makes no pits. Every steepest-descent path ends on a constraint. If border values are above the adjacent river values, paths end on rivers or the coast. Gradient constraints and added noise break this, so repair afterwards (§5).
- **C3:** multigrid on 512² per region is roughly tens of ms in JS, but it is the heaviest of the "analytic" options.
- **C4:** yes, with fixed iteration counts and a fixed sweep order (Jacobi is order-independent).
- **C5:** yes.
- **Look:** smooth "soap film" between constraints. It is flat and featureless far from them unless noise is added. Point constraints make cusps, so use segments.

### 4.5 Constrained midpoint displacement (river and mountain together)

- **Source:**
  - Prusinkiewicz & Hammel combine midpoint displacement with a squig-curve river by subdividing triangles. Midpoints on edges crossed by the river get the minimum altitude `alt(n) = Σ dᵢ`. The riverbed vertices are "guaranteed to be the lowest of all points", and "the river will never run upwards" ([Prusinkiewicz & Hammel 1993, Graphics Interface, "Integration of a river and a mountain"](http://algorithmicbotany.org/papers/mountains.gi93.pdf)).
  - Displacements are looked up by **hashing vertex positions**, so the method needs no explicit neighbour context (section "Midpoint-displacement method revisited", Fig. 5).
  - Limitations: there are no tributaries, and branching curves are "not immediately apparent" to incorporate (Conclusions). The river bed is flat (equal altitude), and valleys come out asymmetric.
- **Relevance:**
  - C1 and C4 are excellent: hashed and local.
  - The branching network problem and the flat bed rule it out here. It is shown for completeness.
  - **Design note:** hashed, position-keyed detail is the right model for *per-pixel noise* in §7.

### 4.6 Stream-power relaxation with the network pinned (simulate the land between the rivers)

- **Sources:**
  - Cordonnier et al. turn a user-painted uplift map into a "stream graph… embedding elevation information and stream flow" using the stream-power equation ([Cordonnier 2016, CGF 35(2):165, DOI 10.1111/cgf.12820](https://hal.archives-ouvertes.fr/hal-01262376)) **[partially verified: abstract only]**.
  - Schott et al. 2023 run it interactively on the GPU ([release code](https://github.com/H-Schott/StreamPowerErosion/tree/8a0c017fe2e599c74a19c3766b1d93d428e9d451), [`spe_shader.glsl` @8a0c017](https://github.com/H-Schott/StreamPowerErosion/blob/8a0c017fe2e599c74a19c3766b1d93d428e9d451/data/shaders/spe_shader.glsl)):
    - Drainage area is approximated **locally**: each cell sums its 8 neighbours' area weighted by `slope^p_flow` (L123–157).
    - Border cells are fixed at zero elevation (L172–179).
    - Each iteration does `h −= dt·(k·A^0.8·S^2 − k_h·ΔH)` with defaults `k = 0.0005`, `p_sa = 0.8`, `p_sl = 2`, `k_h = 200`, `dt = 50`.
    - `h = max(h, receiver)` prevents pits, then uplift is added (L29–36, L188–208).
  - Tzathas et al. 2024 use **analytical** stream-power solutions, so that "time… acts as the parameter of a mathematical function" and not as an iteration count. They use a multigrid-accelerated iteration plus hillslope and landslide models ([CGF 43(2), DOI 10.1111/cgf.15033](https://diglib.eg.org/handle/10.1111/cgf15033)) **[partially verified: abstract via search index]**.
- **C5:** a free simulation routes its own rivers, which will not match the drawn ones. **Design note:** to fit the given map, pin the network.
  1. Cells under river segments are Dirichlet at their §3.2 elevation.
  2. Their receiver is the next cell along the given tree.
  3. Region-border cells are fixed ridge values (§6.1).
  4. Only the cells in between evolve under uplift (per land type) + stream power + diffusion.
  
  The free cells then grow small dendritic gullies *below the river resolution*. Those gullies drain into the given rivers.
- **C1:** per region with a fixed border (each region is hydrologically closed). Schott's per-iteration stencil has a 1-cell halo, but convergence needs at least the longest flow path in iterations, so treat it as per-region.
- **C2:** pinned channels are monotone. `max(h, receiver)` keeps free cells draining.
- **C3:** high: hundreds to thousands of iterations × 260k cells per region. Feasible only in a worker, cached per region.
- **C4:** only with dyadic exponents (m = ½ via `√`, n = 1, which is linear and needs no Newton step). Schott's `pow(A, 0.8)` and `pow(S, 2)` would need replacing; S² is exact as `S·S`.
- **Look:** the most "geomorphic": dendritic ridges and spurs, self-similar valleys.

---

## 5. Repairing drainage after noise and edits

### 5.1 Depression filling

- **Sources:**
  - **Priority-Flood** floods inward from the edge with a priority queue, giving a surface with no depressions. It is O(n) for integer data, O(n log n) for floats, and also labels watersheds ([Barnes, Lehman & Mulla 2014, Computers & Geosciences 62:117, arXiv:1511.04463](https://arxiv.org/abs/1511.04463)) **[partially verified: abstract]**.
  - **Per-tile operation:** all edge cells are queued, the lowest cell is dequeued, and lower unvisited neighbours are raised to its level ([Barnes 2016, C&G 96:56, §3.1, Fig. 2](https://arxiv.org/abs/1606.06204)).
  - **Definition of a filled DEM:** every cell is at least its original height and has a non-ascending path to the boundary (Barnes 2016, §1).
  - **Planchon & Darboux** flood the whole surface, then drain the excess. They can produce flat or gently sloping fills ([Catena 46:159, 2001; SAGA tool doc](https://saga-gis.sourceforge.io/saga_tool_doc/9.3.0/ta_preprocessor_3.html)) **[partially verified: abstract and implementation docs]**.
  - **O'Leary's `fillSinks`** is this ε-scheme: edge cells are fixed, others start at "infinity" and are lowered to `neighbour + ε` (ε = 1e-5) until stable ([`terrain.js` L301–333 @a2511d6](https://github.com/mewo2/terrain/blob/a2511d6b673ae92f5983f3343365ba9326c03b63/terrain.js#L301-L333)).
  - **Azgaar** raises each land cell to `min neighbour + 0.1`, lowest first, with lake handling and a bad-progress abort ([`river-generator.ts` L540–596 @83838f1](https://github.com/Azgaar/Fantasy-Map-Generator/blob/83838f14f1fb0523aed0b5fbb252f4595443c7f9/src/model/physical/river-generator.ts#L540-L596)).
- **C1:** depressions can be arbitrarily large, so filling is inherently non-local.
  - Barnes 2016 makes tiles work by sending each tile's **perimeter elevations, perimeter labels and spillover graph** to a producer, which solves a global spillover graph and sends back per-label levels (§3.2–3.3).
  - **Design note:** here, seed Priority-Flood **only from ocean cells inside the region**, with region-border cells held fixed and high (§6.1). The region is then the whole hydrological domain and no global step is needed.
  - Pockets walled off from the sea (L24–25) have no ocean seed. They fill up to the border ridge and become flat lakes or plateaus. Either accept that or lower the ridge there.
- **C2:** guaranteed (non-ascending; strictly descending with the ε variant).
- **C3:** O(N log N) per region raster; tens of ms.
- **C4:** yes, with an index tie-break in the heap.
- **Look:** flat lake surfaces or ε-ramps. It *raises* terrain, so it cannot cut through a ridge that dams a river; that needs carving (5.2).

### 5.2 Stream burning and drainage enforcement

- **Sources:**
  - **AGREE** ([Hellweger & Maidment 1997, CRWR](http://caee.webhost.utexas.edu/prof/maidment/gishyd97/terrain/agree/agree.htm)):
    1. Lower the cells under the vector streams by `smoothdist`.
    2. Buffer the lines.
    3. Inside the buffer, interpolate along a straight line from the lowered line up to the original surface at the buffer edge.
    4. Lower the line cells again by `sharpdist`, so trenches are not filled in later.
    
    Heuristic: buffer ≈ the spatial error of the vectors; smoothdist ≈ mean slope × buffer × a forcing factor (0.1 "was found to work well").
  - **ANUDEM**: Hutchinson's gridding procedure interpolates elevations *and* stream lines with automatic removal of spurious pits ([J. Hydrology 106:211, 1989](https://www.scilit.net/publications/bfd1ad03e4cf5f2c651881bb943cd8fb)) **[partially verified: abstract only]**.
- **Design note:** AGREE is the right tool for imprinting the given rivers into *any* height field (noise, diffusion or a simulation), and it maps directly onto these params:
  - buffer = the valley half-width `w(flow)`;
  - smoothdist = valley depth;
  - sharpdist = channel depth.
  
  Burn first, then Priority-Flood (5.1). This is the standard GIS "burn, then fill" order.
- **C1:** per segment, with a halo equal to the buffer. **C2:** guaranteed only when combined with §3.2 bed heights or a fill. **C4:** yes.

### 5.3 Fill or carve here?

- **Design note:**
  - Rivers are given, so **carve along rivers** (§3.4 and 5.2): the channel must win.
  - **Fill off-river pits** (5.1), or accept them as Génevaux does, since they are "negligible" at large scale (§6.2).
  - Filling across a river would flatten it into a lake, and breaching a ridge with no river would invent a channel the map does not show.

---

## 6. Drainage divides

### 6.1 Region borders are the primary divides (by construction)

- **Facts from the code:**
  - Rivers never step onto another region's land. Steps that would are redirected, and attractors that are not visible inside the region are banned (`rivers.ts` L21–26, L405–416, L489–545).
  - The exceptions:
    - **landlocked** regions, which cross neighbours to reach the sea (L321–338, L410–411);
    - **walled-off pockets**, which stay unreached (L24–25).
  - Region cells are unwarped at the region level (`world.ts` L4), but the drawn region follows merged, warped biomes when nested (`world.ts` L22–29; `rivers.ts` L229–244).
- **Design note: a ridge term that both sides agree on.**
  - **Distance to the border.** Let `b(p)` be the distance to the region border. It can be approximated cheaply from the **unwarped** region Voronoi: `(d₂ − d₁)` for the two nearest region sites, divided by twice their separation, scaled. It differs from the drawn border by up to the biome-warp amplitude. A cheap fix is to only *taper* the ridge within that distance.
  - **Ridge height.** `H_ridge(p) = max(z of the nearest channel on each side) + s·b_margin + noise(p)`. It is a pure function of position and of both regions' rivers. Each region computes the other's rivers through the 3×3 halo, so both sides produce identical values.
  - **Combining it:** `h = max(h_fill, H_ridge·taper(b(p)))`, or use it as the Dirichlet border in 4.4, 4.6 and 5.1.
  - **Landlocked regions:** suppress the ridge within the valley width of any river segment that crosses a border. Carve it with 5.2.

### 6.2 Divides between basins inside a region

- **Sourced:** Génevaux places ridges on Voronoi edges between river nodes and raises crest vertices above all three adjacent nodes (`max + α·d`, §5.1). The watershed of an outlet is the set of upstream-connected cells (§5.1).
- **Emergent:** in §4.1 and §4.2, divides appear automatically where cones from different channels meet, so they need no explicit placement.
- **Design note:**
  - **Major vs minor divides.** `tree[k]` (L833–834) separates basins that reach the sea independently (major divides) from tributaries of one tree (minor divides). Find the two nearest candidates with **different `tree`** values. Where `|d₁ − d₂|` is small, add `divideBoost·(1 − |d₁ − d₂|/k)²`. That gives higher ridges between separate river systems than between tributaries, as real drainage basins have.
  - **Use Génevaux's crest rule as a floor:** `h ≥ max(z_a, z_b) + α·d` along the bisector.

### 6.3 The coastal strip

- **Fact:** coastal subbiomes have no attractors (`skipCoast`), so a band roughly one subbiome (~8 km) wide carries only river mouths.
- **Design note:** the coast cone `g_c(d_coast)` in §4.1 makes this band rise gently from 0. A lower coastal slope `s_coast` gives coastal plains. Use a higher one for cliffy land types (§7).

---

## 7. Steering relief with biome land types

### 7.1 Sourced patterns

- **Génevaux:** two maps steer everything. The river slope map sets river gradients, and the terrain slope map α "describes… plains, plateaus, valleys, or mountains". It can be weighted by distance to the coast ([§3, §5.1](https://www.cs.purdue.edu/homes/bbenes/papers/Genevaux13ToG.pdf)). Noise amplitude scales with distance to the river and the river-to-crest height (§6.2).
- **mapgen4:** low-amplitude "hills" noise (whose main purpose is to make rivers meander) is mixed with distance-field "mountains" using the weight `e²`. Mountains therefore dominate only at high base elevation ([`map.ts` L162–197 @c1d8cb0](https://github.com/redblobgames/mapgen4/blob/c1d8cb018a11a8b9e17d59233c36c176429d37eb/map.ts#L162-L197)).
- **Hnaidi:** diffuse the **parameters** (noise amplitude A, roughness R) over the domain, then synthesise one noise driven by the two fields ([§4.3](https://perso.liris.cnrs.fr/egalin/Articles/2010-terrain.pdf)). There is no seam, because only one noise is evaluated.
- **Schott and Cordonnier:** relief is authored as an **uplift** map, and mountains appear where uplift is high (StreamPowerErosion README @8a0c017). Uplift enters the steady-state slope as `(U/K)^{1/n}` ([Mudd 2014, Eq. 2](https://www.pure.ed.ac.uk/ws/files/13521459/jgrf20188.pdf)). So "mountain biome" means a higher S₀ in §3.2 *and* steeper hillslopes.

### 7.2 Mapping `LAND_TYPES` to parameters (Design note; values are starting points, not sourced)

| Land type | Hillslope `s` | Channel ×S₀ | Valley floor `w₀` | Detail noise | Amplitude (m) |
|---|---|---|---|---|---|
| Marsh | 0.01 | 0.3 | wide (×3) | fbm, 1 octave | 2 |
| Grassland, Steppe, Savanna | 0.03 | 0.7 | ×1.5 | fbm | 10 |
| Forest, Old forest, Taiga | 0.05 | 1.0 | ×1 | fbm | 20 |
| Scrub, Heath, Tundra | 0.07 | 1.0 | ×1 | fbm + ridged 0.3 | 30 |
| Desert | 0.04 | 0.8 | ×1 | ridged (dune-like), anisotropic | 25 |
| Hills | 0.15 | 1.8 | ×0.5 | ridged | 80 |

- **Caveat:** land type is a hash of the biome key (`render/source.ts` L65–67), so Hills can neighbour Marsh at random. Steering by land type produces relief "patches" that do not follow any large-scale logic.
- **Recommendation:** multiply in a low-frequency, region-scale relief field: `fbm` at 1/200 km, or a per-region hashed "tectonic" value blended between region sites. That way mountain belts span several biomes. Optionally re-weight the land-type hash by it, but that would change the existing colours, so it is a separate decision.

### 7.3 Blending across cell borders without seams (Design note)

1. **Blend parameters, not heights** (Hnaidi §4.3). Per pixel, compute weights for the k nearest biome sites, evaluate the parameters (s, S₀ multiplier, amplitude, ridge mix) as a weighted average, then evaluate **one** noise and **one** envelope. Use Génevaux's compact polynomial weight `(1 − d²/r²)²` (§7): it is bit-exact, local and needs no `exp`.
   - Weights: use distance to the warped border, `(d₂ − d₁)` from `Level.query`'s nearest and second-nearest sites, with blend width ≈ 0.25 × biome size.
2. **Smooth s before using it in §4.1.** The descent property needs `|∇s|·d < s`. A blend width ≥ the largest valley half-width satisfies it. Fast marching (4.2) does not need this.
3. **Mask detail noise near channels:** `h += A(p)·m(p)·N(p)`, with `m = smoothstep(0, 1, (h_base − z_channel)/H_mask)` or `smoothstep(d_river/w)`. Noise then vanishes on the bed and grows toward crests, which is Génevaux's rule (§6.2) and keeps rivers lowest.
4. **Bit-exact noise:** `fbm` and `ridged` in `shared/core/noise.ts` (L81–123) already qualify. `smoothstep` is polynomial.

---

## 8. Game and demo implementations reviewed

| Generator | Order | Height method | River ↔ height link | Reusable here |
|---|---|---|---|---|
| mapgen2 ([`elevation.js` @f16f485](https://github.com/redblobgames/mapgen2/blob/f16f485a62510344afe13e9c6aa01f7fa25be17e/elevation.js#L41-L87)) | Coast → height → rivers | BFS distance to coast; BFS parents become the downslope graph | Rivers follow BFS parents | The coast-distance cone (4.1), minus the global `/maxDistance` |
| mapgen4 ([`map.ts` @c1d8cb0](https://github.com/redblobgames/mapgen4/blob/c1d8cb018a11a8b9e17d59233c36c176429d37eb/map.ts)) | Height → rivers | Noise + mountain distance field, mixed by `e²` (L162–197) | Priority-queue downslope from the ocean (L309–347); trunk lowered to tributary (L380–382) | The carve repair (3.4); the hills/mountains mix (7.1) |
| O'Leary ([`terrain.js` @a2511d6](https://github.com/mewo2/terrain/blob/a2511d6b673ae92f5983f3343365ba9326c03b63/terrain.js)) | Height → erosion → rivers | Slope + cone + Gaussian mountains, then erosion | `√flux·slope + slope²` erosion (L370–382), i.e. stream power with m = ½, n = 1, plus creep; ε sink fill (L301–333) | The ε-fill (5.1) |
| Azgaar ([`river-generator.ts` @83838f1](https://github.com/Azgaar/Fantasy-Map-Generator/blob/83838f14f1fb0523aed0b5fbb252f4595443c7f9/src/model/physical/river-generator.ts)) | Height template → rivers | Hill and range blobs (see the sibling report) | Depressions raised by +0.1 (L540–596); river beds downcut ≤ 5 (L409–423) | Downcut as a cheap "valley under river" (3.4) |
| Génevaux 2013 | **Rivers → height** | Voronoi crests + blended primitives | By construction | Crest rule (6.2), noise scaling, compact kernel |
| Derzapf et al. 2011, "River networks for instant procedural planets" ([CGF 30(7):2031](https://diglib.eg.org/handle/10.1111/v30i7pp2031-2040)) | Rivers with adaptive refinement | — | — | Evidence that on-the-fly, LOD-refined river terrain is feasible **[partially verified: abstract only]** |

Dwarf Fortress was dropped: no primary source describing its elevation/river algorithm was found.

---

## 9. Recommended pipelines for Sandbox 3 (Design note)

All three options share step 0:

- **0. Channel profile (§3.2) + carve (§3.4).** Per region, O(n), bit-exact with dyadic θ, strictly monotone. Store `z` alongside `flow` in `RegionRivers`.
- **Shared params:** `hgt.chSlope` (S₀, default 0.02), `hgt.theta` (½ | 7⁄16 | ⅜), `hgt.areaPerAttr` (auto = subSize²/perSub), `hgt.baseZ`, `hgt.seaDepth`.

### Option A: Envelope (simple; no grids)

1. Height = min over channel segments within R (3×3 regions' rivers) of `z_seg(p) + s(p)·max(0, d − w₀·√flow)`, and the coast cone.
2. s comes from land type, blended with compact weights (§7.3).
3. Add masked fbm/ridged detail (§7.3, point 3).
4. Optionally run a Lipschitz clamp of channel z against nearby other-tree nodes, plus the carve sweep (§4.1, C2).
5. Render through a per-region 250–500 m raster cache with bilinear sampling, plus per-pixel detail noise.

- **Guarantees:** rivers monotone; every pixel drains to a channel or the coast, before noise. Seamless and local with a 1-region halo.
- **Params:** `hgt.hillSlope[landType]`, `hgt.valleyWidth` (w₀), `hgt.radius` (R), `hgt.coastSlope`, `hgt.smoothMin` (k), `hgt.noiseAmp[landType]`, `hgt.noiseMask` (H_mask), `hgt.res`.

### Option B: Per-region raster with divides and hydrological repair (medium)

1. Do Option A on a per-region raster with an R halo, using fast marching (4.2) so biome slope changes stay drainable.
2. Add the shared region-border ridge (§6.1) and the other-tree divide boost (§6.2).
3. Add noise.
4. AGREE-burn the given rivers (5.2).
5. Run Priority-Flood with ε seeded from the region's ocean cells only, with border cells fixed (5.1).

- **Guarantees:** every cell has a downhill path to the sea through the given rivers. Pockets become lakes.
- **Params:** Option A's params, plus `hgt.borderRidge`, `hgt.divideBoost`, `hgt.burnBuffer` (×w), `hgt.burnSmooth`, `hgt.burnSharp`, `hgt.fillEps`, `hgt.pockets` (`lake | lowerRidge`).

### Option C: Pinned stream-power relaxation (ambitious)

1. Start from Option B's raster.
2. Pin the channel cells to their §3.2 z, with receivers along the given tree.
3. Pin the border to the ridge.
4. Evolve the free cells with implicit stream power (fastscape update, m = ½ via `√`, n = 1), plus linear hillslope diffusion, plus uplift `U(landType × region relief)`, for a fixed iteration count.
5. Finish with the 5.1 fill.

- **Result:** sub-resolution dendritic gullies and realistic spurs that all feed the drawn rivers.
- **Cost:** high. Run it per region in a worker and cache it.
- **Params:** `hgt.uplift[landType]`, `hgt.K`, `hgt.kd` (diffusion), `hgt.dt`, `hgt.iters`, `hgt.flowExp` (receiver weighting; 1 = single flow direction).

**Recommendation:** build Option A first. It reuses everything the map has, needs no new global structures, and already satisfies C1–C5. Option B's repair passes are needed only once noise amplitude gets large. Option C is a separate project.

---

## 10. Summary table

| # | Method | Needs from this map | C1 Local / halo | C2 Rivers downhill | C3 Cost | C4 Bit-exact | C5 Height after rivers | Look | Source |
|---|---|---|---|---|---|---|---|---|---|
| 3.2 | χ integration of channel profile | Tree, `flow`, `wet` | Per region, no halo | **Guaranteed** | O(n), < 1 ms | Yes (dyadic θ) | Yes | Concave long profiles | Mudd 2014 Eq. 2–4; Perron & Royden 2013 |
| 3.3 | Slope-map river elevation | Tree, slope map | Per region | Guaranteed | O(n) | Yes | Yes | Uniform gradients | Génevaux 2013 §4.2.2 |
| 3.4 | Carve sweep | Tree, z | Per region | Restores it | O(n) | Yes | Yes | Trench where repaired | mapgen4 `map.ts` L380–382; Azgaar L409–423 |
| 4.1 | Lower envelope of cones/parabolas | Channel z, coast, s(p) | 3×3 regions (R ≤ 128 km), seamless | Yes, if s smooth and Lipschitz | Raster O(N) to O(N log N) | Yes | Yes | V/U valleys, creased divides | Felzenszwalb & Huttenlocher 2012; mapgen2/mapgen4 BFS |
| 4.2 | Fast marching, varying slope | Same | Region raster + halo | Yes, any s > 0 | O(N log N) | Yes | Yes | Slope breaks at biome borders | Sethian 1996 |
| 4.3 | Voronoi crests + primitives | Node z, α map | Local (cells) | Rivers yes; small pits from noise | Seconds per 1000s of km² (2013) | Yes | **Yes (native)** | Smooth; meandering crests | Génevaux 2013 §5–7 |
| 4.4 | Laplace / gradient diffusion | Dirichlet on rivers, coast, border | Per region with fixed border | No pits without noise (max. principle) | Multigrid, tens of ms | Yes | Yes | Soap film, needs noise | Hnaidi 2010 §4; Kelley 1988 |
| 4.5 | Constrained midpoint displacement | Single river | Hashed, local | Yes (flat bed) | Low | Yes | Partly | Asymmetric V; no tributaries | Prusinkiewicz & Hammel 1993 |
| 4.6 | Pinned stream-power relaxation | Uplift, pinned channels, border | Per region, fixed border | Yes (pinned + `max(h, receiver)`) | High (iterations) | With m = ½, n = 1 | Only if pinned | Dendritic, geomorphic | Cordonnier 2016; Schott 2023 shader; fastscapelib `spl.hpp` |
| 5.1 | Priority-Flood / ε fill | Any raster, ocean seeds | Per region if border fixed; else Barnes 2016 tiling | Guaranteed | O(N log N) | Yes | Yes | Flat lakes / ε-ramps | Barnes 2014, 2016; Planchon & Darboux 2001; O'Leary L301–333 |
| 5.2 | AGREE burn / ANUDEM | Vector rivers | Segment + buffer | With 3.2 or 5.1 | O(N) | Yes | Yes | Smooth valley trench | Hellweger & Maidment 1997; Hutchinson 1989 |
| 6.1 | Region-border ridge | Region borders, both sides' rivers | 1-region halo | Makes regions closed | Per pixel | Yes | Yes | Main divides along borders | Code fact (`rivers.ts` L21–26) + Design note |
| 6.2 | Other-tree divide boost | `tree` ids | Local | Neutral | Per pixel | Yes | Yes | Major vs minor divides | Génevaux §5.1 + Design note |
| 7.3 | Parameter blending + masked noise | Land types, distance to river | Local | Keeps beds lowest | Per pixel | Yes | Yes | Biome-specific relief, no seams | Hnaidi §4.3; Génevaux §6.2, §7; mapgen4 L162–197 |
