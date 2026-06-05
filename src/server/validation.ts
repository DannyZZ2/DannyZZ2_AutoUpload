import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { platforms, type Platform } from "../shared/types";

const videoExtensions = new Set([".mp4", ".mov", ".m4v", ".webm"]);
const weiboVideoExtensions = new Set([".mp4"]);
const imageExtensions = new Set([".jpg", ".jpeg", ".png"]);
const maxWeiboVideoBytes = 15 * 1024 * 1024 * 1024;

export type ParsedTaskFields = {
  title: string;
  tags: string[];
  platforms: Platform[];
};

export type ImageRatio = "3:4" | "4:3" | "16:9";

export type VideoMetadata = {
  width: number;
  height: number;
  durationSeconds: number;
  sizeBytes: number;
};

export function parseTaskFields(fields: Record<string, unknown>): ParsedTaskFields {
  const title = String(fields.title ?? "").trim();
  if (!title) {
    throw new Error("标题不能为空");
  }

  const tags = parseTags(fields.tags);
  const selectedPlatforms = parsePlatforms(fields.platforms);

  return { title, tags, platforms: selectedPlatforms };
}

export function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeTags(value.map(String));
  }

  const raw = String(value ?? "").trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return normalizeTags(parsed.map(String));
    }
  } catch {
    // Fall back to comma/space parsing.
  }

  return normalizeTags(raw.split(/[,，\s#]+/));
}

export function parsePlatforms(value: unknown): Platform[] {
  const raw = String(value ?? "").trim();
  if (!raw) {
    throw new Error("至少选择一个平台");
  }

  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    list = raw.split(",");
  }

  if (!Array.isArray(list)) {
    throw new Error("平台字段格式错误");
  }

  const selected = Array.from(new Set(list.map(String))) as Platform[];
  const invalid = selected.filter((platform) => !platforms.includes(platform));
  if (invalid.length > 0) {
    throw new Error(`不支持的平台：${invalid.join(", ")}`);
  }
  if (selected.length === 0) {
    throw new Error("至少选择一个平台");
  }
  return selected;
}

export function validateVideoFile(filePath: string) {
  assertFile(filePath, "视频文件缺失");
  const ext = path.extname(filePath).toLowerCase();
  if (!videoExtensions.has(ext)) {
    throw new Error("视频仅支持 mp4、mov、m4v、webm");
  }
}

export function validateWeiboVideoFile(filePath: string) {
  validateVideoFile(filePath);

  const ext = path.extname(filePath).toLowerCase();
  if (!weiboVideoExtensions.has(ext)) {
    throw new Error("微博视频需要使用 mp4；MOV/M4V 会在发布前自动转换，转换失败时请手动导出 MP4");
  }

  validateWeiboVideoMetadata(readVideoMetadata(filePath), path.basename(filePath));
}

export function validateWeiboVideoMetadata(metadata: VideoMetadata, fileName = "视频") {
  if (metadata.sizeBytes > maxWeiboVideoBytes) {
    throw new Error(`${fileName} 超过微博 15G 限制`);
  }

  if (metadata.durationSeconds <= 15) {
    throw new Error(`${fileName} 时长需要大于 15 秒，当前约 ${metadata.durationSeconds.toFixed(1)} 秒`);
  }

  const shortSide = Math.min(metadata.width, metadata.height);
  if (shortSide < 1080) {
    throw new Error(`${fileName} 分辨率需要至少 1080p，当前为 ${metadata.width}x${metadata.height}`);
  }
}

export function validateImageFile(filePath: string, ratio: ImageRatio) {
  assertFile(filePath, "封面文件缺失");
  const ext = path.extname(filePath).toLowerCase();
  if (!imageExtensions.has(ext)) {
    throw new Error("封面仅支持 jpg、jpeg、png");
  }

  const { width, height } = readImageSize(filePath);
  const expected = ratio === "3:4" ? 3 / 4 : ratio === "4:3" ? 4 / 3 : 16 / 9;
  const actual = width / height;
  const tolerance = 0.03;
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${path.basename(filePath)} 需要是 ${ratio}，当前为 ${width}:${height}`);
  }
}

export function normalizeTags(tags: string[]) {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.replace(/^#/, "").trim())
        .filter(Boolean)
    )
  );
}

function assertFile(filePath: string, message: string) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(message);
  }
}

function readImageSize(filePath: string) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 24) {
    throw new Error("封面图片无法识别尺寸");
  }

  if (buffer.toString("ascii", 1, 4) === "PNG") {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return readJpegSize(buffer);
  }

  throw new Error("封面图片无法识别尺寸");
}

function readVideoMetadata(filePath: string): VideoMetadata {
  const result = runFfprobe(filePath);
  if (!result) {
    throw new Error("无法读取微博视频参数：请先安装 ffmpeg/ffprobe，或换用符合微博要求的视频后重试");
  }

  const stream = result.streams?.[0];
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  const durationSeconds = Number(stream?.duration ?? result.format?.duration);
  const sizeBytes = Number(result.format?.size ?? fs.statSync(filePath).size);

  if (![width, height, durationSeconds, sizeBytes].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("无法读取微博视频参数：视频元数据不完整，请重新导出视频后重试");
  }

  return { width, height, durationSeconds, sizeBytes };
}

function runFfprobe(filePath: string): { streams?: Array<{ width?: number; height?: number; duration?: string }>; format?: { duration?: string; size?: string } } | undefined {
  const binaries = [process.env.FFPROBE_PATH, "ffprobe", "/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe"].filter(Boolean) as string[];

  for (const binary of binaries) {
    const result = spawnSync(
      binary,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,duration:format=duration,size",
        "-of",
        "json",
        filePath
      ],
      { encoding: "utf8", maxBuffer: 1024 * 1024 }
    );

    if (result.error || result.status !== 0 || !result.stdout) {
      continue;
    }

    try {
      return JSON.parse(result.stdout) as {
        streams?: Array<{ width?: number; height?: number; duration?: string }>;
        format?: { duration?: string; size?: string };
      };
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function readJpegSize(buffer: Buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker);

    if (isStartOfFrame) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }

    offset += 2 + length;
  }

  throw new Error("封面图片无法识别尺寸");
}
