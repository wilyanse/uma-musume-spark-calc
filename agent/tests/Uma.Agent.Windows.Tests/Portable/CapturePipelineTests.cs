using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Processing;
using Uma.Agent.Core;
using Uma.Agent.Windows.Shell;
using Xunit;

namespace Uma.Agent.Windows.Portable.Tests;

/// <summary>Answers OCR for whichever fixture frame is being read (frames are identified by reference; ParseAsync
/// returns a 1920x1080 input unchanged). Counts calls so skipped frames can be proven unread.</summary>
internal sealed class FrameDispatchOcr : IOcrEngine
{
    private readonly Dictionary<Frame, IOcrEngine> _byFrame = new(ReferenceEqualityComparer.Instance);
    public int Calls { get; private set; }
    public void Add(Frame frame, IOcrEngine engine) => _byFrame[frame] = engine;
    public Task<IReadOnlyList<OcrLine>> ReadAsync(Frame frame, Rect roi, OcrMode mode)
    {
        Calls++;
        return _byFrame.TryGetValue(frame, out var e) ? e.ReadAsync(frame, roi, mode) : Task.FromResult<IReadOnlyList<OcrLine>>([]);
    }
}

internal sealed class ListLog : IShellLog
{
    public List<string> Lines { get; } = [];
    public void Info(string message) => Lines.Add("I " + message);
    public void Warn(string message) => Lines.Add("W " + message);
    public void Error(string message) => Lines.Add("E " + message);
}

public class CapturePipelineTests
{
    private static Repo R => Repo.Instance;

    private sealed class Rig : IDisposable
    {
        public string Dir { get; } = Temp.Dir();
        public TestClock Clock { get; } = new();
        public FrameDispatchOcr Ocr { get; } = new();
        public UploadOutbox Outbox { get; }
        public CapturePipeline Pipeline { get; }
        public ListLog Log { get; } = new();
        public Rig()
        {
            Outbox = new UploadOutbox(Path.Combine(Dir, "outbox.db"), Clock);
            Pipeline = new CapturePipeline(R.Data, Ocr, Outbox, Clock, new UlidGenerator(Clock, Seeded.Bytes(42)), "t10-test", new FrameGate(Clock, TimeSpan.FromSeconds(2)), Log);
        }
        public Frame Fixture(string name) { var f = R.Frame(name); Ocr.Add(f, R.Ocr(name)); return f; }
        public void Dispose() => Temp.Drop(Dir);
    }

    [Fact]
    public async Task Real_fixtures_01_to_07_with_popups_show_progress_but_are_never_queued()
    {
        using var rig = new Rig();
        PipelineEvent? last = null;
        foreach (var n in Repo.McQueen.Append(Repo.SpecialWeekPopup).Append(Repo.OperaPopup))
        { rig.Clock.UtcNow += TimeSpan.FromSeconds(2); last = await rig.Pipeline.ProcessAsync(rig.Fixture(n), CancellationToken.None); }
        Assert.Equal(PipelineEventKind.Progress, last!.Kind);
        var p = rig.Pipeline.Progress!;
        Assert.Equal(2, p.TabsComplete);   // Inspiration and Career Info; Skills was not scrolled to its end (Q-93)
        Assert.Contains(p.Checklist, s => s.Section == "details.skills" && !s.Complete);

        var flushed = rig.Pipeline.Flush();
        var e = Assert.Single(flushed);
        Assert.Equal(PipelineEventKind.NotUploadable, e.Kind);
        Assert.Contains("details.skills", e.Message);
        Assert.Empty(rig.Outbox.Snapshot());   // diagnostic results never reach the outbox
    }

    [Fact]
    public async Task Unknown_screens_are_ignored_and_store_nothing()
    {
        using var rig = new Rig();
        var blank = new Frame(Enumerable.Repeat((byte)40, 1920 * 1080 * 4).ToArray(), 1920, 1080);
        var e = await rig.Pipeline.ProcessAsync(blank, CancellationToken.None);
        Assert.Equal(PipelineEventKind.Ignored, e.Kind);
        Assert.Null(rig.Pipeline.Progress);
        Assert.Empty(rig.Pipeline.Flush());
        Assert.Empty(rig.Outbox.Snapshot());
    }

    [Fact]
    public async Task Support_card_screens_give_the_truthful_unavailable_message_and_store_nothing()
    {
        using var rig = new Rig();
        foreach (var n in new[] { "13-support-card-list", "14-support-card-detail" })
        {
            var e = await rig.Pipeline.ProcessAsync(rig.Fixture(n), CancellationToken.None);
            Assert.Equal(PipelineEventKind.CardScreen, e.Kind);
            Assert.Equal(new SupportCardsUnavailable().Message, e.Message);
        }
        Assert.Empty(rig.Outbox.Snapshot());
        Assert.False(new SupportCardsUnavailable().Available);
        Assert.Contains("T11", new SupportCardsUnavailable().Message);
        Assert.Contains("nothing", new SupportCardsUnavailable().Message, StringComparison.OrdinalIgnoreCase);
    }

    private static Frame Resized(Frame f, int w, int h)
    {
        using var img = Frames.ToImage(f);
        img.Mutate(c => c.Resize(w, h));
        return Frames.FromImage(img);
    }

    [Fact]
    public async Task Sub_reference_and_non_16x9_frames_produce_an_actionable_error_before_any_reading()
    {
        using var rig = new Rig();
        var small = Resized(R.Frame(Repo.McQueen[0]), 1280, 720);
        var e = await rig.Pipeline.ProcessAsync(small, CancellationToken.None);
        Assert.Equal(PipelineEventKind.Unsupported, e.Kind);
        Assert.Contains("at least 1920x1080", e.Message);
        var wide = new Frame(new byte[1920 * 1200 * 4], 1920, 1200);
        e = await rig.Pipeline.ProcessAsync(wide, CancellationToken.None);
        Assert.Equal(PipelineEventKind.Unsupported, e.Kind);
        Assert.Contains("aspect ratio", e.Message);
        Assert.Equal(0, rig.Ocr.Calls);
    }

    [Fact]
    public async Task Larger_16x9_frames_are_normalised_by_ParseAsync()
    {
        using var rig = new Rig();
        var big = Resized(R.Frame(Repo.McQueen[1]), 2560, 1440);
        var replay = R.Ocr(Repo.McQueen[1]);
        // The resized frame is a new object; ParseAsync normalises it to another new 1920x1080 frame, so answer any frame.
        var any = new AnyFrameOcr(replay);
        var pipeline = new CapturePipeline(R.Data, any, rig.Outbox, rig.Clock, new UlidGenerator(rig.Clock, Seeded.Bytes(1)), "t", new FrameGate(rig.Clock, TimeSpan.FromSeconds(2)), rig.Log);
        var e = await pipeline.ProcessAsync(big, CancellationToken.None);
        Assert.Equal(PipelineEventKind.Progress, e.Kind);
        Assert.Contains(pipeline.Progress!.Checklist, s => s.Section == "details.inspiration");
    }

    private sealed class AnyFrameOcr(IOcrEngine inner) : IOcrEngine
    {
        public Task<IReadOnlyList<OcrLine>> ReadAsync(Frame frame, Rect roi, OcrMode mode) => inner.ReadAsync(frame, roi, mode);
    }

    [Fact]
    public async Task Unchanged_frames_are_skipped_without_any_ocr()
    {
        using var rig = new Rig();
        var f = rig.Fixture(Repo.McQueen[1]);
        await rig.Pipeline.ProcessAsync(f, CancellationToken.None);
        var calls = rig.Ocr.Calls;
        Assert.True(calls > 0);
        var e = await rig.Pipeline.ProcessAsync(f, CancellationToken.None);
        Assert.Equal(PipelineEventKind.Skipped, e.Kind);
        Assert.Equal(calls, rig.Ocr.Calls);
    }

    [Fact]
    public async Task Cancellation_before_parsing_reads_nothing()
    {
        using var rig = new Rig();
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => rig.Pipeline.ProcessAsync(rig.Fixture(Repo.McQueen[1]), cts.Token));
        Assert.Equal(0, rig.Ocr.Calls);
    }

    /// <summary>SYNTHETIC (same as Core's Collect.SyntheticWholeSkillsList): fixture 01 with a scroll thumb spanning the
    /// whole track, i.e. pretending its 14 skills are the full list, so the complete-and-queue path can be exercised.
    /// No screenshot shows the end of a Skills list.</summary>
    private static ParsedFrame SyntheticWholeSkillsList(Rig rig)
    {
        var parsed = R.Parser(Repo.McQueen[0]).ParseAsync(rig.Fixture(Repo.McQueen[0])).GetAwaiter().GetResult();
        return parsed with { Thumb = new ScrollThumb(R.Data.Layout.Int("scrollbar", "trackTop"), R.Data.Layout.Int("scrollbar", "trackBottom")) };
    }

    private static ParsedFrame Parse(Rig rig, string name) => R.Parser(name).ParseAsync(rig.Fixture(name)).GetAwaiter().GetResult();

    [Fact]
    public void Complete_session_is_queued_once_on_flush_with_popups_seen_before_leaving_it()
    {
        using var rig = new Rig();
        var events = new List<PipelineEvent> { rig.Pipeline.Accept(SyntheticWholeSkillsList(rig)) };
        foreach (var n in Repo.McQueen.Skip(1)) events.Add(rig.Pipeline.Accept(Parse(rig, n)));
        Assert.Equal(3, rig.Pipeline.Progress!.TabsComplete);
        Assert.Empty(rig.Outbox.Snapshot());   // complete, but still current: popups can still resolve parents

        events.Add(rig.Pipeline.Accept(Parse(rig, Repo.SpecialWeekPopup)));
        events.Add(rig.Pipeline.Accept(Parse(rig, Repo.OperaPopup)));
        Assert.All(events, e => Assert.NotEqual(PipelineEventKind.Failed, e.Kind));

        var queued = Assert.Single(rig.Pipeline.Flush());
        Assert.Equal(PipelineEventKind.Queued, queued.Kind);
        Assert.Matches("^[0-7][0-9A-HJKMNP-TV-Z]{25}$", queued.CaptureId!);
        var veteran = Assert.Single(rig.Outbox.Snapshot());
        Assert.Equal("veteran", veteran.Kind);
        Assert.Equal(queued.CaptureId, veteran.CaptureId);

        var pending = rig.Outbox.Next()!;
        var capture = CaptureJson.Deserialize(System.Text.Encoding.UTF8.GetString(pending.Payload));
        Assert.Empty(CaptureValidation.Validate(capture, R.Data.Master.Ids));
        Assert.Equal("t10-test", capture.AgentVersion);
        Assert.Equal(R.Data.Layout.Version, capture.LayoutVersion);
        Assert.Equal(R.Data.Master.Version, capture.MasterVersion);
        Assert.Equal(rig.Clock.UtcNow, capture.CapturedAt);
        Assert.All(capture.Veteran.Parents, p => Assert.NotNull(p.OutfitId));   // the popups were included

        Assert.Empty(rig.Pipeline.Flush());   // queued once
        var again = rig.Pipeline.Accept(Parse(rig, Repo.McQueen[1]));
        Assert.Equal(PipelineEventKind.AlreadyQueued, again.Kind);
        Assert.Empty(rig.Pipeline.Flush());
        Assert.Single(rig.Outbox.Snapshot());
    }

    [Fact]
    public void Moving_to_another_veteran_queues_the_completed_one()
    {
        using var rig = new Rig();
        rig.Pipeline.Accept(SyntheticWholeSkillsList(rig));
        foreach (var n in Repo.McQueen.Skip(1)) rig.Pipeline.Accept(Parse(rig, n));
        var e = rig.Pipeline.Accept(Parse(rig, "15-veteran-details-skills-manual"));
        Assert.Equal(PipelineEventKind.Queued, e.Kind);
        Assert.Contains("queued", e.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Single(rig.Outbox.Snapshot(), i => i.Kind == "veteran");
        Assert.Equal(3, rig.Outbox.Snapshot().Count(i => i.Kind == "crop")); // unresolved popup fields need review crops
        Assert.Equal(0, rig.Pipeline.Progress!.TabsComplete);   // now tracking the new veteran
    }

    [Fact]
    public void Leaving_a_complete_veteran_for_an_unknown_screen_keeps_it_current_until_flush()
    {
        // Popups are reached from the details screen; any other screen (unknown, cards) breaks continuity, but the
        // session stays ready and is flushed on Stop/Exit or when another veteran appears.
        using var rig = new Rig();
        rig.Pipeline.Accept(SyntheticWholeSkillsList(rig));
        foreach (var n in Repo.McQueen.Skip(1)) rig.Pipeline.Accept(Parse(rig, n));
        rig.Pipeline.Accept(Parse(rig, "13-support-card-list"));
        Assert.Empty(rig.Outbox.Snapshot());
        Assert.Equal(PipelineEventKind.Queued, Assert.Single(rig.Pipeline.Flush()).Kind);
    }

    [Fact]
    public void Enqueue_refusal_is_reported_and_not_retried_silently()
    {
        using var rig = new Rig();
        rig.Pipeline.Accept(SyntheticWholeSkillsList(rig));
        foreach (var n in Repo.McQueen.Skip(1).Append(Repo.SpecialWeekPopup).Append(Repo.OperaPopup)) rig.Pipeline.Accept(Parse(rig, n));
        // Simulate a read-only/locked outbox: the file is replaced by a directory, so SQLite cannot open it.
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        File.Delete(Path.Combine(rig.Dir, "outbox.db"));
        Directory.CreateDirectory(Path.Combine(rig.Dir, "outbox.db"));
        var e = Assert.Single(rig.Pipeline.Flush());
        Assert.Equal(PipelineEventKind.Failed, e.Kind);
        Assert.Contains("not saved", e.Message);
        Assert.Contains(rig.Log.Lines, l => l.StartsWith("E ", StringComparison.Ordinal));
    }
}
