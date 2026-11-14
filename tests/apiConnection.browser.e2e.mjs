import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";

const workspace = process.cwd();
const profile = await mkdtemp(path.join(workspace, ".tmp-api-browser-"));
const conversation = {
  conversationId: "c1", threadId: null, parentConversationId: null,
  rootNumber: 1, branchPath: [], branchCounter: 0, abbr: "C-01",
  title: "对话标题", frontName: "Mian", image: "", pinned: false,
  model: null, reasoningEffort: null, totalTokens: null, uncachedTotalTokens: null,
  lastActivityAt: null, lastMessage: null, collaborationMode: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};
let channel = { kind: "codex", name: "CODEX" };
let preset = { id: "paper", note: "我的中转", endpoint: "https://fake.test/relay", hasKey: true, model: "", format: "openai" };
const calls = [];
let seq = 0;
const app = express();
const server = createServer(app);
const sockets = new WebSocketServer({ server, path: "/ws" });
const publishChannel = () => {
  for (const socket of sockets.clients) socket.send(JSON.stringify({ kind: "event", streamId: "api-browser", seq: ++seq, event: { type: "channel", channel } }));
};
sockets.on("connection", socket => socket.send(JSON.stringify({
  kind: "session", streamId: "api-browser", seq, reset: true, activeTurnId: null,
  threadId: null, activeTurns: {}, conversations: [conversation], defaultConversationId: "c1", channel,
})));
app.use(express.json());
app.use((req, _res, next) => { if (req.path.startsWith("/api/")) calls.push({ path: req.path, body: req.body }); next(); });
app.get("/api/conversations", (_req, res) => res.json({ conversations: [conversation], defaultConversationId: "c1" }));
app.get("/api/api-presets", (_req, res) => res.json({ presets: [preset], activeId: channel.kind === "api" ? "paper" : null }));
app.post("/api/api-models", (_req, res) => res.status(400).json({ error: "Model listing is unavailable." }));
app.post("/api/api-presets", (req, res) => {
  const { key, ...fields } = req.body;
  assert.equal(key, "");
  preset = { ...fields, hasKey: true };
  res.json(preset);
});
app.post("/api/api-presets/paper/use", (_req, res) => {
  channel = { kind: "api", presetId: "paper", name: preset.note };
  publishChannel(); res.json({ ok: true });
});
app.get("/api/subscriptions/codex", (_req, res) => res.json({ loggedIn: true, account: "fixture", plan: "plus", model: "test" }));
app.get("/api/subscriptions/codex/quota", (_req, res) => res.json({ left: 50, resetAt: "11月20日 17:10" }));
app.post("/api/subscriptions/codex/use", (_req, res) => {
  channel = { kind: "codex", name: "CODEX" }; publishChannel(); res.json({ ok: true });
});
app.use(express.static(path.join(workspace, "client/dist")));
app.get("*splat", (_req, res) => res.sendFile(path.join(workspace, "client/dist/index.html")));
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const debugPort = 9348;
const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  "--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--disable-background-networking", "about:blank",
], { windowsHide: true, stdio: "ignore" });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (read, description) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(description);
};
let cdp;
try {
  const targets = await waitFor(async () => {
    try { return await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); }
    catch { return null; }
  }, "Edge did not start");
  cdp = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await once(cdp, "open");
  let nextId = 0;
  const pending = new Map();
  const errors = [];
  cdp.on("message", raw => {
    const message = JSON.parse(String(raw));
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject });
    cdp.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description);
    return result.result.value;
  };
  const navigate = route => call("Page.navigate", { url: base + route });
  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await navigate("/connections");
  await waitFor(() => evaluate("Boolean(document.querySelector('#apiTie'))"), "Connections did not render");
  await evaluate("document.querySelector('#apiTie').click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.api-sheet .js-use'))"), "Saved API paper did not open");
  assert.equal(await evaluate("document.querySelector('.api-sheet .js-key').value"), "");
  await evaluate("document.querySelector('.api-sheet .js-model').click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('input.js-model'))"), "MODEL did not allow manual input after listing failed");
  await evaluate(`(() => {
    const input = document.querySelector('input.js-model');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'manual/deepseek-model');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate("document.querySelector('.api-sheet .js-save').click()");
  await waitFor(() => preset.model === "manual/deepseek-model", "Manual model was not saved");
  assert.equal(preset.format, "openai");
  await evaluate("document.querySelector('.api-sheet .js-use').click()");
  await waitFor(() => channel.kind === "api", "USE did not select the API channel");
  await navigate("/");
  await waitFor(() => evaluate("document.querySelector('.capsule-text')?.textContent === '我的中转'"), "Home did not show the current API note");
  await navigate("/chat");
  await waitFor(() => evaluate("document.querySelector('#archiveRibbonTitle')?.textContent === '我的中转 · 对话标题'"), "Chat did not show the channel and preserve its title");
  await navigate("/connections");
  await waitFor(() => evaluate("Boolean(document.querySelector('#codexTie'))"), "Connections did not reopen");
  await evaluate("document.querySelector('#codexTie').click()");
  await evaluate("document.querySelector('[data-p=codex] .cover-giant').click()");
  await waitFor(() => channel.kind === "codex", "Codex cover did not switch the current channel");
  await navigate("/");
  await waitFor(() => evaluate("document.querySelector('.capsule-text')?.textContent === 'CODEX'"), "Home did not switch back to CODEX");
  assert.equal(calls.find(call => call.path === "/api/api-models").body.key, "");
  assert.deepEqual(errors, []);
  console.log("PASS API paper manual model, saved-key handling, USE, channel labels, and Codex selection (390x844).");
} finally {
  cdp?.close();
  const exited = once(browser, "exit");
  spawnSync("taskkill.exe", ["/PID", String(browser.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  await exited;
  for (const socket of sockets.clients) socket.terminate();
  await new Promise(resolve => sockets.close(resolve));
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  assert.equal(path.dirname(profile), workspace);
  await rm(profile, { recursive: true });
}
