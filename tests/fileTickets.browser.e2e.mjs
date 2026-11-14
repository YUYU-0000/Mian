import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { fileTicketServer, imageBytes } from "./fileTickets.server.mjs";

const backend = await fileTicketServer();
const filename = "這是一個需要左右滑動才能完整讀出的附件設計稿.md";
const inputPath = path.join(backend.directory, filename);
const imagePath = path.join(backend.directory, "照片.png");
const uploadedImageBytes = Buffer.concat([
  imageBytes,
  Buffer.alloc(256 * 1024),
]);
await writeFile(inputPath, "# 附件内容\n" + "Mian file test.\n".repeat(8192));
await writeFile(imagePath, uploadedImageBytes);
const browser = spawn(
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  [
    "--headless=new",
    "--remote-debugging-port=9357",
    `--user-data-dir=${path.join(backend.directory, "browser")}`,
    "--no-first-run",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (read, description) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await sleep(50);
  }
  throw new Error(description);
};
let cdp;
try {
  let targets;
  await waitFor(async () => {
    try {
      targets = await (await fetch("http://127.0.0.1:9357/json")).json();
      return true;
    } catch {
      return false;
    }
  }, "浏览器启动");
  cdp = new WebSocket(
    targets.find((target) => target.type === "page").webSocketDebuggerUrl,
  );
  await once(cdp, "open");
  let id = 0;
  const pending = new Map();
  const errors = [];
  cdp.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.exception?.description);
    const task = pending.get(message.id);
    if (task) {
      pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error.message));
      else task.resolve(message.result);
    }
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const messageId = ++id;
      pending.set(messageId, { resolve, reject });
      cdp.send(JSON.stringify({ id: messageId, method, params }));
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
  const request = async (url, method = "GET", body) => {
    const response = await fetch(backend.base + url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.status === 204 ? null : response.json();
  };
  const selectFiles = async (files) => {
    const { root } = await call("DOM.getDocument");
    const { nodeId } = await call("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: '.archive-input input[type="file"]',
    });
    await call("DOM.setFileInputFiles", { nodeId, files });
  };
  const clickSend = () =>
    evaluate(
      `document.querySelector('.archive-input button[type="submit"]').click()`,
    );
  const type = async (text) => {
    await evaluate(`document.querySelector('.archive-input textarea').focus()`);
    await call("Input.insertText", { text });
  };
  const closePreview = async () => {
    await evaluate(`document.querySelector('.pv-mask').click()`);
    await waitFor(
      () => evaluate(`!document.querySelector('.pv-viewer')`),
      "关闭预览",
    );
  };
  const imageTicket = (selector) =>
    evaluate(`(() => {
    const ticket=document.querySelector(${JSON.stringify(selector)}), style=getComputedStyle(ticket);
    return {width:ticket.offsetWidth,height:ticket.offsetHeight,paper:style.getPropertyValue('--t-paper').trim(),ink:style.getPropertyValue('--t-ink').trim(),kicker:ticket.querySelector('.ft-kicker').textContent,action:ticket.querySelector('.ft-act').textContent,thumb:!!ticket.querySelector('.ft-thumb'),size:ticket.querySelector('.ft-meta').textContent.includes('KB')};
  })()`);
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Network.enable");
  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true });
  await call("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: path.join(backend.directory, "downloads"),
  });
  await call("Page.navigate", { url: backend.base + "/chat" });
  await waitFor(
    () => evaluate(`!!document.querySelector('.archive-input textarea')`),
    "打开对话页",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.archive-input input[type="file"]').multiple`,
    ),
    true,
  );
  const sentImageStyle = {
    width: 228,
    height: 74,
    paper: "#6b8396",
    ink: "#f5f2ec",
    kicker: "IMAGE · 圖片",
    action: "查看",
    thumb: true,
    size: true,
  };
  await call("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: 64000,
  });
  await selectFiles([inputPath, imagePath]);
  await waitFor(
    () => evaluate(`!!document.querySelector('.file-drafts .ft-progress')`),
    "上传进度票根",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.archive-input button[type="submit"]').disabled`,
    ),
    true,
  );
  assert.deepEqual(
    await imageTicket(".file-draft .ft.is-image"),
    sentImageStyle,
  );
  assert.equal(
    await evaluate(
      `!!document.querySelector('.file-draft .ft.is-image .ft-progress')`,
    ),
    true,
  );
  assert.ok(
    await evaluate(
      `getComputedStyle(document.querySelector('.file-draft .ft-thumb')).backgroundImage.includes('blob:')`,
    ),
  );
  await evaluate(`document.querySelector('.file-draft .ft.is-image').click()`);
  await waitFor(
    () =>
      evaluate(`document.querySelector('.pv.is-ready img')?.naturalWidth===1`),
    "上传期间查看本地图片",
  );
  assert.ok(
    await evaluate(
      `document.querySelector('.pv-acts a').href.startsWith('blob:')`,
    ),
  );
  await closePreview();
  await waitFor(
    () =>
      evaluate(
        `document.querySelectorAll('.file-draft').length === 2 && !document.querySelector('.ft-progress')`,
      ),
    "多文件上传完成",
  );
  await call("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  assert.deepEqual(
    await evaluate(`(() => {
    const ticket = document.querySelector('.file-draft .ft'), name=ticket.querySelector('.ft-name'), style=getComputedStyle(ticket);
    return { width:ticket.getBoundingClientRect().width,height:ticket.getBoundingClientRect().height,paper:style.getPropertyValue('--t-paper').trim(),nameSize:getComputedStyle(name).fontSize,stub:ticket.querySelector('.ft-stub').getBoundingClientRect().width,overflow:name.scrollWidth>name.clientWidth,mask:getComputedStyle(name).maskImage.includes('14px') };
  })()`),
    {
      width: 228,
      height: 70,
      paper: "#6b8396",
      nameSize: "14px",
      stub: 50,
      overflow: true,
      mask: true,
    },
  );
  await evaluate(`document.querySelectorAll('.file-draft-remove')[1].click()`);
  assert.equal(
    await evaluate(`document.querySelectorAll('.file-draft').length`),
    1,
  );
  await selectFiles([imagePath]);
  await waitFor(
    () =>
      evaluate(
        `document.querySelectorAll('.file-draft').length === 2 && !document.querySelector('.ft-progress')`,
      ),
    "重新选图",
  );
  await type("看一下附件");
  await clickSend();
  await waitFor(
    () =>
      evaluate(
        `document.querySelectorAll('.archive-msg .ft.is-mine').length === 2`,
      ),
    "文字和文件留存同条记录",
  );
  await clickSend();
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('.archive-stream')?.textContent.includes('已收到文件。') && !document.querySelector('.is-streaming')`,
      ),
    "API 附件回复",
  );
  const parts = backend.received[0].messages.at(-1).content;
  assert.equal(
    parts.find((part) => part.type === "image_url").image_url.url,
    `data:image/png;base64,${uploadedImageBytes.toString("base64")}`,
  );
  assert.ok(
    parts[0].text.includes(filename) && parts[0].text.includes("# 附件内容"),
  );
  assert.deepEqual(
    await imageTicket(".archive-msg .ft.is-mine.is-image"),
    sentImageStyle,
  );
  await evaluate(
    `document.querySelector('.archive-msg .ft.is-mine.is-image').click()`,
  );
  await waitFor(
    () =>
      evaluate(`document.querySelector('.pv.is-ready img')?.naturalWidth===1`),
    "已发送图片打开共用拍立得",
  );
  assert.ok(
    await evaluate(
      `document.querySelector('.pv-viewer img').src.includes('/api/conversations/c1/files/')`,
    ),
  );
  await closePreview();

  // 文件名拖动只滚动文字，不打开图片或下载。
  const point = await evaluate(
    `(() => { const el=document.querySelector('.archive-msg .ft-name'); el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return {x:r.right-12,y:r.top+r.height/2}; })()`,
  );
  await call("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point],
  });
  await call("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: point.x - 65, y: point.y }],
  });
  await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert.ok(
    await evaluate(
      `document.querySelector('.archive-msg .ft-name').scrollLeft > 0`,
    ),
  );
  await call("Page.reload");
  await waitFor(
    () =>
      evaluate(
        `document.querySelectorAll('.archive-msg .ft.is-mine').length === 2`,
      ),
    "刷新恢复票根",
  );

  await request("/api/subscriptions/codex/use", "POST");
  await selectFiles([inputPath]);
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('.file-draft') && !document.querySelector('.ft-progress')`,
      ),
    "Codex 附件上传",
  );
  await clickSend();
  await clickSend();
  await waitFor(
    () =>
      evaluate(
        `document.querySelectorAll('.archive-msg .ft:not(.is-mine)').length === 2`,
      ),
    "Codex 输出文件和图片票根",
  );
  assert.ok(
    backend.prompts[0].includes(backend.workspace) &&
      backend.prompts[0].includes(filename),
  );
  const receivedTickets = await evaluate(
    `Array.from(document.querySelectorAll('.archive-msg .ft:not(.is-mine)')).map(el=>({name:el.querySelector('.ft-name').textContent,url:el.querySelector('a').getAttribute('href'),height:el.getBoundingClientRect().height}))`,
  );
  assert.deepEqual(
    receivedTickets.map((ticket) => ticket.height).sort(),
    [70, 74],
  );
  for (const ticket of receivedTickets) {
    const response = await fetch(backend.base + ticket.url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition"), /^attachment/);
  }
  await evaluate(
    `document.querySelector('.archive-msg .ft.is-image:not(.is-mine)').click()`,
  );
  await waitFor(
    () =>
      evaluate(`document.querySelector('.pv-viewer img')?.naturalWidth === 1`),
    "查看全屏大图",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.pv-viewer').getBoundingClientRect().height`,
    ),
    844,
  );
  await evaluate(`document.querySelector('.pv-acts a').click()`);
  await waitFor(async () => {
    try {
      return (
        await readFile(path.join(backend.directory, "downloads/generated.png"))
      ).equals(imageBytes);
    } catch {
      return false;
    }
  }, "图片保存");
  await closePreview();
  const { conversation: branch } = await request(
    "/api/conversations/c1/fork",
    "POST",
  );
  for (const ticket of receivedTickets) {
    const response = await fetch(
      backend.base + ticket.url.replace("/c1/", `/${branch.conversationId}/`),
    );
    assert.equal(response.status, 200, "分支复制输出文件");
  }
  await call("Page.reload");
  await waitFor(
    () =>
      evaluate(
        `document.querySelectorAll('.archive-msg .ft:not(.is-mine)').length === 2`,
      ),
    "刷新恢复模型文件",
  );
  await writeFile(
    path.join(process.cwd(), ".tmp-file-tickets.png"),
    Buffer.from((await call("Page.captureScreenshot")).data, "base64"),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS 390x844: 票根数值、进度、多选/移除、API 图片与文本、Codex 文件、滑动文件名、刷新、分支、全屏保存。",
  );
} finally {
  cdp?.close();
  const exited = once(browser, "exit");
  spawnSync("taskkill.exe", ["/PID", String(browser.pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  await exited;
  await backend.close();
}
