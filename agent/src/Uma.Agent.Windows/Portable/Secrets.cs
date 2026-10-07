using System;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using Uma.Agent.Core;

namespace Uma.Agent.Windows.Shell;

/// <summary>Encrypts secrets for the current Windows user. Production: DPAPI CurrentUser (<c>DpapiProtector</c>);
/// tests use a reversible stand-in.</summary>
public interface ISecretProtector
{
    byte[] Protect(byte[] plain);
    /// <summary>Throws <see cref="CryptographicException"/> when the blob was not protected by this user.</summary>
    byte[] Unprotect(byte[] blob);
}

public sealed class ServiceTokenMissingException(string message) : Exception(message);

/// <summary>The Cloudflare Access service token (30 §6, 65 §3): stored only as a protected blob, decrypted on demand
/// for each request and never logged. <see cref="ToString"/> reveals nothing.</summary>
public sealed class ServiceTokenStore(string path, ISecretProtector protector) : IServiceToken
{
    private sealed record Payload(string Id, string Secret);
    private readonly object _lock = new();
    private long _version;

    /// <summary>Nonsecret change counter (T10b r1 B1): incremented under the file lock immediately before every
    /// <see cref="Save"/> write and <see cref="Clear"/>. A caller that reads <see cref="Version"/>, then
    /// <see cref="Read"/>, then <see cref="Version"/> again and sees the same value knows it read the token that was
    /// current at that version. It carries no information about the token itself.</summary>
    public long Version => Interlocked.Read(ref _version);

    public bool HasToken
    {
        get
        {
            try { _ = Read(); return true; }
            catch (ServiceTokenMissingException) { return false; }
        }
    }

    public void Save(string clientId, string clientSecret)
    {
        var id = clientId ?? ""; var secret = clientSecret ?? "";
        if (id.Length == 0 || secret.Length == 0) throw new ShellValidationException("Both the client ID and the client secret are required.");
        if (HasControl(id) || HasControl(secret)) throw new ShellValidationException("The client ID and secret must be single-line values without control characters.");
        var plain = JsonSerializer.SerializeToUtf8Bytes(new Payload(id, secret));
        try
        {
            var blob = protector.Protect(plain);
            lock (_lock) { Interlocked.Increment(ref _version); AtomicFile.WriteAllBytes(path, blob); }
        }
        finally { CryptographicOperations.ZeroMemory(plain); }
    }

    public (string ClientId, string ClientSecret) Read()
    {
        byte[] blob;
        lock (_lock)
        {
            if (!File.Exists(path)) throw new ServiceTokenMissingException("No service token is saved: add the Cloudflare Access service token in Settings.");
            blob = File.ReadAllBytes(path);
        }
        byte[] plain;
        try { plain = protector.Unprotect(blob); }
        catch (CryptographicException)
        {
            throw new ServiceTokenMissingException("The saved service token cannot be decrypted for this Windows user: enter it again in Settings.");
        }
        try
        {
            var p = JsonSerializer.Deserialize<Payload>(plain);
            if (p is null || string.IsNullOrEmpty(p.Id) || string.IsNullOrEmpty(p.Secret)) throw new ServiceTokenMissingException("The saved service token is incomplete: enter it again in Settings.");
            return (p.Id, p.Secret);
        }
        catch (JsonException) { throw new ServiceTokenMissingException("The saved service token is unreadable: enter it again in Settings."); }
        finally { CryptographicOperations.ZeroMemory(plain); }
    }

    public void Clear()
    {
        lock (_lock) { Interlocked.Increment(ref _version); if (File.Exists(path)) File.Delete(path); }
    }

    public override string ToString() => HasToken ? "service token: saved (protected)" : "service token: not saved";

    private static bool HasControl(string s)
    {
        foreach (var c in s) if (char.IsControl(c)) return true;
        return false;
    }
}
