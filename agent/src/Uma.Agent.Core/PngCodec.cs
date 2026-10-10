using System.Buffers.Binary;
using System.IO.Compression;

namespace Uma.Agent.Core;

/// <summary>PNG I/O for frames (T16b, 64). Frames are tightly packed, top-down, straight (non-premultiplied) BGRA.
/// <para>Decode is fully managed and validating (review round 1, B1/B2):</para>
/// <list type="number">
/// <item>The whole chunk stream is checked first: chunk lengths, chunk CRC-32, IHDR first and length 13, exactly one IHDR,
/// at most one PLTE and tRNS in the right place, contiguous IDATs, IEND last and nothing after it, no unknown critical
/// chunks.</item>
/// <item>IHDR is checked against the decode limits, and the exact size of the filtered image (rows plus filter bytes, per
/// Adam7 pass when interlaced) is computed from it.</item>
/// <item>The zlib stream is inflated with the BCL <see cref="ZLibStream"/> into a buffer of exactly that size. One byte
/// more than expected, or one byte less, is refused, so an inflate bomb never grows past the declared image. The
/// zlib header and the Adler-32 checksum (recomputed here over the inflated bytes) must both match.</item>
/// <item>Scanlines are unfiltered and converted to BGRA with the conventions of the previous decoder (SixLabors.ImageSharp
/// 3.1.12: 16-bit to 8-bit as round(v/257), sub-byte greys scaled to 0–255). The output is byte-identical to it on all
/// 15 fixtures and every synthetic colour type, depth and interlace case, except where 3.1.12 deviated from the PNG
/// specification (16-bit tRNS keys, Adam7 images under 8 px; see PngDecodeSafetyTests).</item>
/// </list>
/// Encode is the same managed code path in reverse (see <see cref="Encode"/>). No third-party image library is used.</summary>
public static class PngCodec
{
    private static readonly byte[] Signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    /// <summary>Largest side accepted on decode (PNG input is fixture screenshots and `--record-ocr` inputs only).</summary>
    public const int MaxDimension = 16384;

    /// <summary>Largest pixel count accepted on decode: an 8K (7680x4320) 16:9 client area, about 127 MiB of BGRA.</summary>
    public const long MaxPixels = 7680L * 4320;

    /// <summary>Largest encoded PNG accepted (file size checked before it is read).</summary>
    public const long MaxEncodedBytes = 256L * 1024 * 1024;

    // Adam7 passes: x start, y start, x step, y step.
    private static readonly (int X, int Y, int Dx, int Dy)[] Adam7 = [(0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)];

    private sealed record Header(int Width, int Height, int Depth, int ColorType, bool Interlaced)
    {
        public int Channels => ColorType switch { 0 => 1, 2 => 3, 3 => 1, 4 => 2, 6 => 4, _ => 0 };
        public int BitsPerPixel => Channels * Depth;
        public long RowBytes(int width) => ((long)width * BitsPerPixel + 7) / 8;
    }

    private static InvalidDataException Bad(string why) => new($"corrupt or unsupported PNG image: {why}");

    /// <summary>Decodes a PNG into a straight BGRA frame. Any malformed, corrupt or over-limit input throws
    /// <see cref="InvalidDataException"/>; nothing partially decoded is ever returned.</summary>
    public static Frame Decode(byte[] png)
    {
        ArgumentNullException.ThrowIfNull(png);
        if (png.Length > MaxEncodedBytes) throw new InvalidDataException($"PNG image of {png.Length} bytes exceeds the {MaxEncodedBytes} byte decode limit");
        if (png.Length < Signature.Length || !png.AsSpan(0, Signature.Length).SequenceEqual(Signature))
            throw new InvalidDataException("not a PNG image (bad signature)");

        Header? header = null;
        byte[]? palette = null, transparency = null;
        var idat = new List<(int Offset, int Length)>();
        long idatBytes = 0;
        bool idatDone = false, ended = false;
        var pos = Signature.Length;
        var index = 0;
        while (!ended)
        {
            if (png.Length - pos < 12) throw Bad("truncated chunk");
            var length = BinaryPrimitives.ReadUInt32BigEndian(png.AsSpan(pos));
            if (length > int.MaxValue || length > (uint)(png.Length - pos - 12)) throw Bad("chunk length out of range");
            var type = png.AsSpan(pos + 4, 4);
            foreach (var c in type) if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))) throw Bad("invalid chunk type");
            var data = pos + 8;
            var crc = BinaryPrimitives.ReadUInt32BigEndian(png.AsSpan(data + (int)length));
            if (Crc32(png.AsSpan(pos + 4, 4 + (int)length)) != crc) throw Bad("chunk CRC mismatch");
            var name = System.Text.Encoding.ASCII.GetString(type);
            var body = png.AsSpan(data, (int)length);
            if (index == 0 && name != "IHDR") throw Bad("IHDR is not the first chunk");
            if (name != "IDAT" && idat.Count > 0) idatDone = true;
            switch (name)
            {
                case "IHDR":
                    if (index != 0) throw Bad("duplicate IHDR");
                    if (length != 13) throw Bad("IHDR length is not 13");
                    header = ParseHeader(body);
                    break;
                case "PLTE":
                    if (palette is not null || idat.Count > 0 || transparency is not null) throw Bad("misplaced or duplicate PLTE");
                    if (length == 0 || length % 3 != 0 || length > 768) throw Bad("invalid PLTE length");
                    if (header!.ColorType is 0 or 4) throw Bad("PLTE not allowed for greyscale");
                    palette = body.ToArray();
                    break;
                case "tRNS":
                    if (transparency is not null || idat.Count > 0) throw Bad("misplaced or duplicate tRNS");
                    switch (header!.ColorType)
                    {
                        case 0 when length == 2: break;
                        case 2 when length == 6: break;
                        case 3 when palette is not null && length <= palette.Length / 3: break;
                        default: throw Bad("invalid tRNS for colour type");
                    }
                    transparency = body.ToArray();
                    break;
                case "IDAT":
                    if (idatDone) throw Bad("IDAT chunks are not contiguous");
                    idat.Add((data, (int)length));
                    idatBytes += length;
                    break;
                case "IEND":
                    if (length != 0) throw Bad("IEND length is not 0");
                    if (data + 4 != png.Length) throw Bad("data after IEND");
                    ended = true;
                    break;
                default:
                    if ((type[0] & 0x20) == 0) throw Bad($"unknown critical chunk {name}");
                    break;                                   // unknown ancillary chunk: CRC checked, content ignored
            }
            pos = data + (int)length + 4;
            index++;
        }
        if (header is null) throw Bad("missing IHDR");
        if (idat.Count == 0) throw Bad("missing IDAT");
        if (header.ColorType == 3 && palette is null) throw Bad("missing PLTE for indexed colour");

        var raw = Inflate(png, idat, idatBytes, FilteredSize(header));
        return ToBgra(header, raw, palette, transparency);
    }

    private static Header ParseHeader(ReadOnlySpan<byte> b)
    {
        var w = BinaryPrimitives.ReadUInt32BigEndian(b);
        var h = BinaryPrimitives.ReadUInt32BigEndian(b[4..]);
        if (w == 0 || h == 0) throw Bad("zero size");
        if (w > MaxDimension || h > MaxDimension || (long)w * h > MaxPixels)
            throw new InvalidDataException($"PNG image {w}x{h} exceeds the {MaxDimension}px side / {MaxPixels} pixel decode limit");
        int depth = b[8], color = b[9];
        var valid = color switch
        {
            0 => depth is 1 or 2 or 4 or 8 or 16,
            3 => depth is 1 or 2 or 4 or 8,
            2 or 4 or 6 => depth is 8 or 16,
            _ => false,
        };
        if (!valid) throw Bad($"invalid colour type {color} / bit depth {depth}");
        if (b[10] != 0 || b[11] != 0 || b[12] > 1) throw Bad("unknown compression, filter or interlace method");
        return new Header((int)w, (int)h, depth, color, b[12] == 1);
    }

    private static IEnumerable<(int X, int Y, int Dx, int Dy, int Width, int Height)> Passes(Header h)
    {
        if (!h.Interlaced) { yield return (0, 0, 1, 1, h.Width, h.Height); yield break; }
        foreach (var (x, y, dx, dy) in Adam7)
        {
            int pw = (h.Width - x + dx - 1) / dx, ph = (h.Height - y + dy - 1) / dy;
            if (pw > 0 && ph > 0) yield return (x, y, dx, dy, pw, ph);
        }
    }

    private static int FilteredSize(Header h)
    {
        long total = 0;
        foreach (var p in Passes(h)) total += (h.RowBytes(p.Width) + 1) * p.Height;
        if (total > int.MaxValue - 64) throw new InvalidDataException("PNG image exceeds the decode limit");
        return (int)total;
    }

    /// <summary>Inflates the concatenated IDAT data into exactly <paramref name="expected"/> bytes, refusing any shortfall or
    /// excess (bounded: at most one byte beyond the image is ever produced) and verifying the zlib header and Adler-32.</summary>
    private static byte[] Inflate(byte[] png, List<(int Offset, int Length)> idat, long idatBytes, int expected)
    {
        if (idatBytes < 6) throw Bad("zlib stream too short");
        // Deflate cannot expand by more than 1032:1, so a payload this small cannot fill the declared image: refuse it
        // before allocating the image-sized buffer.
        if ((idatBytes - 6) * 1032 + 1024 < expected) throw Bad("image data is shorter than the header declares");
        var z = new byte[idatBytes];
        var at = 0;
        foreach (var (offset, length) in idat) { Buffer.BlockCopy(png, offset, z, at, length); at += length; }
        int cmf = z[0], flg = z[1];
        if ((cmf & 0x0F) != 8 || (cmf >> 4) > 7 || ((cmf << 8) | flg) % 31 != 0 || (flg & 0x20) != 0) throw Bad("invalid zlib header");
        var raw = new byte[expected];
        try
        {
            using var input = new MemoryStream(z, writable: false);
            using var zlib = new ZLibStream(input, CompressionMode.Decompress);
            var filled = 0;
            while (filled < expected)
            {
                var n = zlib.Read(raw, filled, expected - filled);
                if (n == 0) throw Bad("image data is shorter than the header declares");
                filled += n;
            }
            Span<byte> probe = stackalloc byte[1];
            if (zlib.Read(probe) != 0) throw Bad("image data is longer than the header declares");
        }
        catch (InvalidDataException) { throw; }
        catch (Exception e) when (e is IOException or NotSupportedException or ArgumentException)
        {
            throw new InvalidDataException("corrupt or unsupported PNG image: invalid zlib data", e);
        }
        // ZLibStream checks Adler-32 when it is present but accepts a stream that ends without it; require it here.
        if (BinaryPrimitives.ReadUInt32BigEndian(z.AsSpan(z.Length - 4)) != Adler32(raw)) throw Bad("zlib Adler-32 mismatch or missing");
        return raw;
    }

    private static Frame ToBgra(Header h, byte[] raw, byte[]? palette, byte[]? trns)
    {
        var output = new byte[checked(h.Width * h.Height * 4)];
        var bpp = Math.Max(1, h.BitsPerPixel / 8);                // filter byte distance
        var offset = 0;
        foreach (var p in Passes(h))
        {
            var rowBytes = (int)h.RowBytes(p.Width);
            for (var r = 0; r < p.Height; r++)
            {
                var filter = raw[offset];
                var row = raw.AsSpan(offset + 1, rowBytes);
                var prior = r == 0 ? Span<byte>.Empty : raw.AsSpan(offset - rowBytes, rowBytes);
                Unfilter(filter, row, prior, bpp);
                var y = p.Y + r * p.Dy;
                for (var c = 0; c < p.Width; c++) Pixel(h, row, c, output.AsSpan(((y * h.Width) + p.X + c * p.Dx) * 4, 4), palette, trns);
                offset += rowBytes + 1;
            }
        }
        return new Frame(output, h.Width, h.Height);
    }

    private static void Unfilter(byte filter, Span<byte> row, ReadOnlySpan<byte> prior, int bpp)
    {
        var hasPrior = !prior.IsEmpty;
        switch (filter)
        {
            case 0: break;
            case 1: for (var i = bpp; i < row.Length; i++) row[i] += row[i - bpp]; break;
            case 2: if (hasPrior) for (var i = 0; i < row.Length; i++) row[i] += prior[i]; break;
            case 3:
                for (var i = 0; i < row.Length; i++)
                    row[i] += (byte)(((i >= bpp ? row[i - bpp] : 0) + (hasPrior ? prior[i] : 0)) >> 1);
                break;
            case 4:
                for (var i = 0; i < row.Length; i++)
                {
                    int a = i >= bpp ? row[i - bpp] : 0, b = hasPrior ? prior[i] : 0, c = i >= bpp && hasPrior ? prior[i - bpp] : 0;
                    int pa = Math.Abs(b - c), pb = Math.Abs(a - c), pc = Math.Abs(a + b - 2 * c);
                    row[i] += (byte)(pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
                }
                break;
            default: throw Bad($"invalid filter type {filter}");
        }
    }

    private static int Sample(ReadOnlySpan<byte> row, int index, int depth) => depth switch
    {
        16 => (row[index * 2] << 8) | row[index * 2 + 1],
        8 => row[index],
        _ => (row[index * depth / 8] >> (8 - depth - (index * depth % 8))) & ((1 << depth) - 1),
    };

    // 16 → 8 bit: round(v / 257), as ImageSharp 3.1.12 converts Rgba64/L16 to Rgba32.
    private static byte To8(int v, int depth) => depth switch
    {
        16 => (byte)((v * 255L + 32895) >> 16),
        8 => (byte)v,
        _ => (byte)(v * 255 / ((1 << depth) - 1)),
    };

    private static void Pixel(Header h, ReadOnlySpan<byte> row, int x, Span<byte> bgra, byte[]? palette, byte[]? trns)
    {
        var d = h.Depth;
        switch (h.ColorType)
        {
            case 0:
                {
                    var v = Sample(row, x, d);
                    var g = To8(v, d);
                    var transparent = trns is not null && v == ((trns[0] << 8) | trns[1]);
                    bgra[0] = g; bgra[1] = g; bgra[2] = g; bgra[3] = transparent ? (byte)0 : (byte)255;
                    break;
                }
            case 2:
                {
                    int r = Sample(row, x * 3, d), g = Sample(row, x * 3 + 1, d), b = Sample(row, x * 3 + 2, d);
                    var transparent = trns is not null && r == ((trns[0] << 8) | trns[1]) && g == ((trns[2] << 8) | trns[3]) && b == ((trns[4] << 8) | trns[5]);
                    bgra[0] = To8(b, d); bgra[1] = To8(g, d); bgra[2] = To8(r, d); bgra[3] = transparent ? (byte)0 : (byte)255;
                    break;
                }
            case 3:
                {
                    var i = Sample(row, x, d);
                    if (i * 3 + 2 >= palette!.Length) throw Bad("palette index out of range");
                    bgra[0] = palette[i * 3 + 2]; bgra[1] = palette[i * 3 + 1]; bgra[2] = palette[i * 3];
                    bgra[3] = trns is not null && i < trns.Length ? trns[i] : (byte)255;
                    break;
                }
            case 4:
                {
                    var g = To8(Sample(row, x * 2, d), d);
                    bgra[0] = g; bgra[1] = g; bgra[2] = g; bgra[3] = To8(Sample(row, x * 2 + 1, d), d);
                    break;
                }
            default:
                bgra[0] = To8(Sample(row, x * 4 + 2, d), d); bgra[1] = To8(Sample(row, x * 4 + 1, d), d);
                bgra[2] = To8(Sample(row, x * 4, d), d); bgra[3] = To8(Sample(row, x * 4 + 3, d), d);
                break;
        }
    }

    private static readonly uint[] CrcTable = BuildCrcTable();

    private static uint[] BuildCrcTable()
    {
        var t = new uint[256];
        for (uint n = 0; n < 256; n++)
        {
            var c = n;
            for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            t[n] = c;
        }
        return t;
    }

    internal static uint Crc32(ReadOnlySpan<byte> data) => ~Crc32Update(0xFFFFFFFFu, data);

    private static uint Crc32Update(uint c, ReadOnlySpan<byte> data)
    {
        foreach (var b in data) c = CrcTable[(c ^ b) & 0xFF] ^ (c >> 8);
        return c;
    }

    internal static uint Adler32(ReadOnlySpan<byte> data)
    {
        uint a = 1, b = 0;
        while (!data.IsEmpty)
        {
            var n = Math.Min(data.Length, 5552);
            foreach (var x in data[..n]) { a += x; b += a; }
            a %= 65521; b %= 65521;
            data = data[n..];
        }
        return (b << 16) | a;
    }

    /// <summary>Encodes a straight BGRA frame as an 8-bit RGBA PNG (colour type 6, non-interlaced; only IHDR, IDAT and IEND).
    /// Each row uses the PNG filter with the smallest sum of absolute signed residuals (the minimum-sum-of-absolute-
    /// differences heuristic from the PNG specification, §12.8), and the zlib stream is written by the BCL
    /// <see cref="ZLibStream"/> at <see cref="CompressionLevel.SmallestSize"/>. Everything is managed and disposed with
    /// <c>using</c>, including on failure.</summary>
    public static byte[] Encode(Frame frame)
    {
        ArgumentNullException.ThrowIfNull(frame);
        if (frame.Width <= 0 || frame.Height <= 0 || frame.Bgra.Length != checked(frame.Width * frame.Height * 4))
            throw new ArgumentException($"frame {frame.Width}x{frame.Height} does not hold tightly packed BGRA pixels", nameof(frame));
        int width = frame.Width, height = frame.Height, stride = checked(width * 4);
        var current = new byte[stride];
        var previous = new byte[stride];
        var filtered = new byte[5][];
        for (var f = 0; f < 5; f++) filtered[f] = new byte[stride + 1];
        using var compressed = new MemoryStream();
        using (var zlib = new ZLibStream(compressed, CompressionLevel.SmallestSize, leaveOpen: true))
        {
            for (var y = 0; y < height; y++)
            {
                var o = y * stride;
                for (var x = 0; x < stride; x += 4)
                {
                    current[x] = frame.Bgra[o + x + 2]; current[x + 1] = frame.Bgra[o + x + 1]; current[x + 2] = frame.Bgra[o + x]; current[x + 3] = frame.Bgra[o + x + 3];
                }
                var best = 0; var bestSum = long.MaxValue;
                for (var f = 0; f < 5; f++)
                {
                    var line = filtered[f];
                    line[0] = (byte)f;
                    long sum = 0;
                    for (var i = 0; i < stride; i++)
                    {
                        int a = i >= 4 ? current[i - 4] : 0, b = y > 0 ? previous[i] : 0, c = i >= 4 && y > 0 ? previous[i - 4] : 0;
                        var predictor = f switch { 0 => 0, 1 => a, 2 => b, 3 => (a + b) >> 1, _ => Paeth(a, b, c) };
                        var v = (byte)(current[i] - predictor);
                        line[i + 1] = v;
                        sum += v < 128 ? v : 256 - v;
                    }
                    if (sum < bestSum) { bestSum = sum; best = f; }
                }
                zlib.Write(filtered[best]);
                (previous, current) = (current, previous);
            }
        }
        using var output = new MemoryStream();
        output.Write(Signature);
        Span<byte> ihdr = stackalloc byte[13];
        BinaryPrimitives.WriteUInt32BigEndian(ihdr, (uint)width);
        BinaryPrimitives.WriteUInt32BigEndian(ihdr[4..], (uint)height);
        ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
        WriteChunk(output, "IHDR"u8, ihdr);
        WriteChunk(output, "IDAT"u8, compressed.GetBuffer().AsSpan(0, (int)compressed.Length));
        WriteChunk(output, "IEND"u8, []);
        return output.ToArray();
    }

    private static int Paeth(int a, int b, int c)
    {
        int pa = Math.Abs(b - c), pb = Math.Abs(a - c), pc = Math.Abs(a + b - 2 * c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }

    private static void WriteChunk(Stream output, ReadOnlySpan<byte> type, ReadOnlySpan<byte> data)
    {
        Span<byte> word = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(word, (uint)data.Length);
        output.Write(word);
        output.Write(type);
        output.Write(data);
        var crc = Crc32Update(Crc32Update(0xFFFFFFFFu, type), data) ^ 0xFFFFFFFFu;
        BinaryPrimitives.WriteUInt32BigEndian(word, crc);
        output.Write(word);
    }
}
