import assert from "node:assert/strict";
import test from "node:test";
import { ApiChat } from "../server/src/apiChat.ts";
import type { Clue } from "../server/src/clues.ts";
import type { ChatMessage } from "../server/src/providers/openai.ts";

const config = {
  endpoint: "https://provider.test",
  key: "test-key",
  model: "model",
  format: "openai" as const,
};
const card = (id: string, mode: Clue["mode"] = "trigger"): Clue => ({
  id,
  mode,
  title: `TITLE_${id}`,
  content: `CONTENT_${id}`,
  when: `WHEN_${id}`,
  scenes: [],
  layout: 0,
  x: 0,
  y: 0,
  w: 84,
  h: 88,
  r: 0,
  order: 0,
  createdAt: "now",
  updatedAt: "now",
});
const cards = [card("pinned", "pinned"), card("a"), card("b"), card("c")];
const messages: ChatMessage[] = [{ role: "user", content: "聊一聊" }];
const toolCall = (id: string, ids: string[]) => ({
  id,
  type: "function",
  function: { name: "read_clue", arguments: JSON.stringify({ ids }) },
});
const sse = (...packets: unknown[]) => {
  const bytes = new TextEncoder().encode(
    packets
      .map(
        (packet) =>
          `data: ${typeof packet === "string" ? packet : JSON.stringify(packet)}\n\n`,
      )
      .join(""),
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 7)
          controller.enqueue(bytes.slice(offset, offset + 7));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
};
function runtime() {
  const events: any[] = [],
    usage: any[] = [];
  let finish: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const chat = new ApiChat(
    (event) => {
      events.push(event);
      if (event.type === "turn-completed") finish();
    },
    async (_id, value) => {
      usage.push(value);
    },
  );
  return { chat, done, events, usage };
}

test("clocks and trigger cards change only the current message, keeping system, tools and older history stable", async (t) => {
  const requests: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json({ choices: [{ message: { content: "回答" } }] });
  });
  const pinned = [card("pinned-b", "pinned"), card("pinned-a", "pinned")];
  const history: ChatMessage[] = [
    { role: "user", content: "舊問題\n\n原來的段落" },
    { role: "assistant", content: "舊回答" },
    ...messages,
  ];
  const original = structuredClone(history);
  for (const [index, currentCards] of [
    pinned,
    [...pinned].reverse().map((clue, index) => ({ ...clue, order: 10 - index })).concat(card("trigger")),
    [...pinned, { ...card("voice"), scenes: ["voice"] as Clue["scenes"] }],
  ].entries()) {
    const { chat, done } = runtime();
    chat.startTurn("c1", config, history, `CLOCK_${index}`, {
      cards: currentCards,
      recentMessages: history,
      markToolsUnsupported: async () => assert.fail("tools work"),
    });
    await done;
  }
  assert.equal(requests.length, 3);
  const system = requests[0].messages[0];
  assert.match(system.content, /CONTENT_pinned-a\n\n【TITLE_pinned-b】/);
  assert.doesNotMatch(system.content, /CLOCK_|TITLE_trigger|TITLE_voice|線索目錄|格式提醒/);
  for (const [index, request] of requests.entries()) {
    assert.deepEqual(request.messages[0], system);
    assert.deepEqual(request.tools, requests[0].tools);
    assert.equal(request.tools[0].function.name, "read_clue");
    assert.deepEqual(request.messages.slice(1, -1), original.slice(0, -1));
    assert.match(request.messages.at(-1).content, new RegExp(`CLOCK_${index}`));
  }
  assert.match(requests[1].messages.at(-1).content, /TITLE_trigger/);
  assert.match(requests[2].messages.at(-1).content, /生成語音條時的線索[\s\S]*CONTENT_voice/);
  assert.deepEqual(history, original);
});

test("API reads batched and subsequent cards from streamed tool_calls without exposing the reading rounds", async (t) => {
  const requests: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (requests.length === 1)
      return sse(
        { choices: [{ delta: { content: "正在讀卡，這段不公開。" } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 1,
                    id: "call-c",
                    type: "function",
                    function: { name: "read_clue", arguments: '{"ids":["c"]}' },
                  },
                  {
                    index: 0,
                    id: "call-ab",
                    type: "function",
                    function: {
                      name: "read_",
                      arguments: '{"ids":["a","missing"',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { name: "clue", arguments: ',"b"]}' } },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
        {
          choices: [],
          usage: {
            total_tokens: 10,
            prompt_tokens_details: { cached_tokens: 2 },
          },
        },
        "[DONE]",
      );
    if (requests.length === 2)
      return Response.json({
        choices: [
          {
            message: {
              content: "再讀一次，也不公開。",
              tool_calls: [toolCall("again", ["a"])],
            },
          },
        ],
        usage: { total_tokens: 6, prompt_cache_hit_tokens: 3 },
      });
    return sse(
      { choices: [{ delta: { content: "<mian-bubble>最後" } }] },
      {
        choices: [
          { delta: { content: "回答。</mian-bubble>" }, finish_reason: "stop" },
        ],
      },
      { choices: [], usage: { total_tokens: 4 } },
      "[DONE]",
    );
  });
  const { chat, done, events, usage } = runtime();
  const original = structuredClone(messages);
  chat.startTurn("c1", config, messages, "現在", {
    cards,
    recentMessages: messages,
    markToolsUnsupported: async () => assert.fail("tools work"),
  });
  await done;
  assert.equal(requests.length, 3);
  assert.equal(requests[0].max_tokens, undefined);
  assert.equal(requests[0].tools[0].function.name, "read_clue");
  assert.deepEqual(requests[0].tools[0].function.parameters.properties.ids, {
    type: "array",
    items: { type: "string" },
  });
  const system = requests[0].messages[0].content;
  assert.match(system, /【TITLE_pinned】\nCONTENT_pinned/);
  const context = requests[0].messages.at(-1).content;
  assert.match(context, /可以一次讀幾張，也可以讀完再讀/);
  assert.deepEqual(
    JSON.parse(context.split("線索目錄\n\n")[1].split("\n\n")[0]),
    ["a", "b", "c"].map((id) => ({
      id,
      title: `TITLE_${id}`,
      when: `WHEN_${id}`,
    })),
  );
  assert.doesNotMatch(system, /CONTENT_[abc]/);
  assert.doesNotMatch(system, /線索目錄|現在|格式提醒/);
  for (const request of requests.slice(1)) {
    assert.equal(request.messages[0].content, system);
    assert.deepEqual(request.tools, requests[0].tools);
  }
  const results = requests[1].messages.filter(
    (message: any) => message.role === "tool",
  );
  assert.deepEqual(
    results.map((message: any) => message.tool_call_id),
    ["call-ab", "call-c"],
  );
  assert.deepEqual(
    results.map((message: any) => JSON.parse(message.content)),
    [
      ["a", "b"].map((id) => ({
        id,
        title: `TITLE_${id}`,
        content: `CONTENT_${id}`,
      })),
      [{ id: "c", title: "TITLE_c", content: "CONTENT_c" }],
    ],
  );
  assert.equal(requests[2].messages.at(-1).tool_call_id, "again");
  assert.equal(
    events
      .filter((event) => event.type === "assistant-delta")
      .map((event) => event.delta)
      .join(""),
    "<mian-bubble>最後回答。</mian-bubble>",
  );
  assert.doesNotMatch(
    JSON.stringify(events),
    /CONTENT_|WHEN_|TITLE_|read_clue|讀卡|再讀/,
  );
  assert.deepEqual(messages, original);
  assert.deepEqual(usage, [{ totalTokens: 20, uncachedTotalTokens: 15 }]);
  assert.equal(events.at(-1).status, "completed");
});

test("non-streaming fallback keeps tools and the prompt prefix fixed when stopping card reads", async (t) => {
  const requests: any[] = [];
  let jsonRound = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (body.stream)
      return Response.json(
        { error: { message: "Streaming is not supported", param: "stream" } },
        { status: 422 },
      );
    jsonRound++;
    return Response.json({
      choices: [
        {
          message:
            jsonRound <= 3
              ? {
                  content: "private",
                  tool_calls: [toolCall(`call-${jsonRound}`, ["a"])],
                }
              : { content: "直接回答" },
        },
      ],
    });
  });
  const { chat, done, events } = runtime();
  chat.startTurn("c1", config, messages, "現在", {
    cards,
    recentMessages: messages,
    markToolsUnsupported: async () =>
      assert.fail("422 streaming errors do not reject tools"),
  });
  await done;
  const rounds = requests.filter((request) => !request.stream);
  assert.equal(rounds.length, 4);
  assert.equal(
    rounds
      .slice(0, 3)
      .every((request) => request.tools?.[0].function.name === "read_clue"),
    true,
  );
  assert.deepEqual(rounds[3].tools, rounds[0].tools);
  assert.equal(rounds[3].tool_choice, "none");
  assert.match(rounds[3].messages.at(-1).content, /本輪不再讀卡/);
  for (let index = 1; index < rounds.length; index++) {
    const previous = rounds[index - 1].messages;
    assert.deepEqual(rounds[index].messages.slice(0, previous.length), previous);
  }
  assert.equal(
    rounds[3].messages.filter((message: any) => message.role === "tool").length,
    3,
  );
  assert.deepEqual(
    events
      .filter((event) => event.type === "assistant-delta")
      .map((event) => event.delta),
    ["直接回答"],
  );
  assert.equal(events.at(-1).status, "completed");
});

test("a later tools 400 persists rejection then restarts with twelve-message preselection and a metadata-only directory", async (t) => {
  const requests: any[] = [];
  const recent: ChatMessage[] = Array.from({ length: 15 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `message-${index}`,
  }));
  let marked = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (requests.length === 1)
      return Response.json({
        choices: [
          {
            message: {
              content: "PRIVATE",
              tool_calls: [toolCall("one", ["a"])],
            },
          },
        ],
        usage: { total_tokens: 5 },
      });
    if (requests.length === 2)
      return Response.json(
        { error: { message: "Bad request" } },
        { status: 400 },
      );
    if (body.max_tokens === 256)
      return Response.json({ choices: [{ message: { content: "b" } }] });
    return Response.json({
      choices: [{ message: { content: "FINAL" } }],
      usage: { total_tokens: 7 },
    });
  });
  const { chat, done, events, usage } = runtime();
  chat.startTurn("c1", config, messages, "現在", {
    cards,
    recentMessages: recent,
    markToolsUnsupported: async () => {
      marked++;
    },
  });
  await done;
  assert.equal(marked, 1);
  assert.equal(requests.length, 4);
  assert.deepEqual(requests[2].messages.slice(1), recent.slice(-12));
  assert.equal(requests[3].tools, undefined);
  assert.equal(
    requests[3].messages.some(
      (message: any) => message.role === "tool" || message.tool_calls,
    ),
    false,
  );
  assert.match(requests[3].messages[0].content, /CONTENT_pinned/);
  assert.equal(requests[3].messages[0].content, requests[0].messages[0].content);
  const context = requests[3].messages.at(-1).content;
  assert.match(context, /CONTENT_b/);
  assert.doesNotMatch(
    context,
    /CONTENT_a|CONTENT_c|read_clue/,
  );
  assert.deepEqual(
    JSON.parse(context.split("線索目錄\n\n")[1].split("\n\n")[0]),
    ["a", "b", "c"].map((id) => ({ title: `TITLE_${id}`, when: `WHEN_${id}` })),
  );
  assert.deepEqual(
    events
      .filter((event) => event.type === "assistant-delta")
      .map((event) => event.delta),
    ["FINAL"],
  );
  assert.deepEqual(usage, [{ totalTokens: 12, uncachedTotalTokens: 12 }]);
});

test("interrupting a read-card continuation emits no intermediate content", async (t) => {
  let ready: () => void;
  const waiting = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let count = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    if (++count === 1)
      return Response.json({
        choices: [
          {
            message: {
              content: "PRIVATE",
              tool_calls: [toolCall("one", ["a"])],
            },
          },
        ],
      });
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), {
        once: true,
      });
      ready();
    });
  });
  const { chat, done, events } = runtime();
  const turn = chat.startTurn("c1", config, messages, "現在", {
    cards,
    recentMessages: messages,
    markToolsUnsupported: async () =>
      assert.fail("abort is not a tools rejection"),
  });
  await waiting;
  chat.interrupt(turn.turnId, "c1");
  await done;
  assert.equal(events.at(-1).status, "interrupted");
  assert.equal(
    events.some((event) => event.type === "assistant-delta"),
    false,
  );
  assert.equal(chat.isBusy("c1"), false);
});
