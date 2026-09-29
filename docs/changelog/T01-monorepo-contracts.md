# T01 — Monorepo and shared contracts

- **Status:** Done
- **Branch:** task/T01-monorepo-contracts
- **Agent / model:** Claude Sonnet 5.5, reasoning medium
- **Date:** 2026-09-29

## Summary
pnpm 11 monorepo with `@uma/schema`: zod v4 schemas and TS types for every contract in 01 (enums, VeteranCapture with all §3 rules, OwnedCardsSync, RosterVeteran, ReviewItem, CmTarget, all master files incl. `iconHashes`, Rules, ModelSnapshot), fingerprint (01 §5) via Web Crypto, 7 independently produced fingerprint vectors, and `pnpm build` exporting 17 `json/*.schema.json`. Empty `agent/Uma.Agent.sln` with `Directory.Build.props` and `global.json`.

## Files
Created:
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `.editorconfig`, `.prettierrc`, `.prettierignore`, `eslint.config.js`
- `packages/schema/{package.json,tsconfig.json,vitest.config.ts}`
- `packages/schema/src/{enums,primitives,capture,api,master,rules,cm-target,model-snapshot,fingerprint,json-schemas,index}.ts`
- `packages/schema/scripts/build-json.ts` (writes json/), `packages/schema/scripts/make-vectors.py` (independent vector generator)
- `packages/schema/json/*.schema.json` (17, generated, committed so the C# agent can consume them)
- `packages/schema/test/{capture,fingerprint,master,json-schema}.test.ts`, `fixtures.ts`, `fingerprint.vectors.json`
- `agent/Uma.Agent.sln`, `agent/Directory.Build.props`, `agent/global.json`

Modified:
- `.gitignore` (appended `.pnpm-store/`), `README.md` (added "Development quickstart")

## Decisions
- **TypeScript 5.9.3, not 7.0.2.** typescript-eslint 8.71.0 (latest) throws "does not support TS 7.0" (peer range `<6.1.0`), so `eslint` cannot run. Pinned the latest 5.x (5.9.3); 6.0.x would also work but the card said 5.x. Revisit when typescript-eslint supports TS >= 7.1.
- `@types/node` pinned to 22.20.4 (matches the Node >= 22 floor; 26.x exists).
- Package exports point at `src/*.ts` (no build step for consumers; Vite/Vitest/Workers handle TS). Node runs `scripts/build-json.ts` directly via native type stripping (Node 22.18+/25 here); imports use `.ts` extensions.
- JSON Schema is exported with `io: 'input'`, target draft-2020-12. One file per contract; the nine array/object master files are `master.<name>.schema.json`, plus `MasterLatest` for `/master/latest.json`. `rules` is `Rules.schema.json`.
- Objects are `strictObject` (unknown keys rejected) so schema drift is caught at the API boundary.
- Master-ID fields are validated as `<kind>:<lower-kebab>`; ULIDs, ISO UTC datetimes, `YYYY-MM-DD` dates and lowercase sha256 hex are format-checked.
- "Parent owner may have no sparks if unread, in which case a field is flagged `low_confidence`": implemented on `VeteranCapture` as a rule requiring a `low_confidence` field with path starting `/sparks`. Rules on the bare `veteran` (shape, duplicates, parents, deck) are shared with `RosterVeteran`, which has no `fields`, so the flag rule applies only to captures.
- Extra rules beyond the bullet list, implied by "exactly 6 deck slots / 2 parents": deck slots must be 1..6 each once; parent slots 1 and 2 each once; no duplicate `owner|sparkId`.
- Fingerprint: parents are picked by `slot` (not array order); sparks sorted by default JS string sort (ASCII ordinal); non-ASCII is emitted raw (not `\u` escaped), matching Python `ensure_ascii=False`. C# must do the same. Skills are not in the fingerprint per 01 §5; the ◯ vector documents that. Since ID slugs collapse non-alphanumerics (01 §1), a ◯ suffix appears in a skill *name*, not an ID; the vector uses a `-2` collision-suffixed ID and the test file has a raw-◯ UTF-8 hashing test.
- `Affinity` accepts `{groups}` and an optional `pairs` list, to cover "or the pairwise table the source provides" (01 §11). Shape of `pairs` is my assumption; T03 may refine it.
- `Rules.raceSparkStatGain` / `scenarioSparkEffects` are open objects requiring only `verified`+`source` (01 §12 gives `{…}`).
- Added API helper schemas not strictly listed: `IngestResponse`, `RosterVeteranDetail`, `VeteranPatch`, `ResolveReviewRequest`, `HealthResponse`. `ReviewItem` is the joined shape from §9 (id, veteranId, path, status, resolvedValue, timestamps, `field`, `cropKey`); exact key names are my assumption.
- `.prettierignore` and `pnpm-lock.yaml` are not listed under Owns; needed for prettier/pnpm to work (see Cross-task edits). `pnpm-workspace.yaml` also has a `minimumReleaseAgeExclude` list that pnpm 11 wrote itself for the just-released typescript-eslint packages.
- `agent/global.json` pins 9.0.100 with `rollForward: latestMajor`; with SDKs 9.0.312 and 10.0.103 installed, 10.0.103 is selected.

## Deviations from spec
- TypeScript 5.9.3 instead of 7.0.2 (allowed by the card; reason above).
- `dotnet build agent/Uma.Agent.sln` prints the warning "Unable to find a project to restore" (expected for an empty solution); it does not fail, and TreatWarningsAsErrors doesn't apply to NuGet's warning.

## Cross-task edits
- `.prettierignore` (new) and `pnpm-lock.yaml` (generated) — outside the Owns list but required for formatting and reproducible installs. No other task's files touched.

## Verification
Independent vector check (canonical JSON built by Python, hashed by `shasum`):
```
$ python3 scripts/make-vectors.py        # asserts hashlib == `shasum -a 256` for each vector
wrote 7 vectors
$ printf '%s' "$(canonical of vector 0)" | shasum -a 256
bd293d021ab0e46d58ae758320b5f7b47e7286b8607275cd2bfad2eb897a5b96  -   (equals vectors[0].sha256)
```
Full gate from the repo root:
```
$ pnpm -r lint && pnpm -r typecheck && pnpm -r test
$ eslint .
$ tsc -p tsconfig.json
$ vitest run
 Test Files  4 passed (4)
      Tests  124 passed (124)
$ pnpm build
wrote 17 schemas to .../packages/schema/json/
$ dotnet build agent/Uma.Agent.sln
NuGet.targets(196,5): warning : Unable to find a project to restore!
Build succeeded.    1 Warning(s)    0 Error(s)
$ pnpm exec prettier --check packages eslint.config.js package.json
All matched files use Prettier code style!
```

## Open questions / follow-ups
- No Q-entries added. Assumptions worth a look by T04/T03: `ReviewItem` key names, `Affinity.pairs`, `MasterLatest.files` value type (string path).
- Follow-up: move to TypeScript 7 once typescript-eslint supports >= 7.1.
- Follow-up (T09/T10): the C# fingerprint must run `fingerprint.vectors.json`; note raw-UTF-8 and slot-based parent selection.
