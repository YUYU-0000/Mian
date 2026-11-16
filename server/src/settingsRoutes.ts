import { Router } from "express";
import {
  migrateClues,
  parseClue,
  readClues,
  writeClues,
  type ClueWall,
} from "./clues.js";
import { readConfig, saveConfig } from "./config.js";
import { readPresets, writePresets, type ApiPreset } from "./apiPresets.js";
import { readVoicePresets, writeVoicePresets } from "./voicePresets.js";
import type { VoicePreset } from "../../shared/voice.mjs";
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
import type { ConversationMessages } from "./messages.js";
import type { ChatFiles, BackupFile } from "./chatFiles.js";
import type { ChatGroup } from "../../shared/chatModel.mjs";

type Backup = {
  format: "mian-backup";
  version: 1;
  config: AppConfig;
  apiPresets: Omit<ApiPreset, "key">[];
  voices?: { presets: Omit<VoicePreset, "key" | "hasKey">[]; activeId: string };
  fonts: FontSettings;
  clues: ClueWall;
  conversations: ConversationRecord[];
  chats: Record<string, ChatGroup[]>;
  files?: BackupFile[];
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
      toolsUnsupported: preset.toolsUnsupported,
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
  const clues = migrateClues(value.clues);
  clues.cards = clues.cards.map(parseClue);
  return {
    ...value,
    apiPresets: presets,
    conversations,
    fonts: fontSettings(value.fonts),
    clues,
  };
}

export function settingsRoutes(
  conversations: ConversationRegistry,
  beforeImport: () => Promise<void>,
  afterImport: (previous: ConversationRecord[]) => Promise<void>,
  messages: ConversationMessages,
  files: ChatFiles,
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
    const [config, { presets }, fonts, clues, voices] = await Promise.all([
      readConfig(),
      readPresets(),
      readFontSettings(),
      readClues(),
      readVoicePresets(),
    ]);
    const ids = conversations.list().map(record => record.conversationId);
    const chats = await messages.export(ids);
    response.json({
      format: "mian-backup",
      version: 1,
      config,
      fonts,
      clues,
      voices: { activeId: voices.activeId, presets: voices.presets.map(({ key, ...preset }) => preset) },
      chats,
      files: await files.export(ids),
      // 金钥和提示前缀都不进入备份。
      apiPresets: presets.map(({ id, note, endpoint, model, format, toolsUnsupported }) => ({
        id,
        note,
        endpoint,
        model,
        format,
        toolsUnsupported,
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
      const deployment = await readConfig();
      await saveConfig({ ...backup.config, workingDirectory: deployment.workingDirectory, sandbox: deployment.sandbox });
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
      if (backup.voices) {
        const existingVoices = await readVoicePresets();
        await writeVoicePresets({
          activeId: backup.voices.activeId,
          presets: backup.voices.presets.map(({ id, note, voice_id, voice_name, model, words }) => ({
            id, note, voice_id, voice_name, model, words,
            key: existingVoices.presets.find(saved => saved.id === id)?.key ?? "",
          })),
        });
      }
      await writeClues(backup.clues);
      await conversations.replace(backup.conversations);
      await files.restore(backup.files ?? []);
      for (const record of previous)
        if (!backup.conversations.some(item => item.conversationId === record.conversationId))
          await messages.remove(record.conversationId);
      for (const record of backup.conversations)
        await messages.replace(record.conversationId, backup.chats[record.conversationId]);
      await afterImport(previous);
      response.json({ ok: true });
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
    }
  });
  return router;
}
