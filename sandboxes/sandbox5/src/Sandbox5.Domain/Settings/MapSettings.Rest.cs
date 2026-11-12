using Sandbox5.Domain.Generation;
using Sandbox5.Domain.Model;

namespace Sandbox5.Domain.Settings;

public sealed partial class MapSettings
{
    public LakeParams Lakes { get; private set; } = null!;
    public TerrainParams Terrain { get; private set; } = null!;
    public BiomeParams Biomes { get; private set; } = null!;
    public LocationParams Locations { get; private set; } = null!;
    /// <summary>Display defaults: what a map image shows when the request does not say.</summary>
    public ViewSettings View { get; private set; } = null!;

    private void ReadRest(ParamBag p)
    {
        Lakes = new LakeParams
        {
            Frequency = p.Num("lake.freq", 0, 1),
            MinSize = p.Num("lake.min", 0.2, 40) * Km,
            MaxSize = p.Num("lake.max", 0.2, 40) * Km,
        };
        Terrain = new TerrainParams
        {
            Res = double.Parse(p.Option("hgt.res", "2000", "1000", "500")),
            ChSlope = p.Num("hgt.chSlope", 0.002, 0.1),
            Theta = p.Option("hgt.theta", "0.375", "0.4375", "0.5") switch
            {
                "0.375" => 0.375,
                "0.5" => 0.5,
                _ => 0.4375,
            },
            Hill = p.Num("hgt.hill", 0.05, 4),
            HillType = ElevationZoneType.All.Select(t => t.Kind == ElevationZoneKind.Ocean ? 0 : p.Num($"hgt.hs.{t.Id}", 0, 0.6)).ToArray(),
            Level = p.Num("hgt.level", 0, 1),
            ChanFactor = ElevationZoneType.All.Select(t => t.Kind == ElevationZoneKind.Ocean ? 1 : p.Num($"hgt.ch.{t.Id}", 0, 5)).ToArray(),
            FloodH = [.. Enumerable.Range(1, 4).Select(i => p.Num($"hgt.fp.h{i}", 0, 3000))],
            FloodW = [.. Enumerable.Range(1, 4).Select(i => p.Num($"hgt.fp.w{i}", 0, 3000))],
            FloodFlow = p.Bool("hgt.fp.flow"),
            Relief = p.Num("hgt.relief", 0, 1),
            Ridge = p.Num("hgt.ridge", 0, 400),
            Divide = p.Num("hgt.divide", 0, 300),
            Noise = p.Num("hgt.noise", 0, 3),
            Burn = p.Num("hgt.burn", 0, 20),
            Sea = p.Num("hgt.sea", 0, 2000),
        };
        Biomes = new BiomeParams
        {
            CoolH = [.. Enumerable.Range(1, 5).Select(i => p.Num($"bio.cool.h{i}", 0, 10000))],
            CoolT = [.. Enumerable.Range(1, 5).Select(i => p.Num($"bio.cool.t{i}", 0, 100))],
            SparseDry = p.Num("bio.sparseDry", 0, 1),
            MangroveT = p.Num("bio.mangroveT", -10, 50),
            MangroveM = p.Num("bio.mangroveM", 0, 10),
        };
        Locations = new LocationParams
        {
            Count = p.Int("loc.count", 0, 60),
            Cities = p.Int("loc.cities", 0, 12),
            Spacing = p.Num("loc.spacing", 4, 80) * Km,
            Weights = new FactorWeights(p.Num("loc.wRes", 0, 1), p.Num("loc.wGeo", 0, 1), p.Num("loc.wTrade", 0, 1), p.Num("loc.wClim", 0, 1), p.Num("loc.wPros", 0, 1)),
        };
        View = new ViewSettings
        {
            Color = p.Option("view.color", ViewSettings.ColorModes),
            Hillshade = p.Bool("view.hillshade"),
            Locations = p.Bool("view.locations"),
            LocationMinScore = p.Num("view.locMin", 0, 100),
            Travel = p.Bool("view.travel"),
            TravelStyle = p.Option("view.travelStyle", "terrain", "simple"),
            RegionEdges = p.Bool("view.regEdges"),
            ZoneEdges = p.Bool("view.zoneEdges"),
            PatchEdges = p.Bool("view.patchEdges"),
            Coast = p.Bool("view.coast"),
            RiverWidth = p.Num("view.riverWidth", 0.25, 4),
            RiverExp = p.Num("view.riverExp", 0.2, 1),
            RiverMin = p.Int("view.riverMin", 1, 200),
        };
    }
}

/// <summary>Display defaults of the map images (the <c>view.*</c> parameters).</summary>
public sealed record ViewSettings
{
    /// <summary>The colour modes a map image can be drawn in.</summary>
    public static readonly string[] ColorModes = ["map", "biomes", "landsea", "genesis", "regions", "elevationZones", "patches", "height", "temperature", "precipitation", "prosperity", "supernatural"];

    /// <summary>Colour mode, one of <see cref="ColorModes"/>.</summary>
    public required string Color { get; init; }
    /// <summary>Shade any colour mode by the height map (lit from the north-west).</summary>
    public required bool Hillshade { get; init; }
    /// <summary>Draw the city and town locations.</summary>
    public required bool Locations { get; init; }
    /// <summary>Hide every location below this viability score; the travel network connects those on show.</summary>
    public required double LocationMinScore { get; init; }
    /// <summary>Draw the travel network.</summary>
    public required bool Travel { get; init; }
    /// <summary>"terrain": routes follow the terrain; "simple": straight lines from place to place.</summary>
    public required string TravelStyle { get; init; }
    public required bool RegionEdges { get; init; }
    public required bool ZoneEdges { get; init; }
    public required bool PatchEdges { get; init; }
    public required bool Coast { get; init; }
    /// <summary>Scales the flow-based river line width.</summary>
    public required double RiverWidth { get; init; }
    /// <summary>River width ∝ flow^exponent.</summary>
    public required double RiverExp { get; init; }
    /// <summary>Hide river segments that carry fewer attractors than this.</summary>
    public required int RiverMin { get; init; }
}
