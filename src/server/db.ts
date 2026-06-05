import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { dbPath, ensureDataDirs } from "./config";
import type {
  Platform,
  PlatformRun,
  PlatformRunStatus,
  PublishTask,
  PublishTaskStatus,
  TaskWithRuns
} from "../shared/types";

type TaskRow = Omit<PublishTask, "tags" | "platforms"> & {
  tags: string;
  platforms: string;
  cover169Path?: string | null;
};

type RunRow = Omit<PlatformRun, "platform"> & {
  platform: string;
};

ensureDataDirs();

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    videoPath TEXT NOT NULL,
    cover34Path TEXT NOT NULL,
    cover43Path TEXT NOT NULL,
    cover169Path TEXT,
    title TEXT NOT NULL,
    tags TEXT NOT NULL,
    platforms TEXT NOT NULL,
    scheduledAt TEXT NOT NULL,
    status TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS platform_runs (
    id TEXT PRIMARY KEY,
    taskId TEXT NOT NULL,
    platform TEXT NOT NULL,
    status TEXT NOT NULL,
    currentStep TEXT NOT NULL,
    error TEXT,
    screenshotPath TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(taskId) REFERENCES tasks(id)
  );
`);

ensureColumn("tasks", "cover169Path", "TEXT");

export function insertTask(input: {
  id?: string;
  videoPath: string;
  cover34Path: string;
  cover43Path: string;
  cover169Path?: string;
  title: string;
  tags: string[];
  platforms: Platform[];
}) {
  const now = new Date().toISOString();
  const task: PublishTask = {
    id: input.id ?? randomUUID(),
    videoPath: input.videoPath,
    cover34Path: input.cover34Path,
    cover43Path: input.cover43Path,
    cover169Path: input.cover169Path,
    title: input.title,
    tags: input.tags,
    platforms: input.platforms,
    status: "draft",
    createdAt: now,
    updatedAt: now
  };

  db.prepare(`
    INSERT INTO tasks (
      id, videoPath, cover34Path, cover43Path, title, tags, platforms,
      cover169Path, scheduledAt, status, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.id,
    task.videoPath,
    task.cover34Path,
    task.cover43Path,
    task.title,
    JSON.stringify(task.tags),
    JSON.stringify(task.platforms),
    task.cover169Path ?? null,
    now,
    task.status,
    task.createdAt,
    task.updatedAt
  );

  for (const platform of task.platforms) {
    insertPlatformRun(task.id, platform);
  }

  return getTaskWithRuns(task.id);
}

export function listTasks(): TaskWithRuns[] {
  const rows = db.prepare("SELECT * FROM tasks ORDER BY createdAt DESC").all() as TaskRow[];
  return rows.map((row) => ({
    ...mapTask(row),
    runs: listRuns(row.id)
  }));
}

export function getTask(taskId: string) {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as TaskRow | undefined;
  return row ? mapTask(row) : undefined;
}

export function getTaskWithRuns(taskId: string): TaskWithRuns {
  const task = getTask(taskId);
  if (!task) {
    throw new Error(`任务不存在：${taskId}`);
  }
  return { ...task, runs: listRuns(taskId) };
}

export function updateTaskStatus(taskId: string, status: PublishTaskStatus) {
  db.prepare("UPDATE tasks SET status = ?, updatedAt = ? WHERE id = ?").run(
    status,
    new Date().toISOString(),
    taskId
  );
}

export function listRuns(taskId: string): PlatformRun[] {
  const rows = db
    .prepare("SELECT * FROM platform_runs WHERE taskId = ? ORDER BY createdAt ASC")
    .all(taskId) as RunRow[];
  return rows.map(mapRun);
}

export function updateRun(
  taskId: string,
  platform: Platform,
  patch: {
    status?: PlatformRunStatus;
    currentStep?: string;
    error?: string;
    screenshotPath?: string;
  }
) {
  const run = db
    .prepare("SELECT * FROM platform_runs WHERE taskId = ? AND platform = ?")
    .get(taskId, platform) as RunRow | undefined;
  if (!run) {
    throw new Error(`平台任务不存在：${taskId}/${platform}`);
  }

  const hasError = Object.prototype.hasOwnProperty.call(patch, "error");
  const hasScreenshot = Object.prototype.hasOwnProperty.call(patch, "screenshotPath");

  db.prepare(`
    UPDATE platform_runs
    SET status = ?, currentStep = ?, error = ?, screenshotPath = ?, updatedAt = ?
    WHERE taskId = ? AND platform = ?
  `).run(
    patch.status ?? run.status,
    patch.currentStep ?? run.currentStep,
    hasError ? patch.error ?? null : run.error ?? null,
    hasScreenshot ? patch.screenshotPath ?? null : run.screenshotPath ?? null,
    new Date().toISOString(),
    taskId,
    platform
  );
}

export function resetRuns(taskId: string) {
  for (const run of listRuns(taskId)) {
    updateRun(taskId, run.platform, {
      status: "pending",
      currentStep: "等待开始",
      error: undefined,
      screenshotPath: undefined
    });
  }
}

function insertPlatformRun(taskId: string, platform: Platform) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO platform_runs (
      id, taskId, platform, status, currentStep, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), taskId, platform, "pending", "等待开始", now, now);
}

function mapTask(row: TaskRow): PublishTask {
  return {
    ...row,
    cover169Path: row.cover169Path ?? undefined,
    tags: JSON.parse(row.tags) as string[],
    platforms: JSON.parse(row.platforms) as Platform[]
  };
}

function mapRun(row: RunRow): PlatformRun {
  return {
    ...row,
    platform: row.platform as Platform,
    error: row.error ?? undefined,
    screenshotPath: row.screenshotPath ?? undefined
  };
}

function ensureColumn(table: string, column: string, definition: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
