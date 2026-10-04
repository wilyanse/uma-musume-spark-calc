using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Uma.Agent.Core.Cards;

public enum OwnedCardsUploadOutcome
{
    /// <summary>The API acknowledged with `200 {count, partial, syncedAt}` matching what was sent.</summary>
    Synced,
    /// <summary>Refused locally (<see cref="OwnedCardsSyncValidator"/>): nothing was sent.</summary>
    Invalid,
    /// <summary>Cloudflare Access refused the service token (401/403, any 3xx, an HTML login page or an off-origin
    /// response). Not retried: the user must fix the token in Settings, then send again.</summary>
    AuthRequired,
    /// <summary>The API refused the body (4xx other than 401/403/408/429, e.g. 422). Not retried.</summary>
    Rejected,
    /// <summary>Transient failures (5xx, 408, 429, network/timeout, or a 200 that is not the documented
    /// acknowledgement) until the attempt bound. The collection was not confirmed replaced.</summary>
    Failed,
}

/// <summary>`apps/api/src/routes/owned-cards.ts`: `c.json({ count, partial, syncedAt })` with status 200.</summary>
public sealed record OwnedCardsAck(int Count, bool Partial, DateTimeOffset SyncedAt);

/// <summary>`ErrorCategory` is a category only (`HTTP 503`, `auth`, `unexpected-response`, an exception type name):
/// exception messages, response bodies, headers and URLs are never surfaced. `Errors` carries the API's problem
/// `errors[]` (path: message) for a 4xx rejection, or the local validation errors.</summary>
public sealed record OwnedCardsUploadResult(OwnedCardsUploadOutcome Outcome, int Attempts, OwnedCardsAck? Ack, string? ErrorCategory, IReadOnlyList<string> Errors);

/// <summary>Bounded retry: at most `MaxAttempts` requests per <see cref="OwnedCardsUploader.SendAsync"/>, waiting
/// `BaseDelay·2^(n−1)` (capped at `MaxDelay`) before retry n.</summary>
public sealed record OwnedCardsRetryPolicy(int MaxAttempts, TimeSpan BaseDelay, TimeSpan MaxDelay)
{
    public static OwnedCardsRetryPolicy Default { get; } = new(4, TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(30));

    public TimeSpan DelayBefore(int retry)
    {
        var seconds = BaseDelay.TotalSeconds * Math.Pow(2, Math.Min(30, retry - 1));
        return TimeSpan.FromSeconds(Math.Min(MaxDelay.TotalSeconds, seconds));
    }
}

/// <summary>`PUT /api/v1/owned-cards[?partial=1]` (01 §4) with the Cloudflare Access service-token headers (30 §6).
/// <list type="bullet">
/// <item>Validates locally first (same rules as the API, including master IDs when `knownCards` is given).</item>
/// <item>Success is only the route's documented acknowledgement: HTTP 200, a JSON object with exactly `count` (= cards
/// sent), `partial` (= the flag sent) and `syncedAt` (ISO UTC). Anything else is never reported as synced.</item>
/// <item>A transient failure retries identical bytes, count and query flag. For a whole-table target,
/// callers MUST use one reusable <see cref="OwnedCardsUploadCoordinator"/> across session/uploader
/// replacements, and invalidate the session generation on reset/cancel. Direct SendAsync does not order callers.</item>
/// <item>The secret is read from <see cref="IServiceToken"/> per request and only placed in request headers. Nothing is
/// written to disk: no payload, token or response is persisted by this class.</item>
/// </list>
/// The HttpClient must not follow redirects: build it with <see cref="CreateHandler"/> (as for <see cref="UploadClient"/>).
/// No durable queue. Recovery may retry ONLY the still-current coordinator generation; never revive a stale
/// session after a newer scan. Cancellation cannot undo server work already in flight.</summary>
public sealed class OwnedCardsUploader
{
    private readonly HttpClient _http;
    private readonly Uri _baseUri;
    private readonly IServiceToken _token;
    private readonly IReadOnlySet<string>? _knownCards;
    private readonly OwnedCardsRetryPolicy _policy;
    private readonly Func<TimeSpan, CancellationToken, Task> _delay;

    public OwnedCardsUploader(HttpClient http, Uri baseUri, IServiceToken token, IReadOnlySet<string>? knownCards,
        OwnedCardsRetryPolicy? policy = null, Func<TimeSpan, CancellationToken, Task>? delay = null)
    {
        _http = http; _baseUri = baseUri; _token = token; _knownCards = knownCards;
        _policy = policy ?? OwnedCardsRetryPolicy.Default;
        if (_policy.MaxAttempts < 1) throw new ArgumentOutOfRangeException(nameof(policy), "MaxAttempts must be >= 1");
        _delay = delay ?? Task.Delay;
    }

    public static HttpClientHandler CreateHandler() => UploadClient.CreateHandler();
    internal Uri Target => new(_baseUri, "api/v1/owned-cards");

    public async Task<OwnedCardsUploadResult> SendAsync(OwnedCardsSyncPayload payload, CancellationToken ct = default)
    {
        if (payload is null) return new(OwnedCardsUploadOutcome.Invalid, 0, null, "invalid-schema", ["/: must be an envelope"]);
        var schemaErrors = OwnedCardsSyncValidator.ValidateSchema(payload.Body);
        if (schemaErrors.Count > 0) return new(OwnedCardsUploadOutcome.Invalid, 0, null, "invalid-schema", schemaErrors);
        var errors = OwnedCardsSyncValidator.Validate(payload.Body, payload.Partial, _knownCards);
        if (errors.Count > 0) return new(OwnedCardsUploadOutcome.Invalid, 0, null, "invalid-payload", errors);
        if (!payload.HasValidProvenance) return new(OwnedCardsUploadOutcome.Invalid, 0, null, "invalid-provenance", ["/: upload envelope authorization changed"]);
        // Everything used after the first await is from this one immutable snapshot.
        var json = OwnedCardsSyncJson.Serialize(payload.Body);
        var expectedCount = payload.Body.Cards.Count;
        var expectedPartial = payload.Partial;
        var uri = new Uri(_baseUri, payload.Partial ? "api/v1/owned-cards?partial=1" : "api/v1/owned-cards");

        string? category = null;
        for (var attempt = 1; attempt <= _policy.MaxAttempts; attempt++)
        {
            if (attempt > 1) await _delay(_policy.DelayBefore(attempt - 1), ct);
            ct.ThrowIfCancellationRequested();
            var (outcome, ack, cat, apiErrors) = await AttemptAsync(uri, json, expectedCount, expectedPartial, ct);
            switch (outcome)
            {
                case OwnedCardsUploadOutcome.Synced: return new(outcome, attempt, ack, null, []);
                case OwnedCardsUploadOutcome.AuthRequired:
                case OwnedCardsUploadOutcome.Rejected: return new(outcome, attempt, null, cat, apiErrors);
                default: category = cat; break;
            }
        }
        return new(OwnedCardsUploadOutcome.Failed, _policy.MaxAttempts, null, category, []);
    }

    private async Task<(OwnedCardsUploadOutcome, OwnedCardsAck?, string?, IReadOnlyList<string>)> AttemptAsync(Uri uri, string json, int expectedCount, bool expectedPartial, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, uri);
        var (id, secret) = _token.Read();
        request.Headers.Add("CF-Access-Client-Id", id);
        request.Headers.Add("CF-Access-Client-Secret", secret);
        request.Content = new StringContent(json, Encoding.UTF8);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json") { CharSet = "utf-8" };
        try
        {
            using var response = await _http.SendAsync(request, ct);
            var code = (int)response.StatusCode;
            if (code is >= 300 and < 400 || response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                return (OwnedCardsUploadOutcome.AuthRequired, null, UploadErrors.Auth, []);
            var finalUri = response.RequestMessage?.RequestUri;
            if (finalUri is not null && !string.Equals(finalUri.Authority, _baseUri.Authority, StringComparison.OrdinalIgnoreCase))
                return (OwnedCardsUploadOutcome.AuthRequired, null, UploadErrors.AuthLoginPage, []);
            var media = response.Content.Headers.ContentType?.MediaType ?? "";
            if (media.Contains("html", StringComparison.OrdinalIgnoreCase) && code < 500)
            {
                var html = await response.Content.ReadAsStringAsync(ct);
                if (html.Contains("Cloudflare Access", StringComparison.OrdinalIgnoreCase)
                    && html.Contains("Sign in", StringComparison.OrdinalIgnoreCase))
                    return (OwnedCardsUploadOutcome.AuthRequired, null, UploadErrors.AuthLoginPage, []);
            }
            if (!response.IsSuccessStatusCode)
            {
                if (code is >= 400 and < 500 and not 408 and not 429)
                    return (OwnedCardsUploadOutcome.Rejected, null, $"HTTP {code}", media.Contains("json", StringComparison.OrdinalIgnoreCase) ? ProblemErrors(await response.Content.ReadAsStringAsync(ct)) : []);
                return (OwnedCardsUploadOutcome.Failed, null, $"HTTP {code}", []);
            }
            var ack = code == 200 && !media.Contains("html", StringComparison.OrdinalIgnoreCase) ? TryAck(await response.Content.ReadAsStringAsync(ct), expectedCount, expectedPartial) : null;
            return ack is null ? (OwnedCardsUploadOutcome.Failed, null, UploadErrors.UnexpectedResponse, []) : (OwnedCardsUploadOutcome.Synced, ack, null, []);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException or IOException)
        {
            return (OwnedCardsUploadOutcome.Failed, null, e.GetType().Name, []);
        }
    }

    /// <summary>The documented acknowledgement, strictly; null for anything else.</summary>
    internal static OwnedCardsAck? TryAck(string body, int expectedCount, bool expectedPartial)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var p in root.EnumerateObject())
                if (p.Name is not ("count" or "partial" or "syncedAt") || !names.Add(p.Name)) return null;
            if (names.Count != 3) return null;
            if (!root.TryGetProperty("count", out var count) || count.ValueKind != JsonValueKind.Number || !count.TryGetInt32(out var n)) return null;
            if (!root.TryGetProperty("partial", out var partial) || partial.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return null;
            if (!root.TryGetProperty("syncedAt", out var at) || at.ValueKind != JsonValueKind.String) return null;
            var text = at.GetString()!;
            if (!OwnedCardsSyncJson.IsIsoUtc(text) || !DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var syncedAt)) return null;
            if (n != expectedCount || partial.GetBoolean() != expectedPartial) return null;
            return new OwnedCardsAck(n, partial.GetBoolean(), syncedAt);
        }
        catch (JsonException) { return null; }
    }

    /// <summary>RFC 9457 `errors[]` from the API (`{path, message}`), at most 20, each truncated to 300 characters.</summary>
    private static IReadOnlyList<string> ProblemErrors(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.ValueKind != JsonValueKind.Object || !doc.RootElement.TryGetProperty("errors", out var errors) || errors.ValueKind != JsonValueKind.Array) return [];
            return errors.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.Object).Take(20).Select(e =>
            {
                var path = e.TryGetProperty("path", out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : "";
                var message = e.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : "";
                var line = $"{path}: {message}";
                return line.Length > 300 ? line[..300] : line;
            }).ToArray();
        }
        catch (JsonException) { return []; }
    }
}
