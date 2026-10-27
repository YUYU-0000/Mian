import express from "express";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { readConfig, saveConfig } from "./config.js";
import { CodexBridge } from "./codex.js";
import { ConversationRegistry } from "./conversations.js";
import { requestConversationId } from "./requestConversation.js";
import type {
  ConversationRecord,
  ConversationRuntimeMetadata,
  ConversationThreadBinding,
} from "./types.js";

type BufferedEvent = {
  streamId: string;
  seq: number;
  conversationId?: string;
  event: unknown;
};

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const bridge = new CodexBridge();
const conversations = await ConversationRegistry.load();
bridge.restoreConversationThreads(conversations.list());
const streamId = randomUUID();
const eventBuffer: BufferedEvent[] = [];
const maxBufferedEvents = 5000;
let nextEventSeq = 1;
let conversationWriteQueue: Promise<void> = Promise.resolve();
const activityTimers = new Map<string, NodeJS.Timeout>();

app.use(express.json({ limit: "4mb" }));

const broadcast = (event: unknown) => {
  const conversationId =
    event && typeof event === "object" && "conversationId" in event
      ? String(event.conversationId)
      : undefined;
  const envelope: BufferedEvent = {
    streamId,
    seq: nextEventSeq++,
    conversationId,
    event,
  };
  eventBuffer.push(envelope);
  if (eventBuffer.length > maxBufferedEvents) eventBuffer.shift();
  const data = JSON.stringify({ kind: "event", ...envelope });
  for (const ws of wss.clients)
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
};

const latestConnectionStatus = () => {
  for (let index = eventBuffer.length - 1; index >= 0; index -= 1) {
    const event = eventBuffer[index].event;
    if (
      typeof event === "object" &&
      event !== null &&
      "type" in event &&
      event.type === "connection" &&
      "status" in event
    )
      return event.status;
  }
  return undefined;
};

wss.on("connection", (ws, request) => {
  const url = new URL(request.url ?? "/ws", "http://127.0.0.1");
  const requestedStreamId = url.searchParams.get("streamId");
  const requestedAfterText = url.searchParams.get("after");
  const requestedAfter = Number(requestedAfterText);
  const latestSeq = nextEventSeq - 1;
  const canReplay =
    requestedStreamId === streamId &&
    requestedAfterText !== null &&
    Number.isSafeInteger(requestedAfter) &&
    requestedAfter >= 0 &&
    requestedAfter <= latestSeq;
  const cursor = canReplay ? requestedAfter : latestSeq;
  const defaultConversationId = conversations.defaultConversationId();

  ws.send(
    JSON.stringify({
      kind: "session",
      streamId,
      seq: cursor,
      reset: !canReplay,
      threadId: bridge.getThreadId(defaultConversationId) ?? null,
      activeTurnId: bridge.getActiveTurnId(defaultConversationId) ?? null,
      defaultConversationId,
      activeTurns: bridge.getActiveTurns(),
      conversations: conversations.list(),
      connectionStatus: latestConnectionStatus(),
    }),
  );
  if (canReplay)
    for (const envelope of eventBuffer)
      if (envelope.seq > requestedAfter)
        ws.send(JSON.stringify({ kind: "event", ...envelope }));
});

const publishConversation = (conversation: ConversationRecord) =>
  broadcast({
    type: "conversation-updated",
    conversationId: conversation.conversationId,
    conversation,
  });

const queueConversationWrite = (operation: () => Promise<void>) => {
  conversationWriteQueue = conversationWriteQueue
    .then(operation, operation)
    .catch((error) => console.error("[conversations]", error));
};

const scheduleConversationActivity = (conversationId: string) => {
  const previous = activityTimers.get(conversationId);
  if (previous) clearTimeout(previous);
  const timestamp = new Date().toISOString();
  activityTimers.set(
    conversationId,
    setTimeout(() => {
      activityTimers.delete(conversationId);
      queueConversationWrite(async () => {
        const conversation = await conversations.updateActivity(conversationId, {
          lastActivityAt: timestamp,
        });
        publishConversation(conversation);
      });
    }, 250),
  );
};

bridge.on("event", (event: any) => {
  broadcast(event);
  if (
    typeof event?.conversationId === "string" &&
    (event.type === "assistant-delta" || event.type === "turn-completed")
  )
    scheduleConversationActivity(event.conversationId);
});
bridge.on(
  "thread",
  ({ conversationId, threadId, metadata }: ConversationThreadBinding & { conversationId: string }) => {
    queueConversationWrite(async () => {
      const conversation = await conversations.setThread(conversationId, {
        threadId,
        metadata,
      });
      publishConversation(conversation);
    });
  },
);
bridge.on(
  "conversation-metadata",
  ({
    conversationId,
    patch,
  }: {
    conversationId: string;
    patch: Partial<ConversationRuntimeMetadata>;
  }) => {
    queueConversationWrite(async () => {
      const conversation = await conversations.updateRuntime(
        conversationId,
        patch,
      );
      publishConversation(conversation);
    });
  },
);
bridge.on("log", (message) =>
  console.error("[app-server]", String(message).trim()),
);

app.get("/api/config", async (_request, response) =>
  response.json(await readConfig()),
);
app.put("/api/config", async (request, response) => {
  try {
    response.json(await saveConfig(request.body));
  } catch (error) {
    response.status(400).json({ error: (error as Error).message });
  }
});
app.post("/api/connection/test", async (_request, response) => {
  try {
    response.json(await bridge.connect(await readConfig()));
  } catch (error) {
    const status = { state: "error", message: (error as Error).message };
    broadcast({ type: "connection", status });
    response.status(500).json({ error: status.message });
  }
});
app.get("/api/conversations", (_request, response) =>
  response.json({
    defaultConversationId: conversations.defaultConversationId(),
    conversations: conversations.list(),
  }),
);
app.post("/api/conversations", async (_request, response) => {
  try {
    await bridge.connect(await readConfig());
    const binding = await bridge.createConversationThread();
    const conversation = await conversations.createRoot(binding);
    bridge.registerConversationThread(
      conversation.conversationId,
      binding.threadId,
      true,
    );
    publishConversation(conversation);
    response.status(201).json({ conversation });
  } catch (error) {
    response.status(409).json({ error: (error as Error).message });
  }
});
app.post("/api/conversations/:id/fork", async (request, response) => {
  try {
    conversations.require(request.params.id);
    await bridge.connect(await readConfig());
    const binding = await bridge.forkConversationThread(request.params.id);
    const conversation = await conversations.createBranch(
      request.params.id,
      binding,
    );
    bridge.registerConversationThread(
      conversation.conversationId,
      binding.threadId,
      true,
    );
    publishConversation(conversation);
    response.status(201).json({ conversation });
  } catch (error) {
    response.status(409).json({ error: (error as Error).message });
  }
});
app.patch("/api/conversations/:id", async (request, response) => {
  try {
    const patch = request.body as Record<string, unknown>;
    const conversation = await conversations.update(request.params.id, {
      title: typeof patch.title === "string" ? patch.title : undefined,
      frontName:
        typeof patch.frontName === "string" ? patch.frontName : undefined,
      image: typeof patch.image === "string" ? patch.image : undefined,
      pinned: typeof patch.pinned === "boolean" ? patch.pinned : undefined,
    });
    response.json({ conversation });
  } catch (error) {
    response.status(404).json({ error: (error as Error).message });
  }
});
app.patch("/api/conversations/:id/activity", async (request, response) => {
  try {
    const patch = request.body as Record<string, unknown>;
    const conversation = await conversations.updateActivity(request.params.id, {
      lastActivityAt:
        typeof patch.lastActivityAt === "string"
          ? patch.lastActivityAt
          : undefined,
      lastMessage:
        typeof patch.lastMessage === "string" ? patch.lastMessage : undefined,
    });
    publishConversation(conversation);
    response.json({ conversation });
  } catch (error) {
    response.status(404).json({ error: (error as Error).message });
  }
});
app.delete("/api/conversations/:id", async (request, response) => {
  try {
    const conversationId = request.params.id;
    if (conversations.list().length <= 1)
      throw new Error("最后一个会话不能归档");
    const conversation = conversations.require(conversationId);
    if (bridge.isConversationBusy(conversationId))
      throw new Error("当前会话仍在运行或等待权限处理");
    if (conversation.threadId) await bridge.connect(await readConfig());
    await bridge.archiveConversationThread(conversationId);
    await conversations.remove(conversationId);
    bridge.forgetConversation(conversationId);
    const activityTimer = activityTimers.get(conversationId);
    if (activityTimer) clearTimeout(activityTimer);
    activityTimers.delete(conversationId);
    response.status(204).end();
  } catch (error) {
    response.status(409).json({ error: (error as Error).message });
  }
});
app.post("/api/turn", async (request, response) => {
  try {
    if (typeof request.body?.text !== "string" || !request.body.text.trim())
      throw new Error("消息不能为空");
    const conversationId = requestConversationId(
      request.body,
      conversations.defaultConversationId(),
    );
    conversations.require(conversationId);
    const result = await bridge.startTurn(
      request.body.text.trim(),
      conversationId,
    );
    // ensureConversationThread emits before startTurn resolves. Waiting for the
    // serialized registry write makes the new thread durable before the client
    // is told that its first turn started.
    await conversationWriteQueue;
    if (conversations.require(conversationId).threadId !== result.threadId) {
      const conversation = await conversations.setThread(conversationId, {
        threadId: result.threadId,
        metadata: {},
      });
      publishConversation(conversation);
    }
    response.json(result);
  } catch (error) {
    response.status(409).json({ error: (error as Error).message });
  }
});
app.post("/api/turn/:id/interrupt", async (request, response) => {
  try {
    const conversationId = requestConversationId(
      request.body,
      conversations.defaultConversationId(),
    );
    conversations.require(conversationId);
    await bridge.interrupt(request.params.id, conversationId);
    response.json({ ok: true });
  } catch (error) {
    response.status(409).json({ error: (error as Error).message });
  }
});
app.post("/api/approval/:id", async (request, response) => {
  try {
    const conversationId = requestConversationId(
      request.body,
      conversations.defaultConversationId(),
    );
    conversations.require(conversationId);
    bridge.decide(
      request.params.id,
      request.body?.allow === true,
      conversationId,
    );
    response.json({ ok: true });
  } catch (error) {
    response.status(404).json({ error: (error as Error).message });
  }
});

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, "../../client/dist");
app.use(express.static(clientDist));
app.get("*splat", (_request, response) =>
  response.sendFile(path.join(clientDist, "index.html")),
);

server.listen(8787, "127.0.0.1", () =>
  console.log("Mian backend: http://127.0.0.1:8787"),
);
const shutdown = () => {
  bridge.close();
  server.close();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
