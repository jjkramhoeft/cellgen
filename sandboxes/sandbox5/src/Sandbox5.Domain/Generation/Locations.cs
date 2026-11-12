using System.Collections.Concurrent;
using System.Diagnostics;
using Sandbox5.Domain.Model;
using Sandbox5.Domain.Numerics;

namespace Sandbox5.Domain.Generation;

/// <summary>Relative weight of each factor in the combined viability score.</summary>
public sealed record FactorWeights(double Resources, double Geography, double Trade, double Climate, double Prosperity);

public sealed record LocationParams
{
    /// <summary>Locations aimed for per region (cities included).</summary>
    public required int Count { get; init; }
    /// <summary>At most this many of them are cities.</summary>
    public required int Cities { get; init; }
    /// <summary>Preferred least distance between two locations, metres (relaxed when the region would get fewer than Count).</summary>
    public required double Spacing { get; init; }
    public required FactorWeights Weights { get; init; }
}

/// <summary>A land patch of a region with everything that went into its viability score.</summary>
public sealed class LocationCandidate
{
    /// <summary>Patch (merged root), its region and (merged) elevation zone.</summary>
    public required long Patch { get; init; }
    public required long Region { get; init; }
    public required long Zone { get; init; }
    /// <summary>Index into <see cref="ElevationZoneType.All"/>, index into <see cref="Model.Biome.All"/> (at the zone type's typical height).</summary>
    public required int ZoneType { get; init; }
    public required int Biome { get; init; }
    /// <summary>The spot: on the patch's river when it has one, otherwise its site; metres.</summary>
    public required double X { get; init; }
    public required double Y { get; init; }
    /// <summary>The spot is on a river.</summary>
    public required bool OnRiver { get; init; }
    /// <summary>Patch steps to the nearest patch that touches another region's land (0 = touches one; 99 = the region has no land border).</summary>
    public required int Depth { get; init; }
    public required bool Coast { get; init; }
    /// <summary>On the coast of an enclosed bay.</summary>
    public required bool Harbour { get; init; }
    /// <summary>Share of the neighbours that are ocean.</summary>
    public required double OceanFrac { get; init; }
    /// <summary>Area of the largest lake placed in the patch, m² (0 = none).</summary>
    public required double Lake { get; init; }
    /// <summary>Largest river in the patch, at its mouth here, and the smaller branch of its largest confluence: patches drained upstream.</summary>
    public required double River { get; init; }
    public required double Mouth { get; init; }
    public required double Confluence { get; init; }
    /// <summary>The upstream end of a navigable river.</summary>
    public required bool Head { get; init; }
    // terms of the factors, each in [0, 1]
    public required double Food { get; init; }
    public required double Water { get; init; }
    public required double Materials { get; init; }
    public required double Fish { get; init; }
    /// <summary>Trade goods of the patch and its neighbours.</summary>
    public required double Goods { get; init; }
    public required double Buildable { get; init; }
    public required double Waterside { get; init; }
    public required double Defence { get; init; }
    public required double Gateway { get; init; }
    public required double Centrality { get; init; }
    /// <summary>Temperature comfort alone (the climate factor also holds the aridity).</summary>
    public required double Comfort { get; init; }
    // the five factors, each in [0, 1]
    public required double Resources { get; init; }
    public required double Geography { get; init; }
    public required double Trade { get; init; }
    public required double Climate { get; init; }
    public required double Prosperity { get; init; }
    /// <summary>The limiting necessity: min(water, temperature comfort), doubled and capped at 1.</summary>
    public required double Need { get; init; }
    /// <summary>Combined viability, 0–100.</summary>
    public required double Score { get; init; }
    /// <summary>What stands out about the place ("river mouth", "sheltered harbour", "central place", …).</summary>
    public required string[] Features { get; init; }
}

public enum LocationKind
{
    City,
    Town,
}

/// <summary>A chosen city or town location: a candidate with its rank in the region.</summary>
/// <param name="Rank">1 = the best score of its region.</param>
public sealed record PlacedLocation(LocationCandidate Site, int Rank, LocationKind Kind)
{
    public long Patch => Site.Patch;
    public long Region => Site.Region;
    public double X => Site.X;
    public double Y => Site.Y;
    public double Score => Site.Score;
}

public sealed class RegionLocations
{
    public required long Region { get; init; }
    /// <summary>The chosen locations, best score first.</summary>
    public required PlacedLocation[] List { get; init; }
    /// <summary>Every land patch of the region, by key order.</summary>
    public required LocationCandidate[] Candidates { get; init; }
    public required Dictionary<long, LocationCandidate> ByPatch { get; init; }
    /// <summary>Candidates that may hold a location (score above 0, not on a land border).</summary>
    public required int Eligible { get; init; }
    /// <summary>The least distance between two locations the selection ended up using, metres.</summary>
    public required double Spacing { get; init; }
    public required double Ms { get; init; }
}

/// <summary>
/// Potential city and town locations, computed per region: a port of world/locations.ts.
///
///   Candidates  every land patch (merged) drawn in the region. Each gets five factor scores
///               in [0, 1], from the map alone (no terrain): resources (food of its
///               catchment, fresh water, building material and fuel, fish, trade goods),
///               geography (buildable ground, a waterside site, defence, depth inside the
///               region), trade (a gateway such as a river mouth or harbour, or a central
///               place), climate (comfort of temperature and aridity) and prosperity.
///   Score       viability = 100 × need × the weighted mean of the five factors; no fresh
///               water or an unlivable temperature gives 0.
///   Selection   first up to <c>Cities</c> cities (the best scores, well inside the region
///               and far apart), then towns, best first, each at least the spacing from every
///               location chosen so far; the spacing is relaxed when the region comes up short.
///   Spot        on the river where one runs through the patch, otherwise the patch's site.
///
/// The biomes (and the resource layer on them) must be terrain-less, as in Sandbox 4, so the
/// locations do not depend on the height map. Deterministic, order-independent, thread-safe.
/// </summary>
public sealed class Locations
{
    /// <summary>Depth of every patch in a region with no land border (an island).</summary>
    public const int NoBorder = 99;
    /// <summary>Cities keep this × the spacing from each other, and lie at least this many patch steps inside the region.</summary>
    public const double CitySpacing = 2.5;
    public const int CityDepth = 2;
    /// <summary>The spacing is relaxed by this factor per round, down to one patch size.</summary>
    private const double Relax = 0.85;
    /// <summary>A river is navigable / large from this many patches drained upstream.</summary>
    public const double Navigable = 8;
    public const double BigRiver = 80;
    /// <summary>One day of travel on open flat land, km: the distance scale of the central-place term.</summary>
    private const double DayKm = 35;
    /// <summary>Travel along a navigable river costs this × the same distance on open flat land.</summary>
    private const double RiverCost = 0.4;
    /// <summary>The central-place term reaches 1 at this share of an ideal region.</summary>
    private const double CentralFull = 0.55;
    /// <summary>A site that lies outside its own (warped) cell is moved: points up to one patch size away, in this many rings of 8 directions.</summary>
    private const int SpotRings = 4;
    private static readonly (double X, double Y)[] SpotDirs = [(1, 0), (0, 1), (-1, 0), (0, -1), (0.7, 0.7), (-0.7, 0.7), (-0.7, -0.7), (0.7, -0.7)];
    private static readonly (double X, double Y)[] SpotCentre = [(0, 0)];

    private const int StLoc = 0x10c1;

    /// <summary>How much slower travel is through the vegetation (1 = open), per biome.</summary>
    private static readonly double[] Veg = [1, 1.5, 1.1, 1, 1.3, 1, 1, 1.1, 1.3, 1.3, 2, 1.1, 1.1, 1, 1.3, 2, 2];
    private static readonly int MangroveB = Model.Biome.Mangrove.Index;
    private static readonly int RFish = ResourceType.IndexOf("fish");
    private static readonly int RTimber = ResourceType.IndexOf("timber");
    private static readonly int RStone = ResourceType.IndexOf("stone");
    private static readonly int RClay = ResourceType.IndexOf("clay");
    private static readonly int RFuel = ResourceType.IndexOf("fuel");
    /// <summary>A neighbour's timber, stone and fuel, and its trade goods, count this much (a short haul).</summary>
    private const double Near = 0.7;
    private const double NearGoods = 0.5;
    /// <summary>Trade goods of the patch and its best neighbour that make the goods term 1.</summary>
    private const double GoodsFull = 1.2;
    /// <summary>A deposit this rich is named among what stands out about a place.</summary>
    private const double Notable = 0.5;

    // per zone type: ocean, flat, lowland, hills, mountains
    private static readonly double[] BuildableZ = [0, 1, 0.9, 0.55, 0.25];
    private static readonly double[] DefenceZ = [0, 0, 0.1, 0.6, 0.7];
    private static readonly double[] Rough = [0, 1, 1, 1.3, 2];
    /// <summary>How much fuel a thermal belt needs (polar … tropical).</summary>
    private static readonly double[] FuelNeed = [1, 1, 0.8, 0.5, 0.1];

    private static double Sat(double v) => v < 0 ? 0 : v > 1 ? 1 : v;

    private static double Ramp(double v, double a, double b) => Sat((v - a) / (b - a));

    private static double Trap(double v, double a, double b, double c, double d) => v <= a || v >= d ? 0 : v < b ? (v - a) / (b - a) : v <= c ? 1 : (d - v) / (d - c);

    /// <summary>The combined viability (0–100) of five factor scores under the weights; <paramref name="need"/> scales it.</summary>
    public static double Combine(double resources, double geography, double trade, double climate, double prosperity, double need, FactorWeights weights)
    {
        double[] f = [resources, geography, trade, climate, prosperity];
        double[] ws = [weights.Resources, weights.Geography, weights.Trade, weights.Climate, weights.Prosperity];
        double sum = 0;
        double total = 0;
        for (int k = 0; k < 5; k++)
        {
            double w = Math.Max(0, ws[k]);
            sum += w * f[k];
            total += w;
        }
        // all weights 0: every factor counts the same
        if (total <= 0)
        {
            for (int k = 0; k < 5; k++) sum += f[k];
            total = 5;
        }
        return (100 * need * sum) / total;
    }

    private readonly ConcurrentDictionary<long, Lazy<RegionLocations>> _cache = new();

    public World World { get; }
    public Rivers Rivers { get; }
    public Lakes Lakes { get; }
    public Biomes Biomes { get; }
    public Climate Climate { get; }
    public LocationParams P { get; }
    /// <summary>The resource layer the resources factor reads (on the same terrain-less biomes).</summary>
    public Resources Resources { get; }

    public Locations(World world, Rivers rivers, Lakes lakes, Biomes biomes, Climate climate, LocationParams p, Resources? resources = null)
    {
        if (biomes.Terrain != null) throw new ArgumentException("Locations need terrain-less Biomes (zone-typical heights)", nameof(biomes));
        if (resources != null && !ReferenceEquals(resources.Biomes, biomes)) throw new ArgumentException("Locations need the resource layer of their own Biomes", nameof(resources));
        World = world;
        Rivers = rivers;
        Lakes = lakes;
        Biomes = biomes;
        Climate = climate;
        Resources = resources ?? new Resources(world, rivers, lakes, biomes, climate);
        P = p with { Count = Math.Max(0, p.Count), Cities = Math.Max(0, p.Cities), Spacing = Math.Max(0, p.Spacing) };
    }

    public bool Has(long rkey) => _cache.TryGetValue(rkey, out var l) && l.IsValueCreated;

    public RegionLocations Get(long rkey) => _cache.GetOrAdd(rkey, k => new Lazy<RegionLocations>(() => Compute(k))).Value;

    /// <summary>The candidate of the land patch at a point (null over the ocean).</summary>
    public LocationCandidate? CandidateAt(double x, double y)
    {
        CellInfo c = World.CellAt(x, y, true);
        if (c.Ocean) return null;
        return Get(c.Region).ByPatch.GetValueOrDefault(c.Patch);
    }

    /// <summary>The nearest location with at least <paramref name="minScore"/> within <paramref name="maxDist"/> metres.</summary>
    public PlacedLocation? Nearest(double x, double y, double maxDist, double minScore = 0)
    {
        long rk = World.RegionAt(x, y);
        int ri = CellKeys.I(rk);
        int rj = CellKeys.J(rk);
        PlacedLocation? best = null;
        double bd = maxDist * maxDist;
        for (int dj = -1; dj <= 1; dj++)
        {
            for (int di = -1; di <= 1; di++)
            {
                foreach (PlacedLocation l in Get(CellKeys.Pack(ri + di, rj + dj)).List)
                {
                    if (l.Score < minScore) continue;
                    double d = (l.X - x) * (l.X - x) + (l.Y - y) * (l.Y - y);
                    if (d <= bd)
                    {
                        bd = d;
                        best = l;
                    }
                }
            }
        }
        return best;
    }

    private RegionLocations Compute(long rkey)
    {
        var sw = Stopwatch.StartNew();
        World w = World;
        LocationParams P = this.P;
        double S = w.PatchLevel.Size;

        // ---- the region's land patches (merged roots, key order) and their raw members
        var members = new Dictionary<long, List<long>>();
        foreach (long b in Rivers.RegionElevationZones(rkey))
        {
            if (w.ElevationZoneCell(b).Ocean) continue;
            foreach (long s in w.ElevationZonePatches(w.ElevationZone(b)))
            {
                CellInfo c = w.PatchCell(s);
                if (c.Ocean || c.Region != rkey) continue;
                if (members.TryGetValue(c.Patch, out var list)) list.Add(s);
                else members[c.Patch] = [s];
            }
        }
        long[] roots = members.Keys.OrderBy(k => k).ToArray();
        int n = roots.Length;
        var index = new Dictionary<long, int>(n);
        for (int i = 0; i < n; i++) index[roots[i]] = i;

        // ---- neighbours: own land (indices), ocean, other regions' land; enclosed bays
        var land = new int[n][];
        double[] oceanFrac = new double[n];
        // ocean neighbours (merged patches)
        int[] seaNbrs = new int[n];
        bool[] coast = new bool[n];
        bool[] harbour = new bool[n];
        bool[] border = new bool[n];
        var bayMemo = new Dictionary<long, bool>();
        bool IsBay(long o)
        {
            if (!bayMemo.TryGetValue(o, out bool v))
            {
                v = Generation.Resources.IsBayPatch(w, o);
                bayMemo[o] = v;
            }
            return v;
        }
        for (int i = 0; i < n; i++)
        {
            var own = new HashSet<int>();
            var sea = new HashSet<long>();
            var foreign = new HashSet<long>();
            foreach (long s in members[roots[i]].OrderBy(k => k))
            {
                foreach (long q in w.PatchNbrs(w.Patch(s)))
                {
                    CellInfo qc = w.PatchCell(q);
                    if (qc.Patch == roots[i]) continue;
                    if (qc.Ocean)
                    {
                        sea.Add(qc.Patch);
                        if (IsBay(q)) harbour[i] = true;
                    }
                    else if (qc.Region == rkey)
                    {
                        if (index.TryGetValue(qc.Patch, out int j)) own.Add(j);
                    }
                    else foreign.Add(qc.Patch);
                }
            }
            land[i] = own.OrderBy(k => k).ToArray();
            int all = own.Count + sea.Count + foreign.Count;
            oceanFrac[i] = all != 0 ? (double)sea.Count / all : 0;
            seaNbrs[i] = sea.Count;
            coast[i] = sea.Count != 0;
            border[i] = foreign.Count != 0;
        }

        // ---- depth: patch steps from the land border of the region (breadth first)
        int[] depth = new int[n];
        Array.Fill(depth, NoBorder);
        var front = new List<int>();
        for (int i = 0; i < n; i++)
        {
            if (border[i])
            {
                depth[i] = 0;
                front.Add(i);
            }
        }
        while (front.Count > 0)
        {
            var next = new List<int>();
            foreach (int i in front)
            {
                foreach (int j in land[i])
                {
                    if (depth[j] == NoBorder)
                    {
                        depth[j] = depth[i] + 1;
                        next.Add(j);
                    }
                }
            }
            front = next;
        }

        // ---- lakes: the largest lake of each patch
        List<LakeShape> regionLakes = Lakes.Get(rkey).Lakes;
        double[] lakeArea = new double[n];
        foreach (LakeShape l in regionLakes)
        {
            if (index.TryGetValue(l.Patch, out int i) && l.Area > lakeArea[i]) lakeArea[i] = l.Area;
        }
        bool InLake(double x, double y)
        {
            foreach (LakeShape l in regionLakes)
                if (l.Contains(x, y))
                    return true;
            return false;
        }

        // ---- rivers: size, mouths, confluences, heads of navigation, and the spot on the river
        RegionRivers rr = Rivers.Get(rkey);
        int perPatch = Math.Max(1, Rivers.P.PerPatch);
        double[] river = new double[n];
        double[] mouth = new double[n];
        double[] conf = new double[n];
        bool[] head = new bool[n];
        // the node the spot goes to: the mouth when there is one, else the largest flow, never in a lake
        int[] spot = new int[n];
        Array.Fill(spot, -1);
        int[] spotFlow = new int[n];
        bool[] spotMouth = new bool[n];
        // patch index of each node on the region's own land (−1 otherwise)
        int[] nodePatch = new int[rr.N];
        Array.Fill(nodePatch, -1);
        for (int k = 0; k < rr.N; k++)
        {
            if (rr.Parent[k] < 0 || rr.Wet[k] != 0) continue;
            CellInfo c = w.CellAt(rr.X[k], rr.Y[k], true);
            if (c.Ocean || c.Region != rkey) continue;
            if (index.TryGetValue(c.Patch, out int i)) nodePatch[k] = i;
        }
        // the two largest flows among each node's children on the region's land
        int[] kid1 = new int[rr.N];
        int[] kid2 = new int[rr.N];
        for (int k = 0; k < rr.N; k++)
        {
            int p = rr.Parent[k];
            if (p < 0 || nodePatch[k] < 0) continue;
            int f = rr.Flow[k];
            if (f > kid1[p])
            {
                kid2[p] = kid1[p];
                kid1[p] = f;
            }
            else if (f > kid2[p]) kid2[p] = f;
        }
        double navFlow = Navigable * perPatch;
        // navigable river links between two patches (pairs of indices)
        var riverLinks = new List<int>();
        for (int k = 0; k < rr.N; k++)
        {
            int i = nodePatch[k];
            if (i < 0) continue;
            int f = rr.Flow[k];
            double a = (double)f / perPatch;
            int p = rr.Parent[k];
            if (a > river[i]) river[i] = a;
            bool atMouth = rr.Parent[p] < 0 || rr.Wet[p] == 1;
            if (atMouth && a > mouth[i]) mouth[i] = a;
            if ((double)kid2[k] / perPatch > conf[i]) conf[i] = (double)kid2[k] / perPatch;
            if (f >= navFlow && kid1[k] < navFlow) head[i] = true;
            if (f >= navFlow && nodePatch[p] >= 0 && nodePatch[p] != i)
            {
                riverLinks.Add(i);
                riverLinks.Add(nodePatch[p]);
            }
            // the spot: a mouth beats any other node, then the larger flow, then the smaller index
            bool better = atMouth ? !spotMouth[i] || f > spotFlow[i] : !spotMouth[i] && f > spotFlow[i];
            if (better && !InLake(rr.X[k], rr.Y[k]))
            {
                spot[i] = k;
                spotFlow[i] = f;
                spotMouth[i] = atMouth;
            }
        }

        // ---- per-patch climate and biome (zone-typical heights), resources, food, travel cost
        int[] zt = new int[n];
        int[] biome = new int[n];
        long[] zone = new long[n];
        double[] temp = new double[n];
        double[] arid = new double[n];
        int[] belt = new int[n];
        double[] foodHere = new double[n];
        PatchResources[] res = roots.Select(r => Resources.OfPatch(r)).ToArray();
        double[] sx = new double[n];
        double[] sy = new double[n];
        for (int i = 0; i < n; i++)
        {
            BiomeInfo b = Biomes.OfPatch(roots[i]);
            zt[i] = b.ZoneType;
            biome[i] = b.Biome;
            zone[i] = w.PatchCell(roots[i]).ElevationZone;
            temp[i] = b.T;
            arid[i] = b.Aridity;
            belt[i] = b.Belt;
            // grain or roots (irrigated by the patch's river where it is dry), herds, orchards, game
            foodHere[i] = res[i].Food;
            PatchNode s = w.Patch(roots[i]);
            sx[i] = s.X;
            sy[i] = s.Y;
        }

        // ---- central places: how much of the region's food is within reach of each patch
        // (Hansen accessibility over the travel graph: land between neighbours, navigable rivers)
        var adj = new List<int>[n];
        var cost = new List<double>[n];
        for (int i = 0; i < n; i++)
        {
            adj[i] = [];
            cost[i] = [];
        }
        double Km(int i, int j) => Math.Sqrt((sx[i] - sx[j]) * (sx[i] - sx[j]) + (sy[i] - sy[j]) * (sy[i] - sy[j])) / 1000;
        for (int i = 0; i < n; i++)
        {
            foreach (int j in land[i])
            {
                adj[i].Add(j);
                cost[i].Add(Km(i, j) * 0.5 * (Rough[zt[i]] + Rough[zt[j]]) * 0.5 * (Veg[biome[i]] + Veg[biome[j]]));
            }
        }
        for (int e = 0; e < riverLinks.Count; e += 2)
        {
            int i = riverLinks[e];
            int j = riverLinks[e + 1];
            double c = Km(i, j) * RiverCost;
            adj[i].Add(j);
            cost[i].Add(c);
            adj[j].Add(i);
            cost[j].Add(c);
        }
        double patchKm2 = (S / 1000) * (S / 1000);
        double[] weight = new double[n];
        for (int i = 0; i < n; i++) weight[i] = foodHere[i] * members[roots[i]].Count * patchKm2;
        // an ideal region: a disc of full farmland of the region's area, seen from its centre
        double reach = w.RegionLevel.Size / 1000 / Math.Sqrt(Math.PI) / DayKm;
        double ideal = 2 * Math.PI * DayKm * DayKm * (DMath.Log(1 + reach) + 1 / (1 + reach) - 1);
        double[] central = new double[n];
        double[] dist = new double[n];
        var heap = new MinHeap(256);
        for (int s = 0; s < n; s++)
        {
            Array.Fill(dist, double.PositiveInfinity);
            dist[s] = 0;
            heap.Push(0, s);
            double acc = 0;
            while (heap.Size > 0)
            {
                double d = heap.PeekKey();
                int u = heap.Pop();
                if (d > dist[u]) continue;
                double q = 1 + d / DayKm;
                acc += weight[u] / (q * q);
                List<int> au = adj[u];
                List<double> cu = cost[u];
                for (int e = 0; e < au.Count; e++)
                {
                    double nd = d + cu[e];
                    if (nd < dist[au[e]])
                    {
                        dist[au[e]] = nd;
                        heap.Push(nd, au[e]);
                    }
                }
            }
            central[s] = Sat(acc / (CentralFull * ideal));
        }

        // ---- the candidates
        NoiseFieldParams pros = Climate.P.Prosperity;
        double prosSpan = pros.Max - pros.Min;
        var candidates = new LocationCandidate[n];
        for (int i = 0; i < n; i++)
        {
            long root = roots[i];
            bool isCoast = coast[i];
            bool isHarbour = harbour[i];
            bool hasLake = lakeArea[i] > 0;
            double a = river[i];

            // the spot: on the river, else the site of the root (or of a member that lies in its own cell)
            double x = sx[i];
            double y = sy[i];
            bool onRiver = false;
            if (spot[i] >= 0 && spotFlow[i] >= 3)
            {
                x = rr.X[spot[i]];
                y = rr.Y[spot[i]];
                onRiver = true;
            }
            else
            {
                bool Ok(double px, double py) => w.CellAt(px, py, true).Patch == root && !InLake(px, py);
                if (!Ok(x, y))
                {
                    // border warp can push a site out of its own cell (or a lake may cover it): try the
                    // other members' sites, then points around the sites, nearest first
                    PatchNode[] sites = members[root].Select(s => w.Patch(s)).ToArray();
                    bool found = false;
                    for (int ring = 0; ring <= SpotRings && !found; ring++)
                    {
                        foreach (PatchNode m in sites)
                        {
                            foreach (var (ux, uy) in ring == 0 ? SpotCentre : SpotDirs)
                            {
                                double px = m.X + (ux * ring * S) / SpotRings;
                                double py = m.Y + (uy * ring * S) / SpotRings;
                                if (Ok(px, py))
                                {
                                    x = px;
                                    y = py;
                                    found = true;
                                    break;
                                }
                            }
                            if (found) break;
                        }
                    }
                }
            }

            // resources: what the resource layer gives the patch and, by a short haul, its neighbours
            double[] own = res[i].Amount;
            double ringFood = 2 * foodHere[i];
            double timberNear = 0;
            double stoneNear = 0;
            double fuelNear = 0;
            double goodsNear = 0;
            foreach (int j in land[i])
            {
                ringFood += foodHere[j];
                double[] near = res[j].Amount;
                if (near[RTimber] > timberNear) timberNear = near[RTimber];
                if (near[RStone] > stoneNear) stoneNear = near[RStone];
                if (near[RFuel] > fuelNear) fuelNear = near[RFuel];
                if (res[j].Wealth > goodsNear) goodsNear = res[j].Wealth;
            }
            // ocean neighbours hold no farmland: a coast has a smaller catchment (and fish instead)
            double food = ringFood / (2 + land[i].Length + seaNbrs[i]);
            double water = Max(Sat(a / 2), Ramp(arid[i], 0.5, 1.5), isCoast ? 0.5 : 0, hasLake ? 1 : 0);
            // something to build with, and enough to burn for the climate
            double building = Max(own[RTimber], own[RStone], own[RClay], Near * timberNear, Near * stoneNear);
            double fuel = Max(own[RFuel], Near * fuelNear, 1 - FuelNeed[belt[i]]);
            double materials = 0.5 * building + 0.5 * fuel;
            double fish = own[RFish];
            double goods = Sat((res[i].Wealth + NearGoods * goodsNear) / GoodsFull);
            double resources = 0.45 * food + 0.2 * water + 0.15 * materials + 0.1 * fish + 0.1 * goods;

            // geography
            double buildable = BuildableZ[zt[i]] * (biome[i] == MangroveB ? 0.5 : 1);
            double waterside = Max(a >= Navigable ? 1 : a >= 2 ? 0.7 : a > 0 ? 0.4 : 0, isHarbour ? 1 : isCoast ? 0.7 : 0, hasLake ? 0.8 : 0);
            double defence = Max(DefenceZ[zt[i]], oceanFrac[i] >= 0.5 ? 0.5 : 0, conf[i] >= Navigable / 2 ? 0.4 : 0);
            double geography = buildable * (0.5 + 0.3 * waterside + 0.2 * defence) * (0.75 + 0.25 * Sat(depth[i] / 3.0));

            // trade and travel: one dominant gateway feature plus a quarter of the rest, or a central place
            double[] items = [Sat(mouth[i] / BigRiver), isHarbour ? 0.6 : isCoast ? 0.24 : 0, 0.5 * Ramp(a, Navigable, BigRiver), head[i] ? 0.6 : 0, 0.4 * Sat(conf[i] / Navigable), hasLake ? 0.15 : 0];
            double top = 0;
            double sum = 0;
            foreach (double v in items)
            {
                sum += v;
                if (v > top) top = v;
            }
            double gateway = Sat((top + 0.25 * (sum - top)) / 1.5);
            double centrality = central[i];
            double trade = Sat(Math.Max(gateway, centrality) + 0.25 * Math.Min(gateway, centrality));

            // climate
            double comfort = Trap(temp[i], -8, 4, 24, 34);
            double climate = comfort * (0.4 + 0.6 * Ramp(arid[i], 0.2, 1)) * (arid[i] > 6 ? 0.85 : 1);

            // prosperity
            double prosperity = prosSpan > 0 ? Sat((Climate.ProsperityAt(x, y) - pros.Min) / prosSpan) : 0.5;

            double need = Sat(2 * Math.Min(water, comfort));
            double score = Combine(resources, geography, trade, climate, prosperity, need, P.Weights);

            var features = new List<string>();
            if (mouth[i] >= 2) features.Add(mouth[i] >= Navigable ? "mouth of a navigable river" : "river mouth");
            if (isHarbour) features.Add("sheltered harbour");
            else if (isCoast) features.Add("coast");
            if (a >= Navigable && mouth[i] < Navigable) features.Add(a >= BigRiver ? "large river" : "navigable river");
            else if (a >= 2 && mouth[i] < 2) features.Add("river");
            if (head[i]) features.Add("head of navigation");
            if (conf[i] >= Navigable / 2) features.Add("confluence");
            if (hasLake) features.Add("lake");
            if (centrality >= 0.6 && centrality >= gateway) features.Add("central place");
            if (DefenceZ[zt[i]] >= 0.6) features.Add("high ground");
            else if (oceanFrac[i] >= 0.5) features.Add("peninsula");
            if (food >= 0.7) features.Add("rich farmland");
            // the richest deposits of the patch (at most two): a salt works, a mining town
            int named = 0;
            foreach (ResourceHit hit in res[i].List)
            {
                if (named >= 2 || hit.Amount < Notable) break;
                ResourceType type = ResourceType.All[hit.Resource];
                if (type.Kind != ResourceKind.Deposit || type.Id == "stone") continue;
                features.Add(type.Name.ToLowerInvariant());
                named++;
            }

            candidates[i] = new LocationCandidate
            {
                Patch = root,
                Region = rkey,
                Zone = zone[i],
                ZoneType = zt[i],
                Biome = biome[i],
                X = x,
                Y = y,
                OnRiver = onRiver,
                Depth = depth[i],
                Coast = isCoast,
                Harbour = isHarbour,
                OceanFrac = oceanFrac[i],
                Lake = lakeArea[i],
                River = a,
                Mouth = mouth[i],
                Confluence = conf[i],
                Head = head[i],
                Food = food,
                Water = water,
                Materials = materials,
                Fish = fish,
                Goods = goods,
                Buildable = buildable,
                Waterside = waterside,
                Defence = defence,
                Gateway = gateway,
                Centrality = centrality,
                Comfort = comfort,
                Resources = resources,
                Geography = geography,
                Trade = trade,
                Climate = climate,
                Prosperity = prosperity,
                Need = need,
                Score = score,
                Features = features.ToArray(),
            };
        }

        // ---- selection: cities first, then towns, both greedy by score with a least distance
        uint Tie(LocationCandidate c) => Hash.Hash4(w.SeedInt, StLoc, CellKeys.I(c.Patch), CellKeys.J(c.Patch));
        int ByScore(LocationCandidate a, LocationCandidate b)
        {
            if (b.Score > a.Score) return 1;
            if (b.Score < a.Score) return -1;
            int t = Tie(a).CompareTo(Tie(b));
            return t != 0 ? t : a.Patch.CompareTo(b.Patch);
        }
        List<LocationCandidate> order = candidates.Where(c => c.Score > 0 && c.Depth >= 1).ToList();
        order.Sort(ByScore);
        static bool Far(LocationCandidate c, List<LocationCandidate> others, double d)
        {
            foreach (LocationCandidate o in others)
                if ((o.X - c.X) * (o.X - c.X) + (o.Y - c.Y) * (o.Y - c.Y) < d * d)
                    return false;
            return true;
        }
        var cities = new List<LocationCandidate>();
        int cityCap = Math.Min(P.Cities, P.Count);
        foreach (LocationCandidate c in order)
        {
            if (cities.Count >= cityCap) break;
            if (c.Depth >= CityDepth && Far(c, cities, CitySpacing * P.Spacing)) cities.Add(c);
        }
        var isCity = new HashSet<LocationCandidate>(cities, ReferenceEqualityComparer.Instance);
        double spacing = P.Spacing;
        List<LocationCandidate> picked;
        for (;;)
        {
            picked = [.. cities];
            foreach (LocationCandidate c in order)
            {
                if (picked.Count >= P.Count) break;
                if (!isCity.Contains(c) && Far(c, picked, spacing)) picked.Add(c);
            }
            if (picked.Count >= P.Count || spacing <= S) break;
            spacing = Math.Max(S, spacing * Relax);
        }
        picked.Sort(ByScore);
        PlacedLocation[] placed = picked.Select((c, k) => new PlacedLocation(c, k + 1, isCity.Contains(c) ? LocationKind.City : LocationKind.Town)).ToArray();

        return new RegionLocations
        {
            Region = rkey,
            List = placed,
            Candidates = candidates,
            ByPatch = candidates.ToDictionary(c => c.Patch),
            Eligible = order.Count,
            Spacing = spacing,
            Ms = sw.Elapsed.TotalMilliseconds,
        };
    }

    private static double Max(double a, double b, double c) => Math.Max(Math.Max(a, b), c);

    private static double Max(double a, double b, double c, double d) => Math.Max(Math.Max(Math.Max(a, b), c), d);

    private static double Max(double a, double b, double c, double d, double e) => Math.Max(Math.Max(Math.Max(Math.Max(a, b), c), d), e);
}
