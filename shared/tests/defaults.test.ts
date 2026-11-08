import { describe, expect, it } from 'vitest';
import { bindDefaults, defaultsOf, opt, type SectionSpec } from '../params/schema';

const spec: SectionSpec = {
  id: 's',
  title: 'S',
  params: [
    { key: 'n', label: 'N', type: 'int', min: 0, max: 10 },
    { key: 'x', label: 'X', type: 'number', min: 0, max: 1, step: 0.1 },
    { key: 'k', label: 'K', type: 'select', options: opt(['a', 'A'], ['b', 'B']) },
    { key: 'on', label: 'On', type: 'bool' },
  ],
};
const good = { n: 3, x: 0.5, k: 'b', on: true };

describe('bindDefaults', () => {
  it('attaches every default from the file', () => {
    const b = bindDefaults(good, 'test.json');
    const s = b.section(spec);
    expect(defaultsOf(s.params)).toEqual(good);
    expect(() => b.checkAllUsed()).not.toThrow();
  });
  it('rejects a missing default', () => {
    const { n: _, ...rest } = good;
    expect(() => bindDefaults(rest, 'test.json').section(spec)).toThrow('test.json: "n" has no default');
  });
  it('rejects values of the wrong type, out of range, non-integer, or not an option', () => {
    expect(() => bindDefaults({ ...good, n: '3' }).section(spec)).toThrow('"n" must be a number');
    expect(() => bindDefaults({ ...good, n: 11 }).section(spec)).toThrow('"n" must be in [0, 10]');
    expect(() => bindDefaults({ ...good, n: 2.5 }).section(spec)).toThrow('"n" must be an integer');
    expect(() => bindDefaults({ ...good, k: 'c' }).section(spec)).toThrow('"k" must be one of "a", "b"');
    expect(() => bindDefaults({ ...good, on: 1 }).section(spec)).toThrow('"on" must be true or false');
  });
  it('reports keys in the file that no parameter uses', () => {
    const b = bindDefaults({ ...good, stale: 1 }, 'test.json');
    b.section(spec);
    expect(() => b.checkAllUsed()).toThrow('test.json: no parameter uses "stale"');
  });
  it('rejects a key bound twice', () => {
    const b = bindDefaults(good);
    b.section(spec);
    expect(() => b.section(spec)).toThrow('"n" is used by two parameters');
  });
});
