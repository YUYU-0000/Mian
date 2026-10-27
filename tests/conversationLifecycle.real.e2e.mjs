import assert from "node:assert/strict";
import { WebSocket } from "ws";

const baseUrl = process.env.MIAN_E2E_URL || "http://127.0.0.1:8787";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function jsonRequest(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

async function activeTurns() {
  return new Promise((resolve, reject) => {
    const wsUrl = baseUrl.replace(/^http/, "ws") + "/ws";
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("WebSocket session timed out"));
    }, 5_000);
    socket.once("error", reject);
    socket.on("message", (raw) => {
      const value = JSON.parse(String(raw));
      if (value.kind !== "session") return;
      clearTimeout(timer);
      socket.close();
      resolve(value.activeTurns || {});
    });
  });
}

async function waitForIdle(conversationId, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!(conversationId in (await activeTurns()))) return;
    await sleep(100);
  }
  throw new Error(`${conversationId} did not become idle`);
}

const connection = await jsonRequest("/api/connection/test", { method: "POST" });
assert.equal(connection.status, 200);

const branchResult = await jsonRequest("/api/conversations/c1/fork", {
  method: "POST",
});
assert.equal(branchResult.status, 201);
const branch = branchResult.body.conversation;
assert.equal(branch.parentConversationId, "c1");
assert.ok(branch.threadId);

const branchTurn = await jsonRequest("/api/turn", {
  method: "POST",
  body: JSON.stringify({
    conversationId: branch.conversationId,
    text: "[REAL BRANCH LIFECYCLE TEST] 请写一段较长但无需工具的回复，用于验证活动分支不能被归档。",
  }),
});
assert.equal(branchTurn.status, 200);
assert.equal(branchTurn.body.conversationId, branch.conversationId);

const rejectedArchive = await jsonRequest(
  `/api/conversations/${encodeURIComponent(branch.conversationId)}`,
  { method: "DELETE" },
);
assert.equal(rejectedArchive.status, 409);
let listing = await jsonRequest("/api/conversations");
assert.ok(
  listing.body.conversations.some(
    (item) => item.conversationId === branch.conversationId,
  ),
  "failed archive removed the branch",
);

await waitForIdle(branch.conversationId);
const archivedBranch = await jsonRequest(
  `/api/conversations/${encodeURIComponent(branch.conversationId)}`,
  { method: "DELETE" },
);
assert.equal(archivedBranch.status, 204);
listing = await jsonRequest("/api/conversations");
assert.equal(
  listing.body.conversations.some(
    (item) => item.conversationId === branch.conversationId,
  ),
  false,
);

const rootResult = await jsonRequest("/api/conversations", { method: "POST" });
assert.equal(rootResult.status, 201);
const root = rootResult.body.conversation;
const rootTurn = await jsonRequest("/api/turn", {
  method: "POST",
  body: JSON.stringify({
    conversationId: root.conversationId,
    text: "[REAL INTERRUPT ROUTING TEST] 请生成一段足够长的回复，等待我主动停止。",
  }),
});
assert.equal(rootTurn.status, 200);
const activeAtTurnResponse = await activeTurns();
const interrupt = await jsonRequest(
  `/api/turn/${encodeURIComponent(rootTurn.body.turnId)}/interrupt`,
  {
    method: "POST",
    body: JSON.stringify({ conversationId: root.conversationId }),
  },
);
assert.equal(
  interrupt.status,
  200,
  `immediate interrupt failed: ${JSON.stringify({ interrupt: interrupt.body, rootTurn: rootTurn.body, activeAtTurnResponse })}`,
);
await waitForIdle(root.conversationId);
const archivedRoot = await jsonRequest(
  `/api/conversations/${encodeURIComponent(root.conversationId)}`,
  { method: "DELETE" },
);
assert.equal(archivedRoot.status, 204);

console.log(
  JSON.stringify(
    {
      fork: {
        conversationId: branch.conversationId,
        parentConversationId: branch.parentConversationId,
        threadId: branch.threadId,
        activeArchiveStatus: rejectedArchive.status,
        finalArchiveStatus: archivedBranch.status,
      },
  interrupt: {
        conversationId: root.conversationId,
        threadId: root.threadId,
        turnId: rootTurn.body.turnId,
        activeAtTurnResponse,
        interruptStatus: interrupt.status,
        finalArchiveStatus: archivedRoot.status,
      },
    },
    null,
    2,
  ),
);
