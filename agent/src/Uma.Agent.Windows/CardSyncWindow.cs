using System;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Uma.Agent.Windows.Shell;

namespace Uma.Agent.Windows;

/// <summary>Thin WPF view over <see cref="CardSyncController"/> (T10b). Every action passes the exact
/// <see cref="CardScanView"/> that was on screen when the user clicked; the controller refuses it if the scan or
/// revision changed. All rules (eligibility, destructive confirmation, stale refusal, single in-flight send) live in the
/// portable controller and are tested there.</summary>
public sealed class CardSyncWindow : Window
{
    private readonly CardSyncController _cards;
    private readonly IShellLog _log;
    private readonly TextBlock _text = new() { TextWrapping = TextWrapping.Wrap };
    private readonly TextBlock _warning = new()
    {
        TextWrapping = TextWrapping.Wrap, FontWeight = FontWeights.Bold, Foreground = Brushes.White, Background = Brushes.DarkRed,
        Padding = new Thickness(8), Margin = new Thickness(0, 0, 0, 8),
        Text = "WARNING: every sync REPLACES the entire owned-card list in the web app. A PARTIAL sync deletes every stored card that is not in this scan. Partial sync always asks for explicit confirmation.",
    };
    private readonly ListBox _pending = new() { MaxHeight = 160 };
    private readonly Button _full, _partial, _select, _reset, _cancel, _start;
    private CardScanView? _shown;
    private CardSendResult? _last;
    private bool _watching;

    private readonly IConfirm _confirm;
    private static readonly CardSendResult ChangedWhileAsking = new(CardSendStatus.Stale, "The scan changed while you were deciding (for example, more cards were collected). Nothing was dropped; review the current scan and choose again.");

    public CardSyncWindow(CardSyncController cards, IConfirm confirm, IShellLog log)
    {
        _cards = cards; _confirm = confirm; _log = log;
        Title = "Uma Spark Calc — support cards"; Width = 760; Height = 620;
        var panel = new DockPanel { Margin = new Thickness(16) }; Content = panel;
        DockPanel.SetDock(_warning, Dock.Top); panel.Children.Add(_warning);
        var actions = new WrapPanel(); DockPanel.SetDock(actions, Dock.Bottom); panel.Children.Add(actions);
        Button Add(string label, Func<Task> action)
        {
            var b = new Button { Content = label, Margin = new Thickness(4), Padding = new Thickness(8, 4, 8, 4) };
            b.Click += async (_, _) => await Run(action);
            actions.Children.Add(b); return b;
        }
        // S1: each drop question is asked for the exact view on screen at the click, and the controller only accepts
        // that scan AND revision. If cards arrived while the question was open, nothing is dropped and the user is told.
        _start = Add("Start new scan", () =>
        {
            var v = _cards.View;
            var q = _cards.ReplaceQuestion(v);
            if (q is not null && !_confirm.Confirm(q.Title, q.Message)) return Task.CompletedTask;
            if (_cards.BeginScanReplacing(v) is { } started) { _shown = started; _last = null; }
            else _last = ChangedWhileAsking;
            return Task.CompletedTask;
        });
        _select = Add("Select pending tile, then open it in game", () =>
        {
            if (_shown is not null && _pending.SelectedItem is ListBoxItem { Tag: string id } && !_cards.SelectPending(_shown, id))
                _last = new(CardSendStatus.Stale, "That tile is no longer pending or the scan changed; nothing selected.");
            return Task.CompletedTask;
        });
        _full = Add("Send full sync…", async () => { if (_shown is { } v) _last = await _cards.SendFullAsync(v); });
        _partial = Add("Send PARTIAL sync (replaces entire list)…", async () => { if (_shown is { } v) _last = await _cards.SendPartialAsync(v); });
        _reset = Add("Reset scan", () =>
        {
            if (_cards.View is not { } v) return Task.CompletedTask;
            var q = _cards.ReplaceQuestion(v);
            if (q is not null && !_confirm.Confirm(q.Title, q.Message)) return Task.CompletedTask;
            if (_cards.Reset(v) is { } reset) _shown = reset; else _last = ChangedWhileAsking;
            return Task.CompletedTask;
        });
        _cancel = Add("Cancel scan", () =>
        {
            if (_cards.View is not { } v) return Task.CompletedTask;
            var q = _cards.ReplaceQuestion(v);
            if (q is not null && !_confirm.Confirm(q.Title, q.Message)) return Task.CompletedTask;
            if (!_cards.Cancel(v)) _last = ChangedWhileAsking;
            return Task.CompletedTask;
        });
        var close = new Button { Content = "Close (scan stays in memory)", Margin = new Thickness(4), IsCancel = true };
        close.Click += (_, _) => Close(); actions.Children.Add(close);
        var body = new StackPanel();
        body.Children.Add(_text);
        body.Children.Add(new TextBlock { Text = "Pending tiles:", Margin = new Thickness(0, 8, 0, 2) });
        body.Children.Add(_pending);
        panel.Children.Add(new ScrollViewer { Content = body });
    }

    private async Task Run(Func<Task> action)
    {
        try { await action(); }
        catch (Exception e) { _log.Error("Support-card action failed: " + e.GetType().Name); _last = new(CardSendStatus.Failed, UserMessages.For(e)); }
        Refresh(_watching);
    }

    /// <summary>Called by the tray refresh timer. Keeps the shown snapshot until it is replaced, so a click always
    /// refers to what was displayed, and the controller can refuse it if it went stale meanwhile.</summary>
    public void Refresh(bool watching)
    {
        _watching = watching;
        var view = _cards.View;
        _shown = view;
        _text.Text = CardSyncText.Describe(view, watching, _last, _cards.RemoteUnknown);
        var selected = (_pending.SelectedItem as ListBoxItem)?.Tag as string;
        _pending.Items.Clear();
        foreach (var p in view?.State.Pending ?? [])
        {
            var item = new ListBoxItem { Content = $"{p.Id} • LB {p.Lb} • Lvl {(p.Level?.ToString() ?? "?")} • {string.Join(", ", p.Candidates.Select(c => c.Value))}", Tag = p.Id };
            _pending.Items.Add(item);
            if (p.Id == selected) item.IsSelected = true;
        }
        var busy = (view?.Sending ?? _cards.Sending) || _cards.SendsHeld;
        _full.IsEnabled = !busy && view is { State.CanSendFull: true };
        _partial.IsEnabled = !busy && view is { State: { CanSendFull: false, PartialConfirmation: not null } };
        _select.IsEnabled = !busy && view is { State.Pending.Count: > 0 };
        _reset.IsEnabled = _cancel.IsEnabled = !busy && view is not null;
        _start.IsEnabled = !busy;
    }
}
