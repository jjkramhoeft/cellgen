/**
 * Canvas 2D renderer with zoom & pan.
 *
 * - Polygon graphs: cells are batched into one Path2D per (quantised) colour in world
 *   coordinates; pan/zoom is just a transform, so redraws are cheap and crisp.
 * - Implicit cells and continuous fields: progressive per-pixel raster for the
 *   current viewport (exact at every zoom level).
 * - Overlays (edges, coast, rivers, colonization network, drainage, plates …) are
 *   cached Path2D objects; points and labels are drawn in screen space with culling.
 */
import { WATER_LAND, WATER_OCEAN } from '../gen/hydrology';
import type { World } from '../gen/pipeline';
import { bool, num, str, type Params } from '../params/schema';
import { camEqual, fitCamera, visibleRect, type Camera, type Viewport } from '@shared/render/camera';
import { colorize, RASTER_FIELDS, type Colorization, type Legend } from './colorize';
import { cssRgb, hsl } from '@shared/render/colormaps';
import { RasterLayer, type RasterSource } from '@shared/render/raster';
import { implicitSource, maskSource, noiseSource, pathSource, worleySource } from './sources';

interface Bucket {
  style: string;
  path: Path2D;
}
interface WidthBucket {
  width: number;
  color: string;
  path: Path2D;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  dpr = 1;
  vp: Viewport = { w: 1, h: 1 };
  cam: Camera = { cx: 0, cy: 0, zoom: 1 };
  world: World | null = null;
  view: Params = {};
  colors: Colorization | null = null;
  legend: Legend | null = null;
  hover = -1;
  selected = -1;
  /** world-space cursor for the inspector */
  cursor: [number, number] | null = null;
  onFrame: (() => void) | null = null;

  private colorKey = '';
  private worldVersion = 0;
  private buckets: Bucket[] = [];
  private edgePath: Path2D | null = null;
  private coastPath: Path2D | null = null;
  private plateBuckets: Bucket[] = [];
  private adjPath: Path2D | null = null;
  private drainPath: Path2D | null = null;
  private latticePath: Path2D | null = null;
  private riverBuckets: WidthBucket[] = [];
  private scaBuckets: WidthBucket[] = [];
  private plateArrows: { x: number; y: number; vx: number; vy: number }[] = [];
  private base = new RasterLayer();
  private overlay = new RasterLayer();
  private baseSrc: RasterSource | null = null;
  private overlaySrc: RasterSource | null = null;
  rasterInfo: { label: string; minLabel: string; maxLabel: string; colormap: (t: number) => [number, number, number]; note?: string } | null = null;
  overview: HTMLCanvasElement = document.createElement('canvas');
  private rasterIdleAt = 0;
  private dirty = true;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  // ------------------------------------------------------------------ setup
  resize(w: number, h: number, dpr: number): void {
    this.vp = { w, h };
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    if (this.autoFit && this.world) this.fit();
    this.rasterIdleAt = performance.now() + 100;
    this.requestDraw();
  }

  /** true until the user moves the camera: keeps the map fitted while the layout settles */
  autoFit = true;

  fit(): void {
    if (!this.world) return;
    this.autoFit = true;
    this.cam = fitCamera(this.world.graph.W, this.world.graph.H, this.vp);
    this.requestDraw();
  }

  zoomLimits(): [number, number] {
    if (!this.world) return [1e-3, 1e3];
    const fit = fitCamera(this.world.graph.W, this.world.graph.H, this.vp).zoom;
    // allow zooming until a cell spans ~ 2/3 of the screen
    const maxZ = Math.max(fit * 8, (Math.min(this.vp.w, this.vp.h) * 0.7) / this.world.graph.spacing);
    return [fit * 0.4, maxZ];
  }

  setCamera(c: Camera, immediate = false): void {
    if (camEqual(c, this.cam)) return;
    this.cam = c;
    this.autoFit = false;
    this.rasterIdleAt = performance.now() + (immediate ? 0 : 140);
    this.requestDraw();
  }

  setWorld(world: World, keepCamera: boolean): void {
    const sameDims = this.world && this.world.graph.W === world.graph.W && this.world.graph.H === world.graph.H;
    this.world = world;
    this.worldVersion++;
    if (!keepCamera || !sameDims || this.autoFit) {
      this.cam = fitCamera(world.graph.W, world.graph.H, this.vp);
      this.autoFit = true;
    }
    if (this.hover >= world.graph.n) this.hover = -1;
    if (this.selected >= world.graph.n) this.selected = -1;
    this.buildGeometry();
    this.recolor();
  }

  setView(view: Params): void {
    const prev = this.view;
    this.view = { ...view };
    if (!this.world) return;
    const changed = (k: string) => prev[k] !== view[k];
    if (changed('view.field') || changed('view.hillshade')) this.recolor();
    else if (changed('view.edges') || changed('view.coast') || changed('view.quality') || changed('view.pathExact')) this.updateSources();
    if (changed('view.riverWidth')) this.buildGeometry();
    this.requestDraw();
  }

  // ------------------------------------------------------------------ caches
  private recolor(): void {
    const w = this.world!;
    const field = str(this.view, 'view.field');
    this.colors = colorize(w, field, bool(this.view, 'view.hillshade'));
    this.legend = this.colors.legend;
    this.colorKey = `${this.worldVersion}|${field}|${bool(this.view, 'view.hillshade')}`;
    this.buildBuckets();
    this.updateSources();
  }

  private updateSources(): void {
    const w = this.world!;
    const field = str(this.view, 'view.field');
    this.rasterInfo = null;
    this.baseSrc = null;
    if (RASTER_FIELDS.has(field)) {
      if (field === 'maskSdf') {
        const ms = maskSource(w, w.params);
        if (ms) {
          this.baseSrc = ms.src;
          this.rasterInfo = ms.info;
        } else {
          this.rasterInfo = {
            label: 'Island mask SDF',
            minLabel: '',
            maxLabel: '',
            colormap: () => [128, 128, 128],
            note: 'Island mask is set to None. Pick a mask shape under Elevation.',
          };
        }
      } else if (field === 'noiseRaw') {
        const ns = noiseSource(w, w.params);
        if (ns) {
          this.baseSrc = ns.src;
          this.rasterInfo = ns.info;
        } else {
          this.rasterInfo = {
            label: 'Continuous elevation',
            minLabel: '',
            maxLabel: '',
            colormap: () => [128, 128, 128],
            note: 'Only noise-based elevation methods (fBm, ridged, warp) have a continuous function. Showing cells.',
          };
        }
      } else {
        const ws = worleySource(w, field);
        this.baseSrc = ws.src;
        this.rasterInfo = ws.info;
      }
    } else if (!w.graph.poly && this.colors) {
      this.baseSrc = implicitSource(w, this.colors.u32, this.colorKey, bool(this.view, 'view.edges'), bool(this.view, 'view.coast'));
    }
    this.overlaySrc = bool(this.view, 'view.pathExact') ? pathSource(w, w.params) : null;
    if (!this.baseSrc) this.base.clear();
    if (!this.overlaySrc) this.overlay.clear();
    this.rasterIdleAt = 0;
    this.renderOverview();
    this.requestDraw();
  }

  private buildBuckets(): void {
    const w = this.world!;
    const g = w.graph;
    this.buckets = [];
    if (!g.poly || !this.colors) return;
    const { off, xy } = g.poly;
    const rgb = this.colors.rgb;
    const map = new Map<number, Path2D>();
    for (let i = 0; i < g.n; i++) {
      const o = off[i];
      const m = off[i + 1] - o;
      if (m < 3) continue;
      // quantise to 6 bits per channel to keep the number of fills small
      const key = ((rgb[3 * i] >> 2) << 12) | ((rgb[3 * i + 1] >> 2) << 6) | (rgb[3 * i + 2] >> 2);
      let path = map.get(key);
      if (!path) {
        path = new Path2D();
        map.set(key, path);
      }
      path.moveTo(xy[2 * o], xy[2 * o + 1]);
      for (let k = 1; k < m; k++) path.lineTo(xy[2 * (o + k)], xy[2 * (o + k) + 1]);
      path.closePath();
    }
    for (const [key, path] of map) {
      const r = ((key >> 12) & 63) * 4 + 2;
      const gg = ((key >> 6) & 63) * 4 + 2;
      const b = (key & 63) * 4 + 2;
      this.buckets.push({ style: `rgb(${r},${gg},${b})`, path });
    }
  }

  private buildGeometry(): void {
    const w = this.world!;
    const g = w.graph;
    const n = g.n;
    // polygon edges, coastline, plate boundaries
    this.edgePath = null;
    this.coastPath = null;
    this.plateBuckets = [];
    if (g.poly) {
      const { off, xy, lbl } = g.poly;
      const edges = new Path2D();
      const coast = new Path2D();
      const plateP = [new Path2D(), new Path2D(), new Path2D()];
      const pid = w.plates?.plateId;
      const isWater = (i: number) => w.water[i] !== WATER_LAND;
      for (let i = 0; i < n; i++) {
        const o = off[i];
        const m = off[i + 1] - o;
        for (let k = 0; k < m; k++) {
          const j = lbl[o + k];
          const a = o + k;
          const b = o + ((k + 1) % m);
          const ax = xy[2 * a];
          const ay = xy[2 * a + 1];
          const bx = xy[2 * b];
          const by = xy[2 * b + 1];
          if (j < 0 || j > i) {
            edges.moveTo(ax, ay);
            edges.lineTo(bx, by);
          }
          if (j > i && isWater(i) !== isWater(j)) {
            coast.moveTo(ax, ay);
            coast.lineTo(bx, by);
          }
          if (pid && j > i && pid[i] !== pid[j]) {
            const t = w.plates!.boundary[i] || w.plates!.boundary[j];
            const path = plateP[t === 1 ? 0 : t === 2 ? 1 : 2];
            path.moveTo(ax, ay);
            path.lineTo(bx, by);
          }
        }
      }
      this.edgePath = edges;
      this.coastPath = coast;
      if (pid) {
        this.plateBuckets = [
          { style: '#ff5a4f', path: plateP[0] },
          { style: '#4fd2ff', path: plateP[1] },
          { style: '#ffe14f', path: plateP[2] },
        ];
      }
    }
    // plate velocity arrows at plate centroids
    this.plateArrows = [];
    if (w.plates) {
      const K = w.plates.plates.length;
      const sx = new Float64Array(K);
      const sy = new Float64Array(K);
      const c = new Float64Array(K);
      for (let i = 0; i < n; i++) {
        const p = w.plates.plateId[i];
        sx[p] += g.x[i];
        sy[p] += g.y[i];
        c[p]++;
      }
      for (let k = 0; k < K; k++) {
        if (c[k] === 0) continue;
        this.plateArrows.push({ x: sx[k] / c[k], y: sy[k] / c[k], vx: w.plates.plates[k].vx, vy: w.plates.plates[k].vy });
      }
    }
    // adjacency (dual graph) between sites
    const adj = new Path2D();
    const px = g.kind === 'voronoi' || g.kind === 'implicit' ? g.sx : g.x;
    const py = g.kind === 'voronoi' || g.kind === 'implicit' ? g.sy : g.y;
    for (let i = 0; i < n; i++) {
      for (let k = g.nbrOff[i]; k < g.nbrOff[i + 1]; k++) {
        const j = g.nbr[k];
        if (j <= i) continue;
        adj.moveTo(px[i], py[i]);
        adj.lineTo(px[j], py[j]);
      }
    }
    this.adjPath = adj;
    // drainage arrows
    this.drainPath = null;
    if (w.drainage) {
      const d = new Path2D();
      const ah = g.spacing * 0.18;
      for (let i = 0; i < n; i++) {
        const j = w.drainage.downhill[i];
        if (j < 0 || w.water[i] === WATER_OCEAN) continue;
        const x0 = g.x[i];
        const y0 = g.y[i];
        const x1 = x0 + (g.x[j] - x0) * 0.62;
        const y1 = y0 + (g.y[j] - y0) * 0.62;
        d.moveTo(x0, y0);
        d.lineTo(x1, y1);
        const dx = x1 - x0;
        const dy = y1 - y0;
        const L = Math.hypot(dx, dy) || 1;
        const ux = dx / L;
        const uy = dy / L;
        d.moveTo(x1 - ux * ah - uy * ah * 0.6, y1 - uy * ah + ux * ah * 0.6);
        d.lineTo(x1, y1);
        d.lineTo(x1 - ux * ah + uy * ah * 0.6, y1 - uy * ah - ux * ah * 0.6);
      }
      this.drainPath = d;
    }
    // sampling lattice
    this.latticePath = null;
    if (g.lattice) {
      const L = g.lattice;
      const p = new Path2D();
      if (L.kind === 'square') {
        for (let c = 0; c <= L.cols; c++) {
          p.moveTo(c * L.dx, 0);
          p.lineTo(c * L.dx, L.rows * L.dy);
        }
        for (let r = 0; r <= L.rows; r++) {
          p.moveTo(0, r * L.dy);
          p.lineTo(L.cols * L.dx, r * L.dy);
        }
      } else {
        for (let r = 0; r < L.rows; r++) {
          p.moveTo(0, r * L.dy);
          p.lineTo(g.W, r * L.dy);
          const off = r % 2 === 0 ? 0.25 : 0.75;
          for (let c = 0; c <= L.cols; c++) {
            const x = (c + off - 0.5) * L.dx;
            if (x < 0 || x > g.W) continue;
            p.moveTo(x, r * L.dy);
            p.lineTo(x, (r + 1) * L.dy);
          }
        }
      }
      this.latticePath = p;
    }
    this.buildRivers();
    this.buildSca();
  }

  private buildRivers(): void {
    const w = this.world!;
    const g = w.graph;
    this.riverBuckets = [];
    if (!w.rivers || !w.drainage) return;
    const rw = num(this.view, 'view.riverWidth') || 1;
    const thr = w.rivers.threshold || 1;
    const widthOf = (f: number) => rw * g.spacing * 0.07 * (1 + 0.6 * Math.log2(1 + f / thr));
    const map = new Map<number, Path2D>();
    const bucketW = (wd: number) => Math.round(Math.log2(wd) * 6);
    const add = (wd: number, fn: (p: Path2D) => void) => {
      const k = bucketW(wd);
      let p = map.get(k);
      if (!p) {
        p = new Path2D();
        map.set(k, p);
      }
      fn(p);
    };
    for (const chain of w.rivers.chains) {
      if (chain.length < 2) continue;
      const xs: number[] = [];
      const ys: number[] = [];
      const ws: number[] = [];
      for (let k = 0; k < chain.length; k++) {
        const c = chain[k];
        let x = g.x[c];
        let y = g.y[c];
        if (k === chain.length - 1 && w.water[c] !== WATER_LAND) {
          // end the river at the shoreline: midpoint toward the water cell
          const pc = chain[k - 1];
          x = (x + g.x[pc]) / 2;
          y = (y + g.y[pc]) / 2;
        }
        xs.push(x);
        ys.push(y);
        if (k < chain.length - 1) ws.push(widthOf(w.drainage.flux[c]));
      }
      const m = xs.length;
      // smooth with quadratic curves through midpoints
      for (let k = 0; k < m - 1; k++) {
        const sx = k === 0 ? xs[0] : (xs[k - 1] + xs[k]) / 2;
        const sy = k === 0 ? ys[0] : (ys[k - 1] + ys[k]) / 2;
        const ex = k === m - 2 ? xs[m - 1] : (xs[k] + xs[k + 1]) / 2;
        const ey = k === m - 2 ? ys[m - 1] : (ys[k] + ys[k + 1]) / 2;
        add(ws[k], (p) => {
          p.moveTo(sx, sy);
          if (k === 0) p.lineTo(ex, ey);
          else p.quadraticCurveTo(xs[k], ys[k], ex, ey);
        });
      }
    }
    for (const [k, path] of Array.from(map.entries()).sort((a, b) => a[0] - b[0])) {
      this.riverBuckets.push({ width: Math.pow(2, k / 6), color: '#3d8fd6', path });
    }
  }

  private buildSca(): void {
    const w = this.world!;
    const g = w.graph;
    this.scaBuckets = [];
    const s = w.sca;
    if (!s) return;
    const rw = num(this.view, 'view.riverWidth') || 1;
    const map = new Map<string, { width: number; order: number; path: Path2D }>();
    for (let k = 0; k < s.count; k++) {
      const par = s.parent[k];
      if (par < 0) continue;
      const width = rw * g.spacing * 0.08 * (1 + 0.9 * Math.log2(s.radius[k]));
      const wb = Math.round(Math.log2(width) * 5);
      const key = `${s.order[k]}|${wb}`;
      let e = map.get(key);
      if (!e) {
        e = { width: Math.pow(2, wb / 5), order: s.order[k], path: new Path2D() };
        map.set(key, e);
      }
      e.path.moveTo(s.nx[par], s.ny[par]);
      e.path.lineTo(s.nx[k], s.ny[k]);
    }
    const maxO = Math.max(1, s.maxOrder);
    for (const e of Array.from(map.values()).sort((a, b) => a.order - b.order || a.width - b.width)) {
      const t = maxO === 1 ? 1 : (e.order - 1) / (maxO - 1);
      const c = hsl(0.56 + 0.04 * t, 0.9, 0.6 - 0.2 * t);
      this.scaBuckets.push({ width: e.width, color: cssRgb(c), path: e.path });
    }
  }

  /** Low-res image of the whole world (minimap + fallback while raster layers render). */
  private renderOverview(): void {
    const w = this.world;
    if (!w) return;
    const g = w.graph;
    const OW = 480;
    const OH = Math.round((OW * g.H) / g.W);
    const cv = this.overview;
    cv.width = OW;
    cv.height = OH;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#10141a';
    ctx.fillRect(0, 0, OW, OH);
    const s = OW / g.W;
    if (this.baseSrc && RASTER_FIELDS.has(str(this.view, 'view.field'))) {
      // raster fields: evaluate at a coarse resolution
      const cols = 160;
      const rows = Math.round((cols * g.H) / g.W);
      const img = ctx.createImageData(cols, rows);
      const u = new Uint32Array(img.data.buffer);
      const fn = this.baseSrc.create();
      const dx = g.W / cols;
      const dy = g.H / rows;
      for (let r = 0; r < rows; r++) fn(r, (r + 0.5) * dy, dx / 2, dx, cols, u, r * cols);
      const tmp = document.createElement('canvas');
      tmp.width = cols;
      tmp.height = rows;
      tmp.getContext('2d')!.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tmp, 0, 0, OW, OH);
    } else if (g.raster && this.colors) {
      const { cols, rows, ids } = g.raster;
      const img = ctx.createImageData(cols, rows);
      const u = new Uint32Array(img.data.buffer);
      for (let k = 0; k < ids.length; k++) u[k] = this.colors.u32[ids[k]];
      const tmp = document.createElement('canvas');
      tmp.width = cols;
      tmp.height = rows;
      tmp.getContext('2d')!.putImageData(img, 0, 0);
      ctx.drawImage(tmp, 0, 0, OW, OH);
    } else {
      ctx.setTransform(s, 0, 0, s, 0, 0);
      for (const b of this.buckets) {
        ctx.fillStyle = b.style;
        ctx.fill(b.path);
        ctx.strokeStyle = b.style;
        ctx.lineWidth = 1 / s;
        ctx.stroke(b.path);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  // ------------------------------------------------------------------ loop
  requestDraw(): void {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  get busy(): boolean {
    return this.base.busy || this.overlay.busy;
  }

  /** progress of the slowest running raster job, or null when idle */
  get rasterProgress(): number | null {
    if (!this.busy) return null;
    return Math.min(this.base.progress, this.overlay.progress);
  }

  private frame(): void {
    this.raf = 0;
    const now = performance.now();
    const scale = (Number(str(this.view, 'view.quality')) || 1) * (str(this.view, 'view.quality') === '2' ? this.dpr / 2 : 1);
    let more = false;
    let finished = false;
    if (this.world) {
      for (const [layer, src] of [
        [this.base, this.baseSrc],
        [this.overlay, this.overlaySrc],
      ] as const) {
        if (!src) continue;
        if (!layer.isCurrent(src, this.cam, this.vp, scale)) {
          const fresh = !layer.hasContentFor(src.key);
          const job = layer.jobInfo;
          if (fresh && (!job || job.key !== src.key)) {
            // new content: a quick low-resolution pass first, the full pass follows
            layer.start(src, this.cam, this.vp, Math.min(scale, 0.25));
          } else if (now >= this.rasterIdleAt && !(job && job.key === src.key && job.scale < scale)) {
            layer.start(src, this.cam, this.vp, scale);
          } else more = true;
        }
        if (layer.busy) {
          // larger slices when nothing else needs the frame
          const done = !layer.step(performance.now() + (this.dirty ? 10 : 24));
          if (done) finished = true;
          more = true;
        }
      }
    }
    // While rasters progress, redraw the (possibly heavy) vector scene only a few
    // times per second; always redraw when something changed or a pass finished.
    if (this.dirty || finished || (more && now - this.lastDraw > 160)) {
      this.draw();
      this.lastDraw = now;
      this.dirty = false;
      this.onFrame?.();
    }
    if (more) this.raf = requestAnimationFrame(() => this.frame());
  }
  private lastDraw = 0;

  // ------------------------------------------------------------------ drawing
  private setWorldTransform(): void {
    const { cam, vp, dpr } = this;
    this.ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * (vp.w / 2 - cam.cx * cam.zoom), dpr * (vp.h / 2 - cam.cy * cam.zoom));
  }

  private draw(): void {
    const ctx = this.ctx;
    const { cam, vp, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0e13';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const w = this.world;
    if (!w) return;
    const g = w.graph;
    const v = this.view;
    const px = 1 / cam.zoom; // one CSS pixel in world units
    const cellPx = g.spacing * cam.zoom;

    // map background + fallback overview for raster modes
    this.setWorldTransform();
    ctx.fillStyle = '#151a22';
    ctx.fillRect(0, 0, g.W, g.H);
    if (this.baseSrc) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.overview, 0, 0, g.W, g.H);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.base.draw(ctx, cam, vp, dpr, this.baseSrc.key, false);
      this.setWorldTransform();
    } else {
      // vector cells
      const seam = !bool(v, 'view.edges');
      ctx.lineWidth = px * 0.9;
      ctx.lineJoin = 'round';
      for (const b of this.buckets) {
        ctx.fillStyle = b.style;
        ctx.fill(b.path);
        if (seam) {
          ctx.strokeStyle = b.style;
          ctx.stroke(b.path);
        }
      }
    }

    // edges
    if (bool(v, 'view.edges') && this.edgePath && !RASTER_FIELDS.has(str(v, 'view.field'))) {
      const a = Math.max(0, Math.min(0.55, (cellPx - 2.5) / 14));
      if (a > 0.01) {
        ctx.strokeStyle = `rgba(10,14,20,${a})`;
        ctx.lineWidth = px;
        ctx.stroke(this.edgePath);
      }
    } else if (bool(v, 'view.edges') && this.edgePath && RASTER_FIELDS.has(str(v, 'view.field'))) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = px;
      ctx.stroke(this.edgePath);
    }
    if (bool(v, 'view.lattice') && this.latticePath) {
      ctx.strokeStyle = 'rgba(255,120,200,0.55)';
      ctx.lineWidth = px;
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.stroke(this.latticePath);
      ctx.setLineDash([]);
    }
    if (bool(v, 'view.adjacency') && this.adjPath) {
      ctx.strokeStyle = 'rgba(255,214,102,0.7)';
      ctx.lineWidth = px;
      ctx.stroke(this.adjPath);
    }
    if (bool(v, 'view.coast') && this.coastPath) {
      ctx.strokeStyle = 'rgba(12,18,30,0.9)';
      ctx.lineWidth = Math.max(px * 1.6, g.spacing * 0.04);
      ctx.lineJoin = 'round';
      ctx.stroke(this.coastPath);
    }
    if (bool(v, 'view.plates')) {
      ctx.lineWidth = Math.max(px * 2, g.spacing * 0.06);
      for (const b of this.plateBuckets) {
        ctx.strokeStyle = b.style;
        ctx.stroke(b.path);
      }
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (bool(v, 'view.rivers')) {
      for (const b of this.riverBuckets) {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = Math.max(b.width, px * 0.8);
        ctx.stroke(b.path);
      }
    }
    if (bool(v, 'view.drainage') && this.drainPath) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = px;
      ctx.lineCap = 'butt';
      ctx.stroke(this.drainPath);
      ctx.lineCap = 'round';
    }
    if (bool(v, 'view.sca')) {
      for (const b of this.scaBuckets) {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = Math.max(b.width, px * 1.3);
        ctx.stroke(b.path);
      }
    }
    ctx.lineCap = 'butt';

    // network cells overlay (when not already the coloured field)
    if (bool(v, 'view.pathCells') && w.paths && str(v, 'view.field') !== 'paths') {
      // small markers keep the base field visible underneath
      ctx.fillStyle = 'rgba(255,190,80,0.85)';
      const r = g.spacing * 0.22;
      ctx.beginPath();
      for (let i = 0; i < g.n; i++) {
        if (!w.paths.cells[i]) continue;
        ctx.moveTo(g.x[i] + r, g.y[i]);
        ctx.arc(g.x[i], g.y[i], r, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // map frame
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = px;
    ctx.strokeRect(0, 0, g.W, g.H);

    // exact network raster overlay
    if (this.overlaySrc) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.overlay.draw(ctx, cam, vp, dpr, this.overlaySrc.key, true);
    }

    // ------------------------------------------------ screen-space layers
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const [x0, y0, x1, y1] = visibleRect(cam, vp);
    const pad = g.spacing;
    const inView = (x: number, y: number) => x >= x0 - pad && x <= x1 + pad && y >= y0 - pad && y <= y1 + pad;
    const sx = (x: number) => (x - cam.cx) * cam.zoom + vp.w / 2;
    const sy = (y: number) => (y - cam.cy) * cam.zoom + vp.h / 2;

    if (bool(v, 'view.scaPoints') && w.sca) {
      const s = w.sca;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      for (let a = 0; a < s.ax.length; a++) if (!s.killed[a] && inView(s.ax[a], s.ay[a])) ctx.rect(sx(s.ax[a]) - 1.5, sy(s.ay[a]) - 1.5, 3, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,120,120,0.45)';
      ctx.beginPath();
      for (let a = 0; a < s.ax.length; a++) if (s.killed[a] && inView(s.ax[a], s.ay[a])) ctx.rect(sx(s.ax[a]) - 1, sy(s.ay[a]) - 1, 2, 2);
      ctx.fill();
    }
    if (bool(v, 'view.corners') && g.poly) {
      const { off, xy } = g.poly;
      ctx.fillStyle = 'rgba(120,255,200,0.9)';
      ctx.beginPath();
      const rr = cellPx > 12 ? 2 : 1;
      for (let k = 0; k < off[g.n]; k++) {
        const x = xy[2 * k];
        const y = xy[2 * k + 1];
        if (inView(x, y)) ctx.rect(sx(x) - rr, sy(y) - rr, 2 * rr, 2 * rr);
      }
      ctx.fill();
    }
    if (bool(v, 'view.centroids')) {
      ctx.fillStyle = 'rgba(80,200,255,0.95)';
      ctx.beginPath();
      const rr = cellPx > 12 ? 2 : 1;
      for (let i = 0; i < g.n; i++) if (inView(g.x[i], g.y[i])) ctx.rect(sx(g.x[i]) - rr, sy(g.y[i]) - rr, 2 * rr, 2 * rr);
      ctx.fill();
    }
    if (bool(v, 'view.sites')) {
      ctx.fillStyle = 'rgba(255,60,90,0.95)';
      ctx.beginPath();
      const rr = cellPx > 12 ? 2.5 : 1.2;
      for (let i = 0; i < g.n; i++) {
        if (!inView(g.sx[i], g.sy[i])) continue;
        ctx.moveTo(sx(g.sx[i]) + rr, sy(g.sy[i]));
        ctx.arc(sx(g.sx[i]), sy(g.sy[i]), rr, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    if (bool(v, 'view.plates') && this.plateArrows.length) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      for (const a of this.plateArrows) {
        const X = sx(a.x);
        const Y = sy(a.y);
        const L = 26;
        const ex = X + a.vx * L;
        const ey = Y + a.vy * L;
        ctx.beginPath();
        ctx.moveTo(X, Y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        const ang = Math.atan2(a.vy, a.vx);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - 7 * Math.cos(ang - 0.45), ey - 7 * Math.sin(ang - 0.45));
        ctx.lineTo(ex - 7 * Math.cos(ang + 0.45), ey - 7 * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(X, Y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // labels
    if (bool(v, 'view.labels') && cellPx > 46) {
      const field = w.fields[str(v, 'view.field')] ?? w.fields.elevation;
      const fmt = field.kind === 'category' && field.categories ? (x: number) => field.categories![x]?.label ?? String(x) : field.format ?? ((x: number) => String(x));
      ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let drawn = 0;
      for (let i = 0; i < g.n && drawn < 2500; i++) {
        if (!inView(g.x[i], g.y[i])) continue;
        const X = sx(g.x[i]);
        const Y = sy(g.y[i]);
        const idOnly = field.id === 'cellId' || RASTER_FIELDS.has(str(v, 'view.field'));
        const txt = idOnly ? `#${i}` : fmt(field.values[i] as number);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.fillStyle = '#fff';
        const t1 = cellPx > 80 && !idOnly ? `#${i}` : '';
        if (t1) {
          ctx.font = '500 9px ui-monospace, monospace';
          ctx.strokeText(t1, X, Y - 7);
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.fillText(t1, X, Y - 7);
          ctx.font = '600 10px ui-monospace, monospace';
          ctx.fillStyle = '#fff';
        }
        ctx.strokeText(txt, X, t1 ? Y + 6 : Y);
        ctx.fillText(txt, X, t1 ? Y + 6 : Y);
        drawn++;
      }
    }

    // hover & selection
    const outline = (i: number, color: string, width: number) => {
      if (i < 0 || i >= g.n) return;
      if (g.poly) {
        const { off, xy } = g.poly;
        const o = off[i];
        const m = off[i + 1] - o;
        if (m < 3) return;
        ctx.beginPath();
        ctx.moveTo(sx(xy[2 * o]), sy(xy[2 * o + 1]));
        for (let k = 1; k < m; k++) ctx.lineTo(sx(xy[2 * (o + k)]), sy(xy[2 * (o + k) + 1]));
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(sx(g.sx[i]), sy(g.sy[i]), Math.max(4, Math.min(14, cellPx * 0.2)), 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
      }
    };
    if (this.selected >= 0) {
      const i = this.selected;
      ctx.strokeStyle = 'rgba(255,214,102,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const ox = g.poly ? g.x : g.sx;
      const oy = g.poly ? g.y : g.sy;
      for (let k = g.nbrOff[i]; k < g.nbrOff[i + 1]; k++) {
        const j = g.nbr[k];
        ctx.moveTo(sx(ox[i]), sy(oy[i]));
        ctx.lineTo(sx(ox[j]), sy(oy[j]));
      }
      ctx.stroke();
      for (let k = g.nbrOff[i]; k < g.nbrOff[i + 1]; k++) outline(g.nbr[k], 'rgba(255,214,102,0.85)', 1.5);
      outline(i, '#ffd666', 3);
    }
    if (this.hover >= 0 && this.hover !== this.selected) outline(this.hover, 'rgba(255,255,255,0.95)', 2);
  }
}
