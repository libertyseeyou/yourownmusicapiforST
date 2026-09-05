# 你自己的音乐源 1.2.0

作者：**灯灯&提提**

面向社区中不同设备、不同部署方式的 SillyTavern 用户。支持网易云音乐、QQ 音乐与运行酒馆设备上的本地音乐；后端作为 SillyTavern Server Plugin 运行，不需要另开音乐 API 端口。

## 功能

- 网易云音乐与 QQ 音乐二维码、Cookie 登录，两个平台凭据分开保存。
- 输入“歌曲 歌手”搜索最佳匹配；识别网易云、QQ 单曲短链与歌单分享链接。
- 搜索、播放地址、歌词、封面、歌单与本地音乐 HTTP Range 流。
- 内置黑白极简播放器；可扫描并为现有酒馆助手播放器创建适配副本，绝不覆盖原脚本。
- 支持 Android/Termux、Windows、macOS、Linux 桌面、云服务器、面板服与 Docker。
- 从 SillyTavern 菜单安装前端后，面板会在当前页面动态出现，无需手动刷新。

## 运行要求

- SillyTavern 1.17.0 或相近版本；
- Node.js 20 或更高版本；
- npm；
- `config.yaml` 中启用 `enableServerPlugins: true`（安装器会自动设置并留下备份）。

> 安装器不会启动、停止或重启 SillyTavern。安装后请关闭旧实例，再按你原有的方式自行启动。

## 推荐安装顺序

1. 在 SillyTavern 中打开“扩展 → 安装扩展”。
2. 安装：`https://github.com/libertyseeyou/yourownmusicapiforST`
3. 前端面板出现后，复制与你系统对应的一键部署命令。
4. 在运行 SillyTavern 的同一台设备上执行命令。
5. 安装完成后自行重启 SillyTavern。

已通过插件菜单安装前端时，部署脚本只安装/更新后端，不会复制第二份前端。

## Android / Termux

```bash
curl -fsSL https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-termux.sh | bash
```

自定义酒馆目录：

```bash
curl -fsSL https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-termux.sh | ST_DIR=/实际/SillyTavern/路径 bash
```

本地仓库：`bash scripts/install-termux.sh`

## Windows / PowerShell（Beta）

在 PowerShell 中执行：

```powershell
irm https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-windows.ps1 | iex
```

自动找不到酒馆时，先指定目录再执行：

```powershell
$env:ST_DIR='D:\SillyTavern'
irm https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-windows.ps1 | iex
```

本地仓库：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

支持 Windows PowerShell 5.1 与 PowerShell 7 常用语法；会寻找当前目录、用户目录、桌面、文档和下载目录下的 `SillyTavern`。Windows 版本已完成静态审计，但因当前发布环境没有真实 Windows，暂标记 Beta，欢迎反馈具体系统版本与报错全文。

## macOS

```bash
curl -fsSL https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-macos.sh | bash
```

自定义目录：

```bash
curl -fsSL https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-macos.sh | ST_DIR=/Users/你的名字/SillyTavern bash
```

本地仓库：`bash scripts/install-macos.sh`

需要 Node.js 20+ 和 Git。若没有 Git，可先执行 `xcode-select --install`。安装器兼容 macOS 的 BSD `sed`，不会调用 `sudo`。

## Linux / 云服务器 / 面板服

请使用运行 SillyTavern 的同一用户执行，不建议 `sudo`：

```bash
curl -fsSL https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-linux.sh | bash
```

自定义目录：

```bash
curl -fsSL https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-linux.sh | ST_DIR=/path/to/SillyTavern bash
```

本地仓库：`bash scripts/install-linux.sh`

自动探测当前目录、`~/SillyTavern`、桌面/文档/下载目录以及 `/opt`、`/app`、`/workspace` 下的常见路径。

## Docker

- 前端位于 `public/scripts/extensions/third-party/` 下；后端位于 `plugins/netease-personal-music-source/`。
- 音乐目录必须填写**容器内部可见的绝对路径**，不能填写宿主机路径。
- 建议将后端 `data` 和音乐目录挂载到持久化卷，否则重建容器后登录与配置会丢失。
- 在容器内以运行 SillyTavern 的用户执行 Linux 安装命令；只读镜像需要先提供可写挂载。

## 卸载

卸载脚本只把插件前后端移到酒馆目录外的备份目录，不删除用户音乐，也不会停止或重启酒馆。

```bash
# Termux
bash scripts/uninstall-termux.sh

# macOS
bash scripts/uninstall-macos.sh

# Linux
bash scripts/uninstall-linux.sh
```

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-windows.ps1
```

## 数据与备份

私密数据位于：

```text
SillyTavern/plugins/netease-personal-music-source/data/
```

包含网易云 Cookie、QQ Cookie、本地音乐目录设置与配置。升级时会保留该目录。默认备份位于：

```text
~/sillytavern-music-source-backups/
```

Windows 对应用户主目录下的 `sillytavern-music-source-backups`。

## 本地音乐路径示例

```text
Windows: C:\Users\你的名字\Music
macOS:   /Users/你的名字/Music
Linux:   /home/你的名字/Music
Termux:  /data/data/com.termux/files/home/storage/music
```

## 同源接口

基址：`/api/plugins/netease-personal-music-source`

- `/input/resolve?provider=qq|netease&input=...`
- `/?types=search|url|lyric|pic|playlist&provider=...`
- `/playlist/resolve`
- `/local/list`
- `/audio/:id`
- `/auth/status`、`/auth/qr/start`、`/auth/qr/check`

仅供个人合法使用。请遵守音乐平台服务条款与所在地法律；不要公开分享 Cookie，也不要把接口暴露为公共音乐服务。
