import { describe, expect, it } from 'vitest';
import { decodeState, encodeState } from '@shared/params/url';
import { ALL_DEFS, defaults } from '../src/params';

describe('sandbox params', () => {
  it('round-trips through the URL', () => {
    const p = { ...defaults(), 'pts.n': 321 };
    const back = decodeState(`#${encodeState('abc', p, ALL_DEFS)}`, ALL_DEFS, 'x');
    expect(back?.seed).toBe('abc');
    expect(back?.params).toEqual(p);
  });
});
