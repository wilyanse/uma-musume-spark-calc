using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Uma.Agent.Windows.Shell;

/// <summary>Per-user locations (30 §6, §7): everything lives under %LOCALAPPDATA%/UmaSparkCalc.</summary>
public sealed class AgentPaths(string localAppData)
{
    public string Root { get; } = Path.Combine(localAppData, "UmaSparkCalc");
    public string Outbox => Path.Combine(Root, "outbox.db");
    public string Logs => Path.Combine(Root, "logs");
    public string ServiceToken => Path.Combine(Root, "service-token.bin");
    public string Settings => Path.Combine(Root, "settings.json");
    public string Recordings => Path.Combine(Root, "ocr-recordings");

    public static AgentPaths ForCurrentUser() => new(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));
}

/// <summary>User settings. The service token is NOT here: it is stored separately with DPAPI (<see cref="ServiceTokenStore"/>).</summary>
public sealed record AgentSettings(
    [property: JsonPropertyName("apiBaseUrl")] string ApiBaseUrl,
    [property: JsonPropertyName("processName")] string ProcessName,
    [property: JsonPropertyName("windowTitleContains")] string WindowTitleContains);

/// <summary>The API base address (30 §6). Only absolute https addresses without credentials, query or fragment are
/// accepted, so the service token is never sent in clear text. No address is guessed: an empty value means "not
/// configured" and uploads pause.</summary>
public static class ApiAddress
{
    public static bool TryParse(string? text, out Uri? uri, out string error)
    {
        uri = null; error = "";
        var t = (text ?? "").Trim();
        if (t.Length == 0) { error = "The API address is not configured: set it in Settings."; return false; }
        if (!t.Contains("://", StringComparison.Ordinal) || !Uri.TryCreate(t, UriKind.Absolute, out var u) || u.IsFile || u.IsUnc)
        { error = "The API address must be an absolute https:// address."; return false; }
        if (!string.Equals(u.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        { error = $"The API address must use https (got {u.Scheme})."; return false; }
        if (u.UserInfo.Length > 0) { error = "The API address must not contain a user name or password."; return false; }
        if (u.Query.Length > 0 || u.Fragment.Length > 0) { error = "The API address must not contain a query or fragment."; return false; }
        var b = new UriBuilder(u);
        if (!b.Path.EndsWith('/')) b.Path += "/";
        uri = b.Uri;
        return true;
    }
}

/// <summary>Settings file (plain JSON, no secrets). Defaults come from the shipped appsettings.json (30 §6).
/// Writes are atomic (temp file + replace).</summary>
public sealed class SettingsStore(string path, string defaultsPath)
{
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true, PropertyNameCaseInsensitive = true };

    public AgentSettings Load()
    {
        var defaults = Read(defaultsPath) ?? new AgentSettings("", "UmamusumePrettyDerby", "");
        var saved = File.Exists(path) ? Read(path) : null;
        if (saved is null) return defaults;
        return new AgentSettings(saved.ApiBaseUrl ?? defaults.ApiBaseUrl,
            string.IsNullOrWhiteSpace(saved.ProcessName) ? defaults.ProcessName : saved.ProcessName,
            saved.WindowTitleContains ?? defaults.WindowTitleContains);
    }

    public void Save(AgentSettings settings)
    {
        var address = settings.ApiBaseUrl.Trim();
        if (address.Length > 0)
        {
            if (!ApiAddress.TryParse(address, out var uri, out var error)) throw new ArgumentException(error, nameof(settings));
            address = uri!.AbsoluteUri;
        }
        if (string.IsNullOrWhiteSpace(settings.ProcessName)) throw new ArgumentException("The game process name is required.", nameof(settings));
        var normalized = new AgentSettings(address, settings.ProcessName.Trim(), (settings.WindowTitleContains ?? "").Trim());
        AtomicFile.WriteAllBytes(path, JsonSerializer.SerializeToUtf8Bytes(normalized, Options));
    }

    private static AgentSettings? Read(string file)
    {
        if (!File.Exists(file)) return null;
        return JsonSerializer.Deserialize<AgentSettings>(File.ReadAllBytes(file), Options);
    }
}

internal static class AtomicFile
{
    /// <summary>Writes next to the target and moves it into place, so a crash never leaves a half-written file.</summary>
    public static void WriteAllBytes(string path, byte[] bytes, bool overwrite = true)
    {
        var dir = Path.GetDirectoryName(Path.GetFullPath(path))!;
        Directory.CreateDirectory(dir);
        var temp = Path.Combine(dir, "." + Path.GetFileName(path) + "." + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            File.WriteAllBytes(temp, bytes);
            File.Move(temp, path, overwrite: overwrite);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }
}
