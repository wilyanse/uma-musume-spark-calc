using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Uma.Agent.Core;

namespace Uma.Agent.Windows.Shell;

public enum UploadBlock { None, NoAddress, NoToken, AuthRefused }
public interface IConfirm { bool Confirm(string title, string message); }

/// <summary>One serialized uploader, token rotation and dead-letter mutations. No response body/URI/exception message
/// is logged. Strict JSON acknowledgements and retries are delegated to the reviewed T09 client.</summary>
public sealed class UploadService : IAsyncDisposable
{
    private readonly UploadOutbox _outbox;
    private readonly Func<AgentSettings> _settings;
    private readonly ServiceTokenStore _tokens;
    private readonly Func<HttpMessageHandler> _handler;
    private readonly IShellLog _log;
    private readonly SemaphoreSlim _mutex = new(1, 1);
    private HttpClient? _http;
    private string? _address;
    public UploadBlock Block { get; private set; }
    public bool Uploading { get; private set; }
    public UploadService(UploadOutbox outbox, Func<AgentSettings> settings, ServiceTokenStore tokens, IClock clock, Func<HttpMessageHandler> handler, IShellLog log)
    { _outbox = outbox; _settings = settings; _tokens = tokens; _handler = handler; _log = log; }
    public static HttpMessageHandler DefaultHandler() => UploadClient.CreateHandler();
    public OutboxHealth Health() => _outbox.Health();
    public IReadOnlyList<OutboxItem> DeadItems() => _outbox.Snapshot().Where(i => i.Dead).ToArray();
    public async Task<UploadAttempt?> PumpOnceAsync(CancellationToken ct)
    {
        await _mutex.WaitAsync(ct);
        try
        {
            if (!ApiAddress.TryParse(_settings().ApiBaseUrl, out var uri, out _)) { Block = UploadBlock.NoAddress; return null; }
            if (!_tokens.HasToken) { Block = UploadBlock.NoToken; return null; }
            if (_http is null || _address != uri!.AbsoluteUri)
            {
                _http?.Dispose(); _http = new HttpClient(_handler(), disposeHandler: true) { Timeout = TimeSpan.FromSeconds(30) };
                _address = uri!.AbsoluteUri;
            }
            Uploading = _outbox.Next() is not null;
            var attempt = await new UploadClient(_http, uri!, _tokens, _outbox).SendAsync(ct);
            Block = _outbox.Health().AuthRequired ? UploadBlock.AuthRefused : UploadBlock.None;
            if (attempt.Outcome != UploadOutcome.Idle) _log.Info("Upload " + attempt.Outcome + (attempt.Error is null ? "" : ": " + attempt.Error));
            return attempt;
        }
        finally { Uploading = false; _mutex.Release(); }
    }
    public async Task<int> DrainAsync(CancellationToken ct)
    {
        var count = 0;
        while (true)
        {
            var a = await PumpOnceAsync(ct);
            if (a is null || a.Outcome != UploadOutcome.Uploaded) return count;
            count++;
        }
    }
    public async Task SaveTokenAndRetryAsync(string clientId, string clientSecret)
    {
        await _mutex.WaitAsync();
        try { _tokens.Save(clientId, clientSecret); _outbox.RetryAuthNow(); Block = UploadBlock.None; }
        finally { _mutex.Release(); }
    }
    public async Task<bool> RequeueAsync(long id, IConfirm confirm)
    {
        var item = DeadItems().FirstOrDefault(i => i.Id == id);
        if (item is null || !confirm.Confirm("Retry rejected item?", $"Requeue {item.Kind} row {id} for capture {item.CaptureId}? The API may reject it again.")) return false;
        await _mutex.WaitAsync();
        try { return _outbox.Requeue(id); }
        finally { _mutex.Release(); }
    }
    public async Task<int> DiscardAsync(long id, IConfirm confirm)
    {
        var item = DeadItems().FirstOrDefault(i => i.Id == id);
        if (item is null) return 0;
        var count = _outbox.Snapshot().Count(i => i.CaptureId == item.CaptureId);
        if (!confirm.Confirm("Discard entire capture?", $"Remove all {count} queued item(s) for capture {item.CaptureId}, including its crops and veteran? This cannot be undone; recapture it afterward.")) return 0;
        await _mutex.WaitAsync();
        try { return _outbox.Discard(id); }
        finally { _mutex.Release(); }
    }
    public async Task RunAsync(Func<TimeSpan, CancellationToken, Task> delay, CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                try { await PumpOnceAsync(ct); }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
                catch (Exception e) { _log.Error("Upload loop failed: " + e.GetType().Name); }
                await delay(TimeSpan.FromMilliseconds(250), ct);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
    }
    public async ValueTask DisposeAsync()
    {
        await _mutex.WaitAsync();
        try { _http?.Dispose(); _http = null; }
        finally { _mutex.Release(); }
    }
}
