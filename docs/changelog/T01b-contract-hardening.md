# T01b — Contract hardening (from T01 review)

- **Status:** Done
- **Branch:** task/T01b-contract-hardening
- **Agent / model:** claude-sonnet-5-5
- **Date:** 2026-09-29

## Summary
Addresses T01-review-1 items S2–S8, N4, N5, N6, N8, N9, N10. The parent-spark flag is now per owner, CmTarget/ModelSnapshot IDs are strict ULIDs, owned-card syncs reject duplicate `cardId`s, and the captures are validated against the exported JSON Schema with ajv 2020. `checkMasterIds` and `CAPTURE_RULES` are exported. Fingerprint hashes are unchanged.

## Files
Created:
- `docs/changelog/T01b-contract-hardening.md`

Modified:
- `packages/schema/src/capture.ts` — S3 (flag path exactly `/sparks/<owner>`), S2 `checkMasterIds` + `MasterIndex`, S8 `CAPTURE_RULES`, N4 `guestShape` rule, N6 duplicate `STAT_KEYS` export removed
- `packages/schema/src/primitives.ts` — N5 strict ULID regex
- `packages/schema/src/cm-target.ts`, `model-snapshot.ts` — S4 `Ulid` ids
- `packages/schema/src/api.ts` — S5 `CardId` and unique `cardId` refinement
- `packages/schema/src/master.ts` — N6 unused `MASTER_FILE_NAMES` removed
- `packages/schema/json/{CmTarget,ModelSnapshot,ReviewItem,RosterVeteran,VeteranCapture}.schema.json` — regenerated (ULID pattern, `id` pattern)
- `packages/schema/test/*.ts`, `scripts/make-vectors.py`, `test/fingerprint.vectors.json` — tests; S1 rename; N10 note
- `packages/schema/package.json`, `pnpm-lock.yaml` — devDependency `ajv` 8.20.0 (exact); lock change is ajv and its transitive deps only
- `package.json` (engines `>=22.18`, S6), `README.md` (Node note), `.editorconfig` (`[*.sln] end_of_line = crlf`, N8), `eslint.config.js` (ignore narrowed to `packages/schema/json/**`, N9)

## Decisions
- S3: rule is `status === 'low_confidence' && path === '/sparks/<owner>'` (exact, per owner). One flag per unreadable owner.
- S2: `checkMasterIds(veteran, MasterIndex)` takes iterables of IDs per kind (T03/T09 can build it from the master files). Returns unknown IDs deduplicated in first-seen order; a null guest outfit is skipped. Not a zod refinement (needs master data); listed in `CAPTURE_RULES` with `needsMaster: true`.
- S8: `CAPTURE_RULES` is an array of `{id, scope, path, message, needsMaster?}`; ids match the `RULE` keys plus `masterIds`, and a test enforces this.
- N4: new veteran-level rule `guestShape`: a non-guest parent needs `outfitId` and no `guestTrainer`; a guest needs a `guestTrainer` (`outfitId` may be null or set). The spec is silent, so this is the smallest consistent reading. The test vectors' guest parent conforms.
- S7: ajv runs with `validateFormats: false` (no ajv-formats dependency); date/time formats are checked by zod.
- S1: kept as is; vector renamed `skill-collision-suffix`, note corrected. Test title updated.
- N10: the C# ordinal-sort note is in the vectors file's `description` (via `make-vectors.py`).
- N6: `MASTER_FILE_NAMES` removed rather than renamed (no consumer).

## Deviations from spec
- 01 §3 adds the `guestShape` rule (N4), which the spec does not state.
- 01 §3 does not define the flag path for unreadable parent sparks; `/sparks/<owner>` is a new convention, now in the `RULE` message.

## Cross-task edits
- None. (`pnpm-lock.yaml`, `README.md`, `.editorconfig`, `eslint.config.js` and root `package.json` were named in the card.)

## Verification
```
$ pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm --filter @uma/schema build
$ eslint .
$ tsc -p tsconfig.json
 Test Files  4 passed (4)
      Tests  144 passed (144)
$ node scripts/build-json.ts
wrote 17 schemas to .../packages/schema/json/

$ pnpm exec prettier --check packages eslint.config.js package.json
(clean; README.md was already not prettier-clean on HEAD, untouched apart from the Node note)

# vector hashes unchanged (old = git HEAD, new = working tree)
$ python3: names that differ -> [('skill-circle-suffix', 'skill-collision-suffix')]
$ python3: all(old.sha256 == new.sha256 and old.canonical == new.canonical) -> True (7 vectors)
$ git diff -U0 packages/schema/test/fingerprint.vectors.json | grep sha256 | wc -l
0
(the diff touches only: description, the renamed vector's name, and its note)

$ python3 scripts/make-vectors.py   # regenerated file is the committed one
wrote 7 vectors
```
Tests added: per-owner flag (wrong owner/path variants rejected), guestShape, strict ULID overflow, `checkMasterIds`, `CAPTURE_RULES`, duplicate and malformed `cardId`, non-ULID ids for CmTarget/ModelSnapshot, and 7 vectors plus structural negatives validated through ajv 2020.

## Open questions / follow-ups
- Follow-up (T09): mirror `CAPTURE_RULES` in C# (including the `/sparks/<owner>` flag convention and `guestShape`). Call `checkMasterIds` in the API (T02) with the master data for `masterVersion`.
- Not addressed (out of card): N1, N2, N3, N7.
