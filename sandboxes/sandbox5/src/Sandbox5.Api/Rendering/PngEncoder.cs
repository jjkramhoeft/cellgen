using System.Buffers.Binary;
using System.IO.Compression;

namespace Sandbox5.Api.Rendering;

/// <summary>A minimal PNG writer for opaque 8-bit RGB images (no dependencies: zlib from the BCL, CRC-32 by table).</summary>
public static class PngEncoder
{
    private static readonly byte[] Signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    private static readonly uint[] CrcTable = BuildCrcTable();

    private static uint[] BuildCrcTable()
    {
        var table = new uint[256];
        for (uint n = 0; n < 256; n++)
        {
            uint c = n;
            for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xedb88320u ^ (c >> 1) : c >> 1;
            table[n] = c;
        }
        return table;
    }

    private static uint Crc(ReadOnlySpan<byte> type, ReadOnlySpan<byte> data)
    {
        uint c = 0xffffffffu;
        foreach (byte b in type) c = CrcTable[(c ^ b) & 0xff] ^ (c >> 8);
        foreach (byte b in data) c = CrcTable[(c ^ b) & 0xff] ^ (c >> 8);
        return c ^ 0xffffffffu;
    }

    private static void WriteChunk(Stream s, string type, ReadOnlySpan<byte> data)
    {
        Span<byte> head = stackalloc byte[8];
        BinaryPrimitives.WriteUInt32BigEndian(head, (uint)data.Length);
        for (int i = 0; i < 4; i++) head[4 + i] = (byte)type[i];
        s.Write(head);
        s.Write(data);
        Span<byte> crc = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(crc, Crc(head[4..], data));
        s.Write(crc);
    }

    /// <summary>Encode pixels packed as 0xRRGGBB, row by row from the top.</summary>
    public static byte[] Encode(int[] pixels, int width, int height)
    {
        if (pixels.Length != width * height) throw new ArgumentException("pixel count does not match the size", nameof(pixels));
        // scanlines: a filter byte (1 = Sub: flat areas and gradients compress well) and the RGB bytes
        byte[] raw = new byte[height * (1 + 3 * width)];
        int o = 0;
        for (int y = 0; y < height; y++)
        {
            raw[o++] = 1;
            int pr = 0, pg = 0, pb = 0;
            int row = y * width;
            for (int x = 0; x < width; x++)
            {
                int p = pixels[row + x];
                int r = (p >> 16) & 255, g = (p >> 8) & 255, b = p & 255;
                raw[o++] = (byte)(r - pr);
                raw[o++] = (byte)(g - pg);
                raw[o++] = (byte)(b - pb);
                pr = r;
                pg = g;
                pb = b;
            }
        }
        using var data = new MemoryStream();
        using (var z = new ZLibStream(data, CompressionLevel.Optimal, leaveOpen: true)) z.Write(raw);

        using var png = new MemoryStream();
        png.Write(Signature);
        Span<byte> header = stackalloc byte[13];
        BinaryPrimitives.WriteUInt32BigEndian(header, (uint)width);
        BinaryPrimitives.WriteUInt32BigEndian(header[4..], (uint)height);
        header[8] = 8; // bit depth
        header[9] = 2; // colour type: RGB
        header[10] = 0; // compression
        header[11] = 0; // filter method
        header[12] = 0; // no interlace
        WriteChunk(png, "IHDR", header);
        WriteChunk(png, "IDAT", data.GetBuffer().AsSpan(0, (int)data.Length));
        WriteChunk(png, "IEND", []);
        return png.ToArray();
    }
}
