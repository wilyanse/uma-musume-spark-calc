using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using OcrLine = Uma.Agent.Core.OcrLine;
using Uma.Agent.Core;
using Uma.Agent.Windows.Shell;

namespace Uma.Agent.Windows.Native;
public sealed class DpapiProtector : ISecretProtector
{
    public byte[] Protect(byte[] plain) => ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser);
    public byte[] Unprotect(byte[] blob) => ProtectedData.Unprotect(blob, null, DataProtectionScope.CurrentUser);
}

/// <summary>Real English Windows.Media.Ocr. A serialized engine with caller cancellation checks; the WinRT operation
/// is awaited to completion before bitmap disposal. Full-frame recording is tiled when ×2 exceeds MaxImageDimension.</summary>
public sealed class WindowsOcrEngine : IOcrEngine, IDisposable
{
    private readonly OcrEngine _engine;
    private readonly SemaphoreSlim _gate = new(1, 1);
    public string LanguageTag => _engine.RecognizerLanguage.LanguageTag;
    public CancellationToken Cancellation { get; set; }
    public WindowsOcrEngine()
    {
        _engine = OcrEngine.TryCreateFromLanguage(new Language("en-US"))
            ?? throw new CaptureUnavailableException("English Windows OCR is unavailable. Install English (United States) language/OCR in Windows Settings > Time & language, then restart the agent.");
    }
    public async Task<IReadOnlyList<OcrLine>> ReadAsync(Frame frame, Rect roi, OcrMode mode)
    {
        var ct = Cancellation;
        await _gate.WaitAsync(ct);
        try
        {
            ct.ThrowIfCancellationRequested();
            if (frame.Width != 1920 || frame.Height != 1080) throw new NonReferenceFrameException(frame.Width, frame.Height);
            // Native limit applies to SoftwareBitmap. Every recognition input is a reference ROI enlarged exactly ×2.
            // Most parser ROIs fit; the full-frame recorder uses overlapping tiles and deduplicates by box center.
            int cap = (int)OcrEngine.MaxImageDimension / 2;
            if (cap < 128) throw new CaptureUnavailableException("Windows OCR maximum image dimension is unexpectedly small.");
            if (roi.Width <= cap && roi.Height <= cap) return await Recognize(frame, roi, mode, ct);
            var lines = new List<OcrLine>();
            const int overlap = 100;
            for (int y = roi.Y; y < roi.Y + roi.Height; y += cap - overlap)
            for (int x = roi.X; x < roi.X + roi.Width; x += cap - overlap)
            {
                var tile = new Rect(x, y, Math.Min(cap, roi.X + roi.Width - x), Math.Min(cap, roi.Y + roi.Height - y));
                var tileLines = await Recognize(frame, tile, mode, ct);
                // Assign overlapping text to the tile whose non-overlap ownership region contains its center.
                foreach (var l in tileLines)
                {
                    double cx = l.Box.X + l.Box.Width / 2.0, cy = l.Box.Y + l.Box.Height / 2.0;
                    var left = x == roi.X ? x : x + overlap / 2;
                    var top = y == roi.Y ? y : y + overlap / 2;
                    var right = x + tile.Width == roi.X + roi.Width ? x + tile.Width : x + tile.Width - overlap / 2;
                    var bottom = y + tile.Height == roi.Y + roi.Height ? y + tile.Height : y + tile.Height - overlap / 2;
                    if (cx >= left && cx < right && cy >= top && cy < bottom) lines.Add(l);
                }
            }
            return lines.OrderBy(l => l.Box.Y).ThenBy(l => l.Box.X).ToArray();
        }
        finally { _gate.Release(); }
    }
    private async Task<IReadOnlyList<OcrLine>> Recognize(Frame frame, Rect roi, OcrMode mode, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var crop = OcrGeometry.Upscale(frame, roi, 2);
        using var bitmap = SoftwareBitmap.CreateCopyFromBuffer(crop.Bgra.AsBuffer(), BitmapPixelFormat.Bgra8, crop.Width, crop.Height, BitmapAlphaMode.Premultiplied);
        // Do not abandon this operation on cancellation: Windows still owns the bitmap until it completes.
        var result = await _engine.RecognizeAsync(bitmap);
        ct.ThrowIfCancellationRequested();
        return OcrGeometry.Finish(result.Lines.Where(l => l.Words.Count > 0).Select(l =>
            (l.Text, OcrGeometry.Union(l.Words.Select(w => { var b = w.BoundingRect; return OcrGeometry.ToReference(roi, 2, b.X, b.Y, b.Width, b.Height); })))), mode);
    }
    // The host only disposes after the watcher/recorder task has joined.
    public void Dispose() => _gate.Dispose();
}
