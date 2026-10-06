using Uma.Agent.Windows.Shell;
using Xunit;
namespace Uma.Agent.Windows.Portable.Tests;
public class ReviewRound2SecurityTests
{
    [Fact]
    public void Framework_exception_messages_are_never_displayed()
    {
        const string marker = "SYNTHETIC-SENSITIVE-MARKER";
        Exception[] errors = [new ArgumentException(marker), new ArgumentNullException(marker, marker), new ArgumentOutOfRangeException(marker, marker), new IOException(marker), new System.Net.Http.HttpRequestException(marker), new InvalidOperationException(marker), new AggregateException(marker, new ArgumentException(marker))];
        foreach (var e in errors) { var copy = UserMessages.For(e); Assert.DoesNotContain(marker, copy); Assert.Contains(e.GetType().Name, copy); }
    }
    [Fact]
    public void Unknown_command_option_does_not_echo_user_input()
    {
        const string marker = "SYNTHETIC-SENSITIVE-MARKER";
        var e = Assert.ThrowsAny<ArgumentException>(() => CommandLineOptions.Parse(["--" + marker]));
        Assert.DoesNotContain(marker, UserMessages.For(e));
    }
}
