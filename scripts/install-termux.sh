#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ST_DIR="${ST_DIR:-$HOME/SillyTavern}"
FRONTEND_DST="$ST_DIR/public/scripts/extensions/third-party/netease-personal-music-source"
BACKEND_DST="$ST_DIR/plugins/netease-personal-music-source"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_ROOT="${NPMS_BACKUP_ROOT:-$HOME/sillytavern-music-source-backups/$STAMP}"

EXISTING_GITHUB_FRONTEND=""
for manifest in "$ST_DIR"/public/scripts/extensions/third-party/*/manifest.json; do
  [[ -f "$manifest" ]] || continue
  if grep -q 'github.com/libertyseeyou/yourownmusicapiforST' "$manifest"; then
    EXISTING_GITHUB_FRONTEND="$(dirname "$manifest")"
    break
  fi
done
if [[ -n "$EXISTING_GITHUB_FRONTEND" ]]; then
  FRONTEND_DST="$EXISTING_GITHUB_FRONTEND"
  echo "检测到插件菜单已安装前端：$FRONTEND_DST"
  echo '本次只安装/更新 Server Plugin 后端，不复制第二份前端。'
fi

[ -f "$ST_DIR/server.js" ] || { echo "未找到 SillyTavern：$ST_DIR" >&2; exit 1; }
command -v node >/dev/null || { echo '未找到 Node.js，请先执行 pkg install nodejs-lts' >&2; exit 1; }
command -v npm >/dev/null || { echo '未找到 npm' >&2; exit 1; }

backup_if_exists() {
  local target="$1"
  if [ -e "$target" ]; then
    mkdir -p "$BACKUP_ROOT"
    local label
    case "$target" in
      "$FRONTEND_DST") label="frontend" ;;
      "$BACKEND_DST") label="backend" ;;
      *) label="$(basename "$target")" ;;
    esac
    mv "$target" "$BACKUP_ROOT/$label"
    echo "已备份到酒馆目录外：$BACKUP_ROOT/$label"
  fi
}

PRESERVE_DIR="${TMPDIR:-$HOME/.cache}/npms-preserve-${STAMP}"
mkdir -p "$PRESERVE_DIR"
if [ -d "$BACKEND_DST/data" ]; then
  cp -R "$BACKEND_DST/data" "$PRESERVE_DIR/data"
fi

if [[ -z "$EXISTING_GITHUB_FRONTEND" ]]; then backup_if_exists "$FRONTEND_DST"; fi
backup_if_exists "$BACKEND_DST"
mkdir -p "$(dirname "$FRONTEND_DST")" "$(dirname "$BACKEND_DST")"
if [[ -z "$EXISTING_GITHUB_FRONTEND" ]]; then cp -R "$ROOT/frontend" "$FRONTEND_DST"; fi
cp -R "$ROOT/backend" "$BACKEND_DST"
rm -rf "$BACKEND_DST/node_modules"
if [ -d "$PRESERVE_DIR/data" ]; then
  rm -rf "$BACKEND_DST/data"
  cp -R "$PRESERVE_DIR/data" "$BACKEND_DST/data"
  echo '已保留原有 Cookie、本地音乐目录设置与个人配置。'
fi
rm -rf "$PRESERVE_DIR"
(
  cd "$BACKEND_DST"
  npm install --omit=dev --ignore-scripts
)
chmod 700 "$BACKEND_DST/data" "$BACKEND_DST/data/local-music" 2>/dev/null || true
chmod 600 "$BACKEND_DST/data/config.json" 2>/dev/null || true

CONFIG="$ST_DIR/config.yaml"
if [ -f "$CONFIG" ]; then
  if grep -qE '^[[:space:]]*enableServerPlugins:' "$CONFIG"; then
    sed -i -E 's/^[[:space:]]*enableServerPlugins:.*/enableServerPlugins: true/' "$CONFIG"
  else
    printf '\nenableServerPlugins: true\n' >> "$CONFIG"
  fi
else
  echo "警告：未找到 $CONFIG，请手动设置 enableServerPlugins: true"
fi

echo
echo '安装完成。请重启 SillyTavern。'
echo "前端：$FRONTEND_DST"
echo "后端：$BACKEND_DST"
echo 'Cookie 请在酒馆扩展面板中粘贴，或使用 scripts/migrate-old-data.sh 迁移现有本机数据。'
