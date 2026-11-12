namespace Sandbox5.Domain.Model;

public enum ResourceGroup
{
    Food,
    Materials,
    Fuel,
    Salt,
    Metals,
    Luxuries,
    Animals,
}

/// <summary>Potential = a suitability every patch has; deposit = a rare hashed point resource; both = a potential with deposits on top.</summary>
public enum ResourceKind
{
    Potential,
    Deposit,
    Both,
}

/// <summary>How far a resource is worth carrying.</summary>
public enum ResourceValue
{
    Subsistence,
    Bulk,
    Trade,
    Luxury,
}

/// <summary>One of the 24 raw resources a patch can yield.</summary>
/// <param name="FollowsProsperity">Its frequency follows the prosperity map (the precious metals, gems and the luxuries).</param>
/// <param name="TradeValue">Weight as a trade good (0 for food, building material and fuel).</param>
public sealed record ResourceType(int Index, string Id, string Name, ResourceGroup Group, ResourceKind Kind, ResourceValue Value, bool FollowsProsperity, double TradeValue)
{
    /// <summary>The 24 raw resources, in group order.</summary>
    public static readonly IReadOnlyList<ResourceType> All =
    [
        new(0, "grain", "Grain", ResourceGroup.Food, ResourceKind.Potential, ResourceValue.Bulk, false, 0),
        new(1, "produce", "Produce", ResourceGroup.Food, ResourceKind.Potential, ResourceValue.Subsistence, false, 0),
        new(2, "orchard", "Orchard", ResourceGroup.Food, ResourceKind.Potential, ResourceValue.Bulk, false, 0.1),
        new(3, "livestock", "Livestock", ResourceGroup.Food, ResourceKind.Potential, ResourceValue.Bulk, false, 0),
        new(4, "fish", "Fish", ResourceGroup.Food, ResourceKind.Potential, ResourceValue.Bulk, false, 0),
        new(5, "wildFood", "Wild food & game", ResourceGroup.Food, ResourceKind.Potential, ResourceValue.Subsistence, false, 0),
        new(6, "timber", "Timber", ResourceGroup.Materials, ResourceKind.Potential, ResourceValue.Bulk, false, 0),
        new(7, "stone", "Stone", ResourceGroup.Materials, ResourceKind.Deposit, ResourceValue.Bulk, false, 0),
        new(8, "clay", "Clay & earth", ResourceGroup.Materials, ResourceKind.Both, ResourceValue.Bulk, false, 0),
        new(9, "crystal", "Crystal", ResourceGroup.Materials, ResourceKind.Deposit, ResourceValue.Trade, false, 0.4),
        new(10, "fibre", "Fibre", ResourceGroup.Materials, ResourceKind.Potential, ResourceValue.Bulk, false, 0.1),
        new(11, "fuel", "Fuel", ResourceGroup.Fuel, ResourceKind.Both, ResourceValue.Bulk, false, 0),
        new(12, "salt", "Salt", ResourceGroup.Salt, ResourceKind.Deposit, ResourceValue.Trade, false, 0.7),
        new(13, "ironOre", "Iron ore", ResourceGroup.Metals, ResourceKind.Deposit, ResourceValue.Bulk, false, 0.5),
        new(14, "copperOre", "Copper ore", ResourceGroup.Metals, ResourceKind.Deposit, ResourceValue.Trade, false, 0.6),
        new(15, "tin", "Tin", ResourceGroup.Metals, ResourceKind.Deposit, ResourceValue.Luxury, false, 0.9),
        new(16, "silverLead", "Silver & lead", ResourceGroup.Metals, ResourceKind.Deposit, ResourceValue.Luxury, true, 0.9),
        new(17, "gold", "Gold", ResourceGroup.Metals, ResourceKind.Deposit, ResourceValue.Luxury, true, 1),
        new(18, "gems", "Gems & pearls", ResourceGroup.Luxuries, ResourceKind.Deposit, ResourceValue.Luxury, true, 0.8),
        new(19, "spices", "Spices & incense", ResourceGroup.Luxuries, ResourceKind.Potential, ResourceValue.Luxury, true, 0.7),
        new(20, "stimulants", "Stimulants & sugar", ResourceGroup.Luxuries, ResourceKind.Potential, ResourceValue.Trade, true, 0.4),
        new(21, "furs", "Furs & ivory", ResourceGroup.Luxuries, ResourceKind.Potential, ResourceValue.Luxury, true, 0.35),
        new(22, "dyes", "Dyes", ResourceGroup.Luxuries, ResourceKind.Both, ResourceValue.Trade, true, 0.3),
        new(23, "horses", "Horses & pack animals", ResourceGroup.Animals, ResourceKind.Potential, ResourceValue.Trade, false, 0.2),
    ];

    private static readonly Dictionary<string, ResourceType> ByIdMap = All.ToDictionary(r => r.Id);

    public static ResourceType ById(string id) => ByIdMap[id];

    public static int IndexOf(string id) => ByIdMap[id].Index;
}

/// <summary>
/// Bedrock class of a land elevation zone: it decides which stone, ores and gems the zone's
/// patches can hold. Hashed by weight from the zone type.
/// </summary>
/// <param name="Weights">Relative share among the zones of each land type: flat, lowland, hills, mountains.</param>
public sealed record Bedrock(int Index, string Id, string Name, int[] Weights)
{
    public static readonly IReadOnlyList<Bedrock> All =
    [
        new(0, "shield", "Crystalline shield", [20, 20, 20, 10]),
        new(1, "foldBelt", "Fold belt", [0, 5, 30, 40]),
        new(2, "granite", "Granite intrusion", [0, 3, 15, 20]),
        new(3, "volcanic", "Volcanic arc", [0, 2, 10, 30]),
        new(4, "basalt", "Flood basalt", [10, 10, 15, 5]),
        new(5, "ophiolite", "Ophiolite", [0, 2, 10, 15]),
        new(6, "carbonate", "Carbonate platform", [15, 30, 30, 15]),
        new(7, "clastic", "Clastic basin", [40, 40, 20, 5]),
        new(8, "alluvium", "Unconsolidated cover", [60, 40, 0, 0]),
    ];

    public static int IndexOf(string id) => All.First(b => b.Id == id).Index;
}
