import { bindDefaults, defaultsOf, opt, type ParamDef, type Params, type Section } from '@shared/params/schema';
import DEFAULTS from '../defaults.json';

/** Seed used when the URL has none (from sandboxes/{{ID}}/defaults.json). */
export const DEFAULT_SEED = DEFAULTS.seed;
/** Attaches each parameter's default from sandboxes/{{ID}}/defaults.json. */
const withDefaults = bindDefaults(DEFAULTS.params, 'sandboxes/{{ID}}/defaults.json');

export const SECTIONS: Section[] = withDefaults.sections([
  {
    id: 'points',
    title: 'Points',
    open: true,
    help: 'Starter parameters — replace with this sandbox’s own.',
    params: [
      {
        key: 'pts.method',
        label: 'Sampling',
        type: 'select',
        options: opt(['poisson', 'Poisson disc'], ['jitter-hex', 'Jittered hex lattice'], ['uniform', 'Uniform random']),
      },
      { key: 'pts.n', label: 'Count', type: 'int', min: 10, max: 20000, log: true },
      { key: 'pts.jitter', label: 'Jitter', type: 'number', min: 0, max: 1, step: 0.01 },
    ],
  },
]);

export const ALL_DEFS: ParamDef[] = SECTIONS.flatMap((s) => s.params);
withDefaults.checkAllUsed();

export function defaults(): Params {
  return defaultsOf(ALL_DEFS);
}
