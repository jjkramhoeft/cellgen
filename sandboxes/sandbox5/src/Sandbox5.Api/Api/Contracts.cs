using Sandbox5.Api.Rendering;
using Sandbox5.Domain;
using Sandbox5.Domain.Export;
using Sandbox5.Domain.Generation;
using Sandbox5.Domain.Model;
using Sandbox5.Domain.Settings;

namespace Sandbox5.Api.Api;

// The JSON documents of the API. Positions are metres (x east, y south), rounded to whole
// metres; scores, amounts and climate values are rounded as in the exported documents.

public sealed record ApiIndex(string Name, string Description, string Seed, uint SeedValue, string Fingerprint, TileScheme Tiles, IReadOnlyList<EndpointInfo> Endpoints);

/// <param name="BaseMpp">Metres per pixel at zoom 0; every zoom level halves it.</param>
/// <param name="Template">Tile URL with {z}, {x}, {y}: tile (x, y) at zoom z covers the square from (x, y) × size × mpp(z).</param>
/// <param name="MaxHeightMpp">The height colour mode and the hillshade are drawn up to this many metres per pixel.</param>
/// <param name="MaxFeatureMpp">Rivers, lakes, locations and the travel network are drawn up to this many metres per pixel.</param>
public sealed record TileScheme(int TileSize, double BaseMpp, int MinZoom, int MaxZoom, string Template, double MaxHeightMpp, double MaxFeatureMpp, double DetailMpp);

public sealed record EndpointInfo(string Path, string Returns, string Description);

public sealed record SettingsDto(string Seed, uint SeedValue, string File, IReadOnlyDictionary<string, object> Params);

// ---- catalogue

public sealed record CatalogDto(
    IReadOnlyList<SwatchDto> ElevationZoneTypes,
    IReadOnlyList<SwatchDto> Biomes,
    IReadOnlyList<BeltDto> ThermalBelts,
    IReadOnlyList<string> MoistureClasses,
    IReadOnlyList<ResourceTypeDto> Resources,
    IReadOnlyList<string> ResourceGroups,
    IReadOnlyList<BedrockDto> Bedrocks,
    IReadOnlyList<SwatchDto> OceanGenesis,
    IReadOnlyList<ColorModeDto> ColorModes,
    IReadOnlyList<SwatchDto> TravelModes)
{
    private static string Id(Enum e) => char.ToLowerInvariant(e.ToString()[0]) + e.ToString()[1..];

    private static IReadOnlyList<SwatchDto> Ramp(double[][] stops, string unit) => stops.Select(s => new SwatchDto(s[0].ToString(System.Globalization.CultureInfo.InvariantCulture), s[0].ToString(System.Globalization.CultureInfo.InvariantCulture) + unit, Palette.HexOf(Palette.Pack(s[1], s[2], s[3])))).ToArray();

    public static CatalogDto Build()
    {
        SwatchDto[] zones = ElevationZoneType.All.Select(t => new SwatchDto(t.Id, t.Name, t.Color.Hex)).ToArray();
        SwatchDto[] biomes = Biome.All.Select(b => new SwatchDto(b.Id, b.Name, b.Color.Hex)).ToArray();
        SwatchDto[] genesis = Palette.Genesis.Select((g, i) => new SwatchDto(i switch { 0 => "land", 1 => "loneSeed", 2 => "linkedSeed", 3 => "linkChain", _ => "growth" + (i - 3) }, g.Name, g.Color.Hex)).ToArray();
        SwatchDto[] landSea = [new("land", "Land", Palette.HexOf(Palette.FlatLand)), new("ocean", "Ocean", Palette.HexOf(Palette.FlatOcean))];
        SwatchDto[] heights = new double[] { -300, 0, 60, 180, 400, 700, 1100, 1600, 2400 }.Select(h => new SwatchDto(h.ToString(System.Globalization.CultureInfo.InvariantCulture), h + " m", Palette.HexOf(Palette.HeightColor(h)))).ToArray();
        ColorModeDto[] modes =
        [
            new("map", "Map (elevation zone types)", "Each elevation zone in the colour of its type, a little lighter or darker per patch.", zones),
            new("biomes", "Biomes (per patch)", "One biome per patch, from its temperature (cooled by its height) and aridity.", biomes),
            new("landsea", "Land & ocean", "Plain land and ocean.", landSea),
            new("genesis", "Ocean genesis", "How each ocean zone came to be: a seed, a link between seeds, or growth.", genesis),
            new("regions", "Regions", "One hashed colour per region (128 km cells).", []),
            new("elevationZones", "Elevation zones", "One hashed colour per elevation zone (32 km cells, after merging).", []),
            new("patches", "Patches", "One hashed colour per patch (8 km cells, after merging).", []),
            new("height", "Height (hypsometric)", "The height map as a hypsometric tint with hillshade. Drawn when zoomed in to 2 km per pixel or closer.", heights),
            new("temperature", "Initial temperature", "The initial (sea-level) temperature map over the plain map.", Ramp(Palette.TemperatureStops, " °C")),
            new("precipitation", "Initial precipitation", "The initial precipitation map over the plain map.", Ramp(Palette.PrecipitationStops, " mm")),
            new("prosperity", "Prosperity", "The prosperity map over the plain map: how often precious metals, gems and luxuries turn up.", Ramp(Palette.ProsperityStops, "")),
            new("supernatural", "Supernatural", "The supernatural map over the plain map: how strong magic is.", Ramp(Palette.SupernaturalStops, "")),
        ];
        return new CatalogDto(
            zones,
            biomes,
            ThermalBelt.All.Select(b => new BeltDto(b.Id, b.Name, double.IsNegativeInfinity(b.MinTemperature) ? null : b.MinTemperature)).ToArray(),
            MoistureClassNames.All,
            ResourceType.All.Select(r => new ResourceTypeDto(r.Id, r.Name, Id(r.Group), Id(r.Kind), Id(r.Value), r.FollowsProsperity, r.TradeValue)).ToArray(),
            Enum.GetValues<ResourceGroup>().Select(g => Id(g)).ToArray(),
            Bedrock.All.Select(b => new BedrockDto(b.Id, b.Name, b.Weights[0], b.Weights[1], b.Weights[2], b.Weights[3])).ToArray(),
            genesis,
            modes,
            [new("road", "Road", "#f3dfb4"), new("river", "River route", "#c9f6ff"), new("sea", "Sea lane", "#eaf3ff")]);
    }
}

public sealed record SwatchDto(string Id, string Name, string Color);

public sealed record BeltDto(string Id, string Name, double? MinTemperature);

public sealed record ResourceTypeDto(string Id, string Name, string Group, string Kind, string Value, bool FollowsProsperity, double TradeValue);

/// <summary>A bedrock class with its relative share under each land zone type.</summary>
public sealed record BedrockDto(string Id, string Name, int Flat, int Lowland, int Hills, int Mountains);

public sealed record ColorModeDto(string Id, string Name, string Description, IReadOnlyList<SwatchDto> Legend);

// ---- cells

public sealed record CellRef(long Key, int I, int J, double X, double Y)
{
    public static CellRef Of(Region r) => new(r.Key, r.I, r.J, Rounding.R0(r.Site.X), Rounding.R0(r.Site.Y));
}

public sealed record RegionSummaryDto(long Key, int I, int J, double X, double Y, int ElevationZones, int OceanZones, int OceanSeeds)
{
    public static RegionSummaryDto Of(Region r) => new(r.Key, r.I, r.J, Rounding.R0(r.Site.X), Rounding.R0(r.Site.Y), r.ElevationZones.Count, r.ElevationZones.Count(z => z.IsOcean), r.OceanSeeds.Count);
}

/// <param name="Genesis">Why the zone is ocean: land, loneSeed, linkedSeed, linkChain or growth.</param>
/// <param name="Members">The raw lattice cells merged into the zone.</param>
/// <param name="RiverPoor">A river-poor flat zone: few rivers, drier, no lakes.</param>
public sealed record ZoneDetailDto(long Key, int I, int J, double X, double Y, long Region, string Type, string TypeName, bool Ocean, string Genesis, int GrowthPass, string? Bedrock, string? BedrockName, bool Merged, IReadOnlyList<long> Members, bool RiverPoor, int Patches)
{
    public static ZoneDetailDto Of(ElevationZone z)
    {
        Bedrock? rock = z.Bedrock;
        string g = z.Genesis.ToString();
        return new ZoneDetailDto(z.Key, z.I, z.J, Rounding.R0(z.Site.X), Rounding.R0(z.Site.Y), z.Region.Key, z.Type.Id, z.Type.Name, z.IsOcean, char.ToLowerInvariant(g[0]) + g[1..], z.GrowthPass, rock?.Id, rock?.Name, z.IsMerged, z.Members, z.IsRiverPoor, z.Patches.Count);
    }
}

public sealed record ResourceDto(string Id, string Name, string Group, double Amount, string Variant);

/// <summary>What a patch gets from its region's rivers and lakes.</summary>
/// <param name="River">The largest river in the patch: patches drained upstream (0 = none).</param>
/// <param name="Mouth">The largest river that meets the sea here.</param>
/// <param name="LakeArea">Area of the largest lake in the patch, m².</param>
public sealed record WatersDto(double River, double Mouth, double LakeArea, bool Harbour, double GoldLoad, double TinLoad);

/// <summary>A patch as a site for a city or town: the viability score and what went into it.</summary>
public sealed record SiteDto(
    double Score,
    double Need,
    FactorsDto Factors,
    TermsDto Terms,
    int Depth,
    bool Coast,
    bool Harbour,
    bool OnRiver,
    double River,
    double Mouth,
    double Confluence,
    bool HeadOfNavigation,
    double X,
    double Y,
    IReadOnlyList<string> Features)
{
    public static SiteDto Of(LocationCandidate c) => new(
        Rounding.R1(c.Score),
        Rounding.R2(c.Need),
        new FactorsDto(Rounding.R2(c.Resources), Rounding.R2(c.Geography), Rounding.R2(c.Trade), Rounding.R2(c.Climate), Rounding.R2(c.Prosperity)),
        new TermsDto(Rounding.R2(c.Food), Rounding.R2(c.Water), Rounding.R2(c.Materials), Rounding.R2(c.Fish), Rounding.R2(c.Goods), Rounding.R2(c.Buildable), Rounding.R2(c.Waterside), Rounding.R2(c.Defence), Rounding.R2(c.Gateway), Rounding.R2(c.Centrality), Rounding.R2(c.Comfort)),
        c.Depth,
        c.Coast,
        c.Harbour,
        c.OnRiver,
        Rounding.R2(c.River),
        Rounding.R2(c.Mouth),
        Rounding.R2(c.Confluence),
        c.Head,
        Rounding.R0(c.X),
        Rounding.R0(c.Y),
        c.Features);
}

/// <summary>The five factors of the viability score, each 0–1.</summary>
public sealed record FactorsDto(double Resources, double Geography, double Trade, double Climate, double Prosperity);

/// <summary>The terms behind the factors, each 0–1.</summary>
public sealed record TermsDto(double Food, double Water, double Materials, double Fish, double Goods, double Buildable, double Waterside, double Defence, double Gateway, double Centrality, double Comfort);

/// <summary>Everything about one patch: its biome with every input, its resources and its site.</summary>
public sealed record PatchDetailDto(
    long Key,
    int I,
    int J,
    double X,
    double Y,
    long Region,
    long ElevationZone,
    bool Ocean,
    bool Merged,
    string Biome,
    string BiomeName,
    string BiomeColor,
    string SeaLevelBiome,
    string? Belt,
    string? BeltName,
    string? Moisture,
    double? Aridity,
    double? Temperature,
    double SeaLevelTemperature,
    double? Cooling,
    double? Precipitation,
    double InitialPrecipitation,
    double Height,
    bool HeightExact,
    bool Coastal,
    bool RiverPoor,
    double Prosperity,
    double Supernatural,
    double Food,
    double Wealth,
    WatersDto? Waters,
    string? LakeBlock,
    IReadOnlyList<ResourceDto> Resources,
    SiteDto? Site,
    LocationDto? Location)
{
    public static PatchDetailDto Of(Patch p)
    {
        BiomeInfo b = p.BiomeInfo;
        PatchResources res = p.PatchResources;
        ResourceDto[] resources = p.Resources.Select(r => new ResourceDto(r.Type.Id, r.Type.Name, r.Type.Group.ToString().ToLowerInvariant(), Rounding.R2(r.Amount), r.Variant)).ToArray();
        bool land = !p.IsOcean;
        PatchSite s = res.Site;
        LakeBlock block = p.LakeBlock;
        LocationCandidate? site = p.SiteCandidate;
        PlacedLocation? location = p.Location;
        return new PatchDetailDto(
            p.Key,
            p.I,
            p.J,
            Rounding.R0(p.Site.X),
            Rounding.R0(p.Site.Y),
            p.Region.Key,
            p.ElevationZone.Key,
            p.IsOcean,
            p.IsMerged,
            p.Biome.Id,
            p.Biome.Name,
            p.Biome.Color.Hex,
            Domain.Model.Biome.All[b.SeaLevel].Id,
            p.Belt?.Id,
            p.Belt?.Name,
            p.Moisture?.DisplayName(),
            land ? Rounding.R2(b.Aridity) : null,
            land ? Rounding.R1(b.T) : null,
            Rounding.R1(b.T0),
            land ? Rounding.R1(b.Cooling) : null,
            land ? Rounding.R0(b.P) : null,
            Rounding.R0(b.P0),
            Rounding.R0(p.Height),
            b.HeightExact,
            b.Coastal,
            b.Sparse,
            Rounding.R2(res.Prosperity),
            Rounding.R1(p.Supernatural),
            Rounding.R2(res.Food),
            Rounding.R2(res.Wealth),
            land ? new WatersDto(Rounding.R2(s.River), Rounding.R2(s.Mouth), Rounding.R0(s.Lake), s.Harbour, Rounding.R2(s.GoldLoad), Rounding.R2(s.TinLoad)) : null,
            block == Domain.Generation.LakeBlock.None ? null : block.ToString().ToLowerInvariant(),
            resources,
            site == null ? null : SiteDto.Of(site),
            location == null ? null : LocationDto.Of(location));
    }
}

/// <param name="Key">Key of the location's patch.</param>
/// <param name="Kind">city or town.</param>
/// <param name="Rank">1 = the best score of its region.</param>
/// <param name="Navigable">On a navigable river.</param>
public sealed record LocationDto(long Key, long Region, string Kind, int Rank, double Score, double X, double Y, string ZoneType, bool Coast, bool Harbour, bool OnRiver, bool Navigable, FactorsDto Factors, IReadOnlyList<string> Features)
{
    public static LocationDto Of(PlacedLocation l)
    {
        LocationCandidate c = l.Site;
        return new LocationDto(
            l.Patch,
            l.Region,
            l.Kind == LocationKind.City ? "city" : "town",
            l.Rank,
            Rounding.R1(l.Score),
            Rounding.R0(l.X),
            Rounding.R0(l.Y),
            ElevationZoneType.All[c.ZoneType].Id,
            c.Coast,
            c.Harbour,
            c.OnRiver,
            c.River >= Locations.Navigable,
            new FactorsDto(Rounding.R2(c.Resources), Rounding.R2(c.Geography), Rounding.R2(c.Trade), Rounding.R2(c.Climate), Rounding.R2(c.Prosperity)),
            c.Features);
    }
}

/// <param name="Size">Diameter of a circle of the lake's area, metres.</param>
/// <param name="RiverFlow">Flow of the river at the lake's centre.</param>
/// <param name="Outline">The shore as [x, y] points; left out of lists unless asked for.</param>
public sealed record LakeDto(int Id, long Region, long Patch, double X, double Y, double Size, double Area, int RiverFlow, IReadOnlyList<double[]>? Outline)
{
    public static LakeDto Of(LakeShape l, bool outline = true) => new(
        l.Id,
        l.Region,
        l.Patch,
        Rounding.R0(l.Cx),
        Rounding.R0(l.Cy),
        Rounding.R0(l.Size),
        Rounding.R0(l.Area),
        l.Flow,
        outline ? l.X.Select((x, k) => new[] { Rounding.R0(x), Rounding.R0(l.Y[k]) }).ToArray() : null);
}

/// <summary>The river under a point.</summary>
/// <param name="Flow">Attractors reached at and upstream of the node.</param>
/// <param name="PatchesDrained">Flow in patches drained upstream (flow / attractors per patch): navigable from 8, large from 80.</param>
/// <param name="MouthFlow">Flow of the whole river at its mouth.</param>
/// <param name="DrainsTo">Key of the ocean elevation zone the river drains into.</param>
public sealed record RiverPointDto(long Region, int Node, double X, double Y, int Flow, double PatchesDrained, bool Navigable, int MouthFlow, long DrainsTo, bool OverSea, double Distance);

/// <summary>
/// The river network of one region, as columns: node k is at (x[k], y[k]), flows into node
/// parent[k] (−1 = a root, at an ocean zone's site) and carries flow[k].
/// </summary>
public sealed record RiverNetworkDto(long Region, int Nodes, int Attractors, int Reached, bool Landlocked, IReadOnlyList<int> Roots, IReadOnlyList<long> RootOcean, double[] X, double[] Y, int[] Parent, int[] Flow, int[] OverSea)
{
    public static RiverNetworkDto Of(RegionRivers r) => new(
        r.Region,
        r.N,
        r.Ax.Length,
        r.Reached,
        r.Landlocked,
        r.Roots,
        r.RootOcean,
        r.X.Select(Rounding.R0).ToArray(),
        r.Y.Select(Rounding.R0).ToArray(),
        r.Parent,
        r.Flow,
        r.Wet.Select(w => (int)w).ToArray());
}

/// <param name="A">Patch key of one end; <paramref name="B"/> of the other.</param>
/// <param name="Mode">road, river or sea.</param>
/// <param name="Cost">Travel cost, km of open flat road.</param>
/// <param name="Length">Length of the route, metres.</param>
/// <param name="Parts">The route from A to B, one part per kind of travel.</param>
public sealed record TravelLinkDto(long A, long B, string Mode, double Cost, double Length, bool Major, IReadOnlyList<TravelPartDto> Parts)
{
    public static TravelLinkDto Of(TravelEdge e) => new(
        e.A.Patch,
        e.B.Patch,
        NetworkStructure.ModeId(e.Mode),
        Rounding.R1(e.Cost),
        Rounding.R0(e.Length),
        e.Major,
        e.Parts.Select(p => new TravelPartDto(NetworkStructure.ModeId(p.Mode), Enumerable.Range(0, p.Pts.Length / 2).Select(k => new[] { Rounding.R0(p.Pts[2 * k]), Rounding.R0(p.Pts[2 * k + 1]) }).ToArray())).ToArray());
}

public sealed record TravelPartDto(string Mode, IReadOnlyList<double[]> Points);

/// <summary>The four noise maps at a point.</summary>
public sealed record PointClimateDto(double Temperature, double Precipitation, double Prosperity, double Supernatural);

/// <summary>Everything at one point of the map.</summary>
/// <param name="Height">Terrain height at the point, metres (negative under water).</param>
public sealed record PointDto(double X, double Y, bool Ocean, CellRef Region, ZoneDetailDto ElevationZone, PatchDetailDto Patch, PointClimateDto Climate, double Height, RiverPointDto? River, LakeDto? Lake, LocationDto? Location)
{
    public static PointDto Of(PointInfo p, WorldMap map)
    {
        RiverPointDto? river = null;
        if (p.River is { } r)
        {
            double drained = (double)r.Flow / Math.Max(1, map.Rivers.P.PerPatch);
            river = new RiverPointDto(r.Region, r.Node, Rounding.R0(r.X), Rounding.R0(r.Y), r.Flow, Rounding.R2(drained), drained >= Locations.Navigable, r.MouthFlow, r.DrainsTo, r.OverSea, Rounding.R0(r.Distance));
        }
        return new PointDto(
            Rounding.R0(p.Point.X),
            Rounding.R0(p.Point.Y),
            p.IsOcean,
            CellRef.Of(p.Region),
            ZoneDetailDto.Of(p.ElevationZone),
            PatchDetailDto.Of(p.Patch),
            new PointClimateDto(Rounding.R1(p.Temperature), Rounding.R0(p.Precipitation), Rounding.R1(p.Prosperity), Rounding.R1(p.Supernatural)),
            Rounding.R1(p.Height),
            river,
            p.Lake == null ? null : LakeDto.Of(p.Lake, outline: false),
            p.Location == null ? null : LocationDto.Of(p.Location));
    }
}

public static class SettingsDtoFactory
{
    public static SettingsDto Of(MapSettings s) => new(s.SeedText, s.Seed, s.File.Source, s.File.Params);
}
