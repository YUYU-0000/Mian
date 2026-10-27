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
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(message);
}
async function cdpClient(url) {
  const socket = new WebSocket(url);
  await once(socket, "open");
  let id = 0;
  const pending = new Map();
  socket.on("message", (raw) => {
    const value = JSON.parse(String(raw));
    if (!value.id || !pending.has(value.id)) return;
    const entry = pending.get(value.id);
    pending.delete(value.id);
    value.error ? entry.reject(new Error(value.error.message)) : entry.resolve(value.result);
  });
  return {
    call(method, params = {}) {
      const requestId = ++id;
      socket.send(JSON.stringify({ id: requestId, method, params }));
      return new Promise((resolve, reject) =>
        pending.set(requestId, { resolve, reject }),
      );
    },
    close: () => socket.close(),
  };
}

await fetch(`${baseUrl}/api/connection/test`, { method: "POST" });
const createdResponse = await fetch(`${baseUrl}/api/conversations`, {
  method: "POST",
});
assert.equal(createdResponse.status, 201);
const created = (await createdResponse.json()).conversation;
const profile = await mkdtemp(path.join(tmpdir(), "mian-ticket-archive-e2e-"));
const debugPort = 9333;
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
let archived = false;
try {
  const targets = await waitUntil(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
      return response.ok ? response.json() : null;
    } catch {
      return null;
    }
  }, "Edge target timed out");
  const target = targets.find((item) => item.type === "page");
  cdp = await cdpClient(target.webSocketDebuggerUrl);
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem("mian.active-conversation.v1", ${JSON.stringify(created.conversationId)});`,
  });
  await cdp.call("Page.navigate", { url: `${baseUrl}/chat` });
  const evaluate = async (expression) =>
    (
      await cdp.call("Runtime.evaluate", {
        expression,
        returnByValue: true,
      })
    ).result.value;
  await waitUntil(
    () => evaluate(`Boolean(document.querySelector('.ribbon-ticket-hit'))`),
    "Chat did not render",
  );
  await evaluate(`document.querySelector('.ribbon-ticket-hit').click()`);
  await waitUntil(
    () =>
      evaluate(
        `document.querySelector('.ticket-drawer')?.classList.contains('is-open') && Number.parseFloat(getComputedStyle(document.querySelector('.ticket-workspace')).opacity) > 0.99`,
      ),
    "ticket drawer did not settle",
  );
  await waitUntil(
    () =>
      evaluate(
        `Boolean(document.querySelector(${JSON.stringify(`.mini-ticket-container[data-id="${created.conversationId}"]`) }))`,
      ),
    "created ticket did not render",
  );
  await evaluate(`document.querySelector(${JSON.stringify(`.mini-ticket-container[data-id="${created.conversationId}"]`) }).scrollIntoView({ block: "center", inline: "nearest" })`);
  await sleep(100);
  const rect = await evaluate(`(() => {
    const value = document.querySelector(${JSON.stringify(`.mini-ticket-container[data-id="${created.conversationId}"]`)}).getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height };
  })()`);
  const startX = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  await evaluate(`(() => {
    window.__mianSwipeEvents = [];
    const node = document.querySelector(${JSON.stringify(`.mini-ticket-container[data-id="${created.conversationId}"]`)});
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"])
      node.addEventListener(type, (event) => window.__mianSwipeEvents.push({
        type,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        x: event.clientX,
        y: event.clientY,
      }));
  })()`);
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

  try {
    await waitUntil(async () => {
      const response = await fetch(`${baseUrl}/api/conversations`);
      const list = await response.json();
      return !list.conversations.some(
        (item) => item.conversationId === created.conversationId,
      );
    }, "real swipe did not archive the ticket", 20_000);
  } catch (error) {
    const diagnostics = await evaluate(`(() => {
      const ticket = document.querySelector(${JSON.stringify(`.mini-ticket-container[data-id="${created.conversationId}"]`)});
      const motion = ticket?.querySelector('.mini-ticket-motion');
      return {
        events: window.__mianSwipeEvents,
        transform: motion ? getComputedStyle(motion).transform : null,
        opacity: motion ? getComputedStyle(motion).opacity : null,
        ticketExists: Boolean(ticket),
        rect: ticket ? (() => { const value = ticket.getBoundingClientRect(); return { x: value.x, y: value.y, width: value.width, height: value.height }; })() : null,
      };
    })()`);
    throw new Error(`${error.message}: ${JSON.stringify(diagnostics)}`);
  }
  archived = true;
  await waitUntil(
    () =>
      evaluate(
        `localStorage.getItem("mian.active-conversation.v1") !== ${JSON.stringify(created.conversationId)}`,
      ),
    "archiving the selected ticket did not choose an adjacent conversation",
  );
  const selected = await evaluate(
    `localStorage.getItem("mian.active-conversation.v1")`,
  );
  console.log(
    JSON.stringify(
      {
        viewport: "390x844",
        archivedConversationId: created.conversationId,
        archivedThreadId: created.threadId,
        swipeDistance: 145,
        adjacentConversationId: selected,
      },
      null,
      2,
    ),
  );
} finally {
  if (!archived)
    await fetch(
      `${baseUrl}/api/conversations/${encodeURIComponent(created.conversationId)}`,
      { method: "DELETE" },
    ).catch(() => undefined);
  cdp?.close();
  browser.kill();
  await Promise.race([once(browser, "exit"), sleep(2_000)]);
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
