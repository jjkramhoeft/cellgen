/**
 * Elevation zone types. Every elevation zone (the medium cells, see world.ts) is ocean
 * or one of four land types: flat, lowland, hills, mountains. Ocean comes from the ocean
 * genesis; a land zone's type is picked from a hash of its key, by weight. The type sets
 * the terrain's hillslope, river gradient and detail noise (terrain.ts).
 *
 * Biomes are per subbiome, from the initial climate and the height map (biomes.ts).
 */
import { hash4 } from '@shared/core/hash';
import type { RGB } from '@shared/render/colormaps';
import { keyI, keyJ } from './level';

export type ElevationZoneId = 'ocean' | 'flat' | 'lowland' | 'hills' | 'mountains';

export interface ElevationZoneType {
  id: ElevationZoneId;
  name: string;
  /** map colour */
  rgb: RGB;
  /** relative share of land zones of this type (0 for ocean, which comes from the ocean genesis) */
  weight: number;
}

/** Index order is used by the per-type terrain parameters. */
export const ELEVATION_ZONE_TYPES: ElevationZoneType[] = [
  { id: 'ocean', name: 'Ocean', rgb: [38, 84, 132], weight: 0 },
  { id: 'flat', name: 'Flat', rgb: [143, 174, 93], weight: 5 },
  { id: 'lowland', name: 'Lowland', rgb: [92, 134, 74], weight: 6 },
  { id: 'hills', name: 'Hills', rgb: [154, 138, 98], weight: 1 },
  { id: 'mountains', name: 'Mountains', rgb: [124, 116, 112], weight: 1 },
];

/** Index of the ocean type in ELEVATION_ZONE_TYPES. */
export const OCEAN_ZONE = 0;

/** The land types (everything but ocean), in ELEVATION_ZONE_TYPES order. */
export const LAND_ZONE_TYPES = ELEVATION_ZONE_TYPES.filter((t) => t.id !== 'ocean');

const TOTAL_WEIGHT = ELEVATION_ZONE_TYPES.reduce((s, t) => s + t.weight, 0);

/**
 * Type index (into ELEVATION_ZONE_TYPES) of an elevation zone: OCEAN_ZONE for ocean,
 * otherwise a land type picked by weight from a hash of the zone key (merged root).
 */
export function elevationZoneType(key: number, ocean: boolean): number {
  if (ocean) return OCEAN_ZONE;
  let h = hash4(0x0c0101, 1, keyI(key), keyJ(key)) % TOTAL_WEIGHT;
  for (let i = 0; i < ELEVATION_ZONE_TYPES.length; i++) {
    h -= ELEVATION_ZONE_TYPES[i].weight;
    if (h < 0) return i;
  }
  return ELEVATION_ZONE_TYPES.length - 1;
}
