namespace Uma.Agent.Core.Cards;

/// <summary>Caller-owned ordering for ONE whole-table owned-cards target (API origin/account).
/// T10 must keep this instance across session and uploader replacements; never create one
/// per scan/send. Use BeginGeneration on session replacement/reset, Invalidate on cancel,
/// and pass that session's generation to every send/recovery attempt. An old generation
/// can never become current again, including after authentication repair.
///
/// Requests are serialized through completion, including bounded retries. Replacement
/// cancels the old generation before newer sends can enter. Cancellation cannot undo a
/// PUT already received by the server; even an HTTP timeout may leave server work running.
/// The API has no generation/CAS contract, so absolute remote ordering after an ambiguous
/// in-flight failure cannot be guaranteed. This prevents local stale retries and overlap,
/// not remote rollback. No durable queue or automatic authentication restart is provided.
/// </summary>
public sealed class OwnedCardsUploadCoordinator
{
    private readonly object _sync = new();
    private readonly SemaphoreSlim _serial = new(1, 1);
    private Generation? _current;

    public sealed class Generation
    {
        internal readonly OwnedCardsUploadCoordinator Owner;
        internal readonly CancellationTokenSource Cancellation = new();
        internal Generation(OwnedCardsUploadCoordinator owner) { Owner = owner; }
    }

    public Generation BeginGeneration()
    {
        lock (_sync)
        {
            _current?.Cancellation.Cancel();
            return _current = new Generation(this);
        }
    }

    /// <summary>Invalidates only the specified session; an old UI callback cannot cancel its replacement.</summary>
    public void Invalidate(Generation generation)
    {
        CheckOwner(generation);
        lock (_sync)
        {
            generation.Cancellation.Cancel();
            if (ReferenceEquals(_current, generation)) _current = null;
        }
    }

    /// <summary>Uploader may be replaced after token repair, but it MUST address this coordinator's
    /// same target. Superseded/invalidated generations throw OperationCanceledException and must
    /// not be rebuilt/resubmitted with a fresh generation. Only a new current scan can obtain one.</summary>
    public async Task<OwnedCardsUploadResult> SendAsync(Generation generation, OwnedCardsUploader uploader,
        OwnedCardsSyncPayload payload, CancellationToken ct = default)
    {
        CheckOwner(generation);
        ArgumentNullException.ThrowIfNull(uploader);
        lock (_sync)
        {
            if (!ReferenceEquals(_current, generation)) throw new OperationCanceledException(generation.Cancellation.Token);
            // Bind on first use. A replacement HttpClient/token for the same URI remains valid.
            if (_target is null) _target = uploader.Target;
            else if (_target != uploader.Target) throw new ArgumentException("Uploader must address the coordinator's same target", nameof(uploader));
        }
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, generation.Cancellation.Token);
        await _serial.WaitAsync(linked.Token);
        try
        {
            linked.Token.ThrowIfCancellationRequested();
            var result = await uploader.SendAsync(payload, linked.Token);
            // A handler ignoring cancellation cannot publish an obsolete success to the UI.
            linked.Token.ThrowIfCancellationRequested();
            return result;
        }
        finally { _serial.Release(); }
    }

    private Uri? _target;
    private void CheckOwner(Generation generation)
    {
        ArgumentNullException.ThrowIfNull(generation);
        if (!ReferenceEquals(generation.Owner, this)) throw new ArgumentException("Generation belongs to another coordinator", nameof(generation));
    }
}
