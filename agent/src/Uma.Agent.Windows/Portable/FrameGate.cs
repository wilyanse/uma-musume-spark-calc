using System;
using Uma.Agent.Core;

namespace Uma.Agent.Windows.Shell;

/// <summary>30 §7 "skip unchanged frames": a frame is processed only when its whole-frame dHash or size differs from the
/// last processed frame. A 64-bit dHash of 1920x1080 cannot see every small change (e.g. a short scroll), so a still
/// frame is re-processed after <c>refresh</c>; re-reading a frame is harmless because sessions deduplicate.</summary>
public sealed class FrameGate(IClock clock, TimeSpan refresh)
{
    private string? _hash;
    private (int W, int H) _size;
    private DateTimeOffset _processedAt;
    private bool _any;

    public static string? Hash(Frame f) => f.Width >= 9 && f.Height >= 8 ? PixelAlgorithms.DHash(f) : null;

    public bool ShouldProcess(Frame f)
    {
        var hash = Hash(f);
        var now = clock.UtcNow;
        var same = _any && hash is not null && hash == _hash && _size == (f.Width, f.Height) && now - _processedAt < refresh;
        if (same) return false;
        _hash = hash; _size = (f.Width, f.Height); _processedAt = now; _any = true;
        return true;
    }

    public void Reset() { _any = false; _hash = null; }
}
