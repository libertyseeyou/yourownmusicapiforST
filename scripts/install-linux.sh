#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_URL="${NPMS_REPO_URL:-https://github.com/libertyseeyou/yourownmusicapiforST.git}"
BRANCH="${NPMS_BRANCH:-main}"
SLUG="netease-personal-music-source"
STAMP="$(date +%Y%m%d_%H%M%S)"

find_st_dir() {
  if [[ -n "${ST_DIR:-}" ]]; then printf '%s\n' "$ST_DIR"; return; fi
  local candidate
  for candidate in "$PWD" "$HOME/SillyTavern" "$HOME/sillytavern" "$HOME/Desktop/SillyTavern" "$HOME/Documents/SillyTavern" "$HOME/Downloads/SillyTavern" "/opt/SillyTavern" "/opt/sillytavern" "/app/SillyTavern" "/app/sillytavern" "/workspace/SillyTavern" "/workspace/sillytavern"; do
    [[ -f "$candidate/server.js" ]] && { printf '%s\n' "$candidate"; return; }
  done
  return 1
}

ST_DIR="$(find_st_dir || true)"
if [[ -z "$ST_DIR" || ! -f "$ST_DIR/server.js" ]]; then
  echo '未找到 SillyTavern。请通过 ST_DIR 指定实际目录。' >&2
  exit 1
fi
ST_DIR="$(cd "$ST_DIR" && pwd)"
FRONTEND_DST="$ST_DIR/public/scripts/extensions/third-party/$SLUG"
BACKEND_DST="$ST_DIR/plugins/$SLUG"
BACKUP_ROOT="${NPMS_BACKUP_ROOT:-$HOME/sillytavern-music-source-backups/$STAMP}"
PRESERVE_DIR="${TMPDIR:-/tmp}/npms-preserve-${USER:-user}-$STAMP"

command -v git >/dev/null || { echo '需要 Git；后端自动更新依赖 Git 仓库。' >&2; exit 1; }
command -v node >/dev/null || { echo '需要 Node.js 20+。' >&2; exit 1; }
command -v npm >/dev/null || { echo '未找到 npm。' >&2; exit 1; }
node -e "const m=Number(process.versions.node.split('.')[0]);if(m<20){console.error('需要 Node.js 20+，当前：'+process.version);process.exit(1)}"
[[ -w "$ST_DIR" ]] || { echo "当前用户无权写入 $ST_DIR。请使用运行酒馆的同一用户执行。" >&2; exit 1; }

EXISTING_GITHUB_FRONTEND=""
for manifest in "$ST_DIR"/public/scripts/extensions/third-party/*/manifest.json; do
  [[ -f "$manifest" ]] || continue
  if grep -q 'github.com/libertyseeyou/yourownmusicapiforST' "$manifest"; then EXISTING_GITHUB_FRONTEND="$(dirname "$manifest")"; break; fi
done
if [[ -n "$EXISTING_GITHUB_FRONTEND" ]]; then
  FRONTEND_DST="$EXISTING_GITHUB_FRONTEND"
  echo "检测到插件菜单已安装前端：$FRONTEND_DST"
fi

mkdir -p "$PRESERVE_DIR"
# Old copied backend stored data/ at its root; Git mode stores it under backend/data/.
if [[ -d "$BACKEND_DST/backend/data" ]]; then cp -R "$BACKEND_DST/backend/data" "$PRESERVE_DIR/data";
elif [[ -d "$BACKEND_DST/data" ]]; then cp -R "$BACKEND_DST/data" "$PRESERVE_DIR/data"; fi

if [[ -e "$BACKEND_DST" ]]; then
  mkdir -p "$BACKUP_ROOT"
  mv "$BACKEND_DST" "$BACKUP_ROOT/backend"
  echo "旧后端已备份：$BACKUP_ROOT/backend"
fi
mkdir -p "$(dirname "$BACKEND_DST")"
git clone --branch "$BRANCH" "$REPO_URL" "$BACKEND_DST"

if [[ -d "$PRESERVE_DIR/data" ]]; then
  rm -rf "$BACKEND_DST/backend/data"
  mkdir -p "$BACKEND_DST/backend"
  cp -R "$PRESERVE_DIR/data" "$BACKEND_DST/backend/data"
  echo '已迁移 Cookie、本地目录设置与个人配置。'
else
  mkdir -p "$BACKEND_DST/backend/data/local-music"
fi
touch "$BACKEND_DST/backend/data/.gitkeep"
rm -rf "$PRESERVE_DIR"

(
  cd "$BACKEND_DST/backend"
  npm ci --omit=dev --ignore-scripts
  node -e "const fs=require('fs'),crypto=require('crypto'),path=require('path');const h=crypto.createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex');fs.writeFileSync(path.join('node_modules','.npms-lock-hash'),h+'\\n')"
)

if [[ -z "$EXISTING_GITHUB_FRONTEND" ]]; then
  mkdir -p "$(dirname "$FRONTEND_DST")"
  cp -R "$BACKEND_DST/frontend" "$FRONTEND_DST"
fi
chmod 700 "$BACKEND_DST/backend/data" "$BACKEND_DST/backend/data/local-music" 2>/dev/null || true
for private_file in "$BACKEND_DST/backend/data"/*cookie*.txt "$BACKEND_DST/backend/data/config.json"; do [[ -f "$private_file" ]] && chmod 600 "$private_file" 2>/dev/null || true; done

CONFIG="$ST_DIR/config.yaml"
if [[ -f "$CONFIG" ]]; then
  cp "$CONFIG" "$CONFIG.bak-npms"
  if grep -qE '^[[:space:]]*enableServerPlugins:' "$CONFIG"; then sed -i -E 's/^[[:space:]]*enableServerPlugins:.*/enableServerPlugins: true/' "$CONFIG"; else printf '\nenableServerPlugins: true\n' >> "$CONFIG"; fi
  if grep -qE '^[[:space:]]*enableServerPluginsAutoUpdate:' "$CONFIG"; then sed -i -E 's/^[[:space:]]*enableServerPluginsAutoUpdate:.*/enableServerPluginsAutoUpdate: true/' "$CONFIG"; else printf 'enableServerPluginsAutoUpdate: true\n' >> "$CONFIG"; fi
else
  echo "警告：未找到 $CONFIG，请手动开启 Server Plugin 与自动更新。" >&2
fi

echo
echo 'Git 型后端安装完成。请完整重启 SillyTavern。'
echo "后端仓库：$BACKEND_DST"
echo '以后后端发布更新时，只需完整重启酒馆；SillyTavern 会先 git pull，再加载后端。'
