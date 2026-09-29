# T01 review, round 1 (claude-opus-5-5, high)

## Verdict: PASS

## Blocking
(none)

## Should fix
- [S1] packages/schema/scripts/make-vectors.py:60-61, packages/schema/test/fingerprint.test.ts:53-55 — The "◯ skill" vector contains no ◯. No vector input has the character (I checked with a Python scan, which returned `False`). `skill-circle-suffix` just uses `skill:concentration-2`, and its canonical string is byte-identical to `baseline` (`True`), so it adds no cross-language coverage. The note also says a ◯ name maps to a `-2` collision suffix. That doesn't follow from 01 §1: `Concentration ◯` slugs to `concentration`, and it only gets `-2` if another skill collides. The worker's point that ◯ can never reach the hashed payload under 01 §1/§5 is right. So the card's requirement can't be met in a meaningful way as written. Suggestion: add an `OPEN_QUESTIONS.md` entry (or ask the orchestrator) to restate the requirement, e.g. a white spark whose skill name ends in ◯, with the slug rule written down. Also fix the note so it doesn't claim a slug mapping.
- [S2] packages/schema/src/capture.ts:119-154; docs/changelog/T01-monorepo-contracts.md:40-42 — 01 §3 rule "Every ID exists in the master data version named by `masterVersion`" isn't implemented or tested. The prompt said every rule should be a zod refinement. This one needs master data, so it can't be a sync refinement, but the changelog doesn't list it as a deviation. Suggestion: record it as a deviation and a T04/T09 follow-up. Optionally export a `checkMasterIds(veteran, master)` helper.
- [S3] packages/schema/src/capture.ts:187-189 — The rule "parent owner with no sparks needs a low_confidence flag" accepts any `low_confidence` field whose path starts with `/sparks`. Probe: a low-confidence field on `/sparks/0/stars` (a self spark) excuses `parent2` having no sparks (`self-spark flag excuses parent2: true`). `startsWith('/sparks')` would also match `/sparksX`. Suggestion: require a per-owner flag (e.g. path `/sparks` with `value: {owner}`, or a documented convention like `/sparks?owner=parent2`), or write down the looser rule on purpose as a decision.
- [S4] packages/schema/src/cm-target.ts:10, packages/schema/src/model-snapshot.ts:12 — 01 §1 says user-data IDs are ULIDs, and `cm_targets` / `model_snapshots` are user-data tables. Both `id` fields are `NonEmpty`, and the test uses `id: 't1'` (master.test.ts:94). Every other user-data ID in the package (veteran, review item, capture) uses `Ulid`. Suggestion: use `Ulid`, or document why these differ (e.g. server-assigned on POST).
- [S5] packages/schema/src/api.ts:13-20 — `OwnedCardsSync.cards` accepts duplicate `cardId`s (probe: `dup cardId in sync accepted: true`). `owned_cards.card_id` is the PK (01 §7), so a duplicate would fail the atomic replace inside the API instead of returning a clean 422. Suggestion: add a uniqueness refinement. Also reuse `CardId` instead of the inline regex at api.ts:15.
- [S6] package.json:8, packages/schema/package.json:18 — `build` runs `node scripts/build-json.ts` with native type stripping. That's only on by default from Node 22.18, but `engines` says `>=22`. On 22.0–22.17, `pnpm --filter schema build` fails. Suggestion: set `engines.node` to `>=22.18` (and mention it in the README), or run the script through a pinned `tsx`.
- [S7] packages/schema/test/json-schema.test.ts:85-90 — Close to a tautology. It only checks that `baseCapture()` has the keys listed in `required` and that there are at least 5 vectors. Nothing is validated against the exported JSON Schema. Suggestion: validate the vector-based captures with a JSON Schema validator (e.g. pinned ajv 2020), or delete the test. The drift test (lines 37-41) already covers export equality.
- [S8] docs/changelog/T01-monorepo-contracts.md:73-75 — The exported JSON Schemas carry none of the cross-field `superRefine` rules: deck/parent slots, parents-differ, parent-not-self, spark shape/duplicates, the parent-sparks flag. 01 §3 requires the agent to validate the same rules, so T09 has to re-implement them by hand. Suggestion: add that as an explicit follow-up for T09, pointing at `RULE` in capture.ts:105-115.

## Nits
- [N1] The card's literal `pnpm -r lint typecheck test` fails: pnpm runs `eslint . typecheck test` → exit 2. The chained form in AGENTS.md DoD passes. The card wording should use the chained form.
- [N2] docs/changelog/T01-monorepo-contracts.md:44-45 — `agent/global.json` isn't in the card's Owns and isn't listed under Cross-task edits. The prompt asked for it, but it should still be listed.
- [N3] docs/changelog/T01-monorepo-contracts.md:52 — `printf '%s' "$(canonical of vector 0)"` is pseudo-shell, not the command that was actually run. The value is correct: I re-derived the vector hashes independently (see Commands).
- [N4] packages/schema/src/capture.ts:63-69 — `isGuest` / `guestTrainer` / `outfitId` consistency isn't enforced (probe: non-guest with `outfitId: null` is accepted). The spec is silent, so either document it or add a soft rule.
- [N5] packages/schema/src/primitives.ts:21 — The ULID regex accepts a first character above `7` (overflow). Use `^[0-7][0-9A-HJKMNP-TV-Z]{25}$`.
- [N6] packages/schema/src/capture.ts:204 — Redundant `export { STAT_KEYS }`; index.ts already re-exports it from enums.ts. packages/schema/src/master.ts:145 — `MASTER_FILE_NAMES` is unused and doesn't match the `CONTRACTS` naming.
- [N7] packages/schema/src/api.ts:25,49,58,83 — `IngestResponse`, `RosterVeteranDetail`, `VeteranPatch` and `HealthResponse` have no tests.
- [N8] .editorconfig:4 — Applies `end_of_line = lf` to all files, but `agent/Uma.Agent.sln` is CRLF with a BOM. Add a `[*.sln]` section with `end_of_line = crlf`.
- [N9] eslint.config.js:10 — The `'**/json/**'` ignore will silently skip any future `json/` folder in any package. Narrow it to `packages/schema/json/**`.
- [N10] packages/schema/src/fingerprint.ts:33-34 — Relies on JS default sort (UTF-16). That's fine because the ID regex restricts IDs to ASCII. Add the matching note for C# (`StringComparer.Ordinal`) to the vectors file's description, not just the changelog.

## Checklist
1 Spec conformance: ok with issues. Every 01 contract (enums, VeteranCapture, CaptureField, OwnedCardsSync, RosterVeteran, ReviewItem, CmTarget, all 9 master files including `iconHashes`, MasterLatest, Rules, ModelSnapshot) has a zod schema and a TS type. `pnpm --filter schema build` writes 17 `json/*.schema.json`. `fingerprint.ts` matches §5 (slot-based parents, sorted `owner|sparkId|stars`, canonical JSON). There are 7 vectors, including a guest parent and a permutation with the same hash. The ◯ vector is nominal only (S1). The master-ID existence rule is undeclared (S2). CmTarget/ModelSnapshot IDs aren't ULIDs (S4).
2 Correctness: minor issues (S3, S5, N4, N5). Checked edge cases: guest parent, LB 0–4 bounds, stats 1/2000, parent-slot order in the fingerprint, UTF-8 hashing.
3 Test quality: mostly good. 124 real assertions, and the vectors were generated independently of the TS code (I reproduced them by hand). One near-tautology (S7), some helper schemas untested (N7). The changelog output matches my re-run (4 files / 124 tests, 17 schemas, dotnet 1 warning / 0 errors, prettier clean).
4 Fabrication check: ok. No game constants in code. Rules requires `verified` + `source`. The vector-generator rerun reproduces the committed file byte-for-byte. The only issue is the invented ◯→`-2` slug note (S1).
5 Security: ok, not applicable (no routes). No secrets committed. `.gitignore` is append-only (`.pnpm-store/`).
6 Free-tier constraints: ok, not applicable. Fingerprint uses Web Crypto, which is Workers-compatible.
7 Scope: ok. Off-list files are `.prettierignore`, `pnpm-lock.yaml` (declared) and `agent/global.json` (required by the prompt but not declared, N2). No other task's files touched.
8 Maintainability: ok. `strict` plus `noUncheckedIndexedAccess`, ESM only, exact pinned versions (no `^` in either package.json). TS 5.9.3 instead of 7.0.2 is recorded with the typescript-eslint reason. Small dead code (N6), Node floor mismatch (S6).

## Commands run
$ node -v && pnpm -v && dotnet --version
v25.9.0
11.22.0
10.0.103
$ pnpm install --frozen-lockfile
Scope: all 2 workspace projects
Already up to date
$ pnpm -r lint
$ eslint .
$ pnpm -r typecheck
$ tsc -p tsconfig.json
$ pnpm -r test
$ vitest run
 Test Files  4 passed (4)
      Tests  124 passed (124)
$ pnpm -r lint typecheck test
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @uma/schema@0.0.0 lint: `eslint . typecheck test`
Exit status 2
$ pnpm lint && pnpm typecheck && pnpm test
$ eslint .
$ tsc -p tsconfig.json
      Tests  124 passed (124)
$ pnpm --filter schema build
$ node scripts/build-json.ts
wrote 17 schemas to .../packages/schema/json/
$ git status --porcelain            # after build: no drift
(empty)
$ (cd packages/schema && python3 scripts/make-vectors.py) && git status --porcelain
wrote 7 vectors
(empty — regenerated vectors byte-identical)
$ shasum -a 256 < canonical_of_vector[guest-parent]
dbcf275f0b0c998269fc6ccec54f3c3fed4bc0b5dffc0b49d9e0820b3ca02124  -   (== vectors[2].sha256)
$ python3 -c "...any('◯' in input for input in vectors); vectors[3].canonical == vectors[0].canonical"
False
True
$ dotnet build agent/Uma.Agent.sln
NuGet.targets(196,5): warning : Unable to find a project to restore!
    1 Warning(s)
    0 Error(s)
$ pnpm exec prettier --check packages eslint.config.js package.json
All matched files use Prettier code style!
$ git diff main...HEAD --name-only | grep -v <Owns paths>
.prettierignore
agent/global.json
pnpm-lock.yaml
$ vitest run test/zz-probe.test.ts   # temporary probe, removed afterwards; git status clean
self-spark flag excuses parent2: true
wrong fingerprint accepted: true
overflow ULID accepted: true
non-guest null outfit accepted: true
dup cardId in sync accepted: true
date 2026-02-30: false
CaptureField required: ["path","rawText","value","confidence","status","candidates","cropKey"]
