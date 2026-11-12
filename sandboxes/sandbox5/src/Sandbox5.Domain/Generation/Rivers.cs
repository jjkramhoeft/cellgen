using System.Collections.Concurrent;
using System.Diagnostics;
using Sandbox5.Domain.Model;
using Sandbox5.Domain.Numerics;

namespace Sandbox5.Domain.Generation;

/// <summary>How each attractor's pull is weighted by its distance.</summary>
public enum PullPower
{
    /// <summary>Every pull equal (the paper).</summary>
    Normal,
    /// <summary>(d / dᵢ)²: far attractors dominate.</summary>
    Squared,
    /// <summary>√(d / dᵢ): mildly favours far ones.</summary>
    Sqrt,
}

public sealed record RiverParams
{
    /// <summary>Attractors per eligible patch.</summary>
    public required int PerPatch { get; init; }
    /// <summary>Growth step D, metres.</summary>
    public required double Step { get; init; }
    /// <summary>Influence radius dᵢ, metres.</summary>
    public required double Influence { get; init; }
    /// <summary>Kill distance dₖ, metres (raised to &gt; D so growth cannot overshoot forever).</summary>
    public required double Kill { get; init; }
    /// <summary>Random motion: weight of a random unit vector added to each growth direction.</summary>
    public required double Jitter { get; init; }
    public required PullPower Pull { get; init; }
    /// <summary>Weight of the node's own heading blended into the pull direction. 0 = off.</summary>
    public required double Inertia { get; init; }
    /// <summary>Perception cone, full angle in degrees: 0 (off), 150, 144, 120, 90 or 60.</summary>
    public required int Cone { get; init; }
    /// <summary>Correlated random motion: 0 = fresh every step; towards 1 = long coherent bends.</summary>
    public required double Wander { get; init; }
    /// <summary>Main-stem dominance: a side branch needs at least this share of the main stem's pull. 0 = off.</summary>
    public required double Apical { get; init; }
    /// <summary>Leave out patches that touch the ocean.</summary>
    public required bool SkipCoast { get; init; }
    /// <summary>
    /// Precipitation cutoff, mm per year: a flat elevation zone whose site gets less initial
    /// precipitation than this is river-poor, and each of its patches gets 0 or 1 attractor
    /// instead of <see cref="PerPatch"/>. 0 = off.
    /// </summary>
    public required double FlatSparseCutoff { get; init; }
    /// <summary>The climate maps the precipitation is read from.</summary>
    public required ClimateParams Climate { get; init; }
    /// <summary>How many elevation zone steps a landlocked region searches for an ocean.</summary>
    public required int MaxHops { get; init; }
}

/// <summary>The river network of one region: a forest of nodes, each tree rooted in an ocean elevation zone.</summary>
public sealed class RegionRivers
{
    public required long Region { get; init; }
    /// <summary>Number of nodes.</summary>
    public required int N { get; init; }
    public required double[] X { get; init; }
    public required double[] Y { get; init; }
    /// <summary>Parent node index (−1 = root). A parent always has a smaller index than its children.</summary>
    public required int[] Parent { get; init; }
    /// <summary>Attractors reached at the node.</summary>
    public required int[] Own { get; init; }
    /// <summary>Attractors reached at the node and upstream of it: the flow of the river here.</summary>
    public required int[] Flow { get; init; }
    /// <summary>Root node of each node's tree.</summary>
    public required int[] Tree { get; init; }
    /// <summary>1 when the node lies over ocean (the part of a river between its root and the coast).</summary>
    public required byte[] Wet { get; init; }
    /// <summary>Root node indices and the ocean elevation zone each root drains into.</summary>
    public required int[] Roots { get; init; }
    public required long[] RootOcean { get; init; }
    /// <summary>Attractors and the node that reached each (−1 = never reached).</summary>
    public required double[] Ax { get; init; }
    public required double[] Ay { get; init; }
    public required int[] ReachedBy { get; init; }
    public required int Reached { get; init; }
    public required int Iterations { get; init; }
    /// <summary>Straight bridges added over gaps wider than dᵢ.</summary>
    public required int Bridges { get; init; }
    /// <summary>True when the roots had to come from beyond the region's own coast.</summary>
    public required bool Landlocked { get; init; }
    /// <summary>Bounding box of nodes and attractors.</summary>
    public required double X0 { get; init; }
    public required double Y0 { get; init; }
    public required double X1 { get; init; }
    public required double Y1 { get; init; }
    public required double Ms { get; init; }
}

/// <summary>
/// Space-colonization rivers (Runions et al. 2005, open venation), computed per region: a
/// port of world/rivers.ts.
///
///   Attractors  every land, non-coastal patch drawn in the region gets PerPatch points
///               inside its cell (a river-poor flat zone only 0 or 1).
///   Roots       one per ocean elevation zone that touches the region's land, at the ocean
///               zone's site, so each river first grows across the water to the coast. A
///               landlocked region looks further out for the nearest ocean.
///   Growth      each iteration, every attractor pulls on its nearest node within the
///               influence radius dᵢ; each pulled node grows one step D towards the mean
///               pull plus random motion. Attractors within the kill distance dₖ of a node
///               are reached. When nothing is within dᵢ, the closest node–attractor pair is
///               bridged with a straight run, so growth continues until every reachable
///               attractor is used.
///   Border      rivers never enter another region's land (ocean is open to all).
///   Width       each node counts the attractors it reached; summed upstream this is the
///               flow of the river at that node.
///
/// Deterministic: sfc32 per region, IEEE + − × ÷ √ only and a fixed visiting order.
/// Thread-safe: each region is computed once.
/// </summary>
public sealed class Rivers
{
    private const int StAttr = 0x7e01;
    private const int StGrow = 0x7e02;
    private const int StSparsePatch = 0x7e04;
    private const int MaxIter = 6000;
    private const int MaxNodes = 120000;
    /// <summary>An attractor that cannot see this many of its closest nodes is given up on by the bridge.</summary>
    private const int MaxBans = 12;
    /// <summary>Bridge passes in a row that find no pair inside the region before growth stops.</summary>
    private const int MaxBlockedPasses = 6;
    /// <summary>A node that has grown this many children and still wants more is stopped.</summary>
    private const int MaxChildren = 8;
    /// <summary>Main-stem dominance counts pulls this many nodes downstream of each puller.</summary>
    private const int ApicalDepth = 48;

    public World World { get; }
    /// <summary>Initial climate, for the precipitation that thins flat zones.</summary>
    public Climate Climate { get; }
    public RiverParams P { get; }

    private readonly ConcurrentDictionary<long, Lazy<RegionRivers>> _cache = new();

    public Rivers(World world, RiverParams p)
    {
        World = world;
        Climate = new Climate(p.Climate);
        P = p with { Kill = Math.Max(p.Kill, p.Step * 1.05), Influence = Math.Max(p.Influence, p.Step * 1.5) };
    }

    public int Size => _cache.Count;

    public bool Has(long rkey) => _cache.TryGetValue(rkey, out var l) && l.IsValueCreated;

    public RegionRivers? Peek(long rkey) => _cache.TryGetValue(rkey, out var l) && l.IsValueCreated ? l.Value : null;

    public RegionRivers Get(long rkey) => _cache.GetOrAdd(rkey, k => new Lazy<RegionRivers>(() => Compute(k))).Value;

    /// <summary>Weight of one attractor's pull at squared distance d2, for an influence radius² di2 (√ only: bit-exact).</summary>
    public static double PullWeight(PullPower power, double d2, double di2) => power switch
    {
        PullPower.Squared => d2 / di2,
        PullPower.Sqrt => Math.Sqrt(Math.Sqrt(d2 / di2)),
        _ => 1,
    };

    /// <summary>cos(cone / 2) for each cone angle, built from √ only.</summary>
    public static double ConeCos(int cone) => cone switch
    {
        150 => (Math.Sqrt(6) - Math.Sqrt(2)) / 4,
        144 => (Math.Sqrt(5) - 1) / 4,
        120 => 0.5,
        90 => Math.Sqrt(0.5),
        60 => Math.Sqrt(3) / 2,
        _ => -1,
    };

    /// <summary>Is the patch next to a cell of the other kind (land vs ocean)?</summary>
    public bool IsCoastPatch(long pkey)
    {
        World w = World;
        bool oc = w.PatchCell(pkey).Ocean;
        foreach (long n in w.PatchNbrs(w.Patch(pkey)))
            if (w.PatchCell(n).Ocean != oc)
                return true;
        return false;
    }

    /// <summary>
    /// Raw elevation zones drawn as part of a region. This is not the region's owned zones: a
    /// merged elevation zone is drawn in the region of the zone it joined, which may be a
    /// neighbouring region. Rivers follow what is drawn. Sorted by key.
    /// </summary>
    public long[] RegionElevationZones(long rkey)
    {
        World w = World;
        RegionNode reg = w.Region(rkey);
        var result = new List<long>();
        for (int dj = -1; dj <= 1; dj++)
        {
            for (int di = -1; di <= 1; di++)
            {
                foreach (long b in w.Region(CellKeys.Pack(reg.I + di, reg.J + dj)).ElevationZones)
                    if (w.ElevationZoneCell(b).Region == rkey)
                        result.Add(b);
            }
        }
        result.Sort();
        return result.ToArray();
    }

    /// <summary>Is a point land drawn in this region?</summary>
    private bool IsOwnLand(long rkey, double x, double y)
    {
        CellInfo c = World.CellAt(x, y, true);
        return !c.Ocean && c.Region == rkey;
    }

    /// <summary>
    /// Is this (merged) land elevation zone a river-poor flat zone: is the initial
    /// precipitation at its site below the cutoff? Depends on the zone alone.
    /// </summary>
    public bool IsSparseFlat(long zkey)
    {
        if (P.FlatSparseCutoff <= 0 || ElevationZoneType.IndexOf(zkey, false) != ElevationZoneType.FlatIndex) return false;
        ZoneNode z = World.ElevationZone(zkey);
        return Climate.PrecipitationAt(z.X, z.Y) < P.FlatSparseCutoff;
    }

    /// <summary>Attractor points of a region (land, non-coastal patches drawn in the region).</summary>
    public (List<double> Ax, List<double> Ay) Attractors(long rkey)
    {
        World w = World;
        RegionNode reg = w.Region(rkey);
        Level level = w.PatchLevel;
        var rng = new Sfc32(Hash.Hash4(w.SeedInt, StAttr, reg.I, reg.J));
        var ax = new List<double>();
        var ay = new List<double>();
        foreach (long b in RegionElevationZones(rkey))
        {
            CellInfo bc = w.ElevationZoneCell(b);
            if (bc.Ocean) continue;
            bool sparse = IsSparseFlat(bc.ElevationZone);
            foreach (long s in w.ElevationZonePatches(w.ElevationZone(b)))
            {
                CellInfo sc = w.PatchCell(s);
                if (sc.Ocean || sc.Region != rkey) continue;
                if (P.SkipCoast && IsCoastPatch(s)) continue;
                PatchNode sd = w.Patch(s);
                // a river-poor flat zone: 0 or 1 attractor per patch, from the patch's own hash
                int count = sparse ? (int)(Hash.Hash4(w.SeedInt, StSparsePatch, CellKeys.I(s), CellKeys.J(s)) & 1) : P.PerPatch;
                for (int k = 0; k < count; k++)
                {
                    // a random point inside the (warped) patch cell, on the region's land;
                    // fall back to the site, or drop the point when even that is outside
                    double px = double.NaN;
                    double py = double.NaN;
                    for (int t = 0; t < 24; t++)
                    {
                        double qx = sd.X + (rng.Next() - 0.5) * 1.6 * level.Size;
                        double qy = sd.Y + (rng.Next() - 0.5) * 1.6 * level.Size;
                        // nested, every point of patch s is classified as s (checked above);
                        // otherwise the point itself must be the region's land
                        if (level.Query(qx, qy) == s && (w.P.Nest || IsOwnLand(rkey, qx, qy)))
                        {
                            px = qx;
                            py = qy;
                            break;
                        }
                    }
                    if (double.IsNaN(px))
                    {
                        if (!IsOwnLand(rkey, sd.X, sd.Y)) continue;
                        px = sd.X;
                        py = sd.Y;
                    }
                    ax.Add(px);
                    ay.Add(py);
                }
            }
        }
        return (ax, ay);
    }

    /// <summary>Ocean elevation zones that receive a root, and the land elevation zone each root faces.</summary>
    public (List<(long Ocean, long Land)> Pairs, bool Landlocked) RootPairs(long rkey)
    {
        World w = World;
        long[] mine = RegionElevationZones(rkey);
        var own = new HashSet<long>(mine);
        bool IsOcean(long b) => w.ElevationZoneCell(b).Ocean;
        List<long> land = mine.Where(b => !IsOcean(b)).ToList();
        // nearest land neighbour of an ocean elevation zone, preferring the region's own zones
        long Facing(long o)
        {
            long best = -1;
            bool bestOwn = false;
            foreach (long n in w.ElevationZoneNbrs(w.ElevationZone(o)))
            {
                if (IsOcean(n)) continue;
                bool isMine = own.Contains(n);
                if (best < 0 || (isMine && !bestOwn))
                {
                    best = n;
                    bestOwn = isMine;
                }
            }
            return best;
        }
        var oceans = new HashSet<long>();
        foreach (long b in land)
            foreach (long n in w.ElevationZoneNbrs(w.ElevationZone(b)))
                if (IsOcean(n))
                    oceans.Add(n);
        foreach (long b in mine)
            if (IsOcean(b) && Facing(b) >= 0)
                oceans.Add(b);
        bool landlocked = false;
        if (oceans.Count == 0 && land.Count > 0)
        {
            // breadth-first search outwards for the nearest ocean elevation zones
            landlocked = true;
            List<long> frontier = land;
            var seen = new HashSet<long>(land);
            for (int hop = 0; hop < P.MaxHops && oceans.Count == 0; hop++)
            {
                var next = new List<long>();
                foreach (long b in frontier)
                {
                    foreach (long n in w.ElevationZoneNbrs(w.ElevationZone(b)))
                    {
                        if (!seen.Add(n)) continue;
                        if (IsOcean(n)) oceans.Add(n);
                        else next.Add(n);
                    }
                }
                frontier = next;
            }
        }
        var pairs = new List<(long, long)>();
        foreach (long o in oceans.OrderBy(k => k))
        {
            long l = Facing(o);
            if (l >= 0) pairs.Add((o, l));
        }
        return (pairs, landlocked);
    }

    private static long GridKey(int i, int j) => (i + 1048576L) * 2097152L + (j + 1048576L);

    /// <summary>Random vector on the unit circle (rejection sampling in the disc: no trigonometry, so bit-exact).</summary>
    private static void DiscVec(Sfc32 rng, out double ox, out double oy)
    {
        for (;;)
        {
            double x = rng.Next() * 2 - 1;
            double y = rng.Next() * 2 - 1;
            double d = x * x + y * y;
            if (d <= 1 && d > 1e-12)
            {
                double s = 1 / Math.Sqrt(d);
                ox = x * s;
                oy = y * s;
                return;
            }
        }
    }

    public RegionRivers Compute(long rkey)
    {
        var sw = Stopwatch.StartNew();
        World w = World;
        RiverParams P = this.P;
        var (axs, ays) = Attractors(rkey);
        var (pairs, landlocked) = RootPairs(rkey);
        int A = axs.Count;
        double[] ax = axs.ToArray();
        double[] ay = ays.ToArray();
        int[] reachedBy = new int[A];
        Array.Fill(reachedBy, -1);
        byte[] alive = new byte[A];
        Array.Fill(alive, (byte)1);
        int[] near = new int[A];
        Array.Fill(near, -1);
        double[] nearD2 = new double[A];
        Array.Fill(nearD2, double.PositiveInfinity);
        int aliveCount = A;

        // attractor grid with cell size dᵢ
        double G = P.Influence;
        var grid = new Dictionary<long, List<int>>();
        for (int a = 0; a < A; a++)
        {
            long k = GridKey((int)Math.Floor(ax[a] / G), (int)Math.Floor(ay[a] / G));
            if (grid.TryGetValue(k, out var list)) list.Add(a);
            else grid[k] = [a];
        }

        int cap = 1024;
        double[] nx = new double[cap];
        double[] ny = new double[cap];
        int[] par = new int[cap];
        int[] own = new int[cap];
        // 1 = the node may not grow any more (its pulls lead out of the region)
        byte[] dead = new byte[cap];
        // unit heading (parent → node; 0,0 for roots), wander direction, first child (−1 = none)
        double[] hx = new double[cap];
        double[] hy = new double[cap];
        double[] wvx = new double[cap];
        double[] wvy = new double[cap];
        int[] firstChild = new int[cap];
        Array.Fill(firstChild, -1);
        int n = 0;
        // main-stem dominance: a suppressed side branch's attractors within this distance drain into the stem
        double absorb2 = DMath.Sq(P.Kill + 2 * P.Step);
        double cc = ConeCos(P.Cone);
        double cc2 = cc * cc;
        // Perception cone: may attractor a (at squared distance d2) pull node k? Compared
        // squared (dot ≥ 0 and dot² ≥ cos²·d²) since every half-angle here is ≤ 90°.
        bool Sees(int k, int a, double d2)
        {
            if (cc < 0 || (hx[k] == 0 && hy[k] == 0) || d2 == 0) return true;
            double dot = (ax[a] - nx[k]) * hx[k] + (ay[a] - ny[k]) * hy[k];
            return dot >= 0 && dot * dot >= cc2 * d2;
        }
        double di2 = P.Influence * P.Influence;
        double dk2 = P.Kill * P.Kill;
        // node grid with cell size dᵢ (to re-find an attractor's nearest node when one dies)
        var nodeGrid = new Dictionary<long, List<int>>();

        // Rivers stay in their region: a node may lie over any ocean (the stretch from a root
        // to the coast) or on the region's own land, never on another region's land. A
        // landlocked region has to cross its neighbours to reach the sea, so it is exempt.
        bool Inside(double x, double y)
        {
            if (landlocked) return true;
            CellInfo c = w.CellAt(x, y, true);
            return c.Ocean || c.Region == rkey;
        }
        // a segment from node k to (x, y): its end and midpoint must be inside
        bool SegInside(int k, double x, double y) => Inside(x, y) && Inside((nx[k] + x) * 0.5, (ny[k] + y) * 0.5);

        int AddNode(double x, double y, int parent)
        {
            if (n == cap)
            {
                cap *= 2;
                Array.Resize(ref nx, cap);
                Array.Resize(ref ny, cap);
                Array.Resize(ref par, cap);
                Array.Resize(ref own, cap);
                Array.Resize(ref dead, cap);
                Array.Resize(ref hx, cap);
                Array.Resize(ref hy, cap);
                Array.Resize(ref wvx, cap);
                Array.Resize(ref wvy, cap);
                Array.Resize(ref firstChild, cap);
            }
            int id = n++;
            nx[id] = x;
            ny[id] = y;
            par[id] = parent;
            own[id] = 0;
            dead[id] = 0;
            firstChild[id] = -1;
            wvx[id] = 0;
            wvy[id] = 0;
            hx[id] = 0;
            hy[id] = 0;
            if (parent >= 0)
            {
                double ex = x - nx[parent];
                double ey = y - ny[parent];
                double el = Math.Sqrt(ex * ex + ey * ey);
                if (el > 1e-9)
                {
                    hx[id] = ex / el;
                    hy[id] = ey / el;
                }
                if (firstChild[parent] < 0) firstChild[parent] = id;
            }
            int ci = (int)Math.Floor(x / G);
            int cj = (int)Math.Floor(y / G);
            long nk = GridKey(ci, cj);
            if (nodeGrid.TryGetValue(nk, out var nl)) nl.Add(id);
            else nodeGrid[nk] = [id];
            // reach attractors within dₖ, and update the nearest node of those within dᵢ
            for (int dj = -1; dj <= 1; dj++)
            {
                for (int di = -1; di <= 1; di++)
                {
                    if (!grid.TryGetValue(GridKey(ci + di, cj + dj), out var list)) continue;
                    foreach (int a in list)
                    {
                        if (alive[a] == 0) continue;
                        double dx = ax[a] - x;
                        double dy = ay[a] - y;
                        double d2 = dx * dx + dy * dy;
                        if (d2 <= dk2)
                        {
                            alive[a] = 0;
                            reachedBy[a] = id;
                            own[id]++;
                            aliveCount--;
                        }
                        else if ((d2 < nearD2[a] || (d2 == nearD2[a] && id < near[a])) && Sees(id, a, d2))
                        {
                            nearD2[a] = d2;
                            near[a] = id;
                        }
                    }
                }
            }
            return id;
        }

        // attractor → nodes it may not pull, because the straight line between them leaves the region
        var banned = new Dictionary<int, HashSet<int>>();
        bool IsBanned(int a, int k) => banned.TryGetValue(a, out var s) && s.Contains(k);
        // Does the straight line from node k to (x, y) stay inside (sampled every D/2)?
        bool Visible(int k, double x, double y)
        {
            double d = Math.Sqrt(DMath.Sq(x - nx[k]) + DMath.Sq(y - ny[k]));
            if (d < 1e-9) return true;
            double ux = (x - nx[k]) / d;
            double uy = (y - ny[k]) / d;
            double h = P.Step * 0.5;
            int m = (int)Math.Ceiling(d / h);
            for (int s = 1; s < m; s++)
                if (!Inside(nx[k] + ux * h * s, ny[k] + uy * h * s))
                    return false;
            return Inside(x, y);
        }
        void AddBan(int a, int k)
        {
            if (!banned.TryGetValue(a, out var s)) banned[a] = s = [];
            s.Add(k);
        }
        // Re-find an attractor's nearest live node within dᵢ that it can reach in a straight
        // line inside the region (none → −1). Nodes it cannot reach are banned on the way, so
        // a node that merely sits in open water cannot keep collecting pulls it can never follow.
        var refindCands = new List<(int M, double D2)>();
        void Refind(int a)
        {
            refindCands.Clear();
            int ci = (int)Math.Floor(ax[a] / G);
            int cj = (int)Math.Floor(ay[a] / G);
            for (int dj = -1; dj <= 1; dj++)
            {
                for (int di = -1; di <= 1; di++)
                {
                    if (!nodeGrid.TryGetValue(GridKey(ci + di, cj + dj), out var list)) continue;
                    foreach (int m in list)
                    {
                        if (dead[m] != 0 || IsBanned(a, m)) continue;
                        double d2 = DMath.Sq(ax[a] - nx[m]) + DMath.Sq(ay[a] - ny[m]);
                        if (Sees(m, a, d2)) refindCands.Add((m, d2));
                    }
                }
            }
            refindCands.Sort(static (p, q) => p.D2 < q.D2 ? -1 : p.D2 > q.D2 ? 1 : p.M.CompareTo(q.M));
            near[a] = -1;
            nearD2[a] = double.PositiveInfinity;
            // a copy: Visible/AddBan never re-enter Refind, but keep the loop independent of the shared list
            foreach (var c in refindCands.ToArray())
            {
                if (c.D2 >= di2) break;
                if (Visible(c.M, ax[a], ay[a]))
                {
                    near[a] = c.M;
                    nearD2[a] = c.D2;
                    return;
                }
                AddBan(a, c.M);
            }
        }
        void Ban(int a, int k)
        {
            AddBan(a, k);
            if (near[a] == k) Refind(a);
        }
        // Stop node k growing, and hand its attractors to other nodes.
        void Kill(int k)
        {
            dead[k] = 1;
            for (int a = 0; a < A; a++)
                if (alive[a] != 0 && near[a] == k)
                    Refind(a);
        }

        var roots = new List<int>();
        var rootOcean = new List<long>();
        if (A > 0)
        {
            foreach (var pr in pairs)
            {
                ZoneNode o = w.ElevationZone(pr.Ocean);
                double px = o.X;
                double py = o.Y;
                if (!w.CellAt(px, py, true).Ocean)
                {
                    // coasts follow patch cells, so the elevation zone's site can fall on a sliver
                    // of land: use the closest ocean patch site of the elevation zone instead
                    double bd = double.PositiveInfinity;
                    foreach (long s in w.ElevationZonePatches(o))
                    {
                        PatchNode sd = w.Patch(s);
                        double d2 = DMath.Sq(sd.X - o.X) + DMath.Sq(sd.Y - o.Y);
                        if (d2 < bd && w.CellAt(sd.X, sd.Y, true).Ocean)
                        {
                            bd = d2;
                            px = sd.X;
                            py = sd.Y;
                        }
                    }
                    if (double.IsPositiveInfinity(bd)) continue;
                }
                roots.Add(AddNode(px, py, -1));
                rootOcean.Add(pr.Ocean);
            }
        }

        RegionNode reg = w.Region(rkey);
        var rng = new Sfc32(Hash.Hash4(w.SeedInt, StGrow, reg.I, reg.J));
        double[] sx = new double[cap];
        double[] sy = new double[cap];
        int[] stamp = new int[cap];
        // closest pulling attractor per node this iteration, and each node's last child
        int[] closeA = new int[cap];
        double[] closeD = new double[cap];
        int[] lastChild = new int[cap];
        Array.Fill(lastChild, -1);
        // children grown per node
        int[] kids = new int[cap];
        // attractors pulling each node this iteration, and (main-stem dominance) pulls summed over a node's subtree
        int[] cnt = new int[cap];
        int[] patch = new int[cap];
        int[] patchStamp = new int[cap];
        int iterations = 0;
        int bridges = 0;
        int blockedPasses = 0;
        var touched = new List<int>();
        var cand = new List<(int A, int K, double D2)>();
        var mine = new List<int>();

        while (aliveCount > 0 && roots.Count > 0 && iterations < MaxIter && n < MaxNodes)
        {
            iterations++;
            if (sx.Length < cap)
            {
                sx = new double[cap];
                sy = new double[cap];
                stamp = new int[cap];
                closeA = new int[cap];
                closeD = new double[cap];
                int[] lc = new int[cap];
                Array.Fill(lc, -1);
                Array.Copy(lastChild, lc, lastChild.Length);
                lastChild = lc;
                Array.Resize(ref kids, cap);
                cnt = new int[cap];
                patch = new int[cap];
                patchStamp = new int[cap];
            }
            touched.Clear();
            for (int a = 0; a < A; a++)
            {
                if (alive[a] == 0 || nearD2[a] >= di2) continue;
                int k = near[a];
                double d = Math.Sqrt(nearD2[a]);
                if (stamp[k] != iterations)
                {
                    stamp[k] = iterations;
                    touched.Add(k);
                    closeA[k] = a;
                    closeD[k] = nearD2[a];
                    cnt[k] = 1;
                }
                else
                {
                    cnt[k]++;
                    if (nearD2[a] < closeD[k])
                    {
                        closeA[k] = a;
                        closeD[k] = nearD2[a];
                    }
                }
                double wgt = PullWeight(P.Pull, nearD2[a], di2) / d;
                sx[k] += (ax[a] - nx[k]) * wgt;
                sy[k] += (ay[a] - ny[k]) * wgt;
            }
            if (touched.Count == 0)
            {
                // nothing within dᵢ: bridge the closest node–attractor pair with a straight run
                int ba = -1;
                int bn = -1;
                double bd = double.PositiveInfinity;
                // every attractor's closest live node, tried closest pair first; a pair whose
                // straight run would leave the region is skipped
                cand.Clear();
                for (int a = 0; a < A; a++)
                {
                    if (alive[a] == 0) continue;
                    int ck = -1;
                    double cd = double.PositiveInfinity;
                    banned.TryGetValue(a, out var bans);
                    if ((bans?.Count ?? 0) >= MaxBans) continue;
                    for (int k = 0; k < n; k++)
                    {
                        if (dead[k] != 0 || (bans != null && bans.Contains(k))) continue;
                        double dx = ax[a] - nx[k];
                        double dy = ay[a] - ny[k];
                        double d2 = dx * dx + dy * dy;
                        if (d2 < cd)
                        {
                            cd = d2;
                            ck = k;
                        }
                    }
                    if (ck >= 0) cand.Add((a, ck, cd));
                }
                cand.Sort(static (p, q) => p.D2 < q.D2 ? -1 : p.D2 > q.D2 ? 1 : p.A.CompareTo(q.A));
                int newBans = 0;
                foreach (var c in cand)
                {
                    if (Visible(c.K, ax[c.A], ay[c.A]))
                    {
                        ba = c.A;
                        bn = c.K;
                        bd = c.D2;
                        break;
                    }
                    Ban(c.A, c.K);
                    newBans++;
                }
                if (ba < 0)
                {
                    // every closest pair leaves the region; the bans may expose other pairs
                    if (newBans > 0 && ++blockedPasses < MaxBlockedPasses) continue;
                    break;
                }
                bridges++;
                double bdist = Math.Sqrt(bd);
                double bux = (ax[ba] - nx[bn]) / bdist;
                double buy = (ay[ba] - ny[bn]) / bdist;
                int steps = Math.Max(1, (int)Math.Ceiling((bdist - P.Influence * 0.5) / P.Step));
                int prev = bn;
                double bx0 = nx[bn];
                double by0 = ny[bn];
                for (int s = 1; s <= steps && alive[ba] != 0; s++) prev = AddNode(bx0 + bux * P.Step * s, by0 + buy * P.Step * s, prev);
                continue;
            }
            touched.Sort();
            if (P.Apical > 0)
            {
                // pulls on each subtree (within ApicalDepth nodes downstream of the puller)
                foreach (int k in touched)
                {
                    int m = k;
                    for (int d = 0; d < ApicalDepth && m >= 0; d++, m = par[m])
                    {
                        if (patchStamp[m] != iterations)
                        {
                            patchStamp[m] = iterations;
                            patch[m] = 0;
                        }
                        patch[m] += cnt[k];
                    }
                }
            }
            // AddNode may grow the node arrays (never the per-iteration ones: they are sized to
            // `cap` at the top of the loop, and a node added now is not in `touched`)
            foreach (int k in touched)
            {
                double dx = sx[k];
                double dy = sy[k];
                sx[k] = 0;
                sy[k] = 0;
                if (P.Apical > 0 && kids[k] > 0)
                {
                    // a side branch must be pulled by ≥ apical × what pulls on the main stem's
                    // subtree. A weaker one is not grown: its attractors close to the stem drain
                    // straight into it (flow without a visible channel), the farther ones turn to
                    // other nodes.
                    int mc = firstChild[k];
                    int main = mc >= 0 && patchStamp[mc] == iterations ? patch[mc] : 0;
                    if (cnt[k] < P.Apical * main)
                    {
                        // only attractors within dᵢ pull k: they are in the 3×3 grid cells around it
                        int ci = (int)Math.Floor(nx[k] / G);
                        int cj = (int)Math.Floor(ny[k] / G);
                        mine.Clear();
                        for (int gj = -1; gj <= 1; gj++)
                        {
                            for (int gi = -1; gi <= 1; gi++)
                            {
                                if (!grid.TryGetValue(GridKey(ci + gi, cj + gj), out var list)) continue;
                                foreach (int a in list)
                                    if (alive[a] != 0 && near[a] == k && nearD2[a] < di2)
                                        mine.Add(a);
                            }
                        }
                        mine.Sort();
                        foreach (int a in mine)
                        {
                            if (nearD2[a] <= absorb2)
                            {
                                alive[a] = 0;
                                reachedBy[a] = k;
                                own[k]++;
                                aliveCount--;
                            }
                        }
                        continue;
                    }
                }
                double len = Math.Sqrt(dx * dx + dy * dy);
                if (len < 1e-9)
                {
                    // opposing pulls cancel: head for the closest one
                    int a = closeA[k];
                    dx = ax[a] - nx[k];
                    dy = ay[a] - ny[k];
                    len = Math.Sqrt(dx * dx + dy * dy);
                }
                dx /= len;
                dy /= len;
                if (P.Inertia > 0 && (hx[k] != 0 || hy[k] != 0))
                {
                    // keep going the way the river already runs
                    double ix = dx + P.Inertia * hx[k];
                    double iy = dy + P.Inertia * hy[k];
                    double il = Math.Sqrt(ix * ix + iy * iy);
                    if (il > 1e-9)
                    {
                        dx = ix / il;
                        dy = iy / il;
                    }
                }
                // random motion: fresh each step, or (wander) inherited from the node and nudged
                double jx = 0;
                double jy = 0;
                if (P.Jitter > 0)
                {
                    DiscVec(rng, out double rv0, out double rv1);
                    jx = rv0;
                    jy = rv1;
                    if (P.Wander > 0)
                    {
                        double vx = P.Wander * wvx[k] + (1 - P.Wander) * rv0;
                        double vy = P.Wander * wvy[k] + (1 - P.Wander) * rv1;
                        double vl = Math.Sqrt(vx * vx + vy * vy);
                        if (vl > 1e-9)
                        {
                            jx = vx / vl;
                            jy = vy / vl;
                        }
                    }
                    dx += P.Jitter * jx;
                    dy += P.Jitter * jy;
                    len = Math.Sqrt(dx * dx + dy * dy);
                    if (len < 1e-9) continue;
                    dx /= len;
                    dy /= len;
                }
                double tx = nx[k] + dx * P.Step;
                double ty = ny[k] + dy * P.Step;
                int lc = lastChild[k];
                if (lc >= 0 && DMath.Sq(nx[lc] - tx) + DMath.Sq(ny[lc] - ty) < DMath.Sq(0.05 * P.Step))
                {
                    // the same pulls again (a stall: the last child won over none of them):
                    // step straight towards the closest pulling attractor instead
                    int a = closeA[k];
                    double d = Math.Sqrt(closeD[k]);
                    tx = nx[k] + ((ax[a] - nx[k]) / d) * P.Step;
                    ty = ny[k] + ((ay[a] - ny[k]) / d) * P.Step;
                }
                if (!SegInside(k, tx, ty))
                {
                    // the step would leave the region. Attractors that k cannot reach in a
                    // straight line stop pulling on it (they turn to other nodes); k regrows
                    // from the remaining pulls next iteration.
                    bool dropped = false;
                    for (int a = 0; a < A; a++)
                    {
                        if (alive[a] != 0 && near[a] == k && !Visible(k, ax[a], ay[a]))
                        {
                            Ban(a, k);
                            dropped = true;
                        }
                    }
                    if (dropped) continue;
                    // every pull is reachable but their mean is not: head straight for the closest
                    int ca = closeA[k];
                    double cd = Math.Sqrt(closeD[k]);
                    tx = nx[k] + ((ax[ca] - nx[k]) / cd) * P.Step;
                    ty = ny[k] + ((ay[ca] - ny[k]) / cd) * P.Step;
                    if (!SegInside(k, tx, ty))
                    {
                        Kill(k);
                        continue;
                    }
                }
                if (++kids[k] > MaxChildren)
                {
                    // safety net: a node that keeps sprouting is stuck against the border
                    Kill(k);
                    continue;
                }
                int child = AddNode(tx, ty, k);
                lastChild[k] = child;
                wvx[child] = jx;
                wvy[child] = jy;
            }
        }

        // flow: attractors reached at the node and everything upstream of it
        int[] flow = own[..n];
        for (int k = n - 1; k >= 0; k--)
            if (par[k] >= 0)
                flow[par[k]] += flow[k];
        byte[] wet = new byte[n];
        for (int k = 0; k < n; k++) wet[k] = (byte)(w.CellAt(nx[k], ny[k], true).Ocean ? 1 : 0);
        int[] tree = new int[n];
        for (int k = 0; k < n; k++) tree[k] = par[k] < 0 ? k : tree[par[k]];
        double x0 = double.PositiveInfinity;
        double y0 = double.PositiveInfinity;
        double x1 = double.NegativeInfinity;
        double y1 = double.NegativeInfinity;
        for (int k = 0; k < n; k++)
        {
            if (nx[k] < x0) x0 = nx[k];
            if (nx[k] > x1) x1 = nx[k];
            if (ny[k] < y0) y0 = ny[k];
            if (ny[k] > y1) y1 = ny[k];
        }
        for (int a = 0; a < A; a++)
        {
            if (ax[a] < x0) x0 = ax[a];
            if (ax[a] > x1) x1 = ax[a];
            if (ay[a] < y0) y0 = ay[a];
            if (ay[a] > y1) y1 = ay[a];
        }
        return new RegionRivers
        {
            Region = rkey,
            N = n,
            X = nx[..n],
            Y = ny[..n],
            Parent = par[..n],
            Own = own[..n],
            Flow = flow,
            Tree = tree,
            Wet = wet,
            Roots = roots.ToArray(),
            RootOcean = rootOcean.ToArray(),
            Ax = ax,
            Ay = ay,
            ReachedBy = reachedBy,
            Reached = A - aliveCount,
            Iterations = iterations,
            Bridges = bridges,
            Landlocked = landlocked,
            X0 = x0,
            Y0 = y0,
            X1 = x1,
            Y1 = y1,
            Ms = sw.Elapsed.TotalMilliseconds,
        };
    }

    /// <summary>Nearest river node to a point among the regions around it.</summary>
    public (RegionRivers R, int K, double D)? NearestNode(double x, double y, double maxDist, bool computeMissing = false)
    {
        World w = World;
        long rk = w.RegionAt(x, y);
        int ri = CellKeys.I(rk);
        int rj = CellKeys.J(rk);
        (RegionRivers R, int K, double D)? best = null;
        for (int dj = -1; dj <= 1; dj++)
        {
            for (int di = -1; di <= 1; di++)
            {
                long key = CellKeys.Pack(ri + di, rj + dj);
                RegionRivers? r = computeMissing ? Get(key) : Peek(key);
                if (r == null || x < r.X0 - maxDist || x > r.X1 + maxDist || y < r.Y0 - maxDist || y > r.Y1 + maxDist) continue;
                for (int k = 0; k < r.N; k++)
                {
                    double d = Math.Sqrt(DMath.Sq(r.X[k] - x) + DMath.Sq(r.Y[k] - y));
                    if (d <= maxDist && (best == null || d < best.Value.D)) best = (r, k, d);
                }
            }
        }
        return best;
    }
}
