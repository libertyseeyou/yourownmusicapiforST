#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ST_DIR="${ST_DIR:-$HOME/SillyTavern}"; SLUG='netease-personal-music-source'; STAMP="$(date +%Y%m%d_%H%M%S)"
[[ -f "$ST_DIR/server.js" ]] || { echo '请通过 ST_DIR=/实际/SillyTavern/路径 指定酒馆目录。' >&2; exit 1; }
BACKEND="$ST_DIR/plugins/$SLUG"; BACKUP="${NPMS_BACKUP_ROOT:-$HOME/sillytavern-music-source-backups/remove-backend-$STAMP}"
if [[ -e "$BACKEND" ]]; then mkdir -p "$BACKUP"; mv "$BACKEND" "$BACKUP/backend"; echo "后端已移出并备份：$BACKUP/backend"; else echo '后端未安装，无需删除。'; fi
echo '前端扩展已保留。请自行重启 SillyTavern。'
