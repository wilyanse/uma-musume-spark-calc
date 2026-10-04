using System;
using System.Threading;
using System.Threading.Tasks;
using Uma.Agent.Core;
namespace Uma.Agent.Windows.Shell;
public enum TrayState { Idle, Watching, Capturing, Uploading, Error }
public enum TrayAction { None, OpenSettings, ReviewRejected }
public sealed record TrayStatus(TrayState State, string Title, string Detail, TrayAction Action)
{
    public string Tooltip => ("Uma Spark Calc — " + Title) is var t && t.Length > 127 ? t[..127] : t;
    public static TrayStatus Compute(bool watching, SessionProgress? progress, string? error, OutboxHealth health, UploadBlock block, bool uploading)
    {
        if (error is not null) return new(TrayState.Error, "Error", error, TrayAction.None);
        if (health.Pending > 0 && (block != UploadBlock.None || health.AuthRequired))
            return new(TrayState.Error, "Error: upload paused", block == UploadBlock.NoAddress ? "Set the HTTPS API address in Settings." : "Check the service token in Settings, then save to RetryAuthNow.", TrayAction.OpenSettings);
        if (health.Dead > 0) return new(TrayState.Error, "Error: rejected uploads", $"{health.Dead} rejected item(s). Review rejected uploads to Requeue or Discard.", TrayAction.ReviewRejected);
        if (uploading) return new(TrayState.Uploading, $"Uploading ({health.Pending})", "Waiting for the API JSON acknowledgement.", TrayAction.None);
        if (watching && progress is not null) return new(TrayState.Capturing, $"Capturing ({progress.TabsComplete}/3)", "Scroll slowly; finish all checklist sections and parent popups, then Stop to queue.", TrayAction.None);
        return new(watching ? TrayState.Watching : TrayState.Idle, watching ? "Watching" : "Idle", $"{health.Pending} pending item(s). Assisted capture only.", TrayAction.None);
    }
}
public sealed class WatchLoop(IFrameSource source, Func<Frame, CancellationToken, Task> process, Action<string> error, Func<TimeSpan, CancellationToken, Task> delay)
{
    public static TimeSpan Interval => TimeSpan.FromMilliseconds(250);
    public async Task RunAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var wait = Interval;
                try { var frame = await source.NextAsync(ct); ct.ThrowIfCancellationRequested(); await process(frame, ct); }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
                catch (CaptureUnavailableException e) { error(e.Message); wait = TimeSpan.FromSeconds(1); }
                catch (Exception) { error("capture failed: restore the game window or Stop and Start to recreate the capture device."); wait = TimeSpan.FromSeconds(1); }
                await delay(wait, ct);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
    }
}
