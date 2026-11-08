/**
 * Space-colonization rivers (Runions et al. 2005, open venation), computed per region.
 *
 * For one region (as drawn: an elevation zone merged into a neighbouring region's elevation zone belongs
 * to that region, see `regionElevationZones`):
 *   Attractors  every land, non-coastal subbiome drawn in the region gets `perSub`
 *               points, scattered inside the subbiome's cell.
 *   Roots       one per ocean elevation zone that touches the region's land (a Gabriel
 *               neighbour of a land elevation zone it owns, or an ocean elevation zone it owns with a land
 *               neighbour). The root sits at the ocean elevation zone's point (its site), so each
 *               river first grows across the water to the coast. A landlocked region looks
 *               further out (up to `maxHops` elevation zone steps) for the nearest ocean.
 *   Growth      each iteration, every attractor pulls on its nearest node within the
 *               influence radius dᵢ; each pulled node grows one step D towards the mean
 *               direction of its attractors (each weighted by a power of its distance,
 *               see `pull`), plus `jitter` × a random unit vector (the
 *               "random motion"). Attractors within the kill distance dₖ of a node are
 *               reached and removed. When no attractor is within dᵢ of any node, the
 *               closest node–attractor pair is bridged with a straight run of nodes, so
 *               growth continues until every reachable attractor is used.
 *   Border      rivers never enter another region's land (ocean is open to all): a step
 *               that would is redirected, an attractor that a node cannot reach in a
 *               straight line inside the region stops pulling on that node, and bridges
 *               only follow straight runs inside the region. Attractors in pockets of
 *               the region walled off from the sea by other regions stay unreached.
 *               Landlocked regions are exempt (they must cross a neighbour to drain).
 *   Look        optional knobs, all off by default (see docs/research/space-colonization-
 *               branch-variants.md): inertia (keep the current heading), a perception
 *               cone (only attractors ahead pull; caps junction angles), wander
 *               (random motion inherited from the parent → bends, not wiggle) and
 *               main-stem dominance (weak side branches are not grown; their nearby
 *               attractors drain straight into the stem).
 *   Width       each node counts the attractors it reached; summed upstream this is the
 *               flow of the river at that node (a river's mouth carries all attractors
 *               its tree reached). Line width is drawn from the flow.
 *
 * Deterministic: sfc32 per region, IEEE + − × ÷ √ only (random directions come from
 * rejection sampling in the unit disc, not trigonometry), and a fixed visiting order.
 */
import { hash4, sfc32, type Rng } from '@shared/core/hash';
import { keyI, keyJ, packKey } from './level';
import { Climate, type ClimateParams } from './climate';
import { elevationZoneType, ELEVATION_ZONE_TYPES } from './zones';
import type { World } from './world';

export type PullPower = 'normal' | 'squared' | 'sqrt';

/** Weight of one attractor's pull at squared distance d2, for an influence radius² di2 (√ only, no pow: bit-exact). */
export function pullWeight(power: PullPower, d2: number, di2: number): number {
  switch (power) {
    case 'squared':
      return d2 / di2;
    case 'sqrt':
      return Math.sqrt(Math.sqrt(d2 / di2));
    default:
      return 1;
  }
}

export type ConeAngle = 0 | 150 | 144 | 120 | 90 | 60;

/**
 * cos(cone / 2) for each cone angle, built from √ only (bit-exact everywhere):
 * cos 75° = (√6 − √2)/4, cos 72° = (√5 − 1)/4, cos 60° = ½, cos 45° = √½, cos 30° = √3/2.
 */
export function coneCos(cone: ConeAngle): number {
  switch (cone) {
    case 150:
      return (Math.sqrt(6) - Math.sqrt(2)) / 4;
    case 144:
      return (Math.sqrt(5) - 1) / 4;
    case 120:
      return 0.5;
    case 90:
      return Math.sqrt(0.5);
    case 60:
      return Math.sqrt(3) / 2;
    default:
      return -1;
  }
}

export interface RiverParams {
  /** attractors per eligible subbiome */
  perSub: number;
  /** growth step D, metres */
  step: number;
  /** influence radius dᵢ, metres */
  influence: number;
  /** kill distance dₖ, metres (raised to > D so growth cannot overshoot forever) */
  kill: number;
  /** random motion: weight of a random unit vector added to each growth direction */
  jitter: number;
  /**
   * Pull weighting: each attractor adds its unit vector × (d / dᵢ)^k to the growth
   * direction of its nearest node. 'normal' k = 0 (every pull equal, the paper),
   * 'squared' k = 2 (far attractors dominate), 'sqrt' k = ½ (mildly favours far ones).
   */
  pull: PullPower;
  /**
   * Inertia: weight of the node's own heading (parent → node) blended into the pull
   * direction before random motion (Palubicki et al. 2009 §4.3). 0 = off.
   */
  inertia: number;
  /**
   * Perception cone, full angle in degrees (0 = off, a full circle): an attractor only
   * pulls a node that has it within ±cone/2 of the node's heading (Palubicki et al.
   * 2009 §4.1). Roots have no heading and see all round. Caps junction angles.
   */
  cone: ConeAngle;
  /**
   * Correlated random motion: 0 = a fresh random direction every step (the classic
   * jitter); towards 1 each node passes its random direction on to its children,
   * only nudging it, so random motion makes long coherent bends instead of wiggle.
   */
  wander: number;
  /**
   * Main-stem dominance (apical control, after Palubicki et al. 2009 §4.2): a node that
   * already has a child only sprouts a side branch when it is pulled by at least
   * `apical` × as many attractors as that child. 0 = off.
   */
  apical: number;
  /** leave out subbiomes that touch the ocean */
  skipCoast: boolean;
  /**
   * Precipitation cutoff, mm per year: a flat elevation zone whose (merged root's) site
   * gets less initial precipitation than this is river-poor, and each of its subbiomes
   * gets 0 or 1 attractor (50/50) instead of `perSub`. 0 = off.
   */
  flatSparseCutoff: number;
  /** the climate maps the precipitation is read from (plain data: sent to the terrain worker) */
  climate: ClimateParams;
  /** how many elevation zone steps a landlocked region searches for an ocean */
  maxHops: number;
}

export interface RegionRivers {
  region: number;
  /** node positions, parent index (−1 = root), attractors reached at the node, flow (reached upstream incl. itself) */
  n: number;
  x: Float64Array;
  y: Float64Array;
  parent: Int32Array;
  own: Int32Array;
  flow: Int32Array;
  /** root node of each node's tree */
  tree: Int32Array;
  /** 1 when the node lies over ocean (the part of a river between its root and the coast) */
  wet: Uint8Array;
  /** root node indices and the ocean elevation zone each root drains into */
  roots: number[];
  rootOcean: number[];
  /** attractors and the node that reached each (−1 = never reached) */
  ax: Float64Array;
  ay: Float64Array;
  reachedBy: Int32Array;
  reached: number;
  iterations: number;
  /** straight bridges added over gaps wider than dᵢ */
  bridges: number;
  /** true when the roots had to come from beyond the region's own coast */
  landlocked: boolean;
  /** bounding box of nodes and attractors */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  ms: number;
}

const ST_ATTR = 0x7e01;
const ST_GROW = 0x7e02;
const ST_SPARSE_SUB = 0x7e04;
const FLAT_ZONE = ELEVATION_ZONE_TYPES.findIndex((t) => t.id === 'flat');
const MAX_ITER = 6000;
const MAX_NODES = 120000;
/** an attractor that cannot see this many of its closest nodes is given up on by the bridge */
const MAX_BANS = 12;
/** bridge passes in a row that find no pair inside the region before growth stops */
const MAX_BLOCKED_PASSES = 6;
/** a node that has grown this many children and still wants more is stopped */
const MAX_CHILDREN = 8;
/** main-stem dominance counts pulls this many nodes downstream of each puller */
const APICAL_DEPTH = 48;

/** Random vector in the unit disc (rejection sampling: no trig, so bit-exact everywhere). */
function discVec(rng: Rng, out: [number, number]): void {
  for (;;) {
    const x = rng() * 2 - 1;
    const y = rng() * 2 - 1;
    const d = x * x + y * y;
    if (d <= 1 && d > 1e-12) {
      const s = 1 / Math.sqrt(d);
      out[0] = x * s;
      out[1] = y * s;
      return;
    }
  }
}

export class Rivers {
  readonly world: World;
  /** initial climate, for the precipitation that thins flat zones */
  readonly climate: Climate;
  readonly p: RiverParams;
  private cache = new Map<number, RegionRivers>();

  constructor(world: World, p: RiverParams) {
    this.world = world;
    this.climate = new Climate(p.climate);
    this.p = { ...p, kill: Math.max(p.kill, p.step * 1.05), influence: Math.max(p.influence, p.step * 1.5) };
  }

  get size(): number {
    return this.cache.size;
  }

  has(rkey: number): boolean {
    return this.cache.has(rkey);
  }

  peek(rkey: number): RegionRivers | undefined {
    return this.cache.get(rkey);
  }

  get(rkey: number): RegionRivers {
    let r = this.cache.get(rkey);
    if (!r) {
      if (this.cache.size > 4000) this.cache.clear();
      r = this.compute(rkey);
      this.cache.set(rkey, r);
    }
    return r;
  }

  /** Is the subbiome next to a cell of the other kind (land vs ocean)? */
  isCoastSub(skey: number): boolean {
    const w = this.world;
    const oc = w.subCell(skey).ocean;
    for (const n of w.subNbrs(w.sub(skey))) if (w.subCell(n).ocean !== oc) return true;
    return false;
  }

  /**
   * Raw elevation zones drawn as part of a region. This is not `region.elevationZones` (the elevation zones whose
   * site lies in the region): a merged elevation zone is drawn in the region of the elevation zone it
   * joined, which may be a neighbouring region. Rivers follow what is drawn.
   */
  regionElevationZones(rkey: number): number[] {
    const w = this.world;
    const reg = w.region(rkey);
    const out: number[] = [];
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        for (const b of w.region(packKey(reg.i + di, reg.j + dj)).elevationZones) if (w.elevationZoneCell(b).region === rkey) out.push(b);
      }
    }
    return out.sort((a, b) => a - b);
  }

  /** Is a point land drawn in this region? */
  private isOwnLand(rkey: number, x: number, y: number): boolean {
    const c = this.world.cellAt(x, y, true);
    return !c.ocean && c.region === rkey;
  }

  /**
   * Is this (merged) land elevation zone a river-poor flat zone: is the initial
   * precipitation at its site below the cutoff? Depends on the zone alone, so a zone
   * split across regions is sparse (or not) in all of them.
   */
  isSparseFlat(zkey: number): boolean {
    if (this.p.flatSparseCutoff <= 0 || elevationZoneType(zkey, false) !== FLAT_ZONE) return false;
    const z = this.world.elevationZone(zkey);
    return this.climate.precipitationAt(z.x, z.y) < this.p.flatSparseCutoff;
  }

  /** Attractor points of a region (land, non-coastal subbiomes drawn in the region). */
  attractors(rkey: number): { ax: number[]; ay: number[] } {
    const w = this.world;
    const reg = w.region(rkey);
    const L = w.subLevel;
    const rng = sfc32(hash4(w.p.seed, ST_ATTR, reg.i, reg.j));
    const ax: number[] = [];
    const ay: number[] = [];
    for (const b of this.regionElevationZones(rkey)) {
      const bc = w.elevationZoneCell(b);
      if (bc.ocean) continue;
      const sparse = this.isSparseFlat(bc.elevationZone);
      for (const s of w.elevationZoneSubs(w.elevationZone(b))) {
        const sc = w.subCell(s);
        if (sc.ocean || sc.region !== rkey) continue;
        if (this.p.skipCoast && this.isCoastSub(s)) continue;
        const sd = w.sub(s);
        // a river-poor flat zone: 0 or 1 attractor per subbiome, from the subbiome's own hash
        const count = sparse ? hash4(w.p.seed, ST_SPARSE_SUB, keyI(s), keyJ(s)) & 1 : this.p.perSub;
        for (let k = 0; k < count; k++) {
          // a random point inside the (warped) subbiome cell, on the region's land;
          // fall back to the site, or drop the point when even that is outside
          let px = NaN;
          let py = NaN;
          for (let t = 0; t < 24; t++) {
            const qx = sd.x + (rng() - 0.5) * 1.6 * L.size;
            const qy = sd.y + (rng() - 0.5) * 1.6 * L.size;
            // nested, every point of subbiome s is classified as s (checked above);
            // otherwise the point itself must be the region's land
            if (L.query(qx, qy) === s && (w.p.nest || this.isOwnLand(rkey, qx, qy))) {
              px = qx;
              py = qy;
              break;
            }
          }
          if (Number.isNaN(px)) {
            if (!this.isOwnLand(rkey, sd.x, sd.y)) continue;
            px = sd.x;
            py = sd.y;
          }
          ax.push(px);
          ay.push(py);
        }
      }
    }
    return { ax, ay };
  }

  /** Ocean elevation zones that receive a root, and the land elevation zone each root faces. */
  rootPairs(rkey: number): { pairs: { ocean: number; land: number }[]; landlocked: boolean } {
    const w = this.world;
    const mine = this.regionElevationZones(rkey);
    const own = new Set(mine);
    const isOcean = (b: number) => w.elevationZoneCell(b).ocean;
    const land = mine.filter((b) => !isOcean(b));
    // nearest land neighbour of an ocean elevation zone, preferring the region's own elevation zones
    const facing = (o: number): number => {
      let best = -1;
      let bestOwn = false;
      for (const n of w.elevationZoneNbrs(w.elevationZone(o))) {
        if (isOcean(n)) continue;
        const mine = own.has(n);
        if (best < 0 || (mine && !bestOwn)) {
          best = n;
          bestOwn = mine;
        }
      }
      return best;
    };
    const oceans = new Set<number>();
    for (const b of land) for (const n of w.elevationZoneNbrs(w.elevationZone(b))) if (isOcean(n)) oceans.add(n);
    for (const b of mine) if (isOcean(b) && facing(b) >= 0) oceans.add(b);
    let landlocked = false;
    if (oceans.size === 0 && land.length > 0) {
      // breadth-first search outwards for the nearest ocean elevation zones
      landlocked = true;
      let frontier = land;
      const seen = new Set(land);
      for (let hop = 0; hop < this.p.maxHops && oceans.size === 0; hop++) {
        const next: number[] = [];
        for (const b of frontier) {
          for (const n of w.elevationZoneNbrs(w.elevationZone(b))) {
            if (seen.has(n)) continue;
            seen.add(n);
            if (isOcean(n)) oceans.add(n);
            else next.push(n);
          }
        }
        frontier = next;
      }
    }
    const pairs: { ocean: number; land: number }[] = [];
    for (const o of [...oceans].sort((a, b) => a - b)) {
      const l = facing(o);
      if (l >= 0) pairs.push({ ocean: o, land: l });
    }
    return { pairs, landlocked };
  }

  compute(rkey: number): RegionRivers {
    const t0 = performance.now();
    const w = this.world;
    const P = this.p;
    const { ax: axs, ay: ays } = this.attractors(rkey);
    const { pairs, landlocked } = this.rootPairs(rkey);
    const A = axs.length;
    const ax = Float64Array.from(axs);
    const ay = Float64Array.from(ays);
    const reachedBy = new Int32Array(A).fill(-1);
    const alive = new Uint8Array(A).fill(1);
    const near = new Int32Array(A).fill(-1);
    const nearD2 = new Float64Array(A).fill(Infinity);
    let aliveCount = A;

    // attractor grid with cell size dᵢ
    const G = P.influence;
    const grid = new Map<number, number[]>();
    const gk = (i: number, j: number) => (i + 1048576) * 2097152 + (j + 1048576);
    for (let a = 0; a < A; a++) {
      const k = gk(Math.floor(ax[a] / G), Math.floor(ay[a] / G));
      const list = grid.get(k);
      if (list) list.push(a);
      else grid.set(k, [a]);
    }

    let cap = 1024;
    let nx = new Float64Array(cap);
    let ny = new Float64Array(cap);
    let par = new Int32Array(cap);
    let own = new Int32Array(cap);
    /** 1 = the node may not grow any more (its pulls lead out of the region) */
    let dead = new Uint8Array(cap);
    /** unit heading (parent → node; 0,0 for roots), wander direction, first child (−1 = none) */
    let hx = new Float64Array(cap);
    let hy = new Float64Array(cap);
    let wvx = new Float64Array(cap);
    let wvy = new Float64Array(cap);
    let firstChild = new Int32Array(cap).fill(-1);
    let n = 0;
    /** main-stem dominance: a suppressed side branch's attractors within this distance drain into the stem */
    const absorb2 = (P.kill + 2 * P.step) ** 2;
    const cc = coneCos(P.cone);
    const cc2 = cc * cc;
    /**
     * Perception cone: may attractor a (at squared distance d2) pull node k? Compared
     * squared (dot ≥ 0 and dot² ≥ cos²·d²) since every half-angle here is ≤ 90°.
     */
    const sees = (k: number, a: number, d2: number): boolean => {
      if (cc < 0 || (hx[k] === 0 && hy[k] === 0) || d2 === 0) return true;
      const dot = (ax[a] - nx[k]) * hx[k] + (ay[a] - ny[k]) * hy[k];
      return dot >= 0 && dot * dot >= cc2 * d2;
    };
    const di2 = P.influence * P.influence;
    const dk2 = P.kill * P.kill;
    // node grid with cell size dᵢ (to re-find an attractor's nearest node when one dies)
    const nodeGrid = new Map<number, number[]>();

    /**
     * Rivers stay in their region: a node may lie over any ocean (the stretch from a
     * root to the coast) or on the region's own land, never on another region's land.
     * A landlocked region has to cross its neighbours to reach the sea, so it is exempt.
     */
    const inside = (x: number, y: number): boolean => {
      if (landlocked) return true;
      const c = w.cellAt(x, y, true);
      return c.ocean || c.region === rkey;
    };
    /** a segment from node k to (x, y): its end and midpoint must be inside */
    const segInside = (k: number, x: number, y: number): boolean => inside(x, y) && inside((nx[k] + x) * 0.5, (ny[k] + y) * 0.5);

    const addNode = (x: number, y: number, parent: number): number => {
      if (n === cap) {
        cap *= 2;
        const grow = <T extends Float64Array | Int32Array | Uint8Array>(arr: T, C: { new (n: number): T }) => {
          const b = new C(cap);
          b.set(arr);
          return b;
        };
        nx = grow(nx, Float64Array);
        ny = grow(ny, Float64Array);
        par = grow(par, Int32Array);
        own = grow(own, Int32Array);
        dead = grow(dead, Uint8Array);
        hx = grow(hx, Float64Array);
        hy = grow(hy, Float64Array);
        wvx = grow(wvx, Float64Array);
        wvy = grow(wvy, Float64Array);
        firstChild = grow(firstChild, Int32Array);
      }
      const id = n++;
      nx[id] = x;
      ny[id] = y;
      par[id] = parent;
      own[id] = 0;
      dead[id] = 0;
      firstChild[id] = -1;
      wvx[id] = 0;
      wvy[id] = 0;
      hx[id] = 0;
      hy[id] = 0;
      if (parent >= 0) {
        const ex = x - nx[parent];
        const ey = y - ny[parent];
        const el = Math.sqrt(ex * ex + ey * ey);
        if (el > 1e-9) {
          hx[id] = ex / el;
          hy[id] = ey / el;
        }
        if (firstChild[parent] < 0) firstChild[parent] = id;
      }
      const nk = gk(Math.floor(x / G), Math.floor(y / G));
      const nl = nodeGrid.get(nk);
      if (nl) nl.push(id);
      else nodeGrid.set(nk, [id]);
      // reach attractors within dₖ, and update the nearest node of those within dᵢ
      const ci = Math.floor(x / G);
      const cj = Math.floor(y / G);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const list = grid.get(gk(ci + di, cj + dj));
          if (!list) continue;
          for (const a of list) {
            if (!alive[a]) continue;
            const dx = ax[a] - x;
            const dy = ay[a] - y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= dk2) {
              alive[a] = 0;
              reachedBy[a] = id;
              own[id]++;
              aliveCount--;
            } else if ((d2 < nearD2[a] || (d2 === nearD2[a] && id < near[a])) && sees(id, a, d2)) {
              nearD2[a] = d2;
              near[a] = id;
            }
          }
        }
      }
      return id;
    };

    /** attractor → nodes it may not pull, because the straight line between them leaves the region */
    const banned = new Map<number, Set<number>>();
    const isBanned = (a: number, k: number): boolean => banned.get(a)?.has(k) ?? false;
    /** Does the straight line from node k to (x, y) stay inside (sampled every D/2)? */
    const visible = (k: number, x: number, y: number): boolean => {
      const d = Math.sqrt((x - nx[k]) ** 2 + (y - ny[k]) ** 2);
      if (d < 1e-9) return true;
      const ux = (x - nx[k]) / d;
      const uy = (y - ny[k]) / d;
      const h = P.step * 0.5;
      const m = Math.ceil(d / h);
      for (let s = 1; s < m; s++) if (!inside(nx[k] + ux * h * s, ny[k] + uy * h * s)) return false;
      return inside(x, y);
    };
    const addBan = (a: number, k: number): void => {
      let s = banned.get(a);
      if (!s) banned.set(a, (s = new Set()));
      s.add(k);
    };
    /**
     * Re-find an attractor's nearest live node within dᵢ that it can reach in a straight
     * line inside the region (none → −1). Nodes it cannot reach are banned on the way,
     * so a node that merely sits in open water (whose steps are never blocked) cannot
     * keep collecting pulls it can never follow.
     */
    const refind = (a: number): void => {
      const cands: { m: number; d2: number }[] = [];
      const ci = Math.floor(ax[a] / G);
      const cj = Math.floor(ay[a] / G);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const list = nodeGrid.get(gk(ci + di, cj + dj));
          if (!list) continue;
          for (const m of list) {
            if (dead[m] || isBanned(a, m)) continue;
            const d2 = (ax[a] - nx[m]) ** 2 + (ay[a] - ny[m]) ** 2;
            if (sees(m, a, d2)) cands.push({ m, d2 });
          }
        }
      }
      cands.sort((p, q) => p.d2 - q.d2 || p.m - q.m);
      near[a] = -1;
      nearD2[a] = Infinity;
      for (const c of cands) {
        if (c.d2 >= di2) break;
        if (visible(c.m, ax[a], ay[a])) {
          near[a] = c.m;
          nearD2[a] = c.d2;
          return;
        }
        addBan(a, c.m);
      }
    };
    const ban = (a: number, k: number): void => {
      addBan(a, k);
      if (near[a] === k) refind(a);
    };
    /** Stop node k growing, and hand its attractors to other nodes. */
    const kill = (k: number): void => {
      dead[k] = 1;
      for (let a = 0; a < A; a++) if (alive[a] && near[a] === k) refind(a);
    };

    const roots: number[] = [];
    const rootOcean: number[] = [];
    if (A > 0) {
      for (const pr of pairs) {
        const o = w.elevationZone(pr.ocean);
        let px = o.x;
        let py = o.y;
        if (!w.cellAt(px, py, true).ocean) {
          // coasts follow subbiome cells, so the elevation zone's site can fall on a sliver of
          // land: use the closest ocean subbiome site of the elevation zone instead
          let bd = Infinity;
          for (const s of w.elevationZoneSubs(o)) {
            const sd = w.sub(s);
            const d2 = (sd.x - o.x) ** 2 + (sd.y - o.y) ** 2;
            if (d2 < bd && w.cellAt(sd.x, sd.y, true).ocean) {
              bd = d2;
              px = sd.x;
              py = sd.y;
            }
          }
          if (bd === Infinity) continue;
        }
        roots.push(addNode(px, py, -1));
        rootOcean.push(pr.ocean);
      }
    }

    const reg = w.region(rkey);
    const rng = sfc32(hash4(w.p.seed, ST_GROW, reg.i, reg.j));
    const rv: [number, number] = [0, 0];
    let sx = new Float64Array(cap);
    let sy = new Float64Array(cap);
    let stamp = new Int32Array(cap);
    /** closest pulling attractor per node this iteration, and each node's last child */
    let closeA = new Int32Array(cap);
    let closeD = new Float64Array(cap);
    let lastChild = new Int32Array(cap).fill(-1);
    /** children grown per node */
    let kids = new Int32Array(cap);
    /** attractors pulling each node this iteration, and (main-stem dominance) pulls summed over a node's subtree */
    let cnt = new Int32Array(cap);
    let sub = new Int32Array(cap);
    let subStamp = new Int32Array(cap);
    let iterations = 0;
    let bridges = 0;
    let blockedPasses = 0;
    const touched: number[] = [];

    while (aliveCount > 0 && roots.length > 0 && iterations < MAX_ITER && n < MAX_NODES) {
      iterations++;
      if (sx.length < cap) {
        sx = new Float64Array(cap);
        sy = new Float64Array(cap);
        stamp = new Int32Array(cap);
        closeA = new Int32Array(cap);
        closeD = new Float64Array(cap);
        const lc = new Int32Array(cap).fill(-1);
        lc.set(lastChild);
        lastChild = lc;
        const kc = new Int32Array(cap);
        kc.set(kids);
        kids = kc;
        cnt = new Int32Array(cap);
        sub = new Int32Array(cap);
        subStamp = new Int32Array(cap);
      }
      touched.length = 0;
      for (let a = 0; a < A; a++) {
        if (!alive[a] || nearD2[a] >= di2) continue;
        const k = near[a];
        const d = Math.sqrt(nearD2[a]);
        if (stamp[k] !== iterations) {
          stamp[k] = iterations;
          touched.push(k);
          closeA[k] = a;
          closeD[k] = nearD2[a];
          cnt[k] = 1;
        } else {
          cnt[k]++;
          if (nearD2[a] < closeD[k]) {
            closeA[k] = a;
            closeD[k] = nearD2[a];
          }
        }
        const wgt = pullWeight(P.pull, nearD2[a], di2) / d;
        sx[k] += (ax[a] - nx[k]) * wgt;
        sy[k] += (ay[a] - ny[k]) * wgt;
      }
      if (touched.length === 0) {
        // nothing within dᵢ: bridge the closest node–attractor pair with a straight run
        let ba = -1;
        let bn = -1;
        let bd = Infinity;
        // every attractor's closest live node, tried closest pair first; a pair whose
        // straight run would leave the region is skipped
        const cand: { a: number; k: number; d2: number }[] = [];
        for (let a = 0; a < A; a++) {
          if (!alive[a]) continue;
          let ck = -1;
          let cd = Infinity;
          if ((banned.get(a)?.size ?? 0) >= MAX_BANS) continue;
          for (let k = 0; k < n; k++) {
            if (dead[k] || isBanned(a, k)) continue;
            const dx = ax[a] - nx[k];
            const dy = ay[a] - ny[k];
            const d2 = dx * dx + dy * dy;
            if (d2 < cd) {
              cd = d2;
              ck = k;
            }
          }
          if (ck >= 0) cand.push({ a, k: ck, d2: cd });
        }
        cand.sort((p, q) => p.d2 - q.d2 || p.a - q.a);
        let newBans = 0;
        for (const c of cand) {
          if (visible(c.k, ax[c.a], ay[c.a])) {
            ba = c.a;
            bn = c.k;
            bd = c.d2;
            break;
          }
          ban(c.a, c.k);
          newBans++;
        }
        if (ba < 0) {
          // every closest pair leaves the region; the bans may expose other pairs
          if (newBans > 0 && ++blockedPasses < MAX_BLOCKED_PASSES) continue;
          break;
        }
        bridges++;
        const d = Math.sqrt(bd);
        const ux = (ax[ba] - nx[bn]) / d;
        const uy = (ay[ba] - ny[bn]) / d;
        const steps = Math.max(1, Math.ceil((d - P.influence * 0.5) / P.step));
        let prev = bn;
        for (let s = 1; s <= steps && alive[ba]; s++) prev = addNode(nx[bn] + ux * P.step * s, ny[bn] + uy * P.step * s, prev);
        continue;
      }
      touched.sort((p, q) => p - q);
      if (P.apical > 0) {
        // pulls on each subtree (within APICAL_DEPTH nodes downstream of the puller)
        for (const k of touched) {
          let m = k;
          for (let d = 0; d < APICAL_DEPTH && m >= 0; d++, m = par[m]) {
            if (subStamp[m] !== iterations) {
              subStamp[m] = iterations;
              sub[m] = 0;
            }
            sub[m] += cnt[k];
          }
        }
      }
      for (const k of touched) {
        let dx = sx[k];
        let dy = sy[k];
        sx[k] = 0;
        sy[k] = 0;
        if (P.apical > 0 && kids[k] > 0) {
          // a side branch must be pulled by ≥ apical × what pulls on the main stem's
          // subtree. A weaker one is not grown: its attractors close to the stem drain
          // straight into it (flow without a visible channel), the farther ones turn to
          // other nodes. (Merely postponing it would only bring it back later as stubs.)
          const mc = firstChild[k];
          const main = mc >= 0 && subStamp[mc] === iterations ? sub[mc] : 0;
          if (cnt[k] < P.apical * main) {
            // only attractors within dᵢ pull k: they are in the 3×3 grid cells around it
            const ci = Math.floor(nx[k] / G);
            const cj = Math.floor(ny[k] / G);
            const mine: number[] = [];
            for (let gj = -1; gj <= 1; gj++) {
              for (let gi = -1; gi <= 1; gi++) {
                const list = grid.get(gk(ci + gi, cj + gj));
                if (list) for (const a of list) if (alive[a] && near[a] === k && nearD2[a] < di2) mine.push(a);
              }
            }
            mine.sort((p, q) => p - q);
            for (const a of mine) {
              if (nearD2[a] <= absorb2) {
                alive[a] = 0;
                reachedBy[a] = k;
                own[k]++;
                aliveCount--;
              }
            }
            continue;
          }
        }
        let len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-9) {
          // opposing pulls cancel: head for the closest one
          const a = closeA[k];
          dx = ax[a] - nx[k];
          dy = ay[a] - ny[k];
          len = Math.sqrt(dx * dx + dy * dy);
        }
        dx /= len;
        dy /= len;
        if (P.inertia > 0 && (hx[k] !== 0 || hy[k] !== 0)) {
          // keep going the way the river already runs
          const ix = dx + P.inertia * hx[k];
          const iy = dy + P.inertia * hy[k];
          const il = Math.sqrt(ix * ix + iy * iy);
          if (il > 1e-9) {
            dx = ix / il;
            dy = iy / il;
          }
        }
        // random motion: fresh each step, or (wander) inherited from the node and nudged
        let jx = 0;
        let jy = 0;
        if (P.jitter > 0) {
          discVec(rng, rv);
          jx = rv[0];
          jy = rv[1];
          if (P.wander > 0) {
            const vx = P.wander * wvx[k] + (1 - P.wander) * rv[0];
            const vy = P.wander * wvy[k] + (1 - P.wander) * rv[1];
            const vl = Math.sqrt(vx * vx + vy * vy);
            if (vl > 1e-9) {
              jx = vx / vl;
              jy = vy / vl;
            }
          }
          dx += P.jitter * jx;
          dy += P.jitter * jy;
          len = Math.sqrt(dx * dx + dy * dy);
          if (len < 1e-9) continue;
          dx /= len;
          dy /= len;
        }
        let tx = nx[k] + dx * P.step;
        let ty = ny[k] + dy * P.step;
        const lc = lastChild[k];
        if (lc >= 0 && (nx[lc] - tx) ** 2 + (ny[lc] - ty) ** 2 < (0.05 * P.step) ** 2) {
          // the same pulls again (a stall: the last child won over none of them):
          // step straight towards the closest pulling attractor instead
          const a = closeA[k];
          const d = Math.sqrt(closeD[k]);
          tx = nx[k] + ((ax[a] - nx[k]) / d) * P.step;
          ty = ny[k] + ((ay[a] - ny[k]) / d) * P.step;
        }
        if (!segInside(k, tx, ty)) {
          // the step would leave the region. Attractors that k cannot reach in a
          // straight line stop pulling on it (they turn to other nodes); k regrows
          // from the remaining pulls next iteration.
          let dropped = false;
          for (let a = 0; a < A; a++) {
            if (alive[a] && near[a] === k && !visible(k, ax[a], ay[a])) {
              ban(a, k);
              dropped = true;
            }
          }
          if (dropped) continue;
          // every pull is reachable but their mean is not: head straight for the closest
          const a = closeA[k];
          const d = Math.sqrt(closeD[k]);
          tx = nx[k] + ((ax[a] - nx[k]) / d) * P.step;
          ty = ny[k] + ((ay[a] - ny[k]) / d) * P.step;
          if (!segInside(k, tx, ty)) {
            kill(k);
            continue;
          }
        }
        if (++kids[k] > MAX_CHILDREN) {
          // safety net: a node that keeps sprouting is stuck against the border
          kill(k);
          continue;
        }
        const child = addNode(tx, ty, k);
        lastChild[k] = child;
        wvx[child] = jx;
        wvy[child] = jy;
      }
    }

    // flow: attractors reached at the node and everything upstream of it
    const flow = own.slice(0, n);
    for (let k = n - 1; k >= 0; k--) if (par[k] >= 0) flow[par[k]] += flow[k];
    const wet = new Uint8Array(n);
    for (let k = 0; k < n; k++) wet[k] = w.cellAt(nx[k], ny[k], true).ocean ? 1 : 0;
    const tree = new Int32Array(n);
    for (let k = 0; k < n; k++) tree[k] = par[k] < 0 ? k : tree[par[k]];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < n; k++) {
      if (nx[k] < x0) x0 = nx[k];
      if (nx[k] > x1) x1 = nx[k];
      if (ny[k] < y0) y0 = ny[k];
      if (ny[k] > y1) y1 = ny[k];
    }
    for (let a = 0; a < A; a++) {
      if (ax[a] < x0) x0 = ax[a];
      if (ax[a] > x1) x1 = ax[a];
      if (ay[a] < y0) y0 = ay[a];
      if (ay[a] > y1) y1 = ay[a];
    }
    return {
      region: rkey,
      n,
      x: nx.slice(0, n),
      y: ny.slice(0, n),
      parent: par.slice(0, n),
      own: own.slice(0, n),
      flow,
      tree,
      wet,
      roots,
      rootOcean,
      ax,
      ay,
      reachedBy,
      reached: A - aliveCount,
      iterations,
      bridges,
      landlocked,
      x0,
      y0,
      x1,
      y1,
      ms: performance.now() - t0,
    };
  }

  /** Nearest river node to a point among cached regions near it (for the inspector). */
  nearestNode(x: number, y: number, maxDist: number): { r: RegionRivers; k: number; d: number } | null {
    const w = this.world;
    const rk = w.regionAt(x, y);
    const ri = keyI(rk);
    const rj = keyJ(rk);
    let best: { r: RegionRivers; k: number; d: number } | null = null;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const r = this.cache.get(packKey(ri + di, rj + dj));
        if (!r || x < r.x0 - maxDist || x > r.x1 + maxDist || y < r.y0 - maxDist || y > r.y1 + maxDist) continue;
        for (let k = 0; k < r.n; k++) {
          const d = Math.sqrt((r.x[k] - x) ** 2 + (r.y[k] - y) ** 2);
          if (d <= maxDist && (!best || d < best.d)) best = { r, k, d };
        }
      }
    }
    return best;
  }
}
