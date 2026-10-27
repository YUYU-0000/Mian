import type {
  ChatEvent,
  Config,
  ConnectionStatus,
  ConversationActivity,
  ConversationRecord,
  RealtimeSession,
} from "./types";

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
    const value: unknown = JSON.parse(
      localStorage.getItem(STREAM_CURSOR_KEY) ?? "null",
    );
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
  getConfig: () => request<Config>("/api/config"),
  saveConfig: (config: Config) =>
    request<Config>("/api/config", {
      method: "PUT",
      body: JSON.stringify(config),
    }),
  test: () =>
    request<ConnectionStatus>("/api/connection/test", { method: "POST" }),
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
  updateConversationActivity: (
    conversationId: string,
    patch: ConversationActivity,
  ) =>
    request<{ conversation: ConversationRecord }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/activity`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),
  archiveConversation: (conversationId: string) =>
    request<void>(
      `/api/conversations/${encodeURIComponent(conversationId)}`,
      { method: "DELETE" },
    ),
  send: async (text: string, conversationId: string) => {
    const result = await request<{ turnId?: unknown }>("/api/turn", {
      method: "POST",
      body: JSON.stringify({ text, conversationId }),
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
          if (
            typeof value !== "object" ||
            value === null ||
            !("kind" in value)
          )
            throw new Error("实时消息缺少 kind");
          if (value.kind === "session") {
            const session = value as SessionEnvelope;
            const reset =
              !cursor ||
              cursor.streamId !== session.streamId ||
              session.reset;
            const previousSeq = cursor?.seq ?? 0;
            cursor = {
              streamId: session.streamId,
              seq: reset
                ? session.seq
                : Math.max(previousSeq, session.seq),
            };
            saveStreamCursor(cursor);
            onSession?.({ ...session, reset });
            return;
          }
          if (value.kind !== "event")
            throw new Error("未知的实时消息类型");
          const envelope = value as EventEnvelope;
          if (!cursor || cursor.streamId !== envelope.streamId)
            cursor = { streamId: envelope.streamId, seq: 0 };
          if (envelope.seq <= cursor.seq) return;
          onEvent({
            ...envelope.event,
            conversationId:
              envelope.event.conversationId ?? envelope.conversationId,
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
