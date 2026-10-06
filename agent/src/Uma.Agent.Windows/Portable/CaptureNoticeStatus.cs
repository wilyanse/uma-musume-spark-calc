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
        // Do not duplicate persistent warning copy in routine text: acknowledgement must actually remove it.
        foreach (var notice in e.Notices) Routine = Routine.Replace(notice.Message, "", StringComparison.Ordinal).Trim();
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
