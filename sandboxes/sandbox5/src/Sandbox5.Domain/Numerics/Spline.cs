namespace Sandbox5.Domain.Numerics;

public static class Spline
{
    /// <summary>
    /// Monotone cubic interpolation (Fritsch &amp; Carlson 1980) through control points: C¹,
    /// passes through every point, never overshoots between two points, constant beyond the
    /// end points. The points are sorted by x; equal x's keep the first. + − × ÷ √ only.
    /// </summary>
    public static Func<double, double> Monotone(IReadOnlyList<double> xs, IReadOnlyList<double> ys)
    {
        Knots(xs, ys, out double[] px, out double[] py);
        int n = px.Length;
        if (n == 0) return static _ => 0;
        if (n == 1)
        {
            double only = py[0];
            return _ => only;
        }
        double[] d = new double[n - 1];
        for (int i = 0; i < n - 1; i++) d[i] = (py[i + 1] - py[i]) / (px[i + 1] - px[i]);
        double[] m = new double[n];
        m[0] = d[0];
        for (int i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
        m[n - 1] = d[n - 2];
        for (int i = 0; i < n - 1; i++)
        {
            if (d[i] == 0)
            {
                m[i] = 0;
                m[i + 1] = 0;
                continue;
            }
            double a = m[i] / d[i];
            double b = m[i + 1] / d[i];
            double s = a * a + b * b;
            if (s > 9)
            {
                double t = 3 / Math.Sqrt(s);
                m[i] = t * a * d[i];
                m[i + 1] = t * b * d[i];
            }
        }
        return x =>
        {
            if (x <= px[0]) return py[0];
            if (x >= px[n - 1]) return py[n - 1];
            int i = 0;
            while (x > px[i + 1]) i++;
            double h = px[i + 1] - px[i];
            double t = (x - px[i]) / h;
            double t2 = t * t;
            double t3 = t2 * t;
            return (2 * t3 - 3 * t2 + 1) * py[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * py[i + 1] + (t3 - t2) * h * m[i + 1];
        };
    }

    /// <summary>The control points sorted by x (stable), dropping every x that does not increase.</summary>
    public static void Knots(IReadOnlyList<double> xs, IReadOnlyList<double> ys, out double[] px, out double[] py)
    {
        var lx = new List<double>();
        var ly = new List<double>();
        foreach (int i in Enumerable.Range(0, xs.Count).OrderBy(i => xs[i]))
        {
            if (lx.Count > 0 && xs[i] <= lx[^1]) continue;
            lx.Add(xs[i]);
            ly.Add(ys[i]);
        }
        px = lx.ToArray();
        py = ly.ToArray();
    }
}
