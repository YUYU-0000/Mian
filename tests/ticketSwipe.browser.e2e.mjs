import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { build } from "esbuild";
import { WebSocket } from "ws";

const profile = await mkdtemp(path.join(tmpdir(), "mian-ticket-swipe-"));
const bundle = await build({
  entryPoints: ["tests/ticketSwipe.fixture.tsx"], bundle: true, write: false,
  outdir: profile, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
const page = await readFile("client/dist/index.html", "utf8");
const style = page.match(/<link rel="stylesheet"[^>]*href="([^"]+\.css)"/)[1];
const app = express();
app.get("/fixture.js", (_req, res) => res.type("js").send(bundle.outputFiles.find((file) => file.path.endsWith(".js")).text));
app.get("/fixture.css", (_req, res) => res.type("css").send(bundle.outputFiles.find((file) => file.path.endsWith(".css")).text));
app.get("/", (_req, res) => res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${style}"><link rel="stylesheet" href="/fixture.css"><style>body,#root{height:auto;overflow:auto}#root{padding-top:20px}</style><div id="root"></div><script src="/fixture.js"></script>`));
app.use(express.static("client/dist"));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  "--headless=new", "--remote-debugging-port=9372", `--user-data-dir=${profile}`,
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
    try { targets = await (await fetch("http://127.0.0.1:9372/json")).json(); return true; }
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
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true });
  await call("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
  await waitFor(() => evaluate("document.querySelectorAll('.file-draft').length===4"), "fixture ready");
  const rect = selector => evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+30,y:r.y+r.height/2,h:r.height}})()`);
  const mouse = async (selector, dx, dy, ms=30) => {
    await call("Emulation.setTouchEmulationEnabled", { enabled: false });
    const p = await rect(selector);
    await call("Input.dispatchMouseEvent", { type:"mousePressed", x:p.x,y:p.y,button:"left",clickCount:1 });
    for(let i=1;i<=8;i++) { await call("Input.dispatchMouseEvent", {type:"mouseMoved", x:p.x+dx*i/8,y:p.y+dy*i/8,button:"left",buttons:1}); await sleep(ms); }
    const moving = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}).firstElementChild;return {transform:el.style.transform,opacity:Number(el.style.opacity),blur:el.style.filter}})()`);
    await call("Input.dispatchMouseEvent", {type:"mouseReleased",x:p.x+dx,y:p.y+dy,button:"left",clickCount:1});
    return moving;
  };
  const touch = async (dx,dy) => {
    await call("Emulation.setTouchEmulationEnabled", { enabled: true });
    const p=await rect('.file-draft');
    await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x+80,y:p.y}]});
    for(let i=1;i<=10;i++) {await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+80+dx*i/10,y:p.y+dy*i/10}]});await sleep(18);}
    await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await sleep(400);
  };
  assert.equal(await evaluate("!!document.querySelector('.file-draft-remove')"),false);
  const rebound = await mouse('.file-draft',0,25);
  assert.match(rebound.transform,/translate3d\(0(?:px)?,/);
  assert.ok(rebound.opacity >= .72 && rebound.opacity < 1);
  await waitFor(()=>evaluate("document.querySelector('.file-draft').firstElementChild.style.transform===' ' .trim()"),'draft rebounds');
  assert.equal(await evaluate('result.removed'),0);
  await mouse('.file-draft',0,-60);
  assert.equal(await evaluate('result.removed'),0);
  await touch(-140,0);
  assert.ok(await evaluate("document.querySelector('.file-drafts').scrollLeft>30"));
  const left=await evaluate("document.querySelector('.file-drafts').scrollLeft");
  // Start the right swipe on the second visible card, clear of the clipped left edge.
  await evaluate("document.querySelector('.file-drafts').scrollLeft=120");
  const p=await rect('.file-draft:nth-child(2)');
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});
  for(let i=1;i<=10;i++) {await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+80*i/10,y:p.y}]});await sleep(18);}
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await sleep(350);
  assert.ok(await evaluate("document.querySelector('.file-drafts').scrollLeft<100"));
  await evaluate("document.querySelector('.file-drafts').scrollLeft=0");
  const exiting = await mouse('.file-draft',0,45);
  assert.ok(await evaluate(`new DOMMatrix(${JSON.stringify(exiting.transform || "none")}).m42>37`), JSON.stringify(exiting));
  await waitFor(()=>evaluate('result.removed===1'),'mouse downward exit');
  assert.equal(await evaluate("!!document.querySelector('.pv-viewer')"),false);
  await touch(0,45);
  await waitFor(()=>evaluate('result.removed===2'),'touch downward exit');
  assert.equal(await evaluate("!!document.querySelector('.pv-viewer')"),false);
  await mouse('.mini-ticket-container',-30,0,80);
  await waitFor(()=>evaluate("document.querySelector('.mini-ticket-motion').style.transform===' ' .trim()"),'mini rebounds');
  assert.equal(await evaluate('result.archived'),0);
  await mouse('.mini-ticket-container',-100,0);
  await waitFor(()=>evaluate('result.exited===1'),'mini archives after left exit');
  assert.equal(await evaluate('result.archived'),1);
  assert.equal(await evaluate('result.activated'),0);
  assert.deepEqual(errors,[]);
  console.log('PASS shared ticket motion: draft mouse/touch delete, rebound, upward ignored, native horizontal scroll both ways, click suppression, unchanged MiniTicket archive.');
} finally {
  const exited = once(browser, "exit");
  if (call) await call("Browser.close");
  else browser.kill();
  await exited;
  cdp?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  assert.equal(path.dirname(profile), tmpdir());
  await rm(profile, { recursive: true, force: true });
}
