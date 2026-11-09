/** Builds the parameter panels from the declarative schema. */
import type { NumberDef, ParamDef, Params, ParamValue, Section } from '../params/schema';

export interface PanelHandle {
  /** refresh control values and visibility from params */
  sync(p: Params): void;
}

type OnChange = (key: string, value: ParamValue, committed: boolean) => void;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmtNum(d: NumberDef, v: number): string {
  if (d.type === 'int') return String(Math.round(v));
  const step = d.step ?? 0.01;
  const dec = Math.max(0, Math.min(4, Math.ceil(-Math.log10(step))));
  return v.toFixed(dec);
}

/** The config keys of a section as one pattern: the shared dotted prefix + `*` (e.g. `reg.*`), or the keys listed. */
function keyPattern(keys: string[]): string {
  if (keys.length === 1) return keys[0];
  const parts = keys.map((k) => k.split('.'));
  const common: string[] = [];
  for (let i = 0; parts.every((p) => i < p.length - 1 && p[i] === parts[0][i]); i++) common.push(parts[0][i]);
  return common.length ? `${common.join('.')}.*` : keys.join(', ');
}

const LOG_STEPS = 1000;
function toSlider(d: NumberDef, v: number): number {
  if (!d.log) return v;
  return (Math.log(v / d.min) / Math.log(d.max / d.min)) * LOG_STEPS;
}
function fromSlider(d: NumberDef, s: number): number {
  if (!d.log) return s;
  let v = d.min * Math.pow(d.max / d.min, s / LOG_STEPS);
  if (d.type === 'int') v = Math.round(v);
  else {
    const mag = Math.pow(10, Math.floor(Math.log10(v)) - 2);
    v = Math.round(v / mag) * mag;
  }
  return v;
}

interface Row {
  def: ParamDef;
  row: HTMLElement;
  set(v: ParamValue): void;
}

export function buildPanel(
  host: HTMLElement,
  sections: Section[],
  params: Params,
  onChange: OnChange,
  onResetSection?: (s: Section) => void,
): PanelHandle {
  const rows: Row[] = [];
  const sectionEls: { s: Section; head: HTMLElement; enable?: HTMLInputElement }[] = [];
  for (const s of sections) {
    const sec = el('section', 'sec');
    sec.dataset.id = s.id;
    if (!s.open) sec.classList.add('collapsed');
    const head = el('header', 'sec-head');
    const chev = el('span', 'chev', '▸');
    const title = el('h3', '', s.title);
    head.append(chev, title);
    let enable: HTMLInputElement | undefined;
    if (s.enableKey) {
      const sw = el('label', 'switch small');
      sw.title = `Enable this stage [${s.enableKey}]`;
      enable = el('input');
      enable.type = 'checkbox';
      enable.checked = !!params[s.enableKey];
      enable.addEventListener('click', (e) => e.stopPropagation());
      enable.addEventListener('change', () => {
        onChange(s.enableKey!, enable!.checked, true);
        if (enable!.checked) sec.classList.remove('collapsed');
      });
      sw.append(enable, el('span', 'slider'));
      sw.addEventListener('click', (e) => e.stopPropagation());
      head.append(sw);
    }
    if (onResetSection) {
      const reset = el('button', 'icon-btn reset', '↺');
      reset.title = `Reset this section to defaults [${keyPattern(s.params.map((d) => d.key))}]`;
      reset.addEventListener('click', (e) => {
        e.stopPropagation();
        onResetSection(s);
      });
      head.append(reset);
    }
    head.addEventListener('click', () => sec.classList.toggle('collapsed'));
    sec.append(head);
    const body = el('div', 'sec-body');
    if (s.help) body.append(el('p', 'sec-help', s.help));
    for (const def of s.params) {
      if (def.key === s.enableKey) continue;
      const r = buildRow(def, params[def.key], onChange);
      rows.push(r);
      body.append(r.row);
    }
    sec.append(body);
    host.append(sec);
    sectionEls.push({ s, head, enable });
  }
  const handle: PanelHandle = {
    sync(p: Params) {
      for (const r of rows) {
        r.set(p[r.def.key]);
        const vis = r.def.show ? r.def.show(p) : true;
        r.row.style.display = vis ? '' : 'none';
      }
      for (const se of sectionEls) {
        if (se.enable) {
          se.enable.checked = !!p[se.s.enableKey!];
          se.head.parentElement!.classList.toggle('disabled', !se.enable.checked);
        }
      }
    },
  };
  handle.sync(params);
  return handle;
}

function buildRow(def: ParamDef, value: ParamValue, onChange: OnChange): Row {
  const row = el('div', `row row-${def.type}`);
  const label = el('label', 'row-label', def.label);
  // every tooltip ends with the config key, to make editing the defaults JSON easy
  const tip = def.help ? `${def.help} [${def.key}]` : `[${def.key}]`;
  row.title = tip;
  label.title = tip;
  if (def.help) label.classList.add('has-help');
  row.append(label);
  if (def.type === 'bool') {
    const sw = el('label', 'switch');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = !!value;
    input.addEventListener('change', () => onChange(def.key, input.checked, true));
    sw.append(input, el('span', 'slider'));
    row.append(sw);
    return { def, row, set: (v) => (input.checked = !!v) };
  }
  if (def.type === 'select') {
    const sel = el('select');
    for (const o of def.options) {
      const op = el('option', '', o.label);
      op.value = o.value;
      sel.append(op);
    }
    sel.value = String(value);
    sel.addEventListener('change', () => onChange(def.key, sel.value, true));
    row.append(sel);
    return { def, row, set: (v) => (sel.value = String(v)) };
  }
  const wrap = el('div', 'num');
  const range = el('input');
  range.type = 'range';
  range.min = String(def.log ? 0 : def.min);
  range.max = String(def.log ? LOG_STEPS : def.max);
  range.step = def.log ? '1' : String(def.step ?? (def.type === 'int' ? 1 : 0.01));
  const box = el('input', 'num-box');
  box.type = 'text';
  box.inputMode = 'decimal';
  box.spellcheck = false;
  const setUI = (v: number) => {
    range.value = String(toSlider(def, v));
    box.value = fmtNum(def, v) + (def.unit ?? '');
  };
  setUI(Number(value));
  range.addEventListener('input', () => {
    const v = fromSlider(def, Number(range.value));
    box.value = fmtNum(def, v) + (def.unit ?? '');
    onChange(def.key, v, false);
  });
  range.addEventListener('change', () => onChange(def.key, fromSlider(def, Number(range.value)), true));
  const commitBox = () => {
    let v = parseFloat(box.value);
    if (!Number.isFinite(v)) v = def.default;
    v = Math.min(def.max, Math.max(def.min, v));
    if (def.type === 'int') v = Math.round(v);
    setUI(v);
    onChange(def.key, v, true);
  };
  box.addEventListener('change', commitBox);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') box.blur();
    e.stopPropagation();
  });
  range.addEventListener('dblclick', () => {
    setUI(def.default);
    onChange(def.key, def.default, true);
  });
  range.title = `Double-click to reset [${def.key}]`;
  wrap.append(range, box);
  row.append(wrap);
  return { def, row, set: (v) => setUI(Number(v)) };
}
