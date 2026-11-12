using System.Collections.Concurrent;
using System.Diagnostics;
using Sandbox5.Domain.Model;
using Sandbox5.Domain.Numerics;

namespace Sandbox5.Domain.Generation;

public sealed record LakeParams
{
    /// <summary>Chance that an eligible patch holds a lake, 0–1.</summary>
    public required double Frequency { get; init; }
    /// <summary>Lake size bounds: diameter of a circle of the lake's area, metres.</summary>
    public required double MinSize { get; init; }
    public required double MaxSize { get; init; }
}

/// <summary>One lake: a star-shaped outline around a river node.</summary>
public sealed class LakeShape
{
    /// <summary>Index within its region.</summary>
    public required int Id { get; init; }
    public required long Region { get; init; }
    /// <summary>Patch (merged root) the lake was placed in.</summary>
    public required long Patch { get; init; }
    /// <summary>The river node at the lake's centre (index into the region's rivers) and its flow.</summary>
    public required int Node { get; init; }
    public required int Flow { get; init; }
    /// <summary>Centre, metres.</summary>
    public required double Cx { get; init; }
    public required double Cy { get; init; }
    /// <summary>Nominal size drawn for it (diameter, metres) and its size after the clip.</summary>
    public required double Nominal { get; init; }
    public required double Size { get; init; }
    /// <summary>Area, m².</summary>
    public required double Area { get; init; }
    /// <summary>Outline (<see cref="Lakes.Rays"/> vertices, counter-clockwise from +x).</summary>
    public required double[] X { get; init; }
    public required double[] Y { get; init; }
    /// <summary>Bounding box.</summary>
    public required double X0 { get; init; }
    public required double Y0 { get; init; }
    public required double X1 { get; init; }
    public required double Y1 { get; init; }

    public bool Contains(double x, double y) => x >= X0 && x <= X1 && y >= Y0 && y <= Y1 && Lakes.InPolygon(X, Y, x, y);
}

public sealed class RegionLakes
{
    public required long Region { get; init; }
    public required List<LakeShape> Lakes { get; init; }
    /// <summary>Patches with a river (a node of flow ≥ <see cref="Generation.Lakes.LakeMinFlow"/>) that may hold a lake.</summary>
    public int Candidates { get; set; }
    /// <summary>Candidates that passed the frequency roll.</summary>
    public int Tries { get; set; }
    /// <summary>Tries dropped: centre too close to another lake, or clipped below the minimum size.</summary>
    public int Crowded { get; set; }
    public int TooSmall { get; set; }
    public double Ms { get; set; }
}

/// <summary>Why a patch may not hold a lake.</summary>
public enum LakeBlock
{
    /// <summary>It may hold a lake.</summary>
    None,
    Ocean,
    Mountains,
    Desert,
    Restricted,
}

/// <summary>
/// Lakes, placed per region after the rivers: a port of world/lakes.ts.
///
///   Candidates  every patch drawn in the region that may hold a lake and has a river node
///               in it (flow ≥ LakeMinFlow, on land) gets one try, with chance Frequency.
///               The lake is centred on one of those nodes, so its river runs in and out of
///               it. No lakes in ocean or mountains zones, in desert patches (at sea level)
///               or in restricted patches (those of a river-poor flat elevation zone).
///   Size        a nominal diameter in [MinSize, MaxSize], skewed towards small lakes.
///   Shape       a star-shaped polygon of 64 rays: an ellipse × (1 ± low-frequency noise).
///   Clip        every ray and outline edge is walked and clipped to eligible land of the
///               region, then the rays are tapered and rounded (only ever shortening them).
///
/// Deterministic and independent of the terrain. Thread-safe: each region is computed once.
/// </summary>
public sealed class Lakes
{
    /// <summary>Rays (outline vertices) per lake.</summary>
    public const int Rays = 64;
    /// <summary>Amplitude of the fBm term on the radius.</summary>
    private const double NoiseAmp = 0.3;
    /// <summary>Noise read on a circle of this radius in noise space: small, so the outline gets a few broad lobes.</summary>
    private const double NoiseRing = 0.75;
    private static readonly FbmParams NoiseFbm = new(2, 2, 0.35);
    /// <summary>After the clip, neighbouring rays differ by at most this × the nominal radius.</summary>
    public const double Taper = 0.09;
    /// <summary>Rounding passes after the taper.</summary>
    private const int RoundPasses = 3;
    /// <summary>A lake sits on a river node carrying at least this many attractors upstream.</summary>
    public const int LakeMinFlow = 4;
    /// <summary>Largest elongation of the ellipse (long axis / short axis).</summary>
    private const double MaxElong = 2.2;
    /// <summary>Steps per nominal radius when a ray is walked outwards.</summary>
    private const double RaySteps = 12;
    /// <summary>Walk step never finer than this, metres.</summary>
    private const double MinStep = 60;
    /// <summary>Gap between two lakes, × the sum of their nominal radii.</summary>
    private const double Gap = 1.15;
    /// <summary>Shortest a ray may be after the noise, × the nominal radius.</summary>
    private const double MinRay = 0.25;
    /// <summary>A lake whose shortest ray the clip leaves below this × the nominal radius is dropped.</summary>
    private const double MinKeep = 0.2;
    /// <summary>An outline edge that crosses ineligible land pulls both its ends in by this factor, at most this often.</summary>
    private const double EdgeShrink = 0.85;
    private const int EdgeTries = 12;

    private const int StLake = 0x1a01;
    private const int StShape = 0x1a02;

    /// <summary>Unit vectors of the rays (deterministic cos / sin).</summary>
    private static readonly double[] RayX = new double[Rays];
    private static readonly double[] RayY = new double[Rays];
    /// <summary>Area of the triangle between two neighbouring rays of length 1: ½ sin(2π / Rays).</summary>
    private static readonly double Wedge = 0.5 * DMath.Sin((2 * Math.PI) / Rays);

    static Lakes()
    {
        for (int k = 0; k < Rays; k++)
        {
            double a = (2 * Math.PI * k) / Rays;
            RayX[k] = DMath.Cos(a);
            RayY[k] = DMath.Sin(a);
        }
    }

    public World World { get; }
    public Rivers Rivers { get; }
    /// <summary>Supplies the sea-level biome of each patch (so any Biomes of this world gives the same lakes).</summary>
    public Biomes Biomes { get; }
    public LakeParams P { get; }

    private readonly ConcurrentDictionary<long, Lazy<RegionLakes>> _cache = new();
    private readonly ConcurrentDictionary<long, LakeBlock> _blockCache = new();

    public Lakes(World world, Rivers rivers, Biomes biomes, LakeParams p)
    {
        World = world;
        Rivers = rivers;
        Biomes = biomes;
        double lo = Math.Max(1, Math.Min(p.MinSize, p.MaxSize));
        P = new LakeParams { Frequency = Math.Max(0, Math.Min(1, p.Frequency)), MinSize = lo, MaxSize = Math.Max(lo, p.MaxSize) };
    }

    /// <summary>Is the point inside the polygon (even–odd rule)?</summary>
    public static bool InPolygon(double[] xs, double[] ys, double x, double y)
    {
        bool inside = false;
        int n = xs.Length;
        for (int i = 0, j = n - 1; i < n; j = i++)
        {
            if (ys[i] > y != ys[j] > y && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i]) inside = !inside;
        }
        return inside;
    }

    public RegionLakes? Peek(long rkey) => _cache.TryGetValue(rkey, out var l) && l.IsValueCreated ? l.Value : null;

    public RegionLakes Get(long rkey) => _cache.GetOrAdd(rkey, k => new Lazy<RegionLakes>(() => Compute(k))).Value;

    /// <summary>Why a (raw or merged) patch may not hold a lake.</summary>
    public LakeBlock Block(long pkey)
    {
        CellInfo c = World.PatchCell(pkey);
        long root = c.Patch;
        if (_blockCache.TryGetValue(root, out LakeBlock hit)) return hit;
        LakeBlock b = LakeBlock.None;
        if (c.Ocean) b = LakeBlock.Ocean;
        else if (ElevationZoneType.IndexOf(c.ElevationZone, false) == ElevationZoneType.MountainsIndex) b = LakeBlock.Mountains;
        else if (Biome.All[Biomes.OfPatch(root).SeaLevel].IsDesert) b = LakeBlock.Desert;
        else if (Restricted(c.ElevationZone)) b = LakeBlock.Restricted;
        _blockCache[root] = b;
        return b;
    }

    /// <summary>Restricted patches: those of a river-poor flat elevation zone (merged root).</summary>
    public bool Restricted(long zkey) => Rivers.IsSparseFlat(zkey);

    /// <summary>May a lake of region <paramref name="rkey"/> cover this point?</summary>
    public bool EligibleAt(long rkey, double x, double y)
    {
        CellInfo c = World.CellAt(x, y, true);
        return c.Region == rkey && !c.Ocean && Block(c.PatchRaw) == LakeBlock.None;
    }

    /// <summary>The lake at a point, if any.</summary>
    public LakeShape? LakeAt(double x, double y)
    {
        long rk = World.CellAt(x, y, true).Region;
        foreach (LakeShape l in Get(rk).Lakes)
            if (l.Contains(x, y))
                return l;
        return null;
    }

    /// <summary>
    /// River nodes of the region a lake may be centred on, by raw patch: on land of the
    /// region, not a root, flow ≥ LakeMinFlow, in a patch that may hold a lake.
    /// </summary>
    public Dictionary<long, List<int>> RiverNodes(long rkey)
    {
        World w = World;
        RegionRivers rr = Rivers.Get(rkey);
        var result = new Dictionary<long, List<int>>();
        for (int k = 0; k < rr.N; k++)
        {
            if (rr.Parent[k] < 0 || rr.Wet[k] != 0 || rr.Flow[k] < LakeMinFlow) continue;
            CellInfo c = w.CellAt(rr.X[k], rr.Y[k], true);
            if (c.Region != rkey || c.Ocean || Block(c.PatchRaw) != LakeBlock.None) continue;
            if (result.TryGetValue(c.PatchRaw, out var list)) list.Add(k);
            else result[c.PatchRaw] = [k];
        }
        return result;
    }

    public RegionLakes Compute(long rkey)
    {
        var sw = Stopwatch.StartNew();
        World w = World;
        LakeParams P = this.P;
        RegionNode reg = w.Region(rkey);
        var rng = new Sfc32(Hash.Hash4(w.SeedInt, StLake, reg.I, reg.J));
        var result = new RegionLakes { Region = rkey, Lakes = [] };
        if (P.Frequency <= 0) return result;
        // lakes come after the rivers: every lake is centred on a river node, so its river runs through it
        RegionRivers rr = Rivers.Get(rkey);
        Dictionary<long, List<int>> nodes = RiverNodes(rkey);
        var radii = new List<double>();
        foreach (long b in Rivers.RegionElevationZones(rkey))
        {
            CellInfo bc = w.ElevationZoneCell(b);
            if (bc.Ocean || ElevationZoneType.IndexOf(bc.ElevationZone, false) == ElevationZoneType.MountainsIndex) continue;
            foreach (long s in w.ElevationZonePatches(w.ElevationZone(b)))
            {
                CellInfo sc = w.PatchCell(s);
                if (sc.Ocean || sc.Region != rkey) continue;
                // the draws always happen, so the stream does not depend on which patches have rivers
                double roll = rng.Next();
                double u = rng.Next();
                double pick = rng.Next();
                if (!nodes.TryGetValue(s, out var list)) continue;
                result.Candidates++;
                if (roll >= P.Frequency) continue;
                result.Tries++;
                int k = list[Math.Min(list.Count - 1, (int)Math.Floor(pick * list.Count))];
                double cx = rr.X[k];
                double cy = rr.Y[k];
                double nominal = P.MinSize + (P.MaxSize - P.MinSize) * u * u;
                double radius = nominal / 2;
                bool crowded = false;
                for (int q = 0; q < result.Lakes.Count; q++)
                {
                    LakeShape o = result.Lakes[q];
                    if (DMath.Sq(o.Cx - cx) + DMath.Sq(o.Cy - cy) < DMath.Sq(Gap * (radius + radii[q])))
                    {
                        crowded = true;
                        break;
                    }
                }
                if (crowded)
                {
                    result.Crowded++;
                    continue;
                }
                LakeShape? lake = Shape(rkey, sc.Patch, result.Lakes.Count, cx, cy, nominal, k, rr.Flow[k]);
                if (lake == null)
                {
                    result.TooSmall++;
                    continue;
                }
                result.Lakes.Add(lake);
                radii.Add(radius);
            }
        }
        result.Ms = sw.Elapsed.TotalMilliseconds;
        return result;
    }

    /// <summary>Outline of one lake: noise-shaped rays, clipped to eligible land; null when too small after the clip.</summary>
    private LakeShape? Shape(long rkey, long patch, int id, double cx, double cy, double nominal, int node, int flow)
    {
        LakeParams P = this.P;
        double radius = nominal / 2;
        uint seed = Hash.Hash4(World.SeedInt, StShape, unchecked(CellKeys.I(patch) * 4099 + id), CellKeys.J(patch));
        var srng = new Sfc32(seed);
        // ellipse: random axis (rejection sampling in the unit disc, no trig), elongation, area kept
        double axX = 1;
        double axY = 0;
        for (;;)
        {
            double x = srng.Next() * 2 - 1;
            double y = srng.Next() * 2 - 1;
            double d = x * x + y * y;
            if (d <= 1 && d > 1e-6)
            {
                double s = 1 / Math.Sqrt(d);
                axX = x * s;
                axY = y * s;
                break;
            }
        }
        double e1 = srng.Next();
        double e2 = srng.Next();
        double e = 1 + (MaxElong - 1) * e1 * e2;
        double ia2 = 1 / e; // 1 / a² with a = √e (in units of the radius)
        double ib2 = e; // 1 / b² with b = 1 / √e
        double nx0 = srng.Next() * 1000;
        double ny0 = srng.Next() * 1000;
        double ring = NoiseRing * (0.6 + 0.8 * srng.Next());
        int nseed = unchecked((int)seed) ^ 0x5bd1e995;
        double[] r = new double[Rays];
        double step = Math.Max(MinStep, radius / RaySteps);
        for (int k = 0; k < Rays; k++)
        {
            double ux = RayX[k];
            double uy = RayY[k];
            double along = ux * axX + uy * axY;
            double across = uy * axX - ux * axY;
            double ell = 1 / Math.Sqrt(along * along * ia2 + across * across * ib2);
            double n = Noise.Fbm(nseed, nx0 + ux * ring, ny0 + uy * ring, NoiseFbm);
            double want = radius * Math.Max(MinRay, ell * (1 + NoiseAmp * n));
            // walk outwards; stop one step before the first point that may not be lake
            double got = want;
            for (double t = step; ; t += step)
            {
                double tt = Math.Min(t, want);
                if (!EligibleAt(rkey, cx + ux * tt, cy + uy * tt))
                {
                    got = Math.Max(0, tt - step);
                    break;
                }
                if (tt >= want) break;
            }
            r[k] = got;
        }
        // the rays are clean; anything ineligible reaching into the wedge between two rays must
        // cross its outer edge, so walk each edge and pull both ends in until it is clean
        for (int k = 0; k < Rays; k++)
        {
            int k2 = (k + 1) % Rays;
            for (int tries = 0; ; tries++)
            {
                if (r[k] == 0 && r[k2] == 0) break;
                double ax = cx + RayX[k] * r[k];
                double ay = cy + RayY[k] * r[k];
                double bx = cx + RayX[k2] * r[k2];
                double by = cy + RayY[k2] * r[k2];
                int m = (int)Math.Max(1, Math.Ceiling(Math.Sqrt(DMath.Sq(bx - ax) + DMath.Sq(by - ay)) / step));
                bool clean = true;
                for (int i = 1; i < m && clean; i++) clean = EligibleAt(rkey, ax + ((bx - ax) * i) / m, ay + ((by - ay) * i) / m);
                if (clean) break;
                if (tries >= EdgeTries)
                {
                    r[k] = r[k2] = 0;
                    break;
                }
                r[k] *= EdgeShrink;
                r[k2] *= EdgeShrink;
            }
        }
        // taper and round: rays only ever get shorter here, so the outline stays on eligible land
        double cap = Taper * radius;
        for (int pass = 0; pass < 2; pass++)
        {
            for (int k = 0; k < Rays; k++) r[k] = Math.Min(r[k], r[(k + Rays - 1) % Rays] + cap);
            for (int k = Rays - 1; k >= 0; k--) r[k] = Math.Min(r[k], r[(k + 1) % Rays] + cap);
        }
        double[] tmp = new double[Rays];
        for (int pass = 0; pass < RoundPasses; pass++)
        {
            for (int k = 0; k < Rays; k++) tmp[k] = Math.Min(r[k], 0.25 * (r[(k + Rays - 1) % Rays] + 2 * r[k] + r[(k + 1) % Rays]));
            Array.Copy(tmp, r, Rays);
        }
        double area = 0;
        for (int k = 0; k < Rays; k++) area += r[k] * r[(k + 1) % Rays];
        area *= Wedge;
        double size = 2 * Math.Sqrt(area / Math.PI);
        double shortest = double.PositiveInfinity;
        for (int k = 0; k < Rays; k++) shortest = Math.Min(shortest, r[k]);
        if (size < P.MinSize || shortest < MinKeep * radius) return null;
        if (size > P.MaxSize)
        {
            double f = P.MaxSize / size;
            for (int k = 0; k < Rays; k++) r[k] *= f;
            area *= f * f;
            size = P.MaxSize;
        }
        double[] xs = new double[Rays];
        double[] ys = new double[Rays];
        double x0 = double.PositiveInfinity, y0 = double.PositiveInfinity, x1 = double.NegativeInfinity, y1 = double.NegativeInfinity;
        for (int k = 0; k < Rays; k++)
        {
            xs[k] = cx + RayX[k] * r[k];
            ys[k] = cy + RayY[k] * r[k];
            if (xs[k] < x0) x0 = xs[k];
            if (xs[k] > x1) x1 = xs[k];
            if (ys[k] < y0) y0 = ys[k];
            if (ys[k] > y1) y1 = ys[k];
        }
        return new LakeShape { Id = id, Region = rkey, Patch = patch, Node = node, Flow = flow, Cx = cx, Cy = cy, Nominal = nominal, Size = size, Area = area, X = xs, Y = ys, X0 = x0, Y0 = y0, X1 = x1, Y1 = y1 };
    }
}
