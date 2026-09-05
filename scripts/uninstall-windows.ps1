param(
    [string]$STDir = $env:ST_DIR,
    [string]$BackupRoot = $env:NPMS_BACKUP_ROOT
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Slug = 'netease-personal-music-source'
$RepoMark = 'github.com/libertyseeyou/yourownmusicapiforST'
$Stamp = Get-Date -Format 'yyyyMMdd_HHmmss'

function Test-SillyTavernPath([string]$Path) {
    if (-not $Path) { return $false }
    return Test-Path -LiteralPath (Join-Path $Path 'server.js') -PathType Leaf
}
if (-not $STDir) {
    $candidates = @((Get-Location).Path)
    if ($HOME) {
        $candidates += (Join-Path $HOME 'SillyTavern')
        $candidates += (Join-Path $HOME 'Desktop\SillyTavern')
        $candidates += (Join-Path $HOME 'Documents\SillyTavern')
        $candidates += (Join-Path $HOME 'Downloads\SillyTavern')
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-SillyTavernPath $candidate) { $STDir = $candidate; break }
    }
}
if (-not (Test-SillyTavernPath $STDir)) {
    throw "请设置 `$env:ST_DIR='D:\你的\SillyTavern' 后重试。"
}
$STDir = (Resolve-Path -LiteralPath $STDir).Path
if (-not $BackupRoot) {
    $BackupRoot = Join-Path $HOME "sillytavern-music-source-backups\uninstall-$Stamp"
}
$BackupRoot = [Environment]::ExpandEnvironmentVariables($BackupRoot)
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

$ThirdPartyRoot = Join-Path $STDir 'public\scripts\extensions\third-party'
$frontends = @()
$legacy = Join-Path $ThirdPartyRoot $Slug
if (Test-Path -LiteralPath $legacy) { $frontends += $legacy }
if (Test-Path -LiteralPath $ThirdPartyRoot) {
    foreach ($directory in Get-ChildItem -LiteralPath $ThirdPartyRoot -Directory -ErrorAction SilentlyContinue) {
        $manifest = Join-Path $directory.FullName 'manifest.json'
        if (-not (Test-Path -LiteralPath $manifest)) { continue }
        try {
            if ((Get-Content -LiteralPath $manifest -Raw) -match [regex]::Escape($RepoMark)) {
                $frontends += $directory.FullName
            }
        } catch { }
    }
}
$index = 0
foreach ($frontend in ($frontends | Select-Object -Unique)) {
    $index += 1
    $label = if ($index -eq 1) { 'frontend' } else { "frontend-$index" }
    Move-Item -LiteralPath $frontend -Destination (Join-Path $BackupRoot $label)
    Write-Host "已移出并备份：$frontend"
}
$backend = Join-Path $STDir "plugins\$Slug"
if (Test-Path -LiteralPath $backend) {
    Move-Item -LiteralPath $backend -Destination (Join-Path $BackupRoot 'backend')
    Write-Host "已移出并备份：$backend"
}
Write-Host '卸载器没有停止或重启 SillyTavern。请由你自行重启。'
Write-Host "备份位于：$BackupRoot"
