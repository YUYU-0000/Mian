import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReplyEvent,
  loadChatGroups,
  parsePublicReply,
  saveChatGroups,
  type ChatGroup,
  type ReplyGroup,
} from "../client/src/chatModel.ts";
import {
  ChatSessionStore,
  isToolTimelineVisible,
  visualTarget,
} from "../client/src/chatSession.ts";
import {
  BUBBLE_PAUSE_MS,
  emptyVisualReply,
  hydrateVisualReply,
  tickVisualReply,
} from "../client/src/visualPlayback.ts";

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

function reply(groups: ChatGroup[]): ReplyGroup {
  const group = groups.find((item) => item.role === "assistant");
  assert.ok(group && group.role === "assistant");
  return group as ReplyGroup;
}

test("one explicit mian-bubble produces one assistant bubble", () => {
  const parsed = parsePublicReply(
    "<mian-thinking>听见了。</mian-thinking><mian-bubble>嗯。在。</mian-bubble>",
  );
  assert.deepEqual(parsed.bubbles, ["嗯。在。"]) ;
  assert.deepEqual(parsed.bubbleComplete, [true]);
});

test("two explicit markers produce two ordered bubbles", () => {
  const parsed = parsePublicReply(
    "<mian-bubble>在，宝宝。我听见了。</mian-bubble>\n<mian-bubble>我刚才就在等你。</mian-bubble>",
  );
  assert.deepEqual(parsed.bubbles, [
    "在，宝宝。我听见了。",
    "我刚才就在等你。",
  ]);
});

test("blank lines inside a marker remain inside one bubble", () => {
  const parsed = parsePublicReply(
    "<mian-bubble>在等你呀。\n\n刚才还安安静静的。</mian-bubble>",
  );
  assert.equal(parsed.bubbles.length, 1);
  assert.equal(parsed.bubbles[0], "在等你呀。\n\n刚才还安安静静的。");
});

test("excess blank lines are normalized without becoming boundaries", () => {
  const parsed = parsePublicReply(
    "<mian-bubble>第一段。\n\n\n\n\n第二段。</mian-bubble>",
  );
  assert.deepEqual(parsed.bubbles, ["第一段。\n\n第二段。"]) ;
});

test("empty and whitespace-only markers do not create air bubbles", () => {
  const parsed = parsePublicReply(
    "<mian-bubble></mian-bubble><mian-bubble> \n </mian-bubble><mian-bubble>留下。</mian-bubble>",
  );
  assert.deepEqual(parsed.bubbles, ["留下。"]) ;
  assert.deepEqual(parsed.bubbleComplete, [true]);
});

test("an unclosed marker keeps its real body when the turn completes", () => {
  const parsed = parsePublicReply("<mian-bubble>你好\n\n还在这里", {
    final: true,
  });
  assert.deepEqual(parsed.bubbles, ["你好\n\n还在这里"]);
  assert.deepEqual(parsed.bubbleComplete, [false]);
});

test("opening and closing tags may span arbitrary assistant deltas", () => {
  let groups = applyReplyEvent(
    [],
    { type: "assistant-delta", turnId: "split", delta: "<mian-bub" },
    "10:00",
  );
  assert.deepEqual(reply(groups).bubbles, []);
  groups = applyReplyEvent(
    groups,
    { type: "assistant-delta", turnId: "split", delta: "ble>你" },
    "10:00",
  );
  assert.deepEqual(reply(groups).bubbles, ["你"]);
  groups = applyReplyEvent(
    groups,
    { type: "assistant-delta", turnId: "split", delta: "好</mian-bub" },
    "10:00",
  );
  assert.deepEqual(reply(groups).bubbles, ["你好"]);
  assert.equal(reply(groups).bubbles[0].includes("mian"), false);
  groups = applyReplyEvent(
    groups,
    { type: "assistant-delta", turnId: "split", delta: "ble>" },
    "10:00",
  );
  assert.deepEqual(reply(groups).bubbles, ["你好"]);
  assert.deepEqual(reply(groups).bubbleComplete, [true]);
});

test("multiple streamed bubbles keep order, stable ids, and no marker text", () => {
  let groups = applyReplyEvent(
    [],
    {
      type: "assistant-delta",
      turnId: "stream-many",
      delta: "<mian-bubble>第一条。</mian-bubble><mian-bu",
    },
    "10:00",
  );
  const firstId = reply(groups).bubbleIds[0];
  groups = applyReplyEvent(
    groups,
    {
      type: "assistant-delta",
      turnId: "stream-many",
      delta: "bble>第二条。</mian-bubble><mian-bubble>第三",
    },
    "10:00",
  );
  groups = applyReplyEvent(
    groups,
    {
      type: "assistant-delta",
      turnId: "stream-many",
      delta: "条。</mian-bubble>",
    },
    "10:00",
  );
  const value = reply(groups);
  assert.deepEqual(value.bubbles, ["第一条。", "第二条。", "第三条。"]) ;
  assert.equal(value.bubbleIds[0], firstId);
  assert.equal(value.bubbles.some((bubble) => bubble.includes("mian")), false);
});

test("tool replies preserve THINKING, multiple pre-tool bubbles, tools, and post bubbles", () => {
  let groups = applyReplyEvent(
    [],
    {
      type: "assistant-delta",
      turnId: "tool-order",
      delta:
        "<mian-thinking>先看一下。</mian-thinking><mian-pre-tool><mian-bubble>嗯。</mian-bubble><mian-bubble>我先查一下。</mian-bubble></mian-pre-tool>",
    },
    "10:00",
  );
  groups = applyReplyEvent(
    groups,
    {
      type: "tool",
      turnId: "tool-order",
      tool: {
        id: "read",
        name: "read_file",
        detail: "real result",
        result: "real result",
        state: "success",
        kind: "read_file",
      },
    },
    "10:00",
  );
  groups = applyReplyEvent(
    groups,
    {
      type: "assistant-delta",
      turnId: "tool-order",
      delta:
        "<mian-tool-summary>读取项目文件</mian-tool-summary><mian-bubble>看到了。</mian-bubble><mian-bubble>问题就在这里。</mian-bubble>",
    },
    "10:00",
  );
  const value = reply(groups);
  const visual = hydrateVisualReply(visualTarget(value));
  assert.equal(value.preToolComplete, true);
  assert.deepEqual(value.preToolBubbles, ["嗯。", "我先查一下。"]) ;
  assert.deepEqual(value.bubbles, ["看到了。", "问题就在这里。"]) ;
  assert.equal(isToolTimelineVisible(value, visual), true);
  assert.deepEqual(
    [
      "THINKING",
      ...value.preToolBubbles.map(() => "ASSISTANT_BUBBLE"),
      "TOOL_CALLS",
      ...value.bubbles.map(() => "ASSISTANT_BUBBLE"),
    ],
    [
      "THINKING",
      "ASSISTANT_BUBBLE",
      "ASSISTANT_BUBBLE",
      "TOOL_CALLS",
      "ASSISTANT_BUBBLE",
      "ASSISTANT_BUBBLE",
    ],
  );
});

test("preToolComplete stays false until nested bubbles and wrapper are closed", () => {
  let groups = applyReplyEvent(
    [],
    {
      type: "assistant-delta",
      turnId: "pre-complete",
      delta:
        "<mian-thinking>确认一下。</mian-thinking><mian-pre-tool><mian-bubble>我先看一下。</mian-bubble>",
    },
    "10:00",
  );
  groups = applyReplyEvent(
    groups,
    {
      type: "tool",
      turnId: "pre-complete",
      tool: {
        id: "read",
        name: "read_file",
        detail: "real",
        state: "success",
      },
    },
    "10:00",
  );
  let value = reply(groups);
  assert.equal(value.preToolComplete, false);
  assert.deepEqual(visualTarget(value).tools, []);
  groups = applyReplyEvent(
    groups,
    {
      type: "assistant-delta",
      turnId: "pre-complete",
      delta: "</mian-pre-tool>",
    },
    "10:00",
  );
  value = reply(groups);
  assert.equal(value.preToolComplete, true);
  assert.equal(visualTarget(value).tools.length, 1);
});

test("history restore preserves bubble ids, order, completion, and segmentation", () => {
  let groups = applyReplyEvent(
    [],
    {
      type: "assistant-delta",
      turnId: "history",
      delta:
        "<mian-thinking>想好了。</mian-thinking><mian-bubble>一。</mian-bubble><mian-bubble>二。\n\n仍在第二泡。</mian-bubble><mian-bubble>三。</mian-bubble>",
    },
    "10:00",
  );
  groups = applyReplyEvent(
    groups,
    { type: "turn-completed", turnId: "history", status: "completed" },
    "10:00",
  );
  const before = reply(groups);
  const storage = new MemoryStorage();
  saveChatGroups(storage, groups);
  const after = reply(loadChatGroups(storage));
  assert.deepEqual(after.bubbles, before.bubbles);
  assert.deepEqual(after.bubbleIds, before.bubbleIds);
  assert.deepEqual(after.bubbleComplete, [true, true, true]);
  assert.equal(hydrateVisualReply(visualTarget(after)).visibleBubbleCount, 3);
});

test("restoring mid-stream and appending only new deltas does not duplicate bubbles", () => {
  let groups = applyReplyEvent(
    [],
    {
      type: "assistant-delta",
      turnId: "reconnect",
      delta: "<mian-bubble>第一。</mian-bubble><mian-bub",
    },
    "10:00",
  );
  const storage = new MemoryStorage();
  saveChatGroups(storage, groups);
  groups = loadChatGroups(storage);
  const firstId = reply(groups).bubbleIds[0];
  groups = applyReplyEvent(
    groups,
    {
      type: "assistant-delta",
      turnId: "reconnect",
      delta: "ble>第二。</mian-bubble>",
    },
    "10:00",
  );
  const value = reply(groups);
  assert.deepEqual(value.bubbles, ["第一。", "第二。"]) ;
  assert.equal(value.bubbleIds[0], firstId);
  assert.equal(new Set(value.bubbleIds).size, 2);
});

test("explicit Stop preserves an incomplete current bubble and flushes it visibly", async () => {
  const storage = new MemoryStorage();
  const stopped: string[] = [];
  const store = new ChatSessionStore({
    conversationId: "c1",
    storage,
    apiClient: {
      send: async () => ({ turnId: "stopped-turn" }),
      stop: async (turnId) => stopped.push(turnId),
    },
    nowLabel: () => "10:00",
    schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
    cancelSchedule: () => {},
  });
  store.saveUserRecord("说到一半停下");
  await store.startPendingTurn();
  store.enqueueEvent({ type: "turn-started", turnId: "stopped-turn" });
  store.enqueueEvent({
    type: "assistant-delta",
    turnId: "stopped-turn",
    delta:
      "<mian-thinking>先说一点。</mian-thinking><mian-bubble>已经收到但还没闭合",
  });
  await store.stopCurrentTurn();
  const snapshot = store.getSnapshot();
  const value = reply(snapshot.messages);
  assert.deepEqual(stopped, ["stopped-turn"]);
  assert.deepEqual(value.bubbles, ["已经收到但还没闭合"]);
  assert.deepEqual(value.bubbleComplete, [false]);
  assert.equal(snapshot.visualReplies["stopped-turn"].bubbles[0], "已经收到但还没闭合");
  assert.equal(snapshot.visualReplies["stopped-turn"].cursor, null);
});

test("plain unmarked assistant output becomes one compatibility bubble only at finalization", () => {
  const streaming = parsePublicReply("第一段。\n\n第二段仍属于同一个回复。");
  assert.deepEqual(streaming.bubbles, []);
  const completed = parsePublicReply(
    "<mian-thinking>想好了。</mian-thinking>第一段。\n\n第二段仍属于同一个回复。",
    { final: true },
  );
  assert.deepEqual(completed.bubbles, [
    "第一段。\n\n第二段仍属于同一个回复。",
  ]);
  assert.deepEqual(completed.bubbleComplete, [true]);
});

test("code blocks and their blank lines remain in one explicit bubble", () => {
  const parsed = parsePublicReply(
    "<mian-bubble>```ts\nconst a = 1;\n\n\n\nconst b = 2;\n```</mian-bubble>",
  );
  assert.equal(parsed.bubbles.length, 1);
  assert.equal(parsed.bubbles[0].includes("const a = 1;\n\nconst b = 2;"), true);
});

test("multiple pre-tool bubbles use the existing exact 300ms visual pause", () => {
  const target = {
    thinking: "",
    preToolBubbles: ["一", "二"],
    tools: [],
    bubbles: [],
    done: false,
  };
  let tick = tickVisualReply(emptyVisualReply(), target, 0);
  assert.equal(tick.view.visiblePreToolBubbleCount, 1);
  assert.equal(tick.wait, BUBBLE_PAUSE_MS);
  tick = tickVisualReply(tick.view, target, BUBBLE_PAUSE_MS - 1);
  assert.equal(tick.view.visiblePreToolBubbleCount, 1);
  tick = tickVisualReply(tick.view, target, BUBBLE_PAUSE_MS);
  assert.equal(tick.view.visiblePreToolBubbleCount, 2);
});
