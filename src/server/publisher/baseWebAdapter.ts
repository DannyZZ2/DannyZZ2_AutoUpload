import fs from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "playwright";
import type { Platform, PublishTask } from "../../shared/types";
import { screenshotDir } from "../config";
import { getPlatformConfig } from "../platformConfig";
import { PublisherAutomationError, type AdapterStep, type PlatformPublisherAdapter, type PublishContext } from "./adapter";
import { openPlatformPage } from "./browser";
import { formatTags } from "./format";

type SelectorProfile = {
  videoInputs?: string[];
  cover34Inputs?: string[];
  cover43Inputs?: string[];
  titleInputs?: string[];
  descriptionInputs?: string[];
  tagInputs?: string[];
  submitImmediateTexts?: string[];
};

export abstract class BaseWebAdapter implements PlatformPublisherAdapter {
  abstract platform: Platform;
  protected profile: SelectorProfile = {};

  async publish(task: PublishTask, step: AdapterStep) {
    const page = await openPlatformPage(this.platform, getPlatformConfig(this.platform).publisherUrl);
    const context: PublishContext = { task, page, step };

    try {
      await this.openPublisher(context);
      await this.ensureLogin(context);
      await this.uploadVideo(context);
      await this.setTitleAndTags(context);
      await this.setContentDeclaration(context);
      await this.setCover(context);
      if (!task.autoPublish) {
        await step("已完成填写，等待手动发布");
        return {
          status: "ready_for_manual_publish"
        } as const;
      }
      await this.submitPublish(context);
      return {
        status: "published_immediately"
      } as const;
    } catch (error) {
      const screenshotPath = await this.captureFailure(context, error);
      const message = error instanceof Error ? error.message : String(error);
      throw new PublisherAutomationError(message, screenshotPath);
    }
  }

  async openPublisher({ page, step }: PublishContext) {
    await step("打开发布页");
    await page.goto(getPlatformConfig(this.platform).publisherUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000
    });
  }

  async ensureLogin({ page, step }: PublishContext) {
    await step("检查登录状态");
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
    const loginVisible = await this.isAnyTextVisible(page, ["登录", "扫码登录", "微信扫码", "验证码"], 2_000);
    if (loginVisible) {
      await step("等待用户完成登录");
      await page.waitForTimeout(2_000);
      await this.waitForAnyFileInput(page, 10 * 60_000);
    }
  }

  async uploadVideo({ task, page, step }: PublishContext) {
    await step("上传视频");
    const candidates = this.profile.videoInputs ?? [
      'input[type="file"][accept*="video"]',
      'input[type="file"]'
    ];
    await this.setInputFiles(page, candidates, task.videoPath, "未找到视频上传控件");
    await page.waitForTimeout(1_000);
  }

  async setCover({ task, page, step }: PublishContext) {
    await step("设置封面");
    const candidates = this.profile.cover43Inputs ?? this.profile.cover34Inputs ?? [
      'input[type="file"][accept*="image"]',
      'input[type="file"]'
    ];
    await this.tryClickByText(page, ["设置封面", "编辑封面"]);
    const uploadedByChooser = await this.tryUploadFileViaChooser(page, coverUploadTexts, task.cover43Path);
    if (uploadedByChooser) {
      return;
    }

    await this.setInputFiles(page, candidates, task.cover43Path, "未找到封面上传控件");
  }

  async setTitleAndTags({ task, page, step }: PublishContext) {
    await step("填写标题和标签");
    await this.fillFirst(page, this.profile.titleInputs ?? titleInputCandidates, task.title, "未找到标题输入框");

    const tagText = formatTags(task.tags);
    if (!tagText) {
      return;
    }

    const filledDescription = await this.tryFillFirst(
      page,
      this.profile.descriptionInputs ?? descriptionInputCandidates,
      `${task.title}\n${tagText}`
    );

    if (!filledDescription) {
      await this.tryFillTags(page, task.tags);
    }
  }

  async setContentDeclaration({ page, step }: PublishContext) {
    await step("设置内容声明：内容无需标注");
    const selected = await this.selectNoContentDeclaration(page);
    if (!selected) {
      await step("未找到内容声明控件，继续发布");
    }
  }

  async submitPublish({ page, step }: PublishContext) {
    await step("提交立即发布");
    const clicked = await this.tryClickByText(
      page,
      this.profile.submitImmediateTexts ?? ["发布", "立即发布"]
    );

    if (!clicked) {
      throw new Error("未找到发布按钮");
    }

    await this.waitForPublishSubmitted(page);
  }

  async captureFailure({ task, page }: PublishContext, error: unknown) {
    await fs.mkdir(screenshotDir, { recursive: true });
    const target = path.join(screenshotDir, `${task.id}-${this.platform}-${Date.now()}.png`);
    try {
      await page.screenshot({ path: target, fullPage: true });
      return target;
    } catch {
      return undefined;
    }
  }

  protected async setInputFiles(page: Page, selectors: string[], filePath: string, errorMessage: string) {
    for (const selector of selectors) {
      const input = page.locator(selector).first();
      if (await this.safeSetInputFiles(input, filePath)) {
        return true;
      }
    }
    throw new Error(errorMessage);
  }

  protected async trySetInputFiles(page: Page, selectors: string[], filePath: string) {
    for (const selector of selectors) {
      const input = page.locator(selector).first();
      if (await this.safeSetInputFiles(input, filePath)) {
        return true;
      }
    }
    return false;
  }

  protected async fillFirst(page: Page, selectors: string[], value: string, errorMessage: string) {
    if (await this.tryFillFirst(page, selectors, value)) {
      return true;
    }
    throw new Error(errorMessage);
  }

  protected async tryFillFirst(page: Page, selectors: string[], value: string) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await this.safeFill(locator, value)) {
        return true;
      }
    }
    return false;
  }

  protected async tryClickByText(page: Page, texts: string[]) {
    for (const text of texts) {
      const button = page.getByText(text, { exact: false }).first();
      try {
        await button.click({ timeout: 3_000 });
        return true;
      } catch {
        // Try the next label.
      }
    }
    return false;
  }

  protected async selectNoContentDeclaration(page: Page) {
    const optionTexts = ["内容无需标注", "无需标注", "无须标注", "不需要标注", "无需声明", "不标注"];
    if (!(await this.openContentDeclarationDropdown(page, optionTexts))) {
      return false;
    }

    return this.tryClickByExactText(page, optionTexts, 3_000);
  }

  protected async openContentDeclarationDropdown(page: Page, optionTexts: string[]) {
    const openers = [
      page.getByText("请进行内容声明", { exact: false }).first(),
      page.locator('xpath=//*[contains(normalize-space(),"请进行内容声明")]').first(),
      page.locator('xpath=//*[contains(normalize-space(),"内容声明")]/following::*[@role="combobox" or self::input or self::button][1]').first(),
      page.locator('xpath=//*[contains(normalize-space(),"内容声明")]/following::*[contains(normalize-space(),"请选择") or contains(normalize-space(),"请进行")][1]').first(),
      page.locator('[role="combobox"]:has-text("内容声明")').first(),
      page.locator('[role="combobox"]:has-text("请选择")').first(),
      page.locator('[class*="select"]:has-text("内容声明")').first(),
      page.locator('[class*="Select"]:has-text("内容声明")').first(),
      page.locator('input[placeholder*="内容声明"]').first(),
      page.locator('input[placeholder*="请选择"]').first()
    ];

    for (const opener of openers) {
      try {
        await opener.click({ timeout: 2_000 });
        if (await this.waitForAnyExactText(page, optionTexts, 2_000)) {
          return true;
        }
      } catch {
        // Try a coordinate-based declaration opener next.
      }
    }

    for (const label of ["内容声明", "内容标注", "作品声明"]) {
      const labelBox = await page.getByText(label, { exact: false }).first().boundingBox({ timeout: 1_000 }).catch(() => null);
      if (!labelBox) {
        continue;
      }

      try {
        await page.mouse.click(labelBox.x + labelBox.width + 220, labelBox.y + labelBox.height / 2);
        if (await this.waitForAnyExactText(page, optionTexts, 2_000)) {
          return true;
        }
      } catch {
        // Try the next label position.
      }
    }

    return false;
  }

  protected async waitForAnyExactText(page: Page, texts: string[], timeout: number) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      for (const text of texts) {
        try {
          await page.getByText(text, { exact: true }).first().waitFor({ state: "visible", timeout: 200 });
          return true;
        } catch {
          // Try the next text.
        }
      }
      await page.waitForTimeout(100);
    }

    return false;
  }

  protected async tryClickByExactText(page: Page, texts: string[], timeout: number) {
    for (const text of texts) {
      const candidates = [
        page.getByRole("option", { name: new RegExp(`^${escapeRegExp(text)}$`) }).first(),
        page.getByRole("menuitem", { name: new RegExp(`^${escapeRegExp(text)}$`) }).first(),
        page.getByRole("button", { name: new RegExp(`^${escapeRegExp(text)}$`) }).first(),
        page.getByText(text, { exact: true }).first()
      ];

      for (const candidate of candidates) {
        try {
          await candidate.waitFor({ state: "visible", timeout });
          await candidate.click({ timeout });
          return true;
        } catch {
          // Try the next exact text candidate.
        }
      }
    }

    return false;
  }

  protected async tryUploadFileViaChooser(page: Page, texts: string[], filePath: string) {
    for (const text of texts) {
      const candidates = [
        page.getByRole("button", { name: new RegExp(text) }).first(),
        page.locator(`button:has-text("${text}")`).first(),
        page.locator(`[role="button"]:has-text("${text}")`).first(),
        page.getByText(text, { exact: false }).first()
      ];

      for (const candidate of candidates) {
        const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 3_000 }).catch(() => undefined);
        try {
          await candidate.click({ timeout: 3_000 });
        } catch {
          await fileChooserPromise;
          continue;
        }

        const fileChooser = await fileChooserPromise;
        if (fileChooser) {
          await fileChooser.setFiles(filePath);
          return true;
        }
      }
    }

    return false;
  }

  protected async tryFillTags(page: Page, tags: string[]) {
    const selectors = this.profile.tagInputs ?? [
      'input[placeholder*="标签"]',
      'textarea[placeholder*="标签"]',
      '[contenteditable="true"]'
    ];
    const tagText = formatTags(tags);
    return this.tryFillFirst(page, selectors, tagText);
  }

  protected async isAnyTextVisible(page: Page, texts: string[], timeout: number) {
    for (const text of texts) {
      try {
        await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
        return true;
      } catch {
        // Continue probing.
      }
    }
    return false;
  }

  protected async waitForPublishSubmitted(page: Page, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    let lastText = "";

    while (Date.now() < deadline) {
      const state = await page.evaluate<{
        success: boolean;
        failed: boolean;
        failureText?: string;
        text: string;
      }>(() => {
        const marker = "publish-submit-state";
        void marker;
        const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
        const successTexts = [
          "发布成功",
          "发表成功",
          "投稿成功",
          "提交成功",
          "发布完成",
          "已提交审核",
          "提交审核成功",
          "审核中",
          "作品已发布"
        ];
        const failurePatterns = [
          /发布失败/,
          /发表失败/,
          /投稿失败/,
          /提交失败/,
          /上传失败/,
          /处理失败/,
          /参数错误/,
          /参数不合法/,
          /请求失败/,
          /标题.{0,12}不能为空/,
          /描述.{0,12}不能为空/,
          /内容.{0,12}不能为空/,
          /请选择.{0,12}内容声明/,
          /请选择.{0,12}分类/,
          /请完成.{0,12}必填/,
          /未完成.{0,12}必填/
        ];
        const failureText = failurePatterns.find((pattern) => pattern.test(text))?.source;
        return {
          success: successTexts.some((item) => text.includes(item)),
          failed: Boolean(failureText),
          failureText,
          text: text.slice(0, 500)
        };
      }).catch(() => ({
        success: false,
        failed: false,
        failureText: undefined,
        text: ""
      }));

      if (state.success) {
        return true;
      }
      if (state.failed) {
        throw new Error(`平台提交发布失败：${state.failureText ?? "页面提示失败"}`);
      }

      lastText = state.text;
      await page.waitForTimeout(1_000);
    }

    throw new Error(`已点击发布，但未确认平台发布成功${lastText ? `。页面文本：${lastText.slice(0, 120)}` : ""}`);
  }

  private async waitForAnyFileInput(page: Page, timeout: number) {
    await page.locator('input[type="file"]').first().waitFor({ state: "attached", timeout });
  }

  private async safeSetInputFiles(locator: Locator, filePath: string) {
    try {
      await locator.waitFor({ state: "attached", timeout: 4_000 });
      await locator.setInputFiles(filePath, { timeout: 15_000 });
      return true;
    } catch {
      return false;
    }
  }

  private async safeFill(locator: Locator, value: string) {
    try {
      await locator.waitFor({ state: "visible", timeout: 3_000 });
      await locator.fill(value, { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }
}

const titleInputCandidates = [
  'input[placeholder*="标题"]',
  'textarea[placeholder*="标题"]',
  '[contenteditable="true"][data-placeholder*="标题"]',
  '[contenteditable="true"]'
];

const descriptionInputCandidates = [
  'textarea[placeholder*="正文"]',
  'textarea[placeholder*="描述"]',
  'textarea[placeholder*="简介"]',
  'textarea[placeholder*="说点什么"]',
  '[contenteditable="true"]'
];

const coverUploadTexts = [
  "上传封面",
  "上传图片",
  "本地上传",
  "上传本地图片",
  "从本地上传",
  "选择图片",
  "选择封面"
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
