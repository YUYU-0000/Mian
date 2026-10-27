import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const baseUrl = process.env.MIAN_E2E_URL || "http://127.0.0.1:8787";
const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(check, message, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await sleep(50);
  }
  throw new Error(`${message}${last instanceof Error ? `: ${last.message}` : ""}`);
}

async function waitForJson(url) {
  return waitUntil(async () => {
    const response = await fetch(url);
    return response.ok ? response.json() : null;
  }, `Timed out waiting for ${url}`);
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await once(socket, "open");
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  return {
    call(method, params = {}) {
      const requestId = ++id;
      socket.send(JSON.stringify({ id: requestId, method, params }));
      return new Promise((resolve, reject) =>
        pending.set(requestId, { resolve, reject }),
      );
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      socket.close();
    },
  };
}

const list = await (await fetch(`${baseUrl}/api/conversations`)).json();
const byAbbr = new Map(list.conversations.map((item) => [item.abbr, item]));
const conversations = ["C-01", "C-02", "C-03"].map((abbr) => {
  const record = byAbbr.get(abbr);
  assert.ok(record, `${abbr} is required for the real multi-conversation E2E`);
  return record;
});
const connection = await fetch(`${baseUrl}/api/connection/test`, {
  method: "POST",
});
assert.ok(connection.ok, `real app-server connection failed: ${connection.status}`);

const profile = await mkdtemp(path.join(tmpdir(), "mian-real-multi-e2e-"));
const debugPort = 9331;
const browser = spawn(
  edge,
  [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-background-networking",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let cdp;
try {
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json`);
  const target = targets.find((item) => item.type === "page");
  assert.ok(target?.webSocketDebuggerUrl, "Edge page target was not exposed");
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Network.enable");
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });

  const requests = [];
  const streamEvents = [];
  const consoleErrors = [];
  cdp.subscribe((message) => {
    if (message.method === "Network.requestWillBeSent") {
      const request = message.params.request;
      if (request.url.includes("/api/"))
        requests.push({
          url: request.url,
          method: request.method,
          body: request.postData || "",
          timestamp: message.params.timestamp,
        });
    }
    if (message.method === "Network.webSocketFrameReceived") {
      try {
        const value = JSON.parse(message.params.response.payloadData);
        if (value.kind === "event")
          streamEvents.push({ ...value, timestamp: message.params.timestamp });
      } catch {}
    }
    if (
      message.method === "Runtime.consoleAPICalled" &&
      message.params.type === "error"
    )
      consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description));
    if (message.method === "Runtime.exceptionThrown")
      consoleErrors.push(message.params.exceptionDetails.text);
  });

  await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      if (!sessionStorage.getItem("mian-real-e2e-initialized")) {
        localStorage.setItem("mian.active-conversation.v1", ${JSON.stringify(conversations[0].conversationId)});
        localStorage.removeItem("mian.chat-event-cursor.v1");
        sessionStorage.setItem("mian-real-e2e-initialized", "true");
      }
    `,
  });
  await cdp.call("Page.navigate", { url: `${baseUrl}/chat` });
  await waitUntil(
    async () =>
      (
        await cdp.call("Runtime.evaluate", {
          expression: `Boolean(document.querySelector('.archive-input button[type="submit"]'))`,
          returnByValue: true,
        })
      ).result.value,
    "Chat did not render",
  );

  const evaluate = async (expression) =>
    (
      await cdp.call("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
    ).result.value;

  const activeConversation = () =>
    evaluate(`localStorage.getItem("mian.active-conversation.v1")`);

  const selectConversation = async (conversationId) => {
    if ((await activeConversation()) === conversationId) return;
    await evaluate(`document.querySelector('.ribbon-ticket-hit').click()`);
    await waitUntil(
      () =>
        evaluate(
          `document.querySelector('.ticket-drawer')?.classList.contains('is-open') && Number.parseFloat(getComputedStyle(document.querySelector('.ticket-workspace')).opacity) > 0.99`,
        ),
      "ticket drawer did not open",
    );
    await sleep(50);
    await evaluate(`document.querySelector(${JSON.stringify(`.mini-ticket-container[data-id="${conversationId}"] .mini-lower`)})?.click()`);
    await waitUntil(
      () =>
        evaluate(
          `document.querySelector('.mini-ticket-container.active')?.dataset.id === ${JSON.stringify(conversationId)} && !document.querySelector('.ticket-flipper')?.classList.contains('flipped')`,
        ),
      `ticket preview ${conversationId} did not settle`,
    );
    await evaluate(`document.querySelector('.ticket-face.front')?.click()`);
    await waitUntil(
      () => evaluate(`document.querySelector('.ticket-flipper')?.classList.contains('flipped')`),
      "ticket did not flip",
    );
    await sleep(380);
    await evaluate(`document.querySelector('.row-seat .seat-col:last-child')?.click()`);
    await waitUntil(
      () => evaluate(`!document.querySelector('.ticket-drawer')?.classList.contains('is-open')`),
      "ticket drawer did not close after Select",
    );
    await waitUntil(
      async () => (await activeConversation()) === conversationId,
      `conversation ${conversationId} was not selected`,
    );
  };

  const setInput = async (value) => {
    await evaluate(`(() => {
      const textarea = document.querySelector('.archive-input textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(textarea, ${JSON.stringify(value)});
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      return textarea.value;
    })()`);
    await sleep(30);
  };
  const clickSend = async () => {
    await evaluate(`document.querySelector('.archive-input button[type="submit"]').click()`);
    await sleep(40);
  };
  const turnRequests = () =>
    requests.filter((request) =>
      new URL(request.url).pathname === "/api/turn" && request.method === "POST",
    );
  const interruptRequests = () =>
    requests.filter((request) => request.url.includes("/interrupt"));

  const markers = {
    [conversations[0].conversationId]: "ARCH-C01-REAL",
    [conversations[1].conversationId]: "ARCH-C02-REAL",
    [conversations[2].conversationId]: "ARCH-C03-REAL",
  };
  const save = async (conversationId, text) => {
    await selectConversation(conversationId);
    const before = turnRequests().length;
    await setInput(text);
    await clickSend();
    assert.equal(
      turnRequests().length,
      before,
      "a non-empty save unexpectedly started a turn",
    );
  };
  const submitPending = async (conversationId) => {
    await selectConversation(conversationId);
    const before = turnRequests().length;
    await setInput("");
    await clickSend();
    await waitUntil(
      () => turnRequests().length === before + 1,
      `${conversationId} empty-send did not issue /api/turn`,
      20_000,
    );
    const payload = JSON.parse(turnRequests().at(-1).body);
    assert.equal(payload.conversationId, conversationId);
    return payload;
  };

  await save(
    conversations[0].conversationId,
    `${markers[conversations[0].conversationId]}：请先原样说出这个标记，再用至少二百个中文字分成自然气泡回答。这是多会话后台生成测试。`,
  );
  await submitPending(conversations[0].conversationId);

  await save(
    conversations[1].conversationId,
    `${markers[conversations[1].conversationId]} 第一条：请记住这个标记。`,
  );
  await save(
    conversations[1].conversationId,
    "第二条：请先原样说出上一条标记，再用至少二百个中文字分成自然气泡回答。",
  );
  await evaluate(`(() => {
    const id = ${JSON.stringify(conversations[1].conversationId)};
    const key = 'mian.conversation.' + id + '.mian.chat-groups.v2';
    const groups = JSON.parse(localStorage.getItem(key));
    for (const group of groups) if (group.role === 'user') group.pending = false;
    localStorage.setItem(key, JSON.stringify(groups));
    localStorage.setItem('mian.conversation.' + id + '.mian.chat-session.v1', JSON.stringify({ activeTurnId: 'stale-real-e2e-turn' }));
  })()`);
  await cdp.call("Page.reload", { ignoreCache: true });
  await waitUntil(
    () => evaluate(`Boolean(document.querySelector('.archive-input button[type="submit"]'))`),
    "Chat did not restore after stale-state reload",
  );
  const c2Payload = await submitPending(conversations[1].conversationId);
  assert.match(c2Payload.text, /ARCH-C02-REAL/);
  assert.match(c2Payload.text, /第二条/);

  await save(
    conversations[2].conversationId,
    `${markers[conversations[2].conversationId]}：请先原样说出这个标记，再用至少二百个中文字分成自然气泡回答。这是第三个独立会话。`,
  );
  await submitPending(conversations[2].conversationId);

  for (const conversation of [conversations[0], conversations[1], conversations[2]])
    await selectConversation(conversation.conversationId);

  await cdp.call("Page.reload", { ignoreCache: true });
  await waitUntil(
    () => evaluate(`Boolean(document.querySelector('.archive-input button[type="submit"]'))`),
    "Chat did not restore after active-turn reload",
  );

  const histories = await waitUntil(async () => {
    const value = await evaluate(`(() => {
      const ids = ${JSON.stringify(conversations.map((item) => item.conversationId))};
      return Object.fromEntries(ids.map((id) => {
        const groups = JSON.parse(localStorage.getItem('mian.conversation.' + id + '.mian.chat-groups.v2') || '[]');
        return [id, groups];
      }));
    })()`);
    return conversations.every((conversation) =>
      value[conversation.conversationId].some(
        (group) => group.role === "assistant" && Boolean(group.status),
      ),
    )
      ? value
      : null;
  }, "all three real turns did not complete", 180_000);

  assert.equal(turnRequests().length, 3);
  assert.equal(interruptRequests().length, 0);
  for (const conversation of conversations) {
    const groups = histories[conversation.conversationId];
    const users = groups
      .filter((group) => group.role === "user")
      .flatMap((group) => group.records.map((record) => record.text));
    assert.ok(users.some((text) => text.includes(markers[conversation.conversationId])));
    assert.ok(groups.some((group) => group.role === "assistant" && group.status));
  }

  const routed = streamEvents
    .filter((entry) => entry.event?.turnId)
    .map((entry) => ({
      seq: entry.seq,
      conversationId: entry.conversationId ?? entry.event.conversationId,
      turnId: entry.event.turnId,
      type: entry.event.type,
      timestamp: entry.timestamp,
    }));
  for (let index = 1; index < streamEvents.length; index += 1)
    assert.ok(streamEvents[index].seq > streamEvents[index - 1].seq);
  const owners = new Map();
  for (const event of routed) {
    const previous = owners.get(event.turnId);
    if (previous) assert.equal(event.conversationId, previous);
    else owners.set(event.turnId, event.conversationId);
  }
  const starts = routed.filter((event) => event.type === "turn-started");
  const completions = routed.filter((event) => event.type === "turn-completed");
  const overlap = starts.some((start) =>
    starts.some(
      (other) =>
        other.turnId !== start.turnId &&
        other.timestamp <
          (completions.find((done) => done.turnId === start.turnId)?.timestamp ?? Infinity),
    ),
  );
  assert.equal(overlap, true, "no two real conversations overlapped in generation");
  assert.deepEqual(consoleErrors, []);

  console.log(
    JSON.stringify(
      {
        viewport: "390x844",
        conversations: conversations.map(({ abbr, conversationId, threadId }) => ({
          abbr,
          conversationId,
          threadId,
          userRecordCount: histories[conversationId]
            .filter((group) => group.role === "user")
            .reduce((count, group) => count + group.records.length, 0),
          assistantGroupCount: histories[conversationId].filter(
            (group) => group.role === "assistant",
          ).length,
        })),
        turnRequests: turnRequests().map((request) => JSON.parse(request.body).conversationId),
        interruptRequests: interruptRequests().length,
        orderedEventCount: streamEvents.length,
        overlappingTurns: overlap,
        consoleErrors,
      },
      null,
      2,
    ),
  );
} finally {
  cdp?.close();
  browser.kill();
  await Promise.race([once(browser, "exit"), sleep(2_000)]);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 4) console.warn(`temporary Edge profile cleanup deferred: ${error}`);
      await sleep(100);
    }
  }
}
