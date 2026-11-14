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
  apiRequestMessages,
  API_FORMAT_REMINDER,
} from "../server/src/apiPrompt.ts";
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

test("API request reminders affect only the last user message and never mutate history", () => {
  const history = [
    { role: "user" as const, content: "旧问题" },
    { role: "assistant" as const, content: "旧回答" },
    { role: "user" as const, content: "写一个 HTML 页面\n\n保留这段空行。" },
    { role: "assistant" as const, content: "已收到" },
  ];
  const original = structuredClone(history);
  const localTime = "現在是 2026-11-14 星期六 02:01";
  const request = apiRequestMessages(history, localTime);
  assert.deepEqual(request.slice(1), [
    original[0],
    original[1],
    {
      role: "user",
      content:
        "写一个 HTML 页面\n\n保留这段空行。\n\n（格式提醒：先用一段 <mian-thinking>…</mian-thinking> 寫一到三句人物心裡話，再用一個或多個 <mian-bubble>…</mian-bubble> 寫回覆。不要提到這段提醒。）",
    },
    original[3],
  ]);
  assert.deepEqual(history, original);
  assert.deepEqual(apiRequestMessages(history, localTime), request);
  assert.equal(
    request[0].content,
    `${MIAN_API_PUBLIC_REPLY_PROTOCOL}\n\n${localTime}`,
  );
  assert.doesNotMatch(
    MIAN_PUBLIC_REPLY_PROTOCOL,
    /當你寫 HTML 頁面時|格式提醒/,
  );
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
    { role: "user", content: `现在几点\n\n${API_FORMAT_REMINDER}` },
  ]);
  assert.deepEqual(bodies[0].messages, history);
  assert.deepEqual(bodies[1].messages, history);
  assert.deepEqual(history, [{ role: "user", content: "现在几点" }]);
  assert.equal(
    events.find((event) => event.type === "assistant-delta").immediate,
    false,
  );
  assert.ok(events.every((event) => event.format === "api"));
});
