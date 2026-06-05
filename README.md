# 多平台视频发布工具

本地 TypeScript Web 应用，用 Playwright 自动操作平台网页：上传视频、设置封面、填写标题和标签，并提交发布。

## 运行

```bash
npm install
npm run dev
```

默认地址：

- Web UI: http://127.0.0.1:5173
- API: http://127.0.0.1:4174

程序默认会优先使用本机 Google Chrome，避免必须下载 Playwright 自带 Chromium。

如果本机没有 Chrome，先执行：

```bash
npx playwright install chromium
```

也可以显式指定浏览器：

```bash
PUBLISHER_BROWSER_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run dev
```

## 约束

- 第一版全部平台走网页自动化，不使用开放平台 API。
- 每个平台单账号，登录会话保存在本机 `data/browser-sessions`。
- 不保存账号密码，不绕过验证码和风控。
- 抖音和视频号同时设置 3:4 与 4:3 封面；小红书用 3:4，B站用 4:3，微博用 16:9。
