/** Legend, level box, inspector, view statistics and the ruler readout. */
import { cssRgb, hashColor } from '@shared/render/colormaps';
import { esc } from '@shared/ui/html';
import { keyI, keyJ } from '../world/level';
import type { LakeBlock, Lakes } from '../world/lakes';
import type { Rivers } from '../world/rivers';
import { LINKED, ORIGIN, SEED, World } from '../world/world';
import { fmtDist, LAKE_FILL, TRAVEL, TRAVEL_COLORS, TRAVEL_DASH, travelDays, viabilityColor, type TravelStyle } from '../render/overlays';
import { CITY_DEPTH, FACTOR_NAMES, FACTORS, NO_BORDER, type Candidate, type Factor, type Location, type Locations, type RegionLocations } from '../world/locations';
import { GENESIS, heightColor, keyHash, type ViewMode } from '../render/source';
import { ELEVATION_ZONE_TYPES, elevationZoneType } from '../world/zones';
import type { Terrain } from '../world/terrain';
import { fieldAt, type Climate, type NoiseFieldParams } from '../world/climate';
import { rampRgb, STOPS, type ClimateField } from '../render/climate';
import { BELTS, BIOMES, dryThreshold, MANGROVE_BIOME, MANGROVE_ZONES, MOISTURE, type BiomeInfo, type BiomeParams, type Biomes } from '../world/biomes';

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
  map: ['Map', 'Each elevation zone is coloured by its type (ocean, flat, lowland, hills, mountains), lighter/darker per subbiome. Colour by Biomes for the biome of each subbiome. Turn on Hillshade to see the height map.'],
  biomes: [
    'Biomes',
    'One biome per subbiome, from the initial temperature (cooled with the subbiome’s height by the cooling curve) and precipitation at its site; river-poor flat zones are drier. Heights come from the terrain as it is computed, a typical height per elevation zone type until then. Zoomed far out, each elevation zone shows the biome at its site.',
  ],
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

const CLIMATE_NAMES: Record<ClimateField, [string, string]> = { temperature: ['Initial temperature', '°C'], precipitation: ['Initial precipitation', 'mm/yr'], prosperity: ['Prosperity', ''], supernatural: ['Supernatural', ''] };

/** A gradient bar over [min, max] for one climate overlay (drawn at 50 % on the map). */
function climateBar(c: ClimateLegend): string {
  const [name, unit] = CLIMATE_NAMES[c.field];
  const at = (t: number) => fieldAt(c.p, t);
  const stops = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map((t) => `${cssRgb(rampRgb(STOPS[c.field], at(t)))} ${t * 100}%`).join(',');
  const fmt = (v: number) => (unit ? `${+v.toPrecision(3)} ${unit}` : `${+v.toPrecision(3)}`);
  return (
    `<div class="lg-clim"><div class="lg-clim-name">${esc(name)} <em>overlay · 50 %</em></div>` +
    `<div class="lg-bar" style="background:linear-gradient(90deg,${stops})"></div>` +
    `<div class="lg-clim-ends"><span>${fmt(at(0))}</span><span>${fmt(at(0.5))}${c.p.log ? ' (log)' : ''}</span><span>${fmt(at(1))}</span></div></div>`
  );
}

/** The viability scale of the locations overlay, with the part the threshold hides dimmed. */
function locationBar(min: number): string {
  const stops = [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100].map((v) => `${viabilityColor(v)} ${v}%`).join(',');
  const cut = Math.min(100, Math.max(0, min));
  return (
    `<div class="lg-clim"><div class="lg-clim-name">Location viability <em>${cut > 0 ? `showing ≥ ${cut}` : 'showing all'}</em></div>` +
    `<div class="lg-bar lg-via" style="background:linear-gradient(90deg,${stops})">${cut > 0 ? `<i style="width:${cut}%"></i>` : ''}</div>` +
    `<div class="lg-clim-ends"><span>0 poor</span><span>◆ city · ● town</span><span>100</span></div></div>`
  );
}

/** The line styles of the travel network overlay. */
function travelKey(style: TravelStyle): string {
  const line = (mode: 'road' | 'river' | 'sea', name: string) =>
    `<span><svg width="30" height="8" viewBox="0 0 30 8" aria-hidden="true"><line x1="1" y1="4" x2="29" y2="4" stroke="rgba(8,10,14,0.9)" stroke-width="5" stroke-linecap="round"/>` +
    `<line x1="1" y1="4" x2="29" y2="4" stroke="${TRAVEL_COLORS[mode]}" stroke-width="2"${TRAVEL_DASH[mode].length ? ` stroke-dasharray="${TRAVEL_DASH[mode].join(' ')}"` : ''}/></svg>${name}</span>`;
  return (
    `<div class="lg-clim"><div class="lg-clim-name">Travel network <em>${style === 'simple' ? 'straight lines' : 'following the terrain'}</em></div>` +
    `<div class="lg-travel">${line('road', 'Road')}${line('river', 'River route')}${line('sea', 'Sea lane')}</div></div>`
  );
}

/** `locMin`: the viability threshold of the locations overlay (null = the overlay is off). `travel`: the style of the travel network overlay (null = off). */
export function renderLegend(host: HTMLElement, mode: ViewMode, oceanShare: number | null, passes: number, climate: ClimateLegend[] = [], locMin: number | null = null, travel: TravelStyle | null = null): void {
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
  } else if (mode === 'biomes') {
    html += '<div class="lg-cats two">';
    for (const b of BIOMES) html += sw(cssRgb(b.rgb), b.name);
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
  if (locMin !== null) html += locationBar(locMin);
  if (travel !== null) html += travelKey(travel);
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

/** The inspector rows of a subbiome's biome: the biome and every input that picked it. */
function biomeRows(b: BiomeInfo, bp: BiomeParams): string {
  const sparseDry = bp.sparseDry;
  const biome = BIOMES[b.biome];
  let html = `<div class="lvl"><h4><i style="background:${cssRgb(biome.rgb)}"></i>Biome</h4>`;
  // light text on the dark forest greens and the ocean, dark text on the rest
  const [r, g, bl] = biome.rgb;
  const ink = 0.299 * r + 0.587 * g + 0.114 * bl < 120 ? '#f2f5f7' : '#0b0e13';
  html += `<div class="kv"><span>Biome</span><b><span class="chip" style="background:${cssRgb(biome.rgb)};color:${ink}">${esc(biome.name)}</span></b></div>`;
  if (b.ocean) return html + '</div>';
  const pth = dryThreshold(b.t);
  html += `<div class="kv" title="Thermal belt from the temperature after the height cooling · moisture class from the aridity"><span>Belt · moisture</span><b>${esc(BELTS[b.belt].name)} · ${esc(MOISTURE[b.moisture].toLowerCase())}</b></div>`;
  html += `<div class="kv" title="Precipitation / Köppen dryness threshold 20·T + 140 mm. Below 0.5 desert, 0.5–1 steppe, 1–2 woodland / savanna, then forest and rainforest (≥ 6 temperate, ≥ 4 tropical)"><span>Aridity P / P_th</span><b>${b.aridity.toFixed(2)} · P_th ${pth.toFixed(0)} mm</b></div>`;
  const hTxt = b.heightExact ? `${b.height.toFixed(0)} m · subbiome mean` : `≈ ${b.height.toFixed(0)} m · typical ${esc(ELEVATION_ZONE_TYPES[b.zoneType].name.toLowerCase())}`;
  const hTitle = b.heightExact
    ? 'Mean height of the subbiome’s land, from its terrain tile'
    : 'The terrain tile is not computed yet (it is computed while colouring by Biomes or Height, zoomed in): a typical height for the elevation zone type stands in';
  html += `<div class="kv" title="${hTitle}"><span>Height</span><b>${hTxt}</b></div>`;
  const cool = b.cooling !== 0 ? ` − ${b.cooling.toFixed(1)} = ${b.t.toFixed(1)} °C` : '';
  html += `<div class="kv" title="Initial temperature at the subbiome’s site, minus the cooling curve (Biomes section, points 1–5) at the subbiome’s height [clim.t.*, bio.cool.*]"><span>Site temperature</span><b>${b.t0.toFixed(1)} °C${cool}</b></div>`;
  const pTxt = b.sparse ? `${b.p0.toFixed(0)} × ${sparseDry} = ${b.p.toFixed(0)} mm/yr` : `${b.p0.toFixed(0)} mm/yr`;
  html += `<div class="kv" title="Initial precipitation at the subbiome’s site${b.sparse ? ', × the sparse-flat factor: this is a river-poor flat elevation zone, which favours desert' : ''} [clim.p.*, bio.sparseDry]"><span>Site precipitation</span><b>${pTxt}</b></div>`;
  if (b.sparse) html += `<div class="kv" title="The elevation zone is flat and its site gets less initial precipitation than the sparse river cutoff: few rivers, drier biomes [ez.flatSparseP, bio.sparseDry]"><span>Sparse flat zone</span><b>yes · drier</b></div>`;
  if (b.coastal) {
    const why =
      b.biome === MANGROVE_BIOME
        ? 'mangrove'
        : !MANGROVE_ZONES.has(b.zoneType)
          ? `no mangrove · ${ELEVATION_ZONE_TYPES[b.zoneType].name.toLowerCase()}`
          : b.t < bp.mangroveT
            ? `no mangrove · < ${bp.mangroveT} °C`
            : `no mangrove · aridity < ${bp.mangroveM}`;
    html += `<div class="kv" title="The subbiome borders an ocean subbiome. Coastal subbiomes of flat and lowland elevation zones become mangrove when the temperature and the aridity reach the mangrove minimums [bio.mangroveT, bio.mangroveM]"><span>Ocean coast</span><b>yes · ${why}</b></div>`;
  }
  if (b.seaLevel !== b.biome) html += `<div class="kv" title="The biome the sea-level temperature would give: the height changed it"><span>At sea level</span><b>${esc(BIOMES[b.seaLevel].name)}</b></div>`;
  return html + '</div>';
}

/** The locations overlay as the inspector sees it: a location within `reach` metres of the cursor is picked up. */
export interface LocationProbe {
  locations: Locations;
  reach: number;
  /** the viability threshold on show */
  min: number;
}

/** The terms behind each factor of a candidate, for the inspector. */
const FACTOR_TERMS: Record<Factor, (c: Candidate) => string> = {
  resources: (c) => `food ${c.food.toFixed(2)} · water ${c.water.toFixed(2)} · materials ${c.materials.toFixed(2)} · fish ${c.fish.toFixed(2)}`,
  geography: (c) => `buildable ${c.buildable.toFixed(2)} · waterside ${c.waterside.toFixed(2)} · defence ${c.defence.toFixed(2)} · ${c.depth >= NO_BORDER ? 'no land border' : `${c.depth} from the border`}`,
  trade: (c) => `gateway ${c.gateway.toFixed(2)} · central place ${c.centrality.toFixed(2)}`,
  climate: (c) => `temperature comfort ${c.comfort.toFixed(2)}`,
  prosperity: () => 'the prosperity map at the spot',
};
const FACTOR_HELP: Record<Factor, string> = {
  resources: 'Food of the catchment (farmland by biome and zone type, river irrigation in dry land; the subbiome and its neighbours), fresh water, building material and fuel (wood, stone, clay) and fish',
  geography: 'Buildable ground (flat and lowland over hills and mountains; mangrove is swamp), a waterside site (river, harbour, coast, lake), defence (high ground, peninsula, confluence) and the depth inside the region',
  trade: 'The better of a gateway (river mouth, sheltered harbour, navigable river, head of navigation, confluence, lake) and a central place (how much of the region’s food lies within a day or two of travel)',
  climate: 'Comfort of the temperature (at the zone type’s typical height) and of the aridity',
  prosperity: 'The prosperity map at the spot [clim.pros.*]',
};

/** Why a land subbiome with this score is not one of its region's locations. */
function notChosen(c: Candidate): string {
  if (c.score <= 0) return c.comfort <= 0 ? 'no · unlivable temperature' : c.water <= 0 ? 'no · no fresh water' : 'no · score 0';
  if (c.depth < 1) return 'no · on the region border';
  return 'no · better sites nearby or elsewhere';
}

/** The inspector rows of a location (or, with `l` null, of the subbiome under the cursor as a site). */
function locationRows(c: Candidate, l: Location | null, rl: RegionLocations, lp: LocationProbe): string {
  const color = viabilityColor(c.score);
  const ink = c.score >= 50 ? '#0b0e13' : '#f2f5f7';
  const w = lp.locations.p.weights;
  const total = FACTORS.reduce((a, k) => a + Math.max(0, w[k]), 0);
  const share = (k: Factor) => (total > 0 ? Math.max(0, w[k]) / total : 1 / FACTORS.length);
  const title = l ? `${l.kind === 'city' ? 'City' : 'Town'} location · rank ${l.rank} of ${rl.list.length} in region ${ij(c.region)}` : 'Site viability of this subbiome';
  let html = `<div class="lvl"><h4><i style="background:${color}"></i>${title}</h4>`;
  const hidden = l && l.score < lp.min ? ' · hidden by the slider' : '';
  html += `<div class="kv" title="Combined score: 100 × need × the weighted mean of the five factors below [loc.w*]. Display → Location viability hides locations below a score [view.locMin]"><span>Viability</span><b><span class="chip" style="background:${color};color:${ink}">${c.score.toFixed(0)} / 100</span>${hidden}</b></div>`;
  if (!l) html += `<div class="kv" title="A region’s locations are its best-scoring subbiomes that do not touch another region’s land, kept apart by the spacing (cities: at least ${CITY_DEPTH} subbiomes inside) [loc.count, loc.cities, loc.spacing]"><span>Location</span><b>${notChosen(c)}</b></div>`;
  for (const k of FACTORS) {
    html += `<div class="obar loc-bar" title="${FACTOR_HELP[k]}. Weight ${(share(k) * 100).toFixed(0)} % of the score"><span>${FACTOR_NAMES[k]}</span><i style="width:${(c[k] * 100).toFixed(1)}%;background:${viabilityColor(c[k] * 100)}"></i><em>${c[k].toFixed(2)}</em></div>`;
    html += `<div class="loc-terms">${FACTOR_TERMS[k](c)}</div>`;
  }
  if (c.need < 1) {
    const what = c.water < c.comfort ? `fresh water ${c.water.toFixed(2)}` : `temperature comfort ${c.comfort.toFixed(2)}`;
    html += `<div class="kv" title="Necessities: the score is scaled by min(water, temperature comfort) × 2, capped at 1"><span>Limited by</span><b>${what} · × ${c.need.toFixed(2)}</b></div>`;
  }
  if (c.features.length) html += `<div class="kv" title="${esc(c.features.join(', '))}"><span>Stands out</span><b>${esc(c.features.join(', '))}</b></div>`;
  if (c.river > 0) html += `<div class="kv" title="The largest river in the subbiome: subbiomes it drains upstream (navigable from 20, large from 80)${c.mouth > 0 ? '; it meets the sea here' : ''}"><span>River</span><b>${c.river.toFixed(1)} subbiomes upstream${c.mouth > 0 ? ' · mouth' : ''}</b></div>`;
  html += `<div class="kv" title="The spot: on the subbiome’s river (its mouth, or where it is largest) when it has one, otherwise the subbiome’s site"><span>Spot</span><b>${(c.x / 1000).toFixed(1)}, ${(c.y / 1000).toFixed(1)} km · ${c.onRiver ? 'on the river' : 'subbiome site'}</b></div>`;
  return html + '</div>';
}

export function renderInspector(host: HTMLElement, world: World | null, rivers: Rivers | null, pt: Probe | null, terrain: Terrain | null = null, climate: Climate | null = null, biomes: Biomes | null = null, lakes: Lakes | null = null, loc: LocationProbe | null = null): void {
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
    if (t) html += `<div class="kv" title="Tile raster (a block of k × k regions, 2 × 2 by default): cells · cells raised by the pit fill (largest raise) · compute time [hgt.res]"><span>Terrain raster</span><b>${t.nx}×${t.ny} · ${t.filled} filled (≤ ${t.maxFill.toFixed(1)} m) · ${t.ms.toFixed(0)} ms</b></div>`;
  }

  if (climate) {
    html += `<div class="kv" title="Initial temperature map (Perlin noise) [clim.t.*]"><span>Initial temperature</span><b>${climate.temperatureAt(pt.x, pt.y).toFixed(1)} °C</b></div>`;
    html += `<div class="kv" title="Initial precipitation map (Perlin noise) [clim.p.*]"><span>Initial precipitation</span><b>${climate.precipitationAt(pt.x, pt.y).toFixed(0)} mm/yr</b></div>`;
    html += `<div class="kv" title="Prosperity map (Perlin noise, unitless index) [clim.pros.*]"><span>Prosperity</span><b>${climate.prosperityAt(pt.x, pt.y).toFixed(1)}</b></div>`;
    html += `<div class="kv" title="Supernatural map (Perlin noise, unitless index): how strong magic is here [clim.sup.*]"><span>Supernatural</span><b>${climate.supernaturalAt(pt.x, pt.y).toFixed(1)}</b></div>`;
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
    html += `<div class="kv" title="Growth iterations · nodes · straight bridges over gaps wider than dᵢ · compute time [riv.influence]"><span>Growth</span><b>${rr.iterations} it · ${rr.n} nodes · ${rr.bridges} br · ${rr.ms.toFixed(0)} ms</b></div>`;
  }
  const rl = loc?.locations.peek(c.region);
  if (rl) {
    const cities = rl.list.filter((l) => l.kind === 'city').length;
    const shown = rl.list.filter((l) => l.score >= loc!.min).length;
    const best = rl.list.length ? ` · best ${rl.list[0].score.toFixed(0)}` : '';
    html += `<div class="kv" title="Potential city and town locations of the region (cities among them) · the best viability score · how many the viability slider leaves on show · the selection kept them at least ${(rl.spacing / 1000).toFixed(1)} km apart [loc.*, view.locMin]"><span>Locations</span><b>${rl.list.length} · ${cities} cit${cities === 1 ? 'y' : 'ies'}${best} · ${shown} shown</b></div>`;
  }
  html += '</div>';

  // the location under the cursor, or else the subbiome under it as a site
  if (loc) {
    const near = loc.locations.nearest(pt.x, pt.y, loc.reach, loc.min);
    const nrl = near ? loc.locations.peek(near.region) : rl;
    const cand = near ?? (c.ocean ? null : (rl?.bySub.get(c.sub) ?? null));
    if (cand && nrl) html += locationRows(cand, near, nrl, loc);
  }

  const typeName = ELEVATION_ZONE_TYPES[elevationZoneType(c.elevationZone, c.ocean)].name;
  const g = GENESIS.find((x) => x.origin === c.origin);
  const chipColor = g ? cssRgb(g.rgb) : '#888';
  html += `<div class="lvl"><h4><i style="background:${LEVEL_COLORS.elevationZone}"></i>Elevation zone ${ij(c.elevationZone)}</h4>`;
  html += `<div class="kv"><span>Class</span><b><span class="chip" style="background:${chipColor}">${esc(genesisName(c.origin))}</span></b></div>`;
  html += `<div class="kv"><span>Type</span><b>${esc(typeName)}</b></div>`;
  if (rivers && !c.ocean && ELEVATION_ZONE_TYPES[elevationZoneType(c.elevationZone, false)].id === 'flat') {
    const cut = rivers.p.flatSparseCutoff;
    const precip = rivers.climate.precipitationAt(broot.x, broot.y);
    const sparse = rivers.isSparseFlat(c.elevationZone);
    const why = cut > 0 ? `${precip.toFixed(0)} ${sparse ? '<' : '≥'} ${cut.toFixed(0)} mm/yr` : 'cutoff off';
    html += `<div class="kv" title="A flat elevation zone whose site gets less initial precipitation than “Flat: sparse river precipitation cutoff” is river-poor: each of its subbiomes gets only 0 or 1 river attractor [ez.flatSparseP]"><span>Sparse rivers</span><b>${sparse ? 'yes' : 'no'} · ${why}</b></div>`;
  }
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
  html += `<div class="kv"><span>Neighbours</span><b>${world.subNbrs(world.sub(c.sub)).length}</b></div>`;
  if (lakes && lakes.p.frequency > 0) {
    const why = c.ocean ? 'ocean' : lakes.block(c.subRaw);
    html += `<div class="kv" title="${LAKE_RULES} [lake.*]"><span>Lakes</span><b>${why ? `none · ${LAKE_BLOCK[why]}` : 'allowed'}</b></div>`;
  }
  html += '</div>';
  if (biomes) html += biomeRows(biomes.ofSub(c.sub), biomes.p);
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
  const lake = lakes?.lakeAt(pt.x, pt.y);
  if (lake) {
    const rl = lakes!.peek(lake.region)!;
    html += `<div class="lvl"><h4><i style="background:${LAKE_FILL}"></i>Lake ${lake.id + 1} of ${rl.lakes.length} in region ${ij(lake.region)}</h4>`;
    html += `<div class="kv" title="Diameter of a circle with the lake’s area, after the clip to the land it may cover · nominal size drawn for it [lake.min, lake.max]"><span>Size</span><b>${(lake.size / 1000).toFixed(2)} km · nominal ${(lake.nominal / 1000).toFixed(2)} km</b></div>`;
    html += `<div class="kv"><span>Area</span><b>${(lake.area / 1e6).toFixed(2)} km²</b></div>`;
    html += `<div class="kv" title="Every lake is centred on a river node: attractors reached upstream of it"><span>On river</span><b>flow ${lake.flow} attractors</b></div>`;
    html += `<div class="kv"><span>Placed in subbiome</span><b>${ij(lake.sub)}</b></div>`;
    html += `<div class="kv"><span>Centre</span><b>${(lake.cx / 1000).toFixed(1)}, ${(lake.cy / 1000).toFixed(1)} km</b></div>`;
    html += `<div class="kv" title="Subbiomes that may hold a lake and have a river in them · of those, passed the frequency roll · dropped because too close to another lake · dropped because the clip left them below the minimum size · compute time [lake.freq]"><span>Region tries</span><b>${rl.candidates} with river · ${rl.tries} rolled · ${rl.crowded} crowded · ${rl.tooSmall} too small · ${rl.ms.toFixed(0)} ms</b></div>`;
    html += '</div>';
  }
  html += `<p class="muted small">${pt.pinned ? 'Pinned — Esc to release.' : 'Click to pin.'} Cell ids are lattice indices (i, j).</p>`;
  host.innerHTML = html;
}

const LAKE_RULES = 'No lakes in ocean or mountains elevation zones, in desert subbiomes (hot or cold desert at sea level) or in restricted subbiomes (in a river-poor flat elevation zone); lakes never cross a region border';
const LAKE_BLOCK: Record<Exclude<LakeBlock, null>, string> = {
  ocean: 'ocean',
  mountains: 'mountains zone',
  desert: 'desert at sea level',
  restricted: 'restricted (river-poor flat zone)',
};

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
  add('Elevation zones per region', s.elevationZonesPerRegion.toFixed(1), `Owned elevation zones; nominal (${fmtDist(world.regionLevel.size)}/${fmtDist(world.elevationZoneLevel.size)})² = ${((world.regionLevel.size / world.elevationZoneLevel.size) ** 2).toFixed(1)} [reg.size, ez.size]`);
  add('Subbiomes per elevation zone', s.subsPerElevationZone.toFixed(1), `Owned subbiomes; nominal ${((world.elevationZoneLevel.size / world.subLevel.size) ** 2).toFixed(1)} [ez.size, sub.size]`);

  sub('Oceans');
  add('Seeds (linked)', `${s.seeds} (${s.linkedSeeds})`, 'Ocean seeds in the regions under the view, and how many take part in a link [reg.oceanMin, reg.oceanMax, oc.connect, oc.double]');
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
