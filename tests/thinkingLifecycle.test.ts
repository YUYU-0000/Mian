import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReplyEvent,
  isThinkingRunning,
  loadChatGroups,
  saveChatGroups,
  type ChatGroup,
} from "../client/src/chatModel.ts";
import { CodexBridge } from "../server/src/codex.ts";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function assistant(groups: ChatGroup[]) {
  const reply = groups.find((group) => group.role === "assistant");
  assert.ok(reply && reply.role === "assistant");
  return reply;
}

test("app-server reasoning item lifecycle maps its own stable item id", () => {
  const bridge = new CodexBridge(() => {
    throw new Error("this mapping test must not spawn app-server");
  });
  const events: unknown[] = [];
  bridge.on("event", (event) => events.push(event));
  bridge.restoreConversationThreads([
    { conversationId: "c1", threadId: "thread-1" },
  ]);
  const notify = (
    bridge as unknown as {
      handleNotification(method: string, params: unknown): void;
    }
  ).handleNotification.bind(bridge);

  notify("turn/started", {
    threadId: "thread-1",
    turn: { id: "turn-1" },
  });
  events.length = 0;

  notify("item/started", {
    turnId: "turn-1",
    item: { type: "reasoning", id: "reasoning-1", summary: [], content: [] },
  });
  notify("item/reasoning/summaryTextDelta", {
    turnId: "turn-1",
    itemId: "reasoning-1",
    summaryIndex: 0,
    delta: "公开摘要",
  });
  notify("item/completed", {
    turnId: "turn-1",
    item: {
      type: "reasoning",
      id: "reasoning-1",
      summary: ["公开摘要"],
      content: [],
    },
  });

  assert.deepEqual(events, [
    { type: "thinking-started", conversationId: "c1", turnId: "turn-1", itemId: "reasoning-1" },
    {
      type: "thinking-delta",
      conversationId: "c1",
      turnId: "turn-1",
      itemId: "reasoning-1",
      delta: "公开摘要",
    },
    { type: "thinking-completed", conversationId: "c1", turnId: "turn-1", itemId: "reasoning-1" },
  ]);
});

test("THINKING loading follows reasoning only, not bubbles or tools", () => {
  let groups = applyReplyEvent(
    [],
    { type: "thinking-started", turnId: "turn-1", itemId: "reasoning-1" },
    "10:00",
  );
  assert.equal(isThinkingRunning(assistant(groups)), true);

  groups = applyReplyEvent(
    groups,
    {
      type: "thinking-delta",
      turnId: "turn-1",
      itemId: "reasoning-1",
      delta: "摘要仍在追加",
    },
    "10:00",
  );
  assert.deepEqual(assistant(groups).activeReasoningItemIds, ["reasoning-1"]);

  groups = applyReplyEvent(
    groups,
    { type: "thinking-completed", turnId: "turn-1", itemId: "reasoning-1" },
    "10:00",
  );
  assert.equal(isThinkingRunning(assistant(groups)), false);

  groups = applyReplyEvent(
    groups,
    {
      type: "assistant-delta",
      turnId: "turn-1",
      delta:
        "<mian-thinking>我想好了。</mian-thinking><mian-pre-tool><mian-bubble>我先确认一下。</mian-bubble></mian-pre-tool>",
    },
    "10:00",
  );
  groups = applyReplyEvent(
    groups,
    {
      type: "tool",
      turnId: "turn-1",
      tool: {
        id: "tool-1",
        name: "Get-Location",
        detail: "",
        state: "running",
      },
    },
    "10:00",
  );
  assert.equal(isThinkingRunning(assistant(groups)), false);
  assert.equal(assistant(groups).tools[0].state, "running");
});

test("a later reasoning item reopens the one THINKING status slot", () => {
  let groups = applyReplyEvent(
    [],
    { type: "thinking-started", turnId: "turn-2", itemId: "reasoning-1" },
    "10:00",
  );
  groups = applyReplyEvent(
    groups,
    { type: "thinking-completed", turnId: "turn-2", itemId: "reasoning-1" },
    "10:00",
  );
  groups = applyReplyEvent(
    groups,
    {
      type: "thinking-delta",
      turnId: "turn-2",
      itemId: "reasoning-2",
      delta: "第二段摘要",
    },
    "10:01",
  );
  assert.equal(groups.filter((group) => group.role === "assistant").length, 1);
  assert.deepEqual(assistant(groups).activeReasoningItemIds, ["reasoning-2"]);
  assert.equal(isThinkingRunning(assistant(groups)), true);

  groups = applyReplyEvent(
    groups,
    { type: "thinking-completed", turnId: "turn-2", itemId: "reasoning-2" },
    "10:01",
  );
  assert.equal(isThinkingRunning(assistant(groups)), false);
});

test("completion, failure persistence, and history restore cannot leave a loader", () => {
  let groups = applyReplyEvent(
    [],
    { type: "thinking-started", turnId: "turn-3", itemId: "reasoning-3" },
    "10:00",
  );
  const activeStorage = new MemoryStorage();
  saveChatGroups(activeStorage, groups);
  assert.equal(isThinkingRunning(assistant(loadChatGroups(activeStorage))), true);

  groups = applyReplyEvent(
    groups,
    { type: "turn-completed", turnId: "turn-3", status: "failed" },
    "10:00",
  );
  assert.equal(isThinkingRunning(assistant(groups)), false);

  const historyStorage = new MemoryStorage();
  saveChatGroups(historyStorage, groups);
  assert.equal(isThinkingRunning(assistant(loadChatGroups(historyStorage))), false);

  const legacy = JSON.parse(JSON.stringify(groups)) as Array<Record<string, unknown>>;
  delete legacy[0].activeReasoningItemIds;
  historyStorage.setItem("mian.chat-groups.v2", JSON.stringify(legacy));
  assert.equal(isThinkingRunning(assistant(loadChatGroups(historyStorage))), false);
});

test("normal completion, Stop, failure, and rejection all clear reasoning loading", () => {
  for (const status of ["completed", "interrupted", "failed", "rejected"]) {
    let groups = applyReplyEvent(
      [],
      {
        type: "thinking-started",
        turnId: `turn-${status}`,
        itemId: `reasoning-${status}`,
      },
      "10:00",
    );
    assert.equal(isThinkingRunning(assistant(groups)), true);
    groups = applyReplyEvent(
      groups,
      { type: "turn-completed", turnId: `turn-${status}`, status },
      "10:00",
    );
    assert.equal(isThinkingRunning(assistant(groups)), false);
  }
});
