import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { dataDir } from "../../config";
import type { PublishContext } from "../adapter";
import { BaseWebAdapter } from "../baseWebAdapter";
import { formatTags } from "../format";

export class DouyinAdapter extends BaseWebAdapter {
  platform = "douyin" as const;

  protected profile = {
    videoInputs: [
      'input[type="file"][accept*="video"]',
      'input[type="file"] >> nth=0'
    ],
    cover34Inputs: [
      'input[type="file"][accept*="image"][data-ratio="3:4"]',
      'input[type="file"][accept*="image"] >> nth=0',
      'input[type="file"] >> nth=1'
    ],
    cover43Inputs: [
      'input[type="file"][accept*="image"][data-ratio="4:3"]',
      'input[type="file"][accept*="image"] >> nth=1',
      'input[type="file"] >> nth=2'
    ],
    titleInputs: [
      'textarea[placeholder*="标题"]',
      'input[placeholder*="标题"]'
    ],
    descriptionInputs: [
      'textarea[placeholder*="添加作品描述"]',
      'textarea[placeholder*="描述"]',
      '[contenteditable="true"]'
    ],
    submitImmediateTexts: ["发布", "立即发布"]
  };

  async setContentDeclaration({ step }: PublishContext) {
    await step("跳过抖音自主声明");
  }

  async setTitleAndTags({ task, page, step }: PublishContext) {
    await step("填写抖音标题和标签");
    await this.tryFillFirst(page, this.profile.titleInputs, task.title);

    const tagText = formatTags(task.tags);
    if (!tagText) {
      return;
    }

    const tagsFilled = await this.tryFillFirst(page, this.profile.descriptionInputs, tagText);
    if (!tagsFilled) {
      throw new Error("未能填写抖音作品简介标签");
    }
  }

  async setCover({ task, page, step }: PublishContext) {
    await step("等待抖音视频上传完成");
    await this.waitForDouyinVideoUploadReady(page);

    await step("设置抖音 4:3 横封面");
    await this.tryClickByText(page, ["设置封面", "编辑封面"]);

    if (!(await this.openDouyinCoverEditorFromCard(page, "4:3"))) {
      throw new Error("未能打开抖音 4:3 横封面上传页");
    }

    const horizontalDone = await this.uploadDouyinCoverInEditor(page, task.cover43Path, "4:3");
    if (!horizontalDone) {
      throw new Error("未找到抖音 4:3 横封面上传控件");
    }

    await step("切换抖音 3:4 竖封面");
    if (!(await this.activateDouyinVerticalCover(page))) {
      throw new Error("抖音设置竖封面未激活");
    }

    await step("上传抖音 3:4 竖封面");
    const verticalDone = await this.uploadDouyinCoverInEditor(page, task.cover34Path, "3:4");
    if (!verticalDone) {
      throw new Error("未找到抖音 3:4 竖版封面上传控件");
    }

    await step("完成抖音封面设置");
    if (!(await this.confirmDouyinCoverAndWaitEffectPassed(page))) {
      throw new Error("抖音封面完成后未检测到“封面效果检测通过”，停止发布");
    }
  }

  async submitPublish({ page, step }: PublishContext) {
    await step("提交抖音立即发布");
    const result = await this.clickDouyinBottomPublishButton(page);
    await this.logDouyinPublishClick({
      phase: "submit-click",
      result
    });

    if (!result.clicked) {
      throw new Error(`未找到抖音底部发布按钮${result.reason ? `：${result.reason}` : ""}`);
    }

    await this.waitForPublishSubmitted(page);
  }

  private async waitForDouyinVideoUploadReady(page: Page) {
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      const state = await page.evaluate<{
        uploading: boolean;
        error?: string;
        percent?: number;
      }>(() => {
        const marker = "douyin-video-upload-state";
        void marker;
        const text = document.body?.innerText || "";
        const error = ["上传失败", "上传异常", "视频处理失败", "转码失败"].find((item) => text.includes(item));
        const percentMatches = Array.from(text.matchAll(/(\d{1,3})\s*%/g))
          .map((match) => Number(match[1]))
          .filter((value) => Number.isFinite(value) && value >= 0 && value <= 100);
        const percent = percentMatches.length > 0 ? Math.max(...percentMatches) : undefined;
        const hasUploadSignal = [
          "上传过程中请不要删除/移动文件",
          "已上传",
          "当前速度",
          "剩余时间",
          "取消上传",
          "暂停中",
          "继续"
        ].some((item) => text.includes(item));
        const hasDoneSignal = ["上传完成", "上传成功", "处理完成"].some((item) => text.includes(item));
        const uploading = !hasDoneSignal && hasUploadSignal && (percent === undefined || percent < 100);

        return { uploading, error, percent };
      }).catch(() => ({ uploading: false, error: undefined, percent: undefined }));

      if (state.error) {
        throw new Error(`抖音视频上传失败：${state.error}`);
      }
      if (!state.uploading) {
        return;
      }

      await page.waitForTimeout(2_000);
    }

    throw new Error("等待抖音视频上传完成超时");
  }

  private async openDouyinCoverEditorFromCard(page: Page, ratio: "4:3" | "3:4") {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const labelBoxClicked = await this.clickDouyinCoverCardFromLabelBox(page, ratio);
      if (labelBoxClicked) {
        return true;
      }

      const pointClicked = await this.clickDouyinCoverCardByPoints(page, ratio);
      if (pointClicked) {
        return true;
      }

      const result = await this.clickDouyinCoverCard(page, ratio);
      if (!result.clicked) {
        if (ratio === "4:3") {
          await this.tryClickByText(page, ["横封面4:3", "横封面", "4:3", "选择封面"]);
        } else {
          await this.tryClickByText(page, ["竖封面3:4", "竖封面", "3:4", "选择封面"]);
        }
      }

      await page.waitForTimeout(800);
      if (await this.isDouyinCoverEditorVisible(page)) {
        return true;
      }

      if (result.point) {
        await page.mouse.click(result.point.x, result.point.y);
        await page.waitForTimeout(1_000);
        if (await this.isDouyinCoverEditorVisible(page)) {
          return true;
        }
      }
    }

    return false;
  }

  private async clickDouyinCoverCardFromLabelBox(page: Page, ratio: "4:3" | "3:4") {
    const labels = ratio === "4:3" ? ["横封面4:3", "横封面"] : ["竖封面3:4", "竖封面"];
    for (const label of labels) {
      const box = await page.getByText(label, { exact: false }).first().boundingBox({ timeout: 1_000 }).catch(() => null);
      if (!box) {
        continue;
      }

      const centerX = box.x + box.width / 2;
      const points = ratio === "4:3"
        ? [
            { x: centerX, y: box.y - 64 },
            { x: centerX + 28, y: box.y - 64 },
            { x: centerX - 28, y: box.y - 64 },
            { x: centerX, y: box.y - 96 },
            { x: centerX + 40, y: box.y - 96 },
            { x: centerX - 40, y: box.y - 96 }
          ]
        : [
            { x: centerX, y: box.y - 64 },
            { x: centerX, y: box.y - 96 },
            { x: centerX, y: box.y - 120 }
          ];

      for (const point of points) {
        try {
          await page.mouse.move(point.x, point.y);
          await page.waitForTimeout(200);
          await page.mouse.click(point.x, point.y, { delay: 80 });
        } catch {
          continue;
        }

        await page.waitForTimeout(1_200);
        if (await this.isDouyinCoverEditorVisible(page)) {
          return true;
        }
      }
    }

    return false;
  }

  private async clickDouyinCoverCardByPoints(page: Page, ratio: "4:3" | "3:4") {
    const points = await page.evaluate<Array<{ x: number; y: number }>, "4:3" | "3:4">((targetRatio) => {
      const marker = "douyin-cover-card-points";
      void marker;
      const readText = (element: HTMLElement) => (element.textContent || "").replace(/\s+/g, "");
      const isVisible = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      };
      const visible = Array.from(document.querySelectorAll<HTMLElement>("body *")).filter(isVisible);
      const labelTexts = targetRatio === "4:3" ? ["横封面4:3", "横封面"] : ["竖封面3:4", "竖封面"];
      const ratioLabel = visible
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: readText(element) }))
        .filter(({ text }) => labelTexts.some((label) => text.includes(label)))
        .sort((a, b) => {
          const aArea = a.rect.width * a.rect.height;
          const bArea = b.rect.width * b.rect.height;
          return aArea - bArea || a.rect.left - b.rect.left;
        })[0];

      const result: Array<{ x: number; y: number }> = [];
      const addPoint = (x: number, y: number) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return;
        }
        const point = {
          x: Math.max(0, Math.min(window.innerWidth - 1, x)),
          y: Math.max(0, Math.min(window.innerHeight - 1, y))
        };
        if (!result.some((existing) => Math.abs(existing.x - point.x) < 2 && Math.abs(existing.y - point.y) < 2)) {
          result.push(point);
        }
      };

      if (!ratioLabel) {
        return result;
      }

      ratioLabel.element.scrollIntoView({ block: "center", inline: "center" });
      const labelRect = ratioLabel.element.getBoundingClientRect();
      const labelCenterX = labelRect.left + labelRect.width / 2;

      const chooseLabels = visible
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: readText(element) }))
        .filter(({ rect, text }) => {
          if (!text.includes("选择封面")) {
            return false;
          }
          const centerX = rect.left + rect.width / 2;
          return (
            Math.abs(centerX - labelCenterX) < 110 &&
            rect.bottom <= labelRect.top + 12 &&
            rect.bottom >= labelRect.top - 180
          );
        })
        .sort((a, b) => {
          const aDistance = Math.abs(a.rect.left + a.rect.width / 2 - labelCenterX);
          const bDistance = Math.abs(b.rect.left + b.rect.width / 2 - labelCenterX);
          return aDistance - bDistance || b.rect.bottom - a.rect.bottom;
        });

      const coverBoxes = visible
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: readText(element) }))
        .filter(({ rect, text }) => {
          const centerX = rect.left + rect.width / 2;
          return (
            text.includes("选择封面") &&
            rect.width >= 80 &&
            rect.width <= 260 &&
            rect.height >= 70 &&
            rect.height <= 220 &&
            Math.abs(centerX - labelCenterX) < 130 &&
            rect.bottom <= labelRect.top + 16 &&
            rect.bottom >= labelRect.top - 220
          );
        })
        .sort((a, b) => {
          const aDistance = Math.abs(a.rect.left + a.rect.width / 2 - labelCenterX);
          const bDistance = Math.abs(b.rect.left + b.rect.width / 2 - labelCenterX);
          return aDistance - bDistance || b.rect.width * b.rect.height - a.rect.width * a.rect.height;
        });

      const primaryBox = coverBoxes[0]?.rect;
      if (primaryBox) {
        addPoint(primaryBox.left + primaryBox.width / 2, primaryBox.top + primaryBox.height / 2);
        addPoint(primaryBox.left + primaryBox.width / 2, primaryBox.top + primaryBox.height * 0.68);
        addPoint(primaryBox.left + primaryBox.width / 2, primaryBox.top + primaryBox.height * 0.38);
      }

      const primaryLabel = chooseLabels[0]?.rect;
      if (primaryLabel) {
        addPoint(primaryLabel.left + primaryLabel.width / 2, primaryLabel.top + primaryLabel.height / 2);
      }

      addPoint(labelCenterX, labelRect.top - 70);
      addPoint(labelCenterX, labelRect.top - 105);

      return result.slice(0, 8);
    }, ratio).catch(() => []);

    for (const point of points) {
      try {
        await page.mouse.move(point.x, point.y);
        await page.mouse.click(point.x, point.y);
      } catch {
        continue;
      }

      await page.waitForTimeout(900);
      if (await this.isDouyinCoverEditorVisible(page)) {
        return true;
      }
    }

    return false;
  }

  private async clickDouyinCoverCard(page: Page, ratio: "4:3" | "3:4") {
    const result = await page.evaluate<
      { clicked: boolean; point?: { x: number; y: number }; reason?: string } | boolean,
      "4:3" | "3:4"
    >((targetRatio) => {
      const marker = "douyin-cover-card-click";
      void marker;
      const queryAll = (root: ParentNode, selector: string) => {
        try {
          return Array.from(root.querySelectorAll<HTMLElement>(selector));
        } catch {
          return [];
        }
      };
      const isVisible = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      };
      const clickElement = (element: HTMLElement) => {
        element.scrollIntoView({ block: "center", inline: "center" });
        const rect = element.getBoundingClientRect();
        const point = {
          x: rect.left + rect.width / 2,
          y: rect.top + Math.min(rect.height / 2, Math.max(20, rect.height * 0.42))
        };
        const hit = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
        const targets = [hit, element, element.closest<HTMLElement>("[role='button'], button, label, div")].filter(Boolean) as HTMLElement[];
        const uniqueTargets = Array.from(new Set(targets));
        const eventInit = { bubbles: true, cancelable: true, composed: true, clientX: point.x, clientY: point.y };
        for (const target of uniqueTargets) {
          target.dispatchEvent(new PointerEvent("pointerdown", eventInit));
          target.dispatchEvent(new MouseEvent("mousedown", eventInit));
          target.dispatchEvent(new PointerEvent("pointerup", eventInit));
          target.dispatchEvent(new MouseEvent("mouseup", eventInit));
          target.dispatchEvent(new MouseEvent("click", eventInit));
          target.click();
        }
        return { x: point.x, y: point.y };
      };
      const labelTexts = targetRatio === "4:3" ? ["横封面4:3", "横封面", "4:3"] : ["竖封面3:4", "竖封面", "3:4"];
      const labels = queryAll(document, "body *")
        .filter(isVisible)
        .map((element) => ({ element, text: (element.textContent || "").replace(/\s+/g, "") }))
        .filter(({ text }) => labelTexts.some((label) => text.includes(label)))
        .sort((a, b) => {
          const aRect = a.element.getBoundingClientRect();
          const bRect = b.element.getBoundingClientRect();
          const aArea = aRect.width * aRect.height;
          const bArea = bRect.width * bRect.height;
          return aArea - bArea || aRect.left - bRect.left;
        });
      const label = labels[0]?.element;
      const labelRect = label?.getBoundingClientRect();
      const aboveLabelCards = labelRect
        ? queryAll(document, "body *")
            .filter(isVisible)
            .map((element) => ({ element, rect: element.getBoundingClientRect() }))
            .filter(({ rect }) => {
              const labelCenterX = labelRect.left + labelRect.width / 2;
              return (
                rect.width >= 90 &&
                rect.height >= 90 &&
                rect.left <= labelCenterX &&
                rect.right >= labelCenterX &&
                rect.bottom <= labelRect.top + 12 &&
                rect.bottom >= labelRect.top - 260
              );
            })
            .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)
        : [];
      const chooseCards = queryAll(document, "body *")
        .filter(isVisible)
        .filter((element) => (element.textContent || "").includes("选择封面"))
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => {
          if (rect.width < 80 || rect.height < 80) {
            return false;
          }
          if (!labelRect) {
            return true;
          }
          const cardCenterX = rect.left + rect.width / 2;
          const labelCenterX = labelRect.left + labelRect.width / 2;
          return Math.abs(cardCenterX - labelCenterX) <= Math.max(rect.width, labelRect.width) && rect.bottom <= labelRect.bottom + 16;
        })
        .sort((a, b) => {
          const aRatio = a.rect.width / Math.max(a.rect.height, 1);
          const bRatio = b.rect.width / Math.max(b.rect.height, 1);
          if (targetRatio === "4:3") {
            return bRatio - aRatio || a.rect.left - b.rect.left;
          }
          return aRatio - bRatio || a.rect.left - b.rect.left;
        });
      const target = chooseCards[0]?.element || aboveLabelCards[0]?.element || label?.closest<HTMLElement>("[role='button'], button, label, div") || label;
      if (!target) {
        return { clicked: false, reason: "cover card not found" };
      }

      const point = clickElement(target);
      return { clicked: true, point };
    }, ratio).catch(() => false);

    if (typeof result === "boolean") {
      return { clicked: result };
    }

    return result;
  }

  private async isDouyinCoverEditorVisible(page: Page) {
    return page.evaluate<boolean>(() => {
      const marker = "douyin-cover-editor-visible";
      void marker;
      const text = document.body?.innerText || "";
      return (
        text.includes("设置横封面") ||
        text.includes("设置竖封面") ||
        text.includes("封面检测") ||
        text.includes("横封面预览") ||
        text.includes("竖封面预览")
      );
    }).catch(() => false);
  }

  private async uploadDouyinCoverInEditor(page: Page, filePath: string, ratio: "4:3" | "3:4") {
    const uploadedByBox = await this.clickDouyinCoverUploadBox(page, filePath, ratio);
    if (uploadedByBox) {
      await page.waitForTimeout(1_000);
      return true;
    }

    const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 5_000 }).catch(() => undefined);
    const clickedUpload = await this.clickDouyinUploadCoverButton(page, ratio);
    if (clickedUpload) {
      const fileChooser = await fileChooserPromise;
      if (fileChooser) {
        await fileChooser.setFiles(filePath);
        await page.waitForTimeout(1_000);
        return true;
      }
    } else {
      await fileChooserPromise;
    }

    const uploadedByChooser = await this.tryUploadFileViaChooser(
      page,
      ["上传封面", "上传图片", "本地上传", "上传本地图片", "从本地上传", "选择图片"],
      filePath
    );
    if (uploadedByChooser) {
      await page.waitForTimeout(1_000);
      return true;
    }

    const uploadedByEditorInput = await this.trySetDouyinCoverEditorInput(page, filePath);
    if (uploadedByEditorInput) {
      await page.waitForTimeout(1_000);
      return true;
    }

    const inputs = ratio === "4:3" ? this.profile.cover43Inputs : this.profile.cover34Inputs;
    return this.trySetInputFiles(page, inputs, filePath);
  }

  private async trySetDouyinCoverEditorInput(page: Page, filePath: string) {
    const indexes = await page.evaluate<number[]>(() => {
      const marker = "douyin-cover-editor-file-inputs";
      void marker;
      const bodyText = document.body?.innerText || "";
      const editorVisible = (
        bodyText.includes("设置横封面") ||
        bodyText.includes("设置竖封面") ||
        bodyText.includes("封面检测") ||
        bodyText.includes("横封面预览") ||
        bodyText.includes("竖封面预览")
      );
      if (!editorVisible) {
        return [];
      }

      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
      return inputs
        .map((input, index) => {
          const accept = (input.getAttribute("accept") || "").toLowerCase();
          const disabled = input.disabled || input.getAttribute("aria-disabled") === "true";
          return { index, accept, disabled };
        })
        .filter(({ accept, disabled }) => !disabled && !accept.includes("video"))
        .sort((a, b) => {
          const aImage = a.accept.includes("image") ? 1 : 0;
          const bImage = b.accept.includes("image") ? 1 : 0;
          return bImage - aImage || b.index - a.index;
        })
        .map(({ index }) => index);
    }).catch(() => []);

    await this.logDouyinCoverUploadClick({
      phase: "editor-input-candidates",
      indexes
    });

    for (const index of indexes) {
      const uploaded = await this.trySetInputFiles(page, [`input[type="file"] >> nth=${index}`], filePath);
      await this.logDouyinCoverUploadClick({
        phase: "editor-input-set-files",
        index,
        filePath,
        uploaded
      });
      if (uploaded) {
        return true;
      }
    }

    return false;
  }

  private async inspectDouyinCoverUploadPoint(page: Page, point: { x: number; y: number }) {
    return page.evaluate<{
      point: { x: number; y: number };
      hitTagName?: string;
      hitText?: string;
      hitClassName?: string;
      hitRole?: string | null;
      hitRect?: { left: number; top: number; right: number; bottom: number; width: number; height: number };
      nearestButtonText?: string;
      nearestButtonRect?: { left: number; top: number; right: number; bottom: number; width: number; height: number };
    }, { x: number; y: number }>((targetPoint) => {
      const marker = "douyin-cover-upload-click-inspect";
      void marker;
      const hit = document.elementFromPoint(targetPoint.x, targetPoint.y) as HTMLElement | null;
      const toRect = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        };
      };
      const button = hit?.closest<HTMLElement>("button, [role='button'], label, div");
      return {
        point: targetPoint,
        hitTagName: hit?.tagName,
        hitText: (hit?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
        hitClassName: typeof hit?.className === "string" ? hit.className.slice(0, 160) : undefined,
        hitRole: hit?.getAttribute("role"),
        hitRect: hit ? toRect(hit) : undefined,
        nearestButtonText: (button?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
        nearestButtonRect: button ? toRect(button) : undefined
      };
    }, point).catch((error) => ({
      point,
      inspectError: error instanceof Error ? error.message : String(error)
    }));
  }

  private async logDouyinCoverUploadClick(event: Record<string, unknown>) {
    const entry = {
      time: new Date().toISOString(),
      platform: this.platform,
      ...event
    };
    const line = JSON.stringify(entry);
    console.info(`[douyin-cover-upload] ${line}`);
    await fs
      .mkdir(dataDir, { recursive: true })
      .then(() => fs.appendFile(path.join(dataDir, "douyin-cover-upload-clicks.jsonl"), `${line}\n`))
      .catch(() => undefined);
  }

  private async logDouyinPublishClick(event: Record<string, unknown>) {
    const entry = {
      time: new Date().toISOString(),
      platform: this.platform,
      ...event
    };
    const line = JSON.stringify(entry);
    console.info(`[douyin-publish] ${line}`);
    await fs
      .mkdir(dataDir, { recursive: true })
      .then(() => fs.appendFile(path.join(dataDir, "douyin-publish-clicks.jsonl"), `${line}\n`))
      .catch(() => undefined);
  }

  private async clickDouyinBottomPublishButton(page: Page) {
    let lastResult: {
      clicked: boolean;
      reason?: string;
      point?: { x: number; y: number };
      targetText?: string;
      hitText?: string;
      candidates?: Array<{
        text: string;
        rect: { left: number; top: number; width: number; height: number; right: number; bottom: number };
      }>;
      exactTextCandidates?: Array<{
        text: string;
        rect: { left: number; top: number; width: number; height: number; right: number; bottom: number };
      }>;
    } | undefined;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      lastResult = await page.evaluate<typeof lastResult>(`(() => {
      const marker = "douyin-bottom-publish-click";
      void marker;
      const textOf = (element) => (element.textContent || "").replace(/\\s+/g, " ").trim();
      const rectOf = (element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom
        };
      };
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width >= 70 &&
          rect.height >= 32 &&
          rect.right > 0 &&
          rect.left < window.innerWidth &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0"
        );
      };
      const exactPublishText = (text) => text === "发布" || text === "立即发布";
      const scrollToBottom = () => {
        window.scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight);
        const scrollers = Array.from(document.querySelectorAll("*"))
          .filter((element) => element.scrollHeight > element.clientHeight + 8);
        for (const element of [document.scrollingElement, document.documentElement, document.body, ...scrollers]) {
          if (!element) {
            continue;
          }
          element.scrollTop = element.scrollHeight;
        }
      };
      const clickTarget = (element) => {
        element.scrollIntoView({ block: "center", inline: "center" });
        const rect = element.getBoundingClientRect();
        const point = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
        const hit = document.elementFromPoint(point.x, point.y);
        const targets = Array.from(new Set([
          hit,
          element,
          element.closest("button, [role='button']")
        ].filter(Boolean)));
        const eventInit = {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: point.x,
          clientY: point.y,
          view: window
        };
        for (const target of targets) {
          target.dispatchEvent(new PointerEvent("pointerdown", eventInit));
          target.dispatchEvent(new MouseEvent("mousedown", eventInit));
          target.dispatchEvent(new PointerEvent("pointerup", eventInit));
          target.dispatchEvent(new MouseEvent("mouseup", eventInit));
          target.dispatchEvent(new MouseEvent("click", eventInit));
          if (typeof target.click === "function") {
            target.click();
          }
        }
        return {
          point,
          hitText: textOf(hit || element)
        };
      };

      scrollToBottom();

      const exactTextCandidates = Array.from(document.querySelectorAll("button, [role='button'], a, div, span"))
        .filter(isVisible)
        .map((element) => {
          const rect = rectOf(element);
          return {
            element,
            text: textOf(element),
            rect,
            role: element.getAttribute("role") || "",
            tagName: element.tagName
          };
        })
        .filter(({ text }) => exactPublishText(text));
      const viewportCandidates = exactTextCandidates
        .filter(({ rect }) => rect.bottom > 0 && rect.top < window.innerHeight);
      const lowerViewportCandidates = viewportCandidates
        .filter(({ rect }) => rect.top >= window.innerHeight * 0.35);
      const elements = (lowerViewportCandidates.length > 0 ? lowerViewportCandidates : viewportCandidates.length > 0 ? viewportCandidates : exactTextCandidates)
        .sort((a, b) => {
          const aButton = a.tagName === "BUTTON" || a.role === "button" ? 1 : 0;
          const bButton = b.tagName === "BUTTON" || b.role === "button" ? 1 : 0;
          return bButton - aButton || b.rect.bottom - a.rect.bottom || b.rect.right - a.rect.right;
        });
      const candidate = elements[0];
      const candidates = elements.slice(0, 5).map(({ text, rect }) => ({ text, rect }));
      const allCandidates = exactTextCandidates.slice(0, 10).map(({ text, rect }) => ({ text, rect }));
      if (!candidate) {
        return {
          clicked: false,
          reason: "bottom exact publish button not found after scrolling",
          candidates,
          exactTextCandidates: allCandidates,
          attempt: ${attempt}
        };
      }
      const click = clickTarget(candidate.element);
      return {
        clicked: true,
        point: click.point,
        targetText: candidate.text,
        hitText: click.hitText,
        candidates,
        exactTextCandidates: allCandidates,
        attempt: ${attempt}
      };
    })()`).catch((error) => ({
        clicked: false,
        reason: error instanceof Error ? error.message : String(error)
      }));

      if (lastResult?.clicked) {
        return lastResult;
      }

      await page.waitForTimeout(500);
    }

    return lastResult ?? { clicked: false, reason: "bottom exact publish button not found after scrolling" };
  }

  private async clickDouyinCoverUploadBox(page: Page, filePath: string, ratio: "4:3" | "3:4") {
    const evaluatedPoints: {
      points: Array<{ x: number; y: number; source?: string }>;
      error?: string;
    } = await page.evaluate<Array<{ x: number; y: number; source?: string }>, "4:3" | "3:4">((targetRatio) => {
      const marker = "douyin-cover-upload-box-points";
      void marker;
      const normalizedText = (element: HTMLElement) => [
        element.textContent || "",
        element.getAttribute("aria-label") || "",
        element.getAttribute("title") || "",
        element.getAttribute("alt") || ""
      ].join(" ").replace(/\s+/g, "");
      const isVisible = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      };
      const isDarkBackground = (backgroundColor: string) => {
        const match = backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (!match) {
          return false;
        }
        const channels = match.slice(1, 4).map(Number);
        return channels.every((value) => Number.isFinite(value) && value <= 90);
      };
      const visibleElements = Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter(isVisible)
        .map((element) => {
          const style = window.getComputedStyle(element);
          return {
            element,
            rect: element.getBoundingClientRect(),
            text: normalizedText(element),
            backgroundColor: style.backgroundColor
          };
        });
      const labels = visibleElements
        .filter(({ text, rect }) => {
          const isUploadText =
            text.includes("上传封面") ||
            text.includes("上传图片") ||
            text.includes("本地上传") ||
            text.includes("选择图片");
          return isUploadText && rect.width > 0 && rect.height > 0;
        })
        .sort((a, b) => {
          if (targetRatio === "3:4") {
            return b.rect.right - a.rect.right || b.rect.bottom - a.rect.bottom;
          }
          return b.rect.bottom - a.rect.bottom || b.rect.right - a.rect.right;
        });
      const result: Array<{ x: number; y: number; source?: string }> = [];
      const addPoint = (x: number, y: number, source: string) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return;
        }
        const point = {
          x: Math.max(0, Math.min(window.innerWidth - 1, x)),
          y: Math.max(0, Math.min(window.innerHeight - 1, y)),
          source
        };
        if (!result.some((existing) => Math.abs(existing.x - point.x) < 2 && Math.abs(existing.y - point.y) < 2)) {
          result.push(point);
        }
      };

      addPoint(window.innerWidth * 0.675, window.innerHeight * 0.79, "cover-editor-layout-upload-lower");
      addPoint(window.innerWidth * 0.675, window.innerHeight * 0.76, "cover-editor-layout-upload-center");
      addPoint(window.innerWidth * 0.69, window.innerHeight * 0.79, "cover-editor-layout-upload-right-lower");
      addPoint(window.innerWidth * 0.69, window.innerHeight * 0.76, "cover-editor-layout-upload-right-center");

      for (const label of labels) {
        const labelCenterX = label.rect.left + label.rect.width / 2;
        const labelCenterY = label.rect.top + label.rect.height / 2;
        const containers = visibleElements
          .filter(({ rect, text }) => {
            if (rect.width < 60 || rect.height < 40 || !text.includes("上传")) {
              return false;
            }
            return (
              rect.left <= labelCenterX + 16 &&
              rect.right >= labelCenterX - 16 &&
              rect.top <= labelCenterY + 16 &&
              rect.bottom >= labelCenterY - 16
            );
          })
          .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);

        for (const container of containers.slice(0, 3)) {
          addPoint(container.rect.left + container.rect.width / 2, container.rect.top + container.rect.height / 2, "upload-text-container");
        }
        addPoint(labelCenterX, labelCenterY, "upload-text");
        addPoint(labelCenterX, label.rect.top - 42, "upload-text-above-42");
        addPoint(labelCenterX, label.rect.top - 72, "upload-text-above-72");
      }

      const darkUploadCards = visibleElements
        .filter(({ rect, text, backgroundColor }) => {
          if (text.includes("完成") || text.includes("封面检测") || text.includes("设置横封面") || text.includes("设置竖封面")) {
            return false;
          }
          return (
            rect.width >= 70 &&
            rect.width <= 240 &&
            rect.height >= 45 &&
            rect.height <= 150 &&
            rect.top >= window.innerHeight * 0.42 &&
            rect.left >= window.innerWidth * 0.35 &&
            isDarkBackground(backgroundColor)
          );
        })
        .sort((a, b) => {
          const areaDistance = b.rect.width * b.rect.height - a.rect.width * a.rect.height;
          if (Math.abs(areaDistance) > 1_000) {
            return areaDistance;
          }
          return b.rect.right - a.rect.right || b.rect.bottom - a.rect.bottom;
        });

      for (const card of darkUploadCards.slice(0, 5)) {
        addPoint(card.rect.left + card.rect.width / 2, card.rect.top + card.rect.height / 2, "dark-upload-card");
        addPoint(card.rect.left + card.rect.width / 2, card.rect.top + card.rect.height * 0.62, "dark-upload-card-lower");
      }

      return result.slice(0, 8);
    }, ratio).then((points) => ({ points })).catch((error) => ({
      points: [],
      error: error instanceof Error ? error.message : String(error)
    }));

    if (evaluatedPoints.error) {
      await this.logDouyinCoverUploadClick({
        phase: "upload-box-points-evaluate-error",
        ratio,
        error: evaluatedPoints.error
      });
    }

    const locatorUploaded = await this.clickDouyinCoverUploadTextLocator(page, filePath, ratio);
    if (locatorUploaded) {
      return true;
    }

    let points = evaluatedPoints.points;
    await this.logDouyinCoverUploadClick({
      phase: "upload-box-point-candidates",
      ratio,
      points
    });

    if (points.length === 0) {
      points = this.getDouyinCoverUploadFixedPoints(page);
      await this.logDouyinCoverUploadClick({
        phase: "use-fixed-upload-points",
        ratio,
        points
      });
    }

    for (const point of points) {
      const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 3_500 }).catch(() => undefined);
      const inspection = await this.inspectDouyinCoverUploadPoint(page, point);
      await this.logDouyinCoverUploadClick({
        phase: "before-point-click",
        ratio,
        point,
        inspection
      });
      try {
        await page.mouse.click(point.x, point.y);
      } catch {
        await fileChooserPromise;
        await this.logDouyinCoverUploadClick({
          phase: "point-click-error",
          ratio,
          point
        });
        continue;
      }

      let fileChooser = await Promise.race([
        fileChooserPromise,
        page.waitForTimeout(450).then(() => undefined)
      ]);
      await this.logDouyinCoverUploadClick({
        phase: "after-first-point-click",
        ratio,
        point,
        fileChooserOpened: Boolean(fileChooser)
      });
      if (!fileChooser) {
        try {
          await page.mouse.click(point.x, point.y);
        } catch {
          await fileChooserPromise;
          await this.logDouyinCoverUploadClick({
            phase: "second-point-click-error",
            ratio,
            point
          });
          continue;
        }

        fileChooser = await fileChooserPromise;
        await this.logDouyinCoverUploadClick({
          phase: "after-second-point-click",
          ratio,
          point,
          fileChooserOpened: Boolean(fileChooser)
        });
      }
      if (fileChooser) {
        await fileChooser.setFiles(filePath);
        await this.logDouyinCoverUploadClick({
          phase: "file-set-from-point-click",
          ratio,
          point,
          filePath
        });
        return true;
      }
    }

    await this.logDouyinCoverUploadClick({
      phase: "point-clicks-exhausted",
      ratio,
      points
    });
    return false;
  }

  private async clickDouyinCoverUploadTextLocator(page: Page, filePath: string, ratio: "4:3" | "3:4") {
    const textLocator = page.getByText("上传封面", { exact: false });
    const locators = await textLocator.all().catch(() => []);
    const candidates = locators.length > 0 ? locators : [textLocator.last()];
    const boxes = [];

    for (const [index, locator] of candidates.entries()) {
      const box = await locator.boundingBox().catch(() => null);
      if (!box || box.width <= 0 || box.height <= 0) {
        continue;
      }

      boxes.push({ index, locator, box });
    }

    boxes.sort((a, b) => b.box.y - a.box.y || b.box.x - a.box.x);
    await this.logDouyinCoverUploadClick({
      phase: "locator-upload-text-candidates",
      ratio,
      boxes: boxes.map(({ index, box }) => ({ index, box }))
    });

    for (const candidate of boxes.slice(0, 4)) {
      const point = {
        x: candidate.box.x + candidate.box.width / 2,
        y: candidate.box.y + candidate.box.height / 2,
        source: "locator-upload-text"
      };
      const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 3_500 }).catch(() => undefined);

      try {
        await candidate.locator.click({ timeout: 1_500, force: true });
      } catch (error) {
        await this.logDouyinCoverUploadClick({
          phase: "locator-upload-text-first-click-error",
          ratio,
          point,
          error: error instanceof Error ? error.message : String(error)
        });
        await fileChooserPromise;
        continue;
      }

      let fileChooser = await Promise.race([
        fileChooserPromise,
        page.waitForTimeout(350).then(() => undefined)
      ]);
      await this.logDouyinCoverUploadClick({
        phase: "locator-upload-text-after-first-click",
        ratio,
        point,
        fileChooserOpened: Boolean(fileChooser)
      });

      if (!fileChooser) {
        try {
          await candidate.locator.click({ timeout: 1_500, force: true });
        } catch (error) {
          await this.logDouyinCoverUploadClick({
            phase: "locator-upload-text-second-click-error",
            ratio,
            point,
            error: error instanceof Error ? error.message : String(error)
          });
          await fileChooserPromise;
          continue;
        }

        fileChooser = await fileChooserPromise;
        await this.logDouyinCoverUploadClick({
          phase: "locator-upload-text-after-second-click",
          ratio,
          point,
          fileChooserOpened: Boolean(fileChooser)
        });
      }

      if (fileChooser) {
        await fileChooser.setFiles(filePath);
        await this.logDouyinCoverUploadClick({
          phase: "locator-upload-text-file-set",
          ratio,
          point,
          filePath
        });
        return true;
      }
    }

    return false;
  }

  private getDouyinCoverUploadFixedPoints(page: Page) {
    const viewportGetter = (page as unknown as { viewportSize?: () => { width: number; height: number } | null }).viewportSize;
    const viewport = typeof viewportGetter === "function" ? viewportGetter.call(page) : null;
    const width = viewport?.width ?? 1920;
    const height = viewport?.height ?? 1280;

    return [
      { x: width * 0.69, y: height * 0.79, source: "fixed-upload-button-center" },
      { x: width * 0.675, y: height * 0.79, source: "fixed-upload-button-left-center" },
      { x: width * 0.705, y: height * 0.79, source: "fixed-upload-button-right-center" },
      { x: width * 0.69, y: height * 0.76, source: "fixed-upload-button-upper-center" }
    ];
  }

  private async clickDouyinUploadCoverButton(page: Page, ratio: "4:3" | "3:4") {
    const result = await page.evaluate<
      { clicked: boolean; point?: { x: number; y: number }; hitText?: string; hitTagName?: string; targetText?: string } | boolean,
      "4:3" | "3:4"
    >((targetRatio) => {
      const marker = "douyin-cover-upload-button-click";
      void marker;
      const queryAll = (root: ParentNode, selector: string) => {
        try {
          return Array.from(root.querySelectorAll<HTMLElement>(selector));
        } catch {
          return [];
        }
      };
      const isVisible = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      };
      const visibleButtons = queryAll(document, "button, [role='button'], body *")
        .filter(isVisible)
        .map((element) => ({ element, text: (element.textContent || "").trim(), rect: element.getBoundingClientRect() }))
        .filter(({ text, rect }) => text.includes("上传封面") && rect.width >= 60 && rect.height >= 40)
        .sort((a, b) => {
          if (targetRatio === "3:4") {
            return b.rect.right - a.rect.right || b.rect.bottom - a.rect.bottom;
          }
          return b.rect.bottom - a.rect.bottom || b.rect.right - a.rect.right;
        });
      const target = visibleButtons[0]?.element;
      if (!target) {
        return { clicked: false };
      }

      target.scrollIntoView({ block: "center", inline: "center" });
      const rect = target.getBoundingClientRect();
      const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
      const targets = [hit, target, target.closest<HTMLElement>("button, [role='button'], label, div")].filter(Boolean) as HTMLElement[];
      const eventInit = { bubbles: true, cancelable: true, composed: true, clientX: point.x, clientY: point.y };
      for (const element of Array.from(new Set(targets))) {
        element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
        element.dispatchEvent(new MouseEvent("mousedown", eventInit));
        element.dispatchEvent(new PointerEvent("pointerup", eventInit));
        element.dispatchEvent(new MouseEvent("mouseup", eventInit));
        element.dispatchEvent(new MouseEvent("click", eventInit));
        element.click();
      }
      return {
        clicked: true,
        point,
        hitText: (hit?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
        hitTagName: hit?.tagName,
        targetText: (target.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120)
      };
    }, ratio).catch(() => false);

    const normalized = typeof result === "boolean" ? { clicked: result } : result;
    await this.logDouyinCoverUploadClick({
      phase: "dom-upload-button-click",
      ratio,
      ...normalized
    });
    return normalized.clicked;
  }

  private async activateDouyinVerticalCover(page: Page) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.clickDouyinCoverTab(page, "设置竖封面");
      await page.waitForTimeout(500);
      if (await this.isDouyinVerticalCoverActive(page)) {
        return true;
      }
    }

    return false;
  }

  private async clickDouyinCoverTab(page: Page, label: "设置竖封面" | "设置横封面") {
    const clicked = await page.evaluate<boolean, "设置竖封面" | "设置横封面">((targetLabel) => {
      const marker = "douyin-cover-tab-click";
      void marker;
      const candidates = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], body *"))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0" &&
            (element.textContent || "").trim() === targetLabel
          );
        })
        .sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          return aRect.width * aRect.height - bRect.width * bRect.height;
        });
      const target = candidates[0]?.closest<HTMLElement>("button, [role='button']") || candidates[0];
      if (!target) {
        return false;
      }
      target.scrollIntoView({ block: "center", inline: "center" });
      const rect = target.getBoundingClientRect();
      const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
      const eventInit = { bubbles: true, cancelable: true, composed: true, clientX: point.x, clientY: point.y };
      for (const element of Array.from(new Set([hit, target].filter(Boolean) as HTMLElement[]))) {
        element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
        element.dispatchEvent(new MouseEvent("mousedown", eventInit));
        element.dispatchEvent(new PointerEvent("pointerup", eventInit));
        element.dispatchEvent(new MouseEvent("mouseup", eventInit));
        element.dispatchEvent(new MouseEvent("click", eventInit));
        element.click();
      }
      return true;
    }, label).catch(() => false);

    if (clicked) {
      return true;
    }

    return this.tryClickByText(page, [label]);
  }

  private async isDouyinVerticalCoverActive(page: Page) {
    return page.evaluate<boolean>(() => {
      const marker = "douyin-vertical-cover-active";
      void marker;
      const visible = Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        });
      const bodyText = document.body?.innerText || "";
      if (bodyText.includes("竖封面预览") || bodyText.includes("竖封面预览（3:4）") || bodyText.includes("竖封面预览 (3:4)")) {
        return true;
      }

      const tab = visible
        .filter((element) => (element.textContent || "").trim() === "设置竖封面")
        .sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          return aRect.width * aRect.height - bRect.width * bRect.height;
        })[0];
      if (!tab) {
        return false;
      }

      const target = tab.closest<HTMLElement>("button, [role='tab'], [role='button'], div") || tab;
      const className = typeof target.className === "string" ? target.className : "";
      const style = window.getComputedStyle(target);
      return (
        target.getAttribute("aria-selected") === "true" ||
        target.getAttribute("aria-pressed") === "true" ||
        /active|selected|current|checked/i.test(className) ||
        style.color.includes("255") ||
        style.backgroundColor === "rgb(255, 255, 255)"
      );
    }).catch(() => false);
  }

  private async clickDouyinCoverDone(page: Page) {
    const clicked = await page.evaluate<boolean>(() => {
      const marker = "douyin-cover-done-click";
      void marker;
      const candidates = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], body *"))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0" &&
            (element.textContent || "").trim() === "完成"
          );
        })
        .sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          return bRect.bottom - aRect.bottom || bRect.right - aRect.right;
        });
      const target = candidates[0]?.closest<HTMLElement>("button, [role='button']") || candidates[0];
      if (!target) {
        return false;
      }

      target.scrollIntoView({ block: "center", inline: "center" });
      const rect = target.getBoundingClientRect();
      const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
      const eventInit = { bubbles: true, cancelable: true, composed: true, clientX: point.x, clientY: point.y };
      for (const element of Array.from(new Set([hit, target].filter(Boolean) as HTMLElement[]))) {
        element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
        element.dispatchEvent(new MouseEvent("mousedown", eventInit));
        element.dispatchEvent(new PointerEvent("pointerup", eventInit));
        element.dispatchEvent(new MouseEvent("mouseup", eventInit));
        element.dispatchEvent(new MouseEvent("click", eventInit));
        element.click();
      }
      return true;
    }).catch(() => false);

    if (clicked) {
      await page.waitForTimeout(500);
      return true;
    }

    return this.tryClickByExactText(page, ["完成", "确定"], 3_000);
  }

  private async confirmDouyinCoverAndWaitEffectPassed(page: Page) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (!(await this.clickDouyinCoverDone(page))) {
        await page.waitForTimeout(500);
        continue;
      }

      if (await this.waitForDouyinCoverEffectPassed(page)) {
        return true;
      }

      await this.logDouyinCoverUploadClick({
        phase: "cover-effect-not-passed-after-done",
        attempt
      });
    }

    return false;
  }

  private async waitForDouyinCoverEffectPassed(page: Page, timeout = 20_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const state = await page.evaluate<{
        passed: boolean;
        failed: boolean;
        text: string;
      }>(() => {
        const marker = "douyin-cover-effect-pass-state";
        void marker;
        const text = document.body?.innerText || "";
        const passed = text.includes("封面效果检测通过");
        const failed = [
          "封面不佳",
          "封面存在",
          "封面效果检测未通过",
          "会导致作品流量减少"
        ].some((item) => text.includes(item));

        return {
          passed,
          failed,
          text: text.replace(/\s+/g, " ").trim().slice(0, 500)
        };
      }).catch(() => ({ passed: false, failed: false, text: "" }));

      if (state.passed) {
        return true;
      }
      if (state.failed) {
        await this.logDouyinCoverUploadClick({
          phase: "cover-effect-check-failed",
          text: state.text
        });
        return false;
      }

      await page.waitForTimeout(500);
    }

    return false;
  }
}
