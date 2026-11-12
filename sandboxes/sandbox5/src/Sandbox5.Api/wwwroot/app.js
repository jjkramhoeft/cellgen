// Sandbox 5 demo site: a viewer on top of the REST API. The map is drawn from PNG tiles
// (api/map/tiles/{z}/{x}/{y}.png) and the inspector shows what api/map/at returns for a
// point. No build step and no dependencies: this file is served as it is.

const TILE = 256;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v, d = 0) => Number(v).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
const km = (m, d = 1) => fmt(m / 1000, d);

async function getJSON(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  return res.json();
}

// ------------------------------------------------------------------ state

/** The layers of a map image: [query name, label, key, settings parameter]. */
const LAYERS = [
  ['hillshade', 'Hillshade', 'H', 'view.hillshade'],
  ['rivers', 'Rivers', 'V', 'riv.on'],
  ['lakes', 'Lakes', '', 'riv.on'],
  ['locations', 'City & town locations', 'C', 'view.locations'],
  ['travel', 'Travel network', 'P', 'view.travel'],
  ['regEdges', 'Region borders', '', 'view.regEdges'],
  ['zoneEdges', 'Elevation zone borders', 'B', 'view.zoneEdges'],
  ['patchEdges', 'Patch borders', 'N', 'view.patchEdges'],
  ['coast', 'Coastline', '', 'view.coast'],
];

let api; // the API index: tile scheme, default seed
let catalog; // fixed catalogues and colour modes
let defaults; // what the server draws when a request names no layer (from defaults.json)
const state = { seed: '', x: 0, y: 0, z: 4, color: 'map', locMin: 59, travelStyle: 'terrain', pin: null };
for (const [name] of LAYERS) state[name] = false;

let inspected = null; // the last api/map/at document shown in the inspector
let showRaw = false;

const mppOf = (z) => api.tiles.baseMpp / 2 ** z;
/** The pixel of the map element that shows the camera position (whole pixels, so tiles never straddle one). */
const originX = () => Math.floor($('map').clientWidth / 2);
const originY = () => Math.floor($('map').clientHeight / 2);

function readDefaults(settings) {
  const p = settings.params;
  const d = { seed: settings.seed, x: 0, y: 0, z: 4, color: p['view.color'], locMin: p['view.locMin'], travelStyle: p['view.travelStyle'], pin: null };
  for (const [name, , , param] of LAYERS) d[name] = Boolean(p[param]);
  return d;
}

/** The URL hash holds the seed, the camera and every layer that differs from the defaults. */
function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  Object.assign(state, defaults);
  if (q.get('seed')) state.seed = q.get('seed');
  const at = (q.get('at') ?? '').split(',').map(Number);
  if (at.length === 3 && at.every(Number.isFinite)) {
    state.x = at[0] * 1000;
    state.y = at[1] * 1000;
    state.z = Math.max(api.tiles.minZoom, Math.min(api.tiles.maxZoom, Math.round(at[2])));
  }
  if (catalog.colorModes.some((m) => m.id === q.get('color'))) state.color = q.get('color');
  for (const [name] of LAYERS) if (q.has(name)) state[name] = q.get(name) === '1';
  if (q.has('locMin') && Number.isFinite(Number(q.get('locMin')))) state.locMin = Math.max(0, Math.min(100, Number(q.get('locMin'))));
  if (['terrain', 'simple'].includes(q.get('travelStyle'))) state.travelStyle = q.get('travelStyle');
  const pin = (q.get('pin') ?? '').split(',').map(Number);
  state.pin = pin.length === 2 && pin.every(Number.isFinite) ? { x: pin[0] * 1000, y: pin[1] * 1000, patch: null } : null;
}

let hashTimer = 0;
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const q = new URLSearchParams();
    if (state.seed !== defaults.seed) q.set('seed', state.seed);
    q.set('at', `${(state.x / 1000).toFixed(2)},${(state.y / 1000).toFixed(2)},${state.z}`);
    if (state.color !== defaults.color) q.set('color', state.color);
    for (const [name] of LAYERS) if (state[name] !== defaults[name]) q.set(name, state[name] ? '1' : '0');
    if (state.locMin !== defaults.locMin) q.set('locMin', String(state.locMin));
    if (state.travelStyle !== defaults.travelStyle) q.set('travelStyle', state.travelStyle);
    if (state.pin) q.set('pin', `${(state.pin.x / 1000).toFixed(3)},${(state.pin.y / 1000).toFixed(3)}`);
    history.replaceState(null, '', '#' + q.toString().replace(/%2C/g, ','));
  }, 150);
}

/** Query of a map image: the seed and only the layers that differ from the server's defaults. */
function layerQuery() {
  const q = new URLSearchParams();
  if (state.seed !== defaults.seed) q.set('seed', state.seed);
  if (state.color !== defaults.color) q.set('color', state.color);
  for (const [name] of LAYERS) if (state[name] !== defaults[name]) q.set(name, state[name] ? '1' : '0');
  if (state.locMin !== defaults.locMin) q.set('locMin', String(state.locMin));
  if (state.travelStyle !== defaults.travelStyle) q.set('travelStyle', state.travelStyle);
  return q;
}

const seedQuery = () => (state.seed !== defaults.seed ? `seed=${encodeURIComponent(state.seed)}` : '');
const withSeed = (url) => (seedQuery() ? url + (url.includes('?') ? '&' : '?') + seedQuery() : url);

// ------------------------------------------------------------------ tiles

const mapEl = $('map');
const tilesEl = $('tiles');
/** url → { img, z, tx, ty, ready } */
const tiles = new Map();
let layoutQueued = false;

function queueLayout() {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    layout();
  });
}

/** Does a tile reach the pinned patch (so it must be drawn with the outline)? */
function nearPin(z, tx, ty) {
  const pin = state.pin;
  if (!pin || pin.patch == null || mppOf(z) > api.tiles.detailMpp) return false;
  const span = TILE * mppOf(z);
  const reach = 30000; // a merged patch is a few 8 km cells across
  return pin.px + reach >= tx * span && pin.px - reach <= (tx + 1) * span && pin.py + reach >= ty * span && pin.py - reach <= (ty + 1) * span;
}

function layout() {
  const w = mapEl.clientWidth;
  const h = mapEl.clientHeight;
  if (!w || !h) return;
  const mpp = mppOf(state.z);
  const span = TILE * mpp;
  const query = layerQuery().toString();
  const wanted = [];
  const ox = originX();
  const oy = originY();
  tilesEl.style.transform = `translate(${ox}px, ${oy}px)`;
  const tx0 = Math.floor((state.x - ox * mpp) / span);
  const tx1 = Math.floor((state.x + (w - ox) * mpp) / span);
  const ty0 = Math.floor((state.y - oy * mpp) / span);
  const ty1 = Math.floor((state.y + (h - oy) * mpp) / span);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const q = nearPin(state.z, tx, ty) ? (query ? query + '&' : '') + `pin=${state.pin.patch}` : query;
      wanted.push({ tx, ty, url: `api/map/tiles/${state.z}/${tx}/${ty}.png${q ? '?' + q : ''}` });
    }
  }
  // nearest the centre first
  const cx = state.x / span - 0.5;
  const cy = state.y / span - 0.5;
  wanted.sort((a, b) => (a.tx - cx) ** 2 + (a.ty - cy) ** 2 - ((b.tx - cx) ** 2 + (b.ty - cy) ** 2));
  const keep = new Set(wanted.map((t) => t.url));
  let pending = 0;
  for (const t of wanted) {
    let tile = tiles.get(t.url);
    if (!tile) {
      const img = new Image();
      img.alt = '';
      img.draggable = false;
      tile = { img, z: state.z, tx: t.tx, ty: t.ty, ready: false };
      img.onload = () => {
        tile.ready = true;
        img.classList.add('ready');
        queueLayout();
      };
      img.onerror = () => {
        tile.failed = true;
        queueLayout();
      };
      img.src = t.url;
      tiles.set(t.url, tile);
      tilesEl.appendChild(img);
    }
    if (!tile.ready && !tile.failed) pending++;
  }
  // tiles of another zoom or of other layers stay as a placeholder until the wanted ones are in
  for (const [url, tile] of tiles) {
    const current = keep.has(url);
    const tmpp = mppOf(tile.z);
    const scale = tmpp / mpp;
    const left = (tile.tx * TILE * tmpp - state.x) / mpp;
    const top = (tile.ty * TILE * tmpp - state.y) / mpp;
    const size = TILE * scale;
    const visible = left < w - ox && left + size > -ox && top < h - oy && top + size > -oy;
    if (!current && (pending === 0 || !visible || !tile.ready)) {
      tile.img.onload = tile.img.onerror = null;
      tile.img.src = '';
      tile.img.remove();
      tiles.delete(url);
      continue;
    }
    tile.img.className = (current ? 'cur' : 'old') + (tile.ready ? ' ready' : '');
    tile.img.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)${scale !== 1 ? ` scale(${scale})` : ''}`;
  }
  $('busy').hidden = pending === 0;

  const marker = $('pin-marker');
  marker.hidden = !state.pin;
  if (state.pin) {
    marker.style.left = `${ox + (state.pin.x - state.x) / mpp}px`;
    marker.style.top = `${oy + (state.pin.y - state.y) / mpp}px`;
  }
  updateChrome(w, h, mpp);
  writeHash();
}

function updateChrome(w, h, mpp) {
  $('st-pos').textContent = `${km(state.x)}, ${km(state.y)} km`;
  $('st-zoom').textContent = `z${state.z} · ${mpp >= 1000 ? fmt(mpp / 1000, mpp % 1000 ? 2 : 0) + ' km' : fmt(mpp) + ' m'}/px`;
  // scale bar: a round length of about 120 px
  const target = 120 * mpp;
  const pow = 10 ** Math.floor(Math.log10(target));
  const len = [1, 2, 5, 10].map((f) => f * pow).filter((v) => v <= target).pop();
  $('scale').querySelector('i').style.width = `${len / mpp}px`;
  $('scale').querySelector('span').textContent = len >= 1000 ? `${fmt(len / 1000)} km` : `${fmt(len)} m`;
  // what the server leaves out when zoomed far out
  const notes = [];
  if (mpp > api.tiles.maxFeatureMpp && (state.rivers || state.lakes || state.locations || state.travel)) notes.push('rivers, lakes, locations and the travel network');
  if (mpp > api.tiles.maxHeightMpp && (state.hillshade || state.color === 'height')) notes.push('heights');
  $('note').hidden = notes.length === 0;
  $('note').textContent = notes.length ? `Zoom in to see ${notes.join(' and ')}` : '';
  const q = layerQuery();
  q.set('x', String(Math.round(state.x)));
  q.set('y', String(Math.round(state.y)));
  q.set('mpp', String(mpp));
  q.set('width', String(Math.min(4096, w)));
  q.set('height', String(Math.min(4096, h)));
  $('png').href = 'api/map/image.png?' + q.toString();
}

function setZoom(z, px, py) {
  z = Math.max(api.tiles.minZoom, Math.min(api.tiles.maxZoom, z));
  if (z === state.z) return;
  const ox = (px ?? originX()) - originX();
  const oy = (py ?? originY()) - originY();
  // the world point under the cursor stays where it is
  const wx = state.x + ox * mppOf(state.z);
  const wy = state.y + oy * mppOf(state.z);
  state.z = z;
  state.x = wx - ox * mppOf(z);
  state.y = wy - oy * mppOf(z);
  queueLayout();
}

// ------------------------------------------------------------------ pointer and keyboard

const pointers = new Map();
let drag = null;
let pinch = 0;

mapEl.addEventListener('pointerdown', (e) => {
  mapEl.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, moved: 0 };
  else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = Math.hypot(a.x - b.x, a.y - b.y);
    drag = null;
  }
});

mapEl.addEventListener('pointermove', (e) => {
  const rect = mapEl.getBoundingClientRect();
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 && pinch > 0) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > pinch * 1.5 || d < pinch / 1.5) {
      setZoom(state.z + (d > pinch ? 1 : -1), (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      pinch = d;
    }
    return;
  }
  if (drag) {
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved > 4) {
      mapEl.classList.add('dragging');
      state.x -= dx * mppOf(state.z);
      state.y -= dy * mppOf(state.z);
      queueLayout();
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
    return;
  }
  hoverAt(e.clientX - rect.left, e.clientY - rect.top);
});

function endPointer(e) {
  const wasDrag = drag;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = 0;
  if (pointers.size === 0) {
    drag = null;
    mapEl.classList.remove('dragging');
    if (wasDrag && wasDrag.moved <= 4 && e.type === 'pointerup') {
      const rect = mapEl.getBoundingClientRect();
      const p = toWorld(e.clientX - rect.left, e.clientY - rect.top);
      inspect(p.x, p.y);
    }
  }
}
mapEl.addEventListener('pointerup', endPointer);
mapEl.addEventListener('pointercancel', endPointer);
mapEl.addEventListener('pointerleave', () => {
  clearTimeout(hoverTimer);
  $('st-hover').textContent = '';
});

let wheelAcc = 0;
mapEl.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) < 60) return;
    const rect = mapEl.getBoundingClientRect();
    setZoom(state.z + (wheelAcc < 0 ? 1 : -1), e.clientX - rect.left, e.clientY - rect.top);
    wheelAcc = 0;
  },
  { passive: false },
);

function toWorld(px, py) {
  const mpp = mppOf(state.z);
  return { x: state.x + (px - originX()) * mpp, y: state.y + (py - originY()) * mpp };
}

function setLayer(name, on) {
  state[name] = on;
  const box = document.querySelector(`#layers input[data-layer="${name}"]`);
  if (box) box.checked = on;
  queueLayout();
}

function setColor(id) {
  state.color = id;
  $('color').value = id;
  renderLegend();
  queueLayout();
}

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.ctrlKey || e.metaKey || e.altKey) return;
  const step = 96 * mppOf(state.z);
  const modes = catalog.colorModes.map((m) => m.id);
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const layer = LAYERS.find((l) => l[2] && l[2].toLowerCase() === key);
  if (key === '+' || key === '=') setZoom(state.z + 1);
  else if (key === '-' || key === '_') setZoom(state.z - 1);
  else if (key === '0') {
    state.x = 0;
    state.y = 0;
    queueLayout();
  } else if (key === 'ArrowLeft') (state.x -= step), queueLayout();
  else if (key === 'ArrowRight') (state.x += step), queueLayout();
  else if (key === 'ArrowUp') (state.y -= step), queueLayout();
  else if (key === 'ArrowDown') (state.y += step), queueLayout();
  else if (key === 'r') setSeed(randomSeed());
  else if (key === '[') setColor(modes[(modes.indexOf(state.color) + modes.length - 1) % modes.length]);
  else if (key === ']') setColor(modes[(modes.indexOf(state.color) + 1) % modes.length]);
  else if (key >= '1' && key <= '9' && modes[Number(key) - 1]) setColor(modes[Number(key) - 1]);
  else if (layer) setLayer(layer[0], !state[layer[0]]);
  else if (key === 'Escape') clearPin();
  else if (key === '?') $('help').showModal();
  else return;
  e.preventDefault();
});

// ------------------------------------------------------------------ seed

function randomSeed() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let s = '';
  for (let k = 0; k < 6; k++) s += letters[Math.floor(Math.random() * letters.length)];
  return s;
}

async function setSeed(seed) {
  seed = seed.trim() || defaults.seed;
  if (seed === state.seed) return;
  state.seed = seed;
  $('seed').value = seed;
  clearPin();
  queueLayout();
  await showMapInfo();
}

async function showMapInfo() {
  try {
    const info = await getJSON(withSeed('api'));
    $('seed-value').textContent = info.seedValue;
    $('fingerprint').textContent = info.fingerprint;
  } catch (e) {
    $('fingerprint').textContent = e.message;
  }
}

// ------------------------------------------------------------------ hover and inspector

let hoverTimer = 0;
let hoverAbort = null;

function hoverAt(px, py) {
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(async () => {
    hoverAbort?.abort();
    hoverAbort = new AbortController();
    const p = toWorld(px, py);
    try {
      const d = await getJSON(withSeed(`api/map/at?x=${Math.round(p.x)}&y=${Math.round(p.y)}&tolerance=${Math.round(6 * mppOf(state.z))}`), hoverAbort.signal);
      const parts = [`${km(p.x)}, ${km(p.y)} km`, `region (${d.region.i}, ${d.region.j})`, d.elevationZone.typeName, d.patch.biomeName];
      if (!d.ocean) parts.push(`${fmt(d.height)} m`);
      if (d.lake) parts.push('lake');
      else if (d.river && !d.river.overSea) parts.push(`river · flow ${d.river.flow}`);
      if (d.location) parts.push(`${d.location.kind} · score ${fmt(d.location.score)}`);
      $('st-hover').textContent = parts.join(' · ');
    } catch (e) {
      if (e.name !== 'AbortError') $('st-hover').textContent = e.message;
    }
  }, 140);
}

let inspectAbort = null;

async function inspect(x, y) {
  inspectAbort?.abort();
  inspectAbort = new AbortController();
  state.pin = { x, y, patch: null };
  queueLayout();
  $('inspector').innerHTML = '<p class="muted empty">Reading the map…</p>';
  try {
    const d = await getJSON(withSeed(`api/map/at?x=${Math.round(x)}&y=${Math.round(y)}&tolerance=${Math.round(6 * mppOf(state.z))}`), inspectAbort.signal);
    inspected = d;
    // the tiles around the patch are redrawn with its outline
    state.pin = { x, y, patch: d.patch.key, px: d.patch.x, py: d.patch.y };
    renderInspector();
    queueLayout();
  } catch (e) {
    if (e.name === 'AbortError') return;
    inspected = null;
    $('inspector').innerHTML = `<p class="error empty">${esc(e.message)}</p>`;
  }
}

function clearPin() {
  inspectAbort?.abort();
  state.pin = null;
  inspected = null;
  $('unpin').hidden = true;
  $('raw-toggle').hidden = true;
  $('inspector').innerHTML = '<p class="muted empty">Click the map to inspect a point: its region, elevation zone and patch, the biome with its climate and height, the resources, and the river, lake or location there.</p>';
  queueLayout();
}

const kv = (label, value, cls = '') => `<div class="kv"><span>${esc(label)}</span><b class="${cls}">${value}</b></div>`;
const bar = (label, v, text) => `<div class="bar"><span>${label}</span><i><u style="width:${Math.max(0, Math.min(1, v)) * 100}%"></u></i><em>${text ?? fmt(v, 2)}</em></div>`;
const chips = (items, strong = false) => (items.length ? `<div class="chips">${items.map((f) => `<span class="chip${strong ? ' strong' : ''}">${esc(f)}</span>`).join('')}</div>` : '');
const link = (href, text) => `<a href="${esc(withSeed(href))}" target="_blank" rel="noopener">${esc(text)}</a>`;
const yes = (b) => (b ? 'yes' : 'no');

function viabilityColor(score) {
  const stops = [
    [0, 75, 42, 107],
    [35, 184, 64, 94],
    [65, 240, 138, 36],
    [100, 255, 243, 176],
  ];
  const v = Math.max(0, Math.min(100, score));
  let k = 1;
  while (k < stops.length - 1 && v > stops[k][0]) k++;
  const a = stops[k - 1];
  const b = stops[k];
  const t = (v - a[0]) / (b[0] - a[0]);
  return `rgb(${[1, 2, 3].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)).join(',')})`;
}

function factorBars(f) {
  return `<div class="bars">${bar('Resources', f.resources)}${bar('Geography', f.geography)}${bar('Trade &amp; travel', f.trade)}${bar('Climate', f.climate)}${bar('Prosperity', f.prosperity)}</div>`;
}

function renderInspector() {
  const d = inspected;
  if (!d) return;
  $('unpin').hidden = false;
  $('raw-toggle').hidden = false;
  $('raw-toggle').classList.toggle('on', showRaw);
  if (showRaw) {
    $('inspector').innerHTML = `<p class="muted empty">${link(`api/map/at?x=${d.x}&y=${d.y}`, `GET api/map/at?x=${d.x}&y=${d.y}`)}</p><pre class="raw">${esc(JSON.stringify(d, null, 2))}</pre>`;
    return;
  }
  const p = d.patch;
  const z = d.elevationZone;
  const r = d.region;
  const zoneColor = catalog.elevationZoneTypes.find((t) => t.id === z.type)?.color ?? '#888';
  const html = [];

  html.push(`<div class="title"><i class="swatch" style="background:${esc(p.biomeColor)}"></i>${esc(p.biomeName)}</div>`);
  html.push(kv('Point', `${km(d.x, 2)}, ${km(d.y, 2)} km`, 'mono'));
  if (!d.ocean) html.push(kv('Height here', `${fmt(d.height)} m`));

  if (d.location) {
    const l = d.location;
    html.push(`<h4 class="sub">${l.kind === 'city' ? 'City location' : 'Town location'}<small class="muted">rank ${l.rank} in its region</small></h4>`);
    html.push(`<div class="title"><i class="swatch" style="background:${viabilityColor(l.score)};border-radius:${l.kind === 'city' ? '2px' : '50%'}"></i>Viability ${fmt(l.score, 1)}</div>`);
    html.push(chips(l.features, true));
    html.push(factorBars(l.factors));
  }
  if (d.lake) {
    html.push('<h4 class="sub">Lake</h4>');
    html.push(kv('Size', `${km(d.lake.size)} km across`) + kv('Area', `${fmt(d.lake.area / 1e6, 1)} km²`) + kv('River flow', fmt(d.lake.riverFlow)));
  }
  if (d.river && !d.river.overSea) {
    const v = d.river;
    html.push(`<h4 class="sub">River<small class="muted">${fmt(v.distance)} m away</small></h4>`);
    html.push(kv('Flow here', `${fmt(v.flow)} <span class="muted">(${fmt(v.patchesDrained, 1)} patches drained)</span>`) + kv('Navigable', yes(v.navigable)) + kv('Flow at its mouth', fmt(v.mouthFlow)));
  }

  html.push(`<h4 class="sub">Patch<small class="muted mono">(${p.i}, ${p.j})</small></h4>`);
  if (!p.ocean) {
    html.push(kv('Thermal belt', esc(p.beltName)) + kv('Moisture', `${esc(p.moisture)} <span class="muted">(aridity ${fmt(p.aridity, 2)})</span>`));
    html.push(kv('Temperature', `${fmt(p.temperature, 1)} °C <span class="muted">(${fmt(p.seaLevelTemperature, 1)} − ${fmt(p.cooling, 1)} for height)</span>`));
    html.push(kv('Precipitation', `${fmt(p.precipitation)} mm/yr${p.riverPoor ? ' <span class="muted">(dry flat zone)</span>' : ''}`));
    html.push(kv('Mean height', `${fmt(p.height)} m${p.heightExact ? '' : ' <span class="muted">(estimate)</span>'}`));
    if (p.seaLevelBiome !== p.biome) html.push(kv('At sea level', esc(catalog.biomes.find((b) => b.id === p.seaLevelBiome)?.name ?? p.seaLevelBiome)));
    const flags = [];
    if (p.coastal) flags.push('coastal');
    if (p.merged) flags.push('merged cells');
    if (p.waters?.harbour) flags.push('sheltered bay');
    if (p.lakeBlock) flags.push(`no lakes: ${p.lakeBlock}`);
    html.push(chips(flags));
  } else {
    html.push(kv('Sea temperature', `${fmt(p.seaLevelTemperature, 1)} °C`));
  }
  html.push(kv('Prosperity', fmt(p.prosperity, 2)) + kv('Supernatural', fmt(p.supernatural, 1)));

  html.push(`<h4 class="sub">Resources<small class="muted">${p.resources.length} listed</small></h4>`);
  if (p.resources.length) {
    html.push(`<div class="bars">${p.resources.map((x) => `<div class="bar res"><span title="${esc(x.name)}: ${esc(x.variant)}">${esc(x.name)} <small>${esc(x.variant)}</small></span><i><u style="width:${x.amount * 100}%"></u></i><em>${fmt(x.amount, 2)}</em></div>`).join('')}</div>`);
  } else html.push('<p class="muted empty">None of a listable amount.</p>');
  if (!p.ocean) {
    html.push(kv('Food', fmt(p.food, 2)) + kv('Trade goods', fmt(p.wealth, 2)));
    const w = p.waters;
    if (w && (w.river > 0 || w.lakeArea > 0)) {
      html.push(kv('Largest river', w.river > 0 ? `${fmt(w.river, 1)} patches drained${w.mouth > 0 ? ' · mouth' : ''}` : 'none'));
      if (w.goldLoad > 0 || w.tinLoad > 0) html.push(kv('Upstream uplands', `${fmt(w.goldLoad * 100)} % gold-bearing · ${fmt(w.tinLoad * 100)} % tin-bearing`));
    }
  }

  if (p.site && !d.location) {
    const s = p.site;
    html.push(`<h4 class="sub">As a site<small class="muted">${s.depth === 0 ? 'on a region border: no location' : 'not chosen'}</small></h4>`);
    html.push(`<div class="title"><i class="swatch" style="background:${viabilityColor(s.score)}"></i>Viability ${fmt(s.score, 1)}</div>`);
    html.push(chips(s.features));
    html.push(factorBars(s.factors));
  }

  html.push(`<h4 class="sub">Elevation zone<small class="muted mono">(${z.i}, ${z.j})</small></h4>`);
  html.push(`<div class="title"><i class="swatch" style="background:${esc(zoneColor)}"></i>${esc(z.typeName)}</div>`);
  if (z.ocean) html.push(kv('Ocean genesis', esc(z.genesis === 'growth' ? `growth pass ${z.growthPass}` : z.genesis.replace(/([A-Z])/g, ' $1').toLowerCase())));
  else html.push(kv('Bedrock', esc(z.bedrockName)) + (z.riverPoor ? kv('Rivers', 'river-poor flat zone') : ''));
  html.push(kv('Patches', fmt(z.patches)) + (z.merged ? kv('Merged from', `${z.members.length} cells`) : ''));

  html.push(`<h4 class="sub">Region<small class="muted mono">(${r.i}, ${r.j})</small></h4>`);
  html.push(kv('Site', `${km(r.x)}, ${km(r.y)} km`, 'mono'));
  html.push(kv('Noise maps here', `${fmt(d.climate.temperature, 1)} °C · ${fmt(d.climate.precipitation)} mm`));

  html.push('<h4 class="sub">Data (JSON)</h4>');
  const reg = `api/map/regions/${r.i},${r.j}`;
  html.push(`<div class="links">${link(`api/map/patches/${p.key}`, 'patch')}${link(`api/map/zones/${z.key}`, 'zone')}${link(reg, 'region')}${link(reg + '/rivers', 'rivers')}${link(reg + '/lakes', 'lakes')}${link(reg + '/locations', 'locations')}${link(reg + '/travel', 'travel')}</div>`);
  $('inspector').innerHTML = html.join('');
}

// ------------------------------------------------------------------ panels

function renderLayers() {
  const rows = LAYERS.map(([name, label, key]) => `<div class="row"><label for="l-${name}">${esc(label)}</label>${key ? `<span class="key">${key}</span>` : ''}<span class="switch"><input type="checkbox" id="l-${name}" data-layer="${name}" /><span class="slider"></span></span></div>`);
  rows.splice(4, 0, `<div class="row"><label for="loc-min" title="Hide every location below this viability score; the travel network connects those on show">Location viability</label><input type="range" id="loc-min" min="0" max="100" step="1" /><output id="loc-min-out"></output></div>`);
  rows.splice(6, 0, `<div class="row"><label for="travel-style">Travel routes</label><select id="travel-style"><option value="terrain">Follow the terrain</option><option value="simple">Straight lines</option></select></div>`);
  $('layers').innerHTML = rows.join('');
  for (const box of document.querySelectorAll('#layers input[data-layer]')) {
    box.checked = state[box.dataset.layer];
    box.addEventListener('change', () => setLayer(box.dataset.layer, box.checked));
  }
  const slider = $('loc-min');
  slider.value = state.locMin;
  $('loc-min-out').textContent = state.locMin;
  slider.addEventListener('input', () => ($('loc-min-out').textContent = slider.value));
  slider.addEventListener('change', () => {
    state.locMin = Number(slider.value);
    queueLayout();
  });
  $('travel-style').value = state.travelStyle;
  $('travel-style').addEventListener('change', () => {
    state.travelStyle = $('travel-style').value;
    queueLayout();
  });
}

function renderLegend() {
  const mode = catalog.colorModes.find((m) => m.id === state.color);
  $('mode-help').textContent = mode.description;
  const ramp = ['height', 'temperature', 'precipitation', 'prosperity', 'supernatural'].includes(mode.id);
  if (ramp) {
    const l = mode.legend;
    $('legend').innerHTML = `<div class="ramp" style="background:linear-gradient(90deg, ${l.map((s) => s.color).join(', ')})"></div><div class="ramp-ticks"><span>${esc(l[0].name)}</span><span>${esc(l[Math.floor(l.length / 2)].name)}</span><span>${esc(l[l.length - 1].name)}</span></div>`;
  } else {
    $('legend').innerHTML = mode.legend.map((s) => `<div class="item"><i class="swatch" style="background:${esc(s.color)}"></i>${esc(s.name)}</div>`).join('');
  }
  $('legend-features').innerHTML = [
    '<div class="item"><i class="line" style="border-color:#3f93dc"></i>River (width by flow)</div>',
    '<div class="item"><i class="swatch" style="background:#3a78b6"></i>Lake</div>',
    '<div class="item"><i class="line" style="border-color:#f3dfb4"></i>Road</div>',
    '<div class="item"><i class="line" style="border-color:#c9f6ff;border-top-style:dotted"></i>River route</div>',
    '<div class="item"><i class="line" style="border-color:#eaf3ff;border-top-style:dashed"></i>Sea lane</div>',
    '<div class="item"><span class="mark" style="color:#f08a24">◆</span>City location</div>',
    '<div class="item"><span class="mark" style="color:#f08a24">●</span>Town location (colour = viability)</div>',
    '<div class="item"><i class="line" style="border-color:#eb1c24;border-top-style:dashed"></i>Region border</div>',
  ].join('');
}

// ------------------------------------------------------------------ start

async function start() {
  try {
    [api, catalog] = await Promise.all([getJSON('api'), getJSON('api/catalog')]);
    defaults = readDefaults(await getJSON('api/settings'));
  } catch (e) {
    $('inspector').innerHTML = `<p class="error empty">The API did not answer: ${esc(e.message)}</p>`;
    return;
  }
  readHash();
  $('seed').value = state.seed;
  $('color').innerHTML = catalog.colorModes.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  $('color').value = state.color;
  renderLayers();
  renderLegend();

  $('color').addEventListener('change', () => setColor($('color').value));
  $('seed').addEventListener('change', () => setSeed($('seed').value));
  $('seed').addEventListener('keydown', (e) => e.key === 'Enter' && $('seed').blur());
  $('random').addEventListener('click', () => setSeed(randomSeed()));
  $('default-seed').addEventListener('click', () => setSeed(defaults.seed));
  $('zoom-in').addEventListener('click', () => setZoom(state.z + 1));
  $('zoom-out').addEventListener('click', () => setZoom(state.z - 1));
  $('home').addEventListener('click', () => {
    state.x = 0;
    state.y = 0;
    queueLayout();
  });
  $('unpin').addEventListener('click', clearPin);
  $('raw-toggle').addEventListener('click', () => {
    showRaw = !showRaw;
    renderInspector();
  });
  $('share').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      $('share').textContent = 'Copied';
    } catch {
      $('share').textContent = 'Copy the address bar';
    }
    setTimeout(() => ($('share').textContent = 'Share link'), 1500);
  });
  $('help-btn').addEventListener('click', () => $('help').showModal());
  $('help-close').addEventListener('click', () => $('help').close());
  new ResizeObserver(queueLayout).observe(mapEl);
  window.addEventListener('hashchange', () => {
    const pin = state.pin;
    readHash();
    if (state.pin && pin && Math.abs(state.pin.x - pin.x) < 2 && Math.abs(state.pin.y - pin.y) < 2) state.pin = pin;
    $('seed').value = state.seed;
    $('color').value = state.color;
    renderLayers();
    renderLegend();
    queueLayout();
  });

  layout();
  showMapInfo();
  // a shared link with a pinned point opens with its inspector
  if (state.pin) inspect(state.pin.x, state.pin.y);
}

start();
