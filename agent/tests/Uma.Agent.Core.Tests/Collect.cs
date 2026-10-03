namespace Uma.Agent.Core.Tests;

/// <summary>Shared frame sets for session/upload tests. Every frame is a real fixture parse unless its name says
/// SYNTHETIC; synthetic edits are explicit, minimal and never presented as screenshot evidence.</summary>
internal static class Collect
{
    private static FixtureEnv Env => FixtureEnv.Instance;
    public const string CaptureId = "01K7B33MXGVZV6TZRJZDHB99YE";
    public static readonly DateTimeOffset At = new(2026, 10, 3, 0, 0, 0, TimeSpan.Zero);
    public static readonly string[] McQueen = ["01-veteran-details-skills-independent", "02-veteran-details-inspiration-p1", "03-veteran-details-inspiration-p2",
        "04-veteran-details-inspiration-p3", "05-veteran-details-career-info-deck-legacy", "06-veteran-details-career-info-record", "07-veteran-details-career-info-races"];
    public const string SpecialWeekPopup = "09-sparks-popup-special-week-parent", OperaPopup = "10-sparks-popup-guest-parent";

    /// <summary>SYNTHETIC. Fixture 01 shows only the top of McQueen's Skills list (its real thumb is not at the end), and
    /// no fixture shows the end. This copy replaces the detected thumb with one spanning the whole track, i.e. it
    /// pretends the 14 visible skills are the whole list, so a "complete" collection can be exercised. It is not a fact
    /// about the screenshot or the game.</summary>
    public static ParsedFrame SyntheticWholeSkillsList()
        => Env.Parsed(McQueen[0]) with { Thumb = new ScrollThumb(Env.Layout.Int("scrollbar", "trackTop"), Env.Layout.Int("scrollbar", "trackBottom")) };

    /// <summary>Real 02–07 + popups 09/10 and the synthetic whole-list Skills frame.</summary>
    public static List<ParsedFrame> Complete()
        => [SyntheticWholeSkillsList(), .. McQueen.Skip(1).Select(n => Env.Parsed(n)), Env.Parsed(SpecialWeekPopup), Env.Parsed(OperaPopup)];

    /// <summary>The complete collection with two SYNTHETIC uncertain readings (gut in every header frame, the 4th spark
    /// label of 02), so the capture carries exactly two crops: /stats/gut and /sparks/3/sparkId.</summary>
    public static CaptureResult LowConfidence()
    {
        var frames = Complete().Select(p =>
        {
            if (p.Header is { } h) p = p with { Header = h with { Stats = h.Stats.ToDictionary(kv => kv.Key, kv => kv.Key == "gut" ? kv.Value with { Ok = false } : kv.Value) } };
            if (ReferenceEquals(p.Frame, Env.Frame(McQueen[1]))) p = p with { Sparks = p.Sparks.Select((s, i) => i == 3 ? s with { Spark = s.Spark with { Ok = false } } : s).ToArray() };
            return p;
        });
        var r = Assemble(frames).Result;
        if (!r.Uploadable) throw new InvalidOperationException("fixture collection is not uploadable: " + string.Join("; ", r.Blockers.Concat(r.Errors)));
        return r;
    }

    public static List<ParsedFrame> Real(params string[] names) => names.Select(n => Env.Parsed(n)).ToList();

    public static (CaptureCoordinator Coordinator, CaptureResult Result) Assemble(IEnumerable<ParsedFrame> frames)
    {
        var c = new CaptureCoordinator(Env.Layout, Env.Master);
        foreach (var f in frames) c.Feed(f);
        var session = c.Sessions.Single(s => s.IdentityKey.Contains("outfit:frontline-elegance"));
        return (c, session.Assemble(CaptureId, At, "test"));
    }

    public static string TempDb() => Path.Combine(Path.GetTempPath(), "uma-t09-" + Guid.NewGuid().ToString("N") + ".db");
    public static void Drop(string db) { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); File.Delete(db); }
}
