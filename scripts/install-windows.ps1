param([string]$STDir = $env:ST_DIR,[string]$BackupRoot = $env:NPMS_BACKUP_ROOT)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$Slug = 'netease-personal-music-source'
$RepoUrl = if ($env:NPMS_REPO_URL) { $env:NPMS_REPO_URL } else { 'https://github.com/libertyseeyou/yourownmusicapiforST.git' }
$Branch = if ($env:NPMS_BRANCH) { $env:NPMS_BRANCH } else { 'main' }
$Stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
function Test-ST([string]$Path) { return $Path -and (Test-Path -LiteralPath (Join-Path $Path 'server.js') -PathType Leaf) }
if (-not $STDir) {
    $Candidates=@((Get-Location).Path,(Join-Path $HOME 'SillyTavern'),(Join-Path $HOME 'Desktop\SillyTavern'),(Join-Path $HOME 'Documents\SillyTavern'),(Join-Path $HOME 'Downloads\SillyTavern'))
    foreach($Candidate in $Candidates){if(Test-ST $Candidate){$STDir=$Candidate;break}}
}
if (-not (Test-ST $STDir)) { throw "未找到 SillyTavern。请设置 `$env:ST_DIR='D:\你的\SillyTavern' 后重试。" }
if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { throw '需要 Git for Windows。安装后请重新打开 PowerShell。' }
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw '需要 Node.js 20+。' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw '未找到 npm.cmd。' }
$Major=[int]((& node.exe -p "process.versions.node.split('.')[0]").Trim());if($Major -lt 20){throw "需要 Node.js 20+，当前：$(& node.exe -v)"}
$STDir=(Resolve-Path -LiteralPath $STDir).Path
$FrontendRoot=Join-Path $STDir 'public\scripts\extensions\third-party'
$FrontendDestination=Join-Path $FrontendRoot $Slug
$BackendDestination=Join-Path $STDir "plugins\$Slug"
if (-not $BackupRoot) {$BackupRoot=Join-Path $HOME "sillytavern-music-source-backups\$Stamp"}
$Preserve=Join-Path ([IO.Path]::GetTempPath()) "npms-preserve-$PID-$Stamp"
$ExistingFrontend=$null
if(Test-Path $FrontendRoot){foreach($Directory in Get-ChildItem $FrontendRoot -Directory -ErrorAction SilentlyContinue){$Manifest=Join-Path $Directory.FullName 'manifest.json';if(Test-Path $Manifest){try{if((Get-Content $Manifest -Raw)-match 'github.com/libertyseeyou/yourownmusicapiforST'){$ExistingFrontend=$Directory.FullName;break}}catch{}}}}
if($ExistingFrontend){$FrontendDestination=$ExistingFrontend;Write-Host "检测到插件菜单已安装前端：$FrontendDestination"}
try {
    New-Item -ItemType Directory -Force -Path $Preserve | Out-Null
    $NewData=Join-Path $BackendDestination 'backend\data';$OldData=Join-Path $BackendDestination 'data'
    if(Test-Path $NewData){Copy-Item $NewData (Join-Path $Preserve 'data') -Recurse -Force}elseif(Test-Path $OldData){Copy-Item $OldData (Join-Path $Preserve 'data') -Recurse -Force}
    if(Test-Path $BackendDestination){New-Item -ItemType Directory -Force -Path $BackupRoot|Out-Null;Move-Item $BackendDestination (Join-Path $BackupRoot 'backend');Write-Host "旧后端已备份：$BackupRoot\backend"}
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $BackendDestination)|Out-Null
    & git.exe clone --branch $Branch $RepoUrl $BackendDestination
    if($LASTEXITCODE -ne 0){throw "git clone 失败，退出码：$LASTEXITCODE"}
    $Preserved=Join-Path $Preserve 'data';$TargetData=Join-Path $BackendDestination 'backend\data'
    if(Test-Path $Preserved){if(Test-Path $TargetData){Remove-Item $TargetData -Recurse -Force};Copy-Item $Preserved $TargetData -Recurse -Force;Write-Host '已迁移 Cookie、本地目录设置与个人配置。'}else{New-Item -ItemType Directory -Force -Path (Join-Path $TargetData 'local-music')|Out-Null}
    New-Item -ItemType File -Force -Path (Join-Path $TargetData '.gitkeep') | Out-Null
    Push-Location (Join-Path $BackendDestination 'backend')
    try{& npm.cmd ci --omit=dev --ignore-scripts;if($LASTEXITCODE-ne 0){throw "npm ci 失败：$LASTEXITCODE"};& node.exe -e "const fs=require('fs'),crypto=require('crypto'),path=require('path');const h=crypto.createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex');fs.writeFileSync(path.join('node_modules','.npms-lock-hash'),h+'\n')"}finally{Pop-Location}
    if(-not $ExistingFrontend){New-Item -ItemType Directory -Force -Path $FrontendRoot|Out-Null;Copy-Item (Join-Path $BackendDestination 'frontend') $FrontendDestination -Recurse -Force}
    $ConfigPath=Join-Path $STDir 'config.yaml'
    if(Test-Path $ConfigPath){Copy-Item $ConfigPath "$ConfigPath.bak-npms" -Force;$Config=Get-Content $ConfigPath -Raw;if($Config-match '(?m)^\s*enableServerPlugins\s*:'){$Config=[regex]::Replace($Config,'(?m)^\s*enableServerPlugins\s*:.*$','enableServerPlugins: true')}else{$Config=$Config.TrimEnd()+"`r`n`r`nenableServerPlugins: true"};if($Config-match '(?m)^\s*enableServerPluginsAutoUpdate\s*:'){$Config=[regex]::Replace($Config,'(?m)^\s*enableServerPluginsAutoUpdate\s*:.*$','enableServerPluginsAutoUpdate: true')}else{$Config+="`r`nenableServerPluginsAutoUpdate: true"};[IO.File]::WriteAllText($ConfigPath,$Config+"`r`n",[Text.UTF8Encoding]::new($false))}
    Write-Host '';Write-Host 'Git 型后端安装完成。请完整重启 SillyTavern。' -ForegroundColor Green;Write-Host "后端仓库：$BackendDestination";Write-Host '以后后端发布更新时，只需重启酒馆。'
} finally {if(Test-Path $Preserve){Remove-Item $Preserve -Recurse -Force -ErrorAction SilentlyContinue}}
