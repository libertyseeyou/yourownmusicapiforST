param([string]$STDir = $env:ST_DIR)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Branch = if ($env:NPMS_BRANCH) { $env:NPMS_BRANCH } else { 'main' }
$WorkDirectory = Join-Path ([IO.Path]::GetTempPath()) "npms-install-$PID-$(Get-Date -Format yyyyMMddHHmmss)"
$ZipPath = Join-Path $WorkDirectory 'source.zip'
$ZipUrl = "https://github.com/libertyseeyou/yourownmusicapiforST/archive/refs/heads/$Branch.zip"

Write-Host '== 你自己的音乐源：Windows 一键部署 ==' -ForegroundColor Cyan
try {
    New-Item -ItemType Directory -Force -Path $WorkDirectory | Out-Null
    Write-Host '正在从 GitHub 下载安装包……'
    Invoke-WebRequest -UseBasicParsing -Uri $ZipUrl -OutFile $ZipPath
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $WorkDirectory -Force
    $Repository = Get-ChildItem -LiteralPath $WorkDirectory -Directory | Where-Object {
        Test-Path -LiteralPath (Join-Path $_.FullName 'scripts\install-windows.ps1')
    } | Select-Object -First 1
    if (-not $Repository) { throw '下载包中没有找到 Windows 安装器。' }
    Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force -ErrorAction SilentlyContinue
    & (Join-Path $Repository.FullName 'scripts\install-windows.ps1') -STDir $STDir
} finally {
    if (Test-Path -LiteralPath $WorkDirectory) {
        Remove-Item -LiteralPath $WorkDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}
