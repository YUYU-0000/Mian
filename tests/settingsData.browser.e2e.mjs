// 验证档案馆设置、头像裁切和包含浏览器媒体的完整备份往返。
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
          `!document.documentElement?.dataset.oldPage && !document.querySelector('.auth-page') && !!document.querySelector(${JSON.stringify(route === "/settings" ? ".settings-page" : ".archive-bubble")})`,
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
    maxTouchPoints: 2,
  });
  await call("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: path.join(backend.directory, "downloads"),
  });
  await navigate("/settings");
  const reply =
    "中文 English 456\n\n行內 `代碼 code 123`\n\n```javascript\nconst 中文 = 123;\n```";
  await evaluate(`localStorage.setItem('mian.conversation.c1.mian.chat-groups.v2', JSON.stringify([
    {role:'user',groupId:'u',time:'12:00',pending:false,records:[{messageId:'m',text:'中文 English 123',time:'12:00'}]},
    {role:'assistant',replyGroupId:'r',time:'12:01',format:'plain',raw:${JSON.stringify(reply)},thinking:'',activeReasoningItemIds:[],preToolBubbles:[],preToolBubbleIds:[],preToolBubbleComplete:[],preToolComplete:true,bubbles:[${JSON.stringify(reply)}],bubbleIds:['b'],bubbleComplete:[true],tools:[],approvals:[],status:'completed'}
  ]))`);
  await navigate("/settings");
  await folder("#folderApiSettings");
  assert.deepEqual(
    await evaluate(
      `(() => { const page=document.querySelector('${current}'), slider=page.querySelector('input[type=range]'); return [page.querySelector('.api-polaroid-input-main').value,page.querySelector('.api-field-input').readOnly,slider.min,slider.max,slider.value,!!page.querySelector('.font-status')]; })()`,
    ),
    ["預設", true, "11.5", "17.5", "14.5", false],
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
  const sample = await readFile(
    new URL("./fixtures/zeoseven-2438.css", import.meta.url),
    "utf8",
  );
  const originalBodyFont = await evaluate(
    "getComputedStyle(document.body).fontFamily",
  );
  await input(`${current} .api-field-input`, sample);
  await click(`${current} .btnTestStyle`);
  const faces = await evaluate(`(() => {
    const id=document.querySelector('${current}').dataset.id;
    return Array.from(document.getElementById('mian-font-'+id).sheet.cssRules).map(rule=>({family:rule.style.fontFamily,weight:rule.style.fontWeight,style:rule.style.fontStyle,src:rule.style.getPropertyValue('src')}));
  })()`);
  assert.equal(faces.length, 10);
  assert.equal(new Set(faces.map((face) => face.family)).size, 1);
  assert.match(faces[0].family, /MianFont_/);
  assert.deepEqual(
    faces.map((face) => [face.weight, face.style]),
    [
      ["700", "normal"],
      ["700", "italic"],
      ["400", "italic"],
      ["300", "normal"],
      ["300", "italic"],
      ["400", "normal"],
      ["600", "normal"],
      ["600", "italic"],
      ["100", "normal"],
      ["100", "italic"],
    ],
  );
  assert.ok(
    faces.every((face) =>
      face.src.includes("https://fontsapi.zeoseven.com/2438/"),
    ),
  );
  assert.equal(
    await evaluate("getComputedStyle(document.body).fontFamily"),
    originalBodyFont,
  );
  for (const invalid of [
    "body { font-family: serif; }",
    '@font-face { font-family: Local; src: local("Arial"); }',
  ]) {
    await input(`${current} .api-field-input`, invalid);
    await click(`${current} .btnTestStyle`);
    assert.equal(
      await evaluate("document.querySelector('.mail-title')?.textContent"),
      "字體無效",
    );
  }
  const face =
    '/* 字體網站附帶的使用示例 */ body { font-family: Paper; } @font-face { font-family: Paper; src: url("/fonts/zsft/main.woff2"); }';
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
      "document.documentElement.style.getPropertyValue('--bubble-font-scale')",
    ),
    "1",
  );
  await click(`${current} .btnSaveStyle`);
  await waitFor(
    () =>
      evaluate(
        "Number(document.documentElement.style.getPropertyValue('--bubble-font-scale')) > 1",
      ),
    "保存应用字体",
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.font-status').length"),
    0,
  );
  await navigate("/chat");
  await waitFor(
    () =>
      evaluate(
        "Number(document.documentElement.style.getPropertyValue('--bubble-font-scale')) > 1",
      ),
    "读取已保存的气泡字体",
  );
  await waitFor(
    () =>
      evaluate(
        "document.querySelectorAll('.archive-bubble').length === 2 && !!document.querySelector('.archive-bubble .reply-code pre code')",
      ),
    "双方气泡及代码",
  );
  const typography =
    await evaluate(`Array.from(document.querySelectorAll('.archive-bubble')).map(bubble=>{
    const style=getComputedStyle(bubble);
    return {size:style.fontSize,family:style.fontFamily};
  })`);
  assert.equal(typography.length, 2);
  for (const item of typography) {
    assert.equal(item.size, "16.5px");
    assert.match(
      item.family,
      /^MianFont_active, "LXGW Heart Serif", sans-serif$/,
    );
  }
  const codeStyles = await evaluate(
    `Array.from(document.querySelectorAll('.archive-bubble code')).map(code=>({size:parseFloat(getComputedStyle(code).fontSize),family:getComputedStyle(code).fontFamily,block:!!code.closest('pre')}))`,
  );
  for (const code of codeStyles) {
    assert.ok(
      Math.abs(code.size - (code.block ? (12 * 16.5) / 14.5 : 16.5 * 0.86)) <
        0.001,
    );
    assert.match(code.family, /monospace/);
    assert.doesNotMatch(code.family, /MianFont/);
  }
  assert.equal(
    await evaluate("document.querySelectorAll('.bubble-chinese').length"),
    0,
  );
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
  // 长方形原图中间透明，左右不同颜色，可同时观察移动、比例和透明底色。
  await evaluate(`(async () => {
    const canvas=document.createElement('canvas'); canvas.width=180; canvas.height=100;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#ff0000'; ctx.fillRect(0,0,60,100);
    ctx.fillStyle='#0000ff'; ctx.fillRect(120,0,60,100);
    window.avatarBlob=await new Promise(resolve=>canvas.toBlob(resolve));
  })()`);
  const openCrop = async (role) => {
    await evaluate(`(() => {
      const role=${JSON.stringify(role)};
      const input=document.querySelector('.avatar-page[data-role='+role+'] input');
      const data=new DataTransfer(); data.items.add(new File([window.avatarBlob],role+'.png',{type:'image/png'}));
      input.files=data.files; input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await waitFor(
      () =>
        evaluate(
          "!!document.querySelector('.avatar-cropper .hang-tag.is-visible') && document.querySelector('.avatar-crop-frame img')?.naturalWidth > 0",
        ),
      "打开头像裁切框",
    );
    await evaluate(
      "Promise.all(document.querySelector('.avatar-cropper').getAnimations({subtree:true}).map(animation=>animation.finished))",
    );
    assert.equal(
      await evaluate(
        "document.querySelector('.avatar-crop-heading text:last-child').textContent",
      ),
      role === "assistant" ? "彼方肖像" : "此方肖像",
    );
  };
  const cropAction = async (name) => {
    const point = await evaluate(`(() => {
      const rect=document.querySelector('.avatar-crop-${name}').getBoundingClientRect();
      const x=rect.x+rect.width/2,y=rect.y+rect.height/2,hit=document.elementFromPoint(x,y);
      return {x,y,button:hit instanceof HTMLButtonElement,action:hit.dataset.action};
    })()`);
    assert.equal(point.button, true, JSON.stringify(point));
    assert.equal(point.action, name);
    await call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    assert.equal(
      await evaluate(
        `getComputedStyle(document.querySelector('.avatar-crop-${name}')).opacity`,
      ),
      "0.6",
    );
    await call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
  };
  const cropZoom = () =>
    evaluate(
      "document.querySelector('.avatar-crop-frame img').getBoundingClientRect().height / document.querySelector('.avatar-crop-frame').getBoundingClientRect().height",
    );
  const closeCrop = () =>
    waitFor(
      () => evaluate("!document.querySelector('.avatar-cropper')"),
      "关闭裁切框",
    );
  await openCrop("assistant");
  await cropAction("cancel");
  await closeCrop();
  assert.equal(
    await evaluate(
      "document.querySelector('.avatar-page[data-role=assistant] .media-photo img')?.src ?? ''",
    ),
    "",
  );
  await openCrop("assistant");
  const tag = await evaluate(`(() => {
    const disc=document.querySelector('.avatar-crop-disc'), frame=document.querySelector('.avatar-crop-frame'), string=document.querySelector('.avatar-cropper .tag-string');
    const rect=disc.getBoundingClientRect();
    return {diameter:disc.offsetWidth,window:frame.offsetWidth,hole:string.getBoundingClientRect().bottom-disc.getBoundingClientRect().top,
      center:[rect.x+rect.width/2-innerWidth/2,rect.y+rect.height/2-innerHeight/2],
      headingSize:getComputedStyle(document.querySelector('.avatar-crop-heading')).fontSize,
      shade:getComputedStyle(document.querySelector('.avatar-cropper .tag-overlay')).backgroundColor,
      textStyles:Array.from(document.querySelectorAll('.avatar-crop-actions text:not(.avatar-crop-divider)'),node=>{const style=getComputedStyle(node);return [style.fontSize,style.fill,style.stroke,style.fontWeight]}),
      oldControls:document.querySelectorAll('.avatar-cropper input[type=range],.avatar-cropper .pv-card,.avatar-cropper .pv-under').length};
  })()`);
  assert.deepEqual(tag, {
    diameter: 200,
    window: 160,
    hole: 10,
    center: [0, 0],
    headingSize: "6.5px",
    shade: "rgba(40, 55, 66, 0.32)",
    textStyles: [
      ["9px", "rgb(59, 77, 90)", "none", "600"],
      ["9px", "rgb(114, 130, 142)", "none", "400"],
      ["9px", "rgb(114, 130, 142)", "none", "400"],
    ],
    oldControls: 0,
  });
  const frame = await evaluate(
    `(() => { const rect=document.querySelector('.avatar-crop-frame').getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()`,
  );
  const touch = (type, points) =>
    call("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([id, x, y]) => ({
        id,
        x,
        y,
        radiusX: 2,
        radiusY: 2,
        force: 1,
      })),
    });
  await touch("touchStart", [
    [1, frame.x - 25, frame.y],
    [2, frame.x + 25, frame.y],
  ]);
  await touch("touchMove", [
    [1, frame.x - 50, frame.y],
    [2, frame.x + 50, frame.y],
  ]);
  await touch("touchEnd", []);
  assert.ok((await cropZoom()) > 1.5);
  await call("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: frame.x,
    y: frame.y,
    deltaX: 0,
    deltaY: 2000,
  });
  await waitFor(
    async () => Math.abs((await cropZoom()) - 1) < 0.001,
    "滚轮最小缩放",
  );
  await call("Emulation.setTouchEmulationEnabled", { enabled: false });
  // 圆卡边缘不接收缩放，只有照片窗接收滚轮和拖动。
  await call("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: frame.x,
    y: frame.y - 90,
    deltaX: 0,
    deltaY: -300,
  });
  assert.equal(await cropZoom(), 1);
  await call("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: frame.x,
    y: frame.y,
    deltaX: 0,
    deltaY: -Math.log(2) / 0.002,
  });
  await waitFor(
    async () => Math.abs((await cropZoom()) - 2) < 0.001,
    "照片窗滚轮放大",
  );
  await call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: frame.x - 65,
    y: frame.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    button: "left",
    x: frame.x + 190,
    y: frame.y + 200,
    buttons: 1,
  });
  await call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: frame.x + 190,
    y: frame.y + 200,
    button: "left",
    clickCount: 1,
  });
  const coverage = await evaluate(`(() => {
    const circle=document.querySelector('.avatar-crop-frame').getBoundingClientRect(), image=document.querySelector('.avatar-crop-frame img').getBoundingClientRect();
    return {covered:image.left<=circle.left+0.01 && image.top<=circle.top+0.01 && image.right>=circle.right-0.01 && image.bottom>=circle.bottom-0.01,ratio:image.width/image.height,left:image.left,circleLeft:circle.left};
  })()`);
  assert.equal(coverage.covered, true);
  assert.ok(Math.abs(coverage.ratio - 1.8) < 0.001);
  const screenshot = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(
    ".tmp-avatar-crop.png",
    Buffer.from(screenshot.data, "base64"),
  );
  assert.ok(
    Math.abs(coverage.left - coverage.circleLeft) < 0.1,
    "拖动到图像边缘: " + JSON.stringify(coverage),
  );
  await cropAction("confirm");
  await closeCrop();
  await openCrop("user");
  await cropAction("confirm");
  await closeCrop();
  await waitFor(
    () =>
      evaluate(
        "!!document.querySelector('.avatar-page[data-role=assistant] .media-photo img') && !!document.querySelector('.avatar-page[data-role=user] .media-photo img')",
      ),
    "保存双方头像",
  );
  const dimensions = await evaluate(`(async()=>{
    const db=await new Promise(resolve=>{const request=indexedDB.open('LauncherDB',1);request.onsuccess=()=>resolve(request.result)});
    const image=await new Promise(resolve=>{const request=db.transaction('mediaStore').objectStore('mediaStore').get('savedMediaFile_avatar_user');request.onsuccess=()=>resolve(request.result)});
    const bitmap=await createImageBitmap(image);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=100;
    const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);
    return {size:[bitmap.width,bitmap.height],center:Array.from(context.getImageData(50,50,1,1).data),left:Array.from(context.getImageData(0,50,1,1).data),right:Array.from(context.getImageData(99,50,1,1).data)};
  })()`);
  assert.deepEqual(dimensions, {
    size: [100, 100],
    center: [251, 250, 246, 255],
    left: [255, 0, 0, 255],
    right: [0, 0, 255, 255],
  });
  await navigate("/chat");
  await waitFor(
    () =>
      evaluate(
        "!!document.querySelector('.archive-avatar.user img')?.complete",
      ),
    "刷新恢复头像",
  );
  assert.deepEqual(
    await evaluate(
      "Array.from(document.querySelectorAll('.archive-avatar')).map(el=>[getComputedStyle(el).width,getComputedStyle(el).borderRadius,!!el.querySelector('img')?.complete])",
    ),
    [
      ["34px", "50%", true],
      ["34px", "50%", true],
    ],
  );
  await navigate("/settings");
  await folder("#folderWallpaperSettings");
  await click(".avatar-page[data-role=assistant] input[type=file]");
  await waitFor(
    () =>
      evaluate(
        "!!document.querySelector('.avatar-cropper .hang-tag.is-visible') && document.querySelector('.avatar-crop-frame img')?.naturalWidth > 0",
      ),
    "重新调整已保存头像",
  );
  await evaluate(
    "Promise.all(document.querySelector('.avatar-cropper').getAnimations({subtree:true}).map(animation=>animation.finished))",
  );
  assert.ok(Math.abs((await cropZoom()) - 2) < 0.001);
  assert.deepEqual(
    await evaluate(
      "[document.querySelector('.avatar-crop-frame img').naturalWidth,document.querySelector('.avatar-crop-frame img').naturalHeight]",
    ),
    [180, 100],
  );
  // 环形文字上的 HTML 按钮触发换图，取消保留上次保存的头像。
  await evaluate(
    "window.replaceOpened=false;document.querySelector('.avatar-cropper input[type=file]').addEventListener('click',()=>window.replaceOpened=true)",
  );
  await cropAction("replace");
  assert.equal(await evaluate("window.replaceOpened"), true);
  await evaluate(`(async () => {
    const input=document.querySelector('.avatar-cropper input[type=file]');
    const blob=await (await fetch(document.querySelector('.avatar-crop-frame img').src)).blob();
    const data=new DataTransfer();data.items.add(new File([blob],'replacement.png',{type:'image/png'}));
    input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor(
    async () =>
      (await evaluate(
        "!document.querySelector('.avatar-crop-button[data-action=cancel]').disabled",
      )) && Math.abs((await cropZoom()) - 1) < 0.001,
    "换照片重置取景",
  );
  await cropAction("cancel");
  await closeCrop();
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
    /fake-key|keyHint|hasKey|blob:/,
  );
  assert.match(backup.media.LauncherDB.savedMediaFile_avatar_user, /^data:image\//);
  assert.match(backup.media.LauncherDB.avatarEditor_assistant.file, /^data:image\//);
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
        "document.documentElement.style.getPropertyValue('--bubble-font-scale') === '1'",
      ),
    "预设恢复原样",
  );
  assert.equal(
    await evaluate(
      "document.documentElement.style.getPropertyValue('--bubble-font-family')",
    ),
    '"ZSFT-br", "LXGW Heart Serif", sans-serif',
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS settings: 混合字体规则与整段缩放、圆形吊牌/角色文字/照片窗手势/环形操作/透明裁切/重新调整、JSON 导出与导入。",
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
