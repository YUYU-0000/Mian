import assert from "node:assert/strict";
import test from "node:test";
import { ChatSessionStore } from "../client/src/chatSession.ts";
import { CHAT_STORAGE_KEY } from "../client/src/chatModel.ts";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

function fakePlaybackClock() {
  let now = 0;
  let nextId = 1;
  const jobs = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => now,
    schedule: (callback: () => void, delay: number) => {
      const id = nextId++;
      jobs.set(id, { at: now + delay, callback });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (handle: ReturnType<typeof setTimeout>) => {
      jobs.delete(handle as unknown as number);
    },
    runAll: () => {
      let turns = 0;
      while (jobs.size) {
        if (turns++ > 1000) throw new Error("playback queue did not settle");
        const [id, job] = [...jobs.entries()].sort(
          (left, right) => left[1].at - right[1].at,
        )[0];
        jobs.delete(id);
        now = job.at;
        job.callback();
      }
    },
  };
}

test("route unmount does not own or interrupt the active turn", async () => {
  const storage = new MemoryStorage();
  const clock = fakePlaybackClock();
  let starts = 0;
  const stopped: string[] = [];
  const store = new ChatSessionStore({
    conversationId: "c1",
    storage,
    apiClient: {
      send: async () => ({ turnId: `turn-${++starts}` }),
      stop: async (turnId) => {
        stopped.push(turnId);
      },
    },
    nowLabel: () => "10:20",
    nowMs: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
  });

  store.saveUserRecord("请给我一段较长的回复");
  await store.startPendingTurn();
  assert.equal(starts, 1);
  assert.equal(store.getSnapshot().activeTurnId, "turn-1");

  let visibleUpdates = 0;
  const leaveChat = store.subscribe(() => {
    visibleUpdates += 1;
  });
  leaveChat();

  store.enqueueEvent({ type: "turn-started", turnId: "turn-1" });
  store.enqueueEvent({
    type: "assistant-delta",
    turnId: "turn-1",
    delta:
      "<mian-thinking>测试用户在等这段回复，我慢一点说完整。</mian-thinking><mian-pre-tool>我先确认一下。</mian-pre-tool>",
  });
  store.enqueueEvent({
    type: "tool",
    turnId: "turn-1",
    tool: {
      id: "read-project",
      name: "read_file",
      detail: "真实结果",
      result: "真实结果",
      state: "success",
      kind: "read_file",
    },
  });
  store.enqueueEvent({
    type: "assistant-delta",
    turnId: "turn-1",
    delta:
      "<mian-tool-summary>读取项目文件</mian-tool-summary><mian-bubble>已经确认好了。这是一段在离开 Chat 后继续收到并完整保存的回复正文。</mian-bubble>",
  });
  assert.equal(stopped.length, 0);
  assert.equal(starts, 1);
  assert.equal(visibleUpdates, 0);

  let reentryUpdates = 0;
  const leaveAgain = store.subscribe(() => {
    reentryUpdates += 1;
  });
  const duringTurn = store.getSnapshot();
  const reply = duringTurn.messages.find(
    (message) =>
      message.role === "assistant" && message.replyGroupId === "turn-1",
  );
  assert.ok(reply && reply.role === "assistant");
  if (!reply || reply.role !== "assistant") return;
  assert.equal(reply.thinking, "测试用户在等这段回复，我慢一点说完整。");
  assert.deepEqual(reply.preToolBubbles[0], "我先确认一下。");
  assert.equal(reply.tools.length, 1);
  assert.deepEqual(reply.bubbles, [
    "已经确认好了。这是一段在离开 Chat 后继续收到并完整保存的回复正文。",
  ]);
  leaveAgain();

  store.enqueueEvent({
    type: "turn-completed",
    turnId: "turn-1",
    status: "completed",
  });
  clock.runAll();
  const completed = store.getSnapshot();
  assert.equal(completed.activeTurnId, null);
  assert.equal(starts, 1);
  assert.equal(stopped.length, 0);
  assert.equal(reentryUpdates, 0);
  const restored = new ChatSessionStore({
    conversationId: "c1",
    storage,
    apiClient: {
      send: async () => ({ turnId: "unused" }),
      stop: async () => {},
    },
    nowLabel: () => "10:20",
    nowMs: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
  }).getSnapshot();
  const restoredReply = restored.messages.find(
    (message) =>
      message.role === "assistant" && message.replyGroupId === "turn-1",
  );
  assert.ok(restoredReply && restoredReply.role === "assistant");
  if (restoredReply?.role === "assistant") {
    assert.equal(restoredReply.tools.length, 1);
    assert.equal(restoredReply.bubbles.length, 1);
    assert.equal(restoredReply.status, "completed");
  }
});

test("legacy single-conversation history migrates into default C-01", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    CHAT_STORAGE_KEY,
    JSON.stringify([
      {
        role: "user",
        groupId: "legacy-group",
        pending: true,
        time: "08:00",
        records: [
          { messageId: "legacy-message", text: "旧记录", time: "08:00" },
        ],
      },
    ]),
  );

  const store = new ChatSessionStore({ storage, conversationId: "c1" });
  assert.equal(store.getSnapshot().messages.length, 1);
  assert.equal(store.getSnapshot().conversationId, "c1");
  store.saveUserRecord("继续保留");
  assert.ok(storage.getItem(`mian.conversation.c1.${CHAT_STORAGE_KEY}`));
  assert.ok(storage.getItem(CHAT_STORAGE_KEY));
});

test("conversation stores persist and send independently", async () => {
  const storage = new MemoryStorage();
  const sends: Array<{ text: string; conversationId?: string }> = [];
  const apiClient = {
    send: async (text: string, conversationId?: string) => {
      sends.push({ text, conversationId });
      return { turnId: `turn-${conversationId}` };
    },
    stop: async () => undefined,
  };
  const first = new ChatSessionStore({ storage, conversationId: "c1", apiClient });
  const second = new ChatSessionStore({ storage, conversationId: "c2", apiClient });

  first.saveUserRecord("第一张票根");
  second.saveUserRecord("第二张票根");
  await first.startPendingTurn();
  await second.startPendingTurn();

  assert.equal(first.getSnapshot().messages.length, 1);
  assert.equal(second.getSnapshot().messages.length, 1);
  assert.deepEqual(
    sends.map((entry) => entry.conversationId),
    ["c1", "c2"],
  );
  assert.notEqual(
    storage.getItem(`mian.conversation.c1.${CHAT_STORAGE_KEY}`),
    storage.getItem(`mian.conversation.c2.${CHAT_STORAGE_KEY}`),
  );
});

test("a fresh blank conversation keeps its first message and starts its own turn", async () => {
  const storage = new MemoryStorage();
  const sends: Array<{ text: string; conversationId?: string }> = [];
  const store = new ChatSessionStore({
    storage,
    conversationId: "fresh-conversation",
    apiClient: {
      send: async (text, conversationId) => {
        sends.push({ text, conversationId });
        return { turnId: "fresh-turn" };
      },
      stop: async () => undefined,
    },
  });

  store.saveUserRecord("第一句话");
  await store.startPendingTurn();

  assert.equal(sends.length, 1);
  assert.equal(sends[0].conversationId, "fresh-conversation");
  assert.match(sends[0].text, /第一句话/);
  assert.equal(store.getSnapshot().activeTurnId, "fresh-turn");
  assert.equal(
    store.getSnapshot().messages[0]?.role === "user" &&
      store.getSnapshot().messages[0].pending,
    false,
  );
});

test("concurrent first-turn requests share the store initialization and send once", async () => {
  const storage = new MemoryStorage();
  let resolveSend!: (value: { turnId: string }) => void;
  let sends = 0;
  const store = new ChatSessionStore({
    storage,
    conversationId: "fresh-race",
    apiClient: {
      send: () => {
        sends += 1;
        return new Promise<{ turnId: string }>((resolve) => {
          resolveSend = resolve;
        });
      },
      stop: async () => undefined,
    },
  });
  store.saveUserRecord("只提交一次");

  const first = store.startPendingTurn();
  const second = store.startPendingTurn();
  assert.equal(sends, 1);
  resolveSend({ turnId: "race-turn" });
  await Promise.all([first, second]);

  assert.equal(sends, 1);
  assert.equal(store.getSnapshot().activeTurnId, "race-turn");
});

test("failed first initialization retains the pending message for a safe retry", async () => {
  const storage = new MemoryStorage();
  const submitted: string[] = [];
  let attempts = 0;
  const store = new ChatSessionStore({
    storage,
    conversationId: "fresh-retry",
    apiClient: {
      send: async (text) => {
        submitted.push(text);
        attempts += 1;
        if (attempts === 1) throw new Error("thread initialization failed");
        return { turnId: "retry-turn" };
      },
      stop: async () => undefined,
    },
  });
  store.saveUserRecord("不能丢的原消息");

  const originalError = console.error;
  console.error = () => {};
  try {
    await store.startPendingTurn();
  } finally {
    console.error = originalError;
  }
  const afterFailure = store.getSnapshot().messages[0];
  assert.ok(afterFailure?.role === "user");
  assert.equal(afterFailure.role === "user" && afterFailure.pending, true);

  await store.startPendingTurn();
  assert.equal(attempts, 2);
  assert.equal(submitted[0], submitted[1]);
  assert.match(submitted[1], /不能丢的原消息/);
  assert.equal(store.getSnapshot().activeTurnId, "retry-turn");
});

test("C-02 and C-03 use their own pending groups when empty-send starts a turn", async () => {
  const storage = new MemoryStorage();
  const sends: Array<{ text: string; conversationId?: string }> = [];
  const apiClient = {
    send: async (text: string, conversationId?: string) => {
      sends.push({ text, conversationId });
      return { turnId: `turn-${conversationId}` };
    },
    stop: async () => undefined,
  };
  const c02 = new ChatSessionStore({ storage, conversationId: "c02", apiClient });
  const c03 = new ChatSessionStore({ storage, conversationId: "c03", apiClient });

  c02.saveUserRecord("C-02 的消息");
  c03.saveUserRecord("C-03 的消息");
  assert.equal(sends.length, 0);
  await c02.startPendingTurn();
  await c03.startPendingTurn();

  assert.deepEqual(
    sends.map(({ conversationId }) => conversationId),
    ["c02", "c03"],
  );
  assert.match(sends[0].text, /C-02 的消息/);
  assert.match(sends[1].text, /C-03 的消息/);
});

test("switching stores cannot submit another conversation's pending group", async () => {
  const storage = new MemoryStorage();
  const sends: Array<{ text: string; conversationId?: string }> = [];
  const apiClient = {
    send: async (text: string, conversationId?: string) => {
      sends.push({ text, conversationId });
      return { turnId: `turn-${conversationId}` };
    },
    stop: async () => undefined,
  };
  const c02 = new ChatSessionStore({ storage, conversationId: "c02", apiClient });
  const c03 = new ChatSessionStore({ storage, conversationId: "c03", apiClient });
  c02.saveUserRecord("留在二号");
  c03.saveUserRecord("留在三号");

  await c03.startPendingTurn();
  assert.equal(sends.length, 1);
  assert.equal(sends[0].conversationId, "c03");
  assert.match(sends[0].text, /留在三号/);
  assert.equal(
    c02.getSnapshot().messages[0]?.role === "user" &&
      c02.getSnapshot().messages[0].pending,
    true,
  );
});

test("an old ticket recovers its last unanswered user group before empty-send", async () => {
  const storage = new MemoryStorage();
  storage.setItem(
    `mian.conversation.c02.${CHAT_STORAGE_KEY}`,
    JSON.stringify([
      {
        role: "user",
        groupId: "legacy-unanswered",
        pending: false,
        time: "09:00",
        records: [
          {
            messageId: "legacy-message",
            text: "之前保存但没有得到回复",
            time: "09:00",
          },
        ],
      },
    ]),
  );
  const sends: Array<{ text: string; conversationId?: string }> = [];
  const store = new ChatSessionStore({
    storage,
    conversationId: "c02",
    apiClient: {
      send: async (text, conversationId) => {
        sends.push({ text, conversationId });
        return { turnId: "recovered-turn" };
      },
      stop: async () => undefined,
    },
  });

  await store.startPendingTurn();
  assert.equal(sends.length, 1);
  assert.equal(sends[0].conversationId, "c02");
  assert.match(sends[0].text, /之前保存但没有得到回复/);
  assert.equal(store.getSnapshot().activeTurnId, "recovered-turn");
});

test("a non-reset remote snapshot clears a stale local turn and submits every unanswered user group", async () => {
  const storage = new MemoryStorage();
  storage.setItem(
    `mian.conversation.c02.${CHAT_STORAGE_KEY}`,
    JSON.stringify([
      {
        role: "assistant",
        replyGroupId: "old-turn",
        time: "08:00",
        thinking: "",
        activeReasoningItemIds: [],
        raw: "<mian-bubble>旧回复</mian-bubble>",
        preToolBubbles: [],
        preToolBubbleIds: [],
        preToolBubbleComplete: [],
        preToolComplete: false,
        bubbles: ["旧回复"],
        bubbleIds: ["old-bubble"],
        bubbleComplete: [true],
        tools: [],
        approvals: [],
        status: "completed",
      },
      {
        role: "user",
        groupId: "closed-one",
        pending: false,
        time: "09:00",
        records: [
          { messageId: "one", text: "第一条未回复消息", time: "09:00" },
        ],
      },
      {
        role: "user",
        groupId: "closed-two",
        pending: false,
        time: "09:01",
        records: [
          { messageId: "two", text: "第二条未回复消息", time: "09:01" },
        ],
      },
    ]),
  );
  storage.setItem(
    "mian.conversation.c02.mian.chat-session.v1",
    JSON.stringify({ activeTurnId: "stale-turn" }),
  );
  const sends: Array<{ text: string; conversationId?: string }> = [];
  const store = new ChatSessionStore({
    storage,
    conversationId: "c02",
    apiClient: {
      send: async (text, conversationId) => {
        sends.push({ text, conversationId });
        return { turnId: "recovered-turn" };
      },
      stop: async () => undefined,
    },
  });

  store.synchronizeRemoteTurn(null, false);
  assert.equal(store.getSnapshot().activeTurnId, null);
  await store.startPendingTurn();

  assert.equal(sends.length, 1);
  assert.equal(sends[0].conversationId, "c02");
  assert.match(sends[0].text, /第一条未回复消息[\s\S]*第二条未回复消息/);
  const userGroups = store
    .getSnapshot()
    .messages.filter((message) => message.role === "user");
  assert.equal(userGroups.length, 1);
  assert.equal(userGroups[0].role === "user" && userGroups[0].records.length, 2);
});

test("an immediate post-reload click waits for remote turn reconciliation instead of interrupting stale state", async () => {
  const storage = new MemoryStorage();
  storage.setItem(
    `mian.conversation.c02.${CHAT_STORAGE_KEY}`,
    JSON.stringify([
      {
        role: "user",
        groupId: "closed-before-reload",
        pending: false,
        time: "09:00",
        records: [
          {
            messageId: "saved-before-reload",
            text: "重载后仍要提交的消息",
            time: "09:00",
          },
        ],
      },
    ]),
  );
  storage.setItem(
    "mian.conversation.c02.mian.chat-session.v1",
    JSON.stringify({ activeTurnId: "stale-turn" }),
  );
  const sends: Array<{ text: string; conversationId?: string }> = [];
  const stops: string[] = [];
  const store = new ChatSessionStore({
    storage,
    conversationId: "c02",
    apiClient: {
      send: async (text, conversationId) => {
        sends.push({ text, conversationId });
        return { turnId: "new-turn" };
      },
      stop: async (turnId) => {
        stops.push(turnId);
      },
    },
  });

  const click = store.stopCurrentTurn();
  await Promise.resolve();
  assert.equal(sends.length, 0);
  assert.equal(stops.length, 0);

  store.synchronizeRemoteTurn(null, false);
  await click;

  assert.equal(stops.length, 0);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].conversationId, "c02");
  assert.match(sends[0].text, /重载后仍要提交的消息/);
});

test("WebSocket events update only the conversation store that owns them", () => {
  const storage = new MemoryStorage();
  const c01 = new ChatSessionStore({ storage, conversationId: "c1" });
  const c02 = new ChatSessionStore({ storage, conversationId: "c02" });

  c02.enqueueEvent({ type: "turn-started", turnId: "turn-c02" });
  c02.enqueueEvent({
    type: "assistant-delta",
    turnId: "turn-c02",
    delta: "<mian-bubble>C-02 的真实回复</mian-bubble>",
  });

  assert.equal(c01.getSnapshot().messages.length, 0);
  const reply = c02.getSnapshot().messages[0];
  assert.ok(reply?.role === "assistant");
  assert.deepEqual(reply.role === "assistant" && reply.bubbles, [
    "C-02 的真实回复",
  ]);
});

test("only an explicit stop calls turn interrupt", async () => {
  const storage = new MemoryStorage();
  const stopped: string[] = [];
  const store = new ChatSessionStore({
    conversationId: "c1",
    storage,
    apiClient: {
      send: async () => ({ turnId: "turn-stop" }),
      stop: async (turnId) => {
        stopped.push(turnId);
      },
    },
    nowLabel: () => "10:20",
    schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
    cancelSchedule: () => {},
  });
  store.saveUserRecord("开始后再停止");
  await store.startPendingTurn();
  const unsubscribe = store.subscribe(() => {});
  unsubscribe();
  assert.deepEqual(stopped, []);
  await store.stopCurrentTurn();
  assert.deepEqual(stopped, ["turn-stop"]);
  assert.equal(store.getSnapshot().activeTurnId, null);
});
