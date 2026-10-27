import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const baseUrl = process.env.MIAN_E2E_URL || "http://127.0.0.1:5173";
const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(check, message, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(25);
  }
  throw new Error(message);
}
async function connectCdp(url) {
  const socket = new WebSocket(url);
  await once(socket, "open");
  let id = 0;
  const pending = new Map();
  const handlers = new Set();
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (!message.id || !pending.has(message.id)) {
      for (const handler of handlers) handler(message);
      return;
    }
    const entry = pending.get(message.id);
    pending.delete(message.id);
    message.error
      ? entry.reject(new Error(message.error.message))
      : entry.resolve(message.result);
  });
  return {
    call(method, params = {}) {
      const requestId = ++id;
      socket.send(JSON.stringify({ id: requestId, method, params }));
      return new Promise((resolve, reject) =>
        pending.set(requestId, { resolve, reject }),
      );
    },
    onEvent(handler) {
      handlers.add(handler);
    },
    close: () => socket.close(),
  };
}

const before = await (await fetch(`${baseUrl}/api/conversations`)).json();
assert.ok(before.conversations.length > 1);
const victim = before.conversations[0];

const profile = await mkdtemp(path.join(tmpdir(), "mian-c01-archive-"));
const debugPort = 9335;
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
let interceptedDelete = false;
let deleteRequestCount = 0;
let singleTicketMode = false;
try {
  const targets = await waitUntil(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
      return response.ok ? response.json() : null;
    } catch {
      return null;
    }
  }, "Edge target timed out");
  cdp = await connectCdp(
    targets.find((item) => item.type === "page").webSocketDebuggerUrl,
  );
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Fetch.enable", {
    patterns: [
      {
        urlPattern: `*api/conversations/${victim.conversationId}`,
        requestStage: "Request",
      },
    ],
  });
  cdp.onEvent((event) => {
    if (event.method !== "Fetch.requestPaused") return;
    const request = event.params.request;
    if (
      singleTicketMode &&
      request.method === "GET" &&
      new URL(request.url).pathname === "/api/conversations"
    ) {
      void cdp.call("Fetch.fulfillRequest", {
        requestId: event.params.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: "content-type", value: "application/json" },
        ],
        body: Buffer.from(
          JSON.stringify({
            defaultConversationId: victim.conversationId,
            conversations: [victim],
          }),
        ).toString("base64"),
      });
    } else if (request.method === "DELETE") {
      deleteRequestCount += 1;
      interceptedDelete = true;
      void cdp.call("Fetch.fulfillRequest", {
        requestId: event.params.requestId,
        responseCode: 204,
        responseHeaders: [],
      });
    } else
      void cdp.call("Fetch.continueRequest", {
        requestId: event.params.requestId,
      });
  });
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem("mian.active-conversation.v1", ${JSON.stringify(victim.conversationId)})`,
  });
  await cdp.call("Page.navigate", { url: `${baseUrl}/chat` });
  const evaluate = async (expression) => {
    const result = await cdp.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.exception?.description ?? "evaluation failed");
    return result.result.value;
  };
  await waitUntil(
    () =>
      evaluate(
        `document.querySelector('.archive-chat')?.dataset.displayedConversationId === ${JSON.stringify(victim.conversationId)} && document.querySelectorAll('.mini-ticket-container').length > 1 && document.querySelector('#archiveRibbonTitle')?.textContent === ${JSON.stringify(victim.title)} && document.querySelectorAll('#archiveRibbonTitle .archive-title-text').length === 1`,
      ),
    "selected Chat did not render",
  );
  await evaluate(`document.querySelector('.ribbon-ticket-hit').click()`);
  await waitUntil(
    () => evaluate(`document.querySelector('.ticket-drawer')?.classList.contains('is-open')`),
    "ticket drawer did not open",
  );
  await evaluate(`document.querySelector('.mini-ticket-container[data-id=${JSON.stringify(victim.conversationId)}]').scrollIntoView({ block: 'center' })`);
  await evaluate(`(() => {
    window.__archiveTitleAnimationStarts = 0;
    window.__archiveHeaderBefore = document.querySelector('.archive-ribbon').getBoundingClientRect().toJSON();
    document.querySelector('#archiveRibbonTitle').addEventListener('animationstart', (event) => {
      if (event.animationName === 'archiveTitleInkIn') window.__archiveTitleAnimationStarts += 1;
    });
  })()`);
  await sleep(60);
  const rect = await evaluate(`(() => {
    const value = document.querySelector('.mini-ticket-container[data-id=${JSON.stringify(victim.conversationId)}]').getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height };
  })()`);
  const startX = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  await cdp.call("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: startX, y, id: 1, radiusX: 2, radiusY: 2 }],
  });
  for (const distance of [30, 65, 105, 145]) {
    await cdp.call("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: startX - distance, y, id: 1, radiusX: 2, radiusY: 2 },
      ],
    });
    await sleep(35);
  }
  await cdp.call("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });

  await waitUntil(
    () => evaluate(`!document.querySelector('.mini-ticket-container[data-id=${JSON.stringify(victim.conversationId)}]')`),
    "selected ticket did not leave the ticket list",
  );
  await waitUntil(
    () =>
      evaluate(
        `(() => { const chat = document.querySelector('.archive-chat'); const surface = document.querySelector('.archive-message-layer-current'); return chat?.dataset.displayedConversationId !== ${JSON.stringify(victim.conversationId)} && chat?.dataset.activeConversationId === chat?.dataset.displayedConversationId && surface?.dataset.conversationSwitchPhase === 'idle'; })()`,
      ),
    "adjacent conversation did not finish B1",
  );
  const finalState = await evaluate(`(() => {
    const chat = document.querySelector('.archive-chat');
    return {
      active: chat.dataset.activeConversationId,
      displayed: chat.dataset.displayedConversationId,
      title: document.querySelector('#archiveRibbonTitle').textContent,
      victimTicketPresent: Boolean(document.querySelector('.mini-ticket-container[data-id=${JSON.stringify(victim.conversationId)}]')),
      titleAnimationStarts: window.__archiveTitleAnimationStarts,
      headerBefore: window.__archiveHeaderBefore,
      headerAfter: document.querySelector('.archive-ribbon').getBoundingClientRect().toJSON(),
    };
  })()`);
  assert.equal(interceptedDelete, true);
  assert.equal(finalState.victimTicketPresent, false);
  assert.equal(finalState.active, finalState.displayed);
  assert.equal(finalState.titleAnimationStarts, 1);
  for (const key of ["x", "y", "width", "height"])
    assert.ok(Math.abs(finalState.headerBefore[key] - finalState.headerAfter[key]) <= 0.5);
  const after = await (await fetch(`${baseUrl}/api/conversations`)).json();
  assert.ok(
    after.conversations.some((item) => item.conversationId === victim.conversationId),
    "the non-destructive check unexpectedly changed the real registry",
  );

  singleTicketMode = true;
  await cdp.call("Fetch.disable");
  await cdp.call("Fetch.enable", {
    patterns: [
      { urlPattern: "*api/conversations*", requestStage: "Request" },
    ],
  });
  await cdp.call("Network.enable");
  await cdp.call("Network.setBlockedURLs", {
    urls: ["ws://127.0.0.1:5173/ws*"],
  });
  await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.WebSocket = class LocalSingleTicketSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = 3;
      close() {}
      send() {}
      addEventListener() {}
      removeEventListener() {}
    };`,
  });
  await evaluate(`localStorage.setItem("mian.active-conversation.v1", ${JSON.stringify(victim.conversationId)})`);
  await cdp.call("Page.navigate", { url: `${baseUrl}/chat` });
  await waitUntil(
    () =>
      evaluate(
        `document.querySelectorAll('.mini-ticket-container').length === 1 && document.querySelector('.archive-chat')?.dataset.displayedConversationId === ${JSON.stringify(victim.conversationId)}`,
      ),
    "single-ticket fixture did not render",
  );
  await sleep(400);
  assert.equal(
    await evaluate(`document.querySelectorAll('.mini-ticket-container').length`),
    1,
  );
  await evaluate(`document.querySelector('.ribbon-ticket-hit').click()`);
  await waitUntil(
    () => evaluate(`document.querySelector('.ticket-drawer')?.classList.contains('is-open')`),
    "single-ticket drawer did not open",
  );
  const singleRect = await evaluate(`(() => {
    const value = document.querySelector('.mini-ticket-container[data-id=${JSON.stringify(victim.conversationId)}]').getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height };
  })()`);
  const singleStartX = singleRect.x + singleRect.width / 2;
  const singleY = singleRect.y + singleRect.height / 2;
  await cdp.call("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: singleStartX, y: singleY, id: 2, radiusX: 2, radiusY: 2 },
    ],
  });
  for (const distance of [30, 65, 105, 145]) {
    await cdp.call("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: singleStartX - distance,
          y: singleY,
          id: 2,
          radiusX: 2,
          radiusY: 2,
        },
      ],
    });
    await sleep(35);
  }
  await cdp.call("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await sleep(600);
  const reboundState = await evaluate(`(() => {
    const ticket = document.querySelector('.mini-ticket-container[data-id=${JSON.stringify(victim.conversationId)}]');
    const motion = ticket?.querySelector('.mini-ticket-motion');
    return {
      ticketPresent: Boolean(ticket),
      transform: motion ? getComputedStyle(motion).transform : null,
      opacity: motion ? getComputedStyle(motion).opacity : null,
    };
  })()`);
  assert.equal(deleteRequestCount, 1, "the last ticket attempted a DELETE");
  assert.equal(reboundState.ticketPresent, true);
  assert.ok(
    reboundState.transform === "none" ||
      reboundState.transform === "matrix(1, 0, 0, 1, 0, 0)",
  );
  assert.equal(reboundState.opacity, "1");
  console.log(
    JSON.stringify(
      {
        viewport: "390x844",
        interceptedDelete,
        finalState,
        realRegistryPreserved: true,
        lastTicketRebound: reboundState,
      },
      null,
      2,
    ),
  );
} finally {
  cdp?.close();
  browser.kill();
  await Promise.race([once(browser, "exit"), sleep(2_000)]);
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
