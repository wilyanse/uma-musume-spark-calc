using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Uma.Agent.Core.Tests;

/// <summary>Review round 1: B3 (success acknowledgement, auth state, dead-letter recovery) and S3 (atomic, idempotent
/// enqueue). The fake API reproduces apps/api/src/routes/{crops,veterans}.ts responses (01 §3, §8).</summary>
public class UploadRobustnessTests
{
    private sealed class Token : IServiceToken
    {
        public string Secret = "robust-secret-in-memory";
        public (string ClientId, string ClientSecret) Read() => ("robust-id", Secret);
    }

    private const string VeteranId = "01K7B33MXGVZV6TZRJZDHB99YF";

    private sealed class Api : HttpMessageHandler
    {
        public readonly List<(HttpMethod Method, string Path, string Query)> Requests = [];
        /// <summary>Return non-null to replace the real response.</summary>
        public Func<HttpRequestMessage, HttpResponseMessage?>? Override;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add((request.Method, request.RequestUri!.AbsolutePath, request.RequestUri.Query));
            if (Override?.Invoke(request) is { } custom) return Task.FromResult(custom);
            if (request.Method == HttpMethod.Put)
            {
                var path = Uri.UnescapeDataString(request.RequestUri.Query["?path=".Length..]);
                return Task.FromResult(Json(HttpStatusCode.OK, JsonSerializer.Serialize(new { cropKey = $"crops/{request.RequestUri.Segments.Last()}/{Uri.EscapeDataString(path)}.png" })));
            }
            return Task.FromResult(Json(HttpStatusCode.Created, $"{{\"veteranId\":\"{VeteranId}\",\"created\":true,\"reviewItemIds\":[\"01K7B33MXGVZV6TZRJZDHB99YG\",\"01K7B33MXGVZV6TZRJZDHB99YH\"]}}"));
        }
    }

    private static HttpResponseMessage Json(HttpStatusCode code, string body) => new(code) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    private static HttpResponseMessage Html(HttpStatusCode code) => new(code) { Content = new StringContent("<html><title>Sign in ・ Cloudflare Access</title>secret-looking-nonce-123</html>", Encoding.UTF8, "text/html") };
    private static HttpResponseMessage Redirect(HttpStatusCode code) { var r = new HttpResponseMessage(code); r.Headers.Location = new Uri("https://team.cloudflareaccess.com/cdn-cgi/access/login?nonce=abc"); return r; }

    private static (UploadOutbox Outbox, UploadClient Client, Api Api, TestClock Clock, Token Token) Setup(string db, CaptureResult? capture = null)
    {
        var clock = new TestClock(); var outbox = new UploadOutbox(db, clock); var api = new Api(); var token = new Token();
        outbox.EnqueueCapture(capture ?? Collect.LowConfidence());
        return (outbox, new UploadClient(new HttpClient(api), new Uri("https://api.example.test/"), token, outbox), api, clock, token);
    }

    private static async Task Drain(UploadClient client, TestClock clock, int rounds = 20)
    {
        for (var i = 0; i < rounds; i++) { while (await client.SendNextAsync()) { } clock.UtcNow += TimeSpan.FromHours(2); }
    }

    private static void AssertNoRawResponse(string db)
    {
        var text = Encoding.UTF8.GetString(File.ReadAllBytes(db));
        Assert.DoesNotContain("Cloudflare Access", text);
        Assert.DoesNotContain("secret-looking-nonce-123", text);
        Assert.DoesNotContain("cloudflareaccess.com", text);
        Assert.DoesNotContain("robust-secret-in-memory", text);
    }

    // ---------- B3: success acknowledgement ----------

    [Fact]
    public async Task Valid_201_and_200_acknowledgements_complete_the_veteran()
    {
        foreach (var (code, created) in new[] { (HttpStatusCode.Created, true), (HttpStatusCode.OK, false) })
        {
            var db = Collect.TempDb();
            try
            {
                var (outbox, client, api, clock, _) = Setup(db);
                api.Override = r => r.Method == HttpMethod.Post ? Json(code, $"{{\"veteranId\":\"{VeteranId}\",\"created\":{(created ? "true" : "false")}}}") : null;
                var outcomes = new List<UploadOutcome>();
                for (var i = 0; i < 3; i++) outcomes.Add((await client.SendAsync()).Outcome);
                Assert.Equal([UploadOutcome.Uploaded, UploadOutcome.Uploaded, UploadOutcome.Uploaded], outcomes);
                Assert.Empty(outbox.Snapshot());
                Assert.Equal(UploadOutcome.Idle, (await client.SendAsync()).Outcome);
                Assert.Equal(VeteranId, outbox.UploadedVeteranId(Collect.CaptureId));
            }
            finally { Collect.Drop(db); }
        }
    }

    [Theory]
    [InlineData("html200")]
    [InlineData("json200-empty")]
    [InlineData("json200-wrong-shape")]
    [InlineData("json201-bad-ulid")]
    [InlineData("json201-created-false")]
    [InlineData("not-json")]
    [InlineData("204")]
    [InlineData("202")]
    public async Task Unacknowledged_success_never_deletes_the_veteran(string kind)
    {
        var db = Collect.TempDb();
        try
        {
            var (outbox, client, api, clock, _) = Setup(db);
            api.Override = r => r.Method != HttpMethod.Post ? null : kind switch
            {
                "html200" => Html(HttpStatusCode.OK),
                "json200-empty" => Json(HttpStatusCode.OK, "{}"),
                "json200-wrong-shape" => Json(HttpStatusCode.OK, "{\"ok\":true}"),
                "json201-bad-ulid" => Json(HttpStatusCode.Created, "{\"veteranId\":\"x\",\"created\":true}"),
                "json201-created-false" => Json(HttpStatusCode.Created, $"{{\"veteranId\":\"{VeteranId}\",\"created\":false}}"),
                "not-json" => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{not json", Encoding.UTF8, "application/json") },
                "204" => new HttpResponseMessage(HttpStatusCode.NoContent),
                _ => Json(HttpStatusCode.Accepted, $"{{\"veteranId\":\"{VeteranId}\",\"created\":true}}"),
            };
            await Drain(client, clock, 3);
            var snap = outbox.Snapshot();
            var veteran = Assert.Single(snap);
            Assert.Equal("veteran", veteran.Kind);
            Assert.False(veteran.Dead);
            Assert.True(veteran.Attempts >= 1);
            Assert.Equal(kind == "html200" ? UploadErrors.AuthLoginPage : UploadErrors.UnexpectedResponse, veteran.LastError);
            Assert.Null(outbox.UploadedVeteranId(Collect.CaptureId));
            AssertNoRawResponse(db);
        }
        finally { Collect.Drop(db); }
    }

    [Fact]
    public async Task Html_or_malformed_crop_response_keeps_the_crop()
    {
        var db = Collect.TempDb();
        try
        {
            var (outbox, client, api, clock, _) = Setup(db);
            api.Override = r => r.Method == HttpMethod.Put ? Html(HttpStatusCode.OK) : null;
            var attempt = await client.SendAsync();
            Assert.Equal(UploadOutcome.AuthRequired, attempt.Outcome);
            Assert.Equal(3, outbox.Snapshot().Count);
            api.Override = r => r.Method == HttpMethod.Put ? Json(HttpStatusCode.OK, "{\"cropKey\":42}") : null;
            clock.UtcNow += TimeSpan.FromHours(2);
            Assert.Equal(UploadOutcome.Retrying, (await client.SendAsync()).Outcome);
            Assert.Equal(3, outbox.Snapshot().Count);
            Assert.DoesNotContain(api.Requests, r => r.Method == HttpMethod.Post);
        }
        finally { Collect.Drop(db); }
    }

    // ---------- B3: auth state ----------

    [Theory]
    [InlineData(401)]
    [InlineData(403)]
    [InlineData(302)]
    [InlineData(307)]
    public async Task Auth_failures_are_retryable_auth_state_not_dead_letters(int code)
    {
        var db = Collect.TempDb();
        try
        {
            var (outbox, client, api, clock, token) = Setup(db);
            api.Override = _ => code is 302 or 307 ? Redirect((HttpStatusCode)code) : Json((HttpStatusCode)code, "{\"title\":\"forbidden\"}");
            var first = await client.SendAsync();
            Assert.Equal(UploadOutcome.AuthRequired, first.Outcome);
            Assert.Equal(UploadErrors.Auth, first.Error);
            // Bounded backoff: the next attempt is scheduled, never more than 1 h away, and repeated failures stay retryable.
            for (var i = 0; i < 15; i++)
            {
                var due = outbox.Snapshot().Min(s => s.NextAttemptAt);
                Assert.InRange(due - clock.UtcNow, TimeSpan.Zero, TimeSpan.FromHours(1));
                clock.UtcNow = due;
                Assert.Equal(UploadOutcome.AuthRequired, (await client.SendAsync()).Outcome);
            }
            var health = outbox.Health();
            Assert.True(health.AuthRequired);
            Assert.Equal(0, health.Dead);
            Assert.Equal(3, health.Pending);
            Assert.All(outbox.Snapshot(), s => Assert.False(s.Dead));
            Assert.DoesNotContain(api.Requests, r => r.Method == HttpMethod.Post);   // the veteran never jumps its crops
            AssertNoRawResponse(db);

            // Recovery: the user fixes the service token; T10 asks for an immediate retry; a restart works too.
            token.Secret = "rotated-secret";
            api.Override = null;
            outbox.RetryAuthNow();
            var restarted = new UploadOutbox(db, clock);
            var client2 = new UploadClient(new HttpClient(api), new Uri("https://api.example.test/"), token, restarted);
            while (await client2.SendNextAsync()) { }
            Assert.Empty(restarted.Snapshot());
            Assert.False(restarted.Health().AuthRequired);
            Assert.Equal(VeteranId, restarted.UploadedVeteranId(Collect.CaptureId));
        }
        finally { Collect.Drop(db); }
    }

    [Fact]
    public void The_shell_http_handler_never_follows_redirects()
    {
        using var handler = UploadClient.CreateHandler();
        Assert.False(handler.AllowAutoRedirect);
    }

    // ---------- B3: dead-letter recovery ----------

    [Fact]
    public async Task Dead_crop_can_be_requeued_by_stable_id_and_then_uploads()
    {
        var db = Collect.TempDb();
        try
        {
            var (outbox, client, api, clock, _) = Setup(db);
            api.Override = r => r.Method == HttpMethod.Put && r.RequestUri!.Query.Contains("stats") ? Json(HttpStatusCode.UnprocessableEntity, "{}") : null;
            await Drain(client, clock, 2);
            var dead = Assert.Single(outbox.Snapshot(), s => s.Dead);
            Assert.Equal(("crop", "/stats/gut", "HTTP 422"), (dead.Kind, dead.Path, dead.LastError));
            Assert.Equal(1, outbox.Health().Dead);
            api.Override = null;
            Assert.True(outbox.Requeue(dead.Id));
            Assert.False(outbox.Requeue(dead.Id));                       // not dead any more
            Assert.False(outbox.Requeue(987654));                        // unknown id
            await Drain(client, clock, 1);
            Assert.Empty(outbox.Snapshot());
            var post = api.Requests.Last();
            Assert.Equal((HttpMethod.Post, "/api/v1/veterans"), (post.Method, post.Path));
        }
        finally { Collect.Drop(db); }
    }

    [Fact]
    public async Task Discarding_a_dead_crop_discards_its_whole_capture_never_a_veteran_without_its_crop()
    {
        var db = Collect.TempDb();
        try
        {
            var (outbox, client, api, clock, _) = Setup(db);
            api.Override = r => r.Method == HttpMethod.Put && r.RequestUri!.Query.Contains("stats") ? Json(HttpStatusCode.UnprocessableEntity, "{}") : null;
            await Drain(client, clock, 2);
            var dead = Assert.Single(outbox.Snapshot(), s => s.Dead);
            var pendingVeteran = Assert.Single(outbox.Snapshot(), s => s.Kind == "veteran");
            Assert.Equal(0, outbox.Discard(pendingVeteran.Id));         // only dead items can be discarded
            Assert.Equal(2, outbox.Discard(dead.Id));                   // the crop and its veteran
            Assert.Empty(outbox.Snapshot());
            await Drain(client, clock, 2);
            Assert.DoesNotContain(api.Requests, r => r.Method == HttpMethod.Post);
            // The same capture can be queued again later (e.g. after a re-capture) because nothing was uploaded.
            Assert.Equal(EnqueueResult.Queued, outbox.EnqueueCapture(Collect.LowConfidence()));
        }
        finally { Collect.Drop(db); }
    }

    // ---------- S3: idempotent, atomic enqueue ----------

    [Fact]
    public void Repeated_enqueue_is_idempotent_and_keeps_retry_state()
    {
        var db = Collect.TempDb();
        try
        {
            var r = Collect.LowConfidence();
            var clock = new TestClock(); var outbox = new UploadOutbox(db, clock);
            Assert.Equal(EnqueueResult.Queued, outbox.EnqueueCapture(r));
            var crop = outbox.Next()!;
            outbox.Fail(crop, "HTTP 503");
            Assert.Equal(EnqueueResult.AlreadyQueued, outbox.EnqueueCapture(r));
            Assert.Equal(EnqueueResult.AlreadyQueued, new UploadOutbox(db, clock).EnqueueCapture(r));
            var snap = outbox.Snapshot();
            Assert.Equal(3, snap.Count);
            Assert.Equal(1, snap.Single(s => s.Id == crop.Id).Attempts);
            // A different payload under the same captureId is a conflict, not a silent overwrite.
            var other = r with { Capture = r.Capture! with { CapturedAt = r.Capture.CapturedAt.AddMinutes(1) } };
            Assert.ThrowsAny<Exception>(() => outbox.EnqueueCapture(other));
            Assert.Equal(3, outbox.Snapshot().Count);
        }
        finally { Collect.Drop(db); }
    }

    [Fact]
    public async Task Enqueue_after_a_saved_crop_or_a_finished_upload_does_not_resend()
    {
        var db = Collect.TempDb();
        try
        {
            var (outbox, client, api, clock, _) = Setup(db);
            Assert.Equal(UploadOutcome.Uploaded, (await client.SendAsync()).Outcome);   // one crop saved
            Assert.Equal(EnqueueResult.AlreadyQueued, outbox.EnqueueCapture(Collect.LowConfidence()));
            Assert.Equal(2, outbox.Snapshot().Count);                                      // the saved crop is not queued again
            while (await client.SendNextAsync()) { }
            Assert.Equal(EnqueueResult.AlreadyUploaded, outbox.EnqueueCapture(Collect.LowConfidence()));
            Assert.Empty(outbox.Snapshot());
            Assert.Equal(3, api.Requests.Count);
        }
        finally { Collect.Drop(db); }
    }

    [Fact]
    public async Task Concurrent_enqueue_from_two_outboxes_inserts_once()
    {
        var db = Collect.TempDb();
        try
        {
            var r = Collect.LowConfidence(); var clock = new TestClock();
            _ = new UploadOutbox(db, clock);
            var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Task.Run(() => new UploadOutbox(db, clock).EnqueueCapture(r))));
            Assert.Equal(1, results.Count(x => x == EnqueueResult.Queued));
            Assert.Equal(7, results.Count(x => x == EnqueueResult.AlreadyQueued));
            Assert.Equal(3, new UploadOutbox(db, clock).Snapshot().Count);
        }
        finally { Collect.Drop(db); }
    }

    [Fact]
    public void A_crash_mid_enqueue_leaves_nothing_and_a_retry_succeeds()
    {
        var db = Collect.TempDb();
        try
        {
            var r = Collect.LowConfidence(); var clock = new TestClock();
            var outbox = new UploadOutbox(db, clock) { AfterInsertForTesting = n => { if (n == 2) throw new IOException("simulated crash"); } };
            Assert.Throws<IOException>(() => outbox.EnqueueCapture(r));
            Assert.Empty(outbox.Snapshot());
            outbox.AfterInsertForTesting = null;
            Assert.Equal(EnqueueResult.Queued, outbox.EnqueueCapture(r));
            Assert.Equal(3, outbox.Snapshot().Count);
        }
        finally { Collect.Drop(db); }
    }

    [Fact]
    public void Null_path_rows_are_unique_and_an_existing_database_with_duplicates_is_migrated()
    {
        var db = Collect.TempDb();
        try
        {
            // The round-0 schema (no unique index) with the duplicate rows the reviewer produced (P9).
            using (var c = new SqliteConnection($"Data Source={db}"))
            {
                c.Open(); using var q = c.CreateCommand();
                q.CommandText = """
                    CREATE TABLE outbox (id INTEGER PRIMARY KEY, capture_id TEXT NOT NULL, kind TEXT NOT NULL, path TEXT, payload BLOB NOT NULL,
                      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, last_error TEXT, dead INTEGER NOT NULL DEFAULT 0);
                    CREATE INDEX outbox_capture ON outbox(capture_id, kind);
                    CREATE TABLE crop_results (capture_id TEXT NOT NULL, path TEXT NOT NULL, crop_key TEXT NOT NULL, PRIMARY KEY(capture_id, path));
                    INSERT INTO outbox(capture_id,kind,path,payload,attempts,next_attempt_at) VALUES ('C','veteran',NULL,x'7b7d',2,'2026-10-03T00:00:00.0000000+00:00');
                    INSERT INTO outbox(capture_id,kind,path,payload,attempts,next_attempt_at) VALUES ('C','veteran',NULL,x'7b7d',0,'2026-10-03T00:00:00.0000000+00:00');
                    INSERT INTO outbox(capture_id,kind,path,payload,next_attempt_at) VALUES ('C','crop','/stats/spd',x'89',  '2026-10-03T00:00:00.0000000+00:00');
                    INSERT INTO outbox(capture_id,kind,path,payload,next_attempt_at) VALUES ('C','crop','/stats/spd',x'89',  '2026-10-03T00:00:00.0000000+00:00');
                    """;
                q.ExecuteNonQuery();
            }
            SqliteConnection.ClearAllPools();
            var outbox = new UploadOutbox(db, new TestClock());
            var snap = outbox.Snapshot();
            Assert.Equal(2, snap.Count);
            Assert.Equal(2, snap.Single(s => s.Kind == "veteran").Attempts);           // the oldest row (and its retry state) is kept
            Assert.ThrowsAny<SqliteException>(() => outbox.Enqueue("C", "veteran", [1]));
            Assert.Equal(2, outbox.Snapshot().Count);
        }
        finally { Collect.Drop(db); }
    }
}
