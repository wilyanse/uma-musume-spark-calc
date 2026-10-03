using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace Uma.Agent.Core;

public abstract class UnsupportedFrameException(int width, int height, string message) : Exception(message)
{
    public int Width { get; } = width;
    public int Height { get; } = height;
}

public sealed class UnsupportedAspectRatioException(int width, int height)
    : UnsupportedFrameException(width, height, $"unsupported aspect ratio {width}x{height}: only 16:9 game client areas are supported");

/// <summary>16:9 client areas below the 1920x1080 reference are refused (review round 1, B2; Q-94). The pixel thresholds
/// (glyph centre luma, LB diamonds, borrowed band, pill colour) were calibrated at 1920x1080 only, and resampled
/// smaller frames produced confident-wrong values, so nothing is read from them. The user must enlarge the window.</summary>
public sealed class UnsupportedResolutionException(int width, int height)
    : UnsupportedFrameException(width, height, $"game client area {width}x{height} is below 1920x1080: make the game window at least 1920x1080 (16:9) and try again");

/// <summary>Public parser primitives accept only an already-normalized reference frame (SF3).</summary>
public sealed class NonReferenceFrameException(int width, int height)
    : UnsupportedFrameException(width, height, $"parser primitive requires exactly 1920x1080, received {width}x{height}: use FrameParser.ParseAsync for arbitrary supported client sizes, or normalize first with Frames.Normalize and use reference-space OCR coordinates");

/// <summary>BGRA frame helpers. Every parser works in the 1920x1080 reference space (30 §2).</summary>
public static class Frames
{
    public static Frame Load(string pngPath)
    {
        using var image = Image.Load<Rgba32>(pngPath);
        return FromImage(image);
    }

    public static Frame FromImage(Image<Rgba32> image)
    {
        var bytes = new byte[image.Width * image.Height * 4];
        image.ProcessPixelRows(rows =>
        {
            for (var y = 0; y < rows.Height; y++)
            {
                var row = rows.GetRowSpan(y);
                for (var x = 0; x < row.Length; x++)
                {
                    var p = (y * image.Width + x) * 4;
                    bytes[p] = row[x].B; bytes[p + 1] = row[x].G; bytes[p + 2] = row[x].R; bytes[p + 3] = row[x].A;
                }
            }
        });
        return new Frame(bytes, image.Width, image.Height);
    }

    public static Image<Rgba32> ToImage(Frame frame)
    {
        var image = new Image<Rgba32>(frame.Width, frame.Height);
        image.ProcessPixelRows(rows =>
        {
            for (var y = 0; y < rows.Height; y++)
            {
                var row = rows.GetRowSpan(y);
                for (var x = 0; x < row.Length; x++)
                {
                    var p = (y * frame.Width + x) * 4;
                    row[x] = new Rgba32(frame.Bgra[p + 2], frame.Bgra[p + 1], frame.Bgra[p], frame.Bgra[p + 3]);
                }
            }
        });
        return image;
    }

    /// <summary>Rejects non-16:9 client areas and 16:9 areas below 1920x1080 (typed errors, before any reading), and
    /// resamples larger 16:9 sizes down into reference space.</summary>
    public static Frame Normalize(Frame frame)
    {
        if (frame.Width <= 0 || frame.Height <= 0 || (long)frame.Width * 9 != (long)frame.Height * 16)
            throw new UnsupportedAspectRatioException(frame.Width, frame.Height);
        if (frame.Width < LayoutProfiles.ReferenceWidth) throw new UnsupportedResolutionException(frame.Width, frame.Height);
        if (frame.Width == LayoutProfiles.ReferenceWidth) return frame;
        using var image = ToImage(frame);
        image.Mutate(c => c.Resize(LayoutProfiles.ReferenceWidth, LayoutProfiles.ReferenceHeight, KnownResamplers.Bicubic));
        return FromImage(image);
    }

    /// <summary>Refuses raw client-sized frames at calibrated parser entry, before any OCR or pixel reading.
    /// Crops and OCR boxes passed to primitives must also be expressed in reference space.</summary>
    internal static void RequireReference(Frame frame)
    {
        if (frame.Width != LayoutProfiles.ReferenceWidth || frame.Height != LayoutProfiles.ReferenceHeight)
            throw new NonReferenceFrameException(frame.Width, frame.Height);
    }

    public static Frame Crop(Frame frame, Rect r)
    {
        if (r.X < 0 || r.Y < 0 || r.Width <= 0 || r.Height <= 0 || r.X + r.Width > frame.Width || r.Y + r.Height > frame.Height)
            throw new ArgumentOutOfRangeException(nameof(r), $"crop {r} outside {frame.Width}x{frame.Height}");
        var bytes = new byte[r.Width * r.Height * 4];
        for (var y = 0; y < r.Height; y++)
            Buffer.BlockCopy(frame.Bgra, ((r.Y + y) * frame.Width + r.X) * 4, bytes, y * r.Width * 4, r.Width * 4);
        return new Frame(bytes, r.Width, r.Height);
    }

    public static (int R, int G, int B) Rgb(this Frame f, int x, int y)
    {
        var p = (y * f.Width + x) * 4;
        return (f.Bgra[p + 2], f.Bgra[p + 1], f.Bgra[p]);
    }

    public static int Luma(this Frame f, int x, int y)
    {
        var (r, g, b) = f.Rgb(x, y);
        return (299 * r + 587 * g + 114 * b) / 1000;
    }

    public static double ColorDistance((int R, int G, int B) a, IReadOnlyList<int> b)
        => Math.Sqrt(Math.Pow(a.R - b[0], 2) + Math.Pow(a.G - b[1], 2) + Math.Pow(a.B - b[2], 2));

    /// <summary>Median colour of a rectangle (per channel), robust to text pixels.</summary>
    public static (int R, int G, int B) Median(this Frame f, Rect r)
    {
        var rs = new List<int>(); var gs = new List<int>(); var bs = new List<int>();
        for (var y = r.Y; y < r.Y + r.Height; y++)
            for (var x = r.X; x < r.X + r.Width; x++) { var (R, G, B) = f.Rgb(x, y); rs.Add(R); gs.Add(G); bs.Add(B); }
        static int Mid(List<int> v) { v.Sort(); return v[v.Count / 2]; }
        return (Mid(rs), Mid(gs), Mid(bs));
    }

    public static string DHash(this Frame f, Rect r, LayoutCrop? crop = null) => PixelAlgorithms.DHash(Crop(f, r), crop);
}
