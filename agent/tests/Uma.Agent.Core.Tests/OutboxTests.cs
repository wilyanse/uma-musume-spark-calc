using System.Net;
using Xunit;
namespace Uma.Agent.Core.Tests;

public class OutboxTests
{
    private sealed class Clock : IClock { public DateTimeOffset UtcNow { get; set; } = new(2026, 9, 30, 0, 0, 0, TimeSpan.Zero); }
    private sealed class Token : IServiceToken { public (string ClientId, string ClientSecret) Read() => ("id", "secret"); }
    private sealed class Handler : HttpMessageHandler
    {
        public readonly List<string> Requests = [];
        public int Failures;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Assert.Equal("id", request.Headers.GetValues("CF-Access-Client-Id").Single());
            Assert.Equal("secret", request.Headers.GetValues("CF-Access-Client-Secret").Single());
            Requests.Add(request.RequestUri!.PathAndQuery);
            var code = Failures-- > 0 ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.OK;
            return Task.FromResult(new HttpResponseMessage(code));
        }
    }
    [Fact]
    public async Task Crop_retry_blocks_veteran_even_when_veteran_is_due()
    {
        var file = Path.Combine(Path.GetTempPath(), "uma-outbox-" + Guid.NewGuid().ToString("N") + ".db");
        try
        {
            var clock = new Clock(); var outbox = new UploadOutbox(file, clock);
            outbox.Enqueue("capture", "veteran", "{}"u8.ToArray());
            outbox.Enqueue("capture", "crop", [1, 2, 3], "/stats/spd");
            var handler = new Handler { Failures = 1 };
            var client = new UploadClient(new HttpClient(handler), new Uri("https://example.test/"), new Token(), outbox);
            Assert.True(await client.SendNextAsync());
            Assert.Null(outbox.Next()); // crop retry gates this capture's veteran
            clock.UtcNow += TimeSpan.FromSeconds(2);
            Assert.True(await client.SendNextAsync());
            Assert.True(await client.SendNextAsync());
            Assert.False(await client.SendNextAsync());
            Assert.Equal(3, handler.Requests.Count);
            Assert.StartsWith("/api/v1/crops/capture?path=%2Fstats%2Fspd", handler.Requests[0]);
            Assert.Equal(handler.Requests[0], handler.Requests[1]);
            Assert.Equal("/api/v1/veterans", handler.Requests[2]);
            // Restart leaves no lost pending records.
            Assert.Null(new UploadOutbox(file, clock).Next());
        }
        finally { File.Delete(file); }
    }
}
