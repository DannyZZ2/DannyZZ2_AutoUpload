import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function prepareWeiboVideoFile(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp4") {
    return filePath;
  }

  if (ext !== ".mov" && ext !== ".m4v") {
    return filePath;
  }

  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    throw new Error("微博视频需要 MP4：当前是 MOV/M4V，但本机未找到 ffmpeg，无法自动转换");
  }

  const output = path.join(path.dirname(filePath), "video-weibo.mp4");
  const remuxed = runFfmpeg(ffmpeg, [
    "-y",
    "-i",
    filePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-dn",
    "-map_metadata",
    "-1",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    output
  ]);

  if (remuxed && isUsableFile(output)) {
    return output;
  }

  const transcoded = runFfmpeg(ffmpeg, [
    "-y",
    "-i",
    filePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-dn",
    "-map_metadata",
    "-1",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    output
  ]);

  if (transcoded && isUsableFile(output)) {
    return output;
  }

  throw new Error("微博视频 MP4 转换失败，请手动导出为 H.264/AAC 的 MP4 后重试");
}

function findFfmpeg() {
  const binaries = [process.env.FFMPEG_PATH, "ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].filter(Boolean) as string[];

  for (const binary of binaries) {
    const result = spawnSync(binary, ["-version"], { encoding: "utf8" });
    if (!result.error && result.status === 0) {
      return binary;
    }
  }

  return undefined;
}

function runFfmpeg(binary: string, args: string[]) {
  const result = spawnSync(binary, args, { encoding: "utf8", maxBuffer: 1024 * 1024 });
  return !result.error && result.status === 0;
}

function isUsableFile(filePath: string) {
  return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
}
