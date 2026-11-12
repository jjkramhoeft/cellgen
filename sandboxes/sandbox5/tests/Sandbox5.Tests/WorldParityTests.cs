using System.Text.Json;
using Sandbox5.Domain.Generation;
using Sandbox5.Domain.Model;

namespace Sandbox5.Tests;

/// <summary>The base map (regions, elevation zones, patches, oceans, merges) and the climate fields match the TypeScript generator.</summary>
public class WorldParityTests
{
    private static readonly JsonElement G = Golden.Load("world");

    private static World NewWorld() => new(Golden.Settings.World);

    [Fact]
    public void Seed_and_fingerprint_match()
    {
        Assert.Equal(G.Get("seed").GetUInt32(), Golden.Settings.Seed);
        Assert.Equal(G.Get("fingerprint").GetString(), NewWorld().Fingerprint());
    }

    [Fact]
    public void Every_sampled_point_resolves_to_the_same_cells()
    {
        World w = NewWorld();
        int n = G.Get("n").GetInt32();
        double half = G.Get("half").GetDouble();
        using var rows = G.Get("grid").EnumerateArray().GetEnumerator();
        for (int y = 0; y < n; y++)
        {
            for (int x = 0; x < n; x++)
            {
                Assert.True(rows.MoveNext());
                long[] e = rows.Current.Longs();
                double wx = -half + ((x + 0.37) / n) * 2 * half;
                double wy = -half + ((y + 0.61) / n) * 2 * half;
                CellInfo c = w.CellAt(wx, wy, true);
                long[] actual =
                [
                    c.PatchRaw, c.Patch, c.ElevationZoneRaw, c.ElevationZone, c.Region, c.Ocean ? 1 : 0, c.Origin,
                    c.PatchMerged ? 1 : 0, c.ElevationZoneMerged ? 1 : 0, ElevationZoneType.IndexOf(c.ElevationZone, c.Ocean),
                ];
                Assert.Equal(e, actual);
            }
        }
    }

    [Fact]
    public void Regions_own_the_same_zones_seeds_merges_and_links()
    {
        World w = NewWorld();
        foreach (JsonElement r in G.Get("regions").EnumerateArray())
        {
            RegionNode reg = w.Region(r.Get("key").GetInt64());
            Assert.Equal(r.Get("x").GetDouble(), reg.X);
            Assert.Equal(r.Get("y").GetDouble(), reg.Y);
            Assert.Equal(r.Get("elevationZones").Longs(), reg.ElevationZones);
            Assert.Equal(r.Get("seeds").Longs(), reg.Seeds);
            Assert.Equal(r.Get("merges").Longs(), reg.Merges.OrderBy(k => k).ToArray());
            SeedLink[] links = w.Links(reg.Key);
            JsonElement[] expected = r.Get("links").EnumerateArray().ToArray();
            Assert.Equal(expected.Length, links.Length);
            for (int k = 0; k < links.Length; k++)
            {
                Assert.Equal(expected[k].Get("from").GetInt64(), links[k].From);
                Assert.Equal(expected[k].Get("to").GetInt64(), links[k].To);
                Assert.Equal(expected[k].Get("chain").Longs(), links[k].Chain);
            }
            foreach (JsonElement z in r.Get("zones").EnumerateArray())
            {
                long zk = z.Get("key").GetInt64();
                ZoneNode zone = w.ElevationZone(zk);
                Assert.Equal(z.Get("x").GetDouble(), zone.X);
                Assert.Equal(z.Get("y").GetDouble(), zone.Y);
                Assert.Equal(z.Get("nbrs").Longs(), w.ElevationZoneNbrs(zone));
                Assert.Equal(z.Get("root").GetInt64(), w.ElevationZoneRoot(zk));
                Assert.Equal(z.Get("ocean").GetInt32() == 1, w.Ocean(zk));
                Assert.Equal(z.Get("origin").GetInt32(), w.OriginOf(zk));
                long[] patches = w.ElevationZonePatches(zone);
                Assert.Equal(z.Get("patches").GetInt32(), patches.Length);
                Assert.Equal(z.Get("patchFp").GetString(), Golden.Fp(patches.D()));
            }
        }
    }

    [Fact]
    public void Climate_fields_match()
    {
        var cl = new Climate(Golden.Settings.Climate);
        foreach (JsonElement row in G.Get("climate").EnumerateArray())
        {
            double[] e = row.Doubles();
            Assert.Equal(e[2], cl.TemperatureAt(e[0], e[1]));
            Assert.Equal(e[3], cl.PrecipitationAt(e[0], e[1]));
            Assert.Equal(e[4], cl.ProsperityAt(e[0], e[1]));
            Assert.Equal(e[5], cl.SupernaturalAt(e[0], e[1]));
        }
    }

    [Fact]
    public void The_map_does_not_depend_on_the_order_it_is_explored_in()
    {
        World a = NewWorld();
        World b = NewWorld();
        var points = new List<(double X, double Y)>();
        for (int k = 0; k < 400; k++) points.Add(((k * 7919 % 601 - 300) * 1000.0, (k * 104729 % 599 - 299) * 1000.0));
        CellInfo[] forward = points.Select(p => a.CellAt(p.X, p.Y)).ToArray();
        CellInfo[] backward = points.AsEnumerable().Reverse().Select(p => b.CellAt(p.X, p.Y)).Reverse().ToArray();
        Assert.Equal(forward, backward);
    }

    [Fact]
    public void Concurrent_exploration_gives_the_same_map()
    {
        World serial = NewWorld();
        World parallel = NewWorld();
        var points = new List<(double X, double Y)>();
        for (int k = 0; k < 4000; k++) points.Add(((k * 7919 % 801 - 400) * 1000.0, (k * 104729 % 799 - 399) * 1000.0));
        CellInfo[] expected = points.Select(p => serial.CellAt(p.X, p.Y)).ToArray();
        var actual = new CellInfo[points.Count];
        Parallel.For(0, points.Count, k => actual[k] = parallel.CellAt(points[k].X, points[k].Y));
        Assert.Equal(expected, actual);
    }
}
