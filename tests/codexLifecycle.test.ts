import assert from "node:assert/strict";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  CodexBridge,
  type AppServerSpawner,
} from "../server/src/codex.ts";
import type { AppConfig, RpcMessage } from "../server/src/types.ts";
import {
  MIAN_PUBLIC_REPLY_CONTEXT_KEY,
  MIAN_PUBLIC_REPLY_PROTOCOL,
} from "../server/src/publicReplyProtocol.ts";

const baseConfig: AppConfig = {
  workingDirectory: "C:\\workspace-a",
  sandbox: "workspace-write",
  model: "",
};

let nextPid = 50_000;

class FakeAppServer extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = nextPid++;
  readonly methods: string[] = [];
  readonly requests: RpcMessage[] = [];
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  threadStartFailures = 0;
  threadResumeFailures = 0;
  threadArchiveFailures = 0;
  turnInterruptFailures = 0;
  private input = "";
  private finished = false;
  private threadCount = 0;
  private turnCount = 0;

  constructor() {
    super();
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk: string) => {
      this.input += chunk;
      let newline = this.input.indexOf("\n");
      while (newline >= 0) {
        const line = this.input.slice(0, newline);
        this.input = this.input.slice(newline + 1);
        if (line) this.receive(JSON.parse(line) as RpcMessage);
        newline = this.input.indexOf("\n");
      }
    });
  }

  kill(signal: NodeJS.Signals = "SIGTERM") {
    this.killed = true;
    queueMicrotask(() => this.finish(0, signal));
    return true;
  }

  crash(code = 1) {
    this.finish(code, null);
  }

  private finish(code: number, signal: NodeJS.Signals | null) {
    if (this.finished) return;
    this.finished = true;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
    queueMicrotask(() => {
      this.emit("close", code, signal);
      this.stdout.end();
      this.stderr.end();
    });
  }

  private receive(message: RpcMessage) {
    if (!message.method) return;
    this.methods.push(message.method);
    this.requests.push(message);
    if (message.id === undefined) return;
    let result: unknown = {};
    if (message.method === "initialize") result = { userAgent: "fake-codex" };
    else if (message.method === "account/read")
      result = { account: { type: "test" } };
    else if (message.method === "thread/start") {
      if (this.threadStartFailures > 0) {
        this.threadStartFailures -= 1;
        queueMicrotask(() =>
          this.stdout.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              error: { code: -32_000, message: "thread initialization failed" },
            })}\n`,
          ),
        );
        return;
      }
      result = {
        thread: { id: `thread-${++this.threadCount}` },
        model: "gpt-test",
        reasoningEffort: "high",
      };
    }
    else if (message.method === "thread/resume") {
      if (this.threadResumeFailures > 0) {
        this.threadResumeFailures -= 1;
        queueMicrotask(() =>
          this.stdout.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              error: {
                code: -32_000,
                message: `no rollout found for thread id ${(message.params as any).threadId}`,
              },
            })}\n`,
          ),
        );
        return;
      }
      result = {
        thread: { id: String((message.params as any).threadId) },
        model: "gpt-resumed",
        reasoningEffort: "medium",
      };
    }
    else if (message.method === "thread/fork")
      result = {
        thread: { id: `thread-${++this.threadCount}` },
        model: "gpt-forked",
        reasoningEffort: "low",
      };
    else if (
      message.method === "thread/archive" &&
      this.threadArchiveFailures > 0
    ) {
      this.threadArchiveFailures -= 1;
      queueMicrotask(() =>
        this.stdout.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32_000,
              message: `no rollout found for thread id ${(message.params as any).threadId}`,
            },
          })}\n`,
        ),
      );
      return;
    }
    else if (message.method === "turn/start")
      result = { turn: { id: `turn-${++this.turnCount}` } };
    else if (
      message.method === "turn/interrupt" &&
      this.turnInterruptFailures > 0
    ) {
      this.turnInterruptFailures -= 1;
      queueMicrotask(() =>
        this.stdout.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32_000, message: "no active turn to interrupt" },
          })}\n`,
        ),
      );
      return;
    }
    queueMicrotask(() =>
      this.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`),
    );
  }
}

function bridgeFixture() {
  const children: FakeAppServer[] = [];
  const spawner: AppServerSpawner = () => {
    const child = new FakeAppServer();
    children.push(child);
    return child as unknown as ChildProcessWithoutNullStreams;
  };
  const bridge = new CodexBridge(spawner);
  bridge.restoreConversationThreads(
    ["c1", "c2", "c3", "fresh", "fresh-retry"].map(
      (conversationId) => ({ conversationId, threadId: null }),
    ),
  );
  return { bridge, children };
}

test("an old app-server's late events cannot overwrite the current ready instance", async () => {
  const { bridge, children } = bridgeFixture();
  const connectionEvents: any[] = [];
  bridge.on("event", (event) => connectionEvents.push(event));

  await bridge.connect(baseConfig);
  const first = children[0];
  await bridge.connect({ ...baseConfig, workingDirectory: "C:\\workspace-b" });
  const current = bridge.getLifecycleSnapshot();
  const eventCountBeforeLateError = connectionEvents.length;

  first.emit("error", new Error("late error from retired instance"));

  assert.equal(children.length, 2);
  assert.equal(current.instanceId, 2);
  assert.equal(bridge.getLifecycleSnapshot().instanceId, 2);
  assert.equal(bridge.getLifecycleSnapshot().state, "ready");
  assert.equal(connectionEvents.length, eventCountBeforeLateError);
  assert.equal(
    connectionEvents.some(
      (event) => event.type === "connection" && event.status.state === "error",
    ),
    false,
  );
  bridge.close();
});

test("concurrent connect calls share one app-server start", async () => {
  const { bridge, children } = bridgeFixture();
  const results = await Promise.all([
    bridge.connect(baseConfig),
    bridge.connect(baseConfig),
  ]);

  assert.equal(children.length, 1);
  assert.equal(results[0].state, "ready");
  assert.deepEqual(results[1], results[0]);
  assert.equal(bridge.getLifecycleSnapshot().instanceId, 1);
  bridge.close();
});

test("rapid repeated TEST-style connects reuse one healthy process", async () => {
  const { bridge, children } = bridgeFixture();
  const results = await Promise.all(
    Array.from({ length: 10 }, () => bridge.connect(baseConfig)),
  );

  assert.equal(children.length, 1);
  assert.equal(children.filter((child) => !child.killed).length, 1);
  assert.equal(results.every((result) => result.state === "ready"), true);
  assert.equal(bridge.getLifecycleSnapshot().state, "ready");
  bridge.close();
});

test("a deliberate replacement does not report the retired process as an error", async () => {
  const { bridge, children } = bridgeFixture();
  const connectionEvents: any[] = [];
  bridge.on("event", (event) => connectionEvents.push(event));

  await bridge.connect(baseConfig);
  await bridge.connect({ ...baseConfig, model: "replacement-model" });

  assert.equal(children.length, 2);
  assert.equal(children[0].killed, true);
  assert.equal(bridge.getLifecycleSnapshot().state, "ready");
  assert.equal(
    connectionEvents.filter(
      (event) => event.type === "connection" && event.status.state === "error",
    ).length,
    0,
  );
  bridge.close();
});

test("the current process crashing reports failure and a later connect recovers", async () => {
  const { bridge, children } = bridgeFixture();
  const connectionEvents: any[] = [];
  bridge.on("event", (event) => connectionEvents.push(event));

  await bridge.connect(baseConfig);
  children[0].crash(23);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(bridge.getLifecycleSnapshot().state, "exited");
  assert.equal(bridge.getLifecycleSnapshot().instanceId, null);
  assert.match(connectionEvents.at(-1).status.message, /app-server 已退出 \(23\)/);

  const recovered = await bridge.connect(baseConfig);
  assert.equal(recovered.state, "ready");
  assert.equal(children.length, 2);
  assert.equal(bridge.getLifecycleSnapshot().instanceId, 2);
  bridge.close();
});

test("TEST-style connect during an active turn reuses the process and never interrupts", async () => {
  const { bridge, children } = bridgeFixture();
  await bridge.connect(baseConfig);
  const started = await bridge.startTurn("generate a long response", "c1");
  const before = bridge.getLifecycleSnapshot();

  const status = await bridge.connect(baseConfig);
  const after = bridge.getLifecycleSnapshot();

  assert.equal(status.state, "ready");
  assert.equal(children.length, 1);
  assert.equal(started.turnId, "turn-1");
  assert.equal(after.instanceId, before.instanceId);
  assert.equal(after.activeTurns.c1, "turn-1");
  assert.equal(children[0].methods.filter((method) => method === "turn/start").length, 1);
  assert.equal(children[0].methods.includes("turn/interrupt"), false);
  bridge.close();
});

test("an immediate interrupt retries only the app-server not-yet-active race", async () => {
  const { bridge, children } = bridgeFixture();
  await bridge.connect(baseConfig);
  const started = await bridge.startTurn("stop immediately", "c1");
  children[0].turnInterruptFailures = 1;

  await bridge.interrupt(started.turnId, "c1");

  assert.equal(
    children[0].methods.filter((method) => method === "turn/interrupt").length,
    2,
  );
  bridge.close();
});

test("different conversation ids own different Codex threads and turns", async () => {
  const { bridge, children } = bridgeFixture();
  await bridge.connect(baseConfig);

  const [first, second] = await Promise.all([
    bridge.startTurn("first", "c1"),
    bridge.startTurn("second", "c2"),
  ]);
  const turnStarts = children[0].requests.filter(
    (request) => request.method === "turn/start",
  );

  assert.equal(first.conversationId, "c1");
  assert.equal(second.conversationId, "c2");
  assert.notEqual(first.threadId, second.threadId);
  assert.deepEqual(bridge.getActiveTurns(), {
    c1: first.turnId,
    c2: second.turnId,
  });
  assert.equal((turnStarts[0].params as any).threadId, first.threadId);
  assert.equal((turnStarts[1].params as any).threadId, second.threadId);
  bridge.close();
});

test("turn/start keeps the reply protocol out of persisted user input", async () => {
  const { bridge, children } = bridgeFixture();
  await bridge.connect(baseConfig);

  await bridge.startTurn("[USER_RECORDS]\n短消息\n[/USER_RECORDS]", "c1");
  const request = children[0].requests.find(
    (candidate) => candidate.method === "turn/start",
  );
  const params = request?.params as any;

  assert.equal(params.input.length, 1);
  assert.equal(params.input[0].text, "[USER_RECORDS]\n短消息\n[/USER_RECORDS]");
  assert.doesNotMatch(params.input[0].text, /MIAN_PUBLIC_REPLY_PROTOCOL/);
  assert.deepEqual(params.additionalContext, {
    [MIAN_PUBLIC_REPLY_CONTEXT_KEY]: {
      value: MIAN_PUBLIC_REPLY_PROTOCOL,
      kind: "application",
    },
  });
  bridge.close();
});

test("a fresh conversation shares one in-flight thread initialization", async () => {
  const { bridge, children } = bridgeFixture();
  await bridge.connect(baseConfig);

  const [started, forked] = await Promise.all([
    bridge.startTurn("first message", "fresh"),
    bridge.forkConversationThread("fresh"),
  ]);
  const threadStarts = children[0].requests.filter(
    (request) => request.method === "thread/start",
  );
  const turnStarts = children[0].requests.filter(
    (request) => request.method === "turn/start",
  );
  const forks = children[0].requests.filter(
    (request) => request.method === "thread/fork",
  );

  assert.equal(threadStarts.length, 1);
  assert.equal(turnStarts.length, 1);
  assert.equal(forks.length, 1);
  assert.equal((forks[0].params as any).threadId, started.threadId);
  assert.notEqual(forked.threadId, started.threadId);
  bridge.close();
});

test("a failed fresh thread initialization can be retried without a duplicate turn", async () => {
  const { bridge, children } = bridgeFixture();
  await bridge.connect(baseConfig);
  children[0].threadStartFailures = 1;

  await assert.rejects(
    bridge.startTurn("keep this message", "fresh-retry"),
    /thread initialization failed/,
  );
  const retried = await bridge.startTurn("keep this message", "fresh-retry");
  const methods = children[0].methods;

  assert.equal(
    methods.filter((method) => method === "thread/start").length,
    2,
  );
  assert.equal(
    methods.filter((method) => method === "turn/start").length,
    1,
  );
  assert.equal(retried.conversationId, "fresh-retry");
  bridge.close();
});

test("an old empty thread without a rollout is replaced once and its first turn continues", async () => {
  const { bridge, children } = bridgeFixture();
  bridge.registerConversationThread("c2", "thread-without-rollout");
  await bridge.connect(baseConfig);
  children[0].threadResumeFailures = 1;

  const started = await bridge.startTurn("first real message", "c2");
  const methods = children[0].methods;

  assert.equal(
    methods.filter((method) => method === "thread/resume").length,
    1,
  );
  assert.equal(
    methods.filter((method) => method === "thread/start").length,
    1,
  );
  assert.equal(
    methods.filter((method) => method === "turn/start").length,
    1,
  );
  assert.notEqual(started.threadId, "thread-without-rollout");
  assert.equal(bridge.getThreadId("c2"), started.threadId);
  bridge.close();
});

test("a branch uses the official thread/fork method and keeps its own thread", async () => {
  const { bridge, children } = bridgeFixture();
  await bridge.connect(baseConfig);
  const parent = await bridge.startTurn("parent", "c1");
  const forked = await bridge.forkConversationThread("c1");
  bridge.registerConversationThread("branch-1", forked.threadId);
  const branch = await bridge.startTurn("branch", "branch-1");

  const forkRequest = children[0].requests.find(
    (request) => request.method === "thread/fork",
  );
  assert.ok(forkRequest);
  assert.equal((forkRequest.params as any).threadId, parent.threadId);
  assert.equal((forkRequest.params as any).ephemeral, false);
  assert.equal(branch.threadId, forked.threadId);
  assert.deepEqual(forked.metadata, {
    model: "gpt-forked",
    reasoningEffort: "low",
  });
  assert.notEqual(branch.threadId, parent.threadId);
  bridge.close();
});

test("archiving uses official thread/archive and removes runtime only after commit", async () => {
  const { bridge, children } = bridgeFixture();
  await bridge.connect(baseConfig);
  const original = await bridge.createConversationThread();
  const originalThreadId = original.threadId;
  bridge.registerConversationThread("c2", originalThreadId);

  const archived = await bridge.archiveConversationThread("c2");
  const archiveRequest = children[0].requests.find(
    (request) => request.method === "thread/archive",
  );
  assert.ok(archiveRequest);
  assert.equal((archiveRequest.params as any).threadId, originalThreadId);
  assert.equal(archived.conversationId, "c2");

  assert.equal(bridge.getThreadId("c2"), originalThreadId);
  bridge.forgetConversation("c2");
  assert.throws(() => bridge.getThreadId("c2"), /Unknown conversation/);
  bridge.close();
});

test("a conversation without a thread can commit locally without connecting or inventing an archive", async () => {
  const { bridge, children } = bridgeFixture();
  const archived = await bridge.archiveConversationThread("c2");
  assert.deepEqual(archived, { conversationId: "c2", threadId: null });
  assert.equal(children.length, 0);
  assert.equal(bridge.getThreadId("c2"), null);
  bridge.forgetConversation("c2");
  assert.throws(() => bridge.getThreadId("c2"), /Unknown conversation/);
});

test("an empty thread with no rollout is already absent remotely and may commit locally", async () => {
  const { bridge, children } = bridgeFixture();
  await bridge.connect(baseConfig);
  const binding = await bridge.createConversationThread();
  bridge.registerConversationThread("c2", binding.threadId);
  children[0].threadArchiveFailures = 1;

  const archived = await bridge.archiveConversationThread("c2");
  assert.deepEqual(archived, {
    conversationId: "c2",
    threadId: binding.threadId,
  });
  assert.equal(
    children[0].requests.filter((request) => request.method === "thread/archive")
      .length,
    1,
  );
  assert.equal(bridge.getThreadId("c2"), binding.threadId);
  bridge.forgetConversation("c2");
  assert.throws(() => bridge.getThreadId("c2"), /Unknown conversation/);
  bridge.close();
});

test("an active or approval-blocked conversation cannot be archived", async () => {
  const activeFixture = bridgeFixture();
  await activeFixture.bridge.connect(baseConfig);
  await activeFixture.bridge.startTurn("still running", "c2");
  await assert.rejects(
    activeFixture.bridge.archiveConversationThread("c2"),
    /运行|权限/,
  );
  assert.equal(
    activeFixture.children[0].methods.includes("thread/archive"),
    false,
  );
  activeFixture.bridge.close();

  const approvalFixture = bridgeFixture();
  await approvalFixture.bridge.connect(baseConfig);
  const binding = await approvalFixture.bridge.createConversationThread();
  const threadId = binding.threadId;
  approvalFixture.bridge.registerConversationThread("c3", threadId);
  const request = (
    approvalFixture.bridge as unknown as {
      handleServerRequest(message: RpcMessage): void;
    }
  ).handleServerRequest.bind(approvalFixture.bridge);
  request({
    jsonrpc: "2.0",
    id: 91,
    method: "item/commandExecution/requestApproval",
    params: { threadId, turnId: "turn-approval", command: "Get-Location" },
  });
  await assert.rejects(
    approvalFixture.bridge.archiveConversationThread("c3"),
    /运行|权限/,
  );
  assert.equal(
    approvalFixture.children[0].methods.includes("thread/archive"),
    false,
  );
  approvalFixture.bridge.close();
});

test("stream and approval events carry the owning conversation id", () => {
  const { bridge } = bridgeFixture();
  const events: any[] = [];
  bridge.on("event", (event) => events.push(event));
  bridge.registerConversationThread("c2", "thread-c2");
  const notify = (
    bridge as unknown as {
      handleNotification(method: string, params: unknown): void;
    }
  ).handleNotification.bind(bridge);
  const request = (
    bridge as unknown as {
      handleServerRequest(message: RpcMessage): void;
    }
  ).handleServerRequest.bind(bridge);

  notify("turn/started", {
    threadId: "thread-c2",
    turn: { id: "turn-c2" },
  });
  notify("item/agentMessage/delta", {
    threadId: "thread-c2",
    turnId: "turn-c2",
    delta: "只属于第二张票根",
  });
  request({
    jsonrpc: "2.0",
    id: 42,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-c2",
      turnId: "turn-c2",
      command: "Get-Location",
    },
  });

  assert.deepEqual(
    events.map((event) => [event.type, event.conversationId]),
    [
      ["turn-started", "c2"],
      ["assistant-delta", "c2"],
      ["approval", "c2"],
    ],
  );
  assert.throws(
    () => bridge.decide("42", true, "c1"),
    /不属于这个会话/,
  );
  bridge.close();
});

test("an unmapped app-server event is dropped instead of falling into C-01", () => {
  const { bridge } = bridgeFixture();
  const events: any[] = [];
  const logs: string[] = [];
  bridge.on("event", (event) => events.push(event));
  bridge.on("log", (message) => logs.push(String(message)));
  const notify = (
    bridge as unknown as {
      handleNotification(method: string, params: unknown): void;
    }
  ).handleNotification.bind(bridge);

  notify("item/agentMessage/delta", {
    threadId: "unknown-thread",
    turnId: "unknown-turn",
    delta: "must not enter c1",
  });

  assert.deepEqual(events, []);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /conversationId/);
  bridge.close();
});

test("thread metadata notifications stay routed to their conversation", () => {
  const { bridge } = bridgeFixture();
  const metadata: any[] = [];
  bridge.on("conversation-metadata", (event) => metadata.push(event));
  bridge.registerConversationThread("c2", "thread-c2");
  const notify = (
    bridge as unknown as {
      handleNotification(method: string, params: unknown): void;
    }
  ).handleNotification.bind(bridge);

  notify("model/rerouted", {
    threadId: "thread-c2",
    fromModel: "gpt-old",
    toModel: "gpt-new",
  });
  notify("thread/settings/updated", {
    threadId: "thread-c2",
    threadSettings: {
      model: "gpt-settings",
      effort: "xhigh",
      collaborationMode: { mode: "plan", settings: {} },
    },
  });
  const firstUsage = {
    threadId: "thread-c2",
    turnId: "turn-c2",
    tokenUsage: {
      total: {
        inputTokens: 18_100,
        cachedInputTokens: 17_400,
        outputTokens: 100,
        reasoningOutputTokens: 40,
        totalTokens: 18_200,
      },
    },
  };
  const latestUsage = {
    threadId: "thread-c2",
    turnId: "turn-c2",
    tokenUsage: {
      total: {
        inputTokens: 36_300,
        cachedInputTokens: 34_900,
        outputTokens: 190,
        reasoningOutputTokens: 80,
        totalTokens: 36_490,
      },
    },
  };
  notify("thread/tokenUsage/updated", firstUsage);
  notify("thread/tokenUsage/updated", latestUsage);
  notify("thread/tokenUsage/updated", latestUsage);

  assert.deepEqual(metadata, [
    { conversationId: "c2", patch: { model: "gpt-new" } },
    {
      conversationId: "c2",
      patch: {
        model: "gpt-settings",
        reasoningEffort: "xhigh",
        collaborationMode: "plan",
      },
    },
    {
      conversationId: "c2",
      patch: { totalTokens: 18_200, uncachedTotalTokens: 800 },
    },
    {
      conversationId: "c2",
      patch: { totalTokens: 36_490, uncachedTotalTokens: 1_590 },
    },
    {
      conversationId: "c2",
      patch: { totalTokens: 36_490, uncachedTotalTokens: 1_590 },
    },
  ]);
  bridge.close();
});

test("invalid cached usage is clamped and logged without a negative patch", () => {
  const { bridge } = bridgeFixture();
  const metadata: any[] = [];
  const logs: string[] = [];
  bridge.on("conversation-metadata", (event) => metadata.push(event));
  bridge.on("log", (message) => logs.push(String(message)));
  bridge.registerConversationThread("c2", "thread-c2");
  const notify = (
    bridge as unknown as {
      handleNotification(method: string, params: unknown): void;
    }
  ).handleNotification.bind(bridge);

  notify("thread/tokenUsage/updated", {
    threadId: "thread-c2",
    turnId: "turn-c2",
    tokenUsage: {
      total: {
        inputTokens: 100,
        cachedInputTokens: 250,
        outputTokens: 20,
        reasoningOutputTokens: 10,
        totalTokens: 120,
      },
    },
  });

  assert.deepEqual(metadata, [
    {
      conversationId: "c2",
      patch: { totalTokens: 120, uncachedTotalTokens: 0 },
    },
  ]);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /cachedInputTokens exceeds inputTokens/);
  bridge.close();
});
