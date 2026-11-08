/**
 * Declarative parameter schema shared by all sandboxes. A sandbox describes its
 * parameters as `Section`s of `ParamDef`s; the panel builder (shared/ui/panel.ts),
 * URL state (shared/params/url.ts) and presets all read from that one list.
 *
 * Default values live apart from the schema, in the sandbox's `defaults.json`
 * (`sandboxes/<id>/defaults.json`): the schema is written as `SectionSpec`s without
 * defaults, and `bindDefaults` attaches them (see below).
 */
export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

interface Base {
  key: string;
  label: string;
  help?: string;
  show?: (p: Params) => boolean;
  /** display-only: changing it re-renders but does not regenerate */
  view?: boolean;
}
export interface NumberDef extends Base {
  type: 'number' | 'int';
  min: number;
  max: number;
  step?: number;
  default: number;
  log?: boolean;
  unit?: string;
}
export interface SelectDef extends Base {
  type: 'select';
  options: { value: string; label: string }[];
  default: string;
}
export interface BoolDef extends Base {
  type: 'bool';
  default: boolean;
}
export type ParamDef = NumberDef | SelectDef | BoolDef;

export interface Section {
  id: string;
  title: string;
  /** optional bool param that enables the whole stage */
  enableKey?: string;
  help?: string;
  params: ParamDef[];
  open?: boolean;
}

/** A parameter as written in a sandbox's schema: a ParamDef without its default. */
export type ParamSpec = Omit<NumberDef, 'default'> | Omit<SelectDef, 'default'> | Omit<BoolDef, 'default'>;

/** A section as written in a sandbox's schema: its parameters have no defaults yet. */
export interface SectionSpec extends Omit<Section, 'params'> {
  params: ParamSpec[];
}

/** The contents of a sandbox's defaults.json. */
export interface DefaultsFile {
  /** seed used when the URL has none and when the seed box is cleared */
  seed: string;
  /** default value of every parameter, by key */
  params: Record<string, ParamValue>;
}

export interface DefaultsBinder {
  /** The section with every parameter's default taken from the defaults file. */
  section(s: SectionSpec): Section;
  sections(ss: SectionSpec[]): Section[];
  /** Throw if the defaults file holds keys that no bound section uses. Call after binding every section. */
  checkAllUsed(): void;
}

/**
 * Attach defaults from a defaults file to schema sections. Throws on a parameter
 * without a default, a value of the wrong type, a number outside [min, max] (or not
 * an integer for 'int'), and a select value that is not one of its options, so the
 * file and the schema cannot drift apart unnoticed.
 */
export function bindDefaults(values: Record<string, ParamValue>, file = 'defaults.json'): DefaultsBinder {
  const used = new Set<string>();
  const fail = (key: string, why: string): never => {
    throw new Error(`${file}: "${key}" ${why}`);
  };
  const attach = (spec: ParamSpec): ParamDef => {
    const { key } = spec;
    if (!Object.hasOwn(values, key)) fail(key, 'has no default');
    if (used.has(key)) fail(key, 'is used by two parameters');
    used.add(key);
    const v = values[key];
    switch (spec.type) {
      case 'bool':
        if (typeof v !== 'boolean') fail(key, `must be true or false, not ${JSON.stringify(v)}`);
        break;
      case 'select':
        if (typeof v !== 'string' || !spec.options.some((o) => o.value === v))
          fail(key, `must be one of ${spec.options.map((o) => JSON.stringify(o.value)).join(', ')}, not ${JSON.stringify(v)}`);
        break;
      default:
        if (typeof v !== 'number' || !Number.isFinite(v)) fail(key, `must be a number, not ${JSON.stringify(v)}`);
        else if (v < spec.min || v > spec.max) fail(key, `must be in [${spec.min}, ${spec.max}], not ${v}`);
        else if (spec.type === 'int' && !Number.isInteger(v)) fail(key, `must be an integer, not ${v}`);
    }
    return { ...spec, default: v } as ParamDef;
  };
  const section = (s: SectionSpec): Section => ({ ...s, params: s.params.map(attach) });
  return {
    section,
    sections: (ss) => ss.map(section),
    checkAllUsed() {
      const extra = Object.keys(values).filter((k) => !used.has(k));
      if (extra.length) throw new Error(`${file}: no parameter uses ${extra.map((k) => `"${k}"`).join(', ')}`);
    },
  };
}

/** Build select options from [value, label] pairs. */
export const opt = (...pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));

/** `show` helper: true when params[key] is one of vals. */
export const is =
  (key: string, ...vals: string[]) =>
  (p: Params) =>
    vals.includes(String(p[key]));

/** `show` helper: all predicates hold. */
export const and =
  (...fs: ((p: Params) => boolean)[]) =>
  (p: Params) =>
    fs.every((f) => f(p));

export function defaultsOf(defs: ParamDef[]): Params {
  const p: Params = {};
  for (const d of defs) p[d.key] = d.default;
  return p;
}

export function num(p: Params, key: string): number {
  return Number(p[key]);
}
export function str(p: Params, key: string): string {
  return String(p[key]);
}
export function bool(p: Params, key: string): boolean {
  return p[key] === true || p[key] === 'true' || p[key] === 1;
}

/** Coerce a raw value (e.g. from a URL) into the type declared by the schema. */
export function coerce(def: ParamDef, raw: unknown): ParamValue {
  switch (def.type) {
    case 'bool':
      return raw === true || raw === 'true' || raw === '1' || raw === 1;
    case 'select': {
      const s = String(raw);
      return def.options.some((o) => o.value === s) ? s : def.default;
    }
    default: {
      let v = Number(raw);
      if (!Number.isFinite(v)) return def.default;
      v = Math.min(def.max, Math.max(def.min, v));
      return def.type === 'int' ? Math.round(v) : v;
    }
  }
}
