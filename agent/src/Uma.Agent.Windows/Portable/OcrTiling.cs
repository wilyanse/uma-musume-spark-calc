using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Uma.Agent.Core;

namespace Uma.Agent.Windows.Shell;

/// <summary>Full-frame OCR recording within Windows OCR's <c>MaxImageDimension</c> at exactly ×2 (T10 review S2).
/// Tiles overlap by <see cref="Overlap"/> reference px (longer than any fixture line: the longest, on fixture 14, is
/// 493 px). A line is kept only from the first tile whose interior fully contains its box (an interior seam edge does
/// not count as interior), so a line cut by a seam is never recorded in pieces. A seam-cut line that no tile contains
/// fully (longer than the overlap) gets its horizontal band re-read once at ×2, centred on it.</summary>
public static class OcrTiling
{
    public const int Overlap = 600;
    /// <summary>A box this close to an interior seam counts as cut by it.</summary>
    public const int SeamMargin = 2;

    /// <summary>Largest reference-space side that stays within <paramref name="maxImageDimension"/> at ×2.</summary>
    public static int Cap(uint maxImageDimension)
    {
        var cap = (int)Math.Min(int.MaxValue, maxImageDimension / 2);
        if (cap < Overlap + 100) throw new CaptureUnavailableException($"Windows OCR maximum image dimension ({maxImageDimension}) is too small for ×2 recording.");
        return cap;
    }

    public static IReadOnlyList<Rect> Tiles(Rect roi, int cap)
    {
        static IReadOnlyList<(int Start, int Length)> Axis(int start, int length, int cap)
        {
            if (length <= cap) return [(start, length)];
            var list = new List<(int, int)>();
            for (var s = start; ; s += cap - Overlap)
            {
                var len = Math.Min(cap, start + length - s);
                list.Add((s, len));
                if (s + len >= start + length) return list;
            }
        }
        return Axis(roi.Y, roi.Height, cap).SelectMany(y => Axis(roi.X, roi.Width, cap).Select(x => new Rect(x.Start, y.Start, x.Length, y.Length))).ToArray();
    }

    /// <summary>True when <paramref name="box"/> lies inside <paramref name="tile"/> and clear of every seam (tile edge
    /// that is not an edge of <paramref name="roi"/>).</summary>
    public static bool Interior(Rect tile, Rect roi, Rect box)
    {
        int left = tile.X == roi.X ? tile.X : tile.X + SeamMargin, top = tile.Y == roi.Y ? tile.Y : tile.Y + SeamMargin;
        int right = tile.X + tile.Width == roi.X + roi.Width ? tile.X + tile.Width : tile.X + tile.Width - SeamMargin;
        int bottom = tile.Y + tile.Height == roi.Y + roi.Height ? tile.Y + tile.Height : tile.Y + tile.Height - SeamMargin;
        return box.X >= left && box.Y >= top && box.X + box.Width <= right && box.Y + box.Height <= bottom;
    }

    private static bool SameLine(Rect a, Rect b)
    {
        int x0 = Math.Max(a.X, b.X), y0 = Math.Max(a.Y, b.Y), x1 = Math.Min(a.X + a.Width, b.X + b.Width), y1 = Math.Min(a.Y + a.Height, b.Y + b.Height);
        if (x1 <= x0 || y1 <= y0) return false;
        double inter = (double)(x1 - x0) * (y1 - y0);
        return inter >= 0.5 * Math.Min((double)a.Width * a.Height, (double)b.Width * b.Height);
    }

    /// <summary>Reads <paramref name="roi"/> through <paramref name="recognize"/> (one ×2 OCR call per rectangle, each
    /// within <paramref name="cap"/>) and returns each line once, top-to-bottom then left-to-right.</summary>
    public static async Task<IReadOnlyList<OcrLine>> ReadAsync(Rect roi, int cap, Func<Rect, Task<IReadOnlyList<OcrLine>>> recognize)
    {
        if (roi.Width <= cap && roi.Height <= cap) return await recognize(roi);
        var tiles = Tiles(roi, cap);
        var kept = new List<OcrLine>();
        var cut = new List<Rect>();
        foreach (var tile in tiles)
        {
            foreach (var l in await recognize(tile))
            {
                var owner = tiles.FirstOrDefault(t => Interior(t, roi, l.Box));
                if (owner == tile) kept.Add(l);
                else if (!Interior(tile, roi, l.Box) && owner == default) cut.Add(l.Box);   // cut by this tile's seam, no tile holds it whole
            }
        }
        var bands = new HashSet<Rect>();
        foreach (var box in cut.Where(b => !kept.Any(k => SameLine(k.Box, b))))
        {
            const int pad = 8;
            var width = Math.Min(cap, roi.Width);
            var x = Math.Clamp(box.X + box.Width / 2 - width / 2, roi.X, roi.X + roi.Width - width);
            var y = Math.Max(roi.Y, box.Y - pad);
            var band = new Rect(x, y, width, Math.Min(Math.Min(cap, box.Height + 2 * pad), roi.Y + roi.Height - y));
            if (!bands.Add(band)) continue;
            foreach (var l in await recognize(band))
                if (Interior(band, roi, l.Box) && !kept.Any(k => SameLine(k.Box, l.Box))) kept.Add(l);
        }
        return kept.OrderBy(l => l.Box.Y).ThenBy(l => l.Box.X).ToArray();
    }
}
