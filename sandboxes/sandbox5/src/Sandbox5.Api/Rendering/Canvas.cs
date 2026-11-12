namespace Sandbox5.Api.Rendering;

/// <summary>A colour with opacity.</summary>
public readonly record struct Rgba(int R, int G, int B, double A = 1)
{
    public static Rgba Hex(int rgb, double a = 1) => new((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, a);
}

/// <summary>
/// A small anti-aliased rasteriser over an opaque RGB image: stroked paths (solid or dashed),
/// filled polygons and markers. Coordinates are pixels; a pixel's centre is at (x + 0.5, y + 0.5).
/// Coverage only depends on the geometry's position relative to the pixel, so neighbouring
/// map tiles that draw the same feature join without a seam.
/// </summary>
public sealed class Canvas
{
    public int Width { get; }
    public int Height { get; }
    /// <summary>Pixels packed as 0xRRGGBB, row by row from the top.</summary>
    public int[] Pixels { get; }

    private readonly float[] _mask;
    private int _mx0, _my0, _mx1, _my1;

    public Canvas(int width, int height, int[]? pixels = null)
    {
        Width = width;
        Height = height;
        Pixels = pixels ?? new int[width * height];
        _mask = new float[width * height];
        ResetDirty();
    }

    private void ResetDirty()
    {
        _mx0 = Width;
        _my0 = Height;
        _mx1 = -1;
        _my1 = -1;
    }

    private void Blend(int i, Rgba c, double coverage)
    {
        double a = c.A * coverage;
        if (a <= 0) return;
        int p = Pixels[i];
        int r = (p >> 16) & 255, g = (p >> 8) & 255, b = p & 255;
        r = (int)(r + (c.R - r) * a + 0.5);
        g = (int)(g + (c.G - g) * a + 0.5);
        b = (int)(b + (c.B - b) * a + 0.5);
        Pixels[i] = (r << 16) | (g << 8) | b;
    }

    // ------------------------------------------------------------------ strokes

    /// <summary>
    /// Add one segment of a path to the pending stroke. <paramref name="s0"/> is the length of
    /// the path before the segment (for the dash phase); a dash period of 0 means solid.
    /// Solid strokes have round caps and joins, dashed ones butt ends.
    /// </summary>
    public void AddSegment(double x0, double y0, double x1, double y1, double width, double s0 = 0, double dashOn = 0, double dashPeriod = 0)
    {
        double half = width / 2;
        double reach = half + 1;
        int ia = Math.Max(0, (int)Math.Floor(Math.Min(x0, x1) - reach));
        int ib = Math.Min(Width - 1, (int)Math.Ceiling(Math.Max(x0, x1) + reach));
        int ja = Math.Max(0, (int)Math.Floor(Math.Min(y0, y1) - reach));
        int jb = Math.Min(Height - 1, (int)Math.Ceiling(Math.Max(y0, y1) + reach));
        if (ia > ib || ja > jb) return;
        double ex = x1 - x0;
        double ey = y1 - y0;
        double len2 = ex * ex + ey * ey;
        double len = Math.Sqrt(len2);
        bool dashed = dashPeriod > 0;
        for (int j = ja; j <= jb; j++)
        {
            double py = j + 0.5 - y0;
            int row = j * Width;
            for (int i = ia; i <= ib; i++)
            {
                double px = i + 0.5 - x0;
                double t = len2 > 0 ? (px * ex + py * ey) / len2 : 0;
                double tc = t < 0 ? 0 : t > 1 ? 1 : t;
                double dx = px - tc * ex;
                double dy = py - tc * ey;
                double d = Math.Sqrt(dx * dx + dy * dy);
                double cov = Math.Min(half + 0.5 - d, width);
                if (cov <= 0) continue;
                if (cov > 1) cov = 1;
                if (dashed)
                {
                    // butt ends: nothing beyond the segment's ends, and only inside a dash
                    double over = (t < 0 ? -t : t > 1 ? t - 1 : 0) * len;
                    if (over > 0.5) continue;
                    double m = (s0 + tc * len) % dashPeriod;
                    double edge = m < dashOn ? Math.Min(m, dashOn - m) + 0.5 : 0.5 - Math.Min(m - dashOn, dashPeriod - m);
                    if (edge <= 0) continue;
                    if (edge < 1) cov *= edge;
                }
                int q = row + i;
                if (cov > _mask[q]) _mask[q] = (float)cov;
            }
        }
        if (ia < _mx0) _mx0 = ia;
        if (ib > _mx1) _mx1 = ib;
        if (ja < _my0) _my0 = ja;
        if (jb > _my1) _my1 = jb;
    }

    /// <summary>Add a polyline (x and y in turn) to the pending stroke.</summary>
    public void AddPolyline(IReadOnlyList<double> pts, double width, double dashOn = 0, double dashPeriod = 0)
    {
        double s = 0;
        for (int k = 2; k < pts.Count; k += 2)
        {
            double x0 = pts[k - 2], y0 = pts[k - 1], x1 = pts[k], y1 = pts[k + 1];
            AddSegment(x0, y0, x1, y1, width, s, dashOn, dashPeriod);
            s += Math.Sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
        }
    }

    /// <summary>Paint the pending stroke in one colour (overlapping segments do not add up) and clear it.</summary>
    public void Stroke(Rgba color)
    {
        for (int j = _my0; j <= _my1; j++)
        {
            int row = j * Width;
            for (int i = _mx0; i <= _mx1; i++)
            {
                float m = _mask[row + i];
                if (m <= 0) continue;
                Blend(row + i, color, m);
                _mask[row + i] = 0;
            }
        }
        ResetDirty();
    }

    // ------------------------------------------------------------------ fills

    /// <summary>Fill a polygon (even–odd rule), anti-aliased by 4 scanlines per pixel row with exact horizontal coverage.</summary>
    public void FillPolygon(IReadOnlyList<double> xs, IReadOnlyList<double> ys, Rgba color)
    {
        int n = xs.Count;
        if (n < 3) return;
        double minX = double.PositiveInfinity, minY = double.PositiveInfinity, maxX = double.NegativeInfinity, maxY = double.NegativeInfinity;
        for (int k = 0; k < n; k++)
        {
            if (xs[k] < minX) minX = xs[k];
            if (xs[k] > maxX) maxX = xs[k];
            if (ys[k] < minY) minY = ys[k];
            if (ys[k] > maxY) maxY = ys[k];
        }
        int ja = Math.Max(0, (int)Math.Floor(minY));
        int jb = Math.Min(Height - 1, (int)Math.Floor(maxY));
        int ia = Math.Max(0, (int)Math.Floor(minX));
        int ib = Math.Min(Width - 1, (int)Math.Floor(maxX));
        if (ia > ib || ja > jb) return;
        const int Sub = 4;
        double[] cov = new double[ib - ia + 1];
        var cross = new List<double>(16);
        for (int j = ja; j <= jb; j++)
        {
            Array.Clear(cov);
            for (int s = 0; s < Sub; s++)
            {
                double y = j + (s + 0.5) / Sub;
                cross.Clear();
                for (int a = 0, b = n - 1; a < n; b = a++)
                {
                    if (ys[a] > y != ys[b] > y) cross.Add((xs[b] - xs[a]) * (y - ys[a]) / (ys[b] - ys[a]) + xs[a]);
                }
                cross.Sort();
                for (int k = 0; k + 1 < cross.Count; k += 2)
                {
                    double xa = Math.Max(cross[k], ia);
                    double xb = Math.Min(cross[k + 1], ib + 1);
                    if (xb <= xa) continue;
                    int p0 = (int)Math.Floor(xa);
                    int p1 = Math.Min(ib, (int)Math.Floor(xb));
                    for (int p = p0; p <= p1; p++)
                    {
                        double w = Math.Min(xb, p + 1) - Math.Max(xa, p);
                        if (w > 0) cov[p - ia] += w / Sub;
                    }
                }
            }
            int row = j * Width;
            for (int i = ia; i <= ib; i++)
            {
                double c = cov[i - ia];
                if (c > 0) Blend(row + i, color, c > 1 ? 1 : c);
            }
        }
    }

    // ------------------------------------------------------------------ markers

    /// <summary>
    /// A marker centred at (cx, cy): a disc of radius <paramref name="r"/>, or a diamond with
    /// that half-diagonal, filled and outlined with up to two strokes centred on its edge
    /// (the wider one first).
    /// </summary>
    public void Marker(double cx, double cy, double r, bool diamond, Rgba fill, Rgba outer, double outerWidth, Rgba? inner = null, double innerWidth = 0)
    {
        double reach = r + outerWidth / 2 + 1.5;
        int ia = Math.Max(0, (int)Math.Floor(cx - reach));
        int ib = Math.Min(Width - 1, (int)Math.Ceiling(cx + reach));
        int ja = Math.Max(0, (int)Math.Floor(cy - reach));
        int jb = Math.Min(Height - 1, (int)Math.Ceiling(cy + reach));
        const double InvSqrt2 = 0.7071067811865476;
        for (int j = ja; j <= jb; j++)
        {
            for (int i = ia; i <= ib; i++)
            {
                double dx = i + 0.5 - cx;
                double dy = j + 0.5 - cy;
                // signed distance to the edge (negative inside)
                double d = diamond ? (Math.Abs(dx) + Math.Abs(dy) - r) * InvSqrt2 : Math.Sqrt(dx * dx + dy * dy) - r;
                int q = j * Width + i;
                double f = 0.5 - d;
                if (f > 0) Blend(q, fill, f > 1 ? 1 : f);
                double o = outerWidth / 2 + 0.5 - Math.Abs(d);
                if (o > 0) Blend(q, outer, o > 1 ? 1 : o);
                if (inner is Rgba ic)
                {
                    double n = innerWidth / 2 + 0.5 - Math.Abs(d);
                    if (n > 0) Blend(q, ic, n > 1 ? 1 : n);
                }
            }
        }
    }
}
