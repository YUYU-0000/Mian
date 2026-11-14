import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReplyEvent,
  parsePublicReply,
  type ChatGroup,
  type ReplyGroup,
} from "../client/src/chatModel.ts";
import { localDateTime } from "../client/src/format.ts";
import { api } from "../client/src/api.ts";
import { ApiChat } from "../server/src/apiChat.ts";
import {
  MIAN_API_PUBLIC_REPLY_PROTOCOL,
  MIAN_PUBLIC_REPLY_PROTOCOL,
} from "../server/src/publicReplyProtocol.ts";
import { VisibleContent } from "../server/src/providers/visibleContent.ts";

test("API protocol keeps the shared public thought and bubble rules without tool instructions", () => {
  assert.ok(
    MIAN_API_PUBLIC_REPLY_PROTOCOL.startsWith(
      MIAN_PUBLIC_REPLY_PROTOCOL.split("\n\nIf no tool is needed")[0],
    ),
  );
  assert.match(
    MIAN_API_PUBLIC_REPLY_PROTOCOL,
    /public, fictionalized character thought/,
  );
  assert.match(MIAN_API_PUBLIC_REPLY_PROTOCOL, /<mian-bubble>/);
  assert.doesNotMatch(
    MIAN_API_PUBLIC_REPLY_PROTOCOL,
    /mian-pre-tool|mian-tool-summary|tool call|Tool results/,
  );
  assert.match(MIAN_PUBLIC_REPLY_PROTOCOL, /<mian-pre-tool>/);
});

test("API streams use the shared parser without leaking any partial protocol marker", () => {
  const source =
    "<mian-thinking>我在听。</mian-thinking><mian-bubble>第一段。\n\n保留段落。</mian-bubble><mian-bubble>第二段。</mian-bubble>";
  let groups: ChatGroup[] = [];
  for (const delta of source) {
    groups = applyReplyEvent(
      groups,
      { type: "assistant-delta", turnId: "api-turn", format: "api", delta },
      "02:01",
    );
    const reply = groups[0] as ReplyGroup;
    const parsed = parsePublicReply(reply.raw);
    assert.equal(reply.thinking, parsed.thinking);
    assert.deepEqual(reply.bubbles, parsed.bubbles);
    assert.doesNotMatch([reply.thinking, ...reply.bubbles].join(""), /<|mian-/);
  }
  const reply = groups[0] as ReplyGroup;
  assert.deepEqual(reply.bubbles, ["第一段。\n\n保留段落。", "第二段。"]);
  assert.deepEqual(reply.tools, []);
  assert.deepEqual(reply.approvals, []);
});

test("untagged API text is one streaming bubble and has no public thought", () => {
  let groups: ChatGroup[] = [];
  for (const delta of ["普通", "正文\n\n第二段", "。"]) {
    groups = applyReplyEvent(
      groups,
      {
        type: "assistant-delta",
        turnId: "plain-fallback",
        format: "api",
        delta,
      },
      "02:01",
    );
    const reply = groups[0] as ReplyGroup;
    assert.equal(reply.thinking, "");
    assert.equal(reply.bubbles.length, 1);
    assert.equal(reply.bubbles[0], reply.raw);
  }
  groups = applyReplyEvent(
    groups,
    {
      type: "turn-completed",
      turnId: "plain-fallback",
      format: "api",
      status: "completed",
    },
    "02:01",
  );
  assert.deepEqual((groups[0] as ReplyGroup).bubbleComplete, [true]);
});

test("code whitespace stays intact inside a protocol bubble", () => {
  const code = "```python\ntext = '''first\n\n\n\nlast'''\n```";
  assert.deepEqual(
    parsePublicReply(`<mian-bubble>${code}</mian-bubble>`).bubbles,
    [code],
  );
  assert.deepEqual(
    parsePublicReply("<mian-bubble>    indented code</mian-bubble>").bubbles,
    ["    indented code"],
  );
});

test("native think blocks are discarded at every split, while public thoughts and HTML survive", () => {
  const source =
    "<think>不展示</think><mian-thinking>公开心里话</mian-thinking><mian-bubble><b>正文</b></mian-bubble><think>不展示</think>";
  const expected =
    "<mian-thinking>公开心里话</mian-thinking><mian-bubble><b>正文</b></mian-bubble>";
  for (let split = 0; split <= source.length; split++) {
    const visible = new VisibleContent();
    assert.equal(
      visible.push(source.slice(0, split)) +
        visible.push(source.slice(split)) +
        visible.finish(),
      expected,
    );
  }
  const visible = new VisibleContent();
  assert.equal(visible.push("<think>尚未结束的原生推理"), "");
  assert.equal(visible.finish(), "");
});

test("API sends a fresh local clock and puts it beside the protocol in the system message", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 10, 14, 2, 1) });
  assert.equal(
    localDateTime(new Date(2026, 10, 14, 2, 1)),
    "現在是 2026-11-14 星期六 02:01",
  );
  const bodies: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    bodies.push(JSON.parse(init!.body as string));
    return Response.json({
      turnId: "clock",
      choices: [
        {
          message: {
            content:
              "<mian-thinking>听见了。</mian-thinking><mian-bubble>在。</mian-bubble>",
          },
        },
      ],
    });
  });
  const history = [{ role: "user" as const, content: "现在几点" }];
  await api.send("现在几点", "clock", history);
  assert.equal(bodies[0].localTime, "現在是 2026-11-14 星期六 02:01");
  t.mock.timers.tick(60_000);
  await api.send("现在几点", "clock", history);
  assert.equal(bodies[1].localTime, "現在是 2026-11-14 星期六 02:02");
  const events: any[] = [];
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const runtime = new ApiChat(
    (event) => {
      events.push(event);
      if (event.type === "turn-completed") finish();
    },
    async () => {},
  );
  runtime.startTurn(
    "clock",
    {
      endpoint: "https://fake.test",
      key: "fixture",
      model: "fixture",
      format: "openai",
    },
    history,
    bodies[1].localTime,
  );
  await done;
  assert.deepEqual(bodies[2].messages, [
    {
      role: "system",
      content: `${MIAN_API_PUBLIC_REPLY_PROTOCOL}\n\n${bodies[1].localTime}`,
    },
    ...history,
  ]);
  assert.equal(
    events.find((event) => event.type === "assistant-delta").immediate,
    false,
  );
  assert.ok(events.every((event) => event.format === "api"));
});
