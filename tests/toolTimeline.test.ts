import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReplyEvent,
  loadChatGroups,
  saveChatGroups,
  type ChatGroup,
  type ReplyGroup,
} from "../client/src/chatModel.ts";
import {
  isToolTimelineVisible,
  visualTarget,
} from "../client/src/chatSession.ts";
import {
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
}

const tool = (id: string) => ({
  id,
  name: "read_file",
  detail: `result-${id}`,
  result: `result-${id}`,
  state: "success" as const,
  kind: "read_file",
});

function reply(groups: ChatGroup[]): ReplyGroup {
  const value = groups.find((group) => group.role === "assistant");
  assert.ok(value && value.role === "assistant");
  return value as ReplyGroup;
}

test("a real tool arriving first stays outside the visible timeline", () => {
  const group = reply(
    applyReplyEvent(
      [],
      { type: "tool", turnId: "tool-first", tool: tool("one") },
      "10:00",
    ),
  );
  assert.equal(group.tools.length, 1);
  assert.equal(group.preToolBubbles.length, 0);
  assert.equal(group.preToolComplete, false);
  const target = visualTarget(group);
  assert.deepEqual(target.tools, []);
  assert.deepEqual(target.bubbles, []);
  assert.equal(
    isToolTimelineVisible(group, hydrateVisualReply(target)),
    false,
  );
});

test("a complete model bridge plays fully before TOOL CALLS becomes visible", () => {
  let groups = applyReplyEvent(
    [],
    {
      type: "assistant-delta",
      turnId: "model-bridge",
      delta:
        "<mian-thinking>先替测试用户确认。</mian-thinking><mian-pre-tool>我先看一下。</mian-pre-tool>",
    },
    "10:00",
  );
  groups = applyReplyEvent(
    groups,
    { type: "tool", turnId: "model-bridge", tool: tool("one") },
    "10:00",
  );
  const group = reply(groups);
  assert.equal(group.preToolBubbles.length, 1);
  assert.equal(group.preToolComplete, true);
  const originalId = group.preToolBubbleIds[0];
  const target = visualTarget(group);
  let visual = emptyVisualReply();
  let now = 0;
  while (visual.preToolBubbles[0] !== group.preToolBubbles[0]) {
    visual = tickVisualReply(visual, target, now).view;
    if (visual.preToolBubbles[0] !== group.preToolBubbles[0])
      assert.equal(isToolTimelineVisible(group, visual), false);
    now += 50;
  }
  assert.equal(isToolTimelineVisible(group, visual), true);
  groups = applyReplyEvent(
    groups,
    { type: "turn-completed", turnId: "model-bridge", status: "completed" },
    "10:00",
  );
  const completed = reply(groups);
  assert.equal(completed.preToolBubbles.length, 1);
  assert.equal(completed.preToolBubbleIds[0], originalId);
});

test("completion adds one compatibility bridge before two real tools", () => {
  let groups = applyReplyEvent(
    [],
    { type: "tool", turnId: "fallback", tool: tool("one") },
    "10:00",
  );
  groups = applyReplyEvent(
    groups,
    { type: "tool", turnId: "fallback", tool: tool("two") },
    "10:00",
  );
  groups = applyReplyEvent(
    groups,
    {
      type: "assistant-delta",
      turnId: "fallback",
      delta:
        "<mian-thinking>先确认真实结果。</mian-thinking><mian-bubble>已经检查好了。</mian-bubble>",
    },
    "10:00",
  );
  const beforeCompletion = reply(groups);
  assert.equal(beforeCompletion.preToolBubbles.length, 0);
  assert.equal(
    isToolTimelineVisible(
      beforeCompletion,
      hydrateVisualReply(visualTarget(beforeCompletion)),
    ),
    false,
  );
  groups = applyReplyEvent(
    groups,
    { type: "turn-completed", turnId: "fallback", status: "completed" },
    "10:00",
  );
  const completed = reply(groups);
  assert.equal(completed.tools.length, 2);
  assert.equal(completed.preToolBubbles.length, 1);
  assert.equal(completed.preToolComplete, true);
  const visual = hydrateVisualReply(visualTarget(completed));
  assert.equal(isToolTimelineVisible(completed, visual), true);
  assert.deepEqual(
    [
      "THINKING",
      ...completed.preToolBubbles.map(() => "ASSISTANT_BUBBLE"),
      ...(isToolTimelineVisible(completed, visual) ? ["TOOL_CALLS"] : []),
      ...completed.bubbles.map(() => "ASSISTANT_BUBBLE"),
    ],
    [
      "THINKING",
      "ASSISTANT_BUBBLE",
      "TOOL_CALLS",
      "ASSISTANT_BUBBLE",
    ],
  );

  const storage = new MemoryStorage();
  saveChatGroups(storage, groups);
  const restored = reply(loadChatGroups(storage));
  assert.equal(restored.preToolComplete, true);
  assert.equal(restored.preToolBubbles.length, 1);
  assert.equal(restored.tools.length, 2);
  assert.equal(
    isToolTimelineVisible(
      restored,
      hydrateVisualReply(visualTarget(restored)),
    ),
    true,
  );
});

test("an unfinished model bridge is replaced once only when the turn ends", () => {
  let groups = applyReplyEvent(
    [],
    { type: "tool", turnId: "partial", tool: tool("one") },
    "10:00",
  );
  groups = applyReplyEvent(
    groups,
    {
      type: "assistant-delta",
      turnId: "partial",
      delta:
        "<mian-thinking>先确认。</mian-thinking><mian-pre-tool>我先看",
    },
    "10:00",
  );
  const partial = reply(groups);
  assert.equal(partial.preToolBubbles.length, 1);
  assert.equal(partial.preToolComplete, false);
  assert.equal(
    isToolTimelineVisible(partial, hydrateVisualReply(visualTarget(partial))),
    false,
  );
  groups = applyReplyEvent(
    groups,
    { type: "turn-completed", turnId: "partial", status: "completed" },
    "10:00",
  );
  const completed = reply(groups);
  assert.equal(completed.preToolBubbles.length, 1);
  assert.equal(completed.preToolComplete, true);
});
