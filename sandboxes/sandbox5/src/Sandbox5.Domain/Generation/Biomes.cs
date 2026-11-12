using System.Collections.Concurrent;
using Sandbox5.Domain.Model;
using Sandbox5.Domain.Numerics;

namespace Sandbox5.Domain.Generation;

public sealed record BiomeParams
{
    /// <summary>Cooling curve: control point heights (m) and how much cooler it is there (°C).</summary>
    public required double[] CoolH { get; init; }
    public required double[] CoolT { get; init; }
    /// <summary>Precipitation factor in river-poor (sparse) flat elevation zones (1 = no effect).</summary>
    public required double SparseDry { get; init; }
    /// <summary>Mangrove: least temperature (°C, after the height cooling) and least aridity P / P_th.</summary>
    public required double MangroveT { get; init; }
    public required double MangroveM { get; init; }
}

/// <summary>The biome of a land climate.</summary>
/// <param name="Biome">Index into <see cref="Model.Biome.All"/>.</param>
/// <param name="Belt">Index into <see cref="ThermalBelt.All"/>.</param>
/// <param name="Moisture">Index of the <see cref="MoistureClass"/>.</param>
/// <param name="Aridity">P / P_th.</param>
public readonly record struct Classified(int Biome, int Belt, int Moisture, double Aridity);

/// <summary>Everything that went into one patch's biome.</summary>
public sealed record BiomeInfo
{
    /// <summary>The patch (merged root) or, at zone level, the elevation zone it was read for.</summary>
    public required long Key { get; init; }
    /// <summary>True when read for a patch, false for an elevation zone (zoomed far out).</summary>
    public required bool IsPatch { get; init; }
    public required bool Ocean { get; init; }
    /// <summary>Type of its (merged) elevation zone, index into <see cref="ElevationZoneType.All"/>.</summary>
    public required int ZoneType { get; init; }
    /// <summary>Site the climate was read at, metres.</summary>
    public required double X { get; init; }
    public required double Y { get; init; }
    /// <summary>Initial (sea-level) temperature, °C, and precipitation, mm/yr, at the site.</summary>
    public required double T0 { get; init; }
    public required double P0 { get; init; }
    /// <summary>Mean land height used for the cooling, metres; exact (from the terrain tile) or an estimate.</summary>
    public required double Height { get; init; }
    public required bool HeightExact { get; init; }
    /// <summary>How much cooler the height makes it, °C.</summary>
    public required double Cooling { get; init; }
    /// <summary>Temperature after the cooling and effective precipitation, as classified.</summary>
    public required double T { get; init; }
    public required double P { get; init; }
    /// <summary>In a river-poor flat elevation zone (precipitation × SparseDry).</summary>
    public required bool Sparse { get; init; }
    /// <summary>A land patch bordering the ocean (always false at elevation zone level).</summary>
    public required bool Coastal { get; init; }
    /// <summary>Index into <see cref="Model.Biome.All"/>.</summary>
    public required int Biome { get; init; }
    public required int Belt { get; init; }
    public required int Moisture { get; init; }
    public required double Aridity { get; init; }
    /// <summary>The biome the sea-level temperature alone would give (differs on high ground).</summary>
    public required int SeaLevel { get; init; }
}

/// <summary>
/// Biomes of the patches, from the initial climate and the height map: a port of
/// world/biomes.ts. Every land patch gets one biome, read at its (merged root's) site:
///
///   1. Temperature   the initial temperature cooled with the patch's height:
///                    T = T₀ − cooling(h), a monotone spline through 5 configurable points.
///   2. Moisture      the initial precipitation; × a dryness factor in a river-poor flat zone.
///   3. Aridity       m = P / P_th with Köppen's dryness threshold P_th = 20·T + 140 mm.
///   4. Classify      a thermal belt (from T) × a moisture class (from m) table.
///   5. Mangrove      a coastal patch in a flat or lowland zone becomes mangrove when it is
///                    warm enough and not desert.
///
/// The height is the mean height of the patch's land from the terrain. With a terrain and
/// <c>computeHeights</c>, the tile is computed on demand, so the biome of a patch is always
/// the same; without a terrain a typical height of the elevation zone type stands in.
/// Thread-safe.
/// </summary>
public sealed class Biomes
{
    /// <summary>Cool / warm temperate split for the forests.</summary>
    private const double WarmTemperate = 10;
    private static readonly double[] TemperateBounds = [0.5, 1, 2, 6];
    private static readonly double[] TropicalBounds = [0.5, 1, 2, 4];

    /// <summary>
    /// Typical mean patch height per elevation zone type (index = <see cref="ElevationZoneType.All"/>
    /// order), metres. Used when there is no terrain, and by the locations and travel costs.
    /// </summary>
    public static readonly double[] TypicalHeight = [0, 70, 140, 270, 470];

    private static readonly int Ice = Biome.IndexOf("ice");
    private static readonly int Tundra = Biome.IndexOf("tundra");
    private static readonly int ColdDesert = Biome.IndexOf("coldDesert");
    private static readonly int ColdSteppe = Biome.IndexOf("coldSteppe");
    private static readonly int Taiga = Biome.IndexOf("taiga");
    private static readonly int[] Tropical = new[] { "hotDesert", "thornScrub", "savanna", "dryForest", "rainforest" }.Select(Biome.IndexOf).ToArray();
    private static readonly int[] TemperateWarm = new[] { "coldDesert", "grassland", "shrubland", "broadleaf", "tempRainforest" }.Select(Biome.IndexOf).ToArray();
    private static readonly int[] TemperateCool = new[] { "coldDesert", "grassland", "shrubland", "mixedForest", "tempRainforest" }.Select(Biome.IndexOf).ToArray();

    public static readonly int OceanBiome = Biome.Ocean.Index;
    public static readonly int MangroveBiome = Biome.Mangrove.Index;

    private readonly ConcurrentDictionary<long, BiomeInfo> _cache = new();
    private readonly ConcurrentDictionary<long, BiomeInfo> _zoneCache = new();
    private readonly ConcurrentDictionary<long, bool> _coastCache = new();

    public World World { get; }
    public Rivers Rivers { get; }
    public Climate Climate { get; }
    public Terrain? Terrain { get; }
    public BiomeParams P { get; }
    /// <summary>Compute a patch's terrain tile when its height is needed (otherwise only computed tiles are read).</summary>
    public bool ComputeHeights { get; }
    /// <summary>°C cooler at a height (m): the cooling curve of the parameters.</summary>
    public Func<double, double> Cooling { get; }

    public Biomes(World world, Rivers rivers, Climate climate, Terrain? terrain, BiomeParams p, bool computeHeights = false)
    {
        World = world;
        Rivers = rivers;
        Climate = climate;
        Terrain = terrain;
        P = p;
        ComputeHeights = computeHeights;
        Cooling = CoolingCurve(p.CoolH, p.CoolT);
    }

    /// <summary>Köppen's dryness threshold (mm/yr) for evenly spread rain; never below 40 mm (cold air).</summary>
    public static double DryThreshold(double t) => Math.Max(40, 20 * t + 140);

    /// <summary>Index of the first bound that m is below (bounds.Length when none).</summary>
    private static int ClassOf(double m, double[] bounds)
    {
        int k = 0;
        while (k < bounds.Length && m >= bounds[k]) k++;
        return k;
    }

    /// <summary>The biome of a land climate: temperature (°C, after the height cooling) and precipitation (mm/yr).</summary>
    public static Classified Classify(double t, double p)
    {
        int belt = 0;
        for (int k = 1; k < ThermalBelt.All.Count; k++)
            if (t >= ThermalBelt.All[k].MinTemperature)
                belt = k;
        double aridity = p / DryThreshold(t);
        int biome;
        int moisture;
        if (belt == 4)
        {
            moisture = ClassOf(aridity, TropicalBounds);
            biome = Tropical[moisture];
        }
        else
        {
            moisture = ClassOf(aridity, TemperateBounds);
            biome = belt switch
            {
                0 => Ice,
                1 => Tundra,
                2 => aridity < 0.5 ? ColdDesert : aridity < 1 ? ColdSteppe : Taiga,
                _ => (t >= WarmTemperate ? TemperateWarm : TemperateCool)[moisture],
            };
        }
        return new Classified(biome, belt, moisture, aridity);
    }

    /// <summary>
    /// How much cooler it is at a height: a monotone cubic spline through the control points
    /// (height in metres → cooling in °C). Below the first point it stays at the first point's
    /// cooling; above the last it carries on along the last segment's slope.
    /// </summary>
    public static Func<double, double> CoolingCurve(double[] hs, double[] cs)
    {
        Func<double, double> spline = Spline.Monotone(hs, cs);
        Spline.Knots(hs, cs, out double[] ph, out double[] pc);
        int n = ph.Length;
        if (n < 2) return spline;
        double top = ph[n - 1];
        double last = pc[n - 1];
        double slope = (pc[n - 1] - pc[n - 2]) / (top - ph[n - 2]);
        return h => h > top ? last + slope * (h - top) : spline(h);
    }

    /// <summary>Biome of a (merged) patch, by any of its raw patch keys.</summary>
    public BiomeInfo OfPatch(long pkey)
    {
        bool cached = _cache.TryGetValue(pkey, out BiomeInfo? hit);
        if (cached && hit!.HeightExact) return hit;
        World w = World;
        CellInfo c = w.PatchCell(pkey);
        double h = Terrain != null && !c.Ocean ? Terrain.PatchHeight(c.Patch, c.Region, ComputeHeights) : double.NaN;
        if (cached && double.IsNaN(h)) return hit!;
        PatchNode s = w.Patch(c.Patch);
        BiomeInfo info = Info(c.Patch, true, s.X, s.Y, c.ElevationZone, c.Ocean, h);
        _cache[pkey] = info;
        return info;
    }

    /// <summary>Biome of an elevation zone at its own site (zoomed far out, where patches are skipped); always an estimated height.</summary>
    public BiomeInfo OfZone(long zkey)
    {
        if (_zoneCache.TryGetValue(zkey, out BiomeInfo? info)) return info;
        CellInfo c = World.ElevationZoneCell(zkey);
        ZoneNode z = World.ElevationZone(c.ElevationZone);
        info = Info(c.ElevationZone, false, z.X, z.Y, c.ElevationZone, c.Ocean, double.NaN);
        _zoneCache[zkey] = info;
        return info;
    }

    /// <summary>
    /// Does a (merged) land patch border the ocean: is a cell next to one of its raw patches
    /// an ocean patch? Merges go to neighbours, so the raw members are found by walking
    /// neighbours that share the root.
    /// </summary>
    public bool IsCoastal(long root)
    {
        if (_coastCache.TryGetValue(root, out bool hit)) return hit;
        World w = World;
        bool coast = false;
        var seen = new HashSet<long> { root };
        var stack = new Stack<long>();
        stack.Push(root);
        while (stack.Count > 0 && !coast)
        {
            long s = stack.Pop();
            foreach (long n in w.PatchNbrs(w.Patch(s)))
            {
                if (w.PatchCell(n).Ocean)
                {
                    coast = true;
                    break;
                }
                if (!seen.Contains(n) && w.PatchRoot(n) == root)
                {
                    seen.Add(n);
                    stack.Push(n);
                }
            }
        }
        _coastCache[root] = coast;
        return coast;
    }

    /// <summary>Biome index of a classified map cell (patch, or elevation zone when patch &lt; 0).</summary>
    public int IndexOf(long patch, long zoneRaw) => patch >= 0 ? OfPatch(patch).Biome : OfZone(zoneRaw).Biome;

    private BiomeInfo Info(long key, bool isPatch, double x, double y, long zone, bool ocean, double h)
    {
        double t0 = Climate.TemperatureAt(x, y);
        double p0 = Climate.PrecipitationAt(x, y);
        bool exact = !double.IsNaN(h);
        int zoneType = ElevationZoneType.IndexOf(zone, ocean);
        double height = exact ? Math.Max(0, h) : TypicalHeight[zoneType];
        bool sparse = !ocean && Rivers.IsSparseFlat(zone);
        double cooling = ocean ? 0 : Cooling(height);
        double t = t0 - cooling;
        double p = sparse ? p0 * P.SparseDry : p0;
        Classified k = Classify(t, p);
        bool coastal = !ocean && isPatch && IsCoastal(key);
        int biome;
        int seaLevel;
        if (ocean)
        {
            biome = OceanBiome;
            seaLevel = OceanBiome;
        }
        else
        {
            // the mangrove override, for the actual and the sea-level temperature alike
            bool mangroveZone = zoneType is ElevationZoneType.FlatIndex or ElevationZoneType.LowlandIndex;
            int Pick(Classified c, double tt) => coastal && mangroveZone && tt >= P.MangroveT && c.Aridity >= P.MangroveM ? MangroveBiome : c.Biome;
            biome = Pick(k, t);
            seaLevel = Pick(Classify(t0, p), t0);
        }
        return new BiomeInfo
        {
            Key = key,
            IsPatch = isPatch,
            Ocean = ocean,
            ZoneType = zoneType,
            X = x,
            Y = y,
            T0 = t0,
            P0 = p0,
            Height = height,
            HeightExact = exact,
            Cooling = cooling,
            T = t,
            P = p,
            Sparse = sparse,
            Coastal = coastal,
            Biome = biome,
            Belt = k.Belt,
            Moisture = k.Moisture,
            Aridity = k.Aridity,
            SeaLevel = seaLevel,
        };
    }
}
