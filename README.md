# 你自己的音乐源 1.8.0

作者：**灯灯&提提**

面向社区中不同设备、不同部署方式的 SillyTavern 用户。支持网易云音乐、QQ 音乐与运行酒馆设备上的本地音乐；后端作为 SillyTavern Server Plugin 运行，不需要另开音乐 API 端口。

## 功能

- 网易云音乐与 QQ 音乐二维码、Cookie 登录，两个平台凭据分开保存。
- 登录后自动读取账号歌单目录；按需载入前 300 首（推荐）或前 500 首，后端硬上限 500 首。
- 输入“歌曲 歌手”搜索最佳匹配；识别网易云、QQ 单曲短链与歌单分享链接。
- 搜索、播放地址、歌词、封面、歌单与本地音乐 HTTP Range 流。
- 内置黑白极简播放器；可扫描并为现有酒馆助手播放器创建适配副本，绝不覆盖原脚本。
- 支持将 GDStudio/Meting 型第三方源播放器一键改为本机接口副本；网易云与 QQ 安全映射，未支持源不错误替换。
- 支持 Android/Termux、Windows、macOS、Linux 桌面、云服务器、面板服与 Docker。
- 从 SillyTavern 菜单安装前端后，面板会在当前页面动态出现，无需手动刷新。
- 最终版纸张式分栏 UI：主页、播放器、本地音乐、部署与工具五个标签页，兼容手机和桌面。
- 导入账号歌单或分享歌单后自动播放第一首；本地音乐可与网络歌单融合并按来源去重。
- 文字搜索优先匹配高置信度本地音乐；分享链接、歌单链接和歌单 ID 严格使用指定音乐平台。
- 播放器进度条下方显示当前同步歌词与翻译，按歌曲时间轴逐句流动。
- 可选的主页面悬浮歌词栏：支持透明背景、自定义字体颜色、晕染颜色、位置、字号和阴影强度。
- 主页面悬浮播放器支持自由拖动、缩放、播放控制、进度拖拽、播放顺序和当前列表预览；无歌词时显示预设占位文字。
- Cookie 输入默认折叠；部署页可切换“安装/更新后端”和“删除后端”，删除后端时保留前端。


## 1.7.0 更新公告

本次更新完善了主页面悬浮播放器：

- 播放栏配色统一为六个并列方案：灰黑底浅色字、灰白底深色字、深色毛玻璃、浅色毛玻璃、继承酒馆 CSS、自定义。
- “继承酒馆 CSS”会读取当前酒馆实际可见组件的计算样式，适配不同主题的字体、颜色、背景、边框和阴影。
- 支持自定义播放栏 CSS，并提供方案导入、导出；自定义内容仅作用于播放控制栏和歌曲列表。
- 歌词显示层与播放栏、歌曲列表分离，歌词字体、颜色和晕染强度独立保留。
- 歌词晕染增强隔离，适配包含全局滤镜和文字样式覆盖的主题。
- 保留自由拖动、自由缩放、播放控制、进度拖拽、播放顺序和歌曲列表预览。
- 后端接口、账号数据、Cookie 和本地音乐目录均不受影响，本次无需更新后端。


## 1.7.1 更新公告

- 修复部分 WebView / TauriTavern 环境下网易云二维码生成成功但二维码内容为空的问题。
- 增加二维码响应结构兼容、Base64 图片前缀补全和二维码本地兜底生成。
- 将二维码生成库声明为后端直接依赖，降低不同安装环境中的依赖解析差异。
- 工具页播放器脚本扫描改为异步分批处理，减少 TauriTavern WebView 卡顿。
- 部署页和工具页避免在打开页面时执行不必要的扫描或网络操作。
- 收窄播放栏 CSS 输入框及导入/导出按钮的视觉高度。

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

## 后端自动更新与一次性迁移

从 1.8.0 开始，后端目录是完整 Git 仓库。旧版本用户需要再运行一次当前平台的部署命令：

1. 安装器备份原后端；
2. 暂存并恢复 Cookie、QQ Cookie、配置与本地目录设置；
3. 将本仓库克隆到 `SillyTavern/plugins/netease-personal-music-source/`；
4. 安装后端依赖；
5. 开启 SillyTavern Server Plugin 自动更新。

迁移完成后：

```text
发布后端更新 → 完整重启 SillyTavern → 酒馆自动 git pull → 加载新后端
```

仅刷新网页不会重载 Server Plugin，包含后端更新时必须完整重启酒馆。

## Windows / PowerShell（Beta）

推荐使用 **PowerShell 7**（`pwsh`）。Windows 自带的 PowerShell 5.1 默认按系统代码页（常见为 GBK）解析远程脚本，`irm | iex` 时中文提示容易显示成乱码，看起来像“装不上”。安装命令本身没有问题。

### 安装前

1. 安装 [Node.js 20+](https://nodejs.org/)，安装时勾选 npm。
2. 确认酒馆目录里有 `server.js`。
3. 用 **管理员以外的普通用户** 打开 PowerShell。不需要管理员权限。

检查环境：

```powershell
node -v
npm -v
```

`node -v` 应显示 `v20` 或更高。

### 推荐命令（PowerShell 7）

```powershell
pwsh -NoProfile -Command "irm https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-windows.ps1 | iex"
```

自动找不到酒馆时：

```powershell
$env:ST_DIR='D:\SillyTavern'
pwsh -NoProfile -Command "irm https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-windows.ps1 | iex"
```

把 `D:\SillyTavern` 换成你的实际路径。

### Windows PowerShell 5.1 防乱码写法

如果只能用系统自带 PowerShell，不要直接 `irm | iex`。改成先按 UTF-8 下载再执行：

```powershell
$script = Join-Path $env:TEMP 'npms-bootstrap-windows.ps1'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-windows.ps1' -OutFile $script
powershell -NoProfile -ExecutionPolicy Bypass -File $script
```

指定酒馆目录：

```powershell
$env:ST_DIR='D:\SillyTavern'
$script = Join-Path $env:TEMP 'npms-bootstrap-windows.ps1'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-windows.ps1' -OutFile $script
powershell -NoProfile -ExecutionPolicy Bypass -File $script
```

### 安装成功后

1. 完全退出旧的 SillyTavern 窗口。
2. 用原来的 `Start.bat` 或启动方式重新打开酒馆。
3. 在扩展里打开「你自己的音乐源」，点「刷新状态」。
4. 后端版本应显示 `1.5.2`。

安装器会把后端迁移为 Git 仓库并执行首次依赖安装，**不会自动重启酒馆**。完成这一次迁移后，后续后端更新由 SillyTavern 在启动时自动拉取。

### 常见问题

- 中文变成乱码或方块：改用上面的 5.1 防乱码写法，或安装 PowerShell 7。
- `未找到 SillyTavern`：先设置 `$env:ST_DIR='你的酒馆路径'`。
- `需要 Node.js 20+`：从 nodejs.org 安装当前 LTS，重新打开 PowerShell。
- `npm install 失败`：确认能访问 npm；如需代理，先设置 `$env:HTTPS_PROXY='http://127.0.0.1:7890'`。
- 执行策略拦截：命令里的 `-ExecutionPolicy Bypass` 只对这一次进程生效，不会改系统策略。

本地仓库安装：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

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
SillyTavern/plugins/netease-personal-music-source/backend/data/
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
- `/account/playlists`、`/account/playlist/:id`（账号歌单目录与限量载入）
- `/local/list`
- `/audio/:id`
- `/auth/status`、`/auth/qr/start`、`/auth/qr/check`

仅供个人合法使用。请遵守音乐平台服务条款与所在地法律；不要公开分享 Cookie，也不要把接口暴露为公共音乐服务。


## 1.7.2 更新公告

- 修复 TauriTavern 将 `index.html` 当作二维码接口成功回传时的误报；现在会明确提示后端暂未适配。
- 工具页新增 TauriTavern 兼容说明，列出当前可用范围与限制。
- 悬浮歌词增加“固定歌词位置”和“歌词点击穿透”两个独立开关，默认关闭。
- 两个开关均可单独使用：固定位置关闭拖动，点击穿透不拦截下方界面。

> TauriTavern 目前可以加载本插件前端，但本插件所需的后端暂未适配。因此 TT 中暂不可用网易云 / QQ 音乐登录、二维码、在线曲库和本地音乐后端功能；普通 SillyTavern 用户不受影响。


## 1.7.3 更新公告

- 全面增强播放器后台播放稳定性。
- 增加音频停滞、缓冲等待、断流和临时播放地址失效后的自动恢复。
- 自动保留当前歌曲进度，恢复音频流后从原位置继续播放。
- 补偿后台切歌事件延迟，减少歌曲播放结束后停在原地的情况。
- 后台播放增强默认生效，无需额外开启选项；系统媒体控制暂不纳入本版本。
- 超长悬浮歌词改为左右滚动，不再显示省略号。
- 插件页播放进度条支持鼠标、触摸和手写笔拖动。
- 工具页加入听歌排行榜彩蛋，按 user 总时长和各角色聊天中的听歌时长排行。

> 手机系统仍可能在彻底冻结或回收酒馆进程时中止网页音频；在普通后台降频、短暂断流和音频读取停滞情况下，播放器会自动尝试恢复。


## 1.8.0 更新公告

- 后端部署升级为 Git 型 Server Plugin。
- 现有用户只需再运行一次后端部署命令，安装器会自动备份旧后端并迁移 Cookie、QQ Cookie、本地目录设置和个人配置。
- 迁移完成后，SillyTavern 每次完整启动时会先检查并拉取后端更新，不再需要重复执行部署命令。
- 后端依赖锁发生变化时，零依赖加载器会自动执行一次 `npm ci --omit=dev`；依赖未变化时不会重复安装。
- 健康状态新增 Git 自动更新状态与当前后端提交号。
- 后端 1.6.1 用于首次 Git 自动更新实机验证。

> 自动更新需要设备安装 Git，并在 `config.yaml` 中开启 `enableServerPlugins: true` 与 `enableServerPluginsAutoUpdate: true`。更新失败时酒馆会继续加载本地已有版本。
