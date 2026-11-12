using Sandbox5.Domain.Numerics;

namespace Sandbox5.Domain.Generation;

/// <summary>One Perlin-noise field: octaves, feature size and the range the noise is stretched to.</summary>
public sealed record NoiseFieldParams
{
    public required double Octaves { get; init; }
    public required double Lacunarity { get; init; }
    public required double Gain { get; init; }
    /// <summary>Wavelength of the first octave, metres.</summary>
    public required double Scale { get; init; }
    /// <summary>Value at the strongest lows and highs (the field is stretched to [Min, Max]).</summary>
    public required double Min { get; init; }
    public required double Max { get; init; }
    /// <summary>Stretch the noise over [log Min, log Max] instead (Min must be &gt; 0): the middle value is √(Min·Max).</summary>
    public required bool Log { get; init; }

    internal FbmParams Fbm => new(Octaves, Lacunarity, Gain);
}

public sealed record ClimateParams
{
    public required uint Seed { get; init; }
    /// <summary>°C.</summary>
    public required NoiseFieldParams Temperature { get; init; }
    /// <summary>Precipitation, mm per year.</summary>
    public required NoiseFieldParams Precipitation { get; init; }
    /// <summary>Prosperity index (unitless), linear.</summary>
    public required NoiseFieldParams Prosperity { get; init; }
    /// <summary>Supernatural index (unitless), linear: how strong magic is at a point.</summary>
    public required NoiseFieldParams Supernatural { get; init; }
}

/// <summary>
/// Initial climate (a port of world/climate.ts): a temperature map (°C) and a precipitation
/// map (mm per year, on a log scale), each an fBm of classic Perlin noise with its own
/// parameters; plus a prosperity map and a supernatural map built the same way. All are pure
/// functions of the seed, the parameters and the point (metres). Thread-safe.
/// </summary>
public sealed class Climate
{
    /// <summary>Smallest value of a log-scale field (a log scale cannot reach 0).</summary>
    public const double LogFloor = 1;

    /// <summary>
    /// About the 99.7th percentile of |noise| over a large area, once the spread is made
    /// independent of the octave count. Values beyond it are clamped to min / max.
    /// </summary>
    public const double NoiseExtreme = 0.8;

    // Seed salts, so the fields are independent of each other (and of every other noise).
    private const int TempSalt = 0x7e3a11c5;
    private const int PrecipSalt = 0x2b9d40f3;
    private const int ProsperitySalt = 0x5c1f86a9;
    private const int SupernaturalSalt = 0x3ad5e217;

    private readonly int _tSeed;
    private readonly int _pSeed;
    private readonly int _wSeed;
    private readonly int _sSeed;

    public ClimateParams P { get; }

    public Climate(ClimateParams p)
    {
        P = p;
        int seed = unchecked((int)p.Seed);
        _tSeed = seed ^ TempSalt;
        _pSeed = seed ^ PrecipSalt;
        _wSeed = seed ^ ProsperitySalt;
        _sSeed = seed ^ SupernaturalSalt;
    }

    /// <summary>The value at fraction t ∈ [0, 1] of a field's range (linear or log).</summary>
    public static double FieldAt(NoiseFieldParams p, double t)
    {
        if (!p.Log) return p.Min + t * (p.Max - p.Min);
        double a = DMath.Log(Math.Max(LogFloor, p.Min));
        double b = DMath.Log(Math.Max(LogFloor, p.Max));
        // exp(log(x)) can overshoot x by an ulp: clamp, so the ends are exact
        double lo = Math.Max(LogFloor, p.Min);
        double hi = Math.Max(LogFloor, p.Max);
        return Math.Min(hi, Math.Max(lo, DMath.Exp(a + t * (b - a))));
    }

    /// <summary>One climate field: noise → [min, max].</summary>
    public static double FieldValue(int seed, NoiseFieldParams p, double x, double y)
    {
        double f = 1 / p.Scale;
        FbmParams fbm = p.Fbm;
        double n = Noise.PerlinFbm(seed, x * f, y * f, fbm) * SpreadFix(fbm);
        n /= NoiseExtreme;
        if (n < -1) n = -1;
        else if (n > 1) n = 1;
        return FieldAt(p, (n + 1) / 2);
    }

    /// <summary>Σa / √Σa² for the octave weights 1, gain, gain², …</summary>
    private static double SpreadFix(in FbmParams p)
    {
        double sum = 0;
        double sq = 0;
        double a = 1;
        int oct = (int)Math.Max(1, Math.Floor(p.Octaves));
        for (int o = 0; o < oct; o++)
        {
            sum += a;
            sq += a * a;
            a *= p.Gain;
        }
        return sum / Math.Sqrt(sq);
    }

    /// <summary>Initial temperature at a point, °C.</summary>
    public double TemperatureAt(double x, double y) => FieldValue(_tSeed, P.Temperature, x, y);

    /// <summary>Initial precipitation at a point, mm per year.</summary>
    public double PrecipitationAt(double x, double y) => FieldValue(_pSeed, P.Precipitation, x, y);

    /// <summary>Prosperity index at a point (unitless, within [Min, Max] of its parameters).</summary>
    public double ProsperityAt(double x, double y) => FieldValue(_wSeed, P.Prosperity, x, y);

    /// <summary>Supernatural index at a point (unitless): how strong magic is there.</summary>
    public double SupernaturalAt(double x, double y) => FieldValue(_sSeed, P.Supernatural, x, y);
}
