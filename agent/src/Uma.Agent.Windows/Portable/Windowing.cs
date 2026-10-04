using System;
using System.Collections.Generic;
using System.Linq;
using Uma.Agent.Core;

namespace Uma.Agent.Windows.Shell;

/// <summary>A top-level window as seen by the shell: handle, owning process name, title, visibility and client size
/// (physical pixels; the app is per-monitor DPI aware).</summary>
public sealed record WindowInfo(long Handle, string ProcessName, string Title, bool Visible, bool Minimized, int ClientWidth, int ClientHeight);

public sealed record WindowSelection(WindowInfo? Window, string Reason);

/// <summary>Thrown by the frame source when no frame can be captured right now; the message is shown in the tray.</summary>
public sealed class CaptureUnavailableException(string message) : Exception(message);

/// <summary>30 §2: find the game window by process name (configurable, default `UmamusumePrettyDerby`), falling back to
/// a window-title match. Never guesses between several title matches.</summary>
public static class WindowSelector
{
    public static string NormalizeProcess(string name)
    {
        var n = (name ?? "").Trim();
        return n.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? n[..^4] : n;
    }

    public static WindowSelection Select(IReadOnlyList<WindowInfo> windows, string processName, string titleContains)
    {
        var process = NormalizeProcess(processName);
        static bool Usable(WindowInfo w) => w.Visible && !w.Minimized && w.ClientWidth > 0 && w.ClientHeight > 0;
        var byProcess = process.Length == 0 ? [] : windows.Where(w => string.Equals(NormalizeProcess(w.ProcessName), process, StringComparison.OrdinalIgnoreCase)).ToArray();
        var usable = byProcess.Where(Usable).OrderByDescending(w => (long)w.ClientWidth * w.ClientHeight).ThenBy(w => w.Handle).ToArray();
        if (usable.Length > 0) return new(usable[0], $"process {process}");
        if (byProcess.Any(w => w.Visible && w.Minimized))
            return new(null, $"the game window ({process}) is minimized: restore it to capture");

        var title = (titleContains ?? "").Trim();
        if (title.Length > 0)
        {
            var matches = windows.Where(w => Usable(w) && w.Title.Contains(title, StringComparison.OrdinalIgnoreCase)).ToArray();
            if (matches.Length == 1) return new(matches[0], $"title contains \"{title}\"");
            if (matches.Length > 1) return new(null, $"{matches.Length} windows match the title \"{title}\": set the game's process name in Settings instead");
        }
        return new(null, $"game window not found: start the game (process {(process.Length > 0 ? process : "<not set>")}" + (title.Length > 0 ? $", or a window titled \"{title}\")" : ")"));
    }
}

/// <summary>Maps the window's client area into a captured window texture. WGC captures the window's DWM extended frame
/// bounds; the client origin and size come from ClientToScreen/GetClientRect. Any inconsistency (e.g. the texture
/// lagging a resize) yields null, and the frame is skipped rather than cropped wrongly.</summary>
public static class ClientArea
{
    public static Rect? Within(int frameX, int frameY, int clientX, int clientY, int clientWidth, int clientHeight, int textureWidth, int textureHeight)
    {
        var dx = clientX - frameX; var dy = clientY - frameY;
        if (clientWidth <= 0 || clientHeight <= 0 || dx < 0 || dy < 0) return null;
        if ((long)dx + clientWidth > textureWidth || (long)dy + clientHeight > textureHeight) return null;
        return new Rect(dx, dy, clientWidth, clientHeight);
    }
}

public static class FrameCopy
{
    /// <summary>Copies a BGRA sub-rectangle out of a strided buffer and forces alpha to 255 (the game is opaque; WGC can
    /// report premultiplied/zero alpha that would otherwise wash out dHash and colour reads).</summary>
    public static Frame Crop(byte[] source, int stride, int width, int height, Rect r)
    {
        if (r.X < 0 || r.Y < 0 || r.Width <= 0 || r.Height <= 0 || r.X + r.Width > width || r.Y + r.Height > height || stride < width * 4 || source.Length < (long)stride * height)
            throw new ArgumentOutOfRangeException(nameof(r), $"crop {r} outside {width}x{height}");
        var bytes = new byte[r.Width * r.Height * 4];
        for (var y = 0; y < r.Height; y++)
        {
            Buffer.BlockCopy(source, (r.Y + y) * stride + r.X * 4, bytes, y * r.Width * 4, r.Width * 4);
            for (var x = 0; x < r.Width; x++) bytes[(y * r.Width + x) * 4 + 3] = 255;
        }
        return new Frame(bytes, r.Width, r.Height);
    }
}
