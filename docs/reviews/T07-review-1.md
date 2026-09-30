# T07 review, round 1 (claude-opus-5-5, high)

## Verdict: CHANGES_REQUESTED

## Blocking
- [B1] docs/design/app.css:223 — Column headers are wrong in the committed S07 mobile export (`screens/S07-health-mobile-light.png`). The mobile rule `.tbl-wrap td:first-child,.tbl-wrap th:first-child:not([scope=row]){display:none}` hides the first header cell. The first body cell in the S07 tables is a `<th scope="row">` (build.mjs:371-381), so it stays visible and every header shifts one column left:
  - "Sample counts" shows MODE above the scenario names, VETERANS above the mode, and the count column has no header.
  - "Holdout error" shows MAE above the stat names and Σ above the MAE values, so the MAE values read as σ.
  - The rules table has the same shift.

  A Playwright probe at 390×844 finds header/body column-count mismatches in 3 tables and 3 overflowing containers (the sample-count values are clipped), all on S07 only. The changelog says the mobile tables were fixed (docs/changelog/T07-design.md:75). These mislabelled tables will go to the user for H5 and to T13 as the reference ("build exactly as in docs/design", 60 §2).
  - Required fix: limit the rule to tables whose first column is a `td` (e.g. `.tbl-wrap tr > td:first-child` plus the matching header, via a class on S01/S06 tables), or add `.hm` to the columns meant to be hidden.
  - Make the S07 tables fit or scroll at 390 px without clipping values.
  - Then re-run `node build.mjs && node export.mjs && node verify.mjs` and paste the output into the changelog.

## Should fix
- [S1] app.css:109 — `.rb .rng` renders `bar.range` at `opacity:.75`. The pair verify.mjs checks is `bar.range` on `surface` at full opacity (3.31:1 light). The rendered colour is about 2.52:1 on `surface` and 2.37:1 on `bg`, and the S06 `.detail` cell uses the `bg` background (app.css:167). So the AA pass reported for this token isn't what the prototype shows. Remove the opacity, or darken the token so the blended colour still passes 3:1 on `bg`.
- [S2] build.mjs:307 / components.md:33 — 10 §2 says "every prediction shows the mean, a p10–p90 bar and the sample size n". The P(meet target) cells and the aptitude "72% ≥ A" probabilities (build.mjs:315-317) show no n. components.md says ProbabilityBar shows "low data" when n < 10, but the prototype never shows it, and there's no binding for which n applies to pMeet. Add the n (e.g. model n or `opts.samples`), bind it in bindings.md, or raise a Q.
- [S3] bindings.md:58 vs build.mjs:176 / components.md:36 — The S02 stat bar length is described two different ways. bindings.md says "value ÷ scenario statCap". The prototype and components.md use a fixed 2000 cap (`stats[i] / 20`, aria-label "of 2000 max"). Pick one; the statCap binding is the one grounded in 01 §11.
- [S4] components.md:35 vs copy.md:228 — The held-out empty-state threshold is "needs ≥ 10" in one file and "needs at least 25 veterans" in the other. copy.md:195 "Import at least 3 veterans" is a third made-up threshold. None comes from a spec. Make them consistent, and either source them (e.g. derive from the 80/20 holdout split) or mark them as design assumptions.
- [S5] build.mjs:184 — `role="tablist"` sits on a div whose children are `<label>`s with no `role="tab"`. That's an ARIA required-children violation, which axe reports as serious. build.mjs:218 has a related problem: `role="listbox"` wraps focusable `<a role="option">` links. T13 will likely copy these patterns, and 60 §4 runs axe on S03. Remove the roles from the no-JS prototype, or make them valid.
- [S6] docs/design/** is not in `.prettierignore`. `npx prettier --check docs/design` reports 18 unformatted files, and the root `pnpm format` (`prettier --write .`) would rewrite the generated `tokens.css` and `screens/*.html`, so they would no longer match `build.mjs` output. Add `docs/design/` to `.prettierignore` (declared cross-task edit, T01 owns it), or format the files.

## Nits
- [N1] docs/changelog/T07-design.md:34 — It says McQueen's "rank/rating … are made up". Screenshot 01 shows A+ and 13,471, which are exactly the values used, so they're real, not invented. The changelog should say so.
- [N2] docs/OPEN_QUESTIONS.md:22 — The new IDs start at Q-70, but AGENTS.md says `Q-<next number>` and the last existing ID is Q-3. The choice (probably to avoid collisions with parallel tasks) isn't explained under Decisions.
- [N3] build.mjs:251 — The S04 Friend slot offers only the LB4/LB3 options and has no level input. bindings.md:114 promises "LB via select (0–4), level".
- [N4] bindings.md:139 — "weight > 0" is described as mirroring the `CmTarget` schema, but `optionalSkills[].weight` is a plain `z.number()` (packages/schema/src/cm-target.ts:24). Call it a client-side rule or raise a Q.
- [N5] build.mjs:360 — The illustrative S07 rules rows (activation 0.70/0.80/0.90, grandparentWeight 0.5) look like real game constants, with the source "community wiki (illustrative)". They're labelled, but obvious placeholders (e.g. "x.xx") would keep T03/T13 from copying them.
- [N6] verify.mjs:12 — It doesn't check that `app.css` exists, that `index.html` links every screen/PNG, or that `tokens.json` has the semantic names 10 §1 requires. All three are true today; they're just not enforced. Rendered pairs such as `.badge-count` (`surface` on `danger`) aren't in `contrast-pairs`.

## Checklist
1. Spec conformance: issues. All 10 §1 files exist. Manifest has exactly 21 PNGs at the right dimensions, verify.mjs passes, and 76 contrast checks pass. bindings.md covers S01–S07, with 8 gaps sent to Q-70…Q-77. The H5 request is in the changelog (:93-112). Field names match 01 and `packages/schema` (RosterVeteran, CaptureField, ReviewItem, CmTarget, ModelSnapshot, enums). Problems: the S07 mobile export mislabels its columns (B1); n is missing on some predictions (S2); stat-bar binding is inconsistent (S3).
2. Correctness: issues. Mobile header shift on S07 (B1). The rendered range bar has lower contrast than the verified pair (S1). No layout overflow on the other 13 screen/viewport combinations (Playwright probe).
3. Test quality: ok. The verify.mjs output I got matches the changelog line for line (the same 76 ok lines and sampled values). `build.mjs` is deterministic: a rebuild in a scratch copy gives no diff. `export.mjs` gives byte-identical PNGs and the same manifest. verify.mjs exits 1 on failure. Coverage gaps are in N6.
4. Fabrication check: minor. No game constants in data files. Prototype values are footer-labelled "Illustrative data". Changelog output is real. Small issues: made-up UI thresholds (S4), realistic-looking illustrative rule values (N5), and a wrong "made up" claim (N1).
5. Security: ok. No secrets, no game art (placeholders only), no screenshots outside docs/reference. `node_modules` is gitignored.
6. Free-tier constraints: n/a (static design artefacts, no runtime).
7. Scope: ok. The diff touches only `docs/design/**`, the task changelog and `docs/OPEN_QUESTIONS.md`, which is declared under Cross-task edits. `git merge-tree` against current main is clean.
8. Maintainability: minor issues. The generator/export/verify split is sensible and Playwright is pinned exactly (1.62.1, lockfile included). app.css has patch layers ("/* fixes */" at :205-227 overriding earlier rules such as `.detailgrid`, `.statrow`) that should be folded in. Prettier isolation is missing (S6).

## Commands run
```
$ git diff --stat main...HEAD | tail -1
 43 files changed, 2598 insertions(+)        # docs/OPEN_QUESTIONS.md, docs/changelog/T07-design.md, docs/design/** only

$ cd docs/design && node verify.mjs | grep -v '^ok'; echo "exit=$?"
files: 7 top-level + 7 screen html checked
manifest: 21 PNGs checked for existence and exact dimensions
contrast: 76 pair checks
RESULT: all checks passed
exit=0
$ node verify.mjs | grep -c '^ok'
76
$ node verify.mjs | grep '^ok' | sed -n '1,4p;37,40p;75,76p'
ok   light text on bg: 14.89 >= 4.5
ok   dark  text on bg: 15.82 >= 4.5
ok   light muted on bg: 6.28 >= 4.5
ok   dark  muted on bg: 8.21 >= 4.5
ok   light star on surface: 4.03 >= 3
ok   dark  star on surface: 10.01 >= 3
ok   light bar.mean on surface: 8.51 >= 3
ok   dark  bar.mean on surface: 12.65 >= 3
ok   light grade.G.on on grade.G: 7.65 >= 4.5
ok   dark  grade.G.on on grade.G: 7.65 >= 4.5
$ ls screens | wc -l
      28

# rebuild + re-export in a scratch copy (~/.hermes/cache/scratch/t07review/design), then compare with the committed files
$ node build.mjs && diff -r -q . <worktree>/docs/design; echo "build-diff-exit=$?"
built tokens.css, 7 screens, index.html
build-diff-exit=0
$ node export.mjs && node verify.mjs | tail -2
exported 21 PNGs
contrast: 76 pair checks
RESULT: all checks passed
$ diff manifest.json <worktree>/manifest.json && echo manifest-same; for f in screens/*.png; do cmp -s ...; done
manifest-same                      # no PNG differs

# Playwright probe: header vs first-row visible cell counts, overflowing containers
$ node probe3.mjs
1440 S01..S07 {"over":0,"unnamed":[],"tableHeaderMismatch":0}   (all 7)
390  S01..S06 {"over":0,"unnamed":[],"tableHeaderMismatch":0}
390  S07-health {"over":3,"unnamed":[],"tableHeaderMismatch":3}
$ node probe.mjs   (S07 @390)
S07-health [{"head":["Mode","Veterans",""],"firstRow":["URA Finale","Independent","61",""]},
            {"head":["MAE","σ"],"firstRow":["Speed","31.2","38.0"]},
            {"head":["Value","Status"],"firstRow":["activation.blue","1★ 0.70 · 2★ 0.80 · ","⚠ unverified"]}]

# rendered range-bar contrast (bar.range at opacity .75)
light bar.range@.75 on bg(detail) #84ac62 2.37 full: 3.31
light bar.range@.75 on surface 2.52
dark bar.range@.75 on bg(detail) #497028 3.19 full: 4.77
dark bar.range@.75 on surface 3.02

$ pnpm -r lint && pnpm -r typecheck && pnpm -r test
$ eslint .
$ tsc -p tsconfig.json
$ vitest run
 Test Files  4 passed (4)
      Tests  124 passed (124)

$ npx prettier --check docs/design | tail -3
[warn] docs/design/tokens.json
[warn] docs/design/verify.mjs
[warn] Code style issues found in 18 files. Run Prettier with --write to fix.

$ git merge-tree --write-tree main HEAD >/dev/null && echo clean
merge-tree: clean
```
