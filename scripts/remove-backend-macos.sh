#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { echo '请在 macOS 终端中运行。' >&2; exit 1; }
URL='https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/remove-backend-linux.sh'
curl -fsSL "$URL" | ST_DIR="${ST_DIR:-}" NPMS_BACKUP_ROOT="${NPMS_BACKUP_ROOT:-}" bash
