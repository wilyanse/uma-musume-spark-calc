using System.Reflection;
using System.Text;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Uma.Agent.Core.Tests;

/// <summary>Coordinator-required SF1–SF4. Resized screenshots and edited ParsedFrames are SYNTHETIC probes,
/// not evidence of game rendering or of actual end-of-list coverage.</summary>
public class ReviewRound2Tests
{
    private static FixtureEnv Env => FixtureEnv.Instance;

    [Fact]
    public void SF1_content_maps_have_no_public_mutator_and_session_add_preserves_evidence()
    {
        foreach (var type in new[] { typeof(ContentMap<SkillRow>), typeof(ContentMap<SparkRow>) })
        {
            Assert.Null(type.GetMethod("Add", BindingFlags.Public | BindingFlags.Instance));
            Assert.All(type.GetProperties(), p => Assert.False(p.SetMethod?.IsPublic ?? false));
        }
        var session = new CaptureSession(Env.Layout, Env.Master, "probe");
        session.Add(Env.Parsed(Collect.McQueen[0]));
        Assert.True(session.Skills.Anchored);
        Assert.False(session.Skills.EndSeen);
        Assert.False(session.IsComplete);
        // Explicit SYNTHETIC whole-track frame, fed only through the session API.
        session.Add(Collect.SyntheticWholeSkillsList());
        Assert.True(session.Skills.EndSeen);
    }

    [Fact]
    public void Seal_detects_in_place_mutable_list_and_crop_edits_except_cosmetic_detail()
    {
        var r = Collect.LowConfidence();
        Assert.True(r.Uploadable);
        var crops = Assert.IsType<List<(string Path, byte[] Png)>>(r.Crops);
        var checklist = Assert.IsType<List<SectionStatus>>(r.Checklist);
        var fields = Assert.IsType<List<CaptureField>>(r.Capture!.Fields);
        var crop = crops[0];
        crop.Png[20] ^= 0xff;
        Assert.False(r.Uploadable);
        crop.Png[20] ^= 0xff;
        crops.RemoveAt(0);
        Assert.False(r.Uploadable);
        crops.Insert(0, crop);
        var field = fields[0];
        fields[0] = field with { Value = "synthetic-edited" };
        Assert.False(r.Uploadable);
        fields[0] = field;
        var status = checklist[0];
        checklist[0] = status with { Complete = false };
        Assert.False(r.Uploadable);
        checklist[0] = status with { Section = "synthetic-edited" };
        Assert.False(r.Uploadable);
        checklist[0] = status with { Detail = "cosmetic-only" };
        Assert.True(r.Uploadable);
    }

    private static CaptureResult SyntheticDifferentPayload()
        => Collect.Assemble(Collect.Complete().Select(p => p.Header is not { } h ? p : p with
        {
            Header = h with { Stats = h.Stats.ToDictionary(kv => kv.Key,
                kv => kv.Key == "wit" ? kv.Value with { Value = (int)kv.Value.Value! + 1 } : kv.Value) }
        })).Result;

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void SF2_same_id_accepts_exact_duplicate_but_refuses_different_sealed_content(bool acknowledged)
    {
        var db = Collect.TempDb();
        try
        {
            var original = Collect.Assemble(Collect.Complete()).Result;
            var different = SyntheticDifferentPayload();
            Assert.True(original.Uploadable); Assert.True(different.Uploadable);
            Assert.Equal(original.Capture!.CaptureId, different.Capture!.CaptureId);
            Assert.NotEqual(original.Capture.Fingerprint, different.Capture.Fingerprint);
            var outbox = new UploadOutbox(db, new TestClock());
            Assert.Equal(EnqueueResult.Queued, outbox.EnqueueCapture(original));
            if (acknowledged) outbox.CompleteVeteran(outbox.Next()!, "01K7B33MXGVZV6TZRJZDHB99YF");
            var expected = acknowledged ? EnqueueResult.AlreadyUploaded : EnqueueResult.AlreadyQueued;
            Assert.Equal(expected, outbox.EnqueueCapture(Collect.Assemble(Collect.Complete()).Result));
            var before = outbox.Snapshot().ToArray();
            Assert.Throws<InvalidDataException>(() => outbox.EnqueueCapture(different));
            Assert.Equal(before, outbox.Snapshot());
            Assert.Equal(expected, new UploadOutbox(db, new TestClock()).EnqueueCapture(original));
        }
        finally { Collect.Drop(db); }
    }

    public static IEnumerable<object[]> RawPrimitiveCases()
    {
        // Every public FrameParser entry taking a frame except ParseAsync, including the static HashMatch.
        foreach (var method in typeof(FrameParser).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static)
                     .Where(m => m.Name != nameof(FrameParser.ParseAsync) && m.GetParameters().Any(p => p.ParameterType == typeof(Frame))))
            foreach (var (w, h) in new[] { (1280, 720), (1600, 900), (2560, 1440) })
                yield return [method.Name, w, h];
    }

    private sealed class CountingOcr : IOcrEngine
    {
        public int Calls;
        public Task<IReadOnlyList<OcrLine>> ReadAsync(Frame frame, Rect roi, OcrMode mode)
        { Calls++; return Task.FromResult<IReadOnlyList<OcrLine>>([]); }
    }

    private static object?[] PrimitiveArguments(string method, Frame f) => method switch
    {
        nameof(FrameParser.SparksAsync) => [f, "details.inspiration", true, null, false],
        nameof(FrameParser.HashMatch) => [f, new Rect(300, 728, 104, 104), Env.Master.CharacterIconHashes, Env.Layout.CharIconCrop, 2, 10, 4],
        _ => [f]
    };

    [Theory]
    [MemberData(nameof(RawPrimitiveCases))]
    public async Task SF3_every_public_frame_parser_primitive_refuses_raw_non_reference_input(string method, int w, int h)
    {
        var f = Resampler.Resize(Env.Frame("05-veteran-details-career-info-deck-legacy"), w, h);
        var ocr = new CountingOcr();
        var parser = new FrameParser(Env.Layout, Env.Master, Env.Templates, ocr);
        var info = typeof(FrameParser).GetMethod(method)!;
        var error = await Record.ExceptionAsync(async () =>
        {
            try
            {
                if (info.Invoke(parser, PrimitiveArguments(method, f)) is Task task) await task;
            }
            catch (TargetInvocationException ex) when (ex.InnerException is not null) { throw ex.InnerException; }
        });
        var typed = Assert.IsAssignableFrom<UnsupportedFrameException>(error);
        Assert.Equal(w, typed.Width); Assert.Equal(h, typed.Height);
        Assert.Contains("ParseAsync", typed.Message);
        Assert.Equal(0, ocr.Calls);
    }

    [Theory]
    [InlineData(1280, 720)]
    [InlineData(1600, 900)]
    [InlineData(2560, 1440)]
    public void SF3_classifier_tab_primitive_refuses_non_reference_input(int w, int h)
    {
        var error = Record.Exception(() => new ScreenClassifier(Env.Layout, new CountingOcr()).ActiveTabs(new Frame(new byte[w * h * 4], w, h)));
        Assert.IsAssignableFrom<UnsupportedFrameException>(error);
    }

    [Fact]
    public async Task SF3_native_primitives_and_ParseAsync_upscale_keep_T11_card_values()
    {
        foreach (var name in new[] { "05-veteran-details-career-info-deck-legacy", "13-support-card-list", "14-support-card-detail" })
        {
            var parser = new FrameParser(Env.Layout, Env.Master, Env.Templates, Env.Ocr(name));
            var native = await parser.ParseAsync(Env.Frame(name));
            if (native.Deck.Count > 0)
            {
                var direct = await parser.DeckAsync(native.Frame);
                Assert.Equal(native.Deck.Select(t => (t.Card.Value, t.Lb.Value, t.Level.Value, t.Borrowed.Value)), direct.Select(t => (t.Card.Value, t.Lb.Value, t.Level.Value, t.Borrowed.Value)));
                Assert.All(direct, t => { Assert.Equal(4, t.Lb.Value); Assert.True(t.Lb.Ok); });
            }
            if (native.HeldCount is not null) Assert.Equal(native.HeldCount.Value, (await parser.HeldAsync(native.Frame)).Value);
            if (native.DetailCard is not null) Assert.Equal(native.DetailCard.Value, (await parser.DetailAsync(native.Frame)).Card.Value);
            var big = await parser.ParseAsync(Resampler.Resize(native.Frame, 2560, 1440));
            Assert.Equal((1920, 1080), (big.Frame.Width, big.Frame.Height));
            Assert.Equal(native.Screen.Id, big.Screen.Id);
            Assert.Equal(native.Deck.Select(t => (t.Card.Value, t.Lb.Value, t.Borrowed.Value)), big.Deck.Select(t => (t.Card.Value, t.Lb.Value, t.Borrowed.Value)));
            Assert.Equal(native.ListTiles.Select(t => (t.Card.Value, t.Lb.Value)), big.ListTiles.Select(t => (t.Card.Value, t.Lb.Value)));
            if (native.HeldCount is not null)
            {
                Assert.Equal(native.HeldCount.Value, big.HeldCount!.Value);
                var direct = await parser.ListTilesAsync(big.Frame);
                Assert.Equal(native.ListTiles.Select(t => (t.Card.Value, t.Lb.Value)), direct.Select(t => (t.Card.Value, t.Lb.Value)));
                Assert.All(direct, t => Assert.True(t.Lb.Ok));
            }
            if (native.DetailCard is not null) Assert.Equal(native.DetailCard.Value, big.DetailCard!.Value);
        }
    }

    [Fact]
    public void SF4_legacy_pending_payload_is_refused_without_new_crops_or_row_changes()
    {
        var db = Collect.TempDb();
        try
        {
            var old = Collect.Assemble(Collect.Complete()).Result;
            var different = Collect.LowConfidence();
            Assert.True(old.Uploadable); Assert.True(different.Uploadable); Assert.NotEmpty(different.Crops);
            using (var c = new SqliteConnection($"Data Source={db}"))
            {
                c.Open(); using var q = c.CreateCommand();
                q.CommandText = """
                    CREATE TABLE outbox (id INTEGER PRIMARY KEY, capture_id TEXT NOT NULL, kind TEXT NOT NULL, path TEXT, payload BLOB NOT NULL,
                        attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, last_error TEXT, dead INTEGER NOT NULL DEFAULT 0);
                    CREATE TABLE crop_results (capture_id TEXT NOT NULL, path TEXT NOT NULL, crop_key TEXT NOT NULL, PRIMARY KEY(capture_id,path));
                    INSERT INTO outbox(capture_id,kind,path,payload,attempts,next_attempt_at,last_error)
                        VALUES ($id,'veteran',NULL,$payload,3,'2026-10-03T00:00:00.0000000+00:00','HTTP 503');
                    """;
                q.Parameters.AddWithValue("$id", old.Capture!.CaptureId);
                q.Parameters.AddWithValue("$payload", Encoding.UTF8.GetBytes(CaptureJson.Serialize(old.Capture)));
                q.ExecuteNonQuery();
            }
            var outbox = new UploadOutbox(db, new TestClock());
            var before = outbox.Snapshot().ToArray();
            var payloadBefore = outbox.Next()!.Payload;
            foreach (var result in new[] { different, old })
            {
                Assert.Throws<InvalidDataException>(() => outbox.EnqueueCapture(result));
                Assert.Equal(before, outbox.Snapshot());
                Assert.Equal(payloadBefore, outbox.Next()!.Payload);
            }
            using (var c = new SqliteConnection($"Data Source={db}"))
            {
                c.Open(); using var q = c.CreateCommand();
                q.CommandText = "SELECT COUNT(*) FROM captures";
                Assert.Equal(0L, q.ExecuteScalar());
                q.CommandText = "SELECT COUNT(*) FROM crop_results";
                Assert.Equal(0L, q.ExecuteScalar());
            }
            // Explicit operator-directed recovery, not automatic overwrite: backup first; mark the legacy item dead,
            // then discard its entire group. Only after removal can a new complete capture be queued.
            var pending = outbox.Next()!;
            outbox.Dead(pending, "legacy-discard");
            Assert.Equal(1, outbox.Discard(pending.Id));
            Assert.Equal(EnqueueResult.Queued, outbox.EnqueueCapture(different));
            Assert.Equal(different.Crops.Count + 1, outbox.Snapshot().Count);
        }
        finally { Collect.Drop(db); }
    }
}
