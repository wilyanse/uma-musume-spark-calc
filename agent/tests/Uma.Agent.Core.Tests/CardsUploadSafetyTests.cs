using System.Net;
using System.Text;
using System.Text.Json;
using Uma.Agent.Core.Cards;
using Xunit;

namespace Uma.Agent.Core.Tests;

// Synthetic HTTP replay only; no deployed endpoint or credentials.
public class CardsUploadSafetyTests
{
    private sealed class Token : IServiceToken { public (string ClientId, string ClientSecret) Read() => ("id", "memory-only"); }
    private sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) : HttpMessageHandler
    { protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct) => send(r, ct); }
    // Every coordinator wait is bounded so an ordering regression fails instead of hanging the run.
    private static readonly TimeSpan Bound = TimeSpan.FromSeconds(5);
    private static OwnedCardsSync Body(int n) => new(1, DateTimeOffset.Parse("2026-10-03T00:00:00Z"), "master", n,
        Enumerable.Range(0,n).Select(i => new OwnedCard($"card:c-{i}",0,30,0.9)).ToArray());
    private static HttpResponseMessage Ack(int n) => CardsUploaderTests.Json(HttpStatusCode.OK, $"{{\"count\":{n},\"partial\":false,\"syncedAt\":\"2026-10-03T00:00:00.000Z\"}}");
    private static OwnedCardsUploader Uploader(Handler h, Func<TimeSpan,CancellationToken,Task>? delay=null) => new(new HttpClient(h),new Uri("https://api.example.test/"),new Token(),null,
        new(3,TimeSpan.Zero,TimeSpan.Zero),delay ?? ((_,_)=>Task.CompletedTask));

    [Fact]
    public void Dto_copies_ingress_and_with_assigned_lists()
    {
        var source=Body(2).Cards.ToList(); var b=Body(2) with { Cards=source }; source.Clear();
        Assert.Equal(2,b.Cards.Count);
        Assert.False(b.Cards is OwnedCard[]);
        Assert.Throws<NotSupportedException>(()=>((IList<OwnedCard>)b.Cards).Clear());
    }

    [Fact]
    public async Task Mutation_during_request_cannot_change_ack_expectations()
    {
        var cards=Body(2).Cards.ToList(); var b=Body(2) with { Cards=cards };
        var up=Uploader(new Handler(async (r,ct)=> { Assert.Equal(2,JsonDocument.Parse(await r.Content!.ReadAsStringAsync(ct)).RootElement.GetProperty("cards").GetArrayLength()); cards.Clear(); return Ack(1); }));
        Assert.Equal(OwnedCardsUploadOutcome.Failed,(await up.SendAsync(new(b,false))).Outcome);
    }

    [Theory]
    [InlineData("{\"count\":2,\"count\":2,\"partial\":false,\"syncedAt\":\"2026-10-03T00:00:00Z\"}")]
    [InlineData("{\"count\":2,\"partial\":false,\"syncedAt\":\"October 3, 2026 00:00:00Z\"}")]
    public async Task Duplicate_keys_and_non_ISO_dates_are_not_acknowledgements(string json)
    {
        var up=Uploader(new Handler((_,_)=>Task.FromResult(CardsUploaderTests.Json(HttpStatusCode.OK,json))));
        Assert.Equal(OwnedCardsUploadOutcome.Failed,(await up.SendAsync(new(Body(2),false))).Outcome);
    }

    [Fact]
    public async Task HTML_success_with_JSON_ack_bytes_is_never_acknowledged()
    {
        var up=Uploader(new Handler((_,_)=>Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) {
            Content=new StringContent("{\"count\":2,\"partial\":false,\"syncedAt\":\"2026-10-03T00:00:00Z\"}",Encoding.UTF8,"text/html") })));
        var result=await up.SendAsync(new(Body(2),false));
        Assert.Equal(OwnedCardsUploadOutcome.Failed,result.Outcome);
        Assert.Equal(3,result.Attempts);
    }

    [Fact]
    public async Task Generic_HTML_502_retries_not_auth()
    {
        int calls=0; var up=Uploader(new Handler((_,_)=>Task.FromResult(++calls==1
            ? new HttpResponseMessage(HttpStatusCode.BadGateway){ Content=new StringContent("<html>Bad gateway</html>",Encoding.UTF8,"text/html") } : Ack(2))));
        var result=await up.SendAsync(new(Body(2),false)); Assert.Equal(OwnedCardsUploadOutcome.Synced,result.Outcome); Assert.Equal(2,result.Attempts);
    }

    [Fact]
    public async Task Malformed_public_DTOs_are_invalid_without_network()
    {
        int calls=0; var up=Uploader(new Handler((_,_)=> { calls++; return Task.FromResult(Ack(0)); }));
        foreach(var b in new OwnedCardsSync[] { null!, Body(0) with { Cards=null! }, Body(1) with { Cards=[null!] } })
        { var r=await up.SendAsync(new(b,false)); Assert.Equal(OwnedCardsUploadOutcome.Invalid,r.Outcome); Assert.Equal(0,r.Attempts); Assert.Equal("invalid-schema",r.ErrorCategory); }
        Assert.Equal(0,calls);
    }

    [Theory]
    [InlineData("2026-10-03T00:00:00Z")]
    [InlineData("2026-10-03T00:00:00.000Z")]
    [InlineData("2024-02-29T23:59:59.1234567Z")]
    public void Strict_ack_accepts_schema_ISO_UTC_forms(string at)
    {
        Assert.NotNull(OwnedCardsUploader.TryAck($"{{\"count\":2,\"partial\":false,\"syncedAt\":\"{at}\"}}",2,false));
    }

    [Theory]
    [InlineData("2026-02-29T00:00:00Z")]
    [InlineData("2026-10-03 00:00:00Z")]
    [InlineData("2026-10-03T00:00:00+00:00")]
    [InlineData("2026-10-03T24:00:00Z")]
    [InlineData("2026-10-03T00:00:00Z\n")]
    public void Strict_ack_refuses_invalid_calendar_and_non_schema_UTC_forms(string at)
    {
        Assert.Null(OwnedCardsUploader.TryAck(JsonSerializer.Serialize(new { count=2,partial=false,syncedAt=at }),2,false));
    }

    [Theory]
    [InlineData("{\"count\":2,\"partial\":false,\"partial\":false,\"syncedAt\":\"2026-10-03T00:00:00Z\"}")]
    [InlineData("{\"count\":2,\"partial\":false,\"syncedAt\":\"2026-10-03T00:00:00Z\",\"syncedAt\":\"2026-10-03T00:00:00Z\"}")]
    [InlineData("{\"count\":2.0,\"partial\":false,\"syncedAt\":\"2026-10-03T00:00:00Z\"}")]
    [InlineData("{\"count\":2,\"partial\":0,\"syncedAt\":\"2026-10-03T00:00:00Z\"}")]
    public void Every_ack_key_is_unique_and_types_are_strict(string json)
    {
        Assert.Null(OwnedCardsUploader.TryAck(json,2,false));
    }

    [Theory]
    [InlineData(200)]
    [InlineData(502)]
    public async Task Generic_HTML_has_bounded_retry_not_auth(int status)
    {
        int calls=0;
        var up=Uploader(new Handler((_,_)=> { calls++; return Task.FromResult(new HttpResponseMessage((HttpStatusCode)status){ Content=new StringContent("<html>gateway error</html>",Encoding.UTF8,"text/html") }); }));
        var r=await up.SendAsync(new(Body(2),false));
        Assert.Equal(OwnedCardsUploadOutcome.Failed,r.Outcome); Assert.Equal(3,calls); Assert.Equal(3,r.Attempts);
    }

    [Fact]
    public async Task Constructor_freezes_cards_before_send_and_retry_snapshot_stays_identical()
    {
        var cards=Body(2).Cards.ToList(); var original=Body(2);
        var body=new OwnedCardsSync(1,original.CapturedAt,original.MasterVersion,2,cards);
        var payload=new OwnedCardsSyncPayload(body,false); cards.Clear();
        var bytes=new List<string>();
        var up=Uploader(new Handler(async(r,ct)=> { bytes.Add(await r.Content!.ReadAsStringAsync(ct)); return bytes.Count==1 ? CardsUploaderTests.Json(HttpStatusCode.ServiceUnavailable,"{}") : Ack(2); }));
        var result=await up.SendAsync(payload);
        Assert.Equal(OwnedCardsUploadOutcome.Synced,result.Outcome); Assert.Equal(2,result.Ack!.Count);
        Assert.Equal(2,bytes.Count); Assert.Equal(bytes[0],bytes[1]);
        Assert.DoesNotContain("provenance",bytes[0],StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Session_envelope_cannot_be_upgraded_or_have_Held_rewritten()
    {
        var session=CardsKit.NewSession(); session.Feed(CardsKit.Env.Parsed(CardsKit.List13));
        var p=session.BuildPartial(session.State.PartialConfirmation!);
        Assert.Null(typeof(OwnedCardsSyncPayload).GetProperty("Body")!.SetMethod);
        Assert.Null(typeof(OwnedCardsSyncPayload).GetProperty("Partial")!.SetMethod);
        Assert.Empty(typeof(OwnedCardsSyncPayload).GetConstructors());
        int calls=0; var up=Uploader(new Handler((_,_)=> { calls++; return Task.FromResult(Ack(20)); }));
        foreach(var forged in new[] {
            new OwnedCardsSyncPayload(p.Body with { HeldCount=20 }, false),
            new OwnedCardsSyncPayload(p.Body with { HeldCount=20 }, true),
            new OwnedCardsSyncPayload(p.Body, false) })
        {
            var result=await up.SendAsync(forged);
            Assert.Equal(OwnedCardsUploadOutcome.Invalid,result.Outcome);
        }
        Assert.Equal(0,calls);
        Assert.Equal(208,p.Body.HeldCount); Assert.True(p.Partial);
    }

    [Fact]
    public async Task Replacement_waits_for_noncooperative_inflight_request_then_sends_newest()
    {
        var entered=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        int calls=0,active=0,max=0;
        var up=Uploader(new Handler(async(r,ct)=> {
            int call=Interlocked.Increment(ref calls); int a=Interlocked.Increment(ref active); max=Math.Max(max,a);
            try { if(call==1){entered.SetResult(); await release.Task;} return Ack(call==1 ? 19 : 20); }
            finally { Interlocked.Decrement(ref active); }
        }));
        var coordinator=new OwnedCardsUploadCoordinator(); var first=coordinator.BeginGeneration();
        var old=coordinator.SendAsync(first,up,new(Body(19),false)); await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        // A replacement uploader/HttpClient for the SAME target must share this gate.
        var replacementUp=Uploader(new Handler((_,_)=> {
            Interlocked.Increment(ref calls); int a=Interlocked.Increment(ref active); max=Math.Max(max,a);
            Interlocked.Decrement(ref active); return Task.FromResult(Ack(20));
        }));
        var second=coordinator.BeginGeneration(); var newer=coordinator.SendAsync(second,replacementUp,new(Body(20),false));
        Assert.False(newer.IsCompleted); Assert.Equal(1,calls);
        coordinator.Invalidate(first); // stale cancel callback must not invalidate second
        release.SetResult(); await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>old.WaitAsync(Bound));
        Assert.Equal(OwnedCardsUploadOutcome.Synced,(await newer.WaitAsync(TimeSpan.FromSeconds(5))).Outcome);
        Assert.Equal(2,calls); Assert.Equal(1,max);
    }

    [Fact]
    public async Task Invalidation_stops_retries_even_when_delay_ignores_cancellation()
    {
        var entered=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        int calls=0;
        var up=Uploader(new Handler((_,_)=> { calls++; return Task.FromResult(CardsUploaderTests.Json(HttpStatusCode.ServiceUnavailable,"{}")); }),
            async(_,_)=> { entered.TrySetResult(); await release.Task; });
        var c=new OwnedCardsUploadCoordinator(); var generation=c.BeginGeneration();
        var send=c.SendAsync(generation,up,new(Body(19),false)); await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        c.Invalidate(generation); release.SetResult();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>send.WaitAsync(Bound)); Assert.Equal(1,calls);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>c.SendAsync(generation,up,new(Body(19),false)));
    }

    [Fact]
    public async Task Auth_repair_reuses_coordinator_and_never_resurrects_stale_generation()
    {
        int calls=0;
        var refusing=Uploader(new Handler((_,_)=> { calls++; return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized)); }));
        var repaired=Uploader(new Handler((_,_)=> { calls++; return Task.FromResult(Ack(20)); }));
        var c=new OwnedCardsUploadCoordinator(); var old=c.BeginGeneration();
        Assert.Equal(OwnedCardsUploadOutcome.AuthRequired,(await c.SendAsync(old,refusing,new(Body(19),false))).Outcome);
        var current=c.BeginGeneration();
        Assert.Equal(OwnedCardsUploadOutcome.Synced,(await c.SendAsync(current,repaired,new(Body(20),false))).Outcome);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>c.SendAsync(old,repaired,new(Body(19),false)));
        Assert.Equal(2,calls);
    }

    [Fact]
    public async Task Auth_repair_for_still_current_generation_is_allowed()
    {
        int calls=0; var up=Uploader(new Handler((_,_)=>Task.FromResult(++calls==1 ? new HttpResponseMessage(HttpStatusCode.Forbidden) : Ack(20))));
        var c=new OwnedCardsUploadCoordinator(); var g=c.BeginGeneration(); var p=new OwnedCardsSyncPayload(Body(20),false);
        Assert.Equal(OwnedCardsUploadOutcome.AuthRequired,(await c.SendAsync(g,up,p)).Outcome);
        Assert.Equal(OwnedCardsUploadOutcome.Synced,(await c.SendAsync(g,up,p)).Outcome);
    }

    [Fact]
    public async Task Stale_generation_send_is_refused_before_it_can_bind_the_coordinator_target()
    {
        // A cancelled/replaced generation must be refused up front. Otherwise a stale UI callback could pin the
        // coordinator to its uploader's target and make the current generation's legitimate send fail.
        int calls=0;
        var c=new OwnedCardsUploadCoordinator(); var stale=c.BeginGeneration(); c.Invalidate(stale);
        var other=new OwnedCardsUploader(new HttpClient(new Handler((_,_)=> { calls++; return Task.FromResult(Ack(2)); })),new Uri("https://other.example.test/"),new Token(),null);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>c.SendAsync(stale,other,new(Body(2),false)));
        var current=c.BeginGeneration();
        var up=Uploader(new Handler((_,_)=> { calls++; return Task.FromResult(Ack(2)); }));
        Assert.Equal(OwnedCardsUploadOutcome.Synced,(await c.SendAsync(current,up,new(Body(2),false))).Outcome);
        Assert.Equal(1,calls);
    }

    [Fact]
    public async Task Coordinator_rejects_foreign_generation_and_changed_target()
    {
        var c=new OwnedCardsUploadCoordinator(); var g=c.BeginGeneration();
        var up=Uploader(new Handler((_,_)=>Task.FromResult(Ack(2))));
        await Assert.ThrowsAsync<ArgumentException>(()=>c.SendAsync(new OwnedCardsUploadCoordinator().BeginGeneration(),up,new(Body(2),false)));
        await c.SendAsync(g,up,new(Body(2),false));
        var wrong=new OwnedCardsUploader(new HttpClient(new Handler((_,_)=>Task.FromResult(Ack(2)))),new Uri("https://other.example.test/"),new Token(),null);
        await Assert.ThrowsAsync<ArgumentException>(()=>c.SendAsync(g,wrong,new(Body(2),false)));
    }

    // Response content that completes even though the generation is replaced WHILE it is being read
    // (the replacement happens inside the read, so no cancellation is observed by the uploader).
    private sealed class ReplaceDuringReadContent(string json, Action duringRead) : HttpContent
    {
        protected override async Task SerializeToStreamAsync(Stream stream, System.Net.TransportContext? context)
        { duringRead(); var b = Encoding.UTF8.GetBytes(json); await stream.WriteAsync(b); }
        protected override bool TryComputeLength(out long length) { length = -1; return false; }
    }

    [Fact]
    public async Task A_success_that_completes_after_replacement_is_never_published()
    {
        var c = new OwnedCardsUploadCoordinator(); var first = c.BeginGeneration();
        OwnedCardsUploadCoordinator.Generation? second = null;
        var up = Uploader(new Handler((_, _) => {
            var r = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ReplaceDuringReadContent(
                "{\"count\":19,\"partial\":false,\"syncedAt\":\"2026-10-03T00:00:00Z\"}", () => second = c.BeginGeneration()) };
            r.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
            return Task.FromResult(r);
        }));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => c.SendAsync(first, up, new(Body(19), false)).WaitAsync(Bound));
        Assert.NotNull(second);
    }

    [Fact]
    public async Task Newest_replacement_forbids_old_retry_19_20_19()
    {
        var retry=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var resume=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var replacements=new List<int>();
        var up=Uploader(new Handler(async(r,ct)=> {
            int n=JsonDocument.Parse(await r.Content!.ReadAsStringAsync(ct)).RootElement.GetProperty("cards").GetArrayLength(); replacements.Add(n);
            return replacements.Count==1 ? CardsUploaderTests.Json(HttpStatusCode.ServiceUnavailable,"{}") : Ack(n);
        }),async(_,ct)=> { retry.TrySetResult(); await resume.Task.WaitAsync(ct); });
        var coordinator=new OwnedCardsUploadCoordinator(); var first=coordinator.BeginGeneration();
        var old=coordinator.SendAsync(first,up,new(Body(19),false)); await retry.Task.WaitAsync(Bound);
        var second=coordinator.BeginGeneration();
        // Bounded: if replacement did not cancel the old retry, the newer send would wait forever behind it.
        var newer=await coordinator.SendAsync(second,up,new(Body(20),false)).WaitAsync(Bound); resume.SetResult();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>old.WaitAsync(Bound));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>coordinator.SendAsync(first,up,new(Body(19),false)));
        Assert.Equal(OwnedCardsUploadOutcome.Synced,newer.Outcome);
        Assert.Equal(new[]{19,20},replacements);
    }
}
