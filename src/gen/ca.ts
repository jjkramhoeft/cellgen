/**
 * Cellular automata on an arbitrary cell graph (research §4.1).
 *
 * The RogueBasin 4-5 rule ("wall if ≥ 5 of the 9 cells in the 3×3 block are walls")
 * becomes a fraction of the closed neighbourhood: wall if walls/(deg+1) ≥ t, with
 * t = 5/9 by default. The large-hall fix "R1 ≥ 5 or R2 ≤ 2" uses the 2-ring.
 * Connectivity keeps only the largest floor region.
 */
import { hash3, STAGE, toUnit } from '../core/hash';
import type { CellGraph } from '../graph/types';
import { bool, num, str, type Params } from '../params/schema';
import { WATER_LAND } from './hydrology';

export interface CaResult {
  /** 1 = wall, 0 = floor, 2 = outside domain */
  state: Uint8Array;
  regions: number;
  floorFrac: number;
}

export function runCA(g: CellGraph, p: Params, seed: number, water: Uint8Array): CaResult {
  const n = g.n;
  const landOnly = str(p, 'ca.domain') === 'land';
  const fill = num(p, 'ca.fill');
  const t = num(p, 'ca.threshold');
  const iters = num(p, 'ca.iterations');
  const r2Iters = num(p, 'ca.r2');
  const r2cut = num(p, 'ca.r2cut');
  const borderWall = bool(p, 'ca.borderWall');
  const inDom = new Uint8Array(n);
  for (let i = 0; i < n; i++) inDom[i] = !landOnly || water[i] === WATER_LAND ? 1 : 0;
  let s = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!inDom[i]) s[i] = 1;
    else s[i] = toUnit(hash3(seed, STAGE.ca, i)) < fill || (borderWall && g.border[i]) ? 1 : 0;
  }
  // 2-ring neighbourhoods (only built when needed)
  let ring2: Int32Array[] | null = null;
  if (r2Iters > 0) {
    ring2 = new Array(n);
    const mark = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      const list: number[] = [];
      mark[i] = i;
      list.push(i);
      for (let k = g.nbrOff[i]; k < g.nbrOff[i + 1]; k++) {
        const a = g.nbr[k];
        if (mark[a] !== i) {
          mark[a] = i;
          list.push(a);
        }
        for (let q = g.nbrOff[a]; q < g.nbrOff[a + 1]; q++) {
          const b = g.nbr[q];
          if (mark[b] !== i) {
            mark[b] = i;
            list.push(b);
          }
        }
      }
      ring2[i] = Int32Array.from(list);
    }
  }
  const next = new Uint8Array(n);
  for (let it = 0; it < iters + r2Iters; it++) {
    const useR2 = it < r2Iters;
    for (let i = 0; i < n; i++) {
      if (!inDom[i] || (borderWall && g.border[i])) {
        next[i] = 1;
        continue;
      }
      let walls = s[i] ? 1 : 0;
      const deg = g.nbrOff[i + 1] - g.nbrOff[i];
      for (let k = g.nbrOff[i]; k < g.nbrOff[i + 1]; k++) if (s[g.nbr[k]]) walls++;
      let wall = walls / (deg + 1) >= t;
      if (useR2 && ring2) {
        const r = ring2[i];
        let w2 = 0;
        for (let k = 0; k < r.length; k++) if (s[r[k]]) w2++;
        if (w2 / r.length <= r2cut) wall = true;
      }
      next[i] = wall ? 1 : 0;
    }
    s = Uint8Array.from(next);
  }
  // connectivity
  const region = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (s[i] || region[i] >= 0) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    region[i] = id;
    let area = 0;
    while (head < tail) {
      const c = queue[head++];
      area += g.area[c];
      for (let k = g.nbrOff[c]; k < g.nbrOff[c + 1]; k++) {
        const nb = g.nbr[k];
        if (s[nb] || region[nb] >= 0) continue;
        region[nb] = id;
        queue[tail++] = nb;
      }
    }
    sizes.push(area);
  }
  if (bool(p, 'ca.connect') && sizes.length > 1) {
    let best = 0;
    for (let r = 1; r < sizes.length; r++) if (sizes[r] > sizes[best]) best = r;
    for (let i = 0; i < n; i++) if (!s[i] && region[i] !== best) s[i] = 1;
  }
  let floor = 0;
  let dom = 0;
  for (let i = 0; i < n; i++) {
    if (!inDom[i]) {
      s[i] = 2;
      continue;
    }
    dom += g.area[i];
    if (s[i] === 0) floor += g.area[i];
  }
  return { state: s, regions: sizes.length, floorFrac: dom > 0 ? floor / dom : 0 };
}
