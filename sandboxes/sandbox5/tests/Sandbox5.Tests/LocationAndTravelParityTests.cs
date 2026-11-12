using System.Text.Json;
using Sandbox5.Domain.Generation;

namespace Sandbox5.Tests;

/// <summary>City and town locations (every candidate's factors) and the travel network match the TypeScript generator.</summary>
public class LocationAndTravelParityTests
{
    [Fact]
    public void Locations_match()
    {
        JsonElement g = Golden.Load("locations");
        int total = 0;
        foreach (JsonElement e in g.Get("regions").EnumerateArray())
        {
            RegionLocations r = Shared.Locations.Get(e.Get("key").GetInt64());
            JsonElement[] rows = e.Get("candidates").EnumerateArray().ToArray();
            string[] features = e.Get("features").EnumerateArray().Select(f => f.GetString()!).ToArray();
            Assert.Equal(rows.Length, r.Candidates.Length);
            for (int n = 0; n < rows.Length; n++)
            {
                LocationCandidate c = r.Candidates[n];
                double[] actual =
                [
                    c.Patch, c.Zone, c.ZoneType, c.Biome, c.X, c.Y, c.OnRiver ? 1 : 0, c.Depth, c.Coast ? 1 : 0, c.Harbour ? 1 : 0, c.OceanFrac, c.Lake, c.River, c.Mouth, c.Confluence, c.Head ? 1 : 0,
                    c.Food, c.Water, c.Materials, c.Fish, c.Goods, c.Buildable, c.Waterside, c.Defence, c.Gateway, c.Centrality, c.Comfort,
                    c.Resources, c.Geography, c.Trade, c.Climate, c.Prosperity, c.Need, c.Score,
                ];
                double[] expected = rows[n].Doubles();
                for (int k = 0; k < expected.Length; k++) Assert.True(expected[k] == actual[k], $"candidate {c.Patch} field {k}: expected {expected[k]:R}, got {actual[k]:R}");
                Assert.Equal(features[n], string.Join('|', c.Features));
            }
            Assert.Equal(e.Get("eligible").GetInt32(), r.Eligible);
            Assert.Equal(e.Get("spacing").GetDouble(), r.Spacing);
            JsonElement[] list = e.Get("list").EnumerateArray().ToArray();
            Assert.Equal(list.Length, r.List.Length);
            for (int n = 0; n < list.Length; n++)
            {
                PlacedLocation l = r.List[n];
                Assert.Equal(list[n].Get("patch").GetInt64(), l.Patch);
                Assert.Equal(list[n].Get("kind").GetString(), l.Kind == LocationKind.City ? "city" : "town");
                Assert.Equal(list[n].Get("rank").GetInt32(), l.Rank);
                Assert.Equal(list[n].Get("score").GetDouble(), l.Score);
                Assert.Equal(list[n].Get("x").GetDouble(), l.X);
                Assert.Equal(list[n].Get("y").GetDouble(), l.Y);
                total++;
            }
        }
        Assert.True(total >= 40, $"{total} locations");
    }

    [Fact]
    public void Travel_grids_and_networks_match()
    {
        JsonElement g = Golden.Load("travel");
        int total = 0;
        foreach (JsonElement e in g.Get("regions").EnumerateArray())
        {
            long key = e.Get("key").GetInt64();
            RegionGrid grid = Shared.TravelGrid.Get(key);
            JsonElement x = e.Get("grid");
            Assert.Equal(new[] { x.Get("i0").GetInt32(), x.Get("j0").GetInt32(), x.Get("nx").GetInt32(), x.Get("ny").GetInt32(), x.Get("land").GetInt32(), x.Get("sea").GetInt32(), x.Get("links").GetInt32() },
                new[] { grid.I0, grid.J0, grid.Nx, grid.Ny, grid.Land, grid.Sea, grid.Links.Length / 5 });
            Assert.Equal(x.Get("kindFp").GetString(), Golden.Fp(grid.Kind.D()));
            Assert.Equal(x.Get("costFp").GetString(), Golden.Fp(grid.Cost.D()));
            Assert.Equal(x.Get("hFp").GetString(), Golden.Fp(grid.H.D()));
            Assert.Equal(x.Get("linkFp").GetString(), Golden.Fp(grid.Links.D()));

            Assert.Equal(e.Get("shown").Longs(), Shared.Travel.Shown(key).Select(l => l.Patch).ToArray());
            RegionTravel r = Shared.Travel.Get(key);
            Assert.Equal(e.Get("nodes").GetInt32(), r.Nodes);
            Assert.Equal(e.Get("candidates").GetInt32(), r.Candidates);
            Assert.Equal(e.Get("pruned").GetInt32(), r.Pruned);
            JsonElement[] edges = e.Get("edges").EnumerateArray().ToArray();
            Assert.Equal(edges.Length, r.Edges.Length);
            for (int n = 0; n < edges.Length; n++)
            {
                JsonElement ex = edges[n];
                TravelEdge edge = r.Edges[n];
                string at = $"region {key} edge {n}";
                Assert.True(ex.Get("a").GetInt64() == edge.A.Patch && ex.Get("b").GetInt64() == edge.B.Patch, at + " ends");
                Assert.Equal(ex.Get("mode").GetString(), edge.Mode.ToString().ToLowerInvariant());
                Assert.True(ex.Get("cost").GetDouble() == edge.Cost, at + " cost");
                Assert.True(ex.Get("length").GetDouble() == edge.Length, at + " length");
                Assert.Equal(ex.Get("major").GetBoolean(), edge.Major);
                Assert.Equal(ex.Get("box").Doubles(), new[] { edge.X0, edge.Y0, edge.X1, edge.Y1 });
                JsonElement[] parts = ex.Get("parts").EnumerateArray().ToArray();
                Assert.Equal(parts.Length, edge.Parts.Length);
                for (int p = 0; p < parts.Length; p++)
                {
                    Assert.Equal(parts[p].Get("mode").GetString(), edge.Parts[p].Mode.ToString().ToLowerInvariant());
                    Assert.Equal(parts[p].Get("points").GetInt32(), edge.Parts[p].Pts.Length / 2);
                    Assert.True(parts[p].Get("ptsFp").GetString() == Golden.Fp(edge.Parts[p].Pts), at + $" part {p} route");
                    Assert.Equal(parts[p].Get("runs").Ints(), edge.Parts[p].Runs);
                }
                total++;
            }
        }
        Assert.True(total >= 50, $"{total} links");
    }

    [Fact]
    public void Every_pair_of_regions_has_one_owner()
    {
        long a = CellKeys.Pack(0, 0);
        Assert.Equal(Math.Min(a, CellKeys.Pack(1, 1)), Travel.OwnerOf(a, CellKeys.Pack(1, 1)));
        Assert.Equal(CellKeys.Pack(1, 0), Travel.OwnerOf(a, CellKeys.Pack(2, 1)));
        Assert.Equal(CellKeys.Pack(-1, -1), Travel.OwnerOf(a, CellKeys.Pack(-2, -2)));
        Assert.Equal(-1, Travel.OwnerOf(a, CellKeys.Pack(3, 0)));
        Assert.Equal(Travel.OwnerOf(a, CellKeys.Pack(2, -1)), Travel.OwnerOf(CellKeys.Pack(2, -1), a));
    }
}
