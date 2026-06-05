import { BaseWebAdapter } from "../baseWebAdapter";
import { PublisherAutomationError, type AdapterStep, type PublishContext } from "../adapter";
import { openPlatformPage } from "../browser";
import { getPlatformConfig } from "../../platformConfig";
import type { PublishTask } from "../../../shared/types";
import type { Locator, Page } from "playwright";

type TextBox = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

export class WeiboAdapter extends BaseWebAdapter {
  platform = "weibo" as const;

  protected profile = {
    videoInputs: [
      'input[type="file"][accept*="video"]',
      'input[type="file"]'
    ],
    cover43Inputs: [
      'input[type="file"][accept*="image"]',
      'input[type="file"] >> nth=1'
    ],
    titleInputs: [
      'textarea[placeholder*="分享新鲜事"]',
      'textarea[placeholder*="说点什么"]',
      '[contenteditable="true"]'
    ],
    descriptionInputs: [
      'textarea[placeholder*="分享新鲜事"]',
      'textarea[placeholder*="说点什么"]',
      '[contenteditable="true"]'
    ],
    submitImmediateTexts: ["发布"]
  };

  async publish(task: PublishTask, step: AdapterStep) {
    const page = await openPlatformPage(this.platform, getPlatformConfig(this.platform).publisherUrl);
    const context: PublishContext = { task, page, step };

    try {
      await this.openPublisher(context);
      await this.ensureLogin(context);
      await this.uploadVideo(context);
      await this.setWeiboPostDetails(context);
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

  async ensureLogin({ page, step }: PublishContext) {
    await step("检查微博登录状态");
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
    const loginVisible = await this.isAnyTextVisible(page, ["登录", "扫码登录", "验证码"], 2_000);
    if (loginVisible) {
      await step("等待用户完成微博登录");
      await page.waitForTimeout(2_000);
      await page.getByText("视频", { exact: true }).first().waitFor({
        state: "visible",
        timeout: 10 * 60_000
      });
    }
  }

  async uploadVideo(context: PublishContext) {
    const { task, step } = context;
    let { page } = context;
    await step("进入微博视频发布页");
    const uploadPage = await this.tryClickWeiboVideoEntry(page);
    if (!uploadPage) {
      throw new Error("未找到微博发布器中的“视频”入口");
    }

    context.page = uploadPage;
    page = uploadPage;

    await page.waitForTimeout(1_000);
    await step("点击微博上传视频按钮");
    const uploadedByButton = await this.tryUploadViaUploadButton(page, task.videoPath);
    if (!uploadedByButton) {
      await step("通过微博视频上传控件上传");
      await this.setInputFiles(page, this.profile.videoInputs, task.videoPath, "未找到微博视频上传控件");
    }

    await step("等待微博发布表单可填写");
    await this.waitForWeiboVideoFormReady(page);
  }

  async setCover({ task, page, step }: PublishContext) {
    const coverPath = task.cover169Path;
    if (!coverPath) {
      throw new Error("微博发布必须提供 16:9 封面");
    }

    await step("设置微博 16:9 封面");
    await this.tryClickByText(page, ["编辑封面", "设置封面", "更换封面"]);

    const uploadedByChooser = await this.tryUploadFileViaChooser(
      page,
      ["本地上传", "上传封面", "上传图片", "上传本地图片", "从本地上传", "选择图片"],
      coverPath
    );
    const uploadedByInput =
      uploadedByChooser || (await this.trySetInputFiles(page, this.profile.cover43Inputs, coverPath));
    if (!uploadedByInput) {
      throw new Error("未找到微博 16:9 封面上传控件");
    }

    await step("完成微博封面裁剪");
    const completed = await this.clickWeiboCoverEditorDone(page);
    if (!completed) {
      throw new Error("微博封面上传后未找到“完成”按钮");
    }

    await page.waitForTimeout(800);
  }

  async setContentDeclaration({ page, step }: PublishContext) {
    await step("设置微博内容声明：内容无需标注");
    const declarationSet = await this.selectNoContentDeclaration(page);
    if (!declarationSet) {
      throw new Error("未能选择微博内容声明：内容无需标注");
    }
    await step("确认微博内容声明");
    const confirmed = await this.confirmWeiboContentDeclaration(page);
    if (!confirmed) {
      throw new Error("微博内容声明选择后未找到“确定”按钮");
    }
    await this.verifyWeiboContentDeclarationSelected(page);
  }

  async setTitleAndTags(context: PublishContext) {
    await this.setWeiboTitle(context);
    await this.setWeiboContent(context);
  }

  async setWeiboPostDetails(context: PublishContext) {
    await this.setWeiboOriginalType(context);
    await this.setContentDeclaration(context);
    await this.setWeiboTitle(context);
    await this.scrollWeiboPageToCategory(context);
    await this.setWeiboCategory(context);
    await this.setWeiboContent(context);
    await context.step("等待微博视频上传完成");
    await this.waitForWeiboVideoUploadReady(context.page);
    await this.setCover(context);
  }

  async setWeiboCategory({ page, step }: PublishContext) {
    await step("选择微博分类 科技数码-科技");
    await this.selectWeiboTechCategory(page);
  }

  private async setWeiboOriginalType({ page, step }: PublishContext) {
    await step("选择微博原创类型");
    await this.selectWeiboOriginal(page);
    await this.verifyWeiboOriginalSelected(page);
  }

  private async setWeiboTitle({ task, page, step }: PublishContext) {
    await step("填写微博标题");
    await this.fillFirst(
      page,
      [
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        'input[maxlength="30"]',
        'input[type="text"]'
      ],
      task.title,
      "未找到微博标题输入框"
    );
  }

  private async scrollWeiboPageToCategory({ page, step }: PublishContext) {
    await step("滚动到微博分类区域");

    const blankPoint = await page.evaluate(() => {
      const label = Array.from(document.querySelectorAll<HTMLElement>("body *")).find((element) => {
        const rect = element.getBoundingClientRect();
        return element.textContent?.trim() === "标题" && rect.width > 0 && rect.height > 0;
      });

      if (!label) {
        return {
          x: Math.min(window.innerWidth - 48, 1180),
          y: Math.min(window.innerHeight - 48, 520)
        };
      }

      const rect = label.getBoundingClientRect();
      return {
        x: Math.min(window.innerWidth - 48, rect.right + 640),
        y: Math.min(window.innerHeight - 48, rect.bottom + 80)
      };
    }).catch(() => ({ x: 1180, y: 520 }));

    await page.mouse.move(blankPoint.x, blankPoint.y);
    await page.mouse.wheel(0, 620);
    await page.waitForTimeout(500);
  }

  private async setWeiboContent({ task, page, step }: PublishContext) {
    await step("设置微博内容");
    const tagText = formatWeiboTags(task.tags);
    if (!tagText) {
      return;
    }

    await this.fillFirst(
      page,
      [
        'textarea[placeholder*="微博"]',
        'textarea[placeholder*="内容"]',
        'textarea[placeholder*="分享"]',
        'textarea[placeholder*="说点什么"]',
        '[contenteditable="true"]'
      ],
      tagText,
      "未找到微博内容输入框"
    );
  }

  private async tryClickWeiboVideoEntry(page: PublishContext["page"]) {
    const uploadPageFromToolbar = await this.tryClickWeiboVideoEntryByToolbarLayout(page);
    if (uploadPageFromToolbar) {
      return uploadPageFromToolbar;
    }

    const candidates = [
      page
        .locator('div:has-text("有什么新鲜事想分享给大家?")')
        .locator('button:has-text("视频")')
        .first(),
      page
        .locator('div:has-text("有什么新鲜事想分享给大家?")')
        .locator('[role="button"]:has-text("视频")')
        .first(),
      page
        .locator('div:has-text("有什么新鲜事想分享给大家?")')
        .getByText("视频", { exact: true })
        .first(),
      page.getByRole("button", { name: /视频/ }).first(),
      page.locator('button:has-text("视频")').first(),
      page.locator('[role="button"]:has-text("视频")').first(),
      page.getByText("视频", { exact: true }).first()
    ];

    for (const candidate of candidates) {
      try {
        const uploadPage = await this.clickAndResolveWeiboUploadPage(page, () => candidate.click({ timeout: 3_000 }));
        if (uploadPage) {
          return uploadPage;
        }
      } catch {
        // Try the next visible Weibo video entry candidate.
      }
    }

    return undefined;
  }

  private async tryClickWeiboVideoEntryByToolbarLayout(page: Page) {
    const toolbar = await this.findWeiboVideoToolbarTarget(page);
    if (!toolbar) {
      return undefined;
    }

    const uploadPageFromLabel = await this.clickAndResolveWeiboUploadPage(page, () =>
      page.mouse.click(toolbar.centerX, toolbar.centerY)
    );
    if (uploadPageFromLabel) {
      return uploadPageFromLabel;
    }

    const iconY = Math.max(0, toolbar.y - Math.min(36, toolbar.height * 2));
    return this.clickAndResolveWeiboUploadPage(page, () => page.mouse.click(toolbar.centerX, iconY));
  }

  private async clickAndResolveWeiboUploadPage(page: Page, click: () => Promise<void>) {
    const popupPromise = page.waitForEvent("popup", { timeout: 5_000 }).catch(() => undefined);

    await click();

    return this.firstResolvedUploadPage([
      this.resolveWeiboUploadPage(page),
      popupPromise.then((popup) => (popup ? this.resolveWeiboUploadPage(popup) : undefined))
    ]);
  }

  private async resolveWeiboUploadPage(page: Page) {
    await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
    return (await this.waitForWeiboUploadPage(page)) ? page : undefined;
  }

  private async firstResolvedUploadPage(promises: Array<Promise<Page | undefined>>) {
    return new Promise<Page | undefined>((resolve) => {
      let pending = promises.length;
      let done = false;

      const settle = (page?: Page) => {
        if (done) {
          return;
        }

        if (page) {
          done = true;
          resolve(page);
          return;
        }

        pending -= 1;
        if (pending === 0) {
          done = true;
          resolve(undefined);
        }
      };

      for (const promise of promises) {
        promise.then(settle).catch(() => settle(undefined));
      }
    });
  }

  private async findWeiboVideoToolbarTarget(page: Page) {
    const boxes = {
      expression: await this.collectVisibleTextBoxes(page, "表情"),
      image: await this.collectVisibleTextBoxes(page, "图片"),
      video: await this.collectVisibleTextBoxes(page, "视频"),
      topic: await this.collectVisibleTextBoxes(page, "话题"),
      article: await this.collectVisibleTextBoxes(page, "头条文章"),
      more: await this.collectVisibleTextBoxes(page, "更多")
    };

    const candidates: Array<{ box: TextBox; score: number }> = [];

    for (const video of boxes.video) {
      for (const image of boxes.image) {
        for (const topic of boxes.topic) {
          const sameRow = this.isSameToolbarRow(video, image) && this.isSameToolbarRow(video, topic);
          const ordered = image.centerX < video.centerX && video.centerX < topic.centerX;
          if (!sameRow || !ordered) {
            continue;
          }

          const expression = boxes.expression.find((box) => box.centerX < image.centerX && this.isSameToolbarRow(box, video));
          const article = boxes.article.find((box) => topic.centerX < box.centerX && this.isSameToolbarRow(box, video));
          const more = boxes.more.find((box) => topic.centerX < box.centerX && this.isSameToolbarRow(box, video));

          let score = 100;
          score -= Math.abs(video.centerY - image.centerY);
          score -= Math.abs(video.centerY - topic.centerY);
          if (expression) score += 25;
          if (article) score += 25;
          if (more) score += 25;

          candidates.push({ box: video, score });
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.box;
  }

  private async collectVisibleTextBoxes(page: Page, text: string): Promise<TextBox[]> {
    const locators = await page.getByText(text, { exact: true }).all();
    const boxes: TextBox[] = [];

    for (const locator of locators) {
      try {
        const box = await locator.boundingBox({ timeout: 1_000 });
        if (!box || box.width <= 0 || box.height <= 0) {
          continue;
        }

        boxes.push({
          text,
          ...box,
          centerX: box.x + box.width / 2,
          centerY: box.y + box.height / 2
        });
      } catch {
        // Ignore hidden or detached text nodes.
      }
    }

    return boxes;
  }

  private isSameToolbarRow(a: TextBox, b: TextBox) {
    return Math.abs(a.centerY - b.centerY) <= 48;
  }

  private async waitForWeiboUploadPage(page: PublishContext["page"]) {
    const markers = [
      page.getByRole("heading", { name: "上传视频" }).first(),
      page.getByText("拖拽视频到此处也可上传", { exact: false }).first(),
      page.getByRole("button", { name: /^上传视频$/ }).first()
    ];

    for (const marker of markers) {
      try {
        await marker.waitFor({ state: "visible", timeout: 5_000 });
        return true;
      } catch {
        // Keep checking the upload page markers.
      }
    }

    return false;
  }

  private async tryUploadViaUploadButton(page: PublishContext["page"], videoPath: string) {
    const candidates = [
      page.getByRole("button", { name: /^上传视频$/ }).first(),
      page.locator('button:has-text("上传视频")').first(),
      page.locator('[role="button"]:has-text("上传视频")').first(),
      page.getByText("上传视频", { exact: true }).first()
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
        await fileChooser.setFiles(videoPath);
        return true;
      }

      return false;
    }

    return false;
  }

  private async waitForWeiboVideoFormReady(page: Page) {
    const deadline = Date.now() + 90_000;

    while (Date.now() < deadline) {
      await this.throwIfWeiboVideoUploadFailed(page);

      const formReady =
        (await this.isAnyTextVisible(page, ["类型"], 500)) &&
        (await this.isAnyTextVisible(page, ["内容声明"], 500)) &&
        (await this.isAnyTextVisible(page, ["标题"], 500));
      if (formReady) {
        return;
      }

      await page.waitForTimeout(1_000);
    }

    throw new Error("微博视频选择后未进入可填写表单");
  }

  private async waitForWeiboVideoUploadReady(page: Page) {
    const deadline = Date.now() + 120_000;

    while (Date.now() < deadline) {
      await this.throwIfWeiboVideoUploadFailed(page);

      if (await this.isAnyTextVisible(page, ["上传完成", "上传成功", "处理完成"], 500)) {
        return;
      }

      const formReady =
        (await this.isAnyTextVisible(page, ["类型"], 500)) &&
        (await this.isAnyTextVisible(page, ["内容声明"], 500)) &&
        (await this.isAnyTextVisible(page, ["标题"], 500));
      if (formReady && !(await this.isAnyTextVisible(page, ["上传中", "等待上传", "排队中"], 300))) {
        await this.throwIfWeiboVideoUploadFailed(page);
        return;
      }

      await page.waitForTimeout(1_000);
    }

    throw new Error("微博视频上传未完成：等待上传状态超时");
  }

  private async throwIfWeiboVideoUploadFailed(page: Page) {
    const explicitFailure = await this.isAnyTextVisible(
      page,
      ["init 失败", "AxiosError", "请求参数不合法", "code:20380", "Request failed with status code 400"],
      300
    );
    if (explicitFailure) {
      throw new Error(
        "微博视频上传失败：页面提示 init 失败/请求参数不合法(code:20380)，请检查视频文件参数或重新选择视频后重试"
      );
    }

    const paused = await this.isAnyTextVisible(page, ["暂停中"], 300);
    const zeroProgress = await this.isAnyTextVisible(page, ["0.00MB/ 0.00MB", "0.00MB / 0.00MB", "0.00MB/0.00MB"], 300);
    if (paused || zeroProgress) {
      throw new Error(
        "微博视频上传失败：上传进度处于暂停或 0.00MB 状态，请检查视频文件是否符合微博要求后重试"
      );
    }
  }

  private async clickWeiboCoverEditorDone(page: Page) {
    const candidates = [
      page.getByRole("button", { name: /^完成$/ }).first(),
      page.locator('button:has-text("完成")').first(),
      page.locator('[role="button"]:has-text("完成")').first(),
      page.getByText("完成", { exact: true }).first(),
      page.getByRole("button", { name: /^确定$/ }).first(),
      page.locator('button:has-text("确定")').first(),
      page.getByRole("button", { name: /^保存$/ }).first(),
      page.locator('button:has-text("保存")').first()
    ];

    for (const candidate of candidates) {
      try {
        await candidate.waitFor({ state: "visible", timeout: 30_000 });
        await candidate.click({ timeout: 5_000 });
        return true;
      } catch {
        // Try the next completion control in the same cover editor page.
      }
    }

    return false;
  }

  private async selectWeiboOriginal(page: Page) {
    if (await this.tryClickByText(page, ["原创"])) {
      return;
    }

    await this.tryClickByText(page, ["类型", "作品类型", "声明"]);
    if (await this.tryClickByText(page, ["原创"])) {
      return;
    }

    throw new Error("未找到微博“原创”类型选项");
  }

  private async verifyWeiboOriginalSelected(page: Page) {
    const verified =
      (await this.isAnyTextVisible(page, ["原创"], 2_000)) ||
      (await this.isLocatorVisible(page.locator('label:has-text("原创") input:checked').first(), 1_000)) ||
      (await this.isLocatorVisible(page.locator('[aria-checked="true"]:has-text("原创")').first(), 1_000));
    if (!verified) {
      throw new Error("微博原创类型选择后未确认成功");
    }
  }

  private async verifyWeiboContentDeclarationSelected(page: Page) {
    const selectedVisible = await this.waitForAnyExactText(page, ["内容无需标注", "无需标注", "无须标注"], 3_000);
    if (!selectedVisible) {
      throw new Error("微博内容声明选择后未确认成功：未显示“内容无需标注”");
    }
  }

  private async confirmWeiboContentDeclaration(page: Page) {
    const candidates = [
      page.getByRole("button", { name: /^确定$/ }).first(),
      page.locator('button:has-text("确定")').first(),
      page.locator('[role="button"]:has-text("确定")').first(),
      page.getByText("确定", { exact: true }).first()
    ];

    for (const candidate of candidates) {
      try {
        await candidate.waitFor({ state: "visible", timeout: 3_000 });
        await candidate.click({ timeout: 3_000 });
        await page.waitForTimeout(300);
        return true;
      } catch {
        // Try the next declaration confirm control.
      }
    }

    return false;
  }

  private async isLocatorVisible(locator: Locator, timeout: number) {
    try {
      await locator.waitFor({ state: "visible", timeout });
      return true;
    } catch {
      return false;
    }
  }

  private async selectWeiboTechCategory(page: Page) {
    if (await this.selectWeiboCategoryFromCascader(page)) {
      return;
    }

    const placeholderVisible = await this.isCategoryPlaceholderStillVisible(page);
    const techDigitalVisible = await this.isAnyTextVisible(page, ["科技数码"], 500);
    const techVisible = await this.isAnyTextVisible(page, ["科技"], 500);
    throw new Error(
      `未能选择微博分类：科技数码-科技（placeholder=${placeholderVisible ? "visible" : "hidden"}, 科技数码=${techDigitalVisible ? "visible" : "hidden"}, 科技=${techVisible ? "visible" : "hidden"}）`
    );
  }

  private async selectWeiboCategoryFromCascader(page: Page) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const opened = await this.openWeiboCategoryDropdown(page);
        if (!opened) {
          continue;
        }

        await page.waitForTimeout(300);

        const firstLevel = await this.clickCategoryOptionByDom(page, "科技数码");
        if (!firstLevel.clicked) {
          continue;
        }

        await page.waitForTimeout(300);
        const secondLevel = await this.clickCategoryOptionByDom(page, "科技", {
          minCenterX: firstLevel.box ? firstLevel.box.centerX + 20 : undefined
        });
        if (!secondLevel.clicked) {
          continue;
        }

        await this.clickVisibleCategoryConfirm(page);
        if (await this.verifyWeiboTechCategorySelected(page)) {
          return true;
        }
      } catch {
        // Try the next cascader opener.
      }
    }

    return false;
  }

  private async openWeiboCategoryDropdown(page: Page) {
    return (
      (await this.clickVisibleCategoryArrow(page)) ||
      (await this.activateCategoryDropdownByDom(page)) ||
      (await this.clickCategoryDropdownByDomPoint(page)) ||
      (await this.clickCategoryDropdownByLabelField(page)) ||
      (await this.clickCategoryDropdownByPlaceholder(page))
    );
  }

  private async clickVisibleCategoryArrow(page: Page) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const point = await this.getVisibleCategoryArrowPoint(page);
      if (point) {
        await page.mouse.move(point.x, point.y);
        await page.mouse.click(point.x, point.y);
        await page.waitForTimeout(350);
        if (await this.waitForCategoryDropdownOptions(page)) {
          return true;
        }
      }

      await page.mouse.move(1180, 520).catch(() => undefined);
      await page.mouse.wheel(0, 260);
      await page.waitForTimeout(300);
    }

    return false;
  }

  private async getVisibleCategoryArrowPoint(page: Page) {
    const labelBoxes = await this.collectVisibleTextBoxes(page, "分类");
    const placeholderBoxes = [
      ...(await this.collectVisibleTextBoxes(page, "请选择合适的频道")),
      ...(await this.collectVisibleTextBoxes(page, "请选择分类")),
      ...(await this.collectVisibleTextBoxes(page, "请选择合适分类"))
    ];

    const label = labelBoxes
      .filter((box) => box.width > 0 && box.height > 0)
      .sort((a, b) => b.y - a.y)[0];
    if (!label) {
      return undefined;
    }

    const placeholder = placeholderBoxes
      .filter((box) => box.width > 0 && box.height > 0)
      .filter((box) => box.centerX > label.centerX && box.centerY > label.centerY)
      .sort((a, b) => Math.abs(a.centerY - (label.y + label.height + 28)) - Math.abs(b.centerY - (label.y + label.height + 28)))[0];

    if (placeholder) {
      return {
        x: placeholder.x + Math.max(placeholder.width - 18, placeholder.width / 2),
        y: placeholder.centerY
      };
    }

    return {
      x: label.x + 620,
      y: label.y + label.height + 28
    };
  }

  private async activateCategoryDropdownByDom(page: Page) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const activated = await page.evaluate(() => {
        const isVisible = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.top < window.innerHeight &&
            style.visibility !== "hidden" &&
            style.display !== "none"
          );
        };

        const placeholders = ["请选择合适的频道", "请选择分类", "请选择合适分类"];
        const candidates = Array.from(document.querySelectorAll<HTMLElement>("body *"))
          .filter((element) => {
            const text = element.textContent?.trim() ?? "";
            return placeholders.some((target) => text.includes(target));
          })
          .filter(isVisible)
          .sort((a, b) => {
            const aRect = a.getBoundingClientRect();
            const bRect = b.getBoundingClientRect();
            return aRect.width * aRect.height - bRect.width * bRect.height;
          });

        for (const candidate of candidates) {
          let current: HTMLElement | null = candidate;
          for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
            const rect = current.getBoundingClientRect();
            if (!isVisible(current) || rect.width < 300 || rect.height < 32) {
              continue;
            }

            current.scrollIntoView({ block: "center", inline: "nearest" });
            const refreshed = current.getBoundingClientRect();
            const x = refreshed.right - 24;
            const y = refreshed.top + refreshed.height / 2;
            const eventInit = {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
              view: window
            };
            current.dispatchEvent(new PointerEvent("pointerdown", eventInit));
            current.dispatchEvent(new MouseEvent("mousedown", eventInit));
            current.dispatchEvent(new PointerEvent("pointerup", eventInit));
            current.dispatchEvent(new MouseEvent("mouseup", eventInit));
            current.dispatchEvent(new MouseEvent("click", eventInit));
            return true;
          }
        }

        return false;
      });

      if (activated && (await this.waitForCategoryDropdownOptions(page))) {
        return true;
      }

      await this.moveMouseInsideCategoryDropdown(page);
      await page.mouse.wheel(0, 280);
      await page.waitForTimeout(300);
    }

    return false;
  }

  private async clickCategoryDropdownByDomPoint(page: Page) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const point = await page.evaluate(() => {
        const isVisible = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.top < window.innerHeight &&
            style.visibility !== "hidden" &&
            style.display !== "none"
          );
        };

        const candidates = Array.from(document.querySelectorAll<HTMLElement>("body *"))
          .filter((element) => {
            const text = element.textContent?.trim() ?? "";
            return ["请选择合适的频道", "请选择分类", "请选择合适分类"].some((target) => text.includes(target));
          })
          .filter(isVisible)
          .sort((a, b) => {
            const aRect = a.getBoundingClientRect();
            const bRect = b.getBoundingClientRect();
            return aRect.width * aRect.height - bRect.width * bRect.height;
          });

        for (const candidate of candidates) {
          let current: HTMLElement | null = candidate;
          for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
            const rect = current.getBoundingClientRect();
            if (!isVisible(current) || rect.width < 300 || rect.height < 32) {
              continue;
            }

            return {
              x: rect.right - 24,
              y: rect.top + rect.height / 2
            };
          }
        }

        return undefined;
      });

      if (point) {
        await page.mouse.click(point.x, point.y);
        if (await this.waitForCategoryDropdownOptions(page)) {
          return true;
        }
      }

      await this.moveMouseInsideCategoryDropdown(page);
      await page.mouse.wheel(0, 280);
      await page.waitForTimeout(300);
    }

    return false;
  }

  private async clickCategoryDropdownByLabelField(page: Page) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const boxes = await this.collectVisibleTextBoxes(page, "分类");
      for (const box of boxes) {
        try {
          const x = box.x + 620;
          const y = box.y + box.height + 28;
          await page.mouse.click(x, y);
          if (await this.waitForCategoryDropdownOptions(page)) {
            return true;
          }
        } catch {
          // Recollect category label coordinates after the next scroll attempt.
        }
      }

      await this.moveMouseInsideCategoryDropdown(page);
      await page.mouse.wheel(0, 280);
      await page.waitForTimeout(300);
    }

    return false;
  }

  private async clickCategoryDropdownByPlaceholder(page: Page) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      for (const text of ["请选择合适的频道", "请选择分类", "请选择合适分类"]) {
        const boxes = await this.collectVisibleTextBoxes(page, text);
        for (const box of boxes) {
          try {
            const x = box.x + Math.max(box.width - 32, box.width / 2);
            const y = box.centerY;
            await page.mouse.click(x, y);
            if (await this.waitForCategoryDropdownOptions(page)) {
              return true;
            }
          } catch {
            // Recollect target coordinates after the next scroll attempt.
          }
        }
      }

      await this.moveMouseInsideCategoryDropdown(page);
      await page.mouse.wheel(0, 360);
      await page.waitForTimeout(300);
    }

    return false;
  }

  private async clickVisibleCategoryOption(page: Page, text: string, options: { minCenterX?: number } = {}) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const exactClick = await this.clickExactVisibleText(page, text, options);
      if (exactClick.clicked) {
        return exactClick;
      }

      await this.moveMouseInsideCategoryDropdown(page);
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(300);
    }

    return { clicked: false };
  }

  private async clickCategoryOptionByDom(page: Page, text: string, options: { minCenterX?: number } = {}) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await page.evaluate(
        ({ targetText, minCenterX }) => {
          const isVisible = (element: Element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom > 0 &&
              rect.top < window.innerHeight &&
              style.visibility !== "hidden" &&
              style.display !== "none"
            );
          };

          const textOf = (element: Element) => (element.textContent ?? "").replace(/\s+/g, "").trim();
          const optionRoles = new Set(["option", "menuitem", "treeitem"]);
          const candidates = Array.from(document.querySelectorAll<HTMLElement>("body *"))
            .filter((element) => textOf(element) === targetText)
            .filter(isVisible)
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return minCenterX === undefined || rect.left + rect.width / 2 >= minCenterX;
            })
            .map((element) => {
              let current: HTMLElement | null = element;
              for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
                const role = current.getAttribute("role") ?? "";
                const className = current.className ? String(current.className) : "";
                if (
                  optionRoles.has(role) ||
                  /option|item|menu|tree|select|cascader/i.test(className) ||
                  current.tagName === "LI"
                ) {
                  return current;
                }
              }
              return element;
            })
            .filter(isVisible)
            .sort((a, b) => {
              const aRect = a.getBoundingClientRect();
              const bRect = b.getBoundingClientRect();
              return bRect.top - aRect.top || bRect.left - aRect.left;
            });

          const candidate = candidates[0];
          if (candidate) {
            const rect = candidate.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const eventInit = {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
              view: window
            };
            candidate.dispatchEvent(new PointerEvent("pointerdown", eventInit));
            candidate.dispatchEvent(new MouseEvent("mousedown", eventInit));
            candidate.dispatchEvent(new PointerEvent("pointerup", eventInit));
            candidate.dispatchEvent(new MouseEvent("mouseup", eventInit));
            candidate.dispatchEvent(new MouseEvent("click", eventInit));
            return {
              clicked: true,
              box: {
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height,
                centerX: x,
                centerY: y
              }
            };
          }

          const scrollables = Array.from(document.querySelectorAll<HTMLElement>("body *"))
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              const style = window.getComputedStyle(element);
              return (
                isVisible(element) &&
                element.scrollHeight > element.clientHeight + 12 &&
                rect.height >= 80 &&
                /(auto|scroll)/.test(style.overflowY)
              );
            })
            .sort((a, b) => {
              const aRect = a.getBoundingClientRect();
              const bRect = b.getBoundingClientRect();
              return aRect.height - bRect.height;
            });

          for (const scrollable of scrollables) {
            const before = scrollable.scrollTop;
            scrollable.scrollTop = before + 240;
            if (scrollable.scrollTop !== before) {
              const rect = scrollable.getBoundingClientRect();
              return {
                clicked: false,
                scrolled: true,
                point: {
                  x: rect.left + rect.width / 2,
                  y: rect.top + Math.min(rect.height - 8, Math.max(8, rect.height / 2))
                }
              };
            }
          }

          return { clicked: false, scrolled: false };
        },
        { targetText: text, minCenterX: options.minCenterX }
      );

      if (result.clicked) {
        return {
          clicked: true,
          box: result.box
            ? {
                text,
                ...result.box
              }
            : undefined
        };
      }

      if (result.point) {
        await page.mouse.move(result.point.x, result.point.y);
      } else {
        await this.moveMouseInsideCategoryDropdown(page);
        await page.mouse.wheel(0, 240);
      }
      await page.waitForTimeout(250);
    }

    return this.clickVisibleCategoryOption(page, text, options);
  }

  private async clickVisibleCategoryConfirm(page: Page) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      for (const text of ["确定", "完成"]) {
        const boxes = await this.collectVisibleTextBoxes(page, text);
        const box = boxes
          .filter((candidate) => candidate.width > 0 && candidate.height > 0)
          .sort((a, b) => b.y - a.y || b.centerX - a.centerX)[0];
        if (box) {
          await page.mouse.click(box.centerX, box.centerY);
          return true;
        }
      }

      await this.moveMouseInsideCategoryDropdown(page);
      await page.mouse.wheel(0, 160);
      await page.waitForTimeout(300);
    }

    return false;
  }

  private async verifyWeiboTechCategorySelected(page: Page) {
    await page.waitForTimeout(500);

    const placeholderVisibleNearCategory = await this.isCategoryPlaceholderStillVisible(page);
    if (placeholderVisibleNearCategory) {
      return false;
    }

    const selectedTextsVisible =
      (await this.waitForAnyExactText(page, ["科技数码"], 1_500)) &&
      (await this.waitForAnyExactText(page, ["科技"], 1_500));
    return selectedTextsVisible;
  }

  private async isCategoryPlaceholderStillVisible(page: Page) {
    const categoryBoxes = await this.collectVisibleTextBoxes(page, "分类");
    const placeholders = [
      ...(await this.collectVisibleTextBoxes(page, "请选择合适的频道")),
      ...(await this.collectVisibleTextBoxes(page, "请选择分类")),
      ...(await this.collectVisibleTextBoxes(page, "请选择合适分类"))
    ];

    return placeholders.some((placeholder) =>
      categoryBoxes.some(
        (category) =>
          Math.abs(placeholder.centerY - (category.y + category.height + 28)) < 50 &&
          placeholder.centerX > category.centerX
      )
    );
  }

  private async clickCategoryDropdownByScreenshotLayout(page: Page) {
    const categoryBoxes = await this.collectVisibleTextBoxes(page, "分类");
    for (const box of categoryBoxes) {
      const x = Math.max(24, box.x + 360);
      const y = box.y + box.height + 60;
      try {
        await page.mouse.click(x, y);
        if (await this.waitForCategoryDropdownOptions(page)) {
          return true;
        }
      } catch {
        // Try the next visible 分类 label.
      }
    }

    const collectionBoxes = await this.collectVisibleTextBoxes(page, "合集");
    for (const box of collectionBoxes) {
      const x = Math.max(24, box.x + 360);
      const y = Math.max(24, box.y - 105);
      try {
        await page.mouse.click(x, y);
        if (await this.waitForCategoryDropdownOptions(page)) {
          return true;
        }
      } catch {
        // Try the next layout-derived category position.
      }
    }

    return false;
  }

  private async clickCategoryFieldByLabelPosition(page: Page) {
    for (const label of ["分类", "领域分类", "领域"]) {
      const boxes = await this.collectVisibleTextBoxes(page, label);
      for (const box of boxes) {
        try {
          await page.mouse.click(box.centerX + 180, box.centerY);
          if (await this.waitForCategoryDropdownOptions(page)) {
            return true;
          }
        } catch {
          // Try the next label coordinate.
        }
      }
    }

    return false;
  }

  private async waitForCategoryDropdownOptions(page: Page) {
    const deadline = Date.now() + 4_000;
    let scrolled = false;
    while (Date.now() < deadline) {
      const boxes = await this.collectVisibleTextBoxes(page, "科技数码");
      if (boxes.some((box) => box.width > 0 && box.height > 0)) {
        return true;
      }

      if (!scrolled) {
        await this.moveMouseInsideCategoryDropdown(page);
        await page.mouse.wheel(0, 520);
        scrolled = true;
      }

      await page.waitForTimeout(150);
    }
    return false;
  }

  private async moveMouseInsideCategoryDropdown(page: Page) {
    const point = await page.evaluate(() => {
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        );
      };

      const optionTexts = ["请选择合适的频道", "请选择分类", "请选择合适分类", "科技数码"];
      const candidates = Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((element) => {
          const text = element.textContent?.trim() ?? "";
          return optionTexts.some((target) => text.includes(target));
        })
        .filter(isVisible)
        .sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          return aRect.width * aRect.height - bRect.width * bRect.height;
        });

      for (const candidate of candidates) {
        let current: HTMLElement | null = candidate;
        for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
          const rect = current.getBoundingClientRect();
          if (!isVisible(current) || rect.width < 240 || rect.height < 28) {
            continue;
          }

          return {
            x: Math.min(window.innerWidth - 32, Math.max(32, rect.right - 24)),
            y: Math.min(window.innerHeight - 32, Math.max(32, rect.top + rect.height / 2))
          };
        }
      }

      return undefined;
    });

    if (point) {
      await page.mouse.move(point.x, point.y);
      return true;
    }

    return false;
  }

  private async clickVisibleOption(page: Page, text: string, options: { minCenterX?: number } = {}) {
    const exactClick = await this.clickExactVisibleText(page, text, options);
    if (exactClick.clicked) {
      return exactClick;
    }

    const candidates = [
      page.getByRole("option", { name: new RegExp(`^${escapeRegExp(text)}$`) }).first(),
      page.getByRole("menuitem", { name: new RegExp(`^${escapeRegExp(text)}$`) }).first(),
      page.getByRole("treeitem", { name: new RegExp(`^${escapeRegExp(text)}$`) }).first(),
      page.getByText(text, { exact: true }).last(),
      page.locator(`[role="option"]:text-is("${text}")`).first(),
      page.locator(`[role="menuitem"]:text-is("${text}")`).first(),
      page.locator(`[role="treeitem"]:text-is("${text}")`).first(),
      page.locator(`li:text-is("${text}")`).first(),
      page.locator(`div:text-is("${text}")`).last()
    ];

    for (const candidate of candidates) {
      try {
        await candidate.waitFor({ state: "visible", timeout: 3_000 });
        await candidate.click({ timeout: 3_000 });
        return { clicked: true };
      } catch {
        // Try the next visible option candidate.
      }
    }

    return { clicked: false };
  }

  private async clickExactVisibleText(page: Page, text: string, options: { minCenterX?: number } = {}) {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const boxes = await this.collectVisibleTextBoxes(page, text);
      const box = boxes
        .filter((candidate) => candidate.width > 0 && candidate.height > 0)
        .filter((candidate) => options.minCenterX === undefined || candidate.centerX >= options.minCenterX)
        .sort((a, b) => b.y - a.y || b.centerX - a.centerX)[0];

      if (box) {
        await page.mouse.click(box.centerX, box.centerY);
        return { clicked: true, box };
      }

      await page.waitForTimeout(150);
    }

    return { clicked: false };
  }
}

function formatWeiboTags(tags: string[]) {
  return tags
    .map((tag) => tag.replace(/^#+|#+$/g, "").trim())
    .filter(Boolean)
    .map((tag) => `#${tag}#`)
    .join(" ");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
