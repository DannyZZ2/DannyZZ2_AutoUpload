import type { Page } from "playwright";
import type { Platform, PlatformRunStatus, PublishTask } from "../../shared/types";

export type AdapterStep = (step: string) => Promise<void> | void;

export type PublishContext = {
  task: PublishTask;
  page: Page;
  step: AdapterStep;
};

export type PublishResult = {
  status: Extract<PlatformRunStatus, "published_immediately">;
  screenshotPath?: string;
};

export interface PlatformPublisherAdapter {
  platform: Platform;
  ensureLogin(context: PublishContext): Promise<void>;
  openPublisher(context: PublishContext): Promise<void>;
  uploadVideo(context: PublishContext): Promise<void>;
  setCover(context: PublishContext): Promise<void>;
  setTitleAndTags(context: PublishContext): Promise<void>;
  setContentDeclaration(context: PublishContext): Promise<void>;
  submitPublish(context: PublishContext): Promise<void>;
  captureFailure(context: PublishContext, error: unknown): Promise<string | undefined>;
  publish(task: PublishTask, step: AdapterStep): Promise<PublishResult>;
}

export class PublisherAutomationError extends Error {
  screenshotPath?: string;

  constructor(message: string, screenshotPath?: string) {
    super(message);
    this.name = "PublisherAutomationError";
    this.screenshotPath = screenshotPath;
  }
}
