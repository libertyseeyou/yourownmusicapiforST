#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ST_DIR="${ST_DIR:-$HOME/SillyTavern}"
FRONTEND="$ST_DIR/public/scripts/extensions/third-party/netease-personal-music-source"
BACKEND="$ST_DIR/plugins/netease-personal-music-source"
STAMP="$(date +%Y%m%d_%H%M%S)"
for target in "$FRONTEND" "$BACKEND"; do
  if [ -e "$target" ]; then mv "$target" "${target}.removed-${STAMP}"; echo "已移出：$target"; fi
done
echo '请重启 SillyTavern。备份未删除，可手动恢复。'
