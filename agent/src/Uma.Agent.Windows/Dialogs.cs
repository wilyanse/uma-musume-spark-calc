using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using Uma.Agent.Core;
using Uma.Agent.Windows.Shell;

namespace Uma.Agent.Windows;
public sealed class SettingsWindow : Window
{
    private readonly TextBox _url, _process, _title;
    // ID as well as secret is masked; neither is loaded into the dialog from disk.
    private readonly PasswordBox _id = new(), _secret = new();
    public AgentSettings? Result { get; private set; }
    public string NewId => _id.Password;
    public string NewSecret => _secret.Password;
    public SettingsWindow(AgentSettings settings, bool hasToken)
    {
        Title = "Uma Spark Calc Settings"; Width = 580; SizeToContent = SizeToContent.Height;
        var panel = new StackPanel { Margin = new Thickness(18) };
        Content = panel;
        panel.Children.Add(new TextBlock { Text = "HTTPS API base address (your deployed site; blank pauses uploads). No default endpoint is guessed.", TextWrapping = TextWrapping.Wrap });
        _url = Field(panel, settings.ApiBaseUrl);
        panel.Children.Add(new TextBlock { Text = "Game process name (without .exe)" }); _process = Field(panel, settings.ProcessName);
        panel.Children.Add(new TextBlock { Text = "Optional window-title fallback (unique substring)" }); _title = Field(panel, settings.WindowTitleContains);
        panel.Children.Add(new TextBlock { Text = hasToken ? "A token is saved with DPAPI CurrentUser. Leave BOTH fields blank to keep it." : "No usable service token saved. Enter the Cloudflare Access service token below.", TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0,12,0,8) });
        panel.Children.Add(new TextBlock { Text = "CF-Access-Client-Id" }); panel.Children.Add(_id);
        panel.Children.Add(new TextBlock { Text = "CF-Access-Client-Secret" }); panel.Children.Add(_secret);
        var save = new Button { Content = "Save / Retry authentication now", Margin = new Thickness(0,16,0,4), IsDefault = true };
        save.Click += (_, _) =>
        {
            if (!string.IsNullOrWhiteSpace(_url.Text) && !ApiAddress.TryParse(_url.Text, out _, out var error)) { MessageBox.Show(error); return; }
            if (string.IsNullOrWhiteSpace(_process.Text)) { MessageBox.Show("Set the game process name."); return; }
            if ((_id.Password.Length == 0) != (_secret.Password.Length == 0)) { MessageBox.Show("Enter both token fields or leave both blank to keep the saved token."); return; }
            // Same rule as ServiceTokenStore (review N3): refuse here with a typed message instead of a generic failure.
            if (_id.Password.Any(char.IsControl) || _secret.Password.Any(char.IsControl)) { MessageBox.Show("The client ID and secret must be single-line values without control characters (no tabs or line breaks)."); return; }
            Result = new(_url.Text.Trim(), _process.Text.Trim(), _title.Text.Trim()); DialogResult = true;
        };
        panel.Children.Add(save);
        var cancel = new Button { Content = "Cancel", IsCancel = true }; panel.Children.Add(cancel);
        Closed += (_, _) => { if (DialogResult != true) ClearSecrets(); };
    }
    private static TextBox Field(StackPanel panel, string value)
    {
        var field = new TextBox { Text = value, Margin = new Thickness(0,4,0,10) }; panel.Children.Add(field); return field;
    }
    public void ClearSecrets() { _id.Clear(); _secret.Clear(); }
}
public sealed class RejectedWindow : Window
{
    private readonly ListBox _list = new();
    public long SelectedId { get; private set; }
    public bool Discard { get; private set; }
    public RejectedWindow(IReadOnlyList<OutboxItem> items)
    {
        Title = "Rejected uploads — recovery"; Width = 740; Height = 420;
        var panel = new DockPanel { Margin = new Thickness(16) }; Content = panel;
        var text = new TextBlock { Text = items.Count == 0 ? "No rejected items. Transient/auth failures remain pending and retry with backoff." : "Select a rejected row. Discard removes its entire capture group; both actions require confirmation.", TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0,0,0,10) };
        DockPanel.SetDock(text, Dock.Top); panel.Children.Add(text);
        var actions = new StackPanel { Orientation = Orientation.Horizontal };
        DockPanel.SetDock(actions, Dock.Bottom); panel.Children.Add(actions);
        void Button(string label, bool discard)
        {
            var button = new Button { Content = label, Margin = new Thickness(4), Padding = new Thickness(8) };
            button.Click += (_, _) => { if (_list.SelectedItem is ListBoxItem { Tag: OutboxItem item }) { SelectedId = item.Id; Discard = discard; DialogResult = true; } };
            actions.Children.Add(button);
        }
        Button("Requeue", false); Button("Discard entire capture", true);
        var close = new Button { Content = "Close", IsCancel = true, Margin = new Thickness(4) }; actions.Children.Add(close);
        foreach (var item in items) _list.Items.Add(new ListBoxItem { Content = $"Row {item.Id} • {item.CaptureId} • {item.Kind} {item.Path} • {item.LastError} • {item.Attempts} attempt(s)", Tag = item });
        panel.Children.Add(_list);
    }
}
