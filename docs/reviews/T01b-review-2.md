# T01b review, round 2 (claude-opus-5-5, high)

## Verdict: PASS

## Blocking
(none)

B1 from round 1 is fixed. `packages/schema/src/capture.ts:196` now only enforces `!isGuest ⇒ guestTrainer === null`. `RULE.guestShape` (capture.ts:112) and the `CAPTURE_RULES` entry (capture.ts:132) match that. The tests at `packages/schema/test/capture.test.ts:178-185` now accept a non-guest parent with `outfitId: null` and a guest with `guestTrainer: null`, and reject a non-guest that has a `guestTrainer`. The remaining rule is listed as a deviation (changelog :37, :106), and the question of making the outfit mandatory is a follow-up (changelog :108). I probed four cases and all behaved correctly: non-guest with null outfit → ok; guest with null trainer → ok; guest with trainer and null outfit → ok; non-guest with a trainer → rejected at `veteran.parents.0` with the `guestShape` message.

## Should fix
- [S1] docs/changelog/T01b-contract-hardening.md:28 — the round-0 Decisions entry is out of date. It still says `checkMasterIds` "takes iterables of IDs per kind" and "Returns unknown IDs". After round 1 the inputs are `ReadonlySet<string> | readonly string[]`, `ranks` is included, and it returns `{kind, path, id}[]` deduped by kind+id. The Round 1 section records the change, but T02/T09 will read Decisions first. Suggestion: update line 28 in place, or mark it "superseded by Review round 1".

## Nits
- [N1] packages/schema/src/capture.ts:161-177 — `OWNED_CARDS_SYNC_RULES` describes `OwnedCardsSync`, which lives in `api.ts`, but it is defined in `capture.ts`, so `api.ts:31-38` has to import it back. It would be easier to find next to `OwnedCardsSync` in `api.ts` (or in a small `rules.ts`).
- [N2] packages/schema/test/capture.test.ts:305-309 — the `OWNED_CARDS_SYNC_RULES` test only checks the ids and `unlessQuery`. The duplicate-cardId test at `packages/schema/test/master.test.ts:38-39` only asserts failure (`bad`), not that the emitted message equals `OWNED_CARDS_SYNC_RULES[0].message` at path `cards.<i>.cardId`. My probe shows the message and path are right, but no test locks the descriptor to the emitted text. `CAPTURE_RULES` has the same kind of cross-check against `RULE` (capture.test.ts:~300).
- [N3] packages/schema/src/capture.ts:174 — the `heldCount` message (`cards.length must equal heldCount unless the request has ?partial=1`) is new contract text that no validator emits yet. Its doc comment says the API (T02) must emit it verbatim, but T02's card should also say so explicitly, or T02 will write its own wording.
- [N4] packages/schema/src/capture.ts:299-302 — dedupe is by kind+id, so if the same unknown ID appears at two paths, only the first path is reported. This is documented, but T04 can't flag the second occurrence. Acceptable for now.
- [N5] docs/changelog/T01b-contract-hardening.md:49 — the top Verification block still shows 144 tests. The Round 1 block (:79) shows the current 146, which matches my re-run. Not wrong, just stale.

## Checklist
1 Spec conformance: ok.
   - S3: capture.ts requires an exact per-owner `/sparks/<owner>` field with status `low_confidence`.
   - S4: `Ulid` is used for `CmTarget.id` and `ModelSnapshot.id`.
   - S5: `CardId` is used, and duplicate cardIds are rejected at `cards.<i>.cardId`.
   - S6: engines is `>=22.18`, with the README note.
   - S7: ajv 8.20.0 is pinned and validates with Ajv2020.
   - N5: the regex is exactly `^[0-7][0-9A-HJKMNP-TV-Z]{25}$` (primitives.ts:21).
   - S2: `checkMasterIds` is exported and now covers `ranks` (01 §1 line 17). A probe with all IDs known returns `[]`, and with empty outfits it returns three `{kind, path, id}` entries.
   - S8: `CAPTURE_RULES` is present and cross-tested against `RULE`.
   - N6, N8, N9, N10: fixed. `.sln` now also has `utf-8-bom`.
   - Vectors: 7/7 have identical input, canonical and sha256; the only rename is `skill-circle-suffix` → `skill-collision-suffix`; sha256(canonical) matches for all.
   - The one added rule (`!isGuest ⇒ guestTrainer === null`) is outside 01 §3 but declared as a deviation. It is consistent with 01's types and 30 §4, where a guest trainer only comes from the guest popup.
2 Correctness: ok. `checkMasterIds` rejects a bare string at compile time (TS2322 in my probe), which resolves round-1 N1. All vectors still parse. The zod schema correctly doesn't enforce `heldCount`, because `?partial=1` waives it (01 §4 line 85).
3 Test quality: ok, apart from N2. The tests assert real behaviour, B1 cases are covered in both directions, and nothing is skipped. The changelog's round-1 output (146 tests, 17 schemas, no drift) matches my re-run.
4 Fabrication check: ok. No game constants were added, and the changelog output matches real runs.
5 Security: ok / not applicable. No routes or secrets. Input validation is stricter.
6 Free-tier constraints: ok / not applicable. ajv is a devDependency only.
7 Scope: ok. The only path outside Owns is `pnpm-lock.yaml`, which is now declared under Cross-task edits (changelog :41, :107). The `package.json` diff touches engines only, and the README diff is only the Node note.
8 Maintainability: ok, apart from N1. Types are strict, versions pinned exactly, no dead code, no TODOs.

## Commands run
$ git log --oneline main..HEAD
df921e3 T01b: address review round 1
9796f54 T01b: harden contracts (per-owner spark flag, ULID ids, unique cards, ajv validation, checkMasterIds, CAPTURE_RULES)
$ git diff --stat main...HEAD | tail -1
 24 files changed, 469 insertions(+), 70 deletions(-)
$ git diff --name-only main...HEAD | grep -vE '^(packages/schema/|package.json$|\.editorconfig$|eslint.config.js$|README.md$|docs/changelog/T01b)'
pnpm-lock.yaml
$ node -v && pnpm -v
v25.9.0
11.22.0
$ pnpm install --frozen-lockfile
Already up to date
$ pnpm -r lint
$ eslint .
(exit 0)
$ pnpm -r typecheck
$ tsc -p tsconfig.json
$ pnpm -r test
 Test Files  4 passed (4)
      Tests  146 passed (146)
$ pnpm --filter @uma/schema build
$ node scripts/build-json.ts
wrote 17 schemas to .../packages/schema/json/
$ git status --porcelain            # after build
(empty)
$ (cd packages/schema && python3 scripts/make-vectors.py) && git status --porcelain
wrote 7 vectors
(empty)
$ python3 compare main:fingerprint.vectors.json vs working tree
7 7
True                                            # input/canonical/sha256 identical
[('skill-circle-suffix', 'skill-collision-suffix')]
True                                            # sha256(canonical) == sha256 for all
$ pnpm exec prettier --check packages eslint.config.js package.json
All matched files use Prettier code style!
$ file agent/Uma.Agent.sln
agent/Uma.Agent.sln: Unicode text, UTF-8 (with BOM) text, with CRLF line terminators
$ node probe.mts        # temporary probe in the scratch dir, deleted afterwards; git status clean
nonguest null outfit ok
guest null trainer ok
nonguest with trainer veteran.parents.0: a non-guest parent must not have a guestTrainer
guest trainer null outfit ok
outfits empty -> [{"kind":"outfits","path":"/outfitId",...},{"kind":"outfits","path":"/parents/0/outfitId",...},{"kind":"outfits","path":"/parents/1/outfitId",...}]
all known -> []
sync heldCount mismatch zod: true
dup sync [[["cards",1,"cardId"],"duplicate cardId (owned_cards.card_id is the primary key)"]]
$ tsc --noEmit --strict tc.ts   # checkMasterIds(v, {characters: "abc", ...})
tc.ts(1,195): error TS2322: Type 'string' is not assignable to type 'readonly string[] | ReadonlySet<string>'.
