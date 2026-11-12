using Sandbox5.Domain.Generation;

namespace Sandbox5.Domain.Model;

/// <summary>A position on the map, metres. x grows eastwards, y grows southwards (as on screen).</summary>
public readonly record struct MapPoint(double X, double Y);

/// <summary>How an elevation zone came to be ocean.</summary>
public enum OceanGenesis
{
    Land,
    /// <summary>An ocean seed that linked to no other seed: a single-zone sea.</summary>
    LoneSeed,
    /// <summary>An ocean seed on a link to another seed.</summary>
    LinkedSeed,
    /// <summary>A zone on the straight line between two linked seeds.</summary>
    LinkChain,
    /// <summary>Converted by a neighbouring ocean zone in a growth pass.</summary>
    Growth,
}

/// <summary>An amount of one raw resource in a patch, with the catalogue variant behind it.</summary>
/// <param name="Amount">0–1: the suitability of a potential, the richness of a deposit.</param>
public readonly record struct ResourceYield(ResourceType Type, double Amount, string Variant);

/// <summary>The climate a patch's biome was classified from.</summary>
/// <param name="SeaLevelTemperature">Initial temperature at the patch's site, °C.</param>
/// <param name="InitialPrecipitation">Initial precipitation at the site, mm per year.</param>
/// <param name="Cooling">How much cooler the patch's height makes it, °C.</param>
/// <param name="Temperature">Temperature after the height cooling, °C.</param>
/// <param name="Precipitation">Effective precipitation (reduced in a river-poor flat zone), mm per year.</param>
/// <param name="Aridity">P / P_th with Köppen's dryness threshold: below 0.5 desert, 0.5–1 steppe.</param>
public sealed record PatchClimate(double SeaLevelTemperature, double InitialPrecipitation, double Cooling, double Temperature, double Precipitation, double Aridity);

/// <summary>
/// A region: one of the large cells (128 km by default). It groups elevation zones and is the
/// unit oceans, rivers, lakes, locations and the travel network are laid out in.
/// </summary>
public sealed class Region
{
    private readonly WorldMap _map;
    private readonly RegionNode _node;
    private IReadOnlyList<ElevationZone>? _zones;

    internal Region(WorldMap map, RegionNode node)
    {
        _map = map;
        _node = node;
    }

    /// <summary>Unique id of the region: its packed lattice cell.</summary>
    public long Key => _node.Key;
    /// <summary>Column and row on the region lattice.</summary>
    public int I => _node.I;
    public int J => _node.J;
    /// <summary>The region's site.</summary>
    public MapPoint Site => new(_node.X, _node.Y);

    /// <summary>
    /// The region's elevation zones after merging: every merged zone whose own site lies in
    /// the region (a zone that merged into a zone of another region is listed there).
    /// </summary>
    public IReadOnlyList<ElevationZone> ElevationZones =>
        _zones ??= _node.ElevationZones.Where(zk => _map.World.ElevationZoneRoot(zk) == zk).Select(_map.ElevationZone).ToArray();

    /// <summary>Raw elevation zones the region picked as ocean seeds.</summary>
    public IReadOnlyList<long> OceanSeeds => _node.Seeds;

    /// <summary>Links between ocean seeds that start in this region.</summary>
    public IReadOnlyList<SeedLink> SeedLinks => _map.World.Links(Key);

    /// <summary>The river network of the region: space-colonization trees rooted in the ocean zones around it.</summary>
    public RegionRivers Rivers => _map.Rivers.Get(Key);

    /// <summary>The lakes of the region, each on a river.</summary>
    public IReadOnlyList<LakeShape> Lakes => _map.Lakes.Get(Key).Lakes;

    /// <summary>The potential city and town locations of the region, best score first.</summary>
    public IReadOnlyList<PlacedLocation> Locations => _map.Locations.Get(Key).List;

    /// <summary>The links of the travel network this region owns (roads, river routes, sea lanes).</summary>
    public IReadOnlyList<TravelEdge> TravelLinks => _map.Travel.Get(Key).Edges;

    public override string ToString() => $"Region ({I}, {J})";
}

/// <summary>
/// An elevation zone: one of the medium cells (32 km by default), after merging. The
/// land/ocean unit of the map; a land zone is flat, lowland, hills or mountains and has one
/// bedrock class.
/// </summary>
public sealed class ElevationZone
{
    private readonly WorldMap _map;
    private readonly ZoneNode _node;
    private IReadOnlyList<long>? _members;
    private IReadOnlyList<Patch>? _patches;

    internal ElevationZone(WorldMap map, ZoneNode node)
    {
        _map = map;
        _node = node;
    }

    /// <summary>Unique id of the zone: the packed lattice cell of the cell the others merged into.</summary>
    public long Key => _node.Key;
    public int I => _node.I;
    public int J => _node.J;
    public MapPoint Site => new(_node.X, _node.Y);

    /// <summary>The region the zone is drawn in: the one containing its site.</summary>
    public Region Region => _map.Region(_node.Region);

    public bool IsOcean => _map.World.Ocean(Key);

    public ElevationZoneType Type => ElevationZoneType.Of(Key, IsOcean);

    /// <summary>Why the zone is ocean (Land for a land zone).</summary>
    public OceanGenesis Genesis => WorldMap.GenesisOf(_map.World.ElevationZoneCell(Key).Origin);

    /// <summary>The growth pass that converted the zone (1…), or 0 when it is not ocean by growth.</summary>
    public int GrowthPass
    {
        get
        {
            int origin = _map.World.ElevationZoneCell(Key).Origin;
            return origin >= Origin.Grow ? origin - Origin.Grow + 1 : 0;
        }
    }

    /// <summary>The bedrock that places the zone's deposits; null for ocean.</summary>
    public Bedrock? Bedrock
    {
        get
        {
            int index = _map.Resources.Bedrock(Key);
            return index < 0 ? null : Model.Bedrock.All[index];
        }
    }

    /// <summary>A river-poor flat zone: few rivers, drier, no lakes.</summary>
    public bool IsRiverPoor => !IsOcean && _map.Rivers.IsSparseFlat(Key);

    /// <summary>The raw lattice cells merged into this zone (this zone's own first).</summary>
    public IReadOnlyList<long> Members => _members ??= _map.ZoneMembers(Key);

    public bool IsMerged => Members.Count > 1;

    /// <summary>The zone's patches after merging, row by row.</summary>
    public IReadOnlyList<Patch> Patches => _patches ??= _map.ZonePatchKeys(Key).Select(_map.Patch).ToArray();

    public override string ToString() => $"{Type.Name} zone ({I}, {J})";
}

/// <summary>
/// A patch: one of the small cells (8 km by default), after merging. The detail unit of the
/// map: it has a biome, a climate, a height and its resources.
/// </summary>
public sealed class Patch
{
    private readonly WorldMap _map;
    private readonly PatchNode _node;
    private readonly CellInfo _cell;

    internal Patch(WorldMap map, PatchNode node, CellInfo cell)
    {
        _map = map;
        _node = node;
        _cell = cell;
    }

    /// <summary>Unique id of the patch: the packed lattice cell of the cell the others merged into.</summary>
    public long Key => _node.Key;
    public int I => _node.I;
    public int J => _node.J;
    public MapPoint Site => new(_node.X, _node.Y);

    public ElevationZone ElevationZone => _map.ElevationZone(_cell.ElevationZone);

    public Region Region => _map.Region(_cell.Region);

    public bool IsOcean => _cell.Ocean;

    /// <summary>Part of a merged group of lattice cells.</summary>
    public bool IsMerged => _cell.PatchMerged;

    /// <summary>Everything that went into the patch's biome, on its exact mean height.</summary>
    public BiomeInfo BiomeInfo => _map.Biomes.OfPatch(Key);

    public Biome Biome => Biome.All[BiomeInfo.Biome];

    /// <summary>The thermal belt and moisture class behind the biome; null for ocean.</summary>
    public ThermalBelt? Belt => IsOcean ? null : ThermalBelt.All[BiomeInfo.Belt];

    public MoistureClass? Moisture => IsOcean ? null : (MoistureClass)BiomeInfo.Moisture;

    /// <summary>The climate the biome was classified from; null for ocean.</summary>
    public PatchClimate? Climate
    {
        get
        {
            if (IsOcean) return null;
            BiomeInfo b = BiomeInfo;
            return new PatchClimate(b.T0, b.P0, b.Cooling, b.T, b.P, b.Aridity);
        }
    }

    /// <summary>Mean height of the patch's land, metres (0 for ocean).</summary>
    public double Height => IsOcean ? 0 : BiomeInfo.Height;

    /// <summary>A land patch bordering the ocean.</summary>
    public bool IsCoastal => BiomeInfo.Coastal;

    /// <summary>The prosperity map at the patch's site, 0–1 between its minimum and maximum.</summary>
    public double Prosperity => PatchResources.Prosperity;

    /// <summary>The supernatural map at the patch's site (unitless index): how strong magic is here.</summary>
    public double Supernatural => _map.Climate.SupernaturalAt(_node.X, _node.Y);

    /// <summary>The full resource record of the patch: every amount, the river and lake site, food and trade goods.</summary>
    public PatchResources PatchResources => _map.Resources.OfPatch(Key);

    /// <summary>The patch's resources of a listable amount, largest first.</summary>
    public IReadOnlyList<ResourceYield> Resources =>
        PatchResources.List.Select(h => new ResourceYield(ResourceType.All[h.Resource], h.Amount, h.Variant)).ToArray();

    /// <summary>The amount of one resource (0 when the patch has none).</summary>
    public ResourceYield Resource(ResourceType type)
    {
        PatchResources r = PatchResources;
        return new ResourceYield(type, r.Amount[type.Index], r.Variant[type.Index]);
    }

    /// <summary>Why the patch may not hold a lake (None when it may).</summary>
    public LakeBlock LakeBlock => _map.Lakes.Block(Key);

    /// <summary>The patch as a site for a city or town: its viability score and factors; null for ocean.</summary>
    public LocationCandidate? SiteCandidate => IsOcean ? null : _map.Locations.Get(_cell.Region).ByPatch.GetValueOrDefault(Key);

    /// <summary>The city or town location placed in the patch, if any.</summary>
    public PlacedLocation? Location => IsOcean ? null : _map.Locations.Get(_cell.Region).List.FirstOrDefault(l => l.Patch == Key);

    /// <summary>Neighbouring patches (Gabriel neighbours of the patch's cells, after merging).</summary>
    public IReadOnlyList<Patch> Neighbours => _map.PatchNeighbourKeys(Key).Select(_map.Patch).ToArray();

    public override string ToString() => $"{Biome.Name} patch ({I}, {J})";
}
