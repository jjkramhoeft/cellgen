using System.Collections.Concurrent;
using System.Diagnostics;
using Sandbox5.Domain.Model;
using Sandbox5.Domain.Numerics;

namespace Sandbox5.Domain.Generation;

public sealed record TerrainParams
{
    /// <summary>Raster cell size, metres.</summary>
    public required double Res { get; init; }
    /// <summary>Channel slope S₀ at a flow of one attractor.</summary>
    public required double ChSlope { get; init; }
    /// <summary>Concavity θ of the river profiles: 0.375, 0.4375 or 0.5 (dyadic, so √ suffices).</summary>
    public required double Theta { get; init; }
    /// <summary>Multiplier on the hillslope steepness of every elevation zone type.</summary>
    public required double Hill { get; init; }
    /// <summary>Hillslope steepness per elevation zone type (index = <see cref="ElevationZoneType.All"/> order; the ocean entry is unused), m/m.</summary>
    public required double[] HillType { get; init; }
    /// <summary>Levelling of low-gradient elevation zones, 0–1.</summary>
    public required double Level { get; init; }
    /// <summary>River gradient factor per elevation zone type: how fast the bed rises upstream there, relative to S₀.</summary>
    public required double[] ChanFactor { get; init; }
    /// <summary>Floodplain half-width (metres) as a function of bed height: 4 control points of a monotone cubic spline.</summary>
    public required double[] FloodH { get; init; }
    public required double[] FloodW { get; init; }
    /// <summary>Scale the floodplain with river size: × √(flow / <see cref="Terrain.FloodRefFlow"/>).</summary>
    public required bool FloodFlow { get; init; }
    /// <summary>Strength of the region-scale relief field (mountain belts across elevation zones).</summary>
    public required double Relief { get; init; }
    /// <summary>Height of the ridge along region borders, metres.</summary>
    public required double Ridge { get; init; }
    /// <summary>Extra height where the basins of two different river systems meet, metres.</summary>
    public required double Divide { get; init; }
    /// <summary>Multiplier on the detail noise amplitude of every elevation zone type.</summary>
    public required double Noise { get; init; }
    /// <summary>Channel depth burnt below the bed profile, metres.</summary>
    public required double Burn { get; init; }
    /// <summary>Ocean depth far from the coast, metres.</summary>
    public required double Sea { get; init; }
    /// <summary>Regions per tile side (default: <see cref="Terrain.TileSide"/> of the region size).</summary>
    public int? Tile { get; init; }
}

/// <summary>One tile's height raster, cropped to the cells of its owned regions (plus a 2-cell margin).</summary>
public sealed class TerrainTile
{
    /// <summary>Tile key (CellKeys.Pack(I, J)) and regions per side.</summary>
    public required long Tile { get; init; }
    public required int K { get; init; }
    /// <summary>World position of cell (0, 0)'s centre, cell size, size.</summary>
    public required double X0 { get; init; }
    public required double Y0 { get; init; }
    public required double Res { get; init; }
    public required int Nx { get; init; }
    public required int Ny { get; init; }
    /// <summary>Final heights (metres; ocean negative).</summary>
    public required float[] H { get; init; }
    /// <summary><see cref="Terrain.OceanCell"/> / <see cref="Terrain.LandCell"/>.</summary>
    public required byte[] Cls { get; init; }
    /// <summary>Region of each cell, as an index into <see cref="RegKeys"/>.</summary>
    public required int[] Reg { get; init; }
    public required long[] RegKeys { get; init; }
    /// <summary>Mean final height (metres) of each (merged) patch's land cells in the tile's owned regions.</summary>
    public required long[] PatchKeys { get; init; }
    public required float[] PatchH { get; init; }
    /// <summary>Cells raised by the fill, and the largest raise (lakes / flats), metres.</summary>
    public required int Filled { get; init; }
    public required double MaxFill { get; init; }
    public required double Ms { get; init; }

    private Dictionary<long, float>? _patchMeans;

    /// <summary>Mean land height of a merged patch, or NaN when the tile holds no land of it.</summary>
    public double PatchHeight(long patch)
    {
        Dictionary<long, float>? m = _patchMeans;
        if (m == null)
        {
            m = new Dictionary<long, float>(PatchKeys.Length);
            for (int n = 0; n < PatchKeys.Length; n++) m[PatchKeys[n]] = PatchH[n];
            _patchMeans = m;
        }
        return m.TryGetValue(patch, out float h) ? h : double.NaN;
    }

    /// <summary>Region key of a tile cell.</summary>
    public long RegionAt(int q) => RegKeys[Reg[q]];

    /// <summary>Does the tile own (compute the final heights of) this region?</summary>
    public bool OwnsRegion(long rkey) => CellKeys.Pack(FloorDiv(CellKeys.I(rkey), K), FloorDiv(CellKeys.J(rkey), K)) == Tile;

    internal static int FloorDiv(int a, int b) => (int)Math.Floor((double)a / b);

    /// <summary>Bilinear sample of the raster (clamped at the raster edge).</summary>
    public double Sample(double x, double y)
    {
        double fx = (x - X0) / Res;
        double fy = (y - Y0) / Res;
        int i = (int)Math.Floor(fx);
        int j = (int)Math.Floor(fy);
        double u = fx - i;
        double v = fy - j;
        if (i < 0)
        {
            i = 0;
            u = 0;
        }
        else if (i >= Nx - 1)
        {
            i = Nx - 2;
            u = 1;
        }
        if (j < 0)
        {
            j = 0;
            v = 0;
        }
        else if (j >= Ny - 1)
        {
            j = Ny - 2;
            v = 1;
        }
        int q = j * Nx + i;
        double a = H[q] + ((double)H[q + 1] - H[q]) * u;
        double b = H[q + Nx] + ((double)H[q + Nx + 1] - H[q + Nx]) * u;
        return a + (b - a) * v;
    }
}

/// <summary>
/// Height map fitted to the map and its rivers, computed per tile on a raster: a port of
/// world/terrain.ts ("Option B" of docs/research/heightmap-from-biomes-and-rivers.md).
///
/// Tile (I, J) owns the k × k block of region lattice cells (i, j) with ⌊i/k⌋ = I, ⌊j/k⌋ = J
/// (k = 2 for the default 128 km regions). One raster covers the whole tile.
///
///   0. Channel profile   every river node gets a bed elevation from the steady-state
///                        stream-power law integrated upstream from the sea:
///                        z_k = z_parent + Δx·S₀·A^−θ, with A = flow and a gradient factor
///                        per elevation zone type. Strictly rising upstream.
///   1. Envelope          a geodesic distance (8-connected Dijkstra) from every river bed and
///                        the coast, with the hillslope steepness as the local cost: every
///                        land cell drains to a river or the sea. Rivers get a flat floodplain.
///   2. Divides           a ridge along region borders and a smaller one between river systems.
///   3. Detail noise      fbm / ridged per elevation zone type, masked to zero near channels.
///   4. Burn              the rivers are imprinted (AGREE: a trench plus a linear buffer).
///   5. Fill              ε-Priority-Flood over each owned region's land, seeded from the
///                        sea and the region border: no pits, everything drains.
///
/// Deterministic (+ − × ÷ √ and the simplex noise only, heap ties broken by cell index) and
/// seamless across tiles. Thread-safe: each tile and bed profile is computed once.
/// </summary>
public sealed class Terrain
{
    /// <summary>World span a tile aims for at most, metres: 2 regions of the default 128 km.</summary>
    private const double TileSpan = 256_000;
    /// <summary>Flow whose floodplain is exactly the curve when "scale with river size" is on.</summary>
    public const double FloodRefFlow = 100;
    /// <summary>Raster margin beyond the region, metres: sources this far out still shape the region.</summary>
    public const double Halo = 24_000;
    /// <summary>Blend width of the per-zone-type parameters across elevation zone borders, metres.</summary>
    private const double Blend = 4_000;
    /// <summary>Ridge widths, metres.</summary>
    private const double BorderW = 10_000;
    private const double DivideW = 6_000;
    /// <summary>Distance over which the sea deepens from the coast, metres.</summary>
    private const double SeaW = 40_000;
    /// <summary>Height above the river over which noise and ridges fade in, metres.</summary>
    private const double MaskH = 40;
    /// <summary>Cell size of the coarse per-region envelope that keeps river beds below their land, metres.</summary>
    private const double BedGridSize = 2000;
    /// <summary>Slack of the bed caps, and the smallest lowering of a cap that counts, metres.</summary>
    private const double BedSlack = 5;
    /// <summary>Gradient of a river below a cap (through a gorge): it only has to keep descending.</summary>
    private const double GorgeSlope = 0.0005;
    private const double BedTol = 1;
    /// <summary>ε of the Priority-Flood fill, metres.</summary>
    private const double Eps = 0.01;
    private const int StRelief = 0x7e11;
    private const int StNoise = 0x7e12;
    private const double Sqrt2 = 1.4142135623730951;

    /// <summary>Land-class codes of a raster cell.</summary>
    public const byte OceanCell = 0;
    public const byte LandCell = 1;

    /// <summary>Detail-noise relief per elevation zone type (index = <see cref="ElevationZoneType.All"/> order).</summary>
    private static readonly (double Amp, double Ridged)[] ZoneRelief =
    [
        (0, 0), // Ocean (unused: noise is land only)
        (8, 0), // Flat
        (25, 0.15), // Lowland
        (80, 1), // Hills
        (180, 1), // Mountains
    ];

    private static readonly FbmParams ReliefFbm = new(3, 2, 0.5);
    private static readonly FbmParams DetailFbm = new(4, 2.1, 0.5);
    private static readonly int[] DI = [1, -1, 0, 0, 1, 1, -1, -1];
    private static readonly int[] DJ = [0, 0, 1, -1, 1, -1, 1, -1];

    public World World { get; }
    public Rivers Rivers { get; }
    public TerrainParams P { get; }
    /// <summary>Regions per tile side.</summary>
    public int K { get; }
    /// <summary>Floodplain half-width (m) at a bed height (m).</summary>
    public Func<double, double> Flood { get; }

    private readonly int _seedR;
    private readonly int _seedN;
    private readonly ConcurrentDictionary<long, Lazy<TerrainTile>> _tiles = new();
    private readonly ConcurrentDictionary<long, Lazy<double[]>> _beds = new();
    private readonly ConcurrentDictionary<long, Lazy<(double[] Z, double[] Cap)>> _bases = new();
    private readonly ConcurrentDictionary<long, Lazy<BedGrid>> _grids = new();

    public Terrain(World world, Rivers rivers, TerrainParams p)
    {
        World = world;
        Rivers = rivers;
        P = p;
        K = Math.Max(1, p.Tile ?? TileSide(world.P.RegionSize));
        _seedR = unchecked((int)Hash.Hash4(world.SeedInt, StRelief, 0, 0));
        _seedN = unchecked((int)Hash.Hash4(world.SeedInt, StNoise, 0, 0));
        Flood = Spline.Monotone(p.FloodH, p.FloodW);
    }

    /// <summary>Regions per tile side: 2 for 128 km regions, 1 from 256 km up, up to 4 for small regions.</summary>
    public static int TileSide(double regionSize) => (int)Math.Max(1, Math.Min(4, Math.Floor(TileSpan / regionSize)));

    /// <summary>A^−θ for dyadic θ, with √ only (bit-exact everywhere).</summary>
    public static double InvPowTheta(double a, double theta)
    {
        double r2 = Math.Sqrt(a);
        if (theta == 0.5) return 1 / r2;
        double r4 = Math.Sqrt(r2);
        double r8 = Math.Sqrt(r4);
        if (theta == 0.375) return 1 / (r4 * r8);
        return 1 / (r4 * r8 * Math.Sqrt(r8));
    }

    private static double Smooth01(double t) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

    /// <summary>Key of the tile that owns a region.</summary>
    public long TileOf(long rkey) => CellKeys.Pack(TerrainTile.FloorDiv(CellKeys.I(rkey), K), TerrainTile.FloorDiv(CellKeys.J(rkey), K));

    /// <summary>The regions a tile owns, lattice order.</summary>
    public long[] TileRegions(long tkey)
    {
        int i0 = CellKeys.I(tkey) * K;
        int j0 = CellKeys.J(tkey) * K;
        var result = new long[K * K];
        int n = 0;
        for (int dj = 0; dj < K; dj++)
            for (int di = 0; di < K; di++)
                result[n++] = CellKeys.Pack(i0 + di, j0 + dj);
        return result;
    }

    /// <summary>Tiles whose regions may cover a world rectangle (regions spill one lattice cell out).</summary>
    public long[] TilesIn(double x0, double y0, double x1, double y1)
    {
        var set = new HashSet<long>();
        var result = new List<long>();
        foreach (long rk in World.CellsIn(World.RegionLevel, x0, y0, x1, y1, 1))
        {
            long t = TileOf(rk);
            if (set.Add(t)) result.Add(t);
        }
        return result.ToArray();
    }

    public int TileCount => _tiles.Count;

    public bool HasTile(long tkey) => _tiles.TryGetValue(tkey, out var l) && l.IsValueCreated;

    /// <summary>The tile with this key, computed on demand.</summary>
    public TerrainTile GetTile(long tkey) => _tiles.GetOrAdd(tkey, k => new Lazy<TerrainTile>(() => Compute(k))).Value;

    /// <summary>The tile holding a region's heights, if computed.</summary>
    public TerrainTile? Peek(long rkey) => _tiles.TryGetValue(TileOf(rkey), out var l) && l.IsValueCreated ? l.Value : null;

    /// <summary>The tile holding a region's heights, computed on demand.</summary>
    public TerrainTile Get(long rkey) => GetTile(TileOf(rkey));

    /// <summary>Hillslope steepness of an elevation zone type (0.03 for an unknown index).</summary>
    public double HillOf(int type) => type < 0 || type >= P.HillType.Length ? 0.03 : Math.Max(0, P.HillType[type]);

    /// <summary>River gradient factor of an elevation zone type (1 for an unknown index).</summary>
    public double ChanOf(int type) => type < 0 || type >= P.ChanFactor.Length ? 1 : P.ChanFactor[type];

    /// <summary>
    /// Mean land height (metres) of a merged patch of region <paramref name="rkey"/>, from the
    /// tile that owns the region. NaN while that tile is not computed and
    /// <paramref name="compute"/> is false, or when the patch has no land cell.
    /// </summary>
    public double PatchHeight(long patch, long rkey, bool compute = false)
    {
        TerrainTile? t = compute ? Get(rkey) : Peek(rkey);
        return t == null ? double.NaN : t.PatchHeight(patch);
    }

    /// <summary>Region-scale relief factor (mountain belts spanning several elevation zones).</summary>
    public double ReliefAt(double x, double y)
    {
        if (P.Relief <= 0) return 1;
        double f = Noise.Fbm(_seedR, x / 220_000, y / 220_000, ReliefFbm);
        return Math.Max(0.25, 1 + P.Relief * 1.6 * f);
    }

    /// <summary>
    /// Bed elevation of every node of a region's rivers (step 0): rise by the stream-power
    /// law (never steeper than the hillslope around), levelling of low-gradient zones, and
    /// caps from the bed envelope so no river stands above its land. A pure function of the
    /// region (its rivers, its neighbours' rivers and the map), so every tile agrees.
    /// </summary>
    public double[] Bed(long rkey) => _beds.GetOrAdd(rkey, k => new Lazy<double[]>(() => SolveBed(k, true).Z)).Value;

    /// <summary>A region's beds with rise and levelling only (no envelope caps): the neighbours' sources in <see cref="Bed"/>.</summary>
    private (double[] Z, double[] Cap) BaseBed(long rkey) => _bases.GetOrAdd(rkey, k => new Lazy<(double[], double[])>(() => SolveBed(k, false))).Value;

    private (double[] Z, double[] Cap) SolveBed(long rkey, bool cross)
    {
        RegionRivers rr = Rivers.Get(rkey);
        World w = World;
        TerrainParams P = this.P;
        int n = rr.N;
        int[] par = rr.Parent;
        // per node: elevation zone (merged root, −1 over the sea), rise above the parent, levelling share
        BedEnvelope? env = cross ? new BedEnvelope(this, rkey, rr, NeighbourSources(rkey, rr)) : null;
        long[] zone = new long[n];
        Array.Fill(zone, -1L);
        double[] rise = new double[n];
        // segment length to the parent
        double[] len = new double[n];
        // share of an entry's excess over the lowest entry that is kept: 1 = no levelling
        double[] keep = new double[n];
        Array.Fill(keep, 1.0);
        for (int k = 0; k < n; k++)
        {
            int p = par[k];
            if (p < 0 || rr.Wet[k] != 0) continue; // roots and the stretch over the sea sit at sea level
            double x = rr.X[k];
            double y = rr.Y[k];
            CellInfo c = w.CellAt(x, y, true);
            int type = ElevationZoneType.IndexOf(c.ElevationZone, c.Ocean);
            double rf = ReliefAt(x, y);
            double dx = Math.Sqrt(DMath.Sq(x - rr.X[p]) + DMath.Sq(y - rr.Y[p]));
            double ch = P.ChSlope * ChanOf(type) * rf * InvPowTheta(Math.Max(1, rr.Flow[k]), P.Theta);
            // the same (blurred) hillslope the envelope uses, so a river never caps itself
            double hs = env != null && env.Slope[k] >= 0 ? env.Slope[k] : HillOf(type) * P.Hill * rf;
            zone[k] = c.ElevationZone;
            len[k] = dx;
            rise[k] = dx * Math.Min(ch, hs);
            double cf = Math.Min(1, Math.Max(0, ChanOf(type)));
            keep[k] = 1 - Math.Min(1, Math.Max(0, P.Level)) * (1 - cf);
        }
        bool IsEntry(int k) => zone[k] >= 0 && zone[par[k]] != zone[k];
        double[] zz = new double[n];
        double[] cap = new double[n];
        Array.Fill(cap, double.PositiveInfinity);
        // rise from the parent within the caps (parents have smaller indices); returns the largest change
        double Forward()
        {
            double changed = 0;
            for (int k = 0; k < n; k++)
            {
                int p = par[k];
                if (p < 0 || rr.Wet[k] != 0) continue;
                double v = Math.Max(zz[p], Math.Min(zz[p] + rise[k], cap[k]));
                if (Math.Abs(v - zz[k]) > changed) changed = Math.Abs(v - zz[k]);
                zz[k] = v;
            }
            return changed;
        }
        // A river cannot run uphill: a node's cap also caps everything downstream (children
        // have larger indices). Below a cap the river only has to keep descending, at its
        // natural rise or GorgeSlope if that is gentler.
        void PushDown()
        {
            for (int k = n - 1; k >= 0; k--)
            {
                int p = par[k];
                if (p < 0 || double.IsPositiveInfinity(cap[k])) continue;
                double c = Math.Max(0, cap[k] - Math.Min(rise[k], GorgeSlope * len[k]));
                if (c < cap[p]) cap[p] = c;
            }
        }
        var lowest = new Dictionary<long, double>();
        // levelling: cap every entry of a low-gradient elevation zone towards its lowest entry
        bool LevelPass()
        {
            lowest.Clear();
            for (int k = 0; k < n; k++)
            {
                if (!IsEntry(k)) continue;
                double zp = zz[par[k]];
                if (!lowest.TryGetValue(zone[k], out double l) || zp < l) lowest[zone[k]] = zp;
            }
            bool capped = false;
            for (int k = 0; k < n; k++)
            {
                if (!IsEntry(k) || keep[k] >= 1) continue;
                double zp = zz[par[k]];
                double l = lowest[zone[k]];
                double t = l + keep[k] * (zp - l) + rise[k];
                if (t < cap[k] - BedTol)
                {
                    cap[k] = t;
                    capped = true;
                }
            }
            return capped;
        }
        Forward();
        for (int outer = 0; outer < 6; outer++)
        {
            if (P.Level > 0)
            {
                for (int it = 0; it < 32 && LevelPass(); it++)
                {
                    PushDown();
                    if (Forward() < 1e-6) break;
                }
            }
            bool capped = env != null && env.Apply(zz, cap);
            if (!capped) break;
            PushDown();
            Forward();
        }
        return (zz, cap);
    }

    private sealed class Sources
    {
        public readonly List<double> X = [], Y = [], Z = [], Px = [], Py = [], Pz = [], Wv = [];
    }

    /// <summary>
    /// River nodes of the regions around a region's rivers (within the reach of its bed
    /// envelope), at their pass-1 beds, with their floodplain half-widths.
    /// </summary>
    private Sources NeighbourSources(long rkey, RegionRivers rr)
    {
        var result = new Sources();
        if (rr.N == 0) return result;
        double m = 5 * BedGridSize;
        double bx0 = double.PositiveInfinity, by0 = double.PositiveInfinity, bx1 = double.NegativeInfinity, by1 = double.NegativeInfinity;
        for (int k = 0; k < rr.N; k++)
        {
            if (rr.X[k] < bx0) bx0 = rr.X[k];
            if (rr.X[k] > bx1) bx1 = rr.X[k];
            if (rr.Y[k] < by0) by0 = rr.Y[k];
            if (rr.Y[k] > by1) by1 = rr.Y[k];
        }
        bx0 -= m;
        by0 -= m;
        bx1 += m;
        by1 += m;
        foreach (long ok in World.CellsIn(World.RegionLevel, bx0, by0, bx1, by1, 1))
        {
            if (ok == rkey) continue;
            RegionRivers ro = Rivers.Get(ok);
            if (ro.N == 0 || ro.X1 < bx0 || ro.X0 > bx1 || ro.Y1 < by0 || ro.Y0 > by1) continue;
            double[] zo = BaseBed(ok).Z;
            for (int k = 0; k < ro.N; k++)
            {
                int p = ro.Parent[k];
                if (p < 0 || ro.Wet[k] != 0) continue;
                double x = ro.X[k];
                double y = ro.Y[k];
                if (x < bx0 || x > bx1 || y < by0 || y > by1) continue;
                double wv = Flood((zo[p] + zo[k]) * 0.5);
                if (P.FloodFlow) wv *= Math.Sqrt(Math.Max(1, ro.Flow[k]) / FloodRefFlow);
                result.X.Add(x);
                result.Y.Add(y);
                result.Z.Add(zo[k]);
                result.Px.Add(ro.X[p]);
                result.Py.Add(ro.Y[p]);
                result.Pz.Add(zo[p]);
                result.Wv.Add(Math.Max(0.75 * P.Res, wv));
            }
        }
        return result;
    }

    /// <summary>
    /// Height at a point, bilinear in the tile of the point's region. NaN when that tile is
    /// not computed yet and <paramref name="compute"/> is false.
    /// </summary>
    public double HeightAt(double x, double y, bool compute = false)
    {
        long r = World.CellAt(x, y, true).Region;
        TerrainTile? t = compute ? Get(r) : Peek(r);
        return t != null ? t.Sample(x, y) : double.NaN;
    }

    /// <summary>Raster bounding box of a tile: the union of its regions' boxes.</summary>
    private (double X0, double Y0, double X1, double Y1) Bbox(long tkey)
    {
        double x0 = double.PositiveInfinity, y0 = double.PositiveInfinity, x1 = double.NegativeInfinity, y1 = double.NegativeInfinity;
        foreach (long rk in TileRegions(tkey))
        {
            var b = RegionBox(rk);
            x0 = Math.Min(x0, b.X0);
            y0 = Math.Min(y0, b.Y0);
            x1 = Math.Max(x1, b.X1);
            y1 = Math.Max(y1, b.Y1);
        }
        return (x0, y0, x1, y1);
    }

    /// <summary>Raster bounding box of a region: its drawn elevation zones' sites plus a cell of slack, plus the halo.</summary>
    private (double X0, double Y0, double X1, double Y1) RegionBox(long rkey)
    {
        World w = World;
        double b = w.ElevationZoneLevel.Size;
        double x0 = double.PositiveInfinity, y0 = double.PositiveInfinity, x1 = double.NegativeInfinity, y1 = double.NegativeInfinity;
        foreach (long zk in Rivers.RegionElevationZones(rkey).Concat(w.Region(rkey).ElevationZones))
        {
            ZoneNode bd = w.ElevationZone(zk);
            x0 = Math.Min(x0, bd.X);
            y0 = Math.Min(y0, bd.Y);
            x1 = Math.Max(x1, bd.X);
            y1 = Math.Max(y1, bd.Y);
        }
        if (!double.IsFinite(x0))
        {
            RegionNode reg = w.Region(rkey);
            x0 = x1 = reg.X;
            y0 = y1 = reg.Y;
        }
        double m = 1.6 * b * (1 + w.P.ElevationZoneWarp) + Halo;
        return (x0 - m, y0 - m, x1 + m, y1 + m);
    }

    private sealed class BedGrid
    {
        public required int I0, J0, Nx, Ny;
        public required byte[] Ocean;
        public required long[] Reg;
        public required double[] Hill;
        public required double[] Relief;
    }

    /// <summary>
    /// The coarse (BedGridSize) classification around a region's rivers: sea flag, region,
    /// raw hillslope and relief factor per cell. Cached.
    /// </summary>
    private BedGrid GetBedGrid(long rkey, RegionRivers rr) => _grids.GetOrAdd(rkey, _ => new Lazy<BedGrid>(() =>
    {
        World w = World;
        double g = BedGridSize;
        double bx0 = double.PositiveInfinity, by0 = double.PositiveInfinity, bx1 = double.NegativeInfinity, by1 = double.NegativeInfinity;
        for (int k = 0; k < rr.N; k++)
        {
            if (rr.X[k] < bx0) bx0 = rr.X[k];
            if (rr.X[k] > bx1) bx1 = rr.X[k];
            if (rr.Y[k] < by0) by0 = rr.Y[k];
            if (rr.Y[k] > by1) by1 = rr.Y[k];
        }
        int i0 = (int)Math.Floor(bx0 / g) - 4;
        int j0 = (int)Math.Floor(by0 / g) - 4;
        int nx = (int)Math.Floor(bx1 / g) + 4 - i0 + 1;
        int ny = (int)Math.Floor(by1 / g) + 4 - j0 + 1;
        int cells = nx * ny;
        byte[] ocean = new byte[cells];
        long[] reg = new long[cells];
        double[] hill = new double[cells];
        double[] relief = new double[cells];
        for (int j = 0; j < ny; j++)
        {
            for (int i = 0; i < nx; i++)
            {
                double x = (i0 + i + 0.5) * g;
                double y = (j0 + j + 0.5) * g;
                CellInfo c = w.CellAt(x, y, true);
                int q = j * nx + i;
                reg[q] = c.Region;
                if (c.Ocean)
                {
                    ocean[q] = 1;
                    continue;
                }
                hill[q] = HillOf(ElevationZoneType.IndexOf(c.ElevationZone, false));
                relief[q] = ReliefAt(x, y);
            }
        }
        return new BedGrid { I0 = i0, J0 = j0, Nx = nx, Ny = ny, Ocean = ocean, Reg = reg, Hill = hill, Relief = relief };
    })).Value;

    /// <summary>
    /// No river above its land. The land rises from every river and the coast at the
    /// hillslope, so a bed that stands higher than another source of the region allows leaves
    /// the river perched above its land. This builds that surface on a coarse grid over the
    /// land around the region: the sea and every river segment seed it, then it spreads at the
    /// hillslope. <see cref="Apply"/> caps every bed above the surface and reports whether a
    /// cap was lowered; the caller pushes caps downstream, so the river cuts a gorge instead.
    /// </summary>
    private sealed class BedEnvelope
    {
        private readonly Terrain _t;
        private readonly RegionRivers _rr;
        private readonly Sources? _others;
        private readonly int _n, _i0, _j0, _nx, _ny, _cells;
        /// <summary>0 = not walkable (another region's land), 1 = walkable land, 2 = sea.</summary>
        private readonly byte[] _kind = [];
        private readonly double[] _slope = [];
        private readonly int[] _nodeCell = [];
        private readonly int[] _oCell = [];
        private readonly double[] _e = [];
        private readonly MinHeap _heap = new(1024);

        /// <summary>Blurred hillslope (× multiplier × relief) at each node's cell, −1 = not on walkable land.</summary>
        public double[] Slope { get; }

        public BedEnvelope(Terrain t, long rkey, RegionRivers rr, Sources? others)
        {
            _t = t;
            _rr = rr;
            _others = others;
            TerrainParams P = t.P;
            double g = BedGridSize;
            _n = rr.N;
            Slope = new double[_n];
            Array.Fill(Slope, -1.0);
            if (_n == 0) return;
            BedGrid grid = t.GetBedGrid(rkey, rr);
            _i0 = grid.I0;
            _j0 = grid.J0;
            _nx = grid.Nx;
            _ny = grid.Ny;
            _cells = _nx * _ny;
            _kind = new byte[_cells];
            double[] raw = grid.Hill;
            for (int q = 0; q < _cells; q++)
            {
                if (grid.Ocean[q] != 0) _kind[q] = 2;
                else if (others != null || rr.Landlocked || grid.Reg[q] == rkey) _kind[q] = 1;
            }
            // blurred over walkable land within ±Blend (like the raster's slope), × multiplier × relief
            _slope = new double[_cells];
            int r = (int)Math.Max(1, DMath.Round(Blend / g));
            for (int j = 0; j < _ny; j++)
            {
                for (int i = 0; i < _nx; i++)
                {
                    int q = j * _nx + i;
                    if (_kind[q] != 1) continue;
                    double sum = 0;
                    int cnt = 0;
                    for (int jj = Math.Max(0, j - r); jj <= Math.Min(_ny - 1, j + r); jj++)
                    {
                        for (int ii = Math.Max(0, i - r); ii <= Math.Min(_nx - 1, i + r); ii++)
                        {
                            int c = jj * _nx + ii;
                            if (_kind[c] != 1) continue;
                            sum += raw[c];
                            cnt++;
                        }
                    }
                    _slope[q] = (sum / cnt) * P.Hill * grid.Relief[q];
                }
            }
            _nodeCell = new int[_n];
            Array.Fill(_nodeCell, -1);
            for (int k = 0; k < _n; k++)
            {
                if (rr.Parent[k] < 0 || rr.Wet[k] != 0) continue;
                int q = ((int)Math.Floor(rr.Y[k] / g) - _j0) * _nx + ((int)Math.Floor(rr.X[k] / g) - _i0);
                if (_kind[q] != 1) continue;
                _nodeCell[k] = q;
                Slope[k] = _slope[q];
            }
            // the neighbours' river nodes: fixed sources
            if (others != null)
            {
                _oCell = new int[others.X.Count];
                for (int s = 0; s < others.X.Count; s++)
                {
                    int oi = (int)Math.Floor(others.X[s] / g) - _i0;
                    int oj = (int)Math.Floor(others.Y[s] / g) - _j0;
                    int q = oi >= 0 && oj >= 0 && oi < _nx && oj < _ny ? oj * _nx + oi : -1;
                    _oCell[s] = q >= 0 && _kind[q] == 1 ? q : -1;
                }
            }
            _e = new double[_cells];
        }

        private double CxOf(int i) => (_i0 + i + 0.5) * BedGridSize;

        private double CyOf(int j) => (_j0 + j + 0.5) * BedGridSize;

        /// <summary>
        /// Seed the 3 × 3 cells around cell q0 from segment a → b (beds za, zb, floodplain
        /// half-width wv): the bed at the cell centre's projection onto the segment, plus the
        /// hillslope beyond the floodplain.
        /// </summary>
        private void SeedSeg(int q0, double ax, double ay, double za, double bx, double by, double zb, double wv, double s0)
        {
            double ex = bx - ax;
            double ey = by - ay;
            double l2 = ex * ex + ey * ey;
            int ci = q0 % _nx;
            int cj = (q0 - ci) / _nx;
            for (int jj = cj - 1; jj <= cj + 1; jj++)
            {
                for (int ii = ci - 1; ii <= ci + 1; ii++)
                {
                    if (ii < 0 || jj < 0 || ii >= _nx || jj >= _ny) continue;
                    int q = jj * _nx + ii;
                    if (_kind[q] != 1) continue;
                    double px = CxOf(ii) - ax;
                    double py = CyOf(jj) - ay;
                    double t = l2 > 0 ? (px * ex + py * ey) / l2 : 0;
                    t = t < 0 ? 0 : t > 1 ? 1 : t;
                    double d = Math.Sqrt(DMath.Sq(px - t * ex) + DMath.Sq(py - t * ey));
                    double v = za + (zb - za) * t + Math.Max(s0, _slope[q]) * Math.Max(0, d - wv);
                    if (v < _e[q]) _e[q] = v;
                }
            }
        }

        public bool Apply(double[] z, double[] cap)
        {
            if (_n == 0) return false;
            TerrainParams P = _t.P;
            RegionRivers rr = _rr;
            double g = BedGridSize;
            double[] e = _e;
            Array.Fill(e, double.PositiveInfinity);
            for (int j = 0; j < _ny; j++)
            {
                for (int i = 0; i < _nx; i++)
                {
                    int q = j * _nx + i;
                    if (_kind[q] == 2 && HasNbr(_kind, _nx, _ny, i, j, 1)) e[q] = 0;
                }
            }
            for (int k = 0; k < _n; k++)
            {
                if (_nodeCell[k] < 0) continue;
                int p = rr.Parent[k];
                double zk = z[k];
                // the segment's floodplain is flat across, at the bed interpolated along it (as the raster stamps it)
                double wv = _t.Flood((z[p] + zk) * 0.5);
                if (P.FloodFlow) wv *= Math.Sqrt(Math.Max(1, rr.Flow[k]) / FloodRefFlow);
                wv = Math.Max(0.75 * P.Res, wv);
                SeedSeg(_nodeCell[k], rr.X[p], rr.Y[p], z[p], rr.X[k], rr.Y[k], zk, wv, Slope[k]);
            }
            if (_others != null)
            {
                Sources o = _others;
                for (int s = 0; s < _oCell.Length; s++)
                {
                    int q0 = _oCell[s];
                    if (q0 < 0) continue;
                    SeedSeg(q0, o.Px[s], o.Py[s], o.Pz[s], o.X[s], o.Y[s], o.Z[s], o.Wv[s], _slope[q0]);
                }
            }
            MinHeap heap = _heap;
            for (int q = 0; q < _cells; q++)
                if (e[q] < double.PositiveInfinity)
                    heap.Push(e[q], q);
            while (heap.Size > 0)
            {
                double d = heap.PeekKey();
                int q = heap.Pop();
                if (d > e[q]) continue;
                int i = q % _nx;
                int j = (q - i) / _nx;
                for (int t = 0; t < 8; t++)
                {
                    int ii = i + DI[t];
                    int jj = j + DJ[t];
                    if (ii < 0 || jj < 0 || ii >= _nx || jj >= _ny) continue;
                    int rq = jj * _nx + ii;
                    if (_kind[rq] != 1) continue;
                    double sl = _kind[q] == 1 ? (_slope[q] + _slope[rq]) * 0.5 : _slope[rq];
                    double nd = d + g * sl * (t < 4 ? 1 : Sqrt2);
                    if (nd < e[rq])
                    {
                        e[rq] = nd;
                        heap.Push(nd, rq);
                    }
                }
            }
            bool capped = false;
            for (int k = 0; k < _n; k++)
            {
                int q0 = _nodeCell[k];
                if (q0 < 0) continue;
                double lim = double.PositiveInfinity;
                double sk = Slope[k];
                // the walkable 3 × 3 cells around the node's cell, with the distance from the node to each cell centre
                int ci = q0 % _nx;
                int cj = (q0 - ci) / _nx;
                for (int jj = cj - 1; jj <= cj + 1; jj++)
                {
                    for (int ii = ci - 1; ii <= ci + 1; ii++)
                    {
                        if (ii < 0 || jj < 0 || ii >= _nx || jj >= _ny) continue;
                        int q = jj * _nx + ii;
                        if (_kind[q] != 1) continue;
                        double d = Math.Sqrt(DMath.Sq(rr.X[k] - CxOf(ii)) + DMath.Sq(rr.Y[k] - CyOf(jj)));
                        double v = e[q] + Math.Max(sk, _slope[q]) * d;
                        if (v < lim) lim = v;
                    }
                }
                // a few metres of slack for the discretised spread
                lim += BedSlack;
                // only lowerings that matter count (each one lowers the surface a little in turn)
                if (z[k] > lim && lim < cap[k] - BedTol)
                {
                    cap[k] = lim;
                    capped = true;
                }
            }
            return capped;
        }
    }

    private struct Seg
    {
        public double Ax, Ay, Bx, By, Za, Zb;
        /// <summary>Floodplain half-width.</summary>
        public double Wv;
        public double Lab;
        /// <summary>Index (into the raster's region table) of the region whose land the river may shape; −1 = any (landlocked).</summary>
        public int Reg;
    }

    /// <summary>
    /// Dry river segments (child on land) of one region, with floodplain half-widths from the
    /// height curve at the segment's mean bed height (optionally × √(flow / reference)).
    /// </summary>
    private void AddSegments(List<Seg> segs, RegionRivers rr, double[] z, double lab0, int reg)
    {
        for (int k = 0; k < rr.N; k++)
        {
            int p = rr.Parent[k];
            if (p < 0 || rr.Wet[k] != 0) continue;
            double wv = Flood((z[p] + z[k]) * 0.5);
            if (P.FloodFlow) wv *= Math.Sqrt(Math.Max(1, rr.Flow[k]) / FloodRefFlow);
            segs.Add(new Seg { Ax = rr.X[p], Ay = rr.Y[p], Bx = rr.X[k], By = rr.Y[k], Za = z[p], Zb = z[k], Wv = Math.Max(0.75 * P.Res, wv), Lab = lab0 + rr.Tree[k], Reg = reg });
        }
    }

    private delegate void StampVisitor(int q, double zb, double d);

    /// <summary>Visit the raster cells within <c>wv + extra</c> of a segment: f(cell, bed height at the projection, distance).</summary>
    private static void StampSeg(in Seg s, int nx, int ny, double x0, double y0, double res, StampVisitor f, double extra = 0)
    {
        double r = s.Wv + extra;
        int ia = Math.Max(0, (int)Math.Floor((Math.Min(s.Ax, s.Bx) - r - x0) / res));
        int ib = Math.Min(nx - 1, (int)Math.Ceiling((Math.Max(s.Ax, s.Bx) + r - x0) / res));
        int ja = Math.Max(0, (int)Math.Floor((Math.Min(s.Ay, s.By) - r - y0) / res));
        int jb = Math.Min(ny - 1, (int)Math.Ceiling((Math.Max(s.Ay, s.By) + r - y0) / res));
        double ex = s.Bx - s.Ax;
        double ey = s.By - s.Ay;
        double l2 = ex * ex + ey * ey;
        for (int j = ja; j <= jb; j++)
        {
            for (int i = ia; i <= ib; i++)
            {
                double px = x0 + i * res - s.Ax;
                double py = y0 + j * res - s.Ay;
                double t = l2 > 0 ? (px * ex + py * ey) / l2 : 0;
                t = t < 0 ? 0 : t > 1 ? 1 : t;
                double dx = px - t * ex;
                double dy = py - t * ey;
                double d = Math.Sqrt(dx * dx + dy * dy);
                if (d > r) continue;
                f(j * nx + i, s.Za + (s.Zb - s.Za) * t, d);
            }
        }
    }

    /// <summary>Compute a tile (not cached: see <see cref="GetTile"/>).</summary>
    public TerrainTile Compute(long tkey)
    {
        var sw = Stopwatch.StartNew();
        World w = World;
        TerrainParams P = this.P;
        double res = P.Res;
        var (bx0, by0, bx1, by1) = Bbox(tkey);
        int i0 = (int)Math.Floor(bx0 / res);
        int j0 = (int)Math.Floor(by0 / res);
        int nx = (int)Math.Floor(bx1 / res) - i0 + 1;
        int ny = (int)Math.Floor(by1 / res) - j0 + 1;
        int N = nx * ny;
        double X0 = (i0 + 0.5) * res;
        double Y0 = (j0 + 0.5) * res;

        // ---- classify + per-zone-type parameters
        byte[] cls = new byte[N];
        // region of each cell, as an index into regKeys
        int[] reg = new int[N];
        var regKeys = new List<long>();
        var regIndex = new Dictionary<long, int>();
        sbyte[] lt = new sbyte[N];
        Array.Fill(lt, (sbyte)-1);
        // (merged) patch of each cell, for the per-patch mean heights
        long[] patchOf = new long[N];
        for (int j = 0; j < ny; j++)
        {
            for (int i = 0; i < nx; i++)
            {
                CellInfo c = w.CellAt(X0 + i * res, Y0 + j * res, true);
                int q = j * nx + i;
                patchOf[q] = c.Patch;
                cls[q] = c.Ocean ? OceanCell : LandCell;
                if (!regIndex.TryGetValue(c.Region, out int ri))
                {
                    ri = regKeys.Count;
                    regKeys.Add(c.Region);
                    regIndex[c.Region] = ri;
                }
                reg[q] = ri;
                if (!c.Ocean) lt[q] = (sbyte)ElevationZoneType.IndexOf(c.ElevationZone, false);
            }
        }
        // blended over land cells (box blur, separable): slope, noise amplitude, ridged share
        int rb = (int)Math.Max(1, DMath.Round(Blend / res));
        double[] slope = BlurLand(nx, ny, cls, rb, q => HillOf(lt[q]));
        double[] amp = BlurLand(nx, ny, cls, rb, q => ZoneRelief[lt[q]].Amp);
        double[] rmix = BlurLand(nx, ny, cls, rb, q => ZoneRelief[lt[q]].Ridged);
        for (int j = 0; j < ny; j++)
        {
            for (int i = 0; i < nx; i++)
            {
                int q = j * nx + i;
                if (cls[q] != LandCell) continue;
                double rf = ReliefAt(X0 + i * res, Y0 + j * res);
                slope[q] *= P.Hill * rf;
                amp[q] *= P.Noise * rf;
            }
        }

        // ---- river segments of every region around (stamped as sources, then burnt in)
        var segList = new List<Seg>();
        foreach (long rk in World.CellsIn(w.RegionLevel, bx0, by0, bx1, by1, 1))
        {
            RegionRivers rr = Rivers.Get(rk);
            if (rr.N == 0 || rr.X1 < bx0 || rr.X0 > bx1 || rr.Y1 < by0 || rr.Y0 > by1) continue;
            double[] z = Bed(rk);
            double lab0 = ((double)(CellKeys.I(rk) & 0xffff) * 65536 + (CellKeys.J(rk) & 0xffff)) * 131072;
            // a river's corridor only shapes its own region's land. Landlocked regions cross their neighbours.
            int ri = rr.Landlocked ? -1 : regIndex.TryGetValue(rk, out int idx) ? idx : -2;
            AddSegments(segList, rr, z, lab0, ri);
        }
        Seg[] segs = segList.ToArray();

        // ---- 1. envelope: Dijkstra from the river beds and the coast
        double[] E = new double[N];
        Array.Fill(E, double.PositiveInfinity);
        double[] src = new double[N]; // bed / coast height the cell's path starts from
        double[] lab = new double[N]; // river system (−1 = coast)
        Array.Fill(lab, -1.0);
        var heap = new MinHeap(4096);
        // distance from every cell to its nearest river (within the burn reach): a river's
        // corridor and burn ramp only shape the cells it is nearest to
        double[] near = new double[N];
        Array.Fill(near, double.PositiveInfinity);
        for (int si = 0; si < segs.Length; si++)
        {
            int sreg = segs[si].Reg;
            StampSeg(segs[si], nx, ny, X0, Y0, res, (q, _, d) =>
            {
                if (sreg != -1 && reg[q] != sreg && cls[q] == LandCell) return;
                if (d < near[q]) near[q] = d;
            }, Math.Max(2 * res, segs[si].Wv));
        }
        // only exact ties (a cell equally near two joined segments of one river) share it
        const double tol = 1;
        // the channel itself (the narrowest corridor) is always stamped and burnt, so a
        // river's trench stays continuous where another river passes close by
        double chan = 0.75 * res;
        for (int si = 0; si < segs.Length; si++)
        {
            int sreg = segs[si].Reg;
            double slab = segs[si].Lab;
            StampSeg(segs[si], nx, ny, X0, Y0, res, (q, zb, d) =>
            {
                if (cls[q] != LandCell || zb >= E[q] || (d > near[q] + tol && d > chan) || (sreg != -1 && reg[q] != sreg)) return;
                E[q] = zb;
                src[q] = zb;
                lab[q] = slab;
            });
        }
        for (int q = 0; q < N; q++)
            if (double.IsFinite(E[q]))
                heap.Push(E[q], q);
        for (int j = 0; j < ny; j++)
        {
            for (int i = 0; i < nx; i++)
            {
                int q = j * nx + i;
                if (cls[q] != OceanCell || !HasNbr(cls, nx, ny, i, j, LandCell)) continue;
                E[q] = 0;
                src[q] = 0;
                lab[q] = -1;
                heap.Push(0, q);
            }
        }
        while (heap.Size > 0)
        {
            double d = heap.PeekKey();
            int q = heap.Pop();
            if (d > E[q]) continue;
            int i = q % nx;
            int j = (q - i) / nx;
            double sq = cls[q] == LandCell ? slope[q] : -1;
            for (int n = 0; n < 8; n++)
            {
                int ii = i + DI[n];
                int jj = j + DJ[n];
                if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
                int r = jj * nx + ii;
                if (cls[r] != LandCell) continue;
                double s = sq < 0 ? slope[r] : (sq + slope[r]) * 0.5;
                double nd = d + res * s * (n < 4 ? 1 : Sqrt2);
                if (nd < E[r])
                {
                    E[r] = nd;
                    src[r] = src[q];
                    lab[r] = lab[q];
                    heap.Push(nd, r);
                }
            }
        }
        double maxE = 0;
        for (int q = 0; q < N; q++)
            if (cls[q] == LandCell && double.IsFinite(E[q]) && E[q] > maxE)
                maxE = E[q];

        // ---- 2. divides: distance to region borders and to basin boundaries
        double[] dBorder = Chamfer(nx, ny, res, BorderW, (q, i, j) => cls[q] == LandCell && LandNbrDiffers(cls, reg, nx, ny, i, j));
        double[]? dDivide = P.Divide > 0 ? Chamfer(nx, ny, res, DivideW, (q, i, j) => cls[q] == LandCell && lab[q] >= 0 && LabNbrDiffers(cls, lab, nx, ny, i, j)) : null;
        double[] dCoast = Chamfer(nx, ny, res, SeaW, (q, i, j) => cls[q] == OceanCell && HasNbr(cls, nx, ny, i, j, LandCell));

        // ---- 3. assemble + detail noise
        float[] pre = new float[N];
        for (int j = 0; j < ny; j++)
        {
            for (int i = 0; i < nx; i++)
            {
                int q = j * nx + i;
                if (cls[q] == OceanCell)
                {
                    pre[q] = (float)-(2 + P.Sea * Smooth01(dCoast[q] / SeaW));
                    continue;
                }
                double e = double.IsFinite(E[q]) ? E[q] : maxE;
                double m = Smooth01((e - src[q]) / MaskH);
                double h = e;
                if (P.Ridge > 0 && dBorder[q] < BorderW)
                {
                    double t = 1 - dBorder[q] / BorderW;
                    h += P.Ridge * t * t * m;
                }
                if (dDivide != null && dDivide[q] < DivideW)
                {
                    double t = 1 - dDivide[q] / DivideW;
                    h += P.Divide * t * t * m;
                }
                if (amp[q] > 0)
                {
                    double x = (X0 + i * res) / 6000;
                    double y = (Y0 + j * res) / 6000;
                    double rm = rmix[q];
                    double n = rm <= 0 ? Noise.Fbm(_seedN, x, y, DetailFbm)
                        : rm >= 1 ? Noise.Ridged(_seedN, x, y, DetailFbm)
                        : (1 - rm) * Noise.Fbm(_seedN, x, y, DetailFbm) + rm * Noise.Ridged(_seedN, x, y, DetailFbm);
                    h += amp[q] * m * (n * 0.5 + 0.5);
                }
                pre[q] = (float)h;
            }
        }

        // ---- 4. burn the rivers in (AGREE: trench under the bed, linear buffer to the surface)
        for (int si = 0; si < segs.Length; si++)
        {
            int sreg = segs[si].Reg;
            double swv = segs[si].Wv;
            double buf = Math.Max(2 * res, swv);
            StampSeg(segs[si], nx, ny, X0, Y0, res, (q, zb, d) =>
            {
                if (cls[q] != LandCell || (d > near[q] + tol && d > chan) || (sreg != -1 && reg[q] != sreg)) return;
                double target;
                if (d <= swv) target = zb - P.Burn;
                else
                {
                    if (pre[q] <= zb) return;
                    target = zb + (pre[q] - zb) * ((d - swv) / buf);
                }
                if (target < pre[q]) pre[q] = (float)target;
            }, buf);
        }

        // ---- 5. ε-Priority-Flood over each owned region's land, on the shared raster.
        // A region's fill only writes its own land cells and is seeded from its sea and
        // border cells, which keep their `pre` heights, so the regions do not interact.
        float[] hgt = pre;
        bool[] owned = new bool[regKeys.Count];
        foreach (long rk in TileRegions(tkey))
            if (regIndex.TryGetValue(rk, out int ri))
                owned[ri] = true;
        // seeds per owned region index: sea cells next to its land, its land on the raster
        // edge or next to another region's land (raster scan order; the heap orders them)
        var seeds = new SortedDictionary<int, List<int>>();
        void AddSeed(int ri, int q)
        {
            if (seeds.TryGetValue(ri, out var list)) list.Add(q);
            else seeds[ri] = [q];
        }
        var nbrRegs = new List<int>();
        for (int j = 0; j < ny; j++)
        {
            for (int i = 0; i < nx; i++)
            {
                int q = j * nx + i;
                if (cls[q] == OceanCell)
                {
                    nbrRegs.Clear();
                    for (int jj = j - 1; jj <= j + 1; jj++)
                    {
                        for (int ii = i - 1; ii <= i + 1; ii++)
                        {
                            if (ii < 0 || jj < 0 || ii >= nx || jj >= ny || (ii == i && jj == j)) continue;
                            int r = jj * nx + ii;
                            if (cls[r] == LandCell && owned[reg[r]] && !nbrRegs.Contains(reg[r])) nbrRegs.Add(reg[r]);
                        }
                    }
                    foreach (int ri in nbrRegs) AddSeed(ri, q);
                }
                else if (owned[reg[q]] && (i == 0 || j == 0 || i == nx - 1 || j == ny - 1 || LandNbrDiffers(cls, reg, nx, ny, i, j)))
                {
                    AddSeed(reg[q], q);
                }
            }
        }
        // cells already processed in the current region's fill (stamped with pass + 1)
        int[] done = new int[N];
        int filled = 0;
        double maxFill = 0;
        int pass = 0;
        foreach (var (ri, list) in seeds)
        {
            pass++;
            foreach (int q in list)
            {
                done[q] = pass;
                heap.Push(hgt[q], q);
            }
            while (heap.Size > 0)
            {
                int q = heap.Pop();
                int i = q % nx;
                int j = (q - i) / nx;
                double hq = hgt[q];
                for (int n = 0; n < 8; n++)
                {
                    int ii = i + DI[n];
                    int jj = j + DJ[n];
                    if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
                    int r = jj * nx + ii;
                    if (done[r] == pass || cls[r] != LandCell || reg[r] != ri) continue;
                    done[r] = pass;
                    // the raise is decided in the stored (float32) precision
                    float lift = (float)(hq + Eps);
                    if (hgt[r] < lift)
                    {
                        if ((double)lift - hgt[r] > maxFill) maxFill = (double)lift - hgt[r];
                        hgt[r] = lift;
                        filled++;
                    }
                    heap.Push(hgt[r], r);
                }
            }
        }

        // ---- mean height of every patch's land in the owned regions (raster order, so deterministic)
        var patchIndex = new Dictionary<long, int>();
        var patchKeys = new List<long>();
        var patchSum = new List<double>();
        var patchCount = new List<int>();
        for (int q = 0; q < N; q++)
        {
            if (cls[q] != LandCell || !owned[reg[q]]) continue;
            if (!patchIndex.TryGetValue(patchOf[q], out int si))
            {
                si = patchKeys.Count;
                patchIndex[patchOf[q]] = si;
                patchKeys.Add(patchOf[q]);
                patchSum.Add(0);
                patchCount.Add(0);
            }
            patchSum[si] += hgt[q];
            patchCount[si]++;
        }

        // ---- crop to the owned regions' cells (+ a margin for bilinear sampling)
        int ci0 = nx, cj0 = ny, ci1 = -1, cj1 = -1;
        for (int j = 0; j < ny; j++)
        {
            for (int i = 0; i < nx; i++)
            {
                if (!owned[reg[j * nx + i]]) continue;
                if (i < ci0) ci0 = i;
                if (i > ci1) ci1 = i;
                if (j < cj0) cj0 = j;
                if (j > cj1) cj1 = j;
            }
        }
        if (ci1 < 0)
        {
            // no owned region reaches the raster (cannot happen with lattice-aligned tiles): keep the centre cell
            ci0 = ci1 = nx >> 1;
            cj0 = cj1 = ny >> 1;
        }
        const int margin = 2;
        ci0 = Math.Max(0, ci0 - margin);
        cj0 = Math.Max(0, cj0 - margin);
        ci1 = Math.Min(nx - 1, ci1 + margin);
        cj1 = Math.Min(ny - 1, cj1 + margin);
        int cnx = ci1 - ci0 + 1;
        int cny = cj1 - cj0 + 1;
        float[] ch = new float[cnx * cny];
        byte[] ccls = new byte[cnx * cny];
        int[] creg = new int[cnx * cny];
        for (int j = 0; j < cny; j++)
        {
            int src0 = (j + cj0) * nx + ci0;
            Array.Copy(hgt, src0, ch, j * cnx, cnx);
            Array.Copy(cls, src0, ccls, j * cnx, cnx);
            Array.Copy(reg, src0, creg, j * cnx, cnx);
        }
        float[] patchH = new float[patchKeys.Count];
        for (int n = 0; n < patchH.Length; n++) patchH[n] = (float)(patchSum[n] / patchCount[n]);

        return new TerrainTile
        {
            Tile = tkey,
            K = K,
            X0 = X0 + ci0 * res,
            Y0 = Y0 + cj0 * res,
            Res = res,
            Nx = cnx,
            Ny = cny,
            H = ch,
            Cls = ccls,
            Reg = creg,
            RegKeys = regKeys.ToArray(),
            PatchKeys = patchKeys.ToArray(),
            PatchH = patchH,
            Filled = filled,
            MaxFill = maxFill,
            Ms = sw.Elapsed.TotalMilliseconds,
        };
    }

    // ------------------------------------------------------------------ helpers

    /// <summary>Box blur of a per-land-cell value over land cells only (ocean cells neither contribute nor receive).</summary>
    private static double[] BlurLand(int nx, int ny, byte[] cls, int r, Func<int, double> val)
    {
        int cells = nx * ny;
        double[] v = new double[cells];
        double[] c = new double[cells];
        for (int q = 0; q < cells; q++)
        {
            if (cls[q] == LandCell)
            {
                v[q] = val(q);
                c[q] = 1;
            }
        }
        double[] tv = new double[cells];
        double[] tc = new double[cells];
        // horizontal running sums
        for (int j = 0; j < ny; j++)
        {
            double sv = 0;
            double sc = 0;
            int row = j * nx;
            for (int i = -r; i < nx; i++)
            {
                int a = i + r;
                if (a < nx)
                {
                    sv += v[row + a];
                    sc += c[row + a];
                }
                int b = i - r - 1;
                if (b >= 0)
                {
                    sv -= v[row + b];
                    sc -= c[row + b];
                }
                if (i >= 0)
                {
                    tv[row + i] = sv;
                    tc[row + i] = sc;
                }
            }
        }
        double[] result = new double[cells];
        for (int i = 0; i < nx; i++)
        {
            double sv = 0;
            double sc = 0;
            for (int j = -r; j < ny; j++)
            {
                int a = j + r;
                if (a < ny)
                {
                    sv += tv[a * nx + i];
                    sc += tc[a * nx + i];
                }
                int b = j - r - 1;
                if (b >= 0)
                {
                    sv -= tv[b * nx + i];
                    sc -= tc[b * nx + i];
                }
                if (j >= 0)
                {
                    int q = j * nx + i;
                    result[q] = cls[q] == LandCell && sc > 0 ? sv / sc : 0;
                }
            }
        }
        return result;
    }

    /// <summary>
    /// Chamfer distance (8-connected Dijkstra, metres) from the cells where
    /// <paramref name="isSeed"/> holds, up to <paramref name="cutoff"/> (farther cells stay at it).
    /// </summary>
    private static double[] Chamfer(int nx, int ny, double res, double cutoff, Func<int, int, int, bool> isSeed)
    {
        int cells = nx * ny;
        double[] d = new double[cells];
        Array.Fill(d, cutoff);
        var heap = new MinHeap(1024);
        for (int j = 0; j < ny; j++)
        {
            for (int i = 0; i < nx; i++)
            {
                int q = j * nx + i;
                if (isSeed(q, i, j))
                {
                    d[q] = 0.5 * res;
                    heap.Push(d[q], q);
                }
            }
        }
        double diag = res * Sqrt2;
        while (heap.Size > 0)
        {
            double dq = heap.PeekKey();
            int q = heap.Pop();
            if (dq > d[q]) continue;
            int i = q % nx;
            int j = (q - i) / nx;
            for (int jj = j - 1; jj <= j + 1; jj++)
            {
                for (int ii = i - 1; ii <= i + 1; ii++)
                {
                    if ((ii == i && jj == j) || ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
                    int r = jj * nx + ii;
                    double nd = dq + (ii == i || jj == j ? res : diag);
                    if (nd < d[r])
                    {
                        d[r] = nd;
                        heap.Push(nd, r);
                    }
                }
            }
        }
        return d;
    }

    private static bool HasNbr(byte[] cls, int nx, int ny, int i, int j, byte want)
    {
        for (int jj = j - 1; jj <= j + 1; jj++)
        {
            for (int ii = i - 1; ii <= i + 1; ii++)
            {
                if (ii < 0 || jj < 0 || ii >= nx || jj >= ny || (ii == i && jj == j)) continue;
                if (cls[jj * nx + ii] == want) return true;
            }
        }
        return false;
    }

    /// <summary>Does a land cell touch (4-neighbourhood) a land cell of another region?</summary>
    private static bool LandNbrDiffers(byte[] cls, int[] reg, int nx, int ny, int i, int j)
    {
        int q = j * nx + i;
        int r = reg[q];
        if (i > 0 && cls[q - 1] == LandCell && reg[q - 1] != r) return true;
        if (i < nx - 1 && cls[q + 1] == LandCell && reg[q + 1] != r) return true;
        if (j > 0 && cls[q - nx] == LandCell && reg[q - nx] != r) return true;
        if (j < ny - 1 && cls[q + nx] == LandCell && reg[q + nx] != r) return true;
        return false;
    }

    /// <summary>Does a land cell touch (4-neighbourhood) a cell draining to another river system?</summary>
    private static bool LabNbrDiffers(byte[] cls, double[] lab, int nx, int ny, int i, int j)
    {
        int q = j * nx + i;
        double l = lab[q];
        bool Ok(int r) => cls[r] == LandCell && lab[r] >= 0 && lab[r] != l;
        return (i > 0 && Ok(q - 1)) || (i < nx - 1 && Ok(q + 1)) || (j > 0 && Ok(q - nx)) || (j < ny - 1 && Ok(q + nx));
    }
}
