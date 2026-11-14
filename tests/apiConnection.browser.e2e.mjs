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
let preset = { id: "paper", note: "我的中转", endpoint: "https://fake.test/relay", hasKey: true, keyHint: "sk-abcd", model: "", format: "openai" };
const calls = [];
let workspaceConfig = { workingDirectory: "C:\\Users\\Example\\MianWorkspace", sandbox: "workspace-write", model: "test", channel: { kind: "codex" } };
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
app.get("/api/config", (_req, res) => res.json(workspaceConfig));
app.put("/api/config", (req, res) => {
  if (req.body.workingDirectory === "C:\\Mian" || req.body.workingDirectory.startsWith("C:\\Mian\\")) {
    res.status(400).json({ error: "工作目錄不能設在 Mian 專案裡面，請換一個資料夾。" }); return;
  }
  workspaceConfig = req.body; res.json(workspaceConfig);
});
app.get("/api/api-presets", (_req, res) => res.json({ presets: [preset], activeId: channel.kind === "api" ? "paper" : null }));
app.post("/api/api-models", (_req, res) => res.status(400).json({ error: "Model listing is unavailable." }));
app.post("/api/api-presets", (req, res) => {
  const { key, ...fields } = req.body;
  assert.equal(key, "");
  preset = { ...fields, hasKey: true, keyHint: "sk-abcd" };
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
  const input = (selector, value) => evaluate(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const turnPaper = async key => {
    await evaluate(`document.activeElement.blur(); document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`);
  };
  const currentPaper = ".api-sheet:not([inert])";
  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await navigate("/connections");
  await waitFor(() => evaluate("Boolean(document.querySelector('#apiTie'))"), "Connections did not render");
  await evaluate("document.querySelector('#apiTie').click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.api-sheet .js-use'))"), "Saved API paper did not open");
  assert.equal(await evaluate("document.querySelector('.api-sheet .js-key').value"), "");
  assert.equal(await evaluate("document.querySelector('.api-sheet .js-key').placeholder"), "sk-abcd");
  assert.equal(await evaluate("document.querySelector('.api-sheet .js-toggle')"), null);
  await evaluate("document.querySelector('.api-sheet .js-model').click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('input.js-model'))"), "MODEL did not allow manual input after listing failed");
  await evaluate(`(() => {
    const input = document.querySelector('input.js-model');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'manual/deepseek-model');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await input(`${currentPaper} .js-note`, "原纸片的草稿");
  await input(`${currentPaper} .js-endpoint`, "https://draft.test/custom");
  await input(`${currentPaper} .js-key`, "key-only-in-memory");
  await waitFor(() => evaluate(`Boolean(document.querySelector('${currentPaper} .js-toggle'))`), "New Key did not reveal SHOW/HIDE");
  await evaluate(`document.querySelector('${currentPaper} .js-toggle').click()`);
  assert.equal(await evaluate(`document.querySelector('${currentPaper} .js-key').type`), "text");
  await input(`${currentPaper} .js-key`, "");
  await waitFor(() => evaluate(`!document.querySelector('${currentPaper} .js-toggle')`), "Empty Key still has SHOW/HIDE");
  await input(`${currentPaper} .js-key`, "key-only-in-memory");
  await turnPaper("ArrowRight");
  await waitFor(() => evaluate(`Boolean(document.querySelector('${currentPaper} .js-add'))`), "Plus paper did not become current");
  await evaluate(`document.querySelector('${currentPaper} .js-add').click()`);
  await input(`${currentPaper} .js-note`, "未保存的新纸");
  await input(`${currentPaper} .js-endpoint`, "https://draft.test/relay");
  await input(`${currentPaper} .js-key`, "second-key-only-in-memory");
  await evaluate(`document.querySelector('${currentPaper} .js-model').click()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('${currentPaper} input.js-model'))`), "New paper did not allow manual model input");
  await input(`${currentPaper} input.js-model`, "unsaved-model");
  const cached = await evaluate("sessionStorage.getItem('mian.api-drafts.v1')");
  assert.equal(JSON.parse(cached).length, 2);
  assert.doesNotMatch(cached, /key-only-in-memory|"key"/);
  await call("Page.reload");
  await waitFor(() => evaluate(`document.querySelector('#apiStack')?.classList.contains('is-visible') && document.querySelector('${currentPaper} .js-note')?.value === '未保存的新纸'`), "Reload did not reopen the original draft paper");
  assert.equal(await evaluate(`document.querySelector('${currentPaper}').dataset.i`), "1");
  assert.equal(await evaluate(`document.querySelector('${currentPaper} .js-endpoint').value`), "https://draft.test/relay");
  assert.equal(await evaluate(`document.querySelector('${currentPaper} .js-key').value`), "");
  await waitFor(() => evaluate(`document.querySelector('${currentPaper} .js-model')?.textContent.includes('unsaved-model')`), "Draft model was not restored");
  await turnPaper("ArrowLeft");
  await waitFor(() => evaluate(`document.querySelector('${currentPaper} .js-note')?.value === '原纸片的草稿'`), "Saved paper edits were not restored");
  assert.equal(await evaluate(`document.querySelector('${currentPaper} .js-endpoint').value`), "https://draft.test/custom");
  assert.equal(await evaluate(`document.querySelector('${currentPaper} .js-key').value`), "");
  await input(`${currentPaper} .js-note`, "我的中转");
  await input(`${currentPaper} .js-endpoint`, "https://fake.test/relay");
  await evaluate("document.querySelector('.api-sheet .js-save').click()");
  await waitFor(() => preset.model === "manual/deepseek-model", "Manual model was not saved");
  assert.equal(preset.format, "openai");
  assert.equal(await evaluate("JSON.parse(sessionStorage.getItem('mian.api-drafts.v1')).length"), 1);
  await turnPaper("ArrowRight");
  await waitFor(() => evaluate(`document.querySelector('${currentPaper} .js-note')?.value === '未保存的新纸'`), "Remaining draft did not survive saving another paper");
  await evaluate(`document.querySelector('${currentPaper} .js-del').click()`);
  assert.equal(await evaluate("JSON.parse(sessionStorage.getItem('mian.api-drafts.v1')).length"), 1);
  await evaluate(`document.querySelector('${currentPaper} .js-del').click()`);
  await waitFor(() => evaluate("sessionStorage.getItem('mian.api-drafts.v1') === null"), "Deleting the last draft did not clear its cache");
  await call("Page.reload");
  await waitFor(() => evaluate("Boolean(document.querySelector('#apiTie'))"), "Connections did not reload after deletion");
  await evaluate("document.querySelector('#apiTie').click()");
  await waitFor(() => evaluate("document.querySelectorAll('.api-sheet').length === 2"), "Deleted draft was restored unexpectedly");
  await turnPaper("ArrowLeft");
  await waitFor(() => evaluate(`Boolean(document.querySelector('${currentPaper} .js-use'))`), "Saved paper did not restore after clearing drafts");
  await evaluate("document.querySelector('.api-sheet .js-use').click()");
  await waitFor(() => channel.kind === "api", "USE did not select the API channel");
  await navigate("/");
  await waitFor(() => evaluate("document.querySelector('.capsule-text')?.textContent === '我的中转'"), "Home did not show the current API note");
  await navigate("/chat");
  await waitFor(() => evaluate("document.querySelector('#archiveRibbonTitle')?.textContent === '对话标题'"), "Chat title included the channel or lost its conversation title");
  const publishReply = (event) => {
    for (const socket of sockets.clients) socket.send(JSON.stringify({ kind: "event", streamId: "api-browser", seq: ++seq, event: { conversationId: "c1", ...event } }));
  };
  publishReply({ type: "turn-started", turnId: "api-protocol", format: "api" });
  publishReply({ type: "assistant-delta", turnId: "api-protocol", format: "api", delta: "<mian-think" });
  await sleep(120);
  assert.doesNotMatch(await evaluate("document.querySelector('.archive-msg[data-role=assistant]')?.textContent ?? ''"), /mian-/);
  publishReply({ type: "assistant-delta", turnId: "api-protocol", format: "api", delta: "ing>想。</mian-thinking><mian-bubble>**好。**</mian-bubble><mian-bubble>在。</mian-bubble>" });
  publishReply({ type: "turn-completed", turnId: "api-protocol", format: "api", status: "completed" });
  await waitFor(() => evaluate("document.querySelectorAll('.archive-msg[data-role=assistant] .archive-bubble').length === 2 && [...document.querySelectorAll('.archive-bubble')].at(-1)?.textContent === '在。'"), "API public bubbles did not play in order");
  assert.equal(await evaluate("document.querySelector('.archive-thought').textContent"), "想。");
  assert.equal(await evaluate("document.querySelector('.reply-markdown strong').textContent"), "好。");
  publishReply({ type: "turn-started", turnId: "api-fallback", format: "api" });
  publishReply({ type: "assistant-delta", turnId: "api-fallback", format: "api", delta: "普通答复。" });
  publishReply({ type: "turn-completed", turnId: "api-fallback", format: "api", status: "completed" });
  await waitFor(() => evaluate("[...document.querySelectorAll('.archive-msg[data-role=assistant]')].at(-1)?.querySelector('.archive-bubble')?.textContent === '普通答复。'"), "Untagged API reply missing");
  assert.equal(await evaluate("[...document.querySelectorAll('.archive-msg[data-role=assistant]')].at(-1).querySelector('.archive-module')"), null);
  await navigate("/connections");
  await waitFor(() => evaluate("Boolean(document.querySelector('#codexTie'))"), "Connections did not reopen");
  await evaluate("document.querySelector('#codexTie').click()");
  await evaluate("document.querySelector('[data-p=codex] .cover-giant').click()");
  await waitFor(() => channel.kind === "codex", "Codex cover did not switch the current channel");
  await evaluate("document.querySelector('.cover-workspace').click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.workspace-editor textarea'))"), "Workspace editor did not open");
  assert.equal(await evaluate("document.querySelector('.workspace-editor textarea').value"), workspaceConfig.workingDirectory);
  await input(".workspace-editor textarea", "C:\\Mian\\server");
  await evaluate("document.querySelector('.workspace-editor button').click()");
  await waitFor(() => evaluate("document.querySelector('.mail-title')?.textContent === '目錄不能用'"), "Project directory rejection notice missing");
  assert.equal(await evaluate("document.querySelector('.mail-reason').textContent"), "工作目錄不能設在 Mian 專案裡面，請換一個資料夾。");
  assert.equal(workspaceConfig.workingDirectory, "C:\\Users\\Example\\MianWorkspace");
  await input(".workspace-editor textarea", "C:\\Users\\Example\\Writing");
  await evaluate("document.querySelector('.workspace-editor button').click()");
  await waitFor(() => workspaceConfig.workingDirectory.endsWith("Writing"), "Workspace did not save");
  await navigate("/");
  await waitFor(() => evaluate("document.querySelector('.capsule-text')?.textContent === 'CODEX'"), "Home did not switch back to CODEX");
  await navigate("/chat");
  await waitFor(() => evaluate("Boolean(document.querySelector('.archive-chat'))"), "Chat did not reopen for tool ordering");
  await evaluate(`window.toolOrderFrames = []; window.toolOrderObserver = new MutationObserver(() => {
    const reply = [...document.querySelectorAll('.archive-msg[data-role=assistant]')].at(-1);
    if (!reply) return;
    window.toolOrderFrames.push({ thought: reply.querySelector('.archive-thought')?.textContent, preface: reply.querySelector('.archive-bubble')?.textContent, ids: [...reply.querySelectorAll('[data-tool-id]')].map(el => el.dataset.toolId), first: reply.querySelector('[data-tool-id="ordered-first"] .archive-tool-output')?.textContent });
  }); window.toolOrderObserver.observe(document.querySelector('.archive-chat'), { childList: true, subtree: true, characterData: true });`);
  publishReply({ type: "turn-started", turnId: "tool-order" });
  publishReply({ type: "assistant-delta", turnId: "tool-order", delta: "<mian-thinking>想好。</mian-thinking><mian-pre-tool><mian-bubble>先看。</mian-bubble></mian-pre-tool>" });
  publishReply({ type: "tool", turnId: "tool-order", tool: { id: "ordered-first", name: "read_file", kind: "read_file", state: "success", detail: "第一步。", result: "第一步。" } });
  publishReply({ type: "tool", turnId: "tool-order", tool: { id: "ordered-second", name: "read_file", kind: "read_file", state: "success", detail: "第二步。", result: "第二步。" } });
  publishReply({ type: "assistant-delta", turnId: "tool-order", delta: "<mian-bubble>好了。</mian-bubble>" });
  publishReply({ type: "turn-completed", turnId: "tool-order", status: "completed" });
  await waitFor(() => evaluate("[...document.querySelectorAll('.archive-msg[data-role=assistant]')].at(-1)?.querySelectorAll('.archive-bubble')[1]?.textContent === '好了。'"), "Queued tool reply did not finish");
  const orderFrames = await evaluate("window.toolOrderObserver.disconnect(); window.toolOrderFrames");
  assert.ok(orderFrames.some(frame => frame.ids.includes("ordered-second")));
  for (const frame of orderFrames) {
    if (frame.ids.includes("ordered-first")) { assert.equal(frame.thought, "想好。"); assert.equal(frame.preface, "先看。"); }
    if (frame.ids.includes("ordered-second")) assert.equal(frame.first, "第一步。");
  }
  assert.equal(calls.find(call => call.path === "/api/api-models").body.key, "");
  assert.deepEqual(errors, []);
  console.log("PASS API draft reload, paper position, key exclusion, save/delete cleanup, manual model, USE and Codex selection (390x844).");
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
