using System.Text.Json;
using Sandbox5.Domain.Generation;
using Sandbox5.Domain.Settings;

namespace Sandbox5.Tests;

/// <summary>
/// Golden data: values computed by the TypeScript generator of Sandbox 4 at the frozen
/// parameters in Golden/settings.json (see scripts/export-sandbox5-golden.ts in the
/// repository root). The C# generator must reproduce them bit for bit.
/// </summary>
internal static class Golden
{
    public static string Dir { get; } = Path.Combine(AppContext.BaseDirectory, "Golden");

    private static readonly Lazy<MapSettings> LazySettings = new(() => MapSettings.Load(Path.Combine(Dir, "settings.json")));

    /// <summary>The frozen parameter baseline the golden files were generated at.</summary>
    public static MapSettings Settings => LazySettings.Value;

    public static JsonElement Load(string part)
    {
        using JsonDocument doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(Dir, part + ".json")));
        return doc.RootElement.Clone();
    }

    public static long[] Longs(this JsonElement e) => e.EnumerateArray().Select(v => v.GetInt64()).ToArray();

    public static int[] Ints(this JsonElement e) => e.EnumerateArray().Select(v => v.GetInt32()).ToArray();

    public static double[] Doubles(this JsonElement e) => e.EnumerateArray().Select(v => v.GetDouble()).ToArray();

    public static JsonElement Get(this JsonElement e, string name) => e.GetProperty(name);

    /// <summary>Fingerprint of several arrays in a row, as the TypeScript fingerprint([a, b, …]) gives.</summary>
    public static string Fp(params IEnumerable<double>[] arrays) => Sandbox5.Domain.Numerics.Hash.Fingerprint(arrays.SelectMany(a => a));

    public static IEnumerable<double> D(this IEnumerable<float> a) => a.Select(v => (double)v);

    public static IEnumerable<double> D(this IEnumerable<int> a) => a.Select(v => (double)v);

    public static IEnumerable<double> D(this IEnumerable<long> a) => a.Select(v => (double)v);

    public static IEnumerable<double> D(this IEnumerable<byte> a) => a.Select(v => (double)v);
}

/// <summary>
/// One generator at the golden settings, shared by the test classes (which run in parallel,
/// so this also exercises the thread safety of the generator).
/// </summary>
internal static class Shared
{
    public static readonly World World = new(Golden.Settings.World);
    public static readonly Rivers Rivers = new(World, Golden.Settings.Rivers);
    public static readonly Climate Climate = new(Golden.Settings.Climate);
    public static readonly Terrain Terrain = new(World, Rivers, Golden.Settings.Terrain);
    /// <summary>Biomes on estimated heights (no terrain): what the lakes read.</summary>
    public static readonly Biomes EstimatedBiomes = new(World, Rivers, Climate, null, Golden.Settings.Biomes);
    /// <summary>Biomes on exact patch heights, computing terrain tiles on demand.</summary>
    public static readonly Biomes Biomes = new(World, Rivers, Climate, Terrain, Golden.Settings.Biomes, computeHeights: true);
    public static readonly Lakes Lakes = new(World, Rivers, EstimatedBiomes, Golden.Settings.Lakes);
    /// <summary>Resources on exact patch heights (what the map shows and exports).</summary>
    public static readonly Resources Resources = new(World, Rivers, Lakes, Biomes, Climate);
    /// <summary>Locations and the travel network, on the terrain-less biomes (as in Sandbox 4).</summary>
    public static readonly Locations Locations = new(World, Rivers, Lakes, EstimatedBiomes, Climate, Golden.Settings.Locations);
    public static readonly TravelGrid TravelGrid = new(World, Rivers, Lakes, EstimatedBiomes, Terrain);
    public static readonly Travel Travel = new(TravelGrid, Locations, new TravelParams { MinScore = Golden.Settings.View.LocationMinScore, CitiesOnly = false });
}
