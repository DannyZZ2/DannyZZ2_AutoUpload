import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateImageFile, validateVideoFile, validateWeiboVideoFile, validateWeiboVideoMetadata } from "../src/server/validation";
import { prepareWeiboVideoFile } from "../src/server/videoPrepare";

describe("upload validation", () => {
  it("accepts supported video extensions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publisher-test-"));
    const video = path.join(dir, "sample.mp4");
    fs.writeFileSync(video, Buffer.from("video"));
    expect(() => validateVideoFile(video)).not.toThrow();
    expect(prepareWeiboVideoFile(video)).toBe(video);
  });

  it("requires final Weibo videos to be mp4", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publisher-test-"));
    const video = path.join(dir, "sample.mov");
    fs.writeFileSync(video, Buffer.from("video"));
    expect(() => validateWeiboVideoFile(video)).toThrow(/mp4/);
  });

  it("validates image ratios from PNG dimensions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publisher-test-"));
    const cover34 = path.join(dir, "cover34.png");
    const cover43 = path.join(dir, "cover43.png");
    const cover169 = path.join(dir, "cover169.png");
    fs.writeFileSync(cover34, pngHeader(300, 400));
    fs.writeFileSync(cover43, pngHeader(400, 300));
    fs.writeFileSync(cover169, pngHeader(1600, 900));

    expect(() => validateImageFile(cover34, "3:4")).not.toThrow();
    expect(() => validateImageFile(cover43, "4:3")).not.toThrow();
    expect(() => validateImageFile(cover169, "16:9")).not.toThrow();
    expect(() => validateImageFile(cover34, "4:3")).toThrow(/需要是 4:3/);
  });

  it("accepts Weibo video metadata that matches platform requirements", () => {
    expect(() =>
      validateWeiboVideoMetadata({
        width: 1080,
        height: 1920,
        durationSeconds: 16,
        sizeBytes: 100 * 1024 * 1024
      })
    ).not.toThrow();
  });

  it("rejects Weibo video metadata below platform requirements", () => {
    expect(() =>
      validateWeiboVideoMetadata({
        width: 720,
        height: 1280,
        durationSeconds: 16,
        sizeBytes: 100 * 1024 * 1024
      })
    ).toThrow(/至少 1080p/);

    expect(() =>
      validateWeiboVideoMetadata({
        width: 1080,
        height: 1920,
        durationSeconds: 15,
        sizeBytes: 100 * 1024 * 1024
      })
    ).toThrow(/大于 15 秒/);

    expect(() =>
      validateWeiboVideoMetadata({
        width: 1080,
        height: 1920,
        durationSeconds: 16,
        sizeBytes: 16 * 1024 * 1024 * 1024
      })
    ).toThrow(/15G/);
  });
});

function pngHeader(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  buffer[0] = 0x89;
  buffer.write("PNG", 1, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}
