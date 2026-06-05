import type { Platform } from "../../shared/types";

export type CoverSelection = {
  cover34?: string;
  cover43?: string;
  cover169?: string;
};

export function getCoverSelection(platform: Platform, input: { cover34Path: string; cover43Path: string; cover169Path?: string }) {
  if (platform === "douyin") {
    return {
      cover34: input.cover34Path,
      cover43: input.cover43Path
    } satisfies CoverSelection;
  }

  if (platform === "wechat_channels") {
    return {
      cover34: input.cover34Path,
      cover43: input.cover43Path
    } satisfies CoverSelection;
  }

  if (platform === "xiaohongshu") {
    return {
      cover34: input.cover34Path
    } satisfies CoverSelection;
  }

  if (platform === "weibo") {
    return {
      cover169: input.cover169Path
    } satisfies CoverSelection;
  }

  return {
    cover43: input.cover43Path
  } satisfies CoverSelection;
}
