namespace Uma.Agent.Core.Cards;

/// <summary>Caller-owned ordering for ONE whole-table owned-cards target (API origin/account).
/// Keep one instance across uploader/session replacements. Register the actual current session
/// with BeginGeneration(session) BEFORE any send; there is no implicit first-payload binding.
/// Invalidate on cancel/replacement; reset the session then register its new scan generation.
/// Session identity, instance, generation and current revision are enforced on every attempt.
///
/// Requests are serialized through completion, including bounded retries. Replacement cancels
/// the old generation before newer sends can enter. Cancellation or a revision change cannot
/// undo a PUT already received by the server. The API has no generation/CAS contract, so remote
/// ordering after an ambiguous in-flight failure is not guaranteed. No durable queue.</summary>
public sealed class OwnedCardsUploadCoordinator
{
    private readonly object _sync = new();
    private readonly SemaphoreSlim _serial = new(1, 1);
    private readonly HashSet<CardSessionIdentity> _retired = new();
    private Generation? _current;
    private Uri? _target;

    public sealed class Generation
    {
        internal readonly OwnedCardsUploadCoordinator Owner;
        internal readonly CardSyncSession Session;
        internal readonly CardSessionIdentity Identity;
        internal readonly CancellationTokenSource Cancellation = new();
        internal long Watermark = -1;
        internal Generation(OwnedCardsUploadCoordinator owner, CardSyncSession session, CardSessionIdentity identity)
        { Owner = owner; Session = session; Identity = identity; }
    }

    /// <summary>Explicitly registers one current scan. An invalidated/replaced scan cannot be re-registered:
    /// reset it or use a new session. A still-current scan retries using its existing handle.</summary>
    public Generation BeginGeneration(CardSyncSession session)
    {
        ArgumentNullException.ThrowIfNull(session);
        lock (_sync)
        {
            var identity = session.RegisterUploadIdentity();
            if (_retired.Contains(identity) || _current?.Identity == identity)
                throw new InvalidOperationException("scan already registered or retired; reuse its current handle or reset");
            if (_current is { } previous)
            {
                _retired.Add(previous.Identity);
                previous.Cancellation.Cancel();
            }
            return _current = new Generation(this, session, identity);
        }
    }

    /// <summary>Invalidates only the specified scan; an old UI callback cannot cancel its replacement.</summary>
    public void Invalidate(Generation generation)
    {
        CheckOwner(generation);
        lock (_sync)
        {
            _retired.Add(generation.Identity);
            generation.Cancellation.Cancel();
            if (ReferenceEquals(_current, generation)) _current = null;
        }
    }

    /// <summary>Uploader replacements must address the same target. Stale scan/revision envelopes throw
    /// OperationCanceledException before target binding or network activity. Equal-current revisions may
    /// retry after bounded failure/auth repair; lower revisions can never cross the serialized watermark.</summary>
    public async Task<OwnedCardsUploadResult> SendAsync(Generation generation, OwnedCardsUploader uploader,
        OwnedCardsSyncPayload payload, CancellationToken ct = default)
    {
        CheckOwner(generation);
        ArgumentNullException.ThrowIfNull(uploader);
        ct.ThrowIfCancellationRequested();
        lock (_sync)
        {
            RequireCurrent(generation, payload);
            if (_target is not null && _target != uploader.Target)
                throw new ArgumentException("Uploader must address the coordinator's same target", nameof(uploader));
        }
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, generation.Cancellation.Token);
        await _serial.WaitAsync(linked.Token);
        try
        {
            // Advance inside the serialized gate BEFORE the uploader's first await. Never roll back
            // on failure: equal-current payloads may retry, but older revisions may not.
            lock (_sync)
            {
                linked.Token.ThrowIfCancellationRequested();
                var seal = RequireCurrent(generation, payload);
                if (_target is null) _target = uploader.Target;
                else if (_target != uploader.Target)
                    throw new ArgumentException("Uploader must address the coordinator's same target", nameof(uploader));
                generation.Watermark = Math.Max(generation.Watermark, seal.Revision);
            }
            void Guard()
            {
                linked.Token.ThrowIfCancellationRequested();
                lock (_sync) RequireCurrent(generation, payload);
            }
            var result = await uploader.SendCurrentAsync(payload, Guard, linked.Token);
            // A noncooperative handler cannot publish an obsolete success to the UI.
            Guard();
            return result;
        }
        finally { _serial.Release(); }
    }

    // _sync must be held. Session checks take its own gate; the session never takes _sync.
    private OwnedCardsProvenance RequireCurrent(Generation generation, OwnedCardsSyncPayload payload)
    {
        var seal = payload?.Body?.Provenance;
        if (!ReferenceEquals(_current, generation) || generation.Cancellation.IsCancellationRequested
            || payload is null || !payload.HasValidProvenance || seal is null
            || !generation.Session.IsCurrentUpload(generation.Identity, seal)
            || seal.Revision < generation.Watermark)
            throw new OperationCanceledException("owned-cards scan or snapshot is no longer current", generation.Cancellation.Token);
        return seal;
    }

    private void CheckOwner(Generation generation)
    {
        ArgumentNullException.ThrowIfNull(generation);
        if (!ReferenceEquals(generation.Owner, this)) throw new ArgumentException("Generation belongs to another coordinator", nameof(generation));
    }
}
