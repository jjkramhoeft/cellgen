namespace Sandbox5.Domain.Numerics;

/// <summary>Octave parameters of a fractal noise.</summary>
public readonly record struct FbmParams(double Octaves, double Lacunarity, double Gain);

/// <summary>
/// Seeded 2D simplex and classic Perlin noise with a stateless lattice hash, plus fBm and
/// ridged fBm (a port of shared/core/noise.ts). Arithmetic only, so it is deterministic.
/// </summary>
public static class Noise
{
    private static readonly double F2 = 0.5 * (Math.Sqrt(3) - 1);
    private static readonly double G2 = (3 - Math.Sqrt(3)) / 6;

    // 12 unit gradients at 30° steps (literal constants, no runtime trigonometry).
    private static readonly double[] GX =
    [
        1, 0.8660254037844387, 0.5, 0, -0.5, -0.8660254037844387, -1, -0.8660254037844387, -0.5, 0, 0.5,
        0.8660254037844387,
    ];
    private static readonly double[] GY =
    [
        0, 0.5, 0.8660254037844387, 1, 0.8660254037844387, 0.5, 0, -0.5, -0.8660254037844387, -1,
        -0.8660254037844387, -0.5,
    ];

    /// <summary>Output scale so that simplex noise spans roughly [−1, 1].</summary>
    private const double Scale = 99.204;
    private const double Sqrt2 = 1.4142135623730951;

    // Octave rotation by the exact Pythagorean angle (cos, sin) = (0.8, 0.6) hides lattice alignment.
    private const double RC = 0.8;
    private const double RS = 0.6;

    /// <summary>Raw 2D simplex noise in [−1, 1].</summary>
    public static double Simplex2(int seed, double x, double y)
    {
        double s = (x + y) * F2;
        double i = Math.Floor(x + s);
        double j = Math.Floor(y + s);
        double t = (i + j) * G2;
        double x0 = x - (i - t);
        double y0 = y - (j - t);
        int i1, j1;
        if (x0 > y0)
        {
            i1 = 1;
            j1 = 0;
        }
        else
        {
            i1 = 0;
            j1 = 1;
        }
        double x1 = x0 - i1 + G2;
        double y1 = y0 - j1 + G2;
        double x2 = x0 - 1 + 2 * G2;
        double y2 = y0 - 1 + 2 * G2;
        int ii = (int)i;
        int jj = (int)j;
        double n = 0;
        double t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 > 0)
        {
            uint g = Hash.Pcg3(ii, jj, seed) % 12;
            t0 *= t0;
            n += t0 * t0 * (GX[g] * x0 + GY[g] * y0);
        }
        double t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 > 0)
        {
            uint g = Hash.Pcg3(ii + i1, jj + j1, seed) % 12;
            t1 *= t1;
            n += t1 * t1 * (GX[g] * x1 + GY[g] * y1);
        }
        double t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 > 0)
        {
            uint g = Hash.Pcg3(ii + 1, jj + 1, seed) % 12;
            t2 *= t2;
            n += t2 * t2 * (GX[g] * x2 + GY[g] * y2);
        }
        return Scale * n;
    }

    /// <summary>
    /// Classic 2D Perlin (gradient) noise in [−1, 1]: a gradient at every integer lattice
    /// point, blended with the quintic fade. Zero at every lattice point.
    /// </summary>
    public static double Perlin2(int seed, double x, double y)
    {
        double fi = Math.Floor(x);
        double fj = Math.Floor(y);
        double fx = x - fi;
        double fy = y - fj;
        int i = (int)fi;
        int j = (int)fj;
        double u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
        double v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
        uint g00 = Hash.Pcg3(i, j, seed) % 12;
        uint g10 = Hash.Pcg3(i + 1, j, seed) % 12;
        uint g01 = Hash.Pcg3(i, j + 1, seed) % 12;
        uint g11 = Hash.Pcg3(i + 1, j + 1, seed) % 12;
        double n00 = GX[g00] * fx + GY[g00] * fy;
        double n10 = GX[g10] * (fx - 1) + GY[g10] * fy;
        double n01 = GX[g01] * fx + GY[g01] * (fy - 1);
        double n11 = GX[g11] * (fx - 1) + GY[g11] * (fy - 1);
        double a = n00 + u * (n10 - n00);
        double b = n01 + u * (n11 - n01);
        // unit gradients bound the raw value by √2 / 2 (reached at a cell centre)
        return Sqrt2 * (a + v * (b - a));
    }

    private static int OctaveCount(in FbmParams p) => (int)Math.Max(1, Math.Floor(p.Octaves));

    private static int OctaveSeed(int seed, int o)
    {
        unchecked
        {
            return seed + o * 0x3c6ef372;
        }
    }

    /// <summary>Fractal Brownian motion of simplex noise, normalised to roughly [−1, 1].</summary>
    public static double Fbm(int seed, double x, double y, in FbmParams p)
    {
        double sum = 0, amp = 1, norm = 0, px = x, py = y;
        int oct = OctaveCount(p);
        for (int o = 0; o < oct; o++)
        {
            sum += amp * Simplex2(OctaveSeed(seed, o), px, py);
            norm += amp;
            amp *= p.Gain;
            double nx = (RC * px - RS * py) * p.Lacunarity + 17.3;
            double ny = (RS * px + RC * py) * p.Lacunarity - 9.1;
            px = nx;
            py = ny;
        }
        return sum / norm;
    }

    /// <summary>Fractal Brownian motion of Perlin noise in [−1, 1], divided by the sum of the octave weights.</summary>
    public static double PerlinFbm(int seed, double x, double y, in FbmParams p)
    {
        double sum = 0, amp = 1, norm = 0, px = x, py = y;
        int oct = OctaveCount(p);
        for (int o = 0; o < oct; o++)
        {
            sum += amp * Perlin2(OctaveSeed(seed, o), px, py);
            norm += amp;
            amp *= p.Gain;
            double nx = (RC * px - RS * py) * p.Lacunarity + 17.3;
            double ny = (RS * px + RC * py) * p.Lacunarity - 9.1;
            px = nx;
            py = ny;
        }
        return sum / norm;
    }

    /// <summary>Ridged multifractal (Musgrave-style weighting), mapped to [−1, 1].</summary>
    public static double Ridged(int seed, double x, double y, in FbmParams p)
    {
        double sum = 0, amp = 1, norm = 0, weight = 1, px = x, py = y;
        int oct = OctaveCount(p);
        for (int o = 0; o < oct; o++)
        {
            double r = 1 - Math.Abs(Simplex2(OctaveSeed(seed, o), px, py));
            r *= r;
            r *= weight;
            weight = r * 2 > 1 ? 1 : r * 2;
            sum += amp * r;
            norm += amp;
            amp *= p.Gain;
            double nx = (RC * px - RS * py) * p.Lacunarity + 17.3;
            double ny = (RS * px + RC * py) * p.Lacunarity - 9.1;
            px = nx;
            py = ny;
        }
        return (sum / norm) * 2 - 1;
    }
}
