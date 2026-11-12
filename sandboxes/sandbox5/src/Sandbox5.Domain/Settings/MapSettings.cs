using Sandbox5.Domain.Generation;
using Sandbox5.Domain.Numerics;

namespace Sandbox5.Domain.Settings;

/// <summary>
/// The settings of a map: the seed and the model parameters of every generation step, built
/// from a <see cref="DefaultsFile"/> (the sandbox's <c>defaults.json</c>). The file holds the
/// values in the units of the Sandbox 4 panels (kilometres, per cent); here they are the
/// model's units (metres, fractions). Building it validates the file: every parameter must
/// be present, of the right type and in range, and the file may not hold unknown keys.
/// </summary>
public sealed partial class MapSettings
{
    private const double Km = 1000;

    /// <summary>The file the settings were built from.</summary>
    public DefaultsFile File { get; }
    /// <summary>The seed as text, as it appears in the file and in URLs.</summary>
    public string SeedText { get; }
    /// <summary>The 32-bit seed: digits are used as a number, anything else is hashed.</summary>
    public uint Seed { get; }

    public WorldParams World { get; }
    public ClimateParams Climate { get; }
    /// <summary>False turns the rivers (and with them the lakes) off.</summary>
    public bool RiversEnabled { get; }
    public RiverParams Rivers { get; }

    public MapSettings(DefaultsFile file)
    {
        File = file;
        SeedText = file.Seed;
        Seed = Hash.SeedFromText(file.Seed);
        var p = new ParamBag(file);
        World = ReadWorld(p, Seed);
        Climate = ReadClimate(p, Seed);
        RiversEnabled = p.Bool("riv.on");
        Rivers = ReadRivers(p, Climate);
        ReadRest(p);
        p.CheckAllUsed();
    }

    public static MapSettings Load(string path) => new(DefaultsFile.Load(path));

    /// <summary>The same settings with another seed and/or some parameters replaced (keys as in the file).</summary>
    public MapSettings With(string? seed = null, IEnumerable<KeyValuePair<string, string>>? overrides = null) => new(File.With(overrides ?? [], seed));

    /// <summary>Level sizes are kept strictly nested and at most 16× apart (each parent scans its children on a local window).</summary>
    private static WorldParams ReadWorld(ParamBag p, uint seed)
    {
        double regionSize = p.Num("reg.size", 32, 512) * Km;
        double zoneSize = Math.Min(regionSize / 1.5, Math.Max(regionSize / 16, p.Num("ez.size", 8, 128) * Km));
        double patchSize = Math.Min(zoneSize / 1.5, Math.Max(zoneSize / 16, p.Num("patch.size", 2, 32) * Km));
        return new WorldParams
        {
            Seed = seed,
            RegionSize = regionSize,
            RegionJitter = p.Num("reg.jitter", 0, 1),
            OceanMin = p.Int("reg.oceanMin", 0, 4),
            OceanMax = p.Int("reg.oceanMax", 0, 4),
            ElevationZoneMergeMin = p.Int("reg.mergeMin", 0, 12),
            ElevationZoneMergeMax = p.Int("reg.mergeMax", 0, 12),
            ConnectChance = p.Int("oc.connect", 0, 100) / 100.0,
            DoubleLinkChance = p.Int("oc.double", 0, 100) / 100.0,
            ConnectRange = p.Int("oc.range", 1, 3),
            GrowWeights = [p.Int("oc.g0", 0, 100), p.Int("oc.g1", 0, 100), p.Int("oc.g2", 0, 100), p.Int("oc.g3", 0, 100)],
            GrowFrom = p.Option("oc.from", "connected", "all") == "all" ? GrowFrom.All : GrowFrom.Connected,
            GrowPasses = p.Int("oc.passes", 0, 4),
            ElevationZoneSize = zoneSize,
            ElevationZoneJitter = p.Num("ez.jitter", 0, 1),
            ElevationZoneWarp = p.Num("ez.warp", 0, 1),
            ElevationZoneWarpFreq = p.Num("ez.warpFreq", 0.1, 4),
            MergeAcrossCoast = p.Bool("ez.mergeCoast"),
            PatchMergeMin = p.Int("ez.mergeMin", 0, 12),
            PatchMergeMax = p.Int("ez.mergeMax", 0, 12),
            PatchSize = patchSize,
            PatchJitter = p.Num("patch.jitter", 0, 1),
            PatchWarp = p.Num("patch.warp", 0, 1),
            PatchWarpFreq = p.Num("patch.warpFreq", 0.1, 4),
            Nest = p.Bool("patch.nest"),
        };
    }

    private static NoiseFieldParams ReadField(ParamBag p, string id, double lo, double hi, bool log)
    {
        double a = p.Num($"clim.{id}.min", lo, hi);
        double b = p.Num($"clim.{id}.max", lo, hi);
        return new NoiseFieldParams
        {
            Scale = p.Num($"clim.{id}.scale", 1, 4000) * Km,
            Octaves = p.Int($"clim.{id}.octaves", 1, 8),
            Lacunarity = p.Num($"clim.{id}.lacunarity", 1.5, 4),
            Gain = p.Num($"clim.{id}.gain", 0.1, 0.9),
            Min = Math.Min(a, b),
            Max = Math.Max(a, b),
            Log = log,
        };
    }

    private static ClimateParams ReadClimate(ParamBag p, uint seed) => new()
    {
        Seed = seed,
        Temperature = ReadField(p, "t", -60, 60, false),
        Precipitation = ReadField(p, "p", 10, 20000, true),
        Prosperity = ReadField(p, "pros", 0, 1000, false),
        Supernatural = ReadField(p, "sup", 0, 1000, false),
    };

    private static RiverParams ReadRivers(ParamBag p, ClimateParams climate) => new()
    {
        PerPatch = p.Int("riv.points", 1, 30),
        Step = p.Num("riv.step", 0.5, 8) * Km,
        Influence = p.Num("riv.influence", 2, 256) * Km,
        Kill = p.Num("riv.kill", 0.5, 16) * Km,
        Jitter = p.Num("riv.jitter", 0, 2),
        Pull = p.Option("riv.pull", "normal", "squared", "sqrt") switch
        {
            "squared" => PullPower.Squared,
            "sqrt" => PullPower.Sqrt,
            _ => PullPower.Normal,
        },
        Inertia = p.Num("riv.inertia", 0, 3),
        Cone = int.Parse(p.Option("riv.cone", "0", "150", "144", "120", "90", "60")),
        Wander = p.Num("riv.wander", 0, 0.98),
        Apical = p.Num("riv.apical", 0, 1),
        SkipCoast = p.Bool("riv.coast"),
        FlatSparseCutoff = p.Num("ez.flatSparseP", 0, 20000),
        Climate = climate,
        MaxHops = 4,
    };
}
