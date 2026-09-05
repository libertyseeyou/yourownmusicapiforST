#!/usr/bin/env bash
set -euo pipefail
SLUG='netease-personal-music-source'; STAMP="$(date +%Y%m%d_%H%M%S)"
if [[ -z "${ST_DIR:-}" ]]; then for p in "$PWD" "$HOME/SillyTavern" "$HOME/sillytavern" "$HOME/Desktop/SillyTavern" "$HOME/Documents/SillyTavern" "$HOME/Downloads/SillyTavern" /opt/SillyTavern /app/SillyTavern /workspace/SillyTavern; do [[ -f "$p/server.js" ]] && ST_DIR="$p" && break; done; fi
[[ -n "${ST_DIR:-}" && -f "$ST_DIR/server.js" ]] || { echo '请通过 ST_DIR=/path/to/SillyTavern 指定酒馆目录。' >&2; exit 1; }
BACKEND="$ST_DIR/plugins/$SLUG"; BACKUP="${NPMS_BACKUP_ROOT:-$HOME/sillytavern-music-source-backups/remove-backend-$STAMP}"
if [[ -e "$BACKEND" ]]; then mkdir -p "$BACKUP"; mv "$BACKEND" "$BACKUP/backend"; echo "后端已移出并备份：$BACKUP/backend"; else echo '后端未安装，无需删除。'; fi
echo '前端扩展已保留。请自行重启 SillyTavern。'
