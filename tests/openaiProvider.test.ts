import assert from "node:assert/strict";
import test from "node:test";
import {
  completeChat,
  providerJson,
  type CompletionEvent,
} from "../server/src/providers/openai.ts";

const config = {
  endpoint: "https://provider.test/gateway/",
  key: "secret",
  model: "manual-model",
  format: "openai" as const,
};
const messages = [
  { role: "user" as const, content: "第一句" },
  { role: "assistant" as const, content: "第一答" },
  { role: "user" as const, content: "第二句" },
];
const collect = async (signal = new AbortController().signal) => {
  const events: CompletionEvent[] = [];
  for await (const event of completeChat(config, messages, signal))
    events.push(event);
  return events;
};
const sse = (...packets: unknown[]) => {
  const data = packets
    .map(
      (packet) =>
        `data: ${typeof packet === "string" ? packet : JSON.stringify(packet)}\r\n\r\n`,
    )
    .join("");
  const bytes = new TextEncoder().encode(data);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7)
          controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
};

test("OpenAI stream keeps the exact base, history and UTF-8 chunks, drops reasoning and records usage", async (t) => {
  const mocked = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://provider.test/gateway/chat/completions");
    assert.equal(init.headers.Authorization, "Bearer secret");
    assert.deepEqual(JSON.parse(init.body), {
      model: "manual-model",
      messages,
      stream: true,
      stream_options: { include_usage: true },
    });
    return sse(
      { choices: [{ delta: { reasoning_content: "隐藏推理" } }] },
      { choices: [{ delta: { content: "<thi" } }] },
      { choices: [{ delta: { content: "nk>同样隐藏</thi" } }] },
      { choices: [{ delta: { content: "nk>" } }] },
      { choices: [{ delta: { content: "你好，" } }] },
      { choices: [{ delta: { content: "世界。" }, finish_reason: "stop" }] },
      {
        choices: [],
        usage: {
          total_tokens: 15,
          prompt_tokens_details: { cached_tokens: 3 },
        },
      },
      "[DONE]",
    );
  });
  assert.deepEqual(await collect(), [
    { type: "text", text: "你好，" },
    { type: "text", text: "世界。" },
    { type: "usage", usage: { totalTokens: 15, uncachedTotalTokens: 12 } },
  ]);
  assert.equal(mocked.mock.callCount(), 1);
});

test("models requests do not add /v1", async (t) => {
  const urls: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(url);
    return Response.json({ data: [] });
  });
  for (const endpoint of [
    "https://provider.test",
    "https://provider.test/v1/",
    "https://provider.test/custom",
  ])
    await providerJson({ ...config, endpoint }, "models");
  assert.deepEqual(urls, [
    "https://provider.test/models",
    "https://provider.test/v1/models",
    "https://provider.test/custom/models",
  ]);
});

test("unsupported streaming falls back once and returns the whole answer without reasoning", async (t) => {
  const bodies: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    return body.stream
      ? Response.json(
          {
            error: {
              message: "Streaming is not supported for this model.",
              param: "stream",
            },
          },
          { status: 400 },
        )
      : Response.json({
          choices: [
            { message: { content: "整段回答", reasoning_content: "隐藏推理" } },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 4,
            prompt_cache_hit_tokens: 2,
          },
        });
  });
  assert.deepEqual(await collect(), [
    { type: "text", text: "整段回答", immediate: true },
    { type: "usage", usage: { totalTokens: 9, uncachedTotalTokens: 7 } },
  ]);
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1], { model: config.model, messages, stream: false });
});

test("a server that ignores stream and returns JSON is displayed immediately without a second request", async (t) => {
  const mocked = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ choices: [{ message: { content: "直接返回" } }] }),
  );
  assert.deepEqual(await collect(), [
    { type: "text", text: "直接返回", immediate: true },
  ]);
  assert.equal(mocked.mock.callCount(), 1);
});

test("unsupported stream_options still streams without usage", async (t) => {
  const bodies: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    return body.stream_options
      ? Response.json(
          {
            error: {
              message: "Unknown parameter: stream_options",
              param: "stream_options",
            },
          },
          { status: 422 },
        )
      : sse(
          { choices: [{ delta: { content: "正常" }, finish_reason: "stop" }] },
          "[DONE]",
        );
  });
  assert.deepEqual(await collect(), [{ type: "text", text: "正常" }]);
  assert.equal(bodies[1].stream, true);
  assert.equal(bodies[1].stream_options, undefined);
});

test("auth, quota and model errors preserve provider reasons without retrying", async (t) => {
  for (const [status, message] of [
    [401, "Invalid API key."],
    [429, "Insufficient quota. Add credits. Third sentence."],
    [404, "Model does not exist."],
  ] as const) {
    const mocked = t.mock.method(globalThis, "fetch", async () =>
      Response.json({ error: { message } }, { status }),
    );
    await assert.rejects(collect(), {
      message: status === 429 ? "Insufficient quota. Add credits." : message,
    });
    assert.equal(mocked.mock.callCount(), 1);
    mocked.mock.restore();
  }
});

test("a broken stream fails without sending another paid request", async (t) => {
  const mocked = t.mock.method(globalThis, "fetch", async () =>
    sse({ choices: [{ delta: { content: "未完成" } }] }),
  );
  await assert.rejects(collect(), /服務商連線中斷/);
  assert.equal(mocked.mock.callCount(), 1);
});

test("stop aborts an in-flight provider request without falling back", async (t) => {
  const controller = new AbortController();
  const mocked = t.mock.method(
    globalThis,
    "fetch",
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(init.signal.reason),
          { once: true },
        );
      }),
  );
  const result = collect(controller.signal);
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(mocked.mock.callCount(), 1);
});
