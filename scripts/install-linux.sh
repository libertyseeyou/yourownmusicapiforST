#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SLUG="netease-personal-music-source"
STAMP="$(date +%Y%m%d_%H%M%S)"

find_st_dir() {
  if [[ -n "${ST_DIR:-}" ]]; then printf '%s\n' "$ST_DIR"; return; fi
  local candidate
  for candidate in \
    "$PWD" "$HOME/SillyTavern" "$HOME/sillytavern" \
    "/opt/SillyTavern" "/opt/sillytavern" "/app/SillyTavern" "/app/sillytavern" \
    "/workspace/SillyTavern" "/workspace/sillytavern"; do
    [[ -f "$candidate/server.js" ]] && { printf '%s\n' "$candidate"; return; }
  done
  return 1
}

ST_DIR="$(find_st_dir || true)"
if [[ -z "$ST_DIR" || ! -f "$ST_DIR/server.js" ]]; then
  echo '未找到 SillyTavern。请指定实际目录后重试：' >&2
  echo '  ST_DIR=/path/to/SillyTavern bash scripts/install-linux.sh' >&2
  exit 1
fi
ST_DIR="$(cd "$ST_DIR" && pwd)"
FRONTEND_DST="$ST_DIR/public/scripts/extensions/third-party/$SLUG"
BACKEND_DST="$ST_DIR/plugins/$SLUG"
BACKUP_ROOT="${NPMS_BACKUP_ROOT:-$HOME/sillytavern-music-source-backups/$STAMP}"
RUN_USER="${USER:-$(id -un 2>/dev/null || echo user)}"
PRESERVE_DIR="${TMPDIR:-/tmp}/npms-preserve-$RUN_USER-$STAMP"

command -v node >/dev/null || { echo '未找到 Node.js；请先安装 Node.js 20 或更高版本。' >&2; exit 1; }
command -v npm >/dev/null || { echo '未找到 npm。' >&2; exit 1; }
command -v git >/dev/null || echo '提示：本地安装不需要 git；一键下载脚本需要 git。'
node -e "const major=Number(process.versions.node.split('.')[0]);if(major<20){console.error('需要 Node.js 20+，当前：'+process.version);process.exit(1)}"
[[ -w "$ST_DIR" ]] || { echo "当前用户无权写入 $ST_DIR。请使用运行 SillyTavern 的同一用户执行，不建议 sudo。" >&2; exit 1; }

backup_if_exists() {
  local target="$1" label="$2"
  if [[ -e "$target" ]]; then
    mkdir -p "$BACKUP_ROOT"
    mv "$target" "$BACKUP_ROOT/$label"
    echo "已备份：$BACKUP_ROOT/$label"
  fi
}

mkdir -p "$PRESERVE_DIR"
if [[ -d "$BACKEND_DST/data" ]]; then cp -a "$BACKEND_DST/data" "$PRESERVE_DIR/data"; fi
backup_if_exists "$FRONTEND_DST" frontend
backup_if_exists "$BACKEND_DST" backend
mkdir -p "$(dirname "$FRONTEND_DST")" "$(dirname "$BACKEND_DST")"
cp -a "$ROOT/frontend" "$FRONTEND_DST"
cp -a "$ROOT/backend" "$BACKEND_DST"
rm -rf "$BACKEND_DST/node_modules"
if [[ -d "$PRESERVE_DIR/data" ]]; then
  rm -rf "$BACKEND_DST/data"
  cp -a "$PRESERVE_DIR/data" "$BACKEND_DST/data"
  echo '已保留网易云/QQ Cookie、本地目录设置与个人配置。'
fi
rm -rf "$PRESERVE_DIR"
(
  cd "$BACKEND_DST"
  npm install --omit=dev --ignore-scripts
)
chmod 700 "$BACKEND_DST/data" "$BACKEND_DST/data/local-music" 2>/dev/null || true
find "$BACKEND_DST/data" -maxdepth 1 -type f \( -name '*cookie*.txt' -o -name 'config.json' \) -exec chmod 600 {} + 2>/dev/null || true

CONFIG="$ST_DIR/config.yaml"
if [[ -f "$CONFIG" ]]; then
  if grep -qE '^[[:space:]]*enableServerPlugins:' "$CONFIG"; then
    sed -i.bak-npms -E 's/^[[:space:]]*enableServerPlugins:.*/enableServerPlugins: true/' "$CONFIG"
  else
    printf '\nenableServerPlugins: true\n' >> "$CONFIG"
  fi
else
  echo "警告：未找到 $CONFIG，请手动设置 enableServerPlugins: true" >&2
fi

echo
echo '安装完成。请使用原有方式重启 SillyTavern。'
echo "SillyTavern：$ST_DIR"
echo "前端：$FRONTEND_DST"
echo "后端：$BACKEND_DST"
echo '若运行在 Docker 中，请把插件目录和音乐目录放在持久化卷内，否则重建容器后会丢失。'
