# T10 verification tools

Task-owned helpers kept so a reviewer can rerun the T10 checks. They are not tests, not part of the solution and
not shipped. Run them from the repository root on the Mac with an isolated .NET 8 runtime; nothing here touches
global SDK/runtime configuration.

## MemoryProbe (review B1)

Measures the managed memory held by the real `CapturePipeline` with real Core, real fixture screenshots and recorded
OCR, injected time and seeded IDs:

```sh
dotnet build agent/tests/Uma.Agent.Windows.Tests/Tools/MemoryProbe -c Release
<dotnet8>/dotnet agent/tests/Uma.Agent.Windows.Tests/Tools/MemoryProbe/bin/Release/net8.0/MemoryProbe.dll "$PWD"
```

Scenarios: A, a still view with a fresh frame array every 250 ms poll for 60 s. B, the same with a one-pixel cosmetic
change on every poll. C, 20 synthetic distinct veterans (real parsed evidence, Speed changed per veteran) in one
watch. D, both limits reached. Figures are `GC.GetTotalMemory` after a full blocking GC: managed heap on the Mac,
not Windows process memory.

## bundle_probe.py (packaging)

```sh
dotnet publish agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableWindowsTargeting=true -o "$TMPDIR/t10-publish"
python3 agent/tests/Uma.Agent.Windows.Tests/Tools/bundle_probe.py "$TMPDIR/t10-publish/Uma.Agent.Windows.exe" "$PWD"
```

Checks that all 15 bundled data files equal the repository bytes. The printed EXE SHA-256 changes between publishes
and is not an artifact identifier.
