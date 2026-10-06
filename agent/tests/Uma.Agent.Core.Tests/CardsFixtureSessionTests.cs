using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;
using Uma.Agent.Core.Cards;
using Xunit;
using static Uma.Agent.Core.Tests.CardsKit;

namespace Uma.Agent.Core.Tests;

/// <summary>GROUNDED tests: the real screenshots 13 (cards.list) and 14 (cards.detail) parsed through
/// FrameParser.ParseAsync with their recorded OCR, then fed to the card sync session.</summary>
public class CardsFixtureSessionTests
{
    [Fact]
    public async Task Fixture_13_collects_20_cards_with_the_exact_LB_list_and_stays_partial_against_Held_208()
    {
        var s = NewSession();
        var r = await s.FeedAsync(Env.Parser(List13), Env.Frame(List13));
        Assert.Equal(CardFeedOutcome.Collected, r.Outcome);
        var st = s.State;
        Assert.Equal(208, st.HeldCount);
        Assert.Equal(20, st.Cards.Count);
        Assert.Equal(Lb13, st.Cards.Select(c => c.Lb));                       // 30 §10 T11, row-major
        Assert.Equal(Enumerable.Range(0, 20), st.Cards.Select(c => c.Position));
        Assert.Equal(20, st.Cards.Select(c => c.CardId).Distinct().Count());
        Assert.Equal(Brightest, st.Cards[0].CardId);
        Assert.Equal(40, st.Cards[0].Level);
        // Levels agree with the fixture label (independent of the session).
        var labelLevels = Env.Label(List13)["cards"]!.AsArray().Select(c => c!["level"]!.GetValue<int>());
        Assert.Equal(labelLevels, st.Cards.Select(c => c.Level));
        Assert.All(st.Cards, c => Assert.InRange(c.Confidence, 0.5, 1));
        Assert.Empty(st.Pending); Assert.Empty(st.Conflicts);
        // 20 of 208: a full sync is impossible, never claimed.
        Assert.Equal(CardSyncStatus.Collecting, st.Status);
        Assert.False(st.CanSendFull);
        Assert.Contains(st.Blockers, b => b.Contains("20 of 208"));
        Assert.Throws<InvalidOperationException>(() => s.BuildFull());
    }

    [Fact]
    public async Task Fixture_13_partial_needs_an_explicit_confirmation_and_carries_partial_flag()
    {
        var clock = new TestClock();
        var s = NewSession(clock);
        await s.FeedAsync(Env.Parser(List13), Env.Frame(List13));
        var confirm = s.State.PartialConfirmation!;
        Assert.Equal(20, confirm.Cards); Assert.Equal(208, confirm.HeldCount);
        Assert.Contains("replaced by these 20 cards", confirm.Message);           // the API replaces the table even when partial
        var payload = s.BuildPartial(confirm);
        Assert.True(payload.Partial);
        Assert.Equal(208, payload.Body.HeldCount);
        Assert.Equal(20, payload.Body.Cards.Count);
        Assert.Equal(Lb13, payload.Body.Cards.Select(c => c.Lb));
        Assert.Equal("global-20260930", payload.Body.MasterVersion);
        Assert.Equal(clock.UtcNow, payload.Body.CapturedAt);
        Assert.Empty(OwnedCardsSyncValidator.Validate(payload.Body, partial: true, Env.Master.Ids["cards"]));
        Assert.NotEmpty(OwnedCardsSyncValidator.Validate(payload.Body, partial: false, Env.Master.Ids["cards"]));
    }

    [Fact]
    public async Task Fixture_13_tile_0_resolved_by_detail_14_through_the_actual_master()
    {
        // Tile 0's real art reading (accepted by the parser) is demoted to ambiguous: the parser's real candidates stay.
        var list = DemoteTile(Env.Parsed(List13), 0);
        var s = NewSession();
        s.Feed(list);
        var pending = Assert.Single(s.State.Pending);
        Assert.Equal(0, pending.Position); Assert.Equal(2, pending.Lb); Assert.Equal(40, pending.Level);
        Assert.Null(pending.CardId);
        Assert.Contains(pending.Candidates, c => (string?)c.Value == Brightest);
        Assert.Equal(19, s.State.Cards.Count);
        Assert.DoesNotContain(s.State.Cards, c => c.CardId == Brightest);   // no confident-wrong placeholder

        var r = s.Feed(Env.Parsed(Detail14));                                // title + name OCR, exact (30 §8)
        Assert.Equal(CardFeedOutcome.DetailBound, r.Outcome);
        Assert.Empty(s.State.Pending);
        var c0 = s.State.Cards[0];
        Assert.Equal((0, Brightest, 2, 40, "detail"), (c0.Position, c0.CardId, c0.Lb, c0.Level, c0.Source));
        Assert.Equal(Lb13, s.State.Cards.Select(c => c.Lb));
        // The same ID the parser's art match gives for the un-demoted tile, and the label's sameCardAs.
        Assert.Equal(Env.Parsed(List13).ListTiles[0].Card.Value, c0.CardId);
        Assert.Equal(Detail14, Env.Label(List13)["cards"]![0]!["sameCardAs"]!.GetValue<string>());
    }

    [Fact]
    public void Detail_binds_only_to_the_pending_tile_it_belongs_to()
    {
        // Real tiles 0 and 2 demoted: only tile 0's real candidates contain the detail's card.
        var s = NewSession();
        s.Feed(DemoteTile(Env.Parsed(List13), 0, 2));
        Assert.Equal(2, s.State.Pending.Count);
        Assert.Equal(CardFeedOutcome.DetailBound, s.Feed(Env.Parsed(Detail14)).Outcome);
        var left = Assert.Single(s.State.Pending);
        Assert.Equal(2, left.Position);
        Assert.Equal(Brightest, s.State.Cards.Single(c => c.Position == 0).CardId);
    }

    [Fact]
    public void Ambiguous_detail_needs_the_user_to_select_the_tile_and_level_must_agree()
    {
        // SYNTHETIC edit of a real reading: tile 1 is demoted and its candidates/level made to also fit the detail.
        var list = ReplaceTile(DemoteTile(Env.Parsed(List13), 0, 1), 1,
            t => t with { Card = t.Card with { Candidates = [new Candidate(Brightest, 0.8), .. t.Card.Candidates] }, Level = t.Level with { Value = 40 } });
        var s = NewSession();
        s.Feed(list);
        Assert.Equal(2, s.State.Pending.Count);
        var r = s.Feed(Env.Parsed(Detail14));
        Assert.Equal(CardFeedOutcome.DetailIgnored, r.Outcome);
        Assert.Contains("2 pending tiles", r.Reason);
        Assert.Equal(2, s.State.Pending.Count);

        var tile1 = s.State.Pending.Single(p => p.Position == 1);
        var tile0 = s.State.Pending.Single(p => p.Position == 0);
        Assert.True(s.RequestDetail(tile0.Id));
        Assert.Equal(tile0.Id, s.State.AwaitingDetailFor);
        Assert.Equal(CardFeedOutcome.DetailBound, s.Feed(Env.Parsed(Detail14)).Outcome);
        Assert.Null(s.State.AwaitingDetailFor);
        Assert.Equal(tile1.Id, Assert.Single(s.State.Pending).Id);
        Assert.False(s.RequestDetail(tile0.Id));                            // already resolved
    }

    [Fact]
    public void Requested_detail_with_another_level_or_an_already_collected_card_is_refused()
    {
        var s = NewSession();
        s.Feed(DemoteTile(Env.Parsed(List13), 5));                          // real tile 5: Lvl 30
        var p = Assert.Single(s.State.Pending);
        Assert.True(s.RequestDetail(p.Id));
        var r = s.Feed(Env.Parsed(Detail14));                                // Brightest Lvl 40, already tile 0
        Assert.Equal(CardFeedOutcome.DetailIgnored, r.Outcome);
        Assert.Single(s.State.Pending);
        Assert.Equal(19, s.State.Cards.Count);
        Assert.Equal(p.Id, s.State.AwaitingDetailFor);                       // the request stays until a matching detail
    }

    [Fact]
    public void Detail_with_a_different_level_does_not_bind_even_when_the_card_is_a_candidate()
    {
        // SYNTHETIC edit of real tile 0: demoted and its level changed to 35; detail 14 shows Lvl 40.
        var list = ReplaceTile(DemoteTile(Env.Parsed(List13), 0), 0, t => t with { Level = t.Level with { Value = 35 } });
        var s = NewSession();
        s.Feed(list);
        var r = s.Feed(Env.Parsed(Detail14));
        Assert.Equal(CardFeedOutcome.DetailIgnored, r.Outcome);
        Assert.Contains("no pending tile fits", r.Reason);
        Assert.Single(s.State.Pending);
    }

    [Fact]
    public void Unrelated_detail_changes_nothing()
    {
        var s = NewSession();
        Assert.Equal(CardFeedOutcome.DetailIgnored, s.Feed(Env.Parsed(Detail14)).Outcome);   // nothing collected yet
        s.Feed(Env.Parsed(List13));
        var before = s.State;
        var r = s.Feed(Env.Parsed(Detail14));                                // tile 0 already resolved by art
        Assert.Equal(CardFeedOutcome.DetailIgnored, r.Outcome);
        Assert.Equal(before.Revision, s.State.Revision);
    }

    [Fact]
    public void Non_card_fixture_screens_are_ignored()
    {
        var s = NewSession();
        foreach (var n in new[] { "01-veteran-details-skills-independent", "05-veteran-details-career-info-deck-legacy", "08-sparks-popup-oguri-cap" })
            Assert.Equal(CardFeedOutcome.Ignored, s.Feed(Env.Parsed(n)).Outcome);
        Assert.Equal(CardSyncStatus.Idle, s.State.Status);
        Assert.Equal(0, s.State.Revision);
    }

    [Fact]
    public async Task Raw_supported_sizes_go_through_ParseAsync_and_unsupported_ones_are_refused()
    {
        using var image = Frames.ToImage(Env.Frame(List13));
        image.Mutate(c => c.Resize(2560, 1440, KnownResamplers.Bicubic));
        var big = Frames.FromImage(image);
        var s = NewSession();
        // The recorded OCR is in reference coordinates; ParseAsync normalizes the frame before any read.
        var r = await s.FeedAsync(Env.Parser(List13), big);
        Assert.Equal(CardFeedOutcome.Collected, r.Outcome);
        Assert.Equal(Lb13, s.State.Cards.Select(c => c.Lb));

        using var small = Frames.ToImage(Env.Frame(List13));
        small.Mutate(c => c.Resize(1280, 720, KnownResamplers.Bicubic));
        var fresh = NewSession();
        await Assert.ThrowsAsync<UnsupportedResolutionException>(() => fresh.FeedAsync(Env.Parser(List13), Frames.FromImage(small)));
        Assert.Equal(0, fresh.State.Revision);
    }

    [Fact]
    public void A_ParsedFrame_that_is_not_in_reference_space_is_refused_before_reading()
    {
        var p = Env.Parsed(List13);
        var s = NewSession();
        var odd = p with { Frame = new Frame(new byte[1280 * 720 * 4], 1280, 720) };
        Assert.Throws<NonReferenceFrameException>(() => s.Feed(odd));
        Assert.Equal(0, s.State.Revision);
    }
}
