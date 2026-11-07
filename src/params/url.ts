/**
 * URL state: seed and every non-default parameter live in the hash, so any view is
 * shareable and survives reloads on GitHub Pages (no server routing needed).
 */
import { ALL_DEFS, coerce, DEF_BY_KEY, defaults, type Params } from './schema';

export interface UrlState {
  seed: string;
  params: Params;
}

export function encodeState(seed: string, p: Params): string {
  const d = defaults();
  const q = new URLSearchParams();
  q.set('seed', seed);
  for (const def of ALL_DEFS) {
    const v = p[def.key];
    if (v === undefined || v === d[def.key]) continue;
    q.set(def.key, typeof v === 'boolean' ? (v ? '1' : '0') : String(typeof v === 'number' ? +v.toFixed(6) : v));
  }
  return q.toString();
}

export function decodeState(hash: string): UrlState | null {
  const h = hash.replace(/^#/, '');
  if (!h) return null;
  const q = new URLSearchParams(h);
  const params = defaults();
  for (const [k, v] of q) {
    const def = DEF_BY_KEY.get(k);
    if (def) params[k] = coerce(def, v);
  }
  return { seed: q.get('seed') ?? 'cellgen', params };
}
