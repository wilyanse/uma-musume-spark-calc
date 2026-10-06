using System.Runtime.CompilerServices;
using Uma.Agent.Core;
using Uma.Agent.Windows.Shell;

// T10 verification tool (review round 1, B1). Usage: dotnet MemoryProbe.dll <repo-root>
// Real CapturePipeline + real Core + real fixture screenshots/recorded OCR; injected clock, seeded IDs.
// A: one still Inspiration view, a NEW frame array every 250 ms poll for 60 s (the reviewer's B1 probe).
// B: the same view with a SYNTHETIC one-pixel cosmetic change on every poll for 60 s (moving clock/animation).
// C: 20 SYNTHETIC distinct veterans (real parsed fixture evidence 01-07 + popups 09/10, Speed +i, fresh frame buffers).
// D: worst case: two unqueued veterans each sent more distinct views than the per-veteran limit.
// Each scenario runs in its own method; "managed +MB" is GC.GetTotalMemory after a full blocking GC, relative to
// the scenario baseline. Managed heap only (frame buffers are managed byte[]); not process RSS.
var root = args.Length > 0 ? args[0] : throw new ArgumentException("repo root required");
var p = new Probe(root);
try
{
    await p.Still(cosmetic: false);
    await p.Still(cosmetic: true);
    await p.Veterans();
    p.WorstCase();
}
finally { p.Dispose(); }

sealed class Probe(string root) : IDisposable
{
    private readonly AgentData _data = AgentData.Load(Path.Combine(root, "agent/layouts"), Path.Combine(root, "apps/web/public/master"));
    private readonly string _dir = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), "t10-memory-probe-" + Guid.NewGuid().ToString("N"))).FullName;
    private string Png(string n) => Path.Combine(root, "docs/reference/screenshots", n + ".png");
    private FixtureOcrEngine Recorded(string n) => new(Path.Combine(root, "agent/tests/fixtures/ocr", n + ".json"), Path.Combine(root, "agent/tests/fixtures/ocr-roi", n + ".json"));
    private static long Heap() { for (var i = 0; i < 3; i++) { GC.Collect(GC.MaxGeneration, GCCollectionMode.Forced, true, true); GC.WaitForPendingFinalizers(); } return GC.GetTotalMemory(true); }
    private static RandomFill Seeded(int seed) { var rng = new Random(seed); return b => rng.NextBytes(b); }
    private static Frame Copy(Frame f) => new((byte[])f.Bgra.Clone(), f.Width, f.Height);
    private (CapturePipeline Pipeline, ProbeClock Clock, UploadOutbox Outbox) New(IOcrEngine ocr, string db, int seed)
    {
        var clock = new ProbeClock();
        var outbox = new UploadOutbox(Path.Combine(_dir, db), clock);
        return (new CapturePipeline(_data, ocr, outbox, clock, new UlidGenerator(clock, Seeded(seed)), "probe", new FrameGate(clock, TimeSpan.FromSeconds(2)), new NullLog()), clock, outbox);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    public async Task Still(bool cosmetic)
    {
        const string name = "02-veteran-details-inspiration-p1";
        var frame = Frames.Load(Png(name));
        var (pipeline, clock, _) = New(Recorded(name), $"still-{cosmetic}.db", 1);
        var baseline = Heap();
        Console.WriteLine($"{(cosmetic ? "B one-pixel cosmetic change every poll" : "A idle still view, fresh array every poll")}: baseline managed MB {baseline / 1e6:F1}");
        int processed = 0, skipped = 0;
        for (var i = 1; i <= 240; i++)
        {
            clock.UtcNow += TimeSpan.FromMilliseconds(250);
            if (await Poll(pipeline, frame, cosmetic ? i : -1) == PipelineEventKind.Skipped) skipped++; else processed++;
            if (i % 40 == 0) Console.WriteLine($"  after {i} polls ({i / 4}s): processed {processed} skipped {skipped}; retained {pipeline.Retained}; managed +MB {(Heap() - baseline) / 1e6:F1}");
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static async Task<PipelineEventKind> Poll(CapturePipeline pipeline, Frame frame, int cosmetic)
    {
        var f = Copy(frame);
        if (cosmetic >= 0) { f.Bgra[0] = (byte)cosmetic; f.Bgra[1] = (byte)(cosmetic >> 8); }
        return (await pipeline.ProcessAsync(f, CancellationToken.None)).Kind;
    }

    private async Task<List<ParsedFrame>> Parsed()
    {
        var names = new[] { "01-veteran-details-skills-independent", "02-veteran-details-inspiration-p1", "03-veteran-details-inspiration-p2", "04-veteran-details-inspiration-p3", "05-veteran-details-career-info-deck-legacy", "06-veteran-details-career-info-record", "07-veteran-details-career-info-races", "09-sparks-popup-special-week-parent", "10-sparks-popup-guest-parent" };
        var parsed = new List<ParsedFrame>();
        foreach (var n in names)
        {
            var p = await new FrameParser(_data.Layout, _data.Master, _data.Templates, Recorded(n)).ParseAsync(Frames.Load(Png(n)));
            // SYNTHETIC whole-list Skills thumb: no screenshot shows the end of a Skills list (same as the portable tests).
            if (n.StartsWith("01-", StringComparison.Ordinal)) p = p with { Thumb = new ScrollThumb(_data.Layout.Int("scrollbar", "trackTop"), _data.Layout.Int("scrollbar", "trackBottom")) };
            parsed.Add(p);
        }
        return parsed;
    }

    private static ParsedFrame Veteran(ParsedFrame p, int v)
        => p with { Frame = Copy(p.Frame), Header = p.Header is null ? null : p.Header with { Stats = p.Header.Stats.ToDictionary(kv => kv.Key, kv => kv.Key == "spd" ? kv.Value with { Value = (int)kv.Value.Value! + v } : kv.Value) } };

    [MethodImpl(MethodImplOptions.NoInlining)]
    public async Task Veterans()
    {
        var parsed = await Parsed();
        var (pipeline, clock, outbox) = New(new NoOcr(), "veterans.db", 2);
        var baseline = Heap();
        Console.WriteLine($"C 20 veterans in one watch: baseline managed MB {baseline / 1e6:F1}");
        var queued = 0;
        for (var v = 0; v < 20; v++)
        {
            clock.UtcNow += TimeSpan.FromMinutes(1);
            foreach (var p in parsed) if (pipeline.Accept(Veteran(p, v)).Kind == PipelineEventKind.Queued) queued++;
            if (v % 5 == 4) Console.WriteLine($"  after veteran {v + 1}: queued {queued}; retained {pipeline.Retained}; managed +MB {(Heap() - baseline) / 1e6:F1}");
        }
        queued += pipeline.Flush().Count(e => e.Kind == PipelineEventKind.Queued);
        Console.WriteLine($"  after Stop: queued {queued}; outbox veterans {outbox.Snapshot().Count(i => i.Kind == "veteran")}; retained {pipeline.Retained}; managed +MB {(Heap() - baseline) / 1e6:F1}");
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    public void WorstCase()
    {
        var career = Parsed().GetAwaiter().GetResult()[5];
        var (pipeline, _, _) = New(new NoOcr(), "worst.db", 3);
        var baseline = Heap();
        Console.WriteLine($"D worst case, 2 unqueued veterans x {CapturePipeline.MaxFramesPerSession + 20} distinct views: baseline managed MB {baseline / 1e6:F1}");
        var limits = 0;
        for (var v = 0; v < 2; v++)
            for (var i = 0; i < CapturePipeline.MaxFramesPerSession + 20; i++)
                // SYNTHETIC distinct evidence: a different scroll thumb per view.
                if (pipeline.Accept(Veteran(career, v) with { Thumb = new ScrollThumb(1000 + i, 1100 + i) }).Kind == PipelineEventKind.Limit) limits++;
        Console.WriteLine($"  limit events {limits}; retained {pipeline.Retained}; managed +MB {(Heap() - baseline) / 1e6:F1} (bound {CapturePipeline.MaxLiveSessions} x {CapturePipeline.MaxFramesPerSession} x 8.29 MB = {CapturePipeline.MaxLiveSessions * CapturePipeline.MaxFramesPerSession * 1920 * 1080 * 4 / 1e6:F0} MB of frames)");
    }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(_dir, true);
    }
}

sealed class ProbeClock : IClock { public DateTimeOffset UtcNow { get; set; } = new(2026, 10, 4, 0, 0, 0, TimeSpan.Zero); }
sealed class NullLog : IShellLog { public void Info(string m) { } public void Warn(string m) { } public void Error(string m) { } }
sealed class NoOcr : IOcrEngine { public Task<IReadOnlyList<OcrLine>> ReadAsync(Frame f, Rect r, OcrMode m) => Task.FromResult<IReadOnlyList<OcrLine>>([]); }
