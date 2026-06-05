import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { Platform } from "../../shared/types";
import { browserChannel, browserExecutablePath, browserSessionDir } from "../config";

const contexts = new Map<Platform, BrowserContext>();
const browserWindowSize = { width: 1920, height: 1280 };

export async function getPlatformContext(platform: Platform) {
  const existing = contexts.get(platform);
  if (existing) {
    return existing;
  }

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(path.join(browserSessionDir, platform), {
      acceptDownloads: true,
      channel: browserChannel,
      executablePath: browserChannel ? undefined : browserExecutablePath,
      headless: false,
      viewport: null,
      args: [
        "--start-maximized",
        "--window-position=0,0",
        `--window-size=${browserWindowSize.width},${browserWindowSize.height}`
      ]
    });
  } catch (error) {
    throw new Error(buildBrowserLaunchError(error));
  }

  context.on("close", () => {
    contexts.delete(platform);
  });
  contexts.set(platform, context);
  return context;
}

function buildBrowserLaunchError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Executable doesn't exist") || message.includes("playwright install")) {
    return [
      "浏览器启动失败：Playwright 浏览器不可用。",
      "程序会优先尝试使用系统 Chrome；如果本机没有 Chrome，请运行 `npx playwright install chromium`，或安装 Google Chrome。",
      "也可以通过 `PUBLISHER_BROWSER_EXECUTABLE=/path/to/chrome npm run dev` 指定浏览器。",
      `原始错误：${message}`
    ].join("\n");
  }
  return message;
}

export async function openPlatformPage(platform: Platform, url: string): Promise<Page> {
  const context = await getPlatformContext(platform);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.bringToFront();
  await maximizePageWindow(page);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  return page;
}

export async function maximizePageWindow(page: Page) {
  try {
    const session = await page.context().newCDPSession(page);
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "maximized" }
    });
    await session.detach();
  } catch {
    await page.setViewportSize(browserWindowSize).catch(() => undefined);
  }
}
