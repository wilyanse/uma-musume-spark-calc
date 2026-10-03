using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Uma.Agent.Core;

public enum EnqueueResult { Queued, AlreadyQueued, AlreadyUploaded }

/// <summary>Result of one upload attempt, for the tray (T10): Idle = nothing due; Uploaded = acknowledged by the API;
/// Retrying = transient failure, backed off; AuthRequired = Cloudflare Access refused the service token (401/403, any
/// 3xx, or an HTML login page), every queued item is held with backoff until the user fixes the token
/// (<see cref="UploadOutbox.RetryAuthNow"/>); Rejected = the API refused the item (other 4xx), dead-lettered.</summary>
public enum UploadOutcome { Idle, Uploaded, Retrying, AuthRequired, Rejected }
public sealed record UploadAttempt(UploadOutcome Outcome, string? Kind, string? Error);
public sealed record OutboxItem(long Id, string CaptureId, string Kind, string? Path, int Attempts, bool Dead, string? LastError, DateTimeOffset NextAttemptAt);
public sealed record OutboxHealth(int Pending, int Dead, bool AuthRequired, DateTimeOffset? NextAttemptAt);

/// <summary>Error categories persisted in `last_error`. Raw response bodies, headers, URLs and exception messages are
/// never stored (they can contain login URLs, nonces or other sensitive details).</summary>
public static class UploadErrors
{
    public const string Auth = "auth", AuthLoginPage = "auth-login-page", UnexpectedResponse = "unexpected-response";
    internal static bool IsAuth(string? e) => e is Auth or AuthLoginPage;
}

public sealed record PendingUpload(long Id, string CaptureId, string Kind, string? Path, byte[] Payload, int Attempts);
public interface IServiceToken { (string ClientId, string ClientSecret) Read(); }

/// <summary>Persist payloads, not credentials. Upload crops before their veteran on every retry. Each item has a stable
/// row id (used by <see cref="Requeue"/> / <see cref="Discard"/>); (capture_id, kind, path) is unique, NULL path included.</summary>
public sealed class UploadOutbox
{
    private readonly string _connectionString;
    private readonly IClock _clock;
    private static readonly TimeSpan MaxBackoff = TimeSpan.FromHours(1);

    public UploadOutbox(string databasePath, IClock clock)
    {
        _clock = clock;
        _connectionString = new SqliteConnectionStringBuilder { DataSource = databasePath, DefaultTimeout = 30 }.ToString();
        using var connection = Open();
        using var tx = connection.BeginTransaction(deferred: false);
        using var command = connection.CreateCommand();
        command.Transaction = tx;
        // Round-0 databases have the same outbox/crop_results tables without the unique index (and may hold the duplicate
        // rows a double enqueue produced). Migration keeps the oldest row of each item, so its retry state survives.
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS outbox (
              id INTEGER PRIMARY KEY, capture_id TEXT NOT NULL, kind TEXT NOT NULL,
              path TEXT, payload BLOB NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
              next_attempt_at TEXT NOT NULL, last_error TEXT,
              dead INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS outbox_capture ON outbox(capture_id, kind);
            CREATE TABLE IF NOT EXISTS crop_results (
              capture_id TEXT NOT NULL, path TEXT NOT NULL, crop_key TEXT NOT NULL,
              PRIMARY KEY(capture_id, path)
            );
            CREATE TABLE IF NOT EXISTS captures (
              capture_id TEXT PRIMARY KEY, payload_sha TEXT NOT NULL, veteran_id TEXT
            );
            DELETE FROM outbox WHERE id NOT IN (SELECT MIN(id) FROM outbox GROUP BY capture_id, kind, IFNULL(path, ''));
            CREATE UNIQUE INDEX IF NOT EXISTS outbox_item ON outbox(capture_id, kind, IFNULL(path, ''));
            """;
        command.ExecuteNonQuery();
        tx.Commit();
    }

    private SqliteConnection Open() { var connection = new SqliteConnection(_connectionString); connection.Open(); return connection; }
    /// <summary>Same text format as round 0 (`DateTimeOffset.ToString("O")` at offset 0), so existing rows compare correctly.</summary>
    private static string Iso(DateTimeOffset t) => t.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    /// <summary>Test hook: called after each outbox row inserted by <see cref="EnqueueCapture"/> (crash simulation).</summary>
    internal Action<int>? AfterInsertForTesting { get; set; }

    /// <summary>Low-level insert (tests only); production code queues through <see cref="EnqueueCapture"/>.</summary>
    internal void Enqueue(string captureId, string kind, byte[] payload, string? path = null)
    {
        using var connection = Open();
        Insert(connection, null, captureId, kind, payload, path, ignoreExisting: false);
    }

    private bool Insert(SqliteConnection connection, SqliteTransaction? tx, string captureId, string kind, byte[] payload, string? path, bool ignoreExisting)
    {
        if (kind is not ("crop" or "veteran")) throw new ArgumentException("unknown upload kind", nameof(kind));
        if (kind == "crop" && (path is null || payload.Length > 60 * 1024)) throw new ArgumentException("crop path and <=60KB payload required");
        using var command = connection.CreateCommand(); command.Transaction = tx;
        command.CommandText = $"INSERT {(ignoreExisting ? "OR IGNORE " : "")}INTO outbox(capture_id,kind,path,payload,next_attempt_at) VALUES ($capture,$kind,$path,$payload,$next)";
        command.Parameters.AddWithValue("$capture", captureId); command.Parameters.AddWithValue("$kind", kind);
        command.Parameters.AddWithValue("$path", (object?)path ?? DBNull.Value);
        command.Parameters.AddWithValue("$payload", payload); command.Parameters.AddWithValue("$next", Iso(_clock.UtcNow));
        return command.ExecuteNonQuery() == 1;
    }

    public PendingUpload? Next()
    {
        using var connection = Open(); using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id,capture_id,kind,path,payload,attempts FROM outbox o
            WHERE next_attempt_at <= $now AND dead = 0
              AND (kind = 'crop' OR NOT EXISTS
                (SELECT 1 FROM outbox c WHERE c.capture_id = o.capture_id AND c.kind = 'crop'))
            ORDER BY CASE WHEN kind = 'crop' THEN 0 ELSE 1 END, id LIMIT 1
            """;
        command.Parameters.AddWithValue("$now", Iso(_clock.UtcNow));
        using var reader = command.ExecuteReader();
        return reader.Read() ? new PendingUpload(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetString(3), (byte[])reader[4], reader.GetInt32(5)) : null;
    }

    public void CompleteCrop(PendingUpload item, string cropKey)
    {
        var expected = $"crops/{item.CaptureId}/{Uri.EscapeDataString(item.Path!)}.png";
        if (!string.Equals(cropKey, expected, StringComparison.Ordinal)) throw new InvalidDataException("Crop response key does not match capture and path");
        using var connection = Open(); using var transaction = connection.BeginTransaction();
        using var save = connection.CreateCommand(); save.Transaction = transaction;
        save.CommandText = "INSERT INTO crop_results(capture_id,path,crop_key) VALUES ($capture,$path,$key) ON CONFLICT(capture_id,path) DO UPDATE SET crop_key=excluded.crop_key";
        save.Parameters.AddWithValue("$capture", item.CaptureId); save.Parameters.AddWithValue("$path", item.Path!); save.Parameters.AddWithValue("$key", cropKey); save.ExecuteNonQuery();
        Delete(connection, transaction, item.Id);
        ClearAuth(connection, transaction);
        transaction.Commit();
    }

    /// <summary>The veteran was acknowledged (201/200 with `{veteranId, created}`): remember the ID and remove the row.</summary>
    public void CompleteVeteran(PendingUpload item, string veteranId)
    {
        using var connection = Open(); using var transaction = connection.BeginTransaction();
        using var save = connection.CreateCommand(); save.Transaction = transaction;
        save.CommandText = "INSERT INTO captures(capture_id,payload_sha,veteran_id) VALUES ($capture,'',$vid) ON CONFLICT(capture_id) DO UPDATE SET veteran_id=excluded.veteran_id";
        save.Parameters.AddWithValue("$capture", item.CaptureId); save.Parameters.AddWithValue("$vid", veteranId); save.ExecuteNonQuery();
        Delete(connection, transaction, item.Id);
        ClearAuth(connection, transaction);
        transaction.Commit();
    }

    private static void Delete(SqliteConnection c, SqliteTransaction tx, long id)
    {
        using var q = c.CreateCommand(); q.Transaction = tx;
        q.CommandText = "DELETE FROM outbox WHERE id=$id"; q.Parameters.AddWithValue("$id", id); q.ExecuteNonQuery();
    }

    /// <summary>A success proves the service token works again: drop the stale auth category from held items.</summary>
    private static void ClearAuth(SqliteConnection c, SqliteTransaction tx)
    {
        using var q = c.CreateCommand(); q.Transaction = tx;
        q.CommandText = $"UPDATE outbox SET last_error=NULL WHERE last_error IN ('{UploadErrors.Auth}','{UploadErrors.AuthLoginPage}')"; q.ExecuteNonQuery();
    }

    /// <summary>The API's veteranId once the capture was acknowledged; null while pending (or never queued).</summary>
    public string? UploadedVeteranId(string captureId)
    {
        using var c = Open(); using var q = c.CreateCommand();
        q.CommandText = "SELECT veteran_id FROM captures WHERE capture_id=$capture"; q.Parameters.AddWithValue("$capture", captureId);
        return q.ExecuteScalar() as string;
    }

    public byte[] AttachCropKeys(PendingUpload item)
    {
        var capture = CaptureJson.Deserialize(Encoding.UTF8.GetString(item.Payload));
        if (capture.CaptureId != item.CaptureId) throw new InvalidDataException("Queued capture identity mismatch");
        using var connection = Open(); using var command = connection.CreateCommand();
        command.CommandText = "SELECT path,crop_key FROM crop_results WHERE capture_id=$capture"; command.Parameters.AddWithValue("$capture", item.CaptureId);
        using var reader = command.ExecuteReader();
        var keys = new Dictionary<string,string>(StringComparer.Ordinal);
        while (reader.Read()) keys.Add(reader.GetString(0), reader.GetString(1));
        if (keys.Keys.Any(path => !capture.Fields.Any(f => f.Path == path))) throw new InvalidDataException("Uploaded crop has no matching capture field");
        capture = capture with { Fields = capture.Fields.Select(f => keys.TryGetValue(f.Path, out var key) ? f with { CropKey = key } : f).ToList() };
        var errors = CaptureValidation.Validate(capture);
        if (errors.Count > 0) throw new InvalidDataException("Invalid queued capture: " + string.Join("; ", errors));
        return Encoding.UTF8.GetBytes(CaptureJson.Serialize(capture));
    }

    /// <summary>Queues an assembled capture atomically and idempotently: its crops (one per low-confidence field, minus
    /// crops the API already saved) and then the veteran.
    /// <list type="bullet">
    /// <item>Refuses (<see cref="IncompleteCaptureException"/>) a result that is not <see cref="CaptureResult.Uploadable"/>:
    /// incomplete checklist, errors, or not sealed by the assembler for this content (B1).</item>
    /// <item>Validates the capture and refuses crops that don't belong to a low_confidence field (<see cref="InvalidDataException"/>).</item>
    /// <item>The same capture again returns AlreadyQueued / AlreadyUploaded and leaves retry state alone; a different
    /// payload under the same captureId is refused (<see cref="InvalidDataException"/>), even after acknowledgement.</item>
    /// <item>Legacy pending rows without a captures record are refused without modification. Back up the database,
    /// then finish the existing upload, or explicitly mark an item dead and Discard its entire group before recapturing.
    /// No hash is guessed/backfilled and no user payload is automatically overwritten.</item>
    /// </list></summary>
    public EnqueueResult EnqueueCapture(CaptureResult result)
    {
        var capture = result.Capture ?? throw new IncompleteCaptureException("nothing to upload: " + string.Join("; ", result.Blockers));
        var errors = CaptureValidation.Validate(capture);
        if (errors.Count > 0) throw new InvalidDataException("invalid capture: " + string.Join("; ", errors));
        foreach (var (path, _) in result.Crops)
            if (!capture.Fields.Any(f => f.Path == path && f.Status == FieldStatus.low_confidence)) throw new InvalidDataException("crop for a field that is not low_confidence: " + path);
        if (!result.Uploadable)
            throw new IncompleteCaptureException("capture is not complete; keep capturing: " + string.Join("; ", result.Blockers.DefaultIfEmpty("result was not sealed by the assembler for this content")));

        var veteranPayload = Encoding.UTF8.GetBytes(CaptureJson.Serialize(capture));
        var sha = PayloadSha(veteranPayload, result.Crops);
        using var connection = Open();
        using var tx = connection.BeginTransaction(deferred: false);   // BEGIN IMMEDIATE: concurrent enqueues serialise here
        using (var check = connection.CreateCommand())
        {
            check.Transaction = tx;
            check.CommandText = "SELECT payload_sha, veteran_id FROM captures WHERE capture_id=$capture";
            check.Parameters.AddWithValue("$capture", capture.CaptureId);
            using var r = check.ExecuteReader();
            if (r.Read())
            {
                if (r.GetString(0) != sha) throw new InvalidDataException("a different capture with this captureId is already recorded");
                if (!r.IsDBNull(1)) return EnqueueResult.AlreadyUploaded;
                return EnqueueResult.AlreadyQueued;
            }
        }
        // Legacy pending rows have no verified capture/crop hash. Never combine their old payload with new crops.
        using (var legacy = connection.CreateCommand())
        {
            legacy.Transaction = tx;
            legacy.CommandText = "SELECT EXISTS (SELECT 1 FROM outbox WHERE capture_id=$capture)";
            legacy.Parameters.AddWithValue("$capture", capture.CaptureId);
            if ((long)legacy.ExecuteScalar()! != 0)
                throw new InvalidDataException("legacy queued capture has no verified payload hash; preserve the database and finish its existing upload or explicitly discard its whole group before recapturing");
        }
        using (var add = connection.CreateCommand())
        {
            add.Transaction = tx;
            add.CommandText = "INSERT INTO captures(capture_id,payload_sha,veteran_id) VALUES ($capture,$sha,NULL)";
            add.Parameters.AddWithValue("$capture", capture.CaptureId); add.Parameters.AddWithValue("$sha", sha);
            add.ExecuteNonQuery();
        }
        var saved = new HashSet<string>(StringComparer.Ordinal);
        using (var q = connection.CreateCommand())
        {
            q.Transaction = tx;
            q.CommandText = "SELECT path FROM crop_results WHERE capture_id=$capture"; q.Parameters.AddWithValue("$capture", capture.CaptureId);
            using var r = q.ExecuteReader(); while (r.Read()) saved.Add(r.GetString(0));
        }
        var inserted = 0;
        foreach (var (path, png) in result.Crops.Where(c => !saved.Contains(c.Path)))
        {
            if (Insert(connection, tx, capture.CaptureId, "crop", png, path, ignoreExisting: true)) inserted++;
            AfterInsertForTesting?.Invoke(inserted);
        }
        if (Insert(connection, tx, capture.CaptureId, "veteran", veteranPayload, null, ignoreExisting: true)) inserted++;
        AfterInsertForTesting?.Invoke(inserted);
        tx.Commit();
        return inserted > 0 ? EnqueueResult.Queued : EnqueueResult.AlreadyQueued;
    }

    private static string PayloadSha(byte[] veteran, IReadOnlyList<(string Path, byte[] Png)> crops)
    {
        using var h = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        h.AppendData(veteran);
        foreach (var (path, png) in crops.OrderBy(c => c.Path, StringComparer.Ordinal)) { h.AppendData(Encoding.UTF8.GetBytes("\0" + path + "\0")); h.AppendData(SHA256.HashData(png)); }
        return Convert.ToHexString(h.GetHashAndReset());
    }

    /// <summary>A rejected request (4xx other than 401/403/408/429) is kept for inspection but not retried, and a dead crop
    /// keeps its veteran waiting (the veteran must not be sent without the review crop). Recover with
    /// <see cref="Requeue"/> or <see cref="Discard"/>.</summary>
    public void Dead(PendingUpload item, string error)
    {
        using var c = Open(); using var q = c.CreateCommand();
        q.CommandText = "UPDATE outbox SET attempts=attempts+1,dead=1,last_error=$error WHERE id=$id";
        q.Parameters.AddWithValue("$error", error); q.Parameters.AddWithValue("$id", item.Id); q.ExecuteNonQuery();
    }

    /// <summary>Puts a dead item back in the queue (due now). Returns false for an unknown or non-dead id.</summary>
    public bool Requeue(long id)
    {
        using var c = Open(); using var q = c.CreateCommand();
        q.CommandText = "UPDATE outbox SET dead=0,last_error=NULL,next_attempt_at=$now WHERE id=$id AND dead=1";
        q.Parameters.AddWithValue("$id", id); q.Parameters.AddWithValue("$now", Iso(_clock.UtcNow));
        return q.ExecuteNonQuery() == 1;
    }

    /// <summary>Discards a dead item together with every other queued item of its capture (crops and veteran), so a
    /// veteran can never be uploaded without a crop it needs. Returns the number of rows removed (0 when the id is unknown
    /// or not dead). The capture may be queued again afterwards.</summary>
    public int Discard(long id)
    {
        using var c = Open(); using var tx = c.BeginTransaction(deferred: false);
        string? captureId;
        using (var find = c.CreateCommand())
        {
            find.Transaction = tx;
            find.CommandText = "SELECT capture_id FROM outbox WHERE id=$id AND dead=1"; find.Parameters.AddWithValue("$id", id);
            captureId = find.ExecuteScalar() as string;
        }
        if (captureId is null) return 0;
        int removed;
        using (var del = c.CreateCommand())
        {
            del.Transaction = tx;
            del.Parameters.AddWithValue("$capture", captureId);
            del.CommandText = "DELETE FROM outbox WHERE capture_id=$capture"; removed = del.ExecuteNonQuery();
            del.CommandText = "DELETE FROM crop_results WHERE capture_id=$capture"; del.ExecuteNonQuery();
            del.CommandText = "DELETE FROM captures WHERE capture_id=$capture AND veteran_id IS NULL"; del.ExecuteNonQuery();
        }
        tx.Commit();
        return removed;
    }

    /// <summary>Called by the shell after the user updates the service token: every held item is due now.</summary>
    public void RetryAuthNow()
    {
        using var c = Open(); using var q = c.CreateCommand();
        q.CommandText = $"UPDATE outbox SET next_attempt_at=$now WHERE dead=0 AND EXISTS (SELECT 1 FROM outbox WHERE dead=0 AND last_error IN ('{UploadErrors.Auth}','{UploadErrors.AuthLoginPage}'))";
        q.Parameters.AddWithValue("$now", Iso(_clock.UtcNow)); q.ExecuteNonQuery();
    }

    public IReadOnlyList<OutboxItem> Snapshot()
    {
        using var c = Open(); using var q = c.CreateCommand();
        q.CommandText = "SELECT id,capture_id,kind,path,attempts,dead,last_error,next_attempt_at FROM outbox ORDER BY id";
        using var r = q.ExecuteReader(); var list = new List<OutboxItem>();
        while (r.Read()) list.Add(new(r.GetInt64(0), r.GetString(1), r.GetString(2), r.IsDBNull(3) ? null : r.GetString(3), r.GetInt32(4), r.GetInt32(5) == 1, r.IsDBNull(6) ? null : r.GetString(6),
            DateTimeOffset.Parse(r.GetString(7), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind)));
        return list;
    }

    /// <summary>Tray summary (T10): pending and dead counts, whether the service token is being refused, next due time.</summary>
    public OutboxHealth Health()
    {
        var s = Snapshot();
        var pending = s.Where(x => !x.Dead).ToArray();
        return new(pending.Length, s.Count(x => x.Dead), pending.Any(x => UploadErrors.IsAuth(x.LastError)), pending.Length == 0 ? null : pending.Min(x => x.NextAttemptAt));
    }

    private static TimeSpan Backoff(int attempts) => TimeSpan.FromSeconds(Math.Min(MaxBackoff.TotalSeconds, Math.Pow(2, Math.Min(12, attempts))));

    public void Fail(PendingUpload item, string error)
    {
        var attempts = item.Attempts + 1;
        using var c = Open(); using var q = c.CreateCommand();
        q.CommandText = "UPDATE outbox SET attempts=$attempts,next_attempt_at=$next,last_error=$error WHERE id=$id";
        q.Parameters.AddWithValue("$attempts", attempts); q.Parameters.AddWithValue("$next", Iso(_clock.UtcNow + Backoff(attempts)));
        q.Parameters.AddWithValue("$error", error); q.Parameters.AddWithValue("$id", item.Id); q.ExecuteNonQuery();
    }

    /// <summary>The service token was refused: the item stays retryable (never dead-lettered) and, because the token is
    /// shared, every pending item is held until the same bounded backoff (≤ 1 h), so the queue doesn't hammer Access.</summary>
    public void AuthFailed(PendingUpload item, string category)
    {
        var attempts = item.Attempts + 1;
        var next = Iso(_clock.UtcNow + Backoff(attempts));
        using var c = Open(); using var tx = c.BeginTransaction();
        using var q = c.CreateCommand(); q.Transaction = tx;
        q.CommandText = "UPDATE outbox SET attempts=$attempts,last_error=$error WHERE id=$id";
        q.Parameters.AddWithValue("$attempts", attempts); q.Parameters.AddWithValue("$error", category); q.Parameters.AddWithValue("$id", item.Id); q.ExecuteNonQuery();
        q.Parameters.Clear();
        q.CommandText = "UPDATE outbox SET next_attempt_at=$next WHERE dead=0 AND next_attempt_at < $next";
        q.Parameters.AddWithValue("$next", next); q.ExecuteNonQuery();
        tx.Commit();
    }
}

/// <summary>Sends one due outbox item per call. Success requires the API's documented acknowledgement (01 §3, §8):
/// crops `200 {cropKey}` matching the queued capture/path; veterans `201 {veteranId, created: true}` or
/// `200 {veteranId, created: false}`. Anything else never removes the item.
/// The HttpClient must NOT follow redirects (Cloudflare Access answers a refused token with a 302 to its login page):
/// T10 builds it with <see cref="CreateHandler"/>. If a client does follow one, the HTML/off-origin response is still
/// classified as an auth failure.</summary>
public sealed partial class UploadClient(HttpClient http, Uri baseUri, IServiceToken token, UploadOutbox outbox)
{
    /// <summary>The handler the shell must use: no automatic redirects.</summary>
    public static HttpClientHandler CreateHandler() => new() { AllowAutoRedirect = false };

    public async Task<bool> SendNextAsync(CancellationToken ct = default) => (await SendAsync(ct)).Outcome != UploadOutcome.Idle;

    public async Task<UploadAttempt> SendAsync(CancellationToken ct = default)
    {
        var item = outbox.Next(); if (item is null) return new(UploadOutcome.Idle, null, null);
        var endpoint = item.Kind == "crop"
            ? $"api/v1/crops/{Uri.EscapeDataString(item.CaptureId)}?path={Uri.EscapeDataString(item.Path!)}"
            : "api/v1/veterans";
        using var request = new HttpRequestMessage(item.Kind == "crop" ? HttpMethod.Put : HttpMethod.Post, new Uri(baseUri, endpoint));
        var (id, secret) = token.Read();
        request.Headers.Add("CF-Access-Client-Id", id); request.Headers.Add("CF-Access-Client-Secret", secret);
        UploadAttempt Retry(string error) { outbox.Fail(item, error); return new(UploadOutcome.Retrying, item.Kind, error); }
        UploadAttempt Auth(string error) { outbox.AuthFailed(item, error); return new(UploadOutcome.AuthRequired, item.Kind, error); }
        try
        {
            var payload = item.Kind == "crop" ? item.Payload : outbox.AttachCropKeys(item);
            request.Content = new ByteArrayContent(payload);
            request.Content.Headers.ContentType = new MediaTypeHeaderValue(item.Kind == "crop" ? "image/png" : "application/json");
            using var response = await http.SendAsync(request, ct);
            var code = (int)response.StatusCode;
            if (code is >= 300 and < 400 || response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) return Auth(UploadErrors.Auth);
            if (!response.IsSuccessStatusCode)
            {
                if (code is >= 400 and < 500 and not 408 and not 429)
                {
                    outbox.Dead(item, $"HTTP {code}");
                    return new(UploadOutcome.Rejected, item.Kind, $"HTTP {code}");
                }
                return Retry($"HTTP {code}");
            }
            // A followed redirect ends on another origin; an Access login page is HTML. Neither is an acknowledgement.
            var finalUri = response.RequestMessage?.RequestUri;
            if (finalUri is not null && !string.Equals(finalUri.Authority, baseUri.Authority, StringComparison.OrdinalIgnoreCase)) return Auth(UploadErrors.AuthLoginPage);
            if ((response.Content.Headers.ContentType?.MediaType ?? "").Contains("html", StringComparison.OrdinalIgnoreCase)) return Auth(UploadErrors.AuthLoginPage);
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            if (item.Kind == "crop")
            {
                if (code != 200 || !TryCropKey(doc.RootElement, out var key)) return Retry(UploadErrors.UnexpectedResponse);
                outbox.CompleteCrop(item, key);
            }
            else
            {
                if (!TryAcknowledgement(doc.RootElement, code, out var veteranId)) return Retry(UploadErrors.UnexpectedResponse);
                outbox.CompleteVeteran(item, veteranId);
            }
            return new(UploadOutcome.Uploaded, item.Kind, null);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (JsonException) { return Retry(UploadErrors.UnexpectedResponse); }
        catch (InvalidDataException) when (item.Kind == "crop") { return Retry(UploadErrors.UnexpectedResponse); }   // crop key mismatch
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException or InvalidDataException or KeyNotFoundException or InvalidOperationException)
        {
            // Persist an error category only: exception messages can contain sensitive HTTP details.
            return Retry(e.GetType().Name);
        }
    }

    private static bool TryCropKey(JsonElement root, out string key)
    {
        key = "";
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("cropKey", out var k) || k.ValueKind != JsonValueKind.String) return false;
        key = k.GetString()!;
        return true;
    }

    /// <summary>packages/schema `IngestResponse` (strict object): `{veteranId: ULID, created: boolean, reviewItemIds?: ULID[]}`,
    /// with 201 ⇔ created=true and 200 ⇔ created=false (01 §3; apps/api/src/routes/veterans.ts).</summary>
    internal static bool TryAcknowledgement(JsonElement root, int status, out string veteranId)
    {
        veteranId = "";
        if (root.ValueKind != JsonValueKind.Object) return false;
        foreach (var p in root.EnumerateObject()) if (p.Name is not ("veteranId" or "created" or "reviewItemIds")) return false;
        if (!root.TryGetProperty("veteranId", out var v) || v.ValueKind != JsonValueKind.String || !Ulid().IsMatch(v.GetString()!)) return false;
        if (!root.TryGetProperty("created", out var c) || c.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false;
        if (root.TryGetProperty("reviewItemIds", out var r) && (r.ValueKind != JsonValueKind.Array || r.EnumerateArray().Any(x => x.ValueKind != JsonValueKind.String || !Ulid().IsMatch(x.GetString()!)))) return false;
        if (!(status == 201 && c.GetBoolean() || status == 200 && !c.GetBoolean())) return false;
        veteranId = v.GetString()!;
        return true;
    }

    [GeneratedRegex("^[0-7][0-9A-HJKMNP-TV-Z]{25}$")] private static partial Regex Ulid();
}
