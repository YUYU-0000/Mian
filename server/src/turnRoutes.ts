import { Router } from "express";
import { readConfig } from "./config.js";
import { readClues } from "./clues.js";
import { selectCluePrompt } from "./clueSelection.js";
import { markToolsUnsupported, requirePreset } from "./apiPresets.js";
import {
  prepareConversationWorkspace,
  WorkspaceFiles,
} from "./workspaceFiles.js";
import { requestConversationId } from "./requestConversation.js";
import type { ConversationServices } from "./conversationRoutes.js";

export function turnRoutes({
  bridge,
  apiChat,
  conversations,
  files,
  publishConversation,
  workspaceFiles,
  waitForConversationWrites,
}: ConversationServices & {
  workspaceFiles: Map<string, WorkspaceFiles>;
  waitForConversationWrites: () => Promise<void>;
}) {
  const router = Router();
  router.post("/turn", async (request, response) => {
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
      const wall = await readClues();
      const recent = request.body.recentMessages ??
        request.body.messages ?? [{ role: "user", content: request.body.text }];
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
            {
              cards: wall.cards,
              recentMessages: recent,
              toolsUnsupported: preset.toolsUnsupported,
              markToolsUnsupported: () => markToolsUnsupported(preset.id),
            },
          ),
        );
        return;
      }
      await bridge.connect(config);
      const workspace = await prepareConversationWorkspace(
        config.workingDirectory,
        conversationId,
      );
      const prompt = await files.codexPrompt(
        conversationId,
        workspace,
        request.body.text.trim(),
        request.body.files ?? [],
      );
      const capture = await WorkspaceFiles.start(workspace);
      workspaceFiles.set(conversationId, capture);
      let result;
      try {
        result = await bridge.startTurn(prompt, conversationId, () =>
          selectCluePrompt(wall.cards, recent, bridge.selectClues.bind(bridge)),
        );
      } catch (error) {
        workspaceFiles.delete(conversationId);
        throw error;
      }
      // 先保存线程映射，再通知前端已开始回复。
      await waitForConversationWrites();
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
  router.post("/turn/:id/interrupt", async (request, response) => {
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
  router.post("/approval/:id", async (request, response) => {
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

  return router;
}
