import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { WebSocket } from "ws";
import { fileTicketServer } from "./fileTickets.server.mjs";

const backend = await fileTicketServer();
const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  "--headless=new", "--remote-debugging-port=9370",
  `--user-data-dir=${path.join(backend.directory, "route-browser")}`,
  "--no-first-run", "--disable-background-networking", "--disable-background-timer-throttling", "about:blank",
], { windowsHide: true, stdio: "ignore" });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (read, label) => {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await read()) return;
    await sleep(40);
  }
  throw new Error(label);
};
let cdp, call;
try {
  let targets;
  await waitFor(async () => {
    try { targets = await (await fetch("http://127.0.0.1:9370/json")).json(); return true; }
    catch { return false; }
  }, "browser startup");
  cdp = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await once(cdp, "open");
  let id = 0, navigations = 0;
  const pending = new Map(), paused = new Map(), requested = [], errors = [], missingChunks = new Set();
  cdp.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.method === "Page.frameNavigated" && !message.params.frame.parentId) {
      navigations++;
      missingChunks.clear();
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description);
    if (message.method === "Fetch.requestPaused") {
      const page = /\/(Chat|Clues|Connections|Settings)-[^/]+\.js$/.exec(message.params.request.url)[1];
      requested.push(page);
      if (missingChunks.has(page)) void rejectChunkRequest(message.params.requestId);
      else paused.set(page, message.params.requestId);
    }
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
  });
  call = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id;
    pending.set(next, { resolve, reject });
    cdp.send(JSON.stringify({ id: next, method, params }));
  });
  const rejectChunkRequest = (requestId) => call("Fetch.fulfillRequest", {
    requestId,
    responseCode: 404,
    responseHeaders: [{ name: "Content-Type", value: "text/plain" }],
    body: Buffer.from("Old build chunk removed").toString("base64"),
  });
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description);
    return result.result.value;
  };
  const release = async (page) => {
    const requestId = paused.get(page);
    paused.delete(page);
    await call("Fetch.continueRequest", { requestId });
  };
  const homeReady = () => evaluate("location.pathname==='/' && !!document.querySelector('.home-screen') && document.querySelector('.route-transition-frame').dataset.transitionActive==='false'");

  await call("Page.enable");
  await call("Runtime.enable");
  await call("Network.enable");
  await call("Network.setCacheDisabled", { cacheDisabled: true });
  await call("Fetch.enable", {
    patterns: ["Chat", "Clues", "Connections", "Settings"].map((page) => ({
      urlPattern: `*/assets/${page}-*.js`, requestStage: "Request",
    })),
  });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `
    // 分块恢复单独测试；离线壳和新版切换由 offline.browser.e2e.mjs 覆盖。
    navigator.serviceWorker.register = async () => { throw new Error('shell disabled in chunk test'); };
    const idle = new Map(); let nextIdle = 0;
    window.requestIdleCallback = callback => { idle.set(++nextIdle, callback); return nextIdle; };
    window.cancelIdleCallback = id => idle.delete(id);
    window.runIdle = () => { for (const callback of idle.values()) callback(); idle.clear(); };
    window.pageAnimations = [];
    document.addEventListener('animationstart', event => pageAnimations.push(event.animationName));
    window.watchHome = () => {
      window.blankFrames = 0; window.watchingHome = true;
      const sample = () => {
        if (!watchingHome) return;
        const home = document.querySelector('.home-screen');
        const layer = home?.closest('.route-transition-layer');
        if (!home || !home.getClientRects().length || getComputedStyle(layer).opacity!=='1') blankFrames++;
        requestAnimationFrame(sample);
      };
      sample();
    };
  ` });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call("Page.navigate", { url: backend.base });
  await waitFor(homeReady, "initial home");
  assert.deepEqual(requested, [], "pages are lazy before idle or pointerdown");

  for (const [page, entry, route, content, back, reduced] of [
    ["Settings", ".dock-2", "/settings", ".settings-page", ".back-btn", false],
    ["Clues", ".dock-3", "/clues", ".clues-page", ".back-btn", false],
    ["Connections", ".dock-1", "/connections", ".connections-page", ".back-btn", false],
    ["Chat", ".icon-1", "/chat", ".ribbon-back-hit", ".ribbon-back-hit", true],
  ]) {
    await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }] });
    await evaluate(`document.querySelector(${JSON.stringify(entry)}).dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:1}))`);
    await waitFor(() => paused.has(page), `${page} starts on pointerdown`);
    assert.equal(await evaluate("location.pathname"), "/");
    await evaluate(`watchHome();document.querySelector(${JSON.stringify(entry)}).click()`);
    await sleep(350);
    assert.equal(await evaluate("blankFrames"), 0, `${page} keeps the current page visible while its import is delayed`);
    assert.equal(await evaluate("!!document.querySelector('.route-transition-incoming')"), false, "crossfade waits for the target page");
    await evaluate("watchingHome=false");
    await release(page);
    await waitFor(() => evaluate(`location.pathname===${JSON.stringify(route)} && !!document.querySelector(${JSON.stringify(content)}) && document.querySelector('.route-transition-frame').dataset.transitionActive==='false'`), `${page} renders and finishes switching`);
    assert.equal(requested.filter((name) => name === page).length, 1);
    await evaluate(`document.querySelector(${JSON.stringify(back)}).click()`);
    await waitFor(homeReady, "back to home");
  }
  assert.equal(await evaluate("pageAnimations.includes('routeControlPress') && pageAnimations.includes('routePageEnter')"), true);

  requested.length = 0;
  await call("Page.navigate", { url: `${backend.base}/?idle-preload` });
  await waitFor(homeReady, "fresh home for idle preloading");
  await evaluate("runIdle()");
  const sequence = ["Chat", "Clues", "Connections", "Settings"];
  for (const [index, page] of sequence.entries()) {
    await waitFor(() => paused.has(page), `${page} idle preload`);
    assert.deepEqual(requested, sequence.slice(0, index + 1), "idle imports run one after another");
    assert.equal(await homeReady(), true);
    await release(page);
  }
  assert.deepEqual(errors, []);

  const reloadMarker = () => evaluate("sessionStorage.getItem('mian.lazy-import-reload.v1')");
  const preloadEntry = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:1}))`);
  const failChunk = async (page) => {
    const requestId = paused.get(page);
    paused.delete(page);
    missingChunks.add(page);
    await rejectChunkRequest(requestId);
  };

  await call("Page.navigate", { url: `${backend.base}/?missing-chunk` });
  await waitFor(homeReady, "home before an old chunk fails");
  const beforeFailure = navigations;
  await preloadEntry(".dock-3");
  await waitFor(() => paused.has("Clues"), "old clues chunk request");
  await failChunk("Clues");
  await waitFor(() => navigations === beforeFailure + 1, "first failed import reloads the page");
  await waitFor(homeReady, "home after automatic reload");
  assert.equal(await reloadMarker(), "clues", "Vite event and import catch share one reload");

  await evaluate("runIdle()");
  await waitFor(() => paused.has("Chat"), "unrelated chat preload after reload");
  await release("Chat");
  await waitFor(() => paused.has("Clues"), "retry the failed clues preload");
  assert.equal(await reloadMarker(), "clues", "other modules cannot clear the failed module's marker");
  await failChunk("Clues");
  await sleep(500);
  assert.equal(navigations, beforeFailure + 1, "repeated chunk failure does not reload again");
  assert.equal(await reloadMarker(), "clues");

  await call("Page.reload");
  await waitFor(() => navigations === beforeFailure + 2, "manual reload after restoring the chunk");
  await waitFor(homeReady, "home with available chunks");
  await preloadEntry(".dock-3");
  await waitFor(() => paused.has("Clues"), "restored clues chunk");
  await release("Clues");
  await waitFor(async () => await reloadMarker() === null, "successful import clears the marker");

  await evaluate("window.dispatchEvent(new Event('vite:preloadError'))");
  await waitFor(() => navigations === beforeFailure + 3, "standalone Vite preload error reloads once");
  await waitFor(homeReady, "home after Vite recovery");
  assert.equal(await reloadMarker(), "vite:preloadError");
  await evaluate("window.dispatchEvent(new Event('vite:preloadError'))");
  await sleep(300);
  assert.equal(navigations, beforeFailure + 3);
  await preloadEntry(".dock-2");
  await waitFor(() => paused.has("Settings"), "successful preload after Vite recovery");
  await release("Settings");
  await waitFor(async () => await reloadMarker() === null, "successful import clears the Vite marker");

  console.log("PASS pointerdown and idle preloads, delayed navigation without blanks, unchanged animations, missing chunks reload once, repeated failures stop, success clears the marker, and vite:preloadError recovery.");
} finally {
  const exited = once(browser, "exit");
  if (call) await call("Browser.close");
  else browser.kill();
  await exited;
  cdp?.close();
  await backend.close();
}
