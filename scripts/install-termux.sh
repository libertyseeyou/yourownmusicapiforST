#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
command -v pkg >/dev/null || { echo '请在 Termux 中执行。' >&2; exit 1; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ST_DIR="${ST_DIR:-$HOME/SillyTavern}" exec bash "$ROOT/scripts/install-linux.sh"
