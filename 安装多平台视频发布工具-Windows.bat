@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

set "REPO_URL=https://github.com/DannyZZ2/DannyZZ2_AutoUpload.git"
set "INSTALL_DIR=%USERPROFILE%\Desktop\DannyZZ2_AutoUpload"
set "LAUNCHER_NAME=启动多平台视频发布工具-Windows.bat"
set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR="

echo 多平台视频发布工具 Windows 一键安装
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo 未找到 Git。正在打开 Git 下载页面。
  start "" "https://git-scm.com/download/win"
  echo 请先安装 Git，然后重新运行本安装脚本。
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。正在打开 Node.js 下载页面。
  start "" "https://nodejs.org/"
  echo 请先安装 Node.js 20 或更高版本，然后重新运行本安装脚本。
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo 未找到 npm。请确认 Node.js 已正确安装。
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -p "Number(process.versions.node.split('.')[0])"') do set "NODE_MAJOR=%%v"
if "!NODE_MAJOR!"=="" (
  echo 无法读取 Node.js 版本。
  echo.
  pause
  exit /b 1
)

if !NODE_MAJOR! LSS 20 (
  echo 当前 Node.js 版本：
  node -v
  start "" "https://nodejs.org/"
  echo Node.js 版本过低，请安装 20 或更高版本后重新运行。
  echo.
  pause
  exit /b 1
)

if exist "%SCRIPT_DIR%package.json" (
  set "PROJECT_DIR=%SCRIPT_DIR%"
) else (
  set "PROJECT_DIR=%INSTALL_DIR%"
  if exist "%INSTALL_DIR%\.git" (
    echo 检测到已有项目，正在更新：%INSTALL_DIR%
    git -C "%INSTALL_DIR%" pull --ff-only
    if errorlevel 1 (
      echo 项目更新失败。
      echo.
      pause
      exit /b 1
    )
  ) else if exist "%INSTALL_DIR%\package.json" (
    echo 检测到已有项目目录：%INSTALL_DIR%
  ) else if exist "%INSTALL_DIR%" (
    echo 目标目录已存在但不是项目目录：%INSTALL_DIR%
    echo 请移走该目录后重新运行安装脚本。
    echo.
    pause
    exit /b 1
  ) else (
    echo 正在克隆项目到：%INSTALL_DIR%
    git clone "%REPO_URL%" "%INSTALL_DIR%"
    if errorlevel 1 (
      echo 项目克隆失败。
      echo.
      pause
      exit /b 1
    )
  )
)

cd /d "%PROJECT_DIR%" || (
  echo 无法进入项目目录：%PROJECT_DIR%
  echo.
  pause
  exit /b 1
)

echo.
echo 项目目录：%PROJECT_DIR%
echo 正在安装依赖...

if exist package-lock.json (
  call npm ci
) else (
  call npm install
)
if errorlevel 1 (
  echo 依赖安装失败。
  echo.
  pause
  exit /b 1
)

set "CHROME_X64=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "CHROME_X86=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
set "CHROME_LOCAL=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if exist "%CHROME_X64%" (
  echo.
  echo 检测到 Google Chrome，跳过 Playwright Chromium 下载。
) else if exist "%CHROME_X86%" (
  echo.
  echo 检测到 Google Chrome，跳过 Playwright Chromium 下载。
) else if exist "%CHROME_LOCAL%" (
  echo.
  echo 检测到 Google Chrome，跳过 Playwright Chromium 下载。
) else (
  echo.
  echo 未检测到 Google Chrome，正在安装 Playwright Chromium...
  call npx playwright install chromium
  if errorlevel 1 (
    echo Playwright Chromium 安装失败。
    echo.
    pause
    exit /b 1
  )
)

if not exist "%PROJECT_DIR%\%LAUNCHER_NAME%" (
  echo 未找到启动脚本：%PROJECT_DIR%\%LAUNCHER_NAME%
  echo.
  pause
  exit /b 1
)

copy /Y "%PROJECT_DIR%\%LAUNCHER_NAME%" "%USERPROFILE%\Desktop\%LAUNCHER_NAME%" >nul
if errorlevel 1 (
  echo 创建桌面启动快捷方式失败。
  echo.
  pause
  exit /b 1
)

echo.
echo 安装完成。
echo 桌面已创建快捷方式：%USERPROFILE%\Desktop\%LAUNCHER_NAME%
echo 以后双击这个快捷方式即可启动工具。
echo.
pause
