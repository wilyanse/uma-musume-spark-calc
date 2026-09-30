#!/usr/bin/env bash
# Orchestration helper (orchestrator-only). Usage:
#   scripts/orch.sh worker <TASK_ID> <slug>         # create the worktree if needed, run the configured worker on docs/tasks/<TASK_ID>.prompt.md
#   scripts/orch.sh review <TASK_ID> <slug> <round> # run the Opus reviewer on docs/tasks/<TASK_ID>.review-<round>.prompt.md
# Logs: .orch/logs/<TASK_ID>-{worker,review-N}.log (gitignored)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WT_BASE="$(dirname "$ROOT")/uma-musume-spark-calc.worktrees"
mode="$1"; tid="$2"; slug="$3"; round="${4:-1}"
wt="$WT_BASE/$tid-$slug"; branch="task/$tid-$slug"
# Opus first; the orchestrator explicitly switches to Sol after a provider failure.
provider="${ORCH_PROVIDER:-anthropic}"
model="${ORCH_MODEL:-claude-opus-5-5}"
reasoning="${ORCH_REASONING:-medium}"
# Ignore profile defaults so its fallback chain cannot select an unrequested model.
# Credentials still load. Provider/model/effort and tool budget are explicit per run.
mkdir -p "$ROOT/.orch/logs" "$WT_BASE"
if [ ! -d "$wt" ]; then
  git -C "$ROOT" worktree add -b "$branch" "$wt" main
  # Linked worktrees inherit the repository identity; do not race on shared .git/config.
fi
case "$mode" in
  worker)
    prompt="$ROOT/docs/tasks/$tid.prompt.md"; log="$ROOT/.orch/logs/$tid-worker.log"
    [ -n "${ORCH_RESUME:-}" ] && prompt="$ROOT/docs/tasks/$tid.fix-$round.prompt.md" && log="$ROOT/.orch/logs/$tid-fix-$round.log"
    if [ -f "$log" ]; then cp "$log" "$log.$(date +%Y%m%d-%H%M%S).previous"; fi
    cd "$wt" && hermes chat --oneshot -Q --ignore-user-config --yolo --provider "$provider" -m "$model" --reasoning "$reasoning" \
      --max-turns 400 --query-file "$prompt" >"$log" 2>&1
    ;;
  review)
    prompt="$ROOT/docs/tasks/$tid.review-$round.prompt.md"; log="$ROOT/.orch/logs/$tid-review-$round.log"
    if [ -f "$log" ]; then cp "$log" "$log.$(date +%Y%m%d-%H%M%S).previous"; fi
    cd "$wt" && hermes chat --oneshot -Q --ignore-user-config --yolo --provider "$provider" -m "$model" --reasoning "$reasoning" \
      --max-turns 200 --query-file "$prompt" >"$log" 2>&1
    ;;
esac
echo "exit=$? log=$log"
