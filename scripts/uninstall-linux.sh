#!/usr/bin/env bash
set -euo pipefail
SLUG="netease-personal-music-source"
REPO_MARK='github.com/libertyseeyou/yourownmusicapiforST'
if [[ -z "${ST_DIR:-}" ]]; then
  for candidate in "$PWD" "$HOME/SillyTavern" "$HOME/sillytavern" "$HOME/Desktop/SillyTavern" "$HOME/Documents/SillyTavern" "$HOME/Downloads/SillyTavern" /opt/SillyTavern /opt/sillytavern /app/SillyTavern /app/sillytavern /workspace/SillyTavern /workspace/sillytavern; do
    [[ -f "$candidate/server.js" ]] && ST_DIR="$candidate" && break
  done
fi
[[ -n "${ST_DIR:-}" && -f "$ST_DIR/server.js" ]] || { echo '请通过 ST_DIR=/path/to/SillyTavern 指定酒馆目录。' >&2; exit 1; }
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_ROOT="${NPMS_BACKUP_ROOT:-$HOME/sillytavern-music-source-backups/uninstall-$STAMP}"
mkdir -p "$BACKUP_ROOT"
index=0
third_party="$ST_DIR/public/scripts/extensions/third-party"
if [[ -d "$third_party" ]]; then
  for directory in "$third_party"/*; do
    [[ -d "$directory" ]] || continue
    manifest="$directory/manifest.json"
    if [[ "$(basename "$directory")" == "$SLUG" ]] || { [[ -f "$manifest" ]] && grep -q "$REPO_MARK" "$manifest"; }; then
      index=$((index + 1)); label='frontend'; [[ $index -gt 1 ]] && label="frontend-$index"
      mv "$directory" "$BACKUP_ROOT/$label"; echo "已移出并备份：$directory"
    fi
  done
fi
backend="$ST_DIR/plugins/$SLUG"
[[ -e "$backend" ]] && mv "$backend" "$BACKUP_ROOT/backend" && echo "已移出并备份：$backend"
echo '卸载器没有停止或重启 SillyTavern。请由你自行重启。'
echo "备份位于：$BACKUP_ROOT"
