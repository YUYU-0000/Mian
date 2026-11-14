import assert from "node:assert/strict";
import test from "node:test";
import { ApiChat } from "../server/src/apiChat.ts";

const config = {
  endpoint: "https://provider.test",
  key: "secret",
  model: "test-model",
  format: "openai" as const,
};

test("API runtime isolates turns, cancels only the selected conversation and keeps missing usage absent", async (t) => {
  const signals = new Map<string, AbortSignal>();
  const replies = new Map<string, (response: Response) => void>();
  t.mock.method(
    globalThis,
    "fetch",
    (_url, init) =>
      new Promise((resolve, reject) => {
        const text = JSON.parse(init.body).messages.find((message: { role: string }) => message.role === "user").content;
        signals.set(text, init.signal);
        replies.set(text, resolve);
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      }),
  );
  const events: any[] = [];
  const usage: any[] = [];
  const completions = new Map<string, () => void>();
  const ended = (id: string) =>
    new Promise<void>((resolve) => completions.set(id, resolve));
  const chat = new ApiChat(
    (event) => {
      events.push(event);
      if (event.type === "turn-completed")
        completions.get(event.conversationId)?.();
    },
    async (...args) => {
      usage.push(args);
    },
  );
  const doneA = ended("a"),
    doneB = ended("b");
  const a = chat.startTurn("a", config, [{ role: "user", content: "a" }]);
  const b = chat.startTurn("b", config, [{ role: "user", content: "b" }]);
  assert.deepEqual(chat.getActiveTurns(), { a: a.turnId, b: b.turnId });
  assert.throws(() => chat.interrupt(a.turnId, "b"), /不属于/);
  assert.throws(() => chat.startTurn("a", config, []), /正在运行/);
  chat.interrupt(a.turnId, "a");
  assert.equal(signals.get("a")!.aborted, true);
  assert.equal(signals.get("b")!.aborted, false);
  replies.get("b")!(
    Response.json({ choices: [{ message: { content: "b 的回答" } }] }),
  );
  await Promise.all([doneA, doneB]);
  assert.equal(
    events.find(
      (event) =>
        event.conversationId === "a" && event.type === "turn-completed",
    ).status,
    "interrupted",
  );
  assert.equal(
    events.find(
      (event) =>
        event.conversationId === "b" && event.type === "assistant-delta",
    ).delta,
    "b 的回答",
  );
  assert.equal(
    events.some((event) => event.type === "tool" || event.type === "approval"),
    false,
  );
  assert.equal(usage.length, 0);
  assert.deepEqual(chat.getActiveTurns(), {});
});

test("API runtime records returned usage and emits provider errors as failed turns", async (t) => {
  const completed: any[] = [];
  const usage: any[] = [];
  let finish: () => void;
  const chat = new ApiChat(
    (event) => {
      if (event.type === "turn-completed") {
        completed.push(event);
        finish();
      }
    },
    async (...args) => {
      usage.push(args);
    },
  );
  let fail = false;
  t.mock.method(globalThis, "fetch", async () =>
    fail
      ? Response.json(
          { error: { message: "Model is unavailable." } },
          { status: 404 },
        )
      : Response.json({
          choices: [{ message: { content: "answer" } }],
          usage: { total_tokens: 20 },
        }),
  );
  const run = async () => {
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    chat.startTurn("c1", config, [{ role: "user", content: "hello" }]);
    await done;
  };
  await run();
  assert.deepEqual(usage, [
    ["c1", { totalTokens: 20, uncachedTotalTokens: 20 }],
  ]);
  fail = true;
  await run();
  assert.equal(completed[1].status, "failed");
  assert.equal(completed[1].error, "Model is unavailable.");
  assert.equal(usage.length, 1);
});
