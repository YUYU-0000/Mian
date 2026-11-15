import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { build } from "esbuild";
import { WebSocket } from "ws";

const profile = await mkdtemp(path.join(tmpdir(), "mian-codex-tools-"));
const bundle = await build({
  entryPoints: ["tests/codexToolEvents.fixture.tsx"], bundle: true, write: false,
  outdir: profile, format: "iife", platform: "browser", jsx: "automatic",
  external: ["/grain.png"],
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
  "--headless=new", "--remote-debugging-port=9371", `--user-data-dir=${profile}`,
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
    try { targets = await (await fetch("http://127.0.0.1:9371/json")).json(); return true; }
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
  const notify = (method, params) => evaluate(`codexNotification(${JSON.stringify(method)},${JSON.stringify(params)})`);
  await call("Runtime.enable");
  await call("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
  await waitFor(() => evaluate("typeof codexNotification==='function'"), "fixture ready");
  await notify("turn/started", { turn: { id: "tool-turn" } });
  await notify("item/agentMessage/delta", { delta: "<mian-pre-tool>我看一下。</mian-pre-tool>" });
  await waitFor(() => evaluate("document.querySelector('.archive-bubble')?.textContent==='我看一下。'"), "pre-tool text finishes");

  await notify("rawResponseItem/completed", { item: {
    type: "custom_tool_call", call_id: "clock", name: "exec", input: "text(await tools.clock__curr_time({}));",
  } });
  await waitFor(() => evaluate("!!document.querySelector('.tool-calls-module .archive-module-header .hourglass')"), "TOOL CALLS shows running");
  await evaluate("document.querySelector('.tool-calls-module .archive-module-header').click()");
  await waitFor(() => evaluate("document.querySelector('.tool-calls-module').classList.contains('is-expanded')"), "tool module opens");
  assert.equal(await evaluate("document.querySelector('[data-tool-id=clock] .hourglass').getBoundingClientRect().width>0"), true);

  await notify("rawResponseItem/completed", { item: {
    type: "custom_tool_call_output", call_id: "clock",
    output: [{ type: "input_text", text: "Script completed" }, { type: "input_text", text: "clock-result" }],
  } });
  await waitFor(() => evaluate("!!document.querySelector('[data-tool-id=clock] .status-success')"), "same tool row completes");
  assert.equal(await evaluate("document.querySelectorAll('[data-tool-id=clock]').length"), 1);
  assert.equal(await evaluate("!!document.querySelector('.tool-calls-module .archive-module-header .hourglass')"), false);
  await evaluate("document.querySelector('[data-tool-id=clock] .step-head').click()");
  await waitFor(() => evaluate("document.querySelector('[data-tool-id=clock] .archive-tool-output')?.textContent.includes('clock-result')"), "completed tool result remains expandable");
  await notify("turn/completed", { turn: { id: "tool-turn", status: "completed" } });
  assert.deepEqual(errors, []);
  console.log("PASS Codex raw exec notification -> chat session -> TOOL CALLS running state -> same-row completion and expandable output.");
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
