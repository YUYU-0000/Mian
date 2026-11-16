// 验证缓存优先读取、顺序补发、鉴权中断和离线外壳升级。
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { build } from "esbuild";
import { WebSocket, WebSocketServer } from "ws";
import { mp3 } from "./voiceFixtures.mjs";

const directory = await mkdtemp(path.join(tmpdir(), "mian-offline-"));
const dist = path.resolve("client/dist");
const now = new Date().toISOString();
const conversation = {
  conversationId: "c1", threadId: null, parentConversationId: null,
  rootNumber: 1, branchPath: [], branchCounter: 0, abbr: "C-01", title: "離線會話", frontName: "Mian", image: "", pinned: true,
  model: null, reasoningEffort: null, totalTokens: null, uncachedTotalTokens: null, lastActivityAt: now, lastMessage: "上次的內容",
  collaborationMode: null, createdAt: now, updatedAt: now
};
const file = { id: "note", name: "離線.txt", size: 15, mimeType: "text/plain", createdAt: now };
const voice = { url: "/api/voice-audio/old.mp3", text: "留下的聲音", duration: 0.4 };
const data = {
  "/api/auth/status": { configured: true, authenticated: true, canSetup: true, local: true, localBypass: true, expiresAt: Date.now() + 30 * 86400000 },
  "/api/config": { workingDirectory: "workspace", sandbox: "workspace-write", model: "cached-model", channel: { kind: "api", presetId: "p1" } },
  "/api/conversations": { defaultConversationId: "c1", conversations: [conversation] },
  "/api/conversations/c1/messages": { exists: true, eventSeq: 0, streamId: "test", groups: [{ role: "user", groupId: "u1", pending: false, time: "12:00", records: [{ messageId: "m1", text: "上次的內容", time: "12:00", files: [file] }] }] },
  "/api/clues": { cards: [{ id: "clue", title: "緩存線索", content: "內容還在", mode: "pinned", when: "", scenes: [], layout: 0, order: 0, x: 30, y: 160, w: 84, h: 88, r: 0, createdAt: now, updatedAt: now }], pins: [{ id: "p1", cardId: "clue", x: 0.5, y: 0.2 }, { id: "p2", cardId: "portrait", x: 0.5, y: 0.2 }], threads: [{ from: "p1", to: "p2" }], portrait: { x: 160, y: 160, w: 84, h: 88, r: 0 } },
  "/api/font-presets": { presets: [{ id: "1", name: "預設", face: "", view: "Still water.", size: 14.5 }], activeId: "1", style: { face: "", size: 14.5 } },
  "/api/voice-presets": { presets: [{ id: "v1", note: "離線語音", voice_id: "v", voice_name: "聲音", model: "voice-model", words: "陪你", hasKey: true }], activeId: "v1" },
  "/api/api-presets": { presets: [{ id: "p1", note: "緩存通道", endpoint: "https://example.invalid", model: "cached-model", format: "openai", hasKey: true }], activeId: "p1" },
  "/api/subscriptions/codex": { loggedIn: true, account: "cached@example.com", plan: "plus", model: "cached-model" },
  "/api/subscriptions/codex/quota": { left: 73, resetAt: "明天" },
};
const harness = await build({
  stdin: {
    resolveDir: process.cwd(), contents: `
  import { api } from './client/src/api';
  import * as offline from './client/src/offline';
  import { readOffline, writeOffline } from './client/src/offlineStorage';
  import { backendAvailable, backendAuthorized, setBackendAuthorized } from './client/src/backend';
  import { cachedFile, cachedFileUrl } from './client/src/fileCache';
  import { voicePlayer } from './client/src/voicePlayer';
  import { writeMedia, readSettingsMedia } from './client/src/mediaStorage';
  window.test = { api, ...offline, readOffline, writeOffline, backendAvailable, backendAuthorized, setBackendAuthorized, cachedFile, cachedFileUrl, voicePlayer, writeMedia, readSettingsMedia };
  offline.startOfflineSync();
` }, bundle: true, write: false, format: "iife"
});
let apiDown = false, unauthorized = false, failedSave = false, version = 1, delayRead = false, releaseRead;
const writes = [], apiRequests = [];
const app = express();
app.use(express.json());
app.get("/offline-test", (_req, res) => res.type("html").send('<script src="/offline-harness.js"></script>'));
app.get("/offline-harness.js", (_req, res) => res.type("js").send(harness.outputFiles[0].text));
app.get("/sw.js", async (_req, res) => res.set("Cache-Control", "no-store").type("js").send((await readFile(path.join(dist, "sw.js"), "utf8")).replace(/mian-shell-([a-f0-9]+)/, `mian-shell-$1-test${version}`)));
app.use("/api", async (req, res) => {
  const url = `/api${req.path}`;
  apiRequests.push(url);
  if (unauthorized) return res.status(401).json({ error: "login required" });
  if (apiDown) return res.status(503).json({ error: "sleeping" });
  if (req.method === "GET") {
    if (url.endsWith("/files/note")) return res.type("text").set("X-File-Created-At", now).send("文件也還在");
    if (url === voice.url) return res.type("audio/mpeg").set("X-File-Created-At", now).send(mp3());
    if (!(url in data)) return res.status(404).json({ error: url });
    const value = structuredClone(data[url]);
    if (url === "/api/clues" && delayRead) await new Promise(resolve => { releaseRead = resolve; });
    return res.json(value);
  }
  writes.push({ url, body: req.body });
  if (failedSave && url === "/api/clues") return res.status(400).json({ error: "try later" });
  if (url === "/api/font-presets") {
    const settings = data[url];
    settings.presets = [...settings.presets.filter(p => p.id !== req.body.preset.id), req.body.preset];
    return res.json(settings);
  }
  if (url.endsWith("/activity")) return res.json({ conversation: Object.assign(conversation, req.body) });
  if (url === "/api/conversations/c1/messages") return res.json(data[url]);
  if (req.method === "PUT") { data[url] = req.body; return res.json(req.body); }
  res.json({ ok: true });
});
app.get(["/", "/index.html", "/chat", "/clues", "/settings", "/connections"], async (_req, res) => res.type("html").send((await readFile(path.join(dist, "index.html"), "utf8")).replace("<head>", `<head><meta name="test-build" content="${version}">`)));
app.use(express.static(dist));
const server = createServer(app);
const sockets = new WebSocketServer({ server, path: "/ws" });
sockets.on("connection", socket => socket.send(JSON.stringify({
  kind: "session", streamId: "test", seq: 0, reset: false,
  ...data["/api/conversations"], activeTurns: {}, connectionStatus: { state: "ready", message: "connected" }, channel: { kind: "api", presetId: "p1", name: "緩存通道" }
})));
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port, base = `http://127.0.0.1:${port}`;
const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  "--headless=new", "--remote-debugging-port=9378", `--user-data-dir=${path.join(directory, "browser")}`,
  "--no-first-run", "--disable-background-networking", "--disable-background-timer-throttling", "--autoplay-policy=no-user-gesture-required", "about:blank",
], { windowsHide: true, stdio: "ignore" });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (read, label) => {
  const end = Date.now() + 20000;
  while (Date.now() < end) { if (await read()) return; await sleep(50); }
  throw new Error(label);
};
let cdp;
try {
  let targets;
  await waitFor(async () => { try { targets = await (await fetch("http://127.0.0.1:9378/json")).json(); return true; } catch { return false; } }, "browser");
  cdp = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await once(cdp, "open");
  const pending = new Map(), errors = [];
  let id = 0;
  cdp.on("message", raw => {
    const message = JSON.parse(String(raw));
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description);
    const task = pending.get(message.id);
    if (task) { pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); cdp.send(JSON.stringify({ id: next, method, params })); });
  const evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description);
    return result.result.value;
  };
  const navigate = async route => {
    await call("Page.navigate", { url: base + route });
    await waitFor(() => evaluate(`location.pathname===${JSON.stringify(route)} && ${route === "/offline-test" ? "!!window.test" : "!!document.querySelector('.route-transition-frame')"}`), route);
  };
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Network.enable");
  await call("Network.setCacheDisabled", { cacheDisabled: true });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await navigate("/offline-test");
  await evaluate(`Promise.all([test.api.clues(), test.api.getConfig(), test.api.fontPresets(), test.api.voicePresets(), test.api.apiPresets(), test.api.subStatus('codex'), test.api.subQuota('codex'), test.api.listConversations(), test.api.loadMessages('c1'), test.cachedFile('/api/conversations/c1/files/note'), test.cachedFile(${JSON.stringify(voice.url)})])`);
  await evaluate(`test.writeMedia('LauncherDB','mediaStore','savedMediaFile_home_photo_widget',new Blob(['local photo'],{type:'video/mp4'}))`);
  await evaluate(`(async()=>{
    const canvas=document.createElement('canvas'); canvas.width=canvas.height=24;
    canvas.getContext('2d').fillRect(0,0,24,24);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    await test.writeMedia('LauncherDB','mediaStore','savedMediaFile_avatar_assistant',blob);
  })()`);
  delayRead = true;
  data["/api/clues"].cards[0].title = "遠端更新";
  assert.equal(await evaluate("test.api.clues().then(wall=>wall.cards[0].title)"), "緩存線索");
  await waitFor(() => Boolean(releaseRead), "background read");
  await evaluate("window.updates=[]; window.stop=test.api.clues.watch(value=>updates.push(value.cards[0].title))");
  releaseRead(); delayRead = false;
  await waitFor(() => evaluate("updates.includes('遠端更新')"), "silent update");

  // 挂起的旧 GET 不能覆盖刚排队的本地保存。
  delayRead = true; releaseRead = undefined;
  await evaluate("test.api.clues()");
  await waitFor(() => Boolean(releaseRead), "stale read");
  apiDown = true;
  await evaluate("test.api.test().catch(()=>{})");
  await evaluate("test.api.clues().then(wall=>test.api.saveClueWall({...wall,cards:wall.cards.map(card=>({...card,title:'離線修改'}))}))");
  releaseRead(); delayRead = false;
  await evaluate("test.api.saveFontPreset({id:'offline-font',name:'離線字體',face:'',view:'Saved',size:14.5})");
  await evaluate("test.api.getConfig().then(config=>test.api.saveConfig({...config,model:'offline-model'}))");
  assert.equal(await evaluate("test.readOffline('/api/clues').then(wall=>wall.cards[0].title)"), "離線修改");
  await navigate("/offline-test");
  assert.equal(await evaluate("test.api.clues().then(wall=>wall.cards[0].title)"), "離線修改");
  assert.equal(await evaluate("test.readOffline('outbox').then(queue=>queue.length)"), 3);
  assert.equal(await evaluate("test.api.fileText('c1','note',new AbortController().signal)"), "文件也還在");
  assert.equal(await evaluate("test.readSettingsMedia('home_photo_widget').then(blob=>blob.text())"), "local photo");
  await evaluate(`test.voicePlayer.play('offline',async()=>(${JSON.stringify(voice)}))`);
  assert.equal(await evaluate("test.voicePlayer.getSnapshot().id"), null);

  apiDown = false; failedSave = true;
  await evaluate("window.dispatchEvent(new Event('online'))");
  await waitFor(() => writes.length > 0, "first queued attempt");
  assert.deepEqual(writes.map(write => write.url), ["/api/clues"]);
  assert.equal(await evaluate("test.readOffline('outbox').then(queue=>queue.length)"), 3);
  failedSave = false;
  await waitFor(() => evaluate("test.readOffline('outbox').then(queue=>queue.length===0)"), "ordered retry");
  assert.deepEqual(writes.map(write => write.url), ["/api/clues", "/api/clues", "/api/font-presets", "/api/config"]);
  assert.equal(data["/api/config"].model, "offline-model");

  apiDown = true;
  await evaluate("test.api.test().catch(()=>{})");
  await evaluate("test.api.getConfig().then(config=>test.api.saveConfig({...config,model:'after-login'}))");
  apiDown = false; unauthorized = true;
  await evaluate("window.locks=0; window.addEventListener('mian:login-required',()=>locks++); test.flushOfflineSaves().catch(()=>{})");
  await waitFor(() => evaluate("locks===1 && !test.backendAuthorized()"), "401 requires login");
  const after401 = apiRequests.length;
  await evaluate("Promise.all([test.flushOfflineSaves().catch(()=>{}), test.api.clues.refresh().catch(()=>{}), Promise.resolve(window.dispatchEvent(new Event('online')))])");
  assert.equal(apiRequests.length, after401, "logged-out requests and outbox do not keep retrying");
  assert.equal(await evaluate("test.readOffline('outbox').then(queue=>queue.length)"), 1);
  unauthorized = false;
  await evaluate("test.setBackendAuthorized(true); test.flushOfflineSaves()");
  assert.equal(data["/api/config"].model, "after-login");

  delayRead = true; releaseRead = undefined;
  await navigate("/");
  await waitFor(() => evaluate("!document.querySelector('.auth-page')"), "home gate finishes");
  assert.ok(releaseRead, "gate preloads wall data before the wall is opened");
  assert.match(await evaluate("document.documentElement.style.getPropertyValue('--avatar-assistant')"), /blob:/, "portrait preloaded with home");
  await evaluate(`
    const observer=new MutationObserver(()=>{
      const wall=document.querySelector('.clues-page');
      if(!wall) return;
      window.firstWall={cards:wall.querySelectorAll('.item.card').length,pins:wall.querySelectorAll('.pin').length,threads:wall.querySelectorAll('.threads g').length,portrait:wall.querySelectorAll('.portrait .ph').length};
      observer.disconnect();
    });
    observer.observe(document,{subtree:true,childList:true});
    document.querySelector('[aria-label="線索"]').click();
  `);
  await waitFor(() => evaluate("!!window.firstWall"), "first wall frame");
  assert.deepEqual(await evaluate("firstWall"), { cards: 1, pins: 2, threads: 1, portrait: 1 });
  releaseRead(); delayRead = false;

  // 旧缓存即便是一面空墙，迟到的完整响应也要更新所有墙面元素。
  await navigate("/offline-test");
  await evaluate("test.writeOffline({'/api/clues':{cards:[],pins:[],threads:[],portrait:" + JSON.stringify(data["/api/clues"].portrait) + "}})");
  delayRead = true; releaseRead = undefined;
  await navigate("/clues");
  assert.equal(await evaluate("document.querySelectorAll('.clues-page .item.card').length"), 0);
  releaseRead(); delayRead = false;
  await waitFor(() => evaluate("document.querySelectorAll('.clues-page .item.card').length===1 && document.querySelectorAll('.clues-page .pin').length===2 && document.querySelectorAll('.clues-page .threads g').length===1"), "empty cache replaced by the complete wall");
  await waitFor(() => evaluate("!!navigator.serviceWorker.controller"), "shell installation");
  await navigate("/chat");
  await waitFor(() => evaluate("document.body.textContent.includes('上次的內容')"), "chat loaded");
  await navigate("/clues");
  await waitFor(() => evaluate("document.body.textContent.includes('離線修改')"), "wall loaded");
  for (const socket of sockets.clients) socket.terminate();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await call("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate("!!document.querySelector('.clues-page') && document.body.textContent.includes('離線修改')"), "offline shell and wall");
  await navigate("/chat");
  await waitFor(() => evaluate("document.body.textContent.includes('上次的內容')"), "offline chat");
  await evaluate("document.querySelector('[aria-label=\"查看 離線.txt\"]').click()");
  await waitFor(() => evaluate("document.body.textContent.includes('文件也還在')"), "offline file preview");
  await navigate("/settings");
  await waitFor(() => evaluate("!!document.querySelector('.settings-page') && !!document.querySelector('.vc-page')"), "offline settings");
  await navigate("/connections");
  await waitFor(() => evaluate("!!document.querySelector('#apiTie')"), "connections loaded");
  await evaluate("document.querySelector('#apiTie').click()");
  await waitFor(() => evaluate("!!document.querySelector('#apiTrack .api-sheet input[value=\"緩存通道\"]')"), "offline API presets");
  const requestsBefore = apiRequests.length;
  assert.equal(await evaluate("fetch('/api/config').then(()=>true,()=>false)"), false, "API is never answered by the service worker");
  assert.equal(apiRequests.length, requestsBefore);
  assert.equal(await evaluate("caches.keys().then(keys=>Promise.all(keys.map(key=>caches.open(key).then(cache=>cache.keys())))).then(groups=>groups.flat().some(request=>new URL(request.url).pathname.startsWith('/api/')))"), false);

  data["/api/clues"].cards[0].title = "恢復後的線索";
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  await navigate("/clues");
  await waitFor(() => evaluate("document.body.textContent.includes('恢復後的線索')"), "reconnect refresh");
  version = 2;
  await evaluate("window.openingIdentity='same document'");
  await evaluate("navigator.serviceWorker.getRegistration().then(registration=>registration.update())");
  await waitFor(() => evaluate("navigator.serviceWorker.getRegistration().then(registration=>!!registration.waiting)"), "new shell waits for next cold start");
  assert.equal(await evaluate("openingIdentity==='same document' && document.querySelector('meta[name=test-build]').content==='1'"), true);
  await call("Page.navigate", { url: "about:blank" });
  await sleep(800);
  await navigate("/clues");
  await waitFor(() => evaluate("document.querySelector('meta[name=test-build]')?.content==='2' && !!document.querySelector('.clues-page')"), "new shell on next opening");
  assert.deepEqual(errors, []);
  console.log("PASS: cache-first reads, silent updates, stale reads, durable ordered retries, cached files/voice/media, stopped-server navigation, API bypass and shell upgrades");
} finally {
  cdp?.close();
  const exited = browser.exitCode === null ? once(browser, "exit") : Promise.resolve();
  spawnSync("taskkill.exe", ["/PID", String(browser.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  await exited;
  for (const socket of sockets.clients) socket.terminate();
  sockets.close();
  server.closeAllConnections();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  assert.equal(path.dirname(directory), tmpdir());
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
