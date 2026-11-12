using Sandbox5.Domain;
using Sandbox5.Domain.Generation;
using Sandbox5.Domain.Model;

namespace Sandbox5.Api.Rendering;

/// <summary>
/// Draws a rectangle of a <see cref="WorldMap"/> as an image, the way Sandbox 4 draws its
/// canvas: every pixel is classified through the world (so borders and the coastline are
/// pixel-exact at any zoom), coloured by the colour mode, optionally shaded by the height
/// map, and then rivers, lakes, the travel network and the locations are drawn on top.
///
/// An image is a pure function of the map, the view and the options: border dashes and route
/// dashes are anchored to the world, and vector features are drawn from the same geometry in
/// every image, so neighbouring tiles join without a seam.
/// </summary>
public sealed class MapRenderer
{
    /// <summary>Patches are classified when at least this many pixels wide.</summary>
    public const double DetailPx = 3;
    /// <summary>Heights (the height colour mode and the hillshade) are drawn up to this many metres per pixel; beyond it too many terrain tiles would be needed.</summary>
    public const double MaxHeightMpp = 2048;
    /// <summary>Rivers, lakes, locations and the travel network are drawn up to this many metres per pixel.</summary>
    public const double MaxFeatureMpp = 2048;
    /// <summary>A region must be at least this wide (px) for its cities, and for its towns, to be drawn.</summary>
    public const double CityPx = 14;
    public const double TownPx = 44;

    private const int Margin = 3;
    /// <summary>Features this many pixels outside an image are still drawn: their strokes and markers may reach in.</summary>
    private const double FeatureMarginPx = 16;
    private const int RegionThick = 3;
    private const int RegionDashOn = 4;
    private const int RegionDashPeriod = 7;
    // light from the north-west, 45° up (y grows southwards)
    private const double LX = -0.5;
    private const double LY = -0.5;
    private const double LZ = 0.7071067811865476;
    /// <summary>Shading exaggeration so gentle slopes still read.</summary>
    private const double ShadeExag = 4;
    /// <summary>Flow whose river width does not depend on the width exponent, and the reference length of the zoom factor.</summary>
    private const double RiverRefFlow = 100;
    private const double RiverRefM = 2000;

    private static readonly Rgba RiverColor = Rgba.Hex(0x3f93dc);
    private static readonly Rgba LakeFill = Rgba.Hex(0x3a78b6);
    private static readonly Rgba LakeShore = new(20, 52, 88, 0.85);
    private static readonly Rgba MarkerDark = new(8, 10, 14, 0.9);
    private static readonly Rgba MarkerLight = new(255, 255, 255);
    private static readonly Rgba PinColor = new(90, 230, 255);

    private static readonly TravelMode[] TravelOrder = [TravelMode.Sea, TravelMode.River, TravelMode.Road];
    // index = TravelMode (road, river, sea)
    private static readonly Rgba[] TravelColors = [Rgba.Hex(0xf3dfb4), Rgba.Hex(0xc9f6ff), Rgba.Hex(0xeaf3ff)];
    private static readonly Rgba[] TravelCasing = [new(52, 28, 10, 0.9), new(6, 34, 66, 0.85), new(6, 24, 52, 0.8)];
    private static readonly (double On, double Off)[] TravelDash = [(0, 0), (2.5, 3.5), (7, 5)];
    // line width between two cities, and of any other link
    private static readonly (double Major, double Minor)[] TravelWidth = [(2.3, 1.3), (1.9, 1.4), (1.7, 1.2)];

    private readonly WorldMap _map;

    public MapRenderer(WorldMap map) => _map = map;

    public byte[] RenderPng(MapView view, RenderOptions options) => PngEncoder.Encode(Render(view, options), view.Width, view.Height);

    /// <summary>The image as pixels packed 0xRRGGBB, row by row from the top.</summary>
    public int[] Render(MapView view, RenderOptions o)
    {
        int[] pixels = Raster(view, o);
        var canvas = new Canvas(view.Width, view.Height, pixels);
        if (view.Mpp <= MaxFeatureMpp)
        {
            if (o.Rivers) DrawRivers(canvas, view, o);
            if (o.Lakes) DrawLakes(canvas, view);
            if (o.Travel) DrawTravel(canvas, view, o);
            if (o.Locations) DrawLocations(canvas, view, o);
        }
        return pixels;
    }

    // ------------------------------------------------------------------ cells

    private int[] Raster(MapView view, RenderOptions o)
    {
        World world = _map.World;
        double mpp = view.Mpp;
        double patchSize = world.PatchLevel.Size;
        double zoneSize = world.ElevationZoneLevel.Size;
        double regionSize = world.RegionLevel.Size;
        int w = view.Width + 2 * Margin;
        int h = view.Height + 2 * Margin;
        bool detail = patchSize / mpp >= DetailPx;
        // borders fade out before they would turn the map into a mesh
        bool patchEdges = o.PatchEdges && detail && patchSize / mpp >= 8;
        bool zoneEdges = o.ZoneEdges && zoneSize / mpp >= 8;
        bool regEdges = o.RegionEdges && regionSize / mpp >= 5;
        bool useHeight = (o.Hillshade || o.Color == "height") && mpp <= MaxHeightMpp;
        double[][]? field = Palette.FieldStops(o.Color);
        Func<double, double, double>? fieldAt = o.Color switch
        {
            "temperature" => _map.Climate.TemperatureAt,
            "precipitation" => _map.Climate.PrecipitationAt,
            "prosperity" => _map.Climate.ProsperityAt,
            "supernatural" => _map.Climate.SupernaturalAt,
            _ => null,
        };

        long[] patch = new long[w * h];
        long[] zone = new long[w * h];
        long[] reg = new long[w * h];
        bool[] ocean = new bool[w * h];
        int[] color = new int[w * h];
        double[]? height = useHeight ? new double[w * h] : null;
        // world position of the centre of pixel (0, 0) of the padded raster
        double wx0 = view.X0 + (0.5 - Margin) * mpp;
        double wy0 = view.Y0 + (0.5 - Margin) * mpp;
        Biomes biomes = _map.Biomes;
        Terrain terrain = _map.Terrain;

        Parallel.For(0, h, r =>
        {
            double wy = wy0 + r * mpp;
            int row = r * w;
            long lastRegion = long.MinValue;
            TerrainTile? tile = null;
            for (int c = 0; c < w; c++)
            {
                double wx = wx0 + c * mpp;
                CellInfo cell = world.CellAt(wx, wy, detail);
                int q = row + c;
                patch[q] = cell.Patch;
                zone[q] = cell.ElevationZone;
                reg[q] = cell.Region;
                ocean[q] = cell.Ocean;
                int px;
                if (field != null)
                {
                    // the noise map at half strength over the plain map, as Sandbox 4's overlays
                    int ramp = Palette.Ramp(field, fieldAt!(wx, wy));
                    px = Palette.Mix(Palette.MapColor(cell), (ramp >> 16) & 255, (ramp >> 8) & 255, ramp & 255, 0.5);
                }
                else px = Palette.ColorOf(cell, o.Color, biomes);
                if (height != null)
                {
                    if (cell.Region != lastRegion)
                    {
                        lastRegion = cell.Region;
                        tile = terrain.Get(cell.Region);
                    }
                    double hv = tile!.Sample(wx, wy);
                    height[q] = hv;
                    if (o.Color == "height") px = Palette.HeightColor(hv);
                }
                color[q] = px;
            }
        });

        int[] result = new int[view.Width * view.Height];
        // global pixel indices, so the dash phase is anchored to the world
        long gx0 = (long)Math.Floor(wx0 / mpp);
        long gy0 = (long)Math.Floor(wy0 / mpp);
        Parallel.For(0, view.Height, oy =>
        {
            int r = oy + Margin;
            for (int ox = 0; ox < view.Width; ox++)
            {
                int c = ox + Margin;
                int q = r * w + c;
                int px = color[q];
                if (height != null && o.Hillshade | o.Color == "height" && !ocean[q])
                {
                    // hillshade from the left and upper neighbours (land only; the sea stays flat)
                    double hv = height[q];
                    double gx = ((hv - height[q - 1]) / mpp) * ShadeExag;
                    double gy = ((hv - height[q - w]) / mpp) * ShadeExag;
                    double shade = (-gx * LX - gy * LY + LZ) / Math.Sqrt(gx * gx + gy * gy + 1);
                    double f = 1 + 1.25 * (shade - LZ);
                    px = Palette.Scale(px, f < 0.35 ? 0.35 : f > 1.45 ? 1.45 : f);
                }
                // RegionThick px thick: a pixel is on the border when another region lies within
                // 1 px to its right, RegionThick − 1 px to its left, or RegionThick rows above
                bool regEdge = false;
                if (regEdges)
                {
                    long rk = reg[q];
                    if (reg[q + 1] != rk) regEdge = true;
                    for (int k = 1; k < RegionThick && !regEdge; k++)
                        if (reg[q - k] != rk)
                            regEdge = true;
                    for (int k = 1; k <= RegionThick && !regEdge; k++)
                        if (reg[q - k * w] != rk)
                            regEdge = true;
                }
                long phase = ((gx0 + c + gy0 + r) % RegionDashPeriod + RegionDashPeriod) % RegionDashPeriod;
                if (regEdge && phase < RegionDashOn) px = Palette.RegionEdge;
                else if (o.Coast && (ocean[q - 1] != ocean[q] || ocean[q - w] != ocean[q])) px = Palette.Coast;
                else if (zoneEdges && (zone[q - 1] != zone[q] || zone[q - w] != zone[q])) px = Palette.Scale(px, 0.5);
                else if (patchEdges && (patch[q - 1] != patch[q] || patch[q - w] != patch[q])) px = Palette.Scale(px, 0.8);
                if (o.PinPatch >= 0 && detail)
                {
                    bool inside = patch[q] == o.PinPatch;
                    if ((patch[q - 1] == o.PinPatch) != inside || (patch[q - w] == o.PinPatch) != inside || (patch[q + 1] == o.PinPatch) != inside || (patch[q + w] == o.PinPatch) != inside)
                        px = Palette.Pack(PinColor.R, PinColor.G, PinColor.B);
                }
                result[oy * view.Width + ox] = px;
            }
        });
        return result;
    }

    // ------------------------------------------------------------------ features

    /// <summary>Keys of the regions whose features may reach into the view (with a margin in pixels).</summary>
    private List<long> RegionsNear(MapView view, double marginPx)
    {
        double m = marginPx * view.Mpp;
        return World.CellsIn(_map.World.RegionLevel, view.X0 - m, view.Y0 - m, view.X1 + m, view.Y1 + m, 1);
    }

    /// <summary>Width (px) of a river segment carrying <paramref name="flow"/> attractors: ∝ flow^exp, scaled with the zoom.</summary>
    private static double RiverPx(double flow, double refPx, double scale, double exp)
    {
        double zf = Math.Min(2.2, Math.Max(0.45, refPx / 7));
        double f = exp == 0.5 ? Math.Sqrt(flow / RiverRefFlow) : Math.Pow(flow / RiverRefFlow, exp);
        return scale * zf * (0.45 + 3 * f);
    }

    private void DrawRivers(Canvas canvas, MapView view, RenderOptions o)
    {
        double mpp = view.Mpp;
        double refPx = RiverRefM / mpp;
        List<long> regions = RegionsNear(view, FeatureMarginPx);
        Parallel.ForEach(regions, rk => _map.Rivers.Get(rk));
        double m = FeatureMarginPx * mpp;
        foreach (long rk in regions)
        {
            RegionRivers rr = _map.Rivers.Get(rk);
            if (rr.N == 0 || rr.X1 < view.X0 - m || rr.X0 > view.X1 + m || rr.Y1 < view.Y0 - m || rr.Y0 > view.Y1 + m) continue;
            for (int k = 0; k < rr.N; k++)
            {
                int p = rr.Parent[k];
                if (p < 0 || rr.Flow[k] < o.RiverMin) continue;
                // the stretch from the root across the sea to the coast is not shown
                if (rr.Wet[k] != 0 && rr.Wet[p] != 0) continue;
                double width = Math.Max(0.5, Math.Round(RiverPx(rr.Flow[k], refPx, o.RiverWidth, o.RiverExp) * 4) / 4);
                canvas.AddSegment((rr.X[p] - view.X0) / mpp, (rr.Y[p] - view.Y0) / mpp, (rr.X[k] - view.X0) / mpp, (rr.Y[k] - view.Y0) / mpp, width);
            }
        }
        canvas.Stroke(RiverColor);
    }

    private void DrawLakes(Canvas canvas, MapView view)
    {
        if (_map.Lakes.P.Frequency <= 0) return;
        double mpp = view.Mpp;
        List<long> regions = RegionsNear(view, FeatureMarginPx);
        Parallel.ForEach(regions, rk => _map.Lakes.Get(rk));
        double shore = Math.Max(0.75, Math.Min(1.5, 600 / mpp));
        double m = FeatureMarginPx * mpp;
        foreach (long rk in regions)
        {
            foreach (LakeShape l in _map.Lakes.Get(rk).Lakes)
            {
                if (l.X1 < view.X0 - m || l.X0 > view.X1 + m || l.Y1 < view.Y0 - m || l.Y0 > view.Y1 + m) continue;
                double[] xs = l.X.Select(x => (x - view.X0) / mpp).ToArray();
                double[] ys = l.Y.Select(y => (y - view.Y0) / mpp).ToArray();
                canvas.FillPolygon(xs, ys, LakeFill);
                for (int k = 0; k < xs.Length; k++)
                {
                    int n = (k + 1) % xs.Length;
                    canvas.AddSegment(xs[k], ys[k], xs[n], ys[n], shore);
                }
                canvas.Stroke(LakeShore);
            }
        }
    }

    private void DrawTravel(Canvas canvas, MapView view, RenderOptions o)
    {
        double mpp = view.Mpp;
        double regPx = _map.World.RegionLevel.Size / mpp;
        if (regPx < CityPx) return;
        // the network connects the locations on show: towns only when they are drawn
        Travel travel = _map.TravelFor(o.LocationMinScore, citiesOnly: regPx < TownPx);
        List<long> regions = RegionsNear(view, FeatureMarginPx);
        Parallel.ForEach(regions, rk => travel.Get(rk));
        double m = FeatureMarginPx * mpp;
        RegionTravel[] shown = regions.Select(travel.Get).ToArray();
        double zf = Math.Min(1.5, Math.Max(0.65, regPx / 160));
        bool curved = TravelGrid.Cell / mpp >= 2.5;
        double X(double x) => (x - view.X0) / mpp;
        double Y(double y) => (y - view.Y0) / mpp;
        var lines = new List<List<double>>();
        // one stroke per kind and weight; sea lanes lowest, roads on top
        foreach (TravelMode mode in TravelOrder)
        {
            int mi = (int)mode;
            foreach (bool major in new[] { false, true })
            {
                lines.Clear();
                foreach (RegionTravel rt in shown)
                {
                    foreach (TravelEdge e in rt.Edges)
                    {
                        if (e.Major != major) continue;
                        if (o.TravelStyle == "simple")
                        {
                            if (e.Mode != mode) continue;
                            if (Math.Max(e.A.X, e.B.X) < view.X0 - m || Math.Min(e.A.X, e.B.X) > view.X1 + m || Math.Max(e.A.Y, e.B.Y) < view.Y0 - m || Math.Min(e.A.Y, e.B.Y) > view.Y1 + m) continue;
                            lines.Add([X(e.A.X), Y(e.A.Y), X(e.B.X), Y(e.B.Y)]);
                            continue;
                        }
                        if (e.X1 < view.X0 - m || e.X0 > view.X1 + m || e.Y1 < view.Y0 - m || e.Y0 > view.Y1 + m) continue;
                        foreach (TravelPart part in e.Parts)
                        {
                            if (part.Mode != mode) continue;
                            for (int r = 0; r < part.Runs.Length; r += 2)
                            {
                                // a river route is the river's own polyline: no spline needed
                                lines.Add(TraceRoute(part.Pts, part.Runs[r], part.Runs[r + 1], curved && mode != TravelMode.River, X, Y));
                            }
                        }
                    }
                }
                if (lines.Count == 0) continue;
                double width = (major ? TravelWidth[mi].Major : TravelWidth[mi].Minor) * zf;
                foreach (List<double> line in lines) canvas.AddPolyline(line, width + (mode == TravelMode.Road ? 1.8 : 1.4));
                canvas.Stroke(TravelCasing[mi]);
                var (on, off) = TravelDash[mi];
                foreach (List<double> line in lines) canvas.AddPolyline(line, width, on * zf, (on + off) * zf);
                canvas.Stroke(TravelColors[mi]);
            }
        }
    }

    /// <summary>
    /// The points [i0 … i1] of a route as a polyline in pixels: straight pieces, or a
    /// Catmull-Rom spline through them (as cubic Béziers, the handles capped at a third of the
    /// piece so uneven spacing cannot overshoot), flattened.
    /// </summary>
    private static List<double> TraceRoute(double[] pts, int i0, int i1, bool curved, Func<double, double> sx, Func<double, double> sy)
    {
        int n = pts.Length / 2;
        double X(int i) => sx(pts[2 * i]);
        double Y(int i) => sy(pts[2 * i + 1]);
        var line = new List<double>(2 * (i1 - i0 + 1)) { X(i0), Y(i0) };
        if (!curved)
        {
            for (int i = i0 + 1; i <= i1; i++)
            {
                line.Add(X(i));
                line.Add(Y(i));
            }
            return line;
        }
        for (int i = i0; i < i1; i++)
        {
            double x1 = X(i), y1 = Y(i), x2 = X(i + 1), y2 = Y(i + 1);
            int a = Math.Max(0, i - 1);
            int b = Math.Min(n - 1, i + 2);
            double t1x = (x2 - X(a)) / 6, t1y = (y2 - Y(a)) / 6;
            double t2x = (X(b) - x1) / 6, t2y = (Y(b) - y1) / 6;
            double cap = Math.Sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)) / 3;
            double l1 = Math.Sqrt(t1x * t1x + t1y * t1y);
            if (l1 > cap)
            {
                t1x *= cap / l1;
                t1y *= cap / l1;
            }
            double l2 = Math.Sqrt(t2x * t2x + t2y * t2y);
            if (l2 > cap)
            {
                t2x *= cap / l2;
                t2y *= cap / l2;
            }
            double c1x = x1 + t1x, c1y = y1 + t1y, c2x = x2 - t2x, c2y = y2 - t2y;
            // about one piece per 3 px of route
            int steps = Math.Clamp((int)Math.Ceiling(cap), 1, 12);
            for (int s = 1; s <= steps; s++)
            {
                double t = (double)s / steps;
                double u = 1 - t;
                line.Add(u * u * u * x1 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x2);
                line.Add(u * u * u * y1 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y2);
            }
        }
        return line;
    }

    private void DrawLocations(Canvas canvas, MapView view, RenderOptions o)
    {
        double mpp = view.Mpp;
        double regPx = _map.World.RegionLevel.Size / mpp;
        if (regPx < CityPx) return;
        bool towns = regPx >= TownPx;
        const double Pad = FeatureMarginPx;
        List<long> regions = RegionsNear(view, Pad);
        Parallel.ForEach(regions, rk => _map.Locations.Get(rk));
        var shown = new List<PlacedLocation>();
        foreach (long rk in regions)
        {
            foreach (PlacedLocation l in _map.Locations.Get(rk).List)
            {
                if (l.Score < o.LocationMinScore || (!towns && l.Kind != LocationKind.City)) continue;
                double x = (l.X - view.X0) / mpp;
                double y = (l.Y - view.Y0) / mpp;
                if (x < -Pad || y < -Pad || x > view.Width + Pad || y > view.Height + Pad) continue;
                shown.Add(l);
            }
        }
        // towns under cities, weaker under stronger (ties by patch, so every tile agrees)
        shown.Sort((a, b) => a.Kind != b.Kind ? (a.Kind == LocationKind.City ? 1 : -1) : a.Score != b.Score ? a.Score.CompareTo(b.Score) : a.Patch.CompareTo(b.Patch));
        double zf = Math.Min(1.5, Math.Max(0.7, regPx / 160));
        foreach (PlacedLocation l in shown)
        {
            double x = (l.X - view.X0) / mpp;
            double y = (l.Y - view.Y0) / mpp;
            Rgba fill = Rgba.Hex(Palette.Ramp(Palette.ViabilityStops, Math.Clamp(l.Score, 0, 100)));
            if (l.Kind == LocationKind.City) canvas.Marker(x, y, 5.2 * zf * 1.25, diamond: true, fill, MarkerDark, 3.2, MarkerLight, 1.4);
            else canvas.Marker(x, y, 3.2 * zf, diamond: false, fill, MarkerDark, 1.2);
        }
    }
}
