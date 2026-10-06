using System;
using System.Threading.Tasks;

namespace Uma.Agent.Windows.Shell;

/// <summary>What the tray's Settings action does after the dialog is accepted (T10b r1 B1), kept portable so the
/// wiring is tested: save and publish the normalized settings, save a new service token through the upload service,
/// then ALWAYS tell the support-card controller, even if a step failed part-way. The card controller compares the
/// published address and the token store's nonsecret version with what a scan/send was bound to, cancels a scan whose
/// address changed and stops an in-flight send whose configuration changed. No secret is copied, kept or logged here.</summary>
public static class SettingsCommit
{
    public static async Task CommitAsync(SettingsStore store, AgentSettings result, Action<AgentSettings> publish,
        UploadService uploader, string newId, string newSecret, CardSyncController cards)
    {
        try
        {
            store.Save(result);
            publish(store.Load());
            if (newId.Length > 0 || newSecret.Length > 0) await uploader.SaveTokenAndRetryAsync(newId, newSecret);
        }
        finally { cards.ConfigurationChanged(); }
    }
}
