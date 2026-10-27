import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  displayConversationValue,
  formatLastActivity,
  formatLastMessage,
  formatTokenUsage,
} from "../client/src/conversationDisplay.ts";
import { normalizeConversationRecord } from "../server/src/conversations.ts";

test("legacy conversation records migrate without fabricated runtime values", () => {
  const migrated = normalizeConversationRecord({
    conversationId: "c1",
    threadId: "thread-legacy",
    title: "ARCHIVE CHAT",
    updatedAt: "2026-08-19T08:00:00.000Z",
  });

  assert.ok(migrated);
  assert.equal(migrated.threadId, "thread-legacy");
  assert.equal(migrated.model, null);
  assert.equal(migrated.reasoningEffort, null);
  assert.equal(migrated.totalTokens, null);
  assert.equal(migrated.uncachedTotalTokens, null);
  assert.equal(migrated.lastActivityAt, null);
  assert.equal(migrated.lastMessage, null);
  assert.equal(migrated.collaborationMode, null);
});

test("ticket metadata formatting uses real values and honest empty states", () => {
  assert.equal(displayConversationValue(null), "NONE");
  assert.equal(formatTokenUsage(null), "—");
  assert.equal(formatTokenUsage(999), "999");
  assert.equal(formatTokenUsage(128_400), "128.4K");
  assert.equal(formatLastMessage(null), "还没有留下第一句话。");
  assert.equal(formatLastMessage("  最后一条真实消息  "), "最后一条真实消息");
  assert.equal(
    formatLastActivity(
      "2026-08-19T09:07:00-07:00",
      new Date("2026-08-19T12:00:00-07:00"),
    ),
    "Today 09:07",
  );
  assert.equal(
    formatLastActivity(
      "2026-08-16T23:18:00-07:00",
      new Date("2026-08-19T12:00:00-07:00"),
    ),
    "2026.08.16",
  );
});

test("ticket keeps one Token Used row backed by uncached cumulative usage", async () => {
  const source = await readFile(
    new URL("../client/src/components/TicketDrawer.tsx", import.meta.url),
    "utf8",
  );

  assert.equal(source.match(/Token Used :/g)?.length, 1);
  assert.match(source, /formatTokenUsage\(preview\.uncachedTotalTokens\)/);
  assert.doesNotMatch(source, /formatTokenUsage\(preview\.totalTokens\)/);
  assert.doesNotMatch(source, />\s*(?:Cached|Fresh|Full|Thread Total)\s*</i);
});
