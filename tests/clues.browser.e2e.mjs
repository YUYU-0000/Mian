// 验证线索墙布局、回弹、卡片图钉操作、持久化与备份。
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { WebSocket } from "ws";
import { fileTicketServer } from "./fileTickets.server.mjs";
import { testWallOverscroll } from "./clueWallOverscroll.browser.mjs";

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
  const readWall = async () =>
    await (await fetch(backend.base + "/api/clues")).json();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const point = async (selector, fx = 0.5, fy = 0.5) =>
    evaluate(
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.left+r.width*${fx},y:r.top+r.height*${fy}}; })()`,
    );
  const mouse = (type, p) =>
    call("Input.dispatchMouseEvent", {
      type,
      x: p.x,
      y: p.y,
      button: "left",
      buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: type === "mouseMoved" ? 0 : 1,
    });
  const tap = async (selector) => {
    const p = await point(selector);
    await mouse("mousePressed", p);
    await mouse("mouseReleased", p);
  };
  const drag = async (selector, dx, dy, hold = 0) => {
    const p = await point(selector);
    await mouse("mousePressed", p);
    if (hold) await sleep(hold);
    for (let i = 1; i <= 5; i++)
      await mouse("mouseMoved", {
        x: p.x + (dx * i) / 5,
        y: p.y + (dy * i) / 5,
      });
    await mouse("mouseReleased", { x: p.x + dx, y: p.y + dy });
  };
  const dropPin = async (p) => {
    const start = await point(".tp");
    await mouse("mousePressed", start);
    await mouse("mouseMoved", p);
    await mouse("mouseReleased", p);
  };
  const clearEdit = async () => {
    await mouse("mousePressed", { x: 365, y: 600 });
    await mouse("mouseReleased", { x: 365, y: 600 });
  };
  const dismissNotice = async () =>
    evaluate("document.querySelector('.mail.is-in')?.click()");
  const now = new Date().toISOString();
  const seed = await readWall();
  const coords = [
    [20, 126, -4],
    [150, 120, 2],
    [262, 134, 5],
    [24, 268, 3],
    [282, 262, -3],
    [70, 410, -2],
    [232, 414, 4],
    [150, 540, 0],
  ];
  seed.cards = coords.map(([x, y, r], layout) => ({
    id: "card-" + layout,
    title: ["人設", "紀念日", "關於你", "關係", "語音", "規矩", "睡前", "便箋"][
      layout
    ],
    content: "這是卡片正文。",
    mode: layout === 1 ? "trigger" : "pinned",
    when: layout === 1 ? "聊到紀念日的時候" : "",
    scenes: [],
    layout,
    x,
    y,
    w: 84,
    h: 88,
    r,
    order: layout,
    createdAt: now,
    updatedAt: now,
  }));
  await fetch(backend.base + "/api/clues", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(seed),
  });
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
  await waitFor(() => evaluate("!document.querySelector('.auth-page')"), "开门动画结束");
  await click('.home-app-icon[aria-label="線索"]');
  await waitFor(
    () =>
      evaluate(
        "location.pathname==='/clues' && !document.querySelector('[data-transition-active=true]') && document.querySelectorAll('.item.card').length===8",
      ),
    "線索墙入口",
  );
  await testWallOverscroll({ call, evaluate, waitFor, click, point, mouse });
  assert.equal(
    await evaluate("document.querySelector('.right-decor').textContent"),
    "CLUE WALL線索",
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.clues-page .halo').length"),
    3,
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.threads path').length"),
    0,
  );
  await evaluate(
    `document.documentElement.style.setProperty('--avatar-assistant','url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Crect width=%2240%22 height=%2240%22 fill=%22%237590a3%22/%3E%3C/svg%3E")')`,
  );
  assert.match(
    await evaluate(
      "getComputedStyle(document.querySelector('.portrait .ph')).backgroundImage",
    ),
    /data:image\/svg/,
  );
  await evaluate("document.fonts.ready");
  const screenshot = await call("Page.captureScreenshot", { format: "png" });
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(".tmp-clues-wall.png", Buffer.from(screenshot.data, "base64")),
  );

  await evaluate("window.originalRandom = Math.random; Math.random = () => .9");
  await click(".envc");
  await visible(".ov.show");
  await sleep(320);
  assert.equal(await evaluate("document.querySelectorAll('.pp').length"), 8);
  await drag('.pp[data-layout="0"]', -90, 0);
  await waitFor(
    () => evaluate("document.querySelector('.pick b').textContent==='票根'"),
    "向左换纸",
  );
  await sleep(220);
  await drag('.pp[data-layout="1"]', 90, 0);
  await waitFor(
    () => evaluate("document.querySelector('.pick b').textContent==='索引卡'"),
    "向右换纸",
  );
  await sleep(320);
  await tap('.pp[data-layout="0"]');
  await visible(".item.card.land");
  const addedId = await evaluate("document.querySelector('.item.card.land').dataset.id");
  assert.equal(await evaluate("!!document.querySelector('.sw')"), false);
  await waitFor(() => evaluate("!document.querySelector('.item.land')"), "新卡片收起落在墙上");
  await tap(`.item[data-id="${addedId}"]`);
  await visible(".sw.show");
  const longTitle = "這是一張能左右滑動閱讀完整標題的線索卡片";
  await fill("title", longTitle);
  await fill("content", "第一行\n第二行 <b>原樣保存</b>");
  await click('.mode [data-mode="trigger"]');
  await fill("when", "想念對方的時候");
  await click('[data-scene="voice"]');
  await click(".done");
  await waitFor(() => evaluate("!document.querySelector('.sw')"), "收起保存");
  await waitFor(async () => (await readWall()).cards.length === 9, "新增落盘");
  const added = (await readWall()).cards.at(-1);
  await evaluate("Math.random = window.originalRandom");
  assert.equal(added.title, longTitle);
  assert.equal(added.layout, 0);
  assert.equal(added.when, "想念對方的時候");
  assert.deepEqual(added.scenes, ["voice"]);
  assert.equal(added.content, "第一行\n第二行 <b>原樣保存</b>");
  assert.equal(added.w, 84);
  assert.equal(added.h, 88);
  await dismissNotice();

  // 移动卡片、长按和自由缩放。
  const first = '.item[data-id="card-0"]';
  const before = (await readWall()).cards[0];
  await drag(first, 22, 28);
  await waitFor(
    async () => (await readWall()).cards[0].x > before.x + 20,
    "位置保存",
  );
  assert.equal(await evaluate("!!document.querySelector('.sw')"), false);
  const press = await point(first);
  await mouse("mousePressed", press);
  await sleep(550);
  await mouse("mouseReleased", press);
  await visible(first + ".edit .handle");
  await drag(first + " .handle", 36, 24);
  await waitFor(async () => (await readWall()).cards[0].w > 100, "大小保存");
  await clearEdit();
  assert.equal(await evaluate("!!document.querySelector('.item.edit')"), false);

  // 图钉在旋转卡片上存比例，连线跟着拖动，点两颗钉子切换连接。
  const pinTarget = await point(first, 0.5, 0.18);
  await dropPin(pinTarget);
  await waitFor(async () => (await readWall()).pins.length === 1, "卡片图钉");
  let data = await readWall();
  const pinA = data.pins[0];
  assert.equal(pinA.cardId, "card-0");
  assert.ok(pinA.x >= 0 && pinA.x <= 1 && pinA.y >= 0 && pinA.y <= 1);
  await dropPin({ x: 26, y: 570 });
  await waitFor(async () => (await readWall()).pins.length === 2, "墙面图钉");
  const pinB = (await readWall()).pins[1];
  assert.equal(pinB.cardId, null);
  const pa = `[data-pin="${pinA.id}"]`,
    pb = `[data-pin="${pinB.id}"]`;
  await tap(pa);
  await tap(pb);
  await waitFor(
    async () => (await readWall()).threads.length === 1,
    "连接图钉",
  );
  assert.equal(await evaluate("!!document.querySelector('.pin.sel')"), false);

  await dropPin({ x: 350, y: 570 });
  await waitFor(async () => (await readWall()).pins.length === 3, "第三颗图钉");
  const pc = `[data-pin="${(await readWall()).pins[2].id}"]`;
  const originalThread = (await readWall()).threads;
  await tap(pc);
  assert.deepEqual((await readWall()).threads, originalThread);
  await tap(pc);
  assert.equal(await evaluate("!!document.querySelector('.pin.sel')"), false);
  assert.deepEqual((await readWall()).threads, originalThread);
  const cp = await point(pc);
  await mouse("mousePressed", cp);
  await sleep(1050);
  await mouse("mouseReleased", cp);
  await waitFor(async () => (await readWall()).pins.length === 2, "拔掉第三颗图钉");
  assert.deepEqual((await readWall()).threads, originalThread);

  await tap(pb);
  await tap(pa);
  await waitFor(
    async () => (await readWall()).threads.length === 0,
    "反向点选已有连接的两颗图钉删除连线",
  );
  assert.equal(await evaluate("!!document.querySelector('.pin.sel')"), false);
  await tap(pa);
  await tap(pa);
  assert.equal(await evaluate("!!document.querySelector('.pin.sel')"), false);
  assert.deepEqual((await readWall()).threads, []);
  await tap(pa);
  await tap(pb);
  await waitFor(
    async () => (await readWall()).threads.length === 1,
    "重新连接图钉",
  );
  const oldPin = await point(pa),
    oldPath = await evaluate(
      "document.querySelector('.threads path').getAttribute('d')",
    );
  await drag(first, 25, 12);
  const newPin = await point(pa);
  assert.ok(Math.abs(newPin.x - oldPin.x - 25) < 1);
  assert.ok(Math.abs(newPin.y - oldPin.y - 12) < 1);
  assert.notEqual(
    await evaluate("document.querySelector('.threads path').getAttribute('d')"),
    oldPath,
  );
  const pBeforeResize = await point(pa);
  const p = await point(first, 0.7, 0.6);
  await mouse("mousePressed", p);
  await sleep(550);
  await mouse("mouseReleased", p);
  await drag(first + " .handle", 25, 20);
  const pAfterResize = await point(pa);
  assert.ok(
    Math.hypot(
      pAfterResize.x - pBeforeResize.x,
      pAfterResize.y - pBeforeResize.y,
    ) > 1,
  );
  await waitFor(
    async () => (await readWall()).cards[0].w > 130,
    "缩放连带图钉保存",
  );
  assert.deepEqual((await readWall()).pins[0], pinA);
  await clearEdit();
  const bp = await point(pb);
  await mouse("mousePressed", bp);
  await sleep(1050);
  await mouse("mouseReleased", bp);
  await waitFor(async () => (await readWall()).pins.length === 1, "长按拔掉");
  assert.deepEqual((await readWall()).threads, []);

  // 肖像使用同一套拖动和缩放。
  await drag(".portrait", 16, 12);
  const portraitPoint = await point(".portrait");
  await mouse("mousePressed", portraitPoint);
  await sleep(550);
  await mouse("mouseReleased", portraitPoint);
  await drag(".portrait .handle", 20, 14);
  await waitFor(
    async () => (await readWall()).portrait.w > 115,
    "肖像位置和大小保存",
  );
  await clearEdit();

  // 服务端拒绝保存时保留草稿；500 属于离线排队，不再是页面报错。
  // 撕掉必须确认两次并删除所属图钉。
  await tap(first);
  await visible(".sw.show");
  await fill("title", "保存失敗的草稿");
  await evaluate(
    `window.originalFetch=window.fetch;window.fetch=(url,init)=>url==='/api/clues' && init?.method==='PUT'?Promise.resolve(new Response(JSON.stringify({error:'測試失敗'}),{status:400,headers:{'Content-Type':'application/json'}})):window.originalFetch(url,init)`,
  );
  await click(".done");
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.mail.is-in.is-fail')?.textContent.includes('線索保存失敗')",
      ),
    "失败纸条",
  );
  assert.equal(
    await evaluate("document.querySelector('[name=title]').value"),
    "保存失敗的草稿",
  );
  await evaluate("window.fetch=window.originalFetch");
  await click(".tear");
  assert.equal(
    (await readWall()).cards.some((c) => c.id === "card-0"),
    true,
  );
  await click(".tear");
  await waitFor(() => evaluate("!document.querySelector('.sw')"), "撕掉");
  data = await readWall();
  assert.equal(
    data.cards.some((c) => c.id === "card-0"),
    false,
  );
  assert.equal(
    data.pins.some((p) => p.cardId === "card-0"),
    false,
  );
  const backupResponse = await fetch(backend.base + "/api/backup");
  assert.equal(backupResponse.status, 200, await backupResponse.clone().text());
  const backup = await backupResponse.json();
  assert.deepEqual(backup.clues, data);
  await call("Page.reload");
  await visible(".portrait");
  await waitFor(() => evaluate("!document.querySelector('.auth-page')"), "刷新后开门动画结束");
  await waitFor(
    () => evaluate("document.querySelectorAll('.item.card').length===8"),
    "刷新恢复墙面",
  );
  assert.deepEqual(await readWall(), data);

  // 小屏上纸片和编辑页保持在屏幕内。
  await call("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 568,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await click(".envc");
  await visible(".ov.show");
  await sleep(320);
  assert.equal(
    await evaluate(
      "[...document.querySelectorAll('.pp')].filter(e=>getComputedStyle(e).opacity==='1').every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=320&&r.top>=0&&r.bottom<=568})",
    ),
    true,
  );
  await tap('.pp[data-layout="0"]');
  await visible(".item.card.land");
  const smallCardId = await evaluate("document.querySelector('.item.card.land').dataset.id");
  await waitFor(() => evaluate("!document.querySelector('.item.land')"), "小屏卡片收起");
  await tap(`.item[data-id="${smallCardId}"]`);
  await visible(".sw.show");
  await sleep(280);
  assert.equal(
    await evaluate(
      "(()=>{const r=document.querySelector('.sheet').getBoundingClientRect();return r.left>=0&&r.right<=320&&r.top>=0&&r.bottom<=568})()",
    ),
    true,
  );
  await click(".done");
  await waitFor(() => evaluate("!document.querySelector('.sw')"), "小屏收起");
  await click(".back-btn");
  await waitFor(
    () =>
      evaluate(
        "location.pathname==='/' && !document.querySelector('[data-transition-active=true]')",
      ),
    "返回主屏",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS clues wall: 8 layouts, envelope swipes, editing, dragging, resize, pins, threads, portrait, persistence, backup and small screen.",
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
