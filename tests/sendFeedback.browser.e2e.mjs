import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { build } from "esbuild";
import { WebSocket } from "ws";

const workspace = process.cwd();
const profile = await mkdtemp(path.join(workspace, ".tmp-feedback-browser-"));
const bundle = await build({ entryPoints: ["tests/sendFeedback.fixture.tsx"], bundle: true, write: false, outdir: profile, format: "esm", splitting: true, platform: "browser", external: ["/grain.png"], jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
const html = await readFile("client/dist/index.html", "utf8");
const stylesheet = html.match(/<link rel="stylesheet"[^>]*href="([^"]+\.css)"/)[1];
const app = express();
app.get("/bundle/:file", (request, response) => {
  const file = bundle.outputFiles.find(item => path.basename(item.path) === request.params.file);
  response.type(request.params.file.endsWith(".css") ? "css" : "js").send(file.text);
});
app.get("/", (_request, response) => response.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${stylesheet}">${bundle.outputFiles.filter(file => file.path.endsWith(".css")).map(file => `<link rel="stylesheet" href="/bundle/${path.basename(file.path)}">`).join("")}<div id="root"></div><script type="module" src="/bundle/sendFeedback.fixture.js"></script>`));
app.use(express.static(path.join(workspace, "client/dist")));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", ["--headless=new", "--remote-debugging-port=9368", `--user-data-dir=${profile}`, "--no-first-run", "--disable-background-networking", "--disable-background-timer-throttling", "about:blank"], { windowsHide: true, stdio: "ignore" });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (read, description) => {
  const until = Date.now() + 10000;
  while (Date.now() < until) { if (await read()) return; await sleep(40); }
  throw new Error(description);
};
let cdp;
const errors = [];
try {
  let targets;
  await waitFor(async () => {
    try { targets = await (await fetch("http://127.0.0.1:9368/json")).json(); return true; } catch { return false; }
  }, "browser startup");
  cdp = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await once(cdp, "open");
  let sequence = 0;
  const pending = new Map();
  cdp.on("message", raw => {
    const message = JSON.parse(String(raw));
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description);
    const task = pending.get(message.id);
    if (task) { pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); cdp.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description);
    return result.result.value;
  };
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
  await waitFor(() => evaluate("!!window.feedback && !!document.querySelector('.archive-chat')"), "chat fixture");
  assert.equal(await evaluate("feedback.decodedAvatars()"), 1);

  await evaluate("feedback.begin()");
  await waitFor(() => evaluate("!!document.querySelector('[data-role=assistant] .hourglass')"), "immediate thinking placeholder");
  const initial = await evaluate(`(() => {
    window.replyNode = document.querySelector('[data-role=assistant]');
    window.headNode = replyNode.querySelector('.archive-reply-head');
    window.glassNode = headNode.querySelector('.hourglass');
    return { time: headNode.querySelector('time').textContent, title: headNode.querySelector('.archive-module-title').textContent, animation: getComputedStyle(glassNode).animationName, entry: getComputedStyle(headNode).animationName, avatar: getComputedStyle(headNode.querySelector('.archive-avatar')).backgroundImage };
  })()`);
  assert.equal(initial.time, "10:20");
  assert.equal(initial.title, "THINKING");
  assert.equal(initial.animation, "hourglass");
  assert.equal(initial.entry, "bubblePop");
  assert.match(initial.avatar, /blob:/);
  await waitFor(() => evaluate("getComputedStyle(glassNode).transform !== 'matrix(1, 0, 0, 1, 0, 0)'"), "hourglass rotates");
  assert.equal(await evaluate("document.querySelectorAll('[data-role=user] .archive-avatar').length===1 && document.querySelectorAll('[data-role=user] .archive-bubble').length===3"), true);
  await evaluate(`feedback.event({type:'turn-started',turnId:'reply',format:'api'}); feedback.event({type:'assistant-delta',turnId:'reply',format:'api',delta:'<mian-thinking>在这里。</mian-thinking><mian-bubble>回来了。</mian-bubble><mian-bubble>第二句。</mian-bubble>'});`);
  await evaluate("feedback.resolve()");
  await evaluate("new Promise(requestAnimationFrame)");
  assert.equal(await evaluate("replyNode === document.querySelector('[data-role=assistant]') && headNode === replyNode.querySelector('.archive-reply-head') && glassNode === headNode.querySelector('.hourglass')"), true);
  await evaluate(`feedback.event({type:'turn-completed',turnId:'reply',status:'completed'});`);
  await waitFor(() => evaluate("feedback.idle() && document.querySelector('[data-role=assistant] .archive-reply-body').textContent.includes('回来了。') && !headNode.querySelector('.hourglass')"), "reply playback");
  assert.equal(await evaluate("replyNode === document.querySelector('[data-role=assistant]') && headNode === replyNode.querySelector('.archive-reply-head')"), true);
  assert.equal(await evaluate("document.querySelectorAll('[data-role=assistant] .archive-avatar').length===1 && document.querySelectorAll('[data-role=assistant] .archive-bubble').length===2"), true);

  await evaluate("feedback.begin()");
  await waitFor(() => evaluate("document.querySelectorAll('[data-role=assistant]').length === 2"), "second placeholder");
  await evaluate("window.failedNode = document.querySelectorAll('[data-role=assistant]')[1]; feedback.reject()");
  await waitFor(() => evaluate("!!failedNode.querySelector('[role=status]')"), "failure remains in placeholder");
  assert.equal(await evaluate("failedNode === document.querySelectorAll('[data-role=assistant]')[1] && !failedNode.querySelector('.hourglass') && failedNode.textContent.includes('那邊沒接上')"), true);

  await evaluate("feedback.addFiles()");
  await waitFor(() => evaluate("document.querySelectorAll('.file-drafts .ft-progress').length === 2"), "file and image drafts");
  await evaluate("window.progressNodes = [...document.querySelectorAll('.ft-progress')]; feedback.progress(40); new Promise(requestAnimationFrame)");
  await evaluate("Promise.all(progressNodes.flatMap(line => line.getAnimations().map(animation => animation.finished))).then(() => null)");
  const progress = await evaluate(`[...document.querySelectorAll('.file-drafts .ft')].map(ticket => {
    const line = ticket.querySelector('.ft-progress'), css = getComputedStyle(line);
    return { image: ticket.classList.contains('is-image'), paper: line.parentElement.className, left: css.left, right: css.right, height: css.height, bottom: css.bottom, color: css.backgroundColor, opacity: css.opacity, scale: new DOMMatrix(css.transform).a, numericLabel: /[0-9]+%/.test(ticket.textContent) };
  })`);
  assert.deepEqual(progress.map(value => value.image), [false, true]);
  for (const line of progress) {
    assert.equal(line.paper, "ft-body"); assert.equal(line.left, "3px"); assert.equal(line.right, "3px");
    assert.equal(line.height, "1px"); assert.equal(line.bottom, "0px"); assert.equal(line.color, "rgb(59, 77, 90)");
    assert.equal(Number(line.opacity), 0.35); assert.ok(Math.abs(line.scale - 0.4) < 0.01, JSON.stringify(line)); assert.equal(line.numericLabel, false);
  }
  await evaluate("feedback.uploaded(); new Promise(requestAnimationFrame)");
  await evaluate("Promise.all(progressNodes.flatMap(line => line.getAnimations().map(animation => animation.finished))).then(() => null)");
  await waitFor(() => evaluate("!document.querySelector('.ft-progress') && progressNodes.every(line=>!line.isConnected)"), "completed progress removed");
  await evaluate("feedback.saveFiles()");
  await waitFor(() => evaluate("document.querySelectorAll('[data-role=user] .ft').length===2 && !document.querySelector('.ft-progress')"), "saved file and image tickets have no progress");
  assert.deepEqual(errors, []);
  console.log("PASS immediate avatar/thinking, stable reply nodes, failure feedback, avatar decoding and 1px image/file upload progress.");
} catch (error) {
  console.error(errors);
  throw error;
} finally {
  cdp?.close();
  const exited = once(browser, "exit");
  spawnSync("taskkill.exe", ["/PID", String(browser.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  await exited;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  assert.equal(path.dirname(profile), workspace);
  await rm(profile, { recursive: true, maxRetries: 5, retryDelay: 200 });
}
