import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { CodexBridge } from "./codex.js";
import { readConfig } from "./config.js";
import {
  publicPreset,
  readPresets,
  requirePreset,
  resolvePreset,
  selectChannel,
  writePresets,
} from "./apiPresets.js";
import { providerJson } from "./providers/openai.js";
type RateLimitWindow = { usedPercent: number; resetsAt: number | null };
type RateLimitSnapshot = {
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
};
export function connectionRoutes(
  bridge: CodexBridge,
  channelChanged: () => Promise<void> = async () => {},
) {
  const router = Router();
  router.post("/subscriptions/codex/use", async (_req, res, next) => {
    try {
      await selectChannel({ kind: "codex" });
      await channelChanged();
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  router.get("/subscriptions/codex", async (_req, res, next) => {
    try {
      const config = await readConfig();
      await bridge.connect(config);
      res.json({ ...(await bridge.readAccount()), model: config.model });
    } catch (error) {
      next(error);
    }
  });
  router.post("/subscriptions/codex/login", async (_req, res, next) => {
    try {
      await bridge.connect(await readConfig());
      res.json(
        await bridge.request("account/login/start", { type: "chatgpt" }),
      );
    } catch (error) {
      next(error);
    }
  });
  router.post("/subscriptions/codex/logout", async (_req, res, next) => {
    try {
      await bridge.connect(await readConfig());
      await bridge.request("account/logout");
      await bridge.readAccount();
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  router.post("/subscriptions/codex/login/cancel", async (req, res, next) => {
    try {
      res.json(
        await bridge.request("account/login/cancel", {
          loginId: req.body.loginId,
        }),
      );
    } catch (error) {
      next(error);
    }
  });
  router.get("/subscriptions/codex/quota", async (_req, res, next) => {
    try {
      await bridge.connect(await readConfig());
      const response = (await bridge.request("account/rateLimits/read")) as {
        rateLimits: RateLimitSnapshot;
        rateLimitsByLimitId: Record<string, RateLimitSnapshot> | null;
      };
      const limits = response.rateLimitsByLimitId?.codex ?? response.rateLimits;
      const [window] = [limits.primary, limits.secondary]
        .filter((window) => window !== null)
        .sort((a, b) => b.usedPercent - a.usedPercent);
      if (!window) throw new Error("Codex 未返回可用的訂閱額度。");
      res.json({
        left: Math.max(0, Math.min(100, 100 - window.usedPercent)),
        resetAt:
          window.resetsAt === null
            ? "未提供重置時間"
            : new Date(window.resetsAt * 1000).toLocaleString("zh-CN", {
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23",
              }),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/subscriptions/codex/models", async (_req, res, next) => {
    try {
      await bridge.connect(await readConfig());
      const models: string[] = [];
      let cursor: string | null = null;
      do {
        const page = (await bridge.request("model/list", { cursor })) as {
          data: { model: string }[];
          nextCursor: string | null;
        };
        models.push(...page.data.map((model) => model.model));
        cursor = page.nextCursor;
      } while (cursor);
      res.json(models);
    } catch (error) {
      next(error);
    }
  });
  router.get("/api-presets", async (_req, res, next) => {
    try {
      const { presets } = await readPresets();
      const { channel } = await readConfig();
      res.json({
        presets: presets.map(publicPreset),
        activeId: channel.kind === "api" ? channel.presetId : null,
      });
    } catch (error) {
      next(error);
    }
  });
  router.post("/api-presets", async (req, res, next) => {
    try {
      const { id, note, endpoint, key, model, format } = await resolvePreset(
        req.body,
      );
      const preset = {
        id: id || randomUUID(),
        note,
        endpoint,
        key,
        model,
        format,
      };
      const data = await readPresets();
      const index = data.presets.findIndex((item) => item.id === preset.id);
      if (index < 0) data.presets.push(preset);
      else data.presets[index] = preset;
      await writePresets(data);
      await channelChanged();
      res.json(publicPreset(preset));
    } catch (error) {
      next(error);
    }
  });
  router.delete("/api-presets/:id", async (req, res, next) => {
    try {
      const data = await readPresets();
      data.presets = data.presets.filter(
        (preset) => preset.id !== req.params.id,
      );
      const { channel } = await readConfig();
      if (channel.kind === "api" && channel.presetId === req.params.id)
        await selectChannel({ kind: "codex" });
      await writePresets(data);
      await channelChanged();
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  router.post("/api-presets/:id/use", async (req, res, next) => {
    try {
      await requirePreset(req.params.id);
      await selectChannel({ kind: "api", presetId: req.params.id });
      await channelChanged();
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  router.post("/api-models", async (req, res, next) => {
    try {
      const result = (await providerJson(
        await resolvePreset(req.body),
        "models",
      )) as { data: { id: string }[] };
      res.json(result.data.map((model) => model.id));
    } catch (error) {
      next(error);
    }
  });
  router.post("/api-test", async (req, res, next) => {
    try {
      await providerJson(await resolvePreset(req.body), "chat/completions", {
        model: req.body.model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
        stream: false,
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  router.use(
    (
      error: Error,
      _req: import("express").Request,
      res: import("express").Response,
      _next: import("express").NextFunction,
    ) => {
      res.status(400).json({ error: error.message });
    },
  );
  return router;
}
