#!/bin/zsh

set -e

REPO_URL="https://github.com/DannyZZ2/DannyZZ2_AutoUpload.git"
INSTALL_DIR="$HOME/Desktop/DannyZZ2_AutoUpload"
LAUNCHER_NAME="启动多平台视频发布工具.command"

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

pause_before_exit() {
  echo
  read "unused?按回车退出..."
}

fail() {
  echo
  echo "安装失败：$1"
  pause_before_exit
  exit 1
}

SCRIPT_PATH="${0:A}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"

echo "多平台视频发布工具一键安装"
echo

if ! command_exists git; then
  fail "未找到 Git。请先安装 Xcode Command Line Tools 或 Git。"
fi

if ! command_exists node; then
  echo "未找到 Node.js。正在打开 Node.js 下载页面。"
  open "https://nodejs.org/"
  fail "请先安装 Node.js 20 或更高版本，然后重新运行本安装脚本。"
fi

if ! command_exists npm; then
  fail "未找到 npm。请确认 Node.js 已正确安装。"
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "当前 Node.js 版本：$(node -v)"
  open "https://nodejs.org/"
  fail "Node.js 版本过低，请安装 20 或更高版本后重新运行。"
fi

if [[ -f "$SCRIPT_DIR/package.json" ]]; then
  PROJECT_DIR="$SCRIPT_DIR"
else
  PROJECT_DIR="$INSTALL_DIR"
  if [[ -d "$PROJECT_DIR/.git" ]]; then
    echo "检测到已有项目，正在更新：$PROJECT_DIR"
    git -C "$PROJECT_DIR" pull --ff-only
  elif [[ -f "$PROJECT_DIR/package.json" ]]; then
    echo "检测到已有项目目录：$PROJECT_DIR"
  elif [[ -e "$PROJECT_DIR" ]]; then
    fail "目标目录已存在但不是项目目录：$PROJECT_DIR"
  else
    echo "正在克隆项目到：$PROJECT_DIR"
    git clone "$REPO_URL" "$PROJECT_DIR"
  fi
fi

cd "$PROJECT_DIR" || fail "无法进入项目目录：$PROJECT_DIR"

echo
echo "项目目录：$PROJECT_DIR"
echo "正在安装依赖..."
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

if [[ ! -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]]; then
  echo
  echo "未检测到 Google Chrome，正在安装 Playwright Chromium..."
  npx playwright install chromium
else
  echo
  echo "检测到 Google Chrome，跳过 Playwright Chromium 下载。"
fi

if [[ ! -f "$PROJECT_DIR/$LAUNCHER_NAME" ]]; then
  fail "未找到启动脚本：$PROJECT_DIR/$LAUNCHER_NAME"
fi

chmod +x "$PROJECT_DIR/$LAUNCHER_NAME"
cp "$PROJECT_DIR/$LAUNCHER_NAME" "$HOME/Desktop/$LAUNCHER_NAME"
chmod +x "$HOME/Desktop/$LAUNCHER_NAME"

echo
echo "安装完成。"
echo "桌面已创建快捷方式：$HOME/Desktop/$LAUNCHER_NAME"
echo "以后双击这个快捷方式即可启动工具。"

pause_before_exit
