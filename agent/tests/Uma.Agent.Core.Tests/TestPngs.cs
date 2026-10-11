using System.Buffers.Binary;
using System.IO.Compression;

namespace Uma.Agent.Core.Tests;

/// <summary>Deterministic PNG builder for decoder tests (T16b review round 1). Raw sample bytes come from a fixed
/// pseudo-random sequence; every row uses a different PNG filter type (0–4, applied for real) so all unfilter paths run.
/// The same source is compiled into the scratch harness that recorded the ImageSharp 3.1.12 expectations.</summary>
public static class TestPngs
{
    public sealed record Spec(string Name, int Width, int Height, int Depth, int ColorType, bool Interlaced = false, bool Palette = false, int Trns = 0);

    public static readonly Spec[] Formats =
    [
        new("gray1", 13, 7, 1, 0), new("gray2", 13, 7, 2, 0), new("gray4", 13, 7, 4, 0), new("gray8", 13, 7, 8, 0), new("gray16", 13, 7, 16, 0),
        new("gray8-trns", 13, 7, 8, 0, Trns: 1), new("gray16-trns", 13, 7, 16, 0, Trns: 1), new("gray1-trns", 13, 7, 1, 0, Trns: 1),
        new("graya8", 13, 7, 8, 4), new("graya16", 13, 7, 16, 4),
        new("rgb8", 13, 7, 8, 2), new("rgb16", 13, 7, 16, 2), new("rgb8-trns", 13, 7, 8, 2, Trns: 1), new("rgb16-trns", 13, 7, 16, 2, Trns: 1),
        new("pal1", 13, 7, 1, 3, Palette: true), new("pal2", 13, 7, 2, 3, Palette: true), new("pal4", 13, 7, 4, 3, Palette: true),
        new("pal8", 13, 7, 8, 3, Palette: true), new("pal8-trns", 13, 7, 8, 3, Palette: true, Trns: 1),
        new("rgba8", 13, 7, 8, 6), new("rgba16", 13, 7, 16, 6), new("rgba8-1x1", 1, 1, 8, 6),
        new("rgba8-adam7", 13, 11, 8, 6, Interlaced: true), new("gray1-adam7", 13, 11, 1, 0, Interlaced: true),
        new("pal4-adam7", 13, 11, 4, 3, Interlaced: true, Palette: true), new("rgb16-adam7", 13, 11, 16, 2, Interlaced: true),
        new("rgba8-adam7-3x2", 3, 2, 8, 6, Interlaced: true), new("graya8-adam7-1x9", 1, 9, 8, 4, Interlaced: true),
    ];

    private static int Channels(int ct) => ct switch { 0 => 1, 2 => 3, 3 => 1, 4 => 2, _ => 4 };

    public static uint Crc(ReadOnlySpan<byte> data)
    {
        var c = 0xFFFFFFFFu;
        foreach (var b in data) { c ^= b; for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1; }
        return ~c;
    }

    public static void Chunk(List<byte> o, string type, ReadOnlySpan<byte> data)
    {
        var len = new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(len, (uint)data.Length); o.AddRange(len);
        var body = System.Text.Encoding.ASCII.GetBytes(type).Concat(data.ToArray()).ToArray(); o.AddRange(body);
        var crc = new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(crc, Crc(body)); o.AddRange(crc);
    }

    public static byte[] Ihdr(int w, int h, int depth, int ct, bool interlaced)
    {
        var b = new byte[13];
        BinaryPrimitives.WriteUInt32BigEndian(b, (uint)w); BinaryPrimitives.WriteUInt32BigEndian(b.AsSpan(4), (uint)h);
        b[8] = (byte)depth; b[9] = (byte)ct; b[12] = (byte)(interlaced ? 1 : 0);
        return b;
    }

    public static byte[] Zlib(byte[] raw)
    {
        using var ms = new MemoryStream();
        using (var z = new ZLibStream(ms, CompressionLevel.Optimal, true)) z.Write(raw);
        return ms.ToArray();
    }

    /// <summary>Filters one pass of raw (unfiltered) rows in place into PNG scanlines with the given per-row filter.</summary>
    private static byte[] Filter(byte[][] rows, int bpp)
    {
        var o = new List<byte>();
        for (var r = 0; r < rows.Length; r++)
        {
            var f = (byte)(r % 5);
            var cur = rows[r]; var prev = r > 0 ? rows[r - 1] : new byte[cur.Length];
            o.Add(f);
            for (var i = 0; i < cur.Length; i++)
            {
                int a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
                int pred = f switch
                {
                    0 => 0, 1 => a, 2 => b, 3 => (a + b) >> 1,
                    _ => Math.Abs(b - c) <= Math.Abs(a - c) && Math.Abs(b - c) <= Math.Abs(a + b - 2 * c) ? a : Math.Abs(a - c) <= Math.Abs(a + b - 2 * c) ? b : c,
                };
                o.Add((byte)(cur[i] - pred));
            }
        }
        return o.ToArray();
    }

    public static byte[] Build(Spec s)
    {
        var rnd = new Random(s.Name.Aggregate(17, (h, ch) => h * 31 + ch));
        var bitsPerPixel = Channels(s.ColorType) * s.Depth;
        var bpp = Math.Max(1, bitsPerPixel / 8);
        var palEntries = s.Palette ? Math.Min(256, 1 << s.Depth) : 0;
        // Full-resolution packed rows; for indexed images keep indices < palette size.
        byte[] Row(int w)
        {
            var bytes = new byte[(w * bitsPerPixel + 7) / 8];
            rnd.NextBytes(bytes);
            if (s.ColorType == 0 && s.Trns > 0 && s.Depth <= 8)
                for (var i = 0; i < bytes.Length; i += 3) bytes[i] = s.Depth == 8 ? (byte)0x2A : (byte)0;   // hit the tRNS key
            if (s.ColorType == 0 && s.Trns > 0 && s.Depth == 16)
                for (var i = 0; i + 1 < bytes.Length; i += 6) { bytes[i] = 0x12; bytes[i + 1] = 0x34; }
            if (s.ColorType == 2 && s.Trns > 0)
                for (var p = 0; p < w; p += 3)
                    for (var k = 0; k < 3 * (s.Depth / 8); k++) bytes[p * 3 * (s.Depth / 8) + k] = (byte)(0x40 + k);
            // padding bits in the last byte stay random: decoders must ignore them
            return bytes;
        }
        var passes = s.Interlaced
            ? new[] { (0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2) }
            : new[] { (0, 0, 1, 1) };
        var data = new List<byte>();
        foreach (var (x0, y0, dx, dy) in passes)
        {
            int pw = (s.Width - x0 + dx - 1) / dx, ph = (s.Height - y0 + dy - 1) / dy;
            if (pw <= 0 || ph <= 0) continue;
            var rows = Enumerable.Range(0, ph).Select(_ => Row(pw)).ToArray();
            data.AddRange(Filter(rows, bpp));
        }
        var png = new List<byte> { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
        Chunk(png, "IHDR", Ihdr(s.Width, s.Height, s.Depth, s.ColorType, s.Interlaced));
        Chunk(png, "tEXt", "Comment\0T16b test"u8);                       // valid ancillary chunk, ignored
        if (s.Palette)
        {
            var pal = new byte[palEntries * 3]; rnd.NextBytes(pal);
            Chunk(png, "PLTE", pal);
            if (s.Trns > 0) { var t = new byte[Math.Max(1, palEntries / 2)]; rnd.NextBytes(t); Chunk(png, "tRNS", t); }
        }
        else if (s.Trns > 0)
        {
            if (s.ColorType == 0) Chunk(png, "tRNS", s.Depth == 16 ? new byte[] { 0x12, 0x34 } : s.Depth == 8 ? new byte[] { 0, 0x2A } : new byte[] { 0, 0 });
            else Chunk(png, "tRNS", s.Depth == 16 ? new byte[] { 0x40, 0x41, 0x42, 0x43, 0x44, 0x45 } : new byte[] { 0, 0x40, 0, 0x41, 0, 0x42 });
        }
        var z = Zlib(data.ToArray());
        var split = z.Length / 2;                                         // two IDAT chunks
        Chunk(png, "IDAT", z.AsSpan(0, split));
        Chunk(png, "IDAT", z.AsSpan(split));
        Chunk(png, "IEND", []);
        return png.ToArray();
    }

    /// <summary>Wraps an arbitrary zlib payload in a PNG with valid chunk CRCs.</summary>
    public static byte[] WithIdat(int w, int h, int depth, int ct, byte[] zlib, bool interlaced = false)
    {
        var png = new List<byte> { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
        Chunk(png, "IHDR", Ihdr(w, h, depth, ct, interlaced));
        Chunk(png, "IDAT", zlib);
        Chunk(png, "IEND", []);
        return png.ToArray();
    }
}
