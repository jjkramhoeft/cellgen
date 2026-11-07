/**
 * Space Colonization Algorithm (Runions et al. 2005 leaf venation / 2007 trees),
 * open variant, used to grow river networks upstream from their mouths
 * (research gaps §1).
 *
 * Per iteration:
 *  1. associate: every live attraction point picks its closest node (if within dᵢ),
 *  2. grow: each influenced node adds a child at v + D·normalize(Σ unit vectors + g),
 *  3. kill: points with a node closer than dₖ are removed.
 *
 * Acceleration is the incremental nearest-node cache from the research design note:
 * nodes are only added, so each point caches its nearest node and is updated only
 * from new nodes found through a uniform grid of points.
 */
import { dpow } from '../core/dmath';
import { hash3, rand01, sfc32, STAGE, toUnit } from '../core/hash';
import type { CellGraph } from '../graph/types';
import { num, str, type Params } from '../params/schema';
import { WATER_LAND, WATER_OCEAN } from './hydrology';

export interface ScaNet {
  /** node positions */
  nx: Float64Array;
  ny: Float64Array;
  /** parent node (−1 for roots) */
  parent: Int32Array;
  /** Murray radius (leaves = 1) */
  radius: Float64Array;
  /** Strahler stream order */
  order: Int32Array;
  count: number;
  /** attraction points (initial) and whether they were consumed */
  ax: Float64Array;
  ay: Float64Array;
  killed: Uint8Array;
  iterations: number;
  maxOrder: number;
  roots: number;
}

export function colonize(
  g: CellGraph,
  p: Params,
  seed: number,
  elev: Float64Array,
  water: Uint8Array,
  moist: Float64Array,
  grad: { gx: Float64Array; gy: Float64Array },
): ScaNet {
  const n = g.n;
  const domainLand = str(p, 'sca.domain') === 'land';
  const inDomain = (c: number) => c >= 0 && (!domainLand || water[c] === WATER_LAND);
  const D = num(p, 'sca.seg') * g.spacing;
  const infl = num(p, 'sca.influence');
  const di = infl <= 0 ? Infinity : infl * D;
  const dk = num(p, 'sca.kill') * D;
  const maxIter = num(p, 'sca.iterations');
  const uphill = num(p, 'sca.uphill');
  const rng = sfc32((seed ^ Math.imul(STAGE.sca, 0x9e3779b9)) | 0);

  // --- attraction points: weighted, jittered cell centres
  const weightMode = str(p, 'sca.weight');
  const cand: number[] = [];
  let wsum = 0;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (!inDomain(i)) continue;
    const wi =
      (weightMode === 'moisture' ? 0.15 + moist[i] : weightMode === 'elevation' ? 0.15 + Math.max(0, elev[i]) : 1) * g.area[i];
    w[i] = wi;
    wsum += wi;
    cand.push(i);
  }
  const A = num(p, 'sca.attractors');
  const axs: number[] = [];
  const ays: number[] = [];
  if (wsum > 0) {
    for (const i of cand) {
      // expected count A·w/wsum; place floor + Bernoulli remainder
      const e = (A * w[i]) / wsum;
      let k = Math.floor(e);
      if (toUnit(hash3(seed, STAGE.sca + 1, i)) < e - k) k++;
      for (let q = 0; q < k; q++) {
        const r = Math.sqrt(g.area[i]) * 0.5;
        const x = g.x[i] + (rand01(seed, STAGE.sca + 2, i * 16 + q) * 2 - 1) * r;
        const y = g.y[i] + (rand01(seed, STAGE.sca + 3, i * 16 + q) * 2 - 1) * r;
        if (x < 0 || y < 0 || x > g.W || y > g.H) continue;
        axs.push(x);
        ays.push(y);
      }
    }
  }
  const na = axs.length;
  const ax = Float64Array.from(axs);
  const ay = Float64Array.from(ays);
  const killed = new Uint8Array(na);

  // --- roots
  const R = num(p, 'sca.roots');
  const placement = str(p, 'sca.rootPlacement');
  let rootCand: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!inDomain(i)) continue;
    if (placement === 'coast') {
      let coast = false;
      for (let k = g.nbrOff[i]; k < g.nbrOff[i + 1]; k++) if (water[g.nbr[k]] === WATER_OCEAN) coast = true;
      if (coast) rootCand.push(i);
    } else if (placement === 'border') {
      if (g.border[i]) rootCand.push(i);
    } else rootCand.push(i);
  }
  if (placement === 'center') {
    const c = g.cellAt(g.W / 2, g.H / 2);
    rootCand = inDomain(c) ? [c] : rootCand.slice(0, 1);
  }
  if (rootCand.length === 0) for (let i = 0; i < n && rootCand.length === 0; i++) if (inDomain(i)) rootCand.push(i);
  // shuffle deterministically, then pick greedily with a minimum spacing
  for (let i = rootCand.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = rootCand[i];
    rootCand[i] = rootCand[j];
    rootCand[j] = t;
  }
  const minSep = Math.sqrt((g.W * g.H) / Math.max(1, R)) * 0.35;
  const roots: number[] = [];
  for (const c of rootCand) {
    if (roots.length >= R) break;
    if (
      roots.every((r) => {
        const dx = g.x[r] - g.x[c];
        const dy = g.y[r] - g.y[c];
        return dx * dx + dy * dy >= minSep * minSep;
      })
    )
      roots.push(c);
  }

  // --- nodes
  let cap = 1024;
  let nx = new Float64Array(cap);
  let ny = new Float64Array(cap);
  let parent = new Int32Array(cap);
  let count = 0;
  const addNode = (x: number, y: number, par: number) => {
    if (count === cap) {
      cap *= 2;
      const a = new Float64Array(cap);
      a.set(nx);
      nx = a;
      const b = new Float64Array(cap);
      b.set(ny);
      ny = b;
      const c = new Int32Array(cap);
      c.set(parent);
      parent = c;
    }
    nx[count] = x;
    ny[count] = y;
    parent[count] = par;
    return count++;
  };
  for (const r of roots) addNode(g.x[r], g.y[r], -1);

  // node grid for the "too close" guard
  const ncs = D;
  const ngw = Math.ceil(g.W / ncs) + 1;
  const ngh = Math.ceil(g.H / ncs) + 1;
  const nodeHead = new Int32Array(ngw * ngh).fill(-1);
  let nodeNext = new Int32Array(cap);
  const gridAdd = (k: number) => {
    if (nodeNext.length < cap) {
      const a = new Int32Array(cap);
      a.set(nodeNext);
      nodeNext = a;
    }
    const gx = Math.min(ngw - 1, Math.max(0, Math.floor(nx[k] / ncs)));
    const gy = Math.min(ngh - 1, Math.max(0, Math.floor(ny[k] / ncs)));
    nodeNext[k] = nodeHead[gy * ngw + gx];
    nodeHead[gy * ngw + gx] = k;
  };
  const tooClose = (x: number, y: number, lim: number) => {
    const gx = Math.floor(x / ncs);
    const gy = Math.floor(y / ncs);
    for (let yy = Math.max(0, gy - 1); yy <= Math.min(ngh - 1, gy + 1); yy++)
      for (let xx = Math.max(0, gx - 1); xx <= Math.min(ngw - 1, gx + 1); xx++)
        for (let k = nodeHead[yy * ngw + xx]; k !== -1; k = nodeNext[k]) {
          const dx = nx[k] - x;
          const dy = ny[k] - y;
          if (dx * dx + dy * dy < lim * lim) return true;
        }
    return false;
  };
  for (let k = 0; k < count; k++) gridAdd(k);

  // attraction grid (for incremental updates from new nodes)
  const acs = Number.isFinite(di) ? Math.max(di, dk, D) : Math.max(g.W, g.H);
  const agw = Math.ceil(g.W / acs) + 1;
  const agh = Math.ceil(g.H / acs) + 1;
  const aHead = new Int32Array(agw * agh).fill(-1);
  const aNext = new Int32Array(na);
  for (let a = 0; a < na; a++) {
    const gx = Math.min(agw - 1, Math.floor(ax[a] / acs));
    const gy = Math.min(agh - 1, Math.floor(ay[a] / acs));
    aNext[a] = aHead[gy * agw + gx];
    aHead[gy * agw + gx] = a;
  }
  const nearest = new Int32Array(na).fill(-1);
  const nearD = new Float64Array(na).fill(Infinity);
  const update = (k: number) => {
    const gx = Math.floor(nx[k] / acs);
    const gy = Math.floor(ny[k] / acs);
    for (let yy = Math.max(0, gy - 1); yy <= Math.min(agh - 1, gy + 1); yy++)
      for (let xx = Math.max(0, gx - 1); xx <= Math.min(agw - 1, gx + 1); xx++)
        for (let a = aHead[yy * agw + xx]; a !== -1; a = aNext[a]) {
          if (killed[a]) continue;
          const dx = ax[a] - nx[k];
          const dy = ay[a] - ny[k];
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < nearD[a] || (d === nearD[a] && k < nearest[a])) {
            nearD[a] = d;
            nearest[a] = k;
          }
          if (d < dk) killed[a] = 1;
        }
  };
  for (let k = 0; k < count; k++) update(k);

  const sumX = new Float64Array(cap);
  const sumY = new Float64Array(cap);
  let iterations = 0;
  let sx = sumX;
  let sy = sumY;
  for (let it = 0; it < maxIter; it++) {
    iterations = it + 1;
    if (sx.length < cap) {
      sx = new Float64Array(cap);
      sy = new Float64Array(cap);
    } else {
      sx.fill(0, 0, count);
      sy.fill(0, 0, count);
    }
    const touched: number[] = [];
    const hit = new Uint8Array(count);
    for (let a = 0; a < na; a++) {
      if (killed[a] || nearest[a] < 0 || nearD[a] >= di) continue;
      const k = nearest[a];
      const d = nearD[a] || 1e-9;
      sx[k] += (ax[a] - nx[k]) / d;
      sy[k] += (ay[a] - ny[k]) / d;
      if (!hit[k]) {
        hit[k] = 1;
        touched.push(k);
      }
    }
    if (touched.length === 0) break;
    const before = count;
    for (const k of touched) {
      let dx = sx[k];
      let dy = sy[k];
      const L = Math.sqrt(dx * dx + dy * dy);
      if (L < 1e-6) continue; // opposing points cancel — skip (stall guard)
      dx /= L;
      dy /= L;
      if (uphill > 0) {
        const c = g.cellAt(nx[k], ny[k]);
        if (c >= 0) {
          const gl = Math.sqrt(grad.gx[c] * grad.gx[c] + grad.gy[c] * grad.gy[c]);
          if (gl > 1e-12) {
            dx += (uphill * grad.gx[c]) / gl;
            dy += (uphill * grad.gy[c]) / gl;
          }
        }
        const L2 = Math.sqrt(dx * dx + dy * dy);
        if (L2 < 1e-6) continue;
        dx /= L2;
        dy /= L2;
      }
      const x = nx[k] + D * dx;
      const y = ny[k] + D * dy;
      if (x < 0 || y < 0 || x > g.W || y > g.H) continue;
      if (domainLand && !inDomain(g.cellAt(x, y))) continue;
      if (tooClose(x, y, D * 0.45)) continue;
      const id = addNode(x, y, k);
      gridAdd(id);
    }
    if (count === before) {
      // every influenced tip was blocked: kill the points they were chasing so others can win
      for (let a = 0; a < na; a++) if (!killed[a] && nearest[a] >= 0 && nearD[a] < di && hit[nearest[a]]) killed[a] = 1;
      continue;
    }
    for (let k = before; k < count; k++) update(k);
  }

  // Murray widths & Strahler order, children before parents (reverse creation order)
  const radius = new Float64Array(count);
  const rsum = new Float64Array(count);
  const kids = new Int32Array(count);
  const order = new Int32Array(count);
  const maxChildOrder = new Int32Array(count);
  const maxCount = new Int32Array(count);
  const murray = num(p, 'sca.murray');
  for (let k = count - 1; k >= 0; k--) {
    radius[k] = kids[k] === 0 ? 1 : dpow(rsum[k], 1 / murray);
    order[k] = kids[k] === 0 ? 1 : maxCount[k] >= 2 ? maxChildOrder[k] + 1 : maxChildOrder[k];
    const par = parent[k];
    if (par >= 0) {
      kids[par]++;
      rsum[par] += dpow(radius[k], murray);
      if (order[k] > maxChildOrder[par]) {
        maxChildOrder[par] = order[k];
        maxCount[par] = 1;
      } else if (order[k] === maxChildOrder[par]) maxCount[par]++;
    }
  }
  let maxOrder = 0;
  for (let k = 0; k < count; k++) maxOrder = Math.max(maxOrder, order[k]);
  return {
    nx: nx.slice(0, count),
    ny: ny.slice(0, count),
    parent: parent.slice(0, count),
    radius,
    order,
    count,
    ax,
    ay,
    killed,
    iterations,
    maxOrder,
    roots: roots.length,
  };
}

/** Lower elevation along the network: depth · smoothstep falloff of the capsule distance. */
export function carve(g: CellGraph, net: ScaNet, elev: Float64Array, water: Uint8Array, depth: number, widthCells: number): void {
  const w = widthCells * g.spacing;
  const cs = Math.max(w, g.spacing);
  const gw = Math.ceil(g.W / cs) + 1;
  const gh = Math.ceil(g.H / cs) + 1;
  const head = new Int32Array(gw * gh).fill(-1);
  const next = new Int32Array(net.count);
  for (let k = 0; k < net.count; k++) {
    const gx = Math.min(gw - 1, Math.max(0, Math.floor(net.nx[k] / cs)));
    const gy = Math.min(gh - 1, Math.max(0, Math.floor(net.ny[k] / cs)));
    next[k] = head[gy * gw + gx];
    head[gy * gw + gx] = k;
  }
  let maxR = 1;
  for (let k = 0; k < net.count; k++) maxR = Math.max(maxR, net.radius[k]);
  for (let i = 0; i < g.n; i++) {
    if (water[i] !== WATER_LAND) continue;
    const gx = Math.floor(g.x[i] / cs);
    const gy = Math.floor(g.y[i] / cs);
    let best = Infinity;
    let bestR = 1;
    for (let yy = Math.max(0, gy - 1); yy <= Math.min(gh - 1, gy + 1); yy++)
      for (let xx = Math.max(0, gx - 1); xx <= Math.min(gw - 1, gx + 1); xx++)
        for (let k = head[yy * gw + xx]; k !== -1; k = next[k]) {
          const par = net.parent[k];
          const bx = par >= 0 ? net.nx[par] : net.nx[k];
          const by = par >= 0 ? net.ny[par] : net.ny[k];
          const pax = g.x[i] - net.nx[k];
          const pay = g.y[i] - net.ny[k];
          const bax = bx - net.nx[k];
          const bay = by - net.ny[k];
          const L = bax * bax + bay * bay;
          let h = L > 0 ? (pax * bax + pay * bay) / L : 0;
          h = h < 0 ? 0 : h > 1 ? 1 : h;
          const dx = pax - bax * h;
          const dy = pay - bay * h;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < best) {
            best = d;
            bestR = net.radius[k];
          }
        }
    if (best < w) {
      const t = 1 - best / w;
      const s = t * t * (3 - 2 * t);
      const scale = 0.4 + 0.6 * Math.sqrt(bestR / maxR);
      elev[i] = Math.max(1e-4, elev[i] - depth * s * scale);
    }
  }
}
