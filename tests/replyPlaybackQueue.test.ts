import assert from "node:assert/strict";
import test from "node:test";
import {
  ReplyPlaybackQueue,
  MAX_PLAYBACK_BACKLOG_MS,
} from "../client/src/replyPlaybackQueue.ts";
import {
  emptyVisualReply,
  remainingPlaybackMs,
  type VisualTarget,
} from "../client/src/visualPlayback.ts";

const base: VisualTarget = {
  thinking: "想清楚。",
  preToolBubbles: ["先看一下。"],
  tools: [],
  bubbles: [],
  done: false,
};
const tool = (
  id: string,
  text: string,
  state: "running" | "success" = "success",
) => ({
  id,
  text,
  tool: {
    id,
    name: id,
    state,
    detail: text,
    result: text,
    command: `echo ${id}`,
  },
});

test("tool rows and states wait for all earlier received text, including the preceding tool output", () => {
  const queue = new ReplyPlaybackQueue();
  queue.enqueue("text", base, 0);
  const first = { ...base, tools: [tool("first", "", "running")] };
  queue.enqueue("tool:first", first, 0);
  let view = emptyVisualReply();
  let now = 0;
  while (!view.visibleToolIds.length) {
    view = queue.tick(view, now).view;
    if (
      view.thinking !== base.thinking ||
      view.preToolBubbles[0] !== base.preToolBubbles[0]
    )
      assert.deepEqual(view.visibleToolIds, []);
    now += 30;
  }
  assert.equal(view.toolStates.first.state, "running");
  const firstDone = { ...base, tools: [tool("first", "第一步输出完成。")] };
  const secondDone = {
    ...firstDone,
    tools: [...firstDone.tools, tool("second", "第二步完成。")],
  };
  queue.enqueue("tool:first", firstDone, now);
  queue.enqueue("tool:second", secondDone, now);
  const final = { ...secondDone, bubbles: ["都完成了。"], done: true };
  queue.enqueue("text", { ...final, done: false }, now);
  queue.enqueue("end", final, now);
  let settled = false;
  const deadline = now + 2100;
  for (; now <= deadline && !settled; now += 30) {
    const tick = queue.tick(view, now);
    view = tick.view;
    settled = tick.settled;
    if (view.visibleToolIds.includes("second"))
      assert.equal(view.tools.first, firstDone.tools[0].text);
    if (view.bubbles[0])
      assert.equal(view.tools.second, secondDone.tools[1].text);
  }
  assert.equal(settled, true);
  assert.equal(view.bubbles[0], "都完成了。");
  assert.deepEqual(view.visibleToolIds, ["first", "second"]);
});

test("large backlogs skip only an ordered prefix and retain the newest typing tail", () => {
  const queue = new ReplyPlaybackQueue();
  const thought = { ...base, thinking: "公开心里话。".repeat(200) };
  queue.enqueue("text", thought, 0);
  const withTool = { ...thought, tools: [tool("read", "输出\n".repeat(2000))] };
  queue.enqueue("tool:read", withTool, 0);
  const latest = {
    ...withTool,
    bubbles: ["第一段。", "最新😀正文。".repeat(150)],
  };
  queue.enqueue("text", latest, 0);
  let view = queue.tick(emptyVisualReply(), 0).view;
  assert.equal(view.thinking, latest.thinking);
  assert.equal(view.tools.read, latest.tools[0].text);
  assert.equal(view.bubbles[0], latest.bubbles[0]);
  assert.notEqual(view.bubbles[1], latest.bubbles[1]);
  assert.ok(latest.bubbles[1].startsWith(view.bubbles[1]));
  assert.ok(remainingPlaybackMs(view, latest) <= MAX_PLAYBACK_BACKLOG_MS);
  queue.enqueue("end", { ...latest, done: true }, 0);
  const finished = queue.tick(view, MAX_PLAYBACK_BACKLOG_MS);
  assert.equal(finished.settled, true);
  assert.deepEqual(finished.view.bubbles, latest.bubbles);
  assert.equal(finished.view.cursor, null);
});

test("later text updates do not keep replaying unchanged tool metadata", () => {
  const queue = new ReplyPlaybackQueue();
  const initial = {
    ...base,
    thinking: "",
    preToolBubbles: [],
    tools: [tool("one", "完成")],
  };
  queue.enqueue("tool:one", initial, 0);
  let view = emptyVisualReply();
  for (let now = 0; now < 200; now += 30) view = queue.tick(view, now).view;
  for (let i = 1; i <= 5; i++) {
    const next = {
      ...initial,
      tools: [tool("one", "完成")],
      bubbles: ["字".repeat(i)],
    };
    queue.enqueue("text", next, i * 100 + 200);
    view = queue.tick(view, i * 100 + 200).view;
    assert.equal(view.bubbles[0], next.bubbles[0]);
  }
});
