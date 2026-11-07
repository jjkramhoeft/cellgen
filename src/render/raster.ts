/**
 * Progressive per-pixel raster layer for stateless fields (implicit cells, Worley,
 * continuous noise). Rendering is sliced across animation frames with a time budget
 * so the UI stays responsive; while a new image is in progress the previous one is
 * drawn re-projected to the current camera.
 */
import type { Camera, Viewport } from './camera';

/** Renders one pixel row. Called top-to-bottom; instances may keep per-row state. */
export type RowFn = (py: number, wy: number, wx0: number, dwx: number, cols: number, out: Uint32Array, off: number) => void;

export interface RasterSource {
  /** content identity — a different key forces a re-render */
  key: string;
  create(): RowFn;
}

interface Snap {
  cam: Camera;
  vp: Viewport;
  /** device pixels per CSS pixel used for this image */
  scale: number;
}

interface Job {
  src: RasterSource;
  snap: Snap;
  cols: number;
  rows: number;
  row: number;
  img: ImageData;
  u32: Uint32Array;
  fn: RowFn;
}

export class RasterLayer {
  private front = document.createElement('canvas');
  private back = document.createElement('canvas');
  private frontSnap: Snap | null = null;
  private frontKey = '';
  private job: Job | null = null;
  /** rows of the in-progress job already blitted to `back` */
  private backRows = 0;

  get busy(): boolean {
    return this.job !== null;
  }

  /** key and scale of the running job */
  get jobInfo(): { key: string; scale: number } | null {
    return this.job ? { key: this.job.src.key, scale: this.job.snap.scale } : null;
  }

  /** fraction of the running job done (1 when idle) */
  get progress(): number {
    return this.job ? this.job.row / this.job.rows : 1;
  }

  clear(): void {
    this.job = null;
    this.frontSnap = null;
    this.frontKey = '';
  }

  /** Is the current image (or the running job) already for this source + camera? */
  isCurrent(src: RasterSource, cam: Camera, vp: Viewport, scale: number): boolean {
    const same = (s: Snap | null) =>
      !!s && s.cam.cx === cam.cx && s.cam.cy === cam.cy && s.cam.zoom === cam.zoom && s.vp.w === vp.w && s.vp.h === vp.h && s.scale === scale;
    if (this.job) return this.job.src.key === src.key && same(this.job.snap);
    return this.frontKey === src.key && same(this.frontSnap);
  }

  hasContentFor(key: string): boolean {
    return this.frontKey === key;
  }

  start(src: RasterSource, cam: Camera, vp: Viewport, scale: number): void {
    const cols = Math.max(1, Math.round(vp.w * scale));
    const rows = Math.max(1, Math.round(vp.h * scale));
    if (this.back.width !== cols || this.back.height !== rows) {
      this.back.width = cols;
      this.back.height = rows;
    }
    const ctx = this.back.getContext('2d')!;
    const img = ctx.createImageData(cols, rows);
    this.job = {
      src,
      snap: { cam: { ...cam }, vp: { ...vp }, scale },
      cols,
      rows,
      row: 0,
      img,
      u32: new Uint32Array(img.data.buffer),
      fn: src.create(),
    };
    this.backRows = 0;
  }

  /** Render rows until the deadline. Returns true when there is still work left. */
  step(deadline: number): boolean {
    const j = this.job;
    if (!j) return false;
    const { cam, vp } = j.snap;
    const dwx = vp.w / j.cols / cam.zoom;
    const dwy = vp.h / j.rows / cam.zoom;
    const wx0 = cam.cx - vp.w / 2 / cam.zoom + dwx / 2;
    const wy0 = cam.cy - vp.h / 2 / cam.zoom + dwy / 2;
    const startRow = j.row;
    while (j.row < j.rows) {
      j.fn(j.row, wy0 + j.row * dwy, wx0, dwx, j.cols, j.u32, j.row * j.cols);
      j.row++;
      if ((j.row & 3) === 0 && performance.now() > deadline) break;
    }
    const ctx = this.back.getContext('2d')!;
    if (j.row > startRow) ctx.putImageData(j.img, 0, 0, 0, startRow, j.cols, j.row - startRow);
    this.backRows = j.row;
    if (j.row >= j.rows) {
      // swap
      const t = this.front;
      this.front = this.back;
      this.back = t;
      this.frontSnap = j.snap;
      this.frontKey = j.src.key;
      this.job = null;
      this.backRows = 0;
      return false;
    }
    return true;
  }

  private drawSnap(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, snap: Snap, cam: Camera, vp: Viewport, dpr: number, rows?: number) {
    // world rect of the snapshot
    const sw = snap.vp.w / snap.cam.zoom;
    const sh = snap.vp.h / snap.cam.zoom;
    const wx0 = snap.cam.cx - sw / 2;
    const wy0 = snap.cam.cy - sh / 2;
    const dx = ((wx0 - cam.cx) * cam.zoom + vp.w / 2) * dpr;
    const dy = ((wy0 - cam.cy) * cam.zoom + vp.h / 2) * dpr;
    const dw = sw * cam.zoom * dpr;
    const dh = sh * cam.zoom * dpr;
    if (rows !== undefined) {
      if (rows <= 0) return;
      const frac = rows / canvas.height;
      ctx.drawImage(canvas, 0, 0, canvas.width, rows, dx, dy, dw, dh * frac);
    } else ctx.drawImage(canvas, dx, dy, dw, dh);
  }

  /** Draw into a context whose transform is identity in device pixels. */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, dpr: number, key: string, smooth: boolean): void {
    ctx.imageSmoothingEnabled = smooth;
    if (this.frontSnap && this.frontKey === key) this.drawSnap(ctx, this.front, this.frontSnap, cam, vp, dpr);
    if (this.job && this.job.src.key === key && this.backRows > 0) this.drawSnap(ctx, this.back, this.job.snap, cam, vp, dpr, this.backRows);
    ctx.imageSmoothingEnabled = true;
  }
}
