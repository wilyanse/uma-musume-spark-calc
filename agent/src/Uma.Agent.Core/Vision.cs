namespace Uma.Agent.Core;

public sealed record StarStrip(int Column, int Y0, int Y1, int Stars, double[] Ratios, string? Type, double TypeDistance);
public sealed record ScrollThumb(int Top, int Bottom);

/// <summary>Pixel parsers (30 §4) on reference-space frames. Every constant comes from the layout profile.</summary>
public static class Vision
{
    private static bool Gold((int R, int G, int B) p) => p.R > 200 && p.G > 150 && p.B < 90 && p.R - p.B > 130;

    /// <summary>Spark star strips under each pill (spike stars.py): a strip is a run of rows whose first star cell holds
    /// gold pixels; stars = cells with gold ratio &gt; fillRatio. Strips whose pill is clipped by the viewport are dropped.</summary>
    public static IReadOnlyList<StarStrip> SparkStrips(Frame f, LayoutProfile layout, string screen)
    {
        var view = layout.Sparks(screen);
        int scanW = layout.Int("sparks", "stars", "scanWidth"), minRow = layout.Int("sparks", "stars", "minRowPixels");
        int gap = layout.Int("sparks", "stars", "rowGap"), minH = layout.Int("sparks", "stars", "minHeight");
        int cellW = layout.Int("sparks", "stars", "cellWidth"); double pitch = layout.Num("sparks", "stars", "cellPitch"), fill = layout.Num("sparks", "stars", "fillRatio");
        var pillTop = layout.Int("sparks", "pillTopOffset");
        var result = new List<StarStrip>();
        for (var c = 0; c < view.Columns.Count; c++)
        {
            var col = view.Columns[c];
            var runs = new List<(int A, int B)>(); int? start = null, prev = null;
            for (var y = view.ViewportTop; y < view.ViewportBottom; y++)
            {
                var n = 0; for (var x = col.StarsX; x < col.StarsX + scanW; x++) if (Gold(f.Rgb(x, y))) n++;
                if (n < minRow) continue;
                if (start is null) start = y; else if (y - prev > gap) { runs.Add((start.Value, prev!.Value)); start = y; }
                prev = y;
            }
            if (start is not null) runs.Add((start.Value, prev!.Value));
            foreach (var (a, b) in runs)
            {
                if (b - a + 1 < minH || b >= view.ViewportBottom - 2 || a + pillTop < view.ViewportTop) continue;
                var ratios = new double[3]; var stars = 0;
                for (var k = 0; k < 3; k++)
                {
                    var x0 = (int)Math.Round(col.StarsX + k * pitch, MidpointRounding.AwayFromZero);
                    int gold = 0, total = 0;
                    for (var y = a; y <= b; y++) for (var x = x0; x < x0 + cellW; x++) { total++; if (Gold(f.Rgb(x, y))) gold++; }
                    ratios[k] = Math.Round((double)gold / total, 3);
                    if (ratios[k] > fill) stars++;
                }
                var (type, dist) = PillType(f, layout, col, a);
                result.Add(new StarStrip(c, a, b, stars, ratios, type, dist));
            }
        }
        return ReadingOrder(result, s => s.Y0, s => s.Column);
    }

    /// <summary>Row-major order where items in different columns whose Y differ by ≤ tolerance share a row
    /// (pill borders of the two columns are offset by 1–2 px).</summary>
    public static T[] ReadingOrder<T>(IEnumerable<T> items, Func<T, int> y, Func<T, int> column, int tolerance = 8)
    {
        var sorted = items.OrderBy(y).ThenBy(column).ToArray();
        var rows = new List<List<T>>();
        foreach (var item in sorted)
            if (rows.Count > 0 && y(item) - y(rows[^1][0]) <= tolerance && rows[^1].All(r => column(r) != column(item))) rows[^1].Add(item);
            else rows.Add([item]);
        return rows.SelectMany(r => r.OrderBy(column)).ToArray();
    }

    /// <summary>Spark type from the pill background (median colour) nearest to the palette within paletteMaxDistance.</summary>
    public static (string? Type, double Distance) PillType(Frame f, LayoutProfile layout, SparkColumn col, int stripY)
    {
        var rows = layout.Ints("sparks", "bgSampleRows"); var xs = layout.Ints("sparks", "bgSampleX");
        var med = f.Median(new Rect(col.Left + xs[0], stripY + rows[0], xs[1] - xs[0], rows[1] - rows[0] + 1));
        string? best = null; var bestD = double.MaxValue;
        foreach (var p in layout.At("sparks", "palette").EnumerateObject())
        {
            var d = Frames.ColorDistance(med, p.Value.EnumerateArray().Select(e => e.GetInt32()).ToArray());
            if (d < bestD) { bestD = d; best = p.Name; }
        }
        return bestD <= layout.Num("sparks", "paletteMaxDistance") ? (best, Math.Round(bestD, 1)) : (null, Math.Round(bestD, 1));
    }

    /// <summary>LB diamond (spike lb.py): filled when &gt; fillRatio of the 5x5 patch is cyan (B−R &gt; 60 and G &gt; 140).</summary>
    public static bool LbFilled(Frame f, LayoutProfile layout, int cx, int cy)
    {
        int r = layout.Int("lb", "patch"), minBr = layout.Int("lb", "minBlueMinusRed"), minG = layout.Int("lb", "minGreen");
        int yes = 0, total = 0;
        for (var y = cy - r; y <= cy + r; y++) for (var x = cx - r; x <= cx + r; x++) { var p = f.Rgb(x, y); total++; if (p.B - p.R > minBr && p.G > minG) yes++; }
        return (double)yes / total > layout.Num("lb", "fillRatio");
    }

    /// <summary>Scroll thumb of the details content area; null when no thumb (content fits or the bar is absent).</summary>
    public static ScrollThumb? Thumb(Frame f, LayoutProfile layout)
    {
        int x = layout.Int("scrollbar", "x"), top = layout.Int("scrollbar", "trackTop"), bottom = layout.Int("scrollbar", "trackBottom");
        int tol = layout.Int("scrollbar", "edgeTolerance"), dark = layout.Int("scrollbar", "darkLuma");
        int? a = null, b = null;
        for (var y = top - tol; y <= bottom + tol; y++) if (f.Luma(x, y) < dark) { a ??= y; b = y; }
        return a is null ? null : new ScrollThumb(a.Value, b!.Value);
    }

    /// <summary>Content offset of the viewport top (px) from the thumb position.</summary>
    public static double ContentOffset(ScrollThumb t, LayoutProfile layout)
    {
        int top = layout.Int("scrollbar", "trackTop"), bottom = layout.Int("scrollbar", "trackBottom");
        int vTop = layout.Int("scrollbar", "viewportTop"), vBottom = layout.Int("scrollbar", "viewportBottom");
        double track = bottom - top + 1, thumb = t.Bottom - t.Top + 1, content = (vBottom - vTop) * track / thumb;
        return Math.Max(0, (t.Top - top) * content / track);
    }

    public static bool AtTop(ScrollThumb? t, LayoutProfile layout) => t is null || t.Top <= layout.Int("scrollbar", "trackTop") + layout.Int("scrollbar", "edgeTolerance");
    public static bool AtEnd(ScrollThumb? t, LayoutProfile layout) => t is null || t.Bottom >= layout.Int("scrollbar", "trackBottom") - layout.Int("scrollbar", "edgeTolerance");

    /// <summary>Bottom border rows of skill pills in one column (dark run at the pill's left border).</summary>
    public static IReadOnlyList<int> SkillPillBottoms(Frame f, LayoutProfile layout, int column)
    {
        var col = layout.At("skills", "columns")[column];
        int x = col.GetProperty("borderX").GetInt32(), luma = layout.Int("skills", "borderLuma");
        int top = layout.Int("skills", "viewportTop"), bottom = layout.Int("skills", "viewportBottom"), h = layout.Int("skills", "pillHeight");
        var ends = new List<int>(); int? run = null;
        for (var y = top; y <= bottom; y++)
        {
            var dark = f.Luma(x, y) < luma;
            if (dark) run = y;
            else if (run is not null) { ends.Add(run.Value); run = null; }
        }
        return ends.Where(e => e - h >= top && e <= bottom).ToArray();
    }

    /// <summary>◯ vs ◎ after an OCR'd label: find the rightmost dark glyph column near the line end and compare the
    /// luma of its centre (a double circle has an inner ring, so the centre is darker).</summary>
    public static (CircleGlyph Glyph, double CenterLuma) Circle(Frame f, LayoutProfile layout, Rect box)
    {
        int left = layout.Int("circleGlyph", "searchLeft"), right = layout.Int("circleGlyph", "searchRight");
        int dark = layout.Int("circleGlyph", "darkLuma"), half = layout.Int("circleGlyph", "halfBand"), off = layout.Int("circleGlyph", "centerOffset");
        var cy = box.Y + Math.Min(box.Height, 24) / 2; var end = box.X + box.Width;
        int? rx = null;
        for (var x = end + right; x >= end - left && rx is null; x--)
            for (var y = cy - half; y <= cy + half; y++) if (f.Luma(x, y) < dark) { rx = x; break; }
        if (rx is null) return (CircleGlyph.Unknown, double.NaN);
        double sum = 0; var n = 0;
        for (var y = cy - 2; y <= cy + 2; y++) for (var x = rx.Value - off - 2; x <= rx.Value - off + 3; x++) { sum += f.Luma(x, y); n++; }
        var c = sum / n;
        var glyph = c <= layout.Num("circleGlyph", "doubleMaxCenterLuma") ? CircleGlyph.Double
            : c >= layout.Num("circleGlyph", "singleMinCenterLuma") ? CircleGlyph.Single : CircleGlyph.Unknown;
        return (glyph, Math.Round(c, 1));
    }
}
