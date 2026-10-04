using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Uma.Agent.Windows.Shell;

namespace Uma.Agent.Windows.Native;
internal static class WindowNative
{
    [StructLayout(LayoutKind.Sequential)] internal struct R { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] internal struct P { public int X, Y; }
    private delegate bool EnumProc(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc proc, IntPtr data);
    [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr hwnd, out R rect);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr hwnd, ref P point);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out R rect, int size);
    internal sealed record Geometry(int FrameX, int FrameY, int FrameWidth, int FrameHeight, int ClientX, int ClientY, int ClientWidth, int ClientHeight);
    internal static Geometry GetGeometry(IntPtr hwnd)
    {
        if (!IsWindow(hwnd) || IsIconic(hwnd) || !GetClientRect(hwnd, out var client)) throw new CaptureUnavailableException("The game window closed or is minimized. Restore it to continue capture.");
        var point = new P();
        if (!ClientToScreen(hwnd, ref point) || DwmGetWindowAttribute(hwnd, 9, out var bounds, Marshal.SizeOf<R>()) < 0)
            throw new CaptureUnavailableException("Cannot read the game client bounds. Restore the game window and try again.");
        return new(bounds.Left, bounds.Top, bounds.Right - bounds.Left, bounds.Bottom - bounds.Top, point.X, point.Y, client.Right - client.Left, client.Bottom - client.Top);
    }
    internal static IReadOnlyList<WindowInfo> Enumerate()
    {
        var result = new List<WindowInfo>();
        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd)) return true;
            var title = new StringBuilder(512); GetWindowText(hwnd, title, title.Capacity);
            GetWindowThreadProcessId(hwnd, out var pid);
            string process = "";
            try { using var p = Process.GetProcessById((int)pid); process = p.ProcessName; }
            catch (Exception e) when (e is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception) { }
            GetClientRect(hwnd, out var r);
            result.Add(new(hwnd.ToInt64(), process, title.ToString(), true, IsIconic(hwnd), r.Right-r.Left, r.Bottom-r.Top));
            return true;
        }, IntPtr.Zero);
        return result;
    }
}

[ComImport, Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IGraphicsCaptureItemInterop
{
    IntPtr CreateForWindow(IntPtr window, ref Guid iid);
    IntPtr CreateForMonitor(IntPtr monitor, ref Guid iid);
}
internal static class D3DNative
{
    [DllImport("d3d11.dll", ExactSpelling = true)] private static extern int D3D11CreateDevice(IntPtr adapter, int driverType, IntPtr software, uint flags, IntPtr levels, uint levelsCount, uint sdkVersion, out IntPtr device, out int featureLevel, out IntPtr context);
    [DllImport("d3d11.dll", ExactSpelling = true)] private static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgi, out IntPtr device);
    internal static global::Windows.Graphics.DirectX.Direct3D11.IDirect3DDevice CreateDevice()
    {
        IntPtr device = IntPtr.Zero, context = IntPtr.Zero, dxgi = IntPtr.Zero, projected = IntPtr.Zero;
        try
        {
            var hr = D3D11CreateDevice(IntPtr.Zero, 1, IntPtr.Zero, 0x20, IntPtr.Zero, 0, 7, out device, out _, out context); // BGRA support, hardware
            if (hr < 0)
            {
                if (device != IntPtr.Zero) { Marshal.Release(device); device = IntPtr.Zero; }
                if (context != IntPtr.Zero) { Marshal.Release(context); context = IntPtr.Zero; }
                hr = D3D11CreateDevice(IntPtr.Zero, 5, IntPtr.Zero, 0x20, IntPtr.Zero, 0, 7, out device, out _, out context); // WARP fallback
            }
            Marshal.ThrowExceptionForHR(hr);
            var iid = new Guid("54EC77FA-1377-44E6-8C32-88FD5F44C84C"); // IDXGIDevice
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(device, ref iid, out dxgi));
            Marshal.ThrowExceptionForHR(CreateDirect3D11DeviceFromDXGIDevice(dxgi, out projected));
            return WinRT.MarshalInterface<global::Windows.Graphics.DirectX.Direct3D11.IDirect3DDevice>.FromAbi(projected);
        }
        finally
        {
            if (projected != IntPtr.Zero) Marshal.Release(projected);
            if (dxgi != IntPtr.Zero) Marshal.Release(dxgi);
            if (context != IntPtr.Zero) Marshal.Release(context);
            if (device != IntPtr.Zero) Marshal.Release(device);
        }
    }
}
