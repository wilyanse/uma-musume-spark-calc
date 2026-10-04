using System.Net;
using Uma.Agent.Core;
using Uma.Agent.Windows.Shell;
using Xunit;

namespace Uma.Agent.Windows.Portable.Tests;

internal sealed class ScriptedConfirm(params bool[] answers) : IConfirm
{
    private readonly Queue<bool> _answers = new(answers);
    public List<(string Title, string Message)> Asked { get; } = [];
    public bool Confirm(string title, string message) { Asked.Add((title, message)); return _answers.Dequeue(); }
}

public class UploadServiceTests
{
    private const string Id = "client-id.access", Secret = "SECRET-never-in-logs-0123";
    private static Repo R => Repo.Instance;

    private sealed class Rig : IDisposable
    {
        public string Dir { get; } = Temp.Dir();
        public TestClock Clock { get; } = new();
        public UploadOutbox Outbox { get; }
        public StubApi Api { get; } = new();
        public ServiceTokenStore Tokens { get; }
        public ListLog Log { get; } = new();
        public AgentSettings Settings { get; set; } = new("https://uma.example.test/", "UmamusumePrettyDerby", "");
        public UploadService Service { get; }
        public Rig(bool token = true)
        {
            Outbox = new UploadOutbox(Path.Combine(Dir, "outbox.db"), Clock);
            Tokens = new ServiceTokenStore(Path.Combine(Dir, "token.bin"), new XorProtector());
            if (token) Tokens.Save(Id, Secret);
            Service = new UploadService(Outbox, () => Settings, Tokens, Clock, () => Api, Log);
        }
        public string Queue()
        {
            var pipeline = new CapturePipeline(R.Data, new FrameDispatchOcr(), Outbox, Clock, new UlidGenerator(Clock, Seeded.Bytes(9)), "t", new FrameGate(Clock, TimeSpan.FromSeconds(2)), Log);
            var first = R.Parser(Repo.McQueen[0]).ParseAsync(R.Frame(Repo.McQueen[0])).GetAwaiter().GetResult();
            // SYNTHETIC whole-list Skills thumb (see CapturePipelineTests), plus two SYNTHETIC uncertain readings so crops exist.
            first = first with { Thumb = new ScrollThumb(R.Data.Layout.Int("scrollbar", "trackTop"), R.Data.Layout.Int("scrollbar", "trackBottom")) };
            ParsedFrame Uncertain(ParsedFrame p) => p.Header is { } h ? p with { Header = h with { Stats = h.Stats.ToDictionary(kv => kv.Key, kv => kv.Key == "gut" ? kv.Value with { Ok = false } : kv.Value) } } : p;
            pipeline.Accept(Uncertain(first));
            foreach (var n in Repo.McQueen.Skip(1).Append(Repo.SpecialWeekPopup).Append(Repo.OperaPopup))
                pipeline.Accept(Uncertain(R.Parser(n).ParseAsync(R.Frame(n)).GetAwaiter().GetResult()));
            var e = Assert.Single(pipeline.Flush());
            Assert.Equal(PipelineEventKind.Queued, e.Kind);
            return e.CaptureId!;
        }
        public void Dispose() { Service.DisposeAsync().AsTask().GetAwaiter().GetResult(); Temp.Drop(Dir); }
    }

    private void NoSecretsLogged(Rig rig)
    {
        foreach (var line in rig.Log.Lines) { Assert.DoesNotContain(Secret, line); Assert.DoesNotContain(Id, line); }
    }

    [Fact]
    public void The_default_handler_is_UploadClient_CreateHandler_with_no_automatic_redirects()
    {
        using var handler = UploadService.DefaultHandler();
        var h = Assert.IsType<HttpClientHandler>(handler);
        Assert.False(h.AllowAutoRedirect);
    }

    [Fact]
    public async Task Drains_crops_before_the_veteran_with_the_service_token_headers()
    {
        using var rig = new Rig();
        var captureId = rig.Queue();
        var sent = await rig.Service.DrainAsync(CancellationToken.None);
        Assert.Equal(2, sent);   // 1 crop (/stats/gut) + the veteran
        Assert.Equal(["PUT", "POST"], rig.Api.Requests.Select(r => r.Method));
        Assert.StartsWith($"/api/v1/crops/{captureId}?path=", rig.Api.Requests[0].Path);
        Assert.Equal("/api/v1/veterans", rig.Api.Requests[1].Path);
        Assert.All(rig.Api.Requests, r => { Assert.Equal(Id, r.ClientId); Assert.Equal(Secret, r.Secret); });
        Assert.Equal(new OutboxHealth(0, 0, false, null), rig.Service.Health());
        Assert.Equal("01K7B33MXGVZV6TZRJZDHB99Z0", rig.Outbox.UploadedVeteranId(captureId));
        NoSecretsLogged(rig);
    }

    [Fact]
    public async Task No_address_or_no_token_pauses_uploads_without_sending_anything()
    {
        using var rig = new Rig(token: false);
        rig.Queue();
        Assert.Null(await rig.Service.PumpOnceAsync(CancellationToken.None));
        Assert.Equal(UploadBlock.NoToken, rig.Service.Block);
        rig.Tokens.Save(Id, Secret);
        rig.Settings = rig.Settings with { ApiBaseUrl = "" };
        Assert.Null(await rig.Service.PumpOnceAsync(CancellationToken.None));
        Assert.Equal(UploadBlock.NoAddress, rig.Service.Block);
        rig.Settings = rig.Settings with { ApiBaseUrl = "http://uma.example.test/" };   // never send the token over http
        Assert.Null(await rig.Service.PumpOnceAsync(CancellationToken.None));
        Assert.Equal(UploadBlock.NoAddress, rig.Service.Block);
        Assert.Empty(rig.Api.Requests);
        rig.Settings = rig.Settings with { ApiBaseUrl = "https://uma.example.test" };
        Assert.Equal(2, await rig.Service.DrainAsync(CancellationToken.None));
        Assert.Equal(UploadBlock.None, rig.Service.Block);
    }

    [Theory]
    [InlineData(401)]
    [InlineData(403)]
    [InlineData(302)]
    public async Task Refused_token_holds_the_queue_until_RetryAuthNow_after_a_new_token(int code)
    {
        using var rig = new Rig();
        rig.Queue();
        rig.Api.Script.Enqueue(_ => code == 302
            ? new HttpResponseMessage(HttpStatusCode.Found) { Headers = { Location = new Uri("https://team.cloudflareaccess.com/cdn-cgi/access/login") } }
            : StubApi.Status((HttpStatusCode)code));
        var a = await rig.Service.PumpOnceAsync(CancellationToken.None);
        Assert.Equal(UploadOutcome.AuthRequired, a!.Outcome);
        Assert.True(rig.Service.Health().AuthRequired);
        Assert.Equal(UploadBlock.AuthRefused, rig.Service.Block);
        Assert.Equal(UploadOutcome.Idle, (await rig.Service.PumpOnceAsync(CancellationToken.None))!.Outcome);   // held (backoff)

        await rig.Service.SaveTokenAndRetryAsync("new-id", "new-secret");
        Assert.Equal(2, await rig.Service.DrainAsync(CancellationToken.None));   // due immediately, no clock advance
        Assert.Equal(("new-id", "new-secret"), (rig.Api.Requests[^1].ClientId, rig.Api.Requests[^1].Secret));
        Assert.False(rig.Service.Health().AuthRequired);
        Assert.Equal(UploadBlock.None, rig.Service.Block);
        foreach (var line in rig.Log.Lines) Assert.DoesNotContain("new-secret", line);
        NoSecretsLogged(rig);
    }

    [Fact]
    public async Task Dead_items_are_requeued_or_discarded_only_after_confirmation()
    {
        using var rig = new Rig();
        var captureId = rig.Queue();
        rig.Api.Script.Enqueue(_ => StubApi.Json(HttpStatusCode.UnprocessableEntity, "{\"error\":\"bad\"}"));
        Assert.Equal(UploadOutcome.Rejected, (await rig.Service.PumpOnceAsync(CancellationToken.None))!.Outcome);
        var dead = Assert.Single(rig.Service.DeadItems());
        Assert.Equal("crop", dead.Kind);
        Assert.Equal(UploadOutcome.Idle, (await rig.Service.PumpOnceAsync(CancellationToken.None))!.Outcome);   // veteran waits for its crop

        var no = new ScriptedConfirm(false, false);
        Assert.False(await rig.Service.RequeueAsync(dead.Id, no));
        Assert.Equal(0, await rig.Service.DiscardAsync(dead.Id, no));
        Assert.Equal(2, no.Asked.Count);
        Assert.Contains("2 queued item", no.Asked[1].Message);   // discard names the whole capture group
        Assert.Contains(captureId, no.Asked[1].Message);
        Assert.Single(rig.Service.DeadItems());

        Assert.True(await rig.Service.RequeueAsync(dead.Id, new ScriptedConfirm(true)));
        Assert.Equal(2, await rig.Service.DrainAsync(CancellationToken.None));
        Assert.Empty(rig.Outbox.Snapshot());
    }

    [Fact]
    public async Task Discard_with_confirmation_removes_the_whole_capture_group()
    {
        using var rig = new Rig();
        rig.Queue();
        rig.Api.Script.Enqueue(_ => StubApi.Json(HttpStatusCode.UnprocessableEntity, "{}"));
        await rig.Service.PumpOnceAsync(CancellationToken.None);
        var dead = Assert.Single(rig.Service.DeadItems());
        Assert.Equal(2, await rig.Service.DiscardAsync(dead.Id, new ScriptedConfirm(true)));
        Assert.Empty(rig.Outbox.Snapshot());
        Assert.Equal(UploadOutcome.Idle, (await rig.Service.PumpOnceAsync(CancellationToken.None))!.Outcome);
        Assert.Equal(0, await rig.Service.DiscardAsync(dead.Id, new ScriptedConfirm()));   // unknown id: nothing asked or removed
    }

    private sealed class BlockingApi : HttpMessageHandler
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Entered.TrySetResult();
            await Task.Delay(Timeout.Infinite, ct);
            throw new InvalidOperationException("unreachable");
        }
    }

    [Fact]
    public async Task Cancelling_an_in_flight_upload_leaves_the_item_pending_and_untouched()
    {
        var dir = Temp.Dir();
        try
        {
            var clock = new TestClock();
            var outbox = new UploadOutbox(Path.Combine(dir, "outbox.db"), clock);
            var tokens = new ServiceTokenStore(Path.Combine(dir, "t.bin"), new XorProtector());
            tokens.Save(Id, Secret);
            var api = new BlockingApi();
            var log = new ListLog();
            await using var service = new UploadService(outbox, () => new AgentSettings("https://uma.example.test/", "P", ""), tokens, clock, () => api, log);
            var pipeline = new CapturePipeline(R.Data, new FrameDispatchOcr(), outbox, clock, new UlidGenerator(clock, Seeded.Bytes(3)), "t", new FrameGate(clock, TimeSpan.FromSeconds(2)), log);
            var first = await R.Parser(Repo.McQueen[0]).ParseAsync(R.Frame(Repo.McQueen[0]));
            pipeline.Accept(first with { Thumb = new ScrollThumb(R.Data.Layout.Int("scrollbar", "trackTop"), R.Data.Layout.Int("scrollbar", "trackBottom")) });
            foreach (var n in Repo.McQueen.Skip(1).Append(Repo.SpecialWeekPopup).Append(Repo.OperaPopup)) pipeline.Accept(await R.Parser(n).ParseAsync(R.Frame(n)));
            Assert.Equal(PipelineEventKind.Queued, Assert.Single(pipeline.Flush()).Kind);

            using var cts = new CancellationTokenSource();
            var pump = service.PumpOnceAsync(cts.Token);
            await api.Entered.Task;
            cts.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => pump);
            var item = Assert.Single(outbox.Snapshot());
            Assert.Equal((0, false, null), (item.Attempts, item.Dead, item.LastError));
        }
        finally { Temp.Drop(dir); }
    }

    [Fact]
    public async Task Background_loop_uploads_when_poked_and_stops_cleanly()
    {
        using var rig = new Rig();
        rig.Queue();
        var waits = 0;
        using var cts = new CancellationTokenSource();
        Task Delay(TimeSpan t, CancellationToken ct) { if (++waits >= 3) cts.Cancel(); return Task.CompletedTask; }
        await rig.Service.RunAsync(Delay, cts.Token);   // returns (no exception) when cancelled
        Assert.Empty(rig.Outbox.Snapshot());
        Assert.Equal(2, rig.Api.Requests.Count);
    }

    [Fact]
    public async Task Transport_failures_back_off_and_are_logged_by_category_only()
    {
        using var rig = new Rig();
        rig.Queue();
        rig.Api.Script.Enqueue(_ => throw new HttpRequestException("connect failed to https://uma.example.test/?secret=" + Secret));
        var a = await rig.Service.PumpOnceAsync(CancellationToken.None);
        Assert.Equal(UploadOutcome.Retrying, a!.Outcome);
        Assert.Equal("HttpRequestException", a.Error);
        Assert.Contains(rig.Log.Lines, l => l.Contains("HttpRequestException"));
        NoSecretsLogged(rig);
    }
}
