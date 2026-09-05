#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { echo '请在 macOS 终端中运行。' >&2; exit 1; }
command -v git >/dev/null || { echo '需要 git：xcode-select --install' >&2; exit 1; }
command -v node >/dev/null || { echo '需要 Node.js 20+：https://nodejs.org/' >&2; exit 1; }
REPO_URL="${NPMS_REPO_URL:-https://github.com/libertyseeyou/yourownmusicapiforST.git}";BRANCH="${NPMS_BRANCH:-main}";WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/npms-macos-install.XXXXXX")";trap 'rm -rf "$WORKDIR"' EXIT
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$WORKDIR/repo";cd "$WORKDIR/repo";bash scripts/install-macos.sh
