#!/usr/bin/env bash
set -euo pipefail
SLUG="netease-personal-music-source"
if [[ -z "${ST_DIR:-}" ]]; then
  for candidate in "$PWD" "$HOME/SillyTavern" "$HOME/sillytavern" /opt/SillyTavern /opt/sillytavern /app/SillyTavern /app/sillytavern; do
    [[ -f "$candidate/server.js" ]] && ST_DIR="$candidate" && break
  done
fi
[[ -n "${ST_DIR:-}" && -f "$ST_DIR/server.js" ]] || { echo '请通过 ST_DIR=/path/to/SillyTavern 指定酒馆目录。' >&2; exit 1; }
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_ROOT="${NPMS_BACKUP_ROOT:-$HOME/sillytavern-music-source-backups/uninstall-$STAMP}"
mkdir -p "$BACKUP_ROOT"
for pair in "public/scripts/extensions/third-party/$SLUG:frontend" "plugins/$SLUG:backend"; do
  rel="${pair%%:*}"; label="${pair##*:}"; target="$ST_DIR/$rel"
  [[ -e "$target" ]] && mv "$target" "$BACKUP_ROOT/$label" && echo "已移出并备份：$target"
done
echo "请重启 SillyTavern。备份位于：$BACKUP_ROOT"
