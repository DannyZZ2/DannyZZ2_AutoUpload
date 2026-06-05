import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { dataDir } from "../../config";
import type { PublishContext } from "../adapter";
import { BaseWebAdapter } from "../baseWebAdapter";

type RectSnapshot = {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

type BilibiliClickResult = {
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
};

export class BilibiliAdapter extends BaseWebAdapter {
  platform = "bilibili" as const;

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
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]'
    ],
    descriptionInputs: [
      'textarea[placeholder*="简介"]',
      'textarea[placeholder*="描述"]',
      '[contenteditable="true"]'
    ],
    tagInputs: [
      'input[placeholder*="标签"]',
      'input[placeholder*="按回车键添加标签"]'
    ],
    submitImmediateTexts: ["立即投稿", "投稿", "发布"]
  };

  async setCover({ task, page, step }: PublishContext) {
    await step("打开 B站封面制作页");
    const openResult = await this.clickBilibiliCoverSetting(page);
    await this.logBilibiliCoverClick({
      phase: "cover-setting-click",
      ...openResult
    });
    if (!openResult.clicked) {
      throw new Error(`未能打开 B站封面制作页${openResult.reason ? `：${openResult.reason}` : ""}`);
    }

    if (!(await this.waitForBilibiliCoverEditorVisible(page))) {
      throw new Error("B站封面制作页未打开");
    }

    await step("上传 B站首页推荐封面 4:3");
    if (!(await this.uploadBilibiliCover(page, task.cover43Path, "4:3"))) {
      throw new Error("未能上传 B站 4:3 封面");
    }

    await step("切换 B站个人空间封面 16:9");
    const ratioResult = await this.clickBilibiliCoverRatio(page, "16:9");
    await this.logBilibiliCoverClick({
      phase: "cover-ratio-click",
      ratio: "16:9",
      ...ratioResult
    });
    if (!ratioResult.clicked) {
      throw new Error(`未能切换 B站 16:9 封面${ratioResult.reason ? `：${ratioResult.reason}` : ""}`);
    }

    await page.waitForTimeout(500);

    await step("上传 B站个人空间封面 16:9");
    if (!(await this.uploadBilibiliCover(page, task.cover169Path ?? task.cover43Path, "16:9"))) {
      throw new Error("未能上传 B站 16:9 封面");
    }

    await page.waitForTimeout(1_000);

    await step("完成 B站封面设置");
    const doneResult = await this.clickBilibiliCoverDone(page);
    await this.logBilibiliCoverClick({
      phase: "cover-done-click",
      ...doneResult
    });
    if (!doneResult.clicked) {
      throw new Error(`B站封面上传后未找到完成按钮${doneResult.reason ? `：${doneResult.reason}` : ""}`);
    }
  }

  private async uploadBilibiliCover(page: Page, filePath: string, ratio: "4:3" | "16:9") {
    const clickResult = await this.findBilibiliCoverUploadPoint(page, ratio);
    await this.logBilibiliCoverClick({
      phase: "cover-upload-click",
      ratio,
      ...clickResult
    });

    if (clickResult.clicked && clickResult.point) {
      const x = Math.round(clickResult.point.x);
      const y = Math.round(clickResult.point.y);
      const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 5_000 }).catch(() => undefined);
      await page.mouse.move(x, y);
      await page.mouse.click(x, y);
      const fileChooser = await fileChooserPromise;
      if (fileChooser) {
        await fileChooser.setFiles(filePath);
        await page.waitForTimeout(1_000);
        return true;
      }
    }

    return this.trySetInputFiles(page, this.profile.cover43Inputs, filePath);
  }

  private async clickBilibiliCoverSetting(page: Page) {
    const result = await page.evaluate<BilibiliClickResult | boolean>(`
    (() => {
      const marker = "bilibili-cover-setting-click";
      void marker;
      const createBilibiliClickHelper = ${createBilibiliClickHelper.toString()};
      const helper = createBilibiliClickHelper();
      const candidates = helper.allElements()
        .filter((element) => {
          const text = helper.textOf(element);
          return text.includes("封面设置") || text.includes("设置封面");
        })
        .filter((element) => helper.isVisible(element))
        .map((element) => ({
          element,
          rect: element.getBoundingClientRect(),
          text: helper.textOf(element),
          tagName: element.tagName
        }))
        .filter((candidate) => {
          const rootTags = ["HTML", "BODY", "MICRO-APP", "MICRO-APP-BODY"];
          const area = candidate.rect.width * candidate.rect.height;
          return (
            !rootTags.includes(candidate.tagName) &&
            candidate.rect.width >= 30 &&
            candidate.rect.height >= 18 &&
            candidate.rect.width <= 420 &&
            candidate.rect.height <= 260 &&
            area <= 80_000 &&
            candidate.text.length <= 80
          );
        })
        .sort((a, b) => {
          const score = (candidate) => {
            const exact = candidate.text === "封面设置" || candidate.text === "设置封面" ? 0 : 1;
            const shortText = candidate.text.length <= 12 ? 0 : 1;
            const area = candidate.rect.width * candidate.rect.height;
            return exact * 1_000_000 + shortText * 100_000 + area;
          };
          return score(a) - score(b);
        });

      const candidate = candidates[0];
      if (!candidate) {
        return { clicked: false, reason: "cover-setting-not-found" };
      }

      return helper.clickAt(candidate.element, "bilibili-cover-setting");
    })()
    `);

    return this.normalizeBilibiliClickResult(result, "cover-setting-click");
  }

  private async waitForBilibiliCoverEditorVisible(page: Page, timeout = 10_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const visible = await page.evaluate<boolean>(() => {
        const marker = "bilibili-cover-editor-visible";
        void marker;
        const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
        return text.includes("封面制作") && (text.includes("首页推荐封面") || text.includes("个人空间封面"));
      }).catch(() => false);

      if (visible) {
        return true;
      }

      await page.waitForTimeout(500);
    }

    return false;
  }

  private async clickBilibiliCoverRatio(page: Page, ratio: "16:9") {
    const result = await page.evaluate<BilibiliClickResult | boolean>(`
    (() => {
      const marker = "bilibili-cover-ratio-click";
      void marker;
      const targetRatio = ${JSON.stringify(ratio)};
      const createBilibiliClickHelper = ${createBilibiliClickHelper.toString()};
      const helper = createBilibiliClickHelper();
      const candidates = helper.allElements()
        .filter((element) => {
          const text = helper.textOf(element);
          return text.includes(targetRatio) && (text.includes("个人空间封面") || text.includes("空间封面"));
        })
        .filter((element) => helper.isVisible(element))
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: helper.textOf(element) }))
        .filter((candidate) => candidate.rect.width > 80 && candidate.rect.height > 24)
        .sort((a, b) => a.rect.top - b.rect.top);

      const candidate = candidates[0];
      if (!candidate) {
        return { clicked: false, reason: "cover-ratio-" + targetRatio + "-not-found" };
      }

      return helper.clickAt(candidate.element, "bilibili-cover-ratio-" + targetRatio);
    })()
    `);

    return this.normalizeBilibiliClickResult(result, "cover-ratio-click");
  }

  private async findBilibiliCoverUploadPoint(page: Page, ratio: "4:3" | "16:9") {
    const result = await page.evaluate<BilibiliClickResult | boolean>(`
    (() => {
      const marker = "bilibili-cover-upload-click";
      void marker;
      const targetRatio = ${JSON.stringify(ratio)};
      const createBilibiliClickHelper = ${createBilibiliClickHelper.toString()};
      const helper = createBilibiliClickHelper();
      const candidates = helper.allElements()
        .filter((element) => helper.textOf(element).includes("上传封面"))
        .filter((element) => helper.isVisible(element))
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: helper.textOf(element) }))
        .filter((candidate) => candidate.rect.width > 40 && candidate.rect.height > 18)
        .sort((a, b) => {
          const aArea = a.rect.width * a.rect.height;
          const bArea = b.rect.width * b.rect.height;
          return b.rect.top - a.rect.top || bArea - aArea;
        });

      const candidate = candidates[0];
      if (!candidate) {
        return { clicked: false, reason: "cover-upload-" + targetRatio + "-not-found" };
      }

      const result = helper.pointFor(candidate.element);
      if (result.point) {
        helper.markClick(result.point, "bilibili-cover-upload-" + targetRatio);
      }
      return result;
    })()
    `);

    return this.normalizeBilibiliClickResult(result, "cover-upload-click");
  }

  private async clickBilibiliCoverDone(page: Page) {
    const result = await page.evaluate<BilibiliClickResult | boolean>(`
    (() => {
      const marker = "bilibili-cover-done-click";
      void marker;
      const createBilibiliClickHelper = ${createBilibiliClickHelper.toString()};
      const helper = createBilibiliClickHelper();
      const candidates = helper.allElements()
        .filter((element) => {
          const text = helper.textOf(element);
          return text === "完成" || text === "确定";
        })
        .filter((element) => helper.isVisible(element))
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: helper.textOf(element) }))
        .filter((candidate) => candidate.rect.width > 40 && candidate.rect.height > 24)
        .sort((a, b) => b.rect.bottom - a.rect.bottom || b.rect.right - a.rect.right);

      const candidate = candidates[0];
      if (!candidate) {
        return { clicked: false, reason: "cover-done-not-found" };
      }

      return helper.clickAt(candidate.element, "bilibili-cover-done");
    })()
    `);

    return this.normalizeBilibiliClickResult(result, "cover-done-click");
  }

  private normalizeBilibiliClickResult(result: BilibiliClickResult | boolean | unknown, phase: string): BilibiliClickResult {
    if (typeof result === "boolean") {
      return { clicked: result, phase };
    }

    if (result && typeof result === "object" && "clicked" in result) {
      return {
        phase,
        ...(result as BilibiliClickResult)
      };
    }

    return {
      clicked: false,
      phase,
      reason: "unexpected-click-result"
    };
  }

  private async logBilibiliCoverClick(event: Record<string, unknown>) {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...event
    });

    console.info(`[bilibili-cover] ${line}`);

    await fs.mkdir(dataDir, { recursive: true }).catch(() => undefined);
    await fs.appendFile(path.join(dataDir, "bilibili-cover-clicks.jsonl"), `${line}\n`).catch(() => undefined);
  }
}

function createBilibiliClickHelper() {
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
    allElements() {
      const roots: Array<Document | ShadowRoot> = [document];
      const elements: HTMLElement[] = [];
      for (let index = 0; index < roots.length; index += 1) {
        const root = roots[index];
        for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
          elements.push(element);
          if (element.shadowRoot) {
            roots.push(element.shadowRoot);
          }
        }
      }
      return elements;
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
        "left:" + (point.x - 8) + "px",
        "top:" + (point.y - 8) + "px",
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
        "left:" + (point.x + 12) + "px",
        "top:" + (point.y - 12) + "px",
        "padding:2px 6px",
        "border-radius:4px",
        "background:#ff2442",
        "color:#fff",
        "font:12px/1.4 sans-serif",
        "z-index:2147483647",
        "pointer-events:none"
      ].join(";");
      document.body.append(markerElement, labelElement);
    },
    pointFor(element: HTMLElement): BilibiliClickResult {
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      const point = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
      const hit = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
      return {
        clicked: true,
        point,
        targetText: helper.textOf(element),
        targetTagName: element.tagName,
        targetClassName: helper.classNameOf(element),
        targetRect: helper.toRect(element),
        hitText: hit ? helper.textOf(hit) : undefined,
        hitTagName: hit?.tagName,
        hitClassName: hit ? helper.classNameOf(hit) : undefined,
        hitRect: hit ? helper.toRect(hit) : undefined
      };
    },
    clickAt(element: HTMLElement, label: string): BilibiliClickResult {
      const result = helper.pointFor(element);
      if (!result.point) {
        return result;
      }
      helper.markClick(result.point, label);
      const eventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: result.point.x,
        clientY: result.point.y
      };
      const hit = document.elementFromPoint(result.point.x, result.point.y) as HTMLElement | null;
      const targets = Array.from(new Set([hit, element])).filter(Boolean) as HTMLElement[];
      for (const target of targets) {
        target.dispatchEvent(new MouseEvent("mousedown", eventInit));
        target.dispatchEvent(new MouseEvent("mouseup", eventInit));
        target.dispatchEvent(new MouseEvent("click", eventInit));
        target.click();
      }
      return result;
    }
  };

  return helper;
}
