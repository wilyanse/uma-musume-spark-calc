using System.Text;
using Uma.Agent.Windows.Shell;
using Xunit;

namespace Uma.Agent.Windows.Portable.Tests;

public class SettingsAndSecretsTests
{
    [Theory]
    [InlineData("https://uma.example.test", "https://uma.example.test/")]
    [InlineData("https://uma.example.test/", "https://uma.example.test/")]
    [InlineData("  https://Uma.Example.test/base  ", "https://uma.example.test/base/")]
    [InlineData("https://uma.example.test:8443/x/", "https://uma.example.test:8443/x/")]
    public void Api_address_accepts_absolute_https_and_normalises_the_trailing_slash(string text, string expected)
    {
        Assert.True(ApiAddress.TryParse(text, out var uri, out var error), error);
        Assert.Equal(expected, uri!.AbsoluteUri);
    }

    [Theory]
    [InlineData("", "not configured")]
    [InlineData("   ", "not configured")]
    [InlineData("http://uma.example.test", "https")]
    [InlineData("http://localhost:8787", "https")]
    [InlineData("ftp://uma.example.test", "https")]
    [InlineData("uma.example.test", "absolute")]
    [InlineData("/api", "absolute")]
    [InlineData("https://user:pw@uma.example.test", "user name")]
    [InlineData("https://uma.example.test/?x=1", "query")]
    [InlineData("https://uma.example.test/#frag", "query")]
    public void Api_address_refuses_anything_but_a_plain_https_address(string text, string reason)
    {
        Assert.False(ApiAddress.TryParse(text, out var uri, out var error));
        Assert.Null(uri);
        Assert.Contains(reason, error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Settings_default_to_the_shipped_file_and_have_no_guessed_endpoint()
    {
        var dir = Temp.Dir();
        try
        {
            var defaults = Path.Combine(Repo.Root, "agent/src/Uma.Agent.Windows/appsettings.json");
            var store = new SettingsStore(Path.Combine(dir, "settings.json"), defaults, new TestClock());
            var s = store.Load();
            Assert.Equal("", s.ApiBaseUrl);   // 30 §6 default comes from appsettings.json; no live endpoint is guessed
            Assert.Equal("UmamusumePrettyDerby", s.ProcessName);   // 30 §2
            Assert.Equal("", s.WindowTitleContains);
            Assert.False(File.Exists(Path.Combine(dir, "settings.json")));
        }
        finally { Temp.Drop(dir); }
    }

    [Fact]
    public void Saved_settings_round_trip_and_the_file_carries_no_secret_fields()
    {
        var dir = Temp.Dir();
        try
        {
            var path = Path.Combine(dir, "settings.json");
            var store = new SettingsStore(path, Path.Combine(Repo.Root, "agent/src/Uma.Agent.Windows/appsettings.json"), new TestClock());
            store.Save(new AgentSettings("https://uma.example.test/", "UmamusumePrettyDerby", "Umamusume"));
            Assert.Equal(new AgentSettings("https://uma.example.test/", "UmamusumePrettyDerby", "Umamusume"), store.Load());
            var json = File.ReadAllText(path);
            Assert.DoesNotContain("secret", json, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("clientId", json, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(typeof(AgentSettings).GetProperties(), p => p.Name.Contains("Secret", StringComparison.OrdinalIgnoreCase) || p.Name.Contains("Token", StringComparison.OrdinalIgnoreCase));
        }
        finally { Temp.Drop(dir); }
    }

    [Fact]
    public void Saving_settings_refuses_an_invalid_api_address()
    {
        var dir = Temp.Dir();
        try
        {
            var store = new SettingsStore(Path.Combine(dir, "settings.json"), Path.Combine(Repo.Root, "agent/src/Uma.Agent.Windows/appsettings.json"), new TestClock());
            Assert.Throws<ArgumentException>(() => store.Save(new AgentSettings("http://uma.example.test", "P", "")));
            Assert.Throws<ArgumentException>(() => store.Save(new AgentSettings("https://uma.example.test", " ", "")));
            store.Save(new AgentSettings("", "P", ""));   // clearing the address is allowed (uploads pause)
        }
        finally { Temp.Drop(dir); }
    }

    private const string Id = "4b1c-test-client.access", Secret = "s3cr3t-VALUE-never-on-disk";

    [Fact]
    public void Service_token_is_stored_only_in_protected_form()
    {
        var dir = Temp.Dir();
        try
        {
            var path = Path.Combine(dir, "service-token.bin");
            var protector = new XorProtector();
            var store = new ServiceTokenStore(path, protector);
            Assert.False(store.HasToken);
            store.Save(Id, Secret);
            Assert.True(store.HasToken);
            Assert.Equal(1, protector.Protects);
            var bytes = File.ReadAllBytes(path);
            foreach (var plain in new[] { Id, Secret })
            {
                Assert.DoesNotContain(plain, Encoding.UTF8.GetString(bytes));
                Assert.DoesNotContain(plain, Encoding.Unicode.GetString(bytes));
            }
            Assert.Equal((Id, Secret), new ServiceTokenStore(path, protector).Read());   // survives restart
            Assert.Single(Directory.GetFiles(dir));   // atomic replace leaves no temp file behind
            Assert.DoesNotContain(Secret, store.ToString());
            Assert.DoesNotContain(Id, store.ToString());
        }
        finally { Temp.Drop(dir); }
    }

    [Theory]
    [InlineData("", "x")]
    [InlineData("x", "")]
    [InlineData("a\r\nX-Evil: 1", "x")]
    [InlineData("x", "b\nc")]
    [InlineData("x", "tab\there")]
    public void Service_token_refuses_empty_values_and_header_injection(string id, string secret)
    {
        var dir = Temp.Dir();
        try
        {
            var store = new ServiceTokenStore(Path.Combine(dir, "t.bin"), new XorProtector());
            var e = Assert.Throws<ArgumentException>(() => store.Save(id, secret));
            if (secret.Length > 0) Assert.DoesNotContain(secret, e.Message, StringComparison.Ordinal);
            Assert.False(store.HasToken);
        }
        finally { Temp.Drop(dir); }
    }

    [Fact]
    public void Missing_or_foreign_token_reads_as_missing_with_an_actionable_message()
    {
        var dir = Temp.Dir();
        try
        {
            var path = Path.Combine(dir, "t.bin");
            var store = new ServiceTokenStore(path, new XorProtector());
            Assert.Contains("Settings", Assert.Throws<ServiceTokenMissingException>(() => store.Read()).Message);
            File.WriteAllBytes(path, [1, 2, 3]);   // e.g. copied from another Windows user: DPAPI refuses it
            Assert.False(store.HasToken);
            var e = Assert.Throws<ServiceTokenMissingException>(() => store.Read());
            Assert.Contains("Settings", e.Message);
            store.Clear();
            Assert.False(File.Exists(path));
        }
        finally { Temp.Drop(dir); }
    }

    [Fact]
    public void Agent_paths_live_under_the_local_app_data_folder()
    {
        var p = new AgentPaths("/lad");
        Assert.Equal(Path.Combine("/lad", "UmaSparkCalc", "outbox.db"), p.Outbox);   // 30 §6
        Assert.Equal(Path.Combine("/lad", "UmaSparkCalc", "logs"), p.Logs);           // 30 §7
        Assert.Equal(Path.Combine("/lad", "UmaSparkCalc", "service-token.bin"), p.ServiceToken);
        Assert.Equal(Path.Combine("/lad", "UmaSparkCalc", "settings.json"), p.Settings);
    }
}
