import assert from "node:assert/strict";
import test from "node:test";
import { applyReplyEvent, type ChatGroup } from "../client/src/chatModel.ts";
import { shouldShowThinkingHourglass } from "../client/src/thinkingStatus.ts";
import {
  emptyVisualReply,
  tickVisualReply,
  type VisualReply,
  type VisualTarget,
} from "../client/src/visualPlayback.ts";

function reply(groups: ChatGroup[]) {
  const value = groups.find((group) => group.role === "assistant");
  assert.ok(value && value.role === "assistant");
  return value;
}

function target(thinking: string, bubbles: string[] = []): VisualTarget {
  return {
    thinking,
    preToolBubbles: [],
    tools: [],
    bubbles,
    done: false,
  };
}

test("backend completion keeps the hourglass while visible THINKING is behind", () => {
  let groups = applyReplyEvent(
    [],
    { type: "turn-started", turnId: "visual-turn" },
    "10:00",
  );
  let message = reply(groups);
  let visual = emptyVisualReply();
  assert.equal(
    shouldShowThinkingHourglass(message, visual, "visual-turn"),
    true,
    "the waiting reply shows its hourglass before the first reasoning item",
  );

  groups = applyReplyEvent(
    groups,
    {
      type: "thinking-started",
      turnId: "visual-turn",
      itemId: "reasoning-1",
    },
    "10:00",
  );
  groups = applyReplyEvent(
    groups,
    {
      type: "assistant-delta",
      turnId: "visual-turn",
      delta:
        "<mian-thinking>最后一个字也要显示完。</mian-thinking><mian-bubble>正文还会继续。</mian-bubble>",
    },
    "10:00",
  );
  groups = applyReplyEvent(
    groups,
    {
      type: "thinking-completed",
      turnId: "visual-turn",
      itemId: "reasoning-1",
    },
    "10:00",
  );
  message = reply(groups);
  assert.equal(message.activeReasoningItemIds.length, 0);
  assert.equal(visual.thinking, "");
  assert.equal(
    shouldShowThinkingHourglass(message, visual, "visual-turn"),
    true,
    "app-server completion alone must not hide a visually pending thought",
  );

  const playbackTarget = target(message.thinking, message.bubbles);
  visual = tickVisualReply(visual, playbackTarget, 0).view;
  assert.notEqual(visual.thinking, message.thinking);
  assert.equal(
    shouldShowThinkingHourglass(message, visual, "visual-turn"),
    true,
  );
});

test("the last visible THINKING grapheme removes the hourglass before bubbles finish", () => {
  let groups = applyReplyEvent(
    [],
    {
      type: "assistant-delta",
      turnId: "last-grapheme",
      delta:
        "<mian-thinking>一二三。</mian-thinking><mian-bubble>这段正文仍在逐字输出。</mian-bubble>",
    },
    "10:00",
  );
  groups = applyReplyEvent(
    groups,
    {
      type: "thinking-completed",
      turnId: "last-grapheme",
      itemId: "reasoning-1",
    },
    "10:00",
  );
  const message = reply(groups);
  const playbackTarget = target(message.thinking, message.bubbles);
  let visual: VisualReply = emptyVisualReply();
  let now = 0;

  while (visual.thinking !== message.thinking) {
    const before = visual.thinking;
    visual = tickVisualReply(visual, playbackTarget, now).view;
    now += 30;
    if (visual.thinking !== message.thinking) {
      assert.notEqual(visual.thinking, before);
      assert.equal(
        shouldShowThinkingHourglass(message, visual, "last-grapheme"),
        true,
      );
    }
  }

  assert.equal(visual.thinking, message.thinking);
  assert.equal(visual.bubbles[0] ?? "", "");
  assert.equal(
    shouldShowThinkingHourglass(message, visual, "last-grapheme"),
    false,
    "the render condition flips on the same visual tick as the final thought grapheme",
  );

  visual = tickVisualReply(visual, playbackTarget, now).view;
  assert.notEqual(visual.bubbles[0] ?? "", message.bubbles[0]);
  assert.equal(
    shouldShowThinkingHourglass(message, visual, "last-grapheme"),
    false,
    "assistant bubble playback must not restore the THINKING hourglass",
  );
});

test("a direct no-reasoning reply ends the initial waiting state", () => {
  let groups = applyReplyEvent(
    [],
    { type: "turn-started", turnId: "no-reasoning" },
    "10:00",
  );
  assert.equal(
    shouldShowThinkingHourglass(
      reply(groups),
      emptyVisualReply(),
      "no-reasoning",
    ),
    true,
  );
  groups = applyReplyEvent(
    groups,
    {
      type: "assistant-delta",
      turnId: "no-reasoning",
      delta: "<mian-bubble>直接回答。</mian-bubble>",
    },
    "10:00",
  );
  assert.equal(
    shouldShowThinkingHourglass(
      reply(groups),
      emptyVisualReply(),
      "no-reasoning",
    ),
    false,
  );
});
