import assert from "node:assert/strict";
import test from "node:test";
import { CodexBridge } from "../server/src/codex.ts";
import { applyReplyEvent, type ChatGroup } from "../shared/chatModel.mjs";
import { visualTarget } from "../client/src/replyTimeline.ts";
import type { ChatEvent } from "../client/src/types.ts";

function fixture() {
  const bridge = new CodexBridge(() => {
    throw new Error("mapping tests do not start Codex");
  });
  bridge.restoreConversationThreads([{ conversationId: "c1", threadId: "thread-1" }]);
  const events: ChatEvent[] = [];
  bridge.on("event", (event) => events.push(event));
  const notify = (bridge as any).handleNotification.bind(bridge);
  const send = (method: string, value: object) =>
    notify(method, { threadId: "thread-1", turnId: "turn-1", ...value });
  send("turn/started", { turn: { id: "turn-1" } });
  return { bridge, events, send };
}

test("code-mode exec enters the existing tool timeline while running and updates the same row on completion", () => {
  const { events, send } = fixture();
  const command = "text(await tools.clock__curr_time({}));";
  send("item/agentMessage/delta", { delta: "<mian-pre-tool>我看一下。</mian-pre-tool>" });
  send("rawResponseItem/completed", {
    item: { type: "custom_tool_call", call_id: "clock", name: "exec", input: command },
  });
  let groups: ChatGroup[] = [];
  for (const event of events) groups = applyReplyEvent(groups, event, "00:00");
  const running = groups.find((group) => group.role === "assistant")!;
  assert.equal(visualTarget(running).tools[0].tool?.state, "running");
  assert.equal(running.tools[0].command, command);

  send("rawResponseItem/completed", {
    item: {
      type: "custom_tool_call_output", call_id: "clock",
      output: [{ type: "input_text", text: "Script completed" }, { type: "input_text", text: "clock-result" }],
    },
  });
  groups = applyReplyEvent(groups, events.at(-1)!, "00:00");
  const completed = groups.find((group) => group.role === "assistant")!;
  assert.equal(completed.tools.length, 1);
  assert.equal(completed.tools[0].id, "clock");
  assert.equal(completed.tools[0].command, command);
  assert.equal(visualTarget(completed).tools[0].tool?.state, "success");
  assert.equal(completed.tools[0].result, "Script completed\nclock-result");
});

test("native tool items keep their existing running and completed events", () => {
  const { events, send } = fixture();
  const item = { id: "native", type: "commandExecution", command: "Get-Location" };
  send("item/started", { item });
  send("item/completed", { item: { ...item, aggregatedOutput: "C:\\Mian", status: "completed" } });
  const tools = events.filter((event) => event.type === "tool");
  assert.deepEqual(tools.map((event) => [event.tool.id, event.tool.state]), [["native", "running"], ["native", "success"]]);
  assert.equal(tools[1].tool.result, "C:\\Mian");
});

test("raw calls already represented by native items do not add duplicate tool rows", () => {
  const { events, send } = fixture();
  send("rawResponseItem/completed", { item: { type: "custom_tool_call", call_id: "patch", name: "apply_patch", input: "patch" } });
  send("rawResponseItem/completed", { item: { type: "custom_tool_call_output", call_id: "patch", output: "Done" } });
  assert.equal(events.filter((event) => event.type === "tool").length, 0);
});

test("code-mode calls are scoped to their turns and released when a turn ends", () => {
  const { events, send } = fixture();
  send("rawResponseItem/completed", { item: { type: "custom_tool_call", call_id: "clock", name: "exec", input: "first" } });
  send("rawResponseItem/completed", { turnId: "turn-2", item: { type: "custom_tool_call", call_id: "clock", name: "exec", input: "second" } });
  send("turn/completed", { turn: { id: "turn-1", status: "interrupted" } });
  send("rawResponseItem/completed", { item: { type: "custom_tool_call_output", call_id: "clock", output: "late" } });
  send("rawResponseItem/completed", { turnId: "turn-2", item: { type: "custom_tool_call_output", call_id: "clock", output: "done" } });
  const tools = events.filter((event) => event.type === "tool");
  assert.equal(tools.length, 3);
  assert.equal(tools[2].turnId, "turn-2");
  assert.equal(tools[2].tool.command, "second");
  assert.equal(tools[2].tool.state, "success");
});

test("transport retries keep thinking alive and a final failure clears the busy turn", () => {
  const { bridge, events, send } = fixture();
  send("error", { error: { message: "temporary transport error" }, willRetry: true });
  assert.equal(bridge.getActiveTurnId("c1"), "turn-1");
  assert.equal(events.length, 1);
  send("error", { error: { message: "transport failed" }, willRetry: false });
  assert.equal(bridge.getActiveTurnId("c1"), null);
  assert.deepEqual(events.at(-1), { type: "turn-completed", conversationId: "c1", turnId: "turn-1", status: "failed", error: "transport failed" });
});