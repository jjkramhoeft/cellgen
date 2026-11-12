using System.Collections.Concurrent;
using System.Diagnostics;
using Sandbox5.Domain.Model;
using Sandbox5.Domain.Numerics;

namespace Sandbox5.Domain.Generation;

/// <summary>The travel grid of one region: its own cells (land and sea) and its navigable rivers.</summary>
public sealed class RegionGrid
{
    public required long Region { get; init; }
    /// <summary>Bounding box of the region's cells, in grid cells (cell (i, j) spans [i, i + 1) × <see cref="TravelGrid.Cell"/>).</summary>
    public required int I0 { get; init; }
    public required int J0 { get; init; }
    public required int Nx { get; init; }
    public required int Ny { get; init; }
    /// <summary>0 = not this region's, 1 = land, 2 = sea.</summary>
    public required byte[] Kind { get; init; }
    /// <summary>Land: cost of a km of road relative to open flat land (zone type × biome × lake).</summary>
    public required float[] Cost { get; init; }
    /// <summary>Land: estimated height, metres.</summary>
    public required float[] H { get; init; }
    /// <summary>Navigable river links, 5 numbers each: cell (i, j) → the next cell downstream (i, j), and the river node whose segment to its parent crosses between them.</summary>
    public required int[] Links { get; init; }
    public required int Land { get; init; }
    public required int Sea { get; init; }
    public required double Ms { get; init; }
}

/// <summary>
/// The travel cost grid, per region as drawn, on 2 km cells aligned to the world (a port of
/// the first half of world/travel.ts):
///
///   Land     cost of a kilometre of road relative to open flat land: elevation zone type ×
///            biome × lakes (roads go round them).
///   Height   an estimate that needs no terrain tile: the river beds rise upstream from the
///            sea, and the land rises from every river and the coast at the zone type's
///            hillslope. Rivers are the valleys and region borders the ridges.
///   Water    ocean cells and the navigable rivers, stamped on the grid as links between the
///            cells each river segment crosses.
/// </summary>
public sealed class TravelGrid
{
    /// <summary>Cell size of the travel grid, metres.</summary>
    public const double Cell = 2000;

    internal const byte LandKind = 1;
    internal const byte SeaKind = 2;

    /// <summary>Cost of a road per km, relative to open flat land, by elevation zone type and by biome (design values).</summary>
    public static readonly double[] ZoneCost = [1, 1, 1.15, 1.8, 4];
    public static readonly double[] BiomeCost = [1, 5, 1.6, 1.1, 1.4, 3.5, 1, 1.1, 1.3, 1.3, 2, 4, 1.5, 1.05, 1.3, 2.2, 3];
    /// <summary>A road across a lake costs this × (it goes round).</summary>
    private const double LakeCost = 8;
    /// <summary>Height of land no river or coast of its own region reaches (a walled-off pocket), metres.</summary>
    private const double PocketH = 150;

    /// <summary>The 8 neighbours (index = direction; the opposite of d is (d + 4) &amp; 7), then the 8 knight moves.</summary>
    internal static readonly int[] DX = [1, 1, 0, -1, -1, -1, 0, 1, 2, 1, -1, -2, -2, -1, 1, 2];
    internal static readonly int[] DY = [0, 1, 1, 1, 0, -1, -1, -1, 1, 2, 2, 1, -1, -2, -2, -1];
    internal static readonly double[] Len = Enumerable.Range(0, 16).Select(m => Math.Sqrt(DX[m] * DX[m] + DY[m] * DY[m]) * Cell).ToArray();

    internal static int DirOf(int dx, int dy)
    {
        for (int d = 0; d < 8; d++)
            if (DX[d] == dx && DY[d] == dy)
                return d;
        return -1;
    }

    private readonly ConcurrentDictionary<long, Lazy<RegionGrid>> _cache = new();

    public World World { get; }
    public Rivers Rivers { get; }
    public Lakes Lakes { get; }
    /// <summary>Terrain-less biomes (zone-typical heights), like the locations' ones.</summary>
    public Biomes Biomes { get; }
    /// <summary>Only read for its parameters (hillslopes, river gradients, relief).</summary>
    public Terrain Terrain { get; }

    public TravelGrid(World world, Rivers rivers, Lakes lakes, Biomes biomes, Terrain terrain)
    {
        World = world;
        Rivers = rivers;
        Lakes = lakes;
        Biomes = biomes;
        Terrain = terrain;
    }

    public bool Has(long rkey) => _cache.TryGetValue(rkey, out var l) && l.IsValueCreated;

    public RegionGrid Get(long rkey) => _cache.GetOrAdd(rkey, k => new Lazy<RegionGrid>(() => Compute(k))).Value;

    /// <summary>Bed height (m) of every node of a region's rivers: the terrain's rise from the sea, without its levelling and caps.</summary>
    public double[] Bed(RegionRivers rr)
    {
        World w = World;
        Terrain t = Terrain;
        TerrainParams P = t.P;
        double[] z = new double[rr.N];
        for (int k = 0; k < rr.N; k++)
        {
            int p = rr.Parent[k];
            if (p < 0 || rr.Wet[k] != 0) continue;
            double x = rr.X[k];
            double y = rr.Y[k];
            CellInfo c = w.CellAt(x, y, true);
            int type = ElevationZoneType.IndexOf(c.ElevationZone, c.Ocean);
            double rf = t.ReliefAt(x, y);
            double dx = Math.Sqrt((x - rr.X[p]) * (x - rr.X[p]) + (y - rr.Y[p]) * (y - rr.Y[p]));
            double ch = P.ChSlope * t.ChanOf(type) * rf * Terrain.InvPowTheta(Math.Max(1, rr.Flow[k]), P.Theta);
            double hs = t.HillOf(type) * P.Hill * rf;
            z[k] = z[p] + dx * Math.Min(ch, hs);
        }
        return z;
    }

    private RegionGrid Compute(long rkey)
    {
        var sw = Stopwatch.StartNew();
        World w = World;
        double G = Cell;
        double S = w.PatchLevel.Size;

        // ---- bounding box: the sites of the region's patches plus their reach
        double bx0 = double.PositiveInfinity, by0 = double.PositiveInfinity, bx1 = double.NegativeInfinity, by1 = double.NegativeInfinity;
        if (w.P.Nest)
        {
            foreach (long b in Rivers.RegionElevationZones(rkey))
            {
                foreach (long s in w.ElevationZonePatches(w.ElevationZone(b)))
                {
                    PatchNode sd = w.Patch(s);
                    if (sd.X < bx0) bx0 = sd.X;
                    if (sd.X > bx1) bx1 = sd.X;
                    if (sd.Y < by0) by0 = sd.Y;
                    if (sd.Y > by1) by1 = sd.Y;
                }
            }
            double m = 1.5 * S + w.PatchLevel.WarpReach + G;
            bx0 -= m;
            by0 -= m;
            bx1 += m;
            by1 += m;
        }
        else
        {
            // without nesting a region is its own Voronoi cell: at most a lattice cell beyond its own
            double R = w.RegionLevel.Size;
            bx0 = (CellKeys.I(rkey) - 1) * R;
            by0 = (CellKeys.J(rkey) - 1) * R;
            bx1 = (CellKeys.I(rkey) + 2) * R;
            by1 = (CellKeys.J(rkey) + 2) * R;
        }
        RegionGrid Empty() => new() { Region = rkey, I0 = 0, J0 = 0, Nx = 0, Ny = 0, Kind = [], Cost = [], H = [], Links = [], Land = 0, Sea = 0, Ms = sw.Elapsed.TotalMilliseconds };
        if (!(bx1 >= bx0)) return Empty();

        // ---- classify every cell of the box (at its centre)
        int bi0 = (int)Math.Floor(bx0 / G);
        int bj0 = (int)Math.Floor(by0 / G);
        int bnx = (int)Math.Floor(bx1 / G) - bi0 + 1;
        int bny = (int)Math.Floor(by1 / G) - bj0 + 1;
        int BN = bnx * bny;
        byte[] bKind = new byte[BN];
        // any region's ocean
        byte[] bOcean = new byte[BN];
        float[] bCost = new float[BN];
        float[] bSteep = new float[BN];
        Terrain ter = Terrain;
        int ci0 = bnx, ci1 = -1, cj0 = bny, cj1 = -1;
        int land = 0;
        int sea = 0;
        for (int j = 0; j < bny; j++)
        {
            double y = (bj0 + j + 0.5) * G;
            for (int i = 0; i < bnx; i++)
            {
                double x = (bi0 + i + 0.5) * G;
                CellInfo c = w.CellAt(x, y, true);
                int q = j * bnx + i;
                if (c.Ocean) bOcean[q] = 1;
                if (c.Region != rkey) continue;
                if (i < ci0) ci0 = i;
                if (i > ci1) ci1 = i;
                if (j < cj0) cj0 = j;
                if (j > cj1) cj1 = j;
                if (c.Ocean)
                {
                    bKind[q] = SeaKind;
                    sea++;
                    continue;
                }
                bKind[q] = LandKind;
                land++;
                int type = ElevationZoneType.IndexOf(c.ElevationZone, false);
                bCost[q] = (float)(ZoneCost[type] * BiomeCost[Biomes.OfPatch(c.Patch).Biome]);
                bSteep[q] = (float)(ter.HillOf(type) * ter.P.Hill * ter.ReliefAt(x, y));
            }
        }
        if (ci1 < 0) return Empty();

        // ---- heights: seeded by the river beds and the coast, spread at the hillslope over the region's own land
        RegionRivers rr = Rivers.Get(rkey);
        double[] bH = new double[BN];
        Array.Fill(bH, double.PositiveInfinity);
        var heap = new MinHeap(1024);
        if (land > 0)
        {
            double[] z = Bed(rr);
            for (int k = 0; k < rr.N; k++)
            {
                if (rr.Parent[k] < 0 || rr.Wet[k] != 0) continue;
                int i = (int)Math.Floor(rr.X[k] / G) - bi0;
                int j = (int)Math.Floor(rr.Y[k] / G) - bj0;
                if (i < 0 || j < 0 || i >= bnx || j >= bny) continue;
                int q = j * bnx + i;
                if (bKind[q] == LandKind && z[k] < bH[q]) bH[q] = z[k];
            }
            for (int j = 0; j < bny; j++)
            {
                for (int i = 0; i < bnx; i++)
                {
                    int q = j * bnx + i;
                    if (bKind[q] != LandKind) continue;
                    bool coast = false;
                    for (int d = 0; d < 8 && !coast; d++)
                    {
                        int ii = i + DX[d];
                        int jj = j + DY[d];
                        if (ii >= 0 && jj >= 0 && ii < bnx && jj < bny && bOcean[jj * bnx + ii] != 0) coast = true;
                    }
                    if (coast)
                    {
                        double v = bSteep[q] * G * 0.5;
                        if (v < bH[q]) bH[q] = v;
                    }
                }
            }
            for (int q = 0; q < BN; q++)
                if (bH[q] < double.PositiveInfinity)
                    heap.Push(bH[q], q);
            while (heap.Size > 0)
            {
                double d = heap.PeekKey();
                int u = heap.Pop();
                if (d > bH[u]) continue;
                int ui = u % bnx;
                int uj = (u - ui) / bnx;
                for (int m = 0; m < 8; m++)
                {
                    int vi = ui + DX[m];
                    int vj = uj + DY[m];
                    if (vi < 0 || vj < 0 || vi >= bnx || vj >= bny) continue;
                    int v = vj * bnx + vi;
                    if (bKind[v] != LandKind) continue;
                    double nd = d + 0.5 * ((double)bSteep[u] + bSteep[v]) * Len[m];
                    if (nd < bH[v])
                    {
                        bH[v] = nd;
                        heap.Push(nd, v);
                    }
                }
            }
        }

        // ---- lakes: roads go round
        foreach (LakeShape l in Lakes.Get(rkey).Lakes)
        {
            int li0 = Math.Max(0, (int)Math.Floor(l.X0 / G) - bi0);
            int li1 = Math.Min(bnx - 1, (int)Math.Floor(l.X1 / G) - bi0);
            int lj0 = Math.Max(0, (int)Math.Floor(l.Y0 / G) - bj0);
            int lj1 = Math.Min(bny - 1, (int)Math.Floor(l.Y1 / G) - bj0);
            for (int j = lj0; j <= lj1; j++)
            {
                for (int i = li0; i <= li1; i++)
                {
                    int q = j * bnx + i;
                    if (bKind[q] == LandKind && Generation.Lakes.InPolygon(l.X, l.Y, (bi0 + i + 0.5) * G, (bj0 + j + 0.5) * G)) bCost[q] = (float)(bCost[q] * LakeCost);
                }
            }
        }

        // ---- navigable rivers: a link wherever a segment passes from one cell into the next (downstream)
        double navFlow = Locations.Navigable * Math.Max(1, Rivers.P.PerPatch);
        var links = new List<int>();
        var seen = new HashSet<long>();
        for (int k = 0; k < rr.N; k++)
        {
            int p = rr.Parent[k];
            if (p < 0 || rr.Flow[k] < navFlow) continue;
            double ax = rr.X[k];
            double ay = rr.Y[k];
            double dx = rr.X[p] - ax;
            double dy = rr.Y[p] - ay;
            // steps of at most a quarter cell: consecutive samples lie in the same cell or in two that touch
            int n = (int)Math.Max(1, Math.Ceiling(Math.Sqrt(dx * dx + dy * dy) / (G / 4)));
            int pi = (int)Math.Floor(ax / G);
            int pj = (int)Math.Floor(ay / G);
            for (int s = 1; s <= n; s++)
            {
                int ci = (int)Math.Floor((ax + (dx * s) / n) / G);
                int cj = (int)Math.Floor((ay + (dy * s) / n) / G);
                if (ci == pi && cj == pj) continue;
                int d = DirOf(ci - pi, cj - pj);
                if (d >= 0)
                {
                    long key = CellKeys.Pack(pi, pj) * 8 + d;
                    if (seen.Add(key))
                    {
                        links.Add(pi);
                        links.Add(pj);
                        links.Add(ci);
                        links.Add(cj);
                        links.Add(k);
                    }
                }
                pi = ci;
                pj = cj;
            }
        }

        // ---- crop to the region's own cells
        int nx = ci1 - ci0 + 1;
        int ny = cj1 - cj0 + 1;
        byte[] kind = new byte[nx * ny];
        float[] cost = new float[nx * ny];
        float[] h = new float[nx * ny];
        for (int j = 0; j < ny; j++)
        {
            for (int i = 0; i < nx; i++)
            {
                int q = (j + cj0) * bnx + i + ci0;
                int o = j * nx + i;
                kind[o] = bKind[q];
                if (bKind[q] != LandKind) continue;
                cost[o] = bCost[q];
                h[o] = (float)(bH[q] < double.PositiveInfinity ? bH[q] : PocketH);
            }
        }
        return new RegionGrid { Region = rkey, I0 = bi0 + ci0, J0 = bj0 + cj0, Nx = nx, Ny = ny, Kind = kind, Cost = cost, H = h, Links = links.ToArray(), Land = land, Sea = sea, Ms = sw.Elapsed.TotalMilliseconds };
    }
}

// ------------------------------------------------------------------ network

public sealed record TravelParams
{
    /// <summary>Only locations with at least this viability score are connected.</summary>
    public required double MinScore { get; init; }
    /// <summary>Connect the cities only.</summary>
    public required bool CitiesOnly { get; init; }
}

/// <summary>The three ways to travel. The numeric value is the order used when sorting links.</summary>
public enum TravelMode
{
    Road = 0,
    River = 1,
    Sea = 2,
}

/// <summary>One stretch of a link's route, of a single kind.</summary>
public sealed class TravelPart
{
    public required TravelMode Mode { get; init; }
    /// <summary>The route, x and y in turn, metres.</summary>
    public required double[] Pts { get; init; }
    /// <summary>The stretches to draw (first and last point index of each): what no link drawn earlier in the region already covers.</summary>
    public required int[] Runs { get; init; }
}

/// <summary>A link of the network between two locations.</summary>
public sealed class TravelEdge
{
    public required PlacedLocation A { get; init; }
    public required PlacedLocation B { get; init; }
    /// <summary>The kind of the link: road, or the larger part of a water route (river / sea).</summary>
    public required TravelMode Mode { get; init; }
    /// <summary>Travel cost, km of open flat road.</summary>
    public required double Cost { get; init; }
    /// <summary>Length of the route, metres.</summary>
    public required double Length { get; init; }
    /// <summary>Between two cities.</summary>
    public required bool Major { get; init; }
    /// <summary>The route from A to B.</summary>
    public required TravelPart[] Parts { get; init; }
    /// <summary>Bounding box of the route.</summary>
    public required double X0 { get; init; }
    public required double Y0 { get; init; }
    public required double X1 { get; init; }
    public required double Y1 { get; init; }
}

public sealed class RegionTravel
{
    public required long Region { get; init; }
    /// <summary>The links this region owns.</summary>
    public required TravelEdge[] Edges { get; init; }
    /// <summary>Locations on show in the 3 × 3 regions around, candidate links found among them, and how many of the owned ones were pruned.</summary>
    public required int Nodes { get; init; }
    public required int Candidates { get; init; }
    public required int Pruned { get; init; }
    public required double Ms { get; init; }
}

/// <summary>
/// The travel network between the city and town locations on show: roads over land, river
/// routes along navigable rivers and sea lanes across the ocean (a port of the second half of
/// world/travel.ts). Per region; needs the locations and grids of the 3 × 3 regions around.
///
///   Forests  two multi-source shortest-path forests, one over land (roads, from every
///            location) and one over water (from every location on a navigable river, and
///            from the harbour of every coastal one). Each cell ends up with its cheapest
///            location: a Voronoi diagram under travel cost.
///   Links    two locations whose Voronoi cells touch are neighbours: the candidate link
///            runs through the cheapest crossing of their common border.
///   Pruning  a link is dropped when cheaper links make a detour of at most 1.6 × its cost;
///            a road only gives way to a route that uses water when that is far cheaper.
///   Owner    every pair of regions has one owner, which decides and holds the links between
///            their locations, so nothing depends on the order regions are computed in.
///
/// Deterministic: + − × ÷ √ only, heap ties broken by cell index. Thread-safe.
/// </summary>
public sealed class Travel
{
    private const double Km = 1000;
    /// <summary>Slope at which a road costs twice as much, and the most the slope can add (× the flat cost).</summary>
    private const double SlopeRef = 0.05;
    private const double SlopeMax = 12;
    /// <summary>Height (m) at which a road costs twice as much.</summary>
    private const double ElevRef = 1500;
    /// <summary>Crossing a navigable river (a bridge or ferry), km of open flat road.</summary>
    private const double Bridge = 3;
    /// <summary>A km on the open sea, right at the shore, and on a navigable river, relative to a km of open flat road.</summary>
    private const double SeaCost = 0.3;
    private const double SeaShore = 0.6;
    private const double RiverCost = 0.4;
    /// <summary>Loading and unloading at a sea harbour and at a river landing, km of open flat road (per end of a link).</summary>
    private const double Port = 12;
    private const double Landing = 6;
    /// <summary>A location is on a navigable river when one runs within this distance of it, metres.</summary>
    public const double RiverReach = 4000;
    /// <summary>A link is dropped for a detour over cheaper links of at most this × its cost.</summary>
    public const double Detour = 1.6;
    /// <summary>A road is dropped for a cheaper route that uses water only when that costs at most this × the road.</summary>
    private const double DetourWater = 0.35;

    private const byte LandKind = TravelGrid.LandKind;
    private const byte SeaKind = TravelGrid.SeaKind;
    private static readonly int[] DX = TravelGrid.DX;
    private static readonly int[] DY = TravelGrid.DY;
    private static readonly double[] Len = TravelGrid.Len;
    // the two cells a knight move passes between
    private static readonly int[] MAX = DX.Select((dx, m) => m < 8 ? 0 : Math.Abs(dx) == 2 ? dx / 2 : 0).ToArray();
    private static readonly int[] MAY = DY.Select((dy, m) => m < 8 ? 0 : Math.Abs(dy) == 2 ? dy / 2 : 0).ToArray();
    private static readonly int[] MBX = DX.Select((dx, m) => m < 8 ? 0 : Math.Abs(dx) == 2 ? dx / 2 : dx).ToArray();
    private static readonly int[] MBY = DY.Select((dy, m) => m < 8 ? 0 : Math.Abs(dy) == 2 ? dy / 2 : dy).ToArray();
    private static readonly int[] ForwardMoves = [0, 1, 2, 3, 8, 9, 10, 11];

    private readonly ConcurrentDictionary<long, Lazy<RegionTravel>> _cache = new();

    public TravelGrid Grid { get; }
    public Locations Locations { get; }
    public TravelParams P { get; }
    public World World => Grid.World;

    public Travel(TravelGrid grid, Locations locations, TravelParams p)
    {
        Grid = grid;
        Locations = locations;
        P = p;
    }

    public bool Has(long rkey) => _cache.TryGetValue(rkey, out var l) && l.IsValueCreated;

    public RegionTravel Get(long rkey) => _cache.GetOrAdd(rkey, k => new Lazy<RegionTravel>(() => Compute(k))).Value;

    /// <summary>The 3 × 3 regions around a region, lattice order.</summary>
    public static long[] Around(long rkey)
    {
        int i = CellKeys.I(rkey);
        int j = CellKeys.J(rkey);
        var result = new long[9];
        int n = 0;
        for (int dj = -1; dj <= 1; dj++)
            for (int di = -1; di <= 1; di++)
                result[n++] = CellKeys.Pack(i + di, j + dj);
        return result;
    }

    /// <summary>The locations of a region that the network connects.</summary>
    public PlacedLocation[] Shown(long rkey)
    {
        IEnumerable<PlacedLocation> list = Locations.Get(rkey).List;
        if (P.MinScore > 0) list = list.Where(l => l.Score >= P.MinScore);
        if (P.CitiesOnly) list = list.Where(l => l.Kind == LocationKind.City);
        return list.ToArray();
    }

    /// <summary>The region that decides the links between the locations of two regions (−1: too far apart for a link).</summary>
    public static long OwnerOf(long ra, long rb)
    {
        int ia = CellKeys.I(ra);
        int ja = CellKeys.J(ra);
        int ib = CellKeys.I(rb);
        int jb = CellKeys.J(rb);
        int ch = Math.Max(Math.Abs(ia - ib), Math.Abs(ja - jb));
        if (ch <= 1) return Math.Min(ra, rb);
        if (ch == 2) return CellKeys.Pack((int)Math.Floor((ia + ib) / 2.0), (int)Math.Floor((ja + jb) / 2.0));
        return -1;
    }

    private sealed class Cand
    {
        /// <summary>Node indices, A &lt; B.</summary>
        public required int A, B;
        public required double Cost;
        /// <summary>The crossing: cell U in A's tree, cell V in B's.</summary>
        public required int U, V;
        public required bool Water;
    }

    private sealed class RawPart
    {
        public required bool River;
        public required List<double> Xs, Ys;
        public List<long>? Keys;
    }

    private RegionTravel Compute(long rkey)
    {
        var sw = Stopwatch.StartNew();
        double G = TravelGrid.Cell;
        long[] regs = Around(rkey);
        RegionGrid[] grids = regs.Select(q => Grid.Get(q)).ToArray();

        // ---- nodes: the locations on show, region by region
        var nodeList = new List<PlacedLocation>();
        foreach (long q in regs) nodeList.AddRange(Shown(q));
        PlacedLocation[] nodes = nodeList.ToArray();
        int M = nodes.Length;
        RegionTravel Done(TravelEdge[] edges, int candidates, int pruned) => new() { Region = rkey, Edges = edges, Nodes = M, Candidates = candidates, Pruned = pruned, Ms = sw.Elapsed.TotalMilliseconds };
        if (M < 2) return Done([], 0, 0);

        // ---- the view: the cells of the nine regions on one raster
        int I0 = int.MaxValue, J0 = int.MaxValue, I1 = int.MinValue, J1 = int.MinValue;
        foreach (RegionGrid g in grids)
        {
            if (g.Nx == 0) continue;
            I0 = Math.Min(I0, g.I0);
            J0 = Math.Min(J0, g.J0);
            I1 = Math.Max(I1, g.I0 + g.Nx - 1);
            J1 = Math.Max(J1, g.J0 + g.Ny - 1);
        }
        if (!(I1 >= I0)) return Done([], 0, 0);
        int NX = I1 - I0 + 1;
        int NY = J1 - J0 + 1;
        int N = NX * NY;
        byte[] kind = new byte[N];
        float[] cost = new float[N];
        float[] h = new float[N];
        byte[] rmask = new byte[N];
        double[] distL = new double[N];
        double[] distW = new double[N];
        Array.Fill(distL, double.PositiveInfinity);
        Array.Fill(distW, double.PositiveInfinity);
        int[] srcL = new int[N];
        int[] srcW = new int[N];
        int[] prevL = new int[N];
        int[] prevW = new int[N];
        Array.Fill(srcL, -1);
        Array.Fill(srcW, -1);
        Array.Fill(prevL, -1);
        Array.Fill(prevW, -1);
        foreach (RegionGrid g in grids)
        {
            for (int j = 0; j < g.Ny; j++)
            {
                int row = (g.J0 + j - J0) * NX + g.I0 - I0;
                for (int i = 0; i < g.Nx; i++)
                {
                    byte k = g.Kind[j * g.Nx + i];
                    if (k == 0) continue;
                    int Q = row + i;
                    kind[Q] = k;
                    if (k == LandKind)
                    {
                        h[Q] = g.H[j * g.Nx + i];
                        cost[Q] = (float)(g.Cost[j * g.Nx + i] * (1 + h[Q] / ElevRef));
                    }
                }
            }
        }
        // the sea is dearer right at the shore
        for (int j = 0; j < NY; j++)
        {
            for (int i = 0; i < NX; i++)
            {
                int Q = j * NX + i;
                if (kind[Q] != SeaKind) continue;
                bool shore = false;
                for (int d = 0; d < 8 && !shore; d++)
                {
                    int ii = i + DX[d];
                    int jj = j + DY[d];
                    if (ii >= 0 && jj >= 0 && ii < NX && jj < NY && kind[jj * NX + ii] == LandKind) shore = true;
                }
                cost[Q] = (float)(shore ? SeaShore : SeaCost);
            }
        }
        // navigable rivers (over open sea a boat needs no river): link → grid and river node, for the route
        var linkInfo = new Dictionary<long, long>();
        for (int gi = 0; gi < grids.Length; gi++)
        {
            RegionGrid g = grids[gi];
            for (int e = 0; e < g.Links.Length; e += 5)
            {
                int i = g.Links[e] - I0;
                int j = g.Links[e + 1] - J0;
                int i2 = g.Links[e + 2] - I0;
                int j2 = g.Links[e + 3] - J0;
                if (i < 0 || j < 0 || i >= NX || j >= NY || i2 < 0 || j2 < 0 || i2 >= NX || j2 >= NY) continue;
                int Q = j * NX + i;
                int Q2 = j2 * NX + i2;
                if (kind[Q] == 0 || kind[Q2] == 0 || (kind[Q] == SeaKind && kind[Q2] == SeaKind)) continue;
                int d = TravelGrid.DirOf(i2 - i, j2 - j);
                if ((rmask[Q] & (1 << d)) != 0) continue;
                rmask[Q] |= (byte)(1 << d);
                rmask[Q2] |= (byte)(1 << ((d + 4) & 7));
                linkInfo[(long)Q * 8 + d] = (long)gi * 0x100000 + g.Links[e + 4];
            }
        }

        // ---- seeds
        var heap = new MinHeap(4096);
        double Cx(int Q) => (I0 + (Q % NX) + 0.5) * G;
        double Cy(int Q) => (J0 + (Q / NX) + 0.5) * G;
        // the nearest cell to a point within `reach` cells of its own that passes `ok` (−1: none)
        int Nearest(double x, double y, int reach, Func<int, bool> ok)
        {
            int i = (int)Math.Floor(x / G) - I0;
            int j = (int)Math.Floor(y / G) - J0;
            int best = -1;
            double bd = double.PositiveInfinity;
            for (int jj = Math.Max(0, j - reach); jj <= Math.Min(NY - 1, j + reach); jj++)
            {
                for (int ii = Math.Max(0, i - reach); ii <= Math.Min(NX - 1, i + reach); ii++)
                {
                    int Q = jj * NX + ii;
                    if (!ok(Q)) continue;
                    double d = (Cx(Q) - x) * (Cx(Q) - x) + (Cy(Q) - y) * (Cy(Q) - y);
                    if (d < bd)
                    {
                        bd = d;
                        best = Q;
                    }
                }
            }
            return best;
        }
        int portReach = (int)Math.Ceiling((1.5 * World.PatchLevel.Size) / G);
        int riverReach = (int)Math.Ceiling(RiverReach / G);
        for (int n = 0; n < M; n++)
        {
            PlacedLocation l = nodes[n];
            int Q = Nearest(l.X, l.Y, 2, q => kind[q] == LandKind && srcL[q] < 0);
            if (Q >= 0)
            {
                distL[Q] = 0;
                srcL[Q] = n;
            }
            void SeedW(int q, double d0)
            {
                if (q < 0) return;
                double d = d0 + Math.Sqrt((Cx(q) - l.X) * (Cx(q) - l.X) + (Cy(q) - l.Y) * (Cy(q) - l.Y)) / Km;
                if (d < distW[q])
                {
                    distW[q] = d;
                    srcW[q] = n;
                }
            }
            SeedW(Nearest(l.X, l.Y, riverReach, q => rmask[q] != 0), Landing);
            if (l.Site.Coast) SeedW(Nearest(l.X, l.Y, portReach, q => kind[q] == SeaKind), Port);
        }

        // ---- road forest: 16 directions, slope and river crossings
        // cost of the road step u → u + move m (Infinity: not possible)
        double StepL(int u, int ui, int uj, int m)
        {
            int vi = ui + DX[m];
            int vj = uj + DY[m];
            if (vi < 0 || vj < 0 || vi >= NX || vj >= NY) return double.PositiveInfinity;
            int v = vj * NX + vi;
            if (kind[v] != LandKind) return double.PositiveInfinity;
            double c;
            double climb;
            if (m < 8)
            {
                c = 0.5 * ((double)cost[u] + cost[v]);
                climb = Math.Abs((double)h[v] - h[u]);
            }
            else
            {
                int a = (uj + MAY[m]) * NX + ui + MAX[m];
                int b = (uj + MBY[m]) * NX + ui + MBX[m];
                if (kind[a] != LandKind || kind[b] != LandKind) return double.PositiveInfinity;
                c = 0.25 * ((double)cost[u] + cost[v] + cost[a] + cost[b]);
                double hm = 0.5 * ((double)h[a] + h[b]);
                climb = Math.Abs(hm - h[u]) + Math.Abs(h[v] - hm);
            }
            double s = climb / Len[m] / SlopeRef;
            double wgt = (Len[m] / Km) * c * (1 + Math.Min(SlopeMax, s * s));
            if ((rmask[u] != 0) != (rmask[v] != 0)) wgt += Bridge / 2;
            return wgt;
        }
        for (int Q = 0; Q < N; Q++)
            if (srcL[Q] >= 0)
                heap.Push(0, Q);
        while (heap.Size > 0)
        {
            double d = heap.PeekKey();
            int u = heap.Pop();
            if (d > distL[u]) continue;
            int ui = u % NX;
            int uj = (u - ui) / NX;
            for (int m = 0; m < 16; m++)
            {
                double wgt = StepL(u, ui, uj, m);
                if (double.IsPositiveInfinity(wgt)) continue;
                int v = (uj + DY[m]) * NX + ui + DX[m];
                double nd = d + wgt;
                if (nd < distL[v])
                {
                    distL[v] = nd;
                    srcL[v] = srcL[u];
                    prevL[v] = u;
                    heap.Push(nd, v);
                }
            }
        }

        // ---- water forest: open sea in 8 directions, rivers along their links
        // cost of the water step u → its neighbour in direction d (Infinity: not possible)
        double StepW(int u, int ui, int uj, int d)
        {
            if ((rmask[u] & (1 << d)) != 0) return (Len[d] / Km) * RiverCost;
            if (kind[u] != SeaKind) return double.PositiveInfinity;
            int vi = ui + DX[d];
            int vj = uj + DY[d];
            if (vi < 0 || vj < 0 || vi >= NX || vj >= NY) return double.PositiveInfinity;
            int v = vj * NX + vi;
            if (kind[v] != SeaKind) return double.PositiveInfinity;
            // no squeezing between two land cells that touch at a corner
            if ((d & 1) != 0 && kind[uj * NX + vi] != SeaKind && kind[vj * NX + ui] != SeaKind) return double.PositiveInfinity;
            return (Len[d] / Km) * 0.5 * ((double)cost[u] + cost[v]);
        }
        for (int Q = 0; Q < N; Q++)
            if (srcW[Q] >= 0)
                heap.Push(distW[Q], Q);
        while (heap.Size > 0)
        {
            double d = heap.PeekKey();
            int u = heap.Pop();
            if (d > distW[u]) continue;
            int ui = u % NX;
            int uj = (u - ui) / NX;
            for (int m = 0; m < 8; m++)
            {
                double wgt = StepW(u, ui, uj, m);
                if (double.IsPositiveInfinity(wgt)) continue;
                int v = (uj + DY[m]) * NX + ui + DX[m];
                double nd = d + wgt;
                if (nd < distW[v])
                {
                    distW[v] = nd;
                    srcW[v] = srcW[u];
                    prevW[v] = u;
                    heap.Push(nd, v);
                }
            }
        }

        // ---- candidate links: the cheapest crossing between every two trees that touch
        long PairKey(int a, int b) => a < b ? (long)a * M + b : (long)b * M + a;
        var byPair = new[] { new OrderedDictionary<long, Cand>(), new OrderedDictionary<long, Cand>() };
        void Offer(bool water, int u, int v, int su, int sv, double total)
        {
            OrderedDictionary<long, Cand> map = byPair[water ? 1 : 0];
            long key = PairKey(su, sv);
            if (map.TryGetValue(key, out Cand? old) && old.Cost <= total) return;
            map[key] = su < sv ? new Cand { A = su, B = sv, Cost = total, U = u, V = v, Water = water } : new Cand { A = sv, B = su, Cost = total, U = v, V = u, Water = water };
        }
        for (int u = 0; u < N; u++)
        {
            int ui = u % NX;
            int uj = (u - ui) / NX;
            if (srcL[u] >= 0)
            {
                // the forward half of the 16 moves: every pair of cells once
                foreach (int m in ForwardMoves)
                {
                    double wgt = StepL(u, ui, uj, m);
                    if (double.IsPositiveInfinity(wgt)) continue;
                    int v = (uj + DY[m]) * NX + ui + DX[m];
                    if (srcL[v] >= 0 && srcL[v] != srcL[u]) Offer(false, u, v, srcL[u], srcL[v], distL[u] + wgt + distL[v]);
                }
            }
            if (srcW[u] >= 0)
            {
                for (int m = 0; m < 4; m++)
                {
                    double wgt = StepW(u, ui, uj, m);
                    if (double.IsPositiveInfinity(wgt)) continue;
                    int v = (uj + DY[m]) * NX + ui + DX[m];
                    if (srcW[v] >= 0 && srcW[v] != srcW[u]) Offer(true, u, v, srcW[u], srcW[v], distW[u] + wgt + distW[v]);
                }
            }
        }
        List<Cand> cands = [.. byPair[0].Values, .. byPair[1].Values];
        var adj = new List<Cand>[M];
        for (int n = 0; n < M; n++) adj[n] = [];
        foreach (Cand c in cands)
        {
            adj[c.A].Add(c);
            adj[c.B].Add(c);
        }

        // ---- pruning: only ever the dearest link of a cycle
        static bool Less(Cand x, Cand y) => x.Cost < y.Cost || (x.Cost == y.Cost && (x.Water != y.Water ? !x.Water : x.A != y.A ? x.A < y.A : x.B < y.B));
        double[] reach = new double[M];
        var hops = new MinHeap(64);
        // is there a way from e.A to e.B over cheaper links (roads only, or any) that costs at most `limit`?
        bool DetourExists(Cand e, double limit, bool roadsOnly)
        {
            Array.Fill(reach, double.PositiveInfinity);
            reach[e.A] = 0;
            hops.Push(0, e.A);
            bool found = false;
            while (hops.Size > 0)
            {
                double d = hops.PeekKey();
                int u = hops.Pop();
                if (found || d > reach[u]) continue;
                if (u == e.B)
                {
                    found = true;
                    continue;
                }
                foreach (Cand f in adj[u])
                {
                    if ((roadsOnly && f.Water) || !Less(f, e)) continue;
                    int v = f.A == u ? f.B : f.A;
                    double nd = d + f.Cost;
                    if (nd <= limit && nd < reach[v])
                    {
                        reach[v] = nd;
                        hops.Push(nd, v);
                    }
                }
            }
            return found;
        }
        bool IsPruned(Cand e) => e.Water ? DetourExists(e, Detour * e.Cost, false) : DetourExists(e, Detour * e.Cost, true) || DetourExists(e, DetourWater * e.Cost, false);
        var kept = new List<Cand>();
        int pruned = 0;
        foreach (Cand c in cands)
        {
            if (OwnerOf(nodes[c.A].Region, nodes[c.B].Region) != rkey) continue;
            if (IsPruned(c)) pruned++;
            else kept.Add(c);
        }
        // links between cities first: the stretches they share with lesser links are theirs
        bool Major(Cand c) => nodes[c.A].Kind == LocationKind.City && nodes[c.B].Kind == LocationKind.City;
        kept.Sort((x, y) =>
        {
            int m = (Major(y) ? 1 : 0) - (Major(x) ? 1 : 0);
            if (m != 0) return m;
            if (x.Cost < y.Cost) return -1;
            if (x.Cost > y.Cost) return 1;
            if (x.A != y.A) return x.A.CompareTo(y.A);
            if (x.B != y.B) return x.B.CompareTo(y.B);
            return (x.Water ? 1 : 0) - (y.Water ? 1 : 0);
        });

        // ---- routes
        // cells from a's seed to b's seed through the crossing
        List<int> CellsOf(Cand c)
        {
            int[] prev = c.Water ? prevW : prevL;
            var result = new List<int>();
            for (int q = c.U; q >= 0; q = prev[q]) result.Add(q);
            result.Reverse();
            for (int q = c.V; q >= 0; q = prev[q]) result.Add(q);
            return result;
        }
        var seenRoad = new HashSet<long>();
        var seenRiver = new HashSet<long>();
        static int[] RunsOf(int n, Func<int, bool> isNew)
        {
            var runs = new List<int>();
            int start = -1;
            for (int i = 0; i < n - 1; i++)
            {
                if (isNew(i))
                {
                    if (start < 0) start = i;
                }
                else if (start >= 0)
                {
                    runs.Add(start);
                    runs.Add(i);
                    start = -1;
                }
            }
            if (start >= 0)
            {
                runs.Add(start);
                runs.Add(n - 1);
            }
            return runs.ToArray();
        }
        // is the straight line between two points open sea all the way?
        bool OpenSea(double ax, double ay, double bx, double by)
        {
            int n = (int)Math.Max(1, Math.Ceiling(Math.Sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) / (G / 2)));
            for (int s = 0; s <= n; s++)
            {
                int i = (int)Math.Floor((ax + ((bx - ax) * s) / n) / G) - I0;
                int j = (int)Math.Floor((ay + ((by - ay) * s) / n) / G) - J0;
                if (i < 0 || j < 0 || i >= NX || j >= NY || kind[j * NX + i] != SeaKind) return false;
            }
            return true;
        }
        TravelPart RoadPart(Cand c)
        {
            List<int> cells = CellsOf(c);
            int n = cells.Count;
            double[] pts = new double[2 * n];
            for (int i = 0; i < n; i++)
            {
                pts[2 * i] = Cx(cells[i]);
                pts[2 * i + 1] = Cy(cells[i]);
            }
            pts[0] = nodes[c.A].X;
            pts[1] = nodes[c.A].Y;
            pts[2 * n - 2] = nodes[c.B].X;
            pts[2 * n - 1] = nodes[c.B].Y;
            // two passes of ¼ ½ ¼: a point only moves with its two neighbours on either side, so
            // the stretch two links share comes out the same for both
            double[] tmp = new double[2 * n];
            for (int pass = 0; pass < 2; pass++)
            {
                Array.Copy(pts, tmp, 2 * n);
                for (int i = 1; i < n - 1; i++)
                {
                    pts[2 * i] = 0.25 * tmp[2 * i - 2] + 0.5 * tmp[2 * i] + 0.25 * tmp[2 * i + 2];
                    pts[2 * i + 1] = 0.25 * tmp[2 * i - 1] + 0.5 * tmp[2 * i + 1] + 0.25 * tmp[2 * i + 3];
                }
            }
            int[] runs = RunsOf(n, i =>
            {
                int lo = Math.Min(cells[i], cells[i + 1]);
                long key = (long)lo * N + (lo == cells[i] ? cells[i + 1] : cells[i]);
                return seenRoad.Add(key);
            });
            return new TravelPart { Mode = TravelMode.Road, Pts = pts, Runs = runs };
        }
        // the river nodes along the cells [i0 … i1] of a water route (null: not along one river)
        (int Gi, List<int> Path)? RiverNodes(List<int> cells, int i0, int i1)
        {
            (int Gi, int Node)? End(int i, bool first)
            {
                int u = cells[i];
                int v = cells[i + 1];
                int d = TravelGrid.DirOf((v % NX) - (u % NX), (v / NX) - (u / NX));
                bool isDown = linkInfo.TryGetValue((long)u * 8 + d, out long info);
                if (!isDown && !linkInfo.TryGetValue((long)v * 8 + ((d + 4) & 7), out info)) return null;
                int gi = (int)(info / 0x100000);
                int k = (int)(info % 0x100000);
                int par = Grid.Rivers.Get(regs[gi]).Parent[k];
                // going downstream the stretch starts at the node and ends at its parent; upstream the other way round
                return (gi, isDown == first ? k : par);
            }
            var s = End(i0, true);
            var e = End(i1 - 1, false);
            if (s == null || e == null || s.Value.Gi != e.Value.Gi) return null;
            int[] parent = Grid.Rivers.Get(regs[s.Value.Gi]).Parent;
            var up = new Dictionary<int, int>();
            var fromS = new List<int>();
            for (int k = s.Value.Node; k >= 0; k = parent[k])
            {
                up[k] = fromS.Count;
                fromS.Add(k);
            }
            var fromE = new List<int>();
            int at = e.Value.Node;
            while (at >= 0 && !up.ContainsKey(at))
            {
                fromE.Add(at);
                at = parent[at];
            }
            if (at < 0) return null;
            List<int> path = fromS.GetRange(0, up[at] + 1);
            fromE.Reverse();
            path.AddRange(fromE);
            return (s.Value.Gi, path);
        }
        TravelPart[] WaterParts(Cand c)
        {
            List<int> cells = CellsOf(c);
            int n = cells.Count;
            PlacedLocation la = nodes[c.A];
            PlacedLocation lb = nodes[c.B];
            bool IsRiver(int i) => kind[cells[i]] != SeaKind || kind[cells[i + 1]] != SeaKind;
            var raw = new List<RawPart>();
            int at = 0;
            while (at < n - 1)
            {
                bool river = IsRiver(at);
                int j = at + 1;
                while (j < n - 1 && IsRiver(j) == river) j++;
                var xs = new List<double>();
                var ys = new List<double>();
                List<long>? keys = null;
                var rn = river ? RiverNodes(cells, at, j) : null;
                if (rn != null)
                {
                    RegionRivers rr = Grid.Rivers.Get(regs[rn.Value.Gi]);
                    List<int> path = rn.Value.Path;
                    keys = [];
                    for (int t = 0; t < path.Count; t++)
                    {
                        xs.Add(rr.X[path[t]]);
                        ys.Add(rr.Y[path[t]]);
                        // a river segment is named by its upstream node
                        if (t > 0) keys.Add((long)rn.Value.Gi * 0x100000 + (rr.Parent[path[t]] == path[t - 1] ? path[t] : path[t - 1]));
                    }
                }
                else
                {
                    for (int t = at; t <= j; t++)
                    {
                        xs.Add(Cx(cells[t]));
                        ys.Add(Cy(cells[t]));
                    }
                }
                raw.Add(new RawPart { River = river, Xs = xs, Ys = ys, Keys = keys });
                at = j;
            }
            // the stretches meet where the river meets the sea (at the river's node), and the route starts and ends at the two places
            for (int t = 0; t + 1 < raw.Count; t++)
            {
                RawPart p = raw[t];
                RawPart q = raw[t + 1];
                if (p.River)
                {
                    q.Xs[0] = p.Xs[^1];
                    q.Ys[0] = p.Ys[^1];
                }
                else
                {
                    p.Xs[^1] = q.Xs[0];
                    p.Ys[^1] = q.Ys[0];
                }
            }
            RawPart first = raw[0];
            if (first.Xs[0] != la.X || first.Ys[0] != la.Y)
            {
                first.Xs.Insert(0, la.X);
                first.Ys.Insert(0, la.Y);
                first.Keys?.Insert(0, -1);
            }
            RawPart last = raw[^1];
            if (last.Xs[^1] != lb.X || last.Ys[^1] != lb.Y)
            {
                last.Xs.Add(lb.X);
                last.Ys.Add(lb.Y);
                last.Keys?.Add(-1);
            }
            var parts = new TravelPart[raw.Count];
            for (int r = 0; r < raw.Count; r++)
            {
                RawPart p = raw[r];
                List<double> xs = p.Xs;
                List<double> ys = p.Ys;
                if (!p.River)
                {
                    // pull the lane straight wherever the line of sight is open water
                    var px = new List<double> { xs[0] };
                    var py = new List<double> { ys[0] };
                    int from = 0;
                    while (from < xs.Count - 1)
                    {
                        int next = from + 1;
                        for (int t = xs.Count - 1; t > from + 1; t--)
                        {
                            if (OpenSea(xs[from], ys[from], xs[t], ys[t]))
                            {
                                next = t;
                                break;
                            }
                        }
                        px.Add(xs[next]);
                        py.Add(ys[next]);
                        from = next;
                    }
                    xs = px;
                    ys = py;
                }
                double[] pts = new double[2 * xs.Count];
                for (int t = 0; t < xs.Count; t++)
                {
                    pts[2 * t] = xs[t];
                    pts[2 * t + 1] = ys[t];
                }
                List<long>? keys = p.Keys;
                int[] runs = keys != null
                    ? RunsOf(xs.Count, t => keys[t] < 0 || seenRiver.Add(keys[t]))
                    : [0, xs.Count - 1];
                parts[r] = new TravelPart { Mode = p.River ? TravelMode.River : TravelMode.Sea, Pts = pts, Runs = runs };
            }
            return parts;
        }

        var edges = new TravelEdge[kept.Count];
        for (int n = 0; n < kept.Count; n++)
        {
            Cand c = kept[n];
            TravelPart[] parts = c.Water ? WaterParts(c) : [RoadPart(c)];
            double x0 = double.PositiveInfinity, y0 = double.PositiveInfinity, x1 = double.NegativeInfinity, y1 = double.NegativeInfinity;
            double[] len = new double[3];
            foreach (TravelPart p in parts)
            {
                int mi = (int)p.Mode;
                for (int t = 0; t < p.Pts.Length; t += 2)
                {
                    double x = p.Pts[t];
                    double y = p.Pts[t + 1];
                    if (x < x0) x0 = x;
                    if (x > x1) x1 = x;
                    if (y < y0) y0 = y;
                    if (y > y1) y1 = y;
                    if (t > 0) len[mi] += Math.Sqrt((x - p.Pts[t - 2]) * (x - p.Pts[t - 2]) + (y - p.Pts[t - 1]) * (y - p.Pts[t - 1]));
                }
            }
            edges[n] = new TravelEdge
            {
                A = nodes[c.A],
                B = nodes[c.B],
                Mode = !c.Water ? TravelMode.Road : len[1] >= len[2] ? TravelMode.River : TravelMode.Sea,
                Cost = c.Cost,
                Length = len[0] + len[1] + len[2],
                Major = Major(c),
                Parts = parts,
                X0 = x0,
                Y0 = y0,
                X1 = x1,
                Y1 = y1,
            };
        }
        return Done(edges, cands.Count, pruned);
    }
}
