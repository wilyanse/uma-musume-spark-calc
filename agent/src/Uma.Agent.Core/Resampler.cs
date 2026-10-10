using System.Numerics;

namespace Uma.Agent.Core;

/// <summary>Separable bicubic resampling of straight BGRA frames (T16b, 64). This is the Keys cubic-convolution kernel with
/// a = −0.5 (Catmull-Rom; R. Keys, "Cubic convolution interpolation for digital image processing", IEEE TASSP 29(6),
/// 1981). Its conventions are mirrored from SixLabors.ImageSharp 3.1.12's <c>KnownResamplers.Bicubic</c> path
/// (<c>BicubicResampler.GetValue</c>, <c>ResizeKernelMap.BuildKernel</c>, the premultiply/un-premultiply and byte
/// conversion), which the parsers were calibrated with. It is not an independent derivation:
/// <list type="bullet">
/// <item>pixel-centre mapping: center = (i + 0.5)·src/dst − 0.5;</item>
/// <item>support radius 2, widened by the downscale ratio (area-correct when shrinking), clipped to the image, and
/// weights normalised to sum 1;</item>
/// <item>premultiplied-alpha float accumulation, horizontal pass then vertical pass, un-premultiply, then round with
/// +0.5 and saturate to bytes.</item>
/// </list>
/// Measured against 3.1.12 on macOS arm64 (T16b changelog):
/// <list type="bullet">
/// <item>byte-identical on all 15 real fixtures at 2560x1440, 3840x2160, 1600x900 and 1280x720, and normalising back;</item>
/// <item>byte-identical on the OCR upscale and all 645 layout-ROI review crops;</item>
/// <item>±1 on 9 bytes across 2 of 1,200 random review-crop downscales with non-16:9 ratios (e.g. 85x543 to 59x380).</item>
/// </list>
/// ImageSharp shares kernel rows across a repeating period; this resampler computes every row. The working set is
/// bounded: one premultiplied source row plus a ring of horizontally filtered rows as tall as the vertical kernel, never
/// a whole float copy of the frame.</summary>
public static class Resampler
{
    private const double Epsilon = 1e-8;

    private readonly record struct Kernel(int Left, float[] Weights);

    private static float Cubic(float x)
    {
        if (x < 0F) x = -x;
        if (x <= 1F) return (((1.5F * x) - 2.5F) * x * x) + 1;
        if (x < 2F) return (((((-0.5F * x) + 2.5F) * x) - 4) * x) + 2;
        return 0;
    }

    // Tolerant rounding, so that a ratio that is integral up to floating-point noise selects the integral tap.
    private static double Ceiling(double v) { var f = Math.Floor(v); return v - f <= Epsilon ? f : Math.Ceiling(v); }
    private static double Floor(double v) { var c = Math.Ceiling(v); return c - v <= Epsilon ? c : Math.Floor(v); }

    private static Kernel[] Kernels(int source, int destination)
    {
        var ratio = (double)source / destination;
        var scale = Math.Max(1.0, ratio);
        var radius = (int)Ceiling(scale * 2);
        var kernels = new Kernel[destination];
        var values = new double[radius * 2 + 1];
        for (var i = 0; i < destination; i++)
        {
            var center = ((i + .5) * ratio) - .5;
            var left = Math.Max(0, (int)Ceiling(center - radius));
            var right = Math.Min(source - 1, (int)Floor(center + radius));
            var length = right - left + 1;
            double sum = 0;
            for (var j = left; j <= right; j++) { double v = Cubic((float)((j - center) / scale)); sum += v; values[j - left] = v; }
            var weights = new float[length];
            for (var j = 0; j < length; j++) weights[j] = (float)(sum > 0 ? values[j] / sum : values[j]);
            kernels[i] = new Kernel(left, weights);
        }
        return kernels;
    }

    /// <summary>Resamples a straight BGRA frame to <paramref name="width"/> x <paramref name="height"/>. Same size returns a
    /// copy. The input is never modified.</summary>
    public static Frame Resize(Frame frame, int width, int height)
    {
        ArgumentNullException.ThrowIfNull(frame);
        if (frame.Width <= 0 || frame.Height <= 0 || frame.Bgra.Length != checked(frame.Width * frame.Height * 4))
            throw new ArgumentException($"frame {frame.Width}x{frame.Height} does not hold {frame.Width}x{frame.Height} tightly packed BGRA pixels", nameof(frame));
        ArgumentOutOfRangeException.ThrowIfLessThan(width, 1);
        ArgumentOutOfRangeException.ThrowIfLessThan(height, 1);
        var output = new byte[checked(width * height * 4)];
        if (width == frame.Width && height == frame.Height)
        {
            Buffer.BlockCopy(frame.Bgra, 0, output, 0, output.Length);
            return new Frame(output, width, height);
        }

        var horizontal = Kernels(frame.Width, width);
        var vertical = Kernels(frame.Height, height);
        var window = vertical.Max(k => k.Weights.Length);
        var rows = new Vector4[window][];                   // ring of horizontally filtered rows (premultiplied RGBA)
        var rowIds = new int[window];
        Array.Fill(rowIds, -1);
        for (var i = 0; i < window; i++) rows[i] = new Vector4[width];
        var source = new Vector4[frame.Width];
        const float unit = 1f / 255f;

        Vector4[] Row(int y)
        {
            var slot = y % window;
            if (rowIds[slot] == y) return rows[slot];
            var bgra = frame.Bgra;
            var offset = y * frame.Width * 4;
            for (var x = 0; x < frame.Width; x++)
            {
                var p = offset + x * 4;
                var v = new Vector4(bgra[p + 2], bgra[p + 1], bgra[p], bgra[p + 3]) * unit;
                source[x] = new Vector4(v.X * v.W, v.Y * v.W, v.Z * v.W, v.W);
            }
            var target = rows[slot];
            for (var x = 0; x < width; x++)
            {
                var k = horizontal[x];
                var acc = Vector4.Zero;
                for (var j = 0; j < k.Weights.Length; j++) acc += source[k.Left + j] * k.Weights[j];
                target[x] = acc;
            }
            rowIds[slot] = y;
            return target;
        }

        var taps = new Vector4[window][];
        for (var y = 0; y < height; y++)
        {
            var k = vertical[y];
            for (var j = 0; j < k.Weights.Length; j++) taps[j] = Row(k.Left + j);
            var o = y * width * 4;
            for (var x = 0; x < width; x++)
            {
                var acc = Vector4.Zero;
                for (var j = 0; j < k.Weights.Length; j++) acc += taps[j][x] * k.Weights[j];
                var alpha = acc.W;
                if (alpha != 0) { acc /= alpha; acc.W = alpha; }
                acc = Vector4.Clamp((acc * 255f) + new Vector4(.5f), Vector4.Zero, new Vector4(255f));
                output[o] = (byte)acc.Z; output[o + 1] = (byte)acc.Y; output[o + 2] = (byte)acc.X; output[o + 3] = (byte)acc.W;
                o += 4;
            }
        }
        return new Frame(output, width, height);
    }
}
