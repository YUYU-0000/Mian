import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { WebSocket } from "ws";
import { fileTicketServer } from "./fileTickets.server.mjs";

const backend = await fileTicketServer();
const browser = spawn(
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  [
    "--headless=new",
    "--remote-debugging-port=9363",
    `--user-data-dir=${path.join(backend.directory, "browser")}`,
    "--no-first-run",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
const waitFor = async (read, name) => {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(name);
};
let cdp, call;
try {
  let targets;
  await waitFor(async () => {
    try {
      targets = await (await fetch("http://127.0.0.1:9363/json")).json();
      return true;
    } catch {
      return false;
    }
  }, "启动浏览器");
  cdp = new WebSocket(
    targets.find((target) => target.type === "page").webSocketDebuggerUrl,
  );
  await once(cdp, "open");
  const pending = new Map(),
    errors = [];
  let id = 0;
  cdp.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.exception?.description);
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
  });
  call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const next = ++id;
      pending.set(next, { resolve, reject });
      cdp.send(JSON.stringify({ id: next, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.exception?.description);
    return result.result.value;
  };
  const click = (selector) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (name, value) =>
    evaluate(`(() => {
    const field = document.querySelector('[name=${name}]');
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  })()`);
  const visible = (selector) =>
    waitFor(
      () => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),
      selector,
    );
  const cards = async () => (await fetch(backend.base + "/api/clues")).json();
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await call("Page.navigate", { url: backend.base });
  await visible('.home-app-icon[aria-label="線索"]');
  await click('.home-app-icon[aria-label="線索"]');
  await waitFor(
    () =>
      evaluate(
        `location.pathname === '/clues' && !document.querySelector('[data-transition-active=true]') && !!document.querySelector('.clues-header button:not(:disabled):last-child')`,
      ),
    "線索入口和切页",
  );
  await click(".clues-header button:last-child");
  const title = "這是一張可以左右滑動完整讀取的線索卡片標題".repeat(3);
  await fill("title", title);
  await fill("content", "第一行\n第二行");
  await fill("mode", "trigger");
  await fill("keywords", "Hello, 世界 語音，test");
  await click('[name="voice"]');
  await click('.clues-actions [type="submit"]');
  await visible(".clues-list .clues-card");
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('.mail.is-in.is-ok')?.textContent.includes('線索已保存')`,
      ),
    "保存纸条",
  );
  const [saved] = await cards();
  assert.deepEqual(saved.keywords, ["Hello", "世界", "語音", "test"]);
  assert.deepEqual(saved.scenes, ["voice"]);
  assert.equal(saved.content, "第一行\n第二行");
  assert.equal(saved.title, title);
  assert.ok(saved.id);
  assert.deepEqual(
    await evaluate(`(() => {
    const text = document.querySelector('.clues-card .scroll-text');
    text.scrollLeft = 70;
    return [text.scrollLeft > 0, getComputedStyle(text).textOverflow];
  })()`),
    [true, "clip"],
  );
  await call("Page.reload");
  await visible(".clues-card");
  await click(".clues-card");
  assert.equal(
    await evaluate(`document.querySelector('[name=voice]').checked`),
    true,
  );
  await fill("title", "更新標題");
  await evaluate(
    `window.originalFetch = window.fetch; window.fetch = (url, init) => String(url).startsWith('/api/clues/') && init?.method === 'PUT' ? Promise.resolve(new Response(JSON.stringify({error:'測試保存失敗'}), {status:500,headers:{'Content-Type':'application/json'}})) : window.originalFetch(url, init)`,
  );
  await click('.clues-actions [type="submit"]');
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('.mail.is-in.is-fail')?.textContent.includes('線索保存失敗')`,
      ),
    "失败纸条",
  );
  assert.equal(
    await evaluate(`document.querySelector('[name=title]').value`),
    "更新標題",
  );
  await evaluate("window.fetch = window.originalFetch");
  await fill("mode", "pinned");
  assert.equal(
    await evaluate(`!!document.querySelector('[name=keywords]')`),
    false,
  );
  await click('.clues-actions [type="submit"]');
  await visible('.clues-list [data-mode="pinned"] .clues-card');
  assert.deepEqual((await cards())[0].scenes, []);
  assert.deepEqual((await cards())[0].keywords, []);
  await click(".clues-card");
  await click('.clues-actions [type="button"]');
  await visible(".clues-list");
  assert.deepEqual(await cards(), []);
  await click(".clues-back");
  await waitFor(
    () =>
      evaluate(
        `location.pathname === '/' && !document.querySelector('[data-transition-active=true]')`,
      ),
    "返回主屏",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS clues: 主屏入口、增改删、关键词与场景、保存纸条、刷新持久化、横向滑动。",
  );
} finally {
  const exited = once(browser, "exit");
  if (call) await call("Browser.close");
  else
    spawnSync("taskkill.exe", ["/PID", String(browser.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  await exited;
  cdp?.close();
  await backend.close();
}
