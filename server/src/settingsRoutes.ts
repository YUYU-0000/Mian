import { Router } from "express";
import { readConfig, saveConfig } from "./config.js";
import { readPresets, writePresets, type ApiPreset } from "./apiPresets.js";
import {
  deleteFontPreset,
  fontSettings,
  readFontSettings,
  saveFontPreset,
  writeFontSettings,
  type FontSettings,
} from "./fontPresets.js";
import {
  normalizeConversationRecord,
  type ConversationRegistry,
} from "./conversations.js";
import type { AppConfig, ConversationRecord } from "./types.js";

type Backup = {
  format: "mian-backup";
  version: 1;
  config: AppConfig;
  apiPresets: Omit<ApiPreset, "key">[];
  fonts: FontSettings;
  conversations: ConversationRecord[];
  chats: Record<string, unknown[]>;
  preferences: Record<string, string | null>;
};

const invalidBackup = () => new Error("請選擇 Mian 匯出的完整備份 JSON。");

const textFields = (value: any, ...keys: string[]) =>
  value && keys.every((key) => typeof value[key] === "string");
const filesValid = (files: any) =>
  files === undefined ||
  (Array.isArray(files) &&
    files.every(
      (file) =>
        textFields(file, "id", "name", "mimeType", "createdAt") &&
        typeof file.size === "number" &&
        file.size >= 0,
    ));

// 覆盖前确认正文和票根格式，避免导入一半才发现缺少内容。
function chatGroupValid(group: any) {
  if (!textFields(group, "time")) return false;
  if (group.role === "user")
    return (
      textFields(group, "groupId") &&
      Array.isArray(group.records) &&
      group.records.every(
        (record: any) =>
          textFields(record, "messageId", "text", "time") &&
          filesValid(record.files),
      )
    );
  return (
    group.role === "assistant" &&
    textFields(group, "replyGroupId", "raw", "thinking") &&
    [group.preToolBubbles, group.bubbles].every(
      (parts) =>
        Array.isArray(parts) && parts.every((part) => typeof part === "string"),
    ) &&
    Array.isArray(group.tools) &&
    group.tools.every((tool: any) =>
      textFields(tool, "id", "name", "detail", "state"),
    ) &&
    filesValid(group.files)
  );
}

function parseBackup(value: Backup): Backup {
  if (
    !value ||
    value.format !== "mian-backup" ||
    value.version !== 1 ||
    !value.config ||
    !Array.isArray(value.apiPresets) ||
    !Array.isArray(value.conversations) ||
    !value.conversations.length ||
    !value.chats ||
    !value.preferences ||
    Object.values(value.preferences).some(
      (item) => item !== null && typeof item !== "string",
    )
  )
    throw invalidBackup();
  const presets = value.apiPresets.map((preset) => {
    if (
      !preset ||
      [preset.id, preset.note, preset.endpoint, preset.model].some(
        (item) => typeof item !== "string",
      ) ||
      !preset.id ||
      preset.format !== "openai"
    )
      throw invalidBackup();
    return {
      id: preset.id,
      note: preset.note,
      endpoint: preset.endpoint,
      model: preset.model,
      format: preset.format,
    };
  });
  const channel = value.config.channel;
  if (
    !channel ||
    !(
      channel.kind === "codex" ||
      (channel.kind === "api" &&
        presets.some((preset) => preset.id === channel.presetId))
    )
  )
    throw invalidBackup();
  const conversations = value.conversations.map((record) => {
    if (
      !record ||
      typeof record.title !== "string" ||
      typeof record.frontName !== "string"
    )
      throw invalidBackup();
    const normalized = normalizeConversationRecord(record);
    if (!normalized || !Array.isArray(value.chats[normalized.conversationId]))
      throw invalidBackup();
    if (!value.chats[normalized.conversationId].every(chatGroupValid))
      throw invalidBackup();
    return normalized;
  });
  if (
    new Set(conversations.map((record) => record.conversationId)).size !==
      conversations.length ||
    new Set(presets.map((preset) => preset.id)).size !== presets.length
  )
    throw invalidBackup();
  return {
    ...value,
    apiPresets: presets,
    conversations,
    fonts: fontSettings(value.fonts),
  };
}

export function settingsRoutes(
  conversations: ConversationRegistry,
  beforeImport: () => Promise<void>,
  afterImport: (previous: ConversationRecord[]) => Promise<void>,
) {
  const router = Router();
  router.get("/font-presets", async (_request, response) => {
    response.json(await readFontSettings());
  });
  router.post("/font-presets", async (request, response) => {
    try {
      response.json(
        await saveFontPreset(request.body.preset, request.body.use === true),
      );
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
    }
  });
  router.delete("/font-presets/:id", async (request, response) => {
    try {
      response.json(await deleteFontPreset(request.params.id));
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
    }
  });
  router.get("/backup", async (_request, response) => {
    const [config, { presets }, fonts] = await Promise.all([
      readConfig(),
      readPresets(),
      readFontSettings(),
    ]);
    response.json({
      format: "mian-backup",
      version: 1,
      config,
      fonts,
      // 金钥和提示前缀都不进入备份。
      apiPresets: presets.map(({ id, note, endpoint, model, format }) => ({
        id,
        note,
        endpoint,
        model,
        format,
      })),
      conversations: conversations
        .list()
        .map((record) => ({ ...record, image: "" })),
    });
  });
  router.post("/backup", async (request, response) => {
    try {
      const backup = parseBackup(request.body);
      await beforeImport();
      const previous = conversations.list();
      const existing = (await readPresets()).presets;
      await saveConfig(backup.config);
      // 同一台机器保留同一纸片、同一服务地址的金钥；新机器需重新填写。
      await writePresets({
        presets: backup.apiPresets.map((preset) => ({
          ...preset,
          key:
            existing.find(
              (saved) =>
                saved.id === preset.id && saved.endpoint === preset.endpoint,
            )?.key ?? "",
        })),
      });
      await writeFontSettings(backup.fonts);
      await conversations.replace(backup.conversations);
      await afterImport(previous);
      response.json({ ok: true });
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
    }
  });
  return router;
}
