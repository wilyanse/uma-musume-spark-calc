using Microsoft.Data.Sqlite;
using System.Security.Cryptography;
using System.Text;
using Xunit;
using Xunit.Abstractions;

namespace Uma.Agent.Core.Tests;

public class SqliteSecurityTests(ITestOutputHelper output)
{
    private sealed class Clock : IClock
    {
        public DateTimeOffset UtcNow { get; set; } = Collect.At;
    }

    [Fact]
    public void Loaded_native_engine_is_patched_and_has_the_selected_source_identity()
    {
        using var c = new SqliteConnection("Data Source=:memory:");
        c.Open();
        using var q = c.CreateCommand();
        q.CommandText = "SELECT sqlite_version(), sqlite_source_id()";
        using var r = q.ExecuteReader();
        Assert.True(r.Read());
        var version = r.GetString(0);
        var source = r.GetString(1);
        output.WriteLine($"Actually loaded SQLite {version}; source_id {source}");
        Assert.True(Version.Parse(version) >= new Version(3, 50, 2), $"GHSA-2m69-gcr7-jv3q: loaded {version}");
        Assert.Equal("3.53.3", version);
        Assert.Equal("2026-06-26 20:14:12 d4c0e51e4aeb96955b99185ab9cde75c339e2c29c3f3f12428d364a10d782c62", source);
    }

    [Fact]
    public void Pre_upgrade_database_preserves_schema_payload_retry_and_saved_crops_through_reopen_and_backup()
    {
        var fixture = Path.Combine(FixtureEnv.Fixtures, "sqlite", "outbox-3.49.1.db");
        var db = Collect.TempDb();
        var backup = db + ".backup";
        try
        {
            File.Copy(fixture, db);
            var schema = Schema(db);
            var result = Collect.LowConfidence();
            var clock = new Clock();
            var outbox = new UploadOutbox(db, clock);
            Assert.Equal(schema, Schema(db)); // no schema migration at dependency upgrade
            Assert.Equal(EnqueueResult.AlreadyQueued, outbox.EnqueueCapture(result));
            var rows = outbox.Snapshot();
            Assert.Equal(2, rows.Count);
            var retry = Assert.Single(rows, x => x.Kind == "crop");
            Assert.Equal(("/sparks/3/sparkId", 1, "HTTP 503", Collect.At.AddSeconds(2)),
                (retry.Path, retry.Attempts, retry.LastError, retry.NextAttemptAt));
            Assert.Null(outbox.Next()); // future crop still blocks the veteran
            clock.UtcNow = retry.NextAttemptAt;
            var crop = new UploadOutbox(db, clock).Next()!;
            Assert.Equal(result.Crops.Single(x => x.Path == crop.Path).Png, crop.Payload);
            var key = $"crops/{crop.CaptureId}/{Uri.EscapeDataString(crop.Path!)}.png";
            outbox.CompleteCrop(crop, key);
            var veteran = new UploadOutbox(db, clock).Next()!;
            Assert.Equal("veteran", veteran.Kind);
            Assert.Equal(CaptureJson.Serialize(result.Capture!), Encoding.UTF8.GetString(veteran.Payload));
            var attachedJson = Encoding.UTF8.GetString(outbox.AttachCropKeys(veteran));
            Assert.Empty(CaptureSchema.Validate(attachedJson));
            var attached = CaptureJson.Deserialize(attachedJson);
            Assert.Equal(result.Capture!.Fingerprint, attached.Fingerprint);
            Assert.Equal(System.Text.Json.JsonSerializer.Serialize(result.Capture.Veteran),
                System.Text.Json.JsonSerializer.Serialize(attached.Veteran));
            Assert.Equal(result.Capture.Fields.Select(x => (x.Path, x.Status, x.Confidence)),
                attached.Fields.Select(x => (x.Path, x.Status, x.Confidence)));
            Assert.All(attached.Fields.Where(x => x.Status == FieldStatus.low_confidence),
                x => Assert.Equal($"crops/{crop.CaptureId}/{Uri.EscapeDataString(x.Path)}.png", x.CropKey));
            outbox.CompleteVeteran(veteran, "01K7B33MXGVZV6TZRJZDHB99YF");
            var reopened = new UploadOutbox(db, clock);
            Assert.Empty(reopened.Snapshot());
            Assert.Equal(EnqueueResult.AlreadyUploaded, reopened.EnqueueCapture(result));
            using (var source = Open(db))
            using (var destination = Open(backup)) source.BackupDatabase(destination);
            var restored = new UploadOutbox(backup, clock);
            Assert.Empty(restored.Snapshot());
            Assert.Equal("01K7B33MXGVZV6TZRJZDHB99YF", restored.UploadedVeteranId(Collect.CaptureId));
            Assert.Equal(EnqueueResult.AlreadyUploaded, restored.EnqueueCapture(result));
            Assert.Equal(schema, Schema(backup));
        }
        finally { Collect.Drop(db); Collect.Drop(backup); }
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public void Failed_enqueue_rolls_back_capture_and_all_rows_before_reopen_and_retry(int insertion)
    {
        var db = Collect.TempDb();
        try
        {
            var clock = new Clock();
            var result = Collect.LowConfidence();
            var outbox = new UploadOutbox(db, clock)
            {
                AfterInsertForTesting = n => { if (n == insertion) throw new IOException("injected transaction failure"); }
            };
            Assert.Throws<IOException>(() => outbox.EnqueueCapture(result));
            var reopened = new UploadOutbox(db, clock);
            Assert.Empty(reopened.Snapshot());
            using (var c = Open(db))
            using (var q = c.CreateCommand())
            {
                q.CommandText = "SELECT COUNT(*) FROM captures";
                Assert.Equal(0L, q.ExecuteScalar());
            }
            Assert.Equal(EnqueueResult.Queued, reopened.EnqueueCapture(result));
            Assert.Equal(3, new UploadOutbox(db, clock).Snapshot().Count);
            Assert.Equal(EnqueueResult.AlreadyQueued, reopened.EnqueueCapture(result));
        }
        finally { Collect.Drop(db); }
    }

    [Fact]
    public void Failed_crop_acknowledgement_rolls_back_saved_key_and_keeps_unique_pending_row()
    {
        var db = Collect.TempDb();
        try
        {
            var clock = new Clock();
            var outbox = new UploadOutbox(db, clock);
            outbox.EnqueueCapture(Collect.LowConfidence());
            var crop = outbox.Next()!;
            var key = $"crops/{crop.CaptureId}/{Uri.EscapeDataString(crop.Path!)}.png";
            using (var c = Open(db))
            using (var q = c.CreateCommand())
            {
                q.CommandText = "CREATE TRIGGER fail_delete BEFORE DELETE ON outbox BEGIN SELECT RAISE(ABORT, 'injected failure'); END";
                q.ExecuteNonQuery();
            }
            Assert.Throws<SqliteException>(() => outbox.CompleteCrop(crop, key));
            var reopened = new UploadOutbox(db, clock);
            Assert.Equal(3, reopened.Snapshot().Count);
            Assert.Equal(crop.Id, reopened.Next()!.Id);
            Assert.Throws<SqliteException>(() => reopened.Enqueue(crop.CaptureId, "crop", crop.Payload, crop.Path));
            using (var c = Open(db))
            using (var q = c.CreateCommand())
            {
                q.CommandText = "SELECT COUNT(*) FROM crop_results";
                Assert.Equal(0L, q.ExecuteScalar());
                q.CommandText = "DROP TRIGGER fail_delete";
                q.ExecuteNonQuery();
            }
            reopened.CompleteCrop(crop, key);
            Assert.Equal(2, new UploadOutbox(db, clock).Snapshot().Count);
        }
        finally { Collect.Drop(db); }
    }

    private static SqliteConnection Open(string path)
    {
        var c = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString());
        c.Open();
        return c;
    }

    private static string Schema(string path)
    {
        using var c = Open(path);
        using var q = c.CreateCommand();
        q.CommandText = "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name";
        using var reader = q.ExecuteReader();
        var rows = new List<string>();
        while (reader.Read()) rows.Add(string.Join("|", Enumerable.Range(0, 4).Select(reader.GetValue)));
        return string.Join("\n", rows);
    }
}
