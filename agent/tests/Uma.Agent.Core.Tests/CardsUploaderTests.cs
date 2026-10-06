using System.Net;
using System.Text;
using System.Text.Json;
using Uma.Agent.Core.Cards;
using Xunit;

namespace Uma.Agent.Core.Tests;

/// <summary>PUT /api/v1/owned-cards client. <see cref="OwnedCardsApi"/> replays apps/api/src/routes/owned-cards.ts
/// (count check unless ?partial=1, unknown IDs, `200 {count, partial, syncedAt}`) and Access refusals. These fakes are
/// test evidence of the client's handling, not live verification of a deployed API.</summary>
public class CardsUploaderTests
{
    private static readonly Uri Base = new("https://api.example.test/");
    private static readonly DateTimeOffset At = new(2026, 10, 3, 0, 0, 0, TimeSpan.Zero);
    private static IReadOnlySet<string> Known => FixtureEnv.Instance.Master.Ids["cards"];
    private static string Card(int i) => Known.Order(StringComparer.Ordinal).ElementAt(i);

    private sealed class Token : IServiceToken
    {
        public const string Secret = "cards-secret-in-memory-only";
        public int Reads;
        public (string ClientId, string ClientSecret) Read() { Reads++; return ("cards-id", Secret); }
    }

    internal sealed class OwnedCardsApi : HttpMessageHandler
    {
        public readonly List<(HttpMethod Method, string Path, string Query, string Body, string? Id, string? Secret, string? ContentType)> Requests = [];
        public readonly Queue<Func<HttpRequestMessage, HttpResponseMessage>> Script = new();
        public string SyncedAt = "2026-10-03T00:00:00.000Z";
        public HashSet<string> Masters = ["global-20260930"];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            string? H(string n) => request.Headers.TryGetValues(n, out var v) ? v.Single() : null;
            Requests.Add((request.Method, request.RequestUri!.AbsolutePath, request.RequestUri.Query, body, H("CF-Access-Client-Id"), H("CF-Access-Client-Secret"), request.Content?.Headers.ContentType?.ToString()));
            if (Script.Count > 0) { var r = Script.Dequeue()(request); r.RequestMessage ??= request; return r; }
            return Route(request, body);
        }

        /// <summary>The route's logic (owned-cards.ts), for a request that passed Access.</summary>
        private HttpResponseMessage Route(HttpRequestMessage request, string body)
        {
            if (request.Method != HttpMethod.Put || request.RequestUri!.AbsolutePath != "/api/v1/owned-cards") return Problem(404, []);
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            var partial = request.RequestUri.Query == "?partial=1";
            var cards = root.GetProperty("cards");
            if (!partial && cards.GetArrayLength() != root.GetProperty("heldCount").GetInt32())
                return Problem(422, [("/heldCount", "cards.length must equal heldCount unless the request has ?partial=1")]);
            if (!Masters.Contains(root.GetProperty("masterVersion").GetString()!)) return Problem(422, [("/masterVersion", "unknown master data version")]);
            var i = 0; var unknown = new List<(string, string)>();
            foreach (var c in cards.EnumerateArray()) { if (!Known.Contains(c.GetProperty("cardId").GetString()!)) unknown.Add(($"/cards/{i}/cardId", "unknown cards ID")); i++; }
            if (unknown.Count > 0) return Problem(422, unknown);
            return Json(HttpStatusCode.OK, JsonSerializer.Serialize(new { count = cards.GetArrayLength(), partial, syncedAt = SyncedAt }));
        }
    }

    internal static HttpResponseMessage Json(HttpStatusCode code, string body) => new(code) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    internal static HttpResponseMessage Problem(int code, IEnumerable<(string Path, string Message)> errors)
        => new((HttpStatusCode)code) { Content = new StringContent(JsonSerializer.Serialize(new { type = "about:blank", title = "Unprocessable Content", status = code, errors = errors.Select(e => new { path = e.Path, message = e.Message }) }), Encoding.UTF8, "application/problem+json") };
    private static HttpResponseMessage Html(HttpStatusCode code) => new(code) { Content = new StringContent("<html><title>Sign in ・ Cloudflare Access</title>nonce-xyz-789</html>", Encoding.UTF8, "text/html") };
    private static HttpResponseMessage Redirect() { var r = new HttpResponseMessage(HttpStatusCode.Found); r.Headers.Location = new Uri("https://team.cloudflareaccess.com/cdn-cgi/access/login?nonce=abc"); return r; }

    private static OwnedCardsSyncPayload Payload(int n, int held, bool partial)
        => new(new OwnedCardsSync(1, At, "global-20260930", held, Enumerable.Range(0, n).Select(i => new OwnedCard(Card(i), i % 5, 30, 0.9)).ToArray()), partial);

    private static (OwnedCardsUploader Up, OwnedCardsApi Api, List<TimeSpan> Delays, Token Token) Setup(int maxAttempts = 3)
    {
        var api = new OwnedCardsApi(); var delays = new List<TimeSpan>(); var token = new Token();
        var up = new OwnedCardsUploader(new HttpClient(api), Base, token, Known,
            new OwnedCardsRetryPolicy(maxAttempts, TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(30)), (d, _) => { delays.Add(d); return Task.CompletedTask; });
        return (up, api, delays, token);
    }

    private static void AssertNoSecretOrBody(OwnedCardsUploadResult r)
    {
        var text = string.Join("|", r.Errors) + "|" + r.ErrorCategory;
        Assert.DoesNotContain(Token.Secret, text);
        Assert.DoesNotContain("nonce", text);
        Assert.DoesNotContain("Cloudflare Access", text);
    }

    [Fact]
    public async Task Full_sync_PUTs_the_body_with_service_token_headers_and_returns_the_strict_ack()
    {
        var (up, api, delays, token) = Setup();
        var payload = Payload(3, 3, partial: false);
        var r = await up.SendAsync(payload);
        Assert.Equal(OwnedCardsUploadOutcome.Synced, r.Outcome);
        Assert.Equal(1, r.Attempts);
        Assert.Equal(new OwnedCardsAck(3, false, new DateTimeOffset(2026, 10, 3, 0, 0, 0, TimeSpan.Zero)), r.Ack);
        var q = Assert.Single(api.Requests);
        Assert.Equal(HttpMethod.Put, q.Method);
        Assert.Equal("/api/v1/owned-cards", q.Path);
        Assert.Equal("", q.Query);
        Assert.Equal(("cards-id", Token.Secret), (q.Id, q.Secret));
        Assert.StartsWith("application/json", q.ContentType);
        Assert.Equal(OwnedCardsSyncJson.Serialize(payload.Body), q.Body);
        Assert.Empty(delays);
        Assert.Equal(1, token.Reads);
    }

    [Fact]
    public async Task Partial_sync_adds_partial_1_and_the_ack_must_say_partial()
    {
        var (up, api, _, _) = Setup();
        var r = await up.SendAsync(Payload(2, 208, partial: true));
        Assert.Equal(OwnedCardsUploadOutcome.Synced, r.Outcome);
        Assert.Equal("?partial=1", api.Requests.Single().Query);
        Assert.True(r.Ack!.Partial);
    }

    [Fact]
    public async Task Invalid_payloads_never_reach_the_network()
    {
        var (up, api, _, token) = Setup();
        var r = await up.SendAsync(Payload(2, 208, partial: false));          // full with count != held
        Assert.Equal(OwnedCardsUploadOutcome.Invalid, r.Outcome);
        Assert.Contains(r.Errors, e => e.Contains(OwnedCardsSyncValidator.HeldCountMessage));
        var p = Payload(2, 2, false);
        r = await up.SendAsync(new OwnedCardsSyncPayload(p.Body with { Cards = [p.Body.Cards[0], p.Body.Cards[0]] }, p.Partial));
        Assert.Equal(OwnedCardsUploadOutcome.Invalid, r.Outcome);
        Assert.Empty(api.Requests);
        Assert.Equal(0, r.Attempts);
        Assert.Equal(0, token.Reads);
    }

    [Theory]
    [InlineData(503)] [InlineData(500)] [InlineData(429)] [InlineData(408)]
    public async Task Transient_statuses_retry_with_bounded_backoff_then_succeed(int status)
    {
        var (up, api, delays, _) = Setup();
        api.Script.Enqueue(_ => Json((HttpStatusCode)status, "{}"));
        api.Script.Enqueue(_ => Json((HttpStatusCode)status, "{}"));
        var r = await up.SendAsync(Payload(2, 2, false));
        Assert.Equal(OwnedCardsUploadOutcome.Synced, r.Outcome);
        Assert.Equal(3, r.Attempts);
        Assert.Equal([TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(4)], delays);
        Assert.Equal(3, api.Requests.Count);
        Assert.All(api.Requests, q => Assert.Equal(api.Requests[0].Body, q.Body));   // the same idempotent PUT
    }

    [Fact]
    public async Task Retries_stop_at_the_attempt_bound_and_the_backoff_is_capped()
    {
        var (up, api, delays, _) = Setup(maxAttempts: 6);
        for (var i = 0; i < 10; i++) api.Script.Enqueue(_ => Json(HttpStatusCode.ServiceUnavailable, "{}"));
        var r = await up.SendAsync(Payload(2, 2, false));
        Assert.Equal(OwnedCardsUploadOutcome.Failed, r.Outcome);
        Assert.Equal(6, r.Attempts);
        Assert.Equal("HTTP 503", r.ErrorCategory);
        Assert.Equal(6, api.Requests.Count);
        Assert.Equal(new[] { 2, 4, 8, 16, 30 }.Select(s => TimeSpan.FromSeconds(s)), delays);
    }

    [Fact]
    public async Task Network_errors_and_timeouts_retry_but_caller_cancellation_stops()
    {
        var (up, api, _, _) = Setup();
        api.Script.Enqueue(_ => throw new HttpRequestException("connect failed: " + Token.Secret));
        api.Script.Enqueue(_ => throw new TaskCanceledException("timeout"));
        var r = await up.SendAsync(Payload(2, 2, false));
        Assert.Equal(OwnedCardsUploadOutcome.Synced, r.Outcome);
        Assert.Equal(3, r.Attempts);

        (up, api, _, _) = Setup();
        using var cts = new CancellationTokenSource();
        api.Script.Enqueue(_ => { cts.Cancel(); throw new TaskCanceledException(); });
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => up.SendAsync(Payload(2, 2, false), cts.Token));
        Assert.Single(api.Requests);
    }

    [Fact]
    public async Task Exhausted_network_errors_report_a_category_not_the_message()
    {
        var (up, api, _, _) = Setup();
        for (var i = 0; i < 3; i++) api.Script.Enqueue(_ => throw new HttpRequestException("connect failed: " + Token.Secret));
        var r = await up.SendAsync(Payload(2, 2, false));
        Assert.Equal(OwnedCardsUploadOutcome.Failed, r.Outcome);
        Assert.Equal(nameof(HttpRequestException), r.ErrorCategory);
        AssertNoSecretOrBody(r);
    }

    [Theory]
    [InlineData(401)] [InlineData(403)]
    public async Task Access_refusals_are_auth_required_and_not_retried(int status)
    {
        var (up, api, delays, _) = Setup();
        api.Script.Enqueue(_ => Html((HttpStatusCode)status));
        var r = await up.SendAsync(Payload(2, 2, false));
        Assert.Equal(OwnedCardsUploadOutcome.AuthRequired, r.Outcome);
        Assert.Single(api.Requests); Assert.Empty(delays);
        AssertNoSecretOrBody(r);
    }

    [Fact]
    public async Task Redirects_and_login_pages_are_auth_required()
    {
        var (up, api, _, _) = Setup();
        api.Script.Enqueue(_ => Redirect());
        Assert.Equal(OwnedCardsUploadOutcome.AuthRequired, (await up.SendAsync(Payload(2, 2, false))).Outcome);
        api.Script.Enqueue(_ => Html(HttpStatusCode.OK));                       // a client that followed the redirect
        var r = await up.SendAsync(Payload(2, 2, false));
        Assert.Equal(OwnedCardsUploadOutcome.AuthRequired, r.Outcome);
        Assert.Equal(UploadErrors.AuthLoginPage, r.ErrorCategory);
        api.Script.Enqueue(req => { var m = Json(HttpStatusCode.OK, "{\"count\":2,\"partial\":false,\"syncedAt\":\"2026-10-03T00:00:00.000Z\"}"); m.RequestMessage = new HttpRequestMessage(HttpMethod.Get, "https://team.cloudflareaccess.com/x"); return m; });
        Assert.Equal(OwnedCardsUploadOutcome.AuthRequired, (await up.SendAsync(Payload(2, 2, false))).Outcome);
        AssertNoSecretOrBody(r);
        Assert.False(OwnedCardsUploader.CreateHandler().AllowAutoRedirect);
    }

    [Fact]
    public async Task Api_422_is_rejected_with_the_problem_paths_and_is_not_retried()
    {
        var (up, api, delays, _) = Setup();
        api.Masters.Clear();
        var r = await up.SendAsync(Payload(2, 2, false));
        Assert.Equal(OwnedCardsUploadOutcome.Rejected, r.Outcome);
        Assert.Equal("HTTP 422", r.ErrorCategory);
        Assert.Equal(["/masterVersion: unknown master data version"], r.Errors);
        Assert.Single(api.Requests); Assert.Empty(delays);
    }

    [Fact]
    public async Task Server_side_count_check_is_replayed_for_a_payload_that_skipped_local_validation()
    {
        // The real route's 422 shape for a count mismatch, as an extra guard if a caller's state drifted.
        var (up, api, _, _) = Setup();
        api.Script.Enqueue(_ => Problem(422, [("/heldCount", OwnedCardsSyncValidator.HeldCountMessage)]));
        var r = await up.SendAsync(Payload(2, 2, false));
        Assert.Equal(OwnedCardsUploadOutcome.Rejected, r.Outcome);
        Assert.Equal(["/heldCount: " + OwnedCardsSyncValidator.HeldCountMessage], r.Errors);
    }

    [Theory]
    [InlineData("{\"count\":3,\"partial\":false,\"syncedAt\":\"2026-10-03T00:00:00.000Z\"}")]     // wrong count
    [InlineData("{\"count\":2,\"partial\":true,\"syncedAt\":\"2026-10-03T00:00:00.000Z\"}")]      // wrong partial
    [InlineData("{\"count\":2,\"partial\":false}")]                                                // no syncedAt
    [InlineData("{\"count\":2,\"partial\":false,\"syncedAt\":\"2026-10-03T08:00:00+08:00\"}")]    // not UTC Z
    [InlineData("{\"count\":2,\"partial\":false,\"syncedAt\":\"2026-10-03T00:00:00.000Z\",\"x\":1}")] // extra key
    [InlineData("{\"count\":\"2\",\"partial\":false,\"syncedAt\":\"2026-10-03T00:00:00.000Z\"}")]  // count not a number
    [InlineData("[]")]
    [InlineData("not json")]
    public async Task Anything_but_the_documented_ack_is_not_success(string body)
    {
        var (up, api, _, _) = Setup();
        for (var i = 0; i < 3; i++) api.Script.Enqueue(_ => Json(HttpStatusCode.OK, body));
        var r = await up.SendAsync(Payload(2, 2, false));
        Assert.Equal(OwnedCardsUploadOutcome.Failed, r.Outcome);
        Assert.Equal(UploadErrors.UnexpectedResponse, r.ErrorCategory);
        Assert.Null(r.Ack);
        Assert.Equal(3, api.Requests.Count);
    }

    [Fact]
    public async Task Created_201_is_not_the_owned_cards_ack()
    {
        var (up, api, _, _) = Setup(maxAttempts: 1);
        api.Script.Enqueue(_ => Json(HttpStatusCode.Created, "{\"count\":2,\"partial\":false,\"syncedAt\":\"2026-10-03T00:00:00.000Z\"}"));
        Assert.Equal(OwnedCardsUploadOutcome.Failed, (await up.SendAsync(Payload(2, 2, false))).Outcome);
    }

    [Fact]
    public void The_uploader_has_no_persistent_state()
    {
        // Secrets and payloads stay in memory: the uploader type owns no file, database or stream fields.
        var fields = typeof(OwnedCardsUploader).GetFields(System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public);
        Assert.DoesNotContain(fields, f => f.FieldType == typeof(string) && f.Name.Contains("path", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(fields, f => typeof(Stream).IsAssignableFrom(f.FieldType) || f.FieldType.FullName!.Contains("Sqlite"));
    }

    [Fact]
    public async Task Session_payloads_round_trip_through_the_replayed_route()
    {
        // SYNTHETIC session (see Synthetic) end to end: full sync accepted; the fixture-13 partial is accepted with ?partial=1.
        var inv = new Synthetic(23);
        var s = CardsKit.NewSession();
        s.Feed(inv.Page(0), inv.EmptyCells(0)); s.Feed(inv.Page(5), inv.EmptyCells(5));
        var (up, api, _, _) = Setup();
        var r = await up.SendAsync(s.BuildFull());
        Assert.Equal(OwnedCardsUploadOutcome.Synced, r.Outcome);
        Assert.Equal(23, r.Ack!.Count);

        var real = CardsKit.NewSession();
        real.Feed(CardsKit.Env.Parsed(CardsKit.List13));
        r = await up.SendAsync(real.BuildPartial(real.State.PartialConfirmation!));
        Assert.Equal(OwnedCardsUploadOutcome.Synced, r.Outcome);
        Assert.Equal((20, true), (r.Ack!.Count, r.Ack.Partial));
        Assert.Equal("?partial=1", api.Requests.Last().Query);
    }
}
