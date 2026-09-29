# T01b review, round 1 (claude-opus-5-5, high)

## Verdict: CHANGES_REQUESTED

## Blocking
- [B1] packages/schema/src/capture.ts:112-113, 178-181 (tests at packages/schema/test/capture.test.ts:171-176; changelog :30, :37). Problem: the new `guestShape` rule rejects captures that the authoritative contract allows. 01 §3 types every parent as `outfitId: string | null`, and a null outfit isn't limited to guests. 01 §3 also lists the 422 rules exhaustively, and 01 line 3 says changing the contract needs an ADR. The capture flow can't meet the new rule either. 30 §4 identifies parents by dHash against `characters.json.iconHashes`, which gives a character, not an outfit. The `[Outfit]` and the guest trainer only come from the `sparks.popup` fallback, which the user opens by tapping. 30 §5 doesn't require that popup for a session to be complete. So a normal capture with a well-matched non-guest portrait, or a guest whose popup wasn't opened, now gets a 422. I probed this: a non-guest with `outfitId: null` and a guest with `guestTrainer: null` both fail with the `guestShape` message. N4 asked to "document it or add a soft rule", not to add a hard contract rule. Required fix: remove the `outfitId !== null` requirement for non-guests and the `guestTrainer !== null` requirement for guests. The only safe option is to keep just `!isGuest ⇒ guestTrainer === null`, list it as a deviation, and add an OPEN_QUESTIONS entry if the outfit should become mandatory. Alternatively, drop `guestShape` altogether and document N4 as intentionally unenforced. Update `CAPTURE_RULES` and the tests to match. Restore a passing test for a non-guest parent with a null outfit.

## Should fix
- [S1] docs/changelog/T01b-contract-hardening.md:41. Problem: the changelog says "Cross-task edits: None" and that `pnpm-lock.yaml` "was named in the card". It isn't. The card's Owns list is `packages/schema/**`, `package.json` (engines), `.editorconfig`, `eslint.config.js` and `README.md`. The lock change is only ajv 8.20.0 and its 4 transitive deps, and it's needed for S7. Suggestion: list `pnpm-lock.yaml` under Cross-task edits.
- [S2] packages/schema/src/capture.ts:253-260, 267-291. Problem: `MasterIndex` has no `ranks`, so `veteran.rank` is never checked. 01 §1 says rank is a "free string validated against master `ranks`", and `ranks.json` is a master file (01 §11). Right now nothing validates it. Suggestion: add `ranks: Iterable<string>` and `check('ranks', veteran.rank)`, or record the gap as a follow-up for T02/T04.
- [S3] packages/schema/src/api.ts:22-34; packages/schema/src/capture.ts:122-159. Problem: the new unique-`cardId` rule for `OwnedCardsSync` exists only as a zod refinement. The exported JSON Schema doesn't carry it (probe: no `unique` in `contractJsonSchema('OwnedCardsSync')`). `CAPTURE_RULES` only covers `VeteranCapture`, so T11, which sends the sync, has no descriptor to copy from, and it faces the same S8 problem. Suggestion: add a sync rules descriptor (unique `cardId`, plus the `heldCount` / `?partial=1` rule from 01 §4), or add a `scope: 'ownedCardsSync'` entry.

## Nits
- [N1] packages/schema/src/capture.ts:253-260. `Iterable<string>` also accepts a bare string, which gets iterated character by character. Probe: passing `characters: v.characterId` returned 15 "unknown" IDs. Use `ReadonlySet<string> | readonly string[]`.
- [N2] packages/schema/src/capture.ts:118-119, 199, 244. The doc comment says `message` is "the text the TS validators emit", but `sparkShape` and `parentSparksUnreadable` are emitted with an ` (owner X)` suffix. Say that it's a prefix.
- [N3] packages/schema/src/capture.ts:208-209. `/sparks/<owner>` isn't a real JSON pointer into `veteran` (`sparks` is an array), but the `CaptureField.path` doc comment still says "JSON pointer into `veteran`". Note the pseudo-pointer convention there, because T04 turns low-confidence fields into review items and resolves them by path.
- [N4] .editorconfig:17-18. `agent/Uma.Agent.sln` is UTF-8 with a BOM, and `[*]` sets `charset = utf-8`, so some editors will strip the BOM. Add `charset = utf-8-bom` to the `[*.sln]` section.
- [N5] packages/schema/src/capture.ts:267-291. `checkMasterIds` returns bare IDs with no path or kind. For a 422 body, T02/T04 would benefit from `{path, id}` pairs. This is optional.

## Checklist
1 Spec conformance: issues (B1). S3: the flag must be exactly `/sparks/<owner>` with status `low_confidence`, per owner (capture.ts:235-248). It's tested for `/sparks/parent1`, `/sparks/0/stars`, `/sparks`, `/sparksX` and `/sparks/self`, and I probed that `corrected` doesn't count as a flag and that each owner needs its own. S4: both `CmTarget.id` and `ModelSnapshot.id` use `Ulid`, and the JSON is regenerated. S5: `CardId` plus the uniqueness refinement, with the issue path `cards[i].cardId`. S6: `>=22.18` plus the README note. S7: ajv 8.20.0 is pinned, uses `Ajv2020` with `strict: true`, and the schemas declare draft 2020-12. N5: regex is exact. S2: exported and tested, but rank is missing (S2 above). S8: exported, and the test checks it against `RULE`. N6, N8, N9 and N10 are fixed. Vectors: all 7 have identical `input`, `canonical` and `sha256`, the only name change is `skill-circle-suffix` → `skill-collision-suffix`, and the note is corrected.
2 Correctness: issues (B1). Guest and null-outfit parents are now rejected against 01 §3 and the 30 §4 flow. Other probes were fine: both parents missing with only a parent2 flag correctly fails for parent1; a strict-ULID overflow is rejected; `7ZZZ…` is accepted.
3 Test quality: ok, apart from the tests that lock in B1 (capture.test.ts:171-176). The ajv tests really validate all 7 vector captures plus 4 structural negatives and one positive control. The `checkMasterIds` tests check order, dedupe and null skipping. The changelog numbers match my re-run: 144 tests, 17 schemas, vectors regenerate byte-identical.
4 Fabrication check: ok. No game constants were added. I independently confirmed that each vector's sha256 equals sha256(canonical). The changelog output matches.
5 Security: ok / not applicable. No routes and no secrets. Input validation got stricter (ULID, cardId).
6 Free-tier constraints: ok / not applicable. ajv is a devDependency only.
7 Scope: minor issue (S1). `pnpm-lock.yaml` is outside Owns and not declared. Everything else is inside Owns. The `package.json` diff touches `engines` only, and the README diff is only the Node note.
8 Maintainability: ok. Dead `MASTER_FILE_NAMES` and the duplicate `STAT_KEYS` export are removed (no remaining references). Types are strict, versions are pinned exactly, and the ESLint ignore is narrowed. Nits N1–N3.

## Commands run
$ git diff --stat main...HEAD
 24 files changed, 372 insertions(+), 68 deletions(-)
$ git diff --name-only main...HEAD | grep -vE '^(packages/schema/|package.json$|\.editorconfig$|eslint.config.js$|README.md$|docs/changelog/T01b)'
pnpm-lock.yaml
$ node -v && pnpm -v
v25.9.0
11.22.0
$ pnpm install --frozen-lockfile
Scope: all 2 workspace projects
Already up to date
$ pnpm -r lint
$ eslint .
(exit 0)
$ pnpm -r typecheck
$ tsc -p tsconfig.json
$ pnpm -r test
 Test Files  4 passed (4)
      Tests  144 passed (144)
$ pnpm --filter @uma/schema build
$ node scripts/build-json.ts
wrote 17 schemas to .../packages/schema/json/
$ git status --porcelain              # after build
(empty, no drift)
$ (cd packages/schema && python3 scripts/make-vectors.py) && git status --porcelain
wrote 7 vectors
(empty, regenerated vectors byte-identical)
$ python3 compare main:fingerprint.vectors.json vs HEAD
7 7
True                                              # input, canonical and sha256 identical for all vectors
[('skill-circle-suffix', 'skill-collision-suffix')]
True                                              # sha256(canonical) == sha256 for every vector
$ pnpm exec prettier --check packages eslint.config.js package.json
All matched files use Prettier code style!
$ file agent/Uma.Agent.sln
agent/Uma.Agent.sln: Unicode text, UTF-8 (with BOM) text, with CRLF line terminators
$ node probe.mts        # temporary probe in the scratch dir, outside the repo, deleted afterwards; git status clean
non-guest outfit null (01 allows string|null): a non-guest parent needs an outfitId and no guestTrainer; a guest needs a guestTrainer
guest trainer unread: a non-guest parent needs an outfitId and no guestTrainer; a guest needs a guestTrainer
flag parent2: ok
flag corrected: a parent owner with no sparks needs a low_confidence field whose path is exactly "/sparks/<owner>" (owner parent2)
both missing, only parent2 flag: ... (owner parent1)
dup sync: [[["cards",2,"cardId"],"duplicate cardId (owned_cards.card_id is the primary key)"]]
OwnedCardsSync JSON has uniqueness: false
checkMasterIds string-as-iterable: 15
emitted shape msg: spark shape violated: exactly one blue, one pink and at most one green per owner (owner parent1)
