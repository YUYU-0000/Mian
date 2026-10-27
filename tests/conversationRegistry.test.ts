import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ConversationRegistry } from "../server/src/conversations.ts";
import type { ConversationRecord } from "../server/src/types.ts";

const record = (conversationId: string, rootNumber: number): ConversationRecord => ({
  conversationId,
  threadId: `thread-${rootNumber}`,
  parentConversationId: null,
  rootNumber,
  branchPath: [],
  branchCounter: 0,
  abbr: `C-${String(rootNumber).padStart(2, "0")}`,
  title: `Conversation ${rootNumber}`,
  frontName: "Mian",
  image: "",
  pinned: rootNumber === 1,
  model: null,
  reasoningEffort: null,
  totalTokens: null,
  uncachedTotalTokens: null,
  lastActivityAt: null,
  lastMessage: null,
  collaborationMode: null,
  createdAt: `2026-08-19T00:00:0${rootNumber}.000Z`,
  updatedAt: `2026-08-19T00:00:0${rootNumber}.000Z`,
});

test("uncached cumulative usage overwrites snapshots and survives reload", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mian-token-usage-"));
  const storageFile = path.join(directory, "conversations.json");
  try {
    await writeFile(
      storageFile,
      JSON.stringify({
        version: 2,
        defaultConversationId: "c1",
        records: [record("c1", 1)],
      }),
      "utf8",
    );
    const registry = await ConversationRegistry.load(storageFile);

    await registry.updateRuntime("c1", {
      totalTokens: 18_200,
      uncachedTotalTokens: 800,
    });
    await registry.updateRuntime("c1", {
      totalTokens: 36_490,
      uncachedTotalTokens: 1_590,
    });
    await registry.updateRuntime("c1", {
      totalTokens: 36_490,
      uncachedTotalTokens: 1_590,
    });

    assert.equal(registry.require("c1").uncachedTotalTokens, 1_590);
    const restored = await ConversationRegistry.load(storageFile);
    assert.equal(restored.require("c1").totalTokens, 36_490);
    assert.equal(restored.require("c1").uncachedTotalTokens, 1_590);

    await restored.updateRuntime("c1", { model: "gpt-resumed" });
    assert.equal(restored.require("c1").uncachedTotalTokens, 1_590);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("removing C-01 persists and promotes an existing ticket as the compatibility default", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mian-conversations-"));
  const storageFile = path.join(directory, "conversations.json");
  try {
    await writeFile(
      storageFile,
      JSON.stringify({
        version: 2,
        defaultConversationId: "c1",
        records: [record("c1", 1), record("c2", 2)],
      }),
      "utf8",
    );
    const registry = await ConversationRegistry.load(storageFile);
    await registry.remove("c1");
    assert.deepEqual(
      registry.list().map((conversation) => conversation.conversationId),
      ["c2"],
    );
    assert.equal(registry.defaultConversationId(), "c2");

    const persisted = JSON.parse(await readFile(storageFile, "utf8"));
    assert.equal(persisted.defaultConversationId, "c2");
    assert.deepEqual(
      persisted.records.map((conversation: ConversationRecord) =>
        conversation.conversationId,
      ),
      ["c2"],
    );

    const restored = await ConversationRegistry.load(storageFile);
    assert.equal(restored.get("c1"), undefined);
    assert.equal(restored.defaultConversationId(), "c2");
    await assert.rejects(restored.remove("c2"), /最后一个会话不能归档/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
