using System.Collections.Concurrent;
using Sandbox5.Domain.Model;
using Sandbox5.Domain.Numerics;

namespace Sandbox5.Domain.Generation;

/// <summary>What a land patch gets from its region's rivers and lakes (terrain-free).</summary>
public sealed class PatchSite
{
    /// <summary>The largest river in the patch: patches drained upstream (flow / attractors per patch); 0 = none.</summary>
    public double River { get; internal set; }
    /// <summary>The largest river that meets the sea here.</summary>
    public double Mouth { get; internal set; }
    /// <summary>Area of the largest lake placed in the patch, m² (0 = none).</summary>
    public double Lake { get; internal set; }
    /// <summary>On the coast of an enclosed bay.</summary>
    public bool Harbour { get; internal set; }
    /// <summary>Share (0–1) of the river's upstream network, at its largest point here, in gold-bearing and in tin-bearing uplands.</summary>
    public double GoldLoad { get; internal set; }
    public double TinLoad { get; internal set; }

    internal static readonly PatchSite None = new();
}

/// <summary>One listed resource of a patch.</summary>
/// <param name="Resource">Index into <see cref="ResourceType.All"/>.</param>
public readonly record struct ResourceHit(int Resource, double Amount, string Variant);

public sealed class PatchResources
{
    /// <summary>The patch (merged root).</summary>
    public required long Patch { get; init; }
    public required bool Ocean { get; init; }
    /// <summary>Bedrock of its elevation zone, index into <see cref="Model.Bedrock.All"/> (−1 for ocean).</summary>
    public required int Bedrock { get; init; }
    /// <summary>Per resource index: the amount, 0–1 (suitability of a potential, richness of a deposit).</summary>
    public required double[] Amount { get; init; }
    /// <summary>Per resource index: the catalogue variant behind the amount ("" when 0).</summary>
    public required string[] Variant { get; init; }
    /// <summary>The resources of at least <see cref="Resources.MinAmount"/>, largest first (ties in catalogue order).</summary>
    public required ResourceHit[] List { get; init; }
    /// <summary>Food a settlement can count on from the patch, 0–1.</summary>
    public required double Food { get; init; }
    /// <summary>Its trade goods by value, 0 and up.</summary>
    public required double Wealth { get; init; }
    /// <summary>The prosperity map at the patch's site, 0–1 between its minimum and maximum.</summary>
    public required double Prosperity { get; init; }
    /// <summary>What the prosperity makes of the chances of the precious and luxury resources.</summary>
    public required double Boost { get; init; }
    public required PatchSite Site { get; init; }
}

/// <summary>
/// Natural resources of the patches: a port of world/resources.ts. Every patch gets an
/// amount in [0, 1] for each of the 24 raw resources, and with it the catalogue variant that
/// fits the patch best ("grain: rye", "timber: teak", "iron ore: bog iron").
///
///   Potentials   what the land can yield, from the climate and the position. Crops are the
///                best of a table, each an ECOCROP trapezoid over the growing-season
///                temperature and the yearly water, times farmland, soil and season; a river
///                irrigates. The rest come from tables by biome and zone type and from the
///                water of the patch (coast, harbour, river size, lake).
///   Deposits     rare point resources: stone, crystal, salt, the ores, gems. A hashed draw
///                per patch against a chance from the bedrock of its elevation zone, the zone
///                type and the climate; the amount is the richness of the deposit.
///   Prosperity   multiplies the chances of gold, silver, gems and the luxuries by
///                (2 × prosperity)².
///
/// Deterministic: a pure function of the seed, the parameters and the patch. Thread-safe.
/// </summary>
public sealed partial class Resources
{
    /// <summary>A resource is listed for a patch from this amount.</summary>
    public const double MinAmount = 0.25;

    private static readonly int ResourceCount = ResourceType.All.Count;
    private static readonly bool[] Prosperous = ResourceType.All.Select(r => r.FollowsProsperity).ToArray();
    private static readonly double[] TradeWeights = ResourceType.All.Select(r => r.TradeValue).ToArray();

    private readonly ConcurrentDictionary<long, PatchResources> _cache = new();
    private readonly ConcurrentDictionary<long, Lazy<OrderedDictionary<long, PatchSite>>> _siteCache;

    public World World { get; }
    public Rivers Rivers { get; }
    public Lakes Lakes { get; }
    public Biomes Biomes { get; }
    /// <summary>The climate whose prosperity map sets how often precious metals, gems and luxuries turn up.</summary>
    public Climate Climate { get; }

    public Resources(World world, Rivers rivers, Lakes lakes, Biomes biomes, Climate climate)
        : this(world, rivers, lakes, biomes, climate, new ConcurrentDictionary<long, Lazy<OrderedDictionary<long, PatchSite>>>())
    {
    }

    private Resources(World world, Rivers rivers, Lakes lakes, Biomes biomes, Climate climate, ConcurrentDictionary<long, Lazy<OrderedDictionary<long, PatchSite>>> siteCache)
    {
        World = world;
        Rivers = rivers;
        Lakes = lakes;
        Biomes = biomes;
        Climate = climate;
        _siteCache = siteCache;
    }

    /// <summary>The same layer on other Biomes (at exact patch heights), sharing the river and lake sites.</summary>
    public Resources WithBiomes(Biomes biomes) => new(World, Rivers, Lakes, biomes, Climate, _siteCache);

    /// <summary>
    /// How much more often the prosperity resources turn up at a prosperity of 0–1:
    /// (2 × prosperity)², so 0.25 at a quarter, 1 in the middle and 4 at the top.
    /// </summary>
    public static double ProsperityBoost(double prosperity)
    {
        double p = prosperity < 0 ? 0 : prosperity > 1 ? 1 : prosperity;
        return 4 * p * p;
    }

    /// <summary>The prosperity map at a point, 0–1 between its minimum and maximum (0.5 when the map is flat).</summary>
    public double ProsperityAt(double x, double y)
    {
        NoiseFieldParams p = Climate.P.Prosperity;
        double span = p.Max - p.Min;
        return span > 0 ? Sat((Climate.ProsperityAt(x, y) - p.Min) / span) : 0.5;
    }

    /// <summary>
    /// Bedrock class (index into <see cref="Model.Bedrock.All"/>) of a land elevation zone
    /// (merged root) of a zone type, −1 for ocean: hashed from the seed and the zone key.
    /// </summary>
    public static int BedrockOf(int seed, long zkey, int zoneType)
    {
        int col = zoneType - 1; // flat 0 … mountains 3, −1 for ocean
        if (col < 0) return -1;
        int total = 0;
        foreach (Bedrock b in Model.Bedrock.All) total += b.Weights[col];
        long h = Hash.Hash4(seed, StBedrock, CellKeys.I(zkey), CellKeys.J(zkey)) % (uint)total;
        for (int i = 0; i < Model.Bedrock.All.Count; i++)
        {
            h -= Model.Bedrock.All[i].Weights[col];
            if (h < 0) return i;
        }
        return Model.Bedrock.All.Count - 1;
    }

    /// <summary>Bedrock (index into <see cref="Model.Bedrock.All"/>) of an elevation zone (merged root); −1 for ocean.</summary>
    public int Bedrock(long zkey)
    {
        bool ocean = World.Ocean(zkey);
        return BedrockOf(World.SeedInt, zkey, ElevationZoneType.IndexOf(zkey, ocean));
    }

    /// <summary>The resources of a patch (any key of a merged patch; land or ocean).</summary>
    public PatchResources OfPatch(long pkey)
    {
        World w = World;
        CellInfo c = w.PatchCell(pkey);
        if (_cache.TryGetValue(c.Patch, out PatchResources? hit)) return hit;
        BiomeInfo info = Biomes.OfPatch(c.Patch);
        // the prosperity is read at the patch's site, like its climate
        double prosperity = ProsperityAt(info.X, info.Y);
        PatchResources r;
        if (c.Ocean) r = OceanResources(w.SeedInt, c.Patch, info.T0, TouchesLand(c.Patch), prosperity);
        else
        {
            PatchSite site = Sites(c.Region).TryGetValue(c.Patch, out PatchSite? s) ? s : PatchSite.None;
            r = LandResources(w.SeedInt, info, c.ElevationZone, BedrockOf(w.SeedInt, c.ElevationZone, info.ZoneType), site, prosperity);
        }
        // an estimated height may still change: keep only what is final
        if (c.Ocean || info.HeightExact || Biomes.Terrain == null) _cache[c.Patch] = r;
        return r;
    }

    /// <summary>Does a (merged) ocean patch touch land: is it on the shelf?</summary>
    private bool TouchesLand(long root)
    {
        World w = World;
        var seen = new HashSet<long> { root };
        var stack = new Stack<long>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            long s = stack.Pop();
            foreach (long n in w.PatchNbrs(w.Patch(s)))
            {
                if (!w.PatchCell(n).Ocean) return true;
                if (!seen.Contains(n) && w.PatchRoot(n) == root)
                {
                    seen.Add(n);
                    stack.Push(n);
                }
            }
        }
        return false;
    }

    /// <summary>Is this raw ocean patch mostly enclosed by land (at least 3 land neighbours, and more land than ocean ones)?</summary>
    public static bool IsBayPatch(World w, long o)
    {
        long[] nb = w.PatchNbrs(w.Patch(o));
        int l = 0;
        foreach (long q in nb)
            if (!w.PatchCell(q).Ocean)
                l++;
        return l >= 3 && 2 * l > nb.Length;
    }

    /// <summary>The river and lake site of every land patch (merged root) drawn in a region, in the order they are met.</summary>
    public OrderedDictionary<long, PatchSite> Sites(long rkey) =>
        _siteCache.GetOrAdd(rkey, k => new Lazy<OrderedDictionary<long, PatchSite>>(() => ComputeSites(k))).Value;

    private OrderedDictionary<long, PatchSite> ComputeSites(long rkey)
    {
        World w = World;
        int seed = w.SeedInt;
        var result = new OrderedDictionary<long, PatchSite>();

        // the region's land patches (merged roots) with their raw members: enclosed bays
        foreach (long b in Rivers.RegionElevationZones(rkey))
        {
            if (w.ElevationZoneCell(b).Ocean) continue;
            foreach (long s in w.ElevationZonePatches(w.ElevationZone(b)))
            {
                CellInfo c = w.PatchCell(s);
                if (c.Ocean || c.Region != rkey) continue;
                if (!result.TryGetValue(c.Patch, out PatchSite? site))
                {
                    site = new PatchSite();
                    result.Add(c.Patch, site);
                }
                if (!site.Harbour)
                {
                    foreach (long q in w.PatchNbrs(w.Patch(s)))
                        if (w.PatchCell(q).Ocean && IsBayPatch(w, q))
                            site.Harbour = true;
                }
            }
        }

        foreach (LakeShape l in Lakes.Get(rkey).Lakes)
        {
            if (result.TryGetValue(l.Patch, out PatchSite? site) && l.Area > site.Lake) site.Lake = l.Area;
        }

        // rivers: size and mouths per patch, and what the uplands shed into them
        RegionRivers rr = Rivers.Get(rkey);
        int perPatch = Math.Max(1, Rivers.P.PerPatch);
        int n = rr.N;
        var nodeSite = new PatchSite?[n];
        // land nodes at and upstream of each node: all, in gold-bearing and in tin-bearing uplands
        int[] all = new int[n];
        int[] gold = new int[n];
        int[] tin = new int[n];
        var zoneKind = new Dictionary<long, int>();
        for (int k = 0; k < n; k++)
        {
            if (rr.Parent[k] < 0 || rr.Wet[k] != 0) continue;
            CellInfo c = w.CellAt(rr.X[k], rr.Y[k], true);
            if (c.Ocean || c.Region != rkey) continue;
            if (!result.TryGetValue(c.Patch, out PatchSite? site)) continue;
            nodeSite[k] = site;
            if (!zoneKind.TryGetValue(c.ElevationZone, out int kind))
            {
                int zt = ElevationZoneType.IndexOf(c.ElevationZone, false);
                int rock = BedrockOf(seed, c.ElevationZone, zt);
                kind = zt >= Hills ? (GoldRock.Contains(rock) ? 1 : rock == Granite ? 2 : 0) : 0;
                zoneKind[c.ElevationZone] = kind;
            }
            all[k] = 1;
            if (kind == 1) gold[k] = 1;
            else if (kind == 2) tin[k] = 1;
        }
        // nodes are appended as the rivers grow, so a parent always comes before its children
        for (int k = n - 1; k > 0; k--)
        {
            int p = rr.Parent[k];
            if (p < 0) continue;
            all[p] += all[k];
            gold[p] += gold[k];
            tin[p] += tin[k];
        }
        var best = new Dictionary<PatchSite, int>(ReferenceEqualityComparer.Instance);
        for (int k = 0; k < n; k++)
        {
            PatchSite? site = nodeSite[k];
            if (site == null) continue;
            int f = rr.Flow[k];
            double a = (double)f / perPatch;
            int p = rr.Parent[k];
            if (a > site.River) site.River = a;
            if ((rr.Parent[p] < 0 || rr.Wet[p] == 1) && a > site.Mouth) site.Mouth = a;
            // the loads are read where the river is largest in the patch (first node on a tie)
            if (f > (best.TryGetValue(site, out int bf) ? bf : -1))
            {
                best[site] = f;
                site.GoldLoad = (double)gold[k] / all[k];
                site.TinLoad = (double)tin[k] / all[k];
            }
        }
        return result;
    }

    /// <summary>
    /// Food a settlement can count on from a patch, 0–1: the staple (grain, or roots and pulses
    /// at four fifths), herds, orchards and what the wild gives. Fish is counted on its own.
    /// </summary>
    public static double FoodOf(double[] amount)
    {
        double staple = Math.Max(amount[GrainR], 0.8 * amount[ProduceR]);
        return Sat(0.75 * staple + 0.2 * amount[LivestockR] + 0.1 * amount[OrchardR] + 0.05 * amount[WildR]);
    }

    /// <summary>Trade goods of a patch: its salt, metals, luxuries and cash crops by value, 0 and up.</summary>
    public static double WealthOf(double[] amount)
    {
        double s = 0;
        for (int r = 0; r < amount.Length; r++)
            if (amount[r] >= MinAmount)
                s += TradeWeights[r] * amount[r];
        return s;
    }

    private static PatchResources Finish(long patch, bool ocean, int bedrock, double[] amount, string[] variant, PatchSite site, double prosperity)
    {
        var list = new List<ResourceHit>();
        for (int r = 0; r < amount.Length; r++)
        {
            if (amount[r] >= MinAmount) list.Add(new ResourceHit(r, amount[r], variant[r]));
            else if (amount[r] <= 0) variant[r] = "";
        }
        list.Sort(static (a, b) => b.Amount > a.Amount ? 1 : b.Amount < a.Amount ? -1 : a.Resource.CompareTo(b.Resource));
        return new PatchResources
        {
            Patch = patch,
            Ocean = ocean,
            Bedrock = bedrock,
            Amount = amount,
            Variant = variant,
            List = list.ToArray(),
            Food = FoodOf(amount),
            Wealth = WealthOf(amount),
            Prosperity = prosperity,
            Boost = ProsperityBoost(prosperity),
            Site = site,
        };
    }

    /// <summary>
    /// The resources of an ocean patch: fish everywhere (more on the shelf, next to land), and
    /// on the shelf seaweed, seals and whales in cold water, pearls and coral in warm water.
    /// </summary>
    public static PatchResources OceanResources(int seed, long patch, double t0, bool shelf, double prosperity = 0.5)
    {
        double[] amount = new double[ResourceCount];
        string[] variant = Enumerable.Repeat("", ResourceCount).ToArray();
        void Set(int r, double a, string v)
        {
            if (a > amount[r])
            {
                amount[r] = a;
                variant[r] = v;
            }
        }
        double boost = ProsperityBoost(prosperity);
        // seals and whales: in some patches of the cold sea, more of them where it is prosperous
        bool furs = Unit(seed, StFur, patch) < FurZones * boost;
        void Roll(int r, D kind, double chance, string v)
        {
            if (Unit(seed, StDeposit + (int)kind, patch) < chance * boost) Set(r, 0.35 + 0.65 * Unit(seed, StRich + (int)kind, patch), v);
        }
        if (shelf)
        {
            Set(FishR, 0.9, t0 < 4 ? "cod banks" : t0 < 11 ? "herring" : t0 < 18 ? "sardine and anchovy" : "reef fish and shellfish");
            if (t0 < 12) Set(WildR, 0.3, "edible seaweed and kelp");
            if (t0 < 3 && furs) Set(FursR, 0.4, "seals");
            if (t0 >= 20) Roll(GemsR, D.SeaPearl, 0.05, "pearl oyster");
            else if (t0 >= 11) Roll(GemsR, D.SeaCoral, 0.03, "precious red coral");
        }
        else
        {
            Set(FishR, 0.5, t0 < 8 ? "cod banks" : t0 < 16 ? "herring" : "tuna and large pelagics");
            if (t0 < 6 && furs) Set(FursR, 0.3, "whales");
        }
        return Finish(patch, true, -1, amount, variant, PatchSite.None, prosperity);
    }
}
