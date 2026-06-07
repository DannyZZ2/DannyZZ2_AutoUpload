#!/bin/zsh

PROJECT_DIR="/Users/wuji/Desktop/软件开发/multi-platform-publisher"

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
