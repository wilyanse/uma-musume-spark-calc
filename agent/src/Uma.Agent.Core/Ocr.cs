using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Uma.Agent.Core;

/// <summary>Replays recorded OCR (30 Appendix A). Full-frame recordings answer any ROI with the lines whose
/// box centre falls inside it; ROI recordings (`fixtures/ocr-roi`, recorded on the upscaled ROI crop the way the
/// Windows adapter reads it) answer exactly their ROI. Digits mode post-filters to [0-9,] like the Windows adapter.</summary>
public sealed class FixtureOcrEngine : IOcrEngine
{
    private sealed record JsonLine(string Text, double Confidence, int[] Box);
    private sealed record Fixture(string Engine, int[]? Reference, List<JsonLine> Lines);
    private sealed record RoiRecord(int[] Roi, List<JsonLine> Lines);
    private sealed record RoiFixture(string Engine, List<RoiRecord> RoiLines);
    private static readonly JsonSerializerOptions Options = new() { PropertyNameCaseInsensitive = true };
    private readonly List<JsonLine> _lines;
    private readonly Dictionary<Rect, List<JsonLine>> _roi = [];
    public string Engine { get; }

    public FixtureOcrEngine(string path, string? roiPath = null)
    {
        var fixture = JsonSerializer.Deserialize<Fixture>(File.ReadAllText(path), Options) ?? throw new InvalidDataException(path);
        _lines = fixture.Lines; Engine = fixture.Engine;
        if (roiPath is not null && File.Exists(roiPath))
            foreach (var r in (JsonSerializer.Deserialize<RoiFixture>(File.ReadAllText(roiPath), Options) ?? throw new InvalidDataException(roiPath)).RoiLines)
                _roi[new Rect(r.Roi[0], r.Roi[1], r.Roi[2], r.Roi[3])] = r.Lines;
    }

    public Task<IReadOnlyList<OcrLine>> ReadAsync(Frame frame, Rect roi, OcrMode mode)
    {
        var source = _roi.TryGetValue(roi, out var exact) ? exact
            : _lines.Where(l => l.Box.Length == 4 && Inside(l.Box, roi)).ToList();
        var result = source.Select(l => new OcrLine(mode == OcrMode.Digits ? Ocr.DigitsOnly(l.Text) : l.Text, l.Confidence, new Rect(l.Box[0], l.Box[1], l.Box[2], l.Box[3])))
            .Where(l => l.Text.Length > 0).ToArray();
        return Task.FromResult<IReadOnlyList<OcrLine>>(result);
    }

    private static bool Inside(int[] b, Rect roi)
    {
        var cx = b[0] + b[2] / 2; var cy = b[1] + b[3] / 2;
        return cx >= roi.X && cy >= roi.Y && cx < roi.X + roi.Width && cy < roi.Y + roi.Height;
    }
}

public static partial class Ocr
{
    public static string DigitsOnly(string text) => new(text.Where(c => c is (>= '0' and <= '9') or ',').ToArray());

    public static async Task<(string Text, double Confidence)> TextAsync(IOcrEngine ocr, Frame frame, Rect roi, OcrMode mode = OcrMode.Text)
    {
        var lines = await ocr.ReadAsync(frame, roi, mode);
        if (lines.Count == 0) return ("", 0);
        var ordered = lines.OrderBy(l => l.Box.Y).ThenBy(l => l.Box.X).ToArray();
        return (string.Join(' ', ordered.Select(l => l.Text.Trim())), ordered.Min(l => l.Confidence));
    }

    /// <summary>Integer from digit OCR ("13,471" → 13471). Null when no digits or the commas are malformed.</summary>
    public static int? ParseInt(string text)
    {
        var digits = DigitsOnly(text).Trim(',');
        if (digits.Length == 0 || !CommaGroups().IsMatch(digits)) return null;
        return int.TryParse(digits.Replace(",", ""), NumberStyles.None, CultureInfo.InvariantCulture, out var v) ? v : null;
    }

    /// <summary>"Lvl 50", "Lv| 50", "v| 50", "Lvl 40 / 40" → the first level number after the Lv token (or the trailing number).</summary>
    public static int? ParseLevel(string text)
    {
        var m = LevelToken().Match(text);
        if (m.Success) return int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
        var tail = TrailingNumber().Match(text);
        return tail.Success ? int.Parse(tail.Groups[1].Value, CultureInfo.InvariantCulture) : null;
    }

    [GeneratedRegex(@"^\d{1,3}(,\d{3})*$|^\d+$")] private static partial Regex CommaGroups();
    [GeneratedRegex(@"(?:L?v[l|I1]?)\s*[|lI]?\s*(\d{1,2})\b")] private static partial Regex LevelToken();
    [GeneratedRegex(@"(\d{1,2})\s*$")] private static partial Regex TrailingNumber();
}
