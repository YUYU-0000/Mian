import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { applyReplyEvent } from "../shared/chatModel.mjs";
import { fileTicketServer } from "./fileTickets.server.mjs";

const content = "第一行\n\n\n  縮進保持\n";
const reply = '<mian-bubble>前段</mian-bubble><mian-file name="note.txt">' + content +
  '</mian-file><voice>收好。</voice><mian-file name="data.json">{"value":1}</mian-file><mian-bubble>後段\n' +
  '[沙盒](sandbox:/mnt/data/a.txt) [本機](file:///C:/a.txt) [路徑](/mnt/data/a.txt) ' +
  '[相對](./a.txt) [缺檔](/api/conversations/c1/files/missing) <a href="C:/a.txt">磁碟</a> ' +
  '[網站](https://example.com)</mian-bubble>';
const backend = await fileTicketServer({ reply, voice: true });
const request = async (url, method = "GET", body) => {
  const response = await fetch(backend.base + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(response.ok, await response.clone().text());
  return response.status === 204 ? null : response.json();
};
const upload = await (await fetch(`${backend.base}/api/conversations/c1/files?name=existing.txt`, {
  method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: "existing",
})).json();
await request("/api/voice-presets", "POST", { id: "speech", note: "", key: "fake", voice_id: "speaker", model: "eleven_v4", words: "" });
await request("/api/voice-presets/speech/use", "POST");
let seed = applyReplyEvent([], { type: "assistant-delta", turnId: "existing", format: "plain", delta: `[已有文件](/api/conversations/c1/files/${upload.id})` }, "12:00");
seed = applyReplyEvent(seed, { type: "turn-completed", turnId: "existing", status: "completed" }, "12:00");
const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  "--headless=new", "--remote-debugging-port=9375", `--user-data-dir=${path.join(backend.directory, "browser")}`,
  "--no-first-run", "--disable-background-networking", "--disable-background-timer-throttling", "about:blank",
], { windowsHide: true, stdio: "ignore" });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (read, label) => {
  const deadline = Date.now() + 35000;
  while (Date.now() < deadline) { if (await read()) return; await sleep(50); }
  throw new Error(label);
};
let cdp;
try {
  let targets;
  await waitFor(async () => {
    try { targets = await (await fetch("http://127.0.0.1:9375/json")).json(); return true; }
    catch { return false; }
  }, "browser start");
  cdp = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await once(cdp, "open");
  let id = 0;
  const pending = new Map(), errors = [];
  cdp.on("message", raw => {
    const message = JSON.parse(String(raw));
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description);
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    cdp.send(JSON.stringify({ id: messageId, method, params }));
  });
  const evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description);
    return result.result.value;
  };
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: path.join(backend.directory, "downloads") });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `if(location.origin===${JSON.stringify(backend.base)}&&!localStorage.getItem('mian.conversation.c1.mian.chat-groups.v2'))localStorage.setItem('mian.conversation.c1.mian.chat-groups.v2',${JSON.stringify(JSON.stringify(seed))})` });
  await call("Page.navigate", { url: backend.base + "/chat" });
  await waitFor(() => evaluate("!!document.querySelector('.archive-input textarea') && !!document.querySelector('.reply-markdown a')"), "valid existing file link");
  assert.equal(await evaluate("document.querySelector('.reply-markdown a').textContent"), "已有文件");
  await evaluate("document.querySelector('.archive-input textarea').focus()");
  await call("Input.insertText", { text: "發文件。" });
  await evaluate("document.querySelector('.archive-input button[type=submit]').click()");
  await waitFor(() => evaluate("document.querySelector('.archive-input textarea').value===''"), "save user record");
  await evaluate("document.querySelector('.archive-input button[type=submit]').click()");
  await waitFor(() => evaluate("document.querySelectorAll('.archive-reply-body > .ft').length===2 && document.querySelectorAll('.reply-markdown a').length===2 && !document.querySelector('.cursor-blink')"), "mixed files, voice and bubbles");
  const body = ".archive-msg[data-role=assistant]:last-child .archive-reply-body";
  assert.deepEqual(await evaluate(`[...document.querySelector(${JSON.stringify(body)}).children].map(el=>el.classList.contains('voice-reply')?'voice':el.classList.contains('ft')?'file':'text')`), ["text", "file", "voice", "file", "text"]);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.reply-markdown a')].map(el=>el.textContent)"), ["已有文件", "網站"]);
  for (const label of ["沙盒", "本機", "路徑", "相對", "缺檔", "磁碟"])
    assert.ok(await evaluate(`document.querySelector(${JSON.stringify(body)}).textContent.includes(${JSON.stringify(label)})`));
  await evaluate(`document.querySelector(${JSON.stringify(body + " > .ft")}).click()`);
  await waitFor(() => evaluate("!!document.querySelector('.pv.is-ready .pv-file-content pre')"), "file preview");
  assert.equal(await evaluate("document.querySelector('.pv-file-content pre').textContent"), content);
  await evaluate("document.querySelector('.pv-download').click()");
  await waitFor(async () => { try { return await readFile(path.join(backend.directory, "downloads/note.txt"), "utf8") === content; } catch { return false; } }, "real browser download");
  await evaluate("document.querySelector('.pv-mask').click()");
  await call("Page.reload");
  await waitFor(() => evaluate("document.querySelectorAll('.archive-reply-body > .ft').length===2"), "persisted file tickets");
  assert.equal(await evaluate("document.querySelectorAll('.ft.archive-pop-in').length"), 0);
  await request("/api/subscriptions/codex/use", "POST");
  await evaluate("document.querySelector('.archive-input textarea').focus()");
  await call("Input.insertText", { text: "再發一份。" });
  await evaluate("document.querySelector('.archive-input button[type=submit]').click()");
  await waitFor(() => evaluate("document.querySelector('.archive-input textarea').value===''"), "save Codex user record");
  await evaluate("document.querySelector('.archive-input button[type=submit]').click()");
  await waitFor(() => evaluate("[...document.querySelectorAll('.ft-name')].some(el=>el.textContent==='generated.html')"), "Codex captured file ticket");
  await evaluate("[...document.querySelectorAll('.ft-name')].find(el=>el.textContent==='generated.html').closest('.ft').click()");
  await waitFor(() => evaluate("document.querySelector('.pv.is-ready iframe')?.srcdoc.includes('local file')"), "Codex HTML preview");
  assert.deepEqual(errors, []);
  console.log("PASS API mixed order, file preview/download, local and missing links as text, valid links, reload, Codex workspace tickets and preview.");
} finally {
  cdp?.close();
  const exited = once(browser, "exit");
  spawnSync("taskkill.exe", ["/PID", String(browser.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  await exited;
  await backend.close();
}
