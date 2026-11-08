/** Legend, level box, inspector, view statistics and the ruler readout. */
import { cssRgb, hashColor } from '@shared/render/colormaps';
import { esc } from '@shared/ui/html';
import { keyI, keyJ } from '../world/level';
import type { Rivers } from '../world/rivers';
import { LINKED, ORIGIN, SEED, World } from '../world/world';
import { fmtDist, TRAVEL, travelDays } from '../render/overlays';
import { GENESIS, heightColor, keyHash, type ViewMode } from '../render/source';
import { ELEVATION_ZONE_TYPES, elevationZoneType } from '../world/zones';
import type { Terrain } from '../world/terrain';
import { fieldAt, type Climate, type NoiseFieldParams } from '../world/climate';
import { rampRgb, STOPS, type ClimateField } from '../render/climate';

/** Packed ABGR pixel → CSS colour. */
const cssHex = (c: number) => `rgb(${c & 255},${(c >>> 8) & 255},${(c >>> 16) & 255})`;

const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : '—');
const ij = (k: number) => `${keyI(k)}, ${keyJ(k)}`;
const sw = (c: string, label: string, v = '') => `<div class="lg-cat"><i style="background:${c}"></i><span>${esc(label)}</span><em>${esc(v)}</em></div>`;

export const LEVEL_COLORS = { region: '#faecc8', elevationZone: '#fde725', sub: '#5ae6ff' };

export function genesisName(o: number): string {
  return GENESIS.find((g) => g.origin === o)?.name ?? `Growth pass ${o - ORIGIN.grow + 1}`;
}

// ------------------------------------------------------------------ legend

const NOTES: Record<ViewMode, [string, string]> = {
  map: ['Map', 'Each elevation zone is coloured by its type (ocean, flat, lowland, hills, mountains), lighter/darker per subbiome. Biomes come later, from temperature and precipitation. Turn on Hillshade to see the height map.'],
  landsea: ['Land & ocean', 'Land and ocean, from the ocean genesis.'],
  genesis: ['Ocean genesis', 'Why each ocean elevation zone is ocean. Turn on seeds & links and growth arrows to see the steps.'],
  merges: ['Merged cells', 'Orange: elevation zones in a merged group (one colour per group). Yellow: merged subbiome groups.'],
  regions: ['Regions', 'One colour per region (dark over ocean). With nesting, a region is the union of the elevation zones it owns.'],
  elevationZones: ['Elevation zones', 'One colour per merged elevation zone (dimmed over ocean).'],
  subbiomes: ['Subbiomes', 'One colour per merged subbiome. Zoomed far out, subbiomes are skipped and elevation zones shown.'],
  hierarchy: ['Hierarchy', 'Hue = region, lightness = elevation zone, fine shading = subbiome. Ocean is darkened.'],
  height: ['Height', 'Fitted height map, hillshaded from the north-west. Regions are computed as you look; flat colours mean “not ready yet”.'],
};

/** A climate overlay in the legend: its field and parameters (for the range and scale). */
export interface ClimateLegend {
  field: ClimateField;
  p: NoiseFieldParams;
}

const CLIMATE_NAMES: Record<ClimateField, [string, string]> = { temperature: ['Initial temperature', '°C'], precipitation: ['Initial precipitation', 'mm/yr'] };

/** A gradient bar over [min, max] for one climate overlay (drawn at 50 % on the map). */
function climateBar(c: ClimateLegend): string {
  const [name, unit] = CLIMATE_NAMES[c.field];
  const at = (t: number) => fieldAt(c.p, t);
  const stops = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map((t) => `${cssRgb(rampRgb(STOPS[c.field], at(t)))} ${t * 100}%`).join(',');
  const fmt = (v: number) => `${+v.toPrecision(3)} ${unit}`;
  return (
    `<div class="lg-clim"><div class="lg-clim-name">${esc(name)} <em>overlay · 50 %</em></div>` +
    `<div class="lg-bar" style="background:linear-gradient(90deg,${stops})"></div>` +
    `<div class="lg-clim-ends"><span>${fmt(at(0))}</span><span>${fmt(at(0.5))}${c.p.log ? ' (log)' : ''}</span><span>${fmt(at(1))}</span></div></div>`
  );
}

export function renderLegend(host: HTMLElement, mode: ViewMode, oceanShare: number | null, passes: number, climate: ClimateLegend[] = []): void {
  const [title, note] = NOTES[mode];
  const min = host.classList.contains('min');
  let html = `<div class="lg-title" title="Click to collapse / expand">${esc(title)}</div>`;
  if (mode === 'genesis') {
    html += '<div class="lg-cats">';
    for (const g of GENESIS) if (g.origin < ORIGIN.grow + passes || g.origin < ORIGIN.grow) html += sw(cssRgb(g.rgb), g.name);
    html += '</div>';
  } else if (mode === 'map') {
    html += '<div class="lg-cats two">';
    for (const t of ELEVATION_ZONE_TYPES) html += sw(cssRgb(t.rgb), t.name);
    html += '</div>';
  } else if (mode === 'landsea') {
    html += '<div class="lg-cats">' + sw('#96b270', 'Land', oceanShare === null ? '' : pct(1 - oceanShare)) + sw('#264e80', 'Ocean', oceanShare === null ? '' : pct(oceanShare)) + '</div>';
  } else if (mode === 'height') {
    html += '<div class="lg-cats two">';
    for (const h of [-800, -100, 0, 100, 300, 600, 1000, 1600, 2400]) html += sw(cssHex(heightColor(h)), h < 0 ? `${h} m` : h === 0 ? 'Sea level' : `${h} m`);
    html += '</div>';
  } else if (mode === 'merges') {
    html += '<div class="lg-cats">' + sw('#e8913a', 'Merged elevation zone group') + sw('#f4dd63', 'Merged subbiome group') + sw('#767c70', 'Unmerged land') + sw('#283a54', 'Unmerged ocean') + '</div>';
  }
  html += `<div class="lg-note">${esc(note)}</div>`;
  for (const c of climate) html += climateBar(c);
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
    row('Elevation zone', LEVEL_COLORS.elevationZone, world.elevationZoneLevel.size, true) +
    row('Subbiome', LEVEL_COLORS.sub, world.subLevel.size, detail);
  host.title = detail ? 'Grid size and on-screen size of each level' : 'Subbiomes are under 3 px and are skipped (Display → Detail)';
}

// ------------------------------------------------------------------ inspector

export interface Probe {
  x: number;
  y: number;
  pinned: boolean;
}

export function renderInspector(host: HTMLElement, world: World | null, rivers: Rivers | null, pt: Probe | null, terrain: Terrain | null = null, climate: Climate | null = null): void {
  if (!world || !pt) {
    host.innerHTML = '<p class="muted">Hover the map to inspect a point. Click to pin the elevation zone and subbiome under the cursor.</p>';
    return;
  }
  const c = world.cellAt(pt.x, pt.y, true);
  const reg = world.region(c.region);
  const braw = world.elevationZone(c.elevationZoneRaw);
  const broot = world.elevationZone(c.elevationZone);
  const links = world.links(c.region);
  const f = world.baseFlags(c.elevationZone);
  const regColor = cssRgb(hashColor(keyHash(c.region, 3)));
  let html = `<div class="kv"><span>Point</span><b>${(pt.x / 1000).toFixed(2)}, ${(pt.y / 1000).toFixed(2)} km</b></div>`;
  if (terrain) {
    const h = terrain.heightAt(pt.x, pt.y);
    const t = terrain.peek(c.region);
    html += `<div class="kv" title="Height map (bilinear in the tile raster)"><span>Height</span><b>${h === h ? `${h.toFixed(0)} m` : 'not computed yet'}</b></div>`;
    if (t) html += `<div class="kv" title="Tile raster (a block of k × k regions, 2 × 2 by default): cells · cells raised by the pit fill (largest raise) · compute time"><span>Terrain raster</span><b>${t.nx}×${t.ny} · ${t.filled} filled (≤ ${t.maxFill.toFixed(1)} m) · ${t.ms.toFixed(0)} ms</b></div>`;
  }

  if (climate) {
    html += `<div class="kv" title="Initial temperature map (Perlin noise)"><span>Initial temperature</span><b>${climate.temperatureAt(pt.x, pt.y).toFixed(1)} °C</b></div>`;
    html += `<div class="kv" title="Initial precipitation map (Perlin noise)"><span>Initial precipitation</span><b>${climate.precipitationAt(pt.x, pt.y).toFixed(0)} mm/yr</b></div>`;
  }

  html += `<div class="lvl"><h4><i style="background:${regColor}"></i>Region ${ij(c.region)}</h4>`;
  html += `<div class="kv"><span>Owned elevation zones</span><b>${reg.elevationZones.length}</b></div>`;
  html += `<div class="kv"><span>Ocean seeds</span><b>${reg.seeds.length} · ${links.length} link${links.length === 1 ? '' : 's'}</b></div>`;
  html += `<div class="kv"><span>Elevation zone merges</span><b>${reg.merges.size}</b></div>`;
  const rr = rivers?.peek(c.region);
  if (rr) {
    const trees = rr.roots.filter((k) => rr.flow[k] > 0).length;
    html += `<div class="kv" title="River mouths with at least one attractor upstream / roots placed"><span>Rivers</span><b>${trees} of ${rr.roots.length} roots${rr.landlocked ? ' · landlocked' : ''}</b></div>`;
    html += `<div class="kv"><span>Attractors reached</span><b>${rr.reached} / ${rr.ax.length}</b></div>`;
    html += `<div class="kv" title="Growth iterations · nodes · straight bridges over gaps wider than dᵢ · compute time"><span>Growth</span><b>${rr.iterations} it · ${rr.n} nodes · ${rr.bridges} br · ${rr.ms.toFixed(0)} ms</b></div>`;
  }
  html += '</div>';

  const typeName = ELEVATION_ZONE_TYPES[elevationZoneType(c.elevationZone, c.ocean)].name;
  const g = GENESIS.find((x) => x.origin === c.origin);
  const chipColor = g ? cssRgb(g.rgb) : '#888';
  html += `<div class="lvl"><h4><i style="background:${LEVEL_COLORS.elevationZone}"></i>Elevation zone ${ij(c.elevationZone)}</h4>`;
  html += `<div class="kv"><span>Class</span><b><span class="chip" style="background:${chipColor}">${esc(genesisName(c.origin))}</span></b></div>`;
  html += `<div class="kv"><span>Type</span><b>${esc(typeName)}</b></div>`;
  if (c.elevationZoneMerged) {
    const members = World.cellsIn(world.elevationZoneLevel, broot.x - 3 * world.elevationZoneLevel.size, broot.y - 3 * world.elevationZoneLevel.size, broot.x + 3 * world.elevationZoneLevel.size, broot.y + 3 * world.elevationZoneLevel.size, 0).filter(
      (k) => world.elevationZoneRoot(k) === c.elevationZone,
    );
    html += `<div class="kv"><span>Merged group</span><b>${members.length} elevation zones</b></div>`;
  }
  if (c.elevationZoneRaw !== c.elevationZone) html += `<div class="kv"><span>Raw cell</span><b>${ij(c.elevationZoneRaw)} → ${ij(c.elevationZone)}</b></div>`;
  const t = world.elevationZoneTarget(c.elevationZone);
  if (t >= 0) html += `<div class="kv"><span>Joins</span><b>${ij(t)}</b></div>`;
  html += `<div class="kv"><span>Neighbours</span><b>${world.elevationZoneNbrs(broot).length}</b></div>`;
  html += `<div class="kv"><span>Owned subbiomes</span><b>${world.elevationZoneSubs(braw).length}</b></div>`;
  if (f & SEED) html += `<div class="kv"><span>Ocean seed</span><b>${f & LINKED ? (world.linkCount(world.elevationZone(c.elevationZone)) === 2 ? 'double-linked' : 'linked') : 'lone'}</b></div>`;
  const grows = world.growthFrom(c.elevationZone);
  if (grows.length) html += `<div class="kv"><span>Converted</span><b>${grows.length} neighbour${grows.length > 1 ? 's' : ''}</b></div>`;
  html += `<div class="kv"><span>Site</span><b>${(broot.x / 1000).toFixed(1)}, ${(broot.y / 1000).toFixed(1)} km</b></div></div>`;

  html += `<div class="lvl"><h4><i style="background:${LEVEL_COLORS.sub}"></i>Subbiome ${ij(c.sub)}</h4>`;
  if (c.subRaw !== c.sub) html += `<div class="kv"><span>Raw cell</span><b>${ij(c.subRaw)} → ${ij(c.sub)}</b></div>`;
  const st = world.subTarget(c.sub);
  html += `<div class="kv"><span>Merged</span><b>${c.subMerged ? (st >= 0 ? `joins ${ij(st)}` : 'yes (group root)') : 'no'}</b></div>`;
  html += `<div class="kv"><span>Neighbours</span><b>${world.subNbrs(world.sub(c.sub)).length}</b></div></div>`;
  const nr = rivers?.nearestNode(pt.x, pt.y, rivers.p.step * 1.5);
  if (nr) {
    const { r, k } = nr;
    const root = r.tree[k];
    const ocean = r.rootOcean[r.roots.indexOf(root)];
    html += `<div class="lvl"><h4><i style="background:#3f93dc"></i>River</h4>`;
    html += `<div class="kv" title="Attractors reached at this node and everything upstream: sets the line width"><span>Flow here</span><b>${r.flow[k]} attractors</b></div>`;
    html += `<div class="kv" title="All attractors this river reached"><span>Whole river</span><b>${r.flow[root]} attractors</b></div>`;
    html += `<div class="kv" title="The river's root: the point of the ocean elevation zone it drains into"><span>Root</span><b>${(r.x[root] / 1000).toFixed(1)}, ${(r.y[root] / 1000).toFixed(1)} km</b></div>`;
    if (ocean !== undefined) html += `<div class="kv"><span>Drains into</span><b>ocean elevation zone ${ij(ocean)}</b></div>`;
    html += '</div>';
  }
  html += `<p class="muted small">${pt.pinned ? 'Pinned — Esc to release.' : 'Click to pin.'} Cell ids are lattice indices (i, j).</p>`;
  host.innerHTML = html;
}

// ------------------------------------------------------------------ view statistics

export interface ViewStats {
  samples: number;
  oceanShare: number;
  regions: number;
  elevationZones: number;
  subs: number;
  /** ocean elevation zones (merged roots) by ORIGIN code */
  origins: Map<number, number>;
  oceanElevationZones: number;
  seeds: number;
  linkedSeeds: number;
  links: number;
  elevationZonesPerRegion: number;
  subsPerElevationZone: number;
  /** merged groups */
  elevationZoneGroups: number;
  elevationZoneGroupMax: number;
  elevationZoneMembers: number;
  elevationZoneRaw: number;
  subGroups: number;
  subMembers: number;
  subRaw: number;
  detail: boolean;
  rivers: RiverStats | null;
  ms: number;
}

export interface RiverStats {
  regions: number;
  pending: number;
  rivers: number;
  attractors: number;
  reached: number;
  largest: number;
  nodes: number;
  bridges: number;
  landlocked: number;
  ms: number;
}

/** River totals over the computed regions whose site is in view. */
function riverStats(world: World, rivers: Rivers, x0: number, y0: number, x1: number, y1: number): RiverStats {
  const s: RiverStats = { regions: 0, pending: 0, rivers: 0, attractors: 0, reached: 0, largest: 0, nodes: 0, bridges: 0, landlocked: 0, ms: 0 };
  for (const rk of World.cellsIn(world.regionLevel, x0, y0, x1, y1, 0)) {
    const rr = rivers.peek(rk);
    if (!rr) {
      s.pending++;
      continue;
    }
    s.regions++;
    for (const k of rr.roots) {
      if (rr.flow[k] > 0) s.rivers++;
      s.largest = Math.max(s.largest, rr.flow[k]);
    }
    s.attractors += rr.ax.length;
    s.reached += rr.reached;
    s.nodes += rr.n;
    s.bridges += rr.bridges;
    if (rr.landlocked) s.landlocked++;
    s.ms += rr.ms;
  }
  return s;
}

export function computeViewStats(world: World, x0: number, y0: number, x1: number, y1: number, detail: boolean, rivers: Rivers | null = null): ViewStats {
  const t0 = performance.now();
  const nx = 120;
  const ny = Math.max(20, Math.round((nx * (y1 - y0)) / Math.max(1, x1 - x0)));
  const regions = new Set<number>();
  const elevationZones = new Set<number>();
  /** genesis per raw elevation zone (merged groups can mix seed, chain and growth) */
  const raw = new Map<number, number>();
  const subs = new Set<number>();
  let ocean = 0;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const c = world.cellAt(x0 + ((x + 0.5) / nx) * (x1 - x0), y0 + ((y + 0.5) / ny) * (y1 - y0), detail);
      if (c.ocean) ocean++;
      regions.add(c.region);
      elevationZones.add(c.elevationZone);
      raw.set(c.elevationZoneRaw, c.origin);
      if (c.sub >= 0) subs.add(c.sub);
    }
  }
  const origins = new Map<number, number>();
  let oceanElevationZones = 0;
  for (const o of raw.values()) {
    if (o === ORIGIN.land) continue;
    oceanElevationZones++;
    origins.set(o, (origins.get(o) ?? 0) + 1);
  }
  let seeds = 0;
  let linkedSeeds = 0;
  let links = 0;
  let owned = 0;
  for (const r of regions) {
    const reg = world.region(r);
    owned += reg.elevationZones.length;
    seeds += reg.seeds.length;
    for (const s of reg.seeds) if (world.baseFlags(s) & LINKED) linkedSeeds++;
    links += world.links(r).length;
  }
  let subOwned = 0;
  let subOwners = 0;
  for (const b of elevationZones.keys()) {
    if (subOwners >= 120) break;
    subOwned += world.elevationZoneSubs(world.elevationZone(b)).length;
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
  const bg = World.countIn(world.elevationZoneLevel, x0, y0, x1, y1, 0) <= 20000 ? groupSizes(World.cellsIn(world.elevationZoneLevel, x0, y0, x1, y1, 0), (k) => world.elevationZoneRoot(k)) : null;
  const sg =
    detail && World.countIn(world.subLevel, x0, y0, x1, y1, 0) <= 12000 ? groupSizes(World.cellsIn(world.subLevel, x0, y0, x1, y1, 0), (k) => world.subRoot(k)) : null;
  return {
    samples: nx * ny,
    oceanShare: ocean / (nx * ny),
    regions: regions.size,
    elevationZones: elevationZones.size,
    subs: subs.size,
    origins,
    oceanElevationZones,
    seeds,
    linkedSeeds,
    links,
    elevationZonesPerRegion: owned / Math.max(1, regions.size),
    subsPerElevationZone: subOwned / Math.max(1, subOwners),
    elevationZoneGroups: bg?.groups ?? NaN,
    elevationZoneGroupMax: bg?.max ?? NaN,
    elevationZoneMembers: bg?.members ?? NaN,
    elevationZoneRaw: bg?.raw ?? NaN,
    subGroups: sg?.groups ?? NaN,
    subMembers: sg?.members ?? NaN,
    subRaw: sg?.raw ?? NaN,
    detail,
    rivers: rivers ? riverStats(world, rivers, x0, y0, x1, y1) : null,
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
  add('Regions · elevation zones · subbiomes', `${s.regions} · ${s.elevationZones} · ${s.detail ? s.subs : '—'}`, 'Distinct merged cells under the sample grid');
  add('Elevation zones per region', s.elevationZonesPerRegion.toFixed(1), `Owned elevation zones; nominal (${fmtDist(world.regionLevel.size)}/${fmtDist(world.elevationZoneLevel.size)})² = ${((world.regionLevel.size / world.elevationZoneLevel.size) ** 2).toFixed(1)}`);
  add('Subbiomes per elevation zone', s.subsPerElevationZone.toFixed(1), `Owned subbiomes; nominal ${((world.elevationZoneLevel.size / world.subLevel.size) ** 2).toFixed(1)}`);

  sub('Oceans');
  add('Seeds (linked)', `${s.seeds} (${s.linkedSeeds})`, 'Ocean seeds in the regions under the view, and how many take part in a link');
  add('Links', String(s.links));
  add('Ocean elevation zones', String(s.oceanElevationZones));
  const bars = document.createElement('div');
  for (const g of GENESIS) {
    if (g.origin === ORIGIN.land) continue;
    const n = s.origins.get(g.origin) ?? 0;
    if (!n && g.origin >= ORIGIN.grow + world.p.growPasses) continue;
    const f = n / Math.max(1, s.oceanElevationZones);
    const row = document.createElement('div');
    row.className = 'obar';
    row.innerHTML = `<span>${esc(g.name)}</span><i style="width:${(f * 100).toFixed(1)}%;background:${cssRgb(g.rgb)}"></i><em>${n}</em>`;
    bars.append(row);
  }
  host.append(bars);

  sub('Merges');
  add(
    'Elevation zone groups',
    Number.isFinite(s.elevationZoneGroups) ? `${s.elevationZoneGroups} · ${pct(s.elevationZoneMembers / Math.max(1, s.elevationZoneRaw), 0)} of cells · max ${s.elevationZoneGroupMax}` : 'zoom in',
    'Merged elevation zone groups among elevation zones whose site is in view, share of raw elevation zones in a group, and the largest group',
  );
  add(
    'Subbiome groups',
    Number.isFinite(s.subGroups) ? `${s.subGroups} · ${pct(s.subMembers / Math.max(1, s.subRaw), 0)} of cells` : 'zoom in',
    'Merged subbiome groups among subbiomes whose site is in view',
  );

  if (s.rivers) {
    const r = s.rivers;
    sub('Rivers');
    add('Regions computed', `${r.regions}${r.pending ? ` (+${r.pending} pending)` : ''}`, 'Regions whose site is in view; rivers are grown per region');
    add('Rivers', String(r.rivers), 'River mouths with at least one attractor upstream');
    add('Attractors reached', `${r.reached} / ${r.attractors}`, 'Every attractor of a region is reached unless the region finds no ocean to drain into');
    add('Largest river', `${r.largest} attractors`);
    add('Nodes · bridges', `${r.nodes} · ${r.bridges}`, 'Bridges: straight runs added when no attractor was within the influence radius');
    if (r.landlocked) add('Landlocked regions', String(r.landlocked), 'Regions with no ocean next to their land: roots come from the nearest ocean further out');
    add('Time per region', r.regions ? `${(r.ms / r.regions).toFixed(0)} ms` : '—');
  }

  sub('Performance');
  const c = extra.cache;
  add('Last full render', extra.render > 0 ? `${extra.render.toFixed(0)} ms` : '…');
  add('Statistics pass', `${s.ms.toFixed(0)} ms`);
  add('Cached cells', `${c.regions} · ${c.elevationZones} · ${c.subs}`, 'Memoised regions · elevation zones · subbiomes. The caches are dropped when they grow too large; results never change.');
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
