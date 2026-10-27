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
  const eventHandlers = new Set();
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (!message.id || !pending.has(message.id)) {
      for (const handler of eventHandlers) handler(message);
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
      eventHandlers.add(handler);
      return () => eventHandlers.delete(handler);
    },
    close: () => socket.close(),
  };
}

const response = await fetch(`${baseUrl}/api/conversations`);
assert.equal(response.status, 200);
const records = (await response.json()).conversations;
assert.ok(records.length >= 3, "three existing tickets are required");
const first = records.find((record) => record.conversationId === "c1") ?? records[0];
const second = records.find((record) => record.conversationId !== first.conversationId);
const third = records.find(
  (record) =>
    record.conversationId !== first.conversationId &&
    record.conversationId !== second.conversationId,
);
assert.ok(second && third);
const titles = Object.fromEntries(
  [first, second, third].map((record) => [record.conversationId, record.title]),
);

const profile = await mkdtemp(path.join(tmpdir(), "mian-switch-e2e-"));
const debugPort = 9334;
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
const runtimeErrors = [];
const resourceLogs = [];
try {
  const targets = await waitUntil(async () => {
    try {
      const result = await fetch(`http://127.0.0.1:${debugPort}/json`);
      return result.ok ? result.json() : null;
    } catch {
      return null;
    }
  }, "Edge target timed out");
  const target = targets.find((item) => item.type === "page");
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Log.enable");
  cdp.onEvent((event) => {
    if (event.method === "Runtime.exceptionThrown")
      runtimeErrors.push(
        event.params.exceptionDetails.exception?.description ??
          event.params.exceptionDetails.text,
      );
    if (
      event.method === "Log.entryAdded" &&
      ["error", "warning"].includes(event.params.entry.level)
    )
      resourceLogs.push(event.params.entry.text);
  });
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem("mian.active-conversation.v1", ${JSON.stringify(first.conversationId)});`,
  });
  await cdp.call("Page.navigate", { url: `${baseUrl}/chat` });
  const evaluate = async (expression, awaitPromise = false) => {
    const result = await cdp.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.exception?.description ?? "evaluation failed");
    return result.result.value;
  };
  await waitUntil(
    () =>
      evaluate(
        `document.querySelector('.archive-chat')?.dataset.displayedConversationId === ${JSON.stringify(first.conversationId)} && document.querySelector('#archiveRibbonTitle')?.textContent === ${JSON.stringify(first.title)}`,
      ),
    "initial conversation did not render",
  );

  await evaluate(`(() => {
    window.__mianSwitchFrames = [];
    window.__mianSwitchSampling = true;
    const sample = () => {
      const chat = document.querySelector('.archive-chat');
      const surface = document.querySelector('.archive-message-layer-current');
      const outgoing = document.querySelector('.archive-message-layer-outgoing');
      const title = document.querySelector('#archiveRibbonTitle');
      const headerRect = document.querySelector('.archive-ribbon')?.getBoundingClientRect();
      const input = document.querySelector('.archive-input textarea');
      const style = surface ? getComputedStyle(surface) : null;
      const outgoingStyle = outgoing ? getComputedStyle(outgoing) : null;
      window.__mianSwitchFrames.push({
        time: performance.now(),
        active: chat?.dataset.activeConversationId ?? null,
        displayed: chat?.dataset.displayedConversationId ?? null,
        phase: surface?.dataset.conversationSwitchPhase ?? null,
        title: title?.lastElementChild?.textContent ?? title?.textContent ?? null,
        titleLayerCount: title?.querySelectorAll('.archive-title-text').length ?? 0,
        headerRect: headerRect ? { x: headerRect.x, y: headerRect.y, width: headerRect.width, height: headerRect.height } : null,
        draft: input?.value ?? null,
        opacity: style?.opacity ?? null,
        filter: style?.filter ?? null,
        outgoingOpacity: outgoingStyle?.opacity ?? null,
        chatCount: document.querySelectorAll('.archive-chat').length,
        headerCount: document.querySelectorAll('.archive-header').length,
        inputCount: document.querySelectorAll('.archive-input').length,
        liveLayerCount: document.querySelectorAll('.archive-message-layer-current').length,
        outgoingLayerCount: document.querySelectorAll('.archive-message-layer-outgoing').length,
        background: chat ? getComputedStyle(chat).backgroundColor : null,
      });
      if (window.__mianSwitchSampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  })()`);

  const setDraft = async (value) =>
    evaluate(`(() => {
      const input = document.querySelector('.archive-input textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input.value;
    })()`);
  const setScroll = async () =>
    evaluate(`(() => {
      const stream = document.querySelector('.archive-message-layer-current');
      stream.scrollTop = Math.max(0, stream.scrollHeight - stream.clientHeight - 90);
      stream.dispatchEvent(new Event('scroll', { bubbles: true }));
      return stream.scrollTop;
    })()`);
  const selectTicket = async (conversationId, finishImmediately = false) => {
    await evaluate(`document.querySelector('.ribbon-ticket-hit').click()`);
    await waitUntil(
      () => evaluate(`document.querySelector('.ticket-drawer')?.classList.contains('is-open')`),
      "ticket drawer did not open",
    );
    const targetSelector = `.mini-ticket-container[data-id="${conversationId}"] .mini-lower`;
    await waitUntil(
      () =>
        evaluate(
          `Boolean(document.querySelector(${JSON.stringify(targetSelector)}))`,
        ),
      `ticket ${conversationId} did not render`,
    );
    await evaluate(`document.querySelector(${JSON.stringify(targetSelector)}).click()`);
    await sleep(20);
    await evaluate(`document.querySelector('.ticket-face.front').click()`);
    await waitUntil(
      () => evaluate(`document.querySelector('.ticket-flipper')?.classList.contains('flipped')`),
      "ticket did not flip",
    );
    await evaluate(`document.querySelector('.row-seat .seat-col:last-child').click()`);
    if (finishImmediately) {
      await sleep(20);
      await evaluate(`document.querySelector('.ticket-workspace').dispatchEvent(new TransitionEvent('transitionend', { bubbles: true, propertyName: 'opacity' }))`);
    }
  };
  const waitForIdle = (conversationId) =>
    waitUntil(
      () =>
        evaluate(
          `(() => { const chat = document.querySelector('.archive-chat'); const surface = document.querySelector('.archive-message-layer-current'); return chat?.dataset.displayedConversationId === ${JSON.stringify(conversationId)} && surface?.dataset.conversationSwitchPhase === 'idle'; })()`,
        ),
      `conversation ${conversationId} did not settle`,
    );

  const firstDraft = "draft-for-first-ticket";
  const secondDraft = "draft-for-second-ticket";
  assert.equal(await setDraft(firstDraft), firstDraft);
  const firstScrollTop = await setScroll();
  await selectTicket(second.conversationId);
  await waitUntil(
    () =>
      evaluate(
        `document.querySelector('.archive-message-layer-current')?.dataset.conversationSwitchPhase === 'overlap'`,
      ),
    "normal overlap did not start",
  );
  const normalOutgoingDuration = await evaluate(
    `getComputedStyle(document.querySelector('.archive-message-layer-outgoing')).animationDuration`,
  );
  const normalIncoming = await evaluate(
    `(() => { const style = getComputedStyle(document.querySelector('.archive-message-layer-current')); return { duration: style.animationDuration, delay: style.animationDelay }; })()`,
  );
  await waitForIdle(second.conversationId);
  assert.equal(normalOutgoingDuration, "0.16s");
  assert.deepEqual(normalIncoming, { duration: "0.18s", delay: "0.04s" });
  assert.equal(await setDraft(secondDraft), secondDraft);

  await evaluate(`(() => {
    const style = document.createElement('style');
    style.id = 'e2e-stretched-conversation-overlap';
    style.textContent = '.archive-message-layer-current.is-conversation-incoming { animation-duration: 1000ms !important; }';
    document.head.appendChild(style);
  })()`);
  await selectTicket(third.conversationId, true);
  await waitUntil(
    () =>
      evaluate(
        `document.querySelector('.archive-message-layer-current')?.dataset.conversationSwitchPhase === 'overlap'`,
      ),
    "rapid switch did not begin",
  );
  await sleep(25);
  await selectTicket(first.conversationId, true);
  try {
    await waitForIdle(first.conversationId);
  } catch (error) {
    const diagnostic = await evaluate(`(() => {
      const chat = document.querySelector('.archive-chat');
      const surface = document.querySelector('.archive-message-layer-current');
      const drawer = document.querySelector('.ticket-drawer');
      return {
        active: chat?.dataset.activeConversationId,
        displayed: chat?.dataset.displayedConversationId,
        phase: surface?.dataset.conversationSwitchPhase,
        generation: surface?.dataset.conversationSwitchGeneration,
        drawerOpen: drawer?.classList.contains('is-open'),
        preview: document.querySelector('.mini-ticket-container.active')?.dataset.id,
        lastFrames: window.__mianSwitchFrames.slice(-12),
      };
    })()`);
    throw new Error(`${error.message}: ${JSON.stringify(diagnostic)}`);
  }
  await sleep(50);

  const finalState = await evaluate(`(() => {
    const chat = document.querySelector('.archive-chat');
    const stream = document.querySelector('.archive-message-layer-current');
    return {
      active: chat.dataset.activeConversationId,
      displayed: chat.dataset.displayedConversationId,
      title: document.querySelector('#archiveRibbonTitle').textContent,
      draft: document.querySelector('.archive-input textarea').value,
      scrollTop: stream.scrollTop,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      chatCount: document.querySelectorAll('.archive-chat').length,
      headerCount: document.querySelectorAll('.archive-header').length,
      inputCount: document.querySelectorAll('.archive-input').length,
      liveLayerCount: document.querySelectorAll('.archive-message-layer-current').length,
      outgoingLayerCount: document.querySelectorAll('.archive-message-layer-outgoing').length,
    };
  })()`);
  await evaluate(`window.__mianSwitchSampling = false`);
  const frames = await evaluate(`window.__mianSwitchFrames`);

  assert.equal(finalState.active, first.conversationId);
  assert.equal(finalState.displayed, first.conversationId);
  assert.equal(finalState.title, first.title);
  assert.equal(finalState.draft, firstDraft);
  assert.ok(Math.abs(finalState.scrollTop - firstScrollTop) <= 2);
  assert.equal(finalState.horizontalOverflow, 0);
  assert.equal(finalState.chatCount, 1);
  assert.equal(finalState.headerCount, 1);
  assert.equal(finalState.inputCount, 1);
  assert.equal(finalState.liveLayerCount, 1);
  assert.equal(finalState.outgoingLayerCount, 0);
  assert.ok(frames.some((frame) => frame.phase === "overlap"));
  const firstHeaderRect = frames.find((frame) => frame.headerRect)?.headerRect;
  assert.ok(firstHeaderRect);
  for (const frame of frames) {
    assert.equal(frame.chatCount, 1, "Chat root remounted or duplicated");
    assert.equal(frame.headerCount, 1, "header remounted or duplicated");
    assert.equal(frame.inputCount, 1, "input remounted or duplicated");
    assert.equal(frame.liveLayerCount, 1, "more than one live Store view rendered");
    assert.ok(frame.outgoingLayerCount <= 1, "more than one frozen view rendered");
    assert.ok(frame.titleLayerCount >= 1 && frame.titleLayerCount <= 2);
    assert.ok(Math.abs(frame.headerRect.x - firstHeaderRect.x) <= 0.5);
    assert.ok(Math.abs(frame.headerRect.y - firstHeaderRect.y) <= 0.5);
    assert.ok(Math.abs(frame.headerRect.width - firstHeaderRect.width) <= 0.5);
    assert.ok(Math.abs(frame.headerRect.height - firstHeaderRect.height) <= 0.5);
    if (frame.outgoingOpacity !== null)
      assert.ok(
        Number(frame.opacity) + Number(frame.outgoingOpacity) > 0.01,
        "both conversation layers became transparent",
      );
    if (frame.displayed && titles[frame.displayed])
      assert.equal(frame.title, titles[frame.displayed], "title and Store switched in different frames");
    assert.notEqual(frame.background, "rgba(0, 0, 0, 0)");
    assert.notEqual(frame.background, "rgb(0, 0, 0)");
    if (frame.displayed === first.conversationId)
      assert.ok(frame.draft === "" || frame.draft === firstDraft);
    if (frame.displayed === second.conversationId)
      assert.ok(frame.draft === "" || frame.draft === secondDraft);
  }
  assert.deepEqual(runtimeErrors, []);
  console.log(
    JSON.stringify(
      {
        viewport: "390x844",
        sequence: [
          first.conversationId,
          second.conversationId,
          third.conversationId,
          first.conversationId,
        ],
        frameCount: frames.length,
        normalDurations: {
          outgoing: normalOutgoingDuration,
          incoming: normalIncoming,
        },
        finalState,
        runtimeErrors,
        resourceLogs,
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
