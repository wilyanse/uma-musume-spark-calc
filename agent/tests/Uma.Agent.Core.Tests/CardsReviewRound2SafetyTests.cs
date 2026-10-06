using System.Net;
using System.Text;
using System.Text.Json;
using Uma.Agent.Core.Cards;
using Xunit;
using Xunit.Abstractions;
using static Uma.Agent.Core.Tests.CardsKit;

namespace Uma.Agent.Core.Tests;

// Synthetic inventories and fake HTTP only. No live account or generated captures.
public class CardsReviewRound2SafetyTests(ITestOutputHelper output)
{
    private static readonly TimeSpan Bound = TimeSpan.FromSeconds(5);
    private sealed class Token : IServiceToken { public (string ClientId, string ClientSecret) Read() => ("id", "memory-only"); }
    private sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) : HttpMessageHandler
    { protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct) => send(r, ct); }
    private static HttpResponseMessage Ack(int n, bool partial = true) => CardsUploaderTests.Json(HttpStatusCode.OK,
        $"{{\"count\":{n},\"partial\":{(partial ? "true" : "false")},\"syncedAt\":\"2026-10-03T00:00:00Z\"}}");
    private static OwnedCardsUploader Up(Handler h, Func<TimeSpan, CancellationToken, Task>? delay = null, string origin = "https://api.example.test/") =>
        new(new HttpClient(h), new Uri(origin), new Token(), null, new(3, TimeSpan.Zero, TimeSpan.Zero), delay ?? ((_, _) => Task.CompletedTask));
    private static OwnedCardsSyncPayload Partial(CardSyncSession s) => s.BuildPartial(s.State.PartialConfirmation!);
    private static CardSyncSession Scan(Synthetic inv, int start = 0)
    { var s = NewSession(); s.Feed(inv.Page(start), inv.EmptyCells(start)); return s; }
    private static ListTile Blank(ListTile t) => t with { Card = Reading.Missing(null, ""), Level = Reading.Missing(null, ""), Lb = Reading.Missing(null, "") };

    [Fact]
    public async Task Same_generation_20_fail3_collect25_sync25_stale20_never_replaces25()
    {
        var inv = new Synthetic(30); var s = Scan(inv); var older = Partial(s);
        var wire = new List<int>();
        var up = Up(new Handler(async (r, ct) => {
            int n = JsonDocument.Parse(await r.Content!.ReadAsStringAsync(ct)).RootElement.GetProperty("cards").GetArrayLength(); wire.Add(n);
            return wire.Count <= 3 ? CardsUploaderTests.Json(HttpStatusCode.ServiceUnavailable, "{}") : Ack(n);
        }));
        var c = new OwnedCardsUploadCoordinator(); var g = c.BeginGeneration();
        var failed = await c.SendAsync(g, up, older).WaitAsync(Bound);
        Assert.Equal(OwnedCardsUploadOutcome.Failed, failed.Outcome); Assert.Equal(3, failed.Attempts);
        s.Feed(inv.Page(5), inv.EmptyCells(5)); var newer = Partial(s);
        Assert.Equal(OwnedCardsUploadOutcome.Synced, (await c.SendAsync(g, up, newer).WaitAsync(Bound)).Outcome);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => c.SendAsync(g, up, older).WaitAsync(Bound));
        output.WriteLine($"wire=[{string.Join(",", wire)}]; final remote=25; stale20 refused");
        Assert.Equal(new[] { 20, 20, 20, 25 }, wire);
    }

    [Fact]
    public async Task Old_session_under_fresh_generation_cannot_bind_target_or_send()
    {
        var inv = new Synthetic(30); var old = Scan(inv); var current = Scan(inv); var p = Partial(old);
        var c = new OwnedCardsUploadCoordinator(); c.BeginGeneration(); var g = c.BeginGeneration();
        int calls = 0;
        var wrong = Up(new Handler((_, _) => { calls++; return Task.FromResult(Ack(20)); }), origin: "https://other.example.test/");
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => c.SendAsync(g, wrong, p).WaitAsync(Bound));
        var up = Up(new Handler((_, _) => { calls++; return Task.FromResult(Ack(20)); }));
        Assert.Equal(OwnedCardsUploadOutcome.Synced, (await c.SendAsync(g, up, Partial(current)).WaitAsync(Bound)).Outcome);
        Assert.Equal(1, calls); output.WriteLine("old session -> refused before target binding; current -> Synced; wire=[20]");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Cancel_or_reset_before_first_send_refuses_envelope_without_pinning_target(bool reset)
    {
        var inv = new Synthetic(30); var s = Scan(inv); var p = Partial(s);
        var c = new OwnedCardsUploadCoordinator(); var g = c.BeginGeneration();
        if (reset) { s.Reset(); s.Feed(inv.Page(0), inv.EmptyCells(0)); } else s.Cancel();
        int calls = 0;
        var wrong = Up(new Handler((_, _) => { calls++; return Task.FromResult(Ack(20)); }), origin: "https://other.example.test/");
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => c.SendAsync(g, wrong, p).WaitAsync(Bound));
        var current = Scan(inv); var fresh = c.BeginGeneration();
        var up = Up(new Handler((_, _) => { calls++; return Task.FromResult(Ack(20)); }));
        Assert.Equal(OwnedCardsUploadOutcome.Synced, (await c.SendAsync(fresh, up, Partial(current)).WaitAsync(Bound)).Outcome);
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task Current_revision_changed_before_first_send_is_refused()
    {
        var inv = new Synthetic(30); var s = Scan(inv); var old = Partial(s);
        var c = new OwnedCardsUploadCoordinator(); var g = c.BeginGeneration();
        s.Feed(inv.Page(5), inv.EmptyCells(5));
        int calls = 0; var up = Up(new Handler((_, _) => { calls++; return Task.FromResult(Ack(20)); }));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => c.SendAsync(g, up, old).WaitAsync(Bound));
        Assert.Equal(0, calls);
    }

    [Fact]
    public async Task Revision_change_while_inflight_stops_old_retry_before_queued_new_send()
    {
        var inv = new Synthetic(30); var s = Scan(inv); var old = Partial(s);
        var c = new OwnedCardsUploadCoordinator(); var g = c.BeginGeneration();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var wire = new List<int>();
        var up = Up(new Handler(async (r, ct) => {
            int n = JsonDocument.Parse(await r.Content!.ReadAsStringAsync(ct)).RootElement.GetProperty("cards").GetArrayLength(); wire.Add(n);
            if (wire.Count == 1) { entered.SetResult(); await release.Task.WaitAsync(Bound); return CardsUploaderTests.Json(HttpStatusCode.ServiceUnavailable, "{}"); }
            return Ack(n);
        }));
        var send = c.SendAsync(g, up, old); await entered.Task.WaitAsync(Bound);
        s.Feed(inv.Page(5), inv.EmptyCells(5)); var newer = c.SendAsync(g, up, Partial(s));
        Assert.False(newer.IsCompleted); release.SetResult();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => send.WaitAsync(Bound));
        Assert.Equal(OwnedCardsUploadOutcome.Synced, (await newer.WaitAsync(Bound)).Outcome);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => c.SendAsync(g, up, old).WaitAsync(Bound));
        output.WriteLine($"inflight update: wire=[{string.Join(",", wire)}]; final remote=25");
        Assert.Equal(new[] { 20, 25 }, wire);
    }

    [Fact]
    public async Task Revision_change_during_noncooperative_retry_delay_stops_next_attempt()
    {
        var inv = new Synthetic(30); var s = Scan(inv); var p = Partial(s);
        var c = new OwnedCardsUploadCoordinator(); var g = c.BeginGeneration();
        int calls = 0;
        var up = Up(new Handler((_, _) => { calls++; return Task.FromResult(CardsUploaderTests.Json(HttpStatusCode.ServiceUnavailable, "{}")); }),
            (_, _) => { s.Feed(inv.Page(5), inv.EmptyCells(5)); return Task.CompletedTask; });
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => c.SendAsync(g, up, p).WaitAsync(Bound));
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task Identical_current_payload_can_retry_after_bounded_failure_with_immutable_bytes()
    {
        var inv = new Synthetic(30); var s = Scan(inv); var p = Partial(s);
        var callerCards = p.Body.Cards.ToList(); var copy = new OwnedCardsSyncPayload(p.Body with { Cards = callerCards }, true); callerCards.Clear();
        var c = new OwnedCardsUploadCoordinator(); var g = c.BeginGeneration(); var bytes = new List<string>();
        var up = Up(new Handler(async (r, ct) => {
            bytes.Add(await r.Content!.ReadAsStringAsync(ct));
            return bytes.Count <= 3 ? CardsUploaderTests.Json(HttpStatusCode.ServiceUnavailable, "{}") : Ack(20);
        }));
        Assert.Equal(OwnedCardsUploadOutcome.Failed, (await c.SendAsync(g, up, copy).WaitAsync(Bound)).Outcome);
        s.Feed(inv.Page(0), inv.EmptyCells(0)); // identical refeed doesn't revoke a current envelope
        Assert.Equal(OwnedCardsUploadOutcome.Synced, (await c.SendAsync(g, up, copy).WaitAsync(Bound)).Outcome);
        Assert.Equal(4, bytes.Count); Assert.Single(bytes.Distinct()); Assert.DoesNotContain("provenance", bytes[0], StringComparison.OrdinalIgnoreCase);
        output.WriteLine("identical current payload: Failed(3), Synced(1); all four wire bodies identical");
    }

    [Fact]
    public async Task Double_rewrap_never_reseals_forged_body_but_valid_rewrap_stays_frozen()
    {
        var s = Scan(new Synthetic(30)); var p = Partial(s);
        var once = new OwnedCardsSyncPayload(p.Body with { HeldCount = 20 }, false);
        var twice = new OwnedCardsSyncPayload(once.Body, false);
        int calls = 0; var up = Up(new Handler((_, _) => { calls++; return Task.FromResult(Ack(20)); }));
        Assert.Equal(OwnedCardsUploadOutcome.Invalid, (await up.SendAsync(twice).WaitAsync(Bound)).Outcome);
        Assert.Equal(0, calls);
        var list = p.Body.Cards.ToList(); var valid = new OwnedCardsSyncPayload(new OwnedCardsSyncPayload(p.Body with { Cards = list }, true).Body, true); list.Clear();
        Assert.Equal(20, valid.Body.Cards.Count);
        Assert.Throws<NotSupportedException>(() => ((IList<OwnedCard>)valid.Body.Cards).Clear());
        Assert.Equal(OwnedCardsUploadOutcome.Synced, (await up.SendAsync(valid).WaitAsync(Bound)).Outcome); Assert.Equal(1, calls);
    }

    [Fact]
    public void Later_confirmed_empty_clears_two_unknown_trailing_cells()
    {
        var inv = new Synthetic(18); var s = NewSession(); s.Feed(inv.Page(0));
        Assert.Contains("2 tiles inside the scanned range were not read", s.State.Blockers); var rev = s.State.Revision;
        Assert.Equal(CardFeedOutcome.Collected, s.Feed(inv.Page(0), inv.EmptyCells(0)).Outcome);
        Assert.True(s.State.CanSendFull); Assert.Equal(18, s.BuildFull().Body.Cards.Count); Assert.True(s.State.Revision > rev);
        Assert.Equal(Enumerable.Range(0, 18), s.State.Cards.Select(c => c.Position));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(5)]
    public void Empty_over_earlier_read_cell_rejects_whole_frame_and_preserves_state(int start)
    {
        var inv = new Synthetic(25); var s = Scan(inv); s.Feed(inv.Page(5), inv.EmptyCells(5));
        Assert.True(s.State.CanSendFull); var before = s.BuildFull(); var state = s.State;
        var blank = inv.PageWith(start, (pos, t) => pos == 19 ? Blank(t) : t);
        Assert.Equal(CardFeedOutcome.Rejected, s.Feed(blank, new HashSet<int> { 19 - start }).Outcome);
        Assert.Equal(state.Revision, s.State.Revision); Assert.Equal(state.CapturedAt, s.State.CapturedAt);
        Assert.Equal(state.Cards, s.State.Cards); Assert.Equal(before.Body, s.BuildFull().Body);
    }

    [Fact]
    public void Synthetic20_empty_cell19_is_atomic_rejection_not_new_full_sync_evidence()
    {
        var inv = new Synthetic(20); var s = Scan(inv); var before = s.State;
        var blank = inv.PageWith(0, (pos, t) => pos == 19 ? Blank(t) : t);
        Assert.Equal(CardFeedOutcome.Rejected, s.Feed(blank, new HashSet<int> { 19 }).Outcome);
        Assert.Equal(before.Revision, s.State.Revision); Assert.Equal(before.Cards, s.State.Cards);
        // The previously valid full collection remains unchanged; the contradictory frame authorizes nothing new.
        Assert.Equal(20, s.BuildFull().Body.Cards.Count);
    }

    [Fact]
    public void Empty_clearing_aligns_across_out_of_order_scroll_without_guessing_holes()
    {
        var inv = new Synthetic(23); var s = NewSession(); s.Feed(inv.Page(5)); s.Feed(inv.Page(0));
        Assert.False(s.State.CanSendFull);
        Assert.Equal(CardFeedOutcome.Collected, s.Feed(inv.Page(5), inv.EmptyCells(5)).Outcome);
        Assert.True(s.State.CanSendFull); Assert.Equal(Enumerable.Range(0, 23), s.State.Cards.Select(c => c.Position));
        // An internal unobserved slot still remains a hole, even if some other cell is explicitly empty.
        var gap = NewSession(); var page = inv.PageWith(0, (pos, t) => pos == 10 ? Blank(t) : t); gap.Feed(page);
        Assert.False(gap.State.CanSendFull); Assert.Contains(gap.State.Blockers, b => b.Contains("not read"));
    }
}
