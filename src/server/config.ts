import fs from "node:fs";
import path from "node:path";

export const rootDir = process.cwd();
export const dataDir = path.join(rootDir, "data");
export const uploadDir = path.join(dataDir, "uploads");
export const screenshotDir = path.join(dataDir, "screenshots");
export const browserSessionDir = path.join(dataDir, "browser-sessions");
export const dbPath = path.join(dataDir, "publisher.sqlite");

export const apiPort = Number(process.env.API_PORT ?? 4174);
export const apiHost = process.env.API_HOST ?? "127.0.0.1";
export const browserChannel = process.env.PUBLISHER_BROWSER_CHANNEL || undefined;
export const browserExecutablePath =
  process.env.PUBLISHER_BROWSER_EXECUTABLE || findSystemChromeExecutable();

export function ensureDataDirs() {
  for (const dir of [dataDir, uploadDir, screenshotDir, browserSessionDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function findSystemChromeExecutable() {
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          path.join(process.env.HOME ?? "", "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        ]
      : process.platform === "win32"
        ? [
            path.join(process.env.PROGRAMFILES ?? "", "Google/Chrome/Application/chrome.exe"),
            path.join(process.env["PROGRAMFILES(X86)"] ?? "", "Google/Chrome/Application/chrome.exe"),
            path.join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe")
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser"
          ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}
