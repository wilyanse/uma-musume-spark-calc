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
    [Fact] public async Task Cancelled_WGC_capture_reads_nothing_and_can_be_disposed_twice()
    {
        var src = new WgcFrameSource(() => new("", "synthetic-no-such-game", ""));
        using var cts = new CancellationTokenSource(); cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => src.NextAsync(cts.Token));
        await src.DisposeAsync(); await src.DisposeAsync();
    }
}
