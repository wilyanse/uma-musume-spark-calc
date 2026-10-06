using System;
using System.Collections.Generic;

namespace Uma.Agent.Windows.Shell;

/// <summary>WGC's free-threaded frame pool queues frames between polls; the first one queued is up to a poll interval
/// old. Drain it, keep the newest and dispose the rest (T10 review S1). The drain is bounded so a producer that keeps
/// delivering (e.g. a fast-animating game) cannot hold the poll forever.</summary>
public static class FrameDrain
{
    public const int MaxDrain = 8;

    public static (T? Newest, int Drained) TakeNewest<T>(Func<T?> tryNext, int max = MaxDrain) where T : class, IDisposable
    {
        T? newest = null;
        var drained = 0;
        try
        {
            while (drained < max)
            {
                var next = tryNext();
                if (next is null) break;
                newest?.Dispose();
                newest = next;
                drained++;
            }
            return (newest, drained);
        }
        catch
        {
            newest?.Dispose();
            throw;
        }
    }
}

/// <summary>Numbers-only description of WGC/DWM/client geometry when a capture is refused (T10 review S5): no window
/// titles, process names, paths or tokens. Repeats are suppressed until the numbers change, so a stuck mismatch is
/// logged once rather than every poll.</summary>
public sealed class GeometryDiagnostics
{
    private string? _last;

    public string? Report(string reason, (int W, int H) texture, (int W, int H)? bitmap, (int X, int Y, int W, int H) frame, (int X, int Y, int W, int H) client)
    {
        var text = $"Capture geometry {reason}: texture {texture.W}x{texture.H}; "
            + (bitmap is { } b ? $"bitmap {b.W}x{b.H}; " : "")
            + $"dwm frame {frame.W}x{frame.H} at {frame.X},{frame.Y}; client {client.W}x{client.H} at {client.X},{client.Y}";
        if (text == _last) return null;
        _last = text;
        return text;
    }

    public void Clear() => _last = null;
}
