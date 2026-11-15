import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { build } from "esbuild";
import { WebSocket } from "ws";

const workspace = process.cwd();
const profile = await mkdtemp(path.join(tmpdir(), "mian-voice-preview-"));
const bundle = await build({
  entryPoints: ["tests/voicePreview.fixture.tsx"],
  bundle: true,
  write: false,
  outdir: profile,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
const page = await readFile("client/dist/index.html", "utf8");
const style = page.match(/<link rel="stylesheet"[^>]*href="([^"]+\.css)"/)[1];
const app = express();
app.get("/fixture.js", (_req, res) =>
  res
    .type("js")
    .send(bundle.outputFiles.find((file) => file.path.endsWith(".js")).text),
);
app.get("/fixture.css", (_req, res) =>
  res
    .type("css")
    .send(bundle.outputFiles.find((file) => file.path.endsWith(".css")).text),
);
app.get("/", (_req, res) =>
  res.send(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${style}"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>`,
  ),
);
app.use(express.static(path.join(workspace, "client/dist")));
const samples = 56000;
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i / 8000 * Math.PI * 880) * 12000), 44 + i * 2);
app.get('/tone.wav', (_req, res) => res.set('X-File-Created-At', '2024-02-03T12:34:56.000Z').type('audio/wav').send(wav));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const debugPort = 9359;
const browser = spawn(
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (read, description) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await sleep(40);
  }
  throw new Error(description);
};
let cdp;
try {
  let targets;
  await waitFor(async () => {
    try {
      targets = await (
        await fetch(`http://127.0.0.1:${debugPort}/json`)
      ).json();
      return true;
    } catch {
      return false;
    }
  }, "Edge did not start");
  cdp = new WebSocket(
    targets.find((target) => target.type === "page").webSocketDebuggerUrl,
  );
  await once(cdp, "open");
  const pending = new Map();
  const errors = [];
  let nextId = 0;
  cdp.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.method === "Runtime.exceptionThrown")
      errors.push(
        message.params.exceptionDetails.exception?.description ??
          message.params.exceptionDetails.text,
      );
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      cdp.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      userGesture: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.exception?.description);
    return result.result.value;
  };
  const click = (selector) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

  const settled = () => evaluate("Promise.all(Array.from(document.querySelectorAll('.pv-viewer *')).flatMap(el => el.getAnimations()).map(a => a.finished))");
  const closePreview = async () => {
    await click('.pv-mask');
    await waitFor(() => evaluate("!document.querySelector('.pv-viewer')"), 'preview close');
  };
  const show = (clip, fallback, id) => evaluate(`showVoice(${JSON.stringify(clip)},${JSON.stringify(fallback ?? null)},${JSON.stringify(id ?? 'voice')})`);
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
  await call('Emulation.setTouchEmulationEnabled', {enabled:true});
  await call('Page.navigate', {url:`http://127.0.0.1:${server.address().port}`});
  await waitFor(() => evaluate("!!document.querySelector('.voice-generating')"), 'pending voice');
  assert.equal(await evaluate("document.querySelector('.voice-generating').textContent"), '生成中');
  assert.equal(await evaluate("document.querySelector('.voice-play').disabled"), true);
  assert.equal(await evaluate("document.querySelector('.voice-transcript')"), null);
  await click('.voice-ticket .ft-act');
  await waitFor(() => evaluate("!!document.querySelector('.pv.is-ready')"), 'pending transcript preview');
  await settled();
  assert.equal(await evaluate("document.querySelector('.pv-kicker').textContent"), 'VOICE  語音');
  assert.match(await evaluate("document.querySelector('.pv-name').textContent"), /^\d{4}\.\d{2}\.\d{2}  沈眠$/);
  assert.equal(await evaluate("document.querySelector('.pv-file-content').textContent"), '陪你等天亮。');
  assert.equal(await evaluate("voicePlayer.getSnapshot().id"), null);
  const transcript = '[softly, close] ' + '陪你等天亮。\n'.repeat(80);
  const clip = {url:'/tone.wav',text:transcript,duration:7,peaks:Array(38).fill(.5)};
  // 记录真实执行的动画，文本与条码都先淡出，换内容后再淡入。
  await evaluate(`window.voiceAnimations=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){
    if(this.matches('.voice-wave-slot,.ft-meta b span,.pv-name .scroll-text-content > span,.pv-voice-text code > span'))
      voiceAnimations.push({target:this.className || this.parentElement.className || this.parentElement.tagName,duration:options.duration});
    return animate.call(this,frames,options);
  }`);
  await show(clip);
  await waitFor(() => evaluate("document.querySelectorAll('.voice-wave i').length === 38 && document.querySelector('.pv-name').textContent === '2024.02.03  沈眠'"), 'generated voice and original send date');
  await waitFor(() => evaluate("voiceAnimations.some(a => a.target === 'voice-wave-slot' && a.duration === 180)"), 'barcode fade in');
  const animations = await evaluate('voiceAnimations');
  assert.deepEqual(animations.filter(a => a.target === 'voice-wave-slot').map(a => a.duration), [140,180]);
  assert.ok(animations.some(a => a.target === 'B' && a.duration === 140));
  assert.ok(animations.some(a => a.target === 'scroll-text-content' && a.duration === 180));
  assert.equal(await evaluate("document.querySelector('.ft-meta').textContent"), '00:07台詞');
  assert.equal(await evaluate("document.querySelector('.pv-name').textContent"), '2024.02.03  沈眠');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.pv-name')).whiteSpace"), 'pre');
  assert.equal(await evaluate("document.querySelector('.pv-voice-text').textContent.includes('[')"), false);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.pv-voice-text code')).fontSize"), '12px');
  assert.equal(await evaluate("document.querySelectorAll('.pv-under').length"), 2);
  assert.equal(await evaluate("document.querySelector('.pv-file-content').scrollHeight > document.querySelector('.pv-file-content').clientHeight"), true);
  await evaluate("document.querySelector('.pv-file-content').scrollTop=120");
  assert.ok(await evaluate("document.querySelector('.pv-file-content').scrollTop > 0"));
  await click('.pv-foot .voice-play');
  await waitFor(() => evaluate("document.querySelectorAll('.voice-play.is-playing').length === 2"), 'shared playing state');
  await click('.pv-foot .voice-play');
  await waitFor(() => evaluate("document.querySelectorAll('.voice-play.is-playing').length === 0"), 'shared paused state');
  await closePreview();
  await click('.voice-ticket .voice-play');
  await waitFor(() => evaluate("voicePlayer.getSnapshot().playing"), 'ticket playback');
  assert.equal(await evaluate("document.querySelector('.pv-viewer')"), null);
  await click('.voice-ticket .voice-play');
  await waitFor(() => evaluate("!voicePlayer.getSnapshot().playing"), 'pause before seeking');
  await evaluate(`const wave=document.querySelector('.voice-wave'),r=wave.getBoundingClientRect();wave.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));`);
  await waitFor(() => evaluate("voicePlayer.getSnapshot().playing && voicePlayer.getSnapshot().currentTime >= 3.4"), 'barcode seek');
  assert.equal(await evaluate("document.querySelector('.pv-viewer')"), null);
  await click('.voice-ticket .ft-stub');
  await waitFor(() => evaluate("!!document.querySelector('.pv.is-ready')"), 'stub opens preview');
  await settled();
  await click('.pv-foot .voice-play');
  await waitFor(() => evaluate("!voicePlayer.getSnapshot().playing"), 'preview pauses active ticket');
  const point = await evaluate("(()=>{const r=document.querySelector('.pv-kicker').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()");
  await call('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[point]});
  for (let step=1;step<=6;step++) {
    await call('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x:point.x,y:point.y+160*step/6}]});
    await sleep(16);
  }
  await call('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  await waitFor(() => evaluate("!document.querySelector('.pv-viewer')"), 'drag closes voice preview');

  const failed = {url:'',text:'[quietly amused] 陪你。'};
  await show(failed, null, 'failed');
  await click('.voice-ticket .ft');
  await waitFor(() => evaluate("!!document.querySelector('.pv.is-ready')"), 'failure preview begins pending');
  const failedName = await evaluate("document.querySelector('.pv-name').textContent");
  await show(failed, 'failed', 'failed');
  await waitFor(() => evaluate("document.querySelector('.archive-bubble')?.textContent === '陪你。'"), 'failed generation fades to text');
  assert.equal(await evaluate("document.querySelector('.pv-name').textContent"), failedName);
  assert.equal(await evaluate("document.querySelector('.voice-ticket')"), null);
  assert.equal(await evaluate("document.querySelector('.pv-foot .voice-play').disabled"), true);
  assert.equal(await evaluate("document.querySelector('.pv-file-content').textContent"), '陪你。');
  await closePreview();
  assert.deepEqual(errors, []);
  console.log('PASS voice transcript preview date and signature, ticket duration, transitions, scrolling, synchronized playback, seek, drag/mask close and failure fallback.');
} finally {
  cdp?.close();
  const exited = once(browser, "exit");
  spawnSync("taskkill.exe", ["/PID", String(browser.pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  await exited;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  assert.equal(path.dirname(profile), tmpdir());
  await rm(profile, { recursive: true });
}
