using Xunit;
using Xunit.Abstractions;

namespace Uma.Agent.Core.Tests;

/// <summary>Review round 1: B1 (completeness gate before upload), B2 (sub-1080 refusal), S1, S2, S5, S7.
/// Frames are real fixture parses; every synthetic edit is named SYNTHETIC and described.</summary>
public class CompletenessTests(ITestOutputHelper output)
{
    private static FixtureEnv Env => FixtureEnv.Instance;
    private static readonly string[] McQueen = Collect.McQueen;

    private void Dump(CaptureResult r)
    {
        foreach (var s in r.Checklist) output.WriteLine($"{s.Section}: {(s.Complete ? "complete" : "INCOMPLETE")} — {s.Detail}");
        foreach (var b in r.Blockers) output.WriteLine("BLOCKER " + b);
    }

    private static string Db() => Collect.TempDb();

    // ---------- B1 ----------

    [Fact]
    public void B1_real_01_to_07_is_a_diagnostic_capture_that_the_outbox_refuses()
    {
        // 30 §10 acceptance: 01–07 (+ popups) assemble a valid VeteranCapture. Fixture 01 shows the top of the Skills
        // list only, so 30 §5 completeness is not met: the capture is diagnostic and not uploadable (Q-93).
        var (_, r) = Collect.Assemble(Collect.Real([.. McQueen, Collect.SpecialWeekPopup, Collect.OperaPopup]));
        Dump(r);
        Assert.NotNull(r.Capture);
        Assert.Empty(CaptureValidation.Validate(r.Capture!, Env.Master.Ids));
        Assert.False(r.Uploadable);
        Assert.Contains(r.Blockers, b => b.StartsWith("details.skills"));
        var db = Db();
        try
        {
            var outbox = new UploadOutbox(db, new TestClock());
            var e = Assert.Throws<IncompleteCaptureException>(() => outbox.EnqueueCapture(r));
            Assert.Contains("details.skills", e.Message);
            Assert.Empty(outbox.Snapshot());
        }
        finally { Collect.Drop(db); }
    }

    [Fact]
    public void B1_no_skills_frame_gives_no_capture()
    {
        var (_, r) = Collect.Assemble(Collect.Real([.. McQueen.Skip(1), Collect.SpecialWeekPopup, Collect.OperaPopup]));
        Dump(r);
        Assert.Null(r.Capture);
        Assert.Contains(r.Errors, e => e.Contains("Skills"));
        Assert.False(r.Uploadable);
    }

    [Fact]
    public void B1_partial_skills_list_is_not_uploadable_even_with_everything_else_complete()
    {
        var (_, r) = Collect.Assemble(Collect.Real([.. McQueen, Collect.SpecialWeekPopup, Collect.OperaPopup]));
        Assert.True(r.Checklist.Where(s => s.Section != "details.skills").All(s => s.Complete));
        Assert.False(r.Checklist.Single(s => s.Section == "details.skills").Complete);
        Assert.False(r.Uploadable);
    }

    [Fact]
    public void B1_missing_scroll_thumb_is_unknown_position_not_top_and_end()
    {
        Assert.False(Vision.AtTop(null, Env.Layout));
        Assert.False(Vision.AtEnd(null, Env.Layout));
        // SYNTHETIC: fixture 01 with its thumb removed (a detection failure). It must not count as a complete list.
        var noThumb = Env.Parsed(McQueen[0]) with { Thumb = null };
        var (c, r) = Collect.Assemble([noThumb, .. Collect.Real([.. McQueen.Skip(1), Collect.SpecialWeekPopup, Collect.OperaPopup])]);
        Dump(r);
        Assert.False(r.Checklist.Single(s => s.Section == "details.skills").Complete);
        Assert.Null(r.Capture);
        Assert.False(r.Uploadable);
        // A mid-list Inspiration frame without a thumb is held back, never merged as if it were the top.
        var (_, r2) = Collect.Assemble([Collect.SyntheticWholeSkillsList(), .. Collect.Real(McQueen[1], McQueen[3], McQueen[4], McQueen[5], McQueen[6]),
            Env.Parsed(McQueen[2]) with { Thumb = null }]);
        Dump(r2);
        Assert.False(r2.Checklist.Single(s => s.Section == "details.inspiration").Complete);
        Assert.False(r2.Uploadable);
    }

    [Fact]
    public void B1_unaligned_pending_frames_keep_the_section_incomplete()
    {
        // 02 + 04 without 03: 04 cannot be aligned, so the end it shows is not proof of coverage.
        var (c, r) = Collect.Assemble([Collect.SyntheticWholeSkillsList(), .. Collect.Real(McQueen[1], McQueen[3], McQueen[4], McQueen[5], McQueen[6], Collect.SpecialWeekPopup, Collect.OperaPopup)]);
        Dump(r);
        var insp = r.Checklist.Single(s => s.Section == "details.inspiration");
        Assert.False(insp.Complete);
        Assert.Contains("unaligned", insp.Detail);
        Assert.False(r.Uploadable);
    }

    [Fact]
    public void B1_genuinely_complete_collection_is_uploadable_and_enqueued()
    {
        var (_, r) = Collect.Assemble(Collect.Complete());
        Dump(r);
        Assert.True(r.Checklist.All(s => s.Complete));
        Assert.Empty(r.Blockers);
        Assert.True(r.Uploadable);
        var db = Db();
        try
        {
            var outbox = new UploadOutbox(db, new TestClock());
            Assert.Equal(EnqueueResult.Queued, outbox.EnqueueCapture(r));
            Assert.Contains(outbox.Snapshot(), s => s.Kind == "veteran");
        }
        finally { Collect.Drop(db); }
    }

    [Fact]
    public void B1_a_tampered_or_hand_built_result_is_refused()
    {
        var (_, r) = Collect.Assemble(Collect.Complete());
        var db = Db();
        try
        {
            var outbox = new UploadOutbox(db, new TestClock());
            // Same capture, but the checklist and seal were not produced by an assembler for this content.
            var changed = r with { Capture = r.Capture! with { Veteran = r.Capture.Veteran with { Rating = r.Capture.Veteran.Rating + 1 } } };
            Assert.Throws<IncompleteCaptureException>(() => outbox.EnqueueCapture(changed));
            var handBuilt = new CaptureResult(r.Capture, r.Crops, r.Checklist, []);
            Assert.Throws<IncompleteCaptureException>(() => outbox.EnqueueCapture(handBuilt));
            Assert.Empty(outbox.Snapshot());
        }
        finally { Collect.Drop(db); }
    }

    [Fact]
    public void B1_fully_scrolled_inspiration_with_an_unreadable_parent_block_is_uploadable_with_the_owner_flag()
    {
        // Contract-valid omission (01 §3): the tab was covered top to end, but parent2's block cannot be represented.
        // SYNTHETIC: one parent2 label in 04 (row 5, below the rows shared with 03) made unreadable.
        var frames = Collect.Complete();
        var i4 = frames.FindIndex(f => f.Frame == Env.Frame(McQueen[3]));
        frames[i4] = frames[i4] with { Sparks = frames[i4].Sparks.Select((s, i) => i == 5 ? s with { Spark = Reading.Missing(s.Spark.Crop) } : s).ToArray() };
        frames.RemoveAll(f => f.Frame == Env.Frame(Collect.OperaPopup));
        var (_, r) = Collect.Assemble(frames);
        Dump(r);
        Assert.Empty(r.Errors);
        Assert.True(r.Checklist.Single(s => s.Section == "details.inspiration").Complete);
        Assert.True(r.Uploadable);
        Assert.Equal(0, r.Capture!.Veteran.Sparks.Count(s => s.Owner == "parent2"));
        Assert.Contains(r.Capture.Fields, f => f.Path == "/sparks/parent2" && f.Status == FieldStatus.low_confidence);
    }

    [Fact]
    public void B1_an_end_frame_with_no_readable_label_cannot_prove_coverage()
    {
        // SYNTHETIC: every label in 04 unreadable. Rows are aligned by label, so 04 cannot be placed: the end is not
        // proven, the section stays incomplete and the result is not uploadable (the user re-scrolls), rather than
        // uploading a parent2 flag for a block that may have been partially seen.
        var frames = Collect.Complete();
        var i4 = frames.FindIndex(f => f.Frame == Env.Frame(McQueen[3]));
        frames[i4] = frames[i4] with { Sparks = frames[i4].Sparks.Select(s => s with { Spark = Reading.Missing(s.Spark.Crop) }).ToArray() };
        var (_, r) = Collect.Assemble(frames);
        Dump(r);
        Assert.False(r.Checklist.Single(s => s.Section == "details.inspiration").Complete);
        Assert.False(r.Uploadable);
    }

    // ---------- S1 / S2 ----------

    [Fact]
    public void S1_one_unreadable_parent_label_drops_that_block_with_the_owner_flag()
    {
        var frames = Collect.Complete();
        var i4 = frames.FindIndex(f => f.Frame == Env.Frame(McQueen[3]));
        frames[i4] = frames[i4] with { Sparks = frames[i4].Sparks.Select((s, i) => i == 5 ? s with { Spark = Reading.Missing(s.Spark.Crop) } : s).ToArray() };
        var (_, r) = Collect.Assemble(frames);
        Dump(r);
        Assert.Empty(r.Errors);
        Assert.NotNull(r.Capture);
        Assert.Equal(0, r.Capture!.Veteran.Sparks.Count(s => s.Owner == "parent2"));
        Assert.Equal(10, r.Capture.Veteran.Sparks.Count(s => s.Owner == "parent1"));
        Assert.Contains(r.Capture.Fields, f => f.Path == "/sparks/parent2" && f.Status == FieldStatus.low_confidence);
        Assert.DoesNotContain(r.Capture.Fields, f => f.Path.StartsWith("/sparks/") && f.Path.EndsWith("/sparkId") && f.Value is null);
        Assert.Empty(CaptureValidation.Validate(r.Capture, Env.Master.Ids));
    }

    [Fact]
    public void S1_an_unreadable_self_label_is_fatal()
    {
        var frames = Collect.Complete();
        var i2 = frames.FindIndex(f => f.Frame == Env.Frame(McQueen[1]));
        frames[i2] = frames[i2] with { Sparks = frames[i2].Sparks.Select((s, i) => i == 0 ? s with { Spark = Reading.Missing(s.Spark.Crop) } : s).ToArray() };
        var (_, r) = Collect.Assemble(frames);
        Assert.Null(r.Capture);
        Assert.Contains(r.Errors, e => e.Contains("self"));
    }

    [Fact]
    public void S2_uncertain_star_count_field_value_equals_the_payload_and_lists_candidates()
    {
        // SYNTHETIC: spark row 12 of 02 read as 0 stars.
        var frames = Collect.Complete();
        var i2 = frames.FindIndex(f => f.Frame == Env.Frame(McQueen[1]));
        frames[i2] = frames[i2] with { Sparks = frames[i2].Sparks.Select((s, i) => i == 12 ? s with { Stars = 0, StarsClear = true } : s).ToArray() };
        var (_, r) = Collect.Assemble(frames);
        var c = r.Capture!;
        var field = c.Fields.Single(f => f.Path == "/sparks/12/stars");
        Assert.Equal(FieldStatus.low_confidence, field.Status);
        Assert.Equal(c.Veteran.Sparks[12].Stars, Convert.ToInt32(field.Value));
        Assert.Equal([1, 2, 3], field.Candidates.Select(x => Convert.ToInt32(x.Value)).Order());
        Assert.Contains(r.Crops, x => x.Path == "/sparks/12/stars");
    }

    // ---------- S5 ----------

    /// <summary>SYNTHETIC second veteran: identical outfit, name and rating to McQueen but different confident stats.</summary>
    private static ParsedFrame Twin(ParsedFrame p)
        => p.Header is { } h ? p with { Header = h with { Stats = h.Stats.ToDictionary(kv => kv.Key, kv => kv.Key == "spd" ? kv.Value with { Value = 1200 } : kv.Value) } } : p;

    [Fact]
    public void S5_same_outfit_and_rating_with_different_stats_never_mix()
    {
        var c = new CaptureCoordinator(Env.Layout, Env.Master);
        c.Feed(Env.Parsed(McQueen[0])); c.Feed(Env.Parsed(McQueen[1]));
        var first = c.Current!;
        c.Feed(Env.Parsed("13-support-card-list"));             // back to a non-details screen
        c.Feed(Twin(Env.Parsed(McQueen[2])));
        Assert.NotSame(first, c.Current);
        Assert.Equal(2, c.Sessions.Count);
        Assert.Equal(1, first.Sparks.FramesMerged);               // only 02 merged into the first session
        Assert.DoesNotContain(c.Current!.Skills.Rows, _ => true);
    }

    [Fact]
    public void S5_noisy_header_joins_only_the_current_compatible_session()
    {
        static ParsedFrame Noisy(ParsedFrame p) => p.Header is { } h
            ? p with { Header = h with { Stats = h.Stats.ToDictionary(kv => kv.Key, kv => kv.Key == "spd" ? kv.Value with { Ok = false, Value = null } : kv.Value) } } : p;
        var c = new CaptureCoordinator(Env.Layout, Env.Master);
        c.Feed(Env.Parsed(McQueen[0]));
        var a = c.Current!;
        c.Feed(Twin(Env.Parsed(McQueen[1])));                    // different confident stats, current changes to the twin
        var twin = c.Current!;
        Assert.NotSame(a, twin);
        // A noisy frame (spd unreadable) right after the twin's frame continues the twin, not McQueen.
        Assert.Same(twin, c.Feed(Noisy(Env.Parsed(McQueen[2]))));
        // After leaving the details screen, a noisy frame is compatible with both and is ignored.
        c.Feed(Env.Parsed("13-support-card-list"));
        Assert.Null(c.Feed(Noisy(Env.Parsed(McQueen[3]))));
        Assert.Equal(1, c.AmbiguousIdentity);
        // Returning with a confident header resumes the right session.
        Assert.Same(a, c.Feed(Env.Parsed(McQueen[4])));
    }

    [Fact]
    public void S5_returning_to_a_veteran_resumes_its_session()
    {
        var c = new CaptureCoordinator(Env.Layout, Env.Master);
        c.Feed(Env.Parsed(McQueen[0]));
        var mcqueen = c.Current!;
        c.Feed(Env.Parsed("15-veteran-details-skills-manual"));
        Assert.NotSame(mcqueen, c.Current);
        Assert.Same(mcqueen, c.Feed(Env.Parsed(McQueen[1])));
    }

    // ---------- S7 ----------

    [Fact]
    public void S7_unresolved_parent_outfit_is_not_reported_as_confident()
    {
        var frames = Collect.Complete();
        frames.RemoveAll(f => f.Frame == Env.Frame(Collect.SpecialWeekPopup) || f.Frame == Env.Frame(Collect.OperaPopup));
        var (_, r) = Collect.Assemble(frames);
        var c = r.Capture!;
        Assert.All(c.Veteran.Parents, p => Assert.Null(p.OutfitId));
        foreach (var i in new[] { 0, 1 })
        {
            var f = c.Fields.Single(x => x.Path == $"/parents/{i}/outfitId");
            Assert.Equal(FieldStatus.low_confidence, f.Status);
            Assert.Equal(0, f.Confidence);
            Assert.Null(f.Value);
        }
        Assert.Empty(CaptureValidation.Validate(c, Env.Master.Ids));
        Assert.True(r.Uploadable);
        // With the popups, the resolved outfits are ok.
        var (_, resolved) = Collect.Assemble(Collect.Complete());
        Assert.All(new[] { 0, 1 }, i => Assert.Equal(FieldStatus.ok, resolved.Capture!.Fields.Single(x => x.Path == $"/parents/{i}/outfitId").Status));
    }

    // ---------- B2 ----------

    private static Frame Resized(string fixture, int w, int h)
        => Resampler.Resize(Env.Frame(fixture), w, h);

    [Theory]
    [InlineData(1280, 720)]
    [InlineData(1600, 900)]
    public async Task B2_sub_1080_16x9_frames_are_refused_before_any_reading(int w, int h)
    {
        // Bicubic downsampling of the real fixtures; this is not how the game renders at that size, only a probe that
        // the agent refuses instead of producing confident-wrong values (Q-94).
        foreach (var fixture in new[] { McQueen[0], McQueen[1], McQueen[4] })
        {
            var frame = Resized(fixture, w, h);
            var parser = new FrameParser(Env.Layout, Env.Master, Env.Templates, Env.Ocr(fixture));
            var e = await Assert.ThrowsAsync<UnsupportedResolutionException>(() => parser.ParseAsync(frame));
            Assert.Equal((w, h), (e.Width, e.Height));
            Assert.Contains("1920x1080", e.Message);
            await Assert.ThrowsAsync<UnsupportedResolutionException>(() => new ScreenClassifier(Env.Layout, Env.Ocr(fixture)).ClassifyAsync(frame));
        }
    }

    [Fact]
    public async Task B2_supported_sizes_still_work_and_other_aspects_are_still_rejected()
    {
        var big = Resized(McQueen[1], 2560, 1440);
        var p = await new FrameParser(Env.Layout, Env.Master, Env.Templates, Env.Ocr(McQueen[1])).ParseAsync(big);
        var native = Env.Parsed(McQueen[1]);
        Assert.Equal(native.Sparks.Select(s => $"{s.Spark.Value}|{s.Stars}|{s.Type}"), p.Sparks.Select(s => $"{s.Spark.Value}|{s.Stars}|{s.Type}"));
        Assert.Throws<UnsupportedAspectRatioException>(() => Frames.Normalize(new Frame(new byte[1920 * 1200 * 4], 1920, 1200)));
        Assert.Throws<UnsupportedAspectRatioException>(() => Frames.Normalize(new Frame(new byte[1280 * 800 * 4], 1280, 800)));
        Assert.IsAssignableFrom<UnsupportedFrameException>(new UnsupportedResolutionException(1280, 720));
        Assert.IsAssignableFrom<UnsupportedFrameException>(new UnsupportedAspectRatioException(1920, 1200));
    }
}

internal sealed class TestClock : IClock { public DateTimeOffset UtcNow { get; set; } = new(2026, 10, 3, 0, 0, 0, TimeSpan.Zero); }
