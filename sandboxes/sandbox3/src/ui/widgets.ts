/** Legend, level box, inspector, view statistics and the ruler readout. */
import { cssRgb, hashColor } from '@shared/render/colormaps';
import { keyI, keyJ } from '../world/level';
import { LINKED, ORIGIN, SEED, World } from '../world/world';
import { fmtDist, TRAVEL, travelDays } from '../render/overlays';
import { GENESIS, keyHash, LAND_TYPES, landType, OCEAN_RGB, type ViewMode } from '../render/source';

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : '—');
const ij = (k: number) => `${keyI(k)}, ${keyJ(k)}`;
const sw = (c: string, label: string, v = '') => `<div class="lg-cat"><i style="background:${c}"></i><span>${esc(label)}</span><em>${esc(v)}</em></div>`;

export const LEVEL_COLORS = { region: '#faecc8', biome: '#fde725', sub: '#5ae6ff' };

export function genesisName(o: number): string {
  return GENESIS.find((g) => g.origin === o)?.name ?? `Growth pass ${o - ORIGIN.grow + 1}`;
}

// ------------------------------------------------------------------ legend

const NOTES: Record<ViewMode, [string, string]> = {
  map: ['Map', 'Biome colours are cosmetic: a random look per merged biome, lighter/darker per subbiome. There is no height.'],
  landsea: ['Land & ocean', 'The only real classification in this sandbox.'],
  genesis: ['Ocean genesis', 'Why each ocean biome is ocean. Turn on seeds & links and growth arrows to see the steps.'],
  merges: ['Merged cells', 'Orange: biomes in a merged group (one colour per group). Yellow: merged subbiome groups.'],
  regions: ['Regions', 'One colour per region (dark over ocean). With nesting, a region is the union of the biomes it owns.'],
  biomes: ['Biomes', 'One colour per merged biome (dimmed over ocean).'],
  subbiomes: ['Subbiomes', 'One colour per merged subbiome. Zoomed far out, subbiomes are skipped and biomes shown.'],
  hierarchy: ['Hierarchy', 'Hue = region, lightness = biome, fine shading = subbiome. Ocean is darkened.'],
};

export function renderLegend(host: HTMLElement, mode: ViewMode, oceanShare: number | null, passes: number): void {
  const [title, note] = NOTES[mode];
  const min = host.classList.contains('min');
  let html = `<div class="lg-title" title="Click to collapse / expand">${esc(title)}</div>`;
  if (mode === 'genesis') {
    html += '<div class="lg-cats">';
    for (const g of GENESIS) if (g.origin < ORIGIN.grow + passes || g.origin < ORIGIN.grow) html += sw(cssRgb(g.rgb), g.name);
    html += '</div>';
  } else if (mode === 'map') {
    html += '<div class="lg-cats two">' + sw(cssRgb(OCEAN_RGB), 'Ocean');
    for (const t of LAND_TYPES) html += sw(cssRgb(t.rgb), t.name);
    html += '</div>';
  } else if (mode === 'landsea') {
    html += '<div class="lg-cats">' + sw('#96b270', 'Land', oceanShare === null ? '' : pct(1 - oceanShare)) + sw('#264e80', 'Ocean', oceanShare === null ? '' : pct(oceanShare)) + '</div>';
  } else if (mode === 'merges') {
    html += '<div class="lg-cats">' + sw('#e8913a', 'Merged biome group') + sw('#f4dd63', 'Merged subbiome group') + sw('#767c70', 'Unmerged land') + sw('#283a54', 'Unmerged ocean') + '</div>';
  }
  html += `<div class="lg-note">${esc(note)}</div>`;
  host.innerHTML = html;
  host.classList.toggle('min', min);
  host.querySelector('.lg-title')!.addEventListener('click', () => host.classList.toggle('min'));
}

// ------------------------------------------------------------------ level box

export function renderLevels(host: HTMLElement, world: World, zoom: number, detail: boolean): void {
  const row = (name: string, color: string, size: number, on: boolean) =>
    `<span class="${on ? '' : 'dim'}"><i class="lv-dot" style="background:${color}"></i>${name}</span><b class="${on ? '' : 'dim'}">${fmtDist(size)}</b><b class="${on ? '' : 'dim'}">${(size * zoom).toFixed(size * zoom < 10 ? 1 : 0)} px</b>`;
  host.innerHTML =
    row('Region', LEVEL_COLORS.region, world.regionLevel.size, true) +
    row('Biome', LEVEL_COLORS.biome, world.biomeLevel.size, true) +
    row('Subbiome', LEVEL_COLORS.sub, world.subLevel.size, detail);
  host.title = detail ? 'Grid size and on-screen size of each level' : 'Subbiomes are under 3 px and are skipped (Display → Detail)';
}

// ------------------------------------------------------------------ inspector

export interface Probe {
  x: number;
  y: number;
  pinned: boolean;
}

export function renderInspector(host: HTMLElement, world: World | null, pt: Probe | null): void {
  if (!world || !pt) {
    host.innerHTML = '<p class="muted">Hover the map to inspect a point. Click to pin the biome and subbiome under the cursor.</p>';
    return;
  }
  const c = world.cellAt(pt.x, pt.y, true);
  const reg = world.region(c.region);
  const braw = world.biome(c.biomeRaw);
  const broot = world.biome(c.biome);
  const links = world.links(c.region);
  const f = world.baseFlags(c.biome);
  const regColor = cssRgb(hashColor(keyHash(c.region, 3)));
  let html = `<div class="kv"><span>Point</span><b>${(pt.x / 1000).toFixed(2)}, ${(pt.y / 1000).toFixed(2)} km</b></div>`;

  html += `<div class="lvl"><h4><i style="background:${regColor}"></i>Region ${ij(c.region)}</h4>`;
  html += `<div class="kv"><span>Owned biomes</span><b>${reg.biomes.length}</b></div>`;
  html += `<div class="kv"><span>Ocean seeds</span><b>${reg.seeds.length} · ${links.length} link${links.length === 1 ? '' : 's'}</b></div>`;
  html += `<div class="kv"><span>Biome merges</span><b>${reg.merges.size}</b></div></div>`;

  const typeName = c.ocean ? 'Ocean' : LAND_TYPES[landType(c.biome)].name;
  const g = GENESIS.find((x) => x.origin === c.origin);
  const chipColor = g ? cssRgb(g.rgb) : '#888';
  html += `<div class="lvl"><h4><i style="background:${LEVEL_COLORS.biome}"></i>Biome ${ij(c.biome)}</h4>`;
  html += `<div class="kv"><span>Class</span><b><span class="chip" style="background:${chipColor}">${esc(genesisName(c.origin))}</span></b></div>`;
  html += `<div class="kv"><span>Look (cosmetic)</span><b>${esc(typeName)}</b></div>`;
  if (c.biomeMerged) {
    const members = World.cellsIn(world.biomeLevel, broot.x - 3 * world.biomeLevel.size, broot.y - 3 * world.biomeLevel.size, broot.x + 3 * world.biomeLevel.size, broot.y + 3 * world.biomeLevel.size, 0).filter(
      (k) => world.biomeRoot(k) === c.biome,
    );
    html += `<div class="kv"><span>Merged group</span><b>${members.length} biomes</b></div>`;
  }
  if (c.biomeRaw !== c.biome) html += `<div class="kv"><span>Raw cell</span><b>${ij(c.biomeRaw)} → ${ij(c.biome)}</b></div>`;
  const t = world.biomeTarget(c.biome);
  if (t >= 0) html += `<div class="kv"><span>Joins</span><b>${ij(t)}</b></div>`;
  html += `<div class="kv"><span>Neighbours</span><b>${world.biomeNbrs(broot).length}</b></div>`;
  html += `<div class="kv"><span>Owned subbiomes</span><b>${world.biomeSubs(braw).length}</b></div>`;
  if (f & SEED) html += `<div class="kv"><span>Ocean seed</span><b>${f & LINKED ? (world.linkCount(world.biome(c.biome)) === 2 ? 'double-linked' : 'linked') : 'lone'}</b></div>`;
  const grows = world.growthFrom(c.biome);
  if (grows.length) html += `<div class="kv"><span>Converted</span><b>${grows.length} neighbour${grows.length > 1 ? 's' : ''}</b></div>`;
  html += `<div class="kv"><span>Site</span><b>${(broot.x / 1000).toFixed(1)}, ${(broot.y / 1000).toFixed(1)} km</b></div></div>`;

  html += `<div class="lvl"><h4><i style="background:${LEVEL_COLORS.sub}"></i>Subbiome ${ij(c.sub)}</h4>`;
  if (c.subRaw !== c.sub) html += `<div class="kv"><span>Raw cell</span><b>${ij(c.subRaw)} → ${ij(c.sub)}</b></div>`;
  const st = world.subTarget(c.sub);
  html += `<div class="kv"><span>Merged</span><b>${c.subMerged ? (st >= 0 ? `joins ${ij(st)}` : 'yes (group root)') : 'no'}</b></div>`;
  html += `<div class="kv"><span>Neighbours</span><b>${world.subNbrs(world.sub(c.sub)).length}</b></div></div>`;
  html += `<p class="muted small">${pt.pinned ? 'Pinned — Esc to release.' : 'Click to pin.'} Cell ids are lattice indices (i, j).</p>`;
  host.innerHTML = html;
}

// ------------------------------------------------------------------ view statistics

export interface ViewStats {
  samples: number;
  oceanShare: number;
  regions: number;
  biomes: number;
  subs: number;
  /** ocean biomes (merged roots) by ORIGIN code */
  origins: Map<number, number>;
  oceanBiomes: number;
  seeds: number;
  linkedSeeds: number;
  links: number;
  biomesPerRegion: number;
  subsPerBiome: number;
  /** merged groups */
  biomeGroups: number;
  biomeGroupMax: number;
  biomeMembers: number;
  biomeRaw: number;
  subGroups: number;
  subMembers: number;
  subRaw: number;
  detail: boolean;
  ms: number;
}

export function computeViewStats(world: World, x0: number, y0: number, x1: number, y1: number, detail: boolean): ViewStats {
  const t0 = performance.now();
  const nx = 120;
  const ny = Math.max(20, Math.round((nx * (y1 - y0)) / Math.max(1, x1 - x0)));
  const regions = new Set<number>();
  const biomes = new Set<number>();
  /** genesis per raw biome (merged groups can mix seed, chain and growth) */
  const raw = new Map<number, number>();
  const subs = new Set<number>();
  let ocean = 0;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const c = world.cellAt(x0 + ((x + 0.5) / nx) * (x1 - x0), y0 + ((y + 0.5) / ny) * (y1 - y0), detail);
      if (c.ocean) ocean++;
      regions.add(c.region);
      biomes.add(c.biome);
      raw.set(c.biomeRaw, c.origin);
      if (c.sub >= 0) subs.add(c.sub);
    }
  }
  const origins = new Map<number, number>();
  let oceanBiomes = 0;
  for (const o of raw.values()) {
    if (o === ORIGIN.land) continue;
    oceanBiomes++;
    origins.set(o, (origins.get(o) ?? 0) + 1);
  }
  let seeds = 0;
  let linkedSeeds = 0;
  let links = 0;
  let owned = 0;
  for (const r of regions) {
    const reg = world.region(r);
    owned += reg.biomes.length;
    seeds += reg.seeds.length;
    for (const s of reg.seeds) if (world.baseFlags(s) & LINKED) linkedSeeds++;
    links += world.links(r).length;
  }
  let subOwned = 0;
  let subOwners = 0;
  for (const b of biomes.keys()) {
    if (subOwners >= 120) break;
    subOwned += world.biomeSubs(world.biome(b)).length;
    subOwners++;
  }
  // merged groups among the raw cells whose site is in view
  const groupSizes = (keys: number[], root: (k: number) => number) => {
    const m = new Map<number, number>();
    for (const k of keys) {
      const r = root(k);
      m.set(r, (m.get(r) ?? 0) + 1);
    }
    let groups = 0;
    let members = 0;
    let max = 1;
    for (const n of m.values())
      if (n > 1) {
        groups++;
        members += n;
        max = Math.max(max, n);
      }
    return { groups, members, max, raw: keys.length };
  };
  const bg = World.countIn(world.biomeLevel, x0, y0, x1, y1, 0) <= 20000 ? groupSizes(World.cellsIn(world.biomeLevel, x0, y0, x1, y1, 0), (k) => world.biomeRoot(k)) : null;
  const sg =
    detail && World.countIn(world.subLevel, x0, y0, x1, y1, 0) <= 12000 ? groupSizes(World.cellsIn(world.subLevel, x0, y0, x1, y1, 0), (k) => world.subRoot(k)) : null;
  return {
    samples: nx * ny,
    oceanShare: ocean / (nx * ny),
    regions: regions.size,
    biomes: biomes.size,
    subs: subs.size,
    origins,
    oceanBiomes,
    seeds,
    linkedSeeds,
    links,
    biomesPerRegion: owned / Math.max(1, regions.size),
    subsPerBiome: subOwned / Math.max(1, subOwners),
    biomeGroups: bg?.groups ?? NaN,
    biomeGroupMax: bg?.max ?? NaN,
    biomeMembers: bg?.members ?? NaN,
    biomeRaw: bg?.raw ?? NaN,
    subGroups: sg?.groups ?? NaN,
    subMembers: sg?.members ?? NaN,
    subRaw: sg?.raw ?? NaN,
    detail,
    ms: performance.now() - t0,
  };
}

export function renderStats(
  host: HTMLElement,
  world: World,
  s: ViewStats | null,
  extra: { fingerprint: string; render: number; cache: World['cacheStats'] },
): void {
  host.innerHTML = '';
  const add = (k: string, v: string, title?: string) => {
    const d = document.createElement('div');
    d.className = 'kv';
    if (title) d.title = title;
    d.innerHTML = `<span>${esc(k)}</span><b>${esc(v)}</b>`;
    host.append(d);
  };
  const sub = (t: string) => {
    const d = document.createElement('div');
    d.className = 'sub';
    d.textContent = t;
    host.append(d);
  };
  if (!s) {
    host.innerHTML = '<p class="muted">Measuring…</p>';
    return;
  }
  add('Ocean / land', `${pct(s.oceanShare)} / ${pct(1 - s.oceanShare)}`, `Share of ${s.samples} sample points in the view`);
  add('Regions · biomes · subbiomes', `${s.regions} · ${s.biomes} · ${s.detail ? s.subs : '—'}`, 'Distinct merged cells under the sample grid');
  add('Biomes per region', s.biomesPerRegion.toFixed(1), `Owned biomes; nominal (${fmtDist(world.regionLevel.size)}/${fmtDist(world.biomeLevel.size)})² = ${((world.regionLevel.size / world.biomeLevel.size) ** 2).toFixed(1)}`);
  add('Subbiomes per biome', s.subsPerBiome.toFixed(1), `Owned subbiomes; nominal ${((world.biomeLevel.size / world.subLevel.size) ** 2).toFixed(1)}`);

  sub('Oceans');
  add('Seeds (linked)', `${s.seeds} (${s.linkedSeeds})`, 'Ocean seeds in the regions under the view, and how many take part in a link');
  add('Links', String(s.links));
  add('Ocean biomes', String(s.oceanBiomes));
  const bars = document.createElement('div');
  for (const g of GENESIS) {
    if (g.origin === ORIGIN.land) continue;
    const n = s.origins.get(g.origin) ?? 0;
    if (!n && g.origin >= ORIGIN.grow + world.p.growPasses) continue;
    const f = n / Math.max(1, s.oceanBiomes);
    const row = document.createElement('div');
    row.className = 'obar';
    row.innerHTML = `<span>${esc(g.name)}</span><i style="width:${(f * 100).toFixed(1)}%;background:${cssRgb(g.rgb)}"></i><em>${n}</em>`;
    bars.append(row);
  }
  host.append(bars);

  sub('Merges');
  add(
    'Biome groups',
    Number.isFinite(s.biomeGroups) ? `${s.biomeGroups} · ${pct(s.biomeMembers / Math.max(1, s.biomeRaw), 0)} of cells · max ${s.biomeGroupMax}` : 'zoom in',
    'Merged biome groups among biomes whose site is in view, share of raw biomes in a group, and the largest group',
  );
  add(
    'Subbiome groups',
    Number.isFinite(s.subGroups) ? `${s.subGroups} · ${pct(s.subMembers / Math.max(1, s.subRaw), 0)} of cells` : 'zoom in',
    'Merged subbiome groups among subbiomes whose site is in view',
  );

  sub('Performance');
  const c = extra.cache;
  add('Last full render', extra.render > 0 ? `${extra.render.toFixed(0)} ms` : '…');
  add('Statistics pass', `${s.ms.toFixed(0)} ms`);
  add('Cached cells', `${c.regions} · ${c.biomes} · ${c.subs}`, 'Memoised regions · biomes · subbiomes. The caches are dropped when they grow too large; results never change.');
  add('Fingerprint', extra.fingerprint || '…', 'Hash of a fixed 768 km sample window around the origin. Same seed + parameters ⇒ same value in every browser.');
}

// ------------------------------------------------------------------ ruler

export function renderRuler(host: HTMLElement, d: number | null, measuring: boolean): void {
  if (d === null) {
    host.hidden = !measuring;
    host.innerHTML = measuring ? '<div class="muted">Drag on the map to measure. Esc or M to stop.</div>' : '';
    return;
  }
  host.hidden = false;
  const km = d / 1000;
  let html = `<h4>${esc(fmtDist(d))}</h4>`;
  for (const t of TRAVEL) html += `<div class="kv" title="${t.lo}–${t.hi} km per day"><span>${esc(t.name)}</span><b>${esc(travelDays(km, t.lo, t.hi))}</b></div>`;
  html += '<div class="muted small">Straight line, flat ground. Reference speeds from sandbox3.md.</div>';
  host.innerHTML = html;
}
