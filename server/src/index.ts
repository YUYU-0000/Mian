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
import { WorkspaceFiles } from "./workspaceFiles.js";
import { readChannel, requirePreset } from "./apiPresets.js";
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
const files = new ChatFiles();
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
app.use(express.json({ limit: "4mb" }));
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
      activeTurnId:
        apiChat.getActiveTurns()[defaultConversationId] ??
        bridge.getActiveTurnId(defaultConversationId) ??
        null,
      defaultConversationId,
      activeTurns: { ...bridge.getActiveTurns(), ...apiChat.getActiveTurns() },
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
    broadcast(event);
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
      .finally(() => broadcast(event));
  } else broadcast(event);
  if (
    typeof event?.conversationId === "string" &&
    (event.type === "assistant-delta" || event.type === "turn-completed")
  )
    scheduleConversationActivity(event.conversationId);
});
bridge.on(
  "files-changed",
  ({ conversationId, paths }: { conversationId: string; paths: string[] }) => {
    workspaceFiles.get(conversationId)?.add(paths);
  },
);
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
app.get("/api/conversations", (_request, response) =>
  response.json({
    defaultConversationId: conversations.defaultConversationId(),
    conversations: conversations.list(),
  }),
);
app.post("/api/conversations", async (_request, response) => {
  try {
    const config = await readConfig();
    if (config.channel.kind === "api") {
      const preset = await requirePreset(config.channel.presetId);
      const conversation = await conversations.createRoot({
        threadId: null,
        metadata: { model: preset.model },
      });
      bridge.restoreConversationThreads([conversation]);
      publishConversation(conversation);
      response.status(201).json({ conversation });
      return;
    }
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
    const config = await readConfig();
    if (config.channel.kind === "api") {
      if (
        bridge.isConversationBusy(request.params.id) ||
        apiChat.isBusy(request.params.id)
      )
        throw new Error("当前会话仍在运行或等待权限处理");
      const preset = await requirePreset(config.channel.presetId);
      const conversation = await conversations.createBranch(request.params.id, {
        threadId: null,
        metadata: {
          model: preset.model,
          reasoningEffort: null,
          collaborationMode: null,
        },
      });
      await files.copyConversation(
        request.params.id,
        conversation.conversationId,
      );
      bridge.restoreConversationThreads([conversation]);
      publishConversation(conversation);
      response.status(201).json({ conversation });
      return;
    }
    await bridge.connect(await readConfig());
    const binding = await bridge.forkConversationThread(request.params.id);
    const conversation = await conversations.createBranch(
      request.params.id,
      binding,
    );
    await files.copyConversation(
      request.params.id,
      conversation.conversationId,
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
    if (
      bridge.isConversationBusy(conversationId) ||
      apiChat.isBusy(conversationId)
    )
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
    const config = await readConfig();
    if (
      bridge.isConversationBusy(conversationId) ||
      apiChat.isBusy(conversationId)
    )
      throw new Error("当前会话已有正在运行的 turn");
    if (config.channel.kind === "api") {
      const preset = await requirePreset(config.channel.presetId);
      const conversation = await conversations.updateRuntime(conversationId, {
        model: preset.model,
        reasoningEffort: null,
        collaborationMode: null,
      });
      publishConversation(conversation);
      const messages = await files.apiMessages(
        conversationId,
        request.body.messages ?? [
          {
            role: "user",
            content: request.body.text.trim(),
            files: (request.body.files ?? []).map((id: string) => ({ id })),
          },
        ],
      );
      response.json(
        apiChat.startTurn(
          conversationId,
          preset,
          messages,
          request.body.localTime,
        ),
      );
      return;
    }
    await bridge.connect(config);
    const prompt = await files.codexPrompt(
      conversationId,
      config.workingDirectory,
      request.body.text.trim(),
      request.body.files ?? [],
    );
    const capture = new WorkspaceFiles(config.workingDirectory);
    workspaceFiles.set(conversationId, capture);
    let result;
    try {
      result = await bridge.startTurn(prompt, conversationId);
    } catch (error) {
      capture.close();
      workspaceFiles.delete(conversationId);
      throw error;
    }
    // 先保存线程映射，再通知前端已开始回复。
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
    if (apiChat.isBusy(conversationId))
      apiChat.interrupt(request.params.id, conversationId);
    else await bridge.interrupt(request.params.id, conversationId);
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

const lan = process.argv.includes("--lan");
const port = lan ? 5173 : 8787;
server.listen(port, lan ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`Mian: http://127.0.0.1:${port}`);
  if (lan)
    for (const address of Object.values(networkInterfaces()).flat())
      if (address?.family === "IPv4" && !address.internal)
        console.log(`Mian LAN: http://${address.address}:${port}`);
});
const shutdown = () => {
  for (const capture of workspaceFiles.values()) capture.close();
  apiChat.close();
  bridge.close();
  server.close();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
