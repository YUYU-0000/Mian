import assert from "node:assert/strict";
import test from "node:test";
import { ChatSessionStore } from "../client/src/chatSession.ts";
import { chatHistory } from "../client/src/chatModel.ts";
import type { ChatMessage } from "../client/src/types.ts";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const options = () => ({
  storage: new MemoryStorage(),
  nowLabel: () => "15:30",
  schedule: () => 0 as unknown as ReturnType<typeof setTimeout>,
  cancelSchedule: () => {},
});

test("API requests include public user/assistant history after reload and fork", async () => {
  const shared = options();
  const sent: ChatMessage[][] = [];
  const apiClient = {
    send: async (_text: string, _id: string, messages?: ChatMessage[]) => {
      sent.push(messages!);
      return { turnId: `turn-${sent.length}` };
    },
    stop: async () => {},
  };
  const store = new ChatSessionStore({
    ...shared,
    apiClient,
    conversationId: "c1",
  });
  store.saveUserRecord("第一问");
  await store.startPendingTurn();
  store.enqueueEvent({
    type: "assistant-delta",
    turnId: "turn-1",
    delta:
      "<mian-thinking>不应发给服务商</mian-thinking><mian-bubble>第一答</mian-bubble>",
  });
  store.enqueueEvent({
    type: "turn-completed",
    turnId: "turn-1",
    status: "completed",
  });
  store.synchronizeRemoteTurn(null, false);
  store.dispose();
  const restored = new ChatSessionStore({
    ...shared,
    apiClient,
    conversationId: "c1",
  });
  const branch = new ChatSessionStore({
    ...options(),
    apiClient,
    conversationId: "branch",
  });
  branch.seedFrom(restored.getSnapshot());
  branch.saveUserRecord("分支问题");
  await branch.startPendingTurn();
  assert.deepEqual(sent[1], [
    { role: "user", content: "第一问" },
    { role: "assistant", content: "第一答" },
    { role: "user", content: "分支问题" },
  ]);
  assert.equal(restored.getSnapshot().messages.length, 2);
  branch.dispose();
  restored.dispose();
});

test("API failures retain the user message and retry the same history", async () => {
  const errors: unknown[] = [];
  const sent: ChatMessage[][] = [];
  const store = new ChatSessionStore({
    ...options(),
    conversationId: "c1",
    onSendError: (error) => errors.push(error),
    apiClient: {
      stop: async () => {},
      send: async (_text, _id, history) => {
        sent.push(history!);
        return { turnId: `turn-${sent.length}` };
      },
    },
  });
  store.saveUserRecord("请回答");
  await store.startPendingTurn();
  store.enqueueEvent({
    type: "turn-started",
    turnId: "turn-1",
    format: "plain",
  });
  store.enqueueEvent({
    type: "assistant-delta",
    turnId: "turn-1",
    format: "plain",
    delta: "没说完",
  });
  store.enqueueEvent({
    type: "turn-completed",
    turnId: "turn-1",
    format: "plain",
    status: "failed",
    error: "Insufficient quota.",
  });
  assert.equal(store.getSnapshot().turnPhase, "idle");
  assert.equal(store.getSnapshot().messages[0].role, "user");
  assert.equal((errors[0] as Error).message, "Insufficient quota.");
  await store.startPendingTurn();
  assert.deepEqual(sent, [
    [{ role: "user", content: "请回答" }],
    [{ role: "user", content: "请回答" }],
  ]);
  assert.equal(
    store.getSnapshot().messages.filter((group) => group.role === "user")
      .length,
    1,
  );
  store.dispose();
});

test("non-streaming API text is shown whole and Codex tags remain literal text", async () => {
  const store = new ChatSessionStore({ ...options(), conversationId: "c1" });
  const text = "普通正文 <mian-thinking>这只是文本</mian-thinking>";
  store.enqueueEvent({
    type: "turn-started",
    turnId: "whole",
    format: "plain",
  });
  store.enqueueEvent({
    type: "assistant-delta",
    turnId: "whole",
    delta: text,
    format: "plain",
    immediate: true,
  });
  store.enqueueEvent({
    type: "turn-completed",
    turnId: "whole",
    status: "completed",
    format: "plain",
  });
  const snapshot = store.getSnapshot();
  const reply = snapshot.messages[0];
  assert.equal(reply.role, "assistant");
  if (reply.role !== "assistant") return;
  assert.equal(reply.thinking, "");
  assert.deepEqual(reply.tools, []);
  assert.deepEqual(reply.approvals, []);
  assert.deepEqual(snapshot.visualReplies.whole.bubbles, [text]);
  assert.deepEqual(chatHistory(snapshot.messages), [
    { role: "assistant", content: text },
  ]);
  store.dispose();
});

test("an API error arriving before the HTTP response cannot resurrect the turn", async () => {
  let store: ChatSessionStore;
  store = new ChatSessionStore({
    ...options(),
    conversationId: "c1",
    apiClient: {
      stop: async () => {},
      send: async () => {
        store.enqueueEvent({
          type: "turn-started",
          turnId: "fast",
          format: "plain",
        });
        store.enqueueEvent({
          type: "turn-completed",
          turnId: "fast",
          status: "failed",
          format: "plain",
          error: "Invalid API key.",
        });
        return { turnId: "fast" };
      },
    },
  });
  store.saveUserRecord("保留这条消息");
  await store.startPendingTurn();
  assert.equal(store.getSnapshot().turnPhase, "idle");
  assert.equal(store.getSnapshot().activeTurnId, null);
  store.dispose();
});
