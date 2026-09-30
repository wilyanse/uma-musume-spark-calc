#!/usr/bin/env bash
# .NET agent gates (T12 review S1/S2). Uses the exact spec paths (65 §4). A gate is skipped ONLY
# while its project is wholly absent, and the skip is reported as NOT RUN, never as a pass.
#
#   agent-gates.sh runtime        require the Microsoft.NETCore.App 8.x runtime (net8.0 tests)
#   agent-gates.sh core-tests     dotnet test agent/tests/Uma.Agent.Core.Tests
#   agent-gates.sh windows-build  dotnet build agent/src/Uma.Agent.Windows (EnableWindowsTargeting)
set -euo pipefail

# Run from the repository root; dotnet itself runs inside agent/ so agent/global.json selects the SDK.
cd "${AGENT_GATES_ROOT:-$(dirname "$0")/../..}"
dotnet_bin="${DOTNET_BIN:-dotnet}"
core_dir=agent/tests/Uma.Agent.Core.Tests
core_proj=$core_dir/Uma.Agent.Core.Tests.csproj
core_src=agent/src/Uma.Agent.Core
win_dir=agent/src/Uma.Agent.Windows
win_proj=$win_dir/Uma.Agent.Windows.csproj

not_run() {
  echo "::warning::$1 NOT RUN: $2 is not present yet. This is not a pass."
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    echo "- $1: **NOT RUN** ($2 absent)" >>"$GITHUB_STEP_SUMMARY"
  fi
}

case "${1:-}" in
  runtime)
    (cd agent && "$dotnet_bin" --version)
    "$dotnet_bin" --list-runtimes | tee /dev/stderr | grep -Eq '^Microsoft\.NETCore\.App 8\.' || {
      echo "::error::Microsoft.NETCore.App 8.x runtime is not installed; net8.0 tests cannot run"
      exit 1
    }
    ;;
  core-tests)
    if [[ -f "$core_proj" ]]; then
      (cd agent && "$dotnet_bin" test "${core_proj#agent/}" --configuration Release)
    elif [[ -e "$core_dir" || -e "$core_src" ]]; then
      echo "::error::$core_dir or $core_src exists but $core_proj does not; the spec test project is required"
      exit 1
    else
      not_run 'Agent Core tests' "$core_proj"
    fi
    ;;
  windows-build)
    if [[ -f "$win_proj" ]]; then
      (cd agent && "$dotnet_bin" build "${win_proj#agent/}" --configuration Release -p:EnableWindowsTargeting=true)
    elif [[ -e "$win_dir" ]]; then
      echo "::error::$win_dir exists but $win_proj does not"
      exit 1
    else
      not_run 'Windows agent build' "$win_proj"
    fi
    ;;
  *)
    echo "usage: agent-gates.sh runtime|core-tests|windows-build" >&2
    exit 2
    ;;
esac
