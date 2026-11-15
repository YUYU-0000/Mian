import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { build } from "esbuild";
import { WebSocket } from "ws";
import { imageBytes } from "./fileTickets.server.mjs";

const directory = await mkdtemp(path.join(tmpdir(), "mian-clue-interactions-"));
const bundle = await build({
  entryPoints: ["tests/clueInteractions.fixture.tsx"],
  bundle: true, write: false, outdir: directory, format: "iife",
  platform: "browser", jsx: "automatic",
  external: ["/fonts/*"],
  define: { "process.env.NODE_ENV": '"production"' },
});
const app = express();
app.get("/fixture.js", (_req, res) => res.type("js").send(bundle.outputFiles.find((file) => file.path.endsWith(".js")).text));
app.get("/fixture.css", (_req, res) => res.type("css").send(bundle.outputFiles.find((file) => file.path.endsWith(".css")).text));
app.get("/", (_req, res) => res.send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>'));
app.use(express.static("client/public"));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  "--headless=new", "--remote-debugging-port=9368", `--user-data-dir=${directory}`,
  "--no-first-run", "--disable-background-networking", "--disable-background-timer-throttling", "about:blank",
], { windowsHide: true, stdio: "ignore" });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (read, label) => {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await read()) return;
    await sleep(30);
  }
  throw new Error(label);
};
let cdp, call;
try {
  let targets;
  await waitFor(async () => {
    try { targets = await (await fetch("http://127.0.0.1:9368/json")).json(); return true; }
    catch { return false; }
  }, "browser startup");
  cdp = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await once(cdp, "open");
  let id = 0;
  const pending = new Map(), errors = [];
  cdp.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description);
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
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description);
    return result.result.value;
  };
  const exists = (selector) => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
  const visible = (selector) => waitFor(() => exists(selector), selector);
  const point = (selector, fx = .5, fy = .5) => evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return {x:r.left+r.width*${fx}, y:r.top+r.height*${fy}};
  })()`);
  const mouse = (type, p) => call("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: type === "mouseMoved" ? 0 : 1 });
  const touch = (type, p) => call("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" || type === "touchCancel" ? [] : [{ id: 1, x: p.x, y: p.y }] });
  const tap = async (selector, touchInput = false, dx = 0, dy = 0, fx = .5) => {
    const p = await point(selector, fx);
    const send = touchInput ? touch : mouse;
    await send(touchInput ? "touchStart" : "mousePressed", p);
    if (dx || dy) await send(touchInput ? "touchMove" : "mouseMoved", { x: p.x + dx, y: p.y + dy });
    await send(touchInput ? "touchEnd" : "mouseReleased", { x: p.x + dx, y: p.y + dy });
  };
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
  await visible('.card[data-id="saved-card"]');
  assert.equal(await exists(".sw"), false);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".card"),"::before").content'), "none");

  await evaluate("window.originalRandom=Math.random; Math.random=()=>.9");
  await tap(".envc");
  await visible(".ov.show");
  await sleep(320);
  await tap(".envc", true);
  assert.equal(await exists(".ov.show"), true);
  await tap('.pp[data-layout="1"]', true, 3, 4, .035);
  await waitFor(async () => (await evaluate("readClueWall().cards.length")) === 2, "back paper selects the front card");
  assert.equal(await evaluate("readClueWall().cards.at(-1).layout"), 0);
  await evaluate("Math.random=originalRandom");
  assert.equal(await exists(".sw"), false);
  await sleep(300);
  const added = await evaluate("readClueWall().cards.at(-1).id");
  const addedSelector = `.card[data-id="${added}"]`;
  await tap(addedSelector, true, 5, 4);
  await visible(".sw.show");
  await sleep(350);
  await tap(".sheet .s-title");
  assert.equal(await exists(".sw.show"), true);
  await mouse("mousePressed", { x: 15, y: 80 });
  await mouse("mouseReleased", { x: 15, y: 80 });
  await waitFor(async () => !(await exists(".sw")), "blank dismisses sheet");
  await evaluate("document.querySelector('.mail.is-in')?.click()");

  await tap('.card[data-id="saved-card"]', false, 4, 4);
  await visible(".sw.show");
  await sleep(350);
  assert.equal(await exists(".sw.show"), true);
  assert.match(await evaluate("document.querySelector('.s-top .no').textContent"), /01$/);
  assert.equal(await evaluate("document.querySelector('.sc').textContent"), "always");
  await evaluate("document.querySelector('[data-mode=trigger]').click()");
  await waitFor(() => evaluate("document.querySelector('.sc').textContent==='when it matters'"), "mode text transitions");
  await evaluate("document.querySelector('.tear').click()");
  await waitFor(() => evaluate("document.querySelector('.tear').textContent==='再點一次撕掉'"), "tear text transitions");
  await evaluate("document.querySelector('.done').click()");
  await waitFor(async () => !(await exists(".sw")), "sheet closes");
  await evaluate("document.querySelector('.mail.is-in')?.click()");
  await tap(".envc");
  await visible(".ov.show");
  await sleep(320);
  const paperPoint = await point('.pp[data-layout="0"]');
  await mouse("mousePressed", paperPoint);
  await mouse("mouseMoved", { x: paperPoint.x - 90, y: paperPoint.y });
  await mouse("mouseReleased", { x: paperPoint.x - 90, y: paperPoint.y });
  await waitFor(() => evaluate("document.querySelector('.pick b').textContent==='票根'"), "paper swipe");
  assert.equal(await evaluate("readClueWall().cards.length"), 2);
  await touch("touchStart", { x: 15, y: 80 });
  await touch("touchEnd", { x: 15, y: 80 });
  await waitFor(async () => !(await exists(".ov")), "only blank closes envelope");
  await evaluate("renderClues()");
  await visible(addedSelector);
  assert.equal(await exists(".sw"), false);
  assert.equal(await evaluate("[...document.querySelectorAll('.card')].every(card=>getComputedStyle(card,'::before').content==='none')"), true);

  await evaluate("showNotice()");
  await visible(".mail.is-in");
  await sleep(520);
  const notice = await point(".mail", .4, .7);
  const originalTop = await evaluate("document.querySelector('.mail').getBoundingClientRect().top");
  await touch("touchStart", notice);
  await touch("touchMove", { x: notice.x, y: notice.y - 16 });
  assert.ok(Math.abs((await evaluate("document.querySelector('.mail').getBoundingClientRect().top")) - originalTop + 16) < 1);
  await touch("touchEnd", { x: notice.x, y: notice.y - 16 });
  await sleep(520);
  assert.equal(await exists(".mail.is-in"), true);
  assert.ok(Math.abs((await evaluate("document.querySelector('.mail').getBoundingClientRect().top")) - originalTop) < 1);
  const noticeAgain = await point(".mail", .4, .8);
  await touch("touchStart", noticeAgain);
  await touch("touchMove", { x: noticeAgain.x, y: noticeAgain.y - 42 });
  await touch("touchEnd", { x: noticeAgain.x, y: noticeAgain.y - 42 });
  await waitFor(async () => !(await exists(".mail.is-in")), "up swipe dismisses notice");
  await evaluate("showNotice('ok')");
  await visible(".mail.is-in");
  await waitFor(async () => !(await exists(".mail.is-in")), "notice still auto dismisses");

  await evaluate("renderHome()");
  await visible(".home-photo.widget .file-input");
  await sleep(150);
  const imagePath = path.join(directory, "photo.png");
  await writeFile(imagePath, imageBytes);
  await evaluate("window.savedRaf=requestAnimationFrame; window.mediaFrames=[]; window.requestAnimationFrame=callback=>mediaFrames.push(callback)");
  for (const selector of [".home-photo.widget .file-input", ".settings-page .file-input"]) {
    const { root } = await call("DOM.getDocument");
    const { nodeId } = await call("DOM.querySelector", { nodeId: root.nodeId, selector });
    await call("DOM.setFileInputFiles", { nodeId, files: [imagePath] });
  }
  await visible(".home-photo .developing");
  await visible(".settings-page .developing");
  const effect = (selector) => evaluate(`(() => {const s=getComputedStyle(document.querySelector(${JSON.stringify(selector)}));return [s.transitionProperty,s.transitionDuration,s.transitionTimingFunction,s.filter,s.transform,s.opacity]})()`);
  assert.deepEqual(await effect(".home-photo .developing"), await effect(".settings-page .developing"));
  assert.equal((await effect(".home-photo .developing"))[1], "0.5s, 0.8s, 0.75s");
  await evaluate("window.requestAnimationFrame=savedRaf; mediaFrames.forEach(callback=>callback(performance.now()))");
  await waitFor(async () => !(await exists(".developing")), "shared developing effect settles");
  assert.deepEqual(errors, []);
  console.log("PASS clue paper mouse/touch clicks, front-card selection, no automatic editor, animated sheet text, notice swipe/rebound/auto-dismiss, and shared home media development.");
} finally {
  const exited = once(browser, "exit");
  if (call) await call("Browser.close");
  else spawnSync("taskkill.exe", ["/PID", String(browser.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  await exited;
  cdp?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  assert.equal(path.dirname(directory), tmpdir());
  await rm(directory, { recursive: true, force: true });
}
