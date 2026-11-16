import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConversationMessages } from "../server/src/messages.ts";
import { ChatFiles } from "../server/src/chatFiles.ts";
import { appendUserRecord, applyReplyEvent, chatHistory, type ChatGroup, type UserGroup } from "../shared/chatModel.mjs";
import { ChatSessionStore } from "../client/src/chatSession.ts";
import { flushMessageSyncs, type MessageSnapshot } from "../client/src/messageSync.ts";
import { fileTicketServer, imageBytes } from "./fileTickets.server.mjs";

const user = (text: string, id: string) => appendUserRecord([], text, "12:00", id, `group-${id}`)[0] as UserGroup;
const snapshot = (groups: ChatGroup[], exists = true, eventSeq = 0): MessageSnapshot => ({ groups, exists, eventSeq, streamId: "stream" });
const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};

test("message files migrate once, survive reload, merge late saves and externalize images", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mian-messages-"));
  const files = new ChatFiles(path.join(directory, "files"));
  const messages = new ConversationMessages(files, path.join(directory, "messages"));
  try {
    assert.equal((await messages.read("a")).exists, false);
    await messages.save("a", [user("first", "first")], true);
    await messages.save("a", [user("stale cache", "old")], true);
    const dataUrl = `data:image/png;base64,${imageBytes.toString("base64")}`;
    await messages.submit("a", user(`![photo](${dataUrl})`, "photo"));
    await messages.recordEvent("a", { type: "assistant-delta", turnId: "reply", delta: `<mian-bubble>![answer](${dataUrl})</mian-bubble>` }, 1);
    await messages.recordEvent("a", { type: "tool", turnId: "reply", tool: { id: "tool", name: "exec", detail: "done", state: "success" } }, 2);
    await messages.recordEvent("a", { type: "turn-completed", turnId: "reply", status: "completed" }, 3);
    await messages.save("a", [user("late stale save", "photo")]);
    const saved = await new ConversationMessages(files, path.join(directory, "messages")).read("a");
    assert.equal(saved.groups.length, 3);
    assert.equal((saved.groups[1] as UserGroup).pending, false);
    assert.equal(saved.groups[2].role, "assistant");
    if (saved.groups[2].role === "assistant") {
      assert.equal(saved.groups[2].tools[0].state, "success");
      assert.match(saved.groups[2].raw, /\/api\/conversations\/a\/files\/image-/);
    }
    const json = await readFile(path.join(directory, "messages/a.json"), "utf8");
    assert.doesNotMatch(json, /data:image|stale cache|late stale/);
    const exported = await files.export(["a"]);
    assert.equal(exported.length, 1);
    assert.deepEqual(Buffer.from(exported[0].content, "base64"), imageBytes);
    await files.copyConversation("a", "branch");
    await messages.copy("a", "branch");
    assert.match(JSON.stringify((await messages.read("branch")).groups), /\/conversations\/branch\/files\//);
  } finally {
    await messages.close();
    assert.equal(path.dirname(directory), tmpdir());
    await rm(directory, { recursive: true, force: true });
  }
});

test("server wins over cache, pending saves retry, and full localStorage does not block chat", async () => {
  let remote = snapshot([{ ...user("server history", "server"), pending: false }]);
  let failSave = true;
  let sent = "";
  const local = storage();
  local.setItem("mian.conversation.a.mian.chat-groups.v2", JSON.stringify([user("stale", "stale")]));
  const messageApi = {
    loadMessages: async () => structuredClone(remote),
    saveMessages: async (_id: string, groups: ChatGroup[], initialize?: boolean) => {
      assert.equal(initialize, undefined);
      if (failSave) throw new Error("offline save");
      remote = snapshot([...remote.groups, ...groups]);
      return structuredClone(remote);
    },
  };
  const store = new ChatSessionStore({ conversationId: "a", storage: local, messageApi, apiClient: {
    send: async (text, _id, _files, message) => { sent = text; assert.equal(message?.records.length, 1); return { turnId: "reply" }; }, stop: async () => {},
  } });
  try {
    await flushMessageSyncs();
    assert.equal((store.getSnapshot().messages[0] as UserGroup).records[0].text, "server history");
    local.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
    store.saveUserRecord("new message");
    await assert.rejects(flushMessageSyncs(), /offline save/);
    await store.startPendingTurn();
    assert.equal(sent, "new message");
    failSave = false;
    await flushMessageSyncs();
    assert.equal(remote.groups.length, 2);
  } finally { store.dispose(); }
});

test("initial cache migration is conditional and a blank browser loads the same record", async () => {
  let remote = snapshot([], false);
  let migrations = 0;
  const messageApi = {
    loadMessages: async () => structuredClone(remote),
    saveMessages: async (_id: string, groups: ChatGroup[], initialize?: boolean) => {
      assert.equal(initialize, true);
      migrations++;
      remote = snapshot(groups);
      return structuredClone(remote);
    },
  };
  const local = storage();
  local.setItem("mian.conversation.a.mian.chat-groups.v2", JSON.stringify([user("old browser", "old")]));
  const first = new ChatSessionStore({ conversationId: "a", storage: local, messageApi });
  await flushMessageSyncs();
  first.dispose();
  const second = new ChatSessionStore({ conversationId: "a", storage: storage(), messageApi });
  try {
    await flushMessageSyncs();
    assert.equal(migrations, 1);
    assert.equal((second.getSnapshot().messages[0] as UserGroup).records[0].text, "old browser");
  } finally { second.dispose(); }
});

test("events crossing cache hydration and a history fetch are applied once without losing newer deltas", async () => {
  let resolve!: (snapshot: MessageSnapshot) => void;
  let showCache!: (snapshot: MessageSnapshot) => void;
  const store = new ChatSessionStore({ conversationId: "a", storage: storage(), messageApi: {
    loadMessages: (_id, cached) => new Promise<MessageSnapshot>(done => { resolve = done; showCache = cached!; }), saveMessages: async () => { throw new Error("unexpected save"); },
  } });
  try {
    const event = { type: "assistant-delta" as const, conversationId: "a", turnId: "reply", delta: "A", format: "plain" as const, streamId: "stream", eventSeq: 1 };
    store.enqueueEvent(event);
    showCache(snapshot([]));
    const cachedReply = store.getSnapshot().messages[0];
    assert.equal(cachedReply.role === "assistant" && cachedReply.raw, "A");
    store.enqueueEvent({ ...event, delta: "B", eventSeq: 2 });
    resolve(snapshot(applyReplyEvent([], event, "12:00"), true, 1));
    await flushMessageSyncs();
    const reply = store.getSnapshot().messages[0];
    assert.equal(reply.role === "assistant" && reply.raw, "AB");
  } finally { store.dispose(); }
});

test("real routes use server history across channels and restore messages with image bytes", async () => {
  const backend = await fileTicketServer();
  let restored: Awaited<ReturnType<typeof fileTicketServer>> | undefined;
  const request = async (url: string, body?: unknown, method = "POST", base = backend.base) => {
    const result = await fetch(base + url, { method: body === undefined ? "GET" : method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal(result.ok, true, await result.clone().text());
    return result.json();
  };
  const completed = async (id: string, turnId: string) => {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      const saved = await request(`/api/conversations/${id}/messages`);
      if (saved.groups.some((group: any) => group.replyGroupId === turnId && group.status)) return saved;
      await new Promise(done => setTimeout(done, 20));
    }
    throw new Error("reply was not saved");
  };
  try {
    const { defaultConversationId: id } = await request("/api/conversations");
    const image = `data:image/png;base64,${imageBytes.toString("base64")}`;
    await request(`/api/conversations/${id}/messages`, { initialize: true, groups: [user(`first ![image](${image})`, "first")] }, "PUT");
    const apiTurn = await request("/api/turn", { conversationId: id, text: "new question", messages: [{ role: "user", content: "FORGED HISTORY" }] });
    await completed(id, apiTurn.turnId);
    assert.match(JSON.stringify(backend.received[0].messages), /first/);
    assert.doesNotMatch(JSON.stringify(backend.received[0].messages), /FORGED HISTORY/);
    const config = await request("/api/config");
    await request("/api/config", { ...config, channel: { kind: "codex" } }, "PUT");
    const codexTurn = await request("/api/turn", { conversationId: id, text: "codex question" });
    await completed(id, codexTurn.turnId);
    await request("/api/config", config, "PUT");
    const next = await request("/api/turn", { conversationId: id, text: "remember everything" });
    await completed(id, next.turnId);
    const history = JSON.stringify(backend.received.at(-1).messages);
    assert.match(history, /first/);
    assert.match(history, /codex question/);
    assert.match(history, /文件做好了/);
    const backup = await request("/api/backup");
    assert.ok(backup.chats[id].length >= 7);
    assert.doesNotMatch(JSON.stringify(backup.chats), /data:image/);
    assert.ok(backup.files.length >= 3);
    restored = await fileTicketServer();
    await request("/api/backup", { ...backup, preferences: {} }, "POST", restored.base);
    const saved = await request(`/api/conversations/${id}/messages`, undefined, "GET", restored.base);
    assert.deepEqual(chatHistory(saved.groups), chatHistory(backup.chats[id]));
    const imageFile = backup.files.find((entry: any) => entry.file.id.startsWith("image-"));
    const downloaded = await fetch(`${restored.base}/api/conversations/${id}/files/${imageFile.file.id}?inline=1`);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), imageBytes);
  } finally {
    await backend.close();
    await restored?.close();
  }
});
