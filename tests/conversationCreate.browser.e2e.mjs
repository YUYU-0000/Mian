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
    close() {
      socket.close();
    },
  };
}

const response = await fetch(`${baseUrl}/api/conversations`);
assert.equal(response.status, 200);
const realRecords = (await response.json()).conversations;
assert.ok(realRecords.length > 0);
const initial = realRecords.at(-1);
const temporary = [1, 2, 3].map((number) => {
  const now = new Date(Date.now() + number).toISOString();
  return {
    conversationId: `e2e-created-${number}`,
    threadId: null,
    parentConversationId: null,
    rootNumber: 900 + number,
    branchPath: [],
    branchCounter: 0,
    abbr: `C-${900 + number}`,
    title: `E2E NEW ${number}`,
    frontName: "Mian",
    image: "",
    pinned: false,
    model: null,
    reasoningEffort: null,
    totalTokens: null,
    uncachedTotalTokens: null,
    lastActivityAt: null,
    lastMessage: null,
    collaborationMode: null,
    createdAt: now,
    updatedAt: now,
  };
});

const profile = await mkdtemp(path.join(tmpdir(), "mian-create-transition-"));
const debugPort = 9336;
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
let createIndex = 0;
let renamedConversation = null;
const runtimeErrors = [];
try {
  const targets = await waitUntil(async () => {
    try {
      const value = await fetch(`http://127.0.0.1:${debugPort}/json`);
      return value.ok ? value.json() : null;
    } catch {
      return null;
    }
  }, "Edge target timed out");
  cdp = await connectCdp(
    targets.find((target) => target.type === "page").webSocketDebuggerUrl,
  );
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Fetch.enable", {
    patterns: [
      { urlPattern: "*api/conversations", requestStage: "Request" },
      { urlPattern: "*api/conversations/*", requestStage: "Request" },
    ],
  });
  cdp.onEvent((event) => {
    if (event.method === "Runtime.exceptionThrown")
      runtimeErrors.push(
        event.params.exceptionDetails.exception?.description ??
          event.params.exceptionDetails.text,
      );
    if (event.method !== "Fetch.requestPaused") return;
    const request = event.params.request;
    if (
      request.method === "POST" &&
      new URL(request.url).pathname === "/api/conversations" &&
      createIndex < temporary.length
    ) {
      const conversation = temporary[createIndex++];
      void cdp.call("Fetch.fulfillRequest", {
        requestId: event.params.requestId,
        responseCode: 201,
        responseHeaders: [{ name: "content-type", value: "application/json" }],
        body: Buffer.from(JSON.stringify({ conversation })).toString("base64"),
      });
      return;
    }
    if (
      request.method === "PATCH" &&
      new URL(request.url).pathname ===
        `/api/conversations/${temporary[2].conversationId}`
    ) {
      const patch = JSON.parse(request.postData || "{}");
      renamedConversation = {
        ...temporary[2],
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      void cdp.call("Fetch.fulfillRequest", {
        requestId: event.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: "content-type", value: "application/json" }],
        body: Buffer.from(
          JSON.stringify({ conversation: renamedConversation }),
        ).toString("base64"),
      });
      return;
    }
    void cdp.call("Fetch.continueRequest", { requestId: event.params.requestId });
  });
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem("mian.active-conversation.v1", ${JSON.stringify(initial.conversationId)});`,
  });
  await cdp.call("Page.navigate", { url: `${baseUrl}/chat` });
  const evaluate = async (expression) => {
    const result = await cdp.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ?? "evaluation failed",
      );
    return result.result.value;
  };
  await waitUntil(
    () =>
      evaluate(
        `document.querySelector('.archive-chat')?.dataset.displayedConversationId === ${JSON.stringify(initial.conversationId)}`,
      ),
    "initial latest ticket did not render",
  );
  await evaluate(`(() => {
    window.__stableChat = document.querySelector('.archive-chat');
    window.__stableHeader = document.querySelector('.archive-header');
    window.__stableInput = document.querySelector('.archive-input');
    window.__createFrames = [];
    window.__sampleCreate = true;
    const sample = () => {
      const chat = document.querySelector('.archive-chat');
      const incoming = document.querySelector('.archive-message-layer-current');
      const outgoing = document.querySelector('.archive-message-layer-outgoing');
      const incomingStyle = incoming ? getComputedStyle(incoming) : null;
      const outgoingStyle = outgoing ? getComputedStyle(outgoing) : null;
      const ribbonRect = document.querySelector('.archive-ribbon').getBoundingClientRect();
      window.__createFrames.push({
        active: chat?.dataset.activeConversationId ?? null,
        displayed: chat?.dataset.displayedConversationId ?? null,
        title: document.querySelector('#archiveRibbonTitle')?.textContent ?? null,
        incomingOpacity: incomingStyle?.opacity ?? null,
        outgoingOpacity: outgoingStyle?.opacity ?? null,
        chatStable: chat === window.__stableChat,
        headerStable: document.querySelector('.archive-header') === window.__stableHeader,
        inputStable: document.querySelector('.archive-input') === window.__stableInput,
        chatCount: document.querySelectorAll('.archive-chat').length,
        liveLayerCount: document.querySelectorAll('.archive-message-layer-current').length,
        outgoingLayerCount: document.querySelectorAll('.archive-message-layer-outgoing').length,
        titleLayerCount: document.querySelectorAll('#archiveRibbonTitle .archive-title-text').length,
        ribbonRect: { x: ribbonRect.x, y: ribbonRect.y, width: ribbonRect.width, height: ribbonRect.height },
        paper: getComputedStyle(document.querySelector('.archive-message-stage')).backgroundColor,
        ribbonFill: getComputedStyle(document.querySelector('.archive-ribbon rect')).fill,
      });
      if (window.__sampleCreate) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  })()`);

  for (const conversation of temporary) {
    if (!(await evaluate(`document.querySelector('.ticket-drawer')?.classList.contains('is-open')`)))
      await evaluate(`document.querySelector('.ribbon-ticket-hit').click()`);
    await waitUntil(
      () => evaluate(`document.querySelector('.ticket-drawer')?.classList.contains('is-open')`),
      "ticket drawer did not open",
    );
    await waitUntil(
      () => evaluate(`!document.querySelector('.strip-toggle')?.disabled`),
      "create control stayed busy",
    );
    await evaluate(`document.querySelector('.strip-toggle').click()`);
    await waitUntil(
      () =>
        evaluate(
          `document.querySelector('.archive-chat')?.dataset.displayedConversationId === ${JSON.stringify(conversation.conversationId)} && document.querySelector('.archive-message-layer-current')?.dataset.conversationSwitchPhase === 'idle'`,
        ),
      `new ticket ${conversation.conversationId} did not settle`,
    );
  }

  const renamedTitle = "RENAMED AFTER SAVE";
  await evaluate(`(() => {
    const title = document.querySelector('#archiveRibbonTitle');
    window.__titleAnimationStarts = 0;
    window.__headerBeforeRename = document.querySelector('.archive-ribbon').getBoundingClientRect().toJSON();
    title.addEventListener('animationstart', (event) => {
      if (event.animationName === 'archiveTitleInkIn') window.__titleAnimationStarts += 1;
    });
    if (!document.querySelector('.ticket-drawer').classList.contains('is-open'))
      document.querySelector('.ribbon-ticket-hit').click();
    document.querySelector('.ticket-face.front').click();
  })()`);
  await waitUntil(
    () => evaluate(`document.querySelector('.ticket-flipper')?.classList.contains('flipped')`),
    "ticket did not flip for rename",
  );
  await evaluate(`(() => {
    const input = document.querySelector('.row-title input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(renamedTitle)});
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  })()`);
  try {
    await waitUntil(
      () =>
        evaluate(
          `document.querySelector('#archiveRibbonTitle')?.querySelectorAll('.archive-title-text').length === 1 && document.querySelector('#archiveRibbonTitle')?.textContent === ${JSON.stringify(renamedTitle)}`,
        ),
      "saved rename did not finish one title transition",
    );
  } catch (error) {
    const diagnostic = await evaluate(`(() => ({
      title: document.querySelector('#archiveRibbonTitle')?.innerHTML,
      input: document.querySelector('.row-title input')?.value,
      animations: window.__titleAnimationStarts,
      displayed: document.querySelector('.archive-chat')?.dataset.displayedConversationId,
    }))()`);
    throw new Error(`${error.message}: ${JSON.stringify({ diagnostic, renamedConversation })}`);
  }

  await evaluate(`window.__sampleCreate = false`);
  const frames = await evaluate(`window.__createFrames`);
  const finalState = await evaluate(`(() => ({
    active: document.querySelector('.archive-chat').dataset.activeConversationId,
    displayed: document.querySelector('.archive-chat').dataset.displayedConversationId,
    title: document.querySelector('#archiveRibbonTitle').textContent,
    draft: document.querySelector('.archive-input textarea').value,
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    chatStable: document.querySelector('.archive-chat') === window.__stableChat,
    headerStable: document.querySelector('.archive-header') === window.__stableHeader,
    inputStable: document.querySelector('.archive-input') === window.__stableInput,
    titleAnimationStarts: window.__titleAnimationStarts,
    headerBeforeRename: window.__headerBeforeRename,
    headerAfterRename: document.querySelector('.archive-ribbon').getBoundingClientRect().toJSON(),
  }))()`);
  assert.equal(createIndex, 3);
  assert.equal(finalState.active, temporary[2].conversationId);
  assert.equal(finalState.displayed, temporary[2].conversationId);
  assert.equal(finalState.title, renamedTitle);
  assert.equal(finalState.draft, "");
  assert.equal(finalState.horizontalOverflow, 0);
  assert.equal(finalState.chatStable, true);
  assert.equal(finalState.headerStable, true);
  assert.equal(finalState.inputStable, true);
  assert.equal(finalState.titleAnimationStarts, 1);
  for (const key of ["x", "y", "width", "height"])
    assert.ok(
      Math.abs(finalState.headerBeforeRename[key] - finalState.headerAfterRename[key]) <= 0.5,
      `header ${key} changed during rename`,
    );
  assert.equal(renamedConversation?.title, renamedTitle);
  assert.ok(frames.some((frame) => frame.outgoingLayerCount === 1));
  assert.ok(frames.some((frame) => frame.titleLayerCount === 2));
  const firstRibbonRect = frames[0].ribbonRect;
  for (const frame of frames) {
    assert.equal(frame.chatStable, true);
    assert.equal(frame.headerStable, true);
    assert.equal(frame.inputStable, true);
    assert.equal(frame.chatCount, 1);
    assert.equal(frame.liveLayerCount, 1);
    assert.ok(frame.outgoingLayerCount <= 1);
    assert.ok(frame.titleLayerCount >= 1 && frame.titleLayerCount <= 2);
    for (const key of ["x", "y", "width", "height"])
      assert.ok(Math.abs(frame.ribbonRect[key] - firstRibbonRect[key]) <= 0.5);
    assert.notEqual(frame.paper, "rgba(0, 0, 0, 0)");
    assert.notEqual(frame.paper, "rgb(0, 0, 0)");
    assert.notEqual(frame.ribbonFill, "rgb(0, 0, 0)");
    if (frame.outgoingOpacity !== null)
      assert.ok(
        Number(frame.incomingOpacity) + Number(frame.outgoingOpacity) > 0.01,
        "new-ticket transition exposed an empty frame",
      );
  }
  assert.deepEqual(runtimeErrors, []);
  const after = await (await fetch(`${baseUrl}/api/conversations`)).json();
  assert.equal(
    after.conversations.some((record) =>
      temporary.some((item) => item.conversationId === record.conversationId),
    ),
    false,
  );
  console.log(
    JSON.stringify(
      {
        viewport: "390x844",
        created: temporary.map((item) => item.conversationId),
        frameCount: frames.length,
        finalState,
        stableDom: { chat: true, header: true, input: true },
        realRegistryPreserved: true,
        runtimeErrors,
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
