using Sandbox5.Domain.Numerics;

namespace Sandbox5.Domain.Generation;

/// <summary>
/// Packed keys of lattice cells: one exact integer below 2^44 per (i, j), the same number
/// the TypeScript generator uses, so keys can be exchanged with its exports.
/// </summary>
public static class CellKeys
{
    private const int Off = 2097152; // 2^21: lattice indices in [−2^21, 2^21)
    private const long Span = 4194304; // 2^22

    public static long Pack(int i, int j) => (i + Off) * Span + (j + Off);

    public static int I(long key) => (int)(key / Span) - Off;

    public static int J(long key) => (int)(key % Span) - Off;
}

/// <summary>A Gabriel-graph neighbour of a cell.</summary>
public readonly record struct Neighbour(long Key, double D2);

public sealed record LevelOptions(int Seed, double Size, double Jitter, double Warp, double WarpFreq);

/// <summary>
/// One level of the map hierarchy: a stateless ("infinite") Voronoi diagram on a jittered
/// square lattice, with optional domain-warped borders (a port of world/level.ts).
///
/// Lattice cell (i, j) of side <see cref="Size"/> metres holds exactly one site at a hashed
/// offset, so the diagram is a pure function of (seed, position): any point of an unbounded
/// world can be evaluated without a mesh and in any order. Border warp displaces the query
/// point by a two-octave fBm vector field before the nearest-site search; the sites do not
/// move. The class is immutable and thread-safe.
/// </summary>
public sealed class Level
{
    private const int StSx = 0x3a01;
    private const int StSy = 0x3a02;
    private static readonly FbmParams WarpFbm = new(2, 2, 0.5);

    public int Seed { get; }
    /// <summary>Lattice spacing, metres.</summary>
    public double Size { get; }
    /// <summary>0 = sites on the cell centres (a square grid), 1 = anywhere in the lattice cell.</summary>
    public double Jitter { get; }
    /// <summary>Border warp amplitude, in cell sizes (0 = straight Voronoi edges).</summary>
    public double Warp { get; }
    /// <summary>Border warp frequency, in noise cycles per cell.</summary>
    public double WarpFreq { get; }

    private readonly double _inv;
    /// <summary>(1 − jitter)/2: the minimum L∞ gap from a lattice cell border to its site.</summary>
    private readonly double _lb;
    private readonly int _wsx;
    private readonly int _wsy;

    public Level(LevelOptions o)
    {
        Seed = o.Seed;
        Size = o.Size;
        Jitter = Math.Min(1, Math.Max(0, o.Jitter));
        Warp = Math.Max(0, o.Warp);
        WarpFreq = o.WarpFreq;
        _inv = 1 / o.Size;
        _lb = (1 - Jitter) / 2;
        _wsx = Seed ^ 0x2f6b1e3d;
        _wsy = Seed ^ 0x5bd1e995;
    }

    /// <summary>Site of lattice cell (i, j), metres.</summary>
    public double SiteX(int i, int j) => (i + 0.5 + (Hash.ToUnit(Hash.Hash4(Seed, StSx, i, j)) - 0.5) * Jitter) * Size;

    public double SiteY(int i, int j) => (j + 0.5 + (Hash.ToUnit(Hash.Hash4(Seed, StSy, i, j)) - 0.5) * Jitter) * Size;

    /// <summary>Max displacement of the border warp, metres (fBm is bounded by 1).</summary>
    public double WarpReach => Warp * Size;

    /// <summary>Key of the cell containing world point (wx, wy).</summary>
    public long Query(double wx, double wy)
    {
        double x = wx;
        double y = wy;
        if (Warp > 0)
        {
            double f = WarpFreq * _inv;
            double a = Warp * Size;
            double nx = wx * f;
            double ny = wy * f;
            x += a * Noise.Fbm(_wsx, nx, ny, WarpFbm);
            y += a * Noise.Fbm(_wsy, nx + 31.7, ny - 47.3, WarpFbm);
        }
        double lx = x * _inv;
        double ly = y * _inv;
        int ci = (int)Math.Floor(lx);
        int cj = (int)Math.Floor(ly);
        double jit = Jitter;
        int seed = Seed;
        double best = double.PositiveInfinity;
        int bi = ci;
        int bj = cj;
        // Chebyshev rings with Worley's pruning: a site in ring r is ≥ r − 1 + (1 − jitter)/2
        // away in L∞, hence in L2. Ring 3 always prunes (best ≤ √2 within rings 0..1).
        for (int r = 0; r <= 3; r++)
        {
            if (r >= 1)
            {
                double b = r - 1 + _lb;
                if (b > 0 && b * b > best) break;
            }
            for (int dj = -r; dj <= r; dj++)
            {
                int step = r == 0 || dj == -r || dj == r ? 1 : 2 * r;
                for (int di = -r; di <= r; di += step)
                {
                    int i = ci + di;
                    int j = cj + dj;
                    double dx = lx - (i + 0.5 + (Hash.ToUnit(Hash.Hash4(seed, StSx, i, j)) - 0.5) * jit);
                    double dy = ly - (j + 0.5 + (Hash.ToUnit(Hash.Hash4(seed, StSy, i, j)) - 0.5) * jit);
                    double d = dx * dx + dy * dy;
                    // ties broken by (j, i) so the answer never depends on the visiting order
                    if (d < best || (d == best && (j < bj || (j == bj && i < bi))))
                    {
                        best = d;
                        bi = i;
                        bj = j;
                    }
                }
            }
        }
        return CellKeys.Pack(bi, bj);
    }

    /// <summary>
    /// Gabriel-graph neighbours of cell (i, j), nearest first: B is a neighbour of A when no
    /// other site lies inside the circle with diameter AB. The Gabriel graph is a subgraph of
    /// the Delaunay graph and always contains each site's nearest neighbour; the relation is
    /// symmetric.
    /// </summary>
    public Neighbour[] Neighbours(int i, int j)
    {
        double ax = SiteX(i, j);
        double ay = SiteY(i, j);
        var result = new List<Neighbour>(8);
        for (int dj = -2; dj <= 2; dj++)
        {
            for (int di = -2; di <= 2; di++)
            {
                if (di == 0 && dj == 0) continue;
                int bi = i + di;
                int bj = j + dj;
                double bx = SiteX(bi, bj);
                double by = SiteY(bi, bj);
                double mx = (ax + bx) / 2;
                double my = (ay + by) / 2;
                double r2 = ((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) / 4;
                double r = Math.Sqrt(r2);
                int i0 = (int)Math.Floor((mx - r) * _inv);
                int i1 = (int)Math.Floor((mx + r) * _inv);
                int j0 = (int)Math.Floor((my - r) * _inv);
                int j1 = (int)Math.Floor((my + r) * _inv);
                bool empty = true;
                for (int cj = j0; cj <= j1 && empty; cj++)
                {
                    for (int ci = i0; ci <= i1; ci++)
                    {
                        if ((ci == i && cj == j) || (ci == bi && cj == bj)) continue;
                        double cx = SiteX(ci, cj) - mx;
                        double cy = SiteY(ci, cj) - my;
                        if (cx * cx + cy * cy < r2)
                        {
                            empty = false;
                            break;
                        }
                    }
                }
                if (empty) result.Add(new Neighbour(CellKeys.Pack(bi, bj), 4 * r2));
            }
        }
        result.Sort(static (a, b) => a.D2 < b.D2 ? -1 : a.D2 > b.D2 ? 1 : a.Key.CompareTo(b.Key));
        return result.ToArray();
    }
}
