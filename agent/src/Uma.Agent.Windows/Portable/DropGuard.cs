using System.Collections.Generic;
using System.Linq;

namespace Uma.Agent.Windows.Shell;

/// <summary>One rule set for dropping in-memory evidence (T10 review S4). Start and Exit both discard the current
/// pipeline after a Stop/flush:
/// <list type="bullet">
/// <item>a complete capture whose enqueue failed (<see cref="PipelineEventKind.Failed"/>): Start refuses (retry Stop
/// first); Exit asks, because exiting loses it;</item>
/// <item>an incomplete collection (<see cref="PipelineEventKind.NotUploadable"/>): both ask before dropping it.</item>
/// </list>
/// Persisted outbox items are never touched by either.</summary>
public static class DropGuard
{
    public enum Action { Start, Exit }
    public sealed record Question(string Title, string Message, bool Refuse);

    public static Question? Check(IReadOnlyList<PipelineEvent> flushed, Action action)
    {
        var failed = flushed.FirstOrDefault(e => e.Kind == PipelineEventKind.Failed);
        if (failed is not null)
            return action == Action.Start
                ? new("Capture not saved", failed.Message + "\nStart is refused so this complete capture is not lost.", Refuse: true)
                : new("Exit without saving?", failed.Message + "\nExit would lose this unsaved complete capture. The persisted outbox remains intact.", Refuse: false);
        var incomplete = flushed.Where(e => e.Kind == PipelineEventKind.NotUploadable).Select(e => e.Message).ToArray();
        if (incomplete.Length == 0) return null;
        var verb = action == Action.Start ? "Starting again" : "Exiting";
        return new(action == Action.Start ? "Start a fresh collection?" : "Exit and drop the incomplete collection?",
            $"The collection is incomplete and was NOT uploaded:\n{string.Join("\n", incomplete)}\n{verb} drops only this in-memory evidence; persisted outbox items stay unchanged.", Refuse: false);
    }
}
