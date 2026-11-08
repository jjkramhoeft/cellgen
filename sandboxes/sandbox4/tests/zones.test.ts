import { describe, expect, it } from 'vitest';
import { packKey } from '../src/world/level';
import { ELEVATION_ZONE_TYPES, elevationZoneType, LAND_ZONE_TYPES, OCEAN_ZONE } from '../src/world/zones';

describe('elevation zone types', () => {
  it('are ocean, flat, lowland, hills and mountains', () => {
    expect(ELEVATION_ZONE_TYPES.map((t) => t.id)).toEqual(['ocean', 'flat', 'lowland', 'hills', 'mountains']);
    expect(ELEVATION_ZONE_TYPES[OCEAN_ZONE].id).toBe('ocean');
    expect(LAND_ZONE_TYPES.map((t) => t.id)).toEqual(['flat', 'lowland', 'hills', 'mountains']);
  });

  it('ocean zones are ocean; land zones get a land type by weight, deterministically', () => {
    const counts = new Array(ELEVATION_ZONE_TYPES.length).fill(0);
    let n = 0;
    for (let i = -60; i < 60; i++) {
      for (let j = -60; j < 60; j++) {
        const k = packKey(i, j);
        expect(elevationZoneType(k, true)).toBe(OCEAN_ZONE);
        const t = elevationZoneType(k, false);
        expect(t).toBe(elevationZoneType(k, false));
        counts[t]++;
        n++;
      }
    }
    expect(counts[OCEAN_ZONE]).toBe(0);
    const total = LAND_ZONE_TYPES.reduce((s, t) => s + t.weight, 0);
    ELEVATION_ZONE_TYPES.forEach((t, i) => {
      if (t.id === 'ocean') return;
      expect(counts[i] / n).toBeCloseTo(t.weight / total, 1);
    });
  });
});
