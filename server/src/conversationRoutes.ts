import { Router } from "express";
import { readConfig } from "./config.js";
import { requirePreset } from "./apiPresets.js";
import { randomUUID } from "node:crypto";
import { prepareConversationWorkspace } from "./workspaceFiles.js";
import type { ApiChat } from "./apiChat.js";
import type { ChatFiles } from "./chatFiles.js";
import type { CodexBridge } from "./codex.js";
import type { ConversationRegistry } from "./conversations.js";
import type { ConversationRecord } from "./types.js";

export type ConversationServices = {
  bridge: CodexBridge;
  apiChat: ApiChat;
  conversations: ConversationRegistry;
  files: ChatFiles;
  publishConversation: (conversation: ConversationRecord) => void;
};

export function conversationRoutes({
  bridge,
  apiChat,
  conversations,
  files,
  publishConversation,
  activityTimers,
}: ConversationServices & { activityTimers: Map<string, NodeJS.Timeout> }) {
  const router = Router();
  router.get("/conversations", (_request, response) =>
    response.json({
      defaultConversationId: conversations.defaultConversationId(),
      conversations: conversations.list(),
    }),
  );
  router.post("/conversations", async (_request, response) => {
    try {
      const config = await readConfig();
      const conversationId = randomUUID();
      await prepareConversationWorkspace(
        config.workingDirectory,
        conversationId,
      );
      if (config.channel.kind === "api") {
        const preset = await requirePreset(config.channel.presetId);
        const conversation = await conversations.createRoot(
          { threadId: null, metadata: { model: preset.model } },
          conversationId,
        );
        bridge.restoreConversationThreads([conversation]);
        publishConversation(conversation);
        response.status(201).json({ conversation });
        return;
      }
      await bridge.connect(await readConfig());
      const binding = await bridge.createConversationThread(conversationId);
      const conversation = await conversations.createRoot(
        binding,
        conversationId,
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
  router.post("/conversations/:id/fork", async (request, response) => {
    try {
      conversations.require(request.params.id);
      const config = await readConfig();
      const conversationId = randomUUID();
      await prepareConversationWorkspace(
        config.workingDirectory,
        conversationId,
      );
      if (config.channel.kind === "api") {
        if (
          bridge.isConversationBusy(request.params.id) ||
          apiChat.isBusy(request.params.id)
        )
          throw new Error("当前会话仍在运行或等待权限处理");
        const preset = await requirePreset(config.channel.presetId);
        const conversation = await conversations.createBranch(
          request.params.id,
          {
            threadId: null,
            metadata: {
              model: preset.model,
              reasoningEffort: null,
              collaborationMode: null,
            },
          },
          conversationId,
        );
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
      await prepareConversationWorkspace(
        config.workingDirectory,
        request.params.id,
      );
      const binding = await bridge.forkConversationThread(
        request.params.id,
        conversationId,
      );
      const conversation = await conversations.createBranch(
        request.params.id,
        binding,
        conversationId,
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
  router.patch("/conversations/:id", async (request, response) => {
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
  router.patch("/conversations/:id/activity", async (request, response) => {
    try {
      const patch = request.body as Record<string, unknown>;
      const conversation = await conversations.updateActivity(
        request.params.id,
        {
          lastActivityAt:
            typeof patch.lastActivityAt === "string"
              ? patch.lastActivityAt
              : undefined,
          lastMessage:
            typeof patch.lastMessage === "string"
              ? patch.lastMessage
              : undefined,
        },
      );
      publishConversation(conversation);
      response.json({ conversation });
    } catch (error) {
      response.status(404).json({ error: (error as Error).message });
    }
  });
  router.delete("/conversations/:id", async (request, response) => {
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
  return router;
}
