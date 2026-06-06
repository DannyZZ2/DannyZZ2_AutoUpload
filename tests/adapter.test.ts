import { describe, expect, it } from "vitest";
import type { PublishTask } from "../src/shared/types";
import { BilibiliAdapter } from "../src/server/publisher/platforms/bilibili";
import { DouyinAdapter } from "../src/server/publisher/platforms/douyin";
import { XiaohongshuAdapter } from "../src/server/publisher/platforms/xiaohongshu";
import { WeiboAdapter } from "../src/server/publisher/platforms/weibo";
import { WechatChannelsAdapter } from "../src/server/publisher/platforms/wechatChannels";
import type { PublishContext } from "../src/server/publisher/adapter";

describe("publisher adapters", () => {
  it("sets both 3:4 and 4:3 covers for douyin", async () => {
    const calls: string[] = [];
    const adapter = new DouyinAdapter();
    await adapter.setCover({
      task: sampleTask(),
      page: fakePage(calls),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("chooser-file:/tmp/cover34.png");
    expect(calls).toContain("chooser-file:/tmp/cover43.png");
    expect(calls).toContain("eval:douyin-cover-card-points:4:3");
    expect(calls).toContain("eval:douyin-cover-editor-visible");
    expect(calls).toContain("eval:douyin-cover-upload-box-points:4:3");
    expect(calls).toContain("eval:douyin-cover-tab-click:设置竖封面");
    expect(calls).toContain("eval:douyin-vertical-cover-active");
    expect(calls).toContain("eval:douyin-cover-upload-box-points:3:4");
    expect(calls).toContain("eval:douyin-cover-done-click");
    expect(calls).toContain("eval:douyin-cover-effect-pass-state");
    expect(calls).not.toContain("eval:douyin-cover-editor-close-state");
    expect(calls.indexOf("chooser-file:/tmp/cover43.png")).toBeLessThan(calls.indexOf("eval:douyin-cover-tab-click:设置竖封面"));
    expect(calls.indexOf("eval:douyin-cover-tab-click:设置竖封面")).toBeLessThan(calls.indexOf("chooser-file:/tmp/cover34.png"));
    expect(calls.indexOf("chooser-file:/tmp/cover34.png")).toBeLessThan(calls.indexOf("eval:douyin-cover-done-click"));
    expect(calls.indexOf("eval:douyin-cover-done-click")).toBeLessThan(calls.indexOf("eval:douyin-cover-effect-pass-state"));
  });

  it("uses the Douyin cover editor file input when the upload button does not open a chooser", async () => {
    const calls: string[] = [];
    const adapter = new DouyinAdapter();
    await adapter.setCover({
      task: sampleTask(),
      page: fakePage(calls, { douyinCoverChooserMissing: true }),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("eval:douyin-cover-editor-file-inputs");
    expect(calls).toContain("file:/tmp/cover43.png");
    expect(calls).toContain("file:/tmp/cover34.png");
    expect(calls).not.toContain("chooser-file:/tmp/cover43.png");
    expect(calls).not.toContain("chooser-file:/tmp/cover34.png");
    expect(calls.indexOf("file:/tmp/cover43.png")).toBeLessThan(calls.indexOf("eval:douyin-cover-tab-click:设置竖封面"));
    expect(calls.indexOf("eval:douyin-cover-tab-click:设置竖封面")).toBeLessThan(calls.indexOf("file:/tmp/cover34.png"));
  });

  it("fills Douyin title and copies tags into the description", async () => {
    const calls: string[] = [];
    const adapter = new DouyinAdapter();
    await adapter.setTitleAndTags({
      task: {
        ...sampleTask(),
        title: "抖音标题",
        tags: ["城市生活", "探店"]
      },
      page: fakePage(calls),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("fill:抖音标题");
    expect(calls).toContain("fill:#城市生活 #探店");
    expect(calls).not.toContain("keyboard-topic-converted:城市生活");
    expect(calls).not.toContain("keyboard-topic-converted:探店");
    expect(calls).not.toContain("fill:抖音标题\n#城市生活 #探店");
  });

  it("skips Douyin content declaration for now", async () => {
    const calls: string[] = [];
    const adapter = new DouyinAdapter();
    await adapter.setContentDeclaration({
      task: sampleTask(),
      page: fakePage(calls),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("step:跳过抖音自主声明");
    expect(calls).not.toContain("click:text:请进行内容声明");
  });

  it("clicks the bottom Douyin publish button instead of the first publish text", async () => {
    const calls: string[] = [];
    const adapter = new DouyinAdapter();
    await adapter.submitPublish({
      task: sampleTask(),
      page: fakePage(calls),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("eval:douyin-bottom-publish-click");
    expect(calls).toContain("eval:publish-submit-state");
    expect(calls).not.toContain("click:text:发布");
  });

  it("fills Xiaohongshu description with tags only", async () => {
    const calls: string[] = [];
    const adapter = new XiaohongshuAdapter();
    await adapter.setTitleAndTags({
      task: {
        ...sampleTask(),
        title: "小红书标题",
        tags: ["城市生活", "探店"]
      },
      page: fakePage(calls),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("fill:小红书标题");
    expect(calls).toContain("fill:#城市生活 #探店");
    expect(calls).not.toContain("fill:小红书标题\n#城市生活 #探店");
  });

  it("skips Xiaohongshu content declaration", async () => {
    const calls: string[] = [];
    const adapter = new XiaohongshuAdapter();
    await adapter.setContentDeclaration({
      task: sampleTask(),
      page: fakePage(calls),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toEqual([]);
  });

  it("clicks the fixed Xiaohongshu footer publish button instead of the first publish text", async () => {
    const calls: string[] = [];
    const adapter = new XiaohongshuAdapter();
    await adapter.submitPublish({
      task: sampleTask(),
      page: fakePage(calls),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("eval:xhs-bottom-publish-click");
    expect(calls).toContain("mouse-click:840:760");
    expect(calls).toContain("eval:publish-submit-state");
    expect(calls).not.toContain("eval:xhs-publish-page-scroll-bottom");
    expect(calls).not.toContain("click:text:发布");
    expect(calls.indexOf("eval:xhs-bottom-publish-click")).toBeLessThan(calls.indexOf("eval:publish-submit-state"));
  });

  it("uploads Xiaohongshu 3:4 cover through the cover editor", async () => {
    const calls: string[] = [];
    const adapter = new XiaohongshuAdapter();
    await adapter.setCover({
      task: sampleTask(),
      page: fakePage(calls),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("eval:xhs-cover-preview-click");
    expect(calls).toContain("eval:xhs-cover-editor-visible");
    expect(calls).toContain("eval:xhs-cover-ratio-dropdown-click");
    expect(calls).toContain("mouse-move:810:180");
    expect(calls).toContain("eval:xhs-cover-ratio-option-click:3:4");
    expect(calls).toContain("eval:xhs-cover-upload-image-click");
    expect(calls).toContain("mouse-click:1040:646");
    expect(calls).toContain("chooser-file:/tmp/cover34.png");
    expect(calls).toContain("eval:xhs-cover-upload-settled");
    expect(calls).toContain("eval:xhs-cover-confirm-click");
    expect(calls).toContain("eval:xhs-cover-effect-pass-state");
    expect(calls).not.toContain("eval:xhs-cover-editor-closed");
    expect(calls.indexOf("eval:xhs-cover-preview-click")).toBeLessThan(calls.indexOf("eval:xhs-cover-ratio-dropdown-click"));
    expect(calls.indexOf("eval:xhs-cover-ratio-option-click:3:4")).toBeLessThan(calls.indexOf("chooser-file:/tmp/cover34.png"));
    expect(calls.indexOf("mouse-click:1040:646")).toBeLessThan(calls.indexOf("chooser-file:/tmp/cover34.png"));
    expect(calls.indexOf("chooser-file:/tmp/cover34.png")).toBeLessThan(calls.indexOf("eval:xhs-cover-confirm-click"));
    expect(calls.indexOf("eval:xhs-cover-confirm-click")).toBeLessThan(calls.indexOf("eval:xhs-cover-effect-pass-state"));
  });

  it("uploads 4:3 and 16:9 covers for Bilibili", async () => {
    const calls: string[] = [];
    const adapter = new BilibiliAdapter();
    await adapter.setCover({
      task: sampleTask(),
      page: fakePage(calls),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("eval:bilibili-cover-setting-click");
    expect(calls).toContain("eval:bilibili-cover-editor-visible");
    expect(calls).toContain("eval:bilibili-cover-upload-click:4:3");
    expect(calls).toContain("chooser-file:/tmp/cover43.png");
    expect(calls).toContain("eval:bilibili-cover-ratio-click:16:9");
    expect(calls).toContain("eval:bilibili-cover-upload-click:16:9");
    expect(calls).toContain("chooser-file:/tmp/cover169.png");
    expect(calls).toContain("eval:bilibili-cover-done-click");
    expect(calls.indexOf("eval:bilibili-cover-setting-click")).toBeLessThan(calls.indexOf("eval:bilibili-cover-upload-click:4:3"));
    expect(calls.indexOf("chooser-file:/tmp/cover43.png")).toBeLessThan(calls.indexOf("eval:bilibili-cover-ratio-click:16:9"));
    expect(calls.indexOf("eval:bilibili-cover-ratio-click:16:9")).toBeLessThan(calls.indexOf("chooser-file:/tmp/cover169.png"));
    expect(calls.indexOf("chooser-file:/tmp/cover169.png")).toBeLessThan(calls.indexOf("eval:bilibili-cover-done-click"));
  });

  it("selects Bilibili recommended tags before typing missing tags", async () => {
    const calls: string[] = [];
    const adapter = new BilibiliAdapter();
    await adapter.setTitleAndTags({
      task: {
        ...sampleTask(),
        title: "B站标题",
        tags: ["教程", "agent", "不存在推荐"]
      },
      page: fakePage(calls),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("fill:B站标题");
    expect(calls).toContain("fill:B站标题\n#教程 #agent #不存在推荐");
    expect(calls).toContain("click:locator:input[placeholder*=\"标签\"]");
    expect(calls).toContain("fill:");
    expect(calls).toContain("keyboard-press:Backspace");
    expect(calls).toContain("eval:bilibili-recommended-tag-click:教程");
    expect(calls).toContain("eval:bilibili-recommended-tag-click:agent");
    expect(calls).toContain("eval:bilibili-recommended-tag-missing:不存在推荐");
    expect(calls).toContain("keyboard-insert:不存在推荐");
    expect(calls).toContain("keyboard-press:Space");
    expect(calls.indexOf("fill:")).toBeLessThan(calls.indexOf("eval:bilibili-recommended-tag-click:教程"));
    expect(calls.indexOf("eval:bilibili-recommended-tag-click:agent")).toBeLessThan(calls.indexOf("keyboard-insert:不存在推荐"));
  });

  it("runs WeChat Channels cover selection immediately after video upload", async () => {
    const calls: string[] = [];
    const adapter = new TestableWechatPublishOrderAdapter(calls);
    await adapter.runOrder();

    expect(calls).toContain("method:uploadVideo");
    expect(calls).toContain("method:setCover");
    expect(calls.indexOf("method:uploadVideo")).toBeLessThan(calls.indexOf("method:setCover"));
    expect(calls.indexOf("method:setCover")).toBeLessThan(calls.indexOf("method:setTitleAndTags"));
    expect(calls).toContain("method:setContentDeclaration");
    expect(calls).toContain("method:submitPublish");
  });

  it("sets 4:3 share card before 3:4 personal card covers for WeChat Channels", async () => {
    const calls: string[] = [];
    const adapter = new WechatChannelsAdapter();
    await adapter.setCover({
      task: sampleTask(),
      page: fakePage(calls),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("eval:wechat-cover-edit-dom-click");
    expect(calls).toContain("eval:wechat-cover-preview-page-visible");
    expect(calls).toContain("viewport:1920:1280");
    expect(calls).toContain("chooser-file:/tmp/cover34.png");
    expect(calls).toContain("eval:wechat-cover-use-material-click");
    expect(calls).toContain("mouse-click:635:406");
    expect(calls).toContain("eval:wechat-cover-use-material-point-click:635:406");
    expect(calls).toContain("chooser-file:/tmp/cover43.png");
    expect(calls).toContain("eval:wechat-cover-confirm-scroll");
    expect(calls.filter((call) => call === "eval:wechat-cover-use-material-click")).toHaveLength(2);
    expect(calls.indexOf("eval:wechat-cover-edit-dom-click")).toBeLessThan(calls.indexOf("chooser-file:/tmp/cover43.png"));
    expect(calls.indexOf("eval:wechat-cover-use-material-click")).toBeLessThan(calls.indexOf("chooser-file:/tmp/cover43.png"));
    expect(calls.indexOf("chooser-file:/tmp/cover43.png")).toBeLessThan(calls.indexOf("chooser-file:/tmp/cover34.png"));
    expect(calls.indexOf("chooser-file:/tmp/cover43.png")).toBeLessThan(calls.lastIndexOf("eval:wechat-cover-use-material-click"));
    expect(calls.lastIndexOf("eval:wechat-cover-use-material-click")).toBeLessThan(calls.indexOf("chooser-file:/tmp/cover34.png"));
  });

  it("retries WeChat Channels 4:3 use-material prompt when the upload editor does not open", async () => {
    const calls: string[] = [];
    const adapter = new WechatChannelsAdapter();
    await adapter.setCover({
      task: sampleTask(),
      page: fakePage(calls, { wechatUseMaterialNeedsRetry: true }),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    const useMaterialIndexes = calls
      .map((call, index) => (call === "eval:wechat-cover-use-material-click" ? index : -1))
      .filter((index) => index >= 0);
    expect(useMaterialIndexes).toHaveLength(3);
    expect(useMaterialIndexes[1]).toBeLessThan(calls.indexOf("chooser-file:/tmp/cover43.png"));
    expect(calls.indexOf("chooser-file:/tmp/cover43.png")).toBeLessThan(calls.indexOf("chooser-file:/tmp/cover34.png"));
    expect(calls.indexOf("chooser-file:/tmp/cover43.png")).toBeLessThan(useMaterialIndexes[2]);
    expect(useMaterialIndexes[2]).toBeLessThan(calls.indexOf("chooser-file:/tmp/cover34.png"));
  });

  it("uploads WeChat Channels covers from the edit dialog and confirms each cover", async () => {
    const calls: string[] = [];
    const adapter = new WechatChannelsAdapter();
    await adapter.setCover({
      task: sampleTask(),
      page: fakePage(calls, { wechatCoverEditOpensDialog: true }),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("mouse-click:840:1104");
    expect(calls).toContain("chooser-file:/tmp/cover34.png");
    expect(calls).toContain("chooser-file:/tmp/cover43.png");
    expect(calls.filter((call) => call === "eval:wechat-cover-confirm-dom-click")).toHaveLength(2);
    expect(calls.filter((call) => call === "eval:wechat-cover-confirm-dom-click-includes-confirm")).toHaveLength(2);
    expect(calls.indexOf("mouse-click:840:1104")).toBeLessThan(calls.indexOf("chooser-file:/tmp/cover43.png"));
    expect(calls.indexOf("chooser-file:/tmp/cover43.png")).toBeLessThan(calls.indexOf("chooser-file:/tmp/cover34.png"));
  });

  it("fills WeChat Channels description with title and tags, then writes a sanitized short title", async () => {
    const calls: string[] = [];
    const adapter = new WechatChannelsAdapter();
    await adapter.setTitleAndTags({
      task: {
        ...sampleTask(),
        title: "保姆级 Codex，0基础！入门教程@2026",
        tags: ["AI工具", "教程"]
      },
      page: fakePage(calls),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("fill:保姆级 Codex，0基础！入门教程@2026\n#AI工具 #教程");
    expect(calls).toContain("fill:保姆级 Codex 0基础入门教");
    expect(calls.indexOf("step:填写视频号视频描述")).toBeLessThan(calls.indexOf("step:填写视频号短标题"));
  });

  it("falls back to DOM filling when WeChat Channels description selectors fail", async () => {
    const calls: string[] = [];
    const adapter = new WechatChannelsAdapter();
    await adapter.setTitleAndTags({
      task: sampleTask(),
      page: fakePage(calls, { wechatDescriptionSelectorsFail: true }),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("eval:wechat-description-dom-fill:测试标题\n#城市生活 #探店");
    expect(calls).toContain("fill:测试标题");
  });

  it("selects original declaration for WeChat Channels", async () => {
    const calls: string[] = [];
    const adapter = new WechatChannelsAdapter();
    await adapter.setContentDeclaration({
      task: sampleTask(),
      page: fakePage(calls),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("step:设置视频号声明原创");
    expect(calls).toContain("step:定位视频号原创声明区域");
    expect(calls).not.toContain("eval:wechat-publish-page-scroll-bottom");
    expect(calls).toContain("eval:wechat-original-declaration-direct-click");
    expect(calls).toContain("eval:wechat-original-declaration-target");
    expect(calls).toContain("eval:wechat-original-declaration-click");
    expect(calls).not.toContain("eval:wechat-original-declaration-point");
    expect(calls).toContain("eval:wechat-original-rights-dialog-points");
    expect(calls).toContain("eval:wechat-original-rights-dialog-action");
    expect(calls).toContain("eval:wechat-original-agreement-dialog-click");
    expect(calls).toContain("eval:wechat-original-rights-confirm-click");
    expect(calls).toContain("eval:wechat-original-rights-dialog-visible");
    expect(calls).not.toContain("eval:wechat-original-rights-confirm-enabled");
  });

  it("confirms an already open WeChat Channels original rights dialog", async () => {
    const calls: string[] = [];
    const adapter = new WechatChannelsAdapter();
    await adapter.setContentDeclaration({
      task: sampleTask(),
      page: fakePage(calls, { wechatOriginalRightsAlreadyOpen: true }),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("step:设置视频号声明原创");
    expect(calls).toContain("eval:wechat-original-rights-dialog-points");
    expect(calls).toContain("eval:wechat-original-rights-dialog-action");
    expect(calls).toContain("eval:wechat-original-agreement-dialog-click");
    expect(calls).toContain("eval:wechat-original-rights-confirm-click");
    expect(calls).toContain("eval:wechat-original-rights-dialog-visible");
    expect(calls).not.toContain("eval:wechat-original-declaration-click");
    expect(calls).not.toContain("eval:wechat-original-declaration-point");
  });

  it("clicks the WeChat original entry again when rights confirmation does not select it", async () => {
    const calls: string[] = [];
    const adapter = new WechatChannelsAdapter();
    await adapter.setContentDeclaration({
      task: sampleTask(),
      page: fakePage(calls, { wechatOriginalNeedsSecondEntryClickAfterRights: true }),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("eval:wechat-original-rights-confirm-click");
    expect(calls.filter((call) => call === "eval:wechat-original-declaration-click").length).toBeGreaterThanOrEqual(2);
  });

  it("stops WeChat Channels publish when original declaration is not selected after retrying", async () => {
    const calls: string[] = [];
    const adapter = new WechatChannelsAdapter();
    await expect(
      adapter.setContentDeclaration({
        task: sampleTask(),
        page: fakePage(calls, { wechatOriginalDeclarationStaysUnselected: true }),
        step: async (step) => {
          calls.push(`step:${step}`);
        }
      }
    )).rejects.toThrow(/声明原创未成功选中/);

    expect(calls).toContain("eval:wechat-original-rights-confirm-click");
    expect(calls.filter((call) => call === "eval:wechat-original-declaration-selected").length).toBeGreaterThan(1);
    expect(calls).toContain("step:视频号声明原创未确认选中，继续尝试点选");
    expect(calls).not.toContain("step:视频号声明原创未确认选中，继续发表");
  });

  it("keeps trying the WeChat original agreement checkbox while the dialog stays open", async () => {
    const calls: string[] = [];
    const adapter = new WechatChannelsAdapter();
    await adapter.setContentDeclaration({
      task: sampleTask(),
      page: fakePage(calls, {
        wechatOriginalRightsAlreadyOpen: true,
        wechatOriginalRightsReadyAfterAgreementAttempts: 2,
        wechatOriginalRightsCloseAfterConfirmAttempts: 3
      }),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls.filter((call) => call === "eval:wechat-original-agreement-dialog-click").length).toBeGreaterThanOrEqual(1);
    expect(calls.filter((call) => call === "eval:wechat-original-rights-dialog-action").length).toBeGreaterThanOrEqual(1);
    expect(calls.filter((call) => call === "eval:wechat-original-rights-confirm-click").length).toBeGreaterThanOrEqual(3);
    expect(calls.filter((call) => call === "eval:wechat-original-rights-confirm-ready").length).toBeGreaterThanOrEqual(3);
    expect(calls.indexOf("eval:wechat-original-agreement-dialog-click")).toBeLessThan(calls.indexOf("eval:wechat-original-rights-confirm-click"));
  });

  it("stops WeChat Channels publish when original rights dialog stays open", async () => {
    const calls: string[] = [];
    const adapter = new WechatChannelsAdapter();
    await expect(
      adapter.setContentDeclaration({
        task: sampleTask(),
        page: fakePage(calls, {
          wechatOriginalRightsAlreadyOpen: true,
          wechatOriginalRightsReadyAfterAgreementAttempts: 1,
          wechatOriginalRightsCloseAfterConfirmAttempts: 99
        }),
        step: async (step) => {
          calls.push(`step:${step}`);
        }
      }
    )).rejects.toThrow(/原创权益弹窗未完成/);

    expect(calls).toContain("eval:wechat-original-rights-dialog-visible");
    expect(calls).not.toContain("step:视频号原创权益弹窗未完成，继续发表");
    expect(calls).not.toContain("eval:wechat-original-declaration-click");
    expect(calls).not.toContain("eval:wechat-original-declaration-point");
  });

  it("opens the dedicated weibo video publisher before uploading", async () => {
    const calls: string[] = [];
    const adapter = new WeiboAdapter();
    await adapter.uploadVideo({
      task: sampleTask(),
      page: fakePage(calls),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    const videoEntryClick = calls.findIndex((call) => call.startsWith("mouse-click:260:100"));
    expect(videoEntryClick).toBeGreaterThanOrEqual(0);
    expect(videoEntryClick).toBeLessThan(calls.indexOf("click:role:button:/^上传视频$/"));
    expect(calls.indexOf("click:role:button:/^上传视频$/")).toBeLessThan(calls.indexOf("chooser-file:/tmp/video.mp4"));
  });

  it("fails early when Weibo video upload initialization fails", async () => {
    const calls: string[] = [];
    const adapter = new WeiboAdapter();
    await expect(
      adapter.uploadVideo({
        task: sampleTask(),
        page: fakePage(calls, { weiboUploadError: true }),
        step: async (step) => {
          calls.push(`step:${step}`);
        }
      })
    ).rejects.toThrow("微博视频上传失败");

    expect(calls).toContain("step:等待微博发布表单可填写");
  });

  it("uploads a 16:9 Weibo cover and clicks done", async () => {
    const calls: string[] = [];
    const adapter = new WeiboAdapter();
    await adapter.setCover({
      task: sampleTask(),
      page: fakePage(calls),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("chooser-file:/tmp/cover169.png");
    expect(calls.indexOf("chooser-file:/tmp/cover169.png")).toBeLessThan(calls.indexOf("click:role:button:/^完成$/"));
  });

  it("sets Weibo post details in the requested order", async () => {
    const calls: string[] = [];
    const adapter = new WeiboAdapter();
    await adapter.setWeiboPostDetails({
      task: sampleTask(),
      page: fakePage(calls, { categoryOptionsRequireScroll: true }),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("click:text:原创");
    expect(calls).toContain("click:text:请进行内容声明");
    expect(calls).toContain("click:role:option:/^内容无需标注$/");
    expect(calls).toContain("click:role:button:/^确定$/");
    expect(calls).toContain("fill:测试标题");
    expect(calls).toContain("eval:category-page-scroll-point");
    expect(calls).toContain("mouse-move:1180:520");
    expect(calls).toContain("mouse-wheel:0:620");
    expect(calls).toContain("chooser-file:/tmp/cover169.png");
    expect(calls).toContain("mouse-click:1262:180");
    expect(calls).toContain("mouse-move:1262:180");
    expect(calls).toContain("mouse-wheel:0:520");
    expect(calls).not.toContain("mouse-click:410:210");
    expect(calls).toContain("eval:category-option:科技数码");
    expect(calls).toContain("eval:category-option:科技");
    expect(calls).toContain("fill:#城市生活# #探店#");

    expect(calls.indexOf("step:选择微博原创类型")).toBeLessThan(calls.indexOf("step:设置微博内容声明：内容无需标注"));
    expect(calls.indexOf("step:设置微博内容声明：内容无需标注")).toBeLessThan(calls.indexOf("step:填写微博标题"));
    expect(calls.indexOf("fill:测试标题")).toBeLessThan(calls.indexOf("step:滚动到微博分类区域"));
    expect(calls.indexOf("mouse-wheel:0:620")).toBeLessThan(calls.indexOf("mouse-click:1262:180"));
    expect(calls.indexOf("mouse-move:1262:180")).toBeLessThan(calls.indexOf("mouse-wheel:0:520"));
    expect(calls.indexOf("eval:category-option:科技")).toBeLessThan(calls.indexOf("fill:#城市生活# #探店#"));
    expect(calls.indexOf("fill:#城市生活# #探店#")).toBeLessThan(calls.indexOf("chooser-file:/tmp/cover169.png"));
  });

  it("sets content declaration to no annotation", async () => {
    const calls: string[] = [];
    const adapter = new BilibiliAdapter();
    await adapter.setContentDeclaration({
      task: sampleTask(),
      page: fakePage(calls),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("click:text:请进行内容声明");
    expect(calls).toContain("click:role:option:/^内容无需标注$/");
  });

  it("confirms platform success after clicking publish", async () => {
    const calls: string[] = [];
    const adapter = new BilibiliAdapter();
    await adapter.submitPublish({
      task: sampleTask(),
      page: fakePage(calls),
      step: async (step) => {
        calls.push(`step:${step}`);
      }
    });

    expect(calls).toContain("click:text:立即投稿");
    expect(calls).toContain("eval:publish-submit-state");
  });

  it("does not report success when publish confirmation is missing", async () => {
    const calls: string[] = [];
    const adapter = new TestablePublishConfirmationAdapter();

    await expect(
      adapter.waitForSubmitResult(fakePage(calls, { publishSubmitUnconfirmed: true }), 1)
    ).rejects.toThrow("未确认平台发布成功");

    expect(calls).toContain("eval:publish-submit-state");
  });

});

function sampleTask(): PublishTask {
  return {
    id: "task-1",
    videoPath: "/tmp/video.mp4",
    cover34Path: "/tmp/cover34.png",
    cover43Path: "/tmp/cover43.png",
    cover169Path: "/tmp/cover169.png",
    title: "测试标题",
    tags: ["城市生活", "探店"],
    platforms: ["douyin"],
    autoPublish: true,
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

class TestableWechatPublishOrderAdapter extends WechatChannelsAdapter {
  constructor(private calls: string[]) {
    super();
  }

  async runOrder() {
    return this.runWechatPublishSteps({
      task: sampleTask(),
      page: fakePage(this.calls),
      step: async (step) => {
        this.calls.push(`step:${step}`);
      }
    });
  }

  override async openPublisher(_context: PublishContext) {
    this.calls.push("method:openPublisher");
  }

  override async ensureLogin(_context: PublishContext) {
    this.calls.push("method:ensureLogin");
  }

  override async uploadVideo(_context: PublishContext) {
    this.calls.push("method:uploadVideo");
  }

  override async setCover(_context: PublishContext) {
    this.calls.push("method:setCover");
  }

  override async setTitleAndTags(_context: PublishContext) {
    this.calls.push("method:setTitleAndTags");
  }

  override async setContentDeclaration(_context: PublishContext) {
    this.calls.push("method:setContentDeclaration");
  }

  override async submitPublish(_context: PublishContext) {
    this.calls.push("method:submitPublish");
  }
}

class TestablePublishConfirmationAdapter extends BilibiliAdapter {
  waitForSubmitResult(page: unknown, timeout: number) {
    return this.waitForPublishSubmitted(page as never, timeout);
  }
}

type FakePageOptions = {
  weiboUploadError?: boolean;
  douyinCoverChooserMissing?: boolean;
  publishSubmitFailureText?: string;
  publishSubmitUnconfirmed?: boolean;
  categoryOptionsRequireScroll?: boolean;
  wechatDescriptionSelectorsFail?: boolean;
  wechatCoverEditOpensDialog?: boolean;
  wechatUseMaterialNeedsRetry?: boolean;
  wechatOriginalRightsAlreadyOpen?: boolean;
  wechatOriginalDeclarationStaysUnselected?: boolean;
  wechatOriginalNeedsSecondEntryClickAfterRights?: boolean;
  wechatOriginalRightsCloseAfterConfirmAttempts?: number;
  wechatOriginalRightsReadyAfterAgreementAttempts?: number;
};

function fakePage(calls: string[], options: FakePageOptions = {}) {
  const textBoxes: Record<string, { x: number; y: number; width: number; height: number }> = {
    表情: { x: 50, y: 90, width: 40, height: 20 },
    图片: { x: 150, y: 90, width: 40, height: 20 },
    视频: { x: 240, y: 90, width: 40, height: 20 },
    话题: { x: 340, y: 90, width: 40, height: 20 },
    头条文章: { x: 430, y: 90, width: 70, height: 20 },
    更多: { x: 540, y: 90, width: 40, height: 20 },
    分类: { x: 50, y: 130, width: 50, height: 20 },
    请选择合适的频道: { x: 80, y: 150, width: 1200, height: 60 },
    科技数码: { x: 600, y: 490, width: 70, height: 20 },
    科技: { x: 785, y: 530, width: 40, height: 20 },
    确定: { x: 900, y: 570, width: 40, height: 20 },
    内容无需标注: { x: 600, y: 360, width: 100, height: 20 },
    发表时间: { x: 80, y: 400, width: 80, height: 20 },
    个人主页卡片: { x: 180, y: 250, width: 100, height: 20 },
    分享卡片: { x: 525, y: 250, width: 80, height: 20 },
    "4:3": { x: 545, y: 270, width: 40, height: 20 },
    编辑个人主页卡片: { x: 80, y: 80, width: 160, height: 30 },
    编辑分享卡片: { x: 80, y: 80, width: 120, height: 30 },
    上传封面: { x: 800, y: 1146, width: 80, height: 24 }
  };

  return fakePageInstance(calls, false, textBoxes, options);
}

function fakePageInstance(
  calls: string[],
  isUploadPage: boolean,
  textBoxes: Record<string, { x: number; y: number; width: number; height: number }>,
  options: FakePageOptions
) {
  const pointArg = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) && "x" in value && "y" in value
      ? value as { x?: number; y?: number }
      : undefined;
  const targetTextArg = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) && "targetText" in value
      ? (value as { targetText?: string }).targetText
      : undefined;
  const locator = (label: string, box?: { x: number; y: number; width: number; height: number }): unknown => ({
    locator: (selector: string) => locator(`${label} ${selector}`),
    getByText: (text: string) => locator(`${label} text:${text}`),
    first: () => locator(label, box),
    last: () => locator(label, box),
    all: async () => {
      if (isCategoryPlaceholder(label) && calls.includes("eval:category-option:科技")) {
        return [];
      }
      if (options.categoryOptionsRequireScroll && isCategoryOption(label) && !calls.includes("mouse-wheel:0:520")) {
        return [];
      }
      return box ? [locator(label, box)] : [];
    },
    boundingBox: async () => box,
    waitFor: async () => {
      if (!isUploadPage && isUploadPageMarker(label)) {
        throw new Error(`marker unavailable: ${label}`);
      }
      if (
        options.wechatUseMaterialNeedsRetry &&
        isWechatCoverEditorMarker(label) &&
        calls.filter((call) => call === "eval:wechat-cover-use-material-click").length === 1
      ) {
        throw new Error(`cover editor marker unavailable after first use-material click: ${label}`);
      }
      if (isWeiboUploadFailureMarker(label) && !options.weiboUploadError) {
        throw new Error(`upload failure marker unavailable: ${label}`);
      }
      if (isWeiboTransientUploadMarker(label)) {
        throw new Error(`transient upload marker unavailable: ${label}`);
      }
      calls.push(`wait:${label}`);
    },
    setInputFiles: async (filePath: string) => {
      calls.push(`file:${filePath}`);
    },
    fill: async (value: string) => {
      if (options.wechatDescriptionSelectorsFail && isWechatDescriptionSelector(label)) {
        throw new Error(`description selector unavailable: ${label}`);
      }
      calls.push(`fill:${value}`);
    },
    click: async () => {
      calls.push(`click:${label}`);
    }
  });

  return {
    locator: (selector: string) => locator(`locator:${selector}`),
    getByRole: (role: string, options: { name: RegExp | string }) => locator(`role:${role}:${options.name}`),
    getByText: (text: string) => locator(`text:${text}`, isUploadPage ? undefined : textBoxes[text]),
    mouse: {
      click: async (x: number, y: number) => {
        calls.push(`mouse-click:${x}:${y}`);
      },
      move: async (x: number, y: number) => {
        calls.push(`mouse-move:${x}:${y}`);
      },
      wheel: async (x: number, y: number) => {
        calls.push(`mouse-wheel:${x}:${y}`);
      }
    },
    waitForEvent: async (event: string) => {
      calls.push(`wait-event:${event}`);
      if (event === "popup") {
        return fakePageInstance(calls, !options.wechatCoverEditOpensDialog, textBoxes, options);
      }
      if (event === "filechooser" && options.douyinCoverChooserMissing) {
        throw new Error("file chooser unavailable");
      }
      return {
        setFiles: async (filePath: string) => {
          calls.push(`chooser-file:${filePath}`);
        }
      };
    },
    waitForLoadState: async () => undefined,
    waitForTimeout: async () => undefined,
    setViewportSize: async (viewport: { width: number; height: number }) => {
      calls.push(`viewport:${viewport.width}:${viewport.height}`);
    },
    evaluate: async (fn: (() => unknown) | string, arg?: { targetText?: string; x?: number; y?: number } | string | string[]) => {
      if (String(fn).includes("douyin-bottom-publish-click")) {
        calls.push("eval:douyin-bottom-publish-click");
        return {
          clicked: true,
          point: { x: 450, y: 1180 },
          targetText: "发布",
          hitText: "发布",
          candidates: [
            {
              text: "发布",
              tagName: "button",
              point: { x: 450, y: 1180 },
              rect: { left: 380, top: 1158, width: 140, height: 44, right: 520, bottom: 1202 }
            }
          ]
        };
      }
      if (String(fn).includes("xhs-publish-page-scroll-bottom")) {
        calls.push("eval:xhs-publish-page-scroll-bottom");
        return true;
      }
      if (String(fn).includes("xhs-bottom-publish-click")) {
        calls.push("eval:xhs-bottom-publish-click");
        return {
          clicked: true,
          point: { x: 840, y: 760 },
          targetText: "发布",
          targetTagName: "BUTTON",
          targetRect: { left: 720, top: 724, width: 240, height: 72, right: 960, bottom: 796 },
          hitText: "发布",
          hitTagName: "BUTTON"
        };
      }
      if (String(fn).includes("publish-submit-state")) {
        calls.push("eval:publish-submit-state");
        if (options.publishSubmitFailureText) {
          return {
            success: false,
            failed: true,
            failureText: options.publishSubmitFailureText,
            text: options.publishSubmitFailureText
          };
        }
        if (options.publishSubmitUnconfirmed) {
          return {
            success: false,
            failed: false,
            text: "仍在发布页面"
          };
        }
        return {
          success: true,
          failed: false,
          text: "发布成功"
        };
      }
      if (String(fn).includes("xhs-cover-preview-click")) {
        calls.push("eval:xhs-cover-preview-click");
        return true;
      }
      if (String(fn).includes("xhs-cover-editor-visible")) {
        calls.push("eval:xhs-cover-editor-visible");
        return calls.includes("eval:xhs-cover-preview-click");
      }
      if (String(fn).includes("xhs-cover-ratio-dropdown-click")) {
        calls.push("eval:xhs-cover-ratio-dropdown-click");
        return { clicked: true, point: { x: 810, y: 180 }, targetText: "4:3" };
      }
      if (String(fn).includes("xhs-cover-ratio-option-click")) {
        calls.push("eval:xhs-cover-ratio-option-click:3:4");
        return true;
      }
      if (String(fn).includes("xhs-cover-upload-image-click")) {
        calls.push("eval:xhs-cover-upload-image-click");
        return {
          clicked: true,
          point: { x: 1040, y: 646 },
          targetText: "+ 上传图片",
          targetTagName: "BUTTON",
          targetRect: { left: 980, top: 620, width: 120, height: 52, right: 1100, bottom: 672 },
          hitText: "+ 上传图片",
          hitTagName: "BUTTON"
        };
      }
      if (String(fn).includes("xhs-cover-upload-settled")) {
        calls.push("eval:xhs-cover-upload-settled");
        return {
          ready: calls.includes("chooser-file:/tmp/cover34.png"),
          failed: false,
          text: ""
        };
      }
      if (String(fn).includes("xhs-cover-confirm-click")) {
        calls.push("eval:xhs-cover-confirm-click");
        return true;
      }
      if (String(fn).includes("xhs-cover-effect-pass-state")) {
        calls.push("eval:xhs-cover-effect-pass-state");
        const confirmed = calls.includes("eval:xhs-cover-confirm-click");
        return {
          passed: confirmed,
          failed: false,
          text: confirmed ? "封面效果评估通过，未发现封面质量问题" : ""
        };
      }
      if (String(fn).includes("bilibili-cover-setting-click")) {
        calls.push("eval:bilibili-cover-setting-click");
        return {
          clicked: true,
          point: { x: 260, y: 470 },
          targetText: "封面设置",
          targetTagName: "DIV"
        };
      }
      if (String(fn).includes("bilibili-cover-editor-visible")) {
        calls.push("eval:bilibili-cover-editor-visible");
        return calls.includes("eval:bilibili-cover-setting-click");
      }
      if (String(fn).includes("bilibili-cover-upload-click")) {
        const ratio = typeof arg === "string"
          ? arg
          : String(fn).includes('targetRatio = "16:9"')
            ? "16:9"
            : "4:3";
        calls.push(`eval:bilibili-cover-upload-click:${ratio}`);
        return {
          clicked: true,
          point: ratio === "16:9" ? { x: 540, y: 760 } : { x: 520, y: 1120 },
          targetText: "上传封面",
          targetTagName: "BUTTON"
        };
      }
      if (String(fn).includes("bilibili-cover-ratio-click")) {
        const ratio = typeof arg === "string"
          ? arg
          : String(fn).includes('targetRatio = "16:9"')
            ? "16:9"
            : "unknown";
        calls.push(`eval:bilibili-cover-ratio-click:${ratio}`);
        return {
          clicked: true,
          point: { x: 460, y: 480 },
          targetText: "个人空间封面（16:9）",
          targetTagName: "BUTTON"
        };
      }
      if (String(fn).includes("bilibili-cover-done-click")) {
        calls.push("eval:bilibili-cover-done-click");
        return {
          clicked: true,
          point: { x: 1180, y: 1120 },
          targetText: "完成",
          targetTagName: "BUTTON"
        };
      }
      if (String(fn).includes("bilibili-recommended-tag-click")) {
        const script = String(fn);
        const matched = script.match(/const targetTag = "([^"]+)"/);
        const tag = matched?.[1] ?? "";
        if (["教程", "agent"].includes(tag)) {
          calls.push(`eval:bilibili-recommended-tag-click:${tag}`);
          return { clicked: true, tag };
        }
        calls.push(`eval:bilibili-recommended-tag-missing:${tag}`);
        return { clicked: false, tag };
      }
      if (String(fn).includes("douyin-cover-card-click")) {
        calls.push(`eval:douyin-cover-card-click:${arg}`);
        return true;
      }
      if (String(fn).includes("douyin-cover-card-points")) {
        calls.push(`eval:douyin-cover-card-points:${arg}`);
        return arg === "4:3" ? [{ x: 610, y: 620 }] : [{ x: 730, y: 620 }];
      }
      if (String(fn).includes("douyin-video-upload-state")) {
        calls.push("eval:douyin-video-upload-state");
        return { uploading: false };
      }
      if (String(fn).includes("douyin-cover-upload-button-click")) {
        calls.push(`eval:douyin-cover-upload-button-click:${arg}`);
        return true;
      }
      if (String(fn).includes("douyin-cover-editor-visible")) {
        calls.push("eval:douyin-cover-editor-visible");
        return calls.includes("eval:douyin-cover-card-click:4:3") || calls.includes("mouse-click:610:620");
      }
      if (String(fn).includes("douyin-cover-upload-box-points")) {
        calls.push(`eval:douyin-cover-upload-box-points:${arg}`);
        return arg === "3:4" ? [{ x: 1060, y: 900 }] : [{ x: 1000, y: 900 }];
      }
      if (String(fn).includes("douyin-cover-editor-file-inputs")) {
        calls.push("eval:douyin-cover-editor-file-inputs");
        return [3, 2, 1];
      }
      if (String(fn).includes("douyin-cover-tab-click")) {
        calls.push(`eval:douyin-cover-tab-click:${arg}`);
        return true;
      }
      if (String(fn).includes("douyin-vertical-cover-active")) {
        calls.push("eval:douyin-vertical-cover-active");
        return calls.includes("eval:douyin-cover-tab-click:设置竖封面");
      }
      if (String(fn).includes("douyin-cover-done-click")) {
        calls.push("eval:douyin-cover-done-click");
        return true;
      }
      if (String(fn).includes("douyin-cover-effect-pass-state")) {
        calls.push("eval:douyin-cover-effect-pass-state");
        const doneClicked = calls.includes("eval:douyin-cover-done-click");
        return {
          passed: doneClicked,
          failed: false,
          text: doneClicked ? "封面效果检测通过" : ""
        };
      }
      if (String(fn).includes("wechat-description-dom-fill")) {
        const description = typeof arg === "string" ? arg : extractJsonStringAfter(String(fn), "const description = ");
        calls.push(`eval:wechat-description-dom-fill:${description}`);
        return true;
      }
      if (String(fn).includes("wechat-publish-page-viewport-reset")) {
        calls.push("eval:wechat-publish-page-viewport-reset");
        return true;
      }
      if (String(fn).includes("wechat-publish-page-scroll-bottom")) {
        calls.push("eval:wechat-publish-page-scroll-bottom");
        return true;
      }
      if (String(fn).includes("wechat-original-declaration-target")) {
        calls.push("eval:wechat-original-declaration-target");
        return {
          x: 700,
          y: 900,
          text: "声明原创",
          tagName: "div",
          role: "",
          source: "form-item-cell-center-post-with-link",
          rect: { left: 650, top: 880, width: 100, height: 40, right: 750, bottom: 920 },
          hitText: "声明原创",
          hitTagName: "div"
        };
      }
      if (String(fn).includes("wechat-original-declaration-point")) {
        calls.push("eval:wechat-original-declaration-point");
        return { x: 700, y: 900 };
      }
      if (String(fn).includes("wechat-original-declaration-click")) {
        calls.push("eval:wechat-original-declaration-click");
        return true;
      }
      if (String(fn).includes("__wechatOriginalDeclarationClickX")) {
        calls.push("eval:wechat-original-declaration-click-state");
        return true;
      }
      if (String(fn).includes("wechat-original-declaration-direct-click")) {
        calls.push("eval:wechat-original-declaration-direct-click");
        calls.push("eval:wechat-original-declaration-target");
        calls.push("eval:wechat-original-declaration-click");
        return {
          clicked: true,
          source: "wujie-shadow:0",
          text: "声明原创",
          point: { x: 700, y: 900 },
          rect: { left: 650, top: 880, width: 100, height: 40, right: 750, bottom: 920 },
          hitText: "声明原创",
          hitTagName: "div"
        };
      }
      if (String(fn).includes("wechat-original-declaration-direct-scroll")) {
        calls.push("eval:wechat-original-declaration-direct-scroll");
        return true;
      }
      if (String(fn).includes("wechat-original-declaration-direct-selected")) {
        calls.push("eval:wechat-original-declaration-direct-selected");
        calls.push("eval:wechat-original-declaration-selected");
        if (
          options.wechatOriginalRightsCloseAfterConfirmAttempts &&
          calls.filter((call) => call === "eval:wechat-original-rights-confirm-click").length <
            options.wechatOriginalRightsCloseAfterConfirmAttempts
        ) {
          return false;
        }
        if (options.wechatOriginalDeclarationStaysUnselected) {
          return false;
        }
        if (options.wechatOriginalNeedsSecondEntryClickAfterRights) {
          return calls.includes("eval:wechat-original-rights-confirm-click") &&
            calls.filter((call) => call === "eval:wechat-original-declaration-direct-click").length >= 2;
        }
        return calls.includes("eval:wechat-original-rights-confirm-click");
      }
      if (String(fn).includes("wechat-original-rights-dialog-direct-visible")) {
        calls.push("eval:wechat-original-rights-dialog-direct-visible");
        calls.push("eval:wechat-original-rights-dialog-visible");
        const directClicks = calls.filter((call) => call === "eval:wechat-original-declaration-direct-click").length;
        const confirmClicks = calls.filter((call) => call === "eval:wechat-original-rights-confirm-click").length;
        const opened =
          (options.wechatOriginalRightsAlreadyOpen && confirmClicks === 0) ||
          directClicks > confirmClicks ||
          calls.includes("mouse-click:700:900") ||
          (
            Boolean(options.wechatOriginalRightsCloseAfterConfirmAttempts) &&
            (options.wechatOriginalRightsAlreadyOpen || directClicks > 0) &&
            confirmClicks < (options.wechatOriginalRightsCloseAfterConfirmAttempts ?? 0)
          );
        if (!opened) {
          return false;
        }
        if (options.wechatOriginalRightsCloseAfterConfirmAttempts) {
          return confirmClicks < options.wechatOriginalRightsCloseAfterConfirmAttempts;
        }
        return true;
      }
      if (String(fn).includes("wechat-original-rights-agreement-direct-selected")) {
        calls.push("eval:wechat-original-rights-agreement-direct-selected");
        const agreementAttempts = calls.filter((call) =>
          call === "eval:wechat-original-agreement-dialog-click" ||
          call.startsWith("eval:wechat-original-agreement-point-click") ||
          /^mouse-click:(652|660|644):612$/.test(call)
        ).length;
        return agreementAttempts >= (options.wechatOriginalRightsReadyAfterAgreementAttempts ?? 1);
      }
      if (String(fn).includes("wechat-original-rights-dialog-direct-action")) {
        calls.push("eval:wechat-original-rights-dialog-action");
        calls.push("eval:wechat-original-rights-dialog-points");
        const directClicks = calls.filter((call) => call === "eval:wechat-original-declaration-direct-click").length;
        const confirmClicks = calls.filter((call) => call === "eval:wechat-original-rights-confirm-click").length;
        const opened =
          (options.wechatOriginalRightsAlreadyOpen && confirmClicks === 0) ||
          directClicks > confirmClicks ||
          calls.includes("mouse-click:700:900") ||
          (
            Boolean(options.wechatOriginalRightsCloseAfterConfirmAttempts) &&
            (options.wechatOriginalRightsAlreadyOpen || directClicks > 0) &&
            confirmClicks < (options.wechatOriginalRightsCloseAfterConfirmAttempts ?? 0)
          );
        if (!opened) {
          return { found: false, reason: "rights dialog not found" };
        }

        const agreementAttempts = calls.filter((call) => call === "eval:wechat-original-agreement-dialog-click").length;
        const readyAfter = options.wechatOriginalRightsReadyAfterAgreementAttempts ?? 1;
        if (agreementAttempts < readyAfter) {
          calls.push("eval:wechat-original-agreement-dialog-click");
          return {
            found: true,
            action: "agreement",
            source: "wujie-shadow:0",
            point: { x: 652, y: 612 }
          };
        }

        calls.push("eval:wechat-original-rights-confirm-ready");
        calls.push("eval:wechat-original-rights-confirm-click");
        return {
          found: true,
          action: "confirm",
          source: "wujie-shadow:0",
          point: { x: 1100, y: 715 }
        };
      }
      if (String(fn).includes("elementFromPoint(pointX, pointY)")) {
        calls.push("eval:wechat-original-declaration-hit-after-click");
        return {
          tagName: "label",
          role: "",
          text: "声明原创",
          rect: { left: 650, top: 880, width: 100, height: 40, right: 750, bottom: 920 }
        };
      }
      if (String(fn).includes("wechat-original-declaration-wujie-selected")) {
        calls.push("eval:wechat-original-declaration-wujie-selected");
        if (options.wechatOriginalDeclarationStaysUnselected) {
          return false;
        }
        if (options.wechatOriginalNeedsSecondEntryClickAfterRights) {
          return calls.includes("eval:wechat-original-rights-confirm-click") &&
            calls.filter((call) => call === "eval:wechat-original-declaration-click").length >= 2;
        }
        return calls.includes("eval:wechat-original-rights-confirm-click");
      }
      if (String(fn).includes("wechat-original-declaration-selected")) {
        calls.push("eval:wechat-original-declaration-selected");
        if (options.wechatOriginalDeclarationStaysUnselected) {
          return false;
        }
        if (options.wechatOriginalNeedsSecondEntryClickAfterRights) {
          return calls.includes("eval:wechat-original-rights-confirm-click") &&
            calls.filter((call) => call === "eval:wechat-original-declaration-click").length >= 2;
        }
        return calls.includes("eval:wechat-original-rights-confirm-click");
      }
      if (String(fn).includes("wechat-original-rights-dialog-points")) {
        calls.push("eval:wechat-original-rights-dialog-points");
        if (
          !options.wechatOriginalRightsAlreadyOpen &&
          !calls.includes("eval:wechat-original-declaration-click") &&
          !calls.includes("mouse-click:700:900")
        ) {
          return undefined;
        }

        return {
          agreement: { x: 652, y: 612 },
          agreementFallbacks: [
            { x: 660, y: 612 },
            { x: 644, y: 612 },
            { x: 652, y: 612 }
          ],
          confirm: { x: 1100, y: 715 }
        };
      }
      if (String(fn).includes("wechat-original-agreement-point-click")) {
        const point = pointArg(arg);
        calls.push(`eval:wechat-original-agreement-point-click:${point?.x ?? ""}:${point?.y ?? ""}`);
        return true;
      }
      if (String(fn).includes("wechat-original-agreement-dialog-click")) {
        calls.push("eval:wechat-original-agreement-dialog-click");
        return true;
      }
      if (String(fn).includes("wechat-original-rights-confirm-click")) {
        calls.push("eval:wechat-original-rights-confirm-click");
        return true;
      }
      if (String(fn).includes("wechat-original-rights-confirm-ready")) {
        calls.push("eval:wechat-original-rights-confirm-ready");
        const agreementAttempts = calls.filter((call) =>
          call === "eval:wechat-original-agreement-dialog-click" ||
          call.startsWith("eval:wechat-original-agreement-point-click") ||
          /^mouse-click:(652|660|644):612$/.test(call)
        ).length;
        return agreementAttempts >= (options.wechatOriginalRightsReadyAfterAgreementAttempts ?? 1);
      }
      if (String(fn).includes("wechat-original-rights-dialog-visible")) {
        calls.push("eval:wechat-original-rights-dialog-visible");
        if (options.wechatOriginalRightsCloseAfterConfirmAttempts) {
          return calls.filter((call) => call === "eval:wechat-original-rights-confirm-click").length <
            options.wechatOriginalRightsCloseAfterConfirmAttempts;
        }
        return false;
      }
      if (String(fn).includes("wechat-cover-confirm-scroll")) {
        calls.push("eval:wechat-cover-confirm-scroll");
        return true;
      }
      if (String(fn).includes("wechat-cover-confirm-dom-click")) {
        calls.push("eval:wechat-cover-confirm-dom-click");
        if (String(fn).includes("\"确认\"")) {
          calls.push("eval:wechat-cover-confirm-dom-click-includes-confirm");
        }
        return { x: 920, y: 580 };
      }
      if (String(fn).includes("wechat-cover-edit-container-target")) {
        calls.push("eval:wechat-cover-edit-container-target");
        return String(fn).includes('const targetRatio = "4:3"') ? { x: 565, y: 226 } : { x: 230, y: 226 };
      }
      if (String(fn).includes("wechat-cover-container-dom-click")) {
        calls.push("eval:wechat-cover-container-dom-click");
        return false;
      }
      if (String(fn).includes("wechat-cover-preview-page-visible")) {
        calls.push("eval:wechat-cover-preview-page-visible");
        return true;
      }
      if (String(fn).includes("wechat-cover-edit-dom-click")) {
        calls.push("eval:wechat-cover-edit-dom-click");
        return true;
      }
      if (String(fn).includes("wechat-cover-use-material-point-click")) {
        const point = pointArg(arg);
        calls.push(`eval:wechat-cover-use-material-point-click:${point?.x ?? ""}:${point?.y ?? ""}`);
        return true;
      }
      if (String(fn).includes("wechat-cover-use-material-click")) {
        calls.push("eval:wechat-cover-use-material-click");
        return { x: 635, y: 406 };
      }
      if (String(fn).includes('trim() === "发表"')) {
        calls.push("eval:wechat-bottom-publish");
        return true;
      }
      if (String(fn).includes("PointerEvent")) {
        const targetText = targetTextArg(arg);
        if (targetText) {
          calls.push(`eval:category-option:${targetText}`);
          const box =
            targetText === "科技数码"
              ? { x: 600, y: 490, width: 70, height: 20, centerX: 635, centerY: 500 }
              : { x: 785, y: 530, width: 40, height: 20, centerX: 805, centerY: 540 };
          return { clicked: true, box };
        }
        calls.push("eval:category-dropdown-action");
        return true;
      }
      if (String(fn).includes("rect.right + 640")) {
        calls.push("eval:category-page-scroll-point");
        return { x: 1180, y: 520 };
      }
      calls.push("eval:category-dropdown-point");
      return { x: 670, y: 178 };
    },
    keyboard: {
      press: async (key: string) => {
        calls.push(`keyboard-press:${key}`);
      },
      type: async (value: string) => {
        calls.push(`keyboard-type:${value}`);
      },
      insertText: async (value: string) => {
        calls.push(`keyboard-insert:${value}`);
      }
    }
  } as never;
}

function isUploadPageMarker(label: string) {
  return (
    label.includes("role:heading:上传视频") ||
    label.includes("text:拖拽视频到此处也可上传") ||
    label.includes("role:button:/^上传视频$/")
  );
}

function isWeiboUploadFailureMarker(label: string) {
  return (
    label.includes("init 失败") ||
    label.includes("AxiosError") ||
    label.includes("请求参数不合法") ||
    label.includes("code:20380") ||
    label.includes("Request failed with status code 400") ||
    label.includes("暂停中") ||
    label.includes("0.00MB")
  );
}

function isWeiboTransientUploadMarker(label: string) {
  return label.includes("上传中") || label.includes("等待上传") || label.includes("排队中");
}

function isCategoryPlaceholder(label: string) {
  return label.includes("请选择合适的频道") || label.includes("请选择分类") || label.includes("请选择合适分类");
}

function isCategoryOption(label: string) {
  return label.includes("科技数码") || label.includes("科技") || label.includes("确定");
}

function isWechatDescriptionSelector(label: string) {
  return (
    label.includes('placeholder*="视频描述"') ||
    label.includes('placeholder*="描述"') ||
    label.includes('data-placeholder*="视频描述"') ||
    label.includes('placeholder*="简介"') ||
    label.includes('contenteditable="true"')
  );
}

function isWechatCoverEditorMarker(label: string) {
  return (
    label.includes("text:上传封面") ||
    label.includes("text:裁剪封面") ||
    label.includes("text:确认") ||
    label.includes("text:确定")
  );
}

function extractJsonStringAfter(source: string, marker: string) {
  const start = source.indexOf(marker);
  if (start < 0) {
    return "";
  }

  const afterMarker = source.slice(start + marker.length);
  const end = afterMarker.indexOf(";");
  if (end < 0) {
    return "";
  }

  return JSON.parse(afterMarker.slice(0, end));
}
