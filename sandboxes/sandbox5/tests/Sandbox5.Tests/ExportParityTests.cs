using System.Text.Json;
using System.Text.Json.Nodes;
using Sandbox5.Domain;
using Sandbox5.Domain.Export;

namespace Sandbox5.Tests;

/// <summary>
/// The domain model, read through the <see cref="WorldMap"/> facade and written in the
/// documented export structures, reproduces the files Sandbox 4 exports
/// (docs/map-default-structure.json and docs/network-default-structure.json, frozen in
/// Golden/ at the golden settings): every region, zone, patch, biome, height, resource,
/// location and link.
/// </summary>
public class ExportParityTests
{
    internal static readonly WorldMap Map = new(Golden.Settings);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public void Map_structure_equals_the_sandbox4_export()
    {
        JsonNode expected = JsonNode.Parse(File.ReadAllText(Path.Combine(Golden.Dir, "map-structure.json")))!;
        JsonNode actual = JsonSerializer.SerializeToNode(MapStructure.Of(Map), Json)!;
        AssertSame(expected, actual, "$");
        Assert.Equal(4, actual["regions"]!.AsArray().Count);
    }

    [Fact]
    public void Network_structure_equals_the_sandbox4_export()
    {
        JsonNode expected = JsonNode.Parse(File.ReadAllText(Path.Combine(Golden.Dir, "network-structure.json")))!;
        JsonNode actual = JsonSerializer.SerializeToNode(NetworkStructure.Of(Map), Json)!;
        AssertSame(expected, actual, "$");
        Assert.True(actual["links"]!.AsArray().Count > 300);
    }

    /// <summary>Deep equality of two JSON documents: same keys, same values, numbers compared as numbers.</summary>
    private static void AssertSame(JsonNode? expected, JsonNode? actual, string path)
    {
        if (expected is null || actual is null)
        {
            Assert.True(expected is null && actual is null, $"{path}: expected {expected?.ToJsonString() ?? "null"}, got {actual?.ToJsonString() ?? "null"}");
            return;
        }
        switch (expected)
        {
            case JsonObject eo:
                JsonObject ao = Assert.IsType<JsonObject>(actual);
                Assert.True(eo.Select(p => p.Key).Order().SequenceEqual(ao.Select(p => p.Key).Order()), $"{path}: keys {string.Join(",", eo.Select(p => p.Key))} vs {string.Join(",", ao.Select(p => p.Key))}");
                foreach (var (key, value) in eo) AssertSame(value, ao[key], $"{path}.{key}");
                break;
            case JsonArray ea:
                JsonArray aa = Assert.IsType<JsonArray>(actual);
                Assert.True(ea.Count == aa.Count, $"{path}: {ea.Count} items expected, got {aa.Count}");
                for (int i = 0; i < ea.Count; i++) AssertSame(ea[i], aa[i], $"{path}[{i}]");
                break;
            default:
                JsonElement e = expected.GetValue<JsonElement>();
                JsonElement a = actual.GetValue<JsonElement>();
                Assert.True(e.ValueKind == a.ValueKind, $"{path}: expected {expected.ToJsonString()}, got {actual.ToJsonString()}");
                if (e.ValueKind == JsonValueKind.Number) Assert.True(e.GetDouble() == a.GetDouble(), $"{path}: expected {e.GetRawText()}, got {a.GetRawText()}");
                else if (e.ValueKind == JsonValueKind.String) Assert.True(e.GetString() == a.GetString(), $"{path}: expected {e.GetRawText()}, got {a.GetRawText()}");
                break;
        }
    }
}
