using System.Text.Json;
using Sandbox5.Domain.Generation;

namespace Sandbox5.Tests;

/// <summary>River bed profiles and height tiles match the TypeScript generator cell for cell.</summary>
public class TerrainParityTests
{
    private static readonly JsonElement G = Golden.Load("terrain");

    [Fact]
    public void Beds_and_tiles_match()
    {
        // an own instance: the golden point heights are read from "the tiles computed so far", in this order
        var t = new Terrain(Shared.World, Shared.Rivers, Golden.Settings.Terrain);
        Assert.Equal(G.Get("k").GetInt32(), t.K);
        foreach (JsonElement e in G.Get("regions").EnumerateArray())
        {
            long key = e.Get("key").GetInt64();
            double[] bed = t.Bed(key);
            double[] head = e.Get("bedHead").Doubles();
            Assert.Equal(head, bed.Take(head.Length).ToArray());
            Assert.Equal(e.Get("bedFp").GetString(), Golden.Fp(bed));

            TerrainTile tile = t.Get(key);
            Assert.Equal(e.Get("tile").GetInt64(), tile.Tile);
            Assert.Equal(e.Get("x0").GetDouble(), tile.X0);
            Assert.Equal(e.Get("y0").GetDouble(), tile.Y0);
            Assert.Equal(e.Get("res").GetDouble(), tile.Res);
            Assert.Equal(e.Get("nx").GetInt32(), tile.Nx);
            Assert.Equal(e.Get("ny").GetInt32(), tile.Ny);
            Assert.Equal(e.Get("regKeys").Longs(), tile.RegKeys);
            Assert.Equal(e.Get("clsFp").GetString(), Golden.Fp(tile.Cls.D()));
            Assert.Equal(e.Get("regFp").GetString(), Golden.Fp(tile.Reg.D()));
            foreach (JsonElement s in e.Get("samples").EnumerateArray())
            {
                int q = s[0].GetInt32();
                Assert.Equal(s[1].GetDouble(), (double)tile.H[q]);
                Assert.Equal(s[2].GetInt32(), tile.Cls[q]);
                Assert.Equal(s[3].GetInt32(), tile.Reg[q]);
            }
            Assert.Equal(e.Get("hFp").GetString(), Golden.Fp(tile.H.D()));
            Assert.Equal(e.Get("filled").GetInt32(), tile.Filled);
            Assert.Equal(e.Get("maxFill").GetDouble(), tile.MaxFill);
            Assert.Equal(e.Get("patches").GetInt32(), tile.PatchKeys.Length);
            Assert.Equal(e.Get("patchKeyFp").GetString(), Golden.Fp(tile.PatchKeys.D()));
            Assert.Equal(e.Get("patchHFp").GetString(), Golden.Fp(tile.PatchH.D()));

            RegionNode r = Shared.World.Region(key);
            double[] fs = [0.13, 0.41, 0.77];
            JsonElement[] heights = e.Get("heights").EnumerateArray().ToArray();
            for (int n = 0; n < fs.Length; n++)
            {
                double h = t.HeightAt(r.X + (fs[n] - 0.5) * 60000, r.Y + (0.5 - fs[n]) * 45000);
                if (heights[n].ValueKind == JsonValueKind.Null) Assert.True(double.IsNaN(h));
                else Assert.Equal(heights[n].GetDouble(), h);
            }
        }
    }
}
