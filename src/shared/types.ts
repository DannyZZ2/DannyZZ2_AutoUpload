export const platforms = [
  "douyin",
  "bilibili",
  "xiaohongshu",
  "wechat_channels",
  "weibo"
] as const;

export type Platform = (typeof platforms)[number];

export type PublishTaskStatus =
  | "draft"
  | "running"
  | "ready_for_manual_publish"
  | "published_immediately"
  | "failed";

export type PlatformRunStatus =
  | "pending"
  | "running"
  | "ready_for_manual_publish"
  | "published_immediately"
  | "failed";

export type PublishTask = {
  id: string;
  videoPath: string;
  cover34Path: string;
  cover43Path: string;
  cover169Path?: string;
  title: string;
  tags: string[];
  platforms: Platform[];
  autoPublish: boolean;
  status: PublishTaskStatus;
  createdAt: string;
  updatedAt: string;
};

export type PlatformRun = {
  id: string;
  taskId: string;
  platform: Platform;
  status: PlatformRunStatus;
  currentStep: string;
  error?: string;
  screenshotPath?: string;
  createdAt: string;
  updatedAt: string;
};

export type PlatformConfig = {
  id: Platform;
  name: string;
  coverMode: "both" | "3:4" | "4:3" | "16:9" | "4:3 + 16:9";
  publisherUrl: string;
};

export type TaskWithRuns = PublishTask & {
  runs: PlatformRun[];
};

export type CreateTaskResponse = {
  task: TaskWithRuns;
};
