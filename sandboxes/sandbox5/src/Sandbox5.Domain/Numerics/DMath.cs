namespace Sandbox5.Domain.Numerics;

/// <summary>
/// Deterministic transcendental functions, built from + − × ÷, rounding and bit patterns
/// only (a port of shared/core/dmath.ts). <see cref="Math.Exp"/>, <see cref="Math.Log"/>,
/// <see cref="Math.Pow"/>, <see cref="Math.Sin"/> and friends differ between runtimes and
/// from JavaScript engines, so the generator never uses them: the same seed gives the same
/// world as the TypeScript generator, bit for bit.
/// </summary>
public static class DMath
{
    private const double TwoPi = 6.283185307179586;
    private const double HalfPi = 1.5707963267948966;
    private const double Ln2Hi = 0.6931471803691238;
    private const double Ln2Lo = 1.9082149292705877e-10;
    private const double Ln2 = 0.6931471805599453;

    /// <summary>JavaScript's Math.round: to the nearest integer, halves towards +∞.</summary>
    public static double Round(double x)
    {
        double r = Math.Floor(x);
        return x - r >= 0.5 ? r + 1 : r;
    }

    /// <summary>2^k for integer k in [−1022, 1023], built from the bit pattern.</summary>
    private static double Pow2I(int k)
    {
        if (k > 1023) return double.PositiveInfinity;
        if (k < -1022) return 0;
        return BitConverter.Int64BitsToDouble((long)(k + 1023) << 52);
    }

    public static double Exp(double x)
    {
        if (double.IsNaN(x)) return double.NaN;
        if (x > 709.7) return double.PositiveInfinity;
        if (x < -708) return 0;
        double k = Round(x / Ln2);
        double r = x - k * Ln2Hi - k * Ln2Lo; // |r| <= 0.347
        double s = 1;
        for (int n = 16; n >= 1; n--) s = 1 + (r * s) / n;
        return s * Pow2I((int)k);
    }

    public static double Log(double x)
    {
        if (double.IsNaN(x) || x < 0) return double.NaN;
        if (x == 0) return double.NegativeInfinity;
        if (double.IsPositiveInfinity(x)) return double.PositiveInfinity;
        int e = 0;
        if (x < 2.2250738585072014e-308)
        {
            x *= 18014398509481984; // 2^54, normalise subnormals
            e -= 54;
        }
        long bits = BitConverter.DoubleToInt64Bits(x);
        int hi = (int)(bits >> 32);
        e += (int)(((uint)hi >> 20) & 0x7ff) - 1023;
        hi = (hi & 0x000fffff) | 0x3ff00000; // mantissa in [1, 2)
        double m = BitConverter.Int64BitsToDouble(((long)hi << 32) | (bits & 0xffffffffL));
        if (m > 1.4142135623730951)
        {
            m *= 0.5;
            e += 1;
        }
        // log(m) = 2 atanh(s), s = (m − 1)/(m + 1), |s| <= 0.1716
        double s = (m - 1) / (m + 1);
        double s2 = s * s;
        double t = 0;
        for (int n = 25; n >= 1; n -= 2) t = 1.0 / n + s2 * t;
        return 2 * s * t + e * Ln2;
    }

    /// <summary>x^y. Small integer exponents use exact repeated multiplication.</summary>
    public static double Pow(double x, double y)
    {
        if (y == 0) return 1;
        if (y == 1) return x;
        if (y == 2) return x * x;
        if (y == 0.5) return Math.Sqrt(x);
        if (y == Math.Floor(y) && Math.Abs(y) <= 64)
        {
            double r = 1;
            double b = x;
            int n = (int)Math.Abs(y);
            while (n > 0)
            {
                if ((n & 1) != 0) r *= b;
                b *= b;
                n >>= 1;
            }
            return y < 0 ? 1 / r : r;
        }
        if (x == 0) return y > 0 ? 0 : double.PositiveInfinity;
        if (x < 0) return double.NaN;
        return Exp(y * Log(x));
    }

    private static double SinPoly(double x)
    {
        double x2 = x * x;
        double t = 1;
        for (int n = 17; n >= 3; n -= 2) t = 1 - (x2 / (n * (n - 1))) * t;
        return x * t;
    }

    private static double CosPoly(double x)
    {
        double x2 = x * x;
        double t = 1;
        for (int n = 18; n >= 2; n -= 2) t = 1 - (x2 / (n * (n - 1))) * t;
        return t;
    }

    public static double Sin(double x)
    {
        x -= TwoPi * Round(x / TwoPi); // [−π, π]
        double q = Round(x / HalfPi); // −2..2
        double r = x - q * HalfPi; // [−π/4, π/4]
        return (int)(((q % 4) + 4) % 4) switch
        {
            0 => SinPoly(r),
            1 => CosPoly(r),
            2 => -SinPoly(r),
            _ => -CosPoly(r),
        };
    }

    public static double Cos(double x)
    {
        x -= TwoPi * Round(x / TwoPi);
        double q = Round(x / HalfPi);
        double r = x - q * HalfPi;
        return (int)(((q % 4) + 4) % 4) switch
        {
            0 => CosPoly(r),
            1 => -SinPoly(r),
            2 => -CosPoly(r),
            _ => SinPoly(r),
        };
    }

    /// <summary>x².</summary>
    public static double Sq(double x) => x * x;

    /// <summary>√(x² + y²), without the implementation-defined Math.Hypot.</summary>
    public static double Hypot(double x, double y) => Math.Sqrt(x * x + y * y);

    public static double Clamp(double x, double lo, double hi) => x < lo ? lo : x > hi ? hi : x;
}
