import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { build } from "esbuild";
import { WebSocket } from "ws";

const directory = await mkdtemp(path.join(tmpdir(), "mian-image-compression-"));
const bundle = await build({
  entryPoints: ["tests/imageCompression.fixture.tsx"], bundle: true, write: false,
  outdir: directory, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
let records = [], patches = 0;
const app = express();
app.use(express.json({ limit: "50mb" }));
app.get("/fixture.js", (_req, res) => res.type("js").send(bundle.outputFiles.find((file) => file.path.endsWith(".js")).text));
app.get("/fixture.css", (_req, res) => res.type("css").send(bundle.outputFiles.find((file) => file.path.endsWith(".css")).text));
app.get("/", (_req, res) => res.send('<!doctype html><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>'));
app.put("/seed", (req, res) => { records = req.body; patches = 0; res.json({}); });
app.get("/api/conversations", (_req, res) => res.json({ defaultConversationId: "image-test", conversations: records }));
app.patch("/api/conversations/:id", (req, res) => {
  const conversation = records.find((item) => item.conversationId === req.params.id);
  Object.assign(conversation, req.body);
  patches++;
  res.json({ conversation });
});
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  "--headless=new", "--remote-debugging-port=9369", `--user-data-dir=${directory}`,
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
    try { targets = await (await fetch("http://127.0.0.1:9369/json")).json(); return true; }
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
  await call("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
  await waitFor(() => evaluate("window.ready"), "fixture startup");
  await evaluate("(async()=>{window.landscape=await image(2400,1800);window.portrait=await image(1800,2400);window.small=await image(320,180);encodes.length=0})()");

  assert.deepEqual(await evaluate("compressImage(small).then(describe)"), { width: 320, height: 180, type: "image/webp" });
  assert.deepEqual(await evaluate("compressImage(portrait,1200).then(describe)"), { width: 900, height: 1200, type: "image/webp" });
  assert.deepEqual(await evaluate("encodes"), [["image/webp", .85], ["image/webp", .85]]);

  await evaluate("(async()=>{await seedMedia('home_photo_widget',landscape);encodes.length=0;renderMedia()})()");
  await waitFor(() => evaluate("!!document.querySelector('img.uploaded-media')"), "legacy home photo loads");
  assert.deepEqual(await evaluate("rawMedia('home_photo_widget').then(describe)"), { width: 1600, height: 1200, type: "image/webp" });
  assert.equal(await evaluate("encodes.length"), 1);
  assert.deepEqual(await evaluate("readSettingsMedia('home_photo_widget').then(describe)"), { width: 1600, height: 1200, type: "image/webp" });
  assert.equal(await evaluate("encodes.length"), 1, "reading a migrated photo does not encode again");

  await evaluate("(async()=>{await seedMedia('home_photo_left',small);await seedMedia('home_photo_wide',landscape);await seedMedia('home_photo_right',new Blob(['video fixture'],{type:'video/mp4'}));window.photos=await exportHomePhotos()})()");
  assert.deepEqual(await evaluate("fetch(photos.home_photo_wide).then(r=>r.blob()).then(describe)"), { width: 1600, height: 1200, type: "image/webp" });
  assert.deepEqual(await evaluate("fetch(photos.home_photo_left).then(r=>r.blob()).then(describe)"), { width: 320, height: 180, type: "image/png" });
  assert.equal(await evaluate("fetch(photos.home_photo_right).then(r=>r.text())"), "video fixture");
  await evaluate("(async()=>{photos.home_photo_wide=await blobToDataURL(portrait);await restoreHomePhotos(photos)})()");
  assert.deepEqual(await evaluate("rawMedia('home_photo_wide').then(describe)"), { width: 1200, height: 1600, type: "image/webp" });
  const restoredEncodes = await evaluate("encodes.length");
  await evaluate("exportHomePhotos().then(restoreHomePhotos)");
  assert.equal(await evaluate("encodes.length"), restoredEncodes, "compressed backups are not encoded again");

  // A valid PNG with trailing bytes exercises the original-file 5 MB limit.
  await evaluate("window.savedRaf=requestAnimationFrame;window.mediaFrames=[];window.requestAnimationFrame=callback=>mediaFrames.push(callback);upload('.file-input',new Blob([landscape,new Uint8Array(6*1024*1024)],{type:'image/png'}))");
  await waitFor(() => evaluate("!!document.querySelector('img.developing')"), "large upload reaches the shared developing effect");
  assert.deepEqual(await evaluate("(()=>{const s=getComputedStyle(document.querySelector('img.developing'));return [s.transitionDuration,s.filter,s.opacity]})()"), ["0.5s, 0.8s, 0.75s", "blur(8px) grayscale(1) brightness(1.2)", "0"]);
  assert.deepEqual(await evaluate("rawMedia('home_photo_widget').then(describe)"), { width: 1600, height: 1200, type: "image/webp" });
  await evaluate("window.requestAnimationFrame=savedRaf;mediaFrames.forEach(callback=>callback(performance.now()))");
  await waitFor(() => evaluate("!document.querySelector('.developing')"), "developing effect finishes");

  await evaluate(`(async()=>{
    const image=await blobToDataURL(portrait);
    await fetch('/seed',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify([{
      conversationId:'image-test',threadId:null,parentConversationId:null,rootNumber:1,branchPath:[],branchCounter:0,
      abbr:'C-01',title:'Image test',frontName:'Image test',image,pinned:false,model:null,reasoningEffort:null,
      totalTokens:null,uncachedTotalTokens:null,lastActivityAt:null,lastMessage:null,collaborationMode:null,
      createdAt:'2026-11-15',updatedAt:'2026-11-15'
    }])});
    encodes.length=0;
    await renderTickets();
  })()`);
  await waitFor(() => evaluate("!!document.querySelector('.mini-box')"), "ticket drawer loads migrated image");
  assert.deepEqual(await evaluate("fetch(document.querySelector('.ticket-bg-img').src).then(r=>r.blob()).then(describe)"), { width: 900, height: 1200, type: "image/webp" });
  assert.ok(records[0].image.startsWith("data:image/webp;base64,"));
  assert.equal(patches, 1);
  await evaluate("api.listConversations()");
  assert.equal(patches, 1, "migrated conversation image is not written again");
  assert.equal(await evaluate("encodes.length"), 1);
  await evaluate("document.querySelector('.mini-box').click();upload('#ticketDrawer input[type=file]',landscape)");
  await waitFor(() => patches === 2, "ticket upload saves compressed dataURL");
  assert.deepEqual(await evaluate("api.listConversations().then(data=>fetch(data.conversations[0].image)).then(r=>r.blob()).then(describe)"), { width: 1200, height: 900, type: "image/webp" });
  assert.deepEqual(errors, []);
  console.log("PASS WebP dimensions/quality, home and ticket uploads, one-time legacy migration, backups, video preservation, and unchanged developing effect.");
} finally {
  const exited = once(browser, "exit");
  if (call) await call("Browser.close");
  else browser.kill();
  await exited;
  cdp?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  assert.equal(path.dirname(directory), tmpdir());
  await rm(directory, { recursive: true, force: true });
}
