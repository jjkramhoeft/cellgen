/**
 * 3D landscape view (plain WebGL2, no dependencies): a height-field mesh over the
 * current 2D view, draped with the 2D map image (so rivers, borders and every colour
 * mode come along), lit from the north-west, with an orbit camera.
 *
 * Coordinates: x east and z south in km relative to the view centre, y up in km
 * (height × vertical exaggeration). The sea is drawn as a flat surface at 0.
 */

export interface HeightGrid {
  /** samples per row / column */
  cols: number;
  rows: number;
  /** world extent of the grid (metres) */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** heights in metres, row-major (NaN = unknown, drawn at sea level) */
  h: Float32Array;
}

export interface OrbitCam {
  /** rotation around the vertical axis and elevation angle, radians */
  yaw: number;
  pitch: number;
  /** distance from the target, as a fraction of the grid's width */
  dist: number;
  /** look-at point offset in the ground plane, km */
  tx: number;
  tz: number;
}

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
uniform mat4 uMvp;
out vec3 vNormal;
out vec2 vUv;
out float vH;
void main() {
  vNormal = aNormal;
  vUv = aUv;
  vH = aPos.y;
  gl_Position = uMvp * vec4(aPos, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec2 vUv;
in float vH;
uniform sampler2D uTex;
uniform vec3 uLight;
uniform float uHasTex;
out vec4 outColor;
void main() {
  vec3 base = uHasTex > 0.5 ? texture(uTex, vUv).rgb : vec3(0.55, 0.6, 0.5);
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, uLight), 0.0);
  float light = 0.42 + 0.78 * diff;
  outColor = vec4(base * light, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

// ------------------------------------------------------------------ tiny mat4 (column-major)

type M4 = Float32Array;
function perspective(fovy: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}
function lookAt(ex: number, ey: number, ez: number, cx: number, cy: number, cz: number): M4 {
  let zx = ex - cx;
  let zy = ey - cy;
  let zz = ez - cz;
  let l = Math.hypot(zx, zy, zz);
  zx /= l;
  zy /= l;
  zz /= l;
  // x = up × z, with up = (0, 1, 0)
  let xx = zz;
  let xy = 0;
  let xz = -zx;
  l = Math.hypot(xx, xy, xz) || 1;
  xx /= l;
  xy /= l;
  xz /= l;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx;
  m[1] = yx;
  m[2] = zx;
  m[4] = xy;
  m[5] = yy;
  m[6] = zy;
  m[8] = xz;
  m[9] = yz;
  m[10] = zz;
  m[12] = -(xx * ex + xy * ey + xz * ez);
  m[13] = -(yx * ex + yy * ey + yz * ez);
  m[14] = -(zx * ex + zy * ey + zz * ez);
  m[15] = 1;
  return m;
}
function mul(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

// ------------------------------------------------------------------ mesh

export interface Mesh {
  pos: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint32Array;
  /** grid width in km (for camera distance) */
  widthKm: number;
  /** highest vertex, km after exaggeration */
  topKm: number;
}

/** Height grid → vertices (km; sea clamped to a flat surface at 0) with smooth normals. */
export function buildMesh(g: HeightGrid, exag: number): Mesh {
  const { cols, rows } = g;
  const n = cols * rows;
  const pos = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const cxm = (g.x0 + g.x1) / 2;
  const cym = (g.y0 + g.y1) / 2;
  const dx = (g.x1 - g.x0) / (cols - 1);
  const dy = (g.y1 - g.y0) / (rows - 1);
  const hy = new Float32Array(n);
  let top = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const q = j * cols + i;
      const h = g.h[q];
      const y = (h === h && h > 0 ? h : 0) * exag * 0.001;
      hy[q] = y;
      if (y > top) top = y;
      pos[q * 3] = (g.x0 + i * dx - cxm) * 0.001;
      pos[q * 3 + 1] = y;
      pos[q * 3 + 2] = (g.y0 + j * dy - cym) * 0.001;
      uv[q * 2] = i / (cols - 1);
      uv[q * 2 + 1] = j / (rows - 1);
    }
  }
  const sx = dx * 0.001;
  const sz = dy * 0.001;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const q = j * cols + i;
      const l = hy[j * cols + Math.max(0, i - 1)];
      const r = hy[j * cols + Math.min(cols - 1, i + 1)];
      const u = hy[Math.max(0, j - 1) * cols + i];
      const d = hy[Math.min(rows - 1, j + 1) * cols + i];
      const nx = -(r - l) / (2 * sx);
      const nz = -(d - u) / (2 * sz);
      const len = Math.hypot(nx, 1, nz);
      normal[q * 3] = nx / len;
      normal[q * 3 + 1] = 1 / len;
      normal[q * 3 + 2] = nz / len;
    }
  }
  const index = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let k = 0;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      index[k++] = a;
      index[k++] = c;
      index[k++] = b;
      index[k++] = b;
      index[k++] = c;
      index[k++] = d;
    }
  }
  return { pos, normal, uv, index, widthKm: (g.x1 - g.x0) * 0.001, topKm: top };
}

// ------------------------------------------------------------------ view

export class View3D {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private bufs: WebGLBuffer[] = [];
  private tex: WebGLTexture | null = null;
  private hasTex = false;
  private count = 0;
  private mesh: Mesh | null = null;
  private raf = 0;
  cam: OrbitCam = { yaw: 0, pitch: 0.75, dist: 0.95, tx: 0, tz: 0 };
  /** called when the user pans (km east, km south) */
  onPan: ((dxKm: number, dzKm: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
    if (!this.gl) return;
    const gl = this.gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    this.vao = gl.createVertexArray();
    this.bufs = [gl.createBuffer()!, gl.createBuffer()!, gl.createBuffer()!, gl.createBuffer()!];
    this.tex = gl.createTexture();
    this.bindInput();
  }

  get supported(): boolean {
    return this.gl !== null;
  }

  /** Replace the mesh (and, when given, the draped map image). */
  setData(mesh: Mesh, image: TexImageSource | null): void {
    const gl = this.gl;
    if (!gl) return;
    this.mesh = mesh;
    gl.bindVertexArray(this.vao);
    const attr = (loc: number, buf: WebGLBuffer, data: Float32Array, size: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attr(0, this.bufs[0], mesh.pos, 3);
    attr(1, this.bufs[1], mesh.normal, 3);
    attr(2, this.bufs[2], mesh.uv, 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bufs[3]);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.index, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.count = mesh.index.length;
    if (image) {
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // keeps thin lines (rivers, borders) crisp on slopes seen at a grazing angle
      const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      this.hasTex = true;
    }
    this.requestDraw();
  }

  requestDraw(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.draw());
  }

  /** Model-view-projection for the current orbit camera. */
  matrix(): M4 {
    const w = this.canvas.width || 1;
    const h = this.canvas.height || 1;
    const m = this.mesh;
    const span = m ? m.widthKm : 100;
    const top = m ? m.topKm : 0;
    const c = this.cam;
    const d = span * c.dist;
    const ty = top * 0.25;
    const ex = c.tx + d * Math.cos(c.pitch) * Math.sin(c.yaw);
    const ez = c.tz + d * Math.cos(c.pitch) * Math.cos(c.yaw);
    const ey = ty + d * Math.sin(c.pitch);
    const proj = perspective((45 * Math.PI) / 180, w / h, Math.max(0.01, d / 200), d * 6 + span * 2);
    return mul(proj, lookAt(ex, ey, ez, c.tx, ty, c.tz));
  }

  draw(): void {
    this.raf = 0;
    const gl = this.gl;
    if (!gl || !this.prog) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.043, 0.055, 0.075, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.mesh) return;
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.prog, 'uMvp'), false, this.matrix());
    // light from the north-west (−x, −z), 45° up
    const l = Math.hypot(-1, 1.4, -1);
    gl.uniform3f(gl.getUniformLocation(this.prog, 'uLight'), -1 / l, 1.4 / l, -1 / l);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uHasTex'), this.hasTex ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uTex'), 0);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  private bindInput(): void {
    const cv = this.canvas;
    let drag: { x: number; y: number; pan: boolean } | null = null;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2 };
      cv.classList.add('dragging');
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.pan) {
        // drag the ground: screen motion → ground-plane km, rotated by the yaw
        const span = this.mesh ? this.mesh.widthKm : 100;
        const k = (span * this.cam.dist * 1.6) / Math.max(1, cv.clientHeight);
        const c = Math.cos(this.cam.yaw);
        const s = Math.sin(this.cam.yaw);
        const gx = -dx * k;
        const gz = -dy * k;
        this.onPan?.(gx * c + gz * s, -gx * s + gz * c);
      } else {
        this.cam.yaw -= dx * 0.006;
        this.cam.pitch = Math.min(1.55, Math.max(0.08, this.cam.pitch + dy * 0.005));
        this.requestDraw();
      }
    });
    const end = () => {
      drag = null;
      cv.classList.remove('dragging');
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        this.cam.dist = Math.min(4, Math.max(0.08, this.cam.dist * Math.exp(dy * 0.0012)));
        this.requestDraw();
      },
      { passive: false },
    );
  }
}
