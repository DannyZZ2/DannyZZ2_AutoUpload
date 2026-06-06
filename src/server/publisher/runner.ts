import type { Platform } from "../../shared/types";
import { getTaskWithRuns, resetRuns, updateRun, updateTaskStatus } from "../db";
import { getPlatformConfig } from "../platformConfig";
import { openPlatformPage } from "./browser";
import { PublisherAutomationError } from "./adapter";
import { getAdapter } from "./registry";

const runningTasks = new Set<string>();
const completedStepLabel = {
  published_immediately: "已立即发布",
  ready_for_manual_publish: "待手动发布"
} as const;

export class PublisherRunner {
  private queue: Promise<unknown> = Promise.resolve();

  enqueueTask(taskId: string) {
    const run = this.queue.then(() => this.runTask(taskId));
    this.queue = run.catch(() => undefined);
    return run;
  }

  async runTask(taskId: string) {
    if (runningTasks.has(taskId)) {
      throw new Error("任务正在执行中");
    }

    runningTasks.add(taskId);
    resetRuns(taskId);
    updateTaskStatus(taskId, "running");

    let hasFailure = false;
    try {
      const task = getTaskWithRuns(taskId);

      for (const platform of task.platforms) {
        updateRun(task.id, platform, {
          status: "running",
          currentStep: "准备发布"
        });

        try {
          const adapter = getAdapter(platform);
          const result = await adapter.publish(task, async (step) => {
            updateRun(task.id, platform, {
              status: "running",
              currentStep: step
            });
          });

          updateRun(task.id, platform, {
            status: result.status,
            currentStep: completedStepLabel[result.status],
            screenshotPath: result.screenshotPath
          });
        } catch (error) {
          hasFailure = true;
          const screenshotPath =
            error instanceof PublisherAutomationError ? error.screenshotPath : undefined;
          const message = error instanceof Error ? error.message : String(error);
          updateRun(task.id, platform, {
            status: "failed",
            currentStep: "发布失败",
            error: message,
            screenshotPath
          });
        }
      }

      updateTaskStatus(task.id, hasFailure ? "failed" : task.autoPublish ? "published_immediately" : "ready_for_manual_publish");
    } finally {
      runningTasks.delete(taskId);
    }

    return getTaskWithRuns(taskId);
  }

  async openLogin(platform: Platform) {
    const config = getPlatformConfig(platform);
    await openPlatformPage(platform, config.publisherUrl);
    return config;
  }
}

export const publisherRunner = new PublisherRunner();
