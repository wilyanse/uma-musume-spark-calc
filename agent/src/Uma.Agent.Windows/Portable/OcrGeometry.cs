using System;
using System.Collections.Generic;
using System.Linq;
using Uma.Agent.Core;

namespace Uma.Agent.Windows.Shell;

/// <summary>Geometry for the Windows.Media.Ocr adapter (30 §7): ROI crops upscaled ×2 (capped by the engine's maximum
/// image dimension, never downscaled), boxes mapped back to the 1920x1080 reference space, Digits mode post-filtered
/// to [0-9,].</summary>
public static class OcrGeometry
{
    /// <summary>Windows.Media.Ocr reports no confidence. Every line gets this constant, so Core's OCR-confidence gates
    /// (0.3 / 0.5) never fire on Windows; vocab score/margin, templates and validators still apply (Q-100, H4).</summary>
    public const double WindowsOcrConfidence = 1.0;

    public static double Scale(Rect roi, uint maxImageDimension)
    {
        var longest = Math.Max(roi.Width, roi.Height);
        if (longest <= 0) return 1;
        return Math.Max(1.0, Math.Min(2.0, (double)maxImageDimension / longest));
    }

    /// <summary>Crop-pixel box → reference box, rounding outwards (floor the origin, ceil the far edge).</summary>
    public static Rect ToReference(Rect roi, double scale, double x, double y, double width, double height)
    {
        var x0 = roi.X + (int)Math.Floor(x / scale); var y0 = roi.Y + (int)Math.Floor(y / scale);
        var x1 = roi.X + (int)Math.Ceiling((x + width) / scale); var y1 = roi.Y + (int)Math.Ceiling((y + height) / scale);
        return new Rect(x0, y0, Math.Max(1, x1 - x0), Math.Max(1, y1 - y0));
    }

    public static Rect Union(IEnumerable<Rect> boxes)
    {
        var list = boxes.ToArray();
        if (list.Length == 0) throw new ShellValidationException("OCR geometry requires at least one box.");
        int x0 = list.Min(b => b.X), y0 = list.Min(b => b.Y), x1 = list.Max(b => b.X + b.Width), y1 = list.Max(b => b.Y + b.Height);
        return new Rect(x0, y0, x1 - x0, y1 - y0);
    }

    /// <summary>The ROI of a reference frame, resampled by <paramref name="scale"/> (bicubic). OCR boxes from it are in
    /// crop pixels; map them back with <see cref="ToReference"/>.</summary>
    public static Frame Upscale(Frame frame, Rect roi, double scale)
    {
        if (frame.Width != LayoutProfiles.ReferenceWidth || frame.Height != LayoutProfiles.ReferenceHeight)
            throw new NonReferenceFrameException(frame.Width, frame.Height);
        var crop = Frames.Crop(frame, roi);
        if (scale == 1.0) return crop;
        return Resampler.Resize(crop, Math.Max(1, (int)Math.Round(roi.Width * scale)), Math.Max(1, (int)Math.Round(roi.Height * scale)));
    }

    public static IReadOnlyList<OcrLine> Finish(IEnumerable<(string Text, Rect Box)> lines, OcrMode mode)
        => lines.Select(l => (Text: (mode == OcrMode.Digits ? Ocr.DigitsOnly(l.Text) : l.Text).Trim(), l.Box))
            .Where(l => l.Text.Length > 0)
            .Select(l => new OcrLine(l.Text, WindowsOcrConfidence, l.Box)).ToArray();
}
