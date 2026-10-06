using Uma.Agent.Core.Cards;
using Xunit;
using static Uma.Agent.Core.Tests.CardsKit;

namespace Uma.Agent.Core.Tests;

/// <summary>SYNTHETIC sequences (see <see cref="Synthetic"/>): made-up inventories over real master IDs drive the
/// session's scroll de-duplication and edge cases. They are not captures and assert no game facts.</summary>
public class CardsSequenceTests
{
    private static IEnumerable<string> Ids(CardSyncState s) => s.Cards.Select(c => c.CardId);

    [Fact]
    public void Scrolling_down_collects_each_card_once_and_completes_only_at_Held()
    {
        var inv = new Synthetic(23);
        var s = NewSession();
        s.Feed(inv.Page(0), inv.EmptyCells(0));
        Assert.Equal(20, s.State.Cards.Count);
        Assert.False(s.State.CanSendFull);
        s.Feed(inv.Page(5), inv.EmptyCells(5));                                                 // scrolled one row: 15 tiles overlap
        var st = s.State;
        Assert.Equal(CardSyncStatus.Complete, st.Status);
        Assert.True(st.CanSendFull);
        Assert.Equal(inv.Inventory.Select(c => c.Id), Ids(st));
        Assert.Equal(inv.Inventory.Select(c => c.Lb), st.Cards.Select(c => c.Lb));
        Assert.Equal(inv.Inventory.Select(c => c.Level), st.Cards.Select(c => c.Level));
        var full = s.BuildFull();
        Assert.False(full.Partial);
        Assert.Equal(23, full.Body.Cards.Count); Assert.Equal(23, full.Body.HeldCount);
        Assert.Empty(OwnedCardsSyncValidator.Validate(full.Body, partial: false, Env.Master.Ids["cards"]));
    }

    [Fact]
    public void Repeated_pages_are_idempotent()
    {
        var inv = new Synthetic(23);
        var s = NewSession();
        s.Feed(inv.Page(0), inv.EmptyCells(0));
        var rev = s.State.Revision;
        for (var i = 0; i < 3; i++) Assert.Equal(CardFeedOutcome.Collected, s.Feed(inv.Page(0), inv.EmptyCells(0)).Outcome);
        Assert.Equal(rev, s.State.Revision);
        Assert.Equal(20, s.State.Cards.Count);
    }

    [Fact]
    public void Out_of_order_pages_keep_list_order()
    {
        var inv = new Synthetic(23);
        var s = NewSession();
        s.Feed(inv.Page(5), inv.EmptyCells(5));                                                 // the user scrolled before starting
        s.Feed(inv.Page(0), inv.EmptyCells(0));
        Assert.Equal(inv.Inventory.Select(c => c.Id), Ids(s.State));
        Assert.True(s.State.CanSendFull);
    }

    [Fact]
    public void A_skipped_region_is_a_gap_until_an_overlapping_page_bridges_it()
    {
        var inv = new Synthetic(50);
        var s = NewSession();
        s.Feed(inv.Page(0), inv.EmptyCells(0)); s.Feed(inv.Page(30), inv.EmptyCells(30));                           // 20..29 never seen
        Assert.Equal(40, s.State.Cards.Count);
        Assert.Equal(2, s.State.Segments);
        Assert.False(s.State.CanSendFull);
        s.Feed(inv.Page(15), inv.EmptyCells(15));                                                // overlaps both islands
        Assert.Equal(1, s.State.Segments);
        Assert.Equal(inv.Inventory.Select(c => c.Id), Ids(s.State));
        Assert.True(s.State.CanSendFull);
    }

    [Fact]
    public void A_gap_blocks_full_even_when_the_count_equals_Held()
    {
        // Guards a misread Held: 40 cards seen in two unconnected parts must not be sent as the whole collection.
        var inv = new Synthetic(50, held: 40);
        var s = NewSession();
        s.Feed(inv.Page(0), inv.EmptyCells(0)); s.Feed(inv.Page(30), inv.EmptyCells(30));
        Assert.Equal(40, s.State.Cards.Count);
        Assert.Equal(40, s.State.HeldCount);
        Assert.False(s.State.CanSendFull);
        Assert.Contains(s.State.Blockers, b => b.Contains("separate parts"));
        Assert.Throws<InvalidOperationException>(() => s.BuildFull());
    }

    [Fact]
    public void A_hole_inside_the_scanned_range_blocks_full_even_when_the_count_equals_Held()
    {
        // Tile 7's LB is unreadable in every frame (synthetic), so position 7 stays a hole; Held claims 22.
        var inv = new Synthetic(23, held: 22);
        var s = NewSession();
        ListTile NoLb(int pos, ListTile t) => pos == 7 ? t with { Lb = t.Lb with { Ok = false } } : t;
        s.Feed(inv.PageWith(0, NoLb)); s.Feed(inv.PageWith(5, NoLb));
        Assert.Equal(22, s.State.Cards.Count);
        Assert.Equal(1, s.State.Segments);
        Assert.False(s.State.CanSendFull);
        Assert.Contains(s.State.Blockers, b => b.Contains("were not read"));
    }

    [Fact]
    public void A_frame_shifted_by_part_of_a_row_is_rejected()
    {
        var inv = new Synthetic(30);
        var s = NewSession();
        s.Feed(inv.Page(0), inv.EmptyCells(0));
        var shifted = Synthetic.List(Enumerable.Range(0, 20).Select(i => Synthetic.Tile(i, inv.Inventory[i + 3])), inv.Held);
        var r = s.Feed(shifted);
        Assert.Equal(CardFeedOutcome.Rejected, r.Outcome);
        Assert.Contains("fraction of a row", r.Reason);
        Assert.Equal(20, s.State.Cards.Count);
    }

    [Fact]
    public void A_Held_change_stops_the_session_until_reset()
    {
        var inv = new Synthetic(23);
        var s = NewSession();
        s.Feed(inv.Page(0), inv.EmptyCells(0));
        var r = s.Feed(inv.Page(5) with { HeldCount = new Reading(24, "24/255", 0.9, true, [], null) });
        Assert.Equal(CardFeedOutcome.HeldChanged, r.Outcome);
        Assert.Equal(CardSyncStatus.HeldChanged, s.State.Status);
        Assert.False(s.State.CanSendFull);
        Assert.Null(s.State.PartialConfirmation);
        Assert.Equal(20, s.State.Cards.Count);                                // the changed frame added nothing
        Assert.Throws<InvalidOperationException>(() => s.BuildFull());
        Assert.Equal(CardFeedOutcome.Ignored, s.Feed(inv.Page(5), inv.EmptyCells(5)).Outcome);
        s.Reset();
        Assert.Equal(CardSyncStatus.Idle, s.State.Status);
        Assert.Empty(s.State.Cards);
    }

    [Fact]
    public void Held_must_be_read_confidently_before_a_full_sync()
    {
        var inv = new Synthetic(23);
        var s = NewSession();
        s.Feed(inv.Page(0, held: null), inv.EmptyCells(0)); s.Feed(inv.Page(5, held: null), inv.EmptyCells(5));
        Assert.Null(s.State.HeldCount);
        Assert.Equal(23, s.State.Cards.Count);
        Assert.False(s.State.CanSendFull);
        Assert.Null(s.State.PartialConfirmation);                            // heldCount is required by the contract
        var low = inv.Page(5) with { HeldCount = new Reading(23, "23/255", 0.3, false, [], null) };
        s.Feed(low, inv.EmptyCells(5));
        Assert.Null(s.State.HeldCount);
        s.Feed(inv.Page(5), inv.EmptyCells(5));
        Assert.Equal(23, s.State.HeldCount);
        Assert.True(s.State.CanSendFull);
    }

    [Fact]
    public void Duplicate_card_in_one_frame_rejects_the_frame()
    {
        var inv = new Synthetic(23);
        var s = NewSession();
        var dup = inv.PageWith(0, (pos, t) => pos == 7 ? Synthetic.Tile(t.Index, inv.Inventory[3]) : t);
        var r = s.Feed(dup);
        Assert.Equal(CardFeedOutcome.Rejected, r.Outcome);
        Assert.Contains("twice", r.Reason);
        Assert.Equal(0, s.State.Revision);
    }

    [Fact]
    public void Inconsistent_anchors_reject_the_frame()
    {
        var inv = new Synthetic(30);
        var s = NewSession();
        s.Feed(inv.Page(0), inv.EmptyCells(0));
        // Second frame claims inventory[0] where inventory[10] should be, while the other tiles say one row down.
        var bad = inv.PageWith(5, (pos, t) => pos == 10 ? Synthetic.Tile(t.Index, inv.Inventory[0]) : t);
        var r = s.Feed(bad);
        Assert.Equal(CardFeedOutcome.Rejected, r.Outcome);
        Assert.Equal(20, s.State.Cards.Count);
    }

    [Fact]
    public void Conflicting_LB_or_level_for_a_position_blocks_full_and_is_excluded_from_partial()
    {
        var inv = new Synthetic(23);
        var s = NewSession();
        s.Feed(inv.Page(0), inv.EmptyCells(0));
        var changed = inv.PageWith(5, (pos, t) => pos == 7 ? t with { Lb = new Reading((inv.Inventory[7].Lb + 1) % 5, null, 1, true, [], null) } : t);
        s.Feed(changed);
        var c = Assert.Single(s.State.Conflicts);
        Assert.Equal(7, c.Position);
        Assert.Equal(2, c.Observations.Count);
        Assert.False(s.State.CanSendFull);
        Assert.Equal(22, s.State.Cards.Count);
        var partial = s.BuildPartial(s.State.PartialConfirmation!);
        Assert.DoesNotContain(partial.Body.Cards, x => x.CardId == inv.Inventory[7].Id);
        Assert.Equal(22, partial.Body.Cards.Count);
        // A third reading of the same position is recorded too (and changes the revision); a repeat does not.
        var rev = s.State.Revision;
        s.Feed(inv.PageWith(5, (pos, t) => pos == 7 ? t with { Level = new Reading(inv.Inventory[7].Level + 1, null, 0.9, true, [], null) } : t));
        Assert.Equal(3, s.State.Conflicts.Single().Observations.Count);
        Assert.True(s.State.Revision > rev);
        rev = s.State.Revision;
        s.Feed(changed);
        Assert.Equal(rev, s.State.Revision);
    }

    [Fact]
    public void Rebuilding_a_payload_after_a_failed_send_gives_the_same_body()
    {
        // No durable card queue: recovery is to send again from the in-memory session (idempotent whole-table PUT).
        var inv = new Synthetic(23);
        var clock = new TestClock();
        var s = NewSession(clock);
        s.Feed(inv.Page(0), inv.EmptyCells(0)); s.Feed(inv.Page(5), inv.EmptyCells(5));
        var a = s.BuildFull();
        clock.UtcNow += TimeSpan.FromMinutes(10);
        Assert.Equal(a, s.BuildFull());
    }

    [Fact]
    public void More_cards_than_Held_is_never_sent_as_full()
    {
        var inv = new Synthetic(23, held: 21);
        var s = NewSession();
        s.Feed(inv.Page(0), inv.EmptyCells(0)); s.Feed(inv.Page(5), inv.EmptyCells(5));
        Assert.Equal(23, s.State.Cards.Count);
        Assert.False(s.State.CanSendFull);
        Assert.Contains(s.State.Blockers, b => b.Contains("more than Held"));
    }

    [Fact]
    public void Ambiguous_tiles_stay_pending_with_candidates_and_resolve_from_a_later_confident_frame()
    {
        var inv = new Synthetic(23);
        var s = NewSession();
        var amb = inv.PageWith(0, (pos, t) => pos == 12 ? Synthetic.Ambiguous(t.Index, inv.Inventory[12], [inv.Inventory[12].Id, inv.Inventory[1].Id]) : t);
        s.Feed(amb);
        var p = Assert.Single(s.State.Pending);
        Assert.Equal(12, p.Position); Assert.Null(p.CardId);
        Assert.Equal(2, p.Candidates.Count);
        Assert.DoesNotContain(s.State.Cards, c => c.Position == 12);
        s.Feed(inv.Page(5), inv.EmptyCells(5));                                                 // the same tile, now confidently matched
        Assert.Empty(s.State.Pending);
        Assert.True(s.State.CanSendFull);
    }

    [Fact]
    public void Pending_tiles_block_full_and_are_excluded_from_partial()
    {
        var inv = new Synthetic(23);
        var s = NewSession();
        Func<int, ListTile, ListTile> amb = (pos, t) => pos == 12 ? Synthetic.Ambiguous(t.Index, inv.Inventory[12], [inv.Inventory[1].Id]) : t;
        s.Feed(inv.PageWith(0, amb)); s.Feed(inv.PageWith(5, (pos, t) => pos == 12 ? Synthetic.Ambiguous(t.Index, inv.Inventory[12], [inv.Inventory[1].Id]) : t));
        Assert.Single(s.State.Pending);
        Assert.Equal(22, s.State.Cards.Count);
        Assert.False(s.State.CanSendFull);
        var payload = s.BuildPartial(s.State.PartialConfirmation!);
        Assert.Equal(22, payload.Body.Cards.Count);
        Assert.DoesNotContain(payload.Body.Cards, c => c.CardId == inv.Inventory[1].Id && c.Lb == inv.Inventory[12].Lb && c.Level == inv.Inventory[12].Level);
    }

    [Fact]
    public void Synthetic_detail_resolves_a_card_whose_level_was_not_read()
    {
        var inv = new Synthetic(23);
        var s = NewSession();
        var noLevel = inv.PageWith(0, (pos, t) => pos == 4 ? t with { Level = Reading.Missing(null, "") } : t);
        s.Feed(noLevel);
        var p = Assert.Single(s.State.Pending);
        Assert.Equal(inv.Inventory[4].Id, p.CardId);
        Assert.Null(p.Level);
        Assert.Equal(CardFeedOutcome.DetailIgnored, s.Feed(Synthetic.Detail(inv.Inventory[4].Id, null)).Outcome);   // detail level unread
        Assert.Equal(CardFeedOutcome.DetailBound, s.Feed(Synthetic.Detail(inv.Inventory[4].Id, inv.Inventory[4].Level)).Outcome);
        Assert.Empty(s.State.Pending);
        Assert.Equal(inv.Inventory[4].Level, s.State.Cards.Single(c => c.Position == 4).Level);
    }

    [Fact]
    public void A_detail_that_is_not_confident_never_resolves_anything()
    {
        var inv = new Synthetic(23);
        var s = NewSession();
        s.Feed(inv.PageWith(0, (pos, t) => pos == 12 ? Synthetic.Ambiguous(t.Index, inv.Inventory[12], [inv.Inventory[12].Id]) : t));
        var rev = s.State.Revision;
        Assert.Equal(CardFeedOutcome.DetailIgnored, s.Feed(Synthetic.Detail(inv.Inventory[12].Id, inv.Inventory[12].Level, cardOk: false)).Outcome);
        Assert.Equal(rev, s.State.Revision);
        Assert.Single(s.State.Pending);
    }

    [Fact]
    public void Frames_without_any_confident_tile_are_not_used()
    {
        var inv = new Synthetic(23);
        var s = NewSession();
        var allAmbiguous = Synthetic.List(inv.Inventory.Take(20).Select((c, i) => Synthetic.Ambiguous(i, c, [c.Id])), 23);
        Assert.Equal(CardFeedOutcome.Ignored, s.Feed(allAmbiguous).Outcome);
        Assert.Empty(s.State.Pending);
    }

    [Fact]
    public void Empty_grid_cells_are_not_cards()
    {
        var inv = new Synthetic(3);
        var s = NewSession();
        s.Feed(inv.Page(0), inv.EmptyCells(0));
        Assert.Equal(3, s.State.Cards.Count);
        Assert.Empty(s.State.Pending);
        Assert.True(s.State.CanSendFull);
    }

    [Fact]
    public void Cancel_and_reset()
    {
        var inv = new Synthetic(23);
        var s = NewSession();
        s.Feed(inv.Page(0), inv.EmptyCells(0));
        s.Cancel();
        Assert.Equal(CardSyncStatus.Cancelled, s.State.Status);
        Assert.Equal(CardFeedOutcome.Cancelled, s.Feed(inv.Page(5), inv.EmptyCells(5)).Outcome);
        Assert.Null(s.State.PartialConfirmation);
        Assert.Throws<InvalidOperationException>(() => s.BuildFull());
        s.Reset();
        s.Feed(inv.Page(0), inv.EmptyCells(0)); s.Feed(inv.Page(5), inv.EmptyCells(5));
        Assert.True(s.State.CanSendFull);
    }

    [Fact]
    public void Partial_confirmation_is_tied_to_the_state_the_user_saw()
    {
        var inv = new Synthetic(50);
        var s = NewSession();
        s.Feed(inv.Page(0), inv.EmptyCells(0));
        var seen = s.State.PartialConfirmation!;
        s.Feed(inv.Page(5), inv.EmptyCells(5));                                                 // more cards arrived after the click
        Assert.Throws<InvalidOperationException>(() => s.BuildPartial(seen));
        Assert.Throws<InvalidOperationException>(() => s.BuildPartial(new PartialSyncConfirmation(s.State.Revision, seen.Cards, seen.HeldCount))); // hand-built counts/revision are not authorization
        var now = s.State.PartialConfirmation!;
        Assert.Equal(25, s.BuildPartial(now).Body.Cards.Count);
    }

    [Fact]
    public void Nothing_to_send_means_no_partial()
    {
        var s = NewSession();
        Assert.Null(s.State.PartialConfirmation);
        Assert.Throws<InvalidOperationException>(() => s.BuildPartial(new PartialSyncConfirmation(0, 0, 0)));
    }

    [Fact]
    public void Capture_time_comes_from_the_injected_clock()
    {
        var inv = new Synthetic(23);
        var clock = new TestClock();
        var s = NewSession(clock);
        s.Feed(inv.Page(0), inv.EmptyCells(0));
        clock.UtcNow += TimeSpan.FromSeconds(5);
        s.Feed(inv.Page(5), inv.EmptyCells(5));
        var t = clock.UtcNow;
        clock.UtcNow += TimeSpan.FromMinutes(1);
        s.Feed(inv.Page(5), inv.EmptyCells(5));                                                 // no change: capture time stays
        Assert.Equal(t, s.BuildFull().Body.CapturedAt);
    }
}
