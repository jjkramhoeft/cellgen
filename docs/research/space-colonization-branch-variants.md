# Space Colonization Rivers: Ways to Change Branching and Look

*Research date: 2026-11-07. Scope: knobs that change the branching behaviour and look of the space-colonization rivers in `sandboxes/sandbox3/src/world/rivers.ts` (now `sandboxes/sandbox4/src/world/rivers.ts`). Each knob is described as something that can be added to the existing per-region, open-venation, bit-exact implementation.*

**How to read the citations**

- Each claim cites the source that owns it: paper plus section or figure, or repo plus file, line and commit. Primary sources were read directly unless noted.
- **[unverified]** means the claim is general or bibliographic knowledge that was not checked against the primary text in this pass.
- **[partially verified]** means the primary source exists and is cited, but only part of the claim was confirmed, for example from an abstract or a third-party copy.
- Text marked "Design note" or "Recommendation" is my own engineering judgement, not a sourced claim.
- **Determinism** for each technique says whether it can be built with IEEE `+ − × ÷ √` only, as `rivers.ts` requires (no `Math.sin/cos/pow/exp`).
- **Bit-exact angle trick (Design note):** every angle knob below can be bit-exact. Store the cosine as a literal, or build it from `√`: cos 30° = √3/2, cos 45° = √½, cos 60° = ½, cos 72° = (√5 − 1)/4. Rotate a unit vector **d** toward another, **p**, by building `d' = p·c + q·s`, where **q** is the normalized component of **d** orthogonal to **p** and `s = √(1 − c²)`. Rotation by an arbitrary angle can also use the rational form `c = (1−t²)/(1+t²)`, `s = 2t/(1+t²)`, with `t = tan(θ/2)` given as a literal.

**Code locations used below** (`rivers.ts` at the time of writing):

| Hook | Lines | What happens there |
|---|---|---|
| `attractors()` | 198–240 | `perPatch` points per inland patch, placed randomly within ±0.8 × cell size around the site |
| `addNode()` | 345–394 | Attractors within dₖ are removed, and each attractor's nearest node (`near`, `nearD2`) is updated |
| Pull loop | 518–534 | Each live attractor within dᵢ adds `unit(a − k) × pullWeight` to `sx/sy[k]` |
| Direction | 587–610 | Normalize, then add `jitter × discVec` and normalize again |
| Step target | 611–621 | `t = node + D·dir`, with the stall fallback |
| Region clip | 622–643 | Bans, or a straight step to the closest attractor, or `kill(k)` |
| Child cap | 644–648 | `MAX_CHILDREN = 8` safety net |
| Flow | 653–655 | Reverse sweep: `flow[parent] += flow[k]` |
| Width | `render/overlays.ts` 304–307 | `riverPx = scale·zf·(0.45 + 0.3·√flow)` |

---

## 1. Overview

The algorithm's own papers describe four levers that change the look. Three are numeric: attractor count and density, the influence radius dᵢ, and the kill distance dₖ. The fourth is the spatial and temporal distribution of the attractors ([Runions, Lane & Prusinkiewicz 2007, §3 and §4](http://algorithmicbotany.org/papers/colonization.egwnp2007.pdf)). The tree-model follow-up adds per-tip control: a perception cone, inertia toward the previous direction, tropism, and resource allocation that decides which branches grow vigorously ([Palubicki et al. 2009, §4.1–4.3](http://algorithmicbotany.org/papers/selforg.sig2009.pdf)).

Everything else in this report is either:

- a post-process on the finished tree: widths, ordering, pruning, relaxation, smoothing, meanders, OCN rewiring, or
- a river-specific target to aim the knobs at: junction angles, Hack's law and drainage-pattern types.

One mechanism is worth keeping in mind throughout. Branches appear when the set of attractors pulling one node later **splits** between two nodes. Splits happen "even if the set of sources is fixed" ([Runions et al. 2005, §3.4, Fig. 6](http://algorithmicbotany.org/papers/venation.sig2005.pdf)). Anything that makes pull sets larger and more coherent (more attractors, larger dₖ, inertia) therefore gives fewer, smoother branches. Anything that makes them small and noisy gives more, more irregular branches.

---

## 2. Attractor distribution

### 2.1 Count and regularity (random vs blue-noise vs grid)

- **Sourced effect:**
  - Fewer attractors make crowns sparser and branches **irregular**, because adding or removing one point "can significantly change the direction of the branch growth" ([Runions 2007, §3, Fig. 3](http://algorithmicbotany.org/papers/colonization.egwnp2007.pdf)).
  - Denser, more regular sources give "smoother primary and secondary veins, and more uniform tertiary veins" ([Runions 2005, §6, Fig. 9f–h](http://algorithmicbotany.org/papers/venation.sig2005.pdf)). That figure varies the dart rate ρ over 0.00006, 0.0003 and 0.006 darts per unit area per step.
- **Original placement method:** dart throwing with two birth distances. A new source must be at least `b_s` from other sources and at least `b_v` from vein nodes ([Runions 2005, §3.3](http://algorithmicbotany.org/papers/venation.sig2005.pdf)).
- **Grid placement:** Jason Webb's implementation can place attractors on a jittered grid (`getGridOfAttractors(numRows, numColumns, ctx, jitterRange)`; [`core/AttractorPatterns.js` L62–70 @5e35b09](https://github.com/jasonwebb/2d-space-colonization-experiments/blob/5e35b0998901fff13f30d208aaf71a077ef7658b/core/AttractorPatterns.js#L62-L70)). The 2005 paper warns that grid-constrained sources give "a visible regularity in the layout of vein endings", which it criticises in Gottlieb's earlier model ([Runions 2005, §2.5](http://algorithmicbotany.org/papers/venation.sig2005.pdf)).
- **Current state:** `perPatch` points sit uniformly in a 1.6 × cell box around each patch site. That is stratified per patch but can clump inside a cell.
- **Proposed param:** `riv.spacing`, a minimum attractor spacing (the birth distance `b_s`) in km. 0 keeps the current placement. For each candidate, reject it if an accepted point is closer than `b_s`, and retry up to the existing 24 tries. Use the existing `grid` for the neighbour check.
- **Look:** a larger `b_s` gives smoother trunks and evenly spaced tributaries. A smaller `b_s` and lower `perPatch` give a scrappier, more irregular network.
- **Cost:** O(A) with a grid. **Determinism:** yes (sfc32 plus squared distances).

### 2.2 Density gradients (where the branches go)

- **Sourced effect:** putting attractors only near the crown envelope gives "an open, sparse branch system, with small twigs limited to the crown surface" ([Runions 2007, §3, Fig. 7](http://algorithmicbotany.org/papers/colonization.egwnp2007.pdf)).
- **River analogue (Design note):** scale `perPatch` per patch by a field. That field could be distance from the coast in patch hops, elevation, moisture or noise.
  - Dense inland and sparse near the coast gives long, bare lower trunks with branchy headwaters, the typical "few junctions downstream" look.
  - Dense near the coast gives many short coastal streams.
- **Proposed params:** `riv.densityBias` (−1…1) and `riv.densityBy` (`coastDist | moisture | noise`). Hook: the `for k < perPatch` loop in `attractors()`, line 213.
- **Cost:** negligible. **Determinism:** yes, if the field is integer hop counts or a trig-free noise.

### 2.3 Incremental placement (attractors released over time)

- **Sourced effects:**
  - In marginal growth, sources are precomputed and "include[d]... as they appear within the expanding leaf contour". With slow growth, "all vein tips closely followed the leaf margin" ([Runions 2005, §3.3; §6, Fig. 9i](http://algorithmicbotany.org/papers/venation.sig2005.pdf)).
  - Adding points *while the tree forms*, "with a gradually decreasing distance between the points", produced "a hierarchy of branch sizes" with small twigs filling the gaps between large limbs ([Runions 2007, §3, Fig. 8](http://algorithmicbotany.org/papers/colonization.egwnp2007.pdf)).
- **River analogue (Design note), two variants:**
  - **(a) Headward waves:** activate attractors in rings by patch hop distance from the coast, adding one ring every `riv.waveIters` iterations. The front then advances inland like headward erosion, and trunks run long and roughly perpendicular to the coast.
  - **(b) Coarse-to-fine:** release a sparse set first (large `b_s`), let it grow, then release the rest. Trunks form from the sparse set and tributaries fill in later, giving a clear size hierarchy.
- **Proposed params:** `riv.waves` (`off | headward | coarseFine`) and `riv.waveIters`.
- **Hook:** an `active` flag per attractor. The pull loop (line 518) and the `addNode` kill check skip inactive attractors. The main loop's exit test must also count pending attractors.
- **Cost:** low (adds iterations). **Determinism:** yes.

### 2.4 Domain-warped or clustered attractors

- **Source:** Webb's code has an `applyNoise` pattern that offsets each attractor by simplex noise × 10 ([`core/AttractorPatterns.js` L172–180 @5e35b09](https://github.com/jasonwebb/2d-space-colonization-experiments/blob/5e35b0998901fff13f30d208aaf71a077ef7658b/core/AttractorPatterns.js#L172-L180)). That function contains a typo (`souattractorrce`) and would throw if called, so it is evidently unused. The idea is sourced; the visual effect is not documented.
- **Design note:** warp the candidate point by a 2-D noise vector before the land test, or thin points with a noise threshold so they cluster. Clusters become tributary "fans", and gaps become long bare reaches.
- **Proposed param:** `riv.warp` (amplitude in km).
- **Determinism:** only with a trig-free noise, such as value or gradient noise with a hashed lattice and polynomial fade. Simplex with a gradient table also qualifies. Many simplex ports compute gradients with trig; avoid those.

---

## 3. Influence radius, kill distance and perception cone

### 3.1 Documented ratios

| Source | D | dᵢ | dₖ | Documented effect |
|---|---|---|---|---|
| [Runions 2007, Fig. 3](http://algorithmicbotany.org/papers/colonization.egwnp2007.pdf) | 1 | — | 2D vs 20D | A larger dₖ gives larger pull sets: "individual points matter less, and smoothly curved branches result". Combined with a lower N, crowns get sparser. |
| [Runions 2007, Figs. 4–5](http://algorithmicbotany.org/papers/colonization.egwnp2007.pdf) | 1 | ∞ vs 17D (shrub), ∞ vs 8D (tree) | — | "As its value decreases, branch tips tend to meander between attraction points... a wiggly or gnarly appearance." |
| [Runions 2005, Fig. 9a–e](http://algorithmicbotany.org/papers/venation.sig2005.pdf) | — | — | 40, 20, 10, 5, 1 | As dₖ decreases, "the density of the venation pattern increases, higher-order veins emerge, and eventually anastomose" (closed variant). |
| [Palubicki 2009, §4.1](http://algorithmicbotany.org/papers/selforg.sig2009.pdf) | 1 internode | r = 4–6 | ρ = 2 (occupancy) | "Typical values" |
| [Coding Train, `tree.js`/`sketch.js` @576bc7c](https://github.com/CodingTrain/Coding-Challenges/blob/576bc7c1b60e2fadf4a18e81b06e359cda57751a/017_SpaceColonizer/P5/sketch.js) | 5 | 100 (20D) | 10 (2D) | — |
| [Webb, `core/Defaults.js` L9–11 @5e35b09](https://github.com/jasonwebb/2d-space-colonization-experiments/blob/5e35b0998901fff13f30d208aaf71a077ef7658b/core/Defaults.js#L9-L11) | 5 | 30 (6D) | 5 (1D) | — |
| sandbox3 defaults | 2 km | 16 km (8D) | 3 km (1.5D) | — |

- **Design note:** the existing two sliders already cover these ratios. The cheap win is a **"ratios" mode** that expresses dᵢ and dₖ as multiples of D, so changing D does not change the character of the network. Proposed params: `riv.diRatio` and `riv.dkRatio`.

### 3.2 Perception cone (angle limit)

- **Correction to the brief:** the cone is **not** in the 2007 tree paper. The 2007 algorithm uses a sphere of radius dᵢ ([Runions 2007, §2, Eq. 2](http://algorithmicbotany.org/papers/colonization.egwnp2007.pdf)).
- **Where it comes from:**
  - The cone was introduced in Palubicki et al. 2009. Each bud has "a conical perception volume characterized by the perception angle θ and distance r", plus a spherical occupancy zone of radius ρ. Typical values: θ ≈ 90°, ρ = 2 and r = 4–6 internode lengths.
  - A marker inside several buds' cones goes to the closest of them ([Palubicki 2009, §4.1, Fig. 4](http://algorithmicbotany.org/papers/selforg.sig2009.pdf)).
- **Mechanism here (Design note):**
  - Each non-root node has a heading `h = unit(node − parent)`.
  - Attractor `a` may pull node `k` only if `dot(a − k, h) ≥ cosHalf · |a − k|`, comparing squared values to avoid the `√`.
  - Every node in this model is a "bud", so a lateral can only leave a trunk within θ/2 of the trunk's heading. **The cone half-angle therefore caps the junction angle** (see 7.1).
  - It also stops tips from hooking back toward attractors behind them.
- **Look:** straighter, forward-forking rivers with no U-turns. Narrow cones give acute, "arid" junctions; wide cones approach the current behaviour.
- **Proposed param:** `riv.cone` (select: off, 150°, 144°, 120°, 90°). The half-angle cosines (cos 75°, cos 72° = (√5−1)/4, ½, √½) are literals or `√`-built.
- **Hooks:**
  - The `near[a]` update in `addNode` (line 386) and `refind` (line 438) must skip nodes whose cone excludes the attractor, so the nearest node is the nearest node *that can see it*.
  - Heading is `nx[k] − nx[par[k]]`.
  - Roots have no heading, so give them a full sphere.
- **Cost:** one dot product per candidate. But nodes outside the cone no longer count as "nearest", so `refind` runs more often. **Determinism:** yes.

---

## 4. Direction shaping

### 4.1 Inertia (blend with the parent heading)

- **Sources:**
  - Palubicki: a metamer's orientation is "a weighted sum of three vectors: the default orientation, the optimal growth direction (weight ξ), and a tropism vector (weight η)" ([Palubicki 2009, §4.3](http://algorithmicbotany.org/papers/selforg.sig2009.pdf)).
  - The Coding Train implementation does this implicitly. Each branch starts with its parent's direction (`origDir`). Attractor unit vectors are *added* to it, and the sum is divided by `count + 1`. The parent heading therefore weighs as much as one attractor ([`branch.js` L9–23](https://github.com/CodingTrain/Coding-Challenges/blob/576bc7c1b60e2fadf4a18e81b06e359cda57751a/017_SpaceColonizer/P5/branch.js#L9-L23), [`tree.js` L51–70 @576bc7c](https://github.com/CodingTrain/Coding-Challenges/blob/576bc7c1b60e2fadf4a18e81b06e359cda57751a/017_SpaceColonizer/P5/tree.js#L51-L70)).
- **Mechanism:** `dir = unit(unit(Σ pulls) + w · h)`, where `h` is the node's heading.
  - Use a fixed `w`. Alternatively, use `w · (pull count)` to match Shiffman, so inertia does not fade at busy nodes.
- **Look:** longer straight reaches and wider-radius bends, plus smaller turns right after a junction. High `w` overshoots attractors, which the existing stall fallback (line 614) already catches.
- **Proposed param:** `riv.inertia` (0–3).
- **Hook:** between lines 600 and 602, before jitter.
- **Cost:** trivial. **Determinism:** yes.

### 4.2 Tropism (a global or field bias)

- **Source:** `ñ = (n̂ + g)/‖n̂ + g‖`, an optional bias "representing a combined effect of branch weight and tropisms" ([Runions 2007, §2, Eq. 3](http://algorithmicbotany.org/papers/colonization.egwnp2007.pdf)).
- **Documented behaviour:**
  - An upward bias "may cause the branches to grow above their attraction points, before eventually turning down". The authors could not produce strongly weeping forms this way ([Runions 2007, §3–4, Fig. 9](http://algorithmicbotany.org/papers/colonization.egwnp2007.pdf)).
  - Palubicki shows that flipping tropism from up to down makes branches "spread more widely" ([Palubicki 2009, §4.3, Fig. 12](http://algorithmicbotany.org/papers/selforg.sig2009.pdf)).
- **River analogue (Design note):** **g** stands in for regional slope. Rivers grow upstream from the mouth, so **g** points inland. Options:
  - **(a)** one vector per region, from the mean root to the attractor centroid;
  - **(b)** per node, the direction of increasing coast distance;
  - **(c)** a fixed world direction, for a tilted continent.
- **Look:** strong **g** makes trunks run parallel and tributaries join at acute angles. This is the main knob for **parallel drainage** (7.3).
- **Proposed params:** `riv.tropism` (strength) and `riv.tropismBy` (`region | coast | fixed`).
- **Hook:** the same place as inertia.
- **Determinism:** yes.

### 4.3 Turn limit (maximum change of direction per step)

- **Design note:** clamp the new direction to within β of the heading, using the rotation trick from the top of this report.
- **Difference from the cone:** the cone filters *which attractors count*. The turn limit caps *curvature*, at no more than β per step D.
- **Look:** no hairpins or zig-zags, even with high jitter. Rivers read as larger and smoother.
- **Proposed param:** `riv.maxTurn` (45°/30°/15°, stored as cosine literals).
- **Hook:** after jitter (line 610). Skip it on the first step of a new lateral, or laterals cannot leave the trunk. "First step" means `kids[k] ≥ 1`.
- **Determinism:** yes.

### 4.4 Correlated jitter ("wander") instead of white noise

- **Source:** Langbein & Leopold model the meander path as a random walk whose most likely form "minimizes the sum of the squares of the changes in direction". The direction is then a sine function of distance: the sine-generated curve ([Langbein & Leopold 1966, USGS PP 422-H, p. H1 and Eq. 10](https://pubs.usgs.gov/pp/0422h/report.pdf)).
- **Current state:** the current jitter draws an independent unit vector at every step. That gives high-frequency wiggle, not bends.
- **Design note:**
  - Store a wander vector `wv[k]`. A child inherits `wv = unit(wv[parent] + σ·discVec)`, and the step uses `dir + jitter·wv`.
  - Low σ gives long, smooth, coherent bends. σ → ∞ gives the current white jitter.
- **Proposed param:** `riv.wanderCorr` (0 = current behaviour, 1 = fully persistent).
- **Hook:** line 603. Add one `Float64Array` pair grown in `addNode`.
- **Determinism:** yes.
- **Noise-modulated jitter:** multiply `jitter` by a field sampled at the node, such as biome roughness or noise. This gives calm floodplain reaches and wiggly upland reaches. Trig-free noise is required.

---

## 5. Step length, vigour and branching limits

### 5.1 Coherence-scaled step

- **Source:** Shiffman divides the summed direction by `count + 1` and does **not** renormalize, so the step is `len · |mean|` ([`tree.js` L68](https://github.com/CodingTrain/Coding-Challenges/blob/576bc7c1b60e2fadf4a18e81b06e359cda57751a/017_SpaceColonizer/P5/tree.js#L68), [`branch.js` L20](https://github.com/CodingTrain/Coding-Challenges/blob/576bc7c1b60e2fadf4a18e81b06e359cda57751a/017_SpaceColonizer/P5/branch.js#L20)). Conflicting pulls therefore produce short steps. This is an implementation side effect, not a documented feature.
- **Design note:** `D_k = D · max(m, |Σ unit pulls| / count)`.
- **Look:** nodes bunch up at contested points, which are where junctions form. Coherent reaches take full steps.
- **Proposed param:** `riv.stepByCoherence` (bool, with floor `m`).
- **Determinism:** yes.

### 5.2 Vigour: more growth for well-fed tips (Borchert–Honda)

- **Source:** the extended Borchert–Honda model passes light (exposure) Q down to the tree base. It then distributes a resource `v` back up, split at each branch point by `v_m = v·λQ_m/(λQ_m + (1−λ)Q_l)`. A bud receiving `v` grows `n = ⌊v⌋` metamers of length `l = v/n` ([Palubicki 2009, §4.2, Fig. 7–8](http://algorithmicbotany.org/papers/selforg.sig2009.pdf)).
  - λ > 0.5 favours the main axis, giving an excurrent form with a dominant trunk.
  - λ < 0.5 favours laterals, giving a decurrent, bushy form.
  - Fig. 7 sweeps λ = 0.46…0.54.
- **River analogue (Design note):**
  - The number of attractors pulling a node this iteration (`touched` count) is a live proxy for its future flow.
  - Let a node with `c` pulls take `⌊√(c/c₀)⌋` steps per iteration, capped at 3.
  - Alternatively, when a node already has a child, only allow a new lateral if its pull count is at least `λ'` × the continuing child's count. This acts as apical control.
- **Look:** dominant main stems that race ahead and claim territory, with short, stubby tributaries. The opposite setting gives many equal-rank channels.
- **Proposed params:** `riv.vigor` (0 = off) and `riv.apical` (0–1).
- **Hook:** the `for (const k of touched)` loop (line 587) and the `kids[k]` check (line 644).
- **Cost:** low. **Determinism:** yes (√ and floor).

### 5.3 Children per node and lateral spacing

- **Current state:** `MAX_CHILDREN = 8` is only a safety net (line 118).
- **Design note:**
  - **`riv.maxKids`** (2 or 3): a hard cap on children per node, which yields strictly bifurcating junctions.
  - **`riv.lateralGap`** (in nodes): refuse a new lateral if an ancestor within `g` nodes up the same trunk already sprouted one. This gives evenly spaced tributaries; set `g` high for a "long bare reach" look.
  - **`riv.sides`** (`any | alternate | one`): use the sign of `cross(h, newDir)` to force laterals to alternate sides, which gives a pinnate or herringbone look, or to stay on one side.
- **Mechanism:** a refused lateral leaves its attractors to pull some other node next iteration. If the region has no other node in range, the attractors are bridged later.
- **Determinism:** yes (integers and cross-product sign).

---

## 6. Closed venation (loops)

- **Source:** a vein node v influences source s if v is a *relative neighbour* of s: `‖v − s‖ < max(‖u − s‖, ‖v − u‖)` for every other node u ([Runions 2005, §4, Eq. 2–3, Fig. 7](http://algorithmicbotany.org/papers/venation.sig2005.pdf)).
  - A source stays alive until all tagged veins reach it or leave its zone.
  - Width: "all child veins entering a vein node contribute equally".
  - The exact relative neighbourhood is O(kn²) naively and O(kn) via Delaunay; Urquhart's approximation is much faster. Fig. 18: two hours vs two minutes.
- **Implementation reference:** Webb tests relative neighbourhood only among nodes within the attraction distance, and removes an attractor once *all* its influencing nodes are within kill distance ([`core/Network.js` L42–63, L131–146, L211–250 @5e35b09](https://github.com/jasonwebb/2d-space-colonization-experiments/blob/5e35b0998901fff13f30d208aaf71a077ef7658b/core/Network.js#L211-L250)).
- **River relevance (Design note):** loops look like braided or anastomosing channels and deltas, not normal drainage. The flow computation (line 655) assumes a tree, so loops would need flow split across multiple parents.
- **Recommendation:** low priority. If wanted, enable it only for `wet` nodes (the sea-side stretch) to get delta distributaries. Proposed param: `riv.deltaLoops`.
- **Determinism:** yes. **Cost:** high.

---

## 7. River-specific realism targets

### 7.1 Junction angles

- **Measured angles:**
  - Across nearly one million US junctions, mean branching angles are about **45°** in the driest climates and about **72°** in humid ones. Aridity correlates better than slope or concavity ([Seybold, Rothman & Kirchner 2017, GRL, abstract](https://dspace.mit.edu/handle/1721.1/119825)). **[partially verified: abstract only]**
  - A groundwater-fed network in Florida (~5,000 bifurcations) branches at 71.9° ± 0.8°, matching a predicted 2π/5 for growth in a diffusive field ([Devauchelle et al. 2012, PNAS, abstract](https://dspace.mit.edu/handle/1721.1/80312)). **[partially verified: abstract only]** Physics Today reports a large spread of about 28° ([secondary](https://physicstoday.aip.org/news/hidden-order-emerges-in-stream-networks)).
- **Theory:** Howard's 1971 junction-angle theory relates the angle to the main and tributary slopes ("Optimal angles of stream junction", WRR 7(4)). **[unverified: bibliographic only]**
- **Knobs that set it (Design note):**
  - the cone half-angle (3.2) as a hard cap;
  - `riv.maxTurn` relaxed on the first lateral step (4.3);
  - inertia (4.1), which reduces it;
  - node relaxation toward the parent (8.4), which reduces it ([Runions 2007, Fig. 1e, Fig. 11](http://algorithmicbotany.org/papers/colonization.egwnp2007.pdf)).
- **Climate mapping:** the world already has biomes, so the cap could vary with patch moisture: dry → 45° (cos = √½), wet → 72° (cos = (√5−1)/4). Proposed param: `riv.junctionBy` (`fixed | moisture`).

### 7.2 Hack's law and Horton–Strahler ratios (diagnostics)

- **Hack's law:**
  - Stream length grows as about the 0.6 power of drainage area: `L = 1.4·A^0.6` (miles, square miles), with the coefficient ranging 1 to 2.5 ([Hack 1957, USGS PP 294-B, p. 63, Eq. 3, Fig. 25](https://pubs.usgs.gov/pp/0294b/report.pdf)).
  - Hack notes that the 0.6 rather than 0.5 power means larger basins are "more elongate".
- **Use here (Design note):** `flow` is an area proxy, because attractors are spread evenly over land. Main-stem length upstream of a node is available from a reverse sweep. Fit `log L` against `log flow` per region and show the exponent in the stats panel, as a tuning gauge. Inertia, tropism and headward waves should push it up; high branching pulls it down.
- **Horton–Strahler:**
  - Horton defined the bifurcation ratio (number of streams of one order over the next) and the length ratio; Hack restates them ([Hack 1957, p. 64](https://pubs.usgs.gov/pp/0294b/report.pdf)).
  - Strahler ordering: an order-1 stream has no tributaries; two streams of order k meet to make k+1 (Strahler 1957, Trans. AGU 38(6)). **[unverified: bibliographic]**
  - Natural bifurcation ratios of about 3–5 **[unverified]**.
  - Showing `R_b` in the stats panel is a cheap realism check.

### 7.3 Drainage patterns and the knobs that approximate them

The classic types (dendritic, parallel, trellis, rectangular, radial, annular) come from Zernitz (1932) as summarised by Howard (1967, AAPG Bull. 51(11)). Most are controlled by regional structure ([Howard 1967](https://archives.datapages.com/data/ocgs/data/002/002001/0031.htm)). **[partially verified: third-party copy of the paper only; the per-type descriptions below are standard textbook characterisations, unverified]**

| Pattern | Look | Knob recipe (Design note) |
|---|---|---|
| Dendritic | Tree-like, tributaries at acute angles, no preferred direction | The current defaults: even attractors, no tropism, moderate dᵢ/D. Blue-noise spacing (2.1) cleans it up. |
| Parallel | Long, near-parallel trunks down a uniform slope | Strong `riv.tropism` (inland), cone ≤ 90°, high `riv.inertia`, `riv.waves=headward`. Leaf analogue: a grass leaf with "a row of initial vein nodes... at the leaf base" and a tuned birth distance gave parallel veins ([Runions 2005, §6, Fig. 14](http://algorithmicbotany.org/papers/venation.sig2005.pdf)). Here the analogue is several roots per coast segment. |
| Trellis | Long parallel main streams; short tributaries joining at about 90° | Two phases. First, trunks with tropism along a "strike" vector **s** and sparse attractors. Then tributaries with tropism along ⟂**s**, junction forced near 90°, and a short `riv.lateralGap`. An alternative is an anisotropic distance (scale one axis) in the nearest-node search. |
| Rectangular | Right-angle bends and junctions (joint-controlled) | Snap each step direction to the nearest of 4 (or 8) axes of a per-region rotated frame. This needs only comparisons and literals. Add low jitter and a 90° junction. |
| Radial | Streams flowing outward from a central high point | Roots all around an island, with tropism pointing *toward* the island's interior point, since growth is upstream. Already emergent on small round islands. |
| Annular / centripetal | Rings / inward drainage | Out of scope. Centripetal drainage needs inland sinks (lakes) as roots. |

### 7.4 Meanders (post-process)

- **Source:**
  - Regular meanders follow the sine-generated curve `φ = ω·sin(2πs/M)`, where φ is the direction at path distance s and M is the path length of one meander. ω ranges up to about 125° for "gooseneck" meanders.
  - Meander length / bend radius ≈ 4.7, in both theory and field data ([Langbein & Leopold 1966, p. H1, Eq. 10, p. H4 table](https://pubs.usgs.gov/pp/0422h/report.pdf)).
- **Design note:**
  - Apply this only to segments with flow ≥ `riv.meanderMinFlow`.
  - Scale M with drawn width, since meanders are scale-similar, so big rivers get big bends.
  - Displace the resampled centreline along its normal by `A·f(s/M)`, where `f` is a trig-free periodic shape. The parabolic arc `4x(1−x)` with alternating sign is close to a sine.
  - A true sine-generated curve integrates the heading and needs drift correction plus the rational rotation trick.
  - Keep displaced points inside the region (`inside()`), or clamp A.
- **Proposed params:** `riv.meander` (amplitude ω or A), `riv.meanderLen` (M in widths) and `riv.meanderMinFlow`.
- **Cost:** render-time or a one-off pass. **Determinism:** yes with the polynomial shape; `Math.sin` would break it.

---

## 8. Post-processing the finished tree

### 8.1 Width rule (exponent)

- **Sources:**
  - Runions 2005 uses Murray's law `r^n = r₁^n + r₂^n`, with n = 3 in Murray's original. Following MacDonald, Runions treats n as a parameter ([Runions 2005, §3.5](http://algorithmicbotany.org/papers/venation.sig2005.pdf)).
  - Runions 2007 uses the pipe model with n "usually between 2 and 3" ([Runions 2007, §2, Eq. 1](http://algorithmicbotany.org/papers/colonization.egwnp2007.pdf)).
  - Leonardo's rule is n = 2; measured values are roughly 1.8–2.3 ([Eloy 2011, PRL 107:258101, arXiv:1105.2591](https://arxiv.org/abs/1105.2591)). **[partially verified: preprint and abstract]**
- **For rivers:**
  - Downstream hydraulic geometry gives `w = aQ^b` (Eq. 1), with b "close to 0.5 downstream" ([Leopold & Maddock 1953, USGS PP 252, p. 8 Eq. 1; p. 46](https://pubs.usgs.gov/pp/0252/report.pdf)).
  - With additive flow, `w ∝ Q^b` is the same as the pipe rule with n = 1/b. **So b = ½ ⇔ Leonardo n = 2 ⇔ the current `√flow` in `riverPx`.** The current width is already the physically motivated choice.
- **Knob:** `riv.widthExp` b ∈ {¼, ⅓, ½, ¾}.
  - Lower b (Murray-like ⅓) flattens the contrast, so small streams look relatively bolder.
  - Higher b makes trunks dominate.
  - ¼ = √√ and ¾ = √·√√ are bit-exact. ⅓ needs `Math.cbrt` or a fixed-iteration Newton. Width is render-only, though, so bit-exactness matters less here.
- **Alternative width source:** Webb's "canalization" thickens each parent to `child + 0.03` while it is less than `child + 0.07`, walking up from every tip ([`core/Network.js` L104–116 @5e35b09](https://github.com/jasonwebb/2d-space-colonization-experiments/blob/5e35b0998901fff13f30d208aaf71a077ef7658b/core/Network.js#L104-L116)). That is width by **distance from the tip**, not flow: long unbranched rivers get thick. Proposed param: `riv.widthBy` (`flow | length | order`).

### 8.2 Strahler order: stepped widths and pruning

- **Design note:** compute order in the same reverse sweep as flow: order = max child order, +1 if two or more children tie at the max.
- **Uses:**
  - **(a)** Stepped, cartographic widths per order.
  - **(b)** Drop order-1 streams below a length.
  - **(c)** `R_b` diagnostics (7.2).
- **Proposed param:** `riv.minOrder` (render filter, alongside the existing `minFlow`).
- **Cost:** O(n). **Determinism:** yes.

### 8.3 Pruning short spurs

- **Design note:** stalls, bridges and border bans leave 1–3-node stubs.
- **Mechanism:** remove tip paths shorter than `riv.minSpur` (km) whose own attractor count is small. Re-run the flow sweep afterwards, or keep their flow and attribute it to the junction node.
- **Look:** cleaner trunks, fewer "hairs".
- **Cost:** O(n). **Determinism:** yes.

### 8.4 Decimation, node relaxation and smoothing

- **Source:**
  - Runions 2007 decimates the skeleton, then moves "each remaining node in parallel half way toward its more basal neighbor". This "reduces the branching angles" and "can have a significant impact on the overall appearance".
  - Branching-structure curve subdivision then smooths the result ([Runions 2007, §2, Fig. 1d–f; §3, Fig. 11](http://algorithmicbotany.org/papers/colonization.egwnp2007.pdf)).
  - The effect is only visible on a decimated skeleton "with perceivably spaced nodes" (§3).
- **Design note:**
  - Decimate unbranched runs to every k-th node, keeping junctions, roots, tips and coast crossings.
  - Do one parallel (double-buffered) relaxation pass, then Chaikin corner-cutting (¼–¾) on each unbranched run, with junctions and endpoints pinned.
  - Chaikin: "An algorithm for high speed curve generation", CGIP 3(4), 1974. **[unverified: bibliographic]**
  - Catmull–Rom interpolates through the nodes instead of cutting corners, which keeps exact node positions. It is cubic in t but trig-free.
  - Relaxation can move a node off its region's land, so recheck it with `inside()` and skip the move if it fails.
- **Proposed params:** `riv.decimate` (k), `riv.relax` (0/1/2 passes) and `riv.smooth` (Chaikin passes, render-time).
- **Cost:** O(n·passes). **Determinism:** yes, provided the update is parallel (Jacobi), not in-place.

### 8.5 Optimal-channel-network (OCN) rewiring

- **Source:** OCNs minimise the functional `Σ A^γ` over drainage areas, with γ = 0.5 by default ("energy ∝ Q·ΔH, Q ∝ A, ΔH ∝ A^−0.5"). They are searched by single-link changes accepted by simulated annealing ([OCNet `R/create_OCN.R` L8, L258, L336 @30a67d8](https://github.com/lucarraro/OCNet/blob/30a67d8e687718ff43804558939ee0b6225c2925/R/create_OCN.R#L8); [`man/create_OCN.Rd` L52](https://github.com/lucarraro/OCNet/blob/30a67d8e687718ff43804558939ee0b6225c2925/man/create_OCN.Rd#L52)).
- **Background:** the theory (Rinaldo, Rodríguez-Iturbe et al., WRR 1992; *Fractal River Basins*, 1997) **[unverified: bibliographic; only the OCNet implementation was read]**.
- **Design note:**
  - Post-process the SCA tree with greedy moves. For a node k, try re-parenting it to another node within ~1.5 D that is not downstream of k. Accept if `Σ L_i·√flow_i` drops, updating flow along both affected paths.
  - The result is a more "geomorphic" tree, with fewer redundant parallel channels, whose statistics drift toward natural networks.
- **Determinism:** OCNet's annealing uses `exp()` and `runif` (`create_OCN.R` L258, L336). Use **zero-temperature greedy** acceptance in a fixed visiting order instead; that is `+ − × ÷ √` only.
- **Proposed param:** `riv.ocnPasses`.
- **Cost:** medium to high (each move is O(depth)); cap the number of passes.

---

## 9. Summary table

| # | Technique | Visual change | New param(s) | Hook in `rivers.ts` | Cost | Bit-exact | Source |
|---|---|---|---|---|---|---|---|
| 2.1 | Blue-noise attractors | Smoother trunks, even tributaries | `riv.spacing` | `attractors()` L213 | Low | Yes | Runions 2005 §3.3, Fig. 9f–h |
| 2.2 | Density gradient | Bare lower trunks / branchy headwaters (or the reverse) | `riv.densityBias`, `riv.densityBy` | `attractors()` L213 | Low | Yes | Runions 2007 Fig. 7 |
| 2.3 | Incremental release | Long trunks, size hierarchy | `riv.waves`, `riv.waveIters` | Pull loop L518, `addNode` | Low | Yes | Runions 2005 §3.3; 2007 Fig. 8 |
| 2.4 | Warped attractors | Tributary fans and gaps | `riv.warp` | `attractors()` | Low | Trig-free noise only | Webb `AttractorPatterns.js` (effect undocumented) |
| 3.1 | dᵢ/dₖ as D-ratios | Scale-stable character | `riv.diRatio`, `riv.dkRatio` | Constructor L142 | None | Yes | Runions 2007 Figs. 3–5 |
| 3.2 | Perception cone | Forward forks, no hooks, junction-angle cap | `riv.cone` | `addNode` L386, `refind` L438 | Medium | Yes (literal cos) | Palubicki 2009 §4.1 |
| 4.1 | Inertia | Straighter reaches, smoother bends | `riv.inertia` | L600 | Trivial | Yes | Palubicki §4.3; Coding Train |
| 4.2 | Tropism | Parallel drainage | `riv.tropism`, `riv.tropismBy` | L600 | Trivial | Yes | Runions 2007 Eq. 3 |
| 4.3 | Turn limit | No hairpins | `riv.maxTurn` | L610 | Trivial | Yes | Design note |
| 4.4 | Correlated wander | Bends instead of wiggle | `riv.wanderCorr` | L603 | Low | Yes | Langbein & Leopold 1966 (motivation) |
| 5.1 | Coherence step | Nodes bunch at junctions | `riv.stepByCoherence` | L611 | Trivial | Yes | Coding Train (side effect) |
| 5.2 | Vigour / apical control | Dominant main stems vs bushy | `riv.vigor`, `riv.apical` | L587, L644 | Low | Yes | Palubicki §4.2 |
| 5.3 | Kid cap, lateral gap, sides | Bifurcations, spacing, herringbone | `riv.maxKids`, `riv.lateralGap`, `riv.sides` | L644 | Low | Yes | Design note |
| 6 | Closed venation | Braids, deltas | `riv.deltaLoops` | Pull and kill logic, flow | High | Yes | Runions 2005 §4; Webb `Network.js` |
| 7.1 | Junction angle by climate | 45° arid / 72° humid | `riv.junctionBy` | Via cone / turn limit | Low | Yes | Seybold 2017; Devauchelle 2012 |
| 7.3 | Pattern presets | Dendritic, parallel, trellis, rectangular, radial | Preset select | Combines the above | Varies | Yes | Howard 1967 (partial) |
| 7.4 | Meanders | Bends on big rivers | `riv.meander`, `riv.meanderLen`, `riv.meanderMinFlow` | Post or render | Low | Polynomial only | Langbein & Leopold 1966 |
| 8.1 | Width exponent / width source | Trunk dominance; length-based look | `riv.widthExp`, `riv.widthBy` | `riverPx` | None | Mostly (√ chains) | Runions 2005 §3.5; Leopold & Maddock 1953 |
| 8.2 | Strahler order | Stepped widths, pruning | `riv.minOrder` | After L655 | Low | Yes | Strahler 1957 (unverified) |
| 8.3 | Spur pruning | Fewer hairs | `riv.minSpur` | After L655 | Low | Yes | Design note |
| 8.4 | Decimate, relax, smooth | Smaller junction angles, smooth curves | `riv.decimate`, `riv.relax`, `riv.smooth` | Post / render | Low | Yes (Jacobi) | Runions 2007 Fig. 1d–f, Fig. 11 |
| 8.5 | OCN rewiring | Geomorphic statistics | `riv.ocnPasses` | Post | Med–High | Greedy only | OCNet `create_OCN.R` |

---

## 10. Highest look-change per implementation effort

Recommendation, in order:

1. **`riv.inertia`**: blend the parent heading into the step direction (4.1). One line, and it gives the biggest jump from "wiggly vein" to "river reach".
2. **`riv.cone`**: a perception cone with a literal-cosine half-angle (3.2). It kills hooks and caps junction angles (45°/72° presets after Seybold 2017).
3. **`riv.wanderCorr`**: correlated jitter (4.4). It turns white-noise wiggle into coherent bends at no cost.
4. **`riv.tropism`**: an inland bias vector (4.2). One knob from dendritic to parallel drainage.
5. **`riv.relax` + `riv.smooth`**: Runions-style half-way relaxation plus Chaikin (8.4). Smaller junction angles and smooth curves as a pure post-pass.
6. **`riv.spacing`**: blue-noise attractor spacing (2.1). Smoother trunks and evenly spaced tributaries.
7. **`riv.apical`**: suppress weak laterals at nodes that already have a child (5.2). Dominant main stems, fewer stubs.
8. **`riv.widthExp`**: a width exponent b (8.1). Cheap visual contrast control; the current √ (b = ½) is already the hydraulic-geometry value.
