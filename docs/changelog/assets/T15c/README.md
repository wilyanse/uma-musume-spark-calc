# T15c evidence index

All browser evidence is a REAL Chromium run of the Vite dev server with the real engine Worker
and Comlink. Fixture mode (port 5200) is the SYNTHETIC golden context with the committed,
unchanged `roster.calibration-x1.3.json`, and its snapshot store is an in-tab MOCK. API mode
(port 5201) uses MOCK HTTP routes. Nothing here is real-game, native-agent, live-API or deployed
evidence.

| Folder | Producer / when | Code state | Result |
|---|---|---|---|
| `./` (top level) | Opus 5.5, first full browser run | commits 33199ef..5e0ec0f (before the Sol changes) | 18/18 browser tests passed (log in session scratch, not copied) |
| `tdd/` | Opus (red-1, red-2, green-1), then Sol (sol-*) | RED/GREEN logs captured at the time | see the changelog Verification section |
| `sol-continuation/` | Sol 6.1, first rerun after adding the Web Lock e2e step | uncommitted Sol working tree | 18/18 passed |
| `sol-final/` | Sol, rerun after reset rollback fix | uncommitted | 18/18 passed |
| `sol-acceptance/` | Sol, gates + rerun after adding Health refit / Planner auto-fit steps | uncommitted | gates passed; e2e **1 failed** (`e2e-failed.log`: stale-report assertion after reload, test-order bug), kept on purpose |
| `sol-verified/` | Sol, rerun after the test fix | uncommitted | 18/18 passed |
| `sol-candidate/` | Sol, web lint/typecheck/build/check-dist/e2e after deterministic page ULIDs | uncommitted | all exit 0; 18/18 passed |
| `final-opus/` | Opus 5.5 (resumed), final candidate gates | committed 6d2f9dd, tree clean except this evidence folder | all exit 0; 18/18 passed; `HEAD.txt` records the tree |

Snapshot/override ULIDs and the overridden context fingerprint differ between runs. The effective
rules carry `version: <base>+local-<override ULID>` and a `source` naming the report, both inside the
hashed rules, so every application has its own identity even for equal values (stricter, never
looser); tests compare identities within a run. The base fixture fingerprint `sha256:979cfd2e…7add`
and the ×1.32 → 13.2/26.4/39.6 proposal are the same in every run.
