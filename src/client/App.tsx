import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileVideo,
  Image,
  Loader2,
  LogIn,
  Play,
  RefreshCw,
  Send,
  Tags,
  Trash2,
  UploadCloud,
  XCircle
} from "lucide-react";
import type { Platform, PlatformConfig, PlatformRun, TaskWithRuns } from "../shared/types";

type ApiPlatforms = {
  platforms: PlatformConfig[];
};

type ApiTasks = {
  tasks: TaskWithRuns[];
};

const defaultPlatforms: Platform[] = ["douyin", "bilibili", "xiaohongshu", "wechat_channels"];

export function App() {
  const [platforms, setPlatforms] = useState<PlatformConfig[]>([]);
  const [tasks, setTasks] = useState<TaskWithRuns[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(defaultPlatforms);
  const [autoPublish, setAutoPublish] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function load() {
    const [platformResult, taskResult] = await Promise.all([
      fetchJson<ApiPlatforms>("/api/platforms"),
      fetchJson<ApiTasks>("/api/tasks")
    ]);
    setPlatforms(platformResult.platforms);
    setTasks(taskResult.tasks);
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, []);

  const platformName = useMemo(() => {
    return Object.fromEntries(platforms.map((platform) => [platform.id, platform.name])) as Record<Platform, string>;
  }, [platforms]);
  const visiblePlatforms = useMemo(() => {
    return platforms.filter((platform) => platform.id !== "weibo");
  }, [platforms]);

  async function submitTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSubmitting(true);
    setMessage(undefined);
    setError(undefined);

    try {
      const form = new FormData(formElement);
      form.set("platforms", JSON.stringify(selectedPlatforms));
      form.set("tags", JSON.stringify(parseTags(String(form.get("tags") ?? ""))));
      form.set("autoPublish", String(autoPublish));

      const response = await fetch("/api/tasks", {
        method: "POST",
        body: form
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "任务创建失败");
      }

      setMessage("任务已创建，正在打开平台发布页");
      formElement.reset();
      setSelectedPlatforms(defaultPlatforms);
      setAutoPublish(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function openLogin(platform: Platform) {
    setMessage(undefined);
    setError(undefined);
    try {
      await postJson(`/api/platforms/${platform}/login`);
      setMessage(`${platformName[platform] ?? platform} 登录页已打开`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function retryTask(taskId: string) {
    setMessage(undefined);
    setError(undefined);
    try {
      await postJson(`/api/tasks/${taskId}/run`);
      setMessage("任务已重新开始");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deletePublishTask(taskId: string) {
    setMessage(undefined);
    setError(undefined);
    try {
      await deleteJson(`/api/tasks/${taskId}`);
      setTasks((current) => current.filter((task) => task.id !== taskId));
      setMessage("任务已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function togglePlatform(platform: Platform) {
    setSelectedPlatforms((current) => {
      if (current.includes(platform)) {
        return current.filter((item) => item !== platform);
      }
      return [...current, platform];
    });
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local Publisher</p>
            <h1>视频发布控制台</h1>
          </div>
          <button className="ghost-button" onClick={() => void load()} type="button">
            <RefreshCw size={18} />
            刷新
          </button>
        </header>

        <div className="grid">
          <form className="tool-panel publish-form" onSubmit={submitTask}>
            <div className="panel-title">
              <Send size={20} />
              <h2>新建发布任务</h2>
            </div>

            <label className="field">
              <span>视频文件</span>
              <input name="video" type="file" accept="video/mp4,video/quicktime,video/webm,.m4v" required />
            </label>

            <div className="file-grid">
              <label className="field">
                <span>3:4 封面</span>
                <input name="cover34" type="file" accept="image/png,image/jpeg" required />
              </label>
              <label className="field">
                <span>4:3 封面</span>
                <input name="cover43" type="file" accept="image/png,image/jpeg" required />
              </label>
              <label className="field">
                <span>16:9 封面（B站）</span>
                <input name="cover169" type="file" accept="image/png,image/jpeg" required={selectedPlatforms.includes("bilibili")} />
              </label>
            </div>

            <label className="field">
              <span>标题</span>
              <input name="title" type="text" maxLength={80} placeholder="输入作品标题" required />
            </label>

            <label className="field">
              <span>标签</span>
              <input name="tags" type="text" placeholder="用空格或逗号分隔，例如：探店 城市生活" />
            </label>

            <div className="platform-picker">
              <span>目标平台</span>
              <div className="platform-options">
                {visiblePlatforms.map((platform) => (
                  <button
                    className={selectedPlatforms.includes(platform.id) ? "platform-toggle active" : "platform-toggle"}
                    key={platform.id}
                    onClick={() => togglePlatform(platform.id)}
                    type="button"
                  >
                    <span>{platform.name}</span>
                    <small>{coverLabel(platform.coverMode)}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="auto-publish-field">
              <span>自动发布</span>
              <div className="segmented-control" role="group" aria-label="是否自动发布">
                <button className={autoPublish ? "active" : ""} onClick={() => setAutoPublish(true)} type="button">
                  是
                </button>
                <button className={!autoPublish ? "active" : ""} onClick={() => setAutoPublish(false)} type="button">
                  否
                </button>
              </div>
              <small>{autoPublish ? "填写完成后自动点击发布" : "填写完成后停留页面，由用户手动点击发布"}</small>
            </div>

            <button className="primary-button" disabled={submitting || selectedPlatforms.length === 0} type="submit">
              {submitting ? <Loader2 className="spin" size={18} /> : <UploadCloud size={18} />}
              {autoPublish ? "创建并发布" : "创建并填写"}
            </button>

            {(message || error) && (
              <div className={error ? "notice error" : "notice"}>
                {error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                <span>{error ?? message}</span>
              </div>
            )}
          </form>

          <aside className="side-stack">
            <section className="tool-panel">
              <div className="panel-title">
                <LogIn size={20} />
                <h2>账号会话</h2>
              </div>
              <div className="login-list">
                {visiblePlatforms.map((platform) => (
                  <button className="session-row" key={platform.id} onClick={() => void openLogin(platform.id)} type="button">
                    <span>{platform.name}</span>
                    <LogIn size={16} />
                  </button>
                ))}
              </div>
            </section>

            <section className="metrics-band">
              <Metric icon={<Clock3 size={18} />} label="待处理" value={countByStatus(tasks, "draft") + countByStatus(tasks, "running")} />
              <Metric icon={<Clock3 size={18} />} label="待手动" value={countByStatus(tasks, "ready_for_manual_publish")} />
              <Metric icon={<CheckCircle2 size={18} />} label="已发布" value={countByStatus(tasks, "published_immediately")} />
              <Metric icon={<XCircle size={18} />} label="失败" value={countByStatus(tasks, "failed")} />
            </section>
          </aside>
        </div>

        <section className="tasks-section">
          <div className="section-heading">
            <h2>发布任务</h2>
            <span>{tasks.length} 个任务</span>
          </div>

          <div className="task-list">
            {tasks.length === 0 ? (
              <div className="empty-state">
                <FileVideo size={28} />
                <span>暂无任务</span>
              </div>
            ) : (
              tasks.map((task) => (
                <article className="task-row" key={task.id}>
                  <div className="task-main">
                    <div className="task-heading">
                      <h3>{task.title}</h3>
                      <StatusBadge status={task.status} />
                    </div>
                    <div className="task-meta">
                      <span>
                        <Tags size={15} />
                        {task.tags.length > 0 ? task.tags.join(" / ") : "无标签"}
                      </span>
                      <span>
                        <Image size={15} />
                        抖音双封面
                      </span>
                      <span>{task.autoPublish ? "自动发布" : "手动发布"}</span>
                    </div>
                    <RunList runs={task.runs} platformName={platformName} />
                  </div>

                  <div className="task-actions">
                    <button className="icon-button" onClick={() => void retryTask(task.id)} type="button" title="重跑任务">
                      <Play size={17} />
                    </button>
                    <button className="icon-button danger" onClick={() => void deletePublishTask(task.id)} type="button" title="删除任务">
                      <Trash2 size={17} />
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function RunList({ runs, platformName }: { runs: PlatformRun[]; platformName: Record<Platform, string> }) {
  return (
    <div className="run-list">
      {runs.map((run) => (
        <div className="run-chip" key={run.id}>
          <span className={`run-dot ${run.status}`} />
          <strong>{platformName[run.platform] ?? run.platform}</strong>
          <span>{run.currentStep}</span>
          {run.error && <em>{run.error}</em>}
          {run.screenshotPath && (
            <a href={assetUrl(run.screenshotPath)} rel="noreferrer" target="_blank">
              截图
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: TaskWithRuns["status"] }) {
  const labels: Record<TaskWithRuns["status"], string> = {
    draft: "待执行",
    running: "执行中",
    ready_for_manual_publish: "待手动发布",
    published_immediately: "已立即发布",
    failed: "失败"
  };
  return <span className={`status-badge ${status}`}>{labels[status]}</span>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "请求失败");
  }
  return payload as T;
}

async function postJson(url: string) {
  const response = await fetch(url, { method: "POST" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "请求失败");
  }
  return payload;
}

async function deleteJson(url: string) {
  const response = await fetch(url, { method: "DELETE" });
  if (response.status === 204) {
    return;
  }
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "请求失败");
  }
}

function parseTags(value: string) {
  return value.split(/[,，\s#]+/).map((tag) => tag.trim()).filter(Boolean);
}

function countByStatus(tasks: TaskWithRuns[], status: TaskWithRuns["status"]) {
  return tasks.filter((task) => task.status === status).length;
}

function coverLabel(mode: PlatformConfig["coverMode"]) {
  if (mode === "both") {
    return "3:4 + 4:3";
  }
  return mode;
}

function assetUrl(filePath: string) {
  const marker = "/data/screenshots/";
  const index = filePath.indexOf(marker);
  if (index === -1) {
    return "#";
  }
  return `/assets/screenshots/${filePath.slice(index + marker.length).split("/").map(encodeURIComponent).join("/")}`;
}
