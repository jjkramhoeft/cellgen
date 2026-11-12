using System.Collections.Concurrent;
using Sandbox5.Domain.Numerics;

namespace Sandbox5.Domain.Generation;

public enum GrowFrom
{
    /// <summary>Only ocean zones on a link between two seeds grow.</summary>
    Connected,
    /// <summary>Every ocean zone grows, lone seeds included.</summary>
    All,
}

/// <summary>Model parameters of the three-level base map. Sizes are in metres.</summary>
public sealed record WorldParams
{
    public required uint Seed { get; init; }
    // regions
    public required double RegionSize { get; init; }
    public required double RegionJitter { get; init; }
    public required int OceanMin { get; init; }
    public required int OceanMax { get; init; }
    public required int ElevationZoneMergeMin { get; init; }
    public required int ElevationZoneMergeMax { get; init; }
    // oceans
    public required double ConnectChance { get; init; }
    /// <summary>Chance that a seed links to its two nearest seeds instead (overrides ConnectChance).</summary>
    public required double DoubleLinkChance { get; init; }
    public required int ConnectRange { get; init; }
    /// <summary>Relative weights of converting 0, 1, 2, 3 neighbours.</summary>
    public required double[] GrowWeights { get; init; }
    public required GrowFrom GrowFrom { get; init; }
    public required int GrowPasses { get; init; }
    // elevation zones
    public required double ElevationZoneSize { get; init; }
    public required double ElevationZoneJitter { get; init; }
    public required double ElevationZoneWarp { get; init; }
    public required double ElevationZoneWarpFreq { get; init; }
    public required bool MergeAcrossCoast { get; init; }
    public required int PatchMergeMin { get; init; }
    public required int PatchMergeMax { get; init; }
    // patches
    public required double PatchSize { get; init; }
    public required double PatchJitter { get; init; }
    public required double PatchWarp { get; init; }
    public required double PatchWarpFreq { get; init; }
    public required bool Nest { get; init; }
}

/// <summary>Ocean genesis of an elevation zone. Growth pass p is <c>Grow + p − 1</c>.</summary>
public static class Origin
{
    public const int Land = 0;
    public const int LoneSeed = 1;
    public const int LinkedSeed = 2;
    public const int Chain = 3;
    public const int Grow = 4;
}

/// <summary>A link between two ocean seeds and the elevation zones on the straight line between them.</summary>
public sealed record SeedLink(long From, long To, long[] Chain);

/// <summary>A region lattice cell: the large cells.</summary>
public sealed class RegionNode
{
    public required long Key { get; init; }
    public required int I { get; init; }
    public required int J { get; init; }
    public required double X { get; init; }
    public required double Y { get; init; }
    /// <summary>Owned elevation zone keys (sites inside this region), lattice order.</summary>
    public required long[] ElevationZones { get; init; }
    public required long[] Seeds { get; init; }
    public required HashSet<long> Merges { get; init; }
    /// <summary>Seed links that start in this region (null until sourced).</summary>
    internal volatile SeedLink[]? Links;
}

/// <summary>A raw elevation zone lattice cell: the medium cells.</summary>
public sealed class ZoneNode
{
    internal const long Unresolved = long.MinValue;

    public required long Key { get; init; }
    public required int I { get; init; }
    public required int J { get; init; }
    public required double X { get; init; }
    public required double Y { get; init; }
    /// <summary>Owning region: the region containing the site.</summary>
    public required long Region { get; init; }

    internal volatile long[]? Nbrs;
    /// <summary>Ocean state after pass p: −1 unknown, 0 land, 1 ocean.</summary>
    internal sbyte[] OceanP = [];
    internal long[]?[] Picks = [];
    /// <summary>Unresolved, or −1 = not merged.</summary>
    internal long Target = Unresolved;
    internal long Root = Unresolved;
    internal volatile long[]? Patches;
    internal volatile HashSet<long>? PatchMerges;
}

/// <summary>A raw patch lattice cell: the small cells.</summary>
public sealed class PatchNode
{
    public required long Key { get; init; }
    public required int I { get; init; }
    public required int J { get; init; }
    public required double X { get; init; }
    public required double Y { get; init; }
    /// <summary>Owning raw elevation zone: the elevation zone containing the site.</summary>
    public required long ElevationZone { get; init; }

    internal volatile long[]? Nbrs;
    internal long Target = ZoneNode.Unresolved;
    internal long Root = ZoneNode.Unresolved;
}

/// <summary>Everything about one map location: which cells it resolves to after merging.</summary>
public sealed record CellInfo
{
    /// <summary>Patch (raw and merged root); −1 when resolved at elevation zone level only.</summary>
    public required long PatchRaw { get; init; }
    public required long Patch { get; init; }
    public required long ElevationZoneRaw { get; init; }
    public required long ElevationZone { get; init; }
    public required long Region { get; init; }
    public required bool Ocean { get; init; }
    /// <summary>Ocean genesis, see <see cref="Generation.Origin"/>.</summary>
    public required int Origin { get; init; }
    /// <summary>Member of a merged group.</summary>
    public required bool PatchMerged { get; init; }
    public required bool ElevationZoneMerged { get; init; }
}

/// <summary>
/// The three-level map hierarchy as a pure function of (seed, parameters): a port of
/// Sandbox 4's world/world.ts (spec: sandbox3.md).
///
///   Regions           128 km lattice Voronoi, no warp. Each region owns the elevation zones
///                     whose site lies inside it, and picks among them 0–2 ocean seeds and
///                     2–4 elevation zone mergers.
///   Elevation zones    32 km lattice Voronoi. Each owns the patches whose site lies inside
///                     it, and picks 2–4 patch mergers.
///   Patches           8 km lattice Voronoi with border warp.
///
/// Oceans: seeds per region → links between near seeds (every zone on the straight line
/// turns into ocean) → growth into the closest land neighbours. Merges: a chosen cell joins
/// its nearest Gabriel neighbour; chains merge into one cell and a cycle resolves to the
/// smallest key. Nesting: every point is classified through its patch, so the borders of all
/// three levels line up.
///
/// Everything is evaluated lazily and memoised, and every value only depends on a bounded
/// neighbourhood, so the result is independent of the order in which the map is explored.
/// The class is thread-safe: memoised values are pure, so concurrent callers may compute
/// the same value twice but never a different one; the ocean registry is built under a lock.
/// </summary>
public sealed class World
{
    /// <summary>Base ocean flags (OR-merged from every region's sources).</summary>
    public const int SeedFlag = 1;
    public const int LinkedFlag = 2;

    private const int StSeeds = 0x5e01;
    private const int StMerge = 0x5e02;
    private const int StLink = 0x5e03;
    private const int StDlink = 0x5e05;
    private const int StGrow = 0x5e10;
    private const int StPatchMerge = 0x5e04;

    public WorldParams P { get; }
    public Level RegionLevel { get; }
    public Level ElevationZoneLevel { get; }
    public Level PatchLevel { get; }
    /// <summary>The seed as the signed 32-bit integer the hashes take.</summary>
    public int SeedInt { get; }

    /// <summary>Cumulative normalised growth weights.</summary>
    private readonly double[] _growCdf;

    private readonly ConcurrentDictionary<long, RegionNode> _regions = new();
    private readonly ConcurrentDictionary<long, ZoneNode> _zones = new();
    private readonly ConcurrentDictionary<long, PatchNode> _patches = new();
    private readonly ConcurrentDictionary<long, CellInfo> _patchCells = new();
    private readonly ConcurrentDictionary<long, CellInfo> _zoneCells = new();
    /// <summary>Base ocean flags per elevation zone key, OR-merged by region sourcing (written under the lock).</summary>
    private readonly ConcurrentDictionary<long, int> _base = new();
    private readonly HashSet<long> _sourced = [];
    /// <summary>Regions whose whole sourcing neighbourhood is done.</summary>
    private readonly ConcurrentDictionary<long, bool> _settled = new();
    private readonly object _sourceLock = new();

    public World(WorldParams p)
    {
        P = p;
        int s = unchecked((int)p.Seed);
        SeedInt = s;
        RegionLevel = new Level(new LevelOptions(s ^ 0x1b873593, p.RegionSize, p.RegionJitter, 0, 1));
        ElevationZoneLevel = new Level(new LevelOptions(s ^ 0x7f4a7c15, p.ElevationZoneSize, p.ElevationZoneJitter, p.ElevationZoneWarp, p.ElevationZoneWarpFreq));
        PatchLevel = new Level(new LevelOptions(s ^ 0x6c8e9cf5, p.PatchSize, p.PatchJitter, p.PatchWarp, p.PatchWarpFreq));
        double[] w = p.GrowWeights.Select(x => Math.Max(0, x)).ToArray();
        double sum = w.Sum();
        if (sum == 0) sum = 1;
        double acc = 0;
        _growCdf = w.Select(x => acc += x / sum).ToArray();
    }

    /// <summary>Number of memoised objects (for a cache budget).</summary>
    public int CacheSize => _regions.Count + _zones.Count + _patches.Count + _patchCells.Count + _zoneCells.Count;

    /// <summary>Pick k distinct items (partial Fisher–Yates on a copy).</summary>
    private static long[] Pick(long[] items, int k, Sfc32 rng)
    {
        long[] a = (long[])items.Clone();
        int n = Math.Min(k, a.Length);
        for (int t = 0; t < n; t++)
        {
            int r = t + (int)Math.Floor(rng.Next() * (a.Length - t));
            (a[t], a[r]) = (a[r], a[t]);
        }
        return a[..n];
    }

    /// <summary>Uniform integer in [lo, hi] (bounds may come in either order).</summary>
    private static int Between(int lo, int hi, double u)
    {
        int a = Math.Min(lo, hi);
        int b = Math.Max(lo, hi);
        return a + Math.Min(b - a, (int)Math.Floor(u * (b - a + 1)));
    }

    // ------------------------------------------------------------------ regions

    public RegionNode Region(long key) => _regions.TryGetValue(key, out var r) ? r : _regions.GetOrAdd(key, CreateRegion);

    private RegionNode CreateRegion(long key)
    {
        int i = CellKeys.I(key);
        int j = CellKeys.J(key);
        Level level = RegionLevel;
        // owned elevation zones: candidates from the elevation zone lattice cells covering the
        // region's lattice neighbourhood, kept when the region under their site is this one
        double b = ElevationZoneLevel.Size;
        double rs = level.Size;
        int bi0 = (int)Math.Floor(((i - 1) * rs) / b);
        int bi1 = (int)Math.Floor(((i + 2) * rs) / b);
        int bj0 = (int)Math.Floor(((j - 1) * rs) / b);
        int bj1 = (int)Math.Floor(((j + 2) * rs) / b);
        var zones = new List<long>();
        for (int bj = bj0; bj <= bj1; bj++)
        {
            for (int bi = bi0; bi <= bi1; bi++)
            {
                ZoneNode z = ElevationZone(CellKeys.Pack(bi, bj));
                if (z.Region == key) zones.Add(z.Key);
            }
        }
        long[] owned = zones.ToArray();
        var rng = new Sfc32(Hash.Hash4(SeedInt, StSeeds, i, j));
        int nSeeds = Between(P.OceanMin, P.OceanMax, rng.Next());
        long[] seeds = Pick(owned, nSeeds, rng);
        var rngM = new Sfc32(Hash.Hash4(SeedInt, StMerge, i, j));
        int nMerge = Between(P.ElevationZoneMergeMin, P.ElevationZoneMergeMax, rngM.Next());
        var merges = new HashSet<long>(Pick(owned, nMerge, rngM));
        return new RegionNode { Key = key, I = i, J = j, X = level.SiteX(i, j), Y = level.SiteY(i, j), ElevationZones = owned, Seeds = seeds, Merges = merges };
    }

    public long RegionAt(double x, double y) => RegionLevel.Query(x, y);

    /// <summary>
    /// Register this region's ocean sources: its seeds, and for every seed that links, the
    /// chain of elevation zones to its nearest other seed (or two nearest). Call under the lock.
    /// </summary>
    private void Source(long rkey)
    {
        if (_sourced.Contains(rkey)) return;
        RegionNode r = Region(rkey);
        var links = new List<SeedLink>();
        foreach (long s in r.Seeds)
        {
            Flag(s, SeedFlag);
            ZoneNode sb = ElevationZone(s);
            int n = LinkCount(sb);
            if (n == 0) continue;
            // the n nearest other seeds within ConnectRange regions (by site distance, ties by key)
            var cands = new List<(long Key, double D)>();
            int range = P.ConnectRange;
            for (int dj = -range; dj <= range; dj++)
            {
                for (int di = -range; di <= range; di++)
                {
                    RegionNode o = Region(CellKeys.Pack(r.I + di, r.J + dj));
                    foreach (long t in o.Seeds)
                    {
                        if (t == s) continue;
                        ZoneNode tb = ElevationZone(t);
                        cands.Add((t, (tb.X - sb.X) * (tb.X - sb.X) + (tb.Y - sb.Y) * (tb.Y - sb.Y)));
                    }
                }
            }
            cands.Sort(static (a, b) => a.D < b.D ? -1 : a.D > b.D ? 1 : a.Key.CompareTo(b.Key));
            for (int c = 0; c < n && c < cands.Count; c++)
            {
                long to = cands[c].Key;
                long[] chain = Trace(sb, ElevationZone(to));
                foreach (long link in chain) Flag(link, LinkedFlag);
                links.Add(new SeedLink(s, to, chain));
            }
        }
        r.Links = links.ToArray();
        _sourced.Add(rkey);
    }

    /// <summary>
    /// How many links a seed makes: 2 (its two nearest seeds) with DoubleLinkChance, otherwise
    /// 1 with ConnectChance, otherwise 0. The two draws use independent hash streams.
    /// </summary>
    public int LinkCount(ZoneNode sb)
    {
        if (Hash.ToUnit(Hash.Hash4(SeedInt, StDlink, sb.I, sb.J)) < P.DoubleLinkChance) return 2;
        return Hash.ToUnit(Hash.Hash4(SeedInt, StLink, sb.I, sb.J)) < P.ConnectChance ? 1 : 0;
    }

    private void Flag(long zkey, int f) => _base.AddOrUpdate(zkey, f, (_, old) => old | f);

    /// <summary>Elevation zones crossed by the straight segment between two elevation zone sites (both ends included).</summary>
    public long[] Trace(ZoneNode a, ZoneNode b)
    {
        var result = new List<long> { a.Key };
        var seen = new HashSet<long> { a.Key };
        double len = DMath.Hypot(b.X - a.X, b.Y - a.Y);
        int n = Math.Max(1, (int)Math.Ceiling(len / (ElevationZoneLevel.Size * 0.12)));
        for (int k = 1; k < n; k++)
        {
            double t = (double)k / n;
            long key = ElevationZoneLevel.Query(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t);
            if (seen.Add(key)) result.Add(key);
        }
        if (!seen.Contains(b.Key)) result.Add(b.Key);
        return result.ToArray();
    }

    /// <summary>Radius (in region lattice cells) of the regions whose sources can reach an elevation zone.</summary>
    public int SourceRadius => P.ConnectRange + 5;

    /// <summary>Base ocean flags of a raw elevation zone (seed / linked), complete.</summary>
    public int BaseFlags(long zkey)
    {
        ZoneNode b = ElevationZone(zkey);
        if (!_settled.ContainsKey(b.Region))
        {
            lock (_sourceLock)
            {
                if (!_settled.ContainsKey(b.Region))
                {
                    int ri = CellKeys.I(b.Region);
                    int rj = CellKeys.J(b.Region);
                    int radius = SourceRadius;
                    for (int dj = -radius; dj <= radius; dj++)
                        for (int di = -radius; di <= radius; di++)
                            Source(CellKeys.Pack(ri + di, rj + dj));
                    _settled[b.Region] = true;
                }
            }
        }
        // once the region is settled, no later source can reach this zone: the flags are final
        return _base.TryGetValue(zkey, out int f) ? f : 0;
    }

    // ------------------------------------------------------------------ elevation zones

    public ZoneNode ElevationZone(long key) => _zones.TryGetValue(key, out var z) ? z : _zones.GetOrAdd(key, CreateZone);

    private ZoneNode CreateZone(long key)
    {
        int i = CellKeys.I(key);
        int j = CellKeys.J(key);
        Level level = ElevationZoneLevel;
        double x = level.SiteX(i, j);
        double y = level.SiteY(i, j);
        sbyte[] oceanP = new sbyte[P.GrowPasses + 1];
        Array.Fill(oceanP, (sbyte)-1);
        return new ZoneNode { Key = key, I = i, J = j, X = x, Y = y, Region = RegionLevel.Query(x, y), OceanP = oceanP, Picks = new long[]?[P.GrowPasses + 1] };
    }

    public long[] ElevationZoneNbrs(ZoneNode b) => b.Nbrs ??= ElevationZoneLevel.Neighbours(b.I, b.J).Select(n => n.Key).ToArray();

    /// <summary>Is the raw elevation zone ocean after growth pass p (0 = seeds and chains only)?</summary>
    public bool OceanAt(long key, int p)
    {
        ZoneNode b = ElevationZone(key);
        sbyte memo = b.OceanP[p];
        if (memo >= 0) return memo == 1;
        bool v;
        if (p == 0) v = BaseFlags(key) != 0;
        else if (OceanAt(key, p - 1)) v = true;
        else
        {
            v = false;
            foreach (long g in ElevationZoneNbrs(b))
            {
                if (IsGrower(g, p) && Array.IndexOf(GrowPicks(g, p), key) >= 0)
                {
                    v = true;
                    break;
                }
            }
        }
        b.OceanP[p] = (sbyte)(v ? 1 : 0);
        return v;
    }

    /// <summary>Growth edges out of elevation zone g: the elevation zones it converted, per pass.</summary>
    public List<(int Pass, long To)> GrowthFrom(long g)
    {
        var result = new List<(int, long)>();
        for (int p = 1; p <= P.GrowPasses; p++)
            if (IsGrower(g, p))
                foreach (long to in GrowPicks(g, p))
                    result.Add((p, to));
        return result;
    }

    /// <summary>Does elevation zone g grow in pass p?</summary>
    public bool IsGrower(long g, int p)
    {
        if (p == 1)
        {
            int f = BaseFlags(g);
            return P.GrowFrom == GrowFrom.All ? f != 0 : (f & LinkedFlag) != 0;
        }
        return OceanAt(g, p - 1) && !OceanAt(g, p - 2);
    }

    /// <summary>The land neighbours grower g converts in pass p (its n closest).</summary>
    public long[] GrowPicks(long g, int p)
    {
        ZoneNode b = ElevationZone(g);
        long[]? memo = Volatile.Read(ref b.Picks[p]);
        if (memo != null) return memo;
        double u = Hash.ToUnit(Hash.Hash4(SeedInt, StGrow + p, b.I, b.J));
        int n = 0;
        while (n < 3 && u >= _growCdf[n]) n++;
        var picks = new List<long>(n);
        if (n > 0)
        {
            foreach (long c in ElevationZoneNbrs(b))
            {
                if (picks.Count >= n) break;
                if (!OceanAt(c, p - 1)) picks.Add(c);
            }
        }
        long[] result = picks.ToArray();
        Volatile.Write(ref b.Picks[p], result);
        return result;
    }

    public bool Ocean(long key) => OceanAt(key, P.GrowPasses);

    /// <summary>Ocean genesis of a raw elevation zone (<see cref="Generation.Origin"/> code).</summary>
    public int OriginOf(long key)
    {
        if (!Ocean(key)) return Origin.Land;
        int f = BaseFlags(key);
        if ((f & SeedFlag) != 0) return (f & LinkedFlag) != 0 ? Origin.LinkedSeed : Origin.LoneSeed;
        if ((f & LinkedFlag) != 0) return Origin.Chain;
        for (int p = 1; p <= P.GrowPasses; p++)
            if (OceanAt(key, p))
                return Origin.Grow + p - 1;
        return Origin.Land;
    }

    /// <summary>The elevation zone a merged elevation zone joins, or −1.</summary>
    public long ElevationZoneTarget(long key)
    {
        ZoneNode b = ElevationZone(key);
        long memo = Volatile.Read(ref b.Target);
        if (memo != ZoneNode.Unresolved) return memo;
        long t = -1;
        if (Region(b.Region).Merges.Contains(key))
        {
            bool oc = Ocean(key);
            foreach (long c in ElevationZoneNbrs(b))
            {
                if (P.MergeAcrossCoast || Ocean(c) == oc)
                {
                    t = c;
                    break;
                }
            }
        }
        Volatile.Write(ref b.Target, t);
        return t;
    }

    public long ElevationZoneRoot(long key)
    {
        ZoneNode b = ElevationZone(key);
        long memo = Volatile.Read(ref b.Root);
        if (memo != ZoneNode.Unresolved) return memo;
        long root = ResolveRoot(key, ElevationZoneTarget);
        Volatile.Write(ref b.Root, root);
        return root;
    }

    /// <summary>Is the elevation zone part of a merged group (merged into another, or something merged into it)?</summary>
    public bool ElevationZoneMerged(long key)
    {
        long root = ElevationZoneRoot(key);
        if (root != key) return true;
        foreach (long n in ElevationZoneNbrs(ElevationZone(key)))
            if (ElevationZoneRoot(n) == key)
                return true;
        return false;
    }

    /// <summary>Patches owned by a raw elevation zone (sites inside it), lattice order.</summary>
    public long[] ElevationZonePatches(ZoneNode b)
    {
        long[]? memo = b.Patches;
        if (memo != null) return memo;
        double zs = ElevationZoneLevel.Size;
        double ps = PatchLevel.Size;
        int m = (int)Math.Ceiling(ElevationZoneLevel.Warp) + 1;
        int si0 = (int)Math.Floor(((b.I - m) * zs) / ps);
        int si1 = (int)Math.Floor(((b.I + 1 + m) * zs) / ps);
        int sj0 = (int)Math.Floor(((b.J - m) * zs) / ps);
        int sj1 = (int)Math.Floor(((b.J + 1 + m) * zs) / ps);
        var result = new List<long>();
        for (int sj = sj0; sj <= sj1; sj++)
        {
            for (int si = si0; si <= si1; si++)
            {
                PatchNode s = Patch(CellKeys.Pack(si, sj));
                if (s.ElevationZone == b.Key) result.Add(s.Key);
            }
        }
        return b.Patches = result.ToArray();
    }

    private HashSet<long> PatchMergeSet(long zkey)
    {
        ZoneNode b = ElevationZone(zkey);
        HashSet<long>? memo = b.PatchMerges;
        if (memo != null) return memo;
        var rng = new Sfc32(Hash.Hash4(SeedInt, StPatchMerge, b.I, b.J));
        int n = Between(P.PatchMergeMin, P.PatchMergeMax, rng.Next());
        return b.PatchMerges = new HashSet<long>(Pick(ElevationZonePatches(b), n, rng));
    }

    // ------------------------------------------------------------------ patches

    public PatchNode Patch(long key) => _patches.TryGetValue(key, out var s) ? s : _patches.GetOrAdd(key, CreatePatch);

    private PatchNode CreatePatch(long key)
    {
        int i = CellKeys.I(key);
        int j = CellKeys.J(key);
        Level level = PatchLevel;
        double x = level.SiteX(i, j);
        double y = level.SiteY(i, j);
        return new PatchNode { Key = key, I = i, J = j, X = x, Y = y, ElevationZone = ElevationZoneLevel.Query(x, y) };
    }

    public long[] PatchNbrs(PatchNode s) => s.Nbrs ??= PatchLevel.Neighbours(s.I, s.J).Select(n => n.Key).ToArray();

    public long PatchTarget(long key)
    {
        PatchNode s = Patch(key);
        long memo = Volatile.Read(ref s.Target);
        if (memo != ZoneNode.Unresolved) return memo;
        long t = -1;
        if (PatchMergeSet(s.ElevationZone).Contains(key))
        {
            long home = ElevationZoneRoot(s.ElevationZone);
            foreach (long c in PatchNbrs(s))
            {
                if (ElevationZoneRoot(Patch(c).ElevationZone) == home)
                {
                    t = c;
                    break;
                }
            }
        }
        Volatile.Write(ref s.Target, t);
        return t;
    }

    public long PatchRoot(long key)
    {
        PatchNode s = Patch(key);
        long memo = Volatile.Read(ref s.Root);
        if (memo != ZoneNode.Unresolved) return memo;
        long root = ResolveRoot(key, PatchTarget);
        Volatile.Write(ref s.Root, root);
        return root;
    }

    public bool PatchMerged(long key)
    {
        long root = PatchRoot(key);
        if (root != key) return true;
        foreach (long n in PatchNbrs(Patch(key)))
            if (PatchRoot(n) == key)
                return true;
        return false;
    }

    // ------------------------------------------------------------------ resolution

    /// <summary>Cell info for a raw elevation zone (zone-level detail).</summary>
    public CellInfo ElevationZoneCell(long zkey)
    {
        if (_zoneCells.TryGetValue(zkey, out var c)) return c;
        long root = ElevationZoneRoot(zkey);
        bool ocean = Ocean(root);
        // genesis of the raw cell, so merged groups still show why each part is ocean
        int rawOrigin = OriginOf(zkey);
        c = new CellInfo
        {
            PatchRaw = -1,
            Patch = -1,
            ElevationZoneRaw = zkey,
            ElevationZone = root,
            Region = ElevationZone(root).Region,
            Ocean = ocean,
            Origin = !ocean ? Origin.Land : rawOrigin != Origin.Land ? rawOrigin : OriginOf(root),
            PatchMerged = false,
            ElevationZoneMerged = ElevationZoneMerged(root),
        };
        return _zoneCells.GetOrAdd(zkey, c);
    }

    /// <summary>Cell info for a raw patch, nested: everything follows the merged patch's site.</summary>
    public CellInfo PatchCell(long pkey)
    {
        if (_patchCells.TryGetValue(pkey, out var c)) return c;
        long sr = PatchRoot(pkey);
        CellInfo zc = ElevationZoneCell(Patch(sr).ElevationZone);
        c = zc with { PatchRaw = pkey, Patch = sr, PatchMerged = PatchMerged(sr) };
        return _patchCells.GetOrAdd(pkey, c);
    }

    /// <summary>
    /// Classify a world point. <paramref name="detail"/> = false skips the patch level (used
    /// when patches are smaller than a pixel). Without nesting each level is looked up at the
    /// point itself.
    /// </summary>
    public CellInfo CellAt(double x, double y, bool detail = true)
    {
        if (P.Nest)
        {
            return detail ? PatchCell(PatchLevel.Query(x, y)) : ElevationZoneCell(ElevationZoneLevel.Query(x, y));
        }
        CellInfo zc = ElevationZoneCell(ElevationZoneLevel.Query(x, y));
        long region = RegionLevel.Query(x, y);
        if (!detail) return zc with { Region = region };
        long s = PatchLevel.Query(x, y);
        long root = PatchRoot(s);
        return zc with { Region = region, PatchRaw = s, Patch = root, PatchMerged = PatchMerged(root) };
    }

    // ------------------------------------------------------------------ enumeration

    /// <summary>Keys of a level's lattice cells whose site may lie in the rectangle (+ margin cells).</summary>
    public static List<long> CellsIn(Level level, double x0, double y0, double x1, double y1, int margin = 1)
    {
        double s = level.Size;
        var result = new List<long>();
        int i0 = (int)Math.Floor(x0 / s) - margin;
        int i1 = (int)Math.Floor(x1 / s) + margin;
        int j0 = (int)Math.Floor(y0 / s) - margin;
        int j1 = (int)Math.Floor(y1 / s) + margin;
        for (int j = j0; j <= j1; j++)
            for (int i = i0; i <= i1; i++)
                result.Add(CellKeys.Pack(i, j));
        return result;
    }

    /// <summary>Count of lattice cells a rectangle would enumerate at a level (to cap work).</summary>
    public static long CountIn(Level level, double x0, double y0, double x1, double y1, int margin = 1)
    {
        double s = level.Size;
        return (long)(Math.Floor(x1 / s) - Math.Floor(x0 / s) + 1 + 2 * margin) * (long)(Math.Floor(y1 / s) - Math.Floor(y0 / s) + 1 + 2 * margin);
    }

    /// <summary>Links of a region (sources it on demand).</summary>
    public SeedLink[] Links(long rkey)
    {
        RegionNode r = Region(rkey);
        SeedLink[]? links = r.Links;
        if (links != null) return links;
        lock (_sourceLock)
        {
            Source(rkey);
            return r.Links!;
        }
    }

    /// <summary>
    /// Determinism fingerprint: FNV-1a over a fixed sample grid around the origin (nested cell
    /// ids and ocean flags). Equal to the fingerprint Sandbox 4 shows for the same seed and parameters.
    /// </summary>
    public string Fingerprint(int n = 64, double half = 3 * 128000)
    {
        unchecked
        {
            uint h = 0x811c9dc5;
            void Mix(long v)
            {
                // keys are < 2^44: hash the low and high 22-bit halves
                uint lo = (uint)(v % 4194304);
                uint hi = (uint)(v / 4194304);
                h = (h ^ lo) * 16777619u;
                h = (h ^ hi) * 16777619u;
            }
            for (int y = 0; y < n; y++)
            {
                for (int x = 0; x < n; x++)
                {
                    double wx = -half + ((x + 0.5) / n) * 2 * half;
                    double wy = -half + ((y + 0.5) / n) * 2 * half;
                    CellInfo c = CellAt(wx, wy, true);
                    Mix(c.Patch + 1);
                    Mix(c.ElevationZone + 1);
                    Mix(c.Region + 1);
                    Mix(c.Ocean ? 1 : 2);
                }
            }
            return h.ToString("x8");
        }
    }

    /// <summary>Follow merge targets to the root; a cycle resolves to its smallest key.</summary>
    public static long ResolveRoot(long key, Func<long, long> target)
    {
        var path = new List<long> { key };
        long cur = key;
        for (int step = 0; step < 64; step++)
        {
            long t = target(cur);
            if (t < 0) return cur;
            int at = path.IndexOf(t);
            if (at >= 0)
            {
                long m = t;
                for (int q = at; q < path.Count; q++)
                    if (path[q] < m)
                        m = path[q];
                return m;
            }
            path.Add(t);
            cur = t;
        }
        return cur;
    }
}
