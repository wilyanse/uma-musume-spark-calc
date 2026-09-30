# T09 — Agent core

- **Status:** Partial (not ready to commit)
- **Branch:** task/T09-agent-core
- **Agent / model:** Retry requested: `gpt-6-sol` / `openai-codex`, medium reasoning. Current session identifies as `gpt-6-sol` / `openai-codex`; effective reasoning level and profile-fallback setting are not exposed to this worker. Prior interrupted run: Opus (separate attribution, not this retry).
- **Date:** 2026-10-01

## Summary
Preserved the existing modified solution and all untracked core, layout, test and label files. Added cross-field contract checks, shared fingerprint-vector tests, ambiguity-safe image matching against the committed master bundle, and a persistent SQLite outbox with crop-first retry tests. Screenshot 01's visible skills and aptitudes were transcribed directly; the other fixture labels remain sparse. This is not a complete T09 implementation.

## Files
Created during retry:
- `agent/src/Uma.Agent.Core/ImageMatching.cs` — nearest-neighbour hash matching with a confidence margin.
- `agent/src/Uma.Agent.Core/Outbox.cs` — persistent queued uploads and backoff.
- `agent/tests/Uma.Agent.Core.Tests/{ContractParityTests,ImageTests,OutboxTests}.cs` — shared-contract, screenshot and retry regressions.
- `docs/changelog/T09-agent-core.md` — continuation report.

Modified during retry:
- `agent/src/Uma.Agent.Core/{Parsing,PixelAlgorithms}.cs` — validation parity and BGRA channel correction.
- `agent/tests/Uma.Agent.Core.Tests/CoreTests.cs` — correct fixture test paths.
- `agent/tests/fixtures/labels/01-veteran-details-skills-independent.json` — additional directly observed fields.

Preserved from previous run (not authored anew here): `agent/Uma.Agent.sln`, `agent/layouts/global-2026-09.json`, remaining `agent/src/Uma.Agent.Core/*`, `agent/tests/Uma.Agent.Core.Tests/{CoreTests.cs,Uma.Agent.Core.Tests.csproj}`, and the 15 partial labels.

## Decisions
- Use the bundle's explicit `vocab-cards.json` sidecar (Q-5); the existing `MasterCatalog` accepts its path. It is not silently merged into the schema's vocab enum.
- On ties or a runner-up margin below 4 bits, image identity is withheld rather than assigning a card. Screenshot 13 first tile aligns with the portrait hash; shifting left 3 pixels is rejected (Q-6).
- Accept `ok` `/trainMode` as provenance, but reject unresolvable `low_confidence` paths (T04b Q-110).

## Deviations from spec
- 30 §10: no full parsed-output comparisons for 15 fixtures, no ≥99% accuracy demonstration, no assembled McQueen capture. The 15 JSON files' existence is not a correctness test.
- 30 §1–5: no complete runtime parser/session/assembler; most labels are sparse. The current screen classifier uses OCR keywords rather than anchor dHash plus title and can misclassify inactive tabs.
- 30 §6: uploader does not yet parse the crop upload response and propagate `cropKey` into the veteran payload. No DPAPI (Windows shell T10 owns secret storage). It only tests order/retry, not a completed ingestion round-trip.
- 01 §3: C# `Aptitudes` wrapper currently serializes as `{"values":...}` by default instead of the contract's flat aptitude record; tests manually adapt the shared input. Full JSON Schema parity and all primitive validation are not proven.
- Core tests were run with `DOTNET_ROLL_FORWARD=Major` because this Mac has SDK/runtime 9 and 10 but no .NET 8 runtime. This does not substitute for Windows OCR or H4 human verification.

## Cross-task edits
- `agent/Uma.Agent.sln` — modified by the prior interrupted run to register the Core projects; preserved without further edits in this retry. No changes to another task's files.
- `docs/changelog/T09-agent-core.md` — required by AGENTS.md.

## Verification
```
$ DOTNET_ROLL_FORWARD=Major dotnet test agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj --no-restore
Passed!  - Failed: 0, Passed: 11, Skipped: 0, Total: 11, Duration: 639 ms
$ dotnet build agent/src/Uma.Agent.Core/Uma.Agent.Core.csproj --no-restore
Build succeeded. 0 Warning(s), 0 Error(s).
```
The first baseline test attempt without roll-forward aborted because `Microsoft.NETCore.App 8.0.0` is not installed. Prior to changes, rolling forward ran 5 tests and failed 2 due to an incorrect fixture directory path; the final result above includes the repaired tests.

## Open questions / follow-ups
- Q-5: master-data card vocab is a sidecar, not a schema enum; confirm schema decision.
- Q-6: hash matching needs more screenshot tiles, offsets, and actual capture calibration before automatic identity assignment.
- Q-110 (T04b sibling): verify complete field-path resolvability parity, including indexed array replacement safety. Sibling files were read, not changed.
- Follow-up: implement actual screen parsers, session identity/completion, assembler, rank/grade templates, spark stars/LB capture tests, full screenshot-grounded labels, master-ID bundle validation and JSON payload serialization.
- Follow-up: persist crop upload result keys, attach them to capture fields, and test an end-to-end retry across restarts; never persist service credentials.
- Human H4 action when T10 is available: on Windows record OCR for all 15 screenshots, review/correct T09 labels, import at least 20 real veterans and spot-check 3 in the web app. Human verification has not occurred here.
