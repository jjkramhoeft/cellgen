using System.Collections.Concurrent;
using Sandbox5.Domain.Generation;
using Sandbox5.Domain.Model;
using Sandbox5.Domain.Settings;

namespace Sandbox5.Domain;

/// <summary>What lies at one point of the map.</summary>
public sealed record PointInfo
{
    public required MapPoint Point { get; init; }
    public required bool IsOcean { get; init; }
    public required Region Region { get; init; }
    public required ElevationZone ElevationZone { get; init; }
    public required Patch Patch { get; init; }
    /// <summary>The four noise maps at the point itself: initial temperature (°C), initial precipitation (mm/yr), prosperity and supernatural index.</summary>
    public required double Temperature { get; init; }
    public required double Precipitation { get; init; }
    public required double Prosperity { get; init; }
    public required double Supernatural { get; init; }
    /// <summary>Terrain height at the point, metres (negative under water).</summary>
    public required double Height { get; init; }
    /// <summary>The nearest river node within the tolerance, if any.</summary>
    public RiverPoint? River { get; init; }
    /// <summary>The lake covering the point, if any.</summary>
    public LakeShape? Lake { get; init; }
    /// <summary>The nearest city or town location within the tolerance, if any.</summary>
    public PlacedLocation? Location { get; init; }
}

/// <summary>A point on a river: a node of a region's river network.</summary>
/// <param name="Flow">Attractors reached at and upstream of the node.</param>
/// <param name="MouthFlow">Flow of the whole river where it reaches its root.</param>
/// <param name="DrainsTo">The ocean elevation zone the river's root lies in.</param>
/// <param name="Distance">Distance from the queried point, metres.</param>
public sealed record RiverPoint(long Region, int Node, double X, double Y, int Flow, int MouthFlow, long DrainsTo, bool OverSea, double Distance);

/// <summary>
/// The world map: the aggregate root of the domain model. An unbounded, deterministic map
/// that is a pure function of its <see cref="MapSettings"/> (seed and parameters), generated
/// lazily as it is explored:
///
///   Region → ElevationZone → Patch     the three nested levels of Voronoi cells
///   oceans, rivers, lakes              per region
///   climate, height, biome             per patch (heights from the terrain, per tile)
///   resources                          24 raw resources per patch, with variants
///   city and town locations            scored per region
///   travel network                     roads, river routes and sea lanes between them
///
/// The generation layers (<see cref="World"/>, <see cref="Rivers"/>, <see cref="Terrain"/>, …)
/// are ports of the Sandbox 4 generator and give bit-identical results; the entities
/// (<see cref="Region"/>, <see cref="ElevationZone"/>, <see cref="Patch"/>) are views on them.
/// Biomes and resources always rest on exact patch heights: the terrain tile of a patch is
/// computed when first needed, so a patch's data never depends on what was explored before.
/// Thread-safe.
/// </summary>
public sealed class WorldMap
{
    public MapSettings Settings { get; }
    public string SeedText => Settings.SeedText;
    public uint Seed => Settings.Seed;

    // ---- generation layers
    public World World { get; }
    public Climate Climate { get; }
    public Rivers Rivers { get; }
    public Terrain Terrain { get; }
    /// <summary>Biomes on exact patch heights: what the map shows.</summary>
    public Biomes Biomes { get; }
    /// <summary>Biomes on zone-typical heights (no terrain): what lakes, locations and travel costs read.</summary>
    public Biomes SiteBiomes { get; }
    public Lakes Lakes { get; }
    /// <summary>Resources on exact patch heights: what the map shows.</summary>
    public Resources Resources { get; }
    public Locations Locations { get; }
    public TravelGrid TravelGrid { get; }
    /// <summary>The travel network between the locations at or above the display threshold of the settings.</summary>
    public Travel Travel { get; }
    /// <summary>The travel network between the cities only (what is drawn zoomed far out, where towns are hidden).</summary>
    public Travel CityTravel { get; }

    private readonly ConcurrentDictionary<(double MinScore, bool CitiesOnly), Travel> _travels = new();

    /// <summary>The travel network between the locations of at least a viability score (all of them, or the cities only).</summary>
    public Travel TravelFor(double minScore, bool citiesOnly = false) =>
        _travels.GetOrAdd((minScore, citiesOnly), k => new Travel(TravelGrid, Locations, new TravelParams { MinScore = k.MinScore, CitiesOnly = k.CitiesOnly }));

    private readonly ConcurrentDictionary<long, Region> _regions = new();
    private readonly ConcurrentDictionary<long, ElevationZone> _zones = new();
    private readonly ConcurrentDictionary<long, Patch> _patches = new();
    private readonly Lazy<string> _fingerprint;

    public WorldMap(MapSettings settings)
    {
        Settings = settings;
        World = new World(settings.World);
        Climate = new Climate(settings.Climate);
        Rivers = new Rivers(World, settings.Rivers);
        Terrain = new Terrain(World, Rivers, settings.Terrain);
        Biomes = new Biomes(World, Rivers, Climate, Terrain, settings.Biomes, computeHeights: true);
        SiteBiomes = new Biomes(World, Rivers, Climate, null, settings.Biomes);
        Lakes = new Lakes(World, Rivers, SiteBiomes, settings.Lakes);
        var siteResources = new Resources(World, Rivers, Lakes, SiteBiomes, Climate);
        Resources = siteResources.WithBiomes(Biomes);
        Locations = new Locations(World, Rivers, Lakes, SiteBiomes, Climate, settings.Locations, siteResources);
        TravelGrid = new TravelGrid(World, Rivers, Lakes, SiteBiomes, Terrain);
        Travel = TravelFor(settings.View.LocationMinScore);
        CityTravel = TravelFor(settings.View.LocationMinScore, citiesOnly: true);
        _fingerprint = new Lazy<string>(() => World.Fingerprint());
    }

    /// <summary>
    /// Determinism fingerprint of the base map (cells and oceans on a fixed grid around the
    /// origin): equal to the one Sandbox 4 shows for the same seed and parameters.
    /// </summary>
    public string Fingerprint => _fingerprint.Value;

    /// <summary>A rough count of what the map has memoised so far (for a cache budget).</summary>
    public long CacheCost => World.CacheSize + 20_000L * Rivers.Size + 200_000L * Terrain.TileCount;

    // ---- entities

    public Region Region(long key) => _regions.GetOrAdd(key, k => new Region(this, World.Region(k)));

    public Region Region(int i, int j) => Region(CellKeys.Pack(i, j));

    /// <summary>The (merged) elevation zone a raw zone key belongs to.</summary>
    public ElevationZone ElevationZone(long key)
    {
        long root = World.ElevationZoneRoot(key);
        return _zones.GetOrAdd(root, k => new ElevationZone(this, World.ElevationZone(k)));
    }

    /// <summary>The (merged) patch a raw patch key belongs to.</summary>
    public Patch Patch(long key)
    {
        CellInfo cell = World.PatchCell(key);
        return _patches.GetOrAdd(cell.Patch, k => new Patch(this, World.Patch(k), World.PatchCell(k)));
    }

    /// <summary>The region drawn at a point (through its patch, so borders follow patch cells).</summary>
    public Region RegionAt(double x, double y) => Region(World.CellAt(x, y).Region);

    public ElevationZone ElevationZoneAt(double x, double y) => ElevationZone(World.CellAt(x, y).ElevationZone);

    public Patch PatchAt(double x, double y) => Patch(World.CellAt(x, y).PatchRaw);

    /// <summary>The regions whose land or sea may reach into a rectangle, row by row.</summary>
    public IEnumerable<Region> RegionsIn(double x0, double y0, double x1, double y1) =>
        World.CellsIn(World.RegionLevel, Math.Min(x0, x1), Math.Min(y0, y1), Math.Max(x0, x1), Math.Max(y0, y1), 1).Select(Region);

    /// <summary>Everything at a point. Rivers and locations are found within <paramref name="tolerance"/> metres.</summary>
    public PointInfo At(double x, double y, double tolerance = 1500)
    {
        CellInfo c = World.CellAt(x, y);
        RiverPoint? river = null;
        if (Rivers.NearestNode(x, y, tolerance, computeMissing: true) is var (rr, k, d))
        {
            int root = rr.Tree[k];
            int rootIndex = Array.IndexOf(rr.Roots, root);
            river = new RiverPoint(rr.Region, k, rr.X[k], rr.Y[k], rr.Flow[k], rr.Flow[root], rootIndex >= 0 ? rr.RootOcean[rootIndex] : -1, rr.Wet[k] != 0, d);
        }
        return new PointInfo
        {
            Point = new MapPoint(x, y),
            IsOcean = c.Ocean,
            Region = Region(c.Region),
            ElevationZone = ElevationZone(c.ElevationZone),
            Patch = Patch(c.PatchRaw),
            Temperature = Climate.TemperatureAt(x, y),
            Precipitation = Climate.PrecipitationAt(x, y),
            Prosperity = Climate.ProsperityAt(x, y),
            Supernatural = Climate.SupernaturalAt(x, y),
            Height = Terrain.HeightAt(x, y, compute: true),
            River = river,
            Lake = c.Ocean ? null : Lakes.LakeAt(x, y),
            Location = Locations.Nearest(x, y, tolerance),
        };
    }

    // ---- structure helpers (shared by the entities)

    internal static OceanGenesis GenesisOf(int origin) => origin switch
    {
        Origin.Land => OceanGenesis.Land,
        Origin.LoneSeed => OceanGenesis.LoneSeed,
        Origin.LinkedSeed => OceanGenesis.LinkedSeed,
        Origin.Chain => OceanGenesis.LinkChain,
        _ => OceanGenesis.Growth,
    };

    /// <summary>Raw zones of a merged zone: the root and every neighbour-connected zone that resolves to it.</summary>
    internal long[] ZoneMembers(long root)
    {
        var seen = new HashSet<long> { root };
        var order = new List<long> { root };
        var stack = new Stack<long>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            long z = stack.Pop();
            foreach (long n in World.ElevationZoneNbrs(World.ElevationZone(z)))
            {
                if (seen.Contains(n) || World.ElevationZoneRoot(n) != root) continue;
                seen.Add(n);
                order.Add(n);
                stack.Push(n);
            }
        }
        return order.ToArray();
    }

    /// <summary>Keys of the merged patches of a merged zone, row by row (lattice j, then i).</summary>
    internal long[] ZonePatchKeys(long root) =>
        ZoneMembers(root)
            .SelectMany(m => World.ElevationZonePatches(World.ElevationZone(m)))
            .Where(pk => World.PatchRoot(pk) == pk)
            .OrderBy(pk => World.Patch(pk).J)
            .ThenBy(pk => World.Patch(pk).I)
            .ToArray();

    /// <summary>Raw patches of a merged patch: the root and every neighbour-connected patch that resolves to it.</summary>
    internal long[] PatchMembers(long root)
    {
        var seen = new HashSet<long> { root };
        var order = new List<long> { root };
        var stack = new Stack<long>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            long s = stack.Pop();
            foreach (long n in World.PatchNbrs(World.Patch(s)))
            {
                if (seen.Contains(n) || World.PatchRoot(n) != root) continue;
                seen.Add(n);
                order.Add(n);
                stack.Push(n);
            }
        }
        return order.ToArray();
    }

    /// <summary>Keys of the merged patches next to a merged patch, in key order.</summary>
    internal long[] PatchNeighbourKeys(long root)
    {
        var result = new SortedSet<long>();
        foreach (long m in PatchMembers(root))
        {
            foreach (long n in World.PatchNbrs(World.Patch(m)))
            {
                long nr = World.PatchRoot(n);
                if (nr != root) result.Add(nr);
            }
        }
        return result.ToArray();
    }
}
