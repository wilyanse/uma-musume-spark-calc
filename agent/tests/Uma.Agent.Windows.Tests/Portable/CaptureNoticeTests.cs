using Uma.Agent.Windows.Shell;
using Xunit;
namespace Uma.Agent.Windows.Portable.Tests;
public class CaptureNoticeTests
{
    [Fact]
    public void Routine_events_and_queue_success_preserve_unrelated_notices()
    {
        var status = new CaptureNoticeStatus();
        CaptureNotice[] notices = [new(CaptureNoticeKind.Unsaved, "not saved"), new(CaptureNoticeKind.Overflow, "limit"), new(CaptureNoticeKind.Released, "released")];
        status.Apply(new(PipelineEventKind.Failed, "not saved", Notices: notices));
        status.Apply(new(PipelineEventKind.Skipped, "unchanged"));
        status.Apply(new(PipelineEventKind.Progress, "scroll"));
        Assert.Contains("not saved", status.Error); Assert.Contains("limit", status.Error); Assert.Contains("released", status.Message);
        status.AcknowledgeReleased();
        Assert.DoesNotContain("released", status.Message); Assert.Contains("not saved", status.Error);
        Assert.False(status.StartFresh()); // cannot dismiss unsaved data
        status.Apply(new(PipelineEventKind.Queued, "queued", Notices: notices[1..]));
        Assert.DoesNotContain("not saved", status.Error); Assert.Contains("limit", status.Error);
        Assert.True(status.StartFresh()); Assert.Null(status.Error);
    }
    [Fact]
    public void Immediate_acknowledgement_clears_release_copy_without_clearing_blockers()
    {
        var status = new CaptureNoticeStatus();
        status.Apply(new(PipelineEventKind.NotUploadable, "incomplete\nreleased", Notices: [new(CaptureNoticeKind.Released, "released"), new(CaptureNoticeKind.Unsaved, "not saved")]));
        status.AcknowledgeReleased();
        Assert.DoesNotContain("released", status.Message);
        Assert.Contains("incomplete", status.Message);
        Assert.Contains("not saved", status.Error);
        status.Apply(new(PipelineEventKind.Skipped, "unchanged", Notices: [new(CaptureNoticeKind.Released, "released"), new(CaptureNoticeKind.Unsaved, "not saved")]));
        Assert.DoesNotContain("released", status.Message);
        status.Apply(new(PipelineEventKind.NotUploadable, "released again", Notices: [new(CaptureNoticeKind.Released, "released again")]));
        Assert.Contains("released again", status.Message);
    }

    [Fact]
    public void Simultaneous_queue_and_limit_snapshot_is_not_hidden_by_primary_event()
    {
        var status = new CaptureNoticeStatus();
        status.Apply(new(PipelineEventKind.Queued, "queued", Notices: [new(CaptureNoticeKind.Overflow, "limit"), new(CaptureNoticeKind.Released, "released")]));
        Assert.Equal("limit", status.Error); Assert.Contains("released", status.Message);
        status.Apply(new(PipelineEventKind.Progress, "scroll")); Assert.Equal("limit", status.Error);
    }
}
