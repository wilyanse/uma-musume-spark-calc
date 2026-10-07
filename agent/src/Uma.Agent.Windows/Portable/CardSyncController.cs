using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Uma.Agent.Core;
using Uma.Agent.Core.Cards;

namespace Uma.Agent.Windows.Shell;

/// <summary>One registered support-card scan: the reviewed T11 <see cref="CardSyncSession"/>, the coordinator
/// generation it was registered under and the API destination it belongs to. A reset or replacement produces a new
/// handle. <see cref="Destination"/> is the normalized API address when the scan started (T10b r1 S3); it is only
/// adopted later, once, when no valid address was configured at start. It is written under the controller lock.</summary>
public sealed class CardScanHandle
{
    internal CardSyncSession Session { get; }
    internal OwnedCardsUploadCoordinator.Generation Generation { get; }
    /// <summary>Shell-local scan number, for display only.</summary>
    public long Number { get; }
    /// <summary>Normalized API address this scan may be sent to, or null until one is configured.</summary>
    public string? Destination { get; internal set; }
    internal CardScanHandle(CardSyncSession session, OwnedCardsUploadCoordinator.Generation generation, long number, string? destination)
    { Session = session; Generation = generation; Number = number; Destination = destination; }
}

/// <summary>The last API-acknowledged sync of this shell run (in memory only).</summary>
public sealed record CardLastSync(long Scan, long Revision, int Count, bool Partial, DateTimeOffset SyncedAt);

/// <summary>What the card window shows. The UI passes back the exact view the user acted on; anything newer or older
/// than the current scan and revision is refused before transport.
/// <para><see cref="RemoteUnknown"/> (T10b r1 S2): a request that may have reached the API ended without a valid
/// acknowledgement for the current scan (failure, bad ACK, a stopped or stale send). The web app's list is then
/// unknown; <see cref="LastSync"/> is kept only as history. <see cref="Confirming"/>: a send is waiting for the user's
/// confirmation and nothing has been sent for it yet.</para></summary>
public sealed record CardScanView(CardScanHandle Handle, CardSyncState State, CardLastSync? LastSync, bool Sending, bool RemoteUnknown = false, bool Confirming = false)
{
    public bool SyncedCurrent => !RemoteUnknown && LastSync is { } s && s.Scan == Handle.Number && s.Revision == State.Revision;
}

public enum CardSendStatus { Synced, NotEligible, Cancelled, Stale, Busy, NotConfigured, AuthRequired, Rejected, Failed, Invalid }
public sealed record CardSendResult(CardSendStatus Status, string Message, OwnedCardsAck? Ack = null, int Attempts = 0);

/// <summary>Shell side of T11 (30 §8, 01 §4). Wires the reviewed Core Cards API into the tray:
/// <list type="bullet">
/// <item>Frames: the veteran <see cref="CapturePipeline"/> parses every frame through the existing capture/OCR path
/// and hands classified cards.list / cards.detail frames to <see cref="Feed"/>, which delegates to the current
/// <see cref="CardSyncSession"/>. No card frame or payload is written to disk, and no veteran outbox kind is used.</item>
/// <item>One <see cref="OwnedCardsUploadCoordinator"/> per API destination for the shell lifetime. Every scan is
/// registered with <see cref="OwnedCardsUploadCoordinator.BeginGeneration"/> before any send; reset re-registers,
/// replacement retires the old scan, cancel invalidates it.</item>
/// <item>Sends are explicit. Full needs Core's <see cref="CardSyncState.CanSendFull"/>. Partial needs the exact
/// <see cref="PartialSyncConfirmation"/> the user saw AND an explicit destructive confirmation: the API replaces the
/// whole stored list (Q-150). A view from a replaced/reset/cancelled scan or an older revision is refused before
/// any request; the coordinator re-checks before every attempt.</item>
/// <item>Retry: only Core's bounded attempts inside one send. There is no automatic or background re-send. After a
/// failure the user sends again from the unchanged current scan (partial asks again); a changed scan must be
/// reviewed and confirmed again (Q-152).</item>
/// <item>One send at a time; a second request while one is in flight (or its confirmation is open) is refused.</item>
/// <item>Configuration binding (T10b r1 B1). A scan belongs to the API address it started under. The address and the
/// nonsecret <see cref="ServiceTokenStore.Version"/> are captured before the confirmation is shown, re-read after it
/// closes (refused if either changed), and re-checked by <see cref="BoundToken"/> immediately before every attempt
/// reads the credential, so no attempt runs after a change and a new credential never goes to the old address.
/// <see cref="ConfigurationChanged"/> (called by Settings) cancels a scan whose address changed and stops an in-flight
/// send whose configuration changed. A token-only change keeps the scan: the user may send the same scan again after
/// a fresh confirmation (auth repair).</item>
/// </list>
/// Messages are fixed shell text plus counts and categories; no token, header, response body or exception message
/// is shown or logged.</summary>
public sealed class CardSyncController : ISupportCardsIntegration
{
    private readonly AgentData _data;
    private readonly IClock _clock;
    private readonly Func<AgentSettings> _settings;
    private readonly ServiceTokenStore _tokens;
    private readonly Func<HttpMessageHandler> _handler;
    private readonly IConfirm _confirm;
    private readonly IShellLog _log;
    private readonly OwnedCardsRetryPolicy? _policy;
    private readonly Func<TimeSpan, CancellationToken, Task>? _delay;
    private readonly Func<Guid>? _sessionIds;
    private readonly object _sync = new();
    private readonly CancellationTokenSource _lifetime = new();
    private OwnedCardsUploadCoordinator _coordinator = new();
    private string? _boundAddress;
    private HttpClient? _http;
    private string? _httpAddress;
    private CardScanHandle? _current;
    private CardLastSync? _lastSync;
    private bool _remoteUnknown;
    private long _scans;
    private bool _inFlight, _confirming, _shutdown;
    private int _exitHolds;
    private CancellationTokenSource? _sendCancel;       // the in-flight send's configuration cancellation
    private (string Destination, long TokenVersion)? _sendConfig;
    private Task _inFlightTask = Task.CompletedTask;

    public CardSyncController(AgentData data, IClock clock, Func<AgentSettings> settings, ServiceTokenStore tokens,
        Func<HttpMessageHandler> handler, IConfirm confirm, IShellLog log,
        OwnedCardsRetryPolicy? policy = null, Func<TimeSpan, CancellationToken, Task>? delay = null, Func<Guid>? sessionIds = null)
    {
        _data = data; _clock = clock; _settings = settings; _tokens = tokens; _handler = handler; _confirm = confirm; _log = log;
        _policy = policy; _delay = delay; _sessionIds = sessionIds;
    }

    public const string NoScanMessage = "Support card screen: choose Capture support cards in the tray to start a scan. Nothing stored.";

    /// <summary>The current scan, or null (none started, cancelled or shut down).</summary>
    public CardScanView? View
    {
        get
        {
            lock (_sync) return ViewLocked();
        }
    }

    // _sync must be held.
    private CardScanView? ViewLocked()
        => _current is null ? null : new CardScanView(_current, _current.Session.State, _lastSync, _inFlight, _remoteUnknown, _confirming);

    public bool Sending { get { lock (_sync) return _inFlight; } }

    /// <summary>Exit is being confirmed (N1): new sends are refused until it is cancelled.</summary>
    public bool SendsHeld { get { lock (_sync) return _exitHolds > 0 || _shutdown; } }

    /// <summary>A request may have reached the API without a valid acknowledgement for the current scan (S2).</summary>
    public bool RemoteUnknown { get { lock (_sync) return _remoteUnknown; } }

    private string? CurrentDestination() => ApiAddress.TryParse(_settings().ApiBaseUrl, out var uri, out _) ? uri!.AbsoluteUri : null;

    /// <summary>Shell scan number; changes on BeginScan/Reset so the pipeline re-reads a still frame.</summary>
    public long Epoch { get { lock (_sync) return _scans; } }

    /// <summary>Called by the capture pipeline for classified card screens only. Null when no scan is active.</summary>
    public CardFeedResult? Feed(ParsedFrame parsed)
    {
        CardScanHandle? h;
        lock (_sync) h = _shutdown ? null : _current;
        return h?.Session.Feed(parsed);
    }

    /// <summary>Starts a new scan, retiring any previous one (its views and envelopes become stale). The scan is bound
    /// to the API address configured now (S3).</summary>
    public CardScanView BeginScan()
    {
        lock (_sync)
        {
            if (_shutdown) throw new InvalidOperationException("the agent is exiting");
            return BeginScanLocked();
        }
    }

    /// <summary>Start new scan from the window (S1): replaces the current scan only if it is still exactly the scan and
    /// revision the user confirmed dropping (<paramref name="seen"/>; null = there was no scan). Otherwise null and
    /// nothing is dropped, so the caller asks again with the current counts.</summary>
    public CardScanView? BeginScanReplacing(CardScanView? seen)
    {
        lock (_sync)
        {
            if (_shutdown || !SameAsSeenLocked(seen)) return null;
            return BeginScanLocked();
        }
    }

    // _sync must be held.
    private bool SameAsSeenLocked(CardScanView? seen)
        => _current is null ? seen is null
            : seen is not null && ReferenceEquals(seen.Handle, _current) && seen.State.Revision == _current.Session.State.Revision;

    // _sync must be held.
    private CardScanView BeginScanLocked()
    {
        var old = _current;
        // One coordinator per destination: a scan started after the address changed gets a fresh one.
        var destination = CurrentDestination();
        if (_boundAddress is not null && destination != _boundAddress)
        {
            if (old is not null) { _coordinator.Invalidate(old.Generation); old.Session.Cancel(); old = null; _current = null; }
            _coordinator = new OwnedCardsUploadCoordinator();
            _boundAddress = null;
            // The acknowledged/unknown history describes the previous destination's list, not this one.
            _lastSync = null; _remoteUnknown = false;
        }
        var session = new CardSyncSession(_data.Master, _data.Layout, _clock, _sessionIds);
        // Registration of the replacement retires and cancels the old generation inside the coordinator.
        var generation = _coordinator.BeginGeneration(session);
        old?.Session.Cancel();
        _current = new CardScanHandle(session, generation, ++_scans, destination);
        _log.Info("Support-card scan started");
        return ViewLocked()!;
    }

    /// <summary>Forgets the collection of the shown scan and starts over (Q-154: Invalidate, Reset, BeginGeneration).
    /// Refused (null) unless <paramref name="seen"/> is the current scan at the current revision (S1): cards collected
    /// while the question was open are never dropped silently.</summary>
    public CardScanView? Reset(CardScanView seen)
    {
        lock (_sync)
        {
            if (_shutdown || seen is null || !SameAsSeenLocked(seen)) return null;
            _coordinator.Invalidate(_current!.Generation);
            _current.Session.Reset();
            var generation = _coordinator.BeginGeneration(_current.Session);
            _current = new CardScanHandle(_current.Session, generation, ++_scans, _current.Destination);
            _log.Info("Support-card scan reset");
            return ViewLocked();
        }
    }

    /// <summary>Stops the shown scan (Q-154: Invalidate, then Cancel). An in-flight send stops before its next attempt.
    /// Refused unless <paramref name="seen"/> is the current scan at the current revision (S1).</summary>
    public bool Cancel(CardScanView seen)
    {
        lock (_sync)
        {
            if (seen is null || !SameAsSeenLocked(seen)) return false;
            CancelCurrentLocked();
            _log.Info("Support-card scan cancelled");
            return true;
        }
    }

    /// <summary>Settings were saved (B1). Cancels the current scan when the API address no longer matches the one it
    /// belongs to, and stops an in-flight send whose address or service token changed (it makes no further attempt; a
    /// request already received by the server cannot be undone). A token-only change keeps the scan for auth repair.
    /// Returns true when something was cancelled or stopped.</summary>
    public bool ConfigurationChanged()
    {
        CancellationTokenSource? stop = null;
        var changed = false;
        lock (_sync)
        {
            var destination = CurrentDestination();
            if (_current is { Destination: { } bound } && bound != destination)
            {
                CancelCurrentLocked();
                _log.Warn("Support-card scan cancelled after the API destination changed");
                changed = true;
            }
            if (_boundAddress is not null && _boundAddress != destination)
            {
                // The acknowledged/unknown history describes the old destination's list, not the new one.
                _coordinator = new OwnedCardsUploadCoordinator();
                _boundAddress = null; _lastSync = null; _remoteUnknown = false;
                changed = true;
            }
            if (_sendConfig is { } c && (c.Destination != destination || c.TokenVersion != _tokens.Version))
            {
                stop = _sendCancel;
                changed = true;
            }
        }
        // Outside the lock: cancellation callbacks must not run under _sync.
        stop?.Cancel();
        return changed;
    }

    /// <summary>N1: while Exit asks its questions no new send may start; disposing (Exit cancelled) restores sending.</summary>
    public IDisposable HoldSendsForExit()
    {
        lock (_sync) _exitHolds++;
        return new ExitHold(this);
    }

    private sealed class ExitHold(CardSyncController owner) : IDisposable
    {
        private int _released;
        public void Dispose()
        {
            if (Interlocked.Exchange(ref _released, 1) == 0) lock (owner._sync) owner._exitHolds--;
        }
    }

    private void CancelCurrentLocked()
    {
        if (_current is null) return;
        _coordinator.Invalidate(_current.Generation);
        _current.Session.Cancel();
        _current = null;
    }

    /// <summary>The user picked a pending tile, then opens that card in game (cards.detail).</summary>
    public bool SelectPending(CardScanView seen, string pendingId)
    {
        lock (_sync)
        {
            if (Stale(seen) is not null) return false;
            return seen.Handle.Session.RequestDetail(pendingId);
        }
    }

    public Task<CardSendResult> SendFullAsync(CardScanView seen, CancellationToken ct = default) => SendAsync(seen, partial: false, ct);
    public Task<CardSendResult> SendPartialAsync(CardScanView seen, CancellationToken ct = default) => SendAsync(seen, partial: true, ct);

    public static string PartialWarningTitle => "DESTRUCTIVE: replace the ENTIRE owned-card list?";
    public static string PartialWarning(PartialSyncConfirmation c, string destination)
        => "WARNING — THIS DELETES CARDS FROM THE WEB APP.\n\n" + c.Message
           + $"\n\nOnly {c.Cards} of Held {c.HeldCount} were collected. A partial sync does NOT merge: the stored list is deleted and replaced by exactly these {c.Cards} cards."
           + $"\nDestination: {destination}\n\nChoose Yes only if you accept losing every card not in this scan. No is the safe default.";

    private async Task<CardSendResult> SendAsync(CardScanView seen, bool partial, CancellationToken ct)
    {
        TaskCompletionSource done;
        lock (_sync)
        {
            if (_shutdown) return new(CardSendStatus.Cancelled, "The agent is exiting; nothing was sent.");
            if (_exitHolds > 0) return new(CardSendStatus.Cancelled, "Exit is being confirmed; nothing was sent. Cancel Exit to send.");
            if (_inFlight) return new(CardSendStatus.Busy, "A support-card sync is already in progress; wait for its result.");
            _inFlight = true;
            done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            _inFlightTask = done.Task;
        }
        try { return await SendCoreAsync(seen, partial, ct); }
        finally
        {
            CancellationTokenSource? cancel;
            lock (_sync) { _inFlight = false; _confirming = false; cancel = _sendCancel; _sendCancel = null; _sendConfig = null; }
            cancel?.Dispose();
            done.TrySetResult();
        }
    }

    private const string SettingsChangedUnsent = "The API settings (address or service token) changed while this sync was being confirmed. Nothing was sent; review the scan and send again.";
    private const string SettingsChangedStopped = "Stopped: the API settings (address or service token) changed during this sync. No further attempt was made with the old settings; a request already received by the server cannot be undone, so check the web app's card list.";
    private const string DestinationChanged = "The API destination changed since this scan was started. The scan was cancelled; start a new support-card scan for the new destination. Nothing was sent.";

    private async Task<CardSendResult> SendCoreAsync(CardScanView seen, bool partial, CancellationToken ct)
    {
        lock (_sync) if (Stale(seen) is { } stale) return stale;
        var state = seen.State;
        if (!partial && !state.CanSendFull)
            return new(CardSendStatus.NotEligible, "Full sync is not possible: " + string.Join("; ", state.Blockers) + ". Continue scanning, or send an explicit partial sync.");
        if (partial && state.CanSendFull)
            return new(CardSendStatus.NotEligible, "Every held card is collected: use Send full sync instead of a partial.");
        if (partial && state.PartialConfirmation is null)
            return new(CardSendStatus.NotEligible, "Nothing can be sent yet: " + string.Join("; ", state.Blockers) + ".");
        // Configuration the user is about to confirm: nonsecret address and token version only (B1).
        var tokenVersion = _tokens.Version;
        if (!ApiAddress.TryParse(_settings().ApiBaseUrl, out var address, out var addressError))
            return new(CardSendStatus.NotConfigured, addressError + " Nothing was sent.");
        if (!_tokens.HasToken)
            return new(CardSendStatus.NotConfigured, "No usable service token is saved: add it in Settings. Nothing was sent.");
        var destination = address!.AbsoluteUri;

        lock (_sync)
        {
            if (Stale(seen) is { } stale) return stale;
            // S3: a scan belongs to the address it started under; never carry it to another destination.
            if ((seen.Handle.Destination ?? _boundAddress ?? destination) != destination) return DestinationChangedLocked();
            _confirming = true;
        }
        bool confirmed;
        try
        {
            confirmed = partial
                ? _confirm.Confirm(PartialWarningTitle, PartialWarning(state.PartialConfirmation!, destination))
                : _confirm.Confirm("Replace the owned-card list?", $"Send all {state.Cards.Count} of Held {state.HeldCount} collected cards as a full sync? The web app's owned-card list will be replaced by this scan.\nDestination: {destination}");
        }
        finally { lock (_sync) _confirming = false; }
        if (!confirmed) return new(CardSendStatus.Cancelled, "Not sent: you cancelled the confirmation. The web app's list is unchanged by this action.");

        OwnedCardsSyncPayload payload;
        OwnedCardsUploadCoordinator coordinator;
        HttpClient http;
        CancellationTokenSource sendCancel;
        lock (_sync)
        {
            // The modal confirmation may have taken a while: frames, reset, replacement, Settings or exit may have happened.
            if (Stale(seen) is { } stale) return stale;
            // N1: Exit is being confirmed and told the user nothing was sent for a waiting confirmation; keep that true.
            if (_exitHolds > 0) return new(CardSendStatus.Cancelled, "Exit is being confirmed; nothing was sent. Cancel Exit to send.");
            if (CurrentDestination() != destination)
            {
                // The confirmed destination is no longer configured: this scan belongs to the old one.
                if (seen.Handle.Destination is not null) { CancelCurrentLocked(); _log.Warn("Support-card scan cancelled after the API destination changed"); }
                return new(CardSendStatus.Stale, SettingsChangedUnsent);
            }
            if (_tokens.Version != tokenVersion) return new(CardSendStatus.Stale, SettingsChangedUnsent);
            try { payload = partial ? seen.Handle.Session.BuildPartial(state.PartialConfirmation!) : seen.Handle.Session.BuildFull(); }
            catch (InvalidOperationException) { return StaleRevision(); }
            // Revisions only grow: equal after the build means the payload IS the snapshot the user confirmed.
            if (seen.Handle.Session.State.Revision != state.Revision) return StaleRevision();
            if ((seen.Handle.Destination ?? _boundAddress ?? destination) != destination) return DestinationChangedLocked();
            seen.Handle.Destination ??= destination;
            _boundAddress = destination;
            coordinator = _coordinator;
            if (_http is null || _httpAddress != destination)
            {
                _http?.Dispose();
                _http = new HttpClient(_handler(), disposeHandler: true) { Timeout = TimeSpan.FromSeconds(30) };
                _httpAddress = destination;
            }
            http = _http;
            _sendCancel = sendCancel = new CancellationTokenSource();
            _sendConfig = (destination, tokenVersion);
        }

        var token = new BoundToken(_tokens, () => CurrentDestination(), destination, tokenVersion);
        var uploader = new OwnedCardsUploader(http, address, token, _data.Master.Ids["cards"], _policy, _delay);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, _lifetime.Token, sendCancel.Token);
        OwnedCardsUploadResult result;
        try { result = await coordinator.SendAsync(seen.Handle.Generation, uploader, payload, linked.Token); }
        catch (BoundToken.ChangedException)
        {
            _log.Warn("Support-card sync stopped: API settings changed");
            return Ended(token, new(CardSendStatus.Stale, SettingsChangedStopped));
        }
        catch (OperationCanceledException)
        {
            if (_lifetime.IsCancellationRequested)
            {
                _log.Warn("Support-card sync stopped at exit");
                return Ended(token, new(CardSendStatus.Cancelled, "Stopped at exit. A request already received by the server cannot be undone; check the web app's card list."));
            }
            if (sendCancel.IsCancellationRequested)
            {
                _log.Warn("Support-card sync stopped: API settings changed");
                return Ended(token, new(CardSendStatus.Stale, SettingsChangedStopped));
            }
            _log.Warn("Support-card sync stopped: scan no longer current");
            return Ended(token, new(CardSendStatus.Stale, "Stopped: this scan was changed, reset or cancelled. No further attempt was made; a request already received by the server cannot be undone, so check the web app's card list and send again from the current scan."));
        }
        catch (ServiceTokenMissingException e) { _log.Warn("Support-card sync needs a service token"); return Ended(token, new(CardSendStatus.NotConfigured, e.Message)); }
        catch (Exception e)
        {
            _log.Error("Support-card sync failed: " + e.GetType().Name);
            return Ended(token, new(CardSendStatus.Failed, UserMessages.For(e)));
        }

        _log.Info("Support-card sync " + result.Outcome + (result.ErrorCategory is null ? "" : ": " + result.ErrorCategory));
        switch (result.Outcome)
        {
            case OwnedCardsUploadOutcome.Synced:
                var ack = result.Ack!;
                lock (_sync) { _lastSync = new CardLastSync(seen.Handle.Number, state.Revision, ack.Count, ack.Partial, ack.SyncedAt); _remoteUnknown = false; }
                return new(CardSendStatus.Synced, $"Synced: the API acknowledged {ack.Count} card(s) as a {(ack.Partial ? "PARTIAL" : "full")} sync at {ack.SyncedAt.UtcDateTime:yyyy-MM-dd HH:mm:ss} UTC.", ack, result.Attempts);
            case OwnedCardsUploadOutcome.AuthRequired:
                // A first-attempt Access refusal never reached the API; earlier transient attempts may have.
                if (result.Attempts > 1) MarkRemoteUnknown(destination);
                return new(CardSendStatus.AuthRequired, "Cloudflare Access refused the service token. Update it in Settings, then send again from this scan. The sync was not acknowledged.", null, result.Attempts);
            case OwnedCardsUploadOutcome.Rejected:
                if (result.Attempts > 1) MarkRemoteUnknown(destination);
                return new(CardSendStatus.Rejected, $"The API refused this sync ({result.ErrorCategory}); it was not retried." + Lines(result.Errors), null, result.Attempts);
            case OwnedCardsUploadOutcome.Invalid:
                return new(CardSendStatus.Invalid, "Refused locally: the payload failed validation, so nothing was sent." + Lines(result.Errors), null, result.Attempts);
            default:
                MarkRemoteUnknown(destination);
                return new(CardSendStatus.Failed, $"No valid acknowledgement after {result.Attempts} attempt(s) ({result.ErrorCategory}). The web list may or may not have been replaced: its state is now UNKNOWN. Nothing is retried in the background: send again from this unchanged scan, or rescan.", null, result.Attempts);
        }
    }

    /// <summary>A send that ended without an acknowledgement for the current scan: if any attempt read the credential
    /// (a request may have left), the web list is unknown (S2).</summary>
    private CardSendResult Ended(BoundToken token, CardSendResult result)
    {
        if (token.Reads > 0) MarkRemoteUnknown(token.ConfirmedDestination);
        return result;
    }

    /// <summary>Only for the destination still configured: a stopped send to an address the user moved away from says
    /// nothing about the new destination's list.</summary>
    private void MarkRemoteUnknown(string destination) { lock (_sync) if (CurrentDestination() == destination) _remoteUnknown = true; }

    // _sync must be held.
    private CardSendResult DestinationChangedLocked()
    {
        // One coordinator per destination. Never carry a confirmed scan to another destination: rescan.
        CancelCurrentLocked();
        _coordinator = new OwnedCardsUploadCoordinator();
        _boundAddress = null;
        _log.Warn("Support-card scan cancelled after the API destination changed");
        return new(CardSendStatus.Stale, DestinationChanged);
    }

    /// <summary>The credential source given to the reviewed Core uploader for ONE confirmed send (B1). The uploader
    /// calls <see cref="Read"/> immediately before building each attempt's request; it refuses (throws, so the attempt
    /// is never made) unless the configured address is still the confirmed destination and the token store's
    /// nonsecret version is still the confirmed one, both before and after the read. The token itself is not copied
    /// or kept: it is returned straight to the request headers, as before.</summary>
    internal sealed class BoundToken(ServiceTokenStore tokens, Func<string?> destination, string confirmedDestination, long confirmedVersion) : IServiceToken
    {
        public sealed class ChangedException() : Exception("API settings changed");
        private int _reads;
        public int Reads => Volatile.Read(ref _reads);
        public string ConfirmedDestination => confirmedDestination;
        public (string ClientId, string ClientSecret) Read()
        {
            Check();
            var t = tokens.Read();
            Check();
            Interlocked.Increment(ref _reads);
            return t;
        }
        private void Check()
        {
            if (tokens.Version != confirmedVersion || destination() != confirmedDestination) throw new ChangedException();
        }
    }

    // _sync must be held.
    private CardSendResult? Stale(CardScanView? seen)
    {
        if (_shutdown) return new(CardSendStatus.Cancelled, "The agent is exiting; nothing was sent.");
        if (seen is null || !ReferenceEquals(seen.Handle, _current))
            return new(CardSendStatus.Stale, "This support-card scan was replaced, reset or cancelled. Review the current scan; nothing was sent.");
        if (seen.Handle.Session.State.Revision != seen.State.Revision) return StaleRevision();
        return null;
    }

    private static CardSendResult StaleRevision()
        => new(CardSendStatus.Stale, "The collection changed since it was shown. Review the updated list and confirm again; nothing was sent.");

    private static string Lines(IReadOnlyList<string> errors)
        => errors.Count == 0 ? "" : "\n" + string.Join("\n", errors.Take(5).Select(e => new string(e.Select(c => char.IsControl(c) ? ' ' : c).ToArray())));

    /// <summary>Confirmation before Start new scan drops the current one, or null when nothing unsynced is lost.</summary>
    public DropGuard.Question? ReplaceQuestion() => ReplaceQuestion(View);

    /// <summary>The question for the exact view the user acts on (S1). The answer only authorizes that scan and
    /// revision: <see cref="Reset"/>, <see cref="Cancel"/> and <see cref="BeginScanReplacing"/> refuse a newer one.</summary>
    public DropGuard.Question? ReplaceQuestion(CardScanView? view)
    {
        if (view is { State.Cards.Count: > 0 } && !view.SyncedCurrent)
            return new("Drop the current support-card scan?", $"{view.State.Cards.Count} collected support card(s) are not synced. A new scan starts empty; nothing card-related is stored on disk.", Refuse: false);
        return null;
    }

    /// <summary>Exit confirmation for card state, or null when exiting loses nothing card-related.</summary>
    public DropGuard.Question? ExitQuestion()
    {
        CardScanView? view;
        bool sending, confirming;
        lock (_sync) { view = ViewLocked(); sending = _inFlight; confirming = _confirming; }
        if (sending && confirming)
            return new("Exit while a support-card sync is waiting for confirmation?", "A support-card sync is waiting for your confirmation; nothing has been sent for it. Exiting cancels it." + (view is { State.Cards.Count: > 0 } && !view.SyncedCurrent ? $" {view.State.Cards.Count} collected support card(s) are only in memory and will be dropped." : ""), Refuse: false);
        if (sending)
            return new("Exit during a support-card sync?", "A support-card sync is being sent. Exiting stops further attempts, but cannot undo a request the server already received; check the web app's card list afterwards.", Refuse: false);
        if (view is { State.Cards.Count: > 0 } && !view.SyncedCurrent)
            return new("Exit and drop the support-card scan?", $"{view.State.Cards.Count} collected support card(s) are only in memory and are not synced. Exiting drops this scan; nothing card-related is stored on disk.", Refuse: false);
        return null;
    }

    /// <summary>Exit: invalidates the current scan, stops an in-flight send before its next attempt, waits for it to
    /// return, then releases the HTTP client. Later calls refuse.</summary>
    public async Task ShutdownAsync()
    {
        Task inFlight;
        lock (_sync)
        {
            _shutdown = true;
            CancelCurrentLocked();
            inFlight = _inFlightTask;
        }
        _lifetime.Cancel();
        await inFlight;
        lock (_sync) { _http?.Dispose(); _http = null; }
    }
}

/// <summary>Plain text for the card window, from one view (what the user acts on).</summary>
public static class CardSyncText
{
    public const string RemoteUnknownLine = "Web app card list: UNKNOWN. A request after the last acknowledged sync may or may not have been applied; check the web app's card list.";

    public static string Describe(CardScanView? view, bool watching, CardSendResult? last, bool remoteUnknown = false)
    {
        var lines = new List<string>();
        if (view is null)
        {
            lines.Add("No support-card scan. Choose Start new scan, then open the in-game Support Card List.");
            if (remoteUnknown) lines.Add(RemoteUnknownLine);
            if (last is not null) lines.Add("Last result: " + last.Message);
            return string.Join("\n", lines);
        }
        var s = view.State;
        lines.Add($"Scan #{view.Handle.Number}: {s.Status} (revision {s.Revision})" + (watching ? "" : " — NOT WATCHING: choose Start watching so frames are read."));
        lines.Add(s.HeldCount is int held ? $"Collected {s.Cards.Count} of Held {held}." : $"Collected {s.Cards.Count}; Held N/255 not read yet.");
        if (s.Pending.Count > 0)
        {
            lines.Add($"{s.Pending.Count} tile(s) need the card detail screen (select one, then open that card in game):");
            foreach (var p in s.Pending.Take(20))
                lines.Add($"  {p.Id}: part {p.Segment} position {p.Position}, LB {p.Lb}, Lvl {(p.Level?.ToString() ?? "?")}, candidates {string.Join(", ", p.Candidates.Select(c => c.Value))}");
        }
        if (s.AwaitingDetailFor is not null) lines.Add("Waiting for the detail screen of " + s.AwaitingDetailFor + ".");
        if (s.Conflicts.Count > 0) lines.Add($"{s.Conflicts.Count} position(s) were read differently; reset and scan again.");
        lines.Add(s.CanSendFull ? "Full sync available: every held card is collected." : "Full sync NOT available: " + string.Join("; ", s.Blockers) + ".");
        if (!s.CanSendFull && s.PartialConfirmation is { } c)
            lines.Add($"Partial sync possible ({c.Cards} of {c.HeldCount}) — DESTRUCTIVE: it REPLACES the entire stored list; cards not in this scan disappear from the web app.");
        if (view.RemoteUnknown)
        {
            lines.Add(RemoteUnknownLine);
            if (view.LastSync is { } h)
                lines.Add($"Last acknowledged sync (historical only, may no longer be the web list): {h.Count} card(s), {(h.Partial ? "partial" : "full")}, {h.SyncedAt.UtcDateTime:yyyy-MM-dd HH:mm:ss} UTC.");
        }
        else if (view.LastSync is { } l)
            lines.Add($"Last acknowledged sync: {l.Count} card(s), {(l.Partial ? "partial" : "full")}, {l.SyncedAt.UtcDateTime:yyyy-MM-dd HH:mm:ss} UTC" + (view.SyncedCurrent ? " (this collection)." : " (an earlier collection; the current one is not synced)."));
        if (view.Confirming) lines.Add("Waiting for your confirmation… nothing has been sent yet.");
        else if (view.Sending) lines.Add("Sending… wait for the acknowledgement.");
        if (last is not null) lines.Add("Last result: " + last.Message);
        return string.Join("\n", lines);
    }
}
