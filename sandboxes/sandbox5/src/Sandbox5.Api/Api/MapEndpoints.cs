using System.Globalization;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.Primitives;
using Sandbox5.Api.Rendering;
using Sandbox5.Domain;
using Sandbox5.Domain.Export;
using Sandbox5.Domain.Generation;
using Sandbox5.Domain.Model;

namespace Sandbox5.Api.Api;

/// <summary>
/// The REST API of Sandbox 5: map images (PNG) and map data (JSON). Every endpoint takes an
/// optional <c>seed</c>; without it the seed of the settings file is used. Positions are
/// metres, x eastwards and y southwards.
/// </summary>
public static class MapEndpoints
{
    private const int MaxImageSide = 4096;
    private const int MaxRegionsPerList = 400;
    private const int MaxExportRegions = 16;

    private static readonly EndpointInfo[] Endpoints =
    [
        new("/api", "JSON", "This index: the seed, the determinism fingerprint, the tile scheme and the endpoints."),
        new("/api/settings", "JSON", "The settings file in use: the seed and every parameter (sandboxes/sandbox5/defaults.json)."),
        new("/api/catalog", "JSON", "The fixed catalogues: elevation zone types, biomes, thermal belts, resources, bedrocks, colour modes with legends."),
        new("/api/map/tiles/{z}/{x}/{y}.png", "PNG", "A 256 px map tile. Zoom 0 is 8192 m per pixel, every level halves it (up to 10). Layers: color, hillshade, rivers, lakes, locations, locMin, travel, travelStyle, regEdges, zoneEdges, patchEdges, coast, pin."),
        new("/api/map/image.png?x=&y=&mpp=&width=&height=", "PNG", "A map image of any size centred on (x, y) at mpp metres per pixel. Same layers as the tiles."),
        new("/api/map/at?x=&y=", "JSON", "Everything at a point: region, elevation zone, patch (biome, climate, height, resources, site score), the river, lake and location there."),
        new("/api/map/regions?x0=&y0=&x1=&y1=", "JSON", "The regions that reach into a rectangle (summaries)."),
        new("/api/map/regions/{i},{j}", "JSON", "One region as Region → ElevationZone → BiomePatch (docs/map-structure.md). patches=0 leaves the patches out."),
        new("/api/map/regions/{i},{j}/rivers", "JSON", "The region's river network: nodes with parent and flow."),
        new("/api/map/regions/{i},{j}/lakes", "JSON", "The region's lakes with their outlines."),
        new("/api/map/regions/{i},{j}/locations", "JSON", "The region's city and town locations, best first. all=1 lists every candidate patch with its score."),
        new("/api/map/regions/{i},{j}/travel", "JSON", "The travel links the region owns, with their routes. locMin and citiesOnly choose the locations connected."),
        new("/api/map/zones/{key}", "JSON", "One elevation zone with its patches."),
        new("/api/map/patches/{key}", "JSON", "One patch in full: biome inputs, resources, waters, site score."),
        new("/api/map/structure?regions=i,j;i,j", "JSON", "The map structure export (docs/map-structure.md). Default: the four regions at the origin, as docs/map-default-structure.json."),
        new("/api/map/network?regions=i,j;i,j&margin=1", "JSON", "The travel network export (docs/network-structure.md). Default: as docs/network-default-structure.json."),
    ];

    public static void MapSandbox5Api(this WebApplication app)
    {
        RouteGroupBuilder api = app.MapGroup("/api").AddEndpointFilter(async (context, next) =>
        {
            try
            {
                return await next(context);
            }
            catch (ArgumentException e)
            {
                return Results.BadRequest(new { error = e.Message });
            }
        });

        api.MapGet("/", (MapHost host, string? seed) =>
        {
            WorldMap map = host.Map(seed);
            var tiles = new TileScheme(MapHost.TileSize, MapHost.BaseMpp, MapHost.MinZoom, MapHost.MaxZoom, "/api/map/tiles/{z}/{x}/{y}.png", MapRenderer.MaxHeightMpp, MapRenderer.MaxFeatureMpp, map.World.PatchLevel.Size / MapRenderer.DetailPx);
            return new ApiIndex("cellgen · Sandbox 5", "An unbounded, deterministic world map generated on demand: regions, elevation zones and patches with oceans, rivers, lakes, heights, climate, biomes, resources, city and town locations and a travel network.", map.SeedText, map.Seed, map.Fingerprint, tiles, Endpoints);
        });

        api.MapGet("/settings", (MapHost host, string? seed) => SettingsDtoFactory.Of(host.Map(seed).Settings));

        api.MapGet("/catalog", () => CatalogDto.Build());

        // ---- images

        api.MapGet("/map/tiles/{z:int}/{x:int}/{y:int}.png", async (MapHost host, HttpContext http, int z, int x, int y, string? seed, CancellationToken cancel) =>
        {
            if (z < MapHost.MinZoom || z > MapHost.MaxZoom) throw new ArgumentException($"zoom must be {MapHost.MinZoom} to {MapHost.MaxZoom}");
            if (Math.Abs((long)x) > 1 << 22 || Math.Abs((long)y) > 1 << 22) throw new ArgumentException("tile out of range");
            WorldMap map = host.Map(seed);
            RenderOptions options = host.DefaultOptions.With(Query(http));
            MapView view = MapHost.TileView(z, x, y);
            return await Png(host, http, $"{host.Version}|{map.SeedText}|t{z}/{x}/{y}|{options.Key}", () => new MapRenderer(map).RenderPng(view, options), cancel);
        });

        api.MapGet("/map/image.png", async (MapHost host, HttpContext http, double? x, double? y, double? mpp, int? width, int? height, string? seed, CancellationToken cancel) =>
        {
            int w = width ?? 1024;
            int h = height ?? 768;
            double scale = mpp ?? 1000;
            if (w < 1 || h < 1 || w > MaxImageSide || h > MaxImageSide) throw new ArgumentException($"width and height must be 1 to {MaxImageSide}");
            if (!(scale >= 1 && scale <= 65536)) throw new ArgumentException("mpp must be 1 to 65536 metres per pixel");
            double cx = Coordinate(x ?? 0, "x");
            double cy = Coordinate(y ?? 0, "y");
            WorldMap map = host.Map(seed);
            RenderOptions options = host.DefaultOptions.With(Query(http));
            MapView view = MapView.Centred(cx, cy, scale, w, h);
            string key = string.Create(CultureInfo.InvariantCulture, $"{host.Version}|{map.SeedText}|i{cx},{cy},{scale},{w},{h}|{options.Key}");
            return await Png(host, http, key, () => new MapRenderer(map).RenderPng(view, options), cancel);
        });

        // ---- data

        api.MapGet("/map/at", (MapHost host, double x, double y, double? tolerance, string? seed) =>
        {
            WorldMap map = host.Map(seed);
            double tol = tolerance ?? 1500;
            if (!(tol >= 0 && tol <= 50_000)) throw new ArgumentException("tolerance must be 0 to 50000 metres");
            return PointDto.Of(map.At(Coordinate(x, "x"), Coordinate(y, "y"), tol), map);
        });

        api.MapGet("/map/regions", (MapHost host, double x0, double y0, double x1, double y1, string? seed) =>
        {
            WorldMap map = host.Map(seed);
            Coordinate(x0, "x0");
            Coordinate(y0, "y0");
            Coordinate(x1, "x1");
            Coordinate(y1, "y1");
            if (World.CountIn(map.World.RegionLevel, Math.Min(x0, x1), Math.Min(y0, y1), Math.Max(x0, x1), Math.Max(y0, y1), 1) > MaxRegionsPerList) throw new ArgumentException($"the rectangle holds more than {MaxRegionsPerList} regions");
            return map.RegionsIn(x0, y0, x1, y1).Select(RegionSummaryDto.Of).ToArray();
        });

        api.MapGet("/map/regions/{id}", (MapHost host, string id, int? patches, string? seed) => RegionRecord.Of(Region(host.Map(seed), id), withPatches: patches != 0));

        api.MapGet("/map/regions/{id}/rivers", (MapHost host, string id, string? seed) => RiverNetworkDto.Of(Region(host.Map(seed), id).Rivers));

        api.MapGet("/map/regions/{id}/lakes", (MapHost host, string id, string? seed) => Region(host.Map(seed), id).Lakes.Select(l => LakeDto.Of(l)).ToArray());

        api.MapGet("/map/regions/{id}/locations", (MapHost host, string id, int? all, string? seed) =>
        {
            WorldMap map = host.Map(seed);
            Region region = Region(map, id);
            if (all == 1) return Results.Ok(map.Locations.Get(region.Key).Candidates.Select(c => new { patch = c.Patch, site = SiteDto.Of(c) }).ToArray());
            return Results.Ok(region.Locations.Select(LocationDto.Of).ToArray());
        });

        api.MapGet("/map/regions/{id}/travel", (MapHost host, string id, double? locMin, int? citiesOnly, string? seed) =>
        {
            WorldMap map = host.Map(seed);
            Region region = Region(map, id);
            double min = locMin ?? map.Settings.View.LocationMinScore;
            if (!(min >= 0 && min <= 100)) throw new ArgumentException("locMin must be 0 to 100");
            return map.TravelFor(min, citiesOnly == 1).Get(region.Key).Edges.Select(TravelLinkDto.Of).ToArray();
        });

        api.MapGet("/map/zones/{key:long}", (MapHost host, long key, string? seed) =>
        {
            WorldMap map = host.Map(seed);
            ElevationZone zone = map.ElevationZone(CellKey(key));
            return new { zone = ZoneDetailDto.Of(zone), record = ZoneRecord.Of(zone) };
        });

        api.MapGet("/map/patches/{key:long}", (MapHost host, long key, string? seed) => PatchDetailDto.Of(host.Map(seed).Patch(CellKey(key))));

        api.MapGet("/map/structure", (MapHost host, string? regions, string? seed) => MapStructure.Of(host.Map(seed), RegionList(regions)));

        api.MapGet("/map/network", (MapHost host, string? regions, int? margin, string? seed) =>
        {
            int m = margin ?? 1;
            if (m < 0 || m > 2) throw new ArgumentException("margin must be 0 to 2");
            return NetworkStructure.Of(host.Map(seed), RegionList(regions), m);
        });
    }

    private static Func<string, string?> Query(HttpContext http) => name => http.Request.Query.TryGetValue(name, out StringValues v) ? v.ToString() : null;

    /// <summary>A PNG response with an ETag: an image only changes with the settings, the seed and the options.</summary>
    private static async Task<IResult> Png(MapHost host, HttpContext http, string cacheKey, Func<byte[]> render, CancellationToken cancel)
    {
        string etag = $"\"{Sandbox5.Domain.Numerics.Hash.HashString(cacheKey):x8}-{cacheKey.Length:x}\"";
        http.Response.Headers.ETag = etag;
        http.Response.Headers.CacheControl = "no-cache";
        if (http.Request.Headers.IfNoneMatch == etag) return Results.StatusCode(StatusCodes.Status304NotModified);
        byte[] png = await host.Image(cacheKey, render, cancel);
        return Results.Bytes(png, "image/png");
    }

    private static double Coordinate(double v, string name)
    {
        // lattice indices are 22 bits: keep well inside at the smallest patch size
        if (!double.IsFinite(v) || Math.Abs(v) > 2e9) throw new ArgumentException($"{name} must be within ±2 000 000 km");
        return v;
    }

    private static long CellKey(long key)
    {
        if (key < 0 || key >= 1L << 44) throw new ArgumentException("not a cell key");
        return key;
    }

    /// <summary>A region by "i,j" (lattice column and row) or by its key.</summary>
    private static Region Region(WorldMap map, string id)
    {
        string[] parts = id.Split(',');
        if (parts.Length == 2 && int.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out int i) && int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out int j))
        {
            if (Math.Abs(i) > 1 << 20 || Math.Abs(j) > 1 << 20) throw new ArgumentException("region out of range");
            return map.Region(i, j);
        }
        if (parts.Length == 1 && long.TryParse(id, NumberStyles.Integer, CultureInfo.InvariantCulture, out long key)) return map.Region(CellKey(key));
        throw new ArgumentException("a region is named \"i,j\" (lattice column and row) or by its key");
    }

    /// <summary>"i,j;i,j;…" → lattice cells; null when not given.</summary>
    private static List<(int I, int J)>? RegionList(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var list = new List<(int, int)>();
        foreach (string item in text.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            string[] parts = item.Split(',');
            if (parts.Length != 2 || !int.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out int i) || !int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out int j) || Math.Abs(i) > 1 << 20 || Math.Abs(j) > 1 << 20)
                throw new ArgumentException("regions is a list of lattice cells: i,j;i,j;…");
            list.Add((i, j));
        }
        if (list.Count == 0 || list.Count > MaxExportRegions) throw new ArgumentException($"regions names 1 to {MaxExportRegions} regions");
        return list;
    }
}
