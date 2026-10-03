using System.Net;
using System.Text;
using System.Text.Json;
using Xunit;

namespace Uma.Agent.Core.Tests;

/// <summary>Assembled capture → outbox → HTTP, asserting the final request bodies (01 §8, 30 §6).</summary>
public class UploadPipelineTests
{
    private sealed class Clock : IClock { public DateTimeOffset UtcNow { get; set; } = new(2026, 10, 3, 0, 0, 0, TimeSpan.Zero); }
    private sealed class Token : IServiceToken { public (string ClientId, string ClientSecret) Read() => ("pipeline-id", "pipeline-secret-in-memory"); }

    /// <summary>Mimics the merged API: PUT /api/v1/crops/:captureId?path=… returns {cropKey} built the same way as
    /// apps/api/src/routes/crops.ts; POST /api/v1/veterans returns 201.</summary>
    private sealed class FakeApi : HttpMessageHandler
    {
        public readonly List<(HttpMethod Method, string Path, string? Query, byte[] Body)> Requests = [];
        public Func<HttpRequestMessage, HttpStatusCode?>? Override;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Assert.Equal("pipeline-secret-in-memory", request.Headers.GetValues("CF-Access-Client-Secret").Single());
            var body = await request.Content!.ReadAsByteArrayAsync(ct);
            Requests.Add((request.Method, request.RequestUri!.AbsolutePath, request.RequestUri.Query, body));
            if (Override?.Invoke(request) is { } code) return new HttpResponseMessage(code) { Content = new StringContent("{}") };
            if (request.Method == HttpMethod.Put)
            {
                Assert.Equal("image/png", request.Content.Headers.ContentType!.MediaType);
                Assert.True(body.Length <= 60 * 1024 && body[0] == 0x89);
                var captureId = request.RequestUri.Segments.Last();
                var path = Uri.UnescapeDataString(request.RequestUri.Query["?path=".Length..]);
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(new { cropKey = $"crops/{captureId}/{Uri.EscapeDataString(path)}.png" })) };
            }
            Assert.Equal("application/json", request.Content.Headers.ContentType!.MediaType);
            return new HttpResponseMessage(HttpStatusCode.Created) { Content = new StringContent("{\"veteranId\":\"01K7B33MXGVZV6TZRJZDHB99YF\",\"created\":true}") };
        }
    }

    private static CaptureResult LowConfidenceMcQueen()
    {
        var env = FixtureEnv.Instance;
        var c = new CaptureCoordinator(env.Layout, env.Master);
        foreach (var f in new[] { "01-veteran-details-skills-independent", "02-veteran-details-inspiration-p1", "03-veteran-details-inspiration-p2", "04-veteran-details-inspiration-p3",
                     "05-veteran-details-career-info-deck-legacy", "06-veteran-details-career-info-record", "09-sparks-popup-special-week-parent", "10-sparks-popup-guest-parent" })
        {
            var p = env.Parsed(f);
            if (p.Header is { } h) p = p with { Header = h with { Stats = h.Stats.ToDictionary(kv => kv.Key, kv => kv.Key == "gut" ? kv.Value with { Ok = false } : kv.Value) } };
            if (f.StartsWith("02")) p = p with { Sparks = p.Sparks.Select((s, i) => i == 3 ? s with { Spark = s.Spark with { Ok = false } } : s).ToArray() };
            c.Feed(p);
        }
        var r = c.Current!.Assemble("01K7B33MXGVZV6TZRJZDHB99YE", new DateTimeOffset(2026, 10, 3, 0, 0, 0, TimeSpan.Zero), "test");
        Assert.Empty(r.Errors);
        return r;
    }

    [Fact]
    public async Task Crops_upload_first_and_their_keys_land_on_the_right_fields_across_retry_and_restart()
    {
        var result = LowConfidenceMcQueen();
        var lowPaths = result.Capture!.Fields.Where(f => f.Status == FieldStatus.low_confidence).Select(f => f.Path).Order().ToArray();
        Assert.Equal(new[] { "/sparks/3/sparkId", "/stats/gut" }, lowPaths);
        var db = Path.Combine(Path.GetTempPath(), "uma-pipeline-" + Guid.NewGuid().ToString("N") + ".db");
        try
        {
            var clock = new Clock(); var api = new FakeApi();
            var failOnce = true;
            api.Override = req =>
            {
                if (req.Method != HttpMethod.Put || !failOnce) return null;
                failOnce = false; return HttpStatusCode.ServiceUnavailable;
            };
            var outbox = new UploadOutbox(db, clock);
            outbox.EnqueueCapture(result);
            var client = new UploadClient(new HttpClient(api), new Uri("https://api.example.test/"), new Token(), outbox);
            Assert.True(await client.SendNextAsync());                 // crop 1 → 503, backoff
            Assert.True(await client.SendNextAsync());                 // crop 2 → ok
            Assert.Null(outbox.Next());                                // crop 1 waits; veteran is blocked behind it
            clock.UtcNow += TimeSpan.FromSeconds(3);
            // Restart: a new outbox/client on the same database finishes the job.
            var restarted = new UploadOutbox(db, clock);
            var client2 = new UploadClient(new HttpClient(api), new Uri("https://api.example.test/"), new Token(), restarted);
            while (await client2.SendNextAsync()) { }
            Assert.Empty(restarted.Snapshot());

            Assert.Equal(4, api.Requests.Count);
            Assert.All(api.Requests.Take(3), r => Assert.Equal(HttpMethod.Put, r.Method));
            var last = api.Requests[^1];
            Assert.Equal((HttpMethod.Post, "/api/v1/veterans"), (last.Method, last.Path));
            var json = Encoding.UTF8.GetString(last.Body);
            Assert.Empty(CaptureSchema.Validate(json));
            var sent = CaptureJson.Deserialize(json);
            Assert.Empty(CaptureValidation.Validate(sent, FixtureEnv.Instance.Master.Ids));
            foreach (var f in sent.Fields)
            {
                var expected = lowPaths.Contains(f.Path) ? $"crops/{sent.CaptureId}/{Uri.EscapeDataString(f.Path)}.png" : null;
                Assert.Equal(expected, f.CropKey);
            }
            Assert.Equal(result.Capture.Fingerprint, sent.Fingerprint);
            Assert.Equal(result.Capture.Veteran.Stats, sent.Veteran.Stats);
            Assert.DoesNotContain("pipeline-secret-in-memory", Encoding.UTF8.GetString(File.ReadAllBytes(db)));
        }
        finally { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); File.Delete(db); }
    }

    [Fact]
    public async Task A_rejected_crop_is_dead_lettered_and_the_veteran_is_never_sent_without_it()
    {
        var result = LowConfidenceMcQueen();
        var db = Path.Combine(Path.GetTempPath(), "uma-pipeline-" + Guid.NewGuid().ToString("N") + ".db");
        try
        {
            var clock = new Clock(); var api = new FakeApi { Override = r => r.Method == HttpMethod.Put && r.RequestUri!.Query.Contains("stats") ? HttpStatusCode.UnprocessableEntity : null };
            var outbox = new UploadOutbox(db, clock);
            outbox.EnqueueCapture(result);
            var client = new UploadClient(new HttpClient(api), new Uri("https://api.example.test/"), new Token(), outbox);
            while (await client.SendNextAsync()) { }
            clock.UtcNow += TimeSpan.FromDays(1);
            Assert.False(await client.SendNextAsync());
            Assert.DoesNotContain(api.Requests, r => r.Method == HttpMethod.Post);
            var snap = outbox.Snapshot();
            Assert.Contains(snap, s => s.Kind == "crop" && s.Dead && s.LastError == "HTTP 422");
            Assert.Contains(snap, s => s.Kind == "veteran" && !s.Dead);
        }
        finally { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); File.Delete(db); }
    }

    [Fact]
    public void Enqueue_refuses_invalid_or_mismatched_captures()
    {
        var db = Path.Combine(Path.GetTempPath(), "uma-pipeline-" + Guid.NewGuid().ToString("N") + ".db");
        try
        {
            var outbox = new UploadOutbox(db, new Clock());
            var r = LowConfidenceMcQueen();
            Assert.Throws<InvalidDataException>(() => outbox.EnqueueCapture(r with { Crops = [.. r.Crops, ("/stats/spd", r.Crops[0].Png)] }));
            var reversed = r.Capture! with { Veteran = r.Capture.Veteran with { Deck = r.Capture.Veteran.Deck.AsEnumerable().Reverse().ToList() } };
            Assert.Throws<InvalidDataException>(() => outbox.EnqueueCapture(r with { Capture = reversed }));
            Assert.Throws<InvalidOperationException>(() => outbox.EnqueueCapture(new CaptureResult(null, [], [], ["x"])));
            Assert.Empty(outbox.Snapshot());
        }
        finally { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); File.Delete(db); }
    }
}
