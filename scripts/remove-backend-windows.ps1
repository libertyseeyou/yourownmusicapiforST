param([string]$STDir=$env:ST_DIR,[string]$BackupRoot=$env:NPMS_BACKUP_ROOT)
$ErrorActionPreference='Stop'; $Slug='netease-personal-music-source'; $Stamp=Get-Date -Format 'yyyyMMdd_HHmmss'
function Test-ST($p){$p -and (Test-Path -LiteralPath (Join-Path $p 'server.js') -PathType Leaf)}
if(-not $STDir){$c=@((Get-Location).Path,(Join-Path $HOME 'SillyTavern'),(Join-Path $HOME 'Desktop\SillyTavern'),(Join-Path $HOME 'Documents\SillyTavern'),(Join-Path $HOME 'Downloads\SillyTavern'));foreach($p in $c){if(Test-ST $p){$STDir=$p;break}}}
if(-not(Test-ST $STDir)){throw "请设置 `$env:ST_DIR='D:\你的\SillyTavern' 后重试。"}
if(-not $BackupRoot){$BackupRoot=Join-Path $HOME "sillytavern-music-source-backups\remove-backend-$Stamp"}
$Backend=Join-Path $STDir "plugins\$Slug"
if(Test-Path -LiteralPath $Backend){New-Item -ItemType Directory -Force -Path $BackupRoot|Out-Null;Move-Item -LiteralPath $Backend -Destination (Join-Path $BackupRoot 'backend');Write-Host "后端已移出并备份：$BackupRoot\backend"}else{Write-Host '后端未安装，无需删除。'}
Write-Host '前端扩展已保留。请自行重启 SillyTavern。'
