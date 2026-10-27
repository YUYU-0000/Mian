import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveAvailableConversationId,
  upsertConversation,
} from "../client/src/conversationState.ts";
import type { ConversationRecord } from "../client/src/types.ts";

const record = (conversationId: string, title: string): ConversationRecord => ({
  conversationId,
  threadId: null,
  parentConversationId: null,
  rootNumber: 2,
  branchPath: [],
  branchCounter: 0,
  abbr: "C-02",
  title,
  frontName: "Mian",
  image: "",
  pinned: false,
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

test("replayed conversation snapshots replace uncached usage without adding it", () => {
  const snapshot = {
    ...record("c-02", "usage"),
    totalTokens: 36_490,
    uncachedTotalTokens: 1_590,
  };

  const once = upsertConversation([], snapshot);
  const replayed = upsertConversation(once, { ...snapshot });

  assert.equal(replayed.length, 1);
  assert.equal(replayed[0].uncachedTotalTokens, 1_590);
});

test("HTTP creation and the earlier WebSocket update cannot duplicate a conversation", () => {
  const fromSocket = record("fresh", "socket");
  const fromHttp = { ...fromSocket, title: "http" };
  const afterSocket = upsertConversation([], fromSocket);
  const afterHttp = upsertConversation(afterSocket, fromHttp);

  assert.equal(afterHttp.length, 1);
  assert.equal(afterHttp[0].conversationId, "fresh");
  assert.equal(afterHttp[0].title, "http");
});

test("conversation fallback prefers an available ID without assuming C-01", () => {
  const conversations = [record("c-02", "two"), record("c-03", "three")];
  assert.equal(
    resolveAvailableConversationId(conversations, "c-03", "c-01"),
    "c-03",
  );
  assert.equal(
    resolveAvailableConversationId(conversations, "missing", "c-01"),
    "c-02",
  );
  assert.equal(resolveAvailableConversationId([], undefined, "c-01"), "c-01");
});
