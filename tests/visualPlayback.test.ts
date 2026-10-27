import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSISTANT_CHARACTER_MS,
  BUBBLE_PAUSE_MS,
  FAST_CHARACTER_MS,
  emptyVisualReply,
  hydrateVisualReply,
  tickVisualReply,
  type VisualTarget,
} from "../client/src/visualPlayback";

const target = (overrides: Partial<VisualTarget> = {}): VisualTarget => ({
  thinking: "",
  preToolBubbles: [],
  tools: [],
  bubbles: [],
  done: false,
  ...overrides,
});

test("the first assistant delta creates a bubble without revealing the full reply", () => {
  const received = target({ bubbles: ["助手一直都在这里"] });
  const tick = tickVisualReply(emptyVisualReply(), received, 0);
  assert.equal(tick.view.visibleBubbleCount, 1);
  assert.equal(tick.view.bubbles[0], "助");
  assert.notEqual(tick.view.bubbles[0], received.bubbles[0]);
  assert.deepEqual(tick.view.cursor, { kind: "bubble", index: 0 });
});

test("assistant text advances at 50ms per grapheme without splitting emoji", () => {
  const received = target({ bubbles: ["你😀好"] });
  let view = tickVisualReply(emptyVisualReply(), received, 0).view;
  assert.equal(view.bubbles[0], "你");
  let tick = tickVisualReply(view, received, ASSISTANT_CHARACTER_MS - 1);
  assert.equal(tick.view.bubbles[0], "你");
  tick = tickVisualReply(view, received, ASSISTANT_CHARACTER_MS);
  view = tick.view;
  assert.equal(view.bubbles[0], "你😀");
  view = tickVisualReply(view, received, ASSISTANT_CHARACTER_MS * 2).view;
  assert.equal(view.bubbles[0], "你😀好");
});

test("thinking and real tool results advance at 30ms per grapheme", () => {
  const thinkingTarget = target({ thinking: "想好了" });
  let thinking = tickVisualReply(emptyVisualReply(), thinkingTarget, 0).view;
  assert.equal(thinking.thinking, "想");
  thinking = tickVisualReply(
    thinking,
    thinkingTarget,
    FAST_CHARACTER_MS,
  ).view;
  assert.equal(thinking.thinking, "想好");

  const toolTarget = target({ tools: [{ id: "read", text: "读取成功" }] });
  let tool = tickVisualReply(emptyVisualReply(), toolTarget, 0).view;
  assert.equal(tool.tools.read, "读");
  tool = tickVisualReply(tool, toolTarget, FAST_CHARACTER_MS).view;
  assert.equal(tool.tools.read, "读取");
});

test("a pre-tool assistant bubble plays before real tool results", () => {
  const received = target({
    thinking: "想好了",
    preToolBubbles: ["我先看一下。"],
    tools: [{ id: "read", text: "读取成功" }],
    bubbles: ["已经确认。"],
  });
  let view = hydrateVisualReply(target({ thinking: "想好了" }));
  let tick = tickVisualReply(view, received, 0);
  assert.deepEqual(tick.view.cursor, { kind: "preToolBubble", index: 0 });
  assert.equal(tick.view.preToolBubbles[0], "我");
  assert.equal(tick.view.tools.read, undefined);
  view = hydrateVisualReply({
    ...received,
    tools: [],
    bubbles: [],
  });
  tick = tickVisualReply(view, received, 0);
  assert.deepEqual(tick.view.cursor, { kind: "tool", toolId: "read" });
});

test("successive received deltas remain ordered without loss or duplication", () => {
  let view = emptyVisualReply();
  view = tickVisualReply(view, target({ bubbles: ["甲"] }), 0).view;
  view = tickVisualReply(
    view,
    target({ bubbles: ["甲乙"] }),
    ASSISTANT_CHARACTER_MS,
  ).view;
  view = tickVisualReply(
    view,
    target({ bubbles: ["甲乙丙"] }),
    ASSISTANT_CHARACTER_MS * 2,
  ).view;
  assert.equal(view.bubbles[0], "甲乙丙");
});

test("each later bubble is introduced once after the exact 300ms pause", () => {
  const received = target({ bubbles: ["一", "二"] });
  let tick = tickVisualReply(emptyVisualReply(), received, 0);
  assert.equal(tick.view.visibleBubbleCount, 1);
  assert.equal(tick.wait, BUBBLE_PAUSE_MS);
  tick = tickVisualReply(tick.view, received, BUBBLE_PAUSE_MS - 1);
  assert.equal(tick.view.visibleBubbleCount, 1);
  tick = tickVisualReply(tick.view, received, BUBBLE_PAUSE_MS);
  assert.equal(tick.view.visibleBubbleCount, 2);
  assert.equal(tick.view.bubbles[1], "二");
  const stable = tickVisualReply(tick.view, received, BUBBLE_PAUSE_MS + 1);
  assert.equal(stable.view.visibleBubbleCount, 2);
});

test("completion removes the cursor only after all received text is displayed", () => {
  const received = target({ bubbles: ["完成"], done: true });
  let tick = tickVisualReply(emptyVisualReply(), received, 0);
  assert.equal(tick.settled, false);
  assert.notEqual(tick.view.cursor, null);
  tick = tickVisualReply(tick.view, received, ASSISTANT_CHARACTER_MS);
  assert.equal(tick.view.bubbles[0], "完成");
  assert.equal(tick.view.cursor, null);
  assert.equal(tick.settled, true);
});

test("interrupt flush keeps every already received character and removes the cursor", () => {
  const received = target({
    thinking: "先确认一下",
    tools: [{ id: "path", text: "C:\\Users\\Example\\Desktop\\Mian" }],
    bubbles: ["已经收到了这段回复"],
  });
  const partial = tickVisualReply(emptyVisualReply(), received, 0).view;
  assert.notEqual(partial.thinking, received.thinking);
  const flushed = hydrateVisualReply(received);
  assert.equal(flushed.thinking, received.thinking);
  assert.equal(flushed.tools.path, received.tools[0].text);
  assert.deepEqual(flushed.bubbles, received.bubbles);
  assert.equal(flushed.cursor, null);
});
