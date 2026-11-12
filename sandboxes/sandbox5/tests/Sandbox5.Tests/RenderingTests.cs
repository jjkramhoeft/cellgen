using System.Buffers.Binary;
using System.IO.Compression;
using Sandbox5.Api;
using Sandbox5.Api.Rendering;
using Sandbox5.Domain;

namespace Sandbox5.Tests;

/// <summary>Map images: deterministic, seamless across tiles, and valid PNG files.</summary>
public class RenderingTests
{
    private static readonly WorldMap Map = ExportParityTests.Map;

    private static RenderOptions Options(string color = "map") => RenderOptions.From(Golden.Settings) with { Color = color };

    [Fact]
    public void An_image_is_a_pure_function_of_view_and_options()
    {
        var view = MapView.Centred(20_000, -15_000, 400, 160, 120);
        int[] a = new MapRenderer(Map).Render(view, Options());
        int[] b = new MapRenderer(new WorldMap(Golden.Settings)).Render(view, Options());
        Assert.Equal(a, b);
    }

    [Theory]
    [InlineData(4, "map")]
    [InlineData(5, "biomes")]
    [InlineData(3, "regions")]
    public void Neighbouring_tiles_join_without_a_seam(int z, string color)
    {
        var renderer = new MapRenderer(Map);
        RenderOptions o = Options(color) with { Hillshade = color == "biomes" };
        MapView left = MapHost.TileView(z, -1, 0);
        MapView right = MapHost.TileView(z, 0, 0);
        int[] a = renderer.Render(left, o);
        int[] b = renderer.Render(right, o);
        // the same two tiles as one image
        int[] both = renderer.Render(new MapView(left.X0, left.Y0, left.Mpp, 2 * MapHost.TileSize, MapHost.TileSize), o);
        for (int y = 0; y < MapHost.TileSize; y++)
        {
            for (int x = 0; x < MapHost.TileSize; x++)
            {
                Assert.True(both[y * 2 * MapHost.TileSize + x] == a[y * MapHost.TileSize + x], $"left tile differs at ({x}, {y})");
                Assert.True(both[y * 2 * MapHost.TileSize + MapHost.TileSize + x] == b[y * MapHost.TileSize + x], $"right tile differs at ({x}, {y})");
            }
        }
    }

    [Fact]
    public void Layers_change_the_image()
    {
        var renderer = new MapRenderer(Map);
        MapView view = MapHost.TileView(4, 0, 0);
        RenderOptions all = Options();
        int[] full = renderer.Render(view, all);
        int[] bare = renderer.Render(view, all with { Rivers = false, Lakes = false, Locations = false, Travel = false, RegionEdges = false, ZoneEdges = false, PatchEdges = false, Coast = false });
        Assert.NotEqual(full, bare);
        // without features and borders only the cell colours remain: far fewer colours than with them
        Assert.True(bare.Distinct().Count() < full.Distinct().Count());
        Assert.Contains(Palette.RegionEdge, full);
        Assert.DoesNotContain(Palette.RegionEdge, bare);
    }

    [Fact]
    public void Options_are_read_from_a_query_and_reject_bad_values()
    {
        RenderOptions o = Options();
        var query = new Dictionary<string, string> { ["color"] = "biomes", ["rivers"] = "0", ["locMin"] = "70", ["pin"] = "8796099313659" };
        RenderOptions changed = o.With(name => query.GetValueOrDefault(name));
        Assert.Equal("biomes", changed.Color);
        Assert.False(changed.Rivers);
        Assert.Equal(70, changed.LocationMinScore);
        Assert.Equal(8796099313659, changed.PinPatch);
        Assert.Equal(o.Travel, changed.Travel);
        Assert.NotEqual(o.Key, changed.Key);
        Assert.Throws<ArgumentException>(() => o.With(name => name == "color" ? "plaid" : null));
        Assert.Throws<ArgumentException>(() => o.With(name => name == "rivers" ? "maybe" : null));
        Assert.Throws<ArgumentException>(() => o.With(name => name == "locMin" ? "101" : null));
    }

    [Fact]
    public void The_png_decodes_to_the_same_pixels()
    {
        MapView view = MapView.Centred(0, 0, 500, 97, 61);
        int[] pixels = new MapRenderer(Map).Render(view, Options());
        byte[] png = PngEncoder.Encode(pixels, view.Width, view.Height);
        Assert.Equal(pixels, DecodePng(png, out int w, out int h));
        Assert.Equal((view.Width, view.Height), (w, h));
    }

    /// <summary>A minimal decoder for the PNGs the service writes: 8-bit RGB, filter 0 or 1, one IDAT chunk.</summary>
    internal static int[] DecodePng(byte[] png, out int width, out int height)
    {
        Assert.Equal(new byte[] { 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a }, png[..8]);
        width = height = 0;
        using var idat = new MemoryStream();
        for (int at = 8; at < png.Length;)
        {
            int len = (int)BinaryPrimitives.ReadUInt32BigEndian(png.AsSpan(at));
            string type = System.Text.Encoding.ASCII.GetString(png, at + 4, 4);
            ReadOnlySpan<byte> data = png.AsSpan(at + 8, len);
            if (type == "IHDR")
            {
                width = (int)BinaryPrimitives.ReadUInt32BigEndian(data);
                height = (int)BinaryPrimitives.ReadUInt32BigEndian(data[4..]);
                Assert.Equal(new byte[] { 8, 2, 0, 0, 0 }, data[8..13].ToArray());
            }
            else if (type == "IDAT") idat.Write(data);
            at += 12 + len;
        }
        idat.Position = 0;
        using var z = new ZLibStream(idat, CompressionMode.Decompress);
        using var raw = new MemoryStream();
        z.CopyTo(raw);
        byte[] bytes = raw.ToArray();
        Assert.Equal(height * (1 + 3 * width), bytes.Length);
        int[] pixels = new int[width * height];
        int o = 0;
        for (int y = 0; y < height; y++)
        {
            byte filter = bytes[o++];
            Assert.True(filter is 0 or 1);
            int pr = 0, pg = 0, pb = 0;
            for (int x = 0; x < width; x++)
            {
                int r = bytes[o++], g = bytes[o++], b = bytes[o++];
                if (filter == 1)
                {
                    r = (r + pr) & 255;
                    g = (g + pg) & 255;
                    b = (b + pb) & 255;
                }
                pixels[y * width + x] = (r << 16) | (g << 8) | b;
                pr = r;
                pg = g;
                pb = b;
            }
        }
        return pixels;
    }
}
