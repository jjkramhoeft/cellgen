namespace Sandbox5.Domain.Generation;

internal enum CropNeed
{
    None,
    River,
    Coast,
    Highland,
}

/// <summary>One crop of a crop table: ECOCROP limits and where it grows.</summary>
internal sealed class Crop
{
    public required string Name { get; init; }
    /// <summary>Growing-season temperature, °C: absolute min, optimum min and max, absolute max.</summary>
    public required double[] T { get; init; }
    /// <summary>Yearly water, mm.</summary>
    public required double[] P { get; init; }
    /// <summary>Unique index over all tables (the zone gate's hash stage).</summary>
    public int N { get; set; }
    /// <summary>Farmland by zone type (ElevationZoneType.All order).</summary>
    public required double[] Zones { get; init; }
    /// <summary>Least and most yearly mean temperature, °C (frost-tender and chill-needing perennials); fades over 2 °C.</summary>
    public double? MinT { get; init; }
    public double? MaxT { get; init; }
    /// <summary>A tree or shrub crop: no short-season penalty and no poor-soil penalty.</summary>
    public bool Tree { get; init; }
    public CropNeed Needs { get; init; }
    /// <summary>Share of the elevation zones where it grows at all (a regional speciality).</summary>
    public double? Gate { get; init; }
    /// <summary>Yield factor.</summary>
    public double? K { get; init; }
}

/// <summary>
/// The crop tables of the resource layer. GENERATED from sandboxes/sandbox4/src/world/resources.ts
/// (ECOCROP limits as listed in docs/research/patch-resources.md §4); the order of the tables
/// and of the crops in them fixes each crop's index, which seeds its regional gate.
/// </summary>
internal static class CropTables
{
    /// <summary>Per zone type (ocean, flat, lowland, hills, mountains).</summary>
    internal static double[] ZoneTable(double flat, double lowland, double hills, double mountains) => [0, flat, lowland, hills, mountains];

    /// <summary>Farmland by zone type: field crops like flat ground.</summary>
    internal static readonly double[] FarmZone = ZoneTable(1, 1, 0.6, 0.3);
    /// <summary>Terraces and slopes: crops of the hills.</summary>
    internal static readonly double[] SlopeZone = ZoneTable(0.6, 0.85, 1, 0.6);
    internal static readonly double[] HighZone = ZoneTable(0.4, 0.6, 1, 0.9);
    internal static readonly double[] WetZone = ZoneTable(1, 1, 0.35, 0);

    public static readonly Crop[] Grains, Produces, Orchards, Fibres, Spices, Stimulants, Dyes;

    private static Crop C(string name, double[] t, double[] p, double[]? zones = null, double? minT = null, double? maxT = null, bool tree = false, CropNeed needs = CropNeed.None, double? gate = null, double? k = null) =>
        new() { Name = name, T = t, P = p, Zones = zones ?? FarmZone, MinT = minT, MaxT = maxT, Tree = tree, Needs = needs, Gate = gate, K = k };

    static CropTables()
    {
        Grains =
        [
            C("bread wheat", [5, 15, 23, 27], [300, 750, 900, 1600]),
            C("durum wheat", [6, 17, 25, 30], [400, 500, 700, 800], minT: 9),
            C("barley", [2, 15, 20, 40], [200, 500, 1000, 2000], k: 0.85),
            C("rye", [3, 15, 20, 31], [400, 600, 1000, 2000], maxT: 12, k: 0.8),
            C("oats", [5, 16, 20, 30], [250, 600, 1000, 1500], maxT: 13, k: 0.8),
            C("paddy rice", [10, 20, 30, 36], [1000, 1500, 2000, 4000], zones: WetZone, minT: 12),
            C("maize", [10, 18, 33, 47], [400, 600, 1200, 1800], minT: 9),
            C("sorghum", [8, 22, 35, 40], [300, 400, 600, 700], minT: 16, k: 0.6),
            C("pearl millet", [12, 25, 35, 40], [200, 400, 900, 1700], minT: 18, k: 0.5),
            C("finger millet", [8, 18, 30, 35], [300, 500, 1100, 4300], zones: HighZone, minT: 14, k: 0.6),
            C("proso millet", [15, 20, 32, 45], [200, 500, 750, 1000], maxT: 16, k: 0.6),
            C("buckwheat", [7, 17, 27, 40], [400, 700, 1000, 1300], zones: SlopeZone, maxT: 12, k: 0.6),
            C("fonio", [18, 22, 27, 31], [400, 900, 1600, 2800], minT: 20, k: 0.4),
            C("teff", [2, 22, 28, 30], [300, 600, 1200, 2500], zones: HighZone, needs: CropNeed.Highland, k: 0.6),
            C("quinoa", [2, 14, 18, 35], [250, 500, 1000, 2600], zones: HighZone, needs: CropNeed.Highland, k: 0.6),
        ];
        Produces =
        [
            C("potato", [7, 15, 25, 30], [250, 500, 800, 2000], zones: ZoneTable(0.8, 1, 1, 0.7), maxT: 17),
            C("cassava", [10, 20, 29, 35], [500, 1000, 1500, 5000], minT: 18),
            C("sweet potato", [10, 18, 28, 38], [350, 750, 2000, 5000], minT: 15),
            C("greater yam", [14, 20, 32, 40], [700, 1200, 4000, 8000], minT: 20),
            C("taro", [10, 21, 28, 35], [1000, 1800, 2700, 4100], zones: WetZone, minT: 19),
            C("banana and plantain", [12, 23, 33, 42], [650, 1200, 3600, 5000], minT: 20, tree: true, k: 0.6),
            C("sago palm", [18, 25, 36, 40], [2100, 3000, 4500, 5800], zones: ZoneTable(1, 1, 0, 0), minT: 23, tree: true, k: 0.6),
            C("faba bean", [5, 18, 28, 32], [250, 650, 1000, 2600], maxT: 16),
            C("pea", [4, 10, 24, 30], [350, 800, 1200, 2500], maxT: 14),
            C("lentil", [5, 15, 29, 32], [250, 600, 1000, 2500], minT: 8, maxT: 19),
            C("chickpea", [7, 15, 29, 35], [300, 600, 1000, 1800], minT: 10),
            C("common bean", [7, 16, 25, 32], [300, 500, 2000, 4300], minT: 10),
            C("cowpea", [15, 25, 35, 40], [300, 500, 1500, 4100], minT: 19),
            C("cabbage and kale", [5, 10, 25, 30], [450, 600, 1100, 1900], maxT: 15),
            C("onion and alliums", [4, 12, 25, 30], [300, 350, 600, 2800], k: 0.8),
            C("carrot and root vegetables", [3, 15, 24, 30], [400, 600, 1200, 4000], maxT: 16),
            C("melons", [15, 20, 35, 40], [400, 500, 700, 1800], minT: 14, k: 0.8),
            C("enset", [8, 16, 24, 30], [900, 1100, 1500, 1700], zones: HighZone, needs: CropNeed.Highland, tree: true),
        ];
        Orchards =
        [
            C("olive", [5, 20, 34, 40], [200, 400, 700, 1200], zones: SlopeZone, minT: 12, maxT: 21, tree: true),
            C("grape", [10, 18, 30, 38], [400, 700, 850, 1200], zones: SlopeZone, minT: 9, maxT: 20, tree: true),
            C("date palm", [10, 26, 45, 52], [100, 200, 300, 400], zones: WetZone, minT: 19, needs: CropNeed.River, tree: true),
            C("fig", [4, 16, 26, 38], [300, 700, 1500, 2700], minT: 11, tree: true, k: 0.8),
            C("pomegranate", [8, 23, 32, 40], [400, 900, 1200, 4200], minT: 13, tree: true, k: 0.8),
            C("almond", [10, 12, 35, 40], [250, 600, 900, 1500], zones: SlopeZone, minT: 11, maxT: 21, tree: true, k: 0.8),
            C("pistachio", [12, 25, 35, 40], [250, 400, 700, 1100], zones: SlopeZone, minT: 13, maxT: 22, tree: true, k: 0.7),
            C("apple", [8, 14, 27, 33], [500, 700, 2500, 3200], zones: SlopeZone, minT: 5, maxT: 15, tree: true),
            C("pear", [10, 20, 35, 37], [400, 600, 900, 2100], zones: SlopeZone, minT: 6, maxT: 16, tree: true, k: 0.8),
            C("peach and stone fruit", [7, 20, 33, 35], [750, 900, 1100, 1600], minT: 10, maxT: 19, tree: true, k: 0.9),
            C("citrus", [13, 20, 30, 38], [450, 1200, 2000, 2700], minT: 16, tree: true),
            C("walnut", [7, 15, 30, 40], [400, 800, 1700, 2200], zones: SlopeZone, minT: 7, maxT: 17, tree: true, k: 0.8),
            C("sweet chestnut", [7, 15, 25, 30], [500, 900, 1300, 1600], zones: SlopeZone, minT: 8, maxT: 16, tree: true, k: 0.8),
            C("hazel", [5, 10, 24, 35], [600, 900, 1100, 1400], minT: 4, maxT: 14, tree: true, k: 0.6),
            C("coconut", [14, 22, 34, 38], [650, 1200, 2400, 4000], minT: 22, needs: CropNeed.Coast, tree: true),
            C("oil palm", [12, 20, 35, 38], [1000, 1500, 3000, 8000], zones: WetZone, minT: 23, tree: true),
            C("mango", [8, 24, 30, 48], [300, 600, 1500, 2600], minT: 20, tree: true, k: 0.8),
            C("cashew", [5, 15, 35, 46], [400, 750, 1600, 4000], minT: 21, tree: true, k: 0.7),
            C("shea", [18, 24, 38, 43], [300, 500, 1000, 1800], minT: 23, tree: true, k: 0.7),
            C("baobab", [14, 26, 36, 42], [250, 600, 1500, 4200], minT: 23, tree: true, k: 0.5),
            C("tamarind", [12, 20, 35, 45], [300, 800, 3000, 4500], minT: 21, tree: true, k: 0.6),
            C("breadfruit", [16, 21, 33, 40], [1000, 1500, 3000, 3500], minT: 23, tree: true, k: 0.8),
            C("Brazil nut", [12, 20, 36, 40], [1400, 2400, 2800, 3500], zones: WetZone, minT: 23, tree: true, k: 0.7),
            C("avocado", [10, 14, 40, 45], [300, 500, 2000, 2500], zones: HighZone, needs: CropNeed.Highland, tree: true, k: 0.8),
            C("sunflower", [5, 17, 34, 45], [300, 600, 1000, 1600], minT: 6, maxT: 17, k: 0.6),
            C("rapeseed", [5, 15, 25, 41], [400, 500, 1000, 2800], maxT: 13, k: 0.6),
            C("sesame", [10, 20, 30, 40], [300, 500, 1000, 1500], minT: 17, k: 0.6),
            C("groundnut", [10, 22, 32, 45], [400, 600, 1500, 4000], minT: 18, k: 0.6),
            C("soybean", [10, 20, 33, 38], [450, 600, 1500, 1800], minT: 10, maxT: 19, k: 0.6),
        ];
        Fibres =
        [
            C("flax", [5, 16, 24, 30], [250, 500, 800, 1300], maxT: 13),
            C("hemp", [6, 15, 28, 32], [350, 600, 1200, 4000], minT: 5, maxT: 17),
            C("cotton", [15, 22, 36, 42], [450, 750, 1200, 1500], minT: 17),
            C("jute", [13, 20, 37, 45], [900, 1500, 3000, 3600], zones: WetZone, minT: 21, needs: CropNeed.River),
            C("ramie", [10, 17, 27, 34], [1000, 1500, 2500, 4000], minT: 14, k: 0.8),
            C("kenaf", [10, 15, 28, 35], [450, 600, 2000, 3000], minT: 21, k: 0.7),
            C("sisal and agave", [10, 15, 27, 45], [500, 900, 1250, 1800], zones: SlopeZone, minT: 18, tree: true, k: 0.7),
            C("abaca", [16, 20, 29, 33], [700, 1800, 3000, 4400], minT: 23, tree: true, k: 0.7),
            C("esparto grass", [3, 15, 25, 35], [100, 200, 500, 600], zones: SlopeZone, minT: 10, tree: true, k: 0.5),
            C("silk", [13, 20, 28, 45], [300, 700, 2500, 5100], zones: SlopeZone, minT: 12, maxT: 20, tree: true, gate: 0.2),
            C("kapok", [12, 17, 38, 40], [750, 1500, 2500, 3000], minT: 22, tree: true, k: 0.5),
            C("New Zealand flax", [9, 13, 25, 30], [1300, 2000, 3000, 3800], minT: 8, maxT: 15, tree: true, k: 0.6),
            C("nettle and lime-bast", [5, 12, 22, 28], [400, 500, 700, 800], maxT: 12, tree: true, k: 0.35),
        ];
        Spices =
        [
            C("black pepper", [10, 22, 35, 40], [2000, 2500, 4000, 5500], minT: 22, tree: true, gate: 0.08),
            C("clove", [20, 24, 34, 38], [1200, 1500, 3600, 4000], zones: WetZone, minT: 24, needs: CropNeed.Coast, tree: true, gate: 0.06),
            C("nutmeg and mace", [12, 22, 34, 38], [1200, 1500, 3500, 4000], zones: WetZone, minT: 24, needs: CropNeed.Coast, tree: true, gate: 0.06),
            C("cinnamon", [18, 24, 30, 36], [1200, 2000, 2600, 3000], minT: 22, tree: true, gate: 0.08),
            C("cardamom", [10, 22, 30, 35], [1500, 3000, 6000, 7000], zones: HighZone, minT: 20, tree: true, gate: 0.1),
            C("ginger", [13, 19, 29, 35], [700, 1400, 3000, 4000], minT: 20, gate: 0.1, k: 0.8),
            C("turmeric", [18, 20, 28, 32], [800, 1000, 2000, 3000], minT: 20, gate: 0.1, k: 0.8),
            C("vanilla", [10, 21, 30, 33], [1500, 2000, 2500, 3000], zones: WetZone, minT: 22, tree: true, gate: 0.05),
            C("chili pepper", [8, 17, 30, 35], [500, 600, 1250, 1700], minT: 20, gate: 0.1, k: 0.7),
            C("myrrh", [18, 23, 33, 40], [250, 400, 800, 1000], zones: SlopeZone, minT: 22, tree: true, gate: 0.1),
            C("frankincense", [18, 26, 40, 47], [100, 150, 400, 600], zones: ZoneTable(0, 0.5, 1, 1), minT: 22, tree: true, gate: 0.1),
            C("gum arabic", [14, 24, 32, 48], [200, 300, 800, 2300], minT: 21, tree: true, gate: 0.12, k: 0.7),
            C("sandalwood", [10, 22, 30, 38], [450, 800, 1400, 3000], zones: SlopeZone, minT: 21, tree: true, gate: 0.07),
            C("rubber latex", [10, 24, 33, 45], [1200, 2000, 4000, 6000], zones: WetZone, minT: 23, tree: true, gate: 0.07, k: 0.7),
        ];
        Stimulants =
        [
            C("sugar cane", [15, 24, 37, 41], [1000, 1500, 2000, 5000], zones: WetZone, minT: 20, gate: 0.2),
            C("palm sugar and toddy", [16, 24, 32, 36], [700, 1000, 1500, 4200], minT: 22, tree: true, gate: 0.12, k: 0.5),
            C("tea", [8, 20, 30, 35], [1000, 1400, 2000, 5000], zones: ZoneTable(0, 0.4, 1, 1), minT: 12, tree: true, gate: 0.15),
            C("coffee", [10, 14, 28, 34], [750, 1400, 2300, 4200], zones: ZoneTable(0, 0.4, 1, 1), needs: CropNeed.Highland, tree: true, gate: 0.3),
            C("cacao", [10, 21, 32, 38], [900, 1200, 3000, 7600], zones: WetZone, minT: 22, tree: true, gate: 0.12),
            C("kola nut", [10, 21, 30, 35], [1200, 1400, 2500, 3500], zones: WetZone, minT: 23, tree: true, gate: 0.08, k: 0.7),
            C("betel nut", [7, 16, 33, 39], [750, 1500, 3000, 5000], minT: 21, tree: true, gate: 0.1, k: 0.7),
            C("coca", [14, 17, 23, 27], [700, 1000, 2100, 4000], zones: ZoneTable(0, 0, 0.8, 1), needs: CropNeed.Highland, tree: true, gate: 0.15, k: 0.8),
            C("tobacco", [7, 15, 30, 35], [350, 500, 750, 3000], minT: 11, gate: 0.12, k: 0.8),
        ];
        Dyes =
        [
            C("woad", [5, 14, 22, 28], [450, 600, 1000, 1500], maxT: 14, gate: 0.12, k: 0.7),
            C("madder", [8, 16, 26, 32], [350, 500, 900, 1300], minT: 9, maxT: 19, gate: 0.12, k: 0.7),
            C("weld", [6, 14, 24, 30], [400, 500, 900, 1200], minT: 7, maxT: 17, gate: 0.1, k: 0.5),
            C("indigo", [7, 22, 28, 32], [640, 1300, 1700, 3000], minT: 19, gate: 0.15),
            C("safflower", [5, 20, 32, 45], [300, 600, 1000, 1400], minT: 13, gate: 0.12, k: 0.6),
            C("henna", [13, 19, 27, 33], [250, 500, 1500, 4200], minT: 20, tree: true, gate: 0.12, k: 0.6),
            C("annatto", [15, 20, 28, 36], [1250, 1500, 2000, 2500], minT: 22, tree: true, gate: 0.1, k: 0.6),
            C("red dyewoods", [7, 26, 32, 46], [875, 1000, 1900, 2800], minT: 22, tree: true, gate: 0.07),
            C("lac", [12, 22, 32, 40], [700, 1000, 1800, 2600], minT: 21, tree: true, gate: 0.1, k: 0.7),
            C("cochineal", [10, 18, 26, 30], [300, 700, 1300, 1700], zones: SlopeZone, minT: 14, tree: true, gate: 0.06),
        ];
        int n = 0;
        foreach (Crop[] table in new[] { Grains, Produces, Orchards, Fibres, Spices, Stimulants, Dyes })
            foreach (Crop c in table)
                c.N = n++;
    }
}
