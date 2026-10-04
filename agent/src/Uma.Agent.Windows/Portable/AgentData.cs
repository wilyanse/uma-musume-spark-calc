using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Uma.Agent.Core;

namespace Uma.Agent.Windows.Shell;

/// <summary>Read-only runtime data: the layout profile, its templates and the published master bundle (01 §11). The
/// shell never writes any of it (published master and layout data are read-only).</summary>
public sealed record AgentData(LayoutProfile Layout, MasterData Master, IReadOnlyDictionary<string, TemplateSet> Templates)
{
    /// <summary>Loads `layouts/&lt;version&gt;.json`, `layouts/templates/&lt;version&gt;.json` and the master version named by
    /// `master/latest.json` (file hashes verified by <see cref="MasterData.Load"/>).</summary>
    public static AgentData Load(string layoutsDirectory, string masterRoot)
    {
        var layout = LayoutProfile.Load(Path.Combine(layoutsDirectory, LayoutProfiles.Version + ".json"));
        var templates = new System.Collections.ObjectModel.ReadOnlyDictionary<string, TemplateSet>(
            new Dictionary<string, TemplateSet>(TemplateSet.Load(Path.Combine(layoutsDirectory, "templates", LayoutProfiles.Version + ".json"))));
        using var latest = JsonDocument.Parse(File.ReadAllText(Path.Combine(masterRoot, "latest.json")));
        var version = latest.RootElement.GetProperty("version").GetString();
        if (string.IsNullOrWhiteSpace(version) || version.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || version.Contains("..", StringComparison.Ordinal))
            throw new InvalidDataException("master/latest.json names an invalid version");
        var master = MasterData.Load(Path.Combine(masterRoot, version));
        return new AgentData(layout, master, templates);
    }

    /// <summary>The bundled copy next to the executable (`data/layouts`, `data/master`, see the csproj).</summary>
    public static AgentData LoadBundled(string baseDirectory)
        => Load(Path.Combine(baseDirectory, "data", "layouts"), Path.Combine(baseDirectory, "data", "master"));
}
