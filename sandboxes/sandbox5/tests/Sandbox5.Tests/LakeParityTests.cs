using System.Text.Json;
using Sandbox5.Domain.Generation;

namespace Sandbox5.Tests;

/// <summary>The lakes of the four central regions match the TypeScript generator outline for outline.</summary>
public class LakeParityTests
{
    private static readonly JsonElement G = Golden.Load("lakes");

    [Fact]
    public void Lakes_match()
    {
        int total = 0;
        foreach (JsonElement e in G.Get("regions").EnumerateArray())
        {
            RegionLakes r = Shared.Lakes.Get(e.Get("key").GetInt64());
            Assert.Equal(e.Get("candidates").GetInt32(), r.Candidates);
            Assert.Equal(e.Get("tries").GetInt32(), r.Tries);
            Assert.Equal(e.Get("crowded").GetInt32(), r.Crowded);
            Assert.Equal(e.Get("tooSmall").GetInt32(), r.TooSmall);
            JsonElement[] lakes = e.Get("lakes").EnumerateArray().ToArray();
            Assert.Equal(lakes.Length, r.Lakes.Count);
            for (int n = 0; n < lakes.Length; n++)
            {
                JsonElement x = lakes[n];
                LakeShape l = r.Lakes[n];
                Assert.Equal(x.Get("id").GetInt32(), l.Id);
                Assert.Equal(x.Get("patch").GetInt64(), l.Patch);
                Assert.Equal(x.Get("node").GetInt32(), l.Node);
                Assert.Equal(x.Get("flow").GetInt32(), l.Flow);
                Assert.Equal(new[] { x.Get("cx").GetDouble(), x.Get("cy").GetDouble(), x.Get("nominal").GetDouble(), x.Get("size").GetDouble(), x.Get("area").GetDouble() }, new[] { l.Cx, l.Cy, l.Nominal, l.Size, l.Area });
                Assert.Equal(x.Get("outlineFp").GetString(), Golden.Fp(l.X, l.Y));
                Assert.Equal(x.Get("box").Doubles(), new[] { l.X0, l.Y0, l.X1, l.Y1 });
                Assert.True(l.Contains(l.Cx, l.Cy));
                total++;
            }
        }
        Assert.True(total > 0, "the golden regions hold no lake");
    }
}
