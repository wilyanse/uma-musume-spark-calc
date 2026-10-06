using System;
namespace Uma.Agent.Windows.Shell;

/// <summary>Only shell-owned, fixed validation copy may cross the display boundary. Never pass user text here.</summary>
public sealed class ShellValidationException : ArgumentException
{
    internal ShellValidationException(string safeMessage) : base(safeMessage) { }
}
