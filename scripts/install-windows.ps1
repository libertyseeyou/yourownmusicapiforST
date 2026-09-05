param(
    [string]$STDir = $env:ST_DIR,
    [string]$BackupRoot = $env:NPMS_BACKUP_ROOT
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Slug = 'netease-personal-music-source'
$RepoMark = 'github.com/libertyseeyou/yourownmusicapiforST'
$Root = Split-Path -Parent $PSScriptRoot
$Stamp = Get-Date -Format 'yyyyMMdd_HHmmss'

function Test-SillyTavernPath([string]$Path) {
    if (-not $Path) { return $false }
    return Test-Path -LiteralPath (Join-Path $Path 'server.js') -PathType Leaf
}

function Find-SillyTavern([string]$ExplicitPath) {
    if ($ExplicitPath) {
        $expanded = [Environment]::ExpandEnvironmentVariables($ExplicitPath.Trim('"'))
        if (Test-SillyTavernPath $expanded) {
            return (Resolve-Path -LiteralPath $expanded).Path
        }
        throw "ST_DIR 指向的目录不是 SillyTavern：$expanded"
    }

    $candidates = @((Get-Location).Path)
    if ($PSScriptRoot) {
        $candidates += $PSScriptRoot
        $candidates += (Split-Path -Parent $PSScriptRoot)
    }
    if ($HOME) {
        $candidates += (Join-Path $HOME 'SillyTavern')
        $candidates += (Join-Path $HOME 'sillytavern')
        $candidates += (Join-Path $HOME 'Desktop\SillyTavern')
        $candidates += (Join-Path $HOME 'Documents\SillyTavern')
        $candidates += (Join-Path $HOME 'Downloads\SillyTavern')
    }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-SillyTavernPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw "未找到 SillyTavern。请先执行 `$env:ST_DIR='D:\你的\SillyTavern'，再重新运行安装命令。"
}

function Copy-Directory([string]$Source, [string]$Destination) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}

function Move-ToBackup([string]$Target, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Target)) { return }
    New-Item -ItemType Directory -Force -Path $script:ResolvedBackupRoot | Out-Null
    $destination = Join-Path $script:ResolvedBackupRoot $Label
    if (Test-Path -LiteralPath $destination) {
        Remove-Item -LiteralPath $destination -Recurse -Force
    }
    Move-Item -LiteralPath $Target -Destination $destination
    Write-Host "已备份：$destination"
}

Write-Host '== 你自己的音乐源：Windows 安装 ==' -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw '需要 Node.js 20+：https://nodejs.org/'
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw '未找到 npm.cmd，请重新安装包含 npm 的 Node.js 20+。'
}
$nodeMajor = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -lt 20) {
    throw "需要 Node.js 20+，当前版本：$(& node -v)"
}

$STDir = Find-SillyTavern $STDir
$ThirdPartyRoot = Join-Path $STDir 'public\scripts\extensions\third-party'
$PluginsRoot = Join-Path $STDir 'plugins'
$FrontendDestination = Join-Path $ThirdPartyRoot $Slug
$BackendDestination = Join-Path $PluginsRoot $Slug
if (-not $BackupRoot) {
    $BackupRoot = Join-Path $HOME "sillytavern-music-source-backups\$Stamp"
}
$script:ResolvedBackupRoot = [Environment]::ExpandEnvironmentVariables($BackupRoot)
$PreserveDirectory = Join-Path ([IO.Path]::GetTempPath()) "npms-preserve-$PID-$Stamp"

$ExistingGithubFrontend = $null
if (Test-Path -LiteralPath $ThirdPartyRoot) {
    foreach ($directory in Get-ChildItem -LiteralPath $ThirdPartyRoot -Directory -ErrorAction SilentlyContinue) {
        $manifest = Join-Path $directory.FullName 'manifest.json'
        if (-not (Test-Path -LiteralPath $manifest)) { continue }
        try {
            if ((Get-Content -LiteralPath $manifest -Raw) -match [regex]::Escape($RepoMark)) {
                $ExistingGithubFrontend = $directory.FullName
                break
            }
        } catch { }
    }
}
if ($ExistingGithubFrontend) {
    $FrontendDestination = $ExistingGithubFrontend
    Write-Host "检测到插件菜单已安装前端：$FrontendDestination"
    Write-Host '本次只安装/更新 Server Plugin 后端，不复制第二份前端。'
}

try {
    New-Item -ItemType Directory -Force -Path $PreserveDirectory | Out-Null
    $oldData = Join-Path $BackendDestination 'data'
    if (Test-Path -LiteralPath $oldData) {
        Copy-Directory $oldData (Join-Path $PreserveDirectory 'data')
    }

    if (-not $ExistingGithubFrontend) {
        Move-ToBackup $FrontendDestination 'frontend'
    }
    Move-ToBackup $BackendDestination 'backend'
    New-Item -ItemType Directory -Force -Path $ThirdPartyRoot, $PluginsRoot | Out-Null
    if (-not $ExistingGithubFrontend) {
        Copy-Directory (Join-Path $Root 'frontend') $FrontendDestination
    }
    Copy-Directory (Join-Path $Root 'backend') $BackendDestination

    $nodeModules = Join-Path $BackendDestination 'node_modules'
    if (Test-Path -LiteralPath $nodeModules) {
        Remove-Item -LiteralPath $nodeModules -Recurse -Force
    }
    $preservedData = Join-Path $PreserveDirectory 'data'
    if (Test-Path -LiteralPath $preservedData) {
        $newData = Join-Path $BackendDestination 'data'
        if (Test-Path -LiteralPath $newData) {
            Remove-Item -LiteralPath $newData -Recurse -Force
        }
        Copy-Directory $preservedData $newData
        Write-Host '已保留网易云/QQ Cookie、本地目录设置与个人配置。'
    }

    Push-Location $BackendDestination
    try {
        & npm.cmd install --omit=dev --ignore-scripts
        if ($LASTEXITCODE -ne 0) { throw "npm install 失败，退出码：$LASTEXITCODE" }
    } finally {
        Pop-Location
    }

    $configPath = Join-Path $STDir 'config.yaml'
    if (Test-Path -LiteralPath $configPath) {
        Copy-Item -LiteralPath $configPath -Destination "$configPath.bak-npms" -Force
        $config = Get-Content -LiteralPath $configPath -Raw
        if ($config -match '(?m)^\s*enableServerPlugins\s*:') {
            $config = [regex]::Replace($config, '(?m)^\s*enableServerPlugins\s*:.*$', 'enableServerPlugins: true')
        } else {
            $config = $config.TrimEnd("`r", "`n") + "`r`n`r`nenableServerPlugins: true`r`n"
        }
        [IO.File]::WriteAllText($configPath, $config, [System.Text.UTF8Encoding]::new($false))
    } else {
        Write-Warning "未找到 $configPath，请手动设置 enableServerPlugins: true"
    }

    Write-Host ''
    Write-Host '安装完成。安装器没有启动、停止或重启 SillyTavern。' -ForegroundColor Green
    Write-Host '请关闭旧酒馆，再按原有 Start.bat 或命令自行启动。'
    Write-Host "SillyTavern：$STDir"
    Write-Host "前端：$FrontendDestination"
    Write-Host "后端：$BackendDestination"
} finally {
    if (Test-Path -LiteralPath $PreserveDirectory) {
        Remove-Item -LiteralPath $PreserveDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}
