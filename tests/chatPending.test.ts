import assert from "node:assert/strict";
import test from "node:test";
import {
  loadPending,
  PENDING_STORAGE_KEY,
  type PendingUserRecord,
} from "../client/src/chatPending.ts";
import { ChatSessionStore } from "../client/src/chatSession.ts";

class MemoryStorage {
  private values = new Map<string, string>();
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

const record = (id: string, text: string): PendingUserRecord => ({
  id,
  text,
  time: "10:00",
});

test("legacy pending records load in their persisted order", () => {
  const storage = new MemoryStorage();
  const records = [record("one", "第一条"), record("two", "第二条")];
  storage.setItem(PENDING_STORAGE_KEY, JSON.stringify(records));
  assert.deepEqual(loadPending(storage), records);
});

test("legacy pending loader ignores malformed and empty records", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    PENDING_STORAGE_KEY,
    JSON.stringify([
      record("one", "有效"),
      { id: "empty", text: "   ", time: "10:01" },
      { id: 2, text: "invalid", time: "10:02" },
    ]),
  );
  assert.deepEqual(loadPending(storage), [record("one", "有效")]);
});

test("ChatSessionStore migrates legacy pending records into scoped C-01 history", () => {
  const storage = new MemoryStorage();
  const records = [record("one", "第一条"), record("two", "第二条")];
  storage.setItem(PENDING_STORAGE_KEY, JSON.stringify(records));
  const session = new ChatSessionStore({
    conversationId: "c1",
    storage,
    requireRemoteSynchronization: false,
  });
  const messages = session.getSnapshot().messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.role, "user");
  assert.deepEqual(
    messages[0]?.role === "user"
      ? messages[0].records.map(({ messageId, text, time }) => ({
          id: messageId,
          text,
          time,
        }))
      : [],
    records,
  );
});
