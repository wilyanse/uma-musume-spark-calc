#!/usr/bin/env python3
"""Build docs/tasks/<TID>.review-<N>.prompt.md for the independent reviewer.

Usage: scripts/mkreview.py <TID> <slug> <round>
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
tid, slug, rnd = sys.argv[1], sys.argv[2], int(sys.argv[3])
plan = (ROOT / "docs/specs/80-orchestration-plan.md").read_text()
m = re.search(rf"^### {tid} — (.+?)\n(.*?)(?=^### T\d\d|^## 5\.)", plan, re.S | re.M)
if not m:
    sys.exit(f"task card {tid} not found")
title, card = m.group(1).strip(), m.group(2).strip()
wt = ROOT.parent / "uma-musume-spark-calc.worktrees" / f"{tid}-{slug}"
scope = ("the full diff `git diff main...HEAD`" if rnd == 1 else
         f"the fixes since the previous review: read `docs/reviews/{tid}-review-{rnd-1}.md` in the MAIN checkout "
         f"({ROOT}/docs/reviews/) and check each Blocking item is resolved; also skim `git diff main...HEAD` for regressions")
prompt = f"""You are the **independent code reviewer** for task **{tid} — {title}** of the Uma Spark Calc project. You did not write this code. Be rigorous and specific; do not rubber-stamp.

Working directory: {wt} (branch `task/{tid}-{slug}`). **Read-only:** do not edit, create or delete tracked files, do not commit, do not push. You MAY run builds/tests (they write only to gitignored folders) and `git diff`/`git log`.

Read: `AGENTS.md`, `docs/specs/00-overview.md`, `docs/specs/01-data-contracts.md`, `docs/specs/85-implementation-review.md` (your process + checklist + output format), the spec sections named in the task card, and the worker's changelog `docs/changelog/{tid}-{slug}.md`.

Task card:
### {tid} — {title}
{card}

Review scope: {scope}.

Do all of:
1. Check every "Done when" item and each relevant contract detail in 01 against the code.
2. Re-run the verification commands the changelog claims (at least lint, typecheck and test for touched packages) and compare the output with what the changelog says.
3. Go through checklist items 1–8 in 85 §3.
4. Check scope: `git diff --stat main...HEAD` touches only the card's Owns paths (or declared cross-task edits).

Your final message must be **only** the review in the exact format of 85 §4 (Verdict, Blocking, Should fix, Nits, Checklist 1–8, Commands run with real trimmed output). Verdict CHANGES_REQUESTED requires at least one Blocking item; PASS means zero Blocking items. Reference findings as path:line.
"""
out = ROOT / "docs/tasks" / f"{tid}.review-{rnd}.prompt.md"
out.write_text(prompt)
print(out)
