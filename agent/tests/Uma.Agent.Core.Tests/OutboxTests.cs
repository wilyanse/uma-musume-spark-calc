using System.Net;
using System.Text;
using System.Text.Json;
using Xunit;
namespace Uma.Agent.Core.Tests;

public class OutboxTests
{
    private sealed class Clock : IClock { public DateTimeOffset UtcNow { get; set; } = new(2026,9,30,0,0,0,TimeSpan.Zero); }
    private sealed class Token : IServiceToken { public (string ClientId, string ClientSecret) Read() => ("test-id", "memory-only-test-secret"); }
    private sealed class Handler : HttpMessageHandler
    {
        public readonly List<string> Requests = [];
        public readonly List<string> Bodies = [];
        public int Failures;
        public string? CropResponse;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Assert.Equal("test-id", request.Headers.GetValues("CF-Access-Client-Id").Single());
            Assert.Equal("memory-only-test-secret", request.Headers.GetValues("CF-Access-Client-Secret").Single());
            Requests.Add(request.RequestUri!.PathAndQuery);
            Bodies.Add(await request.Content!.ReadAsStringAsync(cancellationToken));
            var code = Failures-- > 0 ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.OK;
            if (request.Method == HttpMethod.Post) return new(code) { Content = new StringContent("{\"created\":true}") };
            var path = Uri.UnescapeDataString(request.RequestUri.Query.Split('=')[1]);
            return new(code) { Content = new StringContent(CropResponse ?? JsonSerializer.Serialize(new { cropKey = $"crops/{request.RequestUri.Segments.Last()}/{Uri.EscapeDataString(path)}.png" })) };
        }
    }
    private static readonly byte[] Png = [137,80,78,71,13,10,26,10];
    [Fact]
    public async Task Crop_retry_and_restart_attach_key_to_final_HTTP_body()
    {
        var file = Path.Combine(Path.GetTempPath(), "uma-outbox-" + Guid.NewGuid().ToString("N") + ".db");
        try
        {
            var capture = SerializationTests.Capture() with { Fields = [new("/stats/spd", "123", 123, .3, FieldStatus.low_confidence, [], null), new("/stats/sta", "456",456,1,FieldStatus.ok,[],null)] };
            var clock = new Clock(); var outbox = new UploadOutbox(file, clock);
            outbox.Enqueue(capture.CaptureId, "veteran", Encoding.UTF8.GetBytes(CaptureJson.Serialize(capture)));
            outbox.Enqueue(capture.CaptureId, "crop", Png, "/stats/spd");
            var handler = new Handler { Failures = 1 };
            var http = new HttpClient(handler);
            var client = new UploadClient(http,new("https://example.test/"),new Token(),outbox);
            Assert.True(await client.SendNextAsync());
            Assert.Null(outbox.Next());
            clock.UtcNow += TimeSpan.FromSeconds(2);
            Assert.True(await client.SendNextAsync());
            // Reopen the database after the successful crop, before veteran submission.
            var restarted = new UploadOutbox(file,clock);
            Assert.True(await new UploadClient(http,new("https://example.test/"),new Token(),restarted).SendNextAsync());
            Assert.Null(restarted.Next());
            Assert.Equal(3,handler.Requests.Count);
            Assert.Equal(handler.Requests[0],handler.Requests[1]);
            Assert.Equal("/api/v1/veterans",handler.Requests[2]);
            var submitted = CaptureJson.Deserialize(handler.Bodies[2]);
            Assert.Equal($"crops/{capture.CaptureId}/%2Fstats%2Fspd.png",submitted.Fields[0].CropKey);
            Assert.Null(submitted.Fields[1].CropKey);
            Assert.Equal(capture.Veteran.Stats,submitted.Veteran.Stats);
            Assert.Empty(CaptureSchema.Validate(handler.Bodies[2]));
            Assert.DoesNotContain("memory-only-test-secret",Encoding.UTF8.GetString(File.ReadAllBytes(file)));
        }
        finally { File.Delete(file); }
    }
    [Theory]
    [InlineData("{}")]
    [InlineData("not-json")]
    [InlineData("{\"cropKey\":\"crops/other/wrong.png\"}")]
    public async Task Malformed_crop_response_keeps_crop_and_blocks_veteran(string response)
    {
        var file = Path.Combine(Path.GetTempPath(), "uma-outbox-" + Guid.NewGuid().ToString("N") + ".db");
        try
        {
            var capture = SerializationTests.Capture(); var clock = new Clock(); var outbox = new UploadOutbox(file,clock);
            outbox.Enqueue(capture.CaptureId,"veteran",Encoding.UTF8.GetBytes(CaptureJson.Serialize(capture)));
            outbox.Enqueue(capture.CaptureId,"crop",Png,"/stats/spd");
            var handler = new Handler { CropResponse = response };
            Assert.True(await new UploadClient(new(handler),new("https://example.test/"),new Token(),outbox).SendNextAsync());
            Assert.Null(outbox.Next());
            clock.UtcNow += TimeSpan.FromSeconds(2);
            var pending = new UploadOutbox(file,clock).Next();
            Assert.Equal("crop",pending!.Kind); Assert.Equal(1,pending.Attempts);
            Assert.Single(handler.Requests);
        }
        finally { File.Delete(file); }
    }
}
