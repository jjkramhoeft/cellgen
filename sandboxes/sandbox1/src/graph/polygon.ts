/** Polygon utilities: label-preserving rectangle clipping, area, centroid, perimeter. */

export interface LPoly {
  xs: number[];
  ys: number[];
  /** lbl[k] = label of edge from vertex k to vertex k+1 (wrapping) */
  lbl: number[];
}

/**
 * Sutherland–Hodgman clip against the rectangle [0,W]×[0,H], carrying the
 * neighbour label of every edge through the clip. New edges created along the
 * rectangle get label −1.
 */
export function clipToRect(p: LPoly, W: number, H: number): LPoly {
  let cur = p;
  // planes: x >= 0, x <= W, y >= 0, y <= H
  for (let plane = 0; plane < 4 && cur.xs.length > 0; plane++) {
    const inside = (x: number, y: number) =>
      plane === 0 ? x >= 0 : plane === 1 ? x <= W : plane === 2 ? y >= 0 : y <= H;
    const isect = (ax: number, ay: number, bx: number, by: number): [number, number] => {
      let t: number;
      if (plane === 0) t = (0 - ax) / (bx - ax);
      else if (plane === 1) t = (W - ax) / (bx - ax);
      else if (plane === 2) t = (0 - ay) / (by - ay);
      else t = (H - ay) / (by - ay);
      let x = ax + (bx - ax) * t;
      let y = ay + (by - ay) * t;
      if (plane === 0) x = 0;
      else if (plane === 1) x = W;
      else if (plane === 2) y = 0;
      else y = H;
      return [x, y];
    };
    // Work with "incoming" labels: inL[k] = label of edge (k-1 → k).
    const m = cur.xs.length;
    const outX: number[] = [];
    const outY: number[] = [];
    const outIn: number[] = [];
    for (let k = 0; k < m; k++) {
      const a = (k + m - 1) % m;
      const ax = cur.xs[a];
      const ay = cur.ys[a];
      const bx = cur.xs[k];
      const by = cur.ys[k];
      const L = cur.lbl[a];
      const ain = inside(ax, ay);
      const bin = inside(bx, by);
      if (ain && bin) {
        outX.push(bx);
        outY.push(by);
        outIn.push(L);
      } else if (ain && !bin) {
        const [ix, iy] = isect(ax, ay, bx, by);
        outX.push(ix);
        outY.push(iy);
        outIn.push(L);
      } else if (!ain && bin) {
        const [ix, iy] = isect(ax, ay, bx, by);
        outX.push(ix);
        outY.push(iy);
        outIn.push(-1);
        outX.push(bx);
        outY.push(by);
        outIn.push(L);
      }
    }
    // convert incoming labels back to outgoing labels
    const mm = outX.length;
    const outL = new Array<number>(mm);
    for (let k = 0; k < mm; k++) outL[k] = outIn[(k + 1) % mm];
    cur = { xs: outX, ys: outY, lbl: outL };
  }
  return cur;
}

export function polyArea(xs: ArrayLike<number>, ys: ArrayLike<number>, o = 0, m = xs.length): number {
  let a = 0;
  for (let k = 0; k < m; k++) {
    const i = o + k;
    const j = o + ((k + 1) % m);
    a += xs[i] * ys[j] - xs[j] * ys[i];
  }
  return a / 2;
}

/** Signed-area-weighted centroid; falls back to the vertex mean for degenerate polygons. */
export function polyCentroid(xs: number[], ys: number[]): [number, number, number] {
  const m = xs.length;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let k = 0; k < m; k++) {
    const j = (k + 1) % m;
    const cr = xs[k] * ys[j] - xs[j] * ys[k];
    a += cr;
    cx += (xs[k] + xs[j]) * cr;
    cy += (ys[k] + ys[j]) * cr;
  }
  a /= 2;
  if (Math.abs(a) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < m; k++) {
      sx += xs[k];
      sy += ys[k];
    }
    return [m ? sx / m : 0, m ? sy / m : 0, 0];
  }
  return [cx / (6 * a), cy / (6 * a), Math.abs(a)];
}

export function polyPerimeter(xs: number[], ys: number[]): number {
  let p = 0;
  const m = xs.length;
  for (let k = 0; k < m; k++) {
    const j = (k + 1) % m;
    const dx = xs[j] - xs[k];
    const dy = ys[j] - ys[k];
    p += Math.sqrt(dx * dx + dy * dy);
  }
  return p;
}

/** Remove consecutive duplicate vertices (zero-length edges), keeping labels consistent. */
export function dedupe(p: LPoly, eps: number): LPoly {
  const m = p.xs.length;
  if (m < 2) return p;
  const xs: number[] = [];
  const ys: number[] = [];
  const lbl: number[] = [];
  for (let k = 0; k < m; k++) {
    const j = (k + 1) % m;
    const dx = p.xs[j] - p.xs[k];
    const dy = p.ys[j] - p.ys[k];
    if (dx * dx + dy * dy <= eps * eps) continue; // drop vertex k; edge k→j has zero length
    xs.push(p.xs[k]);
    ys.push(p.ys[k]);
    lbl.push(p.lbl[k]);
  }
  return { xs, ys, lbl };
}
