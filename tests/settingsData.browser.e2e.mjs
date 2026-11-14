import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { fileTicketServer } from "./fileTickets.server.mjs";

const backend = await fileTicketServer();
const browser = spawn(
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  [
    "--headless=new",
    "--remote-debugging-port=9360",
    `--user-data-dir=${path.join(backend.directory, "browser")}`,
    "--no-first-run",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (read, name) => {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await read()) return;
    await sleep(40);
  }
  throw new Error(name);
};
let cdp, call;
try {
  let targets;
  await waitFor(async () => {
    try {
      targets = await (await fetch("http://127.0.0.1:9360/json")).json();
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
  const input = (selector, value) =>
    evaluate(`(() => {
    const field=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(value)});
    field.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  const navigate = async (route) => {
    await evaluate("document.documentElement.dataset.oldPage = '1'");
    await call("Page.navigate", { url: backend.base + route });
    await waitFor(
      () =>
        evaluate(
          `!document.documentElement.dataset.oldPage && !!document.querySelector(${JSON.stringify(route === "/settings" ? ".settings-page" : ".archive-bubble")})`,
        ),
      `打开 ${route}`,
    );
  };
  const folder = async (selector) => {
    await click(selector);
    await evaluate(
      "Promise.all(document.querySelector('.paper-stack-container').getAnimations().map(animation=>animation.finished))",
    );
  };
  const current = "#apiWrapper .api-page:not([inert])";
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await call("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  await call("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: path.join(backend.directory, "downloads"),
  });
  await navigate("/settings");
  await evaluate(`localStorage.setItem('mian.conversation.c1.mian.chat-groups.v2', JSON.stringify([
    {role:'user',groupId:'u',time:'12:00',pending:false,records:[{messageId:'m',text:'中文 English 123',time:'12:00'}]},
    {role:'assistant',replyGroupId:'r',time:'12:01',format:'plain',raw:'中文 English 456',thinking:'',activeReasoningItemIds:[],preToolBubbles:[],preToolBubbleIds:[],preToolBubbleComplete:[],preToolComplete:true,bubbles:['中文 English 456'],bubbleIds:['b'],bubbleComplete:[true],tools:[],approvals:[],status:'completed'}
  ]))`);
  await navigate("/settings");
  await folder("#folderApiSettings");
  assert.deepEqual(
    await evaluate(
      `(() => { const page=document.querySelector('${current}'), slider=page.querySelector('input[type=range]'); return [page.querySelector('.api-polaroid-input-main').value,page.querySelector('.api-field-input').readOnly,slider.min,slider.max,slider.value,!!page.querySelector('.font-status')]; })()`,
    ),
    ["預設", true, "11.5", "17.5", "14.5", true],
  );
  await click(`${current} .apiBtnAdd`);
  await waitFor(
    () =>
      evaluate(
        `!!document.querySelector('.api-page:not([inert]):not([data-id="1"])')`,
      ),
    "新增字体纸片",
  );
  await input(`${current} .api-polaroid-input-main`, "紙上字體");
  await input(`${current} .api-field-input`, "broken CSS");
  await click(`${current} .btnTestStyle`);
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.mail-title')?.textContent === '字體無效'",
      ),
    "无效字体提示",
  );
  assert.match(
    await evaluate("document.querySelector('.mail-reason').textContent"),
    /完整的 @font-face/,
  );
  const face =
    '@font-face { font-family: "LXGW Heart Serif"; src: url("/fonts/lxgw/1e991472a5af02b5.woff2"); }';
  await input(`${current} .api-field-input`, face);
  await input(
    `${current} .api-field-row:nth-child(2) input`,
    "字體預覽 English 123",
  );
  await input(`${current} input[type=range]`, "16.5");
  await click(`${current} .btnTestStyle`);
  assert.match(
    await evaluate(
      `getComputedStyle(document.querySelector('${current} .api-field-row:nth-child(2) input')).fontFamily`,
    ),
    /MianFont_/,
  );
  assert.equal(
    await evaluate(
      "document.documentElement.style.getPropertyValue('--bubble-chinese-scale')",
    ),
    "1",
  );
  await click(`${current} .btnSaveStyle`);
  await waitFor(
    () =>
      evaluate(
        "Number(document.documentElement.style.getPropertyValue('--bubble-chinese-scale')) > 1",
      ),
    "保存应用字体",
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.font-status').length"),
    1,
  );
  await navigate("/chat");
  await waitFor(
    () =>
      evaluate(
        "Number(document.documentElement.style.getPropertyValue('--bubble-chinese-scale')) > 1",
      ),
    "读取已保存的气泡字体",
  );
  await waitFor(
    () =>
      evaluate(
        "document.querySelectorAll('.archive-bubble .bubble-chinese').length === 2",
      ),
    "双方中文气泡",
  );
  const typography =
    await evaluate(`Array.from(document.querySelectorAll('.archive-bubble')).map(bubble=>{
    const chinese=getComputedStyle(bubble.querySelector('.bubble-chinese'));
    return {size:chinese.fontSize,base:getComputedStyle(bubble).fontSize,family:chinese.fontFamily};
  })`);
  assert.equal(typography.length, 2);
  for (const item of typography) {
    assert.equal(item.size, "16.5px");
    assert.equal(item.base, "14.5px");
    assert.match(item.family, /ZSFT-br.*MianFont_active/);
  }
  assert.equal(
    await evaluate(
      "getComputedStyle(document.querySelector('.archive-avatar time')).fontSize",
    ),
    "10px",
  );
  await navigate("/settings");
  await folder("#folderWallpaperSettings");
  assert.deepEqual(
    await evaluate(
      "Array.from(document.querySelectorAll('.avatar-page .wp-typo-title')).map(el=>el.textContent)",
    ),
    ["彼方肖像", "此方肖像"],
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.avatar-page .apiBtnAdd, .avatar-page .apiBtnDel').length",
    ),
    0,
  );
  // 直接生成本地长方形图片，覆盖裁切和 IndexedDB 保存。
  await evaluate(`(async () => {
    const canvas=document.createElement('canvas'); canvas.width=180; canvas.height=100;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#93a7b5'; ctx.fillRect(0,0,180,100);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve));
    for(const role of ['assistant','user']) {
      const input=document.querySelector('.avatar-page[data-role='+role+'] input');
      const data=new DataTransfer(); data.items.add(new File([blob],role+'.png',{type:'image/png'}));
      input.files=data.files; input.dispatchEvent(new Event('change',{bubbles:true}));
    }
  })()`);
  await waitFor(
    () =>
      evaluate(
        "document.documentElement.style.getPropertyValue('--avatar-assistant') && document.documentElement.style.getPropertyValue('--avatar-user')",
      ),
    "保存双方头像",
  );
  const dimensions = await evaluate(`(async()=>{
    const db=await new Promise(resolve=>{const request=indexedDB.open('LauncherDB',1);request.onsuccess=()=>resolve(request.result)});
    const image=await new Promise(resolve=>{const request=db.transaction('mediaStore').objectStore('mediaStore').get('savedMediaFile_avatar_user');request.onsuccess=()=>resolve(request.result)});
    const bitmap=await createImageBitmap(image);return [bitmap.width,bitmap.height];
  })()`);
  assert.deepEqual(dimensions, [100, 100]);
  await navigate("/chat");
  await waitFor(
    () =>
      evaluate(
        "getComputedStyle(document.querySelector('.archive-avatar.user')).backgroundImage.startsWith('url(')",
      ),
    "刷新恢复头像",
  );
  assert.deepEqual(
    await evaluate(
      "Array.from(document.querySelectorAll('.archive-avatar')).map(el=>[getComputedStyle(el).width,getComputedStyle(el).borderRadius,getComputedStyle(el).backgroundImage.startsWith('url(')])",
    ),
    [
      ["34px", "50%", true],
      ["34px", "50%", true],
    ],
  );
  await navigate("/settings");
  await folder("#folderStorageSettings");
  await click("#stExportBtn");
  let exported;
  await waitFor(async () => {
    exported = (await readdir(path.join(backend.directory, "downloads"))).find(
      (name) => /^mian-backup-\d{8}\.json$/.test(name),
    );
    return Boolean(exported);
  }, "导出 JSON");
  const backupPath = path.join(backend.directory, "downloads", exported);
  const backup = JSON.parse(await readFile(backupPath, "utf8"));
  assert.equal(backup.chats.c1.length, 2);
  assert.equal(backup.fonts.presets[1].name, "紙上字體");
  assert.doesNotMatch(
    JSON.stringify(backup),
    /fake-key|keyHint|hasKey|data:image|blob:/,
  );
  backup.conversations[0].title = "匯入標題";
  await writeFile(backupPath, JSON.stringify(backup));
  await evaluate(
    "localStorage.setItem('mian.conversation.obsolete.mian.chat-groups.v2','[]')",
  );
  const { root } = await call("DOM.getDocument");
  const { nodeId } = await call("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "#stImportInput",
  });
  await call("DOM.setFileInputFiles", { nodeId, files: [backupPath] });
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('#stImportBtn').textContent === 'CONFIRM'",
      ),
    "二次确认导入",
  );
  assert.equal(
    (await (await fetch(backend.base + "/api/conversations")).json())
      .conversations[0].title,
    "ARCHIVE CHAT",
  );
  await click("#stImportBtn");
  await waitFor(
    async () =>
      (await (await fetch(backend.base + "/api/conversations")).json())
        .conversations[0].title === "匯入標題",
    "覆盖档案",
  );
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.mail-title')?.textContent === '已導入'",
      ),
    "重新载入后提示成功",
  );
  assert.equal(
    await evaluate(
      "localStorage.getItem('mian.conversation.obsolete.mian.chat-groups.v2')",
    ),
    null,
  );
  assert.equal(
    await evaluate(
      "JSON.parse(localStorage.getItem('mian.conversation.c1.mian.chat-groups.v2')).length",
    ),
    2,
  );
  await folder("#folderApiSettings");
  await click(`${current} .btnSaveStyle`);
  await waitFor(
    () =>
      evaluate(
        "document.documentElement.style.getPropertyValue('--bubble-chinese-scale') === '1'",
      ),
    "预设恢复原样",
  );
  assert.equal(
    await evaluate(
      "document.documentElement.style.getPropertyValue('--bubble-chinese-family')",
    ),
    '"LXGW Heart Serif"',
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS settings: 中文字体作用域、预览/保存/恢复、头像裁切与持久化、JSON 导出与二次确认导入。",
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
