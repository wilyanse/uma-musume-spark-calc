using Uma.Agent.Core;
using Uma.Agent.Windows.Shell;
using Xunit;

namespace Uma.Agent.Windows.Portable.Tests;

public class TrayStatusAndLoopTests
{
    private static readonly OutboxHealth Empty = new(0, 0, false, null);

    [Fact]
    public void Status_is_idle_until_watching_and_shows_capturing_progress()
    {
        Assert.Equal(TrayState.Idle, TrayStatus.Compute(false, null, null, Empty, UploadBlock.None, false).State);
        Assert.Equal(TrayState.Watching, TrayStatus.Compute(true, null, null, Empty, UploadBlock.None, false).State);
        var p = new SessionProgress("k", 2, []);
        var s = TrayStatus.Compute(true, p, null, Empty, UploadBlock.None, false);
        Assert.Equal(TrayState.Capturing, s.State);
        Assert.Equal("Capturing (2/3)", s.Title);   // 30 §7 "Capturing (n/3)"
    }

    [Fact]
    public void Uploading_shows_while_items_are_pending_and_sending()
    {
        var s = TrayStatus.Compute(false, null, null, new OutboxHealth(3, 0, false, null), UploadBlock.None, uploading: true);
        Assert.Equal(TrayState.Uploading, s.State);
        Assert.Contains("3", s.Title);
    }

    [Theory]
    [InlineData(UploadBlock.AuthRefused, "service token")]
    [InlineData(UploadBlock.NoToken, "service token")]
    [InlineData(UploadBlock.NoAddress, "API address")]
    public void Upload_blocks_with_pending_work_are_errors_pointing_at_settings(UploadBlock block, string text)
    {
        var s = TrayStatus.Compute(true, null, null, new OutboxHealth(1, 0, block == UploadBlock.AuthRefused, null), block, false);
        Assert.Equal(TrayState.Error, s.State);
        Assert.Contains(text, s.Detail);
        Assert.Contains("Settings", s.Detail);
        Assert.Equal(TrayAction.OpenSettings, s.Action);
        // Nothing pending: not an error yet (but still reported in the detail when relevant).
        Assert.NotEqual(TrayState.Error, TrayStatus.Compute(true, null, null, Empty, block, false).State);
    }

    [Fact]
    public void Dead_items_and_frame_errors_are_errors_with_their_actions()
    {
        var dead = TrayStatus.Compute(false, null, null, new OutboxHealth(1, 2, false, null), UploadBlock.None, false);
        Assert.Equal(TrayState.Error, dead.State);
        Assert.Equal(TrayAction.ReviewRejected, dead.Action);
        Assert.Contains("2", dead.Detail);

        var frame = TrayStatus.Compute(true, null, "game client area 1280x720 is below 1920x1080: make the game window at least 1920x1080 (16:9) and try again", Empty, UploadBlock.None, false);
        Assert.Equal(TrayState.Error, frame.State);
        Assert.Contains("1920x1080", frame.Detail);
    }

    [Fact]
    public void Tooltip_text_fits_the_notify_icon_limit()
    {
        var s = TrayStatus.Compute(true, null, new string('x', 500), Empty, UploadBlock.None, false);
        Assert.True(s.Tooltip.Length <= 127);
    }

    private sealed class ScriptedSource(params Func<CancellationToken, Task<Frame>>[] steps) : IFrameSource
    {
        private int _i;
        public int Calls => _i;
        public Task<Frame> NextAsync(CancellationToken ct) => _i < steps.Length ? steps[_i++](ct) : Task.FromException<Frame>(new OperationCanceledException());
    }

    [Fact]
    public async Task Watch_loop_polls_at_250ms_and_reports_device_failures_without_crashing()
    {
        var frame = new Frame(new byte[1920 * 1080 * 4], 1920, 1080);
        using var cts = new CancellationTokenSource();
        var source = new ScriptedSource(
            _ => Task.FromResult(frame),
            _ => throw new CaptureUnavailableException("game window not found: start the game (process UmamusumePrettyDerby)"),
            _ => throw new InvalidOperationException("device lost"),
            _ => { cts.Cancel(); return Task.FromResult(frame); });
        var processed = 0; var errors = new List<string>(); var delays = new List<TimeSpan>();
        var loop = new WatchLoop(source, (f, ct) => { processed++; return Task.CompletedTask; }, e => errors.Add(e),
            (t, ct) => { delays.Add(t); return Task.CompletedTask; });
        await loop.RunAsync(cts.Token);
        Assert.Equal(1, processed);   // the last frame arrived after cancellation and is not processed
        Assert.Equal(2, errors.Count);
        Assert.Contains("start the game", errors[0]);
        Assert.Contains("capture failed", errors[1]);
        Assert.DoesNotContain("device lost", errors[1]);   // raw exception text goes to the log, not the tray
        Assert.Equal(TimeSpan.FromMilliseconds(250), WatchLoop.Interval);   // 30 §7: 4 fps
        Assert.All(delays.Take(1), d => Assert.Equal(WatchLoop.Interval, d));
        Assert.Contains(delays, d => d >= TimeSpan.FromSeconds(1));   // failures back off instead of spinning
    }

    [Fact]
    public async Task Processing_errors_do_not_stop_the_loop()
    {
        var frame = new Frame(new byte[4], 1, 1);
        using var cts = new CancellationTokenSource();
        var n = 0;
        var source = new ScriptedSource(_ => Task.FromResult(frame), _ => Task.FromResult(frame), _ => { cts.Cancel(); return Task.FromResult(frame); });
        var errors = new List<string>();
        var loop = new WatchLoop(source, (f, ct) => ++n == 1 ? throw new IOException("disk") : Task.CompletedTask, errors.Add, (t, ct) => Task.CompletedTask);
        await loop.RunAsync(cts.Token);
        Assert.Equal(2, n);
        Assert.Single(errors);
    }
}
