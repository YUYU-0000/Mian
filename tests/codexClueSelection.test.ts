import assert from "node:assert/strict";
import test from "node:test";
import { CodexClueSelection } from "../server/src/codexClueSelection.ts";
import type { AppConfig } from "../server/src/types.ts";
import { CLUE_SELECTION_INSTRUCTION } from "../server/src/clueSelection.ts";
import { MIAN_TURN_CONTEXT_KEY } from "../server/src/publicReplyProtocol.ts";

const config: AppConfig = {
  workingDirectory: "C:\\workspace",
  sandbox: "workspace-write",
  model: "same-model",
  channel: { kind: "codex" },
};

test("Codex selection uses an ephemeral system prompt and consumes its own notifications", async () => {
  const selector = new CodexClueSelection();
  const requests: { method: string; params: any }[] = [];
  const request = async (method: string, params: any) => {
    requests.push({ method, params });
    if (method === "thread/start") return { thread: { id: "selection" } };
    if (method === "turn/start") {
      queueMicrotask(() => {
        assert.equal(
          selector.receive("item/agentMessage/delta", {
            threadId: "main",
            delta: "公開回覆",
          }),
          false,
        );
        assert.equal(
          selector.receive("item/agentMessage/delta", {
            threadId: "selection",
            delta: "id-1,",
          }),
          true,
        );
        selector.receive("item/completed", {
          threadId: "selection",
          item: { type: "agentMessage", text: "id-1,id-2" },
        });
        selector.receive("turn/completed", {
          threadId: "selection",
          turn: { status: "completed" },
        });
      });
    }
    return {};
  };
  const messages = [{ role: "user" as const, content: "你好" }];
  assert.equal(
    await selector.select(request, config, "只回 id", messages),
    "id-1,id-2",
  );
  assert.equal(requests[0].params.ephemeral, true);
  assert.equal(requests[0].params.model, config.model);
  assert.equal(requests[0].params.baseInstructions, CLUE_SELECTION_INSTRUCTION);
  assert.equal(requests[1].params.additionalContext[MIAN_TURN_CONTEXT_KEY].value, "只回 id");
  assert.deepEqual(JSON.parse(requests[1].params.input[0].text), messages);
  assert.equal(requests.at(-1)?.method, "thread/unsubscribe");
});

test("a failed or disconnected selector rejects and releases the temporary thread", async () => {
  for (const disconnected of [false, true]) {
    const selector = new CodexClueSelection();
    let released = false;
    const request = async (method: string) => {
      if (method === "thread/start") return { thread: { id: "selection" } };
      if (method === "turn/start")
        queueMicrotask(() => {
          if (disconnected) selector.close(new Error("closed"));
          else
            selector.receive("turn/completed", {
              threadId: "selection",
              turn: { status: "failed", error: { message: "failed" } },
            });
        });
      if (method === "thread/unsubscribe") released = true;
      return {};
    };
    await assert.rejects(
      selector.select(request, config, "只回 id", []),
      /closed|failed/,
    );
    assert.equal(released, true);
  }
});
