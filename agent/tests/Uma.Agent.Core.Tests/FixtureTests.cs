using System.Text.Json;
using Xunit;
using Xunit.Abstractions;

namespace Uma.Agent.Core.Tests;

/// <summary>30 §10 T09: one test per fixture asserting the full parsed output against its label file, plus the
/// programmatic accuracy report (≥ 99% overall; stats, spark stars and LB 100%).</summary>
public class FixtureTests(ITestOutputHelper output)
{
    private static FixtureEnv Env => FixtureEnv.Instance;
    public static TheoryData<string> AllFixtures() { var d = new TheoryData<string>(); foreach (var n in FixtureEnv.Instance.Names) d.Add(n); return d; }

    [Fact]
    public void Fifteen_screenshots_fifteen_labels_fifteen_ocr_recordings()
    {
        Assert.Equal(15, Env.Names.Count);
        foreach (var n in Env.Names)
        {
            Assert.True(File.Exists(Path.Combine(FixtureEnv.Fixtures, "labels", n + ".json")), n);
            Assert.True(File.Exists(Path.Combine(FixtureEnv.Fixtures, "ocr", n + ".json")), n);
            Assert.Equal(n, Env.Label(n)["fixture"]!.GetValue<string>());
        }
    }

    [Theory]
    [MemberData(nameof(AllFixtures))]
    public void Fixture_parses_to_its_label(string name)
    {
        var results = FixtureComparer.Compare(name, Env.Parsed(name), Env);
        foreach (var r in results.Where(r => !r.Correct)) output.WriteLine($"WRONG {r.Field}: expected {r.Expected}, got {r.Actual} (confident={r.Confident})");
        Assert.NotEmpty(results);
        // Stats, stars and LB are exact; no wrong value may be reported as confident (it would skip review).
        Assert.DoesNotContain(results, r => !r.Correct && r.Category is "stats" or "stars" or "lb");
        Assert.DoesNotContain(results, r => !r.Correct && r.Confident);
    }

    [Fact]
    public void Comparer_detects_wrong_scroll_flags_unlabelled_rows_headers_and_deck_characters()
    {
        // S4/S6: the new comparisons must fail on a wrong parse, not just pass on the right one.
        static IEnumerable<string> Wrong(string name, ParsedFrame p) => FixtureComparer.Compare(name, p, Env).Where(r => !r.Correct).Select(r => r.Field);
        var p01 = Env.Parsed("01-veteran-details-skills-independent");
        Assert.Contains("scroll/atEnd", Wrong("01-veteran-details-skills-independent", p01 with { Thumb = new ScrollThumb(p01.Thumb!.Top, Env.Layout.Int("scrollbar", "trackBottom")) }));
        var p07 = Env.Parsed("07-veteran-details-career-info-races");
        var fake = new Reading(1, "1", 1, true, [], null);
        Assert.Contains("career/races/absent", Wrong("07-veteran-details-career-info-races", p07 with { Career = new CareerRows(fake, null, null, null, null) }));
        var p08 = Env.Parsed("08-sparks-popup-oguri-cap");
        Assert.Contains("header/absent", Wrong("08-sparks-popup-oguri-cap", p08 with { Header = p01.Header }));
        var p05 = Env.Parsed("05-veteran-details-career-info-deck-legacy");
        var swapped = p05.Deck.Select((t, i) => i == 0 ? t with { Card = p05.Deck[3].Card } : t).ToArray();   // Agnes Tachyon card on Fukukitaru's tile (both speed SSR)
        Assert.Contains("deck/0/visibleCharacter", Wrong("05-veteran-details-career-info-deck-legacy", p05 with { Deck = swapped }));
    }

    [Fact]
    public void Accuracy_report_meets_acceptance()
    {
        var all = Env.Names.SelectMany(n => FixtureComparer.Compare(n, Env.Parsed(n), Env)).ToList();
        var report = Report(all, "roi-ocr (per-ROI recording, full-frame fallback)");
        output.WriteLine(report);
        File.WriteAllText(Path.Combine(AppContext.BaseDirectory, "accuracy-report.txt"), report);
        var correct = all.Count(r => r.Correct);
        Assert.True(correct >= 0.99 * all.Count, $"overall {correct}/{all.Count}");
        foreach (var cat in new[] { "stats", "stars", "lb" })
            Assert.All(all.Where(r => r.Category == cat), r => Assert.True(r.Correct, $"{r.Fixture} {r.Field}: {r.Expected} vs {r.Actual}"));
        Assert.Equal(15, all.Select(r => r.Fixture).Distinct().Count());
    }

    [Fact]
    public void Full_frame_replay_accuracy_is_reported_and_never_silently_wrong()
    {
        // Informational second run on the original full-frame recordings only (no per-ROI OCR).
        var all = Env.Names.SelectMany(n => FixtureComparer.Compare(n, Env.Parsed(n, roiMode: false), Env)).ToList();
        output.WriteLine(Report(all, "full-frame recording only"));
        Assert.DoesNotContain(all, r => !r.Correct && r.Confident);
        Assert.All(all.Where(r => r.Category is "stats" or "stars" or "lb"), r => Assert.True(r.Correct, $"{r.Fixture} {r.Field}"));
    }

    public static string Report(IReadOnlyList<FieldResult> all, string mode)
    {
        var lines = new List<string> { $"T09 fixture accuracy ({mode})", $"overall: {all.Count(r => r.Correct)}/{all.Count} = {100.0 * all.Count(r => r.Correct) / all.Count:0.00}%" };
        lines.Add($"wrong but confident (silent errors): {all.Count(r => !r.Correct && r.Confident)}; correct but flagged low_confidence: {all.Count(r => r.Correct && !r.Confident)}");
        foreach (var g in all.GroupBy(r => r.Category).OrderBy(g => g.Key))
            lines.Add($"  {g.Key,-14} {g.Count(r => r.Correct),4}/{g.Count(),-4}");
        foreach (var g in all.GroupBy(r => r.Fixture).OrderBy(g => g.Key))
            lines.Add($"  {g.Key,-46} {g.Count(r => r.Correct),4}/{g.Count(),-4} low-confidence {g.Count(r => !r.Confident)}");
        foreach (var r in all.Where(r => !r.Correct)) lines.Add($"  WRONG {r.Fixture} {r.Field}: expected {r.Expected}, got {r.Actual}, confident={r.Confident}");
        return string.Join(Environment.NewLine, lines);
    }

    [Fact]
    public void Templates_are_rebuilt_byte_for_byte_from_their_genuine_fixture_crops()
    {
        var rebuilt = TemplateSet.Rebuild(FixtureEnv.TemplatesPath, Env.Frame);
        var options = new JsonSerializerOptions { WriteIndented = true };
        var text = rebuilt.ToJsonString(options) + "\n";
        if (Environment.GetEnvironmentVariable("UMA_WRITE_TEMPLATES") == "1") File.WriteAllText(FixtureEnv.TemplatesPath, text);
        Assert.Equal(text, File.ReadAllText(FixtureEnv.TemplatesPath));
    }
}
