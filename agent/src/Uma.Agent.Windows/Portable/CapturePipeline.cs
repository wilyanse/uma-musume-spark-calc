using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Uma.Agent.Core;

namespace Uma.Agent.Windows.Shell;

public interface IShellLog { void Info(string message); void Warn(string message); void Error(string message); }
public interface ISupportCardsIntegration { bool Available { get; } string Message { get; } }
public sealed class SupportCardsUnavailable : ISupportCardsIntegration
{
    public bool Available => false;
    public string Message => "Support card capture is unavailable until T11 is merged and integrated. Nothing is synced or uploaded.";
}
public enum PipelineEventKind { Progress, NotUploadable, Ignored, CardScreen, Unsupported, Skipped, Queued, AlreadyQueued, Failed }
public sealed record PipelineEvent(PipelineEventKind Kind, string Message, string? CaptureId = null);
public sealed record SessionProgress(string IdentityKey, int TabsComplete, IReadOnlyList<SectionStatus> Checklist);

/// <summary>Single-owner pipeline. The host serializes processing/flush. Never edits parser evidence or checklist
/// coverage. Sessions finalize on identity change or explicit Stop/Exit, allowing parent popups before enqueue.</summary>
public sealed class CapturePipeline
{
    private readonly CaptureCoordinator _coordinator;
    private readonly FrameParser _parser;
    private readonly UploadOutbox _outbox;
    private readonly IClock _clock;
    private readonly UlidGenerator _ids;
    private readonly string _version;
    private readonly FrameGate _gate;
    private readonly IShellLog _log;
    private readonly HashSet<CaptureSession> _queued = [];
    private readonly Dictionary<CaptureSession, (string Id, DateTimeOffset At)> _identity = [];
    private readonly Dictionary<CaptureSession, CaptureResult> _pending = [];
    private CaptureSession? _current;
    public SessionProgress? Progress { get; private set; }

    public CapturePipeline(AgentData data, IOcrEngine ocr, UploadOutbox outbox, IClock clock, UlidGenerator ids, string version, FrameGate gate, IShellLog log)
    {
        _coordinator = new(data.Layout, data.Master); _parser = new(data.Layout, data.Master, data.Templates, ocr);
        _outbox = outbox; _clock = clock; _ids = ids; _version = version; _gate = gate; _log = log;
    }
    public async Task<PipelineEvent> ProcessAsync(Frame frame, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        // Validate even unchanged frames: a resize must never inherit the previous valid status.
        try
        {
            if (frame.Width < 1920 || frame.Height < 1080 || (long)frame.Width * 9 != (long)frame.Height * 16)
                Frames.Normalize(frame); // invalid inputs throw before dHash/OCR; valid larger inputs normalize once in ParseAsync
        }
        catch (UnsupportedFrameException e) { return new(PipelineEventKind.Unsupported, e.Message); }
        if (!_gate.ShouldProcess(frame)) return new(PipelineEventKind.Skipped, "unchanged frame");
        var p = await _parser.ParseAsync(frame);
        ct.ThrowIfCancellationRequested();
        return Accept(p);
    }
    internal PipelineEvent Accept(ParsedFrame p)
    {
        var previous = _current;
        var session = _coordinator.Feed(p);
        PipelineEvent? finalized = null;
        if (session is not null && previous is not null && !ReferenceEquals(previous, session)) finalized = Finalize(previous);
        if (session is not null)
        {
            _current = session;
            if (!_identity.ContainsKey(session)) _identity.Add(session, (_ids.Next(), _clock.UtcNow));
            var list = session.Checklist().ToArray();
            var tabs = (list.First(s => s.Section == "details.skills").Complete ? 1 : 0)
                + (list.First(s => s.Section == "details.inspiration").Complete ? 1 : 0)
                + (list.Where(s => s.Section.StartsWith("details.career", StringComparison.Ordinal)).All(s => s.Complete) ? 1 : 0);
            Progress = new(session.IdentityKey, tabs, list);
            if (finalized?.Kind is PipelineEventKind.Queued or PipelineEventKind.Failed) return finalized;
            return _queued.Contains(session) ? new(PipelineEventKind.AlreadyQueued, "This collection was already queued; Stop and Start to recapture.") : new(PipelineEventKind.Progress, "Scroll slowly from top to bottom on Skills and Inspiration, then Career Info; open parent popups before Stop.");
        }
        if (p.Screen.Id is ScreenId.CardsList or ScreenId.CardsDetail) return new(PipelineEventKind.CardScreen, new SupportCardsUnavailable().Message);
        return new(PipelineEventKind.Ignored, "Unknown screen ignored; no data stored.");
    }
    private PipelineEvent Finalize(CaptureSession session)
    {
        if (_queued.Contains(session)) return new(PipelineEventKind.AlreadyQueued, "already queued");
        var identity = _identity[session];
        // Preserve a sealed result after a database failure: retries use exactly the same content/ID.
        if (!_pending.TryGetValue(session, out var result)) result = session.Assemble(identity.Id, identity.At, _version);
        if (!result.Uploadable) return new(PipelineEventKind.NotUploadable, string.Join("; ", result.Blockers));
        _pending[session] = result;
        try
        {
            _outbox.EnqueueCapture(result);
            _queued.Add(session); _pending.Remove(session);
            _log.Info("Complete capture queued");
            return new(PipelineEventKind.Queued, "Complete capture queued for acknowledged upload.", identity.Id);
        }
        catch (Exception e)
        {
            _log.Error("Capture enqueue failed: " + e.GetType().Name);
            return new(PipelineEventKind.Failed, "Complete capture not saved. Keep the agent open, fix local outbox access, then retry Stop.", identity.Id);
        }
    }
    public IReadOnlyList<PipelineEvent> Flush() => _coordinator.Sessions.Where(s => !_queued.Contains(s)).Select(Finalize).ToArray();
}
