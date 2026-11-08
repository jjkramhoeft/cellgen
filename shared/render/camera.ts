/** 2D camera: world centre + zoom (CSS pixels per world unit). */
export interface Camera {
  cx: number;
  cy: number;
  zoom: number;
}

export interface Viewport {
  /** CSS pixel size of the canvas */
  w: number;
  h: number;
}

export function screenToWorld(c: Camera, v: Viewport, sx: number, sy: number): [number, number] {
  return [(sx - v.w / 2) / c.zoom + c.cx, (sy - v.h / 2) / c.zoom + c.cy];
}

/** Zoom by a factor while keeping the world point under (sx, sy) fixed. */
export function zoomAt(c: Camera, v: Viewport, sx: number, sy: number, factor: number, minZ: number, maxZ: number): Camera {
  const z = Math.min(maxZ, Math.max(minZ, c.zoom * factor));
  const [wx, wy] = screenToWorld(c, v, sx, sy);
  return { zoom: z, cx: wx - (sx - v.w / 2) / z, cy: wy - (sy - v.h / 2) / z };
}

export function fitCamera(W: number, H: number, v: Viewport, margin = 0.94): Camera {
  const zoom = Math.min(v.w / W, v.h / H) * margin;
  return { cx: W / 2, cy: H / 2, zoom: Math.max(zoom, 1e-4) };
}

/** Visible world rectangle [x0, y0, x1, y1]. */
export function visibleRect(c: Camera, v: Viewport): [number, number, number, number] {
  const [x0, y0] = screenToWorld(c, v, 0, 0);
  const [x1, y1] = screenToWorld(c, v, v.w, v.h);
  return [x0, y0, x1, y1];
}

export function camEqual(a: Camera | null, b: Camera | null): boolean {
  return !!a && !!b && a.cx === b.cx && a.cy === b.cy && a.zoom === b.zoom;
}
