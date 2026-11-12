using System.Text.Json;
using Sandbox5.Domain.Generation;

namespace Sandbox5.Tests;

/// <summary>The space-colonization rivers of the four central regions match the TypeScript generator node for node.</summary>
public class RiverParityTests
{
    private static readonly JsonElement G = Golden.Load("rivers");

    [Fact]
    public void River_networks_match()
    {
        var w = new World(Golden.Settings.World);
        var rv = new Rivers(w, Golden.Settings.Rivers);
        foreach (JsonElement e in G.Get("regions").EnumerateArray())
        {
            long key = e.Get("key").GetInt64();
            Assert.Equal(e.Get("zones").Longs(), rv.RegionElevationZones(key));
            var (pairs, _) = rv.RootPairs(key);
            Assert.Equal(e.Get("pairs").EnumerateArray().Select(p => (p[0].GetInt64(), p[1].GetInt64())).ToArray(), pairs.ToArray());
            var (ax, ay) = rv.Attractors(key);
            Assert.Equal(e.Get("attractors").GetInt32(), ax.Count);
            Assert.Equal(e.Get("attractorFp").GetString(), Golden.Fp(ax, ay));

            RegionRivers r = rv.Get(key);
            JsonElement[] head = e.Get("head").EnumerateArray().ToArray();
            for (int k = 0; k < head.Length; k++)
            {
                double[] h = head[k].Doubles();
                Assert.Equal(h, new double[] { r.X[k], r.Y[k], r.Parent[k], r.Own[k], r.Flow[k], r.Wet[k] });
            }
            Assert.Equal(e.Get("n").GetInt32(), r.N);
            Assert.Equal(e.Get("roots").Ints(), r.Roots);
            Assert.Equal(e.Get("rootOcean").Longs(), r.RootOcean);
            Assert.Equal(e.Get("reached").GetInt32(), r.Reached);
            Assert.Equal(e.Get("iterations").GetInt32(), r.Iterations);
            Assert.Equal(e.Get("bridges").GetInt32(), r.Bridges);
            Assert.Equal(e.Get("landlocked").GetBoolean(), r.Landlocked);
            Assert.Equal(e.Get("xyFp").GetString(), Golden.Fp(r.X, r.Y));
            Assert.Equal(e.Get("treeFp").GetString(), Golden.Fp(r.Parent.D(), r.Own.D(), r.Flow.D(), r.Tree.D(), r.Wet.D()));
            Assert.Equal(e.Get("reachedFp").GetString(), Golden.Fp(r.ReachedBy.D()));
            Assert.Equal(e.Get("box").Doubles(), new[] { r.X0, r.Y0, r.X1, r.Y1 });
        }
    }
}
