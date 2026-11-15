import { Router } from "express";
import type { ConversationMessages } from "./messages.js";

export function messageRoutes(messages: ConversationMessages, requireConversation: (id: string) => unknown, streamId: string, publish: (id: string) => void) {
  const router = Router();
  router.get("/conversations/:id/messages", async (request, response) => {
    try {
      requireConversation(request.params.id);
      response.json({ ...await messages.read(request.params.id), streamId });
    } catch (error) {
      response.status(404).json({ error: (error as Error).message });
    }
  });
  router.put("/conversations/:id/messages", async (request, response) => {
    try {
      requireConversation(request.params.id);
      if (!Array.isArray(request.body.groups)) throw new Error("消息格式不正确");
      const snapshot = await messages.save(request.params.id, request.body.groups, request.body.initialize === true);
      publish(request.params.id);
      response.json({ ...snapshot, streamId });
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
    }
  });
  return router;
}
