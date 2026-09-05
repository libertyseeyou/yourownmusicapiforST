#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

REPO_URL="${NPMS_REPO_URL:-https://github.com/libertyseeyou/yourownmusicapiforST.git}"
BRANCH="${NPMS_BRANCH:-main}"
WORKDIR="${TMPDIR:-$HOME/.cache}/netease-personal-music-source-install"

echo '== 你自己的音乐源：Termux 一键部署 =='

command -v pkg >/dev/null || { echo '请使用 Termux 执行本命令。' >&2; exit 1; }
pkg install git nodejs-lts -y
rm -rf "$WORKDIR"
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$WORKDIR"
cd "$WORKDIR"
bash scripts/install-termux.sh

echo
echo '部署完成。现在请重启 SillyTavern，再打开“你自己的音乐源”面板。'
