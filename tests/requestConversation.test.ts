import assert from "node:assert/strict";
import test from "node:test";
import { requestConversationId } from "../server/src/requestConversation.ts";

test("request conversation routing preserves explicit IDs", () => {
  assert.equal(requestConversationId({ conversationId: "c-02" }, "c-01"), "c-02");
});

test("request conversation routing keeps the legacy default fallback", () => {
  assert.equal(requestConversationId({}, "c-01"), "c-01");
  assert.equal(requestConversationId(null, "c-01"), "c-01");
});

test("request conversation routing does not silently replace an explicit empty ID", () => {
  assert.equal(requestConversationId({ conversationId: "" }, "c-01"), "");
});
