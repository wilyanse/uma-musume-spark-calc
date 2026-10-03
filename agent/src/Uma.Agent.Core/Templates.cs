using System.Text.Json;
using System.Text.Json.Nodes;

namespace Uma.Agent.Core;

/// <summary>One template: a block-averaged RGB feature vector cut from a genuine fixture crop.
/// `Source` records which screenshot/ROI produced it so tests can rebuild it byte-for-byte.</summary>
public sealed record GlyphTemplate(string Label, double[] Features, string SourceFixture, Rect SourceRoi);

public sealed record TemplateMatch(string? Label, double Distance, double Margin, bool Accepted, IReadOnlyList<Candidate> Candidates);

/// <summary>Nearest-template matcher for rank badges and aptitude grade letters (30 §4). Features are an
/// area-averaged GxG RGB grid of the ROI (0..1). A small alignment search absorbs capture jitter;
/// acceptance needs both an absolute distance and a best/runner-up margin, otherwise the label is withheld.</summary>
public sealed class TemplateSet
{
    public required string Kind { get; init; }
    public required int GridW { get; init; }
    public required int GridH { get; init; }
    public required int RoiW { get; init; }
    public required int RoiH { get; init; }
    public required double MaxDistance { get; init; }
    public required double MinMargin { get; init; }
    public required int Search { get; init; }
    public required IReadOnlyList<GlyphTemplate> Templates { get; init; }

    public static double[] Features(Frame frame, Rect roi, int gridW, int gridH)
    {
        var f = new double[gridW * gridH * 3];
        for (var gy = 0; gy < gridH; gy++)
        for (var gx = 0; gx < gridW; gx++)
        {
            int x0 = roi.X + gx * roi.Width / gridW, x1 = roi.X + (gx + 1) * roi.Width / gridW;
            int y0 = roi.Y + gy * roi.Height / gridH, y1 = roi.Y + (gy + 1) * roi.Height / gridH;
            long r = 0, g = 0, b = 0, n = 0;
            for (var y = y0; y < y1; y++)
            for (var x = x0; x < x1; x++) { var p = frame.Rgb(x, y); r += p.R; g += p.G; b += p.B; n++; }
            var i = (gy * gridW + gx) * 3;
            f[i] = Math.Round(r / (255.0 * n), 3); f[i + 1] = Math.Round(g / (255.0 * n), 3); f[i + 2] = Math.Round(b / (255.0 * n), 3);
        }
        return f;
    }

    private static double Distance(double[] a, double[] b)
    {
        double s = 0; for (var i = 0; i < a.Length; i++) s += (a[i] - b[i]) * (a[i] - b[i]);
        return Math.Sqrt(s / a.Length);
    }

    /// <summary>Best distance per label over an alignment search of ±Search px; never forced.</summary>
    public TemplateMatch Match(Frame frame, Rect roi)
    {
        if (roi.Width != RoiW || roi.Height != RoiH) throw new ArgumentException($"{Kind} ROI must be {RoiW}x{RoiH}");
        var best = new Dictionary<string, double>(StringComparer.Ordinal);
        for (var dy = -Search; dy <= Search; dy++)
        for (var dx = -Search; dx <= Search; dx++)
        {
            var r = roi with { X = roi.X + dx, Y = roi.Y + dy };
            if (r.X < 0 || r.Y < 0 || r.X + r.Width > frame.Width || r.Y + r.Height > frame.Height) continue;
            var f = Features(frame, r, GridW, GridH);
            foreach (var t in Templates)
            {
                var d = Distance(f, t.Features);
                if (!best.TryGetValue(t.Label, out var old) || d < old) best[t.Label] = d;
            }
        }
        var ranked = best.OrderBy(kv => kv.Value).ThenBy(kv => kv.Key, StringComparer.Ordinal).ToArray();
        if (ranked.Length == 0) return new TemplateMatch(null, double.PositiveInfinity, 0, false, []);
        var margin = ranked.Length > 1 ? ranked[1].Value - ranked[0].Value : double.PositiveInfinity;
        var accepted = ranked[0].Value <= MaxDistance && margin >= MinMargin;
        var candidates = ranked.Take(3).Select(kv => new Candidate(kv.Key, Math.Round(Math.Max(0, 1 - kv.Value), 4))).ToArray();
        return new TemplateMatch(accepted ? ranked[0].Key : null, ranked[0].Value, margin, accepted, candidates);
    }

    public static IReadOnlyDictionary<string, TemplateSet> Load(string path)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var result = new Dictionary<string, TemplateSet>(StringComparer.Ordinal);
        foreach (var set in doc.RootElement.GetProperty("sets").EnumerateObject())
        {
            var s = set.Value;
            result[set.Name] = new TemplateSet
            {
                Kind = set.Name,
                GridW = s.GetProperty("grid")[0].GetInt32(), GridH = s.GetProperty("grid")[1].GetInt32(),
                RoiW = s.GetProperty("roiSize")[0].GetInt32(), RoiH = s.GetProperty("roiSize")[1].GetInt32(),
                MaxDistance = s.GetProperty("maxDistance").GetDouble(), MinMargin = s.GetProperty("minMargin").GetDouble(),
                Search = s.GetProperty("search").GetInt32(),
                Templates = s.GetProperty("templates").EnumerateArray().Select(t => new GlyphTemplate(
                    t.GetProperty("label").GetString()!,
                    t.GetProperty("features").EnumerateArray().Select(x => x.GetDouble()).ToArray(),
                    t.GetProperty("source").GetProperty("fixture").GetString()!,
                    LayoutProfile.R(t.GetProperty("source").GetProperty("roi")))).ToArray(),
            };
        }
        return result;
    }

    /// <summary>Rebuilds a template file from its own `source` entries (calibration tool + provenance test).</summary>
    public static JsonObject Rebuild(string path, Func<string, Frame> loadFixture)
    {
        var root = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
        foreach (var (_, setNode) in root["sets"]!.AsObject())
        {
            var grid = setNode!["grid"]!.AsArray();
            foreach (var t in setNode["templates"]!.AsArray())
            {
                var src = t!["source"]!;
                var roi = src["roi"]!.AsArray().Select(x => x!.GetValue<int>()).ToArray();
                var f = Features(loadFixture(src["fixture"]!.GetValue<string>()), new Rect(roi[0], roi[1], roi[2], roi[3]), grid[0]!.GetValue<int>(), grid[1]!.GetValue<int>());
                t["features"] = new JsonArray(f.Select(x => (JsonNode)JsonValue.Create(x)!).ToArray());
            }
        }
        return root;
    }
}
