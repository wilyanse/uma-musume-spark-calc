using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Uma.Agent.Core;
using Uma.Agent.Core.Cards;

namespace Uma.Agent.Windows.Shell;

/// <summary>One registered support-card scan: the reviewed T11 <see cref="CardSyncSession"/> and the coordinator
/// generation it was registered under. Immutable; a reset or replacement produces a new handle.</summary>
public sealed class CardScanHandle
{
    internal CardSyncSession Session { get; }
    internal OwnedCardsUploadCoordinator.Generation Generation { get; }
    /// <summary>Shell-local scan number, for display only.</summary>
    public long Number { get; }
    internal CardScanHandle(CardSyncSession session, OwnedCardsUploadCoordinator.Generation generation, long number)
    { Session = session; Generation = generation; Number = number; }
}

/// <summary>The last API-acknowledged sync of this shell run (in memory only).</summary>
public sealed record CardLastSync(long Scan, long Revision, int Count, bool Partial, DateTimeOffset SyncedAt);

/// <summary>What the card window shows. The UI passes back the exact view the user acted on; anything newer or older
/// than the current scan and revision is refused before transport.</summary>
public sealed record CardScanView(CardScanHandle Handle, CardSyncState State, CardLastSync? LastSync, bool Sending)
{
    public bool SyncedCurrent => LastSync is { } s && s.Scan == Handle.Number && s.Revision == State.Revision;
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
    private long _scans;
    private bool _inFlight, _shutdown;
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
            lock (_sync)
                return _current is null ? null : new CardScanView(_current, _current.Session.State, _lastSync, _inFlight);
        }
    }

    public bool Sending { get { lock (_sync) return _inFlight; } }

    /// <summary>Shell scan number; changes on BeginScan/Reset so the pipeline re-reads a still frame.</summary>
    public long Epoch { get { lock (_sync) return _scans; } }

    /// <summary>Called by the capture pipeline for classified card screens only. Null when no scan is active.</summary>
    public CardFeedResult? Feed(ParsedFrame parsed)
    {
        CardScanHandle? h;
        lock (_sync) h = _shutdown ? null : _current;
        return h?.Session.Feed(parsed);
    }

    /// <summary>Starts a new scan, retiring any previous one (its views and envelopes become stale).</summary>
    public CardScanView BeginScan()
    {
        lock (_sync)
        {
            if (_shutdown) throw new InvalidOperationException("the agent is exiting");
            var old = _current;
            // One coordinator per destination: a scan started after the address changed gets a fresh one.
            var destination = ApiAddress.TryParse(_settings().ApiBaseUrl, out var uri, out _) ? uri!.AbsoluteUri : null;
            if (_boundAddress is not null && destination != _boundAddress)
            {
                if (old is not null) { _coordinator.Invalidate(old.Generation); old.Session.Cancel(); old = null; _current = null; }
                _coordinator = new OwnedCardsUploadCoordinator();
                _boundAddress = null;
            }
            var session = new CardSyncSession(_data.Master, _data.Layout, _clock, _sessionIds);
            // Registration of the replacement retires and cancels the old generation inside the coordinator.
            var generation = _coordinator.BeginGeneration(session);
            old?.Session.Cancel();
            _current = new CardScanHandle(session, generation, ++_scans);
            _log.Info("Support-card scan started");
            return new CardScanView(_current, session.State, _lastSync, _inFlight);
        }
    }

    /// <summary>Forgets the collection of the shown scan and starts over (Q-154: Invalidate, Reset, BeginGeneration).</summary>
    public CardScanView? Reset(CardScanView seen)
    {
        lock (_sync)
        {
            if (_shutdown || seen is null || !ReferenceEquals(seen.Handle, _current)) return null;
            _coordinator.Invalidate(_current.Generation);
            _current.Session.Reset();
            var generation = _coordinator.BeginGeneration(_current.Session);
            _current = new CardScanHandle(_current.Session, generation, ++_scans);
            _log.Info("Support-card scan reset");
            return new CardScanView(_current, _current.Session.State, _lastSync, _inFlight);
        }
    }

    /// <summary>Stops the shown scan (Q-154: Invalidate, then Cancel). An in-flight send stops before its next attempt.</summary>
    public bool Cancel(CardScanView seen)
    {
        lock (_sync)
        {
            if (seen is null || !ReferenceEquals(seen.Handle, _current)) return false;
            CancelCurrentLocked();
            _log.Info("Support-card scan cancelled");
            return true;
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
            if (_inFlight) return new(CardSendStatus.Busy, "A support-card sync is already in progress; wait for its result.");
            _inFlight = true;
            done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            _inFlightTask = done.Task;
        }
        try { return await SendCoreAsync(seen, partial, ct); }
        finally
        {
            lock (_sync) _inFlight = false;
            done.TrySetResult();
        }
    }

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
        if (!ApiAddress.TryParse(_settings().ApiBaseUrl, out var address, out var addressError))
            return new(CardSendStatus.NotConfigured, addressError + " Nothing was sent.");
        if (!_tokens.HasToken)
            return new(CardSendStatus.NotConfigured, "No usable service token is saved: add it in Settings. Nothing was sent.");

        var destination = address!.AbsoluteUri;
        var confirmed = partial
            ? _confirm.Confirm(PartialWarningTitle, PartialWarning(state.PartialConfirmation!, destination))
            : _confirm.Confirm("Replace the owned-card list?", $"Send all {state.Cards.Count} of Held {state.HeldCount} collected cards as a full sync? The web app's owned-card list will be replaced by this scan.\nDestination: {destination}");
        if (!confirmed) return new(CardSendStatus.Cancelled, "Not sent: you cancelled the confirmation. The web app's list is unchanged by this action.");

        OwnedCardsSyncPayload payload;
        OwnedCardsUploadCoordinator coordinator;
        HttpClient http;
        lock (_sync)
        {
            // The modal confirmation may have taken a while: frames, reset, replacement or exit may have happened.
            if (Stale(seen) is { } stale) return stale;
            try { payload = partial ? seen.Handle.Session.BuildPartial(state.PartialConfirmation!) : seen.Handle.Session.BuildFull(); }
            catch (InvalidOperationException) { return StaleRevision(); }
            // Revisions only grow: equal after the build means the payload IS the snapshot the user confirmed.
            if (seen.Handle.Session.State.Revision != state.Revision) return StaleRevision();
            if (_boundAddress is not null && _boundAddress != destination)
            {
                // One coordinator per destination. Never carry a confirmed scan to another destination: rescan.
                CancelCurrentLocked();
                _coordinator = new OwnedCardsUploadCoordinator();
                _boundAddress = null;
                _log.Warn("Support-card scan cancelled after the API destination changed");
                return new(CardSendStatus.Stale, "The API destination changed since this scan was started. The scan was cancelled; start a new support-card scan for the new destination. Nothing was sent.");
            }
            _boundAddress = destination;
            coordinator = _coordinator;
            if (_http is null || _httpAddress != destination)
            {
                _http?.Dispose();
                _http = new HttpClient(_handler(), disposeHandler: true) { Timeout = TimeSpan.FromSeconds(30) };
                _httpAddress = destination;
            }
            http = _http;
        }

        var uploader = new OwnedCardsUploader(http, address, _tokens, _data.Master.Ids["cards"], _policy, _delay);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, _lifetime.Token);
        OwnedCardsUploadResult result;
        try { result = await coordinator.SendAsync(seen.Handle.Generation, uploader, payload, linked.Token); }
        catch (OperationCanceledException)
        {
            _log.Warn("Support-card sync stopped: scan no longer current");
            if (_lifetime.IsCancellationRequested) return new(CardSendStatus.Cancelled, "Stopped at exit. A request already received by the server cannot be undone; check the web app's card list.");
            return new(CardSendStatus.Stale, "Stopped: this scan was changed, reset or cancelled. No further attempt was made; a request already received by the server cannot be undone, so check the web app's card list and send again from the current scan.");
        }
        catch (ServiceTokenMissingException e) { _log.Warn("Support-card sync needs a service token"); return new(CardSendStatus.NotConfigured, e.Message); }
        catch (Exception e)
        {
            _log.Error("Support-card sync failed: " + e.GetType().Name);
            return new(CardSendStatus.Failed, UserMessages.For(e));
        }

        _log.Info("Support-card sync " + result.Outcome + (result.ErrorCategory is null ? "" : ": " + result.ErrorCategory));
        switch (result.Outcome)
        {
            case OwnedCardsUploadOutcome.Synced:
                var ack = result.Ack!;
                lock (_sync) _lastSync = new CardLastSync(seen.Handle.Number, state.Revision, ack.Count, ack.Partial, ack.SyncedAt);
                return new(CardSendStatus.Synced, $"Synced: the API acknowledged {ack.Count} card(s) as a {(ack.Partial ? "PARTIAL" : "full")} sync at {ack.SyncedAt.UtcDateTime:yyyy-MM-dd HH:mm:ss} UTC.", ack, result.Attempts);
            case OwnedCardsUploadOutcome.AuthRequired:
                return new(CardSendStatus.AuthRequired, "Cloudflare Access refused the service token. Update it in Settings, then send again from this scan. The sync was not acknowledged.", null, result.Attempts);
            case OwnedCardsUploadOutcome.Rejected:
                return new(CardSendStatus.Rejected, $"The API refused this sync ({result.ErrorCategory}); it was not retried." + Lines(result.Errors), null, result.Attempts);
            case OwnedCardsUploadOutcome.Invalid:
                return new(CardSendStatus.Invalid, "Refused locally: the payload failed validation, so nothing was sent." + Lines(result.Errors), null, result.Attempts);
            default:
                return new(CardSendStatus.Failed, $"No valid acknowledgement after {result.Attempts} attempt(s) ({result.ErrorCategory}). The web list may or may not have been replaced. Nothing is retried in the background: send again from this unchanged scan, or rescan.", null, result.Attempts);
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
    public DropGuard.Question? ReplaceQuestion()
    {
        var view = View;
        if (view is { State.Cards.Count: > 0 } && !view.SyncedCurrent)
            return new("Drop the current support-card scan?", $"{view.State.Cards.Count} collected support card(s) are not synced. A new scan starts empty; nothing card-related is stored on disk.", Refuse: false);
        return null;
    }

    /// <summary>Exit confirmation for card state, or null when exiting loses nothing card-related.</summary>
    public DropGuard.Question? ExitQuestion()
    {
        var view = View;
        if (Sending)
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
    public static string Describe(CardScanView? view, bool watching, CardSendResult? last)
    {
        var lines = new List<string>();
        if (view is null)
        {
            lines.Add("No support-card scan. Choose Start new scan, then open the in-game Support Card List.");
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
        if (view.LastSync is { } l)
            lines.Add($"Last acknowledged sync: {l.Count} card(s), {(l.Partial ? "partial" : "full")}, {l.SyncedAt.UtcDateTime:yyyy-MM-dd HH:mm:ss} UTC" + (view.SyncedCurrent ? " (this collection)." : " (an earlier collection; the current one is not synced)."));
        if (view.Sending) lines.Add("Sending… wait for the acknowledgement.");
        if (last is not null) lines.Add("Last result: " + last.Message);
        return string.Join("\n", lines);
    }
}
