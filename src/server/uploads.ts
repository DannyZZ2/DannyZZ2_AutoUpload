import fs from "node:fs/promises";
import path from "node:path";
import type { MultipartFile } from "@fastify/multipart";
import { uploadDir } from "./config";

export type SavedUploads = {
  videoPath?: string;
  cover34Path?: string;
  cover43Path?: string;
  cover169Path?: string;
};

const uploadFieldNames = new Set(["video", "cover34", "cover43", "cover169"]);

export function isUploadField(field: string) {
  return uploadFieldNames.has(field);
}

export async function saveUpload(taskId: string, part: MultipartFile) {
  const ext = safeExtension(part.filename);
  const fileName = `${part.fieldname}${ext}`;
  const dir = path.join(uploadDir, taskId);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, fileName);
  await fs.writeFile(target, await part.toBuffer());
  return target;
}

export function assignUploadPath(saved: SavedUploads, fieldName: string, filePath: string) {
  if (fieldName === "video") {
    saved.videoPath = filePath;
    return;
  }
  if (fieldName === "cover34") {
    saved.cover34Path = filePath;
    return;
  }
  if (fieldName === "cover43") {
    saved.cover43Path = filePath;
    return;
  }
  if (fieldName === "cover169") {
    saved.cover169Path = filePath;
  }
}

export function requireSavedUploads(saved: SavedUploads, options: { requireCover169: boolean }) {
  if (!saved.videoPath) {
    throw new Error("必须上传视频");
  }
  if (!saved.cover34Path) {
    throw new Error("必须上传 3:4 封面");
  }
  if (!saved.cover43Path) {
    throw new Error("必须上传 4:3 封面");
  }
  if (options.requireCover169 && !saved.cover169Path) {
    throw new Error("发布微博或 B站必须上传 16:9 封面");
  }
  return {
    videoPath: saved.videoPath,
    cover34Path: saved.cover34Path,
    cover43Path: saved.cover43Path,
    cover169Path: saved.cover169Path
  };
}

function safeExtension(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (!/^\.[a-z0-9]+$/.test(ext)) {
    return "";
  }
  return ext;
}
