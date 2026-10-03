using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Uma.Agent.Core;

public sealed record PendingUpload(long Id, string CaptureId, string Kind, string? Path, byte[] Payload, int Attempts);
public interface IServiceToken { (string ClientId, string ClientSecret) Read(); }

/// <summary>Persist payloads, not credentials. Upload crops before their veteran on every retry.</summary>
public sealed class UploadOutbox
{
    private readonly string _connectionString;
    private readonly IClock _clock;
    public UploadOutbox(string databasePath, IClock clock)
    {
        _clock = clock;
        _connectionString = new SqliteConnectionStringBuilder { DataSource = databasePath }.ToString();
        using var connection = Open();
        using var command = connection.CreateCommand();
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
            """;
        command.ExecuteNonQuery();
    }
    private SqliteConnection Open() { var connection = new SqliteConnection(_connectionString); connection.Open(); return connection; }
    public void Enqueue(string captureId, string kind, byte[] payload, string? path = null)
    {
        if (kind is not ("crop" or "veteran")) throw new ArgumentException("unknown upload kind", nameof(kind));
        if (kind == "crop" && (path is null || payload.Length > 60 * 1024)) throw new ArgumentException("crop path and <=60KB payload required");
        using var connection = Open(); using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO outbox(capture_id,kind,path,payload,next_attempt_at) VALUES ($capture,$kind,$path,$payload,$next)";
        command.Parameters.AddWithValue("$capture", captureId); command.Parameters.AddWithValue("$kind", kind);
        command.Parameters.AddWithValue("$path", (object?)path ?? DBNull.Value);
        command.Parameters.AddWithValue("$payload", payload); command.Parameters.AddWithValue("$next", _clock.UtcNow.ToString("O"));
        command.ExecuteNonQuery();
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
        command.Parameters.AddWithValue("$now", _clock.UtcNow.ToString("O"));
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
        using var remove = connection.CreateCommand(); remove.Transaction = transaction;
        remove.CommandText = "DELETE FROM outbox WHERE id=$id"; remove.Parameters.AddWithValue("$id", item.Id); remove.ExecuteNonQuery();
        transaction.Commit();
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
    public void Complete(long id) { using var c = Open(); using var q = c.CreateCommand(); q.CommandText = "DELETE FROM outbox WHERE id=$id"; q.Parameters.AddWithValue("$id", id); q.ExecuteNonQuery(); }
    /// <summary>Queues an assembled capture: its crops (one per low-confidence field) and then the veteran. Validates first,
    /// and refuses crops that don't belong to a low_confidence field of this capture.</summary>
    public void EnqueueCapture(CaptureResult result)
    {
        var capture = result.Capture ?? throw new InvalidOperationException("nothing to upload: " + string.Join("; ", result.Errors));
        var errors = CaptureValidation.Validate(capture);
        if (errors.Count > 0) throw new InvalidDataException("invalid capture: " + string.Join("; ", errors));
        foreach (var (path, _) in result.Crops)
            if (!capture.Fields.Any(f => f.Path == path && f.Status == FieldStatus.low_confidence)) throw new InvalidDataException("crop for a field that is not low_confidence: " + path);
        foreach (var (path, png) in result.Crops) Enqueue(capture.CaptureId, "crop", png, path);
        Enqueue(capture.CaptureId, "veteran", Encoding.UTF8.GetBytes(CaptureJson.Serialize(capture)));
    }

    /// <summary>A rejected request (4xx other than 408/429) is kept for inspection but never retried, and a dead crop
    /// keeps its veteran waiting (the veteran must not be sent without the review crop).</summary>
    public void Dead(PendingUpload item, string error)
    {
        using var c = Open(); using var q = c.CreateCommand();
        q.CommandText = "UPDATE outbox SET attempts=attempts+1,dead=1,last_error=$error WHERE id=$id";
        q.Parameters.AddWithValue("$error", error); q.Parameters.AddWithValue("$id", item.Id); q.ExecuteNonQuery();
    }

    public IReadOnlyList<(string Kind, string? Path, int Attempts, bool Dead, string? LastError)> Snapshot()
    {
        using var c = Open(); using var q = c.CreateCommand();
        q.CommandText = "SELECT kind,path,attempts,dead,last_error FROM outbox ORDER BY id";
        using var r = q.ExecuteReader(); var list = new List<(string, string?, int, bool, string?)>();
        while (r.Read()) list.Add((r.GetString(0), r.IsDBNull(1) ? null : r.GetString(1), r.GetInt32(2), r.GetInt32(3) == 1, r.IsDBNull(4) ? null : r.GetString(4)));
        return list;
    }

    public void Fail(PendingUpload item, string error)
    {
        var attempts = item.Attempts + 1;
        var delay = TimeSpan.FromSeconds(Math.Min(3600, Math.Pow(2, Math.Min(12, attempts))));
        using var c = Open(); using var q = c.CreateCommand();
        q.CommandText = "UPDATE outbox SET attempts=$attempts,next_attempt_at=$next,last_error=$error WHERE id=$id";
        q.Parameters.AddWithValue("$attempts", attempts); q.Parameters.AddWithValue("$next", (_clock.UtcNow + delay).ToString("O"));
        q.Parameters.AddWithValue("$error", error); q.Parameters.AddWithValue("$id", item.Id); q.ExecuteNonQuery();
    }
}

public sealed class UploadClient(HttpClient http, Uri baseUri, IServiceToken token, UploadOutbox outbox)
{
    public async Task<bool> SendNextAsync(CancellationToken ct = default)
    {
        var item = outbox.Next(); if (item is null) return false;
        var endpoint = item.Kind == "crop"
            ? $"api/v1/crops/{Uri.EscapeDataString(item.CaptureId)}?path={Uri.EscapeDataString(item.Path!)}"
            : "api/v1/veterans";
        using var request = new HttpRequestMessage(item.Kind == "crop" ? HttpMethod.Put : HttpMethod.Post, new Uri(baseUri, endpoint));
        var (id, secret) = token.Read();
        request.Headers.Add("CF-Access-Client-Id", id); request.Headers.Add("CF-Access-Client-Secret", secret);
        try
        {
            var payload = item.Kind == "crop" ? item.Payload : outbox.AttachCropKeys(item);
            request.Content = new ByteArrayContent(payload);
            request.Content.Headers.ContentType = new MediaTypeHeaderValue(item.Kind == "crop" ? "image/png" : "application/json");
            using var response = await http.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                var code = (int)response.StatusCode;
                if (code is >= 400 and < 500 and not 408 and not 429) outbox.Dead(item, $"HTTP {code}");
                else outbox.Fail(item, $"HTTP {code}");
                return true;
            }
            if (item.Kind == "crop")
            {
                using var result = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
                var key = result.RootElement.GetProperty("cropKey").GetString() ?? throw new InvalidDataException("Missing cropKey");
                outbox.CompleteCrop(item, key);
            }
            else outbox.Complete(item.Id);
            return true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException or JsonException or InvalidDataException or KeyNotFoundException or InvalidOperationException)
        {
            // Persist an error category only: exception messages can contain sensitive HTTP details.
            outbox.Fail(item, e.GetType().Name); return true;
        }
    }
}
