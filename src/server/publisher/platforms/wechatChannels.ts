import fs from "node:fs/promises";
import path from "node:path";
import { BaseWebAdapter } from "../baseWebAdapter";
import { PublisherAutomationError, type AdapterStep, type PublishContext } from "../adapter";
import type { Frame, Page } from "playwright";
import { formatTags } from "../format";
import { maximizePageWindow, openPlatformPage } from "../browser";
import { dataDir } from "../../config";
import { getPlatformConfig } from "../../platformConfig";
import type { PublishTask } from "../../../shared/types";

type TextBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

type RectSnapshot = {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

type WechatOriginalDeclarationClickTarget = {
  x: number;
  y: number;
  text: string;
  tagName: string;
  role: string;
  source?: string;
  rect: RectSnapshot;
  hitText: string;
  hitTagName: string;
  frameIndex?: number;
  frameUrl?: string;
  frameRect?: RectSnapshot;
  localX?: number;
  localY?: number;
  wujieIframeIndex?: number;
};

type WechatCoverUseMaterialClickTarget = {
  x: number;
  y: number;
  strategy?: string;
  viewport?: { width: number; height: number };
  dialog?: RectSnapshot;
  prompt?: RectSnapshot;
  hit?: {
    tagName: string;
    text: string;
    role: string;
    rect: RectSnapshot;
    className: string;
  };
};

const wechatChannelsShortTitleSymbols = new Set([
  "《",
  "》",
  "「",
  "」",
  "『",
  "』",
  "“",
  "”",
  "\"",
  "'",
  "：",
  ":",
  "+",
  "？",
  "?",
  "%",
  "℃"
]);

export class WechatChannelsAdapter extends BaseWebAdapter {
  platform = "wechat_channels" as const;

  protected profile = {
    videoInputs: [
      'input[type="file"][accept*="video"]',
      'input[type="file"]'
    ],
    cover34Inputs: [
      'input[type="file"][accept*="image"]',
      'input[type="file"] >> nth=1'
    ],
    cover43Inputs: [
      'input[type="file"][accept*="image"]',
      'input[type="file"] >> nth=2'
    ],
    titleInputs: [
      'input[placeholder*="短标题"]',
      'textarea[placeholder*="短标题"]',
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]'
    ],
    descriptionInputs: [
      'textarea[placeholder*="视频描述"]',
      'textarea[placeholder*="描述"]',
      '[contenteditable="true"][data-placeholder*="视频描述"]',
      'textarea[placeholder*="简介"]',
      '[contenteditable="true"]'
    ],
    submitImmediateTexts: ["发表", "发布"]
  };

  async publish(task: PublishTask, step: AdapterStep) {
    const page = await openPlatformPage(this.platform, getPlatformConfig(this.platform).publisherUrl);
    const context: PublishContext = { task, page, step };

    try {
      return await this.runWechatPublishSteps(context);
    } catch (error) {
      const screenshotPath = await this.captureFailure(context, error);
      const message = error instanceof Error ? error.message : String(error);
      throw new PublisherAutomationError(message, screenshotPath);
    }
  }

  protected async runWechatPublishSteps(context: PublishContext) {
    await this.openPublisher(context);
    await this.ensureLogin(context);
    await this.uploadVideo(context);
    await this.setCover(context);
    await this.setTitleAndTags(context);
    await this.setContentDeclaration(context);
    await this.submitPublish(context);
    return {
      status: "published_immediately"
    } as const;
  }

  async setTitleAndTags({ task, page, step }: PublishContext) {
    await step("填写视频号视频描述");
    const description = formatWechatChannelsDescription(task.title, task.tags);
    const descriptionFilled = await this.fillWechatChannelsDescription(page, description);
    if (!descriptionFilled) {
      throw new Error("未找到视频号视频描述输入框");
    }

    await step("填写视频号短标题");
    const shortTitle = toWechatChannelsShortTitle(task.title);
    await this.fillFirst(page, this.profile.titleInputs, shortTitle, "未找到视频号短标题输入框");
  }

  async setContentDeclaration({ page, step }: PublishContext) {
    await step("设置视频号声明原创");

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await step(attempt === 1 ? "定位视频号原创声明区域" : "视频号声明原创未确认选中，继续尝试点选");
      const selected = await this.selectWechatOriginalDeclarationDirect(page);
      if (selected) {
        return;
      }

      if (await this.isWechatOriginalRightsDialogVisibleDirect(page)) {
        throw new Error("视频号原创权益弹窗未完成，已停止发表");
      }

      await page.waitForTimeout(700);
    }

    throw new Error("视频号声明原创未成功选中，已停止发表");
  }

  private async selectWechatOriginalDeclarationDirect(page: Page) {
    if (await this.isWechatOriginalDeclarationSelectedDirect(page)) {
      return true;
    }

    if (await this.confirmWechatOriginalRightsDialogDirect(page)) {
      return this.waitForWechatOriginalDeclarationSelectedDirect(page);
    }
    if (await this.isWechatOriginalRightsDialogVisibleDirect(page)) {
      return false;
    }

    const clicked = await this.clickWechatOriginalDeclarationEntryDirect(page);
    if (!clicked) {
      await this.scrollWechatOriginalDeclarationIntoViewDirect(page);
      return false;
    }

    await this.waitForWechatOriginalRightsDialogOpenDirect(page);
    if (await this.confirmWechatOriginalRightsDialogDirect(page)) {
      return this.waitForWechatOriginalDeclarationSelectedDirect(page);
    }

    return this.waitForWechatOriginalDeclarationSelectedDirect(page);
  }

  private async clickWechatOriginalDeclarationEntryDirect(page: Page) {
    const result = await page.evaluate<{
      clicked: boolean;
      reason?: string;
      source?: string;
      text?: string;
      point?: { x: number; y: number };
      rect?: RectSnapshot;
      hitText?: string;
      hitTagName?: string;
    }>(`(() => {
      const marker = "wechat-original-declaration-direct-click";
      void marker;
      const toRect = (rect) => ({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom
      });
      const queryAll = (root, selector) => {
        try {
          return Array.from(root.querySelectorAll(selector));
        } catch {
          return [];
        }
      };
      const contexts = [];
      const addContext = (root, source, offsetX = 0, offsetY = 0) => contexts.push({ root, source, offsetX, offsetY });
      addContext(document, "document");
      Array.from(document.querySelectorAll("wujie-app")).forEach((app, appIndex) => {
        if (app.shadowRoot) {
          addContext(app.shadowRoot, "wujie-shadow:" + appIndex);
        }
        const iframes = [
          ...Array.from(app.querySelectorAll("iframe")),
          ...(app.shadowRoot ? Array.from(app.shadowRoot.querySelectorAll("iframe")) : [])
        ];
        iframes.forEach((iframe, iframeIndex) => {
          try {
            if (!iframe.contentDocument) {
              return;
            }
            const rect = iframe.getBoundingClientRect();
            addContext(iframe.contentDocument, "wujie-iframe:" + iframeIndex, rect.left, rect.top);
          } catch {
            // Ignore cross-origin iframe roots.
          }
        });
      });

      const isHiddenByStyle = (element) => {
        const view = element.ownerDocument?.defaultView || window;
        const style = view.getComputedStyle(element);
        return style.display === "none" || style.visibility === "hidden" || style.opacity === "0";
      };
      const isDialogText = (text) =>
        text.includes("原创权益") ||
        text.includes("我已阅读并同意") ||
        text.includes("原创声明须知") ||
        text.includes("使用条款");
      const findTarget = (root) => {
        const formItem = queryAll(root, ".form-item.cell-center.post-with-link")
          .filter((element) => !isHiddenByStyle(element))
          .filter((element) => {
            const text = (element.textContent || "").trim();
            return (
              !isDialogText(text) &&
              (text.includes("声明原创") ||
                text.includes("原创声明") ||
                text.includes("作品将展示原创标记") ||
                Boolean(element.querySelector(".ant-checkbox, .ant-checkbox-input, .ant-checkbox-wrapper")))
            );
          })[0];
        if (formItem) {
          return formItem;
        }

        const direct = queryAll(root, ".declare-original-checkbox")
          .filter((element) => !isHiddenByStyle(element))
          .filter((element) => !isDialogText((element.textContent || "").trim()))[0];
        if (direct) {
          return direct.closest(".form-item.cell-center.post-with-link, .post-with-link, label") || direct;
        }

        const label = queryAll(root, "*")
          .filter((element) => !isHiddenByStyle(element))
          .filter((element) => {
            const text = (element.textContent || "").trim();
            return text === "声明原创" || text === "原创声明";
          })[0];
        if (!label) {
          return undefined;
        }

        return label.closest(".declare-original-checkbox, .form-item.cell-center.post-with-link, .post-with-link, label") || label;
      };
      const dispatchClick = (element, point) => {
        if (!element || typeof element.dispatchEvent !== "function") {
          return;
        }
        const view = element.ownerDocument?.defaultView || window;
        const PointerCtor = view.PointerEvent || view.MouseEvent;
        const eventInit = {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: point.localX,
          clientY: point.localY
        };
        element.dispatchEvent(new PointerCtor("pointerdown", eventInit));
        element.dispatchEvent(new view.MouseEvent("mousedown", eventInit));
        element.dispatchEvent(new PointerCtor("pointerup", eventInit));
        element.dispatchEvent(new view.MouseEvent("mouseup", eventInit));
        element.dispatchEvent(new view.MouseEvent("click", eventInit));
        if (typeof element.click === "function") {
          element.click();
        }
      };
      const uniqueElements = (elements) => {
        const set = new Set();
        return elements.filter((element) => {
          if (!element || set.has(element)) {
            return false;
          }
          set.add(element);
          return true;
        });
      };

      for (const context of contexts) {
        const target = findTarget(context.root);
        if (!target) {
          continue;
        }

        target.scrollIntoView({ block: "center", inline: "center" });
        const rect = target.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          continue;
        }

        const localX = rect.left + rect.width / 2;
        const localY = rect.top + rect.height / 2;
        const point = {
          localX,
          localY,
          x: context.offsetX + localX,
          y: context.offsetY + localY
        };
        const hit = context.root.nodeType === Node.DOCUMENT_NODE
          ? context.root.elementFromPoint(localX, localY)
          : document.elementFromPoint(point.x, point.y);
        const row = target.closest(".declare-original-checkbox, .form-item.cell-center.post-with-link, .post-with-link, label");
        const input = target.querySelector?.("input, .ant-checkbox-input, .ant-checkbox, .ant-checkbox-wrapper");
        for (const element of uniqueElements([hit, input, target, row])) {
          dispatchClick(element, point);
        }

        return {
          clicked: true,
          source: context.source,
          text: (target.textContent || "").trim().slice(0, 180),
          point: { x: point.x, y: point.y },
          rect: {
            left: context.offsetX + rect.left,
            top: context.offsetY + rect.top,
            width: rect.width,
            height: rect.height,
            right: context.offsetX + rect.right,
            bottom: context.offsetY + rect.bottom
          },
          hitText: hit ? (hit.textContent || "").trim().slice(0, 180) : "",
          hitTagName: hit ? hit.tagName.toLowerCase() : ""
        };
      }

      return { clicked: false, reason: "original declaration target not found" };
    })()`).catch((error): {
      clicked: boolean;
      reason?: string;
      source?: string;
      text?: string;
      point?: { x: number; y: number };
      rect?: RectSnapshot;
      hitText?: string;
      hitTagName?: string;
    } => ({
      clicked: false,
      reason: error instanceof Error ? error.message : String(error)
    }));

    if (!result.clicked) {
      await this.logWechatOriginalDeclarationClick({
        phase: "no-target-direct",
        result,
        diagnostics: await this.getWechatOriginalDeclarationDiagnostics(page)
      });
      return false;
    }

    await this.logWechatOriginalDeclarationClick({
      phase: "direct-click",
      result
    });

    await page.waitForTimeout(250);
    if (
      result.point &&
      !(await this.isWechatOriginalRightsDialogVisibleDirect(page)) &&
      !(await this.isWechatOriginalDeclarationSelectedDirect(page))
    ) {
      await page.mouse.click(result.point.x, result.point.y);
      await page.waitForTimeout(350);
      await this.logWechatOriginalDeclarationClick({
        phase: "direct-click-mouse-fallback",
        point: result.point,
        rightsDialogVisible: await this.isWechatOriginalRightsDialogVisibleDirect(page),
        selected: await this.isWechatOriginalDeclarationSelectedDirect(page)
      });
    }

    return true;
  }

  private async confirmWechatOriginalRightsDialogDirect(page: Page) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await this.clickWechatOriginalRightsDialogActionDirect(page);
      if (!result.found) {
        return false;
      }

      await this.logWechatOriginalDeclarationClick({
        phase: "rights-dialog-action",
        result
      });

      const agreementPoint = "action" in result && result.action === "agreement" && "point" in result ? result.point : undefined;
      if (agreementPoint) {
        await page.waitForTimeout(250);
        if (!(await this.isWechatOriginalRightsAgreementSelectedDirect(page))) {
          await page.mouse.click(agreementPoint.x, agreementPoint.y);
          await page.waitForTimeout(300);
          await this.logWechatOriginalDeclarationClick({
            phase: "rights-dialog-agreement-mouse-fallback",
            point: agreementPoint,
            agreementSelected: await this.isWechatOriginalRightsAgreementSelectedDirect(page)
          });
        }
      }

      await page.waitForTimeout(500);

      if (!(await this.isWechatOriginalRightsDialogVisibleDirect(page))) {
        return true;
      }
    }

    return false;
  }

  private async clickWechatOriginalRightsDialogActionDirect(page: Page) {
    return page.evaluate<{
      found: boolean;
      action?: "agreement" | "confirm";
      reason?: string;
      source?: string;
      point?: { x: number; y: number };
      agreementSelected?: boolean;
      agreementSelectedAfter?: boolean;
      confirmReady?: boolean;
      target?: Record<string, unknown>;
    }>(`(() => {
      const marker = "wechat-original-rights-dialog-direct-action";
      void marker;
      const queryAll = (root, selector) => {
        try {
          return Array.from(root.querySelectorAll(selector));
        } catch {
          return [];
        }
      };
      const contexts = [];
      const addContext = (root, source, offsetX = 0, offsetY = 0) => contexts.push({ root, source, offsetX, offsetY });
      addContext(document, "document");
      Array.from(document.querySelectorAll("wujie-app")).forEach((app, appIndex) => {
        if (app.shadowRoot) {
          addContext(app.shadowRoot, "wujie-shadow:" + appIndex);
        }
        const iframes = [
          ...Array.from(app.querySelectorAll("iframe")),
          ...(app.shadowRoot ? Array.from(app.shadowRoot.querySelectorAll("iframe")) : [])
        ];
        iframes.forEach((iframe, iframeIndex) => {
          try {
            if (!iframe.contentDocument) {
              return;
            }
            const rect = iframe.getBoundingClientRect();
            addContext(iframe.contentDocument, "wujie-iframe:" + iframeIndex, rect.left, rect.top);
          } catch {
            // Ignore cross-origin iframe roots.
          }
        });
      });
      const readClassName = (element) => {
        if (!element) {
          return "";
        }
        if (typeof element.className === "string") {
          return element.className;
        }
        if (element.className && typeof element.className.baseVal === "string") {
          return element.className.baseVal;
        }
        return "";
      };
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const view = element.ownerDocument?.defaultView || window;
        const style = view.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0"
        );
      };
      const findDialog = (root) => {
        const isOriginalRightsDialog = (element) => {
          const text = (element.textContent || "").trim();
          return text.includes("原创权益") && text.includes("我已阅读并同意") && text.includes("声明原创");
        };
        const explicit = queryAll(root, ".weui-desktop-dialog, [role='dialog'], .ant-modal, .ant-modal-content")
          .filter(isVisible)
          .filter(isOriginalRightsDialog)[0];
        if (explicit) {
          return explicit;
        }

        const title = queryAll(root, "*")
          .filter(isVisible)
          .filter((element) => {
            const text = (element.textContent || "").trim();
            return text === "原创权益" || text.includes("原创权益");
          })
          .sort((a, b) => {
            const aRect = a.getBoundingClientRect();
            const bRect = b.getBoundingClientRect();
            return aRect.width * aRect.height - bRect.width * bRect.height;
          })[0];
        let current = title;
        for (let depth = 0; current && depth < 10; depth += 1) {
          const className = readClassName(current);
          const role = current.getAttribute?.("role") || "";
          if (
            isOriginalRightsDialog(current) &&
            (className.includes("weui-desktop-dialog") ||
              className.includes("ant-modal") ||
              role === "dialog" ||
              current.getAttribute?.("aria-modal") === "true")
          ) {
            return current;
          }
          current = current.parentElement;
        }
        return undefined;
      };
      const dispatchClick = (element, point) => {
        if (!element || typeof element.dispatchEvent !== "function") {
          return;
        }
        const view = element.ownerDocument?.defaultView || window;
        const PointerCtor = view.PointerEvent || view.MouseEvent;
        const eventInit = {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: point.localX,
          clientY: point.localY
        };
        element.dispatchEvent(new PointerCtor("pointerdown", eventInit));
        element.dispatchEvent(new view.MouseEvent("mousedown", eventInit));
        element.dispatchEvent(new PointerCtor("pointerup", eventInit));
        element.dispatchEvent(new view.MouseEvent("mouseup", eventInit));
        element.dispatchEvent(new view.MouseEvent("click", eventInit));
        if (typeof element.click === "function") {
          element.click();
        }
      };
      const uniqueElements = (elements) => {
        const set = new Set();
        return elements.filter((element) => {
          if (!element || set.has(element)) {
            return false;
          }
          set.add(element);
          return true;
        });
      };
      const pointFor = (context, element) => {
        const rect = element.getBoundingClientRect();
        const localX = rect.left + rect.width / 2;
        const localY = rect.top + rect.height / 2;
        return {
          localX,
          localY,
          x: context.offsetX + localX,
          y: context.offsetY + localY
        };
      };
      const describeElement = (element, context) => {
        if (!element) {
          return undefined;
        }
        const rect = element.getBoundingClientRect();
        const view = element.ownerDocument?.defaultView || window;
        const style = view.getComputedStyle(element);
        return {
          tagName: element.tagName ? element.tagName.toLowerCase() : "",
          className: readClassName(element),
          text: (element.textContent || "").trim().slice(0, 80),
          disabled: Boolean(element.disabled),
          ariaDisabled: element.getAttribute?.("aria-disabled") || "",
          ariaChecked: element.getAttribute?.("aria-checked") || "",
          opacity: style.opacity,
          pointerEvents: style.pointerEvents,
          rect: {
            left: context.offsetX + rect.left,
            top: context.offsetY + rect.top,
            width: rect.width,
            height: rect.height,
            right: context.offsetX + rect.right,
            bottom: context.offsetY + rect.bottom
          }
        };
      };
      const clickElement = (context, element) => {
        if (typeof element.scrollIntoView === "function") {
          element.scrollIntoView({ block: "center", inline: "center" });
        }
        const point = pointFor(context, element);
        const doc = element.ownerDocument || document;
        const hit = typeof doc.elementFromPoint === "function" ? doc.elementFromPoint(point.localX, point.localY) : undefined;
        const closestClickable = element.closest?.("button, [role='button'], label, .ant-checkbox-wrapper, .ant-checkbox, .weui-desktop-btn, .weui-desktop-dialog__btn");
        const targets = [];
        [hit, element, closestClickable].forEach((target) => {
          if (target && !targets.includes(target)) {
            targets.push(target);
          }
        });
        targets.forEach((target) => dispatchClick(target, point));
        return point;
      };
      const clickAgreementElement = (context, agreement) => {
        const checkbox = agreement.stateTarget || agreement.clickTarget;
        if (typeof checkbox.scrollIntoView === "function") {
          checkbox.scrollIntoView({ block: "center", inline: "center" });
        }
        const point = pointFor(context, checkbox);
        const doc = checkbox.ownerDocument || document;
        const hit = typeof doc.elementFromPoint === "function" ? doc.elementFromPoint(point.localX, point.localY) : undefined;
        const wrapper = checkbox.closest?.(".ant-checkbox-wrapper, label");
        const row = checkbox.closest?.(".ant-checkbox-wrapper, label, .weui-desktop-dialog, [role='dialog'], .ant-modal-content");
        for (const element of uniqueElements([hit, agreement.input, checkbox, wrapper, agreement.clickTarget, row])) {
          dispatchClick(element, point);
        }
        return point;
      };
      const isConfirmReady = (button) => {
        const view = button.ownerDocument?.defaultView || window;
        const style = view.getComputedStyle(button);
        const className = readClassName(button);
        const disabled = button instanceof HTMLButtonElement || button instanceof HTMLInputElement ? button.disabled : false;
        return !(
          disabled ||
          button.getAttribute("aria-disabled") === "true" ||
          /disabled/i.test(className) ||
          Number(style.opacity || "1") < 0.55 ||
          style.pointerEvents === "none"
        );
      };
      const getConfirmButton = (dialog) => {
        const textNode = queryAll(dialog, "button, [role='button'], *")
          .filter(isVisible)
          .filter((element) => (element.textContent || "").trim() === "声明原创")
          .sort((a, b) => {
            const aRect = a.getBoundingClientRect();
            const bRect = b.getBoundingClientRect();
            return bRect.bottom - aRect.bottom || bRect.right - aRect.right;
          })[0];
        if (!textNode) {
          return undefined;
        }
        const clickable = textNode.closest?.("button, [role='button'], .weui-desktop-btn, .weui-desktop-dialog__btn");
        if (clickable && isVisible(clickable)) {
          return clickable;
        }
        let current = textNode;
        for (let depth = 0; current && depth < 6; depth += 1) {
          const text = (current.textContent || "").trim();
          const role = current.getAttribute("role") || "";
          const tagName = current.tagName.toLowerCase();
          const rect = current.getBoundingClientRect();
          if (text.includes("声明原创") && (tagName === "button" || role === "button" || rect.width >= 80)) {
            return current;
          }
          current = current.parentElement;
        }
        return textNode;
      };
      const getAgreementTarget = (dialog) => {
        const agreementText = queryAll(dialog, "*")
          .filter(isVisible)
          .filter((element) => {
            const text = (element.textContent || "").trim();
            return text.includes("我已阅读并同意") && !text.includes("原创权益");
          })
          .sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0];
        const agreementRect = agreementText?.getBoundingClientRect();
        const candidates = queryAll(dialog, ".ant-checkbox-wrapper, .ant-checkbox, .ant-checkbox-input, input[type='checkbox']")
          .filter(isVisible)
          .sort((a, b) => {
            const aRect = a.getBoundingClientRect();
            const bRect = b.getBoundingClientRect();
            const aDistance = agreementRect ? Math.abs((aRect.top + aRect.height / 2) - (agreementRect.top + agreementRect.height / 2)) : aRect.top;
            const bDistance = agreementRect ? Math.abs((bRect.top + bRect.height / 2) - (agreementRect.top + agreementRect.height / 2)) : bRect.top;
            return aDistance - bDistance || aRect.left - bRect.left;
          });
        const controls = candidates
          .map((candidate) => {
            const checkbox = candidate.closest?.(".ant-checkbox") || candidate.querySelector?.(".ant-checkbox") || candidate;
            const input = candidate.matches?.("input[type='checkbox']")
              ? candidate
              : candidate.querySelector?.("input[type='checkbox'], .ant-checkbox-input");
            const rect = checkbox.getBoundingClientRect();
            const textCenterY = agreementRect ? agreementRect.top + agreementRect.height / 2 : rect.top + rect.height / 2;
            const controlCenterY = rect.top + rect.height / 2;
            const isOnAgreementLine = !agreementRect || Math.abs(controlCenterY - textCenterY) <= 80;
            const isBeforeAgreementText = !agreementRect || rect.left <= agreementRect.left + 20;
            return { checkbox, input, rect, isOnAgreementLine, isBeforeAgreementText };
          })
          .filter(({ checkbox, rect, isOnAgreementLine, isBeforeAgreementText }) => {
            return checkbox && rect.width > 0 && rect.height > 0 && isOnAgreementLine && isBeforeAgreementText;
          })
          .sort((a, b) => {
            const aDistance = agreementRect ? Math.abs((a.rect.top + a.rect.height / 2) - (agreementRect.top + agreementRect.height / 2)) : a.rect.top;
            const bDistance = agreementRect ? Math.abs((b.rect.top + b.rect.height / 2) - (agreementRect.top + agreementRect.height / 2)) : b.rect.top;
            return aDistance - bDistance || a.rect.left - b.rect.left;
          });

        const control = controls[0];
        if (control) {
          return { clickTarget: control.checkbox, stateTarget: control.checkbox, input: control.input };
        }
        return undefined;
      };
      const isAgreementSelected = (agreement) => {
        const targets = [];
        if (agreement.input) {
          targets.push(agreement.input);
        }
        let current = agreement.stateTarget || agreement.clickTarget;
        for (let depth = 0; current && depth < 5; depth += 1) {
          targets.push(current);
          current = current.parentElement;
        }
        queryAll(agreement.clickTarget, "input, .ant-checkbox, .ant-checkbox-input, .ant-checkbox-wrapper").forEach((target) => targets.push(target));
        return targets.some((target) => {
          const className = readClassName(target);
          return (
            target.checked === true ||
            target.getAttribute?.("aria-checked") === "true" ||
            /ant-checkbox-checked|ant-checkbox-wrapper-checked/.test(className)
          );
        });
      };

      for (const context of contexts) {
        const dialog = findDialog(context.root);
        if (!dialog) {
          continue;
        }

        const agreement = getAgreementTarget(dialog);
        const agreementSelected = agreement ? isAgreementSelected(agreement) : true;
        if (agreement && !agreementSelected) {
          const point = clickAgreementElement(context, agreement);
          return {
            found: true,
            action: "agreement",
            source: context.source,
            point: { x: point.x, y: point.y },
            agreementSelected,
            agreementSelectedAfter: isAgreementSelected(agreement),
            target: describeElement(agreement.clickTarget, context)
          };
        }

        const confirmButton = getConfirmButton(dialog);
        if (!confirmButton) {
          return {
            found: true,
            reason: "confirm target not found",
            source: context.source,
            agreementSelected
          };
        }

        const confirmReady = isConfirmReady(confirmButton);
        if (confirmReady) {
          const point = clickElement(context, confirmButton);
          return {
            found: true,
            action: "confirm",
            source: context.source,
            point: { x: point.x, y: point.y },
            agreementSelected,
            confirmReady,
            target: describeElement(confirmButton, context)
          };
        }

        if (!agreement) {
          return {
            found: true,
            reason: "agreement target not found and confirm not ready",
            source: context.source,
            agreementSelected,
            confirmReady,
            target: describeElement(confirmButton, context)
          };
        }
        return {
          found: true,
          reason: "confirm target not ready after agreement selected",
          source: context.source,
          agreementSelected,
          confirmReady,
          target: describeElement(confirmButton, context)
        };
      }

      return { found: false, reason: "rights dialog not found" };
    })()`).catch((error) => ({
      found: false,
      reason: error instanceof Error ? error.message : String(error)
    }));
  }

  private async isWechatOriginalRightsAgreementSelectedDirect(page: Page) {
    return page.evaluate<boolean>(`(() => {
      const marker = "wechat-original-rights-agreement-direct-selected";
      void marker;
      const queryAll = (root, selector) => {
        try {
          return Array.from(root.querySelectorAll(selector));
        } catch {
          return [];
        }
      };
      const roots = [document];
      Array.from(document.querySelectorAll("wujie-app")).forEach((app) => {
        if (app.shadowRoot) {
          roots.push(app.shadowRoot);
        }
        const iframes = [
          ...Array.from(app.querySelectorAll("iframe")),
          ...(app.shadowRoot ? Array.from(app.shadowRoot.querySelectorAll("iframe")) : [])
        ];
        iframes.forEach((iframe) => {
          try {
            if (iframe.contentDocument) {
              roots.push(iframe.contentDocument);
            }
          } catch {
            // Ignore cross-origin iframe roots.
          }
        });
      });
      const readClassName = (element) => {
        if (!element) {
          return "";
        }
        if (typeof element.className === "string") {
          return element.className;
        }
        if (element.className && typeof element.className.baseVal === "string") {
          return element.className.baseVal;
        }
        return "";
      };
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const view = element.ownerDocument?.defaultView || window;
        const style = view.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      };
      const findDialog = (root) => queryAll(root, ".weui-desktop-dialog, [role='dialog'], .ant-modal, .ant-modal-content")
        .filter(isVisible)
        .filter((element) => {
          const text = (element.textContent || "").trim();
          return text.includes("原创权益") && text.includes("我已阅读并同意") && text.includes("声明原创");
        })[0];
      const isSelected = (element) => {
        const className = readClassName(element);
        return (
          element.checked === true ||
          element.getAttribute?.("aria-checked") === "true" ||
          /ant-checkbox-checked|ant-checkbox-wrapper-checked/.test(className)
        );
      };

      return roots.some((root) => {
        const dialog = findDialog(root);
        if (!dialog) {
          return false;
        }
        const agreementText = queryAll(dialog, "*")
          .filter(isVisible)
          .filter((element) => {
            const text = (element.textContent || "").trim();
            return text.includes("我已阅读并同意") && !text.includes("原创权益");
          })[0];
        const agreementRect = agreementText?.getBoundingClientRect();
        const controls = queryAll(dialog, ".ant-checkbox-wrapper, .ant-checkbox, .ant-checkbox-input, input[type='checkbox']")
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;
            const textCenterY = agreementRect ? agreementRect.top + agreementRect.height / 2 : centerY;
            return !agreementRect || Math.abs(centerY - textCenterY) <= 80;
          });
        return controls.some((control) => {
          const targets = [control];
          let current = control.parentElement;
          for (let depth = 0; current && depth < 5; depth += 1) {
            targets.push(current);
            current = current.parentElement;
          }
          queryAll(control, "input, .ant-checkbox, .ant-checkbox-input, .ant-checkbox-wrapper").forEach((target) => targets.push(target));
          return targets.some(isSelected);
        });
      });
    })()`).catch(() => false);
  }

  private async waitForWechatOriginalRightsDialogOpenDirect(page: Page) {
    const deadline = Date.now() + 2_500;
    while (Date.now() < deadline) {
      if (await this.isWechatOriginalRightsDialogVisibleDirect(page)) {
        return true;
      }
      await page.waitForTimeout(150);
    }

    return false;
  }

  private async waitForWechatOriginalDeclarationSelectedDirect(page: Page) {
    for (let attempt = 0; attempt < 18; attempt += 1) {
      if (await this.isWechatOriginalDeclarationSelectedDirect(page)) {
        return true;
      }
      await page.waitForTimeout(200);
    }

    return false;
  }

  private async isWechatOriginalRightsDialogVisibleDirect(page: Page) {
    return page.evaluate<boolean>(`(() => {
      const marker = "wechat-original-rights-dialog-direct-visible";
      void marker;
      const queryAll = (root, selector) => {
        try {
          return Array.from(root.querySelectorAll(selector));
        } catch {
          return [];
        }
      };
      const roots = [document];
      Array.from(document.querySelectorAll("wujie-app")).forEach((app) => {
        if (app.shadowRoot) {
          roots.push(app.shadowRoot);
        }
        const iframes = [
          ...Array.from(app.querySelectorAll("iframe")),
          ...(app.shadowRoot ? Array.from(app.shadowRoot.querySelectorAll("iframe")) : [])
        ];
        iframes.forEach((iframe) => {
          try {
            if (iframe.contentDocument) {
              roots.push(iframe.contentDocument);
            }
          } catch {
            // Ignore cross-origin iframe roots.
          }
        });
      });
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const view = element.ownerDocument?.defaultView || window;
        const style = view.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      };
      const readClassName = (element) => {
        if (!element) {
          return "";
        }
        if (typeof element.className === "string") {
          return element.className;
        }
        if (element.className && typeof element.className.baseVal === "string") {
          return element.className.baseVal;
        }
        return "";
      };
      const isOriginalRightsDialog = (element) => {
        const text = (element.textContent || "").trim();
        return text.includes("原创权益") && text.includes("我已阅读并同意") && text.includes("声明原创");
      };
      return roots.some((root) => {
        const explicit = queryAll(root, ".weui-desktop-dialog, [role='dialog'], .ant-modal, .ant-modal-content")
          .filter(isVisible)
          .some(isOriginalRightsDialog);
        if (explicit) {
          return true;
        }

        const title = queryAll(root, "*")
          .filter(isVisible)
          .filter((element) => {
            const text = (element.textContent || "").trim();
            return text === "原创权益" || text.includes("原创权益");
          })
          .sort((a, b) => {
            const aRect = a.getBoundingClientRect();
            const bRect = b.getBoundingClientRect();
            return aRect.width * aRect.height - bRect.width * bRect.height;
          })[0];
        let current = title;
        for (let depth = 0; current && depth < 10; depth += 1) {
          const className = readClassName(current);
          const role = current.getAttribute?.("role") || "";
          if (
            isOriginalRightsDialog(current) &&
            (className.includes("weui-desktop-dialog") ||
              className.includes("ant-modal") ||
              role === "dialog" ||
              current.getAttribute?.("aria-modal") === "true")
          ) {
            return true;
          }
          current = current.parentElement;
        }
        return false;
      });
    })()`).catch(() => false);
  }

  private async isWechatOriginalDeclarationSelectedDirect(page: Page) {
    return page.evaluate<boolean>(`(() => {
      const marker = "wechat-original-declaration-direct-selected";
      void marker;
      const queryAll = (root, selector) => {
        try {
          return Array.from(root.querySelectorAll(selector));
        } catch {
          return [];
        }
      };
      const roots = [document];
      Array.from(document.querySelectorAll("wujie-app")).forEach((app) => {
        if (app.shadowRoot) {
          roots.push(app.shadowRoot);
        }
        const iframes = [
          ...Array.from(app.querySelectorAll("iframe")),
          ...(app.shadowRoot ? Array.from(app.shadowRoot.querySelectorAll("iframe")) : [])
        ];
        iframes.forEach((iframe) => {
          try {
            if (iframe.contentDocument) {
              roots.push(iframe.contentDocument);
            }
          } catch {
            // Ignore cross-origin iframe roots.
          }
        });
      });
      const isSelected = (element) => {
        if (element instanceof HTMLInputElement && typeof element.checked === "boolean") {
          return element.checked;
        }
        if (element.classList?.contains("ant-checkbox-checked") || element.closest?.(".ant-checkbox-checked")) {
          return true;
        }
        const role = element.getAttribute("role") || "";
        return (
          ((role === "checkbox" || role === "radio") && element.getAttribute("aria-checked") === "true") ||
          ((role === "checkbox" || role === "radio") && element.getAttribute("aria-selected") === "true")
        );
      };
      return roots.some((root) => {
        const rows = queryAll(root, ".declare-original-checkbox, .form-item.cell-center.post-with-link")
          .filter((element) => {
            const text = (element.textContent || "").trim();
            return (
              !text.includes("原创权益") &&
              !text.includes("我已阅读并同意") &&
              (element.classList.contains("declare-original-checkbox") ||
                text.includes("声明原创") ||
                text.includes("原创声明") ||
                text.includes("作品将展示原创标记"))
            );
          });
        return rows.some((row) => [row, ...queryAll(row, "input, [role='checkbox'], [role='radio'], .ant-checkbox, .ant-checkbox-input, .ant-checkbox-wrapper")].some(isSelected));
      });
    })()`).catch(() => false);
  }

  private async scrollWechatOriginalDeclarationIntoViewDirect(page: Page) {
    return page.evaluate<boolean>(`(() => {
      const marker = "wechat-original-declaration-direct-scroll";
      void marker;
      const queryAll = (root, selector) => {
        try {
          return Array.from(root.querySelectorAll(selector));
        } catch {
          return [];
        }
      };
      const roots = [document];
      Array.from(document.querySelectorAll("wujie-app")).forEach((app) => {
        if (app.shadowRoot) {
          roots.push(app.shadowRoot);
        }
      });
      for (const root of roots) {
        const target = queryAll(root, ".declare-original-checkbox, .form-item.cell-center.post-with-link")
          .filter((element) => {
            const text = (element.textContent || "").trim();
            return element.classList.contains("declare-original-checkbox") || text.includes("声明原创") || text.includes("作品将展示原创标记");
          })[0];
        if (target) {
          target.scrollIntoView({ block: "center", inline: "center" });
          return true;
        }
      }
      return false;
    })()`).catch(() => false);
  }

  private async selectWechatOriginalDeclaration(page: Page) {
    if (await this.confirmWechatOriginalRightsDialog(page)) {
      return this.ensureWechatOriginalDeclarationSelectedAfterRights(page);
    }
    if (await this.isWechatOriginalRightsDialogVisible(page)) {
      return false;
    }

    if (await this.isWechatOriginalDeclarationSelected(page)) {
      return true;
    }

    const clickedOriginalEntry = await this.clickWechatOriginalDeclarationEntry(page);
    if (clickedOriginalEntry) {
      await this.waitForWechatOriginalRightsDialogOpen(page);
      if (await this.confirmWechatOriginalRightsDialog(page)) {
        return this.ensureWechatOriginalDeclarationSelectedAfterRights(page);
      }
      if (await this.isWechatOriginalDeclarationSelected(page)) {
        return true;
      }
      if (await this.isWechatOriginalRightsDialogVisible(page)) {
        return false;
      }
    }

    const labels = ["声明原创", "原创"];
    for (const label of labels) {
      const candidates = [
        page.getByRole("checkbox", { name: new RegExp(label) }).first(),
        page.getByRole("radio", { name: new RegExp(label) }).first(),
        page.getByRole("button", { name: new RegExp(label) }).first()
      ];

      for (const candidate of candidates) {
        try {
          await candidate.waitFor({ state: "visible", timeout: 1_000 });
          await candidate.click({ timeout: 1_000 });
          await this.waitForWechatOriginalRightsDialogOpen(page);
          if (await this.confirmWechatOriginalRightsDialog(page)) {
            return this.ensureWechatOriginalDeclarationSelectedAfterRights(page);
          }
          if (await this.isWechatOriginalDeclarationSelected(page)) {
            return true;
          }
          if (await this.isWechatOriginalRightsDialogVisible(page)) {
            return false;
          }
        } catch {
          // Try the next original declaration control.
        }
      }
    }

    return false;
  }

  private async ensureWechatOriginalDeclarationSelectedAfterRights(page: Page) {
    if (await this.waitForWechatOriginalDeclarationSelected(page)) {
      return true;
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const clicked = await this.clickWechatOriginalDeclarationEntry(page);
      if (!clicked) {
        continue;
      }

      await page.waitForTimeout(500);
      if (await this.waitForWechatOriginalDeclarationSelected(page)) {
        return true;
      }

      if (await this.confirmWechatOriginalRightsDialog(page)) {
        if (await this.waitForWechatOriginalDeclarationSelected(page)) {
          return true;
        }
      }
    }

    return false;
  }

  private async clickWechatOriginalDeclarationEntry(page: Page) {
    const target = await this.getWechatOriginalDeclarationEntryTarget(page);
    if (!target) {
      await this.logWechatOriginalDeclarationClick({
        phase: "no-target",
        diagnostics: await this.getWechatOriginalDeclarationDiagnostics(page)
      });
      return false;
    }

    await this.logWechatOriginalDeclarationClick({
      phase: "before-click",
      target
    });
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(300);
    await page.evaluate(({ x, y }) => {
      const state = window as typeof window & {
        __wechatOriginalDeclarationClickX?: number;
        __wechatOriginalDeclarationClickY?: number;
      };
      state.__wechatOriginalDeclarationClickX = x;
      state.__wechatOriginalDeclarationClickY = y;
    }, { x: target.x, y: target.y });
    const frame = typeof target.frameIndex === "number" ? page.frames()[target.frameIndex] : undefined;
    const localX = target.localX;
    const localY = target.localY;
    const wujieIframeIndex = target.wujieIframeIndex;
    const hasFrameTarget = Boolean(frame && typeof localX === "number" && typeof localY === "number");
    const hasWujieIframeTarget =
      typeof wujieIframeIndex === "number" &&
      typeof localX === "number" &&
      typeof localY === "number";
    if (frame && typeof localX === "number" && typeof localY === "number" && hasFrameTarget) {
      await this.clickWechatOriginalDeclarationEntryByDomInFrame(frame, localX, localY);
    } else if (typeof wujieIframeIndex === "number" && typeof localX === "number" && typeof localY === "number" && hasWujieIframeTarget) {
      await this.clickWechatOriginalDeclarationEntryByDomInWujieIframe(page, wujieIframeIndex, localX, localY);
    } else {
      await this.clickWechatOriginalDeclarationEntryByDom(page);
    }
    const hitAfterClick = hasFrameTarget && frame && typeof localX === "number" && typeof localY === "number"
      ? await this.getWechatFrameElementTextAtPoint(frame, localX, localY)
      : hasWujieIframeTarget && typeof localX === "number" && typeof localY === "number" && typeof wujieIframeIndex === "number"
        ? await this.getWechatWujieFrameElementTextAtPoint(page, wujieIframeIndex, localX, localY)
        : await this.getWechatElementTextAtPoint(page, target.x, target.y);
    await this.logWechatOriginalDeclarationClick({
      phase: "after-click",
      target,
      hitAfterClick,
      rightsDialogVisible: await this.isWechatOriginalRightsDialogVisible(page),
      selected: await this.isWechatOriginalDeclarationSelected(page)
    });
    return true;
  }

  private async getWechatOriginalDeclarationDiagnostics(page: Page) {
    return page.evaluate(`(() => {
      const marker = "wechat-original-declaration-diagnostics";
      void marker;
      const toRect = (rect) => ({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom
      });
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight &&
          rect.right > 0 &&
          rect.left < window.innerWidth &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      };
      const elementInfo = (element) => {
        const rect = element.getBoundingClientRect();
        return {
          tagName: element.tagName.toLowerCase(),
          className: typeof element.className === "string" ? element.className : "",
          text: (element.textContent || "").trim().slice(0, 220),
          visible: isVisible(element),
          rect: toRect(rect)
        };
      };
      const bodyText = (document.body?.innerText || "").trim();
      const formItems = Array.from(document.querySelectorAll(".form-item.cell-center.post-with-link"))
        .map(elementInfo)
        .slice(0, 20);
      const looseOriginalItems = Array.from(document.querySelectorAll(".form-item, .post-with-link, .declare-original-checkbox"))
        .filter((element) => {
          const text = (element.textContent || "").trim();
          return text.includes("声明原创") || text.includes("原创声明") || element.classList.contains("declare-original-checkbox");
        })
        .map(elementInfo)
        .slice(0, 20);
      const declareOriginalCheckboxes = Array.from(document.querySelectorAll(".declare-original-checkbox"))
        .map(elementInfo)
        .slice(0, 20);
      const visibleOriginalTextElements = Array.from(document.querySelectorAll("body *"))
        .filter((element) => isVisible(element))
        .filter((element) => {
          const text = (element.textContent || "").trim();
          return text === "声明原创" || text === "原创声明" || text.includes("声明原创");
        })
        .map(elementInfo)
        .slice(0, 20);
      const coverEditorMarkers = ["编辑个人主页卡片", "编辑分享卡片", "裁剪封面"];
      const coverEditorMatches = Array.from(document.querySelectorAll("body *"))
        .filter((element) => isVisible(element))
        .filter((element) => {
          const text = (element.textContent || "").trim();
          return coverEditorMarkers.some((markerText) => text.includes(markerText));
        })
        .map(elementInfo)
        .slice(0, 10);
      const activeElement = document.activeElement ? elementInfo(document.activeElement) : undefined;
      const rootSummary = (root) => {
        const text = ((root.body?.innerText || root.textContent || "")).trim();
        const all = (selector) => Array.from(root.querySelectorAll(selector));
        return {
          textIncludesOriginal: text.includes("声明原创") || text.includes("原创声明"),
          textIncludesCoverEditor: coverEditorMarkers.some((markerText) => text.includes(markerText)),
          textSample: text.slice(0, 500),
          formItemCount: all(".form-item.cell-center.post-with-link").length,
          looseOriginalItemCount: all(".form-item, .post-with-link, .declare-original-checkbox")
            .filter((element) => {
              const elementText = (element.textContent || "").trim();
              return elementText.includes("声明原创") || elementText.includes("原创声明") || element.classList.contains("declare-original-checkbox");
            }).length,
          declareOriginalCheckboxCount: all(".declare-original-checkbox").length,
          antCheckboxCount: all(".ant-checkbox, .ant-checkbox-input, .ant-checkbox-wrapper").length
        };
      };
      const wujieIframeSummaries = [];
      const summarizeIframe = (iframe, iframeIndex, source) => {
        try {
          const iframeDocument = iframe.contentDocument;
          const rect = iframe.getBoundingClientRect();
          if (!iframeDocument) {
            return { iframeIndex, source, sameOrigin: false, rect: toRect(rect) };
          }
          return { iframeIndex, source, sameOrigin: true, rect: toRect(rect), summary: rootSummary(iframeDocument) };
        } catch (error) {
          return {
            iframeIndex,
            source,
            sameOrigin: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      };
      const wujieApps = Array.from(document.querySelectorAll("wujie-app"))
        .map((app, appIndex) => {
          const shadowIframes = app.shadowRoot ? Array.from(app.shadowRoot.querySelectorAll("iframe")) : [];
          const lightIframes = Array.from(app.querySelectorAll("iframe"));
          const iframeSummaries = [...lightIframes, ...shadowIframes].map((iframe, iframeIndex) => {
            const summary = summarizeIframe(iframe, wujieIframeSummaries.length, iframeIndex < lightIframes.length ? "light-dom" : "shadow-dom");
            wujieIframeSummaries.push(summary);
            return summary;
          });
          return {
            appIndex,
            tagName: app.tagName.toLowerCase(),
            className: typeof app.className === "string" ? app.className : "",
            rect: toRect(app.getBoundingClientRect()),
            textSample: (app.textContent || "").trim().slice(0, 500),
            shadowRoot: Boolean(app.shadowRoot),
            shadowSummary: app.shadowRoot ? rootSummary(app.shadowRoot) : undefined,
            lightSummary: rootSummary(app),
            iframeCount: iframeSummaries.length,
            iframeSummaries
          };
        });
      return {
        url: window.location.href,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        bodyTextIncludesOriginal: bodyText.includes("声明原创") || bodyText.includes("原创声明"),
        bodyTextIncludesCoverEditor: coverEditorMarkers.some((markerText) => bodyText.includes(markerText)),
        bodyTextSample: bodyText.slice(0, 900),
        formItemCount: formItems.length,
        formItems,
        looseOriginalItemCount: looseOriginalItems.length,
        looseOriginalItems,
        declareOriginalCheckboxCount: declareOriginalCheckboxes.length,
        declareOriginalCheckboxes,
        visibleOriginalTextCount: visibleOriginalTextElements.length,
        visibleOriginalTextElements,
        coverEditorVisible: coverEditorMatches.length > 0,
        coverEditorMatches,
        activeElement,
        wujieApps,
        wujieIframeSummaries
      };
    })()`).catch((error) => ({
      error: error instanceof Error ? error.message : String(error)
    }));
  }

  private async getWechatOriginalDeclarationEntryTarget(page: Page): Promise<WechatOriginalDeclarationClickTarget | undefined> {
    const mainTarget = await this.getWechatOriginalDeclarationEntryTargetInContext(page);
    if (mainTarget) {
      return mainTarget;
    }

    const wujieTarget = await this.getWechatOriginalDeclarationEntryTargetInWujie(page);
    if (wujieTarget) {
      return wujieTarget;
    }

    const frames = page.frames();
    for (const [frameIndex, frame] of frames.entries()) {
      if (frame === page.mainFrame()) {
        continue;
      }

      const frameTarget = await this.getWechatOriginalDeclarationEntryTargetInContext(frame);
      if (!frameTarget) {
        continue;
      }

      const frameRect = await this.getWechatFrameRect(frame);
      if (!frameRect) {
        continue;
      }

      return {
        ...frameTarget,
        x: frameRect.left + frameTarget.x,
        y: frameRect.top + frameTarget.y,
        localX: frameTarget.x,
        localY: frameTarget.y,
        frameIndex,
        frameUrl: frame.url(),
        frameRect,
        source: `frame:${frameTarget.source || "element"}`
      };
    }

    return undefined;
  }

  private async getWechatOriginalDeclarationEntryTargetInWujie(page: Page): Promise<WechatOriginalDeclarationClickTarget | undefined> {
    return page.evaluate<WechatOriginalDeclarationClickTarget | undefined>(`(() => {
      const marker = "wechat-original-declaration-wujie-target";
      void marker;
      const coverEditorMarkers = ["编辑个人主页卡片", "编辑分享卡片", "裁剪封面"];
      const toRect = (value) => ({
        left: value.left,
        top: value.top,
        width: value.width,
        height: value.height,
        right: value.right,
        bottom: value.bottom
      });
      const queryAll = (root, selector) => {
        try {
          return Array.from(root.querySelectorAll(selector));
        } catch {
          return [];
        }
      };
      const rootText = (root) => ((root.body?.innerText || root.textContent || "")).trim();
      const rootElements = (root) => queryAll(root, root instanceof Document ? "body *" : "*");
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const view = element.ownerDocument?.defaultView || window;
        const style = view.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < view.innerHeight &&
          rect.right > 0 &&
          rect.left < view.innerWidth &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      };
      const hasVisibleCoverEditor = (root) =>
        rootElements(root).some((element) => {
          if (!isVisible(element)) {
            return false;
          }
          const text = (element.textContent || "").trim();
          return coverEditorMarkers.some((markerText) => text.includes(markerText));
        });
      const getWujieIframes = () => {
        const iframes = [];
        Array.from(document.querySelectorAll("wujie-app")).forEach((app) => {
          iframes.push(...Array.from(app.querySelectorAll("iframe")));
          if (app.shadowRoot) {
            iframes.push(...Array.from(app.shadowRoot.querySelectorAll("iframe")));
          }
        });
        return iframes;
      };
      const contexts = [];
      Array.from(document.querySelectorAll("wujie-app")).forEach((app, appIndex) => {
        if (app.shadowRoot) {
          contexts.push({
            root: app.shadowRoot,
            offsetX: 0,
            offsetY: 0,
            source: "wujie-shadow:" + appIndex
          });
        }
      });
      getWujieIframes().forEach((iframe, wujieIframeIndex) => {
        try {
          const iframeDocument = iframe.contentDocument;
          if (!iframeDocument) {
            return;
          }
          const rect = iframe.getBoundingClientRect();
          contexts.push({
            root: iframeDocument,
            offsetX: rect.left,
            offsetY: rect.top,
            source: "wujie-iframe:" + wujieIframeIndex,
            wujieIframeIndex
          });
        } catch {
          // Cross-origin Wujie iframes are reported by diagnostics; they cannot be queried directly here.
        }
      });

      const makeTarget = (context, element, source) => {
        element.scrollIntoView({ block: "center", inline: "center" });
        const rect = element.getBoundingClientRect();
        const localX = rect.left + rect.width / 2;
        const localY = rect.top + rect.height / 2;
        const x = context.offsetX + localX;
        const y = context.offsetY + localY;
        const hit =
          context.root instanceof Document
            ? context.root.elementFromPoint(localX, localY)
            : document.elementFromPoint(x, y);
        return {
          x,
          y,
          localX,
          localY,
          wujieIframeIndex: context.wujieIframeIndex,
          text: (element.textContent || "").trim().slice(0, 160),
          tagName: element.tagName.toLowerCase(),
          role: element.getAttribute("role") || "",
          source: context.source + ":" + source,
          rect: {
            left: context.offsetX + rect.left,
            top: context.offsetY + rect.top,
            width: rect.width,
            height: rect.height,
            right: context.offsetX + rect.right,
            bottom: context.offsetY + rect.bottom
          },
          hitText: hit ? (hit.textContent || "").trim().slice(0, 160) : "",
          hitTagName: hit ? hit.tagName.toLowerCase() : ""
        };
      };
      const findTargetInContext = (context) => {
        const text = rootText(context.root);
        if (!text.includes("声明原创") && !text.includes("原创声明") && !queryAll(context.root, ".declare-original-checkbox").length) {
          return undefined;
        }
        if (hasVisibleCoverEditor(context.root)) {
          return undefined;
        }

        const originalFormItem = queryAll(context.root, ".form-item.cell-center.post-with-link")
          .map((element) => ({
            element,
            text: (element.textContent || "").trim(),
            hasDeclareOriginalCheckbox: Boolean(element.querySelector(".declare-original-checkbox")),
            hasAntCheckbox: Boolean(element.querySelector(".ant-checkbox, .ant-checkbox-input, .ant-checkbox-wrapper"))
          }))
          .filter(({ text: elementText, hasDeclareOriginalCheckbox, hasAntCheckbox }) => {
            const hasOriginalSignal =
              elementText.includes("声明原创") ||
              elementText.includes("原创声明") ||
              hasDeclareOriginalCheckbox ||
              (elementText.includes("原创") && hasAntCheckbox);
            const isDialogText =
              elementText.includes("原创权益") ||
              elementText.includes("我已阅读并同意") ||
              elementText.includes("原创声明须知") ||
              elementText.includes("使用条款");
            const isScheduleOnly =
              !elementText.includes("声明原创") &&
              (elementText.includes("定时发布") || elementText.includes("不定时") || elementText.includes("发表时间"));
            return hasOriginalSignal && !isDialogText && !isScheduleOnly;
          })
          .sort((a, b) => {
            const aExact = a.text.includes("声明原创") ? 0 : 1;
            const bExact = b.text.includes("声明原创") ? 0 : 1;
            const aDeclare = a.hasDeclareOriginalCheckbox ? 0 : 1;
            const bDeclare = b.hasDeclareOriginalCheckbox ? 0 : 1;
            return aExact - bExact || aDeclare - bDeclare;
          })[0]?.element;
        if (originalFormItem) {
          const clickable =
            originalFormItem.querySelector(".declare-original-checkbox") ||
            originalFormItem.querySelector(".ant-checkbox-wrapper") ||
            originalFormItem.querySelector(".ant-checkbox, .ant-checkbox-input") ||
            originalFormItem;
          return makeTarget(context, clickable, "form-item-cell-center-post-with-link");
        }

        const declareOriginalContainer = queryAll(context.root, ".declare-original-checkbox")
          .map((element) => ({ element, text: (element.textContent || "").trim() }))
          .filter(({ text: elementText }) =>
            !elementText.includes("原创权益") &&
            !elementText.includes("我已阅读并同意") &&
            !elementText.includes("原创声明须知") &&
            !elementText.includes("使用条款")
          )
          .sort((a, b) => {
            const aText = a.text.includes("声明原创") ? 0 : 1;
            const bText = b.text.includes("声明原创") ? 0 : 1;
            return aText - bText;
          })[0]?.element;
        if (declareOriginalContainer) {
          return makeTarget(context, declareOriginalContainer, "declare-original-checkbox");
        }

        const label = rootElements(context.root)
          .map((element) => ({ element, text: (element.textContent || "").trim() }))
          .filter(({ text: elementText }) =>
            !elementText.includes("原创权益") &&
            !elementText.includes("我已阅读并同意") &&
            !elementText.includes("原创声明须知") &&
            !elementText.includes("使用条款") &&
            (elementText === "原创" || elementText === "原创声明" || elementText === "声明原创" || elementText.includes("声明原创"))
          )
          .sort((a, b) => {
            const aExact = a.text === "声明原创" || a.text === "原创声明" ? 0 : 1;
            const bExact = b.text === "声明原创" || b.text === "原创声明" ? 0 : 1;
            return aExact - bExact || a.text.length - b.text.length;
          })[0]?.element;
        if (!label) {
          return undefined;
        }

        const row = label.closest(".form-item, .post-with-link, label") || label.parentElement || label;
        const checkbox =
          row.querySelector(".declare-original-checkbox") ||
          row.querySelector(".ant-checkbox-wrapper") ||
          row.querySelector(".ant-checkbox, .ant-checkbox-input") ||
          row;
        return makeTarget(context, checkbox, "label-row-checkbox");
      };

      for (const context of contexts) {
        const target = findTargetInContext(context);
        if (target) {
          return target;
        }
      }

      return undefined;
    })()`).catch(() => undefined);
  }

  private async getWechatOriginalDeclarationEntryTargetInContext(context: Page | Frame) {
    return context.evaluate<WechatOriginalDeclarationClickTarget | undefined>(`(() => {
      const marker = "wechat-original-declaration-target";
      void marker;
      const coverEditorMarkers = ["编辑个人主页卡片", "编辑分享卡片", "裁剪封面"];
      const hasVisibleCoverEditor = Array.from(document.querySelectorAll("body *"))
        .some((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const text = (element.textContent || "").trim();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.top < window.innerHeight &&
            rect.right > 0 &&
            rect.left < window.innerWidth &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            coverEditorMarkers.some((markerText) => text.includes(markerText))
          );
        });
      if (hasVisibleCoverEditor) {
        return undefined;
      }

      const elements = Array.from(document.querySelectorAll("input, button, [role='button'], [role='checkbox'], [role='radio'], label, body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return {
            element,
            rect,
            text: (element.textContent || "").trim(),
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom > 0 &&
              rect.top < window.innerHeight &&
              rect.right > 0 &&
              rect.left < window.innerWidth &&
              style.display !== "none" &&
              style.visibility !== "hidden"
          };
        })
        .filter(({ visible }) => visible);
      const isSelected = (element) => {
        if (element instanceof HTMLInputElement) {
          return element.checked;
        }
        if (
          element.classList?.contains("ant-checkbox-checked") ||
          element.closest?.(".ant-checkbox-checked")
        ) {
          return true;
        }
        const ariaChecked = element.getAttribute("aria-checked");
        const ariaSelected = element.getAttribute("aria-selected");
        const role = element.getAttribute("role") || "";
        return (
          ((role === "checkbox" || role === "radio") && ariaChecked === "true") ||
          ((role === "checkbox" || role === "radio") && ariaSelected === "true")
        );
      };
      const toRect = (value) => ({
        left: value.left,
        top: value.top,
        width: value.width,
        height: value.height,
        right: value.right,
        bottom: value.bottom
      });
      const pointTarget = (x, y, source, fallbackElement) => {
        const hit = document.elementFromPoint(x, y);
        const rect = fallbackElement.getBoundingClientRect();
        return {
          x,
          y,
          text: (fallbackElement.textContent || "").trim().slice(0, 160),
          tagName: fallbackElement.tagName.toLowerCase(),
          role: fallbackElement.getAttribute("role") || "",
          source,
          rect: toRect(rect),
          hitText: hit ? (hit.textContent || "").trim().slice(0, 160) : "",
          hitTagName: hit ? hit.tagName.toLowerCase() : ""
        };
      };
      const clickElement = (element, source = "element") => {
        element.scrollIntoView({ block: "center", inline: "center" });
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        return {
          x,
          y,
          text: (element.textContent || "").trim().slice(0, 160),
          tagName: element.tagName.toLowerCase(),
          role: element.getAttribute("role") || "",
          source,
          rect: toRect(rect),
          hitText: hit ? (hit.textContent || "").trim().slice(0, 160) : "",
          hitTagName: hit ? hit.tagName.toLowerCase() : ""
        };
      };
      const originalFormItem = Array.from(document.querySelectorAll(".form-item.cell-center.post-with-link"))
        .map((element) => ({
          element,
          rect: element.getBoundingClientRect(),
          text: (element.textContent || "").trim(),
          hasDeclareOriginalCheckbox: Boolean(element.querySelector(".declare-original-checkbox")),
          hasAntCheckbox: Boolean(element.querySelector(".ant-checkbox, .ant-checkbox-input, .ant-checkbox-wrapper"))
        }))
        .filter(({ text, hasDeclareOriginalCheckbox, hasAntCheckbox }) => {
          const hasOriginalSignal =
            text.includes("声明原创") ||
            text.includes("原创声明") ||
            hasDeclareOriginalCheckbox ||
            (text.includes("原创") && hasAntCheckbox);
          const isDialogText =
            text.includes("原创权益") ||
            text.includes("我已阅读并同意") ||
            text.includes("原创声明须知") ||
            text.includes("使用条款");
          const isScheduleOnly =
            !text.includes("声明原创") &&
            (text.includes("定时发布") || text.includes("不定时") || text.includes("发表时间"));
          return hasOriginalSignal && !isDialogText && !isScheduleOnly;
        })
        .sort((a, b) => {
          const aExact = a.text.includes("声明原创") ? 0 : 1;
          const bExact = b.text.includes("声明原创") ? 0 : 1;
          const aDeclare = a.hasDeclareOriginalCheckbox ? 0 : 1;
          const bDeclare = b.hasDeclareOriginalCheckbox ? 0 : 1;
          return aExact - bExact || aDeclare - bDeclare || b.rect.top - a.rect.top;
        })[0]?.element;
      if (originalFormItem) {
        const clickable =
          originalFormItem.querySelector(".declare-original-checkbox") ||
          originalFormItem.querySelector(".ant-checkbox-wrapper") ||
          originalFormItem.querySelector(".ant-checkbox, .ant-checkbox-input") ||
          originalFormItem;
        return clickElement(clickable, "form-item-cell-center-post-with-link");
      }

      const declareOriginalContainer = Array.from(document.querySelectorAll(".declare-original-checkbox"))
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: (element.textContent || "").trim() }))
        .filter(({ rect, text }) =>
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight &&
          rect.right > 0 &&
          rect.left < window.innerWidth &&
          !text.includes("原创权益") &&
          !text.includes("我已阅读并同意")
        )
        .sort((a, b) => {
          const aText = a.text.includes("声明原创") ? 0 : 1;
          const bText = b.text.includes("声明原创") ? 0 : 1;
          return aText - bText || b.rect.width * b.rect.height - a.rect.width * a.rect.height;
        })[0]?.element;
      if (declareOriginalContainer) {
        return clickElement(declareOriginalContainer, "declare-original-checkbox");
      }

      const label = elements
        .filter(({ text }) =>
          !text.includes("原创权益") &&
          !text.includes("我已阅读并同意") &&
          !text.includes("原创声明须知") &&
          !text.includes("使用条款") &&
          (text === "原创" || text === "原创声明" || text === "声明原创" || text.includes("声明原创"))
        )
        .sort((a, b) => {
          const aExact = a.text === "原创" || a.text === "声明原创" ? 0 : 1;
          const bExact = b.text === "原创" || b.text === "声明原创" ? 0 : 1;
          const aArea = a.rect.width * a.rect.height;
          const bArea = b.rect.width * b.rect.height;
          return aExact - bExact || aArea - bArea;
        })[0];
      if (!label) {
        return false;
      }

      const labelCenterY = label.rect.top + label.rect.height / 2;
      if (label.text === "声明原创") {
        return clickElement(label.element, "label-center");
      }

      const antCheckboxCandidates = Array.from(document.querySelectorAll(".ant-checkbox, .ant-checkbox-input, .ant-checkbox-wrapper"))
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: (element.textContent || "").trim() }))
        .filter(({ rect }) =>
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight &&
          rect.right > 0 &&
          rect.left < window.innerWidth
        )
        .filter(({ text }) => !text.includes("原创权益") && !text.includes("我已阅读并同意"))
        .filter(({ rect }) => Math.abs((rect.top + rect.height / 2) - labelCenterY) < 56)
        .filter(({ rect }) => rect.left > label.rect.right && rect.left < label.rect.right + 260)
        .sort((a, b) => {
          const aInput = a.element.matches(".ant-checkbox-input") ? 0 : 1;
          const bInput = b.element.matches(".ant-checkbox-input") ? 0 : 1;
          const aBox = a.element.matches(".ant-checkbox") ? 0 : 1;
          const bBox = b.element.matches(".ant-checkbox") ? 0 : 1;
          return aInput - bInput || aBox - bBox || a.rect.left - b.rect.left;
        });
      const antCheckbox = antCheckboxCandidates[0]?.element;
      if (antCheckbox) {
        const clickable = antCheckbox.closest(".ant-checkbox-wrapper") || antCheckbox.closest("label") || antCheckbox;
        return clickElement(clickable, "ant-checkbox");
      }

      if (label.text === "声明原创") {
        const offsets = [78, 90, 102, 114, 126, 146, 166, 190];
        const samples = offsets
          .map((offset) => {
            const x = label.rect.right + offset;
            const y = labelCenterY;
            const hit = document.elementFromPoint(x, y);
            const rect = hit?.getBoundingClientRect();
            const text = (hit?.textContent || "").trim();
            return { x, y, hit, rect, text };
          })
          .filter(({ x, y, hit, rect }) =>
            Boolean(hit) &&
            Boolean(rect) &&
            x > 0 &&
            x < window.innerWidth &&
            y > 0 &&
            y < window.innerHeight &&
            rect.width > 0 &&
            rect.height > 0
          )
          .sort((a, b) => {
            const aSquare = a.rect.width >= 10 && a.rect.width <= 42 && a.rect.height >= 10 && a.rect.height <= 42 ? 0 : 1;
            const bSquare = b.rect.width >= 10 && b.rect.width <= 42 && b.rect.height >= 10 && b.rect.height <= 42 ? 0 : 1;
            const aEmpty = a.text ? 1 : 0;
            const bEmpty = b.text ? 1 : 0;
            return aSquare - bSquare || aEmpty - bEmpty || Math.abs(a.x - (label.rect.right + 82)) - Math.abs(b.x - (label.rect.right + 82));
          });
        const checkboxSample = samples[0];
        if (checkboxSample) {
          return pointTarget(checkboxSample.x, checkboxSample.y, "label-anchor-scan", label.element);
        }

        const fallbackX = Math.min(window.innerWidth - 8, label.rect.right + 82);
        return pointTarget(fallbackX, labelCenterY, "label-anchor-offset", label.element);
      }

      const controlCandidates = elements
        .filter(({ element, rect }) => element !== label.element && rect.width <= 96 && rect.height <= 96)
        .filter(({ rect }) => Math.abs((rect.top + rect.height / 2) - labelCenterY) < 52)
        .filter(({ rect }) => rect.right <= label.rect.left + 32 || rect.left <= label.rect.right + 32)
        .sort((a, b) => {
          const aDistance = Math.abs((a.rect.top + a.rect.height / 2) - labelCenterY) + Math.abs(a.rect.right - label.rect.left);
          const bDistance = Math.abs((b.rect.top + b.rect.height / 2) - labelCenterY) + Math.abs(b.rect.right - label.rect.left);
          return aDistance - bDistance;
        });
      const candidates = [
        ...controlCandidates.map(({ element }) => element),
        label.element.closest("label"),
        label.element
      ].filter(Boolean);

      for (const candidate of candidates) {
        if (isSelected(candidate)) {
          return clickElement(candidate, "selected-element");
        }
        return clickElement(candidate);
      }

      return undefined;
    })()`).catch(() => undefined);
  }

  private async getWechatFrameRect(frame: Frame) {
    const frameElement = await frame.frameElement().catch(() => undefined);
    if (!frameElement) {
      return undefined;
    }

    const rect = await frameElement.evaluate((element) => {
      if (!(element instanceof Element)) {
        return undefined;
      }
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        width: value.width,
        height: value.height,
        right: value.right,
        bottom: value.bottom
      };
    }).catch(() => undefined);
    await frameElement.dispose().catch(() => undefined);
    return rect;
  }

  private async getWechatElementTextAtPoint(page: Page, x: number, y: number) {
    return page.evaluate(({ x: pointX, y: pointY }) => {
      const element = document.elementFromPoint(pointX, pointY);
      if (!element) {
        return undefined;
      }
      const rect = element.getBoundingClientRect();
      return {
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || "",
        text: (element.textContent || "").trim().slice(0, 160),
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom
        }
      };
    }, { x, y }).catch(() => undefined);
  }

  private async getWechatFrameElementTextAtPoint(frame: Frame, x: number, y: number) {
    return frame.evaluate(({ x: pointX, y: pointY }) => {
      const element = document.elementFromPoint(pointX, pointY);
      if (!element) {
        return undefined;
      }
      const rect = element.getBoundingClientRect();
      return {
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || "",
        text: (element.textContent || "").trim().slice(0, 160),
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom
        }
      };
    }, { x, y }).catch(() => undefined);
  }

  private async getWechatWujieFrameElementTextAtPoint(page: Page, iframeIndex: number, x: number, y: number) {
    return page.evaluate(({ iframeIndex: targetIframeIndex, x: pointX, y: pointY }) => {
      const marker = "wechat-wujie-frame-element-at-point";
      void marker;
      const iframes: HTMLIFrameElement[] = [];
      Array.from(document.querySelectorAll("wujie-app")).forEach((app) => {
        iframes.push(...Array.from(app.querySelectorAll("iframe")));
        if (app.shadowRoot) {
          iframes.push(...Array.from(app.shadowRoot.querySelectorAll("iframe")));
        }
      });
      const iframe = iframes[targetIframeIndex];
      const iframeDocument = iframe?.contentDocument;
      if (!iframeDocument) {
        return undefined;
      }
      const element = iframeDocument.elementFromPoint(pointX, pointY);
      if (!element) {
        return undefined;
      }
      const rect = element.getBoundingClientRect();
      return {
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || "",
        text: (element.textContent || "").trim().slice(0, 160),
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom
        }
      };
    }, { iframeIndex, x, y }).catch(() => undefined);
  }

  private async clickWechatOriginalDeclarationEntryByDom(page: Page) {
    return page.evaluate(`(() => {
      const marker = "wechat-original-declaration-click";
      void marker;
      const x = window.__wechatOriginalDeclarationClickX;
      const y = window.__wechatOriginalDeclarationClickY;
      if (typeof x !== "number" || typeof y !== "number") {
        return false;
      }
      const target = document.elementFromPoint(x, y);
      if (!target) {
        return false;
      }
      const eventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y
      };
      target.dispatchEvent(new PointerEvent("pointerdown", eventInit));
      target.dispatchEvent(new MouseEvent("mousedown", eventInit));
      target.dispatchEvent(new PointerEvent("pointerup", eventInit));
      target.dispatchEvent(new MouseEvent("mouseup", eventInit));
      target.dispatchEvent(new MouseEvent("click", eventInit));
      if (target instanceof HTMLElement) {
        target.click();
      }
      return true;
    })()`).catch(() => false);
  }

  private async clickWechatOriginalDeclarationEntryByDomInFrame(frame: Frame, x: number, y: number) {
    return frame.evaluate(({ x: pointX, y: pointY }) => {
      const target = document.elementFromPoint(pointX, pointY);
      if (!target) {
        return false;
      }
      const eventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: pointX,
        clientY: pointY
      };
      target.dispatchEvent(new PointerEvent("pointerdown", eventInit));
      target.dispatchEvent(new MouseEvent("mousedown", eventInit));
      target.dispatchEvent(new PointerEvent("pointerup", eventInit));
      target.dispatchEvent(new MouseEvent("mouseup", eventInit));
      target.dispatchEvent(new MouseEvent("click", eventInit));
      if (target instanceof HTMLElement) {
        target.click();
      }
      return true;
    }, { x, y }).catch(() => false);
  }

  private async clickWechatOriginalDeclarationEntryByDomInWujieIframe(page: Page, iframeIndex: number, x: number, y: number) {
    return page.evaluate(({ iframeIndex: targetIframeIndex, x: pointX, y: pointY }) => {
      const marker = "wechat-original-declaration-wujie-frame-click";
      void marker;
      const iframes: HTMLIFrameElement[] = [];
      Array.from(document.querySelectorAll("wujie-app")).forEach((app) => {
        iframes.push(...Array.from(app.querySelectorAll("iframe")));
        if (app.shadowRoot) {
          iframes.push(...Array.from(app.shadowRoot.querySelectorAll("iframe")));
        }
      });
      const iframe = iframes[targetIframeIndex];
      const iframeDocument = iframe?.contentDocument;
      if (!iframeDocument) {
        return false;
      }
      const target = iframeDocument.elementFromPoint(pointX, pointY);
      if (!target) {
        return false;
      }
      const eventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: pointX,
        clientY: pointY
      };
      target.dispatchEvent(new PointerEvent("pointerdown", eventInit));
      target.dispatchEvent(new MouseEvent("mousedown", eventInit));
      target.dispatchEvent(new PointerEvent("pointerup", eventInit));
      target.dispatchEvent(new MouseEvent("mouseup", eventInit));
      target.dispatchEvent(new MouseEvent("click", eventInit));
      if (target instanceof HTMLElement) {
        target.click();
      }
      return true;
    }, { iframeIndex, x, y }).catch(() => false);
  }

  private async logWechatOriginalDeclarationClick(event: Record<string, unknown>) {
    const line = JSON.stringify({
      time: new Date().toISOString(),
      platform: this.platform,
      ...event
    });
    console.info(`[wechat-original-declaration] ${line}`);
    fs.mkdir(dataDir, { recursive: true })
      .then(() => fs.appendFile(path.join(dataDir, "wechat-original-declaration-clicks.jsonl"), `${line}\n`))
      .catch(() => undefined);
  }

  private async confirmWechatOriginalRightsDialog(page: Page) {
    if (await this.confirmWechatOriginalRightsDialogInChildFrames(page)) {
      return true;
    }

    const points = await page.evaluate<{
      agreement: { x: number; y: number };
      agreementFallbacks: Array<{ x: number; y: number }>;
      confirm: { x: number; y: number };
    } | undefined>(`(() => {
      const marker = "wechat-original-rights-dialog-points";
      void marker;
      const visibleElements = Array.from(document.querySelectorAll("button, [role='button'], input, label, .ant-checkbox, .ant-checkbox-input, .ant-checkbox-wrapper, body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return {
            element,
            rect,
            text: (element.textContent || "").trim(),
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden"
          };
        })
        .filter(({ visible }) => visible);
      let dialog = Array.from(document.querySelectorAll(".weui-desktop-dialog"))
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: (element.textContent || "").trim() }))
        .filter(({ rect, text }) =>
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight &&
          rect.right > 0 &&
          rect.left < window.innerWidth &&
          text.includes("我已阅读并同意") &&
          text.includes("声明原创")
        )
        .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
      if (!dialog) {
        const title = visibleElements
          .filter(({ text }) => text.includes("原创权益"))
          .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
        if (!title) {
          return undefined;
        }

        const dialogCandidates = [];
        let current = title.element;
        for (let depth = 0; current && depth < 10; depth += 1) {
          const rect = current.getBoundingClientRect();
          const text = (current.textContent || "").trim();
          if (
            text.includes("原创权益") &&
            text.includes("我已阅读并同意") &&
            text.includes("声明原创") &&
            rect.width >= 500 &&
            rect.width <= Math.min(1200, window.innerWidth * 0.85) &&
            rect.height >= 300 &&
            rect.height <= Math.min(820, window.innerHeight * 0.85)
          ) {
            dialogCandidates.push({ element: current, rect });
          }
          current = current.parentElement;
        }
        dialog = dialogCandidates
          .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
      }
      if (!dialog) {
        return undefined;
      }

      const agreementText = visibleElements
        .filter(({ text, rect }) =>
          text.includes("我已阅读并同意") &&
          rect.left >= dialog.rect.left &&
          rect.right <= dialog.rect.right &&
          rect.top >= dialog.rect.top &&
          rect.bottom <= dialog.rect.bottom
        )
        .sort((a, b) => a.rect.top - b.rect.top)[0];
      const visualAgreementPoint = {
        x: dialog.rect.left + dialog.rect.width * 0.065,
        y: dialog.rect.top + dialog.rect.height * 0.635
      };
      const agreementCenterY = visualAgreementPoint.y;
      const antAgreementCheckbox = Array.from(dialog.element.querySelectorAll(".ant-checkbox-input, .ant-checkbox, .ant-checkbox-wrapper"))
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: (element.textContent || "").trim() }))
        .filter(({ rect }) =>
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= dialog.rect.left &&
          rect.right <= dialog.rect.right &&
          rect.top >= dialog.rect.top &&
          rect.bottom <= dialog.rect.bottom &&
          (!agreementText || Math.abs((rect.top + rect.height / 2) - (agreementText.rect.top + agreementText.rect.height / 2)) < 44)
        )
        .sort((a, b) => {
          const aInput = a.element.matches(".ant-checkbox-input") ? 0 : 1;
          const bInput = b.element.matches(".ant-checkbox-input") ? 0 : 1;
          const aBox = a.element.matches(".ant-checkbox") ? 0 : 1;
          const bBox = b.element.matches(".ant-checkbox") ? 0 : 1;
          return aInput - bInput || aBox - bBox || a.rect.left - b.rect.left;
        })[0];
      const checkbox = visibleElements
        .filter(({ element, rect }) => {
          const role = element.getAttribute("role") || "";
          const tagName = element.tagName.toLowerCase();
          return (
            (tagName === "input" || role === "checkbox" || role === "radio" || rect.width <= 36) &&
            rect.width >= 10 &&
            rect.width <= 44 &&
            rect.height >= 10 &&
            rect.height <= 44 &&
            rect.left >= dialog.rect.left &&
            rect.right <= dialog.rect.right &&
            rect.top >= dialog.rect.top &&
            rect.bottom <= dialog.rect.bottom &&
            Math.abs((rect.top + rect.height / 2) - agreementCenterY) < 32 &&
            (!agreementText || rect.right <= agreementText.rect.left + 12)
          );
        })
        .sort((a, b) => {
          const aDistance = Math.abs((a.rect.top + a.rect.height / 2) - agreementCenterY);
          const bDistance = Math.abs((b.rect.top + b.rect.height / 2) - agreementCenterY);
          return aDistance - bDistance || b.rect.right - a.rect.right;
        })[0];
      const confirmText = visibleElements
        .filter(({ text, rect }) =>
          text === "声明原创" &&
          rect.left >= dialog.rect.left &&
          rect.right <= dialog.rect.right &&
          rect.top >= dialog.rect.top &&
          rect.bottom <= dialog.rect.bottom
        )
        .sort((a, b) => b.rect.left - a.rect.left || b.rect.top - a.rect.top)[0];
      const agreement = antAgreementCheckbox
        ? {
            x: antAgreementCheckbox.rect.left + antAgreementCheckbox.rect.width / 2,
            y: antAgreementCheckbox.rect.top + antAgreementCheckbox.rect.height / 2
          }
        : checkbox
        ? {
            x: checkbox.rect.left + checkbox.rect.width / 2,
            y: checkbox.rect.top + checkbox.rect.height / 2
          }
        : agreementText
          ? {
              x: Math.max(dialog.rect.left + 64, agreementText.rect.left - 34),
              y: agreementCenterY
            }
          : {
              x: dialog.rect.left + dialog.rect.width * 0.067,
              y: agreementCenterY
            };

      return {
        agreement: visualAgreementPoint,
        agreementFallbacks: [
          agreement,
          {
            x: visualAgreementPoint.x + 8,
            y: visualAgreementPoint.y
          },
          {
            x: visualAgreementPoint.x - 8,
            y: visualAgreementPoint.y
          },
          {
            x: dialog.rect.left + dialog.rect.width * 0.066,
            y: agreementCenterY
          }
        ],
        confirm: confirmText
          ? {
              x: confirmText.rect.left + confirmText.rect.width / 2,
              y: confirmText.rect.top + confirmText.rect.height / 2
            }
          : {
              x: dialog.rect.left + dialog.rect.width * 0.85,
              y: dialog.rect.top + dialog.rect.height * 0.86
            }
      };
    })()`).catch(() => undefined);

    if (!points) {
      return false;
    }

    const agreementPoints = [points.agreement, ...points.agreementFallbacks];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const point = agreementPoints[attempt % agreementPoints.length];

      if (!(await this.isWechatOriginalRightsConfirmReady(page))) {
        if (attempt % 3 === 0) {
          await this.clickWechatOriginalAgreementInDialogByDom(page);
        } else if (attempt % 3 === 1) {
          await this.clickWechatOriginalAgreement(page, point);
        } else {
          await this.clickWechatOriginalAgreementPointByDom(page, point);
        }
        await page.waitForTimeout(350);
      }

      if (await this.isWechatOriginalRightsConfirmReady(page)) {
        const confirmedByDom = await this.clickWechatOriginalRightsConfirmByDom(page);
        if (!confirmedByDom) {
          await page.mouse.click(points.confirm.x, points.confirm.y);
        }
      }

      await page.waitForTimeout(500);
      if (await this.waitForWechatOriginalRightsDialogClosed(page)) {
        return true;
      }
    }

    return false;
  }

  private async confirmWechatOriginalRightsDialogInChildFrames(page: Page) {
    for (const frame of this.getWechatChildFrames(page)) {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const result = await frame.evaluate<{ found: boolean; closed: boolean }>(`(() => {
          const marker = "wechat-original-rights-frame-action";
          void marker;
          const visibleElements = Array.from(document.querySelectorAll("button, [role='button'], input, label, body *"))
            .map((element) => {
              const rect = element.getBoundingClientRect();
              const style = window.getComputedStyle(element);
              return {
                element,
                rect,
                text: (element.textContent || "").trim(),
                style,
                visible:
                  rect.width > 0 &&
                  rect.height > 0 &&
                  style.display !== "none" &&
                  style.visibility !== "hidden"
              };
            })
            .filter(({ visible }) => visible);
          const title = visibleElements
            .filter(({ text }) => text.includes("原创权益"))
            .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
          if (!title) {
            return { found: false, closed: false };
          }

          const dialogCandidates = [];
          let current = title.element;
          for (let depth = 0; current && depth < 10; depth += 1) {
            const rect = current.getBoundingClientRect();
            const text = (current.textContent || "").trim();
            if (
              text.includes("原创权益") &&
              text.includes("我已阅读并同意") &&
              text.includes("声明原创") &&
              rect.width >= 500 &&
              rect.height >= 300
            ) {
              dialogCandidates.push({ element: current, rect });
            }
            current = current.parentElement;
          }
          const dialog = dialogCandidates
            .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
          if (!dialog) {
            return { found: true, closed: false };
          }

          const dispatchClick = (element, point) => {
            const eventInit = {
              bubbles: true,
              cancelable: true,
              clientX: point.x,
              clientY: point.y
            };
            element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
            element.dispatchEvent(new MouseEvent("mousedown", eventInit));
            element.dispatchEvent(new PointerEvent("pointerup", eventInit));
            element.dispatchEvent(new MouseEvent("mouseup", eventInit));
            element.dispatchEvent(new MouseEvent("click", eventInit));
            if (element instanceof HTMLElement) {
              element.click();
            }
          };
          const isInDialog = (rect) =>
            rect.left >= dialog.rect.left &&
            rect.right <= dialog.rect.right &&
            rect.top >= dialog.rect.top &&
            rect.bottom <= dialog.rect.bottom;
          const confirmText = visibleElements
            .filter(({ text, rect }) => text === "声明原创" && isInDialog(rect))
            .sort((a, b) => b.rect.left - a.rect.left || b.rect.top - a.rect.top)[0];
          const getButtonForConfirm = () => {
            if (!confirmText) {
              return undefined;
            }
            let button = confirmText.element;
            for (let depth = 0; button && depth < 6; depth += 1) {
              const role = button.getAttribute("role") || "";
              const tagName = button.tagName.toLowerCase();
              const rect = button.getBoundingClientRect();
              const text = (button.textContent || "").trim();
              if (
                text.includes("声明原创") &&
                (tagName === "button" || role === "button" || rect.width >= confirmText.rect.width + 24 || rect.height >= confirmText.rect.height + 12)
              ) {
                return { element: button, rect };
              }
              button = button.parentElement;
            }
            return undefined;
          };
          const isConfirmReady = () => {
            const button = getButtonForConfirm();
            if (!button || !confirmText) {
              return false;
            }
            const style = window.getComputedStyle(button.element);
            const textStyle = window.getComputedStyle(confirmText.element);
            const className = typeof button.element.className === "string" ? button.element.className : "";
            const ariaDisabled = button.element.getAttribute("aria-disabled");
            const disabled = button.element instanceof HTMLButtonElement || button.element instanceof HTMLInputElement ? button.element.disabled : false;
            const textColor = textStyle.color;
            const buttonBackground = style.backgroundColor;
            const looksOrange = /rgb\\(\\s*2(?:4\\d|5[0-5])\\s*,\\s*(?:1[0-8]\\d|9\\d)\\s*,\\s*[0-8]?\\d\\s*\\)/.test(buttonBackground);
            const looksGray =
              /rgb\\(\\s*1[6-9]\\d\\s*,\\s*1[6-9]\\d\\s*,\\s*1[6-9]\\d\\s*\\)/.test(textColor) ||
              /rgb\\(\\s*2[0-4]\\d\\s*,\\s*2[0-4]\\d\\s*,\\s*2[0-4]\\d\\s*\\)/.test(textColor);
            return looksOrange || !(
              disabled ||
              ariaDisabled === "true" ||
              /disabled/i.test(className) ||
              Number(style.opacity || "1") < 0.6 ||
              style.pointerEvents === "none" ||
              looksGray
            );
          };

          if (!isConfirmReady()) {
            const agreementText = visibleElements
              .filter(({ text, rect }) =>
                text.includes("我已阅读并同意") &&
                !text.includes("原创权益") &&
                !text.includes("声明原创") &&
                isInDialog(rect)
              )
              .sort((a, b) => {
                const aStarts = a.text.startsWith("我已阅读并同意") ? 0 : 1;
                const bStarts = b.text.startsWith("我已阅读并同意") ? 0 : 1;
                const aArea = a.rect.width * a.rect.height;
                const bArea = b.rect.width * b.rect.height;
                return aStarts - bStarts || aArea - bArea || a.rect.top - b.rect.top;
              })[0];
            const y = agreementText
              ? agreementText.rect.top + agreementText.rect.height / 2
              : dialog.rect.top + dialog.rect.height * 0.635;
            const candidates = [
              { x: dialog.rect.left + dialog.rect.width * 0.065, y },
              { x: dialog.rect.left + dialog.rect.width * 0.065 + 8, y },
              { x: dialog.rect.left + dialog.rect.width * 0.065 - 8, y }
            ];
            const point = candidates[${attempt} % candidates.length];
            const target = document.elementFromPoint(point.x, point.y);
            if (target) {
              dispatchClick(target, point);
            }
            return { found: true, closed: false };
          }

          const button = getButtonForConfirm();
          if (!button) {
            return { found: true, closed: false };
          }
          const point = {
            x: button.rect.left + button.rect.width / 2,
            y: button.rect.top + button.rect.height / 2
          };
          dispatchClick(button.element, point);
          return { found: true, closed: false };
        })()`).catch(() => ({ found: false, closed: false }));

        if (!result.found) {
          break;
        }

        await page.waitForTimeout(600);
        if (!(await this.isWechatOriginalRightsDialogVisibleInFrame(frame))) {
          return true;
        }
      }
    }

    return false;
  }

  private async clickWechatOriginalAgreement(page: Page, point: { x: number; y: number }) {
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(300);
    return true;
  }

  private async clickWechatOriginalAgreementPointByDom(page: Page, point: { x: number; y: number }) {
    return page.evaluate(
      ({ x, y }) => {
        const marker = "wechat-original-agreement-point-click";
        void marker;
        const start = document.elementFromPoint(x, y);
        if (!start) {
          return false;
        }

        const dispatchClick = (element: Element) => {
          const eventInit = {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y
          };
          element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
          element.dispatchEvent(new MouseEvent("mousedown", eventInit));
          element.dispatchEvent(new PointerEvent("pointerup", eventInit));
          element.dispatchEvent(new MouseEvent("mouseup", eventInit));
          element.dispatchEvent(new MouseEvent("click", eventInit));
          if (element instanceof HTMLElement) {
            element.click();
          }
          return true;
        };

        let current: Element | null = start;
        for (let depth = 0; current && depth < 6; depth += 1) {
          const role = current.getAttribute("role") || "";
          const tagName = current.tagName.toLowerCase();
          const rect = current.getBoundingClientRect();
          const text = (current.textContent || "").trim();
          const looksLikeAgreementControl =
            tagName === "input" ||
            role === "checkbox" ||
            (rect.width >= 10 && rect.width <= 60 && rect.height >= 10 && rect.height <= 60) ||
            text.includes("我已阅读并同意");
          if (looksLikeAgreementControl) {
            return dispatchClick(current);
          }
          current = current.parentElement;
        }

        return dispatchClick(start);
      },
      point
    ).catch(() => false);
  }

  private async clickWechatOriginalAgreementInDialogByDom(page: Page) {
    return page.evaluate(`(() => {
      const marker = "wechat-original-agreement-dialog-click";
      void marker;
      const visibleElements = Array.from(document.querySelectorAll("button, [role='button'], input, label, body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return {
            element,
            rect,
            text: (element.textContent || "").trim(),
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden"
          };
        })
        .filter(({ visible }) => visible);
      const title = visibleElements
        .filter(({ text }) => text.includes("原创权益"))
        .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
      if (!title) {
        return false;
      }

      const dialogCandidates = [];
      let current = title.element;
      for (let depth = 0; current && depth < 10; depth += 1) {
        const rect = current.getBoundingClientRect();
        const text = (current.textContent || "").trim();
        if (
          text.includes("原创权益") &&
          text.includes("我已阅读并同意") &&
          text.includes("声明原创") &&
          rect.width >= 500 &&
          rect.width <= Math.min(1200, window.innerWidth * 0.85) &&
          rect.height >= 300 &&
          rect.height <= Math.min(820, window.innerHeight * 0.85)
        ) {
          dialogCandidates.push({ element: current, rect });
        }
        current = current.parentElement;
      }
      const dialog = dialogCandidates
        .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
      if (!dialog) {
        return false;
      }

      const dispatchClick = (element, point) => {
        const eventInit = {
          bubbles: true,
          cancelable: true,
          clientX: point.x,
          clientY: point.y
        };
        element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
        element.dispatchEvent(new MouseEvent("mousedown", eventInit));
        element.dispatchEvent(new PointerEvent("pointerup", eventInit));
        element.dispatchEvent(new MouseEvent("mouseup", eventInit));
        element.dispatchEvent(new MouseEvent("click", eventInit));
        if (element instanceof HTMLElement) {
          element.click();
        }
        return true;
      };
      const isInDialog = (rect) =>
        rect.left >= dialog.rect.left &&
        rect.right <= dialog.rect.right &&
        rect.top >= dialog.rect.top &&
        rect.bottom <= dialog.rect.bottom;
      const agreementText = visibleElements
        .filter(({ text, rect }) =>
          text.includes("我已阅读并同意") &&
          !text.includes("原创权益") &&
          !text.includes("声明原创") &&
          isInDialog(rect)
        )
        .sort((a, b) => {
          const aStarts = a.text.startsWith("我已阅读并同意") ? 0 : 1;
          const bStarts = b.text.startsWith("我已阅读并同意") ? 0 : 1;
          const aArea = a.rect.width * a.rect.height;
          const bArea = b.rect.width * b.rect.height;
          return aStarts - bStarts || aArea - bArea || a.rect.top - b.rect.top;
        })[0];
      if (!agreementText) {
        return false;
      }

      const agreementCenterY = agreementText.rect.top + agreementText.rect.height / 2;
      const maxControlLeft = Math.max(agreementText.rect.left + 24, dialog.rect.left + dialog.rect.width * 0.12);
      const controls = visibleElements
        .filter(({ element, rect }) => {
          const role = element.getAttribute("role") || "";
          const tagName = element.tagName.toLowerCase();
          return (
            isInDialog(rect) &&
            (tagName === "input" || role === "checkbox" || rect.width <= 44) &&
            rect.width >= 8 &&
            rect.width <= 44 &&
            rect.height >= 8 &&
            rect.height <= 44 &&
            rect.left <= maxControlLeft &&
            Math.abs((rect.top + rect.height / 2) - agreementCenterY) < 32
          );
        })
        .sort((a, b) => {
          const aDistance = Math.abs((a.rect.top + a.rect.height / 2) - agreementCenterY);
          const bDistance = Math.abs((b.rect.top + b.rect.height / 2) - agreementCenterY);
          return aDistance - bDistance || b.rect.right - a.rect.right;
        });
      const control = controls[0];
      const targetRect = control?.rect || agreementText.rect;
      const point = control
        ? {
            x: targetRect.left + targetRect.width / 2,
            y: targetRect.top + targetRect.height / 2
          }
        : {
            x: Math.max(dialog.rect.left + dialog.rect.width * 0.065, agreementText.rect.left - 34),
            y: agreementCenterY
          };
      const pointTarget = document.elementFromPoint(point.x, point.y);
      const target = control?.element || pointTarget || agreementText.element.closest("label") || agreementText.element;

      dispatchClick(target, point);
      return true;
    })()`).catch(() => false);
  }

  private async isWechatOriginalRightsConfirmReady(page: Page) {
    return page.evaluate(`(() => {
      const marker = "wechat-original-rights-confirm-ready";
      void marker;
      const visibleElements = Array.from(document.querySelectorAll("button, [role='button'], body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return {
            element,
            rect,
            text: (element.textContent || "").trim(),
            style,
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden"
          };
        })
        .filter(({ visible }) => visible);
      const title = visibleElements
        .filter(({ text }) => text.includes("原创权益"))
        .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
      if (!title) {
        return false;
      }

      const dialogCandidates = [];
      let current = title.element;
      for (let depth = 0; current && depth < 10; depth += 1) {
        const rect = current.getBoundingClientRect();
        const text = (current.textContent || "").trim();
        if (
          text.includes("原创权益") &&
          text.includes("我已阅读并同意") &&
          text.includes("声明原创") &&
          rect.width >= 500 &&
          rect.width <= Math.min(1200, window.innerWidth * 0.85) &&
          rect.height >= 300 &&
          rect.height <= Math.min(820, window.innerHeight * 0.85)
        ) {
          dialogCandidates.push({ element: current, rect });
        }
        current = current.parentElement;
      }
      const dialog = dialogCandidates
        .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
      if (!dialog) {
        return false;
      }

      const textNode = visibleElements
        .filter(({ text, rect }) =>
          text === "声明原创" &&
          rect.left >= dialog.rect.left &&
          rect.right <= dialog.rect.right &&
          rect.top >= dialog.rect.top &&
          rect.bottom <= dialog.rect.bottom
        )
        .sort((a, b) => b.rect.left - a.rect.left || b.rect.top - a.rect.top)[0];
      if (!textNode) {
        return false;
      }

      let button = textNode.element;
      for (let depth = 0; button && depth < 6; depth += 1) {
        const role = button.getAttribute("role") || "";
        const tagName = button.tagName.toLowerCase();
        const rect = button.getBoundingClientRect();
        const text = (button.textContent || "").trim();
        if (
          text.includes("声明原创") &&
          (tagName === "button" || role === "button" || rect.width >= textNode.rect.width + 24 || rect.height >= textNode.rect.height + 12)
        ) {
          break;
        }
        button = button.parentElement;
      }
      if (!button) {
        return false;
      }

      const style = window.getComputedStyle(button);
      const textStyle = window.getComputedStyle(textNode.element);
      const className = typeof button.className === "string" ? button.className : "";
      const ariaDisabled = button.getAttribute("aria-disabled");
      const disabled = button instanceof HTMLButtonElement || button instanceof HTMLInputElement ? button.disabled : false;
      const textColor = textStyle.color;
      const buttonBackground = style.backgroundColor;
      const looksGray =
        /rgb\\(\\s*1[6-9]\\d\\s*,\\s*1[6-9]\\d\\s*,\\s*1[6-9]\\d\\s*\\)/.test(textColor) ||
        /rgb\\(\\s*2[0-4]\\d\\s*,\\s*2[0-4]\\d\\s*,\\s*2[0-4]\\d\\s*\\)/.test(textColor);
      const looksOrange = /rgb\\(\\s*2(?:4\\d|5[0-5])\\s*,\\s*(?:1[0-8]\\d|9\\d)\\s*,\\s*[0-8]?\\d\\s*\\)/.test(buttonBackground);

      if (looksOrange) {
        return true;
      }

      return !(
        disabled ||
        ariaDisabled === "true" ||
        /disabled/i.test(className) ||
        Number(style.opacity || "1") < 0.6 ||
        style.pointerEvents === "none" ||
        looksGray
      );
    })()`).catch(() => false);
  }

  private async clickWechatOriginalRightsConfirmByDom(page: Page) {
    return page.evaluate(`(() => {
      const marker = "wechat-original-rights-confirm-click";
      void marker;
      const visibleElements = Array.from(document.querySelectorAll("button, [role='button'], body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return {
            element,
            rect,
            text: (element.textContent || "").trim(),
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden"
          };
        })
        .filter(({ visible }) => visible);
      const title = visibleElements
        .filter(({ text }) => text.includes("原创权益"))
        .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
      if (!title) {
        return false;
      }

      const dialogCandidates = [];
      let current = title.element;
      for (let depth = 0; current && depth < 10; depth += 1) {
        const rect = current.getBoundingClientRect();
        const text = (current.textContent || "").trim();
        if (
          text.includes("原创权益") &&
          text.includes("我已阅读并同意") &&
          text.includes("声明原创") &&
          rect.width >= 500 &&
          rect.width <= Math.min(1200, window.innerWidth * 0.85) &&
          rect.height >= 300 &&
          rect.height <= Math.min(820, window.innerHeight * 0.85)
        ) {
          dialogCandidates.push({ element: current, rect });
        }
        current = current.parentElement;
      }
      const dialog = dialogCandidates
        .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
      if (!dialog) {
        return false;
      }

      const target = visibleElements
        .filter(({ text, rect }) =>
          text === "声明原创" &&
          rect.left >= dialog.rect.left &&
          rect.right <= dialog.rect.right &&
          rect.top >= dialog.rect.top &&
          rect.bottom <= dialog.rect.bottom
        )
        .sort((a, b) => b.rect.left - a.rect.left || b.rect.top - a.rect.top)[0];
      if (!target) {
        return false;
      }

      const point = {
        x: target.rect.left + target.rect.width / 2,
        y: target.rect.top + target.rect.height / 2
      };
      const eventInit = {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y
      };
      target.element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
      target.element.dispatchEvent(new MouseEvent("mousedown", eventInit));
      target.element.dispatchEvent(new PointerEvent("pointerup", eventInit));
      target.element.dispatchEvent(new MouseEvent("mouseup", eventInit));
      target.element.dispatchEvent(new MouseEvent("click", eventInit));
      if (target.element instanceof HTMLElement) {
        target.element.click();
      }
      return true;
    })()`).catch(() => false);
  }

  private async waitForWechatOriginalRightsDialogClosed(page: Page) {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      if (!(await this.isWechatOriginalRightsDialogVisible(page))) {
        return true;
      }
      await page.waitForTimeout(150);
    }

    return false;
  }

  private async waitForWechatOriginalRightsDialogOpen(page: Page) {
    const deadline = Date.now() + 2_500;
    while (Date.now() < deadline) {
      if (await this.isWechatOriginalRightsDialogVisible(page)) {
        return true;
      }
      await page.waitForTimeout(150);
    }

    return false;
  }

  private async isWechatOriginalRightsDialogVisible(page: Page) {
    const visibleInPage = await page.evaluate(`(() => {
      const marker = "wechat-original-rights-dialog-visible";
      void marker;
      const explicitDialog = Array.from(document.querySelectorAll(".weui-desktop-dialog"))
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: (element.textContent || "").trim(), style: window.getComputedStyle(element) }))
        .find(({ rect, text, style }) =>
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight &&
          rect.right > 0 &&
          rect.left < window.innerWidth &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0" &&
          text.includes("我已阅读并同意") &&
          text.includes("声明原创")
        );
      if (explicitDialog) {
        return true;
      }

      const elements = Array.from(document.querySelectorAll("body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return {
            element,
            rect,
            text: (element.textContent || "").trim(),
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom > 0 &&
              rect.top < window.innerHeight &&
              rect.right > 0 &&
              rect.left < window.innerWidth &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              style.opacity !== "0"
          };
        })
        .filter(({ visible }) => visible);
      const hasRequiredText = (text) =>
        text.includes("原创权益") && text.includes("我已阅读并同意") && text.includes("声明原创");
      const isPlausibleDialog = (element) => {
        if (element === document.body || element === document.documentElement) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const text = (element.textContent || "").trim();
        return (
          hasRequiredText(text) &&
          rect.width >= 500 &&
          rect.height >= 300 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight &&
          rect.right > 0 &&
          rect.left < window.innerWidth &&
          rect.width <= window.innerWidth * 0.98 &&
          rect.height <= window.innerHeight * 0.98 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0"
        );
      };
      const titles = elements
        .filter(({ text }) => text === "原创权益" || text.includes("原创权益"))
        .sort((a, b) => {
          const aExact = a.text === "原创权益" ? 0 : 1;
          const bExact = b.text === "原创权益" ? 0 : 1;
          const aArea = a.rect.width * a.rect.height;
          const bArea = b.rect.width * b.rect.height;
          return aExact - bExact || aArea - bArea || a.rect.top - b.rect.top;
        });

      for (const title of titles) {
        let current = title.element;
        for (let depth = 0; current && depth < 10; depth += 1) {
          if (isPlausibleDialog(current)) {
            return true;
          }
          current = current.parentElement;
        }
      }

      return false;
    })()`).catch(() => false);
    if (visibleInPage) {
      return true;
    }

    for (const frame of this.getWechatChildFrames(page)) {
      if (await this.isWechatOriginalRightsDialogVisibleInFrame(frame)) {
        return true;
      }
    }

    return false;
  }

  private async isWechatOriginalRightsDialogVisibleInFrame(frame: Frame) {
    return frame.evaluate(`(() => {
      const marker = "wechat-original-rights-frame-visible";
      void marker;
      const elements = Array.from(document.querySelectorAll("body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return {
            element,
            rect,
            text: (element.textContent || "").trim(),
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom > 0 &&
              rect.top < window.innerHeight &&
              rect.right > 0 &&
              rect.left < window.innerWidth &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              style.opacity !== "0"
          };
        })
        .filter(({ visible }) => visible);
      const hasRequiredText = (text) =>
        text.includes("原创权益") && text.includes("我已阅读并同意") && text.includes("声明原创");
      const isPlausibleDialog = (element) => {
        if (element === document.body || element === document.documentElement) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const text = (element.textContent || "").trim();
        return (
          hasRequiredText(text) &&
          rect.width >= 500 &&
          rect.height >= 300 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight &&
          rect.right > 0 &&
          rect.left < window.innerWidth &&
          rect.width <= window.innerWidth * 0.98 &&
          rect.height <= window.innerHeight * 0.98 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0"
        );
      };
      const titles = elements
        .filter(({ text }) => text === "原创权益" || text.includes("原创权益"))
        .sort((a, b) => {
          const aExact = a.text === "原创权益" ? 0 : 1;
          const bExact = b.text === "原创权益" ? 0 : 1;
          const aArea = a.rect.width * a.rect.height;
          const bArea = b.rect.width * b.rect.height;
          return aExact - bExact || aArea - bArea || a.rect.top - b.rect.top;
        });

      for (const title of titles) {
        let current = title.element;
        for (let depth = 0; current && depth < 10; depth += 1) {
          if (isPlausibleDialog(current)) {
            return true;
          }
          current = current.parentElement;
        }
      }

      return false;
    })()`).catch(() => false);
  }

  private getWechatChildFrames(page: Page) {
    try {
      const mainFrame = page.mainFrame();
      return page.frames().filter((frame) => frame !== mainFrame);
    } catch {
      return [];
    }
  }

  private async waitForWechatOriginalDeclarationSelected(page: Page) {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      if (await this.isWechatOriginalDeclarationSelected(page)) {
        return true;
      }
      await page.waitForTimeout(200);
    }

    return false;
  }

  private async isWechatOriginalDeclarationSelected(page: Page) {
    if (await this.isWechatOriginalDeclarationSelectedInContext(page)) {
      return true;
    }

    if (await this.isWechatOriginalDeclarationSelectedInWujie(page)) {
      return true;
    }

    for (const frame of this.getWechatChildFrames(page)) {
      if (await this.isWechatOriginalDeclarationSelectedInContext(frame)) {
        return true;
      }
    }

    return false;
  }

  private async isWechatOriginalDeclarationSelectedInWujie(page: Page) {
    return page.evaluate(`(() => {
      const marker = "wechat-original-declaration-wujie-selected";
      void marker;
      const queryAll = (root, selector) => {
        try {
          return Array.from(root.querySelectorAll(selector));
        } catch {
          return [];
        }
      };
      const isSelected = (element) => {
        const tagName = element.tagName?.toLowerCase?.() || "";
        if (tagName === "input" && typeof element.checked === "boolean") {
          return element.checked;
        }
        if (
          element.classList?.contains("ant-checkbox-checked") ||
          element.closest?.(".ant-checkbox-checked")
        ) {
          return true;
        }
        const ariaChecked = element.getAttribute("aria-checked");
        const ariaSelected = element.getAttribute("aria-selected");
        const ariaPressed = element.getAttribute("aria-pressed");
        const role = element.getAttribute("role") || "";
        const className = typeof element.className === "string" ? element.className : "";
        return (
          ((role === "checkbox" || role === "radio") && ariaChecked === "true") ||
          ((role === "checkbox" || role === "radio") && ariaSelected === "true") ||
          ariaPressed === "true" ||
          /(^|[-_\\s])(checked|selected|active)([-_\\s]|$)/i.test(className)
        );
      };
      const roots = [];
      Array.from(document.querySelectorAll("wujie-app")).forEach((app) => {
        if (app.shadowRoot) {
          roots.push(app.shadowRoot);
        }
        const iframes = [
          ...Array.from(app.querySelectorAll("iframe")),
          ...(app.shadowRoot ? Array.from(app.shadowRoot.querySelectorAll("iframe")) : [])
        ];
        iframes.forEach((iframe) => {
          try {
            if (iframe.contentDocument) {
              roots.push(iframe.contentDocument);
            }
          } catch {
            // Cross-origin Wujie iframes cannot be inspected directly.
          }
        });
      });

      for (const root of roots) {
        const originalRows = queryAll(root, ".form-item.cell-center.post-with-link, .declare-original-checkbox")
          .filter((element) => {
            const text = (element.textContent || "").trim();
            const hasCheckbox = Boolean(element.querySelector(".ant-checkbox, .ant-checkbox-input, .ant-checkbox-wrapper"));
            const hasOriginalSignal =
              text.includes("声明原创") ||
              text.includes("原创声明") ||
              element.classList.contains("declare-original-checkbox") ||
              (text.includes("原创") && hasCheckbox);
            const isDialogText =
              text.includes("原创权益") ||
              text.includes("我已阅读并同意") ||
              text.includes("原创声明须知") ||
              text.includes("使用条款");
            return hasOriginalSignal && !isDialogText;
          });
        for (const row of originalRows) {
          const controls = [
            row,
            ...queryAll(row, "input, [role='checkbox'], [role='radio'], .ant-checkbox, .ant-checkbox-input, .ant-checkbox-wrapper")
          ];
          if (controls.some(isSelected)) {
            return true;
          }
        }
      }

      return false;
    })()`).catch(() => false);
  }

  private async isWechatOriginalDeclarationSelectedInContext(context: Page | Frame) {
    return context.evaluate(`(() => {
      const marker = "wechat-original-declaration-selected";
      void marker;
      const elements = Array.from(document.querySelectorAll("input, [role='checkbox'], [role='radio'], button, label, body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return {
            element,
            rect,
            style,
            text: (element.textContent || "").trim(),
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom > 0 &&
              rect.top < window.innerHeight &&
              rect.right > 0 &&
              rect.left < window.innerWidth &&
              style.display !== "none" &&
              style.visibility !== "hidden"
          };
        })
        .filter(({ visible }) => visible);
      const isInRightsDialogText = (text) =>
        text.includes("原创权益") || text.includes("我已阅读并同意") || text.includes("原创声明须知") || text.includes("使用条款");
      const isSelected = (element) => {
        if (element instanceof HTMLInputElement) {
          return element.checked;
        }
        if (
          element.classList?.contains("ant-checkbox-checked") ||
          element.closest?.(".ant-checkbox-checked")
        ) {
          return true;
        }
        const ariaChecked = element.getAttribute("aria-checked");
        const ariaSelected = element.getAttribute("aria-selected");
        const ariaPressed = element.getAttribute("aria-pressed");
        const role = element.getAttribute("role") || "";
        const className = typeof element.className === "string" ? element.className : "";
        return (
          ((role === "checkbox" || role === "radio") && ariaChecked === "true") ||
          ((role === "checkbox" || role === "radio") && ariaSelected === "true") ||
          ariaPressed === "true" ||
          /(^|[-_\\s])(checked|selected|active)([-_\\s]|$)/i.test(className)
        );
      };
      const looksSelected = (item) => {
        if (isSelected(item.element)) {
          return true;
        }
        const style = window.getComputedStyle(item.element);
        const color = style.color;
        const background = style.backgroundColor;
        const borderColor = style.borderColor;
        return (
          /rgb\\(\\s*2(?:4\\d|5[0-5])\\s*,\\s*(?:1[0-8]\\d|9\\d)\\s*,\\s*[0-8]?\\d\\s*\\)/.test(background) ||
          /rgb\\(\\s*2(?:4\\d|5[0-5])\\s*,\\s*(?:1[0-8]\\d|9\\d)\\s*,\\s*[0-8]?\\d\\s*\\)/.test(borderColor) ||
          /rgb\\(\\s*2(?:4\\d|5[0-5])\\s*,\\s*(?:1[0-8]\\d|9\\d)\\s*,\\s*[0-8]?\\d\\s*\\)/.test(color)
        );
      };
      const labels = elements
        .filter(({ text }) => !isInRightsDialogText(text))
        .filter(({ text }) => text === "原创" || text === "声明原创" || text === "原创声明" || text.includes("声明原创"))
        .sort((a, b) => {
          const aExact = a.text === "原创" || a.text === "声明原创" || a.text === "原创声明" ? 0 : 1;
          const bExact = b.text === "原创" || b.text === "声明原创" || b.text === "原创声明" ? 0 : 1;
          const aArea = a.rect.width * a.rect.height;
          const bArea = b.rect.width * b.rect.height;
          return aExact - bExact || aArea - bArea || a.rect.top - b.rect.top;
        });

      for (const label of labels) {
        const labelCenterY = label.rect.top + label.rect.height / 2;
        const antCheckboxes = Array.from(document.querySelectorAll(".ant-checkbox, .ant-checkbox-input, .ant-checkbox-wrapper"))
          .map((element) => ({ element, rect: element.getBoundingClientRect(), text: (element.textContent || "").trim() }))
          .filter(({ rect }) =>
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.top < window.innerHeight &&
            rect.right > 0 &&
            rect.left < window.innerWidth
          )
          .filter(({ text }) => !isInRightsDialogText(text))
          .filter(({ rect }) => Math.abs((rect.top + rect.height / 2) - labelCenterY) < 56)
          .filter(({ rect }) => rect.left > label.rect.right && rect.left < label.rect.right + 260);
        if (antCheckboxes.some(({ element }) => isSelected(element))) {
          return true;
        }

        if (looksSelected(label)) {
          return true;
        }

        const nearbyControls = elements
          .filter(({ element, rect, text }) => element !== label.element && !isInRightsDialogText(text))
          .filter(({ element, rect }) => {
            const role = element.getAttribute("role") || "";
            const tagName = element.tagName.toLowerCase();
            return (
              (tagName === "input" || role === "checkbox" || role === "radio" || role === "button" || rect.width <= 88) &&
              rect.width >= 8 &&
              rect.width <= 120 &&
              rect.height >= 8 &&
              rect.height <= 80 &&
              Math.abs((rect.top + rect.height / 2) - labelCenterY) < 48 &&
              rect.right <= label.rect.right + 56 &&
              rect.left <= label.rect.right + 24
            );
          });

        if (nearbyControls.some(looksSelected)) {
          return true;
        }

        const containers = [];
        let current = label.element;
        for (let depth = 0; current && depth < 5; depth += 1) {
          containers.push(current);
          current = current.parentElement;
        }
        if (containers.some((container) => looksSelected({ element: container }))) {
          return true;
        }
      }

      return false;
    })()`).catch(() => false);
  }

  async submitPublish({ page, step }: PublishContext) {
    await step("提交视频号立即发表");
    const clickedBottomPublish = await this.clickBottomWechatPublishButton(page);
    const clicked = clickedBottomPublish || (await this.tryClickByExactText(page, ["发表"], 5_000));
    if (!clicked) {
      throw new Error("未找到视频号最下方发表按钮");
    }

    await this.waitForPublishSubmitted(page);
  }

  async setCover({ task, page, step }: PublishContext) {
    await this.ensureWechatChannelsViewport(page);
    await step("设置视频号 4:3 分享卡片封面");
    await this.setWechatCover43Card(page, task.cover43Path);
    await this.waitForWechatCoverPreviewPage(page);

    await step("设置视频号 3:4 个人主页卡片封面");
    await this.setWechatCover34Card(page, task.cover34Path);
  }

  private async setWechatCover34Card(page: Page, filePath: string) {
    const label = "个人主页卡片";
    const ratio = "3:4";
    const editorPage = await this.openWechatCoverEditorByLabel(page, label, (candidatePage) =>
      this.clickWechatCoverUseMaterialUntilEditor(candidatePage)
    );
    if (!editorPage) {
      throw new Error(`未能打开视频号${ratio}封面编辑页：${label}`);
    }

    await this.uploadWechatCoverInEditor(page, editorPage, label, filePath, ratio);
  }

  private async setWechatCover43Card(page: Page, filePath: string) {
    const label = "分享卡片";
    const ratio = "4:3";
    await this.waitForWechatCoverPreviewPage(page);
    const editorPage = await this.openWechatCoverEditorByLabel(page, label, (candidatePage) =>
      this.clickWechatCoverUseMaterialUntilEditor(candidatePage)
    );
    if (!editorPage) {
      throw new Error(`未能打开视频号${ratio}封面编辑页：${label}`);
    }

    await this.uploadWechatCoverInEditor(page, editorPage, label, filePath, ratio);
  }

  private async uploadWechatCoverInEditor(
    page: Page,
    editorPage: Page,
    label: string,
    filePath: string,
    ratio: "3:4" | "4:3"
  ) {
    await this.fitWechatCoverEditorIntoViewport(editorPage);
    const uploaded = await this.uploadWechatCoverFromEditor(editorPage, filePath);
    if (!uploaded) {
      throw new Error(`未找到视频号${ratio}封面编辑页里的上传封面按钮：${label}`);
    }

    await this.clickWechatCoverEditorDone(editorPage);
    await page.waitForTimeout(500);
  }

  private async openWechatCoverEditorByLabel(
    page: Page,
    label: string,
    afterClick?: (page: Page) => Promise<boolean>
  ) {
    const clickedByDom = await this.clickWechatCoverEditByDom(page, label);
    if (clickedByDom && (await this.resolveWechatCoverEditorAfterClick(page, afterClick))) {
      return page;
    }

    const labelBoxes = await this.collectVisibleTextBoxes(page, label);
    for (const box of labelBoxes) {
      const targets = [
        ...(await this.findWechatCoverEditTextTargets(page, box)),
        { x: box.centerX, y: Math.max(0, box.y - 44) },
        { x: box.centerX, y: Math.max(0, box.y - 72) }
      ];

      for (const target of targets) {
        const popupPromise = page.waitForEvent("popup", { timeout: 500 }).catch(() => undefined);
        try {
          await page.mouse.click(target.x, target.y);
          await page.waitForTimeout(300);
          const popup = await Promise.race([
            popupPromise,
            page.waitForTimeout(150).then(() => undefined)
          ]);
          if (popup) {
            await popup.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
            await this.ensureWechatChannelsViewport(popup);
            if (await this.resolveWechatCoverEditorAfterClick(popup, afterClick)) {
              return popup;
            }
          }
          if (await this.resolveWechatCoverEditorAfterClick(page, afterClick)) {
            return page;
          }
        } catch {
          // Try the next likely edit position.
        }
      }
    }

    return undefined;
  }

  private async resolveWechatCoverEditorAfterClick(
    page: Page,
    afterClick?: (page: Page) => Promise<boolean>
  ) {
    if (afterClick && (await afterClick(page))) {
      return true;
    }

    return this.waitForWechatCoverEditor(page);
  }

  private async openWechatCoverEditorByRatioContainer(
    page: Page,
    ratio: "4:3",
    afterClick?: (page: Page) => Promise<boolean>
  ) {
    const clickedByDom = await this.clickWechatCoverContainerByDom(page, ratio);
    if (clickedByDom && (await this.resolveWechatCoverEditorAfterClick(page, afterClick))) {
      return page;
    }

    const target = await this.findWechatCoverEditPointByContainer(page, ratio);
    if (!target) {
      return undefined;
    }

    return this.clickWechatCoverEditorPoint(page, target, afterClick);
  }

  private async clickWechatCoverContainerByDom(page: Page, ratio: "4:3") {
    return page.evaluate(`(() => {
      const marker = "wechat-cover-container-dom-click";
      void marker;
      const targetRatio = ${JSON.stringify(ratio)};
      const visibleItems = Array.from(document.querySelectorAll("body *"))
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: (element.textContent || "").trim() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0);
      const ratioLabel = visibleItems
        .filter(({ text, rect }) => text === targetRatio && rect.width <= 90 && rect.height <= 60)
        .sort((a, b) => a.rect.left - b.rect.left)[0];
      if (!ratioLabel) {
        return false;
      }

      const centerX = (ratioLabel.rect.left + ratioLabel.rect.right) / 2;
      const card = visibleItems
        .filter(({ rect }) =>
          rect.width >= 80 &&
          rect.height >= 60 &&
          rect.bottom <= ratioLabel.rect.top + 16 &&
          ratioLabel.rect.top - rect.top < 240 &&
          Math.abs((rect.left + rect.right) / 2 - centerX) < 180
        )
        .sort((a, b) => {
          const aDistance = Math.abs((a.rect.left + a.rect.right) / 2 - centerX);
          const bDistance = Math.abs((b.rect.left + b.rect.right) / 2 - centerX);
          const aArea = a.rect.width * a.rect.height;
          const bArea = b.rect.width * b.rect.height;
          return aDistance - bDistance || bArea - aArea;
        })[0];
      if (!card) {
        return false;
      }

      const clickTargets = [card.element, card.element.parentElement, card.element.parentElement?.parentElement]
        .filter(Boolean);
      for (const target of clickTargets) {
        const rect = target.getBoundingClientRect();
        const eventInit = {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2
        };
        target.dispatchEvent(new PointerEvent("pointerdown", eventInit));
        target.dispatchEvent(new MouseEvent("mousedown", eventInit));
        target.dispatchEvent(new PointerEvent("pointerup", eventInit));
        target.dispatchEvent(new MouseEvent("mouseup", eventInit));
        target.dispatchEvent(new MouseEvent("click", eventInit));
      }
      return true;
    })()`).catch(() => false);
  }

  private async clickWechatCoverEditorPoint(
    page: Page,
    target: { x: number; y: number },
    afterClick?: (page: Page) => Promise<boolean>
  ) {
    const popupPromise = page.waitForEvent("popup", { timeout: 500 }).catch(() => undefined);
    try {
      await page.mouse.click(target.x, target.y);
      await page.waitForTimeout(300);
      const popup = await Promise.race([
        popupPromise,
        page.waitForTimeout(150).then(() => undefined)
      ]);
      if (popup) {
        await popup.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
        await this.ensureWechatChannelsViewport(popup);
        if (await this.resolveWechatCoverEditorAfterClick(popup, afterClick)) {
          return popup;
        }
      }
      if (await this.resolveWechatCoverEditorAfterClick(page, afterClick)) {
        return page;
      }
    } catch {
      // Try the next likely edit position.
    }

    return undefined;
  }

  private async waitForWechatCoverPreviewPage(page: Page) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const visible = await this.isWechatCoverPreviewPageVisible(page);
      if (visible) {
        return;
      }
      await page.waitForTimeout(300);
    }
  }

  private async isWechatCoverPreviewPageVisible(page: Page) {
    return page.evaluate(`(() => {
      const marker = "wechat-cover-preview-page-visible";
      void marker;
      const visibleText = Array.from(document.querySelectorAll("body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          if (
            rect.width <= 0 ||
            rect.height <= 0 ||
            style.display === "none" ||
            style.visibility === "hidden"
          ) {
            return "";
          }
          return (element.textContent || "").trim();
        })
        .filter(Boolean)
        .join("\\n");
      return visibleText.includes("封面预览") && visibleText.includes("3:4") && visibleText.includes("4:3");
    })()`).catch(() => false);
  }

  private async clickWechatCoverEditByContainer(page: Page, ratio: "3:4" | "4:3") {
    const point = await this.findWechatCoverEditPointByContainer(page, ratio);
    if (!point) {
      return false;
    }

    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(300);
    return true;
  }

  private async findWechatCoverEditPointByContainer(page: Page, ratio: "3:4" | "4:3") {
    return page.evaluate<{ x: number; y: number } | undefined>(`(() => {
      const marker = "wechat-cover-edit-container-target";
      void marker;
      const targetRatio = ${JSON.stringify(ratio)};
      const elements = Array.from(document.querySelectorAll("body *"))
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: (element.textContent || "").trim() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0);
      const preview = elements
        .filter(({ text }) => text.includes("封面预览"))
        .sort((a, b) => a.rect.top - b.rect.top)[0];
      const ratioLabels = elements
        .filter(({ text }) => text === "3:4" || text === "4:3")
        .filter(({ rect }) => rect.width <= 90 && rect.height <= 60)
        .filter(({ rect }) => !preview || Math.abs(rect.top - preview.rect.top) < 260)
        .sort((a, b) => a.rect.left - b.rect.left);
      const targetLabel = ratioLabels.find(({ text }) => text === targetRatio);
      if (!targetLabel) {
        return undefined;
      }

      const centerX = (targetLabel.rect.left + targetLabel.rect.right) / 2;
      const cardCandidates = elements
        .filter(({ rect }) =>
          rect.width >= 80 &&
          rect.height >= 60 &&
          rect.bottom <= targetLabel.rect.top + 16 &&
          targetLabel.rect.top - rect.top < 240 &&
          Math.abs((rect.left + rect.right) / 2 - centerX) < 180
        )
        .sort((a, b) => {
          const aDistance = Math.abs((a.rect.left + a.rect.right) / 2 - centerX);
          const bDistance = Math.abs((b.rect.left + b.rect.right) / 2 - centerX);
          const aArea = a.rect.width * a.rect.height;
          const bArea = b.rect.width * b.rect.height;
          return aDistance - bDistance || bArea - aArea;
        });
      const target = cardCandidates[0];
      if (!target) {
        return undefined;
      }

      return {
        x: (target.rect.left + target.rect.right) / 2,
        y: (target.rect.top + target.rect.bottom) / 2
      };
    })()`).catch(() => undefined);
  }

  private async clickWechatCoverEditByDom(page: Page, label: string) {
    return page.evaluate(`(() => {
      const marker = "wechat-cover-edit-dom-click";
      void marker;
      const labelText = ${JSON.stringify(label)};
      const elements = Array.from(document.querySelectorAll("body *"))
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: (element.textContent || "").trim() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0);
      const labelCandidates = elements
        .filter(({ text }) => text === labelText || text.includes(labelText))
        .sort((a, b) => {
          const aExact = a.text === labelText ? 0 : 1;
          const bExact = b.text === labelText ? 0 : 1;
          const aArea = a.rect.width * a.rect.height;
          const bArea = b.rect.width * b.rect.height;
          return aExact - bExact || aArea - bArea || a.rect.top - b.rect.top;
        });
      const labelTarget = labelCandidates[0];
      if (!labelTarget) {
        return false;
      }

      const labelCenterX = labelTarget.rect.left + labelTarget.rect.width / 2;
      const editCandidates = elements
        .filter(({ text }) => text === "编辑" || text.includes("编辑"))
        .filter(({ rect }) => rect.bottom <= labelTarget.rect.top + 12)
        .filter(({ rect }) => labelTarget.rect.top - rect.top < 180)
        .filter(({ rect }) => Math.abs((rect.left + rect.right) / 2 - labelCenterX) < 220)
        .sort((a, b) => {
          const aDistance = Math.abs((a.rect.left + a.rect.right) / 2 - labelCenterX);
          const bDistance = Math.abs((b.rect.left + b.rect.right) / 2 - labelCenterX);
          return aDistance - bDistance || b.rect.top - a.rect.top;
        });
      const target = editCandidates[0]?.element;
      if (!target) {
        return false;
      }

      const rect = target.getBoundingClientRect();
      const eventInit = {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      };
      target.dispatchEvent(new PointerEvent("pointerdown", eventInit));
      target.dispatchEvent(new MouseEvent("mousedown", eventInit));
      target.dispatchEvent(new PointerEvent("pointerup", eventInit));
      target.dispatchEvent(new MouseEvent("mouseup", eventInit));
      target.dispatchEvent(new MouseEvent("click", eventInit));
      return true;
    })()`);
  }

  private async findWechatCoverEditTextTargets(page: Page, labelBox: TextBox) {
    const editBoxes = await this.collectVisibleTextBoxes(page, "编辑");
    return editBoxes
      .filter((editBox) => editBox.centerY < labelBox.centerY)
      .filter((editBox) => labelBox.centerY - editBox.centerY < 150)
      .filter((editBox) => Math.abs(editBox.centerX - labelBox.centerX) < 180)
      .sort((a, b) => Math.abs(a.centerX - labelBox.centerX) - Math.abs(b.centerX - labelBox.centerX))
      .map((editBox) => ({ x: editBox.centerX, y: editBox.centerY }));
  }

  private async waitForWechatCoverEditor(page: Page) {
    const editorTexts = ["上传封面", "裁剪封面", "确认", "确定"];
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      for (const text of editorTexts) {
        try {
          await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 200 });
          return true;
        } catch {
          // Try the next editor marker.
        }
      }
      await page.waitForTimeout(100);
    }

    return false;
  }

  private async clickWechatCoverUseMaterialIfVisible(page: Page) {
    const deadline = Date.now() + 3_000;
    let loggedNoDomTarget = false;
    while (Date.now() < deadline) {
      const point = await page.evaluate<WechatCoverUseMaterialClickTarget | undefined>(`(() => {
        const marker = "wechat-cover-use-material-click";
        void marker;
        const toRect = (rect: DOMRect) => ({
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom)
        });
        const describeHit = (x, y) => {
          const element = document.elementFromPoint(x, y);
          if (!element) {
            return undefined;
          }
          const rect = element.getBoundingClientRect();
          return {
            tagName: element.tagName.toLowerCase(),
            text: (element.textContent || "").trim().slice(0, 120),
            role: element.getAttribute("role") || "",
            rect: toRect(rect),
            className: typeof element.className === "string" ? element.className.slice(0, 160) : ""
          };
        };
        const visibleElements = Array.from(document.querySelectorAll("button, [role='button'], body *"))
          .map((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return {
              element,
              rect,
              text: (element.textContent || "").trim(),
              visible:
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== "none" &&
                style.visibility !== "hidden"
            };
          })
          .filter(({ visible }) => visible);
        const hasPrompt = visibleElements.some(({ text }) => text.includes("使用此素材作为封面"));
        if (!hasPrompt) {
          return undefined;
        }

        const prompt = visibleElements
          .filter(({ text }) => text.includes("使用此素材作为封面"))
          .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
        if (!prompt) {
          return undefined;
        }

        const findDialogRoot = () => {
          let current = prompt.element;
          let best = undefined;
          for (let depth = 0; current && depth < 10; depth += 1) {
            const rect = current.getBoundingClientRect();
            const text = (current.textContent || "").trim();
            const looksLikeDialog =
              text.includes("使用此素材作为封面") &&
              text.includes("直接编辑") &&
              text.includes("使用素材") &&
              rect.width >= 320 &&
              rect.width <= 900 &&
              rect.height >= 220 &&
              rect.height <= 760;
            if (looksLikeDialog) {
              best = { element: current, rect };
            }
            current = current.parentElement;
          }
          return best;
        };
        const dialog = findDialogRoot();
        if (dialog) {
          const x = dialog.rect.left + dialog.rect.width * 0.72;
          const y = dialog.rect.top + dialog.rect.height * 0.82;
          return {
            x,
            y,
            strategy: "dialog-ratio-0.72-0.82",
            viewport: { width: window.innerWidth, height: window.innerHeight },
            dialog: toRect(dialog.rect),
            prompt: toRect(prompt.rect),
            hit: describeHit(x, y)
          };
        }

        const inDialog = (rect) => {
          if (!dialog) {
            return true;
          }
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          return (
            centerX >= dialog.rect.left &&
            centerX <= dialog.rect.right &&
            centerY >= dialog.rect.top &&
            centerY <= dialog.rect.bottom
          );
        };
        const getButtonCandidate = (element) => {
          const textRect = element.getBoundingClientRect();
          let current = element;
          let best = undefined;
          for (let depth = 0; current && depth < 8; depth += 1) {
            const rect = current.getBoundingClientRect();
            const text = (current.textContent || "").trim();
            const style = window.getComputedStyle(current);
            const role = current.getAttribute("role") || "";
            const tagName = current.tagName.toLowerCase();
            const textCenterX = textRect.left + textRect.width / 2;
            const textCenterY = textRect.top + textRect.height / 2;
            const containsTextCenter =
              textCenterX >= rect.left &&
              textCenterX <= rect.right &&
              textCenterY >= rect.top &&
              textCenterY <= rect.bottom;
            const isButtonSized =
              rect.width >= 96 &&
              rect.width <= 260 &&
              rect.height >= 38 &&
              rect.height <= 88;
            const hasVisibleBackground =
              style.backgroundColor &&
              style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
              style.backgroundColor !== "transparent";
            const looksClickable =
              tagName === "button" ||
              role === "button" ||
              current.onclick ||
              style.cursor === "pointer" ||
              hasVisibleBackground;
            if (
              text.includes("使用素材") &&
              isButtonSized &&
              containsTextCenter &&
              inDialog(rect) &&
              looksClickable
            ) {
              best = {
                element: current,
                rect,
                backgroundColor: style.backgroundColor,
                cursor: style.cursor,
                score:
                  (tagName === "button" || role === "button" ? 100 : 0) +
                  (hasVisibleBackground ? 60 : 0) +
                  (style.cursor === "pointer" ? 30 : 0) +
                  rect.left / 1000
              };
            }
            current = current.parentElement;
          }
          return best;
        };
        const candidates = visibleElements
          .filter(({ text }) => text === "使用素材")
          .map(({ element }) => getButtonCandidate(element))
          .filter(Boolean)
          .sort((a, b) => b.score - a.score || b.rect.left - a.rect.left);
        const target = candidates[0];
        if (!target) {
          const textTarget = visibleElements
            .filter(({ text, rect }) => text === "使用素材" && inDialog(rect))
            .sort((a, b) => b.rect.left - a.rect.left)[0];
          if (!textTarget) {
            return undefined;
          }
          const x = textTarget.rect.left + textTarget.rect.width / 2;
          const y = textTarget.rect.top + textTarget.rect.height / 2;
          return {
            x,
            y,
            strategy: "text-center-fallback",
            viewport: { width: window.innerWidth, height: window.innerHeight },
            prompt: toRect(prompt.rect),
            hit: describeHit(x, y)
          };
        }

        const x = target.rect.left + target.rect.width / 2;
        const y = target.rect.top + target.rect.height / 2;
        return {
          x,
          y,
          strategy: "button-candidate-center",
          viewport: { width: window.innerWidth, height: window.innerHeight },
          prompt: toRect(prompt.rect),
          hit: describeHit(x, y)
        };
      })()`).catch(() => undefined);

      if (point) {
        await this.logWechatCoverUseMaterialClick({
          phase: "before-click",
          point
        });
        await page.mouse.click(point.x, point.y);
        const domClick = await this.clickWechatCoverUseMaterialPointByDom(page, point);
        await this.logWechatCoverUseMaterialClick({
          phase: "after-click",
          point,
          domClick
        });
        await page.waitForTimeout(500);
        return true;
      }

      if (!loggedNoDomTarget) {
        loggedNoDomTarget = true;
        await this.logWechatCoverUseMaterialClick({
          phase: "dom-target-not-found"
        });
      }

      const clickedByLocator = await this.clickWechatCoverUseMaterialByLocator(page);
      if (clickedByLocator) {
        await page.waitForTimeout(500);
        return true;
      }

      await page.waitForTimeout(100);
    }

    return false;
  }

  private async clickWechatCoverUseMaterialByLocator(page: Page) {
    const candidates = [
      page.getByRole("button", { name: /^使用素材$/ }).first(),
      page.locator('button:has-text("使用素材")').first(),
      page.locator('[role="button"]:has-text("使用素材")').first(),
      page.getByText("使用素材", { exact: true }).first()
    ];

    for (const [index, candidate] of candidates.entries()) {
      try {
        await candidate.waitFor({ state: "visible", timeout: 500 });
        const box = await candidate.boundingBox({ timeout: 500 }).catch(() => null);
        await this.logWechatCoverUseMaterialClick({
          phase: "locator-before-click",
          locatorIndex: index,
          box
        });
        await candidate.click({ timeout: 1_000, force: true });
        await this.logWechatCoverUseMaterialClick({
          phase: "locator-after-click",
          locatorIndex: index,
          box
        });
        return true;
      } catch (error) {
        await this.logWechatCoverUseMaterialClick({
          phase: "locator-click-failed",
          locatorIndex: index,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return false;
  }

  private async clickWechatCoverUseMaterialPointByDom(page: Page, point: { x: number; y: number }) {
    return page.evaluate(
      ({ x, y }) => {
        const marker = "wechat-cover-use-material-point-click";
        void marker;
        const toRect = (rect: DOMRect) => ({
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom)
        });
        const describe = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return {
            tagName: element.tagName.toLowerCase(),
            text: (element.textContent || "").trim().slice(0, 120),
            role: element.getAttribute("role") || "",
            rect: toRect(rect),
            className: typeof element.className === "string" ? element.className.slice(0, 160) : ""
          };
        };
        const start = document.elementFromPoint(x, y);
        if (!start) {
          return { clicked: false, reason: "elementFromPoint returned null" };
        }

        const dispatchClick = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const eventInit = {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y
          };
          element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
          element.dispatchEvent(new MouseEvent("mousedown", eventInit));
          element.dispatchEvent(new PointerEvent("pointerup", eventInit));
          element.dispatchEvent(new MouseEvent("mouseup", eventInit));
          element.dispatchEvent(new MouseEvent("click", eventInit));
          if (element instanceof HTMLElement) {
            element.click();
          }
          return {
            clicked: rect.width > 0 && rect.height > 0,
            start: describe(start),
            target: describe(element)
          };
        };

        let current: Element | null = start;
        for (let depth = 0; current && depth < 8; depth += 1) {
          const text = (current.textContent || "").trim();
          const role = current.getAttribute("role") || "";
          const tagName = current.tagName.toLowerCase();
          const style = window.getComputedStyle(current);
          const rect = current.getBoundingClientRect();
          const looksLikeButton =
            tagName === "button" ||
            role === "button" ||
            style.cursor === "pointer" ||
            (rect.width >= 90 && rect.width <= 280 && rect.height >= 36 && rect.height <= 100);
          if (text.includes("使用素材") && looksLikeButton) {
            return dispatchClick(current);
          }
          current = current.parentElement;
        }

        return dispatchClick(start);
      },
      point
    ).catch((error) => ({ clicked: false, reason: error instanceof Error ? error.message : String(error) }));
  }

  private async logWechatCoverUseMaterialClick(event: Record<string, unknown>) {
    const entry = {
      time: new Date().toISOString(),
      platform: this.platform,
      ...event
    };
    const line = JSON.stringify(entry);
    console.info(`[wechat-cover-use-material] ${line}`);
    await fs
      .mkdir(dataDir, { recursive: true })
      .then(() => fs.appendFile(path.join(dataDir, "wechat-cover-clicks.jsonl"), `${line}\n`))
      .catch(() => undefined);
  }

  private async clickWechatCoverUseMaterialUntilEditor(page: Page) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const clicked = await this.clickWechatCoverUseMaterialIfVisible(page);
      if (!clicked) {
        await this.logWechatCoverUseMaterialClick({
          phase: "attempt-finished",
          attempt: attempt + 1,
          clicked: false,
          editorVisible: false
        });
        return false;
      }

      if (await this.waitForWechatCoverEditor(page)) {
        await this.logWechatCoverUseMaterialClick({
          phase: "attempt-finished",
          attempt: attempt + 1,
          clicked: true,
          editorVisible: true
        });
        return true;
      }

      await this.logWechatCoverUseMaterialClick({
        phase: "attempt-finished",
        attempt: attempt + 1,
        clicked: true,
        editorVisible: false
      });
    }

    return false;
  }

  private async uploadWechatCoverFromEditor(page: Page, filePath: string) {
    const uploadedByBox = await this.clickWechatCoverUploadBox(page, filePath);
    if (uploadedByBox) {
      return true;
    }

    return this.tryUploadFileViaChooser(
      page,
      ["上传封面", "本地上传", "上传图片", "上传本地图片", "从本地上传", "选择图片"],
      filePath
    );
  }

  private async clickWechatCoverUploadBox(page: Page, filePath: string) {
    const labelBoxes = await this.collectVisibleTextBoxes(page, "上传封面");
    for (const box of labelBoxes) {
      const targets = [
        { x: box.centerX, y: Math.max(0, box.y - 42) },
        { x: box.centerX, y: Math.max(0, box.y - 72) }
      ];

      for (const target of targets) {
        const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 2_000 }).catch(() => undefined);
        try {
          await page.mouse.click(target.x, target.y);
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

    return this.clickWechatCoverUploadBoxByDom(page, filePath);
  }

  private async clickWechatCoverUploadBoxByDom(page: Page, filePath: string) {
    const point = await page.evaluate<{ x: number; y: number } | undefined>(`(() => {
      const marker = "wechat-cover-upload-box-point";
      void marker;
      const labels = Array.from(document.querySelectorAll("body *"))
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: (element.textContent || "").trim() }))
        .filter(({ rect, text }) => rect.width > 0 && rect.height > 0 && text === "上传封面");
      const label = labels[0];
      if (!label) {
        return undefined;
      }

      const candidates = Array.from(document.querySelectorAll("body *"))
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) =>
          rect.width >= 40 &&
          rect.height >= 40 &&
          rect.left <= label.rect.right + 20 &&
          rect.right >= label.rect.left - 20 &&
          rect.bottom <= label.rect.top + 10 &&
          rect.bottom >= label.rect.top - 160
        )
        .sort((a, b) => {
          const aDistance = Math.abs((a.rect.left + a.rect.right) / 2 - (label.rect.left + label.rect.right) / 2);
          const bDistance = Math.abs((b.rect.left + b.rect.right) / 2 - (label.rect.left + label.rect.right) / 2);
          return aDistance - bDistance || b.rect.width * b.rect.height - a.rect.width * a.rect.height;
        });
      const target = candidates[0];
      if (!target) {
        return undefined;
      }

      return {
        x: target.rect.left + target.rect.width / 2,
        y: target.rect.top + target.rect.height / 2
      };
    })()`);

    if (!point) {
      return false;
    }

    const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 2_000 }).catch(() => undefined);
    await page.mouse.click(point.x, point.y);
    const fileChooser = await fileChooserPromise;
    if (!fileChooser) {
      return false;
    }

    await fileChooser.setFiles(filePath);
    return true;
  }

  private async clickWechatCoverEditorDone(page: Page) {
    await this.fitWechatCoverEditorIntoViewport(page);
    await this.scrollWechatCoverEditorConfirmIntoView(page);
    const clicked =
      (await this.clickWechatCoverEditorConfirmByDom(page)) ||
      (await this.clickWechatCoverEditorConfirmByText(page));
    if (!clicked) {
      throw new Error("视频号封面编辑页未找到确认按钮");
    }
  }

  private async ensureWechatChannelsViewport(page: Page) {
    await maximizePageWindow(page);
    await page.evaluate(`(() => {
      const marker = "wechat-publish-page-viewport-reset";
      void marker;
      document.documentElement.style.zoom = "";
      document.body.style.zoom = "";
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      return true;
    })()`).catch(() => undefined);
  }

  private async fitWechatCoverEditorIntoViewport(page: Page) {
    await page.evaluate(`(() => {
      const marker = "wechat-cover-editor-fit";
      void marker;
      const scale = 0.78;
      const candidates = Array.from(document.querySelectorAll("body *"))
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: (element.textContent || "").trim() }))
        .filter(({ rect, text }) =>
          rect.width > 500 &&
          rect.height > window.innerHeight * 0.75 &&
          (text.includes("编辑个人主页卡片") || text.includes("编辑分享卡片") || text.includes("上传封面"))
        )
        .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
      const dialog = candidates[0]?.element;
      if (dialog) {
        dialog.style.transformOrigin = "top center";
        dialog.style.transform = "scale(" + scale + ")";
        dialog.style.maxHeight = "none";
      }
      document.documentElement.style.overflow = "visible";
      document.body.style.overflow = "visible";
      return Boolean(dialog);
    })()`).catch(() => undefined);
  }

  private async scrollWechatCoverEditorConfirmIntoView(page: Page) {
    await page.evaluate(`(() => {
      const marker = "wechat-cover-confirm-scroll";
      void marker;
      window.scrollTo(0, document.documentElement.scrollHeight);
      for (const element of Array.from(document.querySelectorAll("body *"))) {
        if (element.scrollHeight > element.clientHeight + 4) {
          element.scrollTop = element.scrollHeight;
        }
      }
      const texts = ["确认", "确定", "完成", "保存"];
      const candidates = Array.from(document.querySelectorAll("button, [role='button'], body *"))
        .filter((element) => texts.includes((element.textContent || "").trim()))
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0)
        .sort((a, b) => b.rect.bottom - a.rect.bottom);
      const target = candidates[0]?.element;
      if (!target) {
        return false;
      }

      target.scrollIntoView({ block: "center", inline: "center" });
      return true;
    })()`).catch(() => undefined);
  }

  private async clickWechatCoverEditorConfirmByDom(page: Page) {
    const point = await page.evaluate<{ x: number; y: number } | undefined>(`(() => {
      const marker = "wechat-cover-confirm-dom-click";
      void marker;
      const texts = ["确认", "确定", "完成", "保存"];
      const editorMarkers = ["编辑个人主页卡片", "编辑分享卡片", "上传封面", "裁剪封面"];
      const visibleElements = Array.from(document.querySelectorAll("body *"))
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: (element.textContent || "").trim() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0);
      const editorRoot = visibleElements
        .filter(({ rect, text }) =>
          rect.width > 280 &&
          rect.height > 240 &&
          editorMarkers.some((markerText) => text.includes(markerText))
        )
        .sort((a, b) => {
          const aArea = a.rect.width * a.rect.height;
          const bArea = b.rect.width * b.rect.height;
          return bArea - aArea || b.rect.bottom - a.rect.bottom;
        })[0];
      if (!editorRoot) {
        return false;
      }

      const isInEditorBounds = (rect) => {
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        return (
          centerX >= editorRoot.rect.left - 20 &&
          centerX <= editorRoot.rect.right + 20 &&
          centerY >= editorRoot.rect.top - 20 &&
          centerY <= editorRoot.rect.bottom + 80
        );
      };
      const candidates = [
        ...Array.from(editorRoot.element.querySelectorAll("button, [role='button'], *")),
        ...visibleElements.map(({ element }) => element)
      ]
        .filter((element) => texts.includes((element.textContent || "").trim()))
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0 && isInEditorBounds(rect))
        .sort((a, b) => b.rect.bottom - a.rect.bottom);
      const target = candidates[0]?.element;
      if (!target) {
        return undefined;
      }

      target.scrollIntoView({ block: "center", inline: "center" });
      const rect = target.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    })()`);

    if (!point) {
      return false;
    }

    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(500);
    return true;
  }

  private async clickWechatCoverEditorConfirmByText(page: Page) {
    const boxes = [
      ...(await this.collectVisibleTextBoxes(page, "确认")),
      ...(await this.collectVisibleTextBoxes(page, "确定")),
      ...(await this.collectVisibleTextBoxes(page, "完成")),
      ...(await this.collectVisibleTextBoxes(page, "保存"))
    ].sort((a, b) => b.centerY - a.centerY || b.centerX - a.centerX);
    const target = boxes[0];
    if (!target) {
      return false;
    }

    await page.mouse.click(target.centerX, target.centerY);
    await page.waitForTimeout(500);
    return true;
  }

  private async fillWechatChannelsDescription(page: Page, value: string) {
    const filledBySelector = await this.tryFillFirst(page, this.profile.descriptionInputs, value);
    if (filledBySelector) {
      return true;
    }

    const filledByDom = await this.fillWechatChannelsDescriptionByDom(page, value);
    if (filledByDom) {
      return true;
    }

    return this.fillWechatChannelsDescriptionByLabelClick(page, value);
  }

  private async fillWechatChannelsDescriptionByDom(page: Page, value: string) {
    return page.evaluate(`(() => {
      const marker = "wechat-description-dom-fill";
      void marker;
      const description = ${JSON.stringify(value)};
      const labels = ["视频描述", "描述", "正文", "说点什么"];
      const editSelector = "textarea, input, [contenteditable='true']";
      const elements = Array.from(document.querySelectorAll(editSelector));
      const allElements = Array.from(document.querySelectorAll("body *"));
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const scoreElement = (element) => {
        const text = [
          element.getAttribute("placeholder"),
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("data-placeholder"),
          element.textContent
        ].filter(Boolean).join(" ");
        let score = 0;
        for (const label of labels) {
          if (text.includes(label)) {
            score += 100;
          }
        }

        const rect = element.getBoundingClientRect();
        const nearbyLabel = allElements.find((candidate) => {
          const candidateText = (candidate.textContent || "").trim();
          if (!labels.some((label) => candidateText === label || candidateText.includes(label))) {
            return false;
          }

          const labelRect = candidate.getBoundingClientRect();
          return (
            labelRect.width > 0 &&
            labelRect.height > 0 &&
            labelRect.top <= rect.bottom &&
            labelRect.bottom >= rect.top - 80 &&
            labelRect.left <= rect.right &&
            labelRect.right >= rect.left - 260
          );
        });
        if (nearbyLabel) {
          score += 80;
        }

        return score;
      };
      const candidates = elements
        .filter(isVisible)
        .map((element) => ({ element, score: scoreElement(element) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score);
      const target = candidates[0]?.element;
      if (!target) {
        return false;
      }

      target.focus();
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.value = description;
      } else {
        target.textContent = description;
      }

      target.dispatchEvent(new InputEvent("input", { bubbles: true, data: description, inputType: "insertText" }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
  }

  private async fillWechatChannelsDescriptionByLabelClick(page: Page, value: string) {
    for (const label of ["视频描述", "描述", "正文", "说点什么"]) {
      const boxes = await this.collectVisibleTextBoxes(page, label);
      for (const box of boxes) {
        const targets = [
          { x: box.centerX + 180, y: box.centerY },
          { x: box.centerX, y: box.centerY + 56 }
        ];

        for (const target of targets) {
          try {
            await page.mouse.click(target.x, target.y);
            await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => undefined);
            await page.keyboard.insertText(value);
            await page.waitForTimeout(300);
            return true;
          } catch {
            // Try the next likely description input position.
          }
        }
      }
    }

    return false;
  }

  private async clickBottomWechatPublishButton(page: Page) {
    return page.evaluate(`(() => {
      const candidates = Array.from(document.querySelectorAll("button, [role='button'], body *"))
        .filter((element) => (element.textContent || "").trim() === "发表")
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { element, rect };
        })
        .filter(({ rect }) => rect.width > 0 && rect.height > 0)
        .sort((a, b) => b.rect.bottom - a.rect.bottom);

      const candidate = candidates[0];
      if (!candidate) {
        return false;
      }

      const eventInit = {
        bubbles: true,
        cancelable: true,
        clientX: candidate.rect.left + candidate.rect.width / 2,
        clientY: candidate.rect.top + candidate.rect.height / 2
      };
      candidate.element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
      candidate.element.dispatchEvent(new MouseEvent("mousedown", eventInit));
      candidate.element.dispatchEvent(new PointerEvent("pointerup", eventInit));
      candidate.element.dispatchEvent(new MouseEvent("mouseup", eventInit));
      candidate.element.dispatchEvent(new MouseEvent("click", eventInit));
      return true;
    })()`);
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
          ...box,
          centerX: box.x + box.width / 2,
          centerY: box.y + box.height / 2
        });
      } catch {
        // Ignore hidden cover labels.
      }
    }

    return boxes;
  }
}

function formatWechatChannelsDescription(title: string, tags: string[]) {
  const tagText = formatTags(tags);
  return [title.trim(), tagText].filter(Boolean).join("\n");
}

function toWechatChannelsShortTitle(title: string) {
  const normalized = title.replace(/[，,]/g, " ");
  const chars = Array.from(normalized)
    .filter((char) => isAllowedWechatChannelsShortTitleChar(char))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  return Array.from(chars).slice(0, 16).join("");
}

function isAllowedWechatChannelsShortTitleChar(char: string) {
  if (/[\p{Letter}\p{Number}\s]/u.test(char)) {
    return true;
  }

  return wechatChannelsShortTitleSymbols.has(char);
}
