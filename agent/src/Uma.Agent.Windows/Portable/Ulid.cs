using System;
using Uma.Agent.Core;

namespace Uma.Agent.Windows.Shell;

public delegate void RandomFill(Span<byte> buffer);

/// <summary>ULID (01 §1 user-data IDs): 48-bit Unix milliseconds + 80 random bits, Crockford base32. Time and
/// randomness are injected so tests are deterministic; production uses the OS CSPRNG.</summary>
public sealed class UlidGenerator(IClock clock, RandomFill fill)
{
    private const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    private readonly object _lock = new();

    public static UlidGenerator System(IClock clock) => new(clock, b => global::System.Security.Cryptography.RandomNumberGenerator.Fill(b));

    public string Next()
    {
        Span<byte> bytes = stackalloc byte[16];
        var ms = (ulong)clock.UtcNow.ToUnixTimeMilliseconds();
        for (var i = 0; i < 6; i++) bytes[i] = (byte)(ms >> (8 * (5 - i)));
        lock (_lock) fill(bytes[6..]);
        // 128 bits → 26 base32 chars (the first char holds the top 3 bits, so it is 0–7).
        var hi = 0UL; var lo = 0UL;
        for (var i = 0; i < 8; i++) hi = (hi << 8) | bytes[i];
        for (var i = 8; i < 16; i++) lo = (lo << 8) | bytes[i];
        var chars = new char[26];
        for (var i = 25; i >= 0; i--)
        {
            chars[i] = Alphabet[(int)(lo & 31)];
            lo = (lo >> 5) | (hi << 59);
            hi >>= 5;
        }
        return new string(chars);
    }
}

public sealed class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}
