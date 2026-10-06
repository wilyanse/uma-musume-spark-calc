using Uma.Agent.Windows.Shell;
using Xunit;
namespace Uma.Agent.Windows.Portable.Tests;
public class ShellValidationTests
{
    [Fact]
    public void Known_validation_copy_is_actionable_without_echoing_sensitive_values()
    {
        const string marker = "SYNTHETIC-SENSITIVE-MARKER";
        var dir = Temp.Dir();
        try
        {
            var tokens = new ServiceTokenStore(Path.Combine(dir, "token.bin"), new XorProtector());
            var tokenError = Assert.Throws<ShellValidationException>(() => tokens.Save(marker, marker + "\n"));
            Assert.Contains("single-line", UserMessages.For(tokenError)); Assert.DoesNotContain(marker, UserMessages.For(tokenError));
            var settings = new SettingsStore(Path.Combine(dir, "settings.json"), Path.Combine(Repo.Root, "agent/src/Uma.Agent.Windows/appsettings.json"), new TestClock());
            var error = Assert.Throws<ShellValidationException>(() => settings.Save(new(marker + "://host/", "Game", "")));
            Assert.Contains("https", UserMessages.For(error)); Assert.DoesNotContain(marker, UserMessages.For(error));
            var option = Assert.Throws<ShellValidationException>(() => CommandLineOptions.Parse(["--record-ocr", "file.png", "--out"]));
            Assert.Contains("--out", UserMessages.For(option));
        }
        finally { Temp.Drop(dir); }
    }
}
