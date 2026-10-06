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
/// is awaited to completion before bitmap disposal. Full-frame recording is tiled (OcrTiling) when ×2 exceeds MaxImageDimension.</summary>
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
            // Parser ROIs fit in one read; the full-frame recorder tiles without splitting lines (OcrTiling, review S2).
            var cap = OcrTiling.Cap(OcrEngine.MaxImageDimension);
            return await OcrTiling.ReadAsync(roi, cap, r => Recognize(frame, r, mode, ct));
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
