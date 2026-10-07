using System.Net;
using System.Text;
using System.Text.Json;
using Uma.Agent.Core;
using Uma.Agent.Core.Cards;
using Uma.Agent.Windows.Shell;
using Xunit;

namespace Uma.Agent.Windows.Portable.Tests;

/// <summary>Scripted owned-cards API (fake HTTP, NOT a live API). Records every request; by default answers with the
/// route's documented acknowledgement `200 {count, partial, syncedAt}` derived from the request it received
/// (apps/api/src/routes/owned-cards.ts).</summary>
internal sealed class CardsApi : HttpMessageHandler
{
    public sealed record Request(string Method, string PathAndQuery, string? ClientId, string? Secret, string Body);
    public List<Request> Requests { get; } = [];
    public Func<Request, CancellationToken, Task<HttpResponseMessage>>? Respond { get; set; }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
        var r = new Request(request.Method.Method, request.RequestUri!.PathAndQuery,
            request.Headers.TryGetValues("CF-Access-Client-Id", out var id) ? id.Single() : null,
            request.Headers.TryGetValues("CF-Access-Client-Secret", out var s) ? s.Single() : null, body);
        lock (Requests) Requests.Add(r);
        var response = Respond is null ? Ack(r) : await Respond(r, ct);
        response.RequestMessage ??= request;
        return response;
    }

    public static HttpResponseMessage Ack(Request r, int? count = null)
    {
        using var doc = JsonDocument.Parse(r.Body);
        var n = count ?? doc.RootElement.GetProperty("cards").GetArrayLength();
        var partial = r.PathAndQuery.EndsWith("?partial=1", StringComparison.Ordinal) ? "true" : "false";
        return StubApi.Json(HttpStatusCode.OK, $"{{\"count\":{n},\"partial\":{partial},\"syncedAt\":\"2026-10-07T01:02:03.000Z\"}}");
    }
}

/// <summary>Confirmation stand-in: records every prompt, answers from a queue (default No), and can run an action
/// while the "modal dialog" is open.</summary>
internal sealed class CardConfirm : IConfirm
{
    public List<(string Title, string Message)> Prompts { get; } = [];
    public Queue<bool> Answers { get; } = new();
    public Action? WhileOpen { get; set; }
    public bool Confirm(string title, string message)
    {
        Prompts.Add((title, message));
        WhileOpen?.Invoke(); WhileOpen = null;
        return Answers.Count > 0 && Answers.Dequeue();
    }
}

/// <summary>T10b: the shell's support-card integration, wired through the real <see cref="CapturePipeline"/> and the
/// reviewed Core Cards API (session, coordinator, uploader). Grounded inputs are the real fixtures 13/14 parsed with
/// recorded OCR; SYNTHETIC inputs (labelled) are made-up list frames over real master card IDs on a blank frame.
/// HTTP is a scripted fake handler; no live API is contacted.</summary>
public class CardShellIntegrationTests
{
    private static Repo R => Repo.Instance;
    private const string Secret = "SYNTHETIC-SECRET-do-not-log", ClientId = "SYNTHETIC-CLIENT-ID";
    private const string Marker = "SYNTHETIC-TRANSPORT-MARKER";
    private static readonly int[] Lb13 = [2, 4, 4, 4, 4, 0, 0, 1, 0, 4, 0, 4, 0, 4, 4, 0, 0, 4, 4, 0];

    private sealed class Rig : IDisposable
    {
        public string Dir { get; } = Temp.Dir();
        public TestClock Clock { get; } = new();
        public FrameDispatchOcr Ocr { get; } = new();
        public UploadOutbox Outbox { get; }
        public CapturePipeline Pipeline { get; }
        public ListLog Log { get; } = new();
        public CardsApi Api { get; } = new();
        public CardConfirm Confirm { get; } = new();
        public ServiceTokenStore Tokens { get; }
        public AgentSettings Settings { get; set; } = new("https://uma.example.test/", "Game", "");
        public List<TimeSpan> Delays { get; } = [];
        public Action? OnDelay { get; set; }
        public CardSyncController Cards { get; }
        public Rig(bool token = true)
        {
            Outbox = new UploadOutbox(Path.Combine(Dir, "outbox.db"), Clock);
            Tokens = new ServiceTokenStore(Path.Combine(Dir, "service-token.bin"), new XorProtector());
            if (token) Tokens.Save(ClientId, Secret);
            Cards = new CardSyncController(R.Data, Clock, () => Settings, Tokens, () => Api, Confirm, Log,
                new OwnedCardsRetryPolicy(3, TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(30)),
                (d, ct) => { Delays.Add(d); OnDelay?.Invoke(); return Task.CompletedTask; });
            Pipeline = new CapturePipeline(R.Data, Ocr, Outbox, Clock, new UlidGenerator(Clock, Seeded.Bytes(42)), "t10b-test", new FrameGate(Clock, TimeSpan.FromSeconds(2)), Log, Cards);
        }
        public Frame Fixture(string name) { var f = R.Frame(name); Ocr.Add(f, R.Ocr(name)); return f; }
        public async Task<PipelineEvent> Process(string name) { Clock.UtcNow += TimeSpan.FromSeconds(3); return await Pipeline.ProcessAsync(Fixture(name), CancellationToken.None); }
        public void Dispose() => Temp.Drop(Dir);
    }

    private static readonly Lazy<ParsedFrame> List13 = new(() => R.Parser("13-support-card-list").ParseAsync(R.Frame("13-support-card-list")).GetAwaiter().GetResult());

    // ---------- SYNTHETIC frames ----------
    private static readonly Frame Blank = new(new byte[1920 * 1080 * 4], 1920, 1080);
    private static string[] Ids(int n, int skip = 0) => R.Data.Master.Ids["cards"].Order(StringComparer.Ordinal).Skip(skip).Take(n).ToArray();
    private static ListTile Tile(int index, string id, int lb = 1, int level = 30)
        => new(index, new Reading(id, "SYNTHETIC dhash", 0.95, true, [new Candidate(id, 0.95)], null),
            new Reading(lb, null, 1, true, [], null), new Reading(level, "Lvl " + level, 0.9, true, [], null));
    /// <summary>SYNTHETIC cards.list frame: tiles 0..n-1 of the given IDs, Held as given.</summary>
    private static ParsedFrame SyntheticList(IReadOnlyList<string> ids, int held)
        => new(new ScreenClassification(ScreenId.CardsList, "cards.list", 0, 1, "SYNTHETIC"), Blank, null)
        {
            HeldCount = new Reading(held, $"{held}/255", 0.9, true, [], null),
            ListTiles = ids.Select((id, i) => Tile(i, id)).ToArray(),
        };

    private static async Task<CardScanView> ScanFixture13(Rig rig)
    {
        rig.Cards.BeginScan();
        var e = await rig.Process("13-support-card-list");
        Assert.Equal(PipelineEventKind.CardScreen, e.Kind);
        Assert.Contains("Collected", e.Message);
        return rig.Cards.View!;
    }

    // ---------- delegation through the real capture/OCR path ----------

    [Fact]
    public async Task Fixture_13_through_the_pipeline_collects_20_of_Held_208_and_is_only_partial()
    {
        using var rig = new Rig();
        var view = await ScanFixture13(rig);
        var s = view.State;
        Assert.Equal(208, s.HeldCount);
        Assert.Equal(20, s.Cards.Count);
        Assert.Equal(Lb13, s.Cards.OrderBy(c => c.Position).Select(c => c.Lb));
        Assert.False(s.CanSendFull);                         // never claim full on fixture 13
        Assert.Contains(s.Blockers, b => b.Contains("20 of 208", StringComparison.Ordinal));
        Assert.Equal((20, 208), (s.PartialConfirmation!.Cards, s.PartialConfirmation.HeldCount));
        // Card frames never become veteran evidence or outbox rows.
        Assert.Equal(new RetainedEvidence(0, 0, 0), rig.Pipeline.Retained);
        Assert.Empty(rig.Outbox.Snapshot());
        Assert.Contains("Full sync NOT available", CardSyncText.Describe(view, true, null));
        Assert.Contains("REPLACES the entire stored list", CardSyncText.Describe(view, true, null));
    }

    [Fact]
    public async Task Fixture_14_detail_through_the_pipeline_resolves_a_demoted_fixture_13_tile()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan();
        // Real parse of fixture 13 with tile 0's art reading demoted (SYNTHETIC demotion of a real reading).
        var demoted = List13.Value with { ListTiles = List13.Value.ListTiles.Select(t => t.Index == 0 ? t with { Card = t.Card with { Ok = false } } : t).ToArray() };
        Assert.Equal(PipelineEventKind.CardScreen, rig.Pipeline.Accept(demoted).Kind);
        var pending = Assert.Single(rig.Cards.View!.State.Pending);
        Assert.Equal(19, rig.Cards.View!.State.Cards.Count);
        var e = await rig.Process("14-support-card-detail");     // real capture/OCR path, real detail parse
        Assert.Contains("DetailBound", e.Message);
        var s = rig.Cards.View!.State;
        Assert.Empty(s.Pending);
        Assert.Equal(20, s.Cards.Count);
        Assert.Contains(s.Cards, c => c.Position == pending.Position && c.CardId == "card:the-brightest-star-in-japan-special-week" && c.Source == "detail");
    }

    [Fact]
    public async Task Selecting_a_pending_tile_binds_through_the_view_and_refuses_a_stale_view()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan();
        var demoted = List13.Value with { ListTiles = List13.Value.ListTiles.Select(t => t.Index == 0 ? t with { Card = t.Card with { Ok = false } } : t).ToArray() };
        rig.Pipeline.Accept(demoted);
        var view = rig.Cards.View!;
        var id = Assert.Single(view.State.Pending).Id;
        Assert.True(rig.Cards.SelectPending(view, id));
        Assert.Equal(id, rig.Cards.View!.State.AwaitingDetailFor);
        Assert.False(rig.Cards.SelectPending(view, id));   // the selection itself advanced the revision: old view is stale
        rig.Cards.BeginScan();
        Assert.False(rig.Cards.SelectPending(rig.Cards.View!, id));   // not a tile of the new scan
    }

    // ---------- full / partial eligibility and destructive confirmation ----------

    [Fact]
    public async Task Full_send_is_refused_for_a_partial_collection_without_prompt_or_request()
    {
        using var rig = new Rig();
        var view = await ScanFixture13(rig);
        var r = await rig.Cards.SendFullAsync(view);
        Assert.Equal(CardSendStatus.NotEligible, r.Status);
        Assert.Contains("20 of 208", r.Message);
        Assert.Empty(rig.Confirm.Prompts);
        Assert.Empty(rig.Api.Requests);
    }

    [Fact]
    public async Task Partial_shows_a_destructive_warning_and_cancel_sends_nothing()
    {
        using var rig = new Rig();
        var view = await ScanFixture13(rig);
        var r = await rig.Cards.SendPartialAsync(view);          // default answer: No
        Assert.Equal(CardSendStatus.Cancelled, r.Status);
        Assert.Empty(rig.Api.Requests);
        var (title, message) = Assert.Single(rig.Confirm.Prompts);
        Assert.Contains("DESTRUCTIVE", title);
        Assert.Contains("ENTIRE", title);
        Assert.Contains(view.State.PartialConfirmation!.Message, message);   // Core's exact Q-150 message
        Assert.Contains("does NOT merge", message);
        Assert.Contains("20 of Held 208", message);
        Assert.Contains("https://uma.example.test/", message);
        Assert.Null(rig.Cards.View!.LastSync);
    }

    [Fact]
    public async Task Confirmed_partial_is_a_single_acknowledged_PUT_with_the_partial_flag_and_service_token()
    {
        using var rig = new Rig();
        var view = await ScanFixture13(rig);
        rig.Confirm.Answers.Enqueue(true);
        var r = await rig.Cards.SendPartialAsync(view);
        Assert.Equal(CardSendStatus.Synced, r.Status);
        Assert.Equal((20, true), (r.Ack!.Count, r.Ack.Partial));
        var req = Assert.Single(rig.Api.Requests);
        Assert.Equal(("PUT", "/api/v1/owned-cards?partial=1", ClientId, Secret), (req.Method, req.PathAndQuery, req.ClientId, req.Secret));
        var body = OwnedCardsSyncJson.Deserialize(req.Body);
        Assert.Equal(208, body.HeldCount);
        Assert.Equal(20, body.Cards.Count);
        Assert.Equal(R.Data.Master.Version, body.MasterVersion);
        Assert.True(rig.Cards.View!.SyncedCurrent);
        Assert.Contains("PARTIAL", r.Message);
        Assert.DoesNotContain(rig.Log.Lines, l => l.Contains(Secret, StringComparison.Ordinal) || l.Contains(ClientId, StringComparison.Ordinal));
        Assert.DoesNotContain(Secret, r.Message);
        Assert.Empty(rig.Outbox.Snapshot());   // no durable card queue; veteran outbox untouched
    }

    [Fact]
    public async Task Complete_scan_sends_full_without_the_partial_flag_and_partial_is_refused()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan();
        var ids = Ids(5);
        rig.Pipeline.Accept(SyntheticList(ids, 5));   // SYNTHETIC: 5 accepted tiles, Held 5
        var view = rig.Cards.View!;
        Assert.True(view.State.CanSendFull);
        Assert.Equal(CardSendStatus.NotEligible, (await rig.Cards.SendPartialAsync(view)).Status);
        Assert.Empty(rig.Confirm.Prompts);
        rig.Confirm.Answers.Enqueue(true);
        var r = await rig.Cards.SendFullAsync(view);
        Assert.Equal(CardSendStatus.Synced, r.Status);
        Assert.Equal("/api/v1/owned-cards", Assert.Single(rig.Api.Requests).PathAndQuery);
        Assert.False(r.Ack!.Partial);
        Assert.Equal(ids, OwnedCardsSyncJson.Deserialize(rig.Api.Requests[0].Body).Cards.Select(c => c.CardId));
    }

    [Fact]
    public async Task A_full_view_changed_during_its_confirmation_is_not_sent_even_if_still_full()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan();
        var ids = Ids(5);
        rig.Pipeline.Accept(SyntheticList(ids, 5));
        var view = rig.Cards.View!;
        Assert.True(view.State.CanSendFull);
        // SYNTHETIC: the same 5 cards re-read with a higher art confidence: still full, but a new revision whose body
        // (confidence) differs from what the user confirmed.
        var higher = SyntheticList(ids, 5) with { ListTiles = SyntheticList(ids, 5).ListTiles.Select(t => t with { Card = t.Card with { Confidence = 0.99 }, Level = t.Level with { Confidence = 0.99 } }).ToArray() };
        rig.Confirm.Answers.Enqueue(true);
        rig.Confirm.WhileOpen = () => rig.Pipeline.Accept(higher);
        var r = await rig.Cards.SendFullAsync(view);
        Assert.True(rig.Cards.View!.State.CanSendFull);
        Assert.True(rig.Cards.View!.State.Revision > view.State.Revision);
        Assert.Equal(CardSendStatus.Stale, r.Status);
        Assert.Empty(rig.Api.Requests);
    }

    [Fact]
    public async Task Without_address_or_token_nothing_is_prompted_or_sent()
    {
        using var rig = new Rig(token: false);
        var view = await ScanFixture13(rig);
        Assert.Equal(CardSendStatus.NotConfigured, (await rig.Cards.SendPartialAsync(view)).Status);
        rig.Tokens.Save(ClientId, Secret);
        rig.Settings = rig.Settings with { ApiBaseUrl = "" };
        Assert.Equal(CardSendStatus.NotConfigured, (await rig.Cards.SendPartialAsync(rig.Cards.View!)).Status);
        Assert.Empty(rig.Confirm.Prompts);
        Assert.Empty(rig.Api.Requests);
    }

    // ---------- stale views: changed session / revision ----------

    [Fact]
    public async Task A_view_older_than_the_current_revision_is_refused_before_prompt_and_transport()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan();
        rig.Pipeline.Accept(SyntheticList(Ids(5), 10));
        var old = rig.Cards.View!;
        rig.Pipeline.Accept(SyntheticList(Ids(6), 10));   // SYNTHETIC: a sixth card appears in the next frame
        Assert.True(rig.Cards.View!.State.Revision > old.State.Revision);
        rig.Confirm.Answers.Enqueue(true);
        var r = await rig.Cards.SendPartialAsync(old);
        Assert.Equal(CardSendStatus.Stale, r.Status);
        Assert.Empty(rig.Confirm.Prompts);
        Assert.Empty(rig.Api.Requests);
    }

    [Fact]
    public async Task A_frame_arriving_while_the_confirmation_is_open_makes_the_confirmed_view_stale()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan();
        rig.Pipeline.Accept(SyntheticList(Ids(5), 10));
        var view = rig.Cards.View!;
        rig.Confirm.Answers.Enqueue(true);
        rig.Confirm.WhileOpen = () => rig.Pipeline.Accept(SyntheticList(Ids(6), 10));
        var r = await rig.Cards.SendPartialAsync(view);
        Assert.Equal(CardSendStatus.Stale, r.Status);
        Assert.Single(rig.Confirm.Prompts);
        Assert.Empty(rig.Api.Requests);
        // The current view needs its own confirmation (6 cards, not the 5 confirmed).
        rig.Confirm.Answers.Enqueue(true);
        Assert.Equal(CardSendStatus.Synced, (await rig.Cards.SendPartialAsync(rig.Cards.View!)).Status);
        Assert.Contains("Send 6 of 10", rig.Confirm.Prompts[1].Message);
        Assert.Equal(6, OwnedCardsSyncJson.Deserialize(Assert.Single(rig.Api.Requests).Body).Cards.Count);
    }

    [Theory]
    [InlineData("new-scan")]
    [InlineData("reset")]
    [InlineData("cancel")]
    public async Task Views_of_a_replaced_reset_or_cancelled_scan_are_refused(string change)
    {
        using var rig = new Rig();
        rig.Cards.BeginScan();
        rig.Pipeline.Accept(SyntheticList(Ids(5), 10));
        var view = rig.Cards.View!;
        switch (change)
        {
            case "new-scan": rig.Cards.BeginScan(); rig.Pipeline.Accept(SyntheticList(Ids(5), 10)); break;   // identical content, new scan
            case "reset": Assert.NotNull(rig.Cards.Reset(view)); rig.Pipeline.Accept(SyntheticList(Ids(5), 10)); break;
            case "cancel": Assert.True(rig.Cards.Cancel(view)); break;
        }
        rig.Confirm.Answers.Enqueue(true);
        var r = await rig.Cards.SendPartialAsync(view);
        Assert.Equal(CardSendStatus.Stale, r.Status);
        Assert.Contains("replaced, reset or cancelled", r.Message);   // refused as another scan, not merely a revision
        Assert.Empty(rig.Api.Requests);
        Assert.Empty(rig.Confirm.Prompts);
        Assert.Null(rig.Cards.Reset(view));     // an old view cannot reset the replacement either
        Assert.False(rig.Cards.Cancel(view));
        if (change == "cancel") Assert.Null(rig.Cards.Feed(SyntheticList(Ids(5), 10)));   // nothing is collected after cancel
        else Assert.Equal(5, rig.Cards.View!.State.Cards.Count);
    }

    // ---------- in-flight, auth, bad ACK, network ----------

    [Fact]
    public async Task A_second_send_while_one_is_in_flight_is_refused_without_a_request()
    {
        using var rig = new Rig();
        var view = await ScanFixture13(rig);
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        rig.Api.Respond = async (r, _) => { entered.TrySetResult(); await release.Task; return CardsApi.Ack(r); };
        rig.Confirm.Answers.Enqueue(true); rig.Confirm.Answers.Enqueue(true);
        var first = rig.Cards.SendPartialAsync(view);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.True(rig.Cards.Sending);
        Assert.True(rig.Cards.View!.Sending);
        var second = await rig.Cards.SendPartialAsync(rig.Cards.View!).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(CardSendStatus.Busy, second.Status);
        Assert.Single(rig.Confirm.Prompts);   // the refused send never asked
        release.SetResult();
        Assert.Equal(CardSendStatus.Synced, (await first.WaitAsync(TimeSpan.FromSeconds(5))).Status);
        Assert.Single(rig.Api.Requests);
        Assert.False(rig.Cards.Sending);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.Found)]
    public async Task Auth_refusal_is_not_retried_and_points_to_Settings(HttpStatusCode code)
    {
        using var rig = new Rig();
        var view = await ScanFixture13(rig);
        rig.Api.Respond = (_, _) => Task.FromResult(new HttpResponseMessage(code) { Content = new StringContent("<html>" + Marker + "</html>", Encoding.UTF8, "text/html") });
        rig.Confirm.Answers.Enqueue(true);
        var r = await rig.Cards.SendPartialAsync(view);
        Assert.Equal(CardSendStatus.AuthRequired, r.Status);
        Assert.Contains("Settings", r.Message);
        Assert.Single(rig.Api.Requests);
        Assert.Empty(rig.Delays);
        Assert.Null(rig.Cards.View!.LastSync);
        Assert.DoesNotContain(Marker, r.Message);
        // After the token is repaired the user sends again from the SAME unchanged scan (asked again).
        rig.Api.Respond = null;
        rig.Confirm.Answers.Enqueue(true);
        Assert.Equal(CardSendStatus.Synced, (await rig.Cards.SendPartialAsync(rig.Cards.View!)).Status);
        Assert.Equal(2, rig.Confirm.Prompts.Count);
        Assert.Equal(rig.Api.Requests[0].Body, rig.Api.Requests[1].Body);
    }

    [Fact]
    public async Task A_bad_acknowledgement_retries_boundedly_is_never_reported_synced_and_has_no_background_retry()
    {
        using var rig = new Rig();
        var view = await ScanFixture13(rig);
        rig.Api.Respond = (r, _) => Task.FromResult(CardsApi.Ack(r, count: 19));   // 200, but not the documented ack
        rig.Confirm.Answers.Enqueue(true);
        var r = await rig.Cards.SendPartialAsync(view);
        Assert.Equal(CardSendStatus.Failed, r.Status);
        Assert.Equal(3, rig.Api.Requests.Count);                    // the injected policy's bound
        Assert.Equal(2, rig.Delays.Count);
        Assert.Contains("unexpected-response", r.Message);
        Assert.Contains("may or may not", r.Message);
        Assert.Null(rig.Cards.View!.LastSync);
        await Task.Delay(50);
        Assert.Equal(3, rig.Api.Requests.Count);                    // nothing re-sends by itself
    }

    [Fact]
    public async Task Network_errors_are_shown_and_logged_as_categories_only()
    {
        using var rig = new Rig();
        var view = await ScanFixture13(rig);
        rig.Api.Respond = (_, _) => throw new HttpRequestException(Marker + " " + Secret);
        rig.Confirm.Answers.Enqueue(true);
        var r = await rig.Cards.SendPartialAsync(view);
        Assert.Equal(CardSendStatus.Failed, r.Status);
        Assert.Equal(3, rig.Api.Requests.Count);
        Assert.Contains("HttpRequestException", r.Message);
        Assert.DoesNotContain(Marker, r.Message);
        Assert.DoesNotContain(Secret, r.Message);
        Assert.DoesNotContain(rig.Log.Lines, l => l.Contains(Marker, StringComparison.Ordinal) || l.Contains(Secret, StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_422_rejection_is_not_retried_and_shows_sanitized_problem_paths()
    {
        using var rig = new Rig();
        var view = await ScanFixture13(rig);
        rig.Api.Respond = (_, _) => Task.FromResult(StubApi.Json(HttpStatusCode.UnprocessableEntity, "{\"errors\":[{\"path\":\"/cards/0/cardId\",\"message\":\"unknown\\nid\"}]}"));
        rig.Confirm.Answers.Enqueue(true);
        var r = await rig.Cards.SendPartialAsync(view);
        Assert.Equal(CardSendStatus.Rejected, r.Status);
        Assert.Single(rig.Api.Requests);
        Assert.Contains("/cards/0/cardId: unknown id", r.Message);
    }

    [Fact]
    public async Task A_frame_during_the_retry_delay_stops_the_next_attempt()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan();
        rig.Pipeline.Accept(SyntheticList(Ids(5), 10));
        rig.Api.Respond = (_, _) => Task.FromResult(StubApi.Status(HttpStatusCode.ServiceUnavailable));
        rig.OnDelay = () => { rig.Pipeline.Accept(SyntheticList(Ids(6), 10)); rig.OnDelay = null; };
        rig.Confirm.Answers.Enqueue(true);
        var r = await rig.Cards.SendPartialAsync(rig.Cards.View!);
        Assert.Equal(CardSendStatus.Stale, r.Status);
        Assert.Single(rig.Api.Requests);   // no stale second attempt
        Assert.Contains("cannot be undone", r.Message);
    }

    // ---------- freshness after a newer sync ----------

    [Fact]
    public async Task After_a_newer_sync_an_older_view_cannot_be_resent()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan();
        rig.Pipeline.Accept(SyntheticList(Ids(5), 10));
        var older = rig.Cards.View!;
        rig.Api.Respond = (_, _) => Task.FromResult(StubApi.Status(HttpStatusCode.ServiceUnavailable));
        rig.Confirm.Answers.Enqueue(true);
        Assert.Equal(CardSendStatus.Failed, (await rig.Cards.SendPartialAsync(older)).Status);
        rig.Pipeline.Accept(SyntheticList(Ids(8), 10));
        rig.Api.Respond = null;
        rig.Confirm.Answers.Enqueue(true);
        var newer = rig.Cards.View!;
        Assert.Equal(CardSendStatus.Synced, (await rig.Cards.SendPartialAsync(newer)).Status);
        var before = rig.Api.Requests.Count;
        rig.Confirm.Answers.Enqueue(true);
        Assert.Equal(CardSendStatus.Stale, (await rig.Cards.SendPartialAsync(older)).Status);   // stale 5-card retry refused
        Assert.Equal(before, rig.Api.Requests.Count);
        Assert.Equal(8, OwnedCardsSyncJson.Deserialize(rig.Api.Requests[^1].Body).Cards.Count);
        Assert.True(rig.Cards.View!.SyncedCurrent);
        rig.Pipeline.Accept(SyntheticList(Ids(9), 10));
        var after = rig.Cards.View!;
        Assert.False(after.SyncedCurrent);
        Assert.Equal(8, after.LastSync!.Count);
        Assert.Contains("the current one is not synced", CardSyncText.Describe(after, true, null));
    }

    [Fact]
    public async Task Changing_the_API_destination_cancels_the_scan_instead_of_sending_it_elsewhere()
    {
        using var rig = new Rig();
        var view = await ScanFixture13(rig);
        rig.Confirm.Answers.Enqueue(true);
        Assert.Equal(CardSendStatus.Synced, (await rig.Cards.SendPartialAsync(view)).Status);
        rig.Settings = rig.Settings with { ApiBaseUrl = "https://other.example.test/" };
        rig.Confirm.Answers.Enqueue(true);
        var r = await rig.Cards.SendPartialAsync(rig.Cards.View!);
        Assert.Equal(CardSendStatus.Stale, r.Status);
        Assert.Contains("destination changed", r.Message);
        Assert.Single(rig.Api.Requests);
        Assert.Null(rig.Cards.View);
        // A new scan for the new destination works through a fresh coordinator.
        rig.Cards.BeginScan();
        await rig.Process("13-support-card-list");
        rig.Confirm.Answers.Enqueue(true);
        Assert.Equal(CardSendStatus.Synced, (await rig.Cards.SendPartialAsync(rig.Cards.View!)).Status);
        Assert.Equal(2, rig.Api.Requests.Count);
    }

    // ---------- Stop / Start / Exit and veteran safeguards ----------

    [Fact]
    public async Task Exit_asks_about_unsynced_cards_and_stops_an_in_flight_send()
    {
        using var rig = new Rig();
        Assert.Null(rig.Cards.ExitQuestion());
        var view = await ScanFixture13(rig);
        Assert.Contains("20 collected", rig.Cards.ExitQuestion()!.Message);
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        rig.Api.Respond = async (r, ct) =>
        {
            entered.TrySetResult();
            await Task.Delay(TimeSpan.FromSeconds(30), ct);   // cooperative transport, like SocketsHttpHandler
            return CardsApi.Ack(r);
        };
        rig.Confirm.Answers.Enqueue(true);
        var send = rig.Cards.SendPartialAsync(view);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Contains("cannot undo", rig.Cards.ExitQuestion()!.Message);
        await rig.Cards.ShutdownAsync().WaitAsync(TimeSpan.FromSeconds(10));
        var r = await send.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(CardSendStatus.Cancelled, r.Status);
        Assert.Single(rig.Api.Requests);
        Assert.Null(rig.Cards.View);
        Assert.Null(rig.Cards.Feed(List13.Value));
        Assert.Throws<InvalidOperationException>(() => rig.Cards.BeginScan());
        Assert.Equal(CardSendStatus.Cancelled, (await rig.Cards.SendPartialAsync(view)).Status);
        Assert.Single(rig.Api.Requests);
        Assert.Null(rig.Cards.ExitQuestion());
    }

    [Fact]
    public async Task A_scan_started_after_the_destination_changed_sends_to_the_new_destination()
    {
        using var rig = new Rig();
        var view = await ScanFixture13(rig);
        rig.Confirm.Answers.Enqueue(true);
        Assert.Equal(CardSendStatus.Synced, (await rig.Cards.SendPartialAsync(view)).Status);
        rig.Settings = rig.Settings with { ApiBaseUrl = "https://other.example.test/" };
        rig.Cards.BeginScan();
        Assert.Equal(PipelineEventKind.CardScreen, (await rig.Process("13-support-card-list")).Kind);
        rig.Confirm.Answers.Enqueue(true);
        Assert.Equal(CardSendStatus.Synced, (await rig.Cards.SendPartialAsync(rig.Cards.View!)).Status);
        Assert.Contains("https://other.example.test/", rig.Confirm.Prompts[^1].Message);
        Assert.Equal(2, rig.Api.Requests.Count);
    }

    [Fact]
    public async Task Replacing_an_unsynced_scan_asks_and_a_still_list_is_reread_by_the_new_scan()
    {
        using var rig = new Rig();
        Assert.Null(rig.Cards.ReplaceQuestion());
        await ScanFixture13(rig);
        Assert.Contains("not synced", rig.Cards.ReplaceQuestion()!.Message);
        rig.Cards.BeginScan();
        Assert.Empty(rig.Cards.View!.State.Cards);
        // The SAME still frame (byte-identical, within the gate refresh) is read again for the new scan.
        rig.Clock.UtcNow += TimeSpan.FromMilliseconds(250);
        Assert.Equal(PipelineEventKind.CardScreen, (await rig.Pipeline.ProcessAsync(rig.Fixture("13-support-card-list"), CancellationToken.None)).Kind);
        Assert.Equal(20, rig.Cards.View!.State.Cards.Count);
        rig.Clock.UtcNow += TimeSpan.FromMilliseconds(250);
        Assert.Equal(PipelineEventKind.Skipped, (await rig.Pipeline.ProcessAsync(rig.Fixture("13-support-card-list"), CancellationToken.None)).Kind);
    }

    [Fact]
    public async Task Stop_and_Start_watching_keep_the_card_scan_and_never_add_veteran_drop_prompts()
    {
        using var rig = new Rig();
        var view = await ScanFixture13(rig);
        var flushed = rig.Pipeline.Flush();                 // Stop
        Assert.Empty(flushed);
        Assert.Null(DropGuard.Check(flushed, DropGuard.Action.Start));
        // Start: a fresh pipeline shares the shell's card controller; the scan and its view stay current.
        var restarted = new CapturePipeline(R.Data, rig.Ocr, rig.Outbox, rig.Clock, new UlidGenerator(rig.Clock, Seeded.Bytes(9)), "t10b-test", new FrameGate(rig.Clock, TimeSpan.FromSeconds(2)), rig.Log, rig.Cards);
        rig.Clock.UtcNow += TimeSpan.FromSeconds(3);
        Assert.Equal(PipelineEventKind.CardScreen, (await restarted.ProcessAsync(rig.Fixture("13-support-card-list"), CancellationToken.None)).Kind);
        Assert.Equal(view.State.Revision, rig.Cards.View!.State.Revision);   // identical re-read is a no-op
        rig.Confirm.Answers.Enqueue(true);
        Assert.Equal(CardSendStatus.Synced, (await rig.Cards.SendPartialAsync(view)).Status);
        Assert.Empty(rig.Outbox.Snapshot());
    }

    [Fact]
    public async Task A_synced_scan_does_not_prompt_at_exit()
    {
        using var rig = new Rig();
        var view = await ScanFixture13(rig);
        rig.Confirm.Answers.Enqueue(true);
        await rig.Cards.SendPartialAsync(view);
        Assert.Null(rig.Cards.ExitQuestion());
    }

    [Fact]
    public async Task Card_screens_between_veteran_tabs_do_not_disturb_the_veteran_capture_or_its_queue()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan();
        foreach (var n in Repo.McQueen.Take(4)) await rig.Process(n);
        var before = rig.Pipeline.Progress!;
        var retained = rig.Pipeline.Retained;
        Assert.Equal(PipelineEventKind.CardScreen, (await rig.Process("13-support-card-list")).Kind);
        Assert.Equal(PipelineEventKind.CardScreen, (await rig.Process("14-support-card-detail")).Kind);
        Assert.Equal(retained, rig.Pipeline.Retained);           // no frame retained for card screens
        foreach (var n in Repo.McQueen.Skip(4)) await rig.Process(n);
        var after = rig.Pipeline.Progress!;
        Assert.Equal(before.IdentityKey, after.IdentityKey);    // still the same veteran session
        Assert.Equal(20, rig.Cards.View!.State.Cards.Count);
        var flushed = rig.Pipeline.Flush();
        Assert.Equal(PipelineEventKind.NotUploadable, Assert.Single(flushed).Kind);   // same completeness rule as before (Skills unscrolled)
        Assert.Empty(rig.Outbox.Snapshot());
    }

    [Fact]
    public void While_veteran_collection_is_paused_card_frames_are_not_fed()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan();
        // SYNTHETIC: a veteran whose enqueue fails pauses the pipeline (same mechanism as MemoryBoundTests).
        var parsed = Repo.McQueen.Append(Repo.SpecialWeekPopup).Append(Repo.OperaPopup)
            .Select(n => R.Parser(n).ParseAsync(R.Frame(n)).GetAwaiter().GetResult()).ToList();
        parsed[0] = parsed[0] with { Thumb = new ScrollThumb(R.Data.Layout.Int("scrollbar", "trackTop"), R.Data.Layout.Int("scrollbar", "trackBottom")) };
        foreach (var p in parsed) rig.Pipeline.Accept(p);
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        var db = Path.Combine(rig.Dir, "outbox.db");
        var aside = db + ".aside"; Directory.CreateDirectory(aside);
        foreach (var f in Directory.GetFiles(rig.Dir, "outbox.db*").Where(f => !f.EndsWith(".aside", StringComparison.Ordinal))) File.Move(f, Path.Combine(aside, Path.GetFileName(f)));
        Directory.CreateDirectory(db);
        Assert.Equal(PipelineEventKind.Failed, Assert.Single(rig.Pipeline.Flush()).Kind);
        var revision = rig.Cards.View!.State.Revision;
        var e = rig.Pipeline.Accept(List13.Value);
        Assert.Equal(PipelineEventKind.Failed, e.Kind);                     // paused: unsaved veteran first
        Assert.Equal(revision, rig.Cards.View!.State.Revision);           // card scan untouched
        Assert.Empty(rig.Cards.View!.State.Cards);
        Assert.Single(rig.Pipeline.PendingResults);
    }

    [Fact]
    public void Card_integration_source_has_no_durable_card_queue_or_outbox_use()
    {
        var text = File.ReadAllText(Path.Combine(Repo.Root, "agent/src/Uma.Agent.Windows/Portable/CardSyncController.cs"));
        Assert.DoesNotContain("UploadOutbox", text);
        Assert.DoesNotContain("Enqueue", text);
        Assert.DoesNotContain("File.", text);
        Assert.Contains("OwnedCardsUploadCoordinator", text);
        Assert.Contains("BeginGeneration", text);
    }
}

/// <summary>T10 r3 S1/S2: transient capture-source errors recover on valid frames; durable notices stay.</summary>
public class CaptureStatusRecoveryTests
{
    private static Repo R => Repo.Instance;

    [Theory]
    [InlineData(PipelineEventKind.Progress)]
    [InlineData(PipelineEventKind.Queued)]
    [InlineData(PipelineEventKind.AlreadyQueued)]
    [InlineData(PipelineEventKind.CardScreen)]
    [InlineData(PipelineEventKind.Skipped)]        // T10b r1 B2: geometry is validated before the frame gate
    [InlineData(PipelineEventKind.Ignored)]
    [InlineData(PipelineEventKind.NotUploadable)]
    [InlineData(PipelineEventKind.Limit)]
    public void A_valid_event_clears_a_transient_capture_error(PipelineEventKind kind)
    {
        var s = new CaptureStatusModel();
        s.Apply(new(PipelineEventKind.Unsupported, "game client area 1280x720 is below 1920x1080"));
        Assert.Contains("1920x1080", s.Error);
        s.Apply(new(PipelineEventKind.Unsupported, "game client area 1280x720 is below 1920x1080"));
        Assert.NotNull(s.Error);                                  // a still-invalid frame keeps it
        s.Apply(new(PipelineEventKind.Failed, "paused"));
        Assert.NotNull(s.Error);                                  // a paused pipeline never looked at the frame
        s.Apply(new(kind, "ok"));
        Assert.Null(s.Error);
        s.ReportCaptureError("The game window is not available.");
        Assert.Equal("The game window is not available.", s.Error);
        s.Apply(new(kind, "ok"));
        Assert.Null(s.Error);
    }

    [Fact]
    public void Recovery_never_clears_durable_unsaved_or_overflow_notices()
    {
        var s = new CaptureStatusModel();
        CaptureNotice[] durable = [new(CaptureNoticeKind.Unsaved, "not saved"), new(CaptureNoticeKind.Overflow, "limit")];
        s.Apply(new(PipelineEventKind.Failed, "not saved", Notices: durable));
        s.ReportCaptureError("window unavailable");
        Assert.Contains("not saved", s.Error);                     // durable notices take precedence
        s.Apply(new(PipelineEventKind.Progress, "scroll", Notices: durable));
        Assert.Null(s.Transient);
        Assert.Contains("not saved", s.Error); Assert.Contains("limit", s.Error);
        s.Apply(new(PipelineEventKind.Queued, "queued", Notices: durable[1..]));
        Assert.Equal("limit", s.Error);
    }

    [Fact]
    public async Task Wired_pipeline_resize_then_valid_frame_returns_to_capturing()
    {
        var dir = Temp.Dir();
        try
        {
            var clock = new TestClock();
            var ocr = new FrameDispatchOcr();
            var outbox = new UploadOutbox(Path.Combine(dir, "outbox.db"), clock);
            var pipeline = new CapturePipeline(R.Data, ocr, outbox, clock, new UlidGenerator(clock, Seeded.Bytes(7)), "t10b", new FrameGate(clock, TimeSpan.FromSeconds(2)), new ListLog());
            var s = new CaptureStatusModel();
            var good = R.Frame(Repo.McQueen[1]); ocr.Add(good, R.Ocr(Repo.McQueen[1]));
            s.Apply(await pipeline.ProcessAsync(new Frame(new byte[1280 * 720 * 4], 1280, 720), CancellationToken.None));
            var bad = TrayStatus.Compute(true, pipeline.Progress, s.Error, new(0, 0, false, null), UploadBlock.None, false);
            Assert.Equal(TrayState.Error, bad.State);
            clock.UtcNow += TimeSpan.FromSeconds(3);
            var e = await pipeline.ProcessAsync(good, CancellationToken.None);
            Assert.Equal(PipelineEventKind.Progress, e.Kind);
            s.Apply(e);
            var ok = TrayStatus.Compute(true, pipeline.Progress, s.Error, new(0, 0, false, null), UploadBlock.None, false);
            Assert.Equal(TrayState.Capturing, ok.State);
        }
        finally { Temp.Drop(dir); }
    }

    [Fact]
    public void Routine_text_that_merely_contains_notice_copy_is_kept()
    {
        var status = new CaptureNoticeStatus();
        status.Apply(new(PipelineEventKind.Progress, "limit reached? no: scroll on", Notices: [new(CaptureNoticeKind.Overflow, "limit")]));
        Assert.Equal("limit reached? no: scroll on", status.Routine);
        status.Apply(new(PipelineEventKind.NotUploadable, "incomplete\nlimit", Notices: [new(CaptureNoticeKind.Overflow, "limit")]));
        Assert.Equal("incomplete", status.Routine);
        status.Apply(new(PipelineEventKind.Limit, "limit", Notices: [new(CaptureNoticeKind.Overflow, "limit")]));
        Assert.Equal("", status.Routine);
    }
}
