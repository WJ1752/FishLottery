# 深海鱼市 · Windows 开机自启（计划任务）
#
# 以管理员身份运行：
#   powershell -ExecutionPolicy Bypass -File scripts\windows-service.ps1 -Install
#
# 卸载：
#   powershell -ExecutionPolicy Bypass -File scripts\windows-service.ps1 -Uninstall
#
# 说明：用「计划任务」而不是 Windows 服务，是因为 Node 进程不需要服务包装器，
# 而且计划任务能直接以当前用户身份跑，证书与 data 目录权限最简单。

param(
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$Run,
  [string]$InstallDir = "D:\FishGame",
  [string]$TaskName = "DeepwaterFishMarket",
  [ValidateRange(1, 65535)][int]$Port = 9000,
  [string]$NodePath
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "请以管理员身份运行此脚本。"
  }
}

if ($Run) {
  $env:PORT = [string]$Port
  Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
  & $NodePath --env-file-if-exists=.env server/index.js
  exit $LASTEXITCODE
}

if ($Uninstall) {
  Assert-Admin
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "已移除计划任务：$TaskName"
  } else {
    Write-Host "计划任务不存在：$TaskName"
  }
  exit 0
}

if (-not $Install) {
  Write-Host "用法："
  Write-Host "  -Install      注册开机自启"
  Write-Host "  -Uninstall    移除开机自启"
  Write-Host "  -InstallDir   安装目录（默认 D:\FishGame）"
  Write-Host "  -Port         端口（默认 9000）"
  exit 0
}

Assert-Admin

if (-not (Test-Path -LiteralPath $InstallDir -PathType Container)) { throw "安装目录不存在：$InstallDir" }
$InstallDir = (Resolve-Path -LiteralPath $InstallDir).Path
$taskScript = Join-Path $InstallDir "scripts\windows-service.ps1"
if (-not (Test-Path -LiteralPath $taskScript -PathType Leaf)) { throw "安装目录缺少计划任务脚本：$taskScript" }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "找不到 node，请先安装 Node.js 22.13 或更新的 LTS 版本，并加入 PATH。" }

$taskArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Run -Port {1} -NodePath "{2}"' -f $taskScript, $Port, $node
$action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument $taskArgs -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Highest

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "深海鱼市（HTTPS :$Port）" | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "已注册并启动：$TaskName"
Write-Host "  目录：$InstallDir"
Write-Host "  端口：$Port"
Write-Host "  访问：https://localhost:$Port"
