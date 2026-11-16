import type { ChatEvent, RealtimeSession } from "./types";
import { setBackendAvailable } from "./backend";

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
  try { localStorage.setItem(STREAM_CURSOR_KEY, JSON.stringify(cursor)); }
  catch { /* 消息在服务器，游标缓存写满不打断事件接收。 */ }
}

export const subscribe = (
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
    setBackendAvailable(false);
  };

  const connect = () => {
    if (closedByClient) return;
    const query = cursor
      ? `?streamId=${encodeURIComponent(cursor.streamId)}&after=${cursor.seq}`
      : "";
    const ws = new WebSocket(`${protocol}//${location.host}/ws${query}`);
    socket = ws;
    ws.onopen = () => {
      setBackendAvailable(true);
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
          eventSeq: envelope.seq,
          streamId: envelope.streamId,
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
    ws.onclose = (event) => {
      if (closedByClient) return;
      if (event.code === 4001) {
        window.dispatchEvent(new Event("mian:login-required"));
        return;
      }
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
};
