# 你自己的音乐源 1.1.1

面向个人 SillyTavern 实例的账号音乐源：支持网易云音乐、QQ 音乐与服务器/设备本地音乐。后端作为 SillyTavern Server Plugin 运行，不需要额外开放音乐 API 端口。

## 功能

- 网易云音乐与 QQ 音乐二维码、Cookie 登录，两个平台凭据分开保存。
- 文字搜索：输入“歌曲 歌手”自动选择最佳匹配。
- 识别网易云、QQ 音乐单曲短链和歌单分享链接。
- 搜索、播放地址、歌词、封面、歌单与本地音乐 Range 流。
- 内置黑白极简播放器与酒馆助手播放器脚本适配器。
- Android Termux 与通用 Linux 双平台部署。

## 运行要求

- SillyTavern 1.17.0 或相近版本；
- Node.js 20 或更高版本；
- npm；
- 使用 Server Plugin 时，`config.yaml` 中需要 `enableServerPlugins: true`。

## Termux 安装

本地仓库安装：

```bash
bash scripts/install-termux.sh
```

GitHub 一键安装：

```bash
curl -fsSL https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-termux.sh | bash
```

## Linux 云酒馆安装

请使用**运行 SillyTavern 的同一 Linux 用户**执行，不建议使用 `sudo`，否则插件文件可能变成 root 所有。

本地仓库安装：

```bash
bash scripts/install-linux.sh
```

若 SillyTavern 不在常见目录：

```bash
ST_DIR=/path/to/SillyTavern bash scripts/install-linux.sh
```

GitHub 一键安装：

```bash
curl -fsSL https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-linux.sh | bash
```

也可以组合指定路径：

```bash
curl -fsSL https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-linux.sh | ST_DIR=/path/to/SillyTavern bash
```

安装器会尝试寻找：当前目录、`~/SillyTavern`、`/opt/SillyTavern`、`/app/SillyTavern`、`/workspace/SillyTavern` 等常见位置。

## Docker / 面板服

- 插件前端目录：`public/scripts/extensions/third-party/netease-personal-music-source`
- 插件后端目录：`plugins/netease-personal-music-source`
- 私密数据目录：`plugins/netease-personal-music-source/data`
- 音乐目录必须是**容器内部可见的绝对路径**，宿主机路径不能直接填写。
- 请把后端 `data` 与音乐目录放在持久化卷内，否则重建容器后登录信息和配置会丢失。
- 若容器镜像是不可写的，建议把完整 SillyTavern 目录或上述插件目录挂载为可写卷后再安装。

## 数据与备份

网易云 Cookie、QQ Cookie 和配置保存在：

```text
SillyTavern/plugins/netease-personal-music-source/data/
```

安装器升级时会先备份旧插件，并恢复该数据目录。默认备份位置：

```text
~/sillytavern-music-source-backups/
```

## 同源接口

```text
/api/plugins/netease-personal-music-source
```

主要接口包括：

- `/input/resolve?provider=qq|netease&input=...`
- `/?types=search|url|lyric|pic|playlist&provider=...`
- `/playlist/resolve`
- `/local/list`
- `/audio/:id`
- `/auth/status`、`/auth/qr/start`、`/auth/qr/check`

仅供个人使用，请遵守音乐平台服务条款及当地法律，不要公开分享 Cookie 或将接口暴露为公共音乐服务。
