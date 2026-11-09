/**
 * Raster sources and colour ramps for the noise-field overlays (initial temperature,
 * precipitation and prosperity). Each overlay is an opaque image drawn at 50 % opacity over the map; the
 * fields are smooth, so they are rendered below screen resolution and scaled up.
 */
import { packColor } from '@shared/render/colormaps';
import type { RasterSource } from '@shared/render/raster';
import type { Climate, NoiseFieldParams } from '../world/climate';

export type ClimateField = 'temperature' | 'precipitation' | 'prosperity';

/** Colour stops: [value, r, g, b], on absolute values so a colour always means the same °C or mm per year. */
type Stops = [number, number, number, number][];

/** °C: blue (cold) → pale yellow (≈ 10 °C) → red (hot). */
export const TEMP_STOPS: Stops = [
  [-30, 49, 54, 149],
  [-10, 69, 117, 180],
  [0, 171, 217, 233],
  [10, 255, 255, 191],
  [20, 253, 174, 97],
  [30, 215, 48, 39],
  [45, 120, 0, 30],
];

/** mm per year, spaced roughly evenly in log: brown (desert) → cream (≈ 1000) → teal → deep blue (rainforest). */
export const PRECIP_STOPS: Stops = [
  [0, 90, 48, 4],
  [100, 125, 70, 10],
  [250, 175, 115, 38],
  [500, 223, 194, 125],
  [1000, 246, 232, 195],
  [2000, 128, 205, 193],
  [4000, 53, 151, 143],
  [7000, 1, 102, 94],
  [10000, 8, 64, 110],
];

/** Prosperity index: dark purple (poor) → grey-violet → pale gold (≈ 50) → deep gold (prosperous). */
export const PROSPERITY_STOPS: Stops = [
  [0, 45, 20, 70],
  [25, 110, 80, 140],
  [50, 225, 215, 170],
  [75, 240, 185, 60],
  [100, 190, 120, 10],
];

export const STOPS: Record<ClimateField, Stops> = { temperature: TEMP_STOPS, precipitation: PRECIP_STOPS, prosperity: PROSPERITY_STOPS };

/** The value of one field at a point. */
function fieldReader(climate: Climate, field: ClimateField): (x: number, y: number) => number {
  if (field === 'temperature') return (x, y) => climate.temperatureAt(x, y);
  if (field === 'precipitation') return (x, y) => climate.precipitationAt(x, y);
  return (x, y) => climate.prosperityAt(x, y);
}

/** Interpolated [r, g, b] for a value on a ramp (flat beyond the ends). */
export function rampRgb(stops: Stops, v: number): [number, number, number] {
  if (v <= stops[0][0]) return [stops[0][1], stops[0][2], stops[0][3]];
  for (let k = 1; k < stops.length; k++) {
    const [v1, r1, g1, b1] = stops[k];
    if (v <= v1) {
      const [v0, r0, g0, b0] = stops[k - 1];
      const t = (v - v0) / (v1 - v0);
      return [r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t];
    }
  }
  const l = stops[stops.length - 1];
  return [l[1], l[2], l[3]];
}

const fieldKey = (p: NoiseFieldParams) => `${p.scale},${p.octaves},${p.lacunarity},${p.gain},${p.min},${p.max}`;

/** One climate field as a raster: every pixel is the field's ramp colour at that point. */
export function climateSource(climate: Climate, field: ClimateField): RasterSource {
  const stops = STOPS[field];
  const at = fieldReader(climate, field);
  return {
    key: `clim|${field}|${climate.p.seed}|${fieldKey(climate.p[field])}`,
    create() {
      return (_py, wy, wx0, dwx, n, out, off) => {
        for (let c = 0; c < n; c++) {
          const [r, g, b] = rampRgb(stops, at(wx0 + c * dwx, wy));
          out[off + c] = packColor(r, g, b);
        }
      };
    },
  };
}
