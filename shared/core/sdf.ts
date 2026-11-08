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
