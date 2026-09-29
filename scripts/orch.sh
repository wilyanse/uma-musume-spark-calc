#!/usr/bin/env bash
# Orchestration helper (orchestrator-only). Usage:
#   scripts/orch.sh worker <TASK_ID> <slug>         # create the worktree if needed, run the Sonnet worker on docs/tasks/<TASK_ID>.prompt.md
#   scripts/orch.sh review <TASK_ID> <slug> <round> # run the Opus reviewer on docs/tasks/<TASK_ID>.review-<round>.prompt.md
# Logs: .orch/logs/<TASK_ID>-{worker,review-N}.log (gitignored)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WT_BASE="$(dirname "$ROOT")/uma-musume-spark-calc.worktrees"
mode="$1"; tid="$2"; slug="$3"; round="${4:-1}"
wt="$WT_BASE/$tid-$slug"; branch="task/$tid-$slug"
mkdir -p "$ROOT/.orch/logs" "$WT_BASE"
if [ ! -d "$wt" ]; then
  git -C "$ROOT" worktree add -b "$branch" "$wt" main
  git -C "$wt" config user.email willjose51@gmail.com
  git -C "$wt" config user.name "Will Jose"
fi
case "$mode" in
  worker)
    prompt="$ROOT/docs/tasks/$tid.prompt.md"; log="$ROOT/.orch/logs/$tid-worker.log"
    [ -n "${ORCH_RESUME:-}" ] && prompt="$ROOT/docs/tasks/$tid.fix-$round.prompt.md" && log="$ROOT/.orch/logs/$tid-fix-$round.log"
    cd "$wt" && hermes chat --oneshot -Q --yolo --provider anthropic -m claude-sonnet-5-5 --reasoning medium \
      --max-turns 400 --query-file "$prompt" >"$log" 2>&1
    ;;
  review)
    prompt="$ROOT/docs/tasks/$tid.review-$round.prompt.md"; log="$ROOT/.orch/logs/$tid-review-$round.log"
    cd "$wt" && hermes chat --oneshot -Q --yolo --provider anthropic -m claude-opus-5-5 --reasoning high \
      --max-turns 200 --query-file "$prompt" >"$log" 2>&1
    ;;
esac
echo "exit=$? log=$log"
