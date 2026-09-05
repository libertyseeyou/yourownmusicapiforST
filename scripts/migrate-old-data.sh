#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ST_DIR="${ST_DIR:-$HOME/SillyTavern}"
OLD_DIR="${OLD_MUSIC_API_DIR:-$HOME/music-api}"
NEW_DATA="$ST_DIR/plugins/netease-personal-music-source/data"
[ -d "$NEW_DATA" ] || { echo '请先安装插件。' >&2; exit 1; }
if [ -s "$OLD_DIR/cookie.txt" ]; then
  cp "$OLD_DIR/cookie.txt" "$NEW_DATA/cookie.txt"
  chmod 600 "$NEW_DATA/cookie.txt" 2>/dev/null || true
  echo '已复制旧 Cookie。'
fi
if [ -d "$OLD_DIR/local-music" ]; then
  node - "$OLD_DIR/local-music" "$NEW_DATA/config.json" <<'NODE'
const fs = require('fs');
const path = require('path');
const source = path.resolve(process.argv[2]);
const config = path.resolve(process.argv[3]);
fs.writeFileSync(config, JSON.stringify({ localMusicDir: source }, null, 2) + '\n', { mode: 0o600 });
NODE
  echo "已把本地音乐目录指向：$OLD_DIR/local-music（未复制音频文件）"
fi
echo '迁移完成，请重启 SillyTavern。'
