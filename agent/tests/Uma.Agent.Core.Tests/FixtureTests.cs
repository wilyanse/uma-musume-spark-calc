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
