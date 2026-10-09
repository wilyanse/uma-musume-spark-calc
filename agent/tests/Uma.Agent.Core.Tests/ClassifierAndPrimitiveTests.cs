using Xunit;

namespace Uma.Agent.Core.Tests;

/// <summary>Classifier, layout scaling, template discrimination and identity-uncertainty tests on real screenshots.</summary>
public class ClassifierAndPrimitiveTests
{
    private static FixtureEnv Env => FixtureEnv.Instance;

    private sealed class NoOcr : IOcrEngine
    {
        public Task<IReadOnlyList<OcrLine>> ReadAsync(Frame frame, Rect roi, OcrMode mode) => Task.FromResult<IReadOnlyList<OcrLine>>([]);
    }
    private sealed class FixedOcr(string text) : IOcrEngine
    {
        public Task<IReadOnlyList<OcrLine>> ReadAsync(Frame frame, Rect roi, OcrMode mode) => Task.FromResult<IReadOnlyList<OcrLine>>([new OcrLine(text, 1, roi)]);
    }

    [Fact]
    public async Task Anchor_alone_is_not_enough_title_OCR_must_agree()
    {
        // Sparks and Featured Cards share a similar title bar (anchor distance 4): without OCR nothing is classified.
        var frame = Env.Frame("08-sparks-popup-oguri-cap");
        Assert.Equal(ScreenId.Unknown, (await new ScreenClassifier(Env.Layout, new NoOcr()).ClassifyAsync(frame)).Id);
        Assert.Equal(ScreenId.CardsDetail, (await new ScreenClassifier(Env.Layout, new FixedOcr("Featured Cards")).ClassifyAsync(Env.Frame("14-support-card-detail"))).Id);
        // A wrong title over the right anchor is rejected rather than trusted.
        Assert.Equal(ScreenId.Unknown, (await new ScreenClassifier(Env.Layout, new FixedOcr("Umamusume Details")).ClassifyAsync(frame)).Id);
    }

    [Fact]
    public async Task Non_game_frame_is_unknown_and_ignored()
    {
        var blank = new Frame(Enumerable.Repeat((byte)128, 1920 * 1080 * 4).ToArray(), 1920, 1080);
        var c = await new ScreenClassifier(Env.Layout, new FixedOcr("Umamusume Details")).ClassifyAsync(blank);
        Assert.Equal(ScreenId.Unknown, c.Id);
        var coordinator = new CaptureCoordinator(Env.Layout, Env.Master);
        Assert.Null(coordinator.Feed(new ParsedFrame(c, blank, null)));
    }

    [Fact]
    public void Exactly_one_tab_is_active_on_every_details_fixture()
    {
        var classifier = new ScreenClassifier(Env.Layout, new NoOcr());
        foreach (var (name, tab) in new[] { ("01", "details.skills"), ("02", "details.inspiration"), ("03", "details.inspiration"), ("04", "details.inspiration"),
                     ("05", "details.career"), ("06", "details.career"), ("07", "details.career"), ("15", "details.skills") })
            Assert.Equal([tab], classifier.ActiveTabs(Env.Frame(Env.Names.Single(n => n.StartsWith(name)))));
        // Popups and card screens have no active details tab.
        Assert.Empty(classifier.ActiveTabs(Env.Frame("08-sparks-popup-oguri-cap")));
    }

    [Fact]
    public async Task Other_16x9_sizes_are_scaled_and_other_aspects_rejected()
    {
        var full = Env.Frame("15-veteran-details-skills-manual");
        var big = Resampler.Resize(full, 2560, 1440);
        var parsed = await new FrameParser(Env.Layout, Env.Master, Env.Templates, Env.Ocr("15-veteran-details-skills-manual")).ParseAsync(big);
        Assert.Equal(ScreenId.DetailsSkills, parsed.Screen.Id);
        Assert.Equal(1557, parsed.Header!.Stats["spd"].Value);
        Assert.Equal("S", parsed.Header.Aptitudes["medium"].Value);
        Assert.True(parsed.Header.Aptitudes.Values.All(a => a.Ok));
        Assert.Throws<UnsupportedAspectRatioException>(() => Frames.Normalize(new Frame(new byte[1600 * 1200 * 4], 1600, 1200)));
        await Assert.ThrowsAsync<UnsupportedAspectRatioException>(() => new ScreenClassifier(Env.Layout, new NoOcr()).ClassifyAsync(new Frame(new byte[1920 * 1200 * 4], 1920, 1200)));
        Assert.Equal(new Rect(640, 360, 1280, 720), LayoutProfiles.Scale(new Rect(960, 540, 1920, 1080), 1280, 720));
    }

    [Fact]
    public void Grade_templates_discriminate_all_eight_grades_on_cells_they_were_not_cut_from()
    {
        var grade = Env.Templates["grade"];
        Assert.Equal("ABCDEFGS".Select(c => c.ToString()), grade.Templates.Select(t => t.Label).Order());
        var cells = Env.Layout.At("header", "aptitudeCells");
        var used = grade.Templates.Select(t => (t.SourceFixture, t.SourceRoi)).ToHashSet();
        var heldOut = 0;
        foreach (var fixture in new[] { "01-veteran-details-skills-independent", "15-veteran-details-skills-manual", "02-veteran-details-inspiration-p1", "05-veteran-details-career-info-deck-legacy" })
        {
            var frame = Env.Frame(fixture);
            foreach (var cell in cells.EnumerateObject())
            {
                var roi = LayoutProfile.R(cell.Value);
                var m = grade.Match(frame, roi);
                Assert.True(m.Accepted, $"{fixture} {cell.Name}: distance {m.Distance:0.000} margin {m.Margin:0.000}");
                if (!used.Contains((fixture, roi))) heldOut++;
            }
        }
        Assert.True(heldOut >= 30, $"held-out cells {heldOut}");
    }

    [Fact]
    public void Rank_templates_accept_the_known_badges_and_withhold_an_unseen_one()
    {
        var rank = Env.Templates["rank"];
        var roi = Env.Layout.Rect("header", "rank");
        Assert.Equal("A+", rank.Match(Env.Frame("06-veteran-details-career-info-record"), roi).Label);
        Assert.Equal("UG3", rank.Match(Env.Frame("15-veteran-details-skills-manual"), roi).Label);
        // A badge that is not in the template set (here: a non-badge area of the same size) must not be labelled.
        var other = rank.Match(Env.Frame("15-veteran-details-skills-manual"), roi with { X = 600, Y = 600 });
        Assert.False(other.Accepted);
        Assert.Null(other.Label);
    }

    [Fact]
    public void Parent_and_deck_identity_survive_jitter_but_ambiguity_stays_uncertain()
    {
        var f = Env.Frame("05-veteran-details-career-info-deck-legacy");
        var crop = Env.Layout.CharIconCrop;
        var p1 = FrameParser.HashMatch(f, new Rect(300, 728, 104, 104), Env.Master.CharacterIconHashes, crop, 2, 10, 4);
        Assert.True(p1.Ok); Assert.Equal("character:special-week", p1.Value);
        // A portrait-sized box on the grandparent area is not confidently anyone.
        var gp = FrameParser.HashMatch(f, new Rect(448, 668, 104, 104), Env.Master.CharacterIconHashes, crop, 2, 10, 4);
        Assert.False(gp.Ok);
        Assert.Equal(3, gp.Candidates.Count);
        // A two-way tie never produces an accepted identity.
        var tie = FrameParser.HashMatch(f, new Rect(300, 728, 104, 104), new Dictionary<string, IReadOnlyList<string>> { ["a"] = Env.Master.CharacterIconHashes["character:special-week"], ["b"] = Env.Master.CharacterIconHashes["character:special-week"] }, crop, 2, 10, 4);
        Assert.False(tie.Ok);
    }

    [Fact]
    public void Card_list_primitives_match_the_T11_acceptance_LB_list()
    {
        var p = Env.Parsed("13-support-card-list");
        Assert.Equal(ScreenId.CardsList, p.Screen.Id);
        Assert.Equal(208, p.HeldCount!.Value);
        Assert.Equal([2, 4, 4, 4, 4, 0, 0, 1, 0, 4, 0, 4, 0, 4, 4, 0, 0, 4, 4, 0], p.ListTiles.Select(t => (int)t.Lb.Value!));
        Assert.Equal("card:the-brightest-star-in-japan-special-week", p.ListTiles[0].Card.Value);
    }

    [Fact]
    public void Card_list_tile_0_is_the_card_resolved_by_its_detail_screen()
    {
        // S4: fixture 14 is tile 0 of fixture 13 opened (same art, guts icon, SSR, Lvl 40; label sameCardAs). The art
        // match of the list tile and the exact title+name resolution of the detail screen must agree, independently.
        var detail = Env.Parsed("14-support-card-detail").DetailCard!;
        var tile = Env.Parsed("13-support-card-list").ListTiles[0].Card;
        Assert.True(detail.Ok);
        Assert.True(tile.Ok);
        Assert.Equal(detail.Value, tile.Value);
        Assert.Equal("14-support-card-detail", Env.Label("13-support-card-list")["cards"]![0]!["sameCardAs"]!.GetValue<string>());
    }

    [Fact]
    public void Vocab_matching_follows_30_section_4()
    {
        var v = new VocabIndex(Env.Master.Vocab);
        Assert.Equal("spark:nhk-mile-c", v.Match("5 NHK Mile C.", "spark").Id);
        Assert.Equal("outfit:frontline-elegance", FrameParser.OutfitTitles("[Frontline Elegancel").Select(t => v.Match(t, "outfit")).First(m => m.Accepted).Id);
        Assert.Equal("skill:long-corners", v.Match("Long Corners O", "skill", CircleGlyph.Double).Id);
        Assert.Equal("skill:long-corners-2", v.Match("Long Corners O", "skill", CircleGlyph.Single).Id);
        var unknownGlyph = v.Match("Long Corners O", "skill", CircleGlyph.Unknown);
        Assert.False(unknownGlyph.Accepted);
        Assert.Equal(2, unknownGlyph.Candidates.Count(c => ((string)c.Value!).StartsWith("skill:long-corners")));
        var junk = v.Match("Qwzx Plorb", "skill");
        Assert.False(junk.Accepted); Assert.Null(junk.Id); Assert.Equal(3, junk.Candidates.Count);
    }
}
