# T07 review, round 2 (claude-opus-5-5, high)

## Verdict: PASS

## Blocking
None. B1 from round 1 is fixed. `docs/design/app.css:225` now hides only cells with the `.hc` class. Only the S01 Portrait column (`build.mjs:120`, `:145`) and the S06 "#" column (`build.mjs:307`, `:347`) have that class, in both the header and body cells. The S07 tables have no hidden column and use `.fit` wrapping (`app.css:231`), and the split layouts stack below 720 px (`app.css:224`). I checked this three ways:
- The worker's probe passes.
- My own probe finds 0 row/header count mismatches, 0 clipped cells and 0 page overflow on all 7 screens × 2 viewports × 2 themes.
- I looked at the committed `S07-health-mobile-light.png` and scrolled 390 px captures of S06 and S07. Each header (SCENARIO/MODE/VETERANS, STAT/MAE/Σ, RULE/VALUE/STATUS, PARENT 1/PARENT 2/P(MEET TARGET)) sits over the right values, and nothing is clipped.

## Should fix
- [S1] `.prettierignore` (root, T01-owned). This is S6 from round 1, still open and now slightly worse. `npx prettier --check docs/design` reports 19 files, up from 18 because `probe-mobile.mjs` was added. A root `pnpm format` would rewrite the generated `tokens.css` and `screens/*.html`, and they would no longer match `build.mjs` output. The worker correctly declined to edit a file it doesn't own and listed this as an orchestrator follow-up (`docs/changelog/T07-design.md`, Review round 1 → Follow-ups). Suggestion: the orchestrator adds `docs/design/` to `.prettierignore` at merge.
- [S2] `docs/design/components.md:33` and `docs/design/bindings.md:161` name the n binding loosely: "`ModelSnapshot.nTrain`-equivalent" and "`ModelSnapshot` fitted-row count". 01 §13 already has the field, `ModelSnapshot.nSamples`, and `bindings.md:185` uses it for S07 "Training rows". Suggestion: bind the S06 n to `ModelSnapshot.nSamples` in both places. `nTrain` doesn't exist in the contract, so T13 could look for it.
- [S3] `docs/design/components.md:35` says the "needs at least 10 held-out veterans" assumption is tracked in "(Q-76)". The threshold question is actually Q-78 (`docs/OPEN_QUESTIONS.md:62`); Q-76 is per-skill n. Suggestion: change the reference to Q-78.

## Nits
- [N1] `docs/design/app.css:205-233`: the "/* fixes */" override layer grew this round. A second `@media (max-width:720px)` block now overrides earlier rules (`.detailgrid`, `.split.s2` at :222/:224), where these changes could have gone into the original rules. The changelog already lists folding this in as a follow-up.
- [N2] The top-level sections of `docs/changelog/T07-design.md` are stale:
  - Summary (:9) still says "38 contrast pairs"; there are now 40 (80 checks).
  - The Files list (:18 area) doesn't include `probe-mobile.mjs`. It appears only in the round-1 file list.
- [N3] `docs/design/probe-mobile.mjs:18` compares headers against the first `tbody tr` only. A later row with a different visible cell count would pass. It's fine for the current data (my all-rows probe found 0 mismatches), but it's a weak guard.
- [N4] `docs/design/build.mjs:361`: `pinkGradeGain` is shown as "✓ verified / in-game observation". 01 §12 lists `{"1":1,"2":1,"3":1}` but gives no verified flag or source. It's illustrative and footer-labelled, but T03 decides that status, not the design. Consider "⚠ unverified" or a placeholder like the other rows.
- [N5] S07 "Sample counts" (`build.mjs:373`) still has an empty `<th scope="col"></th>` over the low-data tag column. Screen readers will announce an unnamed column header; add `<span class="sr">Note</span>`.

## Checklist
1. Spec conformance: ok.
   - All 10 §1 files exist.
   - `manifest.json` lists exactly 21 PNGs, each existing at the stated size.
   - `verify.mjs` passes 80 contrast checks, including the new `bar.range` on `bg` (3.31/4.77) and `surface` on `danger` (6.54/7.60).
   - `bindings.md` covers S01–S07, with gaps sent to Q-70…Q-78.
   - The H5 request is in the changelog.
   - 10 §2 "n on every prediction" is now met: P(meet) cells show `n=142`, and the aptitude and spark headings show "model n=142" (`build.mjs:309`, `:314`, `:323`).
   - The stat-bar binding (statCap) now matches across `bindings.md:58`, `components.md:36` and `build.mjs:163`/`:177`.
   - Minor naming issues: S2, S3.
2. Correctness: ok. The mobile header shift is fixed (see Blocking). The range bar no longer uses opacity (`app.css:109`), so the rendered colour is the colour `verify.mjs` checks. No overflow or clipping in any screen × viewport × theme combination in my probe; the only "clipped" hits were `.sr` visually-hidden elements, which is expected.
3. Test quality: ok.
   - Rebuild from HEAD, re-export and re-verify reproduce the committed output: no working-tree changes afterwards, identical manifest, and every PNG byte-identical.
   - The `verify.mjs` and `probe-mobile.mjs` output matches the changelog's round-1 Verification block line for line.
   - Both scripts exit non-zero on failure.
   - Weakness: N3.
4. Fabrication check: ok. The illustrative rule values that looked like game constants are now `x.xx` / "formula placeholder" with source "placeholder, not a real value (Q-3)". UI thresholds are unified (10 held-out, 2 veterans) and recorded as design assumptions in Q-78. The McQueen rank/rating claim is corrected. The changelog output is real. Minor: N4.
5. Security: ok. No secrets and no game art. `docs/design/node_modules` is gitignored (`.gitignore:12`). The PNGs are renders of the prototypes, not game screenshots.
6. Free-tier constraints: n/a. These are static design artefacts.
7. Scope: ok. `git diff --stat main...HEAD` touches only `docs/design/**`, `docs/changelog/T07-design.md` and `docs/OPEN_QUESTIONS.md` (a declared cross-task edit). `git merge-tree` against current main (4b3b042) is clean. `.prettierignore` was correctly left alone.
8. Maintainability: minor issues. The CSS patch layer grew (N1) and the changelog summary is stale (N2). Playwright is still pinned exactly. The ARIA misuse from round 1 is gone: there's no `role=tablist` on the label row (`build.mjs:185`), and the S03 queue is a `<nav>` of links using `aria-current` (`build.mjs:219`).

## Commands run
```
$ git log --oneline main..HEAD
7e02d18 T07: fix review round 1 (mobile table headers, contrast, ARIA, n, thresholds)
bfae53e T07: design tokens, S01-S07 prototypes, exports, bindings, copy, H5 request
$ git diff --stat main...HEAD | tail -1
 44 files changed, 2715 insertions(+)     # docs/OPEN_QUESTIONS.md, docs/changelog/T07-design.md, docs/design/** only

$ cd docs/design && node build.mjs && node export.mjs     # regenerate in the worktree
built tokens.css, 7 screens, index.html
exported 21 PNGs
$ git status --short; git diff --stat
(empty — regenerated html/css/png/manifest identical to committed files)

$ node verify.mjs | grep -v '^ok'; echo verify-exit=$?
files: 7 top-level + 7 screen html checked
manifest: 21 PNGs checked for existence and exact dimensions
contrast: 80 pair checks
RESULT: all checks passed
verify-exit=0
$ node verify.mjs | grep -c '^ok'
80
$ node verify.mjs | grep -E 'bar.range|surface on danger'
ok   light bar.range on surface: 3.64 >= 3
ok   dark  bar.range on surface: 4.33 >= 3
ok   light bar.range on bg: 3.31 >= 3
ok   dark  bar.range on bg: 4.77 >= 3
ok   light surface on danger: 6.54 >= 4.5
ok   dark  surface on danger: 7.60 >= 4.5

$ node probe-mobile.mjs S01-roster S02-veteran S03-review S04-cards S05-targets S06-planner S07-health; echo probe-exit=$?
ok   S01-roster {"caption":"Veterans","heads":4,"bodyCells":4,"misaligned":0,"clipped":0,"wrapOverflow":0,"pageOverflow":0}
ok   S06-planner {"caption":"Ranked parent pairs","heads":3,"bodyCells":3,"misaligned":0,"clipped":0,"wrapOverflow":0,"pageOverflow":0}
ok   S07-health {"caption":"Sample counts","heads":4,"bodyCells":4,...,"pageOverflow":0}
ok   S07-health {"caption":"Holdout error (MAE, stat points)","heads":3,"bodyCells":3,...}
ok   S07-health {"caption":"Inheritance rules (rules-1)","heads":3,"bodyCells":3,...}
RESULT: all tables aligned, nothing clipped
probe-exit=0

# reviewer probe (temp script, deleted afterwards): all tbody rows vs visible header count, overflow-hidden clipping, page overflow; 7 screens × {1440,390} × {light,dark}
1440 light S01..S07  rowMis 0, pageOver 0, clipped only .sr elements
390  light S07-health {"rowMis":0,"emptyTh":1,"clipped":[],"overEls":[],"pageOver":0}
390  dark  S06-planner {"rowMis":0,"emptyTh":0,"clipped":[".sr only"],"overEls":[],"pageOver":0}
(all 28 combinations: rowMis 0, overEls [], pageOver 0; emptyTh 1 on S07 → N5)
# visual check: committed S07-health-mobile-light.png + scrolled 390px captures of S06/S07 — headers over correct columns, n=142 visible, rule placeholders x.xx shown

$ grep -n "Q-7[0-9]" docs/OPEN_QUESTIONS.md | tail -2
57:## Q-77 (T07) Where the draft deck and planner settings persist
62:## Q-78 (T07) UI thresholds for empty states are design assumptions
$ grep -n nSamples docs/specs/01-data-contracts.md
ModelSnapshot = { id, kind: 'training-v1', masterVersion, trainedAt, nSamples,

$ npx prettier --check docs/design 2>&1 | tail -1
[warn] Code style issues found in 19 files. Run Prettier with --write to fix.

$ pnpm -r lint && pnpm -r typecheck && pnpm -r test
 Test Files  4 passed (4)
      Tests  124 passed (124)
exit=0

$ git merge-tree --write-tree main HEAD >/dev/null && echo merge-tree-clean
merge-tree-clean
```
