namespace Sandbox5.Domain.Model;

/// <summary>
/// A biome: what a patch of land looks like from above. Every land patch gets one from its
/// temperature (after the height cooling) and its aridity; the azonal mangrove overrides it
/// on warm, wet, low coasts.
/// </summary>
public sealed record Biome(int Index, string Id, string Name, Rgb Color)
{
    /// <summary>Every biome, in legend order (cold → hot, dry → wet within a belt; the azonal mangrove last).</summary>
    public static readonly IReadOnlyList<Biome> All =
    [
        new(0, "ocean", "Ocean", new Rgb(38, 84, 132)),
        new(1, "ice", "Ice & snow", new Rgb(234, 239, 243)),
        new(2, "tundra", "Tundra", new Rgb(146, 154, 138)),
        new(3, "coldSteppe", "Cold steppe", new Rgb(178, 171, 132)),
        new(4, "taiga", "Boreal forest (taiga)", new Rgb(56, 94, 78)),
        new(5, "coldDesert", "Cold desert", new Rgb(204, 189, 152)),
        new(6, "grassland", "Temperate grassland", new Rgb(186, 186, 112)),
        new(7, "shrubland", "Woodland & shrubland", new Rgb(144, 152, 90)),
        new(8, "mixedForest", "Temperate mixed forest", new Rgb(68, 114, 72)),
        new(9, "broadleaf", "Temperate broadleaf forest", new Rgb(90, 140, 64)),
        new(10, "tempRainforest", "Temperate rainforest", new Rgb(40, 102, 80)),
        new(11, "hotDesert", "Hot desert", new Rgb(229, 200, 138)),
        new(12, "thornScrub", "Thorn scrub", new Rgb(198, 166, 100)),
        new(13, "savanna", "Savanna", new Rgb(190, 176, 80)),
        new(14, "dryForest", "Tropical dry forest", new Rgb(122, 144, 58)),
        new(15, "rainforest", "Tropical rainforest", new Rgb(28, 94, 44)),
        new(16, "mangrove", "Mangrove", new Rgb(66, 132, 118)),
    ];

    private static readonly Dictionary<string, Biome> ByIdMap = All.ToDictionary(b => b.Id);

    public static Biome ById(string id) => ByIdMap[id];

    /// <summary>Index into <see cref="All"/> of the biome with this id.</summary>
    public static int IndexOf(string id) => ByIdMap[id].Index;

    public static readonly Biome Ocean = ById("ocean");
    public static readonly Biome Mangrove = ById("mangrove");

    public bool IsOcean => Index == 0;
    public bool IsDesert => Id is "hotDesert" or "coldDesert";
}

/// <summary>
/// Thermal belt by temperature after the height cooling (°C, lower bound): ice below −10,
/// tundra to −3, boreal to 3, temperate to 18, then subtropical / tropical.
/// </summary>
public sealed record ThermalBelt(int Index, string Id, string Name, double MinTemperature)
{
    public static readonly IReadOnlyList<ThermalBelt> All =
    [
        new(0, "polar", "Polar / nival", double.NegativeInfinity),
        new(1, "subpolar", "Subpolar / alpine", -10),
        new(2, "boreal", "Boreal / subalpine", -3),
        new(3, "temperate", "Temperate", 3),
        new(4, "tropical", "Subtropical / tropical", 18),
    ];
}

/// <summary>Moisture class by aridity m = P / P_th. The numeric value is the index used by the classifier.</summary>
public enum MoistureClass
{
    Arid = 0,
    SemiArid = 1,
    Subhumid = 2,
    Humid = 3,
    Perhumid = 4,
}

public static class MoistureClassNames
{
    /// <summary>Display names, in <see cref="MoistureClass"/> order (as in the map export).</summary>
    public static readonly IReadOnlyList<string> All = ["Arid", "Semi-arid", "Subhumid", "Humid", "Perhumid"];

    public static string DisplayName(this MoistureClass m) => All[(int)m];
}
