using System.Text.Json;
using Sandbox5.Domain.Generation;

namespace Sandbox5.Tests;

/// <summary>The biome classifier, the cooling curve and the per-patch biome inputs match the TypeScript generator.</summary>
public class BiomeParityTests
{
    private static readonly JsonElement G = Golden.Load("biomes");

    [Fact]
    public void Classifier_matches()
    {
        foreach (JsonElement row in G.Get("table").EnumerateArray())
        {
            double[] e = row.Doubles();
            Classified c = Biomes.Classify(e[0], e[1]);
            Assert.Equal(new[] { e[2], e[3], e[4], e[5] }, new[] { c.Biome, c.Belt, c.Moisture, c.Aridity });
        }
    }

    [Fact]
    public void Cooling_curve_matches()
    {
        Func<double, double> cool = Biomes.CoolingCurve(Golden.Settings.Biomes.CoolH, Golden.Settings.Biomes.CoolT);
        foreach (JsonElement row in G.Get("cooling").EnumerateArray()) Assert.Equal(row[1].GetDouble(), cool(row[0].GetDouble()));
    }

    [Fact]
    public void Patch_biomes_on_estimated_heights_match()
    {
        using var rows = G.Get("patches").EnumerateArray().GetEnumerator();
        for (int j = -14; j < 14; j++)
        {
            for (int i = -14; i < 14; i++)
            {
                Assert.True(rows.MoveNext());
                JsonElement e = rows.Current;
                BiomeInfo b = Shared.EstimatedBiomes.OfPatch(CellKeys.Pack(i, j));
                Assert.Equal(e[0].GetInt64(), b.Key);
                Assert.Equal(new[] { e[1].GetInt32(), e[2].GetInt32(), e[3].GetInt32(), e[4].GetInt32(), e[5].GetInt32() }, new[] { b.Biome, b.SeaLevel, b.Belt, b.Moisture, b.ZoneType });
                Assert.Equal(new[] { e[6].GetDouble(), e[7].GetDouble(), e[8].GetDouble(), e[9].GetDouble(), e[10].GetDouble(), e[11].GetDouble() }, new[] { b.T0, b.P0, b.Height, b.T, b.P, b.Aridity });
                Assert.Equal(e[12].GetBoolean(), b.Sparse);
                Assert.Equal(e[13].GetBoolean(), b.Coastal);
            }
        }
    }
}
