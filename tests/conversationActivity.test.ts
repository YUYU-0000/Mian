import assert from "node:assert/strict";
import test from "node:test";
import {
  ChatSessionStore,
  lastVisibleMessageSummary,
} from "../client/src/chatSession.ts";

class MemoryStorage {
  private values = new Map<string, string>();
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

test("user and assistant activity report only the last visible message", () => {
  const activity: Array<{ lastActivityAt?: string; lastMessage?: string }> = [];
  const store = new ChatSessionStore({
    conversationId: "c1",
    storage: new MemoryStorage(),
    nowLabel: () => "08:44",
    nowIso: () => "2026-08-19T08:44:00.000Z",
    onActivity: (entry) => activity.push(entry),
    schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
    cancelSchedule: () => {},
  });

  store.saveUserRecord("测试用户的消息");
  store.enqueueEvent({ type: "turn-started", turnId: "turn-1" });
  store.enqueueEvent({
    type: "assistant-delta",
    turnId: "turn-1",
    delta:
      "<mian-thinking>公开思绪不应成为 Last MSG</mian-thinking><mian-bubble>Mian 的真实回复</mian-bubble>",
  });
  store.enqueueEvent({
    type: "tool",
    turnId: "turn-1",
    tool: {
      id: "tool-1",
      name: "read_file",
      detail: "工具结果也不应成为 Last MSG",
      state: "success",
    },
  });

  assert.deepEqual(activity[0], {
    lastActivityAt: "2026-08-19T08:44:00.000Z",
    lastMessage: "测试用户的消息",
  });
  assert.equal(activity.at(-1)?.lastMessage, "Mian 的真实回复");
  assert.equal(
    lastVisibleMessageSummary(store.getSnapshot().messages),
    "Mian 的真实回复",
  );
});
