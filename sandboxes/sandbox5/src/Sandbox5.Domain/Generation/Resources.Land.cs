using Sandbox5.Domain.Model;
using Sandbox5.Domain.Numerics;

namespace Sandbox5.Domain.Generation;

// The rules of one land patch: a port of the second half of world/resources.ts. The order of
// the rules, the hash stages and the deposit kinds must not change: they fix every draw.
public sealed partial class Resources
{
    private static readonly int GrainR = ResourceType.IndexOf("grain");
    private static readonly int ProduceR = ResourceType.IndexOf("produce");
    private static readonly int OrchardR = ResourceType.IndexOf("orchard");
    private static readonly int LivestockR = ResourceType.IndexOf("livestock");
    private static readonly int FishR = ResourceType.IndexOf("fish");
    private static readonly int WildR = ResourceType.IndexOf("wildFood");
    private static readonly int TimberR = ResourceType.IndexOf("timber");
    private static readonly int StoneR = ResourceType.IndexOf("stone");
    private static readonly int ClayR = ResourceType.IndexOf("clay");
    private static readonly int CrystalR = ResourceType.IndexOf("crystal");
    private static readonly int FibreR = ResourceType.IndexOf("fibre");
    private static readonly int FuelR = ResourceType.IndexOf("fuel");
    private static readonly int SaltR = ResourceType.IndexOf("salt");
    private static readonly int IronR = ResourceType.IndexOf("ironOre");
    private static readonly int CopperR = ResourceType.IndexOf("copperOre");
    private static readonly int TinR = ResourceType.IndexOf("tin");
    private static readonly int SilverR = ResourceType.IndexOf("silverLead");
    private static readonly int GoldR = ResourceType.IndexOf("gold");
    private static readonly int GemsR = ResourceType.IndexOf("gems");
    private static readonly int SpicesR = ResourceType.IndexOf("spices");
    private static readonly int StimulantsR = ResourceType.IndexOf("stimulants");
    private static readonly int FursR = ResourceType.IndexOf("furs");
    private static readonly int DyesR = ResourceType.IndexOf("dyes");
    private static readonly int HorsesR = ResourceType.IndexOf("horses");

    private const int StBedrock = 0x5e01;
    private const int StPlaya = 0x5e02;
    private const int StEvaporite = 0x5e03;
    private const int StIvory = 0x5e04;
    private const int StFur = 0x5e05;
    private const int StPick = 0x5e10;
    private const int StGate = 0x5e100;
    private const int StDeposit = 0x5e400;
    private const int StRich = 0x5e800;

    private const int Lowland = ElevationZoneType.LowlandIndex;
    private const int Hills = ElevationZoneType.HillsIndex;
    private const int Mountains = ElevationZoneType.MountainsIndex;

    private static readonly int Shield = Model.Bedrock.IndexOf("shield");
    private static readonly int Fold = Model.Bedrock.IndexOf("foldBelt");
    private static readonly int Granite = Model.Bedrock.IndexOf("granite");
    private static readonly int Volcanic = Model.Bedrock.IndexOf("volcanic");
    private static readonly int Basalt = Model.Bedrock.IndexOf("basalt");
    private static readonly int Ophiolite = Model.Bedrock.IndexOf("ophiolite");
    private static readonly int Carbonate = Model.Bedrock.IndexOf("carbonate");
    private static readonly int Clastic = Model.Bedrock.IndexOf("clastic");
    private static readonly int Alluvium = Model.Bedrock.IndexOf("alluvium");

    /// <summary>Bedrock that carries copper. Tin (granite, and placers below it) never shares a zone with these.</summary>
    private static readonly HashSet<int> CopperRock = [Volcanic, Basalt, Ophiolite, Clastic];
    /// <summary>Bedrock whose hills and mountains shed gold into the rivers.</summary>
    private static readonly HashSet<int> GoldRock = [Fold, Volcanic, Shield];

    // Per biome, in Biome.All order: ocean, ice, tundra, coldSteppe, taiga, coldDesert, grassland, shrubland,
    // mixedForest, broadleaf, tempRainforest, hotDesert, thornScrub, savanna, dryForest, rainforest, mangrove.
    /// <summary>Soil for field crops once cleared: leached under rainforest, podzol under taiga, saline in mangrove.</summary>
    private static readonly double[] Soil = [0, 0, 0.3, 1, 0.55, 1, 1, 1, 1, 1, 0.55, 1, 0.7, 0.6, 0.7, 0.4, 0.3];
    /// <summary>Ground for tree crops: not in swamp, on ice or on tundra.</summary>
    private static readonly double[] TreeGround = [0, 0, 0.2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.4];
    /// <summary>Pasture, 0–1.</summary>
    private static readonly double[] Pasture = [0, 0, 0.25, 0.7, 0.25, 0.2, 1, 0.7, 0.6, 0.6, 0.5, 0.15, 0.5, 0.8, 0.45, 0.15, 0.1];
    private static readonly double[] PastureZone = CropTables.ZoneTable(1, 1, 0.9, 0.7);
    /// <summary>Forage and game, 0–1.</summary>
    private static readonly double[] Game = [0, 0.05, 0.3, 0.3, 0.7, 0.1, 0.4, 0.45, 0.8, 0.8, 0.8, 0.05, 0.3, 0.6, 0.6, 0.6, 0.4];
    /// <summary>Standing timber, 0–1 (rivers add gallery forest in open land).</summary>
    private static readonly double[] Wood = [0, 0, 0, 0.08, 1, 0, 0.1, 0.4, 1, 1, 1, 0, 0.25, 0.35, 0.8, 1, 0.5];
    /// <summary>Furs (cold forests and tundra) and ivory, feathers and skins (hot lands), 0–1.</summary>
    private static readonly double[] Fur = [0, 0, 0.5, 0.15, 0.85, 0, 0, 0, 0.3, 0.1, 0.2, 0, 0.25, 0.4, 0.35, 0.35, 0];
    /// <summary>Share of the hot-land elevation zones with elephants, ostriches or big cats worth hunting.</summary>
    private const double IvoryZones = 0.3;
    /// <summary>Share of the cold-land elevation zones (and of the cold sea's patches) with fur animals worth trapping, at the middle of the prosperity map.</summary>
    private const double FurZones = 0.5;
    /// <summary>Horses and pack animals, 0–1.</summary>
    private static readonly double[] Mounts = [0, 0, 0, 0.9, 0, 0.5, 0.9, 0.3, 0.15, 0.15, 0, 0.5, 0.4, 0.3, 0.1, 0, 0];
    private static readonly double[] MountZone = CropTables.ZoneTable(1, 1, 0.7, 0.4);
    /// <summary>Honey and beeswax: widespread and cheap.</summary>
    private static readonly double[] Honey = [0, 0, 0, 0.1, 0.2, 0, 0.2, 0.3, 0.2, 0.3, 0.15, 0, 0.15, 0.2, 0.2, 0.15, 0.1];

    private static readonly int MangroveB = Biome.Mangrove.Index;

    private static readonly double[] ClayZone = CropTables.ZoneTable(0.7, 0.6, 0.25, 0.1);
    /// <summary>Chance of workable stone in a patch, and how rich it is, by zone type.</summary>
    private static readonly double[] StoneChance = CropTables.ZoneTable(0.04, 0.12, 0.75, 0.95);
    private static readonly double[] StoneRich = CropTables.ZoneTable(0.35, 0.5, 0.85, 1);

    private const int Polar = 0;
    private const int Boreal = 2;
    private const int Temperate = 3;
    private const int Tropical = 4;
    /// <summary>Moisture classes: Arid … Perhumid.</summary>
    private const int Arid = 0;
    private const int Humid = 3;

    /// <summary>A river irrigates: mm of water per patch it drains upstream beyond the first (up to IrrigationFull patches), by zone type.</summary>
    private const double IrrigationMm = 100;
    private const double IrrigationFull = 13;
    /// <summary>A river counts as navigable from this many patches drained upstream (as for the locations).</summary>
    private const double Navigable = 8;
    private static readonly double[] IrrigationZone = CropTables.ZoneTable(1, 1, 0.5, 0.25);
    /// <summary>The growing season is this much warmer than the yearly mean per °C the sea-level temperature lies below 24 °C, at most 12 °C.</summary>
    private const double SeasonGain = 0.5;
    /// <summary>Share of the arid river-poor flat zones that hold a salt flat, and of the clastic basins that hold salt beds.</summary>
    private const double PlayaZones = 0.08;
    private const double EvaporiteZones = 0.05;

    /// <summary>Deposit kinds: the stage of their hashed draw (never renumber: that reshuffles the deposits).</summary>
    private enum D
    {
        Stone = 1,
        Kaolin,
        Quartz,
        GlassSand,
        Coal,
        Lignite,
        OilSeep,
        SolarSalt,
        PlayaSalt,
        Natron,
        RockSalt,
        Brine,
        BogIron,
        Laterite,
        BandedIron,
        SkarnIron,
        BlackSand,
        PorphyryCopper,
        RedBedCopper,
        SulfideCopper,
        NativeCopper,
        TinLode,
        StreamTin,
        SilverVein,
        LeadZinc,
        VolcanicSilver,
        LodeGold,
        GreenstoneGold,
        EpithermalGold,
        PlacerGold,
        BeachGold,
        Diamond,
        GranitGems,
        Garnet,
        Emerald,
        Agate,
        Ruby,
        Jade,
        Lapis,
        Turquoise,
        Opal,
        Amber,
        Jet,
        Pearl,
        RiverPearl,
        Coral,
        Murex,
        Kermes,
        MuskDeer,
        SeaPearl,
        SeaCoral,
    }

    private static double Sat(double v) => v < 0 ? 0 : v > 1 ? 1 : v;

    private static double Ramp(double v, double a, double b) => Sat((v - a) / (b - a));

    /// <summary>Trapezoid: 0 at and below a, 1 on [b, c], 0 at and above d.</summary>
    private static double Trap(double v, double a, double b, double c, double d) => v <= a || v >= d ? 0 : v < b ? (v - a) / (b - a) : v <= c ? 1 : (d - v) / (d - c);

    private static double Unit(int seed, int stage, long key) => Hash.ToUnit(Hash.Hash4(seed, stage, CellKeys.I(key), CellKeys.J(key)));

    /// <summary>Everything the rules read about a land patch.</summary>
    private sealed class Env
    {
        public required int Seed;
        public required long Patch;
        public required long Zone;
        public required BiomeInfo B;
        public required string Id;
        public required int Zt;
        public required int Rock;
        public required PatchSite Site;
        /// <summary>Growing-season temperature, °C.</summary>
        public required double Tg;
        /// <summary>Length of the growing season, 0–1.</summary>
        public required double Season;
        /// <summary>Irrigation water from the patch's river, mm.</summary>
        public required double Irr;
        /// <summary>A tropical highland: tropical at sea level, temperate at its height.</summary>
        public required bool Highland;
        /// <summary>A river on flat ground: floodplain.</summary>
        public required bool Floodplain;
        /// <summary>Factor on the chances of the prosperity resources, from the prosperity map.</summary>
        public required double Boost;
        public required double[] Amount;
        public required string[] Variant;
    }

    /// <summary>Keep the larger amount of a resource, with its variant.</summary>
    private static void Put(Env e, int r, double amount, string variant)
    {
        double a = Sat(amount);
        if (a > e.Amount[r])
        {
            e.Amount[r] = a;
            e.Variant[r] = variant;
        }
    }

    /// <summary>
    /// A deposit: present with <paramref name="chance"/> (hashed per patch and kind), its
    /// richness hashed in [0.35, 1] × <paramref name="rich"/>. The chance of a precious metal,
    /// gem or luxury follows the prosperity.
    /// </summary>
    private static void Deposit(Env e, int r, D kind, double chance, string variant, double rich = 1)
    {
        if (Prosperous[r]) chance *= e.Boost;
        if (chance <= 0 || Unit(e.Seed, StDeposit + (int)kind, e.Patch) >= chance) return;
        Put(e, r, rich * (0.35 + 0.65 * Unit(e.Seed, StRich + (int)kind, e.Patch)), variant);
    }

    /// <summary>One of the options, hashed per patch and resource (flavour: which timber, which game).</summary>
    private static string Pick(Env e, int r, params string[] options) =>
        options[Hash.Hash4(e.Seed, StPick + r, CellKeys.I(e.Patch), CellKeys.J(e.Patch)) % (uint)options.Length];

    private static double CropScore(Env e, Crop c, double boost)
    {
        double s = Trap(e.Tg, c.T[0], c.T[1], c.T[2], c.T[3]);
        if (s <= 0) return 0;
        double water = e.B.P;
        if (water < c.P[1]) water = Math.Min(c.P[1], water + e.Irr);
        s *= Trap(water, c.P[0], c.P[1], c.P[2], c.P[3]);
        s *= c.Zones[e.Zt];
        if (s <= 0) return 0;
        if (c.MinT is double minT) s *= Ramp(e.B.T, minT - 2, minT);
        if (c.MaxT is double maxT) s *= 1 - Ramp(e.B.T, maxT, maxT + 2);
        s *= c.Tree ? TreeGround[e.B.Biome] : e.Season * Soil[e.B.Biome];
        if (c.Needs == CropNeed.River && e.Site.River <= 0 && e.Site.Lake <= 0) s *= 0.25;
        if (c.Needs == CropNeed.Coast && !e.B.Coastal) return 0;
        if (c.Needs == CropNeed.Highland && !e.Highland) return 0;
        if (c.K is double k) s *= k;
        if (s <= 0) return 0;
        // a regional speciality: only in some zones, in more of them where the land is prosperous
        if (c.Gate is double gate && Unit(e.Seed, StGate + c.N, e.Zone) >= gate * boost) return 0;
        return s;
    }

    /// <summary>The best crop of a table becomes the resource's amount and variant.</summary>
    private static void Crops(Env e, int r, Crop[] table)
    {
        double boost = Prosperous[r] ? e.Boost : 1;
        foreach (Crop c in table)
        {
            double s = CropScore(e, c, boost);
            if (s > e.Amount[r]) Put(e, r, s, c.Name);
        }
    }

    private static void Livestock(Env e)
    {
        string id = e.Id;
        int zt = e.Zt;
        BiomeInfo b = e.B;
        PatchSite site = e.Site;
        double a = Pasture[b.Biome] * PastureZone[zt];
        // floodplain hay meadows, and watered pasture along a desert river
        if (site.River >= 1 && b.Belt >= Boreal) a += 0.1;
        string v;
        if (zt == Mountains && b.T < 5 && id != "tundra") v = "yak";
        else if (zt == Mountains) v = id is "shrubland" or "thornScrub" ? "goats" : "alpine summer pasture";
        else if (id is "tundra" or "taiga") v = "herded reindeer";
        else if (id is "coldSteppe" or "coldDesert") v = "sheep";
        else if (id == "grassland") v = Pick(e, LivestockR, "cattle", "sheep");
        else if (id == "shrubland") v = zt == Hills ? "goats" : "sheep";
        else if (id == "broadleaf") v = Pick(e, LivestockR, "pigs", "cattle");
        else if (id is "mixedForest" or "tempRainforest") v = Pick(e, LivestockR, "cattle", "sheep");
        else if (id is "hotDesert" or "thornScrub") v = "goats";
        else if (id == "dryForest") v = e.Floodplain ? "water buffalo" : "cattle";
        else if (id is "rainforest" or "mangrove") v = Pick(e, LivestockR, "pigs", "poultry");
        else v = "cattle";
        Put(e, LivestockR, a, v);
    }

    private static void Fish(Env e)
    {
        BiomeInfo b = e.B;
        PatchSite site = e.Site;
        if (b.Coastal)
        {
            double t = b.T0;
            if (b.Biome == MangroveB) Put(e, FishR, 0.9, "crabs, lobsters and shrimp");
            else if (site.Mouth >= 2 && t < 10) Put(e, FishR, site.Harbour ? 1 : 0.85, "salmon runs");
            else
            {
                Put(e, FishR, b.Belt == Polar ? 0.6 : site.Harbour ? 1 : 0.8,
                    t < 4 ? "cod banks"
                    : t < 11 ? "herring"
                    : t < 18 ? Pick(e, FishR, "sardine and anchovy", "oysters and mussels")
                    : Pick(e, FishR, "reef fish and shellfish", "tuna and large pelagics"));
            }
        }
        double a = site.River;
        if (a > 0 && b.Belt > Polar)
        {
            double river = a >= 80 ? 0.7 : a >= Navigable ? 0.6 : a >= 2 ? 0.3 : 0.15;
            Put(e, FishR, river, a >= 80 && b.Belt <= Temperate ? "sturgeon" : a >= Navigable && b.Belt == Temperate ? Pick(e, FishR, "river fish", "eels") : "river fish");
        }
        if (site.Lake > 0) Put(e, FishR, 0.45 + 0.3 * Sat(site.Lake / 2e7), "lake fish");
    }

    private static void WildFood(Env e)
    {
        string id = e.Id;
        BiomeInfo b = e.B;
        PatchSite site = e.Site;
        int zt = e.Zt;
        double a = Game[b.Biome];
        // wetland birds and plants along the water
        if ((site.Lake > 0 || e.Floodplain) && b.Belt > Polar) a += 0.15;
        string v;
        switch (id)
        {
            case "ice":
                v = "seals";
                if (!b.Coastal) a = 0;
                break;
            case "tundra":
                v = Pick(e, WildR, "caribou", "cloudberry and crowberry");
                break;
            case "taiga":
                v = Pick(e, WildR, "deer and elk", "bilberry and blueberry", "forest mushrooms");
                break;
            case "mixedForest":
                v = Pick(e, WildR, "deer", "wild boar", "forest mushrooms");
                break;
            case "broadleaf":
                v = Pick(e, WildR, "deer", "wild boar", "acorns");
                break;
            case "tempRainforest":
                v = Pick(e, WildR, "deer", "raspberry and bramble");
                break;
            case "grassland":
                v = Pick(e, WildR, "bison and wild cattle", "hares and rabbits");
                break;
            case "coldSteppe":
                v = Pick(e, WildR, "antelope and gazelle", "upland game birds");
                break;
            case "shrubland":
                v = Pick(e, WildR, "upland game birds", "wild herbs", "hares and rabbits");
                break;
            case "mangrove":
                v = "waterfowl";
                break;
            case "coldDesert":
                v = Pick(e, WildR, "hares and rabbits", "upland game birds");
                break;
            case "rainforest":
            case "dryForest":
                v = Pick(e, WildR, "wild boar", "deer", "wild herbs");
                break;
            default:
                v = "antelope and gazelle";
                break;
        }
        if (zt == Mountains && id != "ice" && id != "tundra") v = "wild sheep and ibex";
        else if (site.Lake > 0 && b.Belt >= Temperate) v = b.Belt == Tropical ? "lotus" : "waterfowl";
        Put(e, WildR, a, v);
    }

    private static string TimberVariant(Env e)
    {
        string id = e.Id;
        int zt = e.Zt;
        BiomeInfo b = e.B;
        PatchSite site = e.Site;
        switch (id)
        {
            case "taiga":
                return zt >= Hills ? Pick(e, TimberR, "larch", "spruce") : Pick(e, TimberR, "Scots pine", "spruce");
            case "mixedForest":
                return zt == Mountains ? "fir" : zt == Hills ? Pick(e, TimberR, "beech", "spruce") : Pick(e, TimberR, "oak", "Scots pine", "lime");
            case "broadleaf":
                if (zt == Mountains) return b.T >= 12 ? "cedar" : "beech";
                if (zt == Hills) return Pick(e, TimberR, "beech", "oak");
                return e.Floodplain ? Pick(e, TimberR, "oak", "ash", "elm") : "oak";
            case "tempRainforest":
                return "giant conifers";
            case "shrubland":
                if (b.T < 10) return zt >= Hills ? "juniper" : Pick(e, TimberR, "oak", "Scots pine", "juniper");
                return zt >= Hills ? Pick(e, TimberR, "cypress", "Mediterranean pines") : Pick(e, TimberR, "cork oak", "Mediterranean pines");
            case "dryForest":
                return b.P >= 1500 ? Pick(e, TimberR, "teak", "sal") : Pick(e, TimberR, "teak", "Spanish cedar", "rosewood");
            case "rainforest":
                return Pick(e, TimberR, "mahogany", "iroko", "rosewood", "ebony", "mahogany", "iroko");
            case "savanna":
                return site.River >= 1 ? "African mahogany" : "thorn-scrub wood";
            case "thornScrub":
                return "thorn-scrub wood";
            case "mangrove":
                return "mangrove timber";
            case "hotDesert":
            case "coldDesert":
                return "poplar";
            case "tundra":
            case "ice":
                return "driftwood";
            default:
                // grassland and steppe: gallery woods along the rivers, juniper on the hills
                return site.River >= 1 ? "willow and poplar" : "juniper";
        }
    }

    private static void Timber(Env e)
    {
        string id = e.Id;
        BiomeInfo b = e.B;
        PatchSite site = e.Site;
        int zt = e.Zt;
        double a = Wood[b.Biome];
        if (id is "grassland" or "coldSteppe")
        {
            if (site.River >= 1) a += 0.2;
            else if (zt >= Hills) a += 0.07;
        }
        else if (id is "hotDesert" or "coldDesert") a = site.River >= 2 ? 0.3 : 0;
        else if (id == "tundra") a = b.Coastal ? 0.1 : 0;
        // above the tree line the forest thins
        if (zt == Mountains && a > 0.6) a *= 0.8;
        if (a > 0) Put(e, TimberR, a, TimberVariant(e));
    }

    private static void Stone(Env e)
    {
        int zt = e.Zt;
        int rock = e.Rock;
        double chance = StoneChance[zt];
        string v;
        if (rock == Shield || rock == Granite) v = "granite";
        else if (rock == Fold) v = zt == Mountains ? Pick(e, StoneR, "slate", "slate", "marble") : Pick(e, StoneR, "slate", "whetstone", "slate");
        else if (rock == Volcanic) v = Pick(e, StoneR, "basalt", "pumice and pozzolana", "obsidian", "basalt");
        else if (rock == Basalt)
        {
            v = Pick(e, StoneR, "basalt", "basalt", "millstone and quern stone");
            chance *= 2;
        }
        else if (rock == Ophiolite) v = "soapstone";
        else if (rock == Carbonate)
        {
            v = zt <= Lowland ? Pick(e, StoneR, "chalk", "limestone", "flint and chert") : Pick(e, StoneR, "limestone", "limestone", "marble");
            chance *= 2.5;
        }
        else if (rock == Clastic)
        {
            v = Pick(e, StoneR, "sandstone", "sandstone", "millstone and quern stone");
            chance *= 1.6;
        }
        else
        {
            v = "field stone and boulders";
            chance *= 0.5;
        }
        Deposit(e, StoneR, D.Stone, chance, v, StoneRich[zt]);
    }

    private static void Clay(Env e)
    {
        string id = e.Id;
        int zt = e.Zt;
        BiomeInfo b = e.B;
        int rock = e.Rock;
        PatchSite site = e.Site;
        if (id == "ice") return;
        double a = ClayZone[zt];
        if (site.River >= 1 && zt <= Lowland) a += 0.3;
        if (rock == Alluvium) a += 0.1;
        if (id == "tundra") a *= 0.3;
        bool dry = b.Aridity < 1;
        string v = dry && b.Belt >= Temperate ? "adobe and mud-brick earth"
            : site.River >= 1 ? "brick and pottery clay"
            : id is "mixedForest" or "broadleaf" ? "wattle and daub"
            : dry || id == "shrubland" ? "rammed earth and cob"
            : "brick and pottery clay";
        Put(e, ClayR, a, v);
        // porcelain clay: deeply weathered granite in warm, wet climates
        if ((rock == Granite || rock == Shield) && b.T >= 10 && b.Moisture >= Humid && zt != Mountains) Deposit(e, ClayR, D.Kaolin, 0.05, "kaolin", 1.2);
    }

    private static void Crystal(Env e)
    {
        int zt = e.Zt;
        int rock = e.Rock;
        if (zt >= Hills)
        {
            int k = rock == Volcanic ? 3 : rock == Granite || rock == Fold ? 2 : 1;
            Deposit(e, CrystalR, D.Quartz, (zt == Mountains ? 0.05 : 0.03) * k, "rock crystal");
        }
        else
        {
            // pure quartz sand: coastal dunes and the rivers of the lowlands
            double chance = (e.B.Coastal ? 0.03 : 0) + (e.Site.River >= Navigable ? 0.015 : 0);
            Deposit(e, CrystalR, D.GlassSand, chance, "glass sand", 0.8);
        }
    }

    private static void Fuel(Env e)
    {
        string id = e.Id;
        int zt = e.Zt;
        BiomeInfo b = e.B;
        int rock = e.Rock;
        if (e.Amount[TimberR] > 0) Put(e, FuelR, 0.9 * e.Amount[TimberR], id == "mangrove" ? "charcoal" : e.Amount[TimberR] >= 0.7 ? Pick(e, FuelR, "firewood", "charcoal") : "firewood");
        // peat: cool, wet, low ground
        if (zt <= Lowland && b.Moisture >= Humid && b.T < 10 && b.Belt >= Boreal) Put(e, FuelR, 0.6, "peat");
        if (id == "tundra") Put(e, FuelR, zt <= Lowland ? 0.35 : 0.2, "turf and sod");
        // dung of the herds where there is no wood
        if (e.Amount[LivestockR] >= 0.15) Put(e, FuelR, 0.35 * e.Amount[LivestockR], "dung fuel");
        if (rock == Clastic)
        {
            if (zt == Hills || zt == Lowland) Deposit(e, FuelR, D.Coal, 0.04, "coal");
            if (zt <= Lowland)
            {
                Deposit(e, FuelR, D.Lignite, 0.04, "lignite", 0.7);
                Deposit(e, FuelR, D.OilSeep, 0.01, "oil and naphtha seeps", 0.8);
            }
        }
    }

    private static void Salt(Env e)
    {
        int zt = e.Zt;
        BiomeInfo b = e.B;
        int rock = e.Rock;
        // solar pans need evaporation above the rainfall: dry, warm, low coasts
        if (b.Coastal && zt <= Lowland && b.Aridity < 1 && b.T >= 12) Deposit(e, SaltR, D.SolarSalt, 0.25, "solar sea salt");
        // salt flats: a few of the river-poor flat zones are closed basins
        if (b.Sparse && b.Moisture == Arid && Unit(e.Seed, StPlaya, e.Zone) < PlayaZones)
        {
            Deposit(e, SaltR, D.PlayaSalt, 0.3, "lake and playa salt");
            Deposit(e, SaltR, D.Natron, 0.05, "natron and soda", 0.8);
        }
        // salt beds and brine springs: a few of the old basins have an evaporite member
        if (rock == Clastic && zt != Mountains && Unit(e.Seed, StEvaporite, e.Zone) < EvaporiteZones)
        {
            Deposit(e, SaltR, D.RockSalt, 0.12, "rock salt");
            Deposit(e, SaltR, D.Brine, 0.08, "brine springs", 0.8);
        }
    }

    private static void Metals(Env e)
    {
        string id = e.Id;
        int zt = e.Zt;
        BiomeInfo b = e.B;
        int rock = e.Rock;
        PatchSite site = e.Site;
        bool high = zt >= Hills;

        // iron
        if (zt <= Lowland && b.Moisture >= Humid && id is "taiga" or "mixedForest" or "broadleaf" or "tempRainforest") Deposit(e, IronR, D.BogIron, site.River >= 1 || site.Lake > 0 ? 0.1 : 0.05, "bog iron", 0.7);
        if (zt != Mountains && id is "rainforest" or "dryForest" or "savanna") Deposit(e, IronR, D.Laterite, 0.1, "lateritic iron and ironstone", 0.8);
        if (rock == Shield && (zt == Hills || zt == Lowland)) Deposit(e, IronR, D.BandedIron, 0.08, "banded iron formation");
        if ((rock == Granite || rock == Carbonate) && high) Deposit(e, IronR, D.SkarnIron, 0.06, "magnetite skarn iron");
        if (b.Coastal && rock == Basalt) Deposit(e, IronR, D.BlackSand, 0.05, "black sands", 0.6);

        // copper: arcs, ophiolites, basalts and red beds
        if (rock == Volcanic && high) Deposit(e, CopperR, D.PorphyryCopper, zt == Mountains ? 0.1 : 0.05, Pick(e, CopperR, "porphyry copper", "malachite and azurite", "porphyry copper"));
        if (rock == Clastic && (zt == Lowland || zt == Hills)) Deposit(e, CopperR, D.RedBedCopper, 0.03, "red-bed copper", 0.8);
        if (rock == Ophiolite && high) Deposit(e, CopperR, D.SulfideCopper, 0.08, "massive-sulfide copper");
        if (rock == Basalt && zt >= Lowland) Deposit(e, CopperR, D.NativeCopper, zt == Lowland ? 0.02 : 0.06, "native copper", 0.8);

        // tin: granite, and the streams below it (never in a copper zone)
        if (rock == Granite && high) Deposit(e, TinR, D.TinLode, 0.06, "tin lode");
        if (!CopperRock.Contains(rock) && zt != Mountains && site.River >= 1) Deposit(e, TinR, D.StreamTin, 0.35 * site.TinLoad, "stream tin", 0.4 + 0.6 * site.TinLoad);

        // silver and lead
        if (rock == Fold && high) Deposit(e, SilverR, D.SilverVein, 0.05, "silver");
        if (rock == Carbonate && (zt == Hills || zt == Lowland)) Deposit(e, SilverR, D.LeadZinc, zt == Hills ? 0.06 : 0.025, Pick(e, SilverR, "lead-zinc in carbonates", "calamine", "lead-zinc in carbonates"), 0.8);
        if (rock == Volcanic && zt == Mountains) Deposit(e, SilverR, D.VolcanicSilver, 0.03, "lead-zinc skarns and veins");

        // gold: lodes in the mountains, placers where their rivers reach flatter ground
        if (rock == Fold && high) Deposit(e, GoldR, D.LodeGold, 0.03, "lode gold");
        if (rock == Shield && zt == Hills) Deposit(e, GoldR, D.GreenstoneGold, 0.03, "lode gold");
        if (rock == Volcanic && zt == Mountains) Deposit(e, GoldR, D.EpithermalGold, 0.03, "epithermal and hot-spring gold-silver");
        if (zt != Mountains && site.River >= 1) Deposit(e, GoldR, D.PlacerGold, 0.2 * site.GoldLoad, "placer gold", 0.4 + 0.6 * site.GoldLoad);
        if (b.Coastal && site.Mouth >= 2) Deposit(e, GoldR, D.BeachGold, 0.1 * site.GoldLoad, "beach gold", 0.6);
    }

    private static void Gems(Env e)
    {
        string id = e.Id;
        int zt = e.Zt;
        BiomeInfo b = e.B;
        int rock = e.Rock;
        PatchSite site = e.Site;
        bool high = zt >= Hills;
        bool desert = id is "hotDesert" or "coldDesert" or "thornScrub";
        if (rock == Shield && zt != Mountains) Deposit(e, GemsR, D.Diamond, 0.004, "diamond");
        if (rock == Granite && high) Deposit(e, GemsR, D.GranitGems, 0.04, "topaz, beryl and tourmaline");
        if (rock == Fold && high)
        {
            Deposit(e, GemsR, D.Garnet, 0.03, "garnet", 0.7);
            Deposit(e, GemsR, D.Emerald, 0.004, "emerald");
        }
        if ((rock == Volcanic || rock == Basalt) && high) Deposit(e, GemsR, D.Agate, 0.04, "amethyst and agate", 0.7);
        if ((rock == Basalt || rock == Carbonate) && zt == Mountains) Deposit(e, GemsR, D.Ruby, 0.008, "ruby and sapphire");
        if (rock == Ophiolite && high) Deposit(e, GemsR, D.Jade, 0.04, "jade");
        if (rock == Carbonate && zt == Mountains) Deposit(e, GemsR, D.Lapis, 0.012, "lapis lazuli");
        // arid weathering over copper, and in the dry basins
        if (desert && high && (rock == Volcanic || rock == Clastic)) Deposit(e, GemsR, D.Turquoise, 0.04, "turquoise");
        if (desert && (zt == Lowland || zt == Hills) && (rock == Clastic || rock == Basalt)) Deposit(e, GemsR, D.Opal, 0.012, "opal");
        if (b.Coastal)
        {
            if (b.T < 12 && b.Belt >= Boreal && (rock == Clastic || rock == Alluvium)) Deposit(e, GemsR, D.Amber, 0.03, "amber");
            if (rock == Clastic && zt == Hills) Deposit(e, GemsR, D.Jet, 0.02, "jet", 0.6);
            if (b.T0 >= 20) Deposit(e, GemsR, D.Pearl, 0.04, "pearl oyster");
            else if (b.T0 >= 11 && high) Deposit(e, GemsR, D.Coral, 0.03, "precious red coral");
        }
        if (site.River >= 2 && b.T < 9 && b.Belt >= Boreal) Deposit(e, GemsR, D.RiverPearl, 0.006, "freshwater pearl mussel", 0.7);
    }

    private static void Furs(Env e)
    {
        string id = e.Id;
        int zt = e.Zt;
        BiomeInfo b = e.B;
        PatchSite site = e.Site;
        double a = Fur[b.Biome];
        // a regional speciality, in more of the zones where the land is prosperous: ivory and skins in the hot lands, furs in the cold
        bool here = b.Belt == Tropical ? Unit(e.Seed, StIvory, e.Zone) < IvoryZones * e.Boost : Unit(e.Seed, StFur, e.Zone) < FurZones * e.Boost;
        string v;
        switch (id)
        {
            case "taiga":
                v = site.River >= 1 ? Pick(e, FursR, "beaver", "sable and marten") : Pick(e, FursR, "sable and marten", "squirrel", "ermine");
                break;
            case "tundra":
                v = b.Coastal ? Pick(e, FursR, "walrus", "seals", "fox and Arctic fox") : "fox and Arctic fox";
                if (b.Coastal) a += 0.15;
                break;
            case "ice":
                v = Pick(e, FursR, "walrus", "seals", "narwhal tusk");
                a = b.Coastal ? 0.5 : 0;
                break;
            case "mixedForest":
            case "tempRainforest":
                v = zt >= Hills ? "bear" : site.River >= 1 ? "beaver" : Pick(e, FursR, "squirrel", "sable and marten");
                break;
            case "broadleaf":
                v = "fox and Arctic fox";
                break;
            case "coldSteppe":
                v = "fox and Arctic fox";
                break;
            case "savanna":
                v = Pick(e, FursR, "elephant ivory", "ostrich", "big cats");
                break;
            case "thornScrub":
                v = "ostrich";
                break;
            case "dryForest":
                v = Pick(e, FursR, "elephant ivory", "big cats");
                break;
            case "rainforest":
                v = Pick(e, FursR, "exotic feathers", "big cats", "elephant ivory");
                break;
            default:
                v = "";
                break;
        }
        // cold coasts: seals
        if (v.Length == 0 && b.Coastal && b.T0 < 3)
        {
            a = 0.3;
            v = "seals";
        }
        if (here && a > 0 && v.Length > 0) Put(e, FursR, a, v);
        if (zt == Mountains && b.Belt == Boreal) Deposit(e, FursR, D.MuskDeer, 0.03, "musk deer");
    }

    private static void Dyes(Env e)
    {
        string id = e.Id;
        int zt = e.Zt;
        BiomeInfo b = e.B;
        Crops(e, DyesR, CropTables.Dyes);
        if (b.Coastal && zt >= Hills && b.T0 >= 12 && b.T0 < 21) Deposit(e, DyesR, D.Murex, 0.06, "murex");
        if (id == "shrubland" && zt == Hills && b.T >= 12) Deposit(e, DyesR, D.Kermes, 0.06, "kermes");
        if (id is "tundra" or "tempRainforest") Put(e, DyesR, 0.15, "lichen dyes");
    }

    private static void Horses(Env e)
    {
        string id = e.Id;
        int zt = e.Zt;
        BiomeInfo b = e.B;
        double a = Mounts[b.Biome] * MountZone[zt];
        string v;
        if (id is "hotDesert" or "thornScrub") v = zt >= Hills ? "donkeys and mules" : "dromedary camel";
        else if (id == "coldDesert") v = "Bactrian camel";
        else if (e.Highland && zt == Mountains)
        {
            v = "llama and alpaca-like camelids";
            a = Math.Max(a, 0.5 * Pasture[b.Biome]);
        }
        else if (zt >= Hills)
        {
            v = "donkeys and mules";
            a = Math.Max(a, 0.3 * Pasture[b.Biome]);
        }
        else v = "horses";
        Put(e, HorsesR, a, v);
    }

    /// <summary>
    /// The resources of a land patch from its biome record, the (merged) elevation zone it
    /// lies in, that zone's bedrock, its river and lake site and the prosperity there (0–1; the
    /// middle, 0.5, leaves every chance as it is). A pure function.
    /// </summary>
    public static PatchResources LandResources(int seed, BiomeInfo b, long zone, int bedrock, PatchSite site, double prosperity = 0.5)
    {
        int zt = b.ZoneType;
        double gain = SeasonGain * (24 - b.T0);
        var e = new Env
        {
            Seed = seed,
            Patch = b.Key,
            Zone = zone,
            B = b,
            Id = Biome.All[b.Biome].Id,
            Zt = zt,
            Rock = bedrock,
            Site = site,
            Tg = b.T + (gain < 0 ? 0 : gain > 12 ? 12 : gain),
            Season = Ramp(b.T, -4, 6),
            Irr = (site.River > 1 ? IrrigationMm * (Math.Min(site.River, IrrigationFull) - 1) * IrrigationZone[zt] : 0) + (site.Lake > 0 ? 2 * IrrigationMm : 0),
            Highland = b.T0 >= ThermalBelt.All[Tropical].MinTemperature && b.Belt == Temperate,
            Floodplain = site.River >= 1 && zt <= Lowland,
            Boost = ProsperityBoost(prosperity),
            Amount = new double[ResourceCount],
            Variant = Enumerable.Repeat("", ResourceCount).ToArray(),
        };
        Crops(e, GrainR, CropTables.Grains);
        Crops(e, ProduceR, CropTables.Produces);
        Crops(e, OrchardR, CropTables.Orchards);
        Livestock(e);
        Fish(e);
        WildFood(e);
        Timber(e);
        Stone(e);
        Clay(e);
        Crystal(e);
        Crops(e, FibreR, CropTables.Fibres);
        Fuel(e);
        Salt(e);
        Metals(e);
        Gems(e);
        Crops(e, SpicesR, CropTables.Spices);
        Crops(e, StimulantsR, CropTables.Stimulants);
        Put(e, StimulantsR, Honey[b.Biome], "honey and beeswax");
        Furs(e);
        Dyes(e);
        Horses(e);
        return Finish(b.Key, false, bedrock, e.Amount, e.Variant, site, prosperity);
    }
}
