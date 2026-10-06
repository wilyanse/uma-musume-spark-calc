using System.Runtime.CompilerServices;
using Uma.Agent.Core;
using Uma.Agent.Windows.Shell;
using Xunit;

namespace Uma.Agent.Windows.Portable.Tests;

/// <summary>T10 review round 1 B1: memory held by an assisted watch must stay bounded. Real Core sessions, real fixture
/// frames/recorded OCR, injected time and seeded IDs. Retention is proven with weak references after a full blocking
/// GC (the frames are only reachable through the pipeline), not with timing or process-memory heuristics.</summary>
public class MemoryBoundTests
{
    private static Repo R => Repo.Instance;

    private sealed class AnyFrameOcr(IOcrEngine inner) : IOcrEngine
    {
        public int Calls { get; private set; }
        public Task<IReadOnlyList<OcrLine>> ReadAsync(Frame frame, Rect roi, OcrMode mode) { Calls++; return inner.ReadAsync(frame, roi, mode); }
    }

    private sealed class Rig : IDisposable
    {
        public string Dir { get; } = Temp.Dir();
        public TestClock Clock { get; } = new();
        public UploadOutbox Outbox { get; }
        public ListLog Log { get; } = new();
        public CapturePipeline Pipeline { get; private set; }
        public Rig(IOcrEngine? ocr = null)
        {
            Outbox = new UploadOutbox(Path.Combine(Dir, "outbox.db"), Clock);
            Pipeline = New(ocr ?? new FrameDispatchOcr());
        }
        public CapturePipeline New(IOcrEngine ocr) => Pipeline = new CapturePipeline(R.Data, ocr, Outbox, Clock, new UlidGenerator(Clock, Seeded.Bytes(42)), "t10-test", new FrameGate(Clock, TimeSpan.FromSeconds(2)), Log);
        public void Dispose() => Temp.Drop(Dir);
    }

    private static Frame Copy(Frame f) => new((byte[])f.Bgra.Clone(), f.Width, f.Height);

    private static void FullGc() { for (var i = 0; i < 3; i++) { GC.Collect(GC.MaxGeneration, GCCollectionMode.Forced, true, true); GC.WaitForPendingFinalizers(); } }

    [Fact]
    public async Task Idle_polls_of_fresh_identical_arrays_parse_once_and_retain_one_frame()
    {
        // WGC delivers a NEW array every 250 ms poll even when nothing moves. The forced 2 s re-read must not re-parse or
        // re-retain byte-identical frames (the reviewer's probe grew ~4 MB/s here).
        var name = Repo.McQueen[1];
        var ocr = new AnyFrameOcr(R.Ocr(name));
        using var rig = new Rig(ocr);
        var refs = new List<WeakReference>();
        var processed = await Run(rig, 120, i => Copy(R.Frame(name)), refs);   // 30 s of idle dwell
        Assert.Equal(1, processed);
        var callsAfterFirst = ocr.Calls;
        Assert.True(callsAfterFirst > 0);
        FullGc();
        Assert.Equal(1, refs.Count(r => r.IsAlive));   // only the first (evidence) frame is held
        Assert.Equal(1, rig.Pipeline.Retained.Frames);
    }

    /// <summary>Polls in a separate method so the test's own stack holds no frame when retention is checked.</summary>
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static async Task<int> Run(Rig rig, int polls, Func<int, Frame> make, List<WeakReference> refs, TimeSpan? step = null, Action<PipelineEvent>? check = null)
    {
        var processed = 0;
        for (var i = 0; i < polls; i++)
        {
            rig.Clock.UtcNow += step ?? TimeSpan.FromMilliseconds(250);
            var e = await Poll(rig.Pipeline, make(i), refs);
            if (e.Kind != PipelineEventKind.Skipped) { processed++; check?.Invoke(e); }
        }
        return processed;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static Task<PipelineEvent> Poll(CapturePipeline p, Frame f, List<WeakReference> refs) { refs.Add(new WeakReference(f)); return p.ProcessAsync(f, CancellationToken.None); }

    /// <summary>A cosmetic pixel change (moving clock, animated sparkle) outside every parsed ROI makes a different
    /// frame whose parsed evidence is identical. It is re-parsed (correct: the gate cannot know), but must not be
    /// accumulated as new evidence.</summary>
    [Fact]
    public async Task Cosmetic_changes_with_the_same_parsed_evidence_are_not_accumulated()
    {
        var name = Repo.McQueen[1];
        var ocr = new AnyFrameOcr(R.Ocr(name));
        using var rig = new Rig(ocr);
        var refs = new List<WeakReference>();
        SessionProgress? first = null;
        var processed = await Run(rig, 40, i =>
        {
            var f = Copy(R.Frame(name));
            f.Bgra[0] = (byte)i; f.Bgra[1] = (byte)(255 - i);   // top-left pixel only: SYNTHETIC cosmetic change
            return f;
        }, refs, TimeSpan.FromSeconds(2), e =>
        {
            Assert.Equal(PipelineEventKind.Progress, e.Kind);
            first ??= rig.Pipeline.Progress;   // the checklist never changes: nothing new was learnt
            Assert.Equal(first!.Checklist.Select(c => (c.Section, c.Complete, c.Detail)), rig.Pipeline.Progress!.Checklist.Select(c => (c.Section, c.Complete, c.Detail)));
        });
        Assert.Equal(40, processed);   // re-parsed (the gate cannot know it is cosmetic) ...
        FullGc();
        Assert.Equal(1, refs.Count(r => r.IsAlive));    // ... but only the first frame is kept as evidence
        Assert.Equal(1, rig.Pipeline.Retained.Frames);
        Assert.Equal(1, rig.Pipeline.Retained.Sessions);
    }

    private static readonly Lazy<IReadOnlyList<ParsedFrame>> Veteran = new(() =>
    {
        var list = new List<ParsedFrame>();
        foreach (var n in Repo.McQueen.Append(Repo.SpecialWeekPopup).Append(Repo.OperaPopup))
        {
            var p = R.Parser(n).ParseAsync(R.Frame(n)).GetAwaiter().GetResult();
            // SYNTHETIC whole-list Skills thumb (no screenshot shows the end of a Skills list; see CapturePipelineTests).
            if (n == Repo.McQueen[0]) p = p with { Thumb = new ScrollThumb(R.Data.Layout.Int("scrollbar", "trackTop"), R.Data.Layout.Int("scrollbar", "trackBottom")) };
            list.Add(p);
        }
        return list;
    });

    /// <summary>SYNTHETIC distinct veteran #i: the real parsed evidence with a different confident Speed value (a new
    /// identity by Core's own rule) and freshly allocated frame buffers, so retention is observable per veteran.</summary>
    private static IEnumerable<ParsedFrame> VeteranFrames(int i, List<WeakReference>? refs = null, IEnumerable<int>? only = null)
    {
        var parsed = Veteran.Value;
        foreach (var k in only ?? Enumerable.Range(0, parsed.Count))
        {
            var p = parsed[k];
            var frame = Copy(p.Frame);
            refs?.Add(new WeakReference(frame));
            var h = p.Header;
            if (h is not null)
            {
                var spd = h.Stats["spd"];
                h = h with { Stats = h.Stats.ToDictionary(kv => kv.Key, kv => kv.Key == "spd" ? spd with { Value = (int)spd.Value! + i } : kv.Value) };
            }
            yield return p with { Frame = frame, Header = h };
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static List<PipelineEvent> Feed(CapturePipeline pipeline, int veteran, List<WeakReference>? refs = null, IEnumerable<int>? only = null)
        => VeteranFrames(veteran, refs, only).Select(pipeline.Accept).ToList();

    [Fact]
    public void Twenty_veterans_in_one_watch_are_queued_and_their_frames_released()
    {
        using var rig = new Rig();
        var refs = new List<WeakReference>[20];
        var queuedIds = new List<string>();
        for (var v = 0; v < 20; v++)
        {
            refs[v] = [];
            foreach (var e in Feed(rig.Pipeline, v, refs[v]))
            {
                Assert.NotEqual(PipelineEventKind.Failed, e.Kind);
                if (e.Kind == PipelineEventKind.Queued) queuedIds.Add(e.CaptureId!);
            }
            Assert.True(rig.Pipeline.Retained.Sessions <= CapturePipeline.MaxLiveSessions);
            Assert.True(rig.Pipeline.Retained.Frames <= CapturePipeline.MaxLiveSessions * CapturePipeline.MaxFramesPerSession);
        }
        Assert.Equal(19, queuedIds.Count);
        FullGc();
        for (var v = 0; v < 19; v++) Assert.DoesNotContain(refs[v], r => r.IsAlive);   // queued veterans hold nothing
        Assert.Contains(refs[19], r => r.IsAlive);                                       // current veteran keeps its evidence
        Assert.Equal(1, rig.Pipeline.Retained.Sessions);

        var last = Assert.Single(rig.Pipeline.Flush());
        Assert.Equal(PipelineEventKind.Queued, last.Kind);
        queuedIds.Add(last.CaptureId!);
        Assert.Equal(20, queuedIds.Distinct().Count());
        Assert.Equal(20, rig.Outbox.Snapshot().Count(i => i.Kind == "veteran"));
        FullGc();
        Assert.DoesNotContain(refs[19], r => r.IsAlive);
        Assert.Equal((0, 0), (rig.Pipeline.Retained.Sessions, rig.Pipeline.Retained.Frames));
    }

    [Fact]
    public void Returning_to_a_queued_veteran_is_reported_and_never_recollected()
    {
        using var rig = new Rig();
        Feed(rig.Pipeline, 0);
        Assert.Equal(PipelineEventKind.Queued, Feed(rig.Pipeline, 1, only: [1]).Single().Kind);
        var refs = new List<WeakReference>();
        var back = Feed(rig.Pipeline, 0, refs, only: [1, 2, 7, 4]);   // includes a parent popup of the queued veteran
        Assert.Equal(PipelineEventKind.NotUploadable, back[0].Kind);    // leaving incomplete veteran 1 is reported
        Assert.All(back.Skip(1), e => Assert.Equal(PipelineEventKind.AlreadyQueued, e.Kind));
        FullGc();
        Assert.DoesNotContain(refs, r => r.IsAlive);
        // Veteran 1 (incomplete: one Inspiration frame) is kept, not lost, while the user revisits veteran 0.
        var flushed = rig.Pipeline.Flush();
        Assert.Equal(PipelineEventKind.NotUploadable, Assert.Single(flushed).Kind);
        Assert.Single(rig.Outbox.Snapshot(), i => i.Kind == "veteran");
    }

    [Fact]
    public void An_incomplete_veteran_keeps_its_evidence_across_another_veteran_and_completes_later()
    {
        using var rig = new Rig();
        var all = Enumerable.Range(0, Veteran.Value.Count).ToArray();
        // Veteran 0: Skills + Inspiration only (no Career Info); then veteran 1 complete; then back to finish veteran 0.
        Assert.DoesNotContain(Feed(rig.Pipeline, 0, only: all[..4]), e => e.Kind == PipelineEventKind.Queued);
        var toOne = Feed(rig.Pipeline, 1);
        Assert.Equal(PipelineEventKind.NotUploadable, toOne[0].Kind);   // reported, not dropped
        var back = Feed(rig.Pipeline, 0, only: all[4..]);
        Assert.Equal(PipelineEventKind.Queued, back[0].Kind);           // veteran 1 queued on leaving it
        Assert.Equal(3, rig.Pipeline.Progress!.TabsComplete);            // veteran 0 complete with its earlier Skills/Inspiration
        Assert.Equal(PipelineEventKind.Queued, Assert.Single(rig.Pipeline.Flush()).Kind);
        Assert.Equal(2, rig.Outbox.Snapshot().Count(i => i.Kind == "veteran"));
    }

    [Fact]
    public void Identity_change_after_parent_popups_queues_the_previous_veteran_with_its_popups_only()
    {
        using var rig = new Rig();
        Feed(rig.Pipeline, 0);                                   // includes both parent popups
        var next = Feed(rig.Pipeline, 1, only: [0]).Single();
        Assert.Equal(PipelineEventKind.Queued, next.Kind);
        var popupAfter = Feed(rig.Pipeline, 1, only: [7]).Single();   // a popup now belongs to veteran 1
        Assert.Equal(PipelineEventKind.Progress, popupAfter.Kind);
        var item = rig.Outbox.Next()!;
        var capture = CaptureJson.Deserialize(System.Text.Encoding.UTF8.GetString(item.Payload));
        Assert.Equal(next.CaptureId, capture.CaptureId);
        Assert.All(capture.Veteran.Parents, p => Assert.NotNull(p.OutfitId));
        Assert.Empty(CaptureValidation.Validate(capture, R.Data.Master.Ids));
    }

    [Fact]
    public void Failed_enqueue_keeps_only_the_sealed_result_and_retries_it_exactly()
    {
        using var rig = new Rig();
        Feed(rig.Pipeline, 0);
        var db = Path.Combine(rig.Dir, "outbox.db");
        var payload = BreakOutbox(db);
        var refs = new List<WeakReference>();
        var failed = Feed(rig.Pipeline, 1, refs, only: [0]).Single();   // identity change triggers the enqueue
        Assert.Equal(PipelineEventKind.Failed, failed.Kind);
        FullGc();
        Assert.Equal(0, rig.Pipeline.Retained.Sessions);   // sealed result retained; transition refused until durable recovery
        Assert.Equal(1, rig.Pipeline.Retained.SealedPending);
        RepairOutbox(db, payload);
        var retried = rig.Pipeline.Flush();
        var queued = Assert.Single(retried, e => e.Kind == PipelineEventKind.Queued);
        Assert.Equal(failed.CaptureId, queued.CaptureId);   // exact same sealed capture ID
        Assert.Equal(0, rig.Pipeline.Retained.SealedPending);
        Assert.Single(rig.Outbox.Snapshot(), i => i.Kind == "veteran" && i.CaptureId == failed.CaptureId);
    }

    [Fact]
    public async Task Repeated_failed_enqueue_pauses_both_entry_points_before_new_evidence_and_retry_resumes_fresh()
    {
        var ocr = new AnyFrameOcr(R.Ocr(Repo.McQueen[0]));
        using var rig = new Rig(ocr);
        Feed(rig.Pipeline, 0);
        var db = Path.Combine(rig.Dir, "outbox.db");
        var aside = BreakOutbox(db);
        var failed = Feed(rig.Pipeline, 1, only: [0]).Single();
        Assert.Equal(PipelineEventKind.Failed, failed.Kind);
        Assert.Equal((0, 0, 1), (rig.Pipeline.Retained.Sessions, rig.Pipeline.Retained.Frames, rig.Pipeline.Retained.SealedPending));
        var pending = Pending(rig.Pipeline);
        var payload = System.Text.Encoding.UTF8.GetBytes(CaptureJson.Serialize(pending.Capture!));
        var pngs = pending.Crops.ToDictionary(c => c.Path, c => (byte[])c.Png.Clone());
        for (var i = 1; i <= 25; i++)
        {
            Assert.All(Feed(rig.Pipeline, i), e => Assert.Equal(PipelineEventKind.Failed, e.Kind));
            Assert.Equal(PipelineEventKind.Failed, (await rig.Pipeline.ProcessAsync(R.Frame(Repo.McQueen[0]), CancellationToken.None)).Kind);
            Assert.Equal(0, ocr.Calls);
            Assert.Equal((0, 0, 1), (rig.Pipeline.Retained.Sessions, rig.Pipeline.Retained.Frames, rig.Pipeline.Retained.SealedPending));
            Assert.Equal(failed.CaptureId, Assert.Single(rig.Pipeline.Flush()).CaptureId);
            Assert.Same(pending, Pending(rig.Pipeline));
        }
        RepairOutbox(db, aside);
        var recovered = Assert.Single(rig.Pipeline.Flush());
        Assert.Equal(PipelineEventKind.Queued, recovered.Kind);
        Assert.Equal(failed.CaptureId, recovered.CaptureId);
        using (var c = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=" + db))
        {
            c.Open(); using var q = c.CreateCommand(); q.CommandText = "SELECT kind, path, payload FROM outbox";
            using var rows = q.ExecuteReader(); var count = 0;
            while (rows.Read()) { count++; Assert.Equal(rows.GetString(0) == "veteran" ? payload : pngs[rows.GetString(1)], (byte[])rows[2]); }
            Assert.Equal(1 + pngs.Count, count);
        }
        Assert.Equal(PipelineEventKind.AlreadyQueued, (await rig.Pipeline.ProcessAsync(R.Frame(Repo.McQueen[0]), CancellationToken.None)).Kind);
        Assert.True(ocr.Calls > 0); // paused frame re-parsed, but queued identity stays frozen
        Assert.Equal(PipelineEventKind.Progress, Feed(rig.Pipeline, 1, only: [0]).Single().Kind);
        Assert.Equal(1, rig.Pipeline.Retained.Frames);
    }

    private static CaptureResult Pending(CapturePipeline p)
    {
        var list = (System.Collections.IEnumerable)typeof(CapturePipeline).GetField("_pending", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!.GetValue(p)!;
        var entry = Assert.Single(list.Cast<object>());
        return (CaptureResult)entry.GetType().GetProperty("Result")!.GetValue(entry)!;
    }

    [Fact]
    public void Previously_complete_at_cap_fails_closed_on_rejected_unaligned_skills_even_after_return_and_stop()
    {
        using var rig = new Rig();
        var core = new CaptureCoordinator(R.Data.Layout, R.Data.Master);
        foreach (var p in Veteran.Value) { rig.Pipeline.Accept(p); core.Feed(p); }
        for (var i = Veteran.Value.Count; i < CapturePipeline.MaxFramesPerSession; i++)
        {
            var p = Veteran.Value[5] with { Thumb = new ScrollThumb(1000 + i, 1100 + i) };
            rig.Pipeline.Accept(p); core.Feed(p);
        }
        Assert.Equal(3, rig.Pipeline.Progress!.TabsComplete);
        var rejected = Veteran.Value[0] with { Thumb = new ScrollThumb(700, 730), Skills = [] };
        Assert.Equal(PipelineEventKind.Limit, rig.Pipeline.Accept(rejected).Kind);
        core.Feed(rejected);
        Assert.False(core.Current!.Checklist().First(c => c.Section == "details.skills").Complete);
        Assert.NotEqual(3, rig.Pipeline.Progress!.TabsComplete);
        Assert.Equal(PipelineEventKind.Limit, rig.Pipeline.Accept(Veteran.Value[0]).Kind);
        Assert.DoesNotContain(rig.Pipeline.Flush(), e => e.Kind == PipelineEventKind.Queued);
        Feed(rig.Pipeline, 1, only: [1]); Feed(rig.Pipeline, 2, only: [1]);
        Assert.Equal(PipelineEventKind.Limit, rig.Pipeline.Accept(Veteran.Value[0]).Kind);
        Assert.DoesNotContain(rig.Pipeline.Flush(), e => e.Kind == PipelineEventKind.Queued);
        Assert.Empty(rig.Outbox.Snapshot());
    }

    [Fact]
    public async Task Overflow_blocker_survives_process_polls_and_does_not_prevent_other_complete_capture()
    {
        using var rig = new Rig();
        Feed(rig.Pipeline, 0);
        for (var i = Veteran.Value.Count; i <= CapturePipeline.MaxFramesPerSession; i++)
            rig.Pipeline.Accept(Veteran.Value[5] with { Thumb = new ScrollThumb(1000 + i, 1100 + i) });
        var status = new CaptureNoticeStatus();
        status.Apply(await rig.Pipeline.ProcessAsync(R.Frame(Repo.McQueen[0]), CancellationToken.None));
        Assert.Equal(PipelineEventKind.Skipped, (await rig.Pipeline.ProcessAsync(R.Frame(Repo.McQueen[0]), CancellationToken.None)).Kind);
        status.Apply(await rig.Pipeline.ProcessAsync(R.Frame(Repo.McQueen[0]), CancellationToken.None));
        Assert.Contains("cannot be saved", status.Error);
        Assert.Contains(rig.Pipeline.Flush(), e => e.Kind == PipelineEventKind.NotUploadable);
        Assert.Empty(rig.Outbox.Snapshot());
        Feed(rig.Pipeline, 1);
        var flushed = rig.Pipeline.Flush();
        Assert.Single(flushed, e => e.Kind == PipelineEventKind.Queued);
        Assert.Single(flushed, e => e.Kind == PipelineEventKind.NotUploadable);
        Assert.Single(rig.Outbox.Snapshot(), i => i.Kind == "veteran");
        Assert.Contains("cannot be saved", status.Error);
        var fresh = rig.New(new FrameDispatchOcr()); // explicit fresh pipeline only
        Feed(fresh, 0);
        Assert.Equal(PipelineEventKind.Queued, Assert.Single(fresh.Flush()).Kind);
    }

    private static string BreakOutbox(string db)
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        var aside = db + ".aside";
        Directory.CreateDirectory(aside);
        foreach (var f in Directory.GetFiles(Path.GetDirectoryName(db)!, Path.GetFileName(db) + "*")) File.Move(f, Path.Combine(aside, Path.GetFileName(f)));
        Directory.CreateDirectory(db);   // SQLite cannot open a directory: simulates a locked/unwritable outbox
        return aside;
    }

    private static void RepairOutbox(string db, string aside)
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(db);
        foreach (var f in Directory.GetFiles(aside)) File.Move(f, Path.Combine(Path.GetDirectoryName(db)!, Path.GetFileName(f)));
        Directory.Delete(aside);
    }

    [Fact]
    public void Distinct_views_beyond_the_per_veteran_limit_are_reported_not_retained()
    {
        using var rig = new Rig();
        var career = Veteran.Value[5];   // real fixture 06 (Career Info record) parsed evidence
        var refs = new List<WeakReference>();
        var events = new List<PipelineEvent>();
        for (var i = 0; i < CapturePipeline.MaxFramesPerSession + 10; i++)
            events.Add(AcceptDistinct(rig.Pipeline, career, i, refs));
        Assert.All(events.Take(CapturePipeline.MaxFramesPerSession), e => Assert.Equal(PipelineEventKind.Progress, e.Kind));
        Assert.All(events.Skip(CapturePipeline.MaxFramesPerSession), e => Assert.Equal(PipelineEventKind.Limit, e.Kind));
        Assert.Contains("Stop", events[^1].Message);
        FullGc();
        Assert.Equal(CapturePipeline.MaxFramesPerSession, refs.Count(r => r.IsAlive));
        Assert.Equal(CapturePipeline.MaxFramesPerSession, rig.Pipeline.Retained.Frames);
        Assert.Empty(rig.Outbox.Snapshot());   // never uploads because of a limit
    }

    /// <summary>SYNTHETIC distinct evidence for the same veteran: a different scroll thumb per view (a new parsed fact).</summary>
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static PipelineEvent AcceptDistinct(CapturePipeline pipeline, ParsedFrame p, int i, List<WeakReference> refs)
    {
        var frame = Copy(p.Frame);
        refs.Add(new WeakReference(frame));
        return pipeline.Accept(p with { Frame = frame, Thumb = new ScrollThumb(1000 + i, 1100 + i) });
    }

    [Fact]
    public void At_most_two_unqueued_veterans_are_kept_and_the_released_one_is_reported()
    {
        using var rig = new Rig();
        var refs = new List<WeakReference>[3];
        for (var v = 0; v < 3; v++) { refs[v] = []; Feed(rig.Pipeline, v, refs[v], only: [1]); }   // three incomplete veterans
        Assert.Equal(CapturePipeline.MaxLiveSessions, rig.Pipeline.Retained.Sessions);
        FullGc();
        Assert.DoesNotContain(refs[0], r => r.IsAlive);   // the oldest incomplete veteran was released ...
        Assert.Contains(rig.Log.Lines, l => l.StartsWith("W ", StringComparison.Ordinal));
        var flushed = rig.Pipeline.Flush();
        Assert.Equal(2, flushed.Count);
        Assert.All(flushed, e => Assert.Equal(PipelineEventKind.NotUploadable, e.Kind));
        Assert.Empty(rig.Outbox.Snapshot());
    }

    [Fact]
    public void Releasing_an_incomplete_veteran_is_announced_in_the_event()
    {
        using var rig = new Rig();
        Feed(rig.Pipeline, 0, only: [1]);
        Feed(rig.Pipeline, 1, only: [1]);
        var third = Feed(rig.Pipeline, 2, only: [1]).Single();
        Assert.Equal(PipelineEventKind.NotUploadable, third.Kind);
        Assert.Contains("released", third.Message);
    }

    [Fact]
    public void The_least_recently_visited_incomplete_veteran_is_the_one_released()
    {
        using var rig = new Rig();
        var refs0 = new List<WeakReference>(); var refs1 = new List<WeakReference>();
        Feed(rig.Pipeline, 0, refs0, only: [1]);
        Feed(rig.Pipeline, 1, refs1, only: [1]);
        Feed(rig.Pipeline, 0, refs0, only: [2]);   // the user went back to veteran 0
        Feed(rig.Pipeline, 2, only: [1]);
        FullGc();
        Assert.DoesNotContain(refs1, r => r.IsAlive);   // veteran 1 (least recently visited) released
        Assert.Equal(2, refs0.Count(r => r.IsAlive));   // veteran 0 kept with both views
    }
}
