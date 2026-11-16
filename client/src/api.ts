import { subscribe } from "./realtime";
import type { ClueWall } from "./clueTypes";
import { localDateTime } from "./format";
import { exportHomePhotos, restoreHomePhotos } from "./homePhotos";
import { blobToDataURL, compressImage } from "./imageCompression";
import { flushMessageSyncs, type MessageSnapshot } from "./messageSync";
import type { ChatGroup, UserGroup } from "../../shared/chatModel.mjs";
import {
  backupFilename,
  completeBackup,
  restoreBrowserBackup,
  type Backup,
  type ServerBackup,
} from "./settingsBackup";
import type { FontPreset, FontSettings } from "./settingsTypes";
import type { VoiceClip, VoiceOption, VoicePreset, VoiceSettings } from "../../shared/voice.mjs";
import { voicePlayer } from "./voicePlayer";
import { createId } from "./id";
import { readResponse, request, BackendUnavailable, setBackendAvailable } from "./backend";
import { flushOfflineSaves, queueSave, readQuery, refreshReads } from "./offline";
import { cachedFile } from "./fileCache";
import { defaultFont, DEFAULT_FONT_ID, DEFAULT_BUBBLE_SIZE } from "./settingsTypes";
import type {
  ChatFile,
  Config,
  ConnectionStatus,
  ConversationActivity,
  ConversationRecord,
} from "./types";
import type {
  ApiPreset,
  Provider,
  Quota,
  Subscription,
} from "./connectionTypes";

type ConversationList = { defaultConversationId: string; conversations: ConversationRecord[] };
const messages = new Map<string, ReturnType<typeof readQuery<MessageSnapshot>>>();
const messageQuery = (id: string) => {
  if (!messages.has(id)) messages.set(id, readQuery<MessageSnapshot>(`/api/conversations/${encodeURIComponent(id)}/messages`, undefined, false));
  return messages.get(id)!;
};
const codexStatus = readQuery<Subscription>("/api/subscriptions/codex");
const codexQuota = readQuery<Quota>("/api/subscriptions/codex/quota");
const replacePreset = <T extends { id: string }>(presets: T[], preset: T) =>
  presets.some(item => item.id === preset.id)
    ? presets.map(item => item.id === preset.id ? preset : item) : [...presets, preset];
const localValue = async <T>(query: ReturnType<typeof readQuery<T>>) =>
  (await query.peek()) ?? query();

const saveVoiceSettings = (url: string, method: string, body: unknown, change: (settings: VoiceSettings) => VoiceSettings) =>
  queueSave(url, method, body, async () => {
    const result = change(await localValue(api.voicePresets));
    return { updates: { "/api/voice-presets": result }, result };
  });

const updateConversation = (id: string, patch: Partial<ConversationRecord>, activity = false) =>
  queueSave(`/api/conversations/${encodeURIComponent(id)}${activity ? "/activity" : ""}`, "PATCH", patch, async () => {
    const list = await localValue(api.listConversations);
    const conversation = { ...list.conversations.find(item => item.conversationId === id)!, ...patch };
    const conversations = list.conversations.map(item => item.conversationId === id ? conversation
      : patch.pinned ? { ...item, pinned: false } : item);
    if (patch.pinned) conversations.sort((left, right) => left.pinned === right.pinned
      ? left.createdAt.localeCompare(right.createdAt) : left.pinned ? -1 : 1);
    return { updates: { "/api/conversations": { ...list, conversations } }, result: { conversation } };
  }, activity);

export const api = {
  clues: readQuery<ClueWall>("/api/clues"),
  saveClueWall: (wall: ClueWall) =>
    queueSave("/api/clues", "PUT", wall, async () => ({ updates: { "/api/clues": wall }, result: wall })),
  subStatus: (provider: Provider) =>
    provider === "codex"
      ? codexStatus()
      : Promise.resolve({ ...demoSubscriptions[provider] }), // 待接后端：Gemini / Kimi
  watchSubStatus: (provider: Provider, receive: (status: Subscription) => void) =>
    provider === "codex" ? codexStatus.watch(receive) : (() => {}),
  watchSubQuota: (provider: Provider, receive: (quota: Quota) => void) =>
    provider === "codex" ? codexQuota.watch(receive) : (() => {}),
  subLogin: async (
    provider: Provider,
  ): Promise<{ account: string; plan: string }> => {
    if (provider !== "codex") {
      // 待接后端：保留设计稿的演示登录。
      await delay(900);
      Object.assign(demoSubscriptions[provider], {
        loggedIn: true,
        account: "yuyu@example.com",
        plan: "plus",
      });
      return demoSubscriptions[provider];
    }
    const popup = window.open("about:blank", "mian-codex-login");
    if (!popup) throw new Error("請允許開啟登入視窗，再試一次。");
    let loginId = "";
    try {
      const login = await request<{ authUrl: string; loginId: string }>(
        "/api/subscriptions/codex/login",
        { method: "POST" },
      );
      loginId = login.loginId;
      popup.location.href = login.authUrl;
      while (true) {
        await delay(1000);
        const status = await codexStatus.refresh();
        if (status.loggedIn) {
          popup.close();
          return status;
        }
        if (popup.closed) throw new Error("登入視窗已關閉，尚未完成登入。");
      }
    } catch (error) {
      popup.close();
      if (loginId)
        await request("/api/subscriptions/codex/login/cancel", {
          method: "POST",
          body: JSON.stringify({ loginId }),
        });
      throw error;
    }
  },
  subLogout: async (provider: Provider) => {
    if (provider === "codex")
      return request("/api/subscriptions/codex/logout", { method: "POST" });
    // 待接后端：Gemini / Kimi
    await delay(400);
    Object.assign(demoSubscriptions[provider], {
      loggedIn: false,
      account: "",
      plan: "",
    });
  },
  subModels: (provider: Provider): Promise<string[]> =>
    provider === "codex"
      ? request("/api/subscriptions/codex/models")
      : Promise.resolve(
          provider === "gemini"
            ? ["gemini-3-pro", "gemini-3-flash"]
            : ["kimi-k3", "kimi-k3-turbo"],
        ), // 待接后端
  saveSubConfig: async (provider: Provider, cfg: { model: string }) => {
    if (provider === "codex") {
      await api.saveConfig({ ...(await api.getConfig()), model: cfg.model });
      return api.useCodex();
    }
    // 待接后端：Gemini / Kimi
    await delay(300);
    demoSubscriptions[provider].model = cfg.model;
  },
  subQuota: async (provider: Provider): Promise<Quota> => {
    if (provider === "codex")
      return codexQuota();
    // 待接后端：Gemini / Kimi
    await delay(600);
    return { left: 96, resetAt: "11月20日 01:59" };
  },
  apiPresets: readQuery<{ presets: ApiPreset[]; activeId: string | null }>("/api/api-presets"),
  saveApiPreset: (input: ApiPreset) => {
    const preset = { ...input, id: input.id || createId() };
    return queueSave("/api/api-presets", "POST", preset, async () => {
      const settings = await localValue(api.apiPresets);
      const { key, ...rest } = preset;
      const previous = settings.presets.find(item => item.id === preset.id);
      const result = { ...rest, hasKey: Boolean(key || previous?.hasKey), keyHint: previous?.keyHint };
      return { updates: { "/api/api-presets": { ...settings, presets: replacePreset(settings.presets, result) } }, result };
    });
  },
  deleteApiPreset: (id: string) =>
    queueSave(`/api/api-presets/${encodeURIComponent(id)}`, "DELETE", undefined, async () => {
      const settings = await localValue(api.apiPresets);
      const config = await localValue(api.getConfig);
      return { updates: {
        "/api/api-presets": { presets: settings.presets.filter(preset => preset.id !== id), activeId: settings.activeId === id ? null : settings.activeId },
        "/api/config": config.channel?.kind === "api" && config.channel.presetId === id ? { ...config, channel: { kind: "codex" } } : config,
      }, result: undefined };
    }),
  useApiPreset: (id: string) =>
    selectChannel(id),
  useCodex: () =>
    selectChannel(null),
  apiModels: (cfg: ApiPreset) =>
    request<string[]>("/api/api-models", {
      method: "POST",
      body: JSON.stringify(cfg),
    }),
  apiTest: (cfg: ApiPreset) =>
    request<void>("/api/api-test", {
      method: "POST",
      body: JSON.stringify(cfg),
    }),
  fontPresets: readQuery<FontSettings>("/api/font-presets"),
  saveFontPreset: (preset: FontPreset, use = false) =>
    queueSave("/api/font-presets", "POST", { preset, use }, async () => {
      const settings = await localValue(api.fontPresets);
      const saved = preset.id === DEFAULT_FONT_ID ? { ...defaultFont, view: preset.view } : preset;
      const result = { ...settings, presets: replacePreset(settings.presets, saved),
        ...(use ? { activeId: saved.id, style: { face: saved.face, size: saved.size } } : {}) };
      return { updates: { "/api/font-presets": result }, result };
    }),
  deleteFontPreset: (id: string) =>
    queueSave(`/api/font-presets/${encodeURIComponent(id)}`, "DELETE", undefined, async () => {
      const settings = await localValue(api.fontPresets);
      const result = { ...settings, presets: settings.presets.filter(preset => preset.id !== id),
        ...(settings.activeId === id ? { activeId: DEFAULT_FONT_ID, style: { face: "", size: DEFAULT_BUBBLE_SIZE } } : {}) };
      return { updates: { "/api/font-presets": result }, result };
    }),
  voicePresets: readQuery<VoiceSettings>("/api/voice-presets"),
  saveVoicePreset: (preset: VoicePreset) =>
    saveVoiceSettings("/api/voice-presets", "POST", preset, settings => {
      const { key, ...rest } = preset;
      const saved = { ...rest, hasKey: Boolean(key || settings.presets.find(item => item.id === preset.id)?.hasKey) };
      return { ...settings, presets: replacePreset(settings.presets, saved) };
    }),
  useVoicePreset: (id: string) =>
    saveVoiceSettings(`/api/voice-presets/${encodeURIComponent(id)}/use`, "POST", undefined, settings => ({ ...settings, activeId: id })),
  deleteVoicePreset: (id: string) =>
    saveVoiceSettings(`/api/voice-presets/${encodeURIComponent(id)}`, "DELETE", undefined, settings => {
      const presets = settings.presets.filter(item => item.id !== id);
      return { presets, activeId: settings.activeId === id
        ? presets[Math.max(0, settings.presets.findIndex(item => item.id === id) - 1)].id : settings.activeId };
    }),
  voiceModels: (preset: VoicePreset) =>
    request<VoiceOption[]>("/api/voice-models", { method: "POST", body: JSON.stringify(preset) }),
  voiceList: (preset: VoicePreset) =>
    request<VoiceOption[]>("/api/voice-list", { method: "POST", body: JSON.stringify(preset) }),
  testVoice: (preset: VoicePreset, signal: AbortSignal, onPlaying: () => void) => {
    const requestId = createId();
    return voicePlayer.play(requestId, requestSignal => request<VoiceClip>("/api/voice-test", {
      method: "POST", body: JSON.stringify({ ...preset, requestId }), signal: requestSignal,
    }), signal, onPlaying);
  },
  importData: async (backup: Backup) => {
    await flushOfflineSaves();
    const { homePhotos, ...data } = backup;
    await request("/api/backup", {
      method: "POST",
      body: JSON.stringify(data),
    });
    restoreBrowserBackup(backup, localStorage);
    await restoreHomePhotos(homePhotos);
    await refreshReads();
  },
  exportData: async () => {
    await flushOfflineSaves();
    await flushMessageSyncs();
    const content = completeBackup(
      await request<ServerBackup>("/api/backup"),
      localStorage,
    );
    content.homePhotos = await exportHomePhotos();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(content, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = backupFilename();
    link.click();
    URL.revokeObjectURL(url);
  },
  getConfig: readQuery<Config>("/api/config"),
  saveConfig: (config: Config) =>
    queueSave("/api/config", "PUT", config, async () => {
      const subscription = await codexStatus.peek();
      return { updates: { "/api/config": config,
        ...(subscription ? { "/api/subscriptions/codex": { ...subscription, model: config.model } } : {}) }, result: config };
    }),
  test: () =>
    request<ConnectionStatus>("/api/connection/test", { method: "POST" }),
  listConversations: readQuery<ConversationList>("/api/conversations", async data => {
    for (const record of data.conversations) {
      if (!record.image) continue;
      const file = await (await fetch(record.image)).blob();
      const compressed = await compressImage(file, 1200, true);
      if (compressed === file) continue;
      const { conversation } = await request<{ conversation: ConversationRecord }>(
        `/api/conversations/${encodeURIComponent(record.conversationId)}`,
        { method: "PATCH", body: JSON.stringify({ image: await blobToDataURL(compressed) }) });
      Object.assign(record, conversation);
    }
    return data;
  }),
  rememberConversation: (conversation: ConversationRecord) =>
    api.listConversations.update(current => current && ({
      defaultConversationId: current.defaultConversationId,
      conversations: current.conversations.some(item => item.conversationId === conversation.conversationId)
        ? current.conversations.map(item => item.conversationId === conversation.conversationId ? conversation : item)
        : [...current.conversations, conversation],
    })),
  createConversation: async () => {
    const result = await request<{ conversation: ConversationRecord }>("/api/conversations", {
      method: "POST",
    });
    await api.rememberConversation(result.conversation);
    return result;
  },
  forkConversation: async (conversationId: string) => {
    const result = await request<{ conversation: ConversationRecord }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/fork`,
      { method: "POST" },
    );
    await api.rememberConversation(result.conversation);
    return result;
  },
  updateConversation: (
    conversationId: string,
    patch: Partial<
      Pick<ConversationRecord, "title" | "frontName" | "image" | "pinned">
    >,
  ) =>
    updateConversation(conversationId, patch),
  updateConversationActivity: (
    conversationId: string,
    patch: ConversationActivity,
  ) =>
    updateConversation(conversationId, patch, true),
  archiveConversation: async (conversationId: string) => {
    await request<void>(`/api/conversations/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
    });
    await api.listConversations.update(current => ({ ...current!, conversations: current!.conversations.filter(item => item.conversationId !== conversationId) }), false);
  },
  fileUrl: (conversationId: string, fileId: string, inline = false) =>
    `/api/conversations/${encodeURIComponent(conversationId)}/files/${encodeURIComponent(fileId)}${inline ? "?inline=1" : ""}`,
  loadMessages: (conversationId: string, cached?: (snapshot: MessageSnapshot) => void) =>
    cached ? messageQuery(conversationId).load(cached) : messageQuery(conversationId)(),
  saveMessages: (conversationId: string, groups: ChatGroup[], initialize = false) =>
    request<MessageSnapshot>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "PUT", body: JSON.stringify({ groups, initialize }),
    }),
  fileText: async (
    conversationId: string,
    fileId: string,
    signal: AbortSignal,
  ) => {
    return (await cachedFile(api.fileUrl(conversationId, fileId), signal)).blob.text();
  },
  fileCreatedAt: async (url: string, signal: AbortSignal) => {
    return (await cachedFile(url, signal)).createdAt;
  },
  uploadFile: (
    conversationId: string,
    file: File,
    progress: (percent: number) => void,
    signal: AbortSignal,
  ) =>
    new Promise<ChatFile>((resolve, reject) => {
      const upload = new XMLHttpRequest();
      upload.open(
        "POST",
        `/api/conversations/${encodeURIComponent(conversationId)}/files?${new URLSearchParams({ name: file.name, type: file.type })}`,
      );
      upload.setRequestHeader("Content-Type", "application/octet-stream");
      upload.upload.onprogress = (event) => {
        if (event.lengthComputable)
          progress(Math.round((event.loaded / event.total) * 100));
      };
      const abort = () => upload.abort();
      signal.addEventListener("abort", abort, { once: true });
      upload.onloadend = () => signal.removeEventListener("abort", abort);
      upload.onerror = () => { setBackendAvailable(false); reject(new BackendUnavailable()); };
      upload.onabort = () =>
        reject(new DOMException("已取消上傳", "AbortError"));
      upload.onload = () => {
        if (upload.status >= 500) { setBackendAvailable(false); reject(new BackendUnavailable()); return; }
        setBackendAvailable(true);
        void readResponse<ChatFile>(
          new Response(upload.responseText, {
            status: upload.status,
            headers: {
              "Content-Type": upload.getResponseHeader("Content-Type") ?? "",
            },
          }),
        ).then(resolve, reject);
      };
      upload.send(file);
    }),
  send: async (
    text: string,
    conversationId: string,
    files?: ChatFile[],
    message?: UserGroup,
  ) => {
    const result = await request<{ turnId?: unknown }>("/api/turn", {
      method: "POST",
      body: JSON.stringify({
        text,
        conversationId,
        message,
        files: files?.map((file) => file.id),
        localTime: localDateTime(),
      }),
    });
    if (typeof result?.turnId !== "string" || !result.turnId)
      throw new Error("服务未返回有效的 turnId");
    return { turnId: result.turnId };
  },
  stop: (turnId: string, conversationId: string) =>
    request<void>(`/api/turn/${encodeURIComponent(turnId)}/interrupt`, {
      method: "POST",
      body: JSON.stringify({ conversationId }),
    }),
  decide: (requestId: string, allow: boolean, conversationId: string) =>
    request<void>(`/api/approval/${encodeURIComponent(requestId)}`, {
      method: "POST",
      body: JSON.stringify({ allow, conversationId }),
    }),
  subscribe,
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const demoSubscriptions: Record<"gemini" | "kimi", Subscription> = {
  gemini: { loggedIn: false, account: "", plan: "", model: "" },
  kimi: { loggedIn: false, account: "", plan: "", model: "" },
};

function selectChannel(id: string | null) {
  return queueSave(id ? `/api/api-presets/${encodeURIComponent(id)}/use` : "/api/subscriptions/codex/use", "POST", undefined, async () => {
    const config = await localValue(api.getConfig);
    const presets = await localValue(api.apiPresets);
    return { updates: {
      "/api/config": { ...config, channel: id ? { kind: "api", presetId: id } : { kind: "codex" } },
      "/api/api-presets": { ...presets, activeId: id },
    }, result: undefined };
  });
}
