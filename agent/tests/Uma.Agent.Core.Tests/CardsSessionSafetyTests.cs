using Uma.Agent.Core.Cards;
using Xunit;
using static Uma.Agent.Core.Tests.CardsKit;

namespace Uma.Agent.Core.Tests;

/// <summary>Round-one safety regressions. All edits/sequences are explicitly synthetic, over published master IDs.</summary>
public class CardsSessionSafetyTests
{
    [Fact]
    public void Empty_boundary_cells_require_explicit_confirmation_and_cannot_hide_a_read_card()
    {
        var inv = new Synthetic(20, held: 19);
        var page = inv.PageWith(0, (pos, t) => pos == 19 ? t with {
            Card = Reading.Missing(null, ""), Level = Reading.Missing(null, ""), Lb = Reading.Missing(null, "") } : t);
        var s = NewSession();
        Assert.Equal(CardFeedOutcome.Collected, s.Feed(page, new HashSet<int> { 19 }).Outcome);
        Assert.True(s.State.CanSendFull);
        var other = NewSession();
        Assert.Equal(CardFeedOutcome.Rejected, other.Feed(inv.Page(0), new HashSet<int> { 19 }).Outcome);
        Assert.Empty(other.State.Cards);
    }

    [Fact]
    public void Normalization_keeps_the_grid_column_when_the_first_observed_cell_is_not_column_zero()
    {
        // SYNTHETIC: the leading cell is explicitly declared empty, so the first kept position is column 1.
        // Shifting to that key (instead of whole rows) would make an identical refeed or a one-row scroll look
        // like a fraction-of-a-row move.
        var inv = new Synthetic(23);
        var page = inv.PageWith(0, (pos, t) => pos == 0 ? Synthetic.Empty(t.Index) with { Lb = Reading.Missing(null, "") } : t);
        var s = NewSession();
        var empty = new HashSet<int>(inv.EmptyCells(0)) { 0 };
        Assert.Equal(CardFeedOutcome.Collected, s.Feed(page, empty).Outcome);
        Assert.Equal(1, s.State.Cards.Min(c => c.Position));
        var revision = s.State.Revision;
        Assert.Equal(CardFeedOutcome.Collected, s.Feed(page, empty).Outcome);
        Assert.Equal(revision, s.State.Revision);
        Assert.Equal(CardFeedOutcome.Collected, s.Feed(inv.Page(5), inv.EmptyCells(5)).Outcome);
        Assert.Equal(Enumerable.Range(1, 22), s.State.Cards.Select(c => c.Position));
    }

    [Theory]
    [InlineData(0)] [InlineData(19)]
    public void No_reading_is_unknown_occupancy_not_proof_of_empty(int boundary)
    {
        var inv = new Synthetic(20, held: 19);
        var page = inv.PageWith(0, (pos, t) => pos == boundary ? t with {
            Card = Reading.Missing(null, ""), Level = Reading.Missing(null, ""), Lb = Reading.Missing(null, "") } : t);
        var s = NewSession();
        s.Feed(page);
        Assert.False(s.State.CanSendFull);
        Assert.Contains(s.State.Blockers, b => b.Contains("were not read"));
        Assert.Equal(CardFeedOutcome.Collected, s.Feed(page).Outcome);
    }

    [Theory]
    [InlineData(0)] [InlineData(19)]
    public void Unread_occupied_boundaries_block_full_and_repeated_frames_keep_origin(int boundary)
    {
        var inv = new Synthetic(20, held: 19);
        var page = inv.PageWith(0, (pos, t) => pos == boundary ? t with { Lb = t.Lb with { Ok = false } } : t);
        var s = NewSession();
        Assert.Equal(CardFeedOutcome.Collected, s.Feed(page).Outcome);
        Assert.False(s.State.CanSendFull);
        Assert.Equal(Enumerable.Range(0, 20).Where(i => i != boundary), s.State.Cards.Select(c => c.Position));
        Assert.Contains(s.State.Blockers, b => b.Contains("were not read"));
        var revision = s.State.Revision;
        Assert.Equal(CardFeedOutcome.Collected, s.Feed(page).Outcome);
        Assert.Equal(revision, s.State.Revision);
        Assert.Throws<InvalidOperationException>(() => s.BuildFull());
    }

    [Theory]
    [InlineData(false)] [InlineData(true)]
    public void Boundary_holes_survive_out_of_order_disconnected_pages_and_bridges(bool reverse)
    {
        var inv = new Synthetic(50, held: 48);
        ParsedFrame Page(int start) => inv.PageWith(start, (pos, t) => pos is 0 or 49 ? t with { Lb = t.Lb with { Ok = false } } : t);
        var s = NewSession();
        s.Feed(Page(reverse ? 30 : 0)); s.Feed(Page(reverse ? 0 : 30));
        Assert.Equal(2, s.State.Segments);
        Assert.Equal(CardFeedOutcome.Collected, s.Feed(Page(15)).Outcome);
        Assert.Equal(1, s.State.Segments);
        Assert.Equal(Enumerable.Range(1, 48), s.State.Cards.Select(c => c.Position));
        Assert.False(s.State.CanSendFull);
        Assert.Equal(CardFeedOutcome.Collected, s.Feed(Page(0)).Outcome);
        Assert.Equal(CardFeedOutcome.Collected, s.Feed(Page(30)).Outcome);
        Assert.False(s.State.CanSendFull);
    }

    [Fact]
    public void Reading_boundary_LB_later_resolves_the_hole_but_empty_cells_do_not_create_holes()
    {
        var inv = new Synthetic(3);
        var s = NewSession();
        s.Feed(inv.PageWith(0, (pos, t) => pos == 0 ? t with { Lb = t.Lb with { Ok = false } } : t), inv.EmptyCells(0));
        Assert.False(s.State.CanSendFull);
        Assert.Equal(CardFeedOutcome.Collected, s.Feed(inv.Page(0), inv.EmptyCells(0)).Outcome);
        Assert.True(s.State.CanSendFull);
        Assert.Equal(3, s.BuildFull().Body.Cards.Count);
    }

    [Theory]
    [InlineData(false)] [InlineData(true)]
    public void Unrelated_uncollected_same_level_detail_cannot_bind_selected_or_automatic_tile(bool selected)
    {
        // Both fixture tiles are demoted. Tile 5 is synthetically made the same level as detail 14,
        // but excludes its identity. The automatic variant omits tile 0 so no other fit masks the guard.
        var list = DemoteTile(Env.Parsed(List13), 0, 5);
        // Automatic case has ONE pending tile and omits tile 0 entirely: ambiguity/already-collected guards
        // cannot mask a removed identity check. Selected case keeps tile 0 as the legitimate detail target.
        if (!selected) list = list with { ListTiles = list.ListTiles.Where(t => t.Index != 0).ToArray() };
        list = ReplaceTile(list, 5, t => t with { Level = t.Level with { Value = 40 }, Card = t.Card with { Candidates = [new Candidate("card:synthetic-unrelated", .8)] } });
        var s = NewSession(); s.Feed(list);
        if (selected) Assert.True(s.RequestDetail(s.State.Pending.Single(p => p.Position == 5).Id));
        var before = s.State;
        Assert.Equal(CardFeedOutcome.DetailIgnored, s.Feed(Env.Parsed(Detail14)).Outcome);
        Assert.Equal(before.Revision, s.State.Revision);
        Assert.Equal(selected ? 2 : 1, s.State.Pending.Count);
        Assert.DoesNotContain(s.State.Cards, c => c.CardId == Brightest);
        Assert.Equal(before.AwaitingDetailFor, s.State.AwaitingDetailFor);
    }

    [Theory]
    [InlineData(false)] [InlineData(true)]
    public void Detail_cannot_bind_a_card_already_located_at_another_unread_LB_tile(bool selected)
    {
        // GROUNDED+SYNTHETIC (from the round-1 re-review): fixture 13 tile 0 keeps its accepted art
        // (Special Week) but its LB is made unreadable; tile 5 is demoted with Special Week among its
        // candidates and its level set to 40. Detail 14 (Special Week Lvl 40) must not bind tile 5:
        // the card is already located at tile 0, and binding would put it at two positions with tile 5's LB.
        var p = Env.Parsed(List13);
        p = ReplaceTile(p, 0, t => t with { Lb = t.Lb with { Ok = false } });
        p = ReplaceTile(p, 5, t => t with { Card = t.Card with { Ok = false, Candidates = [new Candidate(Brightest, .8), new Candidate("card:synthetic-runner-up", .7)] }, Level = t.Level with { Value = 40 } });
        var s = NewSession(); s.Feed(p);
        var tile5 = s.State.Pending.Single(x => x.Position == 5);
        if (selected) Assert.True(s.RequestDetail(tile5.Id));
        var before = s.State.Revision;
        Assert.Equal(CardFeedOutcome.DetailIgnored, s.Feed(Env.Parsed(Detail14)).Outcome);
        Assert.Equal(before, s.State.Revision);
        Assert.DoesNotContain(s.State.Cards, c => c.CardId == Brightest);
        Assert.Single(s.State.Pending, x => x.Position == 5);
        // Not wedged: the same frame, and one with tile 0's LB readable, are still accepted.
        Assert.Equal(CardFeedOutcome.Collected, s.Feed(p).Outcome);
        var readable = ReplaceTile(Env.Parsed(List13), 5, t => t with { Card = t.Card with { Ok = false, Candidates = [new Candidate(Brightest, .8)] }, Level = t.Level with { Value = 40 } });
        Assert.Equal(CardFeedOutcome.Collected, s.Feed(readable).Outcome);
        Assert.Equal(2, s.State.Cards.Single(c => c.CardId == Brightest).Lb);
    }

    [Fact]
    public void Confirmation_cannot_authorize_a_different_session_even_with_equal_counts_and_revision()
    {
        var inv = new Synthetic(23); var a = NewSession(); var b = NewSession();
        a.Feed(inv.Page(0), inv.EmptyCells(0));
        b.Feed(inv.PageWith(0, (pos, t) => pos == 0 ? t with { Lb = t.Lb with { Value = 4 } } : t));
        Assert.Equal(a.State.Revision, b.State.Revision);
        Assert.Throws<InvalidOperationException>(() => b.BuildPartial(a.State.PartialConfirmation!));
        Assert.True(b.BuildPartial(b.State.PartialConfirmation!).Partial);
    }

    [Fact]
    public void Pending_handles_are_not_reused_between_sessions_reset_or_cancel()
    {
        var inv = new Synthetic(23);
        ParsedFrame Amb(int pos) => inv.PageWith(0, (i, t) => i == pos ? Synthetic.Ambiguous(t.Index, inv.Inventory[i], [inv.Inventory[i].Id]) : t);
        var a = NewSession(); var b = NewSession();
        a.Feed(Amb(0)); b.Feed(Amb(7));
        var old = a.State.Pending.Single().Id;
        Assert.False(b.RequestDetail(old));
        var confirm = a.State.PartialConfirmation!;
        a.Cancel(); Assert.False(a.RequestDetail(old));
        Assert.Throws<InvalidOperationException>(() => a.BuildPartial(confirm));
        a.Reset(); a.Feed(Amb(7));
        Assert.NotEqual(old, a.State.Pending.Single().Id);
        Assert.False(a.RequestDetail(old));
        Assert.Throws<InvalidOperationException>(() => a.BuildPartial(confirm));
    }

    [Fact]
    public void Reset_alone_never_reuses_a_pending_handle_for_a_different_tile()
    {
        // SYNTHETIC. No Cancel in between: Reset by itself must start a new handle generation, otherwise the
        // first pending tile after Reset gets the same handle as the first one before it (the B3 stale-UI case).
        var inv = new Synthetic(23);
        ParsedFrame Amb(int pos) => inv.PageWith(0, (i, t) => i == pos ? Synthetic.Ambiguous(t.Index, inv.Inventory[i], [inv.Inventory[i].Id]) : t);
        var s = NewSession();
        s.Feed(Amb(0));
        var old = s.State.Pending.Single();
        s.Reset();
        s.Feed(Amb(7));
        var now = s.State.Pending.Single();
        Assert.Equal(7, now.Position);
        Assert.NotEqual(old.Id, now.Id);
        Assert.False(s.RequestDetail(old.Id));
        Assert.Null(s.State.AwaitingDetailFor);
    }

    [Fact]
    public void Injected_identity_cannot_collide_and_confirmations_have_no_rewritable_revision()
    {
        var injected = Guid.Parse("54e39b50-cd69-494c-91cc-03e503c902f8");
        var inv = new Synthetic(23);
        var page = inv.PageWith(0, (pos, t) => pos == 0 ? Synthetic.Ambiguous(t.Index, inv.Inventory[0], [inv.Inventory[0].Id]) : t);
        var a = new CardSyncSession(Env.Master, Env.Layout, new TestClock(), () => injected);
        var b = new CardSyncSession(Env.Master, Env.Layout, new TestClock(), () => injected);
        a.Feed(page); b.Feed(page);
        Assert.Equal(injected, a.State.PartialConfirmation!.SessionId);
        Assert.False(b.RequestDetail(a.State.Pending.Single().Id));
        Assert.Throws<InvalidOperationException>(() => b.BuildPartial(a.State.PartialConfirmation!));
        Assert.Null(typeof(PartialSyncConfirmation).GetProperty(nameof(PartialSyncConfirmation.Revision))!.SetMethod);
        Assert.Throws<InvalidOperationException>(() => a.BuildPartial(new PartialSyncConfirmation(a.State.Revision, a.State.Cards.Count, inv.Held)));
        var seen = a.State.PartialConfirmation!;
        Assert.True(a.RequestDetail(a.State.Pending.Single().Id));
        Assert.Throws<InvalidOperationException>(() => a.BuildPartial(seen));
        var revision = a.State.Revision;
        Assert.True(a.RequestDetail(a.State.Pending.Single().Id));
        Assert.Equal(revision, a.State.Revision);
        a.ClearDetailRequest();
        Assert.True(a.State.Revision > revision);
    }

    private static void RefuseMutation<T>(IReadOnlyList<T> list, T replacement)
    {
        Assert.False(list is T[]);
        if (list is IList<T> mutable) Assert.Throws<NotSupportedException>(() => mutable[0] = replacement);
    }

    [Fact]
    public void Caller_candidates_and_published_nested_lists_cannot_mutate_binding_without_revision()
    {
        var inv = new Synthetic(23); var id = inv.Inventory[0].Id;
        var candidates = new[] { new Candidate(id, .9) };
        var page = inv.PageWith(0, (pos, t) => pos == 0 ? Synthetic.Ambiguous(t.Index, inv.Inventory[0], [id]) with { Card = t.Card with { Ok = false, Candidates = candidates } } : t);
        var s = NewSession(); s.Feed(page); var before = s.State;
        candidates[0] = new Candidate(inv.Inventory[22].Id, 1);
        Assert.Equal(id, s.State.Pending.Single().Candidates.Single().Value);
        RefuseMutation(before.Pending.Single().Candidates, new Candidate(inv.Inventory[22].Id, 1));
        RefuseMutation(before.Cards, before.Cards[0] with { Lb = 4 });
        RefuseMutation(before.Pending, before.Pending[0] with { Id = "forged" });
        RefuseMutation(before.Blockers, "forged");
        Assert.Equal(before.Revision, s.State.Revision);
        Assert.Equal(CardFeedOutcome.DetailBound, s.Feed(Synthetic.Detail(id, inv.Inventory[0].Level)).Outcome);
    }

    [Fact]
    public void Published_conflicts_and_payload_cards_are_frozen()
    {
        var inv = new Synthetic(23); var s = NewSession(); s.Feed(inv.Page(0), inv.EmptyCells(0));
        s.Feed(inv.PageWith(0, (pos, t) => pos == 7 ? t with { Lb = t.Lb with { Value = 4 } } : t));
        var st = s.State;
        RefuseMutation(st.Conflicts.Single().Observations, new CardObservation(null, 0, null));
        RefuseMutation(st.Conflicts, st.Conflicts[0] with { Position = 999 });
        var payload = s.BuildPartial(st.PartialConfirmation!);
        var serialized = OwnedCardsSyncJson.Serialize(payload.Body);
        RefuseMutation(payload.Body.Cards, payload.Body.Cards[0] with { Lb = 4 });
        Assert.Equal(serialized, OwnedCardsSyncJson.Serialize(payload.Body));
        Assert.Equal(st.Revision, s.State.Revision);
    }
}
