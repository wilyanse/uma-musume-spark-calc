using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading;
using System.Threading.Tasks;
using Windows.Graphics;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Graphics.Imaging;
using Uma.Agent.Core;
using Uma.Agent.Windows.Shell;

namespace Uma.Agent.Windows.Native;

/// <summary>Real WGC capture for a chosen HWND, cropped to its physical-pixel client area. Frame pool/session/device
/// are owned by the serialized Next/Dispose path; callback only sets a closed flag. Resizes discard stale textures
/// and recreate the pool. Device errors tear down resources so the next poll can reconnect.</summary>
public sealed class WgcFrameSource(Func<AgentSettings> settings) : IFrameSource, IAsyncDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private IDirect3DDevice? _device;
    private GraphicsCaptureItem? _item;
    private Direct3D11CaptureFramePool? _pool;
    private GraphicsCaptureSession? _session;
    private IntPtr _hwnd;
    private SizeInt32 _size;
    private int _closed;
    private bool _disposed;

    public async Task<Frame> NextAsync(CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            ct.ThrowIfCancellationRequested();
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (!GraphicsCaptureSession.IsSupported()) throw new CaptureUnavailableException("Windows Graphics Capture is unavailable. Use Windows 10 2004 or newer with a working graphics driver.");
            var s = settings();
            var selection = WindowSelector.Select(WindowNative.Enumerate(), s.ProcessName, s.WindowTitleContains);
            if (selection.Window is null) { Reset(); throw new CaptureUnavailableException(selection.Reason); }
            var hwnd = new IntPtr(selection.Window.Handle);
            if (_pool is null || hwnd != _hwnd || Volatile.Read(ref _closed) != 0) { Reset(); Start(hwnd); }
            // Poll the free-threaded pool. No capture callback touches/disposes a frame.
            var deadline = Environment.TickCount64 + 2000;
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                if (Volatile.Read(ref _closed) != 0) { Reset(); throw new CaptureUnavailableException("The captured game window closed. Open the game again to continue."); }
                using var captured = _pool!.TryGetNextFrame();
                if (captured is null)
                {
                    if (Environment.TickCount64 >= deadline) throw new CaptureUnavailableException("No WGC frame received. Restore the game, disable exclusive fullscreen, and use a visible window.");
                    await Task.Delay(20, ct); continue;
                }
                var size = captured.ContentSize;
                if (size.Width <= 0 || size.Height <= 0) continue;
                if (size.Width != _size.Width || size.Height != _size.Height)
                {
                    // Dispose the outstanding frame before Recreate; do not read an old-sized surface.
                    captured.Dispose();
                    _size = size; _pool.Recreate(_device!, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, size);
                    continue;
                }
                var before = WindowNative.GetGeometry(hwnd);
                if (before.FrameWidth != size.Width || before.FrameHeight != size.Height)
                    throw new CaptureUnavailableException("The game window is resizing. Wait for its client area to settle.");
                var roi = ClientArea.Within(before.FrameX, before.FrameY, before.ClientX, before.ClientY, before.ClientWidth, before.ClientHeight, size.Width, size.Height);
                if (roi is null) throw new CaptureUnavailableException("Client bounds do not fit the WGC frame. Restore the game window and wait for resizing to finish.");
                // Await completion before disposing the captured surface, even if caller cancels mid-copy.
                using var bitmap = await SoftwareBitmap.CreateCopyFromSurfaceAsync(captured.Surface, BitmapAlphaMode.Premultiplied);
                ct.ThrowIfCancellationRequested();
                if (WindowNative.GetGeometry(hwnd) != before) throw new CaptureUnavailableException("The game window moved or resized during capture. Hold it still and try again.");
                if (bitmap.PixelWidth != size.Width || bitmap.PixelHeight != size.Height) continue;
                using var bgra = SoftwareBitmap.Convert(bitmap, BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied);
                var bytes = new byte[checked(size.Width * size.Height * 4)];
                bgra.CopyToBuffer(bytes.AsBuffer()); // packed rows into the supplied buffer
                return FrameCopy.Crop(bytes, size.Width * 4, size.Width, size.Height, roi.Value);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (CaptureUnavailableException) { throw; }
        catch { Reset(); throw; }
        finally { _gate.Release(); }
    }
    private void Start(IntPtr hwnd)
    {
        using var factory = WinRT.ActivationFactory.Get("Windows.Graphics.Capture.GraphicsCaptureItem");
        var interop = factory.AsInterface<IGraphicsCaptureItemInterop>();
        var iid = new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760");
        var ptr = interop.CreateForWindow(hwnd, ref iid);
        try { _item = GraphicsCaptureItem.FromAbi(ptr); }
        finally { Marshal.Release(ptr); }
        _item.Closed += Closed;
        _device = D3DNative.CreateDevice(); _size = _item.Size; _hwnd = hwnd;
        _pool = Direct3D11CaptureFramePool.CreateFreeThreaded(_device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, _size);
        _session = _pool.CreateCaptureSession(_item);
        _session.IsCursorCaptureEnabled = false;
        // Keep the system capture border: no access-bypass or border-disable request.
        _session.StartCapture();
    }
    private void Closed(GraphicsCaptureItem sender, object args) => Interlocked.Exchange(ref _closed, 1);
    private void Reset()
    {
        if (_item is not null) _item.Closed -= Closed;
        _session?.Dispose(); _session = null;
        _pool?.Dispose(); _pool = null;
        _device?.Dispose(); _device = null;
        _item = null; _hwnd = IntPtr.Zero; Interlocked.Exchange(ref _closed, 0);
    }
    public async ValueTask DisposeAsync()
    {
        await _gate.WaitAsync();
        try { if (!_disposed) { _disposed = true; Reset(); } }
        finally { _gate.Release(); }
    }
}
