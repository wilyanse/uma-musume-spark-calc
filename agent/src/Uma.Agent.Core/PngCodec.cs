using Hjg.Pngcs;
using StbImageSharp;

namespace Uma.Agent.Core;

/// <summary>PNG I/O for frames (T16b, 64). Managed, license-key-free libraries, exact-pinned in Uma.Agent.Core.csproj:
/// decode with StbImageSharp (MIT OR Unlicense), encode with Hjg.Pngcs (Apache-2.0; zlib via the BCL DeflateStream).
/// Frames are tightly packed, top-down, straight (non-premultiplied) BGRA.</summary>
public static class PngCodec
{
    private static readonly byte[] Signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    /// <summary>Largest side accepted on decode (PNG input is fixture screenshots and `--record-ocr` inputs only).</summary>
    public const int MaxDimension = 16384;

    /// <summary>Largest pixel count accepted on decode: an 8K (7680x4320) 16:9 client area, about 127 MiB of BGRA.</summary>
    public const long MaxPixels = 7680L * 4320;

    /// <summary>Decodes a PNG into a straight BGRA frame. Non-PNG or corrupt input throws <see cref="InvalidDataException"/>.
    /// Only PNG is accepted: the agent never reads other image formats, so other decoders stay unreachable.</summary>
    public static Frame Decode(byte[] png)
    {
        ArgumentNullException.ThrowIfNull(png);
        if (png.Length < Signature.Length || !png.AsSpan(0, Signature.Length).SequenceEqual(Signature))
            throw new InvalidDataException("not a PNG image (bad signature)");
        // Size guard from IHDR before the decoder allocates anything (bounded memory on hostile or huge input).
        if (png.Length < 33 || !png.AsSpan(12, 4).SequenceEqual("IHDR"u8))
            throw new InvalidDataException("corrupt PNG image (missing IHDR)");
        var w = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(png.AsSpan(16, 4));
        var h = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(png.AsSpan(20, 4));
        if (w == 0 || h == 0) throw new InvalidDataException("corrupt PNG image (zero size)");
        if (w > MaxDimension || h > MaxDimension || (long)w * h > MaxPixels)
            throw new InvalidDataException($"PNG image {w}x{h} exceeds the {MaxDimension}px side / {MaxPixels} pixel decode limit");
        ImageResult image;
        try { image = ImageResult.FromMemory(png, ColorComponents.RedGreenBlueAlpha); }
        catch (Exception e) when (e is InvalidOperationException or ArgumentException or IndexOutOfRangeException or OverflowException or NullReferenceException or IOException)
        {
            throw new InvalidDataException("corrupt or unsupported PNG image", e);
        }
        if (image is null || image.Width != w || image.Height != h || image.Comp != ColorComponents.RedGreenBlueAlpha
            || image.Data is null || image.Data.LongLength != (long)image.Width * image.Height * 4)
            throw new InvalidDataException("corrupt or unsupported PNG image");
        var bgra = image.Data;                                   // fresh array owned by us: swap R/B in place
        for (var p = 0; p < bgra.Length; p += 4) (bgra[p], bgra[p + 2]) = (bgra[p + 2], bgra[p]);
        return new Frame(bgra, image.Width, image.Height);
    }

    /// <summary>Encodes a straight BGRA frame as an 8-bit RGBA PNG (colour type 6, non-interlaced, maximum deflate level the
    /// encoder exposes). Only IHDR/IDAT/IEND are written.</summary>
    public static byte[] Encode(Frame frame)
    {
        ArgumentNullException.ThrowIfNull(frame);
        if (frame.Width <= 0 || frame.Height <= 0 || frame.Bgra.Length != checked(frame.Width * frame.Height * 4))
            throw new ArgumentException($"frame {frame.Width}x{frame.Height} does not hold tightly packed BGRA pixels", nameof(frame));
        using var output = new MemoryStream();
        var writer = new PngWriter(output, new Hjg.Pngcs.ImageInfo(frame.Width, frame.Height, 8, true)) { CompLevel = 9, ShouldCloseStream = false };
        var row = new byte[frame.Width * 4];
        for (var y = 0; y < frame.Height; y++)
        {
            var o = y * frame.Width * 4;
            for (var x = 0; x < row.Length; x += 4)
            {
                row[x] = frame.Bgra[o + x + 2]; row[x + 1] = frame.Bgra[o + x + 1]; row[x + 2] = frame.Bgra[o + x]; row[x + 3] = frame.Bgra[o + x + 3];
            }
            writer.WriteRowByte(row, y);
        }
        writer.End();
        return output.ToArray();
    }
}
