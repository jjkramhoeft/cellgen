using System.Text.Json;
using Sandbox5.Domain.Numerics;

namespace Sandbox5.Tests;

/// <summary>Hashing, PRNG, deterministic maths and noise give the TypeScript generator's values exactly.</summary>
public class NumericsParityTests
{
    private static readonly JsonElement G = Golden.Load("numerics");

    [Fact]
    public void Hashes_match()
    {
        int k = 0;
        foreach (JsonElement row in G.Get("hashes").EnumerateArray())
        {
            int a = (k * 7919) ^ 0x1234567;
            Assert.Equal(row[0].GetUInt32(), Hash.Hash4(a, k, k * 31 - 500, 1000 - k * 17));
            Assert.Equal(row[1].GetUInt32(), Hash.Hash3(a, k + 3, k * 1009 - 77));
            Assert.Equal(row[2].GetUInt32(), Hash.Pcg3(k - 20, a, -k * 13));
            k++;
        }
        Assert.Equal(48, k);
    }

    [Fact]
    public void String_hashes_and_seeds_match()
    {
        foreach (JsonElement row in G.Get("strings").EnumerateArray())
        {
            string s = row.Get("s").GetString()!;
            Assert.Equal(row.Get("hash").GetUInt32(), Hash.HashString(s));
            Assert.Equal(row.Get("seed").GetUInt32(), Hash.SeedFromText(s));
        }
    }

    [Fact]
    public void Sfc32_stream_matches()
    {
        var rng = new Sfc32(0xc0ffee);
        foreach (double v in G.Get("stream").Doubles()) Assert.Equal(v, rng.Next());
        foreach (int v in G.Get("ints").Ints()) Assert.Equal(v, rng.Int(1000));
    }

    [Fact]
    public void Deterministic_maths_match()
    {
        foreach (JsonElement row in G.Get("maths").EnumerateArray())
        {
            double x = row.Get("x").GetDouble();
            // JSON has no Infinity: the overflowing case is written as null
            if (row.Get("exp").ValueKind == JsonValueKind.Null) Assert.Equal(double.PositiveInfinity, DMath.Exp(x / 20));
            else Assert.Equal(row.Get("exp").GetDouble(), DMath.Exp(x / 20));
            if (row.Get("log").ValueKind != JsonValueKind.Null) Assert.Equal(row.Get("log").GetDouble(), DMath.Log(x));
            Assert.Equal(row.Get("sin").GetDouble(), DMath.Sin(x));
            Assert.Equal(row.Get("cos").GetDouble(), DMath.Cos(x));
            if (row.Get("pow").ValueKind == JsonValueKind.Null) continue;
            JsonElement pow = row.Get("pow");
            Assert.Equal(pow[0].GetDouble(), DMath.Pow(x, 0.4375));
            Assert.Equal(pow[1].GetDouble(), DMath.Pow(x, 3));
            Assert.Equal(pow[2].GetDouble(), DMath.Pow(x, 1.7));
            Assert.Equal(pow[3].GetDouble(), DMath.Pow(x, 0.5));
            if (pow[4].ValueKind != JsonValueKind.Null) Assert.Equal(pow[4].GetDouble(), DMath.Pow(x, -2));
        }
    }

    [Fact]
    public void Noise_matches()
    {
        var p = new FbmParams(3, 2.2, 0.55);
        foreach (JsonElement row in G.Get("noise").EnumerateArray())
        {
            double x = row[0].GetDouble();
            double y = row[1].GetDouble();
            int seed = row[2].GetInt32();
            Assert.Equal(row[3].GetDouble(), Noise.Simplex2(seed, x, y));
            Assert.Equal(row[4].GetDouble(), Noise.Perlin2(seed, x, y));
            Assert.Equal(row[5].GetDouble(), Noise.Fbm(seed, x, y, p));
            Assert.Equal(row[6].GetDouble(), Noise.PerlinFbm(seed, x, y, p));
            Assert.Equal(row[7].GetDouble(), Noise.Ridged(seed, x, y, p));
        }
    }
}
