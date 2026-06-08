@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "LOG_FILE=%USERPROFILE%\Desktop\DannyZZ2_AutoUpload_launch.log"
> "%LOG_FILE%" echo [%date% %time%] Start Windows launcher

call :main
set "LAUNCH_EXIT=%ERRORLEVEL%"

echo.
if "%LAUNCH_EXIT%"=="0" (
  echo 服务已停止。
) else (
  echo 启动失败，错误码：%LAUNCH_EXIT%
  echo 日志文件：%LOG_FILE%
  echo.
  echo ===== 启动日志 =====
  type "%LOG_FILE%"
  echo ===== 日志结束 =====
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
>> "%LOG_FILE%" echo Project directory was not found.
exit /b 1

:found_project
>> "%LOG_FILE%" echo Project directory: !PROJECT_DIR!

cd /d "!PROJECT_DIR!"
if errorlevel 1 (
  echo 无法进入项目目录：!PROJECT_DIR!
  >> "%LOG_FILE%" echo Failed to cd into project directory.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo 未找到 npm。请先安装 Node.js，或重新运行 Windows 一键安装脚本。
  >> "%LOG_FILE%" echo npm was not found in PATH.
  exit /b 1
)

if not exist node_modules (
  echo 未找到 node_modules，正在安装依赖...
  >> "%LOG_FILE%" echo node_modules was not found. Installing dependencies.
  if exist package-lock.json (
    call npm ci
  ) else (
    call npm install
  )
  if errorlevel 1 (
    echo 依赖安装失败。
    >> "%LOG_FILE%" echo Dependency installation failed.
    exit /b 1
  )
)

echo 正在启动多平台视频发布工具...
echo 项目目录：!PROJECT_DIR!
echo 页面会在服务启动后自动打开。
echo 关闭此窗口会停止本地服务。
echo.
>> "%LOG_FILE%" echo Running npm run dev:open.

call npm run dev:open
set "DEV_EXIT=!ERRORLEVEL!"
>> "%LOG_FILE%" echo npm run dev:open exited with code !DEV_EXIT!.
exit /b !DEV_EXIT!
