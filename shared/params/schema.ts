/**
 * Declarative parameter schema shared by all sandboxes. A sandbox describes its
 * parameters as `Section`s of `ParamDef`s; the panel builder (shared/ui/panel.ts),
 * URL state (shared/params/url.ts) and presets all read from that one list.
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
