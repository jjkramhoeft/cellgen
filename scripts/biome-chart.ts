/**
 * Draw sandbox4's `classify(t, p)` (sandboxes/sandbox4/src/world/biomes.ts) as a filled
 * temperature × precipitation chart, with the Whittaker biome outlines from `plotbiomes`
 * on top (scripts/data/plotbiomes-whittaker.json: Ricklefs 2008 Fig. 5.5, digitised).
 *
 * Fill = what the generator assigns. Outlines = Whittaker. Outside the Whittaker triangle
 * the fill is faded: those climates are rare on Earth, so the diagram says nothing there.
 *
 * Also measures agreement: for each Whittaker biome, the share of its area (on a 0.1 °C ×
 * 10 mm grid) that classify() puts in a matching sandbox4 biome (MATCH below).
 *
 * Run through scripts/biome-chart.mjs (`npm run biome-chart`), which loads this file with
 * Vite so the `@shared` alias resolves as it does in the app.
 */
import { BIOMES, type BiomeId, classify } from '../sandboxes/sandbox4/src/world/biomes';
import whittaker from './data/plotbiomes-whittaker.json';

type Pt = [number, number];

/** sandbox4 biomes that count as agreeing with each Whittaker biome. */
const MATCH: Record<string, BiomeId[]> = {
  Tundra: ['tundra'],
  'Boreal forest': ['taiga'],
  'Temperate grassland/desert': ['grassland', 'coldSteppe', 'coldDesert'],
  'Woodland/shrubland': ['shrubland'],
  'Temperate seasonal forest': ['mixedForest', 'broadleaf'],
  'Temperate rain forest': ['tempRainforest'],
  'Tropical rain forest': ['rainforest'],
  'Tropical seasonal forest/savanna': ['savanna', 'dryForest'],
  'Subtropical desert': ['hotDesert', 'thornScrub'],
};

/** Chart domain: °C and mm/yr. */
const T0 = -16;
const T1 = 32;
const P0 = 0;
const P1 = 4500;
/** Raster step. */
const DT = 0.1;
const DP = 10;

/** Layout (px). */
const W = 1120;
const H = 800;
const PX = 84;
const PY = 64;
const PW = 760;
const PH = 600;

const sx = (t: number) => PX + ((t - T0) / (T1 - T0)) * PW;
const sy = (p: number) => PY + PH - ((p - P0) / (P1 - P0)) * PH;
const f = (v: number) => +v.toFixed(2);
const hex = (rgb: readonly number[]) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function inside(poly: Pt[], t: number, p: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ti, pi] = poly[i];
    const [tj, pj] = poly[j];
    if (pi > p !== pj > p && t < ((tj - ti) * (p - pi)) / (pj - pi) + ti) c = !c;
  }
  return c;
}

/** Distance (px) from a point to the polygon's edges, in screen space. */
function edgeDistance(poly: Pt[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = sx(poly[j][0]);
    const ay = sy(poly[j][1]);
    const bx = sx(poly[i][0]);
    const by = sy(poly[i][1]);
    const dx = bx - ax;
    const dy = by - ay;
    const l = dx * dx + dy * dy;
    const u = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
    best = Math.min(best, Math.hypot(x - ax - u * dx, y - ay - u * dy));
  }
  return best;
}

export interface BiomeChart {
  svg: string;
  rows: { name: string; agree: number; top: string }[];
}

export function biomeChart(): BiomeChart {
  const polys = whittaker.biomes.map((b) => ({ name: b.name, ring: b.ring as Pt[] }));
  const nt = Math.round((T1 - T0) / DT);
  const np = Math.round((P1 - P0) / DP);

  // Raster of classify(), as horizontal runs; identical consecutive rows are merged.
  const rects: string[] = [];
  let prevKey = '';
  let band: { p: number; runs: [number, number, number][] } | null = null;
  const flush = (pTop: number) => {
    if (!band) return;
    // Each rect overlaps its neighbours by half a pixel so no anti-aliased seams show.
    const y0 = f(sy(pTop));
    const h = f(sy(band.p) - sy(pTop) + 0.5);
    for (const [a, b, k] of band.runs) {
      rects.push(`<rect x="${f(sx(T0 + a * DT))}" y="${y0}" width="${f(sx(T0 + b * DT) - sx(T0 + a * DT) + 0.5)}" height="${h}" fill="${hex(BIOMES[k].rgb)}"/>`);
    }
  };
  for (let j = 0; j < np; j++) {
    const p = P0 + (j + 0.5) * DP;
    const runs: [number, number, number][] = [];
    for (let i = 0; i < nt; i++) {
      const k = classify(T0 + (i + 0.5) * DT, p).biome;
      const last = runs[runs.length - 1];
      if (last && last[2] === k) last[1] = i + 1;
      else runs.push([i, i + 1, k]);
    }
    const key = runs.map((r) => r.join(',')).join(';');
    if (key !== prevKey) {
      flush(P0 + j * DP);
      band = { p: P0 + j * DP, runs };
      prevKey = key;
    }
  }
  flush(P1);

  // Agreement and label positions per Whittaker biome.
  const rows: BiomeChart['rows'] = [];
  const labels: string[] = [];
  for (const { name, ring } of polys) {
    const ok = new Set(MATCH[name].map((id) => BIOMES.findIndex((b) => b.id === id)));
    const counts = new Map<number, number>();
    let n = 0;
    let hit = 0;
    let best = { d: -1, x: 0, y: 0 };
    for (let j = 0; j < np; j++) {
      const p = P0 + (j + 0.5) * DP;
      for (let i = 0; i < nt; i++) {
        const t = T0 + (i + 0.5) * DT;
        if (!inside(ring, t, p)) continue;
        const k = classify(t, p).biome;
        n++;
        if (ok.has(k)) hit++;
        counts.set(k, (counts.get(k) ?? 0) + 1);
        if (i % 5 === 0 && j % 5 === 0) {
          const d = edgeDistance(ring, sx(t), sy(p));
          if (d > best.d) best = { d, x: sx(t), y: sy(p) };
        }
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    rows.push({ name, agree: hit / n, top: BIOMES[top].name });
    const words = name.replace('/', '/ ').split(' ');
    const lines: string[] = [];
    for (const w of words) {
      const cur = lines[lines.length - 1];
      if (cur && (cur + ' ' + w).length <= 14) lines[lines.length - 1] = cur + ' ' + w;
      else lines.push(w);
    }
    const y0 = best.y - ((lines.length - 1) * 13) / 2 + 4;
    labels.push(
      `<text class="wl" x="${f(best.x)}" y="${f(y0)}">${lines.map((l, i) => `<tspan x="${f(best.x)}" dy="${i ? 13 : 0}">${esc(l.replace('/ ', '/'))}</tspan>`).join('')}</text>`,
    );
  }

  const outlines = polys.map(({ ring }) => `<path d="M${ring.map(([t, p]) => `${f(sx(t))},${f(sy(p))}`).join('L')}Z"/>`);

  // Axes.
  const ticks: string[] = [];
  for (let t = -15; t <= 30; t += 5) {
    ticks.push(`<line x1="${f(sx(t))}" y1="${PY + PH}" x2="${f(sx(t))}" y2="${PY + PH + 5}"/>`);
    ticks.push(`<text class="tx" x="${f(sx(t))}" y="${PY + PH + 20}">${t < 0 ? '−' + -t : t}</text>`);
  }
  for (let p = 0; p <= P1; p += 500) {
    ticks.push(`<line x1="${PX - 5}" y1="${f(sy(p))}" x2="${PX}" y2="${f(sy(p))}"/>`);
    ticks.push(`<text class="ty" x="${PX - 9}" y="${f(sy(p)) + 4}">${p}</text>`);
  }

  // Legend: the biomes classify() can return (no ocean, no mangrove).
  const used = BIOMES.filter((b) => b.id !== 'ocean' && b.id !== 'mangrove');
  const LX = PX + PW + 28;
  const legend = used.map(
    (b, i) =>
      `<rect x="${LX}" y="${PY + 22 + i * 22}" width="16" height="16" rx="2" fill="${hex(b.rgb)}" stroke="#0003"/><text class="lg" x="${LX + 24}" y="${PY + 35 + i * 22}">${esc(b.name)}</text>`,
  );
  const ly = PY + 22 + used.length * 22 + 14;
  legend.push(`<line x1="${LX}" y1="${ly + 8}" x2="${LX + 16}" y2="${ly + 8}" class="ol"/><text class="lg" x="${LX + 24}" y="${ly + 12}">Whittaker (plotbiomes)</text>`);

  const agreeLines = rows.map(
    (r) => `${r.name}: ${Math.round(r.agree * 100)} % (mostly ${r.top})`,
  );
  const ay = ly + 48;
  const agree = [
    `<text class="lh" x="${LX}" y="${ay}">Agreement inside each outline</text>`,
    ...agreeLines.map((l, i) => `<text class="ag" x="${LX}" y="${ay + 20 + i * 30}">${esc(l.split(': ')[0])}</text><text class="ag2" x="${LX}" y="${ay + 34 + i * 30}">${esc(l.split(': ')[1])}</text>`),
  ];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">
<style>
.tx,.ty{font-size:12px;fill:#555}.tx{text-anchor:middle}.ty{text-anchor:end}
.ax{font-size:13px;fill:#333;text-anchor:middle}
.wl{font-size:11.5px;font-weight:600;fill:#111;text-anchor:middle;paint-order:stroke;stroke:#fffd;stroke-width:3px;stroke-linejoin:round}
.ol,.outl path{fill:none;stroke:#111;stroke-width:1.6;stroke-linejoin:round}
.lg{font-size:12.5px;fill:#222}.lh{font-size:13px;font-weight:600;fill:#222}
.ag{font-size:11.5px;fill:#222}.ag2{font-size:11px;fill:#666}
</style>
<rect width="${W}" height="${H}" fill="#faf9f5"/>
<text x="${PX}" y="30" font-size="20" font-weight="700" fill="#222">sandbox4 classify() vs. the Whittaker biomes</text>
<text x="${PX}" y="50" font-size="12.5" fill="#666">Fill: classify(t, p) from biomes.ts. Outlines: plotbiomes digitisation of Ricklefs (2008) Fig. 5.5. Faded fill lies outside the Whittaker triangle.</text>
<defs><clipPath id="wh">${outlines.join('')}</clipPath><clipPath id="plot"><rect x="${PX}" y="${PY}" width="${PW}" height="${PH}"/></clipPath></defs>
<g shape-rendering="crispEdges" clip-path="url(#plot)"><g opacity="0.38">${rects.join('')}</g><g clip-path="url(#wh)">${rects.join('')}</g></g>
<g class="outl" clip-path="url(#plot)">${outlines.join('')}</g>
${labels.join('\n')}
<rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" fill="none" stroke="#999"/>
<g stroke="#999">${ticks.filter((s) => s.startsWith('<line')).join('')}</g>
${ticks.filter((s) => s.startsWith('<text')).join('')}
<text class="ax" x="${PX + PW / 2}" y="${PY + PH + 44}">Mean annual temperature (°C, after height cooling)</text>
<text class="ax" transform="translate(${PX - 58},${PY + PH / 2}) rotate(-90)">Annual precipitation (mm)</text>
${legend.join('\n')}
${agree.join('\n')}
</svg>
`;
  return { svg, rows };
}
