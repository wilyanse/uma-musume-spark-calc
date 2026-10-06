using System;
using System.Security.Cryptography;
using Uma.Agent.Core;

namespace Uma.Agent.Windows.Shell;

/// <summary>30 §7 "skip unchanged frames": a frame is processed only when its whole-frame dHash or size differs from the
/// last processed frame. A 64-bit dHash of 1920x1080 cannot see every small change (real fixtures 02 and 03 collide,
/// Q-101), so a still frame is re-checked after <c>refresh</c>: it is re-processed only if its bytes differ (SHA-256)
/// from the last processed frame. WGC returns a new buffer every poll, so byte-identical idle frames are never
/// re-parsed or re-retained (T10 review B1).</summary>
public sealed class FrameGate(IClock clock, TimeSpan refresh)
{
    private string? _hash;
    private byte[]? _content;
    private (int W, int H) _size;
    private DateTimeOffset _checkedAt;
    private bool _any;

    public static string? Hash(Frame f) => f.Width >= 9 && f.Height >= 8 ? PixelAlgorithms.DHash(f) : null;
    public static byte[] ContentHash(Frame f) => SHA256.HashData(f.Bgra);

    public bool ShouldProcess(Frame f)
    {
        var hash = Hash(f);
        var now = clock.UtcNow;
        var sameHash = _any && hash is not null && hash == _hash && _size == (f.Width, f.Height);
        if (sameHash && now - _checkedAt < refresh) return false;
        var content = ContentHash(f);
        if (sameHash && _content is not null && CryptographicOperations.FixedTimeEquals(content, _content)) { _checkedAt = now; return false; }
        _hash = hash; _content = content; _size = (f.Width, f.Height); _checkedAt = now; _any = true;
        return true;
    }

    public void Reset() { _any = false; _hash = null; _content = null; }
}
