/**
 * Space-colonization rivers (Runions et al. 2005, open venation), computed per region.
 *
 * For one region:
 *   Attractors  every land, non-coastal subbiome owned by one of the region's land
 *               biomes gets `perSub` points, scattered inside the subbiome's cell.
 *   Roots       one per ocean biome that touches the region's land (a Gabriel
 *               neighbour of a land biome it owns, or an ocean biome it owns with a land
 *               neighbour). The root sits at the ocean biome's point (its site), so each
 *               river first grows across the water to the coast. A landlocked region looks
 *               further out (up to `maxHops` biome steps) for the nearest ocean.
 *   Growth      each iteration, every attractor pulls on its nearest node within the
 *               influence radius dᵢ; each pulled node grows one step D towards the mean
 *               direction of its attractors (each weighted by a power of its distance,
 *               see `pull`), plus `jitter` × a random unit vector (the
 *               "random motion"). Attractors within the kill distance dₖ of a node are
 *               reached and removed. When no attractor is within dᵢ of any node, the
 *               closest node–attractor pair is bridged with a straight run of nodes, so
 *               growth always continues until every attractor is used.
 *   Width       each node counts the attractors it reached; summed upstream this is the
 *               flow of the river at that node (a river's mouth carries all attractors
 *               its tree reached). Line width is drawn from the flow.
 *
 * Deterministic: sfc32 per region, IEEE + − × ÷ √ only (random directions come from
 * rejection sampling in the unit disc, not trigonometry), and a fixed visiting order.
 */
import { hash4, sfc32, type Rng } from '@shared/core/hash';
import { keyI, keyJ, packKey } from './level';
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
  /** leave out subbiomes that touch the ocean */
  skipCoast: boolean;
  /** how many biome steps a landlocked region searches for an ocean */
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
  /** root node indices and the ocean biome each root drains into */
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
const MAX_ITER = 6000;
const MAX_NODES = 120000;

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
  readonly p: RiverParams;
  private cache = new Map<number, RegionRivers>();

  constructor(world: World, p: RiverParams) {
    this.world = world;
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

  /** Attractor points of a region (land, non-coastal subbiomes of its land biomes). */
  attractors(rkey: number): { ax: number[]; ay: number[] } {
    const w = this.world;
    const reg = w.region(rkey);
    const L = w.subLevel;
    const rng = sfc32(hash4(w.p.seed, ST_ATTR, reg.i, reg.j));
    const ax: number[] = [];
    const ay: number[] = [];
    for (const b of reg.biomes) {
      if (w.biomeCell(b).ocean) continue;
      for (const s of w.biomeSubs(w.biome(b))) {
        if (w.subCell(s).ocean) continue;
        if (this.p.skipCoast && this.isCoastSub(s)) continue;
        const sd = w.sub(s);
        for (let k = 0; k < this.p.perSub; k++) {
          // a random point inside the (warped) subbiome cell; fall back to the site
          let px = sd.x;
          let py = sd.y;
          for (let t = 0; t < 24; t++) {
            const qx = sd.x + (rng() - 0.5) * 1.6 * L.size;
            const qy = sd.y + (rng() - 0.5) * 1.6 * L.size;
            if (L.query(qx, qy) === s) {
              px = qx;
              py = qy;
              break;
            }
          }
          ax.push(px);
          ay.push(py);
        }
      }
    }
    return { ax, ay };
  }

  /** Ocean biomes that receive a root, and the land biome each root faces. */
  rootPairs(rkey: number): { pairs: { ocean: number; land: number }[]; landlocked: boolean } {
    const w = this.world;
    const reg = w.region(rkey);
    const own = new Set(reg.biomes);
    const isOcean = (b: number) => w.biomeCell(b).ocean;
    const land = reg.biomes.filter((b) => !isOcean(b));
    // nearest land neighbour of an ocean biome, preferring the region's own biomes
    const facing = (o: number): number => {
      let best = -1;
      let bestOwn = false;
      for (const n of w.biomeNbrs(w.biome(o))) {
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
    for (const b of land) for (const n of w.biomeNbrs(w.biome(b))) if (isOcean(n)) oceans.add(n);
    for (const b of reg.biomes) if (isOcean(b) && facing(b) >= 0) oceans.add(b);
    let landlocked = false;
    if (oceans.size === 0 && land.length > 0) {
      // breadth-first search outwards for the nearest ocean biomes
      landlocked = true;
      let frontier = land;
      const seen = new Set(land);
      for (let hop = 0; hop < this.p.maxHops && oceans.size === 0; hop++) {
        const next: number[] = [];
        for (const b of frontier) {
          for (const n of w.biomeNbrs(w.biome(b))) {
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
    let n = 0;
    const di2 = P.influence * P.influence;
    const dk2 = P.kill * P.kill;

    const addNode = (x: number, y: number, parent: number): number => {
      if (n === cap) {
        cap *= 2;
        const grow = <T extends Float64Array | Int32Array>(arr: T, C: { new (n: number): T }) => {
          const b = new C(cap);
          b.set(arr);
          return b;
        };
        nx = grow(nx, Float64Array);
        ny = grow(ny, Float64Array);
        par = grow(par, Int32Array);
        own = grow(own, Int32Array);
      }
      const id = n++;
      nx[id] = x;
      ny[id] = y;
      par[id] = parent;
      own[id] = 0;
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
            } else if (d2 < nearD2[a] || (d2 === nearD2[a] && id < near[a])) {
              nearD2[a] = d2;
              near[a] = id;
            }
          }
        }
      }
      return id;
    };

    const roots: number[] = [];
    const rootOcean: number[] = [];
    if (A > 0) {
      for (const pr of pairs) {
        const o = w.biome(pr.ocean);
        roots.push(addNode(o.x, o.y, -1));
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
    let iterations = 0;
    let bridges = 0;
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
        } else if (nearD2[a] < closeD[k]) {
          closeA[k] = a;
          closeD[k] = nearD2[a];
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
        for (let a = 0; a < A; a++) {
          if (!alive[a]) continue;
          for (let k = 0; k < n; k++) {
            const dx = ax[a] - nx[k];
            const dy = ay[a] - ny[k];
            const d2 = dx * dx + dy * dy;
            if (d2 < bd) {
              bd = d2;
              ba = a;
              bn = k;
            }
          }
        }
        if (ba < 0) break;
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
      for (const k of touched) {
        let dx = sx[k];
        let dy = sy[k];
        sx[k] = 0;
        sy[k] = 0;
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
        if (P.jitter > 0) {
          discVec(rng, rv);
          dx += P.jitter * rv[0];
          dy += P.jitter * rv[1];
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
        lastChild[k] = addNode(tx, ty, k);
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
