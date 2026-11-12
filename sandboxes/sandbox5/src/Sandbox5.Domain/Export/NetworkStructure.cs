using Sandbox5.Domain.Generation;
using Sandbox5.Domain.Model;

namespace Sandbox5.Domain.Export;

/// <summary>
/// The travel network as a graph: the city and town locations on show as nodes, and the
/// roads, river routes and sea lanes between them as weighted links. The structure described
/// in docs/network-structure.md of the repository (and written by Sandbox 4's
/// <c>npm run export-network</c>).
///
/// Covers a block of regions: the "core" regions asked for and <c>margin</c> rings of regions
/// around them. A link is listed when both its ends lie in the block. A node's <c>key</c> is
/// the key of its biome patch in <see cref="MapStructure"/>.
/// </summary>
public sealed record NetworkStructure(string Seed, NetworkUnits Units, NetworkSettings Settings, IReadOnlyList<NetworkRegion> Regions, IReadOnlyList<NetworkNode> Nodes, IReadOnlyList<NetworkLink> Links)
{
    /// <summary>A route is sampled at most this far apart (metres) to find the biomes it passes through.</summary>
    private const double Sample = 250;

    public static NetworkStructure Of(WorldMap map, IEnumerable<(int I, int J)>? coreRegions = null, int margin = 1)
    {
        (int I, int J)[] core = (coreRegions ?? MapStructure.OriginRegions).ToArray();
        World w = map.World;
        Travel travel = map.Travel;

        // ---- regions: the core and `margin` rings around it, row by row
        var coreKeys = new HashSet<long>(core.Select(c => CellKeys.Pack(c.I, c.J)));
        var block = new List<long>();
        for (int j = core.Min(c => c.J) - margin; j <= core.Max(c => c.J) + margin; j++)
            for (int i = core.Min(c => c.I) - margin; i <= core.Max(c => c.I) + margin; i++)
                block.Add(CellKeys.Pack(i, j));
        var inBlock = new HashSet<long>(block);

        // biome id of a (merged) land patch as the map shows it (on its exact height)
        string BiomeOf(long patch) => Biome.All[map.Biomes.OfPatch(patch).Biome].Id;

        // ---- nodes: the locations on show, region by region, best score first
        var nodes = new List<NetworkNode>();
        var byKey = new HashSet<long>();
        var regions = new List<NetworkRegion>();
        foreach (long rk in block)
        {
            RegionNode r = w.Region(rk);
            PlacedLocation[] shown = travel.Shown(rk);
            foreach (PlacedLocation l in shown)
            {
                LocationCandidate s = l.Site;
                nodes.Add(new NetworkNode(
                    l.Patch,
                    rk,
                    coreKeys.Contains(rk),
                    l.Kind == LocationKind.City ? "city" : "town",
                    l.Rank,
                    Rounding.R1(l.Score),
                    Rounding.R0(l.X),
                    Rounding.R0(l.Y),
                    BiomeOf(l.Patch),
                    ElevationZoneType.All[s.ZoneType].Id,
                    s.Coast,
                    s.Harbour,
                    s.OnRiver,
                    s.River >= Locations.Navigable,
                    s.Features));
                byKey.Add(l.Patch);
            }
            regions.Add(new NetworkRegion(rk, r.I, r.J, Rounding.R0(r.X), Rounding.R0(r.Y), coreKeys.Contains(rk), shown.Length));
        }

        // ---- links: what the block's regions own, between two locations of the block
        // metres of an edge's route by biome, in the order the biomes are first met
        List<(string Id, double Length)> BiomesAlong(TravelEdge e)
        {
            var index = new Dictionary<string, int>();
            var result = new List<(string Id, double Length)>();
            foreach (TravelPart part in e.Parts)
            {
                double[] p = part.Pts;
                for (int t = 2; t < p.Length; t += 2)
                {
                    double ax = p[t - 2];
                    double ay = p[t - 1];
                    double dx = p[t] - ax;
                    double dy = p[t + 1] - ay;
                    double len = Math.Sqrt(dx * dx + dy * dy);
                    if (len == 0) continue;
                    int n = (int)Math.Max(1, Math.Ceiling(len / Sample));
                    for (int s = 0; s < n; s++)
                    {
                        double f = (s + 0.5) / n;
                        CellInfo c = w.CellAt(ax + dx * f, ay + dy * f, true);
                        string id = c.Ocean ? "ocean" : BiomeOf(c.Patch);
                        if (!index.TryGetValue(id, out int at))
                        {
                            at = result.Count;
                            index[id] = at;
                            result.Add((id, 0));
                        }
                        result[at] = (id, result[at].Length + len / n);
                    }
                }
            }
            return result;
        }
        static double PartLength(double[] pts)
        {
            double len = 0;
            for (int t = 2; t < pts.Length; t += 2) len += Math.Sqrt((pts[t] - pts[t - 2]) * (pts[t] - pts[t - 2]) + (pts[t + 1] - pts[t - 1]) * (pts[t + 1] - pts[t - 1]));
            return len;
        }

        var found = new List<(TravelEdge E, PlacedLocation A, PlacedLocation B)>();
        foreach (long rk in block)
        {
            foreach (TravelEdge e in travel.Get(rk).Edges)
            {
                if (!inBlock.Contains(e.A.Region) || !inBlock.Contains(e.B.Region)) continue;
                if (!byKey.Contains(e.A.Patch) || !byKey.Contains(e.B.Patch)) throw new InvalidOperationException($"link {e.A.Patch} – {e.B.Patch} ends at a location that is not a node");
                // from the smaller key to the larger
                found.Add(e.A.Patch < e.B.Patch ? (e, e.A, e.B) : (e, e.B, e.A));
            }
        }
        found.Sort((p, q) => p.A.Patch != q.A.Patch ? p.A.Patch.CompareTo(q.A.Patch) : p.B.Patch != q.B.Patch ? p.B.Patch.CompareTo(q.B.Patch) : ((int)p.E.Mode).CompareTo((int)q.E.Mode));

        var links = new List<NetworkLink>();
        for (int id = 0; id < found.Count; id++)
        {
            var (e, a, b) = found[id];
            var modes = new Dictionary<string, double>();
            foreach (TravelMode mode in new[] { TravelMode.Road, TravelMode.River, TravelMode.Sea })
            {
                double len = 0;
                foreach (TravelPart p in e.Parts)
                    if (p.Mode == mode)
                        len += PartLength(p.Pts);
                if (len > 0) modes[ModeId(mode)] = Rounding.R0(len);
            }
            List<(string Id, double Length)> along = BiomesAlong(e);
            along.Sort((p, q) => q.Length > p.Length ? 1 : q.Length < p.Length ? -1 : string.CompareOrdinal(p.Id, q.Id));
            var biomes = new Dictionary<string, double>();
            foreach (var (bid, len) in along)
                if (Rounding.R0(len) > 0)
                    biomes[bid] = Rounding.R0(len);
            links.Add(new NetworkLink(id, a.Patch, b.Patch, ModeId(e.Mode), Rounding.R0(e.Length), Rounding.R1(e.Cost), along[0].Id, e.Major, modes, biomes));
        }

        var settings = new NetworkSettings(travel.P.MinScore, travel.P.CitiesOnly, TravelGrid.Cell, Travel.Detour);
        return new NetworkStructure(map.SeedText, NetworkUnits.Default, settings, regions, nodes, links);
    }

    public static string ModeId(TravelMode mode) => mode switch
    {
        TravelMode.River => "river",
        TravelMode.Sea => "sea",
        _ => "road",
    };
}

public sealed record NetworkUnits(string Distance, string Length, string Weight)
{
    public static readonly NetworkUnits Default = new("m", "m", "km of open flat road");
}

/// <param name="MinScore">Only locations with at least this viability score are nodes.</param>
/// <param name="Cell">Cell size of the travel cost grid, metres.</param>
/// <param name="Detour">A link is dropped for a detour over cheaper links of at most this × its cost.</param>
public sealed record NetworkSettings(double MinScore, bool CitiesOnly, double Cell, double Detour);

/// <param name="Core">One of the regions asked for (not one of the rings around them).</param>
/// <param name="Nodes">Number of nodes in the region.</param>
public sealed record NetworkRegion(long Key, int I, int J, double X, double Y, bool Core, int Nodes);

/// <param name="Key">Key of the location's biome patch: the node id.</param>
/// <param name="Kind">city or town.</param>
/// <param name="Rank">1 = the best score of its region.</param>
/// <param name="Score">Viability, 0–100.</param>
/// <param name="Navigable">On a navigable river.</param>
public sealed record NetworkNode(
    long Key,
    long Region,
    bool Core,
    string Kind,
    int Rank,
    double Score,
    double X,
    double Y,
    string Biome,
    string ZoneType,
    bool Coast,
    bool Harbour,
    bool OnRiver,
    bool Navigable,
    IReadOnlyList<string> Features);

/// <param name="A">Node key of one end (the smaller key).</param>
/// <param name="Mode">road, river or sea: the kind of the link.</param>
/// <param name="Length">Length of the route, metres.</param>
/// <param name="Weight">Travel cost, km of open flat road.</param>
/// <param name="Biome">The biome most of the route passes through.</param>
/// <param name="Major">Between two cities.</param>
/// <param name="Modes">Metres of the route by kind.</param>
/// <param name="Biomes">Metres of the route by biome, longest first.</param>
public sealed record NetworkLink(int Id, long A, long B, string Mode, double Length, double Weight, string Biome, bool Major, IReadOnlyDictionary<string, double> Modes, IReadOnlyDictionary<string, double> Biomes);
