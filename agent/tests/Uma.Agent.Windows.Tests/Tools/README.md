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

## EdgeProbe (review round 2 B1/B2/S1/S2)

Retains the independent review's real-Core edge probe and adds fail-fast assertions. It attempts 41 synthetic
veterans with an actually unavailable SQLite path, checks one retained sealed capture and exact ID/JSON/PNG retry,
failed retry/backpressure, resumed identity collection, persistent status, complete-at-cap followed by rejected
unaligned Skills (compared with Core), Stop refusing upload and category-only ArgumentException display.
The other inherited identity/thumb/cancellation/settings/drain checks remain visible in its output.
No native Windows OCR or game evidence is generated. Managed heap is a Mac measurement, not Windows RSS;
identity tombstones grow with distinct veterans, while live frames and sealed unsaved results have fixed capacities.

```sh
dotnet build agent/tests/Uma.Agent.Windows.Tests/Tools/EdgeProbe -c Release
<dotnet8>/dotnet agent/tests/Uma.Agent.Windows.Tests/Tools/EdgeProbe/bin/Release/net8.0/EdgeProbe.dll "$PWD"
```

The copied baseline came from the parent's independent round-2 scratch probe; added assertions are implementation
verification, not a new independent review. Parent focused read-only re-review remains required before merge.

## bundle_probe.py (packaging)

```sh
dotnet publish agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableWindowsTargeting=true -o "$TMPDIR/t10-publish"
python3 agent/tests/Uma.Agent.Windows.Tests/Tools/bundle_probe.py "$TMPDIR/t10-publish/Uma.Agent.Windows.exe" "$PWD"
```

Checks that all 15 bundled data files equal the repository bytes. The printed EXE SHA-256 changes between publishes
and is not an artifact identifier.
