using System.Net;
using Uma.Agent.Core;
using Uma.Agent.Core.Cards;
using Uma.Agent.Windows.Shell;
using Xunit;

namespace Uma.Agent.Windows.Portable.Tests;

/// <summary>T10b review round 1 regressions (B1, B2, S1, S2, S3, N1). Hosts are `*.example.test`; every credential is a
/// SYNTHETIC marker written through the real <see cref="ServiceTokenStore"/> with the test protector. HTTP is a
/// scripted fake handler; no live API is contacted. The scenarios mirror reviewer probes P1–P10 but assert the
/// required behaviour instead of printing it.</summary>
public class CardReviewRound1Tests
{
    private static Repo R => Repo.Instance;
    private const string OldId = "SYNTHETIC-ID-A", OldSecret = "SYNTHETIC-OLD-SECRET";
    private const string NewId = "SYNTHETIC-ID-B", NewSecret = "SYNTHETIC-NEW-SECRET-FOR-B";
    private const string HostA = "https://a.example.test/", HostB = "https://b.example.test/";
    private static readonly Frame Blank = new(new byte[1920 * 1080 * 4], 1920, 1080);

    private sealed class Hosts : HttpMessageHandler
    {
        public List<(string Host, string? Id, string? Secret)> Seen { get; } = [];
        public Func<HttpRequestMessage, Task<HttpResponseMessage>>? Respond { get; set; }
        public Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>? RespondCt { get; set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct)
        {
            var body = await r.Content!.ReadAsStringAsync(ct);
            lock (Seen) Seen.Add((r.RequestUri!.Host,
                r.Headers.TryGetValues("CF-Access-Client-Id", out var i) ? i.Single() : null,
                r.Headers.TryGetValues("CF-Access-Client-Secret", out var s) ? s.Single() : null));
            var resp = RespondCt is not null ? await RespondCt(r, ct) : Respond is null ? CardsApi.Ack(new CardsApi.Request("PUT", r.RequestUri.PathAndQuery, null, null, body)) : await Respond(r);
            resp.RequestMessage ??= r;
            return resp;
        }
    }

    private sealed class Rig : IDisposable
    {
        public string Dir { get; } = Temp.Dir();
        public TestClock Clock { get; } = new();
        public ServiceTokenStore Tokens { get; }
        public AgentSettings Settings { get; set; } = new(HostA, "Game", "");
        public Hosts Api { get; } = new();
        public CardConfirm Confirm { get; } = new();
        public ListLog Log { get; } = new();
        public Action? OnDelay { get; set; }
        public int Delays { get; private set; }
        public FrameDispatchOcr Ocr { get; } = new();
        public CardSyncController Cards { get; }
        public CapturePipeline Pipeline { get; }
        public Rig()
        {
            Tokens = new ServiceTokenStore(Path.Combine(Dir, "service-token.bin"), new XorProtector());
            Tokens.Save(OldId, OldSecret);
            Cards = new CardSyncController(R.Data, Clock, () => Settings, Tokens, () => Api, Confirm, Log,
                new OwnedCardsRetryPolicy(3, TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(30)),
                (_, _) => { Delays++; var a = OnDelay; OnDelay = null; a?.Invoke(); return Task.CompletedTask; });
            Pipeline = NewPipeline(1);
        }
        public CapturePipeline NewPipeline(int seed) => new(R.Data, Ocr, new UploadOutbox(Path.Combine(Dir, $"outbox{seed}.db"), Clock), Clock,
            new UlidGenerator(Clock, Seeded.Bytes(seed)), "t10b-r1", new FrameGate(Clock, TimeSpan.FromSeconds(2)), Log, Cards);
        public void MoveToB() { Settings = Settings with { ApiBaseUrl = HostB }; Tokens.Save(NewId, NewSecret); }
        public void TokenOnly() => Tokens.Save(NewId, NewSecret);
        public void Dispose() => Temp.Drop(Dir);
    }

    private static string[] Ids(int n) => R.Data.Master.Ids["cards"].Order(StringComparer.Ordinal).Take(n).ToArray();
    /// <summary>SYNTHETIC cards.list frame over real master IDs (blank pixels).</summary>
    private static ParsedFrame List(int n, int held)
        => new(new ScreenClassification(ScreenId.CardsList, "cards.list", 0, 1, "SYNTHETIC"), Blank, null)
        {
            HeldCount = new Reading(held, $"{held}/255", 0.9, true, [], null),
            ListTiles = Ids(n).Select((id, i) => new ListTile(i, new Reading(id, "SYNTHETIC", 0.95, true, [new Candidate(id, 0.95)], null),
                new Reading(1, null, 1, true, [], null), new Reading(30, "Lvl 30", 0.9, true, [], null))).ToArray(),
        };

    private static void NoNewCredentialToOldHost(Hosts api)
    {
        Assert.DoesNotContain(api.Seen, s => s.Host == "a.example.test" && (s.Secret == NewSecret || s.Id == NewId));
    }

    // ================= B1: destination / token binding =================

    [Fact]
    public async Task P1_unsent_scan_settings_moved_to_B_with_new_token_while_confirmation_open_sends_nothing()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(5, 10));
        rig.Confirm.Answers.Enqueue(true);
        rig.Confirm.WhileOpen = rig.MoveToB;
        var r = await rig.Cards.SendPartialAsync(rig.Cards.View!);
        Assert.Contains("a.example.test", rig.Confirm.Prompts[0].Message);   // the user confirmed A
        Assert.Equal(CardSendStatus.Stale, r.Status);
        Assert.Contains("Nothing was sent", r.Message);
        Assert.Empty(rig.Api.Seen);
        Assert.False(rig.Cards.RemoteUnknown);
        Assert.DoesNotContain(NewSecret, r.Message);
        Assert.DoesNotContain(rig.Log.Lines, l => l.Contains(NewSecret, StringComparison.Ordinal) || l.Contains(OldSecret, StringComparison.Ordinal));
    }

    [Fact]
    public async Task P1b_bound_scan_settings_moved_to_B_while_confirmation_open_sends_nothing_more()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(5, 10));
        rig.Confirm.Answers.Enqueue(true);
        Assert.Equal(CardSendStatus.Synced, (await rig.Cards.SendPartialAsync(rig.Cards.View!)).Status);
        rig.Pipeline.Accept(List(6, 10));
        rig.Confirm.Answers.Enqueue(true);
        rig.Confirm.WhileOpen = rig.MoveToB;
        var r = await rig.Cards.SendPartialAsync(rig.Cards.View!);
        Assert.Equal(CardSendStatus.Stale, r.Status);
        var only = Assert.Single(rig.Api.Seen);
        Assert.Equal(("a.example.test", OldSecret), (only.Host, only.Secret));
        NoNewCredentialToOldHost(rig.Api);
    }

    [Fact]
    public async Task P2_settings_moved_to_B_during_the_retry_delay_stops_before_the_next_attempt()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(5, 10));
        rig.Api.Respond = _ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        rig.OnDelay = () => { rig.MoveToB(); rig.Api.Respond = null; };
        rig.Confirm.Answers.Enqueue(true);
        var r = await rig.Cards.SendPartialAsync(rig.Cards.View!);
        Assert.Equal(CardSendStatus.Stale, r.Status);
        var only = Assert.Single(rig.Api.Seen);                   // the first attempt only; no old-host retry
        Assert.Equal(("a.example.test", OldSecret), (only.Host, only.Secret));
        NoNewCredentialToOldHost(rig.Api);
        Assert.Contains("cannot be undone", r.Message);
    }

    [Fact]
    public async Task P1t_token_only_change_while_confirmation_open_sends_nothing()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(5, 10));
        rig.Confirm.Answers.Enqueue(true);
        rig.Confirm.WhileOpen = rig.TokenOnly;
        var r = await rig.Cards.SendPartialAsync(rig.Cards.View!);
        Assert.Equal(CardSendStatus.Stale, r.Status);
        Assert.Contains("while this sync was being confirmed. Nothing was sent", r.Message);   // refused after the modal, before any attempt
        Assert.Empty(rig.Api.Seen);
        Assert.False(rig.Cards.RemoteUnknown);
        Assert.NotNull(rig.Cards.View);                           // token-only: the scan is kept
    }

    [Fact]
    public async Task P2t_token_only_change_during_the_retry_delay_stops_before_the_next_attempt()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(5, 10));
        rig.Api.Respond = _ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        rig.OnDelay = () => { rig.TokenOnly(); rig.Api.Respond = null; };
        rig.Confirm.Answers.Enqueue(true);
        var r = await rig.Cards.SendPartialAsync(rig.Cards.View!);
        Assert.Equal(CardSendStatus.Stale, r.Status);
        Assert.Equal(OldSecret, Assert.Single(rig.Api.Seen).Secret);
    }

    [Fact]
    public async Task P3_a_scan_started_under_A_is_cancelled_when_the_address_moves_to_B_before_any_send()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(5, 10));
        rig.Settings = rig.Settings with { ApiBaseUrl = HostB };
        rig.Confirm.Answers.Enqueue(true);
        var r = await rig.Cards.SendPartialAsync(rig.Cards.View!);
        Assert.Equal(CardSendStatus.Stale, r.Status);
        Assert.Contains("destination changed", r.Message);
        Assert.Empty(rig.Confirm.Prompts);
        Assert.Empty(rig.Api.Seen);
        Assert.Null(rig.Cards.View);
    }

    // ================= B2: transient source error recovery on a real pipeline with a primed gate =================

    [Fact]
    public async Task P8a_resize_then_the_byte_identical_valid_frame_returns_to_Capturing()
    {
        using var rig = new Rig();
        var p = rig.NewPipeline(3);
        var m = new CaptureStatusModel();
        var good = R.Frame(Repo.McQueen[0]); rig.Ocr.Add(good, R.Ocr(Repo.McQueen[0]));
        var first = await p.ProcessAsync(good, CancellationToken.None);
        Assert.Equal(PipelineEventKind.Progress, first.Kind);     // the gate now holds this exact frame
        m.Apply(first);
        rig.Clock.UtcNow += TimeSpan.FromSeconds(1);
        var bad = await p.ProcessAsync(new Frame(new byte[1280 * 720 * 4], 1280, 720), CancellationToken.None);
        Assert.Equal(PipelineEventKind.Unsupported, bad.Kind);
        m.Apply(bad);
        Assert.Equal(TrayState.Error, TrayStatus.Compute(true, p.Progress, m.Error, new(0, 0, false, null), UploadBlock.None, false).State);
        rig.Clock.UtcNow += TimeSpan.FromSeconds(3);
        var restored = await p.ProcessAsync(good, CancellationToken.None);
        Assert.Equal(PipelineEventKind.Skipped, restored.Kind);   // same still frame: gate skips, geometry was validated
        m.Apply(restored);
        Assert.Null(m.Error);
        Assert.Equal(TrayState.Capturing, TrayStatus.Compute(true, p.Progress, m.Error, new(0, 0, false, null), UploadBlock.None, false).State);
    }

    [Fact]
    public async Task P7_window_unavailable_then_the_same_frame_clears_the_error()
    {
        using var rig = new Rig();
        var p = rig.NewPipeline(2);
        var m = new CaptureStatusModel();
        var f = R.Frame("01-veteran-details-skills-independent"); rig.Ocr.Add(f, R.Ocr("01-veteran-details-skills-independent"));
        m.Apply(await p.ProcessAsync(f, CancellationToken.None));
        m.ReportCaptureError("SYNTHETIC window minimized");
        rig.Clock.UtcNow += TimeSpan.FromSeconds(5);
        var e = await p.ProcessAsync(f, CancellationToken.None);
        Assert.Equal(PipelineEventKind.Skipped, e.Kind);
        m.Apply(e);
        Assert.Null(m.Error);
    }

    [Fact]
    public async Task P8b_window_unavailable_then_a_valid_non_capture_screen_clears_the_error()
    {
        using var rig = new Rig();
        var p = rig.NewPipeline(4);
        var m = new CaptureStatusModel();
        m.ReportCaptureError("SYNTHETIC game window is minimized");
        var e = await p.ProcessAsync(Blank, CancellationToken.None);
        Assert.Equal(PipelineEventKind.Ignored, e.Kind);
        m.Apply(e);
        Assert.Null(m.Error);
    }

    // ================= S1: replace/reset/cancel authority is the confirmed handle AND revision =================

    [Fact]
    public void P4_reset_confirmed_for_5_cards_is_refused_when_8_exist_and_keeps_them()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(5, 10));
        var shown = rig.Cards.View!;
        Assert.Contains("5 collected", rig.Cards.ReplaceQuestion()!.Message);
        rig.Pipeline.Accept(List(8, 10));                          // frames arrive while the question is open
        Assert.Null(rig.Cards.Reset(shown));                      // user said Yes to 5: refused
        Assert.Equal(8, rig.Cards.View!.State.Cards.Count);
        Assert.False(rig.Cards.Cancel(shown));
        Assert.Equal(8, rig.Cards.View!.State.Cards.Count);
    }

    // ================= S2: remote state unknown after an ambiguous request =================

    [Fact]
    public async Task P10_ambiguous_5_card_send_after_an_acknowledged_8_card_sync_marks_the_web_list_unknown()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(8, 10));
        rig.Confirm.Answers.Enqueue(true);
        Assert.Equal(CardSendStatus.Synced, (await rig.Cards.SendPartialAsync(rig.Cards.View!)).Status);
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(5, 10));
        rig.Api.Respond = _ => Task.FromResult(StubApi.Json(HttpStatusCode.OK, "{}"));   // 200 without the documented ack
        rig.Confirm.Answers.Enqueue(true);
        var r = await rig.Cards.SendPartialAsync(rig.Cards.View!);
        Assert.Equal(CardSendStatus.Failed, r.Status);
        var text = CardSyncText.Describe(rig.Cards.View, true, null);
        Assert.Contains("UNKNOWN", text);
        Assert.Contains("8 card(s)", text);                       // history kept…
        Assert.DoesNotContain("(an earlier collection; the current one is not synced)", text);   // …but not presented as current
        Assert.Contains("historical", text);
    }

    [Fact]
    public async Task P5_old_acknowledgement_after_a_newer_scan_is_not_success_and_marks_the_web_list_unknown()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(5, 10));
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        rig.Api.Respond = async r => { entered.TrySetResult(); await release.Task; return CardsApi.Ack(new("PUT", r.RequestUri!.PathAndQuery, null, null, await r.Content!.ReadAsStringAsync())); };
        rig.Confirm.Answers.Enqueue(true);
        var send = rig.Cards.SendPartialAsync(rig.Cards.View!);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(3, 10));
        release.SetResult();
        var r = await send.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(CardSendStatus.Stale, r.Status);
        Assert.Null(rig.Cards.View!.LastSync);                     // a stale 200 is never recorded as acknowledged
        var text = CardSyncText.Describe(rig.Cards.View, true, null);
        Assert.Contains("UNKNOWN", text);
        Assert.DoesNotContain("Synced", r.Message);
    }

    // ================= N1: exit text distinguishes waiting-for-confirmation from sending =================

    [Fact]
    public async Task N1_exit_question_while_the_send_confirmation_is_open_says_nothing_was_sent()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(5, 10));
        DropGuard.Question? q = null;
        rig.Confirm.WhileOpen = () => q = rig.Cards.ExitQuestion();
        await rig.Cards.SendPartialAsync(rig.Cards.View!);          // answered No
        Assert.NotNull(q);
        Assert.Contains("waiting for your confirmation", q!.Message);
        Assert.DoesNotContain("is being sent", q.Message);
    }

    // ================= B1: auth repair and the actual Settings commit wiring =================

    [Fact]
    public async Task Token_only_change_keeps_the_scan_and_a_freshly_confirmed_resend_uses_the_new_token_on_the_same_host()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(5, 10));
        rig.Api.Respond = _ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Forbidden));
        rig.Confirm.Answers.Enqueue(true);
        Assert.Equal(CardSendStatus.AuthRequired, (await rig.Cards.SendPartialAsync(rig.Cards.View!)).Status);
        Assert.False(rig.Cards.RemoteUnknown);                   // a first-attempt Access refusal never reached the API
        // Settings: token-only repair through the real commit path.
        await SettingsCommitTo(rig, HostA, NewId, NewSecret);
        Assert.NotNull(rig.Cards.View);                          // same address: the scan is kept
        rig.Api.Respond = null;
        rig.Confirm.Answers.Enqueue(true);
        Assert.Equal(CardSendStatus.Synced, (await rig.Cards.SendPartialAsync(rig.Cards.View!)).Status);
        Assert.Equal(2, rig.Confirm.Prompts.Count);              // freshly confirmed
        Assert.Equal(("a.example.test", NewSecret), (rig.Api.Seen[^1].Host, rig.Api.Seen[^1].Secret));
    }

    [Fact]
    public async Task After_a_token_change_during_confirmation_the_same_scan_can_be_confirmed_again()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(5, 10));
        rig.Confirm.Answers.Enqueue(true);
        rig.Confirm.WhileOpen = rig.TokenOnly;
        Assert.Equal(CardSendStatus.Stale, (await rig.Cards.SendPartialAsync(rig.Cards.View!)).Status);
        rig.Confirm.Answers.Enqueue(true);
        Assert.Equal(CardSendStatus.Synced, (await rig.Cards.SendPartialAsync(rig.Cards.View!)).Status);
        Assert.Equal(("a.example.test", NewSecret), (Assert.Single(rig.Api.Seen).Host, rig.Api.Seen[0].Secret));
    }

    private static async Task SettingsCommitTo(Rig rig, string host, string newId, string newSecret)
    {
        var store = new SettingsStore(Path.Combine(rig.Dir, "settings.json"), Path.Combine(rig.Dir, "no-defaults.json"), rig.Clock);
        var uploader = new UploadService(new UploadOutbox(Path.Combine(rig.Dir, "settings-outbox.db"), rig.Clock), () => rig.Settings, rig.Tokens, () => new StubApi(), rig.Log);
        await SettingsCommit.CommitAsync(store, rig.Settings with { ApiBaseUrl = host }, s => rig.Settings = s, uploader, newId, newSecret, rig.Cards);
    }

    [Fact]
    public async Task Settings_saved_from_the_tray_while_the_confirmation_is_open_cancels_the_scan_and_sends_nothing()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(5, 10));
        rig.Confirm.Answers.Enqueue(true);
        rig.Confirm.WhileOpen = () => SettingsCommitTo(rig, HostB, NewId, NewSecret).GetAwaiter().GetResult();
        var r = await rig.Cards.SendPartialAsync(rig.Cards.View!);
        Assert.Equal(CardSendStatus.Stale, r.Status);
        Assert.Empty(rig.Api.Seen);
        Assert.Null(rig.Cards.View);                              // the scan belonged to A
        Assert.Equal(HostB, rig.Settings.ApiBaseUrl);
        Assert.DoesNotContain(rig.Log.Lines, l => l.Contains(NewSecret, StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Settings_saved_while_a_request_is_in_flight_stop_the_send_and_mark_the_web_list_unknown(bool moveAddress)
    {
        using var rig = new Rig();
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(5, 10));
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        rig.Api.RespondCt = async (_, ct) =>
        {
            entered.TrySetResult();
            await Task.Delay(TimeSpan.FromSeconds(30), ct);         // cooperative transport, like SocketsHttpHandler
            return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
        };
        rig.Confirm.Answers.Enqueue(true);
        var send = rig.Cards.SendPartialAsync(rig.Cards.View!);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await SettingsCommitTo(rig, moveAddress ? HostB : HostA, NewId, NewSecret);
        var result = await send.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(CardSendStatus.Stale, result.Status);
        Assert.Contains("settings", result.Message);
        Assert.Contains("cannot be undone", result.Message);
        var only = Assert.Single(rig.Api.Seen);                    // no further attempt
        Assert.Equal(("a.example.test", OldSecret), (only.Host, only.Secret));
        // Same address: the old request may have been applied there, so its list is UNKNOWN. New address: the stopped
        // request went to the old one and says nothing about the new destination's list.
        Assert.Equal(!moveAddress, rig.Cards.RemoteUnknown);
        if (!moveAddress) Assert.Contains("UNKNOWN", CardSyncText.Describe(rig.Cards.View, true, result, rig.Cards.RemoteUnknown));
        Assert.Equal(moveAddress, rig.Cards.View is null);         // token-only keeps the scan for a fresh resend
    }


    [Fact]
    public async Task Saving_unchanged_settings_keeps_the_scan()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(5, 10));
        await SettingsCommitTo(rig, HostA, "", "");
        Assert.NotNull(rig.Cards.View);
        Assert.False(rig.Cards.ConfigurationChanged());
    }

    [Fact]
    public void App_Settings_and_Exit_use_the_card_guards()
    {
        // WPF cannot run on macOS: a static check that the tray actions call the portable, tested guards.
        var app = File.ReadAllText(Path.Combine(Repo.Root, "agent/src/Uma.Agent.Windows/App.cs"));
        Assert.Contains("await SettingsCommit.CommitAsync(_settingsStore, dialog.Result, s => Volatile.Write(ref _settings, s), _uploader, dialog.NewId, dialog.NewSecret, _cards);", app);
        Assert.DoesNotContain("_settingsStore.Save(", app);
        Assert.Contains("using var holdCards = _cards.HoldSendsForExit();", app);
        Assert.True(app.IndexOf("HoldSendsForExit", StringComparison.Ordinal) < app.IndexOf("_cards.ExitQuestion()", StringComparison.Ordinal));
        var window = File.ReadAllText(Path.Combine(Repo.Root, "agent/src/Uma.Agent.Windows/CardSyncWindow.cs"));
        Assert.Contains("_cards.BeginScanReplacing(v)", window);
        Assert.DoesNotContain("_cards.BeginScan()", window);
        Assert.Contains("_cards.SendsHeld", window);
    }

    // ================= S1: Start new scan =================

    [Fact]
    public void Start_new_scan_confirmed_for_5_cards_is_refused_when_8_exist()
    {
        using var rig = new Rig();
        Assert.NotNull(rig.Cards.BeginScanReplacing(null));      // no scan: nothing to drop
        rig.Pipeline.Accept(List(5, 10));
        var shown = rig.Cards.View!;
        rig.Pipeline.Accept(List(8, 10));
        Assert.Null(rig.Cards.BeginScanReplacing(shown));
        Assert.Null(rig.Cards.BeginScanReplacing(null));
        Assert.Equal(8, rig.Cards.View!.State.Cards.Count);
        var now = rig.Cards.View!;
        Assert.Contains("8 collected", rig.Cards.ReplaceQuestion(now)!.Message);   // asked again with the real count
        Assert.Empty(rig.Cards.BeginScanReplacing(now)!.State.Cards);
    }

    // ================= N1: exit hold =================

    [Fact]
    public async Task While_Exit_is_being_confirmed_no_send_starts_and_cancelling_Exit_restores_sending()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(5, 10));
        var hold = rig.Cards.HoldSendsForExit();
        Assert.True(rig.Cards.SendsHeld);
        rig.Confirm.Answers.Enqueue(true);
        var r = await rig.Cards.SendPartialAsync(rig.Cards.View!);
        Assert.Equal(CardSendStatus.Cancelled, r.Status);
        Assert.Contains("Exit", r.Message);
        Assert.Empty(rig.Confirm.Prompts);
        Assert.Empty(rig.Api.Seen);
        hold.Dispose(); hold.Dispose();                           // idempotent
        Assert.False(rig.Cards.SendsHeld);
        Assert.Equal(CardSendStatus.Synced, (await rig.Cards.SendPartialAsync(rig.Cards.View!)).Status);
    }

    // ================= B2: precedence with a primed gate =================

    [Fact]
    public async Task A_skipped_frame_clears_only_the_transient_error_never_a_durable_notice()
    {
        using var rig = new Rig();
        var m = new CaptureStatusModel();
        CaptureNotice[] durable = [new(CaptureNoticeKind.Unsaved, "SYNTHETIC not saved"), new(CaptureNoticeKind.Overflow, "SYNTHETIC limit")];
        m.Apply(new(PipelineEventKind.Failed, "SYNTHETIC not saved", Notices: durable));
        m.ReportCaptureError("SYNTHETIC window minimized");
        m.Apply(new(PipelineEventKind.Skipped, "unchanged frame", Notices: durable));
        Assert.Null(m.Transient);
        Assert.Contains("SYNTHETIC not saved", m.Error);
        Assert.Contains("SYNTHETIC limit", m.Error);
        // And a still-invalid frame after recovery sets it again.
        var p = rig.NewPipeline(5);
        m.Apply(await p.ProcessAsync(new Frame(new byte[1280 * 720 * 4], 1280, 720), CancellationToken.None));
        Assert.Contains("1920x1080", m.Transient);
    }

    [Fact]
    public async Task A_send_confirmed_while_Exit_is_being_confirmed_is_not_sent()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(5, 10));
        IDisposable? hold = null;
        rig.Confirm.Answers.Enqueue(true);
        rig.Confirm.WhileOpen = () => hold = rig.Cards.HoldSendsForExit();   // tray Exit chosen while the send modal is open
        var r = await rig.Cards.SendPartialAsync(rig.Cards.View!);
        Assert.Equal(CardSendStatus.Cancelled, r.Status);
        Assert.Empty(rig.Api.Seen);
        hold!.Dispose();
    }

    [Fact]
    public async Task Acknowledged_and_unknown_history_of_the_old_destination_is_not_shown_for_a_new_destination_scan()
    {
        using var rig = new Rig();
        rig.Cards.BeginScan(); rig.Pipeline.Accept(List(8, 10));
        rig.Confirm.Answers.Enqueue(true);
        Assert.Equal(CardSendStatus.Synced, (await rig.Cards.SendPartialAsync(rig.Cards.View!)).Status);
        rig.Pipeline.Accept(List(9, 10));
        rig.Api.Respond = _ => Task.FromResult(StubApi.Json(HttpStatusCode.OK, "{}"));
        rig.Confirm.Answers.Enqueue(true);
        Assert.Equal(CardSendStatus.Failed, (await rig.Cards.SendPartialAsync(rig.Cards.View!)).Status);
        Assert.True(rig.Cards.RemoteUnknown);
        await SettingsCommitTo(rig, HostB, NewId, NewSecret);
        Assert.Null(rig.Cards.View);
        Assert.False(rig.Cards.RemoteUnknown);                    // not shown for B even before a new scan
        Assert.DoesNotContain("UNKNOWN", CardSyncText.Describe(null, true, null, rig.Cards.RemoteUnknown));
        rig.Cards.BeginScan();
        Assert.False(rig.Cards.RemoteUnknown);
        Assert.Null(rig.Cards.View!.LastSync);
    }
}
