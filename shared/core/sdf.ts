/** 2D signed distance functions and operators (Quilez, "2D distance functions", "smooth minimum"). */

export function sdCircle(px: number, py: number, r: number): number {
  return Math.sqrt(px * px + py * py) - r;
}

export function sdBox(px: number, py: number, bx: number, by: number): number {
  const dx = Math.abs(px) - bx;
  const dy = Math.abs(py) - by;
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(dx, dy), 0);
}

export function sdRoundBox(px: number, py: number, bx: number, by: number, r: number): number {
  return sdBox(px, py, bx - r, by - r) - r;
}

/** Distance from p to the segment ab (capsule core). Also writes the projection parameter t. */
export function sdSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const L = bax * bax + bay * bay;
  let h = L > 0 ? (pax * bax + pay * bay) / L : 0;
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Quadratic polynomial smooth minimum; k is the blend width in distance units. */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Annular ("onion") operator: a shell of half-thickness r around the surface. */
export function onion(d: number, r: number): number {
  return Math.abs(d) - r;
}
