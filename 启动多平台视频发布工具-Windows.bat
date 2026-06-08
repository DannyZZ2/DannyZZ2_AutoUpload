@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR="

if exist "%SCRIPT_DIR%package.json" set "PROJECT_DIR=%SCRIPT_DIR%"
if not defined PROJECT_DIR if exist "%USERPROFILE%\Desktop\DannyZZ2_AutoUpload\package.json" set "PROJECT_DIR=%USERPROFILE%\Desktop\DannyZZ2_AutoUpload"
if not defined PROJECT_DIR if exist "%USERPROFILE%\Desktop\multi-platform-publisher\package.json" set "PROJECT_DIR=%USERPROFILE%\Desktop\multi-platform-publisher"

if not defined PROJECT_DIR (
  echo 未找到项目目录。
  echo 请把此文件放在项目根目录，或先运行 Windows 一键安装脚本。
  echo.
  pause
  exit /b 1
)

cd /d "%PROJECT_DIR%" || (
  echo 无法进入项目目录：%PROJECT_DIR%
  echo.
  pause
  exit /b 1
)

echo 正在启动多平台视频发布工具...
echo 项目目录：%PROJECT_DIR%
echo.

start "" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports=5173..5179; for($i=0; $i -lt 60; $i++){ foreach($p in $ports){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:' + $p + '/') -TimeoutSec 1; if($r.StatusCode -ge 200){ Start-Process ('http://127.0.0.1:' + $p + '/'); exit 0 } } catch {} }; Start-Sleep -Seconds 1 }; Start-Process 'http://127.0.0.1:5173/'"

npm run dev

echo.
pause
