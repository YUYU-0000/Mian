import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { build } from "esbuild";
import { WebSocket } from "ws";

const profile = await mkdtemp(path.join(tmpdir(), "mian-connection-transitions-"));
const bundle = await build({
  entryPoints: ["tests/connectionTransitions.fixture.tsx"], bundle: true, write: false,
  outdir: profile, format: "iife", platform: "browser", jsx: "automatic",
  external: ["/grain.png"],
  define: { "process.env.NODE_ENV": '"production"' },
});
const page = await readFile("client/dist/index.html", "utf8");
const style = page.match(/<link rel="stylesheet"[^>]*href="([^"]+\.css)"/)[1];
const app = express();
app.get("/fixture.js", (_req, res) => res.type("js").send(bundle.outputFiles.find((file) => file.path.endsWith(".js")).text));
app.get("/fixture.css", (_req, res) => res.type("css").send(bundle.outputFiles.find((file) => file.path.endsWith(".css")).text));
app.get("/", (_req, res) => res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${style}"><link rel="stylesheet" href="/fixture.css"><style>#text-probe{position:fixed;left:0;bottom:0}</style><div id="root"></div><script src="/fixture.js"></script>`));
app.use(express.static("client/dist"));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  "--headless=new", "--remote-debugging-port=9374", `--user-data-dir=${profile}`,
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
    try { targets = await (await fetch("http://127.0.0.1:9374/json")).json(); return true; }
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
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
  await waitFor(()=>evaluate("!!document.querySelector('#codexTie')"),'connection fixture');
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const sub='#subTrack .cover:not([inert])';
  const apiPaper='.api-sheet:not([inert])';
  const visibleValues=()=>evaluate(`([...document.querySelectorAll('${sub} .cover-link-text')].map(el=>({text:el.textContent,opacity:getComputedStyle(el).opacity})))`);
  assert.equal(await evaluate("!!document.querySelector('.stack.is-visible')"),false);
  await click('#codexTie');
  await waitFor(()=>evaluate(`document.querySelector('${sub} .js-quota-v').textContent==='剩餘 65%'`),'subscription values');
  for(let i=0;i<4;i++){
    await click(`${sub} .js-model`);
    await waitFor(()=>evaluate("!!document.querySelector('.hang-tag.is-visible .tag-option')"),'subscription tag');
    await click(`.hang-tag.is-visible .tag-option:nth-child(${i%2+1})`);
    await click('#paperOverlay');
    await click('#codexTie');
  }
  await waitFor(()=>evaluate(`document.querySelector('${sub} .js-model-v').textContent==='sub-b' && state.saving===0`),'latest subscription selection');
  await sleep(360);
  assert.deepEqual(await visibleValues(),[{text:'PLUS',opacity:'1'},{text:'sub-b',opacity:'1'},{text:'剩餘 65%',opacity:'1'}]);
  assert.equal(await evaluate('state.maxSaving'),1,'model reconnects are serialized');
  await evaluate("state.failSave=true");
  await click(`${sub} .js-model`);
  await waitFor(()=>evaluate("!!document.querySelector('.hang-tag.is-visible .tag-option')"),'failure tag');
  await click('.hang-tag.is-visible .tag-option');
  await sleep(450);
  assert.equal((await visibleValues())[1].text,'sub-b');
  await evaluate("state.failSave=false");
  await evaluate(`document.querySelector('${sub} .js-model').click();document.querySelector('#paperOverlay').click()`);
  await sleep(550);
  assert.equal(await evaluate("!!document.querySelector('.hang-tag.is-visible')"),false,'late subscription list stays closed');
  await click('#apiTie');
  await waitFor(()=>evaluate(`document.querySelector('${apiPaper} .js-note')?.value==='second'`),'active API page');
  for(let i=0;i<3;i++){
    await click(`${apiPaper} .js-model`);
    await waitFor(()=>evaluate("!!document.querySelector('.hang-tag.is-visible .tag-option')"),'api tag');
    await click(`.hang-tag.is-visible .tag-option:nth-child(${i%2+1})`);
  }
  await evaluate(`document.querySelector('${apiPaper} .js-model').click();document.querySelector('#paperOverlay').click()`);
  await sleep(550);
  assert.equal(await evaluate("!!document.querySelector('.hang-tag.is-visible')"),false,'late API list stays closed');
  assert.ok(await evaluate("[...document.querySelectorAll('.choice-tag .tag-overlay,.choice-tag .hang-tag')].every(el=>getComputedStyle(el).pointerEvents==='none')"));
  await click('.mail');
  await sleep(550);
  const back=await evaluate("(()=>{const r=document.querySelector('.back-btn').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()");
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...back,button:'left',clickCount:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',...back,button:'left',clickCount:1});
  assert.equal(await evaluate('state.back'),1,'back receives the actual pointer click');
  await evaluate('reset()');
  await sleep(250);
  assert.equal(await evaluate("!!document.querySelector('.stack.is-visible')"),false,'draft cache never auto-opens a paper');
  await click('#apiTie');
  await waitFor(()=>evaluate(`document.querySelector('${apiPaper} .js-note')?.value==='second'`),'draft position restored on explicit opening');
  await evaluate('state.failTest=true');
  await click(`${apiPaper} .js-test`);
  await sleep(450);
  assert.equal(await evaluate(`document.querySelector('${apiPaper} .js-status').textContent`),'IN USE');
  await evaluate('state.failModels=true');
  await click(`${apiPaper} .js-model`);
  await waitFor(()=>evaluate(`!!document.querySelector('${apiPaper} input.js-model')`),'model failure returns manual entry');
  assert.ok(await evaluate(`!!document.querySelector('${apiPaper} input.js-model').value`));
  await click('#paperOverlay');
  await evaluate("text('');void 0");
  await sleep(25);
  await evaluate("text('latest');void 0");
  await sleep(400);
  assert.deepEqual(await evaluate("(()=>{const el=document.querySelector('#text-probe span');return [el.textContent,getComputedStyle(el).opacity,el.getAnimations().length]})()"),['latest','1',0]);
  await evaluate("text('cancelled-transition');void 0");
  await sleep(30);
  await evaluate("document.querySelector('#text-probe span').getAnimations().forEach(a=>a.cancel())");
  await sleep(60);
  assert.equal(await evaluate("document.querySelector('#text-probe span').textContent"),'cancelled-transition');
  await evaluate("probe(false);void 0");
  await sleep(20);
  await evaluate("text('remounted');probe(true);void 0");
  await sleep(40);
  assert.equal(await evaluate("document.querySelector('#text-probe span').textContent"),'remounted');
  assert.equal(await evaluate("[...document.querySelectorAll('.choice-tag textPath')].every(el=>document.getElementById(el.getAttribute('href').slice(1)).closest('.choice-tag')===el.closest('.choice-tag'))"),true);
  assert.deepEqual(errors,[]);
  console.log('PASS rapid model choices, immediate back, late-list suppression, save/test/list failure recovery, overview entry with cached drafts, text interruption and independent ChoiceTag instances.');
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
