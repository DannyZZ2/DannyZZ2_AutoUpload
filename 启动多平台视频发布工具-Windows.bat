@echo off
setlocal EnableExtensions DisableDelayedExpansion

call :main
set "LAUNCH_EXIT=%ERRORLEVEL%"

echo.
if "%LAUNCH_EXIT%"=="0" (
  echo 服务已停止。
) else (
  echo 启动失败，错误码：%LAUNCH_EXIT%
)
echo.
pause
exit /b %LAUNCH_EXIT%

:main
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR="

if exist "!SCRIPT_DIR!package.json" set "PROJECT_DIR=!SCRIPT_DIR!"
if defined PROJECT_DIR goto found_project

if exist "%USERPROFILE%\Desktop\DannyZZ2_AutoUpload\package.json" set "PROJECT_DIR=%USERPROFILE%\Desktop\DannyZZ2_AutoUpload"
if defined PROJECT_DIR goto found_project

if exist "%USERPROFILE%\Desktop\multi-platform-publisher\package.json" set "PROJECT_DIR=%USERPROFILE%\Desktop\multi-platform-publisher"
if defined PROJECT_DIR goto found_project

echo 未找到项目目录。
echo 请把此文件放在项目根目录，或先运行 Windows 一键安装脚本。
exit /b 1

:found_project
cd /d "!PROJECT_DIR!"
if errorlevel 1 (
  echo 无法进入项目目录：!PROJECT_DIR!
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo 未找到 npm。请先安装 Node.js，或重新运行 Windows 一键安装脚本。
  exit /b 1
)

if not exist node_modules (
  echo 未找到 node_modules，正在安装依赖...
  if exist package-lock.json (
    call npm ci
  ) else (
    call npm install
  )
  if errorlevel 1 (
    echo 依赖安装失败。
    exit /b 1
  )
)

echo 正在启动多平台视频发布工具...
echo 项目目录：!PROJECT_DIR!
echo 页面会在服务启动后自动打开。
echo 关闭此窗口会停止本地服务。
echo.

call npm run dev:open
set "DEV_EXIT=!ERRORLEVEL!"
exit /b !DEV_EXIT!
