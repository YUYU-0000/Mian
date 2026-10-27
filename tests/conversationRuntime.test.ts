import assert from "node:assert/strict";
import test from "node:test";
import { ConversationRuntimeRegistry } from "../server/src/conversationRuntime.ts";

test("thread and turn ownership cannot cross conversation boundaries", () => {
  const registry = new ConversationRuntimeRegistry();
  registry.register("c1", "thread-1");
  registry.register("c2", "thread-2");
  registry.setActiveTurn("c1", "turn-1");

  assert.throws(
    () => registry.setThread("c2", "thread-1"),
    /already belongs to c1/,
  );
  assert.throws(
    () => registry.setActiveTurn("c2", "turn-1"),
    /already belongs to c1/,
  );
  assert.equal(registry.conversationForThread("thread-1"), "c1");
  assert.equal(registry.conversationForTurn("turn-1"), "c1");
});

test("removing one runtime leaves every other conversation intact", () => {
  const registry = new ConversationRuntimeRegistry();
  registry.register("c1", "thread-1");
  registry.register("c2", "thread-2");
  registry.setActiveTurn("c1", "turn-1");
  registry.setActiveTurn("c2", "turn-2");
  registry.remove("c2");

  assert.deepEqual(registry.getActiveTurns(), { c1: "turn-1" });
  assert.equal(registry.conversationForThread("thread-1"), "c1");
  assert.equal(registry.conversationForTurn("turn-1"), "c1");
  assert.throws(() => registry.require("c2"), /Unknown conversation/);
});
