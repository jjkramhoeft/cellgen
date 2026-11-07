import { defaultsOf, opt, type ParamDef, type Params, type Section } from '@shared/params/schema';

export const SECTIONS: Section[] = [
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
        default: 'poisson',
        options: opt(['poisson', 'Poisson disc'], ['jitter-hex', 'Jittered hex lattice'], ['uniform', 'Uniform random']),
      },
      { key: 'pts.n', label: 'Count', type: 'int', min: 10, max: 20000, default: 1500, log: true },
      { key: 'pts.jitter', label: 'Jitter', type: 'number', min: 0, max: 1, step: 0.01, default: 0.9 },
    ],
  },
];

export const ALL_DEFS: ParamDef[] = SECTIONS.flatMap((s) => s.params);

export function defaults(): Params {
  return defaultsOf(ALL_DEFS);
}
