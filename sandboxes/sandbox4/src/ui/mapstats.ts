/** The Statistics section: biome and elevation zone histograms, climate and height ranges. */
import { cssRgb, type RGB } from '@shared/render/colormaps';
import { esc } from '@shared/ui/html';
import { PRECIP_STOPS, rampRgb, TEMP_STOPS } from '../render/climate';
import { heightColor } from '../render/source';
import { BELTS, BIOMES, MOISTURE, OCEAN_BIOME } from '../world/biomes';
import type { Dist, Extreme, MapStats } from '../world/mapstats';
import { ELEVATION_ZONE_TYPES, OCEAN_ZONE } from '../world/zones';

export type BiomeSort = 'legend' | 'share';

/** A biome below this share of the land is flagged as rare. */
export const RARE_SHARE = 0.01;

const pct = (v: number) => (!Number.isFinite(v) ? '—' : v === 0 ? '0 %' : v < 0.001 ? '< 0.1 %' : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)} %`);
const int = (n: number) => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
const km = (m: number) => `${int(m / 1000)} km`;
/** Packed ABGR pixel → CSS colour. */
const cssPacked = (c: number) => `rgb(${c & 255},${(c >>> 8) & 255},${(c >>> 16) & 255})`;
/** Dark or light text on a background colour. */
const ink = ([r, g, b]: RGB) => (0.299 * r + 0.587 * g + 0.114 * b < 120 ? '#f2f5f7' : '#0b0e13');

interface Row {
  name: string;
  rgb: RGB;
  count: number;
  share: number;
  /** expected share (drawn as a tick), if any */
  ref?: number;
  title: string;
  flag?: 'rare' | 'none';
}

/** Histogram rows: name, count and share over a full-width bar scaled to the largest share. */
function hist(rows: Row[], refLabel: string): string {
  const top = Math.max(1e-9, ...rows.map((r) => Math.max(r.share, r.ref ?? 0)));
  let html = '<div class="ms-hist">';
  for (const r of rows) {
    const w = (r.share / top) * 100;
    const tick = r.ref !== undefined ? `<u style="left:${((r.ref / top) * 100).toFixed(1)}%" title="${esc(refLabel)}"></u>` : '';
    html +=
      `<div class="ms-row${r.flag ? ` ${r.flag}` : ''}" title="${esc(r.title)}">` +
      `<span class="nm"><i style="background:${cssRgb(r.rgb)}"></i>${esc(r.name)}</span>` +
      `<b>${int(r.count)}</b><em>${pct(r.share)}</em>` +
      `<span class="tr"><i style="width:${w.toFixed(1)}%;background:${cssRgb(r.rgb)}"></i>${tick}</span>` +
      `</div>`;
  }
  return html + '</div>';
}

/** A jump link to an extreme (pans there and pins it), or the plain value. */
function ext(e: Extreme | null, digits: number): string {
  if (!e) return '—';
  const v = digits === 0 ? int(e.v) : e.v.toFixed(digits);
  return `<button class="ms-jump" data-x="${e.x}" data-y="${e.y}" title="Go to ${(e.x / 1000).toFixed(1)}, ${(e.y / 1000).toFixed(1)} km and pin it">${v}</button>`;
}

function rangeRow(label: string, unit: string, d: Dist, digits: number, title: string): string {
  const mean = d.n ? (digits === 0 ? int(d.mean) : d.mean.toFixed(digits)) : '—';
  return `<tr title="${esc(title)}"><th>${esc(label)} <small>${esc(unit)}</small></th><td>${ext(d.min, digits)}</td><td>${mean}</td><td>${ext(d.max, digits)}</td></tr>`;
}

/** A small distribution histogram, each bar in the colour of its value. */
function spark(label: string, d: Dist, color: (v: number) => string, fmt: (v: number) => string): string {
  if (!d.n) return '';
  const peak = Math.max(1, ...d.bins);
  const w = (d.hi - d.lo) / d.bins.length;
  const val = (t: number) => (d.log ? 10 ** t : t);
  let bars = '';
  d.bins.forEach((n, k) => {
    const a = d.lo + k * w;
    const mid = val(a + w / 2);
    const h = n ? Math.max(4, (n / peak) * 100) : 0;
    bars += `<i style="height:${h.toFixed(1)}%;background:${color(mid)}" title="${esc(`${fmt(val(a))} to ${fmt(val(a + w))}: ${pct(n / d.n)}`)}"></i>`;
  });
  return (
    `<div class="ms-spark"><div class="ms-spark-head"><span>${esc(label)}</span><em>${d.log ? 'log scale' : ''}</em></div>` +
    `<div class="ms-bars">${bars}</div>` +
    `<div class="ms-spark-ends"><span>${fmt(val(d.lo))}</span><span>${fmt(val(d.hi))}</span></div></div>`
  );
}

const BELT_SHORT = ['Polar', 'Subpolar', 'Boreal', 'Temperate', 'Tropical'];
const MOIST_SHORT = ['Arid', 'Semi', 'Subh.', 'Humid', 'Perh.'];

/** Land samples per thermal belt × moisture class, each cell in its most common biome. */
function climateGrid(s: MapStats): string {
  const peak = Math.max(1, ...s.grid.flat());
  let html = '<div class="ms-grid"><span></span>';
  MOISTURE.forEach((m, k) => (html += `<span class="h" title="${esc(m)}">${MOIST_SHORT[k]}</span>`));
  for (let b = BELTS.length - 1; b >= 0; b--) {
    html += `<span class="h row" title="${esc(BELTS[b].name)}">${BELT_SHORT[b]}</span>`;
    for (let m = 0; m < MOISTURE.length; m++) {
      const n = s.grid[b][m];
      const bi = s.gridBiome[b][m];
      if (!n || bi < 0) {
        html += `<i class="empty" title="${esc(`${BELTS[b].name} · ${MOISTURE[m].toLowerCase()}: none`)}"></i>`;
        continue;
      }
      const rgb = BIOMES[bi].rgb;
      const a = 0.35 + 0.65 * Math.sqrt(n / peak);
      const share = n / Math.max(1, s.land);
      html += `<i style="background:${cssRgb(rgb, a)};color:${a > 0.6 ? ink(rgb) : 'var(--text)'}" title="${esc(`${BELTS[b].name} · ${MOISTURE[m].toLowerCase()}: ${pct(share)} of land, mostly ${BIOMES[bi].name}`)}">${share >= 0.005 ? Math.round(share * 100) : '·'}</i>`;
    }
  }
  return html + '</div>';
}

export function renderMapStats(host: HTMLElement, s: MapStats | null, sort: BiomeSort, onJump: (x: number, y: number) => void, onSort: (s: BiomeSort) => void): void {
  host.onclick = (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-x],[data-sort]');
    if (!t) return;
    if (t.dataset.sort) onSort(t.dataset.sort as BiomeSort);
    else onJump(Number(t.dataset.x), Number(t.dataset.y));
  };
  if (!s) {
    host.innerHTML = '<p class="muted">Measuring…</p>';
    return;
  }
  const { rect } = s;
  const all = Math.max(1, s.samples);
  const land = Math.max(1, s.land);
  let html = '';
  const kv = (k: string, v: string, title = '') => (html += `<div class="kv"${title ? ` title="${esc(title)}"` : ''}><span>${esc(k)}</span><b>${v}</b></div>`);

  kv('Area', `${km(rect.x1 - rect.x0)} × ${km(rect.y1 - rect.y0)}`, 'The rectangle the statistics are taken over');
  kv('Land / ocean', `${pct(s.land / all)} / ${pct(s.ocean / all)}`, 'Share of the sampled subbiome cells');
  kv('Regions', int(s.regions), 'Distinct regions met by the samples');
  kv('Elevation zones', int(s.zones), 'Distinct (merged) elevation zones met by the samples');
  kv('Subbiomes', int(s.subs), 'Distinct (merged) subbiomes met by the samples');

  // ---------------------------------------------------------------- biomes
  const landBiomes = BIOMES.map((b, k) => ({ b, k })).filter(({ k }) => k !== OCEAN_BIOME);
  const even = 1 / landBiomes.length;
  let rows: Row[] = landBiomes.map(({ b, k }) => {
    const share = s.biomeSamples[k] / land;
    return {
      name: b.name,
      rgb: b.rgb,
      count: s.biomeSubs[k],
      share,
      ref: even,
      flag: s.biomeSamples[k] === 0 ? 'none' : share < RARE_SHARE ? 'rare' : undefined,
      title: `${b.name}: ${int(s.biomeSubs[k])} subbiomes, ${pct(share)} of the land (≈ ${int((s.biomeSamples[k] * s.sampleArea) / 1e6)} km²)`,
    };
  });
  if (sort === 'share') rows = rows.slice().sort((a, b) => b.share - a.share);
  html +=
    `<div class="sub ms-sub">Biomes <span class="ms-seg">` +
    `<button data-sort="legend" class="${sort === 'legend' ? 'on' : ''}" title="Legend order: cold to hot, dry to wet">legend</button>` +
    `<button data-sort="share" class="${sort === 'share' ? 'on' : ''}" title="Largest share first">share</button></span></div>`;
  html += `<div class="ms-note">${s.stride > 1 ? `Subbiomes sampled (1 in ${int(s.stride ** 2)})` : 'Subbiomes'} · share of land. Tick: an even share (${pct(even)}).</div>`;
  html += hist(rows, `Even share: ${pct(even)} of the land each`);
  const missing = rows.filter((r) => r.flag === 'none').map((r) => r.name);
  const rare = rows.filter((r) => r.flag === 'rare').map((r) => r.name);
  if (missing.length) html += `<div class="ms-flag none"><b>Missing</b> ${esc(missing.join(', '))}</div>`;
  if (rare.length) html += `<div class="ms-flag rare"><b>Rare (&lt; ${RARE_SHARE * 100} % of land)</b> ${esc(rare.join(', '))}</div>`;
  // Shannon evenness over the land biomes: 1 = every biome equally common
  let h = 0;
  let present = 0;
  for (const { k } of landBiomes) {
    const q = s.biomeSamples[k] / land;
    if (q > 0) {
      h -= q * Math.log(q);
      present++;
    }
  }
  kv('Biomes present', `${present} of ${landBiomes.length}`);
  kv('Evenness', s.land ? (h / Math.log(landBiomes.length)).toFixed(2) : '—', 'Shannon entropy of the land biome shares ÷ ln 15: 1 when all 15 land biomes cover the same area, 0 when one covers everything');

  // ---------------------------------------------------------------- elevation zones
  const landZones = s.zoneCount.reduce((a, n, k) => (k === OCEAN_ZONE ? a : a + n), 0);
  const allZones = Math.max(1, s.zones);
  const totalWeight = ELEVATION_ZONE_TYPES.reduce((a, t) => a + t.weight, 0);
  html += `<div class="sub ms-sub">Elevation zone types</div>`;
  html += `<div class="ms-note">Elevation zones · share of all zones. Tick: the share the type weights give the land zones.</div>`;
  html += hist(
    ELEVATION_ZONE_TYPES.map((t, k) => {
      const n = s.zoneCount[k];
      const share = n / allZones;
      const exp = k === OCEAN_ZONE ? undefined : (landZones / allZones) * (t.weight / totalWeight);
      const ofLand = k === OCEAN_ZONE ? '' : `, ${pct(n / Math.max(1, landZones))} of land zones (weight ${t.weight} of ${totalWeight}: ${pct(t.weight / totalWeight)})`;
      return {
        name: t.name,
        rgb: t.rgb,
        count: n,
        share,
        ref: exp,
        title: `${t.name}: ${int(n)} elevation zones, ${pct(share)} of all zones${ofLand}; ${pct(s.zoneSamples[k] / all)} of the area`,
      };
    }),
    'Expected from the type weights',
  );

  // ---------------------------------------------------------------- climate & height
  html += `<div class="sub ms-sub">Climate &amp; height</div>`;
  html +=
    `<table class="ms-table"><thead><tr><th></th><th>min</th><th>mean</th><th>max</th></tr></thead><tbody>` +
    rangeRow('Temp. sea level', '°C', s.t0, 1, 'Initial temperature at the subbiome sites, land and ocean') +
    rangeRow('Temp. land', '°C', s.t, 1, 'Land temperature after the height cooling (what the biomes use)') +
    rangeRow('Precip. initial', 'mm', s.p0, 0, 'Initial precipitation at the subbiome sites, mm per year, land and ocean') +
    rangeRow('Precip. land', 'mm', s.p, 0, 'Land precipitation after the sparse-flat dryness (what the biomes use), mm per year') +
    rangeRow('Height land', 'm', s.height, 0, 'Land heights of the computed terrain rasters') +
    rangeRow('Ocean floor', 'm', s.depth, 0, 'Ocean heights of the computed terrain rasters') +
    `</tbody></table>`;
  html += `<div class="ms-note">Click a min or max to go there.</div>`;
  html += spark('Land temperature', s.t, (v) => cssRgb(rampRgb(TEMP_STOPS, v)), (v) => `${v.toFixed(0)} °C`);
  html += spark('Land precipitation', s.p, (v) => cssRgb(rampRgb(PRECIP_STOPS, v)), (v) => `${int(v)} mm`);
  html += spark('Land height', s.height, (v) => cssPacked(heightColor(v)), (v) => `${int(v)} m`);
  if (!s.height.n && !s.depth.n) html += `<p class="muted small">No height map computed here yet: zoom in until the terrain is computed.</p>`;

  // ---------------------------------------------------------------- climate space
  html += `<div class="sub ms-sub">Climate space</div>`;
  html += `<div class="ms-note">% of land per thermal belt × moisture class, coloured by its most common biome.</div>`;
  html += climateGrid(s);

  // ---------------------------------------------------------------- biome inputs
  html += `<div class="sub ms-sub">Biome inputs</div>`;
  kv('Exact heights', pct(s.exactHeight / land), 'Land samples whose subbiome height came from a computed terrain tile; the rest use a typical height for their elevation zone type');
  kv('Height changed biome', pct(s.shifted / land), 'Land samples whose biome differs from the one the sea-level temperature would give');
  kv('Sparse flat (drier)', pct(s.sparse / land), 'Land samples in river-poor flat elevation zones, whose precipitation is reduced');
  kv('Terrain coverage', pct(s.coverage), 'Share of the area with a computed height map');

  html += `<p class="muted small ms-foot">${int(s.samples)} samples${s.stride > 1 ? ` · 1 in ${int(s.stride ** 2)} subbiome cells` : ''} · ${s.ms.toFixed(0)} ms</p>`;
  host.innerHTML = html;
}
