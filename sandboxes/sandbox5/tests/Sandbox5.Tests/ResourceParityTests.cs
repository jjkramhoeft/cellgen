using System.Text.Json;
using Sandbox5.Domain.Generation;

namespace Sandbox5.Tests;

/// <summary>
/// Biomes on exact heights, river and lake sites, bedrock and all 24 resources of every patch
/// of the four central regions match the TypeScript generator, unrounded.
/// </summary>
public class ResourceParityTests
{
    private static readonly JsonElement G = Golden.Load("resources");

    [Fact]
    public void Patch_biomes_and_resources_match()
    {
        World w = Shared.World;
        int patches = 0;
        int listed = 0;
        foreach (JsonElement region in G.Get("regions").EnumerateArray())
        {
            long rk = region.Get("key").GetInt64();
            long[] zones = Shared.Rivers.RegionElevationZones(rk);
            JsonElement[] expectedZones = region.Get("zones").EnumerateArray().ToArray();
            Assert.Equal(expectedZones.Select(z => z.Get("key").GetInt64()).ToArray(), zones);
            foreach (JsonElement z in expectedZones)
            {
                long zk = z.Get("key").GetInt64();
                long root = w.ElevationZoneRoot(zk);
                Assert.Equal(z.Get("root").GetInt64(), root);
                Assert.Equal(z.Get("bedrock").GetInt32(), Shared.Resources.Bedrock(root));
                long[] own = w.ElevationZonePatches(w.ElevationZone(zk)).Where(pk => w.PatchRoot(pk) == pk && w.PatchCell(pk).Region == rk).ToArray();
                JsonElement[] expected = z.Get("patches").EnumerateArray().ToArray();
                Assert.Equal(expected.Select(p => p.Get("key").GetInt64()).ToArray(), own);
                foreach (JsonElement e in expected)
                {
                    long pk = e.Get("key").GetInt64();
                    BiomeInfo info = Shared.Biomes.OfPatch(pk);
                    PatchResources r = Shared.Resources.OfPatch(pk);
                    string at = $"patch {pk}";
                    Assert.True(e.Get("biome").Ints().SequenceEqual(new[] { info.Biome, info.Belt, info.Moisture, info.SeaLevel, info.ZoneType }), at + " biome");
                    Assert.True(e.Get("climate").Doubles().SequenceEqual(new[] { info.T0, info.P0, info.Height, info.Cooling, info.T, info.P, info.Aridity }), at + " climate");
                    bool[] flags = e.Get("flags").EnumerateArray().Select(f => f.GetBoolean()).ToArray();
                    Assert.True(flags.SequenceEqual(new[] { info.Ocean, info.HeightExact, info.Sparse, info.Coastal }), at + " flags");
                    Assert.Equal(e.Get("bedrock").GetInt32(), r.Bedrock);
                    Assert.Equal(e.Get("prosperity").GetDouble(), r.Prosperity);
                    Assert.True(e.Get("site").Doubles().SequenceEqual(new[] { r.Site.River, r.Site.Mouth, r.Site.Lake, r.Site.Harbour ? 1 : 0, r.Site.GoldLoad, r.Site.TinLoad }), at + " site");
                    double[] amounts = e.Get("amounts").Doubles();
                    string[] variants = e.Get("variants").EnumerateArray().Select(v => v.GetString()!).ToArray();
                    for (int k = 0; k < amounts.Length; k++)
                    {
                        Assert.True(amounts[k] == r.Amount[k], $"{at} resource {k}: expected {amounts[k]}, got {r.Amount[k]}");
                        Assert.True(variants[k] == r.Variant[k], $"{at} resource {k}: expected \"{variants[k]}\", got \"{r.Variant[k]}\"");
                    }
                    Assert.Equal(e.Get("list").Ints(), r.List.Select(h => h.Resource).ToArray());
                    Assert.Equal(e.Get("food").GetDouble(), r.Food);
                    Assert.Equal(e.Get("wealth").GetDouble(), r.Wealth);
                    patches++;
                    listed += r.List.Length;
                }
            }
        }
        Assert.True(patches > 700 && listed > 4000, $"{patches} patches, {listed} resources");
    }
}
