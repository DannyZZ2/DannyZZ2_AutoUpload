#!/bin/zsh

SCRIPT_PATH="${0:A}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"

if [[ -f "$SCRIPT_DIR/package.json" ]]; then
  PROJECT_DIR="$SCRIPT_DIR"
elif [[ -f "$HOME/Desktop/DannyZZ2_AutoUpload/package.json" ]]; then
  PROJECT_DIR="$HOME/Desktop/DannyZZ2_AutoUpload"
elif [[ -f "$HOME/Desktop/multi-platform-publisher/package.json" ]]; then
  PROJECT_DIR="$HOME/Desktop/multi-platform-publisher"
elif [[ -f "/Users/wuji/Desktop/软件开发/multi-platform-publisher/package.json" ]]; then
  PROJECT_DIR="/Users/wuji/Desktop/软件开发/multi-platform-publisher"
else
  echo "未找到项目目录。请把此文件放在项目根目录，或将项目克隆到桌面的 DannyZZ2_AutoUpload 文件夹。"
  read "unused?按回车退出..."
  exit 1
fi

cd "$PROJECT_DIR" || exit 1

echo "正在启动多平台视频发布工具..."
echo "项目目录：$PROJECT_DIR"
echo

(
  for _ in {1..60}; do
    for port in 5173 5174 5175 5176 5177 5178 5179; do
      if curl -fsS "http://127.0.0.1:${port}/" >/dev/null 2>&1; then
        open "http://127.0.0.1:${port}/"
        exit 0
      fi
    done
    sleep 1
  done

  open "http://127.0.0.1:5173/"
) &

npm run dev
