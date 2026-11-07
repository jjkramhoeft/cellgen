/**
 * URL state: the seed and every non-default parameter live in the hash, so any view
 * is shareable and survives reloads on GitHub Pages (no server routing needed).
 * Each sandbox is its own page, so hashes never collide between sandboxes.
 */
import { coerce, defaultsOf, type ParamDef, type Params } from './schema';

export interface UrlState {
  seed: string;
  params: Params;
}

export function encodeState(seed: string, p: Params, defs: ParamDef[]): string {
  const d = defaultsOf(defs);
  const q = new URLSearchParams();
  q.set('seed', seed);
  for (const def of defs) {
    const v = p[def.key];
    if (v === undefined || v === d[def.key]) continue;
    q.set(def.key, typeof v === 'boolean' ? (v ? '1' : '0') : String(typeof v === 'number' ? +v.toFixed(6) : v));
  }
  return q.toString();
}

export function decodeState(hash: string, defs: ParamDef[], defaultSeed: string): UrlState | null {
  const h = hash.replace(/^#/, '');
  if (!h) return null;
  const q = new URLSearchParams(h);
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const params = defaultsOf(defs);
  for (const [k, v] of q) {
    const def = byKey.get(k);
    if (def) params[k] = coerce(def, v);
  }
  return { seed: q.get('seed') ?? defaultSeed, params };
}
