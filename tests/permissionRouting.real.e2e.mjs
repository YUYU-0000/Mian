import assert from "node:assert/strict";
import { WebSocket } from "ws";

const baseUrl = process.env.MIAN_E2E_URL || "http://127.0.0.1:8787";
const wsUrl = baseUrl.replace(/^http/, "ws") + "/ws";
const list = await (await fetch(`${baseUrl}/api/conversations`)).json();
const owner = list.conversations.find((item) => item.abbr === "C-04");
const other = list.conversations.find((item) => item.abbr === "C-05");
assert.ok(owner && other, "C-04 and C-05 are required for permission routing E2E");

await fetch(`${baseUrl}/api/connection/test`, { method: "POST" });
const socket = new WebSocket(wsUrl);
const events = [];
let resolveApproval;
let resolveCompleted;
const approval = new Promise((resolve) => (resolveApproval = resolve));
const completed = new Promise((resolve) => (resolveCompleted = resolve));
socket.on("message", (raw) => {
  const value = JSON.parse(String(raw));
  if (value.kind !== "event") return;
  events.push(value);
  if (
    value.event.type === "approval" &&
    value.event.conversationId === owner.conversationId
  )
    resolveApproval(value.event);
  if (
    value.event.type === "turn-completed" &&
    value.event.conversationId === owner.conversationId
  )
    resolveCompleted(value.event);
});
await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});

const turnResponse = await fetch(`${baseUrl}/api/turn`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    conversationId: owner.conversationId,
    text: "请使用命令执行工具尝试在 C:\\Windows\\Temp 中创建 permission-e2e.tmp。必须先请求权限，不要改用别的方法。",
  }),
});
assert.equal(turnResponse.status, 200);
const turn = await turnResponse.json();

const approvalEvent = await Promise.race([
  approval,
  completed.then(() => {
    throw new Error("turn completed without producing a real permission request");
  }),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("permission request timed out")), 60_000),
  ),
]);
assert.equal(approvalEvent.turnId, turn.turnId);
assert.equal(approvalEvent.conversationId, owner.conversationId);

const wrongOwner = await fetch(
  `${baseUrl}/api/approval/${encodeURIComponent(approvalEvent.approval.requestId)}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allow: false, conversationId: other.conversationId }),
  },
);
assert.equal(wrongOwner.status, 404);

const decline = await fetch(
  `${baseUrl}/api/approval/${encodeURIComponent(approvalEvent.approval.requestId)}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allow: false, conversationId: owner.conversationId }),
  },
);
assert.equal(decline.status, 200);

const completion = await Promise.race([
  completed,
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("declined turn did not finish")), 60_000),
  ),
]);
assert.equal(completion.conversationId, owner.conversationId);
assert.equal(
  events.some(
    (entry) =>
      entry.event.type === "approval" &&
      entry.event.conversationId === other.conversationId,
  ),
  false,
);
socket.close();

console.log(
  JSON.stringify(
    {
      owner: owner.conversationId,
      otherConversationRejected: other.conversationId,
      turnId: turn.turnId,
      approvalRequestId: approvalEvent.approval.requestId,
      wrongOwnerStatus: wrongOwner.status,
      correctOwnerStatus: decline.status,
      completionStatus: completion.status,
    },
    null,
    2,
  ),
);
