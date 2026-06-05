import { randomUUID } from "node:crypto";
import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { apiHost, apiPort, ensureDataDirs, screenshotDir } from "./config";
import { getTaskWithRuns, insertTask, listTasks } from "./db";
import { platformConfigs } from "./platformConfig";
import { publisherRunner } from "./publisher/runner";
import { assignUploadPath, isUploadField, requireSavedUploads, saveUpload, type SavedUploads } from "./uploads";
import { prepareWeiboVideoFile } from "./videoPrepare";
import {
  parseTaskFields,
  parsePlatforms,
  validateImageFile,
  validateVideoFile,
  validateWeiboVideoFile
} from "./validation";
import type { Platform } from "../shared/types";

ensureDataDirs();

const app = Fastify({
  logger: true,
  bodyLimit: 5 * 1024 * 1024 * 1024
});

await app.register(fastifyCors, {
  origin: true
});

await app.register(fastifyMultipart, {
  limits: {
    files: 4,
    fileSize: 5 * 1024 * 1024 * 1024
  }
});

await app.register(fastifyStatic, {
  root: screenshotDir,
  prefix: "/assets/screenshots/",
  decorateReply: false
});

app.get("/api/health", async () => {
  return { ok: true };
});

app.get("/api/platforms", async () => {
  return { platforms: Object.values(platformConfigs) };
});

app.get("/api/tasks", async () => {
  return { tasks: listTasks() };
});

app.get<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
  try {
    return { task: getTaskWithRuns(request.params.id) };
  } catch (error) {
    return reply.status(404).send({ error: errorMessage(error) });
  }
});

app.post("/api/tasks", async (request, reply) => {
  const taskId = randomUUID();
  const fields: Record<string, unknown> = {};
  const saved: SavedUploads = {};

  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (!isUploadField(part.fieldname)) {
          continue;
        }
        const filePath = await saveUpload(taskId, part);
        assignUploadPath(saved, part.fieldname, filePath);
      } else {
        fields[part.fieldname] = part.value;
      }
    }

    const parsed = parseTaskFields(fields);
    const uploads = requireSavedUploads(saved, {
      requireCover169: parsed.platforms.includes("weibo") || parsed.platforms.includes("bilibili")
    });
    validateVideoFile(uploads.videoPath);
    if (parsed.platforms.includes("weibo")) {
      uploads.videoPath = prepareWeiboVideoFile(uploads.videoPath);
      validateWeiboVideoFile(uploads.videoPath);
    }
    validateImageFile(uploads.cover34Path, "3:4");
    validateImageFile(uploads.cover43Path, "4:3");
    if (uploads.cover169Path) {
      validateImageFile(uploads.cover169Path, "16:9");
    }

    const task = insertTask({
      id: taskId,
      ...uploads,
      ...parsed
    });

    void publisherRunner.enqueueTask(task.id).catch((error) => {
      app.log.error(error, "publish task failed");
    });

    return reply.status(201).send({ task });
  } catch (error) {
    return reply.status(400).send({ error: errorMessage(error) });
  }
});

app.post<{ Params: { id: string } }>("/api/tasks/:id/run", async (request, reply) => {
  try {
    getTaskWithRuns(request.params.id);
    void publisherRunner.enqueueTask(request.params.id).catch((error) => {
      app.log.error(error, "publish retry failed");
    });
    return reply.status(202).send({ ok: true });
  } catch (error) {
    return reply.status(404).send({ error: errorMessage(error) });
  }
});

app.post<{ Params: { platform: string } }>("/api/platforms/:platform/login", async (request, reply) => {
  try {
    const [platform] = parsePlatforms(JSON.stringify([request.params.platform]));
    await publisherRunner.openLogin(platform as Platform);
    return reply.status(202).send({ ok: true });
  } catch (error) {
    return reply.status(400).send({ error: errorMessage(error) });
  }
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  return reply.status(500).send({ error: errorMessage(error) });
});

await app.listen({ host: apiHost, port: apiPort });

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
