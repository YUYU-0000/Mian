import { Router } from "express";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexBridge } from "./codex.js";
import { readConfig } from "./config.js";

type ApiPreset = { id: string; note: string; endpoint: string; key: string; model: string };
type Presets = { presets: ApiPreset[]; activeId: string | null };
type RateLimitWindow = { usedPercent: number; resetsAt: number | null };
type RateLimitSnapshot = { primary: RateLimitWindow | null; secondary: RateLimitWindow | null };
const file = path.resolve("server/data/api-presets.json");

async function readPresets(): Promise<Presets> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { presets: [], activeId: null };
    throw error;
  }
}
async function writePresets(value: Presets) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

async function providerRequest(cfg: ApiPreset, resource: string, body?: object) {
  const base = cfg.endpoint.replace(/\/+$/, "");
  const response = await fetch(`${base}${/\/v\d+$/.test(base) ? "" : "/v1"}/${resource}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`服務商拒絕了請求（HTTP ${response.status}）：${detail}`);
  }
  return response.json();
}

export function connectionRoutes(bridge: CodexBridge) {
  const router = Router();
  router.get("/subscriptions/codex", async (_req, res, next) => {
    try {
      const config = await readConfig();
      await bridge.connect(config);
      res.json({ ...await bridge.readAccount(), model: config.model });
    } catch (error) { next(error); }
  });
  router.post("/subscriptions/codex/login", async (_req, res, next) => {
    try {
      await bridge.connect(await readConfig());
      res.json(await bridge.request("account/login/start", { type: "chatgpt" }));
    } catch (error) { next(error); }
  });
  router.post("/subscriptions/codex/logout", async (_req, res, next) => {
    try {
      await bridge.connect(await readConfig());
      await bridge.request("account/logout");
      await bridge.readAccount();
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  router.post("/subscriptions/codex/login/cancel", async (req, res, next) => {
    try { res.json(await bridge.request("account/login/cancel", { loginId: req.body.loginId })); }
    catch (error) { next(error); }
  });
  router.get("/subscriptions/codex/quota", async (_req, res, next) => {
    try {
      await bridge.connect(await readConfig());
      const response = await bridge.request("account/rateLimits/read") as {
        rateLimits: RateLimitSnapshot;
        rateLimitsByLimitId: Record<string, RateLimitSnapshot> | null;
      };
      const limits = response.rateLimitsByLimitId?.codex ?? response.rateLimits;
      const [window] = [limits.primary, limits.secondary]
        .filter(window => window !== null)
        .sort((a, b) => b.usedPercent - a.usedPercent);
      if (!window) throw new Error("Codex 未返回可用的訂閱額度。");
      res.json({
        left: Math.max(0, Math.min(100, 100 - window.usedPercent)),
        resetAt: window.resetsAt === null ? "未提供重置時間" : new Date(window.resetsAt * 1000).toLocaleString("zh-CN", {
          month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
        }),
      });
    } catch (error) { next(error); }
  });
  router.get("/subscriptions/codex/models", async (_req, res, next) => {
    try {
      await bridge.connect(await readConfig());
      const models: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await bridge.request("model/list", { cursor }) as { data: { model: string }[]; nextCursor: string | null };
        models.push(...page.data.map(model => model.model));
        cursor = page.nextCursor;
      } while (cursor);
      res.json(models);
    } catch (error) { next(error); }
  });
  router.get("/api-presets", async (_req, res, next) => {
    try { res.json(await readPresets()); } catch (error) { next(error); }
  });
  router.post("/api-presets", async (req, res, next) => {
    try {
      const { id, note, endpoint, key, model } = req.body as ApiPreset;
      const preset = { id: id || randomUUID(), note, endpoint, key, model };
      const data = await readPresets();
      const index = data.presets.findIndex(item => item.id === preset.id);
      if (index < 0) data.presets.push(preset); else data.presets[index] = preset;
      await writePresets(data);
      res.json(preset);
    } catch (error) { next(error); }
  });
  router.delete("/api-presets/:id", async (req, res, next) => {
    try {
      const data = await readPresets();
      data.presets = data.presets.filter(preset => preset.id !== req.params.id);
      if (data.activeId === req.params.id) data.activeId = null;
      await writePresets(data);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  router.post("/api-presets/:id/use", async (req, res, next) => {
    try {
      const data = await readPresets();
      if (!data.presets.some(preset => preset.id === req.params.id)) throw new Error("這張預設已經不存在，請重新開啟連接中心。");
      data.activeId = req.params.id;
      await writePresets(data);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  router.post("/api-models", async (req, res, next) => {
    try {
      const result = await providerRequest(req.body, "models") as { data: { id: string }[] };
      res.json(result.data.map(model => model.id));
    } catch (error) { next(error); }
  });
  router.post("/api-test", async (req, res, next) => {
    try {
      await providerRequest(req.body, "chat/completions", {
        model: req.body.model, messages: [{ role: "user", content: "Hi" }], max_tokens: 1,
      });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  router.use((error: Error, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
    res.status(400).json({ error: error.message });
  });
  return router;
}
