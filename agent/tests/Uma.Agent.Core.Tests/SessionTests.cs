using System.Text.Json;
using Xunit;
using Xunit.Abstractions;

namespace Uma.Agent.Core.Tests;

/// <summary>30 §5 / §10: CaptureSession + assembler on the real fixtures, including sparse and ambiguous paths.
/// Expected values are built from the label files (screenshot-grounded), never from parser output.</summary>
public class SessionTests(ITestOutputHelper output)
{
    private static FixtureEnv Env => FixtureEnv.Instance;
    private const string CaptureId = "01K7B33MXGVZV6TZRJZDHB99YE";
    private static readonly DateTimeOffset At = new(2026, 10, 3, 0, 0, 0, TimeSpan.Zero);
    private static readonly string[] McQueen = ["01-veteran-details-skills-independent", "02-veteran-details-inspiration-p1", "03-veteran-details-inspiration-p2",
        "04-veteran-details-inspiration-p3", "05-veteran-details-career-info-deck-legacy", "06-veteran-details-career-info-record", "07-veteran-details-career-info-races"];
    private const string SpecialWeekPopup = "09-sparks-popup-special-week-parent", OperaPopup = "10-sparks-popup-guest-parent";

    private static (CaptureCoordinator Coordinator, CaptureResult Result) Run(params string[] fixtures)
    {
        var c = new CaptureCoordinator(Env.Layout, Env.Master);
        foreach (var f in fixtures) c.Feed(Env.Parsed(f));
        var session = c.Sessions.Single(s => s.IdentityKey.Contains("outfit:frontline-elegance"));
        return (c, session.Assemble(CaptureId, At, "test"));
    }

    private void Dump(CaptureResult r)
    {
        foreach (var s in r.Checklist) output.WriteLine($"{s.Section}: {(s.Complete ? "complete" : "INCOMPLETE")} — {s.Detail}");
        foreach (var e in r.Errors) output.WriteLine("ERROR " + e);
    }

    /// <summary>The McQueen veteran as visible in the label files of fixtures 01–07, 09, 10.</summary>
    private static (List<Spark> Sparks, string P1, string P2, string P1Outfit, string P2Outfit, List<Skill> Skills) Expected()
    {
        var sparks = new List<Spark>();
        void Add(string fixture, Func<JsonElement, bool> keep)
        {
            using var d = JsonDocument.Parse(Env.Label(fixture).ToJsonString());
            foreach (var s in d.RootElement.GetProperty("sparks").EnumerateArray().Where(keep))
            {
                var owner = s.GetProperty("owner").GetString()!;
                var id = Env.IdOf("spark", s.GetProperty("name").GetString()!);
                if (sparks.Any(x => x.Owner == owner && x.SparkId == id)) continue;
                sparks.Add(new Spark(owner, id, s.GetProperty("type").GetString()!, s.GetProperty("stars").GetInt32()));
            }
        }
        Add(McQueen[1], _ => true); Add(McQueen[2], _ => true); Add(McQueen[3], _ => true);
        using var l1 = JsonDocument.Parse(Env.Label(McQueen[0]).ToJsonString());
        var skills = l1.RootElement.GetProperty("skills").EnumerateArray().Select(s => new Skill(Env.IdOf("skill", s.GetProperty("name").GetString()!),
            s.GetProperty("level").ValueKind == JsonValueKind.Null ? null : s.GetProperty("level").GetInt32())).ToList();
        return (sparks, Env.IdOf("character", "Special Week"), Env.IdOf("character", "T.M. Opera O"),
            Env.OutfitOf("Special Week", "Special Dreamer"), Env.OutfitOf("T.M. Opera O", "New Year, Same Radiance!"), skills);
    }

    [Fact]
    public void Fixtures_01_to_07_with_parent_popups_assemble_the_McQueen_capture()
    {
        var (_, r) = Run([.. McQueen, SpecialWeekPopup, OperaPopup]);
        Dump(r);
        Assert.Empty(r.Errors);
        var c = r.Capture!;
        var v = c.Veteran;
        var exp = Expected();
        Assert.Equal("character:mejiro-mcqueen", v.CharacterId);
        Assert.Equal(Env.OutfitOf("Mejiro McQueen", "Frontline Elegance"), v.OutfitId);
        Assert.Equal(("A+", 13471, "Independent Learner", TrainMode.independent), (v.Rank, v.Rating, v.Epithet, v.TrainMode));
        Assert.Equal(new Stats(894, 938, 740, 559, 635), v.Stats);
        Assert.Equal("A,E,G,D,A,S,B,A,D,F", string.Join(",", new[] { "turf", "dirt", "sprint", "mile", "medium", "long", "front", "pace", "late", "end" }.Select(k => v.Aptitudes.Values[k])));
        Assert.Equal(exp.Skills, v.Skills);
        // 3 spark blocks: 10 self + 10 parent1 + 15 parent2, in screen order.
        Assert.Equal(exp.Sparks, v.Sparks);
        Assert.Equal([10, 10, 15], new[] { "self", "parent1", "parent2" }.Select(o => v.Sparks.Count(s => s.Owner == o)));
        Assert.Equal(6, v.Deck.Count);
        Assert.Equal([1, 2, 3, 4, 5, 6], v.Deck.Select(d => d.Slot));
        Assert.All(v.Deck, d => Assert.Equal((4, 50), (d.Lb, d.Level)));
        Assert.Equal([false, false, false, false, false, true], v.Deck.Select(d => d.Borrowed));
        Assert.Equal(new Parent(1, exp.P1, exp.P1Outfit, false, null), v.Parents[0]);
        Assert.Equal(new Parent(2, exp.P2, exp.P2Outfit, true, "Yuuki"), v.Parents[1]);
        Assert.Equal("scenario:ura-finale", v.ScenarioId);
        Assert.Equal(new Career(22, 22, 649560, "2026-09-29"), v.Career);

        // Deck identity is art-only: every accepted card must agree with the visible type icon (label) and be SSR.
        using var deckLabel = JsonDocument.Parse(Env.Label(McQueen[4]).ToJsonString());
        var types = deckLabel.RootElement.GetProperty("deck").EnumerateArray().Select(d => d.GetProperty("type").GetString()).ToArray();
        Assert.Equal(types, v.Deck.Select(d => FixtureComparer.CardInfo(Env, d.CardId)!.Value.Type));
        Assert.All(v.Deck, d => Assert.Equal("SSR", FixtureComparer.CardInfo(Env, d.CardId)!.Value.Rarity));

        // Fingerprint: equals the hash of the label-built veteran (fields independent of OCR), and the payload passes
        // the shared schema, CAPTURE_RULES and master-ID validation.
        var expected = v with { Sparks = exp.Sparks, Skills = exp.Skills };
        Assert.Equal(Fingerprint.Hash(expected), c.Fingerprint);
        Assert.Matches("^[0-9a-f]{64}$", c.Fingerprint);
        Assert.Empty(CaptureValidation.Validate(c, Env.Master.Ids));
        Assert.Empty(CaptureSchema.Validate(CaptureJson.Serialize(c)));
        Assert.Equal(Env.Master.Version, c.MasterVersion);
        Assert.Equal(Env.Layout.Version, c.LayoutVersion);
        Assert.DoesNotContain(c.Fields, f => f.Path.StartsWith("/sparks/parent"));
        File.WriteAllText(Path.Combine(AppContext.BaseDirectory, "mcqueen-capture.json"), CaptureJson.Serialize(c));
        output.WriteLine($"fingerprint {c.Fingerprint}; fields {c.Fields.Count}, low_confidence {c.Fields.Count(f => f.Status == FieldStatus.low_confidence)}, crops {r.Crops.Count}");
        // Every low_confidence field has a crop, and every crop belongs to such a field.
        Assert.Equal(c.Fields.Where(f => f.Status == FieldStatus.low_confidence && !f.Path.StartsWith("/sparks/parent")).Select(f => f.Path).Order(), r.Crops.Select(x => x.Path).Order());
        Assert.All(r.Crops, x => Assert.True(x.Png.Length <= 60 * 1024 && x.Png[0] == 0x89));
    }

    [Fact]
    public void Checklist_reports_skills_not_scrolled_to_end_but_other_sections_complete()
    {
        var (_, r) = Run([.. McQueen, SpecialWeekPopup, OperaPopup]);
        var list = r.Checklist.ToDictionary(s => s.Section);
        Assert.False(list["details.skills"].Complete);     // fixture 01 shows the top only (more skills below)
        Assert.True(list["details.inspiration"].Complete);
        Assert.True(list["details.career.deck"].Complete);
        Assert.True(list["details.career.parents"].Complete);
        Assert.True(list["details.career.block"].Complete);
    }

    [Fact]
    public void Feeding_frames_twice_and_out_of_order_deduplicates()
    {
        var (_, once) = Run([.. McQueen, SpecialWeekPopup, OperaPopup]);
        var shuffled = new[] { McQueen[3], McQueen[2], SpecialWeekPopup, McQueen[5], McQueen[0], McQueen[1], McQueen[2], McQueen[4], McQueen[6], McQueen[3], OperaPopup, McQueen[1] };
        var (_, twice) = Run(shuffled);
        Assert.Empty(twice.Errors);
        Assert.Equal(once.Capture!.Fingerprint, twice.Capture!.Fingerprint);
        Assert.Equal(once.Capture.Veteran.Sparks, twice.Capture.Veteran.Sparks);
        Assert.Equal(once.Capture.Veteran.Skills, twice.Capture.Veteran.Skills);
    }

    [Fact]
    public void Header_change_mid_session_starts_a_new_session_and_returning_resumes()
    {
        var c = new CaptureCoordinator(Env.Layout, Env.Master);
        c.Feed(Env.Parsed(McQueen[0])); c.Feed(Env.Parsed(McQueen[1]));
        var mcqueen = c.Current!;
        c.Feed(Env.Parsed("15-veteran-details-skills-manual"));
        Assert.NotSame(mcqueen, c.Current);
        Assert.Equal(2, c.Sessions.Count);
        Assert.Contains("outfit:beyond-the-horizon", c.Current!.IdentityKey);
        // The Teio frame must not leak into McQueen's skills.
        Assert.Equal(14, mcqueen.Skills.Rows.Count);
        foreach (var f in McQueen.Skip(2).Append(SpecialWeekPopup).Append(OperaPopup)) c.Feed(Env.Parsed(f));
        Assert.Same(mcqueen, c.Current);
        var r = mcqueen.Assemble(CaptureId, At, "test");
        Assert.Empty(r.Errors);
        Assert.Equal("character:mejiro-mcqueen", r.Capture!.Veteran.CharacterId);
        // Teio session alone has no inspiration/career: it cannot produce a capture.
        var teio = c.Sessions.Single(s => s != mcqueen).Assemble(CaptureId, At, "test");
        Assert.Null(teio.Capture);
        Assert.Contains(teio.Errors, e => e.Contains("self sparks"));
        // Card screens and unknown frames are ignored.
        Assert.Null(c.Feed(Env.Parsed("13-support-card-list")));
        Assert.Equal(1, c.Ignored);
    }

    [Fact]
    public void Missing_parent2_block_is_flagged_low_confidence_not_invented()
    {
        // Inspiration never scrolled to the end: parent2's block is partial.
        var (_, r) = Run(McQueen[0], McQueen[1], McQueen[2], McQueen[4], McQueen[5], SpecialWeekPopup, OperaPopup);
        Dump(r);
        Assert.Empty(r.Errors);
        var c = r.Capture!;
        Assert.Equal(10, c.Veteran.Sparks.Count(s => s.Owner == "parent1"));
        Assert.Contains(c.Fields, f => f.Path == "/sparks/parent2" && f.Status == FieldStatus.low_confidence);
        Assert.DoesNotContain(c.Fields, f => f.Path == "/sparks/parent1");
        Assert.Empty(CaptureValidation.Validate(c, Env.Master.Ids));
        Assert.False(r.Checklist.Single(s => s.Section == "details.inspiration").Complete);
    }

    [Fact]
    public void A_frame_that_cannot_be_aligned_is_not_bridged()
    {
        // 04 (parent2 only) without 03 shares no rows with 02: it is held back, parents 1/2 are partial and flagged.
        var c = new CaptureCoordinator(Env.Layout, Env.Master);
        foreach (var f in new[] { McQueen[0], McQueen[1], McQueen[3], McQueen[4], McQueen[5] }) c.Feed(Env.Parsed(f));
        var s = c.Current!;
        Assert.Equal(1, s.Sparks.FramesRejected);
        var r = s.Assemble(CaptureId, At, "test");
        Assert.Empty(r.Errors);
        Assert.Equal(0, r.Capture!.Veteran.Sparks.Count(x => x.Owner == "parent2"));
        Assert.Contains(r.Capture.Fields, f => f.Path == "/sparks/parent1" && f.Status == FieldStatus.low_confidence);
        Assert.Contains(r.Capture.Fields, f => f.Path == "/sparks/parent2" && f.Status == FieldStatus.low_confidence);
        // Feeding the missing middle frame later aligns the held-back frame.
        c.Feed(Env.Parsed(McQueen[2]));
        Assert.Equal(0, s.Sparks.FramesRejected);
        Assert.Equal(15, s.Assemble(CaptureId, At, "test").Capture!.Veteran.Sparks.Count(x => x.Owner == "parent2"));
    }

    [Fact]
    public void Without_popups_parent_outfit_is_null_and_guest_trainer_needs_review()
    {
        var (_, r) = Run(McQueen);
        Assert.Empty(r.Errors);
        var p = r.Capture!.Veteran.Parents;
        Assert.Equal(("character:special-week", (string?)null, false), (p[0].CharacterId, p[0].OutfitId, p[0].IsGuest));
        Assert.Equal(("character:tm-opera-o", (string?)null, true, (string?)null), (p[1].CharacterId, p[1].OutfitId, p[1].IsGuest, p[1].GuestTrainer));
        Assert.Contains(r.Capture.Fields, f => f.Path == "/parents/1/guestTrainer" && f.Status == FieldStatus.low_confidence);
        Assert.Empty(CaptureValidation.Validate(r.Capture, Env.Master.Ids));
    }

    [Fact]
    public void A_popup_of_an_unrelated_veteran_does_not_resolve_a_parent()
    {
        var (_, r) = Run([.. McQueen, "08-sparks-popup-oguri-cap", "11-sparks-popup-gold-city"]);
        Assert.Empty(r.Errors);
        Assert.All(r.Capture!.Veteran.Parents, p => Assert.Null(p.OutfitId));
        Assert.DoesNotContain(r.Capture.Veteran.Parents, p => p.CharacterId is "character:oguri-cap" or "character:gold-city");
    }

    [Fact]
    public void Missing_required_sections_produce_no_capture()
    {
        Assert.Contains(Run(McQueen[0], McQueen[4], McQueen[5]).Result.Errors, e => e.Contains("self sparks"));
        Assert.Contains(Run(McQueen[0], McQueen[1], McQueen[5]).Result.Errors, e => e.Contains("Career Info top"));
        Assert.Contains(Run(McQueen[0], McQueen[1], McQueen[4]).Result.Errors, e => e.Contains("/scenarioId"));
        Assert.Null(Run(McQueen[1], McQueen[4]).Result.Capture);
    }

    [Fact]
    public void Ambiguous_low_confidence_reading_is_emitted_with_candidates_and_a_crop()
    {
        var c = new CaptureCoordinator(Env.Layout, Env.Master);
        foreach (var f in McQueen.Append(SpecialWeekPopup).Append(OperaPopup))
        {
            var p = Env.Parsed(f);
            if (p.Header is { } h)
            {
                // Simulate an unreadable stat and an uncertain grade in every header frame (a confident reading in any
                // frame would legitimately win the per-field vote).
                var stats = h.Stats.ToDictionary(kv => kv.Key, kv => kv.Key == "pow" ? kv.Value with { Ok = false, Confidence = 0.4 } : kv.Value);
                var apt = h.Aptitudes.ToDictionary(kv => kv.Key, kv => kv.Key == "late" ? kv.Value with { Ok = false } : kv.Value);
                p = p with { Header = h with { Stats = stats, Aptitudes = apt } };
            }
            c.Feed(p);
        }
        var r = c.Current!.Assemble(CaptureId, At, "test");
        Assert.Empty(r.Errors);
        var pow = r.Capture!.Fields.Single(f => f.Path == "/stats/pow");
        Assert.Equal(FieldStatus.low_confidence, pow.Status);
        var late = r.Capture.Fields.Single(f => f.Path == "/aptitudes/late");
        Assert.Equal(FieldStatus.low_confidence, late.Status);
        Assert.InRange(late.Candidates.Count, 2, 3);
        Assert.Contains(r.Crops, x => x.Path == "/stats/pow");
        Assert.Contains(r.Crops, x => x.Path == "/aptitudes/late");
        Assert.Empty(CaptureValidation.Validate(r.Capture, Env.Master.Ids));
    }
}
