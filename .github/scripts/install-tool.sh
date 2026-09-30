#!/usr/bin/env bash
# Downloads a pinned release binary, verifies its SHA-256 and installs it into <dest-dir>.
# Prints nothing secret. Fails on any digest mismatch.
#
#   install-tool.sh age|actionlint <dest-dir>
#
# Digests were taken from the GitHub release asset metadata and re-computed locally with
# `shasum -a 256` on 2026-09-30 (see docs/changelog/T12-devops.md).
set -euo pipefail

tool="${1:?usage: install-tool.sh age|actionlint <dest-dir>}"
dest="${2:?usage: install-tool.sh age|actionlint <dest-dir>}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=linux-amd64 ;;
  Darwin-arm64) platform=darwin-arm64 ;;
  *) echo "::error::install-tool: unsupported platform $(uname -s)-$(uname -m)"; exit 1 ;;
esac

case "$tool/$platform" in
  age/linux-amd64)
    url=https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-linux-amd64.tar.gz
    sha=cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10 ;;
  age/darwin-arm64)
    url=https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-darwin-arm64.tar.gz
    sha=e2020b073c44f692685a24d6abc378817eb81ffaaf49fd0531ef8565f767f2f5 ;;
  actionlint/linux-amd64)
    url=https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz
    sha=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8 ;;
  actionlint/darwin-arm64)
    url=https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_darwin_arm64.tar.gz
    sha=aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f ;;
  *) echo "::error::install-tool: unknown tool $tool"; exit 1 ;;
esac

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl -fsSL --max-time 120 -o "$work/pkg.tar.gz" "$url"
if command -v sha256sum >/dev/null; then
  actual=$(sha256sum "$work/pkg.tar.gz" | cut -d' ' -f1)
else
  actual=$(shasum -a 256 "$work/pkg.tar.gz" | cut -d' ' -f1)
fi
if [[ "$actual" != "$sha" ]]; then
  echo "::error::install-tool: $tool digest mismatch (expected $sha, got $actual)"
  exit 1
fi
tar -xzf "$work/pkg.tar.gz" -C "$work"
mkdir -p "$dest"
if [[ "$tool" == age ]]; then
  install -m 0755 "$work/age/age" "$dest/age"
  install -m 0755 "$work/age/age-keygen" "$dest/age-keygen"
  "$dest/age" --version
else
  install -m 0755 "$work/actionlint" "$dest/actionlint"
  "$dest/actionlint" --version | head -n 1
fi
