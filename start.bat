@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

node -e "const [major, minor] = process.versions.node.split('.').map(Number); if (!(major === 22 && minor >= 13 || major === 23 && minor >= 5 || major >= 24)) process.exit(1)"
if errorlevel 1 (
  echo 请先安装 Node.js 22.13 或更新的 LTS 版本。
  goto failed
)

REM 本机邮件配置可放在受忽略的 smtp.local.bat。
if exist "smtp.local.bat" (
  call "smtp.local.bat"
  if errorlevel 1 goto failed
)

if not exist "node_modules\.bin\vite.cmd" (
  echo 正在安装依赖...
  call npm ci --include=dev
  if errorlevel 1 goto failed
)

echo 正在构建前端...
call npm run build
if errorlevel 1 goto failed

if not defined HOST set "HOST=127.0.0.1"
call npm start
if errorlevel 1 goto failed
exit /b 0

:failed
echo 启动失败。请查看上方错误信息。
pause
exit /b 1
