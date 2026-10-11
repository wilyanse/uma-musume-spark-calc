"""Required Windows distribution mappings: never infer native terms from NuGet MIT metadata."""
from verification_safety import require

LIBRARY = 'dotnet-Library-LICENSE.html'
SDK = 'Microsoft.Windows.SDK.NET.Ref-10.0.19041.57-LICENSE.rtf'
REQUIRED = {'coreclr.dll': LIBRARY, 'PresentationNative_cor3.dll': LIBRARY,
            'vcruntime140_cor3.dll': LIBRARY, 'wpfgfx_cor3.dll': LIBRARY,
            'D3DCompiler_47_cor3.dll': SDK}


def check(inv, texts, paths=None):
    # Synthetic test graphs use a fake host; the actual supported Windows artifact cannot opt out.
    if inv['singleFileHost']['package'] != 'Microsoft.NETCore.App.Host.win-x64':
        return
    m = inv.get('windowsLicensing')
    require(isinstance(m, dict), 'inventory lacks windowsLicensing for Microsoft single-file runtime')
    require(m.get('singleFileRuntime') == LIBRARY, 'single-file runtime must map to .NET Library License')
    require(m.get('native') == REQUIRED, 'Windows native licence mappings differ from required Microsoft terms')
    require(m.get('authority') == 'dotnet-license-information-windows.md', 'Windows licence mapping lacks pinned authority')
    require(isinstance(m.get('publicationGate'), str) and 'UNRESOLVED HUMAN PUBLICATION GATE' in m['publicationGate'],
            'Microsoft terms require unresolved human publication gate')
    for n in set(REQUIRED.values()) | {m['authority']}:
        require(n in texts, 'required Windows licence missing: ' + n)
    for c in inv['components']:
        if c['deps'].startswith('runtimepack.Microsoft.NETCore.App.Runtime.'):
            require(LIBRARY in c['notices'] and 'Library License' in c['licence'], 'single-file runtime component mislabelled')
        if c['deps'].startswith('runtimepack.Microsoft.WindowsDesktop.App.Runtime.'):
            require(LIBRARY in c['notices'] and SDK in c['notices'] and 'Library License' in c['licence'] and 'Windows SDK' in c['licence'],
                    'WindowsDesktop component mislabelled/missing native terms')
    if paths is not None:
        # .NET single-file host incorporates coreclr rather than listing coreclr.dll separately.
        for n in set(REQUIRED) - {'coreclr.dll'}:
            require(n in paths, 'expected licensed WPF native absent from actual bundle: ' + n)
