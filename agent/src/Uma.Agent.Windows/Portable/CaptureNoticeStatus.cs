using System;
using System.Collections.Generic;
using System.Linq;
namespace Uma.Agent.Windows.Shell;

public enum CaptureNoticeKind { Unsaved, Overflow, Released }
public sealed record CaptureNotice(CaptureNoticeKind Kind, string Message);

/// <summary>Persistent capture notices are separate from routine progress. A pipeline event's non-null Notices is
/// an authoritative snapshot; queue recovery removes only Unsaved. Overflow clears only on an explicit fresh scan.
/// Released can be acknowledged. Neither action may dismiss an unsaved capture into a healthy status.</summary>
public sealed class CaptureNoticeStatus
{
    private readonly Dictionary<CaptureNoticeKind, CaptureNotice> _notices = [];
    private bool _releasedAcknowledged;
    public string Routine { get; private set; } = "";
    public string Message => string.Join("\n", _notices.Values.Where(n => n.Kind != CaptureNoticeKind.Released || !_releasedAcknowledged).Select(n => n.Message).Append(Routine));
    public string? Error
    {
        get
        {
            var errors = _notices.Values.Where(n => n.Kind is CaptureNoticeKind.Unsaved or CaptureNoticeKind.Overflow).Select(n => n.Message).ToArray();
            return errors.Length == 0 ? null : string.Join("\n", errors);
        }
    }
    public void Apply(PipelineEvent e)
    {
        Routine = e.Message;
        if (e.Notices is null) return;
        // Do not duplicate persistent warning copy in routine text: acknowledgement must actually remove it. Only whole
        // routine lines that ARE a notice are dropped (T10 r3 S2): a routine line merely containing notice text stays.
        var noticeLines = e.Notices.Select(n => n.Message).ToHashSet(StringComparer.Ordinal);
        Routine = noticeLines.Contains(Routine) ? "" : string.Join("\n", Routine.Split('\n').Where(line => !noticeLines.Contains(line))).Trim();
        // A new release warning revokes acknowledgement; unchanged snapshots do not.
        var released = e.Notices.FirstOrDefault(n => n.Kind == CaptureNoticeKind.Released);
        if (released is not null && (!_notices.TryGetValue(CaptureNoticeKind.Released, out var old) || old != released)) _releasedAcknowledged = false;
        _notices.Clear();
        foreach (var n in e.Notices) _notices[n.Kind] = n;
    }
    public void AcknowledgeReleased() => _releasedAcknowledged = true;
    public bool StartFresh()
    {
        if (_notices.ContainsKey(CaptureNoticeKind.Unsaved)) return false;
        _notices.Clear(); _releasedAcknowledged = false; Routine = ""; return true;
    }
}

/// <summary>Transient capture-source error (unsupported client size/aspect, window/capture unavailable). T10 r3 S1:
/// it clears itself once a valid frame is accepted again (<see cref="PipelineEventKind.Progress"/>, Queued,
/// AlreadyQueued, or a recognized support-card screen), so the tray returns to Capturing after the user fixes the
/// window. It is separate from <see cref="CaptureNoticeStatus"/>: durable unsaved/overflow notices are never cleared
/// here, and they take precedence in <see cref="Error"/>.</summary>
public sealed class CaptureStatusModel
{
    public CaptureNoticeStatus Notices { get; } = new();
    public string? Transient { get; private set; }
    public string? Error => Notices.Error ?? Transient;
    public void Apply(PipelineEvent e)
    {
        Notices.Apply(e);
        if (e.Kind == PipelineEventKind.Unsupported) Transient = e.Message;
        else if (e.Kind is PipelineEventKind.Progress or PipelineEventKind.Queued or PipelineEventKind.AlreadyQueued or PipelineEventKind.CardScreen) Transient = null;
    }
    /// <summary>From the watch loop: no frame could be read (window missing/minimized, geometry, device).</summary>
    public void ReportCaptureError(string message) => Transient = message;
    public void ClearTransient() => Transient = null;
}
