import assert from "node:assert/strict";
import test from "node:test";
import { ConversationSessions } from "../client/src/conversationSessions.ts";
import type { ConversationRecord } from "../client/src/types.ts";

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

const record = (conversationId: string): ConversationRecord => ({
  conversationId,
  threadId: null,
  parentConversationId: null,
  rootNumber: Number(conversationId.replace(/\D/g, "")) || 1,
  branchPath: [],
  branchCounter: 0,
  abbr: conversationId.toUpperCase(),
  title: conversationId,
  frontName: "Mian",
  image: "",
  pinned: conversationId === "c1",
  model: null,
  reasoningEffort: null,
  totalTokens: null,
  uncachedTotalTokens: null,
  lastActivityAt: null,
  lastMessage: null,
  collaborationMode: null,
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
});

test("three registered conversations own independent pending, turns and event streams", async () => {
  const storage = new MemoryStorage();
  const sends: Array<{ text: string; conversationId: string }> = [];
  const sessions = new ConversationSessions({
    initialConversationIds: ["c1"],
    storage,
    onActivity: () => {},
    apiClient: {
      send: async (text, conversationId) => {
        sends.push({ text, conversationId });
        return { turnId: `turn-${conversationId}` };
      },
      stop: async () => undefined,
    },
  });
  sessions.synchronize({
    streamId: "stream",
    seq: 0,
    reset: true,
    threadId: null,
    activeTurnId: null,
    defaultConversationId: "c1",
    activeTurns: {},
    conversations: [record("c1"), record("c2"), record("c3")],
  });

  for (const conversationId of ["c1", "c2", "c3"]) {
    const store = sessions.get(conversationId);
    store.saveUserRecord(`first-${conversationId}`);
    store.saveUserRecord(`second-${conversationId}`);
    await store.startPendingTurn();
  }

  assert.deepEqual(
    sends.map(({ conversationId }) => conversationId),
    ["c1", "c2", "c3"],
  );
  for (const conversationId of ["c1", "c2", "c3"]) {
    const snapshot = sessions.get(conversationId).getSnapshot();
    assert.equal(snapshot.activeTurnId, `turn-${conversationId}`);
    const ownGroup = snapshot.messages[0];
    assert.ok(ownGroup?.role === "user");
    assert.deepEqual(
      ownGroup.role === "user"
        ? ownGroup.records.map(({ text }) => text)
        : [],
      [`first-${conversationId}`, `second-${conversationId}`],
    );
  }

  sessions.route({
    type: "assistant-delta",
    conversationId: "c2",
    turnId: "turn-c2",
    delta: "<mian-bubble>only-c2</mian-bubble>",
  });
  assert.equal(sessions.get("c1").getSnapshot().messages.length, 1);
  assert.equal(sessions.get("c3").getSnapshot().messages.length, 1);
  assert.equal(sessions.get("c2").getSnapshot().messages.length, 2);
});

test("a remote session reconciles every conversation and later stores inherit authority", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    "mian.conversation.c2.mian.chat-session.v1",
    JSON.stringify({ activeTurnId: "stale-turn" }),
  );
  const sessions = new ConversationSessions({
    initialConversationIds: ["c1", "c2"],
    storage,
    onActivity: () => {},
    apiClient: {
      send: async (_text, conversationId) => ({ turnId: `new-${conversationId}` }),
      stop: async () => undefined,
    },
  });
  sessions.synchronize({
    streamId: "stream",
    seq: 1,
    reset: false,
    threadId: null,
    activeTurnId: null,
    defaultConversationId: "c1",
    activeTurns: { c3: "turn-c3" },
    conversations: [record("c1"), record("c2"), record("c3")],
  });

  assert.equal(sessions.get("c2").getSnapshot().activeTurnId, null);
  assert.equal(sessions.get("c3").getSnapshot().activeTurnId, "turn-c3");
  assert.throws(
    () =>
      sessions.route({
        type: "assistant-delta",
        turnId: "missing-owner",
        delta: "wrong",
      }),
    /missing conversationId/,
  );
});

test("a pre-session empty-send waits for backend authority and then submits once", async () => {
  const storage = new MemoryStorage();
  const sends: string[] = [];
  const sessions = new ConversationSessions({
    initialConversationIds: ["c1", "c2"],
    storage,
    onActivity: () => {},
    apiClient: {
      send: async (_text, conversationId) => {
        sends.push(conversationId);
        return { turnId: `turn-${conversationId}` };
      },
      stop: async () => undefined,
    },
  });
  const c2 = sessions.get("c2");
  c2.saveUserRecord("wait for session");
  const start = c2.startPendingTurn();
  await Promise.resolve();
  assert.deepEqual(sends, []);

  sessions.synchronize({
    streamId: "stream",
    seq: 0,
    reset: true,
    threadId: null,
    activeTurnId: null,
    defaultConversationId: "c1",
    activeTurns: {},
    conversations: [record("c1"), record("c2")],
  });
  await start;
  assert.deepEqual(sends, ["c2"]);
});

test("removing one conversation clears only its own persisted runtime", () => {
  const storage = new MemoryStorage();
  const sessions = new ConversationSessions({
    initialConversationIds: ["c1", "c2"],
    storage,
    onActivity: () => {},
    apiClient: {
      send: async (_text, conversationId) => ({ turnId: `turn-${conversationId}` }),
      stop: async () => undefined,
    },
  });
  sessions.get("c1").saveUserRecord("keep");
  sessions.get("c2").saveUserRecord("remove");
  sessions.remove("c2");

  assert.equal(sessions.get("c1").getSnapshot().messages.length, 1);
  assert.throws(() => sessions.get("c2"), /Unknown conversation/);
  assert.equal(
    storage.getItem("mian.conversation.c2.mian.chat-groups.v2"),
    null,
  );
});
