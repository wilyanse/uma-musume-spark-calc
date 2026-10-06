using Uma.Agent.Windows.Shell;
using Xunit;

namespace Uma.Agent.Windows.Portable.Tests;

/// <summary>T10 review S4: Exit asks before dropping in-memory evidence under the same rules as Start.</summary>
public class DropGuardTests
{
    private static PipelineEvent E(PipelineEventKind k, string m = "m") => new(k, m);

    [Fact]
    public void Nothing_to_lose_needs_no_question()
    {
        foreach (var events in new[] { Array.Empty<PipelineEvent>(), [E(PipelineEventKind.Queued)], [E(PipelineEventKind.AlreadyQueued)] })
        {
            Assert.Null(DropGuard.Check(events, DropGuard.Action.Start));
            Assert.Null(DropGuard.Check(events, DropGuard.Action.Exit));
        }
    }

    [Theory]
    [InlineData(DropGuard.Action.Start)]
    [InlineData(DropGuard.Action.Exit)]
    public void An_incomplete_collection_asks_before_it_is_dropped_on_start_and_on_exit(DropGuard.Action action)
    {
        var q = DropGuard.Check([E(PipelineEventKind.Queued), E(PipelineEventKind.NotUploadable, "details.skills: end not reached")], action)!;
        Assert.False(q.Refuse);
        Assert.Contains("incomplete", q.Message);
        Assert.Contains("NOT uploaded", q.Message);
        Assert.Contains("details.skills: end not reached", q.Message);
        Assert.Contains("outbox", q.Message);
        Assert.Contains(action == DropGuard.Action.Exit ? "Exit" : "Start", q.Title);
    }

    [Fact]
    public void A_complete_but_unsaved_capture_refuses_start_and_asks_before_exit()
    {
        var events = new[] { E(PipelineEventKind.Failed, "Complete capture not saved."), E(PipelineEventKind.NotUploadable) };
        var start = DropGuard.Check(events, DropGuard.Action.Start)!;
        Assert.True(start.Refuse);
        Assert.Contains("not saved", start.Message);
        var exit = DropGuard.Check(events, DropGuard.Action.Exit)!;
        Assert.False(exit.Refuse);
        Assert.Contains("not saved", exit.Message);
        Assert.Contains("lose", exit.Message);
    }
}
