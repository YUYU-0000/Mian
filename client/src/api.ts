import { localDateTime } from "./format";
import type {
  ChatMessage,
  ChatEvent,
  Config,
  ConnectionStatus,
  ConversationActivity,
  ConversationRecord,
  RealtimeSession,
} from "./types";
import type {
  ApiPreset,
  Provider,
  Quota,
  Subscription,
  VoiceConfig,
} from "./connectionTypes";

const STREAM_CURSOR_KEY = "mian.chat-event-cursor.v1";

type StreamCursor = { streamId: string; seq: number };
type SessionEnvelope = { kind: "session" } & RealtimeSession;
type EventEnvelope = {
  kind: "event";
  streamId: string;
  seq: number;
  conversationId?: string;
  event: ChatEvent;
};

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  let parsed: unknown;
  if (body.trim() && contentType.includes("application/json")) {
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error(`服务返回了无效的 JSON（HTTP ${response.status}）`);
    }
  } else if (body.trim()) parsed = body;
  if (!response.ok) {
    const message =
      typeof parsed === "object" && parsed !== null && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : typeof parsed === "string"
          ? parsed
          : `请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }
  if (!body.trim()) return undefined as T;
  if (!contentType.includes("application/json"))
    throw new Error(`服务返回了非 JSON 内容（HTTP ${response.status}）`);
  return parsed as T;
}

const request = async <T>(url: string, init?: RequestInit): Promise<T> =>
  readResponse<T>(
    await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    }),
  );

function loadStreamCursor(): StreamCursor | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STREAM_CURSOR_KEY) ?? "null");
    if (
      typeof value === "object" &&
      value !== null &&
      "streamId" in value &&
      typeof value.streamId === "string" &&
      "seq" in value &&
      typeof value.seq === "number" &&
      Number.isSafeInteger(value.seq) &&
      value.seq >= 0
    )
      return value as StreamCursor;
  } catch {
    return null;
  }
  return null;
}

function saveStreamCursor(cursor: StreamCursor) {
  localStorage.setItem(STREAM_CURSOR_KEY, JSON.stringify(cursor));
}

export const api = {
  subStatus: (provider: Provider) =>
    provider === "codex"
      ? request<Subscription>("/api/subscriptions/codex")
      : Promise.resolve({ ...demoSubscriptions[provider] }), // 待接后端：Gemini / Kimi
  subLogin: async (provider: Provider): Promise<{ account: string; plan: string }> => {
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
        const status = await api.subStatus("codex");
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
    if (provider === "codex") return request<Quota>("/api/subscriptions/codex/quota");
    // 待接后端：Gemini / Kimi
    await delay(600);
    return { left: 96, resetAt: "11月20日 01:59" };
  },
  apiPresets: () =>
    request<{ presets: ApiPreset[]; activeId: string | null }>("/api/api-presets"),
  saveApiPreset: (preset: ApiPreset) =>
    request<ApiPreset>("/api/api-presets", {
      method: "POST",
      body: JSON.stringify(preset),
    }),
  deleteApiPreset: (id: string) =>
    request<void>(`/api/api-presets/${encodeURIComponent(id)}`, { method: "DELETE" }),
  useApiPreset: (id: string) =>
    request<void>(`/api/api-presets/${encodeURIComponent(id)}/use`, { method: "POST" }),
  useCodex: () => request<void>("/api/subscriptions/codex/use", { method: "POST" }),
  apiModels: (cfg: ApiPreset) =>
    request<string[]>("/api/api-models", { method: "POST", body: JSON.stringify(cfg) }),
  apiTest: (cfg: ApiPreset) =>
    request<void>("/api/api-test", { method: "POST", body: JSON.stringify(cfg) }),
  // 待接后端：以下设置接口保留设计稿的预留实现。
  saveFontStyle: async (_page: HTMLElement) => {},
  testFontStyle: async (_page: HTMLElement) => {},
  testVoice: (_cfg: VoiceConfig) => new Promise<void>(() => {}),
  exportData: () => delay(300),
  importData: (_file: File) => delay(300),
  getConfig: () => request<Config>("/api/config"),
  saveConfig: (config: Config) =>
    request<Config>("/api/config", {
      method: "PUT",
      body: JSON.stringify(config),
    }),
  test: () => request<ConnectionStatus>("/api/connection/test", { method: "POST" }),
  listConversations: () =>
    request<{
      defaultConversationId: string;
      conversations: ConversationRecord[];
    }>("/api/conversations"),
  createConversation: () =>
    request<{ conversation: ConversationRecord }>("/api/conversations", {
      method: "POST",
    }),
  forkConversation: (conversationId: string) =>
    request<{ conversation: ConversationRecord }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/fork`,
      { method: "POST" },
    ),
  updateConversation: (
    conversationId: string,
    patch: Partial<Pick<ConversationRecord, "title" | "frontName" | "image" | "pinned">>,
  ) =>
    request<{ conversation: ConversationRecord }>(
      `/api/conversations/${encodeURIComponent(conversationId)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),
  updateConversationActivity: (conversationId: string, patch: ConversationActivity) =>
    request<{ conversation: ConversationRecord }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/activity`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),
  archiveConversation: (conversationId: string) =>
    request<void>(`/api/conversations/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
    }),
  send: async (text: string, conversationId: string, messages?: ChatMessage[]) => {
    const result = await request<{ turnId?: unknown }>("/api/turn", {
      method: "POST",
      body: JSON.stringify({ text, conversationId, messages, localTime: localDateTime() }),
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
  subscribe: (
    onEvent: (event: ChatEvent) => void,
    onSession?: (session: RealtimeSession) => void,
  ) => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    let cursor = loadStreamCursor();
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let reconnectDelay = 250;
    let closedByClient = false;
    let failureReported = false;

    const reportFailure = () => {
      if (closedByClient || failureReported) return;
      failureReported = true;
      onEvent({
        type: "connection",
        status: {
          state: "error",
          message: "与本地服务的实时连接已断开",
        },
      });
    };

    const connect = () => {
      if (closedByClient) return;
      const query = cursor
        ? `?streamId=${encodeURIComponent(cursor.streamId)}&after=${cursor.seq}`
        : "";
      const ws = new WebSocket(`${protocol}//${location.host}/ws${query}`);
      socket = ws;
      ws.onopen = () => {
        failureReported = false;
        reconnectDelay = 250;
      };
      ws.onmessage = (message) => {
        try {
          const value: unknown = JSON.parse(String(message.data));
          if (typeof value !== "object" || value === null || !("kind" in value))
            throw new Error("实时消息缺少 kind");
          if (value.kind === "session") {
            const session = value as SessionEnvelope;
            const reset =
              !cursor || cursor.streamId !== session.streamId || session.reset;
            const previousSeq = cursor?.seq ?? 0;
            cursor = {
              streamId: session.streamId,
              seq: reset ? session.seq : Math.max(previousSeq, session.seq),
            };
            saveStreamCursor(cursor);
            onSession?.({ ...session, reset });
            return;
          }
          if (value.kind !== "event") throw new Error("未知的实时消息类型");
          const envelope = value as EventEnvelope;
          if (!cursor || cursor.streamId !== envelope.streamId)
            cursor = { streamId: envelope.streamId, seq: 0 };
          if (envelope.seq <= cursor.seq) return;
          onEvent({
            ...envelope.event,
            conversationId: envelope.event.conversationId ?? envelope.conversationId,
          });
          cursor = { streamId: envelope.streamId, seq: envelope.seq };
          saveStreamCursor(cursor);
        } catch (error) {
          onEvent({
            type: "error",
            message: `无法读取流式事件：${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      };
      ws.onerror = reportFailure;
      ws.onclose = () => {
        if (closedByClient) return;
        reportFailure();
        window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 4000);
      };
    };

    connect();
    return () => {
      closedByClient = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  },
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const demoSubscriptions: Record<"gemini" | "kimi", Subscription> = {
  gemini: { loggedIn: false, account: "", plan: "", model: "" },
  kimi: { loggedIn: false, account: "", plan: "", model: "" },
};
