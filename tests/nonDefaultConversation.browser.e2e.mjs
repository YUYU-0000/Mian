import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "client", "dist");
const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const conversation = {
  conversationId: "c02-e2e",
  threadId: null,
  parentConversationId: null,
  rootNumber: 2,
  branchPath: [],
  branchCounter: 0,
  abbr: "C-02",
  title: "E2E C-02",
  frontName: "Mian",
  image: "",
  pinned: false,
  model: null,
  reasoningEffort: null,
  totalTokens: null,
  uncachedTotalTokens: null,
  lastActivityAt: null,
  lastMessage: "第二条未回复消息",
  collaborationMode: null,
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
};
const c01 = { ...conversation, conversationId: "c1", rootNumber: 1, abbr: "C-01" };
const history = [
  {
    role: "assistant",
    replyGroupId: "old-turn",
    time: "08:00",
    thinking: "fixture thinking",
    activeReasoningItemIds: [],
    raw: "<mian-bubble>旧回复</mian-bubble>",
    preToolBubbles: ["fixture pre-tool"],
    preToolBubbleIds: ["old-pre-tool"],
    preToolBubbleComplete: [true],
    preToolComplete: true,
    bubbles: ["旧回复"],
    bubbleIds: ["old-bubble"],
    bubbleComplete: [true],
    tools: [
      {
        id: "fixture-tool",
        name: "read_file",
        detail: "",
        state: "success",
        summary: "读取测试内容",
        result: "fixture result",
      },
    ],
    approvals: [],
    status: "completed",
  },
  {
    role: "user",
    groupId: "closed-one",
    pending: false,
    time: "09:00",
    records: [
      { messageId: "message-one", text: "第一条未回复消息", time: "09:00" },
    ],
  },
  {
    role: "user",
    groupId: "closed-two",
    pending: false,
    time: "09:01",
    records: [
      { messageId: "message-two", text: "第二条未回复消息", time: "09:01" },
    ],
  },
];

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
};

async function staticBody(urlPath) {
  const relative = urlPath === "/" || urlPath === "/chat" ? "index.html" : urlPath.slice(1);
  const candidate = path.resolve(dist, relative);
  if (!candidate.startsWith(`${dist}${path.sep}`) && candidate !== path.join(dist, "index.html"))
    return null;
  try {
    if (!(await stat(candidate)).isFile()) return null;
    return { body: await readFile(candidate), file: candidate };
  } catch {
    return null;
  }
}

async function startHarness() {
  const requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    let body = "";
    for await (const chunk of request) body += chunk;
    if (url.pathname.startsWith("/api/")) requests.push({ method: request.method, path: url.pathname, body });
    if (url.pathname === "/api/conversations") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ defaultConversationId: "c1", conversations: [c01, conversation] }));
      return;
    }
    if (url.pathname === "/api/turn" && request.method === "POST") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ turnId: "turn-e2e" }));
      return;
    }
    if (url.pathname.includes("/activity")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ conversation }));
      return;
    }
    if (url.pathname.includes("/interrupt")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    const file = await staticBody(url.pathname);
    if (!file) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }
    response.setHeader("content-type", contentTypes[path.extname(file.file)] ?? "application/octet-stream");
    response.end(file.body);
  });
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({
      kind: "session",
      streamId: "e2e-stream",
      seq: 0,
      reset: false,
      defaultConversationId: "c1",
      activeTurnId: null,
      activeTurns: {},
      conversations: [c01, conversation],
      connectionStatus: { state: "ready", message: "READY" },
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    requests,
    port: server.address().port,
    close: async () => {
      for (const socket of wss.clients) socket.close();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function waitForJson(url, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let id = 0;
  const pending = new Map();
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  return {
    call(method, params = {}) {
      const requestId = ++id;
      socket.send(JSON.stringify({ id: requestId, method, params }));
      return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
    },
    close() { socket.close(); },
  };
}

const harness = await startHarness();
const profile = await mkdtemp(path.join(tmpdir(), "mian-edge-e2e-"));
const debugPort = 9327;
const browser = spawn(edge, [
  "--headless=new",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--disable-background-networking",
  "about:blank",
], { stdio: "ignore" });

try {
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json`);
  const target = targets.find((item) => item.type === "page");
  assert.ok(target?.webSocketDebuggerUrl, "Edge did not expose a page target");
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      localStorage.setItem("mian.active-conversation.v1", "c02-e2e");
      localStorage.setItem("mian.chat-event-cursor.v1", JSON.stringify({ streamId: "e2e-stream", seq: 0 }));
      localStorage.setItem("mian.conversation.c02-e2e.mian.chat-groups.v2", ${JSON.stringify(JSON.stringify(history))});
      localStorage.setItem("mian.conversation.c02-e2e.mian.chat-session.v1", JSON.stringify({ activeTurnId: "stale-turn" }));
    `,
  });
  await cdp.call("Page.navigate", { url: `http://127.0.0.1:${harness.port}/chat` });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await cdp.call("Runtime.evaluate", {
      expression: `Boolean(document.querySelector('.archive-input button[type="submit"]'))`,
      returnByValue: true,
    });
    if (result.result.value) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const disclosure = await cdp.call("Runtime.evaluate", {
    expression: `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const thinking = document.querySelector('.archive-reply-head[data-timeline-kind="THINKING"] .archive-module');
      const tools = document.querySelector('.archive-module[data-timeline-kind="TOOL_CALLS"]');
      const tool = tools?.querySelector('.archive-tool-step');
      if (!thinking || !tools || !tool) return { ready: false };
      const initial = {
        thinking: thinking.classList.contains('is-expanded'),
        tools: tools.classList.contains('is-expanded'),
        tool: tool.classList.contains('is-expanded'),
      };
      thinking.querySelector('summary').click();
      await wait(320);
      const thinkingFirstOpen = thinking.classList.contains('is-expanded');
      thinking.querySelector('summary').click();
      await wait(320);
      thinking.querySelector('summary').click();
      await wait(320);
      const thinkingSecondOpen = thinking.classList.contains('is-expanded');
      tools.querySelector('summary').click();
      await wait(320);
      tool.querySelector('.step-head').click();
      await wait(260);
      const expanded = {
        tools: tools.classList.contains('is-expanded'),
        tool: tool.classList.contains('is-expanded'),
        body: tool.querySelector('.archive-step-body')?.textContent,
      };
      tool.querySelector('.step-head').click();
      await wait(260);
      const toolClosed = !tool.classList.contains('is-expanded');
      return {
        ready: true,
        initial,
        thinkingFirstOpen,
        thinkingSecondOpen,
        expanded,
        toolClosed,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(disclosure.result.value.ready, true);
  assert.deepEqual(disclosure.result.value.initial, {
    thinking: false,
    tools: false,
    tool: false,
  });
  assert.equal(disclosure.result.value.thinkingFirstOpen, true);
  assert.equal(disclosure.result.value.thinkingSecondOpen, true);
  assert.deepEqual(disclosure.result.value.expanded, {
    tools: true,
    tool: true,
    body: "fixture result",
  });
  assert.equal(disclosure.result.value.toolClosed, true);
  assert.equal(disclosure.result.value.horizontalOverflow, 0);
  const click = await cdp.call("Runtime.evaluate", {
    expression: `(() => {
      const button = document.querySelector('.archive-input button[type="submit"]');
      if (!button) return { clicked: false };
      const rect = button.getBoundingClientRect();
      button.click();
      return {
        clicked: true,
        disabled: button.disabled,
        ariaLabel: button.getAttribute('aria-label'),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    })()`,
    returnByValue: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const turnRequests = harness.requests.filter((request) => request.path === "/api/turn");
  const interruptRequests = harness.requests.filter((request) => request.path.includes("/interrupt"));
  assert.equal(click.result.value.clicked, true);
  assert.equal(click.result.value.disabled, false);
  assert.equal(interruptRequests.length, 0, "stale local turn incorrectly routed the click to interrupt");
  assert.equal(turnRequests.length, 1, "the real DOM click did not issue exactly one /api/turn request");
  const payload = JSON.parse(turnRequests[0].body);
  assert.equal(payload.conversationId, "c02-e2e");
  assert.match(payload.text, /第一条未回复消息/);
  assert.match(payload.text, /第二条未回复消息/);
  console.log(JSON.stringify({ viewport: "390x844", disclosure: disclosure.result.value, click: click.result.value, turnRequest: payload }, null, 2));
  cdp.close();
} finally {
  browser.kill();
  await Promise.race([
    once(browser, "exit"),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  await harness.close();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 4) console.warn(`temporary Edge profile cleanup deferred: ${error}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
