using System.Runtime.CompilerServices;
using Uma.Agent.Core;
using Uma.Agent.Windows.Shell;

// Retained independent review-round-2 edge probe, re-expressed with fail-fast regression assertions.
// Usage: dotnet EdgeProbe.dll <repo-root>. Historical measured failures are in the coordinator review.
// No native WGC/OCR execution; all veteran/thumb mutations are synthetic.
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
    await p.Edges();
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


    public async Task Edges()
    {
        var parsed = await Parsed();
        // Compare same evidence at/over the bound with a real Core coordinator.
        var (pipeline, clock, outbox) = New(new NoOcr(), "limit.db", 11);
        var core = new CaptureCoordinator(_data.Layout, _data.Master);
        foreach (var f in parsed) { pipeline.Accept(f); core.Feed(f); }
        for(int i=0;i<31;i++) { var f=parsed[5] with { Thumb=new ScrollThumb(1000+i,1100+i) }; pipeline.Accept(f); core.Feed(f); }
        var unaligned=parsed[0] with { Thumb=new ScrollThumb(700,730), Skills=[] };
        var ev = pipeline.Accept(unaligned); core.Feed(unaligned);
        Console.WriteLine($"LIMIT rejected new unaligned Skills: event={ev.Kind}; retained={pipeline.Retained}; shellSkillsComplete={pipeline.Progress!.Checklist.First(c=>c.Section=="details.skills").Complete}; CoreSkillsComplete={core.Current!.Checklist().First(c=>c.Section=="details.skills").Complete}");
        var stopped = pipeline.Flush();
        Check(ev.Kind == PipelineEventKind.Limit && pipeline.Progress!.TabsComplete == 0 && !core.Current!.Checklist().First(c=>c.Section=="details.skills").Complete, "overflow blocks stale complete UI");
        Check(stopped.All(e=>e.Kind!=PipelineEventKind.Queued) && outbox.Snapshot().Count==0, "overflow Stop never queues");
        Console.WriteLine("LIMIT Stop="+string.Join(",",stopped.Select(e=>e.Kind))+"; outboxVeterans="+outbox.Snapshot().Count(i=>i.Kind=="veteran"));
        var notices = new CaptureNoticeStatus(); notices.Apply(ev);
        var poll = await pipeline.ProcessAsync(parsed[0].Frame, CancellationToken.None); notices.Apply(poll);
        notices.Apply(await pipeline.ProcessAsync(parsed[0].Frame, CancellationToken.None));
        Check(notices.Error is not null, "overflow notice survives routine polls");
        // Bad outbox: first failure must pause, not seal another veteran.
        var (failed, fc, fo) = New(new NoOcr(), "failed.db", 12);
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        var db=Path.Combine(_dir,"failed.db"); var aside=db+".aside";
        Directory.CreateDirectory(aside);
        foreach(var f in Directory.GetFiles(_dir,"failed.db*")) File.Move(f,Path.Combine(aside,Path.GetFileName(f)));
        Directory.CreateDirectory(db);
        var baseline=Heap();
        var ids=new List<string>();
        for(int v=0;v<41;v++) {
            foreach(var f in parsed.Take(7)) { var e=failed.Accept(Veteran(f,v)); if(e.Kind==PipelineEventKind.Failed) ids.Add(e.CaptureId!); }
            if(v==20||v==40) {
                var retainedResults=failed.PendingResults.ToList();
                Console.WriteLine($"QUEUEFAIL veterans={v+1}; retained={failed.Retained}; managed+MB={(Heap()-baseline)/1e6:F3}; distinctFailedIDs={ids.Distinct().Count()}; failedEvents={ids.Count}; retainedPngBytes={retainedResults.Sum(r=>r.Crops.Sum(c=>c.Png.Length))}");
            }
        }
        var results=failed.PendingResults.ToList();
        var hashes=results.ToDictionary(r=>r.Capture!.CaptureId,r=>Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(CaptureJson.Serialize(r.Capture!)))));
        var crops=results.SelectMany(r=>r.Crops.Select(c=>(Id:r.Capture!.CaptureId,c.Path,Hash:Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(c.Png))))).ToList();
        Console.WriteLine($"QUEUEFAIL sealedResults={results.Count}; sealedAll={results.All(r=>r.Uploadable)}; pngBytes={results.Sum(r=>r.Crops.Sum(c=>c.Png.Length))}");
        Check(results.Count==1 && failed.Retained.Sessions==0 && failed.Retained.Frames==0 && ids.Distinct().Count()==1, "41 attempted veterans retain only one sealed capture");
        var failedRetry = failed.Flush();
        Check(failedRetry.Count==1 && failedRetry[0].Kind==PipelineEventKind.Failed && failed.Retained.SealedPending==1, "failed retry stays blocked");
        var blocked = await failed.ProcessAsync(parsed[0].Frame, CancellationToken.None);
        Check(blocked.Kind==PipelineEventKind.Failed && failed.Retained.Frames==0, "ProcessAsync backpressure");
        var status = new CaptureNoticeStatus(); status.Apply(blocked); status.AcknowledgeReleased();
        Check(status.Error is not null && !status.StartFresh(), "unsaved error cannot be dismissed");
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); Directory.Delete(db);
        foreach(var f in Directory.GetFiles(aside)) File.Move(f,Path.Combine(_dir,Path.GetFileName(f)));
        var flushed=failed.Flush();var items=fo.Snapshot();
        Console.WriteLine($"RETRY queued={flushed.Count(e=>e.Kind==PipelineEventKind.Queued)}; oldCapturePayloadsExact={items.Where(i=>i.Kind=="veteran"&&hashes.ContainsKey(i.CaptureId)).All(i=>PayloadHash(db,i.CaptureId,"veteran",null)==hashes[i.CaptureId])}; oldIDsPreserved={ids.All(id=>items.Any(i=>i.Kind=="veteran"&&i.CaptureId==id))}; pending={failed.Retained.SealedPending}; oldCropBytesExact={crops.All(c=>PayloadHash(db,c.Id,"crop",c.Path)==c.Hash)}");
        Check(flushed.Count(e=>e.Kind==PipelineEventKind.Queued)==1 && failed.Retained.SealedPending==0, "repair queues exactly one retained capture");
        Check(items.Where(i=>i.Kind=="veteran"&&hashes.ContainsKey(i.CaptureId)).All(i=>PayloadHash(db,i.CaptureId,"veteran",null)==hashes[i.CaptureId]) && ids.All(id=>items.Any(i=>i.Kind=="veteran"&&i.CaptureId==id)) && crops.All(c=>PayloadHash(db,c.Id,"crop",c.Path)==c.Hash), "exact IDs JSON PNGs after retry");
        status.Apply(flushed[0]); Check(status.Error is null, "only successful durable retry clears unsaved notice");
        var resumed = failed.Accept(Veteran(parsed[0], 41));
        Check(resumed.Kind==PipelineEventKind.Progress && failed.Retained.Frames==1, "new identity resumes after repair");
        Console.WriteLine("BACKPRESSURE failed retry blocked; ProcessAsync blocked; exact retry; new identity resumed; notices verified");
        var (thumb, _, _) = New(new NoOcr(), "thumb.db", 14);
        var skill=parsed[0]; thumb.Accept(skill with { Thumb=null });
        var beforeThumb=thumb.Progress!.Checklist.First(c=>c.Section=="details.skills").Complete;
        thumb.Accept(skill);
        Console.WriteLine($"THUMB null->whole: complete={beforeThumb}->{thumb.Progress!.Checklist.First(c=>c.Section=="details.skills").Complete}; frames={thumb.Retained.Frames}");
        var (cancel, _, co) = New(new NoOcr(), "cancel.db", 15);
        foreach(var f in parsed) cancel.Accept(f);
        using var cts=new CancellationTokenSource();cts.Cancel();
        try { await cancel.ProcessAsync(parsed[0].Frame,cts.Token); } catch(OperationCanceledException) { }
        Console.WriteLine("CANCEL accepted complete survives="+(cancel.Flush().Single().Kind==PipelineEventKind.Queued)+"; outboxVeterans="+co.Snapshot().Count(i=>i.Kind=="veteran"));
        var (identity, _, _) = New(new NoOcr(), "identity.db", 16); var coord=new CaptureCoordinator(_data.Layout,_data.Master);
        var aa=parsed[0]; var bb=Veteran(aa,1); identity.Accept(aa);coord.Feed(aa);identity.Accept(bb);coord.Feed(bb);
        var unknown=aa with { Screen=aa.Screen with { Id=ScreenId.Unknown } }; identity.Accept(unknown);coord.Feed(unknown);
        var ambiguous=aa with { Header=aa.Header! with { Stats=aa.Header!.Stats.ToDictionary(k=>k.Key,k=>k.Value with { Ok=false }) } };
        var ie=identity.Accept(ambiguous);var ce=coord.Feed(ambiguous);
        Console.WriteLine($"IDENTITY samecharacter differentstats sessions={identity.Retained.Sessions}; CoreSessions={coord.Sessions.Count}; ambiguousShell={ie.Kind}; CoreIgnored={ce is null}");
        var (modes, _, mo) = New(new NoOcr(), "modes.db", 17);
        var modeCore=new CaptureCoordinator(_data.Layout,_data.Master);
        foreach(var f in parsed) { modes.Accept(f);modeCore.Feed(f); }
        var modeChanged=aa with { Header=aa.Header! with { Epithet=aa.Header!.Epithet with { Value="Synthetic manual epithet",Raw="Synthetic manual epithet" } } };
        modes.Accept(modeChanged);modeCore.Feed(modeChanged);
        var modeEvent=modes.Flush().Single();
        using var modeDb=new Microsoft.Data.Sqlite.SqliteConnection("Data Source="+Path.Combine(_dir,"modes.db"));modeDb.Open();using var modeQ=modeDb.CreateCommand();modeQ.CommandText="SELECT payload FROM outbox WHERE kind='veteran'";
        var modeCapture=CaptureJson.Deserialize(System.Text.Encoding.UTF8.GetString((byte[])modeQ.ExecuteScalar()!));
        Console.WriteLine($"MODEONLY synthetic header change: CoreSessions={modeCore.Sessions.Count}; Stop={modeEvent.Kind}; epithetStatus={modeCapture.Fields.Single(f=>f.Path=="/epithet").Status}");
        var settingsPath=Path.Combine(_dir,"settings.json");
        File.WriteAllText(settingsPath,"{broken");var settings=new SettingsStore(settingsPath,Path.Combine(root,"agent/src/Uma.Agent.Windows/appsettings.json"),clock);
        var def=settings.Load();var firstBackup=Directory.GetFiles(_dir,"settings.json.bad-*").Single();
        File.WriteAllText(settingsPath,"{broken-again");settings.Load();
        Console.WriteLine($"SETTINGS backups={Directory.GetFiles(_dir,"settings.json.bad-*").Length}; firstPreserved={File.ReadAllText(firstBackup)=="{broken"}; uploadsAllowed={ApiAddress.TryParse(def.ApiBaseUrl,out _,out _)}; notice={settings.Notice is not null}");
        var made=new List<DisposableProbe>();var drained=FrameDrain.TakeNewest(()=>{var d=new DisposableProbe();made.Add(d);return d;});
        Console.WriteLine($"DRAIN bounded={drained.Drained}; oldDisposed={made.Take(7).All(d=>d.Disposed)}; newestAlive={!drained.Newest!.Disposed}");drained.Newest.Dispose();
        using var ocrCts=new CancellationTokenSource();int ocrCalls=0;
        try { await OcrTiling.ReadAsync(new Rect(0,0,1920,1080),1300, r=>{ocrCalls++;ocrCts.Token.ThrowIfCancellationRequested();ocrCts.Cancel();return Task.FromResult<IReadOnlyList<OcrLine>>([]);}); }
        catch(OperationCanceledException) { Console.WriteLine($"OCR tile cancellation propagated; calls={ocrCalls}"); }
        var secretMarker="SYNTHETIC-SENSITIVE-MARKER";
        var reflects = UserMessages.For(new ArgumentException(secretMarker)).Contains(secretMarker);
        Check(!reflects, "framework ArgumentException category-only");
        Console.WriteLine("MESSAGE ArgumentException reflects marker="+reflects);
        Console.WriteLine("ASSERTIONS passed");
    }

    private static void Check(bool ok, string reason) { if (!ok) throw new InvalidOperationException("Probe assertion failed: " + reason); }

    private static string PayloadHash(string db,string id,string kind,string? path) {
        using var c=new Microsoft.Data.Sqlite.SqliteConnection("Data Source="+db); c.Open();
        using var q=c.CreateCommand(); q.CommandText="SELECT payload FROM outbox WHERE capture_id=$id AND kind=$kind AND path IS $path";
        q.Parameters.AddWithValue("$id",id); q.Parameters.AddWithValue("$kind",kind); q.Parameters.AddWithValue("$path",(object?)path??DBNull.Value);
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData((byte[])q.ExecuteScalar()!));
    }
    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(_dir, true);
    }
}

sealed class DisposableProbe : IDisposable { public bool Disposed; public void Dispose()=>Disposed=true; }
sealed class ProbeClock : IClock { public DateTimeOffset UtcNow { get; set; } = new(2026, 10, 4, 0, 0, 0, TimeSpan.Zero); }
sealed class NullLog : IShellLog { public void Info(string m) { } public void Warn(string m) { } public void Error(string m) { } }
sealed class NoOcr : IOcrEngine { public Task<IReadOnlyList<OcrLine>> ReadAsync(Frame f, Rect r, OcrMode m) => Task.FromResult<IReadOnlyList<OcrLine>>([]); }