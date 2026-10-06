using System;
using Uma.Agent.Core;

namespace Uma.Agent.Windows.Shell;

/// <summary>What the tray/dialogs show for a failed local operation. Shell- and Core-owned exception types carry
/// actionable messages written for the user (no secrets, no HTTP bodies) and are shown as is; anything else shows only
/// its category, because its message may contain paths, addresses or server text.</summary>
public static class UserMessages
{
    public static string For(Exception e) => e switch
    {
        UnsupportedFrameException or NonReferenceFrameException or CaptureUnavailableException or ServiceTokenMissingException
            or ShellValidationException or IncompleteCaptureException => e.Message,
        _ => $"Local operation failed ({e.GetType().Name}). Check local file permissions, restore the game window, or Stop and Start; the local logs record the category only.",
    };
}
