using System.Security.Cryptography;
using Uma.Agent.Core;
using Uma.Agent.Windows.Native;
using Xunit;
namespace Uma.Agent.Windows.Tests;
// Windows-only; compile on Mac, execute at H4. No fabricated OCR text or game capture evidence.
public class NativeTests
{
    [Fact] public void Dpapi_current_user_roundtrip_and_ciphertext_is_not_plaintext()
    {
        var plain = System.Text.Encoding.UTF8.GetBytes("synthetic-test-token");
        var p = new DpapiProtector(); var blob = p.Protect(plain);
        Assert.NotEqual(plain, blob); Assert.Equal(plain, p.Unprotect(blob));
        Assert.Equal(plain, ProtectedData.Unprotect(blob, null, DataProtectionScope.CurrentUser));
    }
    [Fact] public async Task Windows_English_ocr_reads_a_blank_reference_frame_without_inventing_text()
    {
        var bytes = Enumerable.Repeat((byte)255, 1920 * 1080 * 4).ToArray();
        using var ocr = new WindowsOcrEngine();
        var lines = await ocr.ReadAsync(new Frame(bytes,1920,1080), new Rect(100,100,100,40), OcrMode.Text);
        Assert.Empty(lines);
    }
    // Honest scope (review N5): cancellation is checked before any WGC/window call, so this only proves the
    // cancel-then-double-dispose contract of the source, not capture behaviour.
    [Fact] public async Task Pre_cancelled_NextAsync_throws_before_any_capture_call_and_dispose_is_idempotent()
    {
        var src = new WgcFrameSource(() => new("", "synthetic-no-such-game", ""));
        using var cts = new CancellationTokenSource(); cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => src.NextAsync(cts.Token));
        await src.DisposeAsync(); await src.DisposeAsync();
    }
    // Real WGC path up to window selection: with no window of a nonexistent process and no title fallback, the source
    // must fail closed with the actionable message (on a machine without WGC support, the WGC message instead).
    [Fact] public async Task No_matching_game_window_fails_closed_with_an_actionable_capture_unavailable_message()
    {
        await using var src = new WgcFrameSource(() => new("", "synthetic-no-such-game-" + Guid.NewGuid().ToString("N"), ""));
        var e = await Assert.ThrowsAsync<Uma.Agent.Windows.Shell.CaptureUnavailableException>(() => src.NextAsync(CancellationToken.None));
        Assert.True(e.Message.Contains("game window not found", StringComparison.Ordinal) || e.Message.Contains("Windows Graphics Capture is unavailable", StringComparison.Ordinal), e.Message);
    }
    // The tiled full-frame path within the real MaxImageDimension: a blank reference frame yields no invented text.
    [Fact] public async Task Windows_English_ocr_full_frame_tiled_read_of_a_blank_frame_invents_nothing()
    {
        var bytes = Enumerable.Repeat((byte)255, 1920 * 1080 * 4).ToArray();
        using var ocr = new WindowsOcrEngine();
        Assert.Empty(await ocr.ReadAsync(new Frame(bytes, 1920, 1080), new Rect(0, 0, 1920, 1080), OcrMode.Text));
    }
}
