import { describe, expect, it } from "vitest";
import { getCoverSelection } from "../src/server/publisher/coverMapping";

const covers = {
  cover34Path: "/tmp/cover-34.png",
  cover43Path: "/tmp/cover-43.png",
  cover169Path: "/tmp/cover-169.png"
};

describe("cover mapping", () => {
  it("uses both covers for douyin", () => {
    expect(getCoverSelection("douyin", covers)).toEqual({
      cover34: covers.cover34Path,
      cover43: covers.cover43Path
    });
  });

  it("uses 3:4 covers for vertical platforms", () => {
    expect(getCoverSelection("xiaohongshu", covers)).toEqual({
      cover34: covers.cover34Path
    });
  });

  it("uses both card covers for WeChat Channels", () => {
    expect(getCoverSelection("wechat_channels", covers)).toEqual({
      cover34: covers.cover34Path,
      cover43: covers.cover43Path
    });
  });

  it("uses 4:3 and 16:9 covers for Bilibili", () => {
    expect(getCoverSelection("bilibili", covers)).toEqual({
      cover43: covers.cover43Path,
      cover169: covers.cover169Path
    });
  });

  it("uses 16:9 covers for Weibo", () => {
    expect(getCoverSelection("weibo", { ...covers, cover169Path: "/tmp/cover-169.png" })).toEqual({
      cover169: "/tmp/cover-169.png"
    });
  });

  it("does not use vertical or 4:3 covers for Weibo", () => {
    expect(getCoverSelection("weibo", {
      cover34Path: covers.cover34Path,
      cover43Path: covers.cover43Path
    })).toEqual({
      cover169: undefined
    });
  });
});
