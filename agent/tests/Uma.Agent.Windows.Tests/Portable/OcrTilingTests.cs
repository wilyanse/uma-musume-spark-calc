using System.Text.Json.Nodes;
using Uma.Agent.Core;
using Uma.Agent.Windows.Shell;
using Xunit;

namespace Uma.Agent.Windows.Portable.Tests;

/// <summary>T10 review S2: tiled full-frame recording must never record a seam-cut line in pieces. Uses the REAL line
/// geometry of the committed full-frame recordings. The stand-in engine does no OCR: for each requested rectangle it
/// returns the recorded lines touching it, boxes clipped to the rectangle, and marks clipped text with a "[cut]"
/// sentinel so a split line is detectable. No OCR text is invented.</summary>
public class OcrTilingTests
{
    private static IReadOnlyList<OcrLine> Recorded(string name)
        => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Fixtures, "ocr", name + ".json")))!["lines"]!.AsArray()
            .Select(l => { var b = l!["box"]!.AsArray().Select(v => v!.GetValue<int>()).ToArray(); return new OcrLine(l["text"]!.GetValue<string>(), l["confidence"]!.GetValue<double>(), new Rect(b[0], b[1], b[2], b[3])); })
            .ToArray();

    private sealed class Clipping(IReadOnlyList<OcrLine> lines, int cap)
    {
        public List<Rect> Calls { get; } = [];
        public Task<IReadOnlyList<OcrLine>> Read(Rect r)
        {
            Assert.True(r.Width <= cap && r.Height <= cap, $"{r} exceeds the ×2 cap {cap}");
            Calls.Add(r);
            var result = new List<OcrLine>();
            foreach (var l in lines)
            {
                int x0 = Math.Max(l.Box.X, r.X), y0 = Math.Max(l.Box.Y, r.Y), x1 = Math.Min(l.Box.X + l.Box.Width, r.X + r.Width), y1 = Math.Min(l.Box.Y + l.Box.Height, r.Y + r.Height);
                if (x1 <= x0 || y1 <= y0) continue;
                var clipped = new Rect(x0, y0, x1 - x0, y1 - y0);
                result.Add(clipped == l.Box ? l : new OcrLine(l.Text + " [cut]", l.Confidence, clipped));
            }
            return Task.FromResult<IReadOnlyList<OcrLine>>(result);
        }
    }

    private static readonly Rect Full = new(0, 0, 1920, 1080);

    [Fact]
    public void Fixture_13_really_has_lines_across_the_old_100px_overlap_and_the_longest_fixture_line_fits_the_new_one()
    {
        var all = Directory.GetFiles(Path.Combine(Repo.Fixtures, "ocr"), "*.json").SelectMany(f => Recorded(Path.GetFileNameWithoutExtension(f))).ToArray();
        Assert.Equal(493, all.Max(l => l.Box.Width));
        Assert.True(all.Max(l => l.Box.Width) + 2 * OcrTiling.SeamMargin < OcrTiling.Overlap);
        static bool Crosses(OcrLine l, int edge) => l.Box.X < edge && l.Box.X + l.Box.Width > edge;
        var crossing = Recorded("13-support-card-list").Where(l => Crosses(l, 1200) || Crosses(l, 1300)).ToArray();
        Assert.Equal(6, crossing.Length);   // the reviewer's count: lines cut by an edge of the old 1200..1300 overlap
        Assert.Contains(crossing, l => l.Text == "To Title Screen");
    }

    [Theory]
    [InlineData(2600u)]   // a typical Windows OCR MaxImageDimension
    [InlineData(1500u)]   // a smaller limit: three tiles across
    public async Task Every_recorded_line_of_every_fixture_is_read_whole_exactly_once(uint maxImageDimension)
    {
        var cap = OcrTiling.Cap(maxImageDimension);
        foreach (var file in Directory.GetFiles(Path.Combine(Repo.Fixtures, "ocr"), "*.json").Order())
        {
            var lines = Recorded(Path.GetFileNameWithoutExtension(file));
            var engine = new Clipping(lines, cap);
            var read = await OcrTiling.ReadAsync(Full, cap, engine.Read);
            Assert.DoesNotContain(read, l => l.Text.EndsWith("[cut]", StringComparison.Ordinal));
            Assert.Equal(lines.OrderBy(l => l.Box.Y).ThenBy(l => l.Box.X).Select(l => (l.Text, l.Box)), read.Select(l => (l.Text, l.Box)));
            Assert.All(engine.Calls, c => Assert.True(c.Width <= cap && c.Height <= cap));
        }
    }

    [Fact]
    public void Tiles_cover_the_roi_with_the_overlap_and_respect_the_cap()
    {
        var tiles = OcrTiling.Tiles(Full, 1300);
        Assert.Equal([new Rect(0, 0, 1300, 1080), new Rect(700, 0, 1220, 1080)], tiles);
        Assert.Single(OcrTiling.Tiles(new Rect(10, 10, 860, 40), 1300));
        Assert.Throws<CaptureUnavailableException>(() => OcrTiling.Cap(1000));
    }

    [Fact]
    public async Task A_line_longer_than_the_overlap_is_recovered_by_one_band_reread()
    {
        // SYNTHETIC geometry: a 900 px line across the seam (longer than any fixture line) plus a real-looking short one.
        var lines = new[] { new OcrLine("long synthetic geometry line", 1, new Rect(500, 400, 900, 30)), new OcrLine("short", 1, new Rect(100, 100, 50, 20)) };
        var engine = new Clipping(lines, 1300);
        var read = await OcrTiling.ReadAsync(Full, 1300, engine.Read);
        Assert.Equal(["short", "long synthetic geometry line"], read.Select(l => l.Text));
        Assert.Equal(new Rect(500, 400, 900, 30), read[1].Box);
        Assert.Equal(3, engine.Calls.Count);   // two tiles + one band
    }

    [Fact]
    public async Task Rois_within_the_cap_are_read_in_a_single_call()
    {
        var engine = new Clipping(Recorded("05-veteran-details-career-info-deck-legacy"), 1300);
        await OcrTiling.ReadAsync(new Rect(287, 598, 76, 34), 1300, engine.Read);
        Assert.Equal([new Rect(287, 598, 76, 34)], engine.Calls);
    }
}
