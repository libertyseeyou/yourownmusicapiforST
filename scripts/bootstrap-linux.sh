#!/usr/bin/env bash
set -euo pipefail
REPO_URL="${NPMS_REPO_URL:-https://github.com/libertyseeyou/yourownmusicapiforST.git}"
BRANCH="${NPMS_BRANCH:-main}"
command -v git >/dev/null || { echo '需要 git。请先通过系统包管理器安装 git。' >&2; exit 1; }
command -v node >/dev/null || { echo '需要 Node.js 20+。' >&2; exit 1; }
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/npms-install.XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$WORKDIR/repo"
cd "$WORKDIR/repo"
bash scripts/install-linux.sh
