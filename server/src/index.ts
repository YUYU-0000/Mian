import express from "express";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { readConfig, saveConfig } from "./config.js";
import { connectionRoutes } from "./connections.js";
import { ApiChat } from "./apiChat.js";
import { ChatFiles } from "./chatFiles.js";
import { fileRoutes } from "./fileRoutes.js";
import { settingsRoutes } from "./settingsRoutes.js";
import { clueRoutes } from "./clueRoutes.js";
import { voiceRoutes } from "./voiceRoutes.js";
import { VoiceReplies } from "./voiceReplies.js";
import { VoiceGeneration } from "./voiceGeneration.js";
import { WorkspaceFiles } from "./workspaceFiles.js";
import { readChannel } from "./apiPresets.js";
import { CodexBridge } from "./codex.js";
import { ConversationRegistry } from "./conversations.js";
import { conversationRoutes } from "./conversationRoutes.js";
import { turnRoutes } from "./turnRoutes.js";
import { ConversationMessages } from "./messages.js";
import { messageRoutes } from "./messageRoutes.js";
import type { ChatEvent } from "../../shared/types.mjs";
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
const files = new ChatFiles();
const voiceGeneration = new VoiceGeneration(files);
const messages = new ConversationMessages(files);
const workspaceFiles = new Map<string, WorkspaceFiles>();
let channel = await readChannel();
bridge.restoreConversationThreads(conversations.list());
const streamId = randomUUID();
const eventBuffer: BufferedEvent[] = [];
const maxBufferedEvents = 5000;
let nextEventSeq = 1;
let conversationWriteQueue: Promise<void> = Promise.resolve();
const activityTimers = new Map<string, NodeJS.Timeout>();

app.use(
  "/api",
  fileRoutes(files, (id) => conversations.require(id)),
);
app.use("/api/backup", express.json({ limit: "64mb" }));
app.use("/api/conversations/:id/messages", express.json({ limit: "64mb" }));
app.use(express.json({ limit: "4mb" }));
app.use("/api/clues", clueRoutes());
app.use("/api", voiceRoutes(voiceGeneration));
app.use(
  "/api",
  settingsRoutes(
    conversations,
    async () => {
      if (
        Object.keys({ ...bridge.getActiveTurns(), ...apiChat.getActiveTurns(), ...voiceReplies.getActiveTurns() })
          .length
      )
        throw new Error("請先停止正在進行的回覆，再導入。");
      for (const timer of activityTimers.values()) clearTimeout(timer);
      activityTimers.clear();
      await conversationWriteQueue;
      await messages.close();
    },
    async (previous) => {
      for (const record of previous)
        bridge.forgetConversation(record.conversationId);
      bridge.restoreConversationThreads(conversations.list());
      workspaceFiles.clear();
      eventBuffer.length = 0;
      channel = await readChannel();
      broadcast({ type: "channel", channel });
    },
    messages,
    files,
  ),
);
app.use(
  "/api",
  connectionRoutes(bridge, async () => {
    channel = await readChannel();
    broadcast({ type: "channel", channel });
  }),
);

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
  if (conversationId && event && typeof event === "object" && "turnId" in event)
    void messages.recordEvent(conversationId, event as Extract<ChatEvent, { turnId: string }>, envelope.seq)
      .catch(error => console.error("[messages]", error));
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
const voiceReplies = new VoiceReplies(voiceGeneration, broadcast);

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
      activeTurnId:
        apiChat.getActiveTurns()[defaultConversationId] ??
        bridge.getActiveTurnId(defaultConversationId) ??
        voiceReplies.getActiveTurns()[defaultConversationId] ??
        null,
      defaultConversationId,
      activeTurns: { ...bridge.getActiveTurns(), ...apiChat.getActiveTurns(), ...voiceReplies.getActiveTurns() },
      conversations: conversations.list(),
      connectionStatus: latestConnectionStatus(),
      channel,
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
        const conversation = await conversations.updateActivity(
          conversationId,
          {
            lastActivityAt: timestamp,
          },
        );
        publishConversation(conversation);
      });
    }, 250),
  );
};

const apiChat = new ApiChat(
  (event) => {
    voiceReplies.receive(event);
    if (event.type === "assistant-delta" || event.type === "turn-completed")
      scheduleConversationActivity(event.conversationId);
  },
  async (conversationId, usage) => {
    const current = conversations.require(conversationId);
    const conversation = await conversations.updateRuntime(conversationId, {
      totalTokens: (current.totalTokens ?? 0) + usage.totalTokens,
      uncachedTotalTokens:
        (current.uncachedTotalTokens ?? 0) + usage.uncachedTotalTokens,
    });
    publishConversation(conversation);
  },
  files,
);

bridge.on("event", (event: any) => {
  const capture = workspaceFiles.get(event.conversationId);
  if (event.type === "turn-completed" && capture) {
    workspaceFiles.delete(event.conversationId);
    void capture
      .finish(files, event.conversationId, event.turnId)
      .then((attachments) => {
        if (attachments.length)
          broadcast({
            type: "files",
            conversationId: event.conversationId,
            turnId: event.turnId,
            files: attachments,
          });
      })
      .catch((error) =>
        broadcast({
          type: "files-error",
          conversationId: event.conversationId,
          message: (error as Error).message,
        }),
      )
      .finally(() => voiceReplies.receive(event));
  } else voiceReplies.receive(event);
  if (
    typeof event?.conversationId === "string" &&
    (event.type === "assistant-delta" || event.type === "turn-completed")
  )
    scheduleConversationActivity(event.conversationId);
});
bridge.on(
  "thread",
  ({
    conversationId,
    threadId,
    metadata,
  }: ConversationThreadBinding & { conversationId: string }) => {
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
    const config = await saveConfig(request.body);
    channel = await readChannel();
    broadcast({ type: "channel", channel });
    response.json(config);
  } catch (error) {
    response.status(400).json({ error: (error as Error).message });
  }
});
app.post("/api/connection/test", async (_request, response) => {
  try {
    const config = await readConfig();
    if (config.channel.kind === "api") {
      response.json({ state: "ready", message: `目前通道：${channel.name}` });
    } else response.json(await bridge.connect(config));
  } catch (error) {
    const status = { state: "error", message: (error as Error).message };
    broadcast({ type: "connection", status });
    response.status(500).json({ error: status.message });
  }
});
const chatServices = {
  bridge,
  apiChat,
  voiceReplies,
  conversations,
  files,
  messages,
  publishMessages: (conversationId: string) => broadcast({ type: "messages-updated", conversationId }),
  publishConversation,
};
app.use("/api", messageRoutes(messages, id => conversations.require(id), streamId, chatServices.publishMessages));
app.use("/api", conversationRoutes({ ...chatServices, activityTimers }));
app.use(
  "/api",
  turnRoutes({
    ...chatServices,
    workspaceFiles,
    waitForConversationWrites: () => conversationWriteQueue,
  }),
);

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, "../../client/dist");
app.use(express.static(clientDist));
app.get("*splat", (_request, response) =>
  response.sendFile(path.join(clientDist, "index.html")),
);

const lan = process.argv.includes("--lan");
const port = lan ? 5173 : 8787;
server.listen(port, lan ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`Mian: http://127.0.0.1:${port}`);
  if (lan)
    for (const address of Object.values(networkInterfaces()).flat())
      if (address?.family === "IPv4" && !address.internal)
        console.log(`Mian LAN: http://${address.address}:${port}`);
});
const shutdown = async () => {
  apiChat.close();
  bridge.close();
  await voiceReplies.close();
  await messages.close();
  server.close();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
