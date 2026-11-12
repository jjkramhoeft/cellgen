using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Sandbox5.Domain.Model;

namespace Sandbox5.Tests;

/// <summary>The REST API over HTTP, on the golden settings: map images as PNG and map data as JSON.</summary>
public class ApiTests : IClassFixture<ApiTests.Factory>
{
    /// <summary>The service with the frozen golden settings instead of the sandbox's live defaults.json.</summary>
    public sealed class Factory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.UseSetting("Map:SettingsFile", Path.Combine(Golden.Dir, "settings.json"));
    }

    private readonly HttpClient _http;

    public ApiTests(Factory factory) => _http = factory.CreateClient();

    private async Task<JsonElement> Json(string url)
    {
        using HttpResponseMessage res = await _http.GetAsync(url);
        Assert.True(res.IsSuccessStatusCode, $"{url}: {(int)res.StatusCode}");
        Assert.Equal("application/json", res.Content.Headers.ContentType?.MediaType);
        using JsonDocument doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        return doc.RootElement.Clone();
    }

    [Fact]
    public async Task Index_names_the_seed_the_fingerprint_and_the_endpoints()
    {
        JsonElement index = await Json("/api");
        Assert.Equal("cellgen", index.Get("seed").GetString());
        Assert.Equal(Golden.Settings.Seed, index.Get("seedValue").GetUInt32());
        Assert.Equal(Golden.Load("world").Get("fingerprint").GetString(), index.Get("fingerprint").GetString());
        Assert.Equal(256, index.Get("tiles").Get("tileSize").GetInt32());
        Assert.Contains(index.Get("endpoints").EnumerateArray(), e => e.Get("path").GetString()!.StartsWith("/api/map/tiles/"));
    }

    [Fact]
    public async Task Another_seed_gives_another_map()
    {
        JsonElement other = await Json("/api?seed=another");
        Assert.Equal("another", other.Get("seed").GetString());
        Assert.NotEqual(Golden.Load("world").Get("fingerprint").GetString(), other.Get("fingerprint").GetString());
    }

    [Fact]
    public async Task Settings_and_catalog_are_served()
    {
        JsonElement settings = await Json("/api/settings");
        Assert.Equal(128, settings.Get("params").Get("reg.size").GetDouble());
        Assert.Equal(Golden.Settings.File.Params.Count, settings.Get("params").EnumerateObject().Count());
        JsonElement catalog = await Json("/api/catalog");
        Assert.Equal(Biome.All.Count, catalog.Get("biomes").GetArrayLength());
        Assert.Equal(ResourceType.All.Count, catalog.Get("resources").GetArrayLength());
        Assert.Equal(Bedrock.All.Count, catalog.Get("bedrocks").GetArrayLength());
        Assert.Contains(catalog.Get("colorModes").EnumerateArray(), m => m.Get("id").GetString() == "biomes");
    }

    [Fact]
    public async Task A_tile_is_a_png_and_is_not_sent_twice()
    {
        using HttpResponseMessage res = await _http.GetAsync("/api/map/tiles/4/0/0.png");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("image/png", res.Content.Headers.ContentType?.MediaType);
        byte[] png = await res.Content.ReadAsByteArrayAsync();
        RenderingTests.DecodePng(png, out int w, out int h);
        Assert.Equal((256, 256), (w, h));
        string etag = res.Headers.ETag!.Tag;

        using var again = new HttpRequestMessage(HttpMethod.Get, "/api/map/tiles/4/0/0.png");
        again.Headers.TryAddWithoutValidation("If-None-Match", etag);
        using HttpResponseMessage cached = await _http.SendAsync(again);
        Assert.Equal(HttpStatusCode.NotModified, cached.StatusCode);

        // another layer set is another image
        using HttpResponseMessage plain = await _http.GetAsync("/api/map/tiles/4/0/0.png?color=landsea&rivers=0&travel=0&locations=0");
        Assert.NotEqual(etag, plain.Headers.ETag!.Tag);
        Assert.NotEqual(png, await plain.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task An_image_of_any_size_is_served()
    {
        using HttpResponseMessage res = await _http.GetAsync("/api/map/image.png?x=10000&y=-20000&mpp=800&width=300&height=200&color=genesis");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        RenderingTests.DecodePng(await res.Content.ReadAsByteArrayAsync(), out int w, out int h);
        Assert.Equal((300, 200), (w, h));
    }

    [Theory]
    [InlineData("/api/map/tiles/11/0/0.png")]
    [InlineData("/api/map/tiles/4/0/0.png?color=plaid")]
    [InlineData("/api/map/image.png?width=5000")]
    [InlineData("/api/map/image.png?mpp=0")]
    [InlineData("/api/map/at?x=1e300&y=0")]
    [InlineData("/api/map/regions/north")]
    [InlineData("/api/map/structure?regions=0,0;1")]
    [InlineData("/api/map/network?margin=9")]
    public async Task Bad_requests_are_refused_with_a_reason(string url)
    {
        using HttpResponseMessage res = await _http.GetAsync(url);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        using JsonDocument doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        Assert.False(string.IsNullOrWhiteSpace(doc.RootElement.Get("error").GetString()));
    }

    [Fact]
    public async Task A_point_is_described_as_the_domain_model_has_it()
    {
        const double x = 12_000, y = -34_000;
        JsonElement at = await Json($"/api/map/at?x={x}&y={y}");
        Patch patch = ExportParityTests.Map.PatchAt(x, y);
        Assert.Equal(patch.Key, at.Get("patch").Get("key").GetInt64());
        Assert.Equal(patch.Biome.Id, at.Get("patch").Get("biome").GetString());
        Assert.Equal(patch.ElevationZone.Key, at.Get("elevationZone").Get("key").GetInt64());
        Assert.Equal(patch.ElevationZone.Type.Id, at.Get("elevationZone").Get("type").GetString());
        Assert.Equal(patch.Region.Key, at.Get("region").Get("key").GetInt64());
        Assert.Equal(patch.Resources.Select(r => r.Type.Id).ToArray(), at.Get("patch").Get("resources").EnumerateArray().Select(r => r.Get("id").GetString()!).ToArray());
        Assert.True(at.Get("patch").Get("heightExact").GetBoolean());

        // the patch on its own, by key
        JsonElement byKey = await Json($"/api/map/patches/{patch.Key}");
        Assert.Equal(at.Get("patch").GetRawText(), byKey.GetRawText());
    }

    [Fact]
    public async Task A_region_lists_its_zones_rivers_lakes_locations_and_links()
    {
        JsonElement region = await Json("/api/map/regions/0,0?patches=0");
        Region model = ExportParityTests.Map.Region(0, 0);
        Assert.Equal(model.Key, region.Get("key").GetInt64());
        Assert.Equal(model.ElevationZones.Count, region.Get("elevationZones").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, region.Get("elevationZones")[0].Get("biomePatches").ValueKind);
        // the same region by its key
        Assert.Equal(region.GetRawText(), (await Json($"/api/map/regions/{model.Key}?patches=0")).GetRawText());

        JsonElement rivers = await Json("/api/map/regions/0,0/rivers");
        Assert.Equal(model.Rivers.N, rivers.Get("nodes").GetInt32());
        Assert.Equal(model.Rivers.N, rivers.Get("x").GetArrayLength());
        Assert.Equal(model.Lakes.Count, (await Json("/api/map/regions/0,0/lakes")).GetArrayLength());
        JsonElement locations = await Json("/api/map/regions/0,0/locations");
        Assert.Equal(model.Locations.Count, locations.GetArrayLength());
        Assert.Equal(model.Locations[0].Patch, locations[0].Get("key").GetInt64());
        Assert.Equal(model.TravelLinks.Count, (await Json("/api/map/regions/0,0/travel")).GetArrayLength());

        JsonElement summaries = await Json("/api/map/regions?x0=-100000&y0=-100000&x1=100000&y1=100000");
        Assert.Contains(summaries.EnumerateArray(), r => r.Get("key").GetInt64() == model.Key);
    }

    [Fact]
    public async Task The_demo_site_is_served()
    {
        using HttpResponseMessage res = await _http.GetAsync("/");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains("Sandbox 5", await res.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.OK, (await _http.GetAsync("/app.js")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _http.GetAsync("/style.css")).StatusCode);
    }
}
