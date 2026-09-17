param([string]$STDir = $env:ST_DIR)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$Branch = if ($env:NPMS_BRANCH) { $env:NPMS_BRANCH } else { 'main' }
$RepoUrl = if ($env:NPMS_REPO_URL) { $env:NPMS_REPO_URL } else { 'https://github.com/libertyseeyou/yourownmusicapiforST.git' }
$WorkDirectory = Join-Path ([IO.Path]::GetTempPath()) "npms-install-$PID-$(Get-Date -Format yyyyMMddHHmmss)"
if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { throw 'Git is required. Install Git for Windows, reopen PowerShell, and retry.' }
try {
    Write-Host '== Your Own Music Source: Git backend installer ==' -ForegroundColor Cyan
    & git.exe clone --depth 1 --branch $Branch $RepoUrl $WorkDirectory
    if ($LASTEXITCODE -ne 0) { throw "git clone failed with exit code $LASTEXITCODE" }
    Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force -ErrorAction SilentlyContinue
    & (Join-Path $WorkDirectory 'scripts\install-windows.ps1') -STDir $STDir
} finally {
    if (Test-Path -LiteralPath $WorkDirectory) { Remove-Item -LiteralPath $WorkDirectory -Recurse -Force -ErrorAction SilentlyContinue }
}
