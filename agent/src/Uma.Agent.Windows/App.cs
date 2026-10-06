using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Serilog;
using Uma.Agent.Core;
using Uma.Agent.Windows.Native;
using Uma.Agent.Windows.Shell;
using Forms = System.Windows.Forms;

namespace Uma.Agent.Windows;

public sealed class ShellLog : IShellLog
{
    public void Info(string message) => Log.Information("{Category}", message);
    public void Warn(string message) => Log.Warning("{Category}", message);
    public void Error(string message) => Log.Error("{Category}", message);
}
public sealed class UiConfirm : IConfirm
{
    public bool Confirm(string title, string message) => MessageBox.Show(message, title, MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No) == MessageBoxResult.Yes;
}
public sealed class App : Application
{
    private readonly CancellationTokenSource _lifetime = new();
    private readonly SemaphoreSlim _transition = new(1, 1);
    private readonly AgentPaths _paths = AgentPaths.ForCurrentUser();
    private readonly ShellLog _log = new();
    private AgentSettings _settings = new("", "UmamusumePrettyDerby", "");
    private SettingsStore _settingsStore = null!;
    private ServiceTokenStore _tokens = null!;
    private AgentData _data = null!;
    private UploadOutbox _outbox = null!;
    private UploadService _uploader = null!;
    private Task? _uploadTask, _watchTask;
    private CancellationTokenSource? _watchCancel;
    private CapturePipeline? _pipeline;
    private Forms.NotifyIcon? _tray;
    private Forms.ToolStripMenuItem? _start, _stop;
    private DispatcherTimer? _timer;
    private Window? _statusWindow;
    private TextBlock? _statusText;
    private string? _error;   // UI-operation failures; capture-source errors live in _capture (T10 r3 S1)
    private readonly CaptureStatusModel _capture = new();
    private CaptureNoticeStatus _captureNotices => _capture.Notices;
    private CardSyncController _cards = null!;
    private CardSyncWindow? _cardWindow;
    private string _notice = "Ready. Configure Settings before uploading.";
    private bool _exiting, _busy;
    private TrayStatus? _status;
    private readonly SystemClock _clock = new();
    private readonly UiConfirm _confirm = new();

    [STAThread]
    public static int Main(string[] args)
    {
        using var instance = new Mutex(true, "Local\\UmaSparkCalc-WindowsShell", out var owner);
        if (!owner) { MessageBox.Show("Uma Spark Calc is already running for this Windows session."); return 2; }
        var app = new App { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        app.InstallUnhandledHandlers();
        app.Startup += async (_, _) => await app.StartupAsync(args);
        return app.Run();
    }
    /// <summary>Review N6: last-chance handlers log the exception category only (never its message, which may hold
    /// paths or server text). UI-thread exceptions are marked handled and shown as a typed/category message so the
    /// tray stays usable; background and fatal ones are logged before the runtime proceeds.</summary>
    private void InstallUnhandledHandlers()
    {
        DispatcherUnhandledException += (_, e) =>
        {
            _log.Error("Unhandled UI exception: " + e.Exception.GetType().Name);
            _error = UserMessages.For(e.Exception);
            e.Handled = true;
        };
        TaskScheduler.UnobservedTaskException += (_, e) => { _log.Error("Unobserved task exception: " + (e.Exception.InnerException ?? e.Exception).GetType().Name); e.SetObserved(); };
        AppDomain.CurrentDomain.UnhandledException += (_, e) => { _log.Error("Fatal exception: " + (e.ExceptionObject?.GetType().Name ?? "unknown")); Log.CloseAndFlush(); };
    }
    private static string ContentRoot()
    {
        // IncludeAllContentForSelfExtract extracts this assembly AND data into the same directory.
#pragma warning disable IL3000
        return Path.GetDirectoryName(typeof(App).Assembly.Location) ?? AppContext.BaseDirectory;
#pragma warning restore IL3000
    }
    private async Task StartupAsync(string[] args)
    {
        try
        {
            Directory.CreateDirectory(_paths.Root); Directory.CreateDirectory(_paths.Logs);
            Log.Logger = new LoggerConfiguration().WriteTo.File(Path.Combine(_paths.Logs, "agent-.log"), rollingInterval: RollingInterval.Day, retainedFileCountLimit: 7).CreateLogger();
            var options = CommandLineOptions.Parse(args);
            if (options.Mode == AgentMode.Help) { MessageBox.Show(CommandLineOptions.Usage, "Uma Spark Calc CLI"); Shutdown(0); return; }
            var root = ContentRoot(); _data = AgentData.LoadBundled(root);
            if (options.Mode == AgentMode.RecordOcr)
            {
                var files = options.ExpandInputs();
                if (files.Count == 0) throw new ShellValidationException("No PNG inputs found.");
                await Task.Run(async () =>
                {
                    using var ocr = new WindowsOcrEngine();
                    var recorder = new OcrRecorder(ocr, OcrRecorder.WindowsEngineName(ocr.LanguageTag), _data.Layout);
                    foreach (var file in files) await recorder.RecordAsync(file, options.OutputDirectory!, options.Overwrite);
                });
                MessageBox.Show($"Recorded actual Windows OCR for {files.Count} PNG(s) in {options.OutputDirectory}", "OCR recording complete");
                Shutdown(0); return;
            }
            _settingsStore = new(_paths.Settings, Path.Combine(root, "appsettings.json"), _clock); _settings = _settingsStore.Load();
            if (_settingsStore.Notice is not null) { _log.Warn("Malformed settings file backed up; defaults loaded"); _notice = _settingsStore.Notice; }
            _tokens = new(_paths.ServiceToken, new DpapiProtector());
            _outbox = new(_paths.Outbox, _clock);
            // This factory calls the reviewed Core handler explicitly; automatic redirects stay disabled.
            _uploader = new(_outbox, () => Volatile.Read(ref _settings), _tokens, UploadService.DefaultHandler, _log);
            _uploadTask = Task.Run(() => _uploader.RunAsync(Task.Delay, _lifetime.Token));
            // Support cards (T10b): in-memory only, explicit sends through the reviewed Core coordinator.
            _cards = new(_data, _clock, () => Volatile.Read(ref _settings), _tokens, UploadService.DefaultHandler, _confirm, _log);
            BuildTray();
            _timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
            _timer.Tick += (_, _) => Refresh(); _timer.Start(); Refresh(); ShowStatus();
            if (_settingsStore.Notice is not null) MessageBox.Show(_settingsStore.Notice, "Settings reset", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        catch (Exception e)
        {
            _log.Error("Startup failed: " + e.GetType().Name);
            // Only known local/validation messages shown; never an HTTP exception/body.
            MessageBox.Show(UserMessages.For(e), "Uma Spark Calc", MessageBoxButton.OK, MessageBoxImage.Error);
            Log.CloseAndFlush(); Shutdown(1);
        }
    }
    private void BuildTray()
    {
        var menu = new Forms.ContextMenuStrip();
        void Add(string title, Func<Task> action) { var item = menu.Items.Add(title); item.Click += async (_, _) => await Dispatch(action); }
        _start = new Forms.ToolStripMenuItem("Start watching"); _start.Click += async (_, _) => await Dispatch(StartWatching); menu.Items.Add(_start);
        _stop = new Forms.ToolStripMenuItem("Stop / save complete captures"); _stop.Click += async (_, _) => await Dispatch(StopWatching); menu.Items.Add(_stop);
        Add("Acknowledge released-collection warning", () => { _captureNotices.AcknowledgeReleased(); return Task.CompletedTask; });
        Add("Checklist / status", () => { ShowStatus(); return Task.CompletedTask; });
        Add("Capture support cards", () => { ShowCards(); return Task.CompletedTask; });
        Add("Open web app", () => { OpenWeb(); return Task.CompletedTask; });
        Add("Settings", Settings);
        Add("Review rejected uploads", Rejected);
        Add("Record OCR fixture (dev)", RecordLive);
        Add("Exit", ExitAsync);
        _tray = new Forms.NotifyIcon { Icon = SystemIcons.Application, Visible = true, ContextMenuStrip = menu, Text = "Uma Spark Calc" };
        _tray.DoubleClick += (_, _) => ShowStatus();
    }
    private async Task Dispatch(Func<Task> action)
    {
        if (_busy || _exiting) return;
        _busy = true;
        try { await action(); }
        catch (Exception e) { _error = UserMessages.For(e); _log.Error("UI operation failed: " + e.GetType().Name); }
        finally { _busy = false; if (!_exiting) Refresh(); }
    }
    private async Task StartWatching()
    {
        await _transition.WaitAsync();
        try
        {
            if (_watchTask is not null) return;
            if (_pipeline is not null)
            {
                var flushed = _pipeline.Flush();
                foreach (var e in flushed) _captureNotices.Apply(e);
                var q = DropGuard.Check(flushed, DropGuard.Action.Start);
                if (q is { Refuse: true }) { _error = q.Message; return; }
                if (q is not null && !_confirm.Confirm(q.Title, q.Message)) return;
                _pipeline = null;   // release the previous collection's evidence before the new watch starts
            }
            if (!_captureNotices.StartFresh()) return;
            _error = null; _capture.ClearTransient(); _progress = null; _watchCancel = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
            var ct = _watchCancel.Token;
            // Create/own native resources within the worker; Stop joins it before Flush or any resource disposal.
            _watchTask = Task.Run(async () =>
            {
                try
                {
                    using var ocr = new WindowsOcrEngine { Cancellation = ct };
                    await using var source = new WgcFrameSource(() => Volatile.Read(ref _settings), _log);
                    _pipeline = new(_data, ocr, _outbox, _clock, UlidGenerator.System(_clock), "0.1.0", new FrameGate(_clock, TimeSpan.FromSeconds(2)), _log, _cards);
                    await new WatchLoop(source, async (frame, cancellation) =>
                    {
                        var e = await _pipeline.ProcessAsync(frame, cancellation);
                        var progress = _pipeline.Progress;
                        await Dispatcher.InvokeAsync(() => { _capture.Apply(e); _progress = progress; });
                    }, message => Dispatcher.BeginInvoke(new Action(() => _capture.ReportCaptureError(message))), Task.Delay).RunAsync(ct);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
                catch (Exception e) { _log.Error("Watcher failed: " + e.GetType().Name); await Dispatcher.InvokeAsync(() => _capture.ReportCaptureError(e is CaptureUnavailableException ? e.Message : "Capture device failed. Stop and Start to retry.")); }
            });
        }
        finally { _transition.Release(); }
    }
    private SessionProgress? _progress;
    private async Task<IReadOnlyList<PipelineEvent>> StopWatching()
    {
        IReadOnlyList<PipelineEvent> flushed = [];
        await _transition.WaitAsync();
        try
        {
            _watchCancel?.Cancel();
            if (_watchTask is not null) await _watchTask;
            _watchTask = null; _watchCancel?.Dispose(); _watchCancel = null;
            _error = null; _capture.ClearTransient();
            if (_pipeline is not null)
            {
                flushed = _pipeline.Flush();
                foreach (var e in flushed) _captureNotices.Apply(e);
                _progress = _pipeline.Progress;
                _notice = "Watching stopped; see collection notices/checklist below. Queued captures remain in the durable outbox.";
                if (flushed.Any(e => e.Kind == PipelineEventKind.Failed)) _error = flushed.First(e => e.Kind == PipelineEventKind.Failed).Message;
            }
        }
        finally { _transition.Release(); }
        return flushed;
    }
    private void Refresh()
    {
        try
        {
            _status = TrayStatus.Compute(_watchTask is not null && !_watchTask.IsCompleted, _progress, _capture.Error ?? _error, _uploader.CachedHealth, _uploader.Block, _uploader.Uploading);
            if (_tray is not null) { _tray.Text = _status.Tooltip; _tray.Icon = _status.State == TrayState.Error ? SystemIcons.Error : SystemIcons.Application; }
            if (_start is not null) _start.Enabled = _watchTask is null && !_busy;
            if (_stop is not null) _stop.Enabled = !_busy && (_watchTask is not null || _pipeline is not null);
            _cardWindow?.Refresh(_watchTask is not null && !_watchTask.IsCompleted);
            if (_statusText is not null) _statusText.Text = _status.Title + "\n\n" + _status.Detail + "\n\n" + _notice + "\n" + _captureNotices.Message + "\n\n" + string.Join("\n", (_progress?.Checklist ?? []).Select(s => (s.Complete ? "✓ " : "○ ") + s.Section + ": " + s.Detail));
        }
        catch (Exception e) { _log.Error("Status failed: " + e.GetType().Name); }
    }
    private void ShowStatus()
    {
        if (_statusWindow is not null) { _statusWindow.Show(); _statusWindow.Activate(); return; }
        _statusText = new TextBlock { Margin = new Thickness(16), TextWrapping = TextWrapping.Wrap };
        _statusWindow = new Window { Title = "Uma Spark Calc — assisted capture", Width = 650, Height = 470, Content = new ScrollViewer { Content = _statusText } };
        _statusWindow.Closed += (_, _) => { _statusWindow = null; _statusText = null; }; Refresh(); _statusWindow.Show();
    }
    private void ShowCards()
    {
        if (_cardWindow is not null) { _cardWindow.Show(); _cardWindow.Activate(); return; }
        _cardWindow = new CardSyncWindow(_cards, _confirm, _log);
        _cardWindow.Closed += (_, _) => _cardWindow = null;
        _cardWindow.Refresh(_watchTask is not null && !_watchTask.IsCompleted);
        _cardWindow.Show();
    }
    private void OpenWeb()
    {
        if (!ApiAddress.TryParse(_settings.ApiBaseUrl, out var uri, out var error)) { MessageBox.Show(error); return; }
        Process.Start(new ProcessStartInfo(uri!.AbsoluteUri) { UseShellExecute = true });
    }
    private async Task Settings()
    {
        var dialog = new SettingsWindow(_settings, _tokens.HasToken);
        try
        {
        if (dialog.ShowDialog() != true) return;
        if (ApiAddress.Changes(_settings.ApiBaseUrl, dialog.Result!.ApiBaseUrl) && _outbox.Health().Pending > 0 && !_confirm.Confirm("Change upload destination?", "Existing pending captures will be sent to the new HTTPS address. Confirm this is your own configured API.")) return;
        // Join watcher before changing target. Pending upload mutation is serialized by UploadService.
        await StopWatching();
        _settingsStore.Save(dialog.Result); Volatile.Write(ref _settings, _settingsStore.Load());
        if (dialog.NewId.Length > 0 || dialog.NewSecret.Length > 0) await _uploader.SaveTokenAndRetryAsync(dialog.NewId, dialog.NewSecret);
        _notice = "Settings saved. Start watching to resume capture.";
        }
        finally { dialog.ClearSecrets(); }
    }
    private async Task Rejected()
    {
        var dialog = new RejectedWindow(_uploader.DeadItems());
        if (dialog.ShowDialog() != true) return;
        if (dialog.Discard) await _uploader.DiscardAsync(dialog.SelectedId, _confirm);
        else await _uploader.RequeueAsync(dialog.SelectedId, _confirm);
    }
    private async Task RecordLive()
    {
        if (!_confirm.Confirm("Record current game frame?", "Stop watching and record actual Windows OCR for the current client area? Local dev recordings may include guest trainer names. Nothing is uploaded or written to committed fixtures.")) return;
        await StopWatching();
        var dir = Path.Combine(_paths.Recordings, DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmss-fffffff"));
        await Task.Run(async () =>
        {
            await using var source = new WgcFrameSource(() => Volatile.Read(ref _settings), _log);
            var frame = Frames.Normalize(await source.NextAsync(_lifetime.Token));
            using var ocr = new WindowsOcrEngine { Cancellation = _lifetime.Token };
            var classification = await new ScreenClassifier(_data.Layout, ocr).ClassifyAsync(frame);
            var recorder = new OcrRecorder(ocr, OcrRecorder.WindowsEngineName(ocr.LanguageTag), _data.Layout);
            await recorder.RecordFrameAsync(frame, "live", dir, false, RoiPlan.ForScreen(classification.Id, _data.Layout));
        });
        MessageBox.Show("Actual Windows OCR recorded in " + dir);
    }
    private async Task ExitAsync()
    {
        // Same drop rules as Start (review S4): an unsaved complete capture or an incomplete collection asks first.
        var q = DropGuard.Check(await StopWatching(), DropGuard.Action.Exit);
        if (q is not null && !_confirm.Confirm(q.Title, q.Message)) return;
        // Support-card scans are in memory only (Q-152): ask before dropping unsynced cards or leaving a send.
        var cards = _cards.ExitQuestion();
        if (cards is not null && !_confirm.Confirm(cards.Title, cards.Message)) return;
        _exiting = true; _timer?.Stop(); _cardWindow?.Close();
        await _cards.ShutdownAsync();
        _lifetime.Cancel();
        if (_uploadTask is not null) await _uploadTask;
        await _uploader.DisposeAsync();
        _tray?.Dispose(); _statusWindow?.Close();
        _log.Info("Agent stopped"); Log.CloseAndFlush(); Shutdown(0);
    }
}
