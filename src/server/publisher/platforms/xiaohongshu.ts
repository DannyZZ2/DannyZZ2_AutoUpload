import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { dataDir } from "../../config";
import type { PublishContext } from "../adapter";
import { BaseWebAdapter } from "../baseWebAdapter";
import { formatTags } from "../format";

type RectSnapshot = {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

type XhsClickCandidate = {
  text: string;
  tagName: string;
  rect: RectSnapshot;
  backgroundImage?: string;
  disabled?: boolean;
  pointerEvents?: string;
  opacity?: string;
  position?: string;
};

type XhsClickResult = {
  clicked: boolean;
  phase?: string;
  reason?: string;
  point?: { x: number; y: number };
  targetText?: string;
  targetTagName?: string;
  targetClassName?: string;
  targetRect?: RectSnapshot;
  hitText?: string;
  hitTagName?: string;
  hitClassName?: string;
  hitRect?: RectSnapshot;
  candidates?: XhsClickCandidate[];
};

type XhsRatioDropdownResult = XhsClickResult & {
  alreadySelected?: boolean;
};

export class XiaohongshuAdapter extends BaseWebAdapter {
  platform = "xiaohongshu" as const;

  protected profile = {
    videoInputs: [
      'input[type="file"][accept*="video"]',
      'input[type="file"]'
    ],
    cover34Inputs: [
      'input[type="file"][accept*="image"]',
      'input[type="file"] >> nth=1'
    ],
    titleInputs: [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]'
    ],
    descriptionInputs: [
      'textarea[placeholder*="正文"]',
      'textarea[placeholder*="描述"]',
      'textarea[placeholder*="说点什么"]',
      '[contenteditable="true"]'
    ],
    tagInputs: [
      'input[placeholder*="话题"]',
      'input[placeholder*="标签"]',
      '[contenteditable="true"]'
    ],
    submitImmediateTexts: ["发布"]
  };

  async setTitleAndTags({ task, page, step }: PublishContext) {
    await step("填写小红书标题和标签");
    await this.fillFirst(page, this.profile.titleInputs, task.title, "未找到小红书标题输入框");

    const tagText = formatTags(task.tags);
    if (!tagText) {
      return;
    }

    const descriptionFilled = await this.tryFillFirst(page, this.profile.descriptionInputs, tagText);
    if (!descriptionFilled) {
      await this.tryFillTags(page, task.tags);
    }
  }

  async setCover({ task, page, step }: PublishContext) {
    await step("打开小红书封面编辑页");
    if (!(await this.openXhsCoverEditor(page))) {
      throw new Error("未能打开小红书封面编辑页");
    }

    await step("选择小红书 3:4 封面比例");
    if (!(await this.selectXhsCoverRatio34(page))) {
      throw new Error("未能选择小红书封面比例：3:4");
    }

    await step("上传小红书 3:4 封面");
    if (!(await this.uploadXhsCoverImage(page, task.cover34Path))) {
      throw new Error("未能上传小红书 3:4 封面");
    }

    if (!(await this.waitForXhsCoverUploadSettled(page))) {
      throw new Error("等待小红书封面上传完成超时");
    }

    await step("确认小红书封面");
    if (!(await this.confirmXhsCoverEditor(page))) {
      throw new Error("小红书封面上传后未能点击确定");
    }

    await page.waitForTimeout(5_000);

    await step("等待小红书封面效果评估通过");
    if (!(await this.waitForXhsCoverEffectPassed(page))) {
      throw new Error("小红书封面上传后未检测到“封面效果评估通过”");
    }
  }

  async setContentDeclaration(_context: PublishContext) {
    // 小红书当前不处理内容声明，避免基础 adapter 执行通用声明流程。
  }

  async submitPublish({ page, step }: PublishContext) {
    await step("提交小红书立即发布");
    const result = await this.clickXhsBottomPublishButton(page);
    await this.logXhsCoverClick({
      phase: "bottom-publish-click",
      ...result
    });

    if (!result.clicked) {
      throw new Error(`未找到小红书底部发布按钮${result.reason ? `：${result.reason}` : ""}`);
    }

    await this.waitForPublishSubmitted(page);
  }

  private async openXhsCoverEditor(page: Page) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const clickResult = await this.clickXhsCoverPreview(page);
      await this.logXhsCoverClick({
        phase: "cover-preview-click",
        attempt: attempt + 1,
        ...clickResult
      });

      if (clickResult.clicked) {
        await page.waitForTimeout(800);
        const editorVisible = await this.isXhsCoverEditorVisible(page);
        await this.logXhsCoverClick({
          phase: "cover-editor-visible-state",
          attempt: attempt + 1,
          visible: editorVisible
        });

        if (editorVisible) {
          return true;
        }
      }

      await page.waitForTimeout(500);
    }

    return false;
  }

  private async clickXhsCoverPreview(page: Page) {
    const result = await page.evaluate<XhsClickResult | boolean>(() => {
      const marker = "xhs-cover-preview-click";
      void marker;
      const helper = {
        textOf(element: HTMLElement) {
          return (element.textContent || "").replace(/\s+/g, " ").trim();
        },
        toRect(element: HTMLElement) {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom
          };
        },
        classNameOf(element: HTMLElement) {
          return typeof element.className === "string" ? element.className.slice(0, 160) : undefined;
        },
        isVisible(element: HTMLElement) {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.right > 0 &&
            rect.bottom > 0 &&
            rect.left < window.innerWidth &&
            rect.top < window.innerHeight &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0"
          );
        },
        markClick(point: { x: number; y: number }, label: string) {
          const markerElement = document.createElement("div");
          markerElement.dataset.publisherClickMarker = label;
          markerElement.style.cssText = [
            "position:fixed",
            `left:${point.x - 8}px`,
            `top:${point.y - 8}px`,
            "width:16px",
            "height:16px",
            "border:3px solid #ff2442",
            "border-radius:50%",
            "background:rgba(255,36,66,.2)",
            "z-index:2147483647",
            "pointer-events:none"
          ].join(";");
          const labelElement = document.createElement("div");
          labelElement.textContent = label;
          labelElement.style.cssText = [
            "position:fixed",
            `left:${point.x + 12}px`,
            `top:${point.y - 12}px`,
            "padding:2px 6px",
            "border-radius:4px",
            "background:#ff2442",
            "color:#fff",
            "font:12px/1.4 sans-serif",
            "z-index:2147483647",
            "pointer-events:none"
          ].join(";");
          void markerElement;
          void labelElement;
        },
        click(element: HTMLElement): XhsClickResult {
          element.scrollIntoView({ block: "center", inline: "center" });
          const rect = element.getBoundingClientRect();
          const fallbackPoint = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          const modifyTargets = Array.from(element.querySelectorAll<HTMLElement>("button, [role='button'], a, span, div"))
            .filter((candidate) => helper.textOf(candidate).includes("修改封面"));
          const primary = modifyTargets[0] || element;
          const primaryRect = primary.getBoundingClientRect();
          const point =
            primaryRect.width > 0 && primaryRect.height > 0
              ? { x: primaryRect.left + primaryRect.width / 2, y: primaryRect.top + primaryRect.height / 2 }
              : fallbackPoint;
          const hit = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
          const targets = Array.from(new Set([
            primary,
            ...modifyTargets,
            hit,
            element,
            element.closest<HTMLElement>("[role='button'], button, label, div")
          ].filter(Boolean) as HTMLElement[]));
          const eventInit = { bubbles: true, cancelable: true, composed: true, clientX: point.x, clientY: point.y };
          helper.markClick(point, "xhs-cover-preview");
          for (const target of targets) {
            target.dispatchEvent(new PointerEvent("pointerover", eventInit));
            target.dispatchEvent(new MouseEvent("mouseover", eventInit));
            target.dispatchEvent(new PointerEvent("pointerenter", eventInit));
            target.dispatchEvent(new MouseEvent("mouseenter", eventInit));
            target.dispatchEvent(new PointerEvent("pointermove", eventInit));
            target.dispatchEvent(new MouseEvent("mousemove", eventInit));
            target.dispatchEvent(new PointerEvent("pointerdown", eventInit));
            target.dispatchEvent(new MouseEvent("mousedown", eventInit));
            target.dispatchEvent(new PointerEvent("pointerup", eventInit));
            target.dispatchEvent(new MouseEvent("mouseup", eventInit));
            target.dispatchEvent(new MouseEvent("click", eventInit));
            target.click();
          }
          return {
            clicked: true,
            point,
            targetText: helper.textOf(primary).slice(0, 120) || helper.textOf(element).slice(0, 120),
            targetTagName: primary.tagName,
            targetClassName: helper.classNameOf(primary),
            targetRect: helper.toRect(primary),
            hitText: (hit ? helper.textOf(hit) : "").slice(0, 120),
            hitTagName: hit?.tagName,
            hitClassName: hit ? helper.classNameOf(hit) : undefined,
            hitRect: hit ? helper.toRect(hit) : undefined,
            candidates: [
              {
                text: modifyTargets.length > 0 ? `modify-targets:${modifyTargets.length}` : "modify-targets:0",
                tagName: primary.tagName,
                rect: helper.toRect(primary)
              }
            ]
          };
        }
      };

      const visible = Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((element) => helper.isVisible(element));
      const labels = visible
        .filter((element) => helper.textOf(element) === "设置封面")
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
      const label = labels[0];
      if (!label) {
        return {
          clicked: false,
          reason: "setting-cover-label-not-found"
        };
      }

      const candidates = visible
        .map((element) => ({
          element,
          rect: element.getBoundingClientRect(),
          text: helper.textOf(element),
          tagName: element.tagName,
          backgroundImage: window.getComputedStyle(element).backgroundImage
        }))
        .filter(({ rect, text, tagName, backgroundImage }) => {
          const isMedia = ["IMG", "VIDEO", "CANVAS"].includes(tagName) || backgroundImage !== "none";
          return (
            isMedia &&
            rect.width >= 120 &&
            rect.height >= 90 &&
            rect.width <= 700 &&
            rect.height <= 520 &&
            rect.top > label.rect.top + 40 &&
            rect.top < label.rect.top + 520 &&
            rect.left >= label.rect.left - 20 &&
            rect.left < window.innerWidth * 0.55 &&
            !text.includes("智能推荐封面")
          );
        })
        .sort((a, b) => a.rect.left - b.rect.left || a.rect.top - b.rect.top || (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));

      const target = candidates[0]?.element;
      if (!target) {
        return {
          clicked: false,
          reason: "cover-preview-candidate-not-found",
          candidates: candidates.slice(0, 8).map((candidate) => ({
            text: candidate.text.slice(0, 120),
            tagName: candidate.tagName,
            rect: {
              left: candidate.rect.left,
              top: candidate.rect.top,
              width: candidate.rect.width,
              height: candidate.rect.height,
              right: candidate.rect.right,
              bottom: candidate.rect.bottom
            },
            backgroundImage: candidate.backgroundImage === "none" ? undefined : candidate.backgroundImage.slice(0, 80)
          }))
        };
      }

      const clickResult = helper.click(target);
      return {
        ...clickResult,
        candidates: candidates.slice(0, 8).map((candidate) => ({
          text: candidate.text.slice(0, 120),
          tagName: candidate.tagName,
          rect: {
            left: candidate.rect.left,
            top: candidate.rect.top,
            width: candidate.rect.width,
            height: candidate.rect.height,
            right: candidate.rect.right,
            bottom: candidate.rect.bottom
          },
          backgroundImage: candidate.backgroundImage === "none" ? undefined : candidate.backgroundImage.slice(0, 80)
        }))
      };
    }).catch((error): XhsClickResult => ({
      clicked: false,
      reason: error instanceof Error ? error.message : String(error)
    }));

    return this.normalizeXhsClickResult(result, "cover-preview-click");
  }

  private async isXhsCoverEditorVisible(page: Page) {
    return page.evaluate<boolean>(() => {
      const marker = "xhs-cover-editor-visible";
      void marker;
      const text = document.body?.innerText || "";
      return text.includes("封面比例") && text.includes("上传图片") && text.includes("确定");
    }).catch(() => false);
  }

  private async selectXhsCoverRatio34(page: Page) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const dropdown = await this.clickXhsCoverRatioDropdown(page);
      await this.logXhsCoverClick({
        phase: "cover-ratio-dropdown-click",
        attempt: attempt + 1,
        ...dropdown
      });
      if (dropdown.alreadySelected) {
        return true;
      }
      if (!dropdown.clicked) {
        await page.waitForTimeout(500);
        continue;
      }

      if (dropdown.point) {
        await page.mouse.move(dropdown.point.x, dropdown.point.y);
        await this.logXhsCoverClick({
          phase: "cover-ratio-dropdown-hover",
          attempt: attempt + 1,
          point: dropdown.point
        });
      }

      await page.waitForTimeout(700);
      const optionClick = await this.clickXhsCoverRatioOption34(page);
      await this.logXhsCoverClick({
        phase: "cover-ratio-option-click",
        attempt: attempt + 1,
        ...optionClick
      });
      if (optionClick.clicked) {
        await page.waitForTimeout(500);
        return true;
      }
    }

    return false;
  }

  private async clickXhsCoverRatioDropdown(page: Page) {
    const result = await page.evaluate<XhsRatioDropdownResult | boolean>(() => {
      const marker = "xhs-cover-ratio-dropdown-click";
      void marker;
      const helper = {
        textOf(element: HTMLElement) {
          return (element.textContent || "").replace(/\s+/g, " ").trim();
        },
        toRect(element: HTMLElement) {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom
          };
        },
        isVisible(element: HTMLElement) {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        },
        markClick(point: { x: number; y: number }, label: string) {
          const markerElement = document.createElement("div");
          markerElement.dataset.publisherClickMarker = label;
          markerElement.style.cssText = [
            "position:fixed",
            `left:${point.x - 8}px`,
            `top:${point.y - 8}px`,
            "width:16px",
            "height:16px",
            "border:3px solid #ff2442",
            "border-radius:50%",
            "background:rgba(255,36,66,.2)",
            "z-index:2147483647",
            "pointer-events:none"
          ].join(";");
          const labelElement = document.createElement("div");
          labelElement.textContent = label;
          labelElement.style.cssText = [
            "position:fixed",
            `left:${point.x + 12}px`,
            `top:${point.y - 12}px`,
            "padding:2px 6px",
            "border-radius:4px",
            "background:#ff2442",
            "color:#fff",
            "font:12px/1.4 sans-serif",
            "z-index:2147483647",
            "pointer-events:none"
          ].join(";");
          void markerElement;
          void labelElement;
        },
        click(element: HTMLElement): XhsClickResult {
          const rect = element.getBoundingClientRect();
          const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          const hit = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
          const eventInit = { bubbles: true, cancelable: true, composed: true, clientX: point.x, clientY: point.y };
          helper.markClick(point, "xhs-cover-ratio");
          for (const target of Array.from(new Set([hit, element, element.closest<HTMLElement>("[role='button'], button, [role='combobox'], div")].filter(Boolean) as HTMLElement[]))) {
            target.dispatchEvent(new PointerEvent("pointerdown", eventInit));
            target.dispatchEvent(new MouseEvent("mousedown", eventInit));
            target.dispatchEvent(new PointerEvent("pointerup", eventInit));
            target.dispatchEvent(new MouseEvent("mouseup", eventInit));
            target.dispatchEvent(new MouseEvent("click", eventInit));
            target.click();
          }
          return {
            clicked: true,
            point,
            targetText: helper.textOf(element).slice(0, 120),
            targetTagName: element.tagName,
            targetRect: helper.toRect(element),
            hitText: (hit ? helper.textOf(hit) : "").slice(0, 120),
            hitTagName: hit?.tagName,
            hitRect: hit ? helper.toRect(hit) : undefined
          };
        }
      };

      const visible = Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((element) => helper.isVisible(element));
      const labels = visible
        .filter((element) => helper.textOf(element).includes("封面比例"))
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
      const label = labels[0];

      const candidates = visible
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: helper.textOf(element) }))
        .filter(({ rect, text }) => {
          const nearRatioLabel = label
            ? (
                rect.left > label.rect.left &&
                rect.left < label.rect.right + 260 &&
                rect.top > label.rect.top - 50 &&
                rect.top < label.rect.bottom + 90
              )
            : (
                rect.top > 80 &&
                rect.top < window.innerHeight * 0.35 &&
                rect.left > window.innerWidth * 0.25 &&
                rect.left < window.innerWidth * 0.55
              );
          return (
            /^(3:4|4:3)$/.test(text) &&
            nearRatioLabel &&
            rect.width <= 180 &&
            rect.height <= 90
          );
        })
        .sort((a, b) => {
          if (a.text === "4:3" && b.text !== "4:3") {
            return -1;
          }
          if (b.text === "4:3" && a.text !== "4:3") {
            return 1;
          }
          return a.rect.top - b.rect.top || a.rect.left - b.rect.left;
        });
      const candidate = candidates[0];
      if (!candidate) {
        return {
          clicked: false,
          reason: label ? "cover-ratio-dropdown-candidate-not-found" : "cover-ratio-label-and-dropdown-not-found",
          candidates: visible
            .map((element) => ({ element, rect: element.getBoundingClientRect(), text: helper.textOf(element) }))
            .filter(({ text, rect }) => text.includes("4:3") || text.includes("3:4") || text.includes("封面比例") || (rect.top > 80 && rect.top < window.innerHeight * 0.4))
            .slice(0, 16)
            .map((item) => ({
            text: item.text.slice(0, 120),
            tagName: item.element.tagName,
            rect: {
              left: item.rect.left,
              top: item.rect.top,
              width: item.rect.width,
              height: item.rect.height,
              right: item.rect.right,
              bottom: item.rect.bottom
            }
          }))
        };
      }
      if (candidate.text === "3:4") {
        return {
          clicked: true,
          alreadySelected: true,
          targetText: candidate.text,
          targetTagName: candidate.element.tagName,
          targetRect: helper.toRect(candidate.element)
        };
      }

      return helper.click(candidate.element);
    }).catch((error): XhsRatioDropdownResult => ({
      clicked: false,
      reason: error instanceof Error ? error.message : String(error)
    }));

    return this.normalizeXhsRatioDropdownResult(result, "cover-ratio-dropdown-click");
  }

  private async clickXhsCoverRatioOption34(page: Page) {
    const result = await page.evaluate<XhsClickResult | boolean>(() => {
      const marker = "xhs-cover-ratio-option-click";
      void marker;
      const helper = {
        textOf(element: HTMLElement) {
          return (element.textContent || "").replace(/\s+/g, " ").trim();
        },
        toRect(element: HTMLElement) {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom
          };
        },
        isVisible(element: HTMLElement) {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        },
        markClick(point: { x: number; y: number }, label: string) {
          const markerElement = document.createElement("div");
          markerElement.dataset.publisherClickMarker = label;
          markerElement.style.cssText = [
            "position:fixed",
            `left:${point.x - 8}px`,
            `top:${point.y - 8}px`,
            "width:16px",
            "height:16px",
            "border:3px solid #ff2442",
            "border-radius:50%",
            "background:rgba(255,36,66,.2)",
            "z-index:2147483647",
            "pointer-events:none"
          ].join(";");
          const labelElement = document.createElement("div");
          labelElement.textContent = label;
          labelElement.style.cssText = [
            "position:fixed",
            `left:${point.x + 12}px`,
            `top:${point.y - 12}px`,
            "padding:2px 6px",
            "border-radius:4px",
            "background:#ff2442",
            "color:#fff",
            "font:12px/1.4 sans-serif",
            "z-index:2147483647",
            "pointer-events:none"
          ].join(";");
          void markerElement;
          void labelElement;
        }
      };
      const candidates = Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((element) => helper.isVisible(element))
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: helper.textOf(element) }))
        .filter(({ text, rect }) => text === "3:4" && rect.width <= 200 && rect.height <= 100)
        .sort((a, b) => b.rect.top - a.rect.top || a.rect.left - b.rect.left);
      const target = candidates[0]?.element;
      if (!target) {
        return { clicked: false, reason: "cover-ratio-option-34-not-found" };
      }

      const rect = target.getBoundingClientRect();
      const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
      const eventInit = { bubbles: true, cancelable: true, composed: true, clientX: point.x, clientY: point.y };
      helper.markClick(point, "xhs-cover-ratio-3:4");
      for (const element of Array.from(new Set([hit, target, target.closest<HTMLElement>("[role='option'], [role='menuitem'], button, div")].filter(Boolean) as HTMLElement[]))) {
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
        targetText: helper.textOf(target).slice(0, 120),
        targetTagName: target.tagName,
        targetRect: helper.toRect(target),
        hitText: (hit ? helper.textOf(hit) : "").slice(0, 120),
        hitTagName: hit?.tagName,
        hitRect: hit ? helper.toRect(hit) : undefined
      };
    }).catch((error): XhsClickResult => ({
      clicked: false,
      reason: error instanceof Error ? error.message : String(error)
    }));

    const clickResult = this.normalizeXhsClickResult(result, "cover-ratio-option-click");
    if (clickResult.clicked) {
      return clickResult;
    }

    const fallbackClicked = await this.tryClickByExactText(page, ["3:4"], 2_000);
    return {
      clicked: fallbackClicked,
      phase: "cover-ratio-option-click",
      reason: fallbackClicked ? "fallback-text-click" : clickResult.reason
    };
  }

  private async uploadXhsCoverImage(page: Page, filePath: string) {
    const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 5_000 }).catch(() => undefined);
    const clickResult = await this.clickXhsCoverUploadImage(page);
    await this.logXhsCoverClick({
      phase: "cover-upload-image-click",
      ...clickResult
    });
    const fileChooser = await fileChooserPromise;

    if (clickResult.clicked && fileChooser) {
      await fileChooser.setFiles(filePath);
      await page.waitForTimeout(1_000);
      await this.logXhsCoverClick({
        phase: "cover-upload-filechooser-set",
        filePath,
        fileChooser: true
      });
      return true;
    }

    const fallbackUploaded = await this.trySetInputFiles(page, this.profile.cover34Inputs, filePath);
    await this.logXhsCoverClick({
      phase: "cover-upload-input-fallback",
      filePath,
      fileChooser: Boolean(fileChooser),
      clicked: clickResult.clicked,
      fallbackUploaded
    });
    return fallbackUploaded;
  }

  private async clickXhsCoverUploadImage(page: Page) {
    const result = await page.evaluate<XhsClickResult | boolean>(() => {
      const marker = "xhs-cover-upload-image-click";
      void marker;
      const helper = {
        textOf(element: HTMLElement) {
          return (element.textContent || "").replace(/\s+/g, " ").trim();
        },
        compactTextOf(element: HTMLElement) {
          return (element.textContent || "").replace(/\s+/g, "").replace(/[ⓘ]/g, "").trim();
        },
        toRect(element: HTMLElement) {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom
          };
        },
        classNameOf(element: HTMLElement) {
          return typeof element.className === "string" ? element.className.slice(0, 160) : undefined;
        },
        isVisible(element: HTMLElement) {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.right > 0 &&
            rect.bottom > 0 &&
            rect.left < window.innerWidth &&
            rect.top < window.innerHeight &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0"
          );
        },
        markClick(point: { x: number; y: number }, label: string) {
          const markerElement = document.createElement("div");
          markerElement.dataset.publisherClickMarker = label;
          markerElement.style.cssText = [
            "position:fixed",
            `left:${point.x - 8}px`,
            `top:${point.y - 8}px`,
            "width:16px",
            "height:16px",
            "border:3px solid #ff2442",
            "border-radius:50%",
            "background:rgba(255,36,66,.2)",
            "z-index:2147483647",
            "pointer-events:none"
          ].join(";");
          const labelElement = document.createElement("div");
          labelElement.textContent = label;
          labelElement.style.cssText = [
            "position:fixed",
            `left:${point.x + 12}px`,
            `top:${point.y - 12}px`,
            "padding:2px 6px",
            "border-radius:4px",
            "background:#ff2442",
            "color:#fff",
            "font:12px/1.4 sans-serif",
            "z-index:2147483647",
            "pointer-events:none"
          ].join(";");
          void markerElement;
          void labelElement;
        }
      };
      const allUploadTextElements = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], label, a, span, div"))
        .filter((element) => helper.isVisible(element))
        .map((element) => {
          const explicitControl = element.closest<HTMLElement>("button, [role='button'], label");
          const explicitRect = explicitControl?.getBoundingClientRect();
          const explicitText = explicitControl ? helper.compactTextOf(explicitControl) : "";
          const useExplicitControl =
            explicitControl &&
            explicitRect &&
            explicitRect.width >= 60 &&
            explicitRect.width <= 280 &&
            explicitRect.height >= 26 &&
            explicitRect.height <= 110 &&
            explicitText.includes("上传图片") &&
            explicitText.length <= 14;
          const target = useExplicitControl ? explicitControl : element;
          return {
            element: target,
            source: element,
            rect: target.getBoundingClientRect(),
            sourceRect: element.getBoundingClientRect(),
            text: helper.textOf(target) || helper.textOf(element),
            compactText: helper.compactTextOf(target) || helper.compactTextOf(element)
          };
        })
        .filter(({ compactText }) => compactText.includes("上传图片"));

      const candidates = allUploadTextElements
        .filter(({ rect, compactText }) => (
          compactText.length <= 14 &&
          rect.width >= 70 &&
          rect.width <= 280 &&
          rect.height >= 28 &&
          rect.height <= 110 &&
          rect.top >= 120 &&
          rect.width < window.innerWidth * 0.35 &&
          rect.height < window.innerHeight * 0.2
        ))
        .sort((a, b) => {
          const score = (item: typeof a) => {
            const roleButton = item.element.tagName === "BUTTON" || item.element.tagName === "LABEL" || item.element.getAttribute("role") === "button";
            const startsWithPlus = item.compactText.startsWith("+上传图片");
            const lowerRight = item.rect.left > window.innerWidth * 0.45;
            return (
              (startsWithPlus ? 50 : 0) +
              (roleButton ? 30 : 0) +
              (lowerRight ? 20 : 0) +
              item.rect.bottom / 1000 +
              item.rect.right / 10_000
            );
          };
          return score(b) - score(a);
        });
      const target = candidates[0]?.element;
      if (!target) {
        return {
          clicked: false,
          reason: "cover-upload-image-button-not-found",
          candidates: allUploadTextElements.slice(0, 12).map((item) => ({
            text: item.text.slice(0, 120),
            tagName: item.element.tagName,
            rect: {
              left: item.rect.left,
              top: item.rect.top,
              width: item.rect.width,
              height: item.rect.height,
              right: item.rect.right,
              bottom: item.rect.bottom
            }
          }))
        };
      }

      target.scrollIntoView({ block: "nearest", inline: "nearest" });
      const rect = target.getBoundingClientRect();
      const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
      helper.markClick(point, "xhs-cover-upload-image");
      return {
        clicked: true,
        point,
        targetText: helper.textOf(target).slice(0, 120),
        targetTagName: target.tagName,
        targetClassName: helper.classNameOf(target),
        targetRect: helper.toRect(target),
        hitText: (hit ? helper.textOf(hit) : "").slice(0, 120),
        hitTagName: hit?.tagName,
        hitClassName: hit ? helper.classNameOf(hit) : undefined,
        hitRect: hit ? helper.toRect(hit) : undefined,
        candidates: candidates.slice(0, 8).map((item) => ({
          text: item.text.slice(0, 120),
          tagName: item.element.tagName,
          rect: {
            left: item.rect.left,
            top: item.rect.top,
            width: item.rect.width,
            height: item.rect.height,
            right: item.rect.right,
            bottom: item.rect.bottom
          }
        }))
      };
    }).catch((error): XhsClickResult => ({
      clicked: false,
      reason: error instanceof Error ? error.message : String(error)
    }));

    const clickResult = this.normalizeXhsClickResult(result, "cover-upload-image-click");
    if (clickResult.clicked && clickResult.point) {
      await page.mouse.move(Math.round(clickResult.point.x), Math.round(clickResult.point.y));
      await page.mouse.click(Math.round(clickResult.point.x), Math.round(clickResult.point.y));
    }

    return clickResult;
  }

  private async waitForXhsCoverUploadSettled(page: Page, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const state = await page.evaluate<{
        ready: boolean;
        failed: boolean;
        text: string;
      }>(() => {
        const marker = "xhs-cover-upload-settled";
        void marker;
        const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
        const uploading = ["上传中", "正在上传", "图片上传中", "处理中"].some((item) => text.includes(item));
        const confirm = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], body *"))
          .map((element) => ({ element, text: (element.textContent || "").replace(/\s+/g, " ").trim(), rect: element.getBoundingClientRect() }))
          .filter(({ text, rect }) => text === "确定" && rect.width > 0 && rect.height > 0)
          .sort((a, b) => b.rect.bottom - a.rect.bottom || b.rect.right - a.rect.right)[0]?.element;
        const disabled = Boolean(confirm?.closest("[disabled], [aria-disabled='true'], .disabled, [class*='disabled']"));
        return {
          ready: Boolean(confirm) && !disabled && !uploading,
          failed: false,
          text: text.slice(0, 300)
        };
      }).catch(() => ({ ready: false, failed: false, text: "" }));

      if (state.failed) {
        await this.logXhsCoverClick({
          phase: "cover-upload-settled-state",
          ...state
        });
        throw new Error(`小红书封面上传失败：${state.text}`);
      }
      if (state.ready) {
        await this.logXhsCoverClick({
          phase: "cover-upload-settled-state",
          ...state
        });
        return true;
      }

      await page.waitForTimeout(500);
    }

    return false;
  }

  private async confirmXhsCoverEditor(page: Page) {
    const result = await page.evaluate<XhsClickResult | boolean>(() => {
      const marker = "xhs-cover-confirm-click";
      void marker;
      const helper = {
        textOf(element: HTMLElement) {
          return (element.textContent || "").replace(/\s+/g, " ").trim();
        },
        toRect(element: HTMLElement) {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom
          };
        },
        isVisible(element: HTMLElement) {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        },
        markClick(point: { x: number; y: number }, label: string) {
          const markerElement = document.createElement("div");
          markerElement.dataset.publisherClickMarker = label;
          markerElement.style.cssText = [
            "position:fixed",
            `left:${point.x - 8}px`,
            `top:${point.y - 8}px`,
            "width:16px",
            "height:16px",
            "border:3px solid #ff2442",
            "border-radius:50%",
            "background:rgba(255,36,66,.2)",
            "z-index:2147483647",
            "pointer-events:none"
          ].join(";");
          const labelElement = document.createElement("div");
          labelElement.textContent = label;
          labelElement.style.cssText = [
            "position:fixed",
            `left:${point.x + 12}px`,
            `top:${point.y - 12}px`,
            "padding:2px 6px",
            "border-radius:4px",
            "background:#ff2442",
            "color:#fff",
            "font:12px/1.4 sans-serif",
            "z-index:2147483647",
            "pointer-events:none"
          ].join(";");
          void markerElement;
          void labelElement;
        }
      };
      const candidates = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], body *"))
        .filter((element) => helper.isVisible(element))
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: helper.textOf(element) }))
        .filter(({ text }) => text === "确定")
        .sort((a, b) => b.rect.bottom - a.rect.bottom || b.rect.right - a.rect.right);
      const target = candidates[0]?.element;
      if (!target) {
        return {
          clicked: false,
          reason: "cover-confirm-button-not-found",
          candidates: candidates.slice(0, 8).map((item) => ({
            text: item.text.slice(0, 120),
            tagName: item.element.tagName,
            rect: {
              left: item.rect.left,
              top: item.rect.top,
              width: item.rect.width,
              height: item.rect.height,
              right: item.rect.right,
              bottom: item.rect.bottom
            }
          }))
        };
      }

      const rect = target.getBoundingClientRect();
      const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
      const eventInit = { bubbles: true, cancelable: true, composed: true, clientX: point.x, clientY: point.y };
      helper.markClick(point, "xhs-cover-confirm");
      for (const element of Array.from(new Set([hit, target, target.closest<HTMLElement>("[role='button'], button, div")].filter(Boolean) as HTMLElement[]))) {
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
        targetText: helper.textOf(target).slice(0, 120),
        targetTagName: target.tagName,
        targetRect: helper.toRect(target),
        hitText: (hit ? helper.textOf(hit) : "").slice(0, 120),
        hitTagName: hit?.tagName,
        hitRect: hit ? helper.toRect(hit) : undefined
      };
    }).catch((error): XhsClickResult => ({
      clicked: false,
      reason: error instanceof Error ? error.message : String(error)
    }));

    const clickResult = this.normalizeXhsClickResult(result, "cover-confirm-click");
    await this.logXhsCoverClick({
      phase: "cover-confirm-click",
      ...clickResult
    });

    if (!clickResult.clicked) {
      return false;
    }

    await page.waitForTimeout(500);
    return true;
  }

  private async waitForXhsCoverEffectPassed(page: Page, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const state = await page.evaluate<{
        passed: boolean;
        failed: boolean;
        text: string;
      }>(() => {
        const marker = "xhs-cover-effect-pass-state";
        void marker;
        const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
        const passed = text.includes("封面效果评估通过");
        const failed = [
          "封面效果评估未通过",
          "封面效果评估不通过",
          "发现封面质量问题",
          "存在封面质量问题"
        ].some((item) => text.includes(item));

        return {
          passed,
          failed,
          text: text.slice(0, 500)
        };
      }).catch(() => ({ passed: false, failed: false, text: "" }));

      if (state.passed) {
        await this.logXhsCoverClick({
          phase: "cover-effect-pass-state",
          ...state
        });
        return true;
      }
      if (state.failed) {
        await this.logXhsCoverClick({
          phase: "cover-effect-pass-state",
          ...state
        });
        throw new Error(`小红书封面效果评估未通过：${state.text}`);
      }

      await page.waitForTimeout(500);
    }

    return false;
  }

  private async clickXhsBottomPublishButton(page: Page) {
    const result = await page.evaluate<XhsClickResult | boolean>(() => {
      const marker = "xhs-bottom-publish-click";
      void marker;
      const helper = {
        textOf(element: HTMLElement) {
          return (element.textContent || "").replace(/\s+/g, " ").trim();
        },
        compactTextOf(element: HTMLElement) {
          return (element.textContent || "").replace(/\s+/g, "").trim();
        },
        toRect(element: HTMLElement) {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom
          };
        },
        classNameOf(element: HTMLElement) {
          return typeof element.className === "string" ? element.className.slice(0, 160) : undefined;
        },
        isVisible(element: HTMLElement) {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.right > 0 &&
            rect.bottom > 0 &&
            rect.left < window.innerWidth &&
            rect.top < window.innerHeight &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0"
          );
        },
        isDisabled(element: HTMLElement) {
          const disabled = element.closest("[disabled], [aria-disabled='true'], .disabled, [class*='disabled']");
          return Boolean(disabled);
        },
        allElements() {
          const roots: Array<Document | ShadowRoot> = [document];
          const elements: HTMLElement[] = [];
          for (let index = 0; index < roots.length; index += 1) {
            for (const element of Array.from(roots[index].querySelectorAll<HTMLElement>("button, [role='button'], a, span, div"))) {
              elements.push(element);
              if (element.shadowRoot) {
                roots.push(element.shadowRoot);
              }
            }
          }
          return elements;
        },
        markClick(point: { x: number; y: number }, label: string) {
          const markerElement = document.createElement("div");
          markerElement.dataset.publisherClickMarker = label;
          markerElement.style.cssText = [
            "position:fixed",
            `left:${point.x - 8}px`,
            `top:${point.y - 8}px`,
            "width:16px",
            "height:16px",
            "border:3px solid #ff2442",
            "border-radius:50%",
            "background:rgba(255,36,66,.2)",
            "z-index:2147483647",
            "pointer-events:none"
          ].join(";");
          const labelElement = document.createElement("div");
          labelElement.textContent = label;
          labelElement.style.cssText = [
            "position:fixed",
            `left:${point.x + 12}px`,
            `top:${point.y - 12}px`,
            "padding:2px 6px",
            "border-radius:4px",
            "background:#ff2442",
            "color:#fff",
            "font:12px/1.4 sans-serif",
            "z-index:2147483647",
            "pointer-events:none"
          ].join(";");
          void markerElement;
          void labelElement;
        }
      };

      const allPublishElements = helper.allElements()
        .filter((element) => helper.isVisible(element))
        .map((element) => {
          const explicitControl = element.closest<HTMLElement>("button, [role='button'], a");
          const explicitText = explicitControl ? helper.compactTextOf(explicitControl) : "";
          const explicitRect = explicitControl?.getBoundingClientRect();
          const useExplicitControl =
            explicitControl &&
            explicitRect &&
            explicitText === "发布" &&
            explicitRect.width >= 90 &&
            explicitRect.width <= 320 &&
            explicitRect.height >= 36 &&
            explicitRect.height <= 100;
          const compactText = helper.compactTextOf(element);
          let target = useExplicitControl ? explicitControl : element;
          if (!useExplicitControl && compactText === "发布") {
            for (const parent of Array.from(element.parentElement ? [element.parentElement, element.parentElement.parentElement, element.parentElement.parentElement?.parentElement] : [])) {
              if (!parent) {
                continue;
              }
              const parentRect = parent.getBoundingClientRect();
              const parentText = helper.compactTextOf(parent);
              if (
                parentText === "发布" &&
                parentRect.width >= 90 &&
                parentRect.width <= 360 &&
                parentRect.height >= 36 &&
                parentRect.height <= 120
              ) {
                target = parent;
                break;
              }
            }
          }
          const rect = target.getBoundingClientRect();
          const hasFixedOrStickyAncestor = (() => {
            let current: HTMLElement | null = target;
            while (current && current !== document.body) {
              const position = window.getComputedStyle(current).position;
              if (position === "fixed" || position === "sticky") {
                return true;
              }
              current = current.parentElement;
            }
            return false;
          })();
          return {
            element: target,
            rect,
            text: helper.textOf(target) || helper.textOf(element),
            compactText: helper.compactTextOf(target) || helper.compactTextOf(element),
            hasFixedOrStickyAncestor,
            disabled: helper.isDisabled(target),
            pointerEvents: window.getComputedStyle(target).pointerEvents,
            opacity: window.getComputedStyle(target).opacity,
            position: window.getComputedStyle(target).position
          };
        })
        .filter(({ compactText }) => compactText === "发布");

      const publishLikeCandidates = allPublishElements
        .filter(({ rect }) => {
          const centerX = rect.left + rect.width / 2;
          return (
            rect.width >= 90 &&
            rect.width <= 360 &&
            rect.height >= 36 &&
            rect.height <= 120 &&
            rect.top >= window.innerHeight - 180 &&
            rect.bottom <= window.innerHeight + 12 &&
            Math.abs(centerX - window.innerWidth / 2) <= window.innerWidth * 0.35
          );
        })
        .sort((a, b) => {
          const score = (item: typeof a) => {
            const style = window.getComputedStyle(item.element);
            const isButton = item.element.tagName === "BUTTON" || item.element.getAttribute("role") === "button";
            const pinkLike = style.backgroundColor.includes("255") || style.backgroundColor.includes("36") || style.color.includes("255");
            const centerX = item.rect.left + item.rect.width / 2;
            const centerDistance = Math.abs(centerX - window.innerWidth / 2);
            const bottomDistance = Math.abs(window.innerHeight - item.rect.bottom);
            return (
              (item.hasFixedOrStickyAncestor ? 100 : 0) +
              (item.disabled ? -80 : 0) +
              (item.pointerEvents === "none" ? -40 : 0) +
              (isButton ? 50 : 0) +
              (pinkLike ? 20 : 0) +
              Math.max(0, 40 - bottomDistance) +
              Math.max(0, 40 - centerDistance / 10) +
              item.rect.width / 1000
            );
          };
          return score(b) - score(a);
        });
      const candidates = publishLikeCandidates.filter((item) => !item.disabled && item.pointerEvents !== "none");
      const target = candidates[0]?.element ?? publishLikeCandidates[0]?.element;
      if (!target) {
        const point = { x: window.innerWidth / 2, y: window.innerHeight - 64 };
        const hit = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
        helper.markClick(point, "xhs-bottom-publish-pixel");
        return {
          clicked: true,
          reason: "fixed-footer-pixel-fallback",
          point,
          targetText: hit ? helper.textOf(hit).slice(0, 120) : "",
          targetTagName: hit?.tagName,
          targetClassName: hit ? helper.classNameOf(hit) : undefined,
          targetRect: hit ? helper.toRect(hit) : undefined,
          candidates: allPublishElements.slice(0, 12).map((item) => ({
            text: item.text.slice(0, 120),
            tagName: item.element.tagName,
            disabled: item.disabled,
            pointerEvents: item.pointerEvents,
            opacity: item.opacity,
            position: item.position,
            rect: {
              left: item.rect.left,
              top: item.rect.top,
              width: item.rect.width,
              height: item.rect.height,
              right: item.rect.right,
              bottom: item.rect.bottom
            }
          }))
        };
      }

      const rect = target.getBoundingClientRect();
      const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
      helper.markClick(point, "xhs-bottom-publish");
      const loggedCandidates = candidates.length > 0 ? candidates : publishLikeCandidates;
      return {
        clicked: true,
        point,
        targetText: helper.textOf(target).slice(0, 120),
        targetTagName: target.tagName,
        targetClassName: helper.classNameOf(target),
        targetRect: helper.toRect(target),
        hitText: (hit ? helper.textOf(hit) : "").slice(0, 120),
        hitTagName: hit?.tagName,
        hitClassName: hit ? helper.classNameOf(hit) : undefined,
        hitRect: hit ? helper.toRect(hit) : undefined,
        candidates: loggedCandidates.slice(0, 8).map((item) => ({
          text: item.text.slice(0, 120),
          tagName: item.element.tagName,
          disabled: item.disabled,
          pointerEvents: item.pointerEvents,
          opacity: item.opacity,
          position: item.position,
          rect: {
            left: item.rect.left,
            top: item.rect.top,
            width: item.rect.width,
            height: item.rect.height,
            right: item.rect.right,
            bottom: item.rect.bottom
          }
        }))
      };
    }).catch((error): XhsClickResult => ({
      clicked: false,
      reason: error instanceof Error ? error.message : String(error)
    }));

    const clickResult = this.normalizeXhsClickResult(result, "bottom-publish-click");
    if (clickResult.clicked && clickResult.point) {
      await page.mouse.move(Math.round(clickResult.point.x), Math.round(clickResult.point.y));
      await page.mouse.click(Math.round(clickResult.point.x), Math.round(clickResult.point.y));
    }

    return clickResult;
  }

  private normalizeXhsClickResult(result: XhsClickResult | boolean | unknown, phase: string): XhsClickResult {
    if (typeof result === "boolean") {
      return { clicked: result, phase };
    }
    if (result && typeof result === "object" && "clicked" in result) {
      return {
        phase,
        ...(result as XhsClickResult)
      };
    }
    return {
      clicked: false,
      phase,
      reason: "unexpected-click-result"
    };
  }

  private normalizeXhsRatioDropdownResult(result: XhsRatioDropdownResult | boolean | unknown, phase: string): XhsRatioDropdownResult {
    const clickResult = this.normalizeXhsClickResult(result, phase);
    const alreadySelected =
      result && typeof result === "object" && "alreadySelected" in result
        ? Boolean((result as XhsRatioDropdownResult).alreadySelected)
        : undefined;
    return {
      ...clickResult,
      alreadySelected
    };
  }

  private async logXhsCoverClick(event: Record<string, unknown>) {
    const entry = {
      time: new Date().toISOString(),
      platform: this.platform,
      ...event
    };
    const line = JSON.stringify(entry);
    console.info(`[xhs-cover] ${line}`);
    await fs
      .mkdir(dataDir, { recursive: true })
      .then(() => fs.appendFile(path.join(dataDir, "xhs-cover-clicks.jsonl"), `${line}\n`))
      .catch(() => undefined);
  }
}
