#!/usr/bin/env python3
"""Build docs/tasks/<TID>.prompt.md from the task card in 80-orchestration-plan.md §4 + optional notes.

Usage: scripts/mkprompt.py <TID> <slug> [notes-file]
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
tid, slug = sys.argv[1], sys.argv[2]
notes = Path(sys.argv[3]).read_text() if len(sys.argv) > 3 else ""
plan = (ROOT / "docs/specs/80-orchestration-plan.md").read_text()
m = re.search(rf"^### {tid} — (.+?)\n(.*?)(?=^### T\d\d|^## 5\.)", plan, re.S | re.M)
if not m:
    sys.exit(f"task card {tid} not found")
title, card = m.group(1).strip(), m.group(2).strip()
wt = ROOT.parent / "uma-musume-spark-calc.worktrees" / f"{tid}-{slug}"
branch = f"task/{tid}-{slug}"
prompt = f"""You are an implementing agent for the Uma Spark Calc project. Your task is **{tid} — {title}**.

Working directory: {wt} (a git worktree on branch `{branch}`). Stay inside it.

1. Read `AGENTS.md` in full and follow it exactly.
2. Read `docs/specs/00-overview.md`, `docs/specs/01-data-contracts.md`, `docs/specs/85-implementation-review.md` §3 (what the independent reviewer will check), the spec sections named in the card below, and the changelogs of the tasks you depend on in `docs/changelog/`.
3. Your task card (from `docs/specs/80-orchestration-plan.md` §4):

### {tid} — {title}
{card}

4. Only create or modify paths under **Owns**. Record any other change under *Cross-task edits* in your changelog.
5. Before finishing:
   - run the verification commands and paste their real output into `docs/changelog/{tid}-{slug}.md` (template `docs/changelog/_TEMPLATE.md`);
   - commit on `{branch}` with messages like `{tid}: …`;
   - don't push, and don't touch `main`.
6. Your final message: Status (Done/Partial/Blocked), the changelog path, the last commit hash, and any human action needed.
"""
if notes:
    prompt += "\n## Orchestrator notes\n" + notes
out = ROOT / "docs/tasks" / f"{tid}.prompt.md"
out.write_text(prompt)
print(out)
