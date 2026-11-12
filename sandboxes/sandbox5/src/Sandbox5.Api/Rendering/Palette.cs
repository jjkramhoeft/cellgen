using Sandbox5.Domain.Generation;
using Sandbox5.Domain.Model;
using Sandbox5.Domain.Numerics;

namespace Sandbox5.Api.Rendering;

/// <summary>
/// The colours of the map images: a port of Sandbox 4's render/source.ts and render/climate.ts,
/// so an image shows the same colours as the Sandbox 4 canvas. Colours are packed as 0xRRGGBB.
/// </summary>
public static class Palette
{
    public static int Pack(double r, double g, double b) => ((int)Math.Clamp(r, 0, 255) << 16) | ((int)Math.Clamp(g, 0, 255) << 8) | (int)Math.Clamp(b, 0, 255);

    public static int Pack(Rgb c) => (c.R << 16) | (c.G << 8) | c.B;

    public static int Scale(int c, double f) => Pack(((c >> 16) & 255) * f, ((c >> 8) & 255) * f, (c & 255) * f);

    public static int Mix(int c, double r, double g, double b, double t)
    {
        int cr = (c >> 16) & 255, cg = (c >> 8) & 255, cb = c & 255;
        return Pack(cr + (r - cr) * t, cg + (g - cg) * t, cb + (b - cb) * t);
    }

    /// <summary>Display hash of a cell key (salted per level).</summary>
    public static uint KeyHash(long key, int salt) => Hash.Hash4(0x0c0101, salt, CellKeys.I(key), CellKeys.J(key));

    /// <summary>±amt lightness factor from a hash.</summary>
    private static double JitterF(uint h, double amt) => 1 + ((((h >> 8) & 1023) / 1023.0) * 2 - 1) * amt;

    public static (double R, double G, double B) Hsl(double h, double s, double l)
    {
        double a = s * Math.Min(l, 1 - l);
        double F(double n)
        {
            double k = (n + h * 12) % 12;
            return 255 * (l - a * Math.Max(-1, Math.Min(Math.Min(k - 3, 9 - k), 1)));
        }
        return (F(0), F(8), F(4));
    }

    /// <summary>Stable pseudo-random colour for an integer id.</summary>
    public static int HashColor(uint id)
    {
        unchecked
        {
            uint h = (id ^ 0x5bd1e995u) * 0x27d4eb2du;
            h ^= h >> 15;
            h *= 0x85ebca6bu;
            h ^= h >> 13;
            double hue = (h % 360) / 360.0;
            double sat = 0.45 + ((h >> 9) % 30) / 100.0;
            double lig = 0.55 + ((h >> 17) % 20) / 100.0;
            var (r, g, b) = Hsl(hue, sat, lig);
            return Pack(r, g, b);
        }
    }

    public static readonly Rgb OceanRgb = ElevationZoneType.All[ElevationZoneType.OceanIndex].Color;

    /// <summary>Colour of each ocean genesis: land, lone seed, linked seed, link chain, growth passes 1–4.</summary>
    public static readonly (string Name, Rgb Color)[] Genesis =
    [
        ("Land", new Rgb(96, 104, 92)),
        ("Lone seed", new Rgb(255, 150, 60)),
        ("Linked seed", new Rgb(253, 231, 37)),
        ("Link chain", new Rgb(63, 193, 176)),
        ("Growth pass 1", new Rgb(64, 128, 206)),
        ("Growth pass 2", new Rgb(104, 92, 206)),
        ("Growth pass 3", new Rgb(150, 84, 190)),
        ("Growth pass 4", new Rgb(190, 84, 150)),
    ];

    public static readonly int FlatLand = Pack(150, 178, 112);
    public static readonly int FlatOcean = Pack(38, 78, 128);
    public static readonly int Coast = Pack(14, 20, 30);
    /// <summary>Region borders: a 3 px red dashed line.</summary>
    public static readonly int RegionEdge = Pack(235, 28, 36);

    /// <summary>The map mode: elevation zone types, a little lighter or darker per patch.</summary>
    public static int MapColor(CellInfo c)
    {
        if (c.Ocean)
        {
            double fo = JitterF(KeyHash(c.ElevationZone, 8), 0.07) * (c.Patch >= 0 ? JitterF(KeyHash(c.Patch, 9), 0.03) : 1);
            return Pack(OceanRgb.R * fo, OceanRgb.G * fo, OceanRgb.B * fo);
        }
        Rgb t = ElevationZoneType.Of(c.ElevationZone, false).Color;
        double f = c.Patch >= 0 ? JitterF(KeyHash(c.Patch, 9), 0.08) : 1;
        return Pack(t.R * f, t.G * f, t.B * f);
    }

    /// <summary>Colour of one classified cell (no borders).</summary>
    public static int ColorOf(CellInfo c, string mode, Biomes biomes)
    {
        switch (mode)
        {
            case "biomes":
            {
                if (c.Ocean) return MapColor(c);
                // one colour per biome, a little lighter / darker per patch so the cells still read
                double f = c.Patch >= 0 ? JitterF(KeyHash(c.Patch, 9), 0.05) : 1;
                return Scale(Pack(Biome.All[biomes.IndexOf(c.Patch, c.ElevationZoneRaw)].Color), f);
            }
            case "landsea":
            case "height": // where no height is drawn
                return c.Ocean ? FlatOcean : FlatLand;
            case "genesis":
                return Pack(Genesis[Math.Min(c.Origin, Genesis.Length - 1)].Color);
            case "regions":
            {
                int b = HashColor(KeyHash(c.Region, 3));
                return c.Ocean ? Scale(b, 0.42) : b;
            }
            case "elevationZones":
            {
                int b = HashColor(KeyHash(c.ElevationZone, 4));
                return c.Ocean ? Mix(Scale(b, 0.5), 20, 50, 100, 0.45) : b;
            }
            case "patches":
            {
                int b = HashColor(KeyHash(c.Patch >= 0 ? c.Patch : c.ElevationZone, 5));
                return c.Ocean ? Mix(Scale(b, 0.5), 20, 50, 100, 0.45) : b;
            }
            default:
                return MapColor(c);
        }
    }

    /// <summary>Hypsometric tint: stops (metres → colour) for land, and sea depth shades.</summary>
    private static readonly double[][] LandStops =
    [
        [0, 72, 128, 76],
        [60, 104, 152, 84],
        [180, 150, 176, 98],
        [400, 206, 194, 122],
        [700, 182, 142, 94],
        [1100, 150, 120, 98],
        [1600, 168, 160, 156],
        [2400, 246, 246, 246],
    ];

    public static int HeightColor(double h)
    {
        if (h < 0)
        {
            double t = Math.Min(1, -h / 1200);
            return Pack(84 - 62 * t, 150 - 104 * t, 200 - 100 * t);
        }
        return Ramp(LandStops, h);
    }

    /// <summary>°C: blue (cold) → pale yellow (≈ 10 °C) → red (hot).</summary>
    public static readonly double[][] TemperatureStops = [[-30, 49, 54, 149], [-10, 69, 117, 180], [0, 171, 217, 233], [10, 255, 255, 191], [20, 253, 174, 97], [30, 215, 48, 39], [45, 120, 0, 30]];
    /// <summary>mm per year: brown (desert) → cream (≈ 1000) → teal → deep blue (rainforest).</summary>
    public static readonly double[][] PrecipitationStops = [[0, 90, 48, 4], [100, 125, 70, 10], [250, 175, 115, 38], [500, 223, 194, 125], [1000, 246, 232, 195], [2000, 128, 205, 193], [4000, 53, 151, 143], [7000, 1, 102, 94], [10000, 8, 64, 110]];
    /// <summary>Prosperity index: dark purple (poor) → pale gold (≈ 50) → deep gold (prosperous).</summary>
    public static readonly double[][] ProsperityStops = [[0, 45, 20, 70], [25, 110, 80, 140], [50, 225, 215, 170], [75, 240, 185, 60], [100, 190, 120, 10]];
    /// <summary>Supernatural index: near black (mundane) → indigo → violet → magenta → glowing cyan (strong magic).</summary>
    public static readonly double[][] SupernaturalStops = [[0, 14, 12, 28], [25, 48, 36, 112], [50, 118, 64, 190], [75, 206, 84, 214], [100, 128, 244, 255]];
    /// <summary>Viability score of a location: purple (poor) → orange → pale yellow (excellent).</summary>
    public static readonly double[][] ViabilityStops = [[0, 75, 42, 107], [35, 184, 64, 94], [65, 240, 138, 36], [100, 255, 243, 176]];

    /// <summary>Interpolated colour for a value on a ramp of [value, r, g, b] stops (flat beyond the ends).</summary>
    public static int Ramp(double[][] stops, double v)
    {
        if (v <= stops[0][0]) return Pack(stops[0][1], stops[0][2], stops[0][3]);
        for (int k = 1; k < stops.Length; k++)
        {
            double[] b = stops[k];
            if (v <= b[0])
            {
                double[] a = stops[k - 1];
                double t = (v - a[0]) / (b[0] - a[0]);
                return Pack(a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t);
            }
        }
        double[] l = stops[^1];
        return Pack(l[1], l[2], l[3]);
    }

    /// <summary>The colour ramp of a noise-field colour mode, or null for the other modes.</summary>
    public static double[][]? FieldStops(string mode) => mode switch
    {
        "temperature" => TemperatureStops,
        "precipitation" => PrecipitationStops,
        "prosperity" => ProsperityStops,
        "supernatural" => SupernaturalStops,
        _ => null,
    };

    public static string HexOf(int rgb) => $"#{rgb:x6}";
}
