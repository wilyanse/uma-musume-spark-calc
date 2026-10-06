using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Uma.Agent.Core;

namespace Uma.Agent.Windows.Shell;

/// <summary>Per-ROI recordings (Q-91): the deck `Lvl N` boxes of Career Info (fixture 05) and the card-list `Lvl N` boxes
/// (fixture 13), computed from the layout with the same formulas as Core's DeckAsync/ListTilesAsync and
/// `agent/tests/tools/record_roi_ocr.py`.</summary>
public static class RoiPlan
{
    public const string DeckFixture = "05-veteran-details-career-info-deck-legacy", ListFixture = "13-support-card-list";
    public static IReadOnlyList<string> Fixtures { get; } = [DeckFixture, ListFixture];

    public static IReadOnlyList<Rect> For(string fixture, LayoutProfile layout) => fixture switch
    {
        DeckFixture => Deck(layout),
        ListFixture => List(layout),
        _ => [],
    };

    /// <summary>For a live frame recorded from the tray: the same ROIs, chosen by the classified screen.</summary>
    public static IReadOnlyList<Rect> ForScreen(ScreenId screen, LayoutProfile layout) => screen switch
    {
        ScreenId.DetailsCareer => Deck(layout),
        ScreenId.CardsList => List(layout),
        _ => [],
    };

    private static int Round(double v) => (int)Math.Round(v, MidpointRounding.AwayFromZero);

    private static IReadOnlyList<Rect> Deck(LayoutProfile layout)
    {
        var d = layout.At("career", "deck"); var r = LayoutProfile.R(d.GetProperty("levelRoi"));
        return Enumerable.Range(0, d.GetProperty("tiles").GetInt32())
            .Select(t => new Rect(Round(d.GetProperty("tileX").GetInt32() + t * d.GetProperty("tilePitch").GetDouble()) + r.X, r.Y, r.Width, r.Height)).ToArray();
    }

    private static IReadOnlyList<Rect> List(LayoutProfile layout)
    {
        var g = layout.At("cardsList"); var r = LayoutProfile.R(g.GetProperty("levelRoi"));
        var result = new List<Rect>();
        foreach (var y in g.GetProperty("diamondRows").EnumerateArray().Select(e => e.GetInt32()))
        {
            if (y > g.GetProperty("visibleBottom").GetInt32()) break;
            for (var c = 0; c < g.GetProperty("columns").GetInt32(); c++)
                result.Add(new Rect(Round(g.GetProperty("tileX").GetInt32() + c * g.GetProperty("tilePitch").GetDouble()) + r.X, y + r.Y, r.Width, r.Height));
        }
        return result;
    }
}

/// <summary>`--record-ocr` (30 §1, Appendix A; Q-91): writes the OCR the given engine actually returns, in the formats
/// Core's FixtureOcrEngine reads: `ocr/&lt;name&gt;.json` `{engine, reference, lines:[{text, confidence, box}]}` sorted
/// top-to-bottom, and for 05/13 `ocr-roi/&lt;name&gt;.json` `{engine, fixture, roiLines:[{roi, lines}]}`. Nothing is
/// generated or edited: every line comes from <see cref="IOcrEngine.ReadAsync"/>. Existing files are never replaced
/// unless <c>overwrite</c> is set, and that is checked before anything is written.</summary>
public sealed class OcrRecorder(IOcrEngine engine, string engineName, LayoutProfile layout)
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public static string WindowsEngineName(string languageTag) => $"windows-media-ocr-{languageTag}";
    public static string RoiEngineName(string engineName) => engineName + "-roi-x2";

    public async Task<IReadOnlyList<string>> RecordAsync(string pngPath, string outputDirectory, bool overwrite)
    {
        var frame = Frames.Load(pngPath);
        var name = Path.GetFileNameWithoutExtension(pngPath);
        return await RecordFrameAsync(frame, name, outputDirectory, overwrite, RoiPlan.For(name, layout));
    }

    public async Task<IReadOnlyList<string>> RecordFrameAsync(Frame frame, string name, string outputDirectory, bool overwrite, IReadOnlyList<Rect> rois)
    {
        if (frame.Width != LayoutProfiles.ReferenceWidth || frame.Height != LayoutProfiles.ReferenceHeight)
            throw new NonReferenceFrameException(frame.Width, frame.Height);
        if (name.Length == 0 || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) throw new ShellValidationException("The fixture name must be a valid file name.");
        var fullPath = Path.Combine(outputDirectory, "ocr", name + ".json");
        var roiPath = rois.Count > 0 ? Path.Combine(outputDirectory, "ocr-roi", name + ".json") : null;
        var targets = roiPath is null ? new[] { fullPath } : new[] { fullPath, roiPath };
        if (!overwrite)
            foreach (var t in targets)
                if (File.Exists(t)) throw new IOException($"{t} already exists; pass --overwrite to replace it (existing recordings are never replaced by default)");

        // Read everything first, then write, so a failed read leaves no partial output.
        var full = await engine.ReadAsync(frame, new Rect(0, 0, frame.Width, frame.Height), OcrMode.Text);
        var fullDoc = new JsonObject
        {
            ["engine"] = engineName,
            ["reference"] = new JsonArray(LayoutProfiles.ReferenceWidth, LayoutProfiles.ReferenceHeight),
            ["lines"] = Lines(full),
        };
        JsonObject? roiDoc = null;
        if (roiPath is not null)
        {
            var entries = new JsonArray();
            foreach (var roi in rois)
            {
                var lines = await engine.ReadAsync(frame, roi, OcrMode.Text);
                entries.Add(new JsonObject { ["lines"] = Lines(lines), ["roi"] = new JsonArray(roi.X, roi.Y, roi.Width, roi.Height) });
            }
            roiDoc = new JsonObject { ["engine"] = RoiEngineName(engineName), ["fixture"] = name, ["roiLines"] = entries };
        }

        Write(fullPath, fullDoc, overwrite);
        if (roiPath is not null) Write(roiPath, roiDoc!, overwrite);
        return targets;
    }

    private static JsonArray Lines(IReadOnlyList<OcrLine> lines)
        => new(lines.OrderBy(l => l.Box.Y).ThenBy(l => l.Box.X)
            .Select(l => (JsonNode)new JsonObject
            {
                ["box"] = new JsonArray(l.Box.X, l.Box.Y, l.Box.Width, l.Box.Height),
                ["confidence"] = l.Confidence,
                ["text"] = l.Text,
            }).ToArray());

    private static void Write(string path, JsonObject doc, bool overwrite)
        => AtomicFile.WriteAllBytes(path, Encoding.UTF8.GetBytes(doc.ToJsonString(Json) + "\n"), overwrite);
}

public enum AgentMode { Tray, RecordOcr, Help }

/// <summary>Command line: no arguments = tray app; `--record-ocr &lt;png|dir&gt;... [--out &lt;dir&gt;] [--overwrite]`;
/// `--help`. The default output is a new timestamped folder under %LOCALAPPDATA%/UmaSparkCalc/ocr-recordings, never the
/// committed fixtures.</summary>
public sealed record CommandLineOptions(AgentMode Mode, IReadOnlyList<string> Inputs, string? OutputDirectory, bool Overwrite)
{
    public const string Usage = """
        Uma.Agent.Windows                         start the tray app
        Uma.Agent.Windows --record-ocr <png|dir>... [--out <dir>] [--overwrite]
            Runs Windows.Media.Ocr (English) on 1920x1080 PNGs and writes ocr/<name>.json (full frame) and, for
            fixtures 05 and 13, ocr-roi/<name>.json (per-ROI x2), in the agent/tests/fixtures format.
            Default --out: %LOCALAPPDATA%\UmaSparkCalc\ocr-recordings\<UTC timestamp>. Existing files are kept unless --overwrite.
        Uma.Agent.Windows --help
        """;

    public static CommandLineOptions Parse(IReadOnlyList<string> args, DateTimeOffset? now = null)
    {
        if (args.Count == 0) return new(AgentMode.Tray, [], null, false);
        if (args.Count == 1 && args[0] is "--help" or "-h" or "/?") return new(AgentMode.Help, [], null, false);
        var inputs = new List<string>(); string? output = null; var overwrite = false; var record = false;
        for (var i = 0; i < args.Count; i++)
        {
            switch (args[i])
            {
                case "--record-ocr": record = true; break;
                case "--overwrite": overwrite = true; break;
                case "--out":
                    if (i + 1 >= args.Count || args[i + 1].StartsWith("--", StringComparison.Ordinal)) throw new ShellValidationException("--out needs a directory");
                    output = args[++i]; break;
                default:
                    if (args[i].StartsWith('-')) throw new ShellValidationException("Unknown command option. Use --help for supported options.");
                    inputs.Add(args[i]); break;
            }
        }
        if (!record) throw new ShellValidationException("options given without --record-ocr");
        if (inputs.Count == 0) throw new ShellValidationException("--record-ocr needs at least one PNG file or directory");
        output ??= Path.Combine(AgentPaths.ForCurrentUser().Recordings, (now ?? DateTimeOffset.UtcNow).UtcDateTime.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture));
        return new(AgentMode.RecordOcr, inputs, output, overwrite);
    }

    /// <summary>PNG files named by the inputs (a directory contributes its *.png files, sorted).</summary>
    public IReadOnlyList<string> ExpandInputs()
        => Inputs.SelectMany(i => Directory.Exists(i) ? Directory.GetFiles(i, "*.png").Order(StringComparer.Ordinal) : (IEnumerable<string>)[i]).ToArray();
}
