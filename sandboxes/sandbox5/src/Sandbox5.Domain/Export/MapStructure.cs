using Sandbox5.Domain.Model;
using Sandbox5.Domain.Numerics;

namespace Sandbox5.Domain.Export;

/// <summary>Rounding as the exported documents use it (JavaScript's Math.round: halves up), never −0.</summary>
public static class Rounding
{
    public static double R0(double v) => DMath.Round(v) + 0.0;

    public static double R1(double v) => DMath.Round(v * 10) / 10 + 0.0;

    public static double R2(double v) => DMath.Round(v * 100) / 100 + 0.0;
}

/// <summary>
/// The map as three nested levels of cells, Region → ElevationZone → BiomePatch: the
/// structure described in docs/map-structure.md of the repository (and written by Sandbox 4's
/// <c>npm run export-map</c>). Cells are listed after merging. Values are rounded: positions
/// and heights to metres, temperatures to 0.1 °C, amounts to 0.01.
/// </summary>
public sealed record MapStructure(string Seed, MapUnits Units, IReadOnlyList<RegionRecord> Regions)
{
    /// <summary>The four regions that meet at the map origin: what docs/map-default-structure.json covers.</summary>
    public static readonly IReadOnlyList<(int I, int J)> OriginRegions = [(-1, -1), (0, -1), (-1, 0), (0, 0)];

    public static MapStructure Of(WorldMap map, IEnumerable<(int I, int J)>? regions = null) =>
        new(map.SeedText, MapUnits.Default, (regions ?? OriginRegions).Select(r => RegionRecord.Of(map.Region(r.I, r.J))).ToArray());
}

public sealed record MapUnits(string Distance, string Temperature, string Precipitation, string Height)
{
    public static readonly MapUnits Default = new("m", "°C", "mm/yr", "m");
}

public sealed record RegionRecord(long Key, int I, int J, double X, double Y, IReadOnlyList<ZoneRecord> ElevationZones)
{
    public static RegionRecord Of(Region r, bool withPatches = true) =>
        new(r.Key, r.I, r.J, Rounding.R0(r.Site.X), Rounding.R0(r.Site.Y), r.ElevationZones.Select(z => ZoneRecord.Of(z, withPatches)).ToArray());
}

/// <param name="Type">ocean, flat, lowland, hills or mountains.</param>
/// <param name="Bedrock">The bedrock class that places the zone's deposits; null for ocean.</param>
/// <param name="BiomePatches">The zone's patches; null when they were not asked for.</param>
public sealed record ZoneRecord(long Key, int I, int J, double X, double Y, string Type, bool Ocean, string? Bedrock, IReadOnlyList<PatchRecord>? BiomePatches)
{
    public static ZoneRecord Of(ElevationZone z, bool withPatches = true) =>
        new(z.Key, z.I, z.J, Rounding.R0(z.Site.X), Rounding.R0(z.Site.Y), z.Type.Id, z.IsOcean, z.Bedrock?.Id, withPatches ? z.Patches.Select(PatchRecord.Of).ToArray() : null);
}

/// <param name="Biome">Biome id; "ocean" for an ocean patch.</param>
/// <param name="Belt">Thermal belt id; null for ocean (like the other climate fields).</param>
/// <param name="Aridity">P / P_th: below 0.5 desert, 0.5–1 steppe.</param>
/// <param name="Temperature">°C, after the height cooling.</param>
/// <param name="Precipitation">mm per year, as classified.</param>
/// <param name="Height">Mean height of the patch's land, metres.</param>
/// <param name="Coastal">A land patch bordering the ocean.</param>
/// <param name="Prosperity">The prosperity map at the patch's site, 0–1 between its minimum and maximum.</param>
/// <param name="Resources">The patch's resources, largest amount first.</param>
public sealed record PatchRecord(
    long Key,
    int I,
    int J,
    double X,
    double Y,
    string Biome,
    string? Belt,
    string? Moisture,
    double? Aridity,
    double? Temperature,
    double? Precipitation,
    double Height,
    bool Coastal,
    double Prosperity,
    IReadOnlyList<ResourceRecord> Resources)
{
    public static PatchRecord Of(Patch p)
    {
        ResourceRecord[] resources = p.Resources.Select(r => new ResourceRecord(r.Type.Id, Rounding.R2(r.Amount), r.Variant)).ToArray();
        double x = Rounding.R0(p.Site.X);
        double y = Rounding.R0(p.Site.Y);
        double prosperity = Rounding.R2(p.Prosperity);
        if (p.IsOcean) return new PatchRecord(p.Key, p.I, p.J, x, y, p.Biome.Id, null, null, null, null, null, 0, false, prosperity, resources);
        PatchClimate c = p.Climate!;
        return new PatchRecord(p.Key, p.I, p.J, x, y, p.Biome.Id, p.Belt!.Id, p.Moisture!.Value.DisplayName(), Rounding.R2(c.Aridity), Rounding.R1(c.Temperature), Rounding.R0(c.Precipitation), Rounding.R0(p.Height), p.IsCoastal, prosperity, resources);
    }
}

public sealed record ResourceRecord(string Id, double Amount, string Variant);
