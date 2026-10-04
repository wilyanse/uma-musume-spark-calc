using System;
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
    private string? _error;
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
        app.Startup += async (_, _) => await app.StartupAsync(args);
        return app.Run();
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
                if (files.Count == 0) throw new ArgumentException("No PNG inputs found.");
                await Task.Run(async () =>
                {
                    using var ocr = new WindowsOcrEngine();
                    var recorder = new OcrRecorder(ocr, OcrRecorder.WindowsEngineName(ocr.LanguageTag), _data.Layout);
                    foreach (var file in files) await recorder.RecordAsync(file, options.OutputDirectory!, options.Overwrite);
                });
                MessageBox.Show($"Recorded actual Windows OCR for {files.Count} PNG(s) in {options.OutputDirectory}", "OCR recording complete");
                Shutdown(0); return;
            }
            _settingsStore = new(_paths.Settings, Path.Combine(root, "appsettings.json")); _settings = _settingsStore.Load();
            _tokens = new(_paths.ServiceToken, new DpapiProtector());
            _outbox = new(_paths.Outbox, _clock);
            // This factory calls the reviewed Core handler explicitly; automatic redirects stay disabled.
            _uploader = new(_outbox, () => Volatile.Read(ref _settings), _tokens, _clock, UploadService.DefaultHandler, _log);
            _uploadTask = Task.Run(() => _uploader.RunAsync(Task.Delay, _lifetime.Token));
            BuildTray();
            _timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
            _timer.Tick += (_, _) => Refresh(); _timer.Start(); Refresh(); ShowStatus();
        }
        catch (Exception e)
        {
            _log.Error("Startup failed: " + e.GetType().Name);
            // Only known local/validation messages shown; never an HTTP exception/body.
            MessageBox.Show(e is CaptureUnavailableException or ArgumentException or IOException ? e.Message : "Unable to start. Check the bundled data, local file permissions and English Windows OCR. See local logs for the error category.", "Uma Spark Calc", MessageBoxButton.OK, MessageBoxImage.Error);
            Log.CloseAndFlush(); Shutdown(1);
        }
    }
    private void BuildTray()
    {
        var menu = new Forms.ContextMenuStrip();
        void Add(string title, Func<Task> action) { var item = menu.Items.Add(title); item.Click += async (_, _) => await Dispatch(action); }
        _start = new Forms.ToolStripMenuItem("Start watching"); _start.Click += async (_, _) => await Dispatch(StartWatching); menu.Items.Add(_start);
        _stop = new Forms.ToolStripMenuItem("Stop / save complete captures"); _stop.Click += async (_, _) => await Dispatch(StopWatching); menu.Items.Add(_stop);
        Add("Checklist / status", () => { ShowStatus(); return Task.CompletedTask; });
        Add("Capture support cards", () => { MessageBox.Show(new SupportCardsUnavailable().Message, "Support cards"); return Task.CompletedTask; });
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
        catch (Exception e) { _error = "Local operation failed; check file permissions or restart capture. Category: " + e.GetType().Name; _log.Error("UI operation failed: " + e.GetType().Name); }
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
                if (flushed.Any(e => e.Kind == PipelineEventKind.Failed)) { _error = flushed.First(e => e.Kind == PipelineEventKind.Failed).Message; return; }
                if (flushed.Any(e => e.Kind == PipelineEventKind.NotUploadable) && !_confirm.Confirm("Start a fresh collection?", "The stopped collection is incomplete and was NOT uploaded. Starting again drops only in-memory incomplete evidence; persisted outbox items stay unchanged.")) return;
            }
            _error = null; _watchCancel = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
            var ct = _watchCancel.Token;
            // Create/own native resources within the worker; Stop joins it before Flush or any resource disposal.
            _watchTask = Task.Run(async () =>
            {
                try
                {
                    using var ocr = new WindowsOcrEngine { Cancellation = ct };
                    await using var source = new WgcFrameSource(() => Volatile.Read(ref _settings));
                    _pipeline = new(_data, ocr, _outbox, _clock, UlidGenerator.System(_clock), "0.1.0", new FrameGate(_clock, TimeSpan.FromSeconds(2)), _log);
                    await new WatchLoop(source, async (frame, cancellation) =>
                    {
                        var e = await _pipeline.ProcessAsync(frame, cancellation);
                        var progress = _pipeline.Progress;
                        await Dispatcher.InvokeAsync(() => { _notice = e.Message; _error = e.Kind is PipelineEventKind.Unsupported or PipelineEventKind.Failed ? e.Message : null; _progress = progress; });
                    }, message => Dispatcher.BeginInvoke(new Action(() => _error = message)), Task.Delay).RunAsync(ct);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
                catch (Exception e) { _log.Error("Watcher failed: " + e.GetType().Name); await Dispatcher.InvokeAsync(() => _error = e is CaptureUnavailableException ? e.Message : "Capture device failed. Stop and Start to retry."); }
            });
        }
        finally { _transition.Release(); }
    }
    private SessionProgress? _progress;
    private async Task StopWatching()
    {
        await _transition.WaitAsync();
        try
        {
            _watchCancel?.Cancel();
            if (_watchTask is not null) await _watchTask;
            _watchTask = null; _watchCancel?.Dispose(); _watchCancel = null;
            _error = null;
            if (_pipeline is not null)
            {
                var flushed = _pipeline.Flush();
                _notice = flushed.Count > 0 ? string.Join("\n", flushed.Select(e => e.Message)) : "Watching stopped; queued captures remain in the durable outbox.";
                if (flushed.Any(e => e.Kind == PipelineEventKind.Failed)) _error = flushed.First(e => e.Kind == PipelineEventKind.Failed).Message;
            }
        }
        finally { _transition.Release(); }
    }
    private void Refresh()
    {
        try
        {
            _status = TrayStatus.Compute(_watchTask is not null && !_watchTask.IsCompleted, _progress, _error, _uploader.Health(), _uploader.Block, _uploader.Uploading);
            if (_tray is not null) { _tray.Text = _status.Tooltip; _tray.Icon = _status.State == TrayState.Error ? SystemIcons.Error : SystemIcons.Application; }
            if (_start is not null) _start.Enabled = _watchTask is null && !_busy;
            if (_stop is not null) _stop.Enabled = !_busy && (_watchTask is not null || _pipeline is not null);
            if (_statusText is not null) _statusText.Text = _status.Title + "\n\n" + _status.Detail + "\n\n" + _notice + "\n\n" + string.Join("\n", (_progress?.Checklist ?? []).Select(s => (s.Complete ? "✓ " : "○ ") + s.Section + ": " + s.Detail));
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
        if (_settings.ApiBaseUrl != dialog.Result!.ApiBaseUrl && _outbox.Health().Pending > 0 && !_confirm.Confirm("Change upload destination?", "Existing pending captures will be sent to the new HTTPS address. Confirm this is your own configured API.")) return;
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
            await using var source = new WgcFrameSource(() => _settings);
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
        await StopWatching();
        if (_error is not null && !_confirm.Confirm("Exit without saving?", _error + "\nExit would lose this unsaved in-memory collection. The persisted outbox remains intact.")) return;
        _exiting = true; _timer?.Stop(); _lifetime.Cancel();
        if (_uploadTask is not null) await _uploadTask;
        await _uploader.DisposeAsync();
        _tray?.Dispose(); _statusWindow?.Close();
        _log.Info("Agent stopped"); Log.CloseAndFlush(); Shutdown(0);
    }
}
