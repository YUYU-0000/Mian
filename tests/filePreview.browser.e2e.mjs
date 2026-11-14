import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { fileTicketServer } from "./fileTickets.server.mjs";

const backend = await fileTicketServer();
const portraitName = "這是一張保留完整比例而且文件名需要左右滑動的海邊照片.svg";
const svg = (width, height) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#c9d5dd"/><rect y="60%" width="100%" height="40%" fill="#6b8396"/></svg>`;
const pdf =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
const cases = [
  ["example.php", '<?php function hello($name) { echo "Hi " . $name; }'],
  [portraitName, svg(600, 900)],
  ["landscape.svg", svg(1600, 800)],
  ["tall.svg", svg(200, 2400)],
  [
    "example.ts",
    `const value = "${"long-code ".repeat(80)}";\n` +
      "console.log(value);\n".repeat(100),
  ],
  [
    "readme.md",
    "# 文件标题\n\n| 名称 | 数量 |\n| --- | --- |\n| 茶 | 2 |\n\n<script>window.markdownUnsafe = true</script>\n\n```js\nconst count = 2;\n```",
  ],
  [
    "page.html",
    '<!doctype html><html><body style="margin:0"><button style="width:120px;height:50px" onclick="parent.postMessage({fixture:\'html-click\'},\'*\')">点一下</button><script>parent.postMessage({fixture:"html-script"},"*");try{parent.document.body.dataset.leak="yes"}catch{parent.postMessage({fixture:"isolated"},"*")}</script></body></html>',
  ],
  ["document.pdf", pdf],
  ["large.txt", "a".repeat(2 * 1024 * 1024 + 1)],
  ["archive.zip", "binary fixture"],
];
const attachments = [];
for (const [name, content] of cases) {
  const response = await fetch(
    `${backend.base}/api/conversations/c1/files?${new URLSearchParams({ name })}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: content,
    },
  );
  assert.equal(response.status, 201);
  attachments.push(await response.json());
}
const browser = spawn(
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  [
    "--headless=new",
    "--remote-debugging-port=9358",
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
    await sleep(40);
  }
  throw new Error(description);
};
let cdp;
try {
  let targets;
  await waitFor(async () => {
    try {
      targets = await (await fetch("http://127.0.0.1:9358/json")).json();
      return true;
    } catch {
      return false;
    }
  }, "启动浏览器");
  cdp = new WebSocket(
    targets.find((target) => target.type === "page").webSocketDebuggerUrl,
  );
  await once(cdp, "open");
  let id = 0;
  const pending = new Map(),
    errors = [],
    resources = [];
  cdp.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.method === "Network.requestWillBeSent")
      resources.push(message.params.request.url);
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.exception?.description);
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
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
  const touch = (type, points) =>
    call("Input.dispatchTouchEvent", { type, touchPoints: points });
  const settle = () =>
    evaluate(
      `Promise.all(Array.from(document.querySelectorAll('.pv-viewer *')).flatMap(el=>el.getAnimations()).map(animation=>animation.finished))`,
    );
  const open = async (name) => {
    await evaluate(
      `(() => { const ticket=Array.from(document.querySelectorAll('.ft')).find(el=>el.querySelector('.ft-name').textContent===${JSON.stringify(name)}); ticket.scrollIntoView({block:'center'}); ticket.click(); })()`,
    );
    await waitFor(
      () => evaluate(`!!document.querySelector('.pv.is-ready')`),
      `预览 ${name}`,
    );
  };
  const close = async () => {
    await evaluate(`document.querySelector('.pv-mask').click()`);
    await waitFor(
      () => evaluate(`!document.querySelector('.pv-viewer')`),
      "关闭预览",
    );
  };
  const photoCenter = () =>
    evaluate(
      `(() => { const r=document.querySelector('.pv-photo').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`,
    );
  const drag = async (point, dx, dy) => {
    await touch("touchStart", [{ ...point, id: 1 }]);
    for (let step = 1; step <= 6; step++) {
      await touch("touchMove", [
        { x: point.x + (dx * step) / 6, y: point.y + (dy * step) / 6, id: 1 },
      ]);
      await sleep(16);
    }
  };

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
  const group = {
    role: "assistant",
    replyGroupId: "file-preview-fixture",
    time: "12:00",
    format: "plain",
    status: "completed",
    raw: "附件已备好",
    thinking: "",
    activeReasoningItemIds: [],
    preToolBubbles: [],
    preToolBubbleIds: [],
    preToolBubbleComplete: [],
    preToolComplete: false,
    bubbles: ["附件已备好"],
    bubbleIds: ["intro"],
    bubbleComplete: [true],
    tools: [],
    approvals: [],
    files: attachments,
  };
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `if(location.origin===${JSON.stringify(backend.base)}){localStorage.setItem('mian.conversation.c1.mian.chat-groups.v2',${JSON.stringify(JSON.stringify([group]))});window.previewMessages=[];addEventListener('message',event=>{if(event.data?.fixture)window.previewMessages.push(event.data.fixture)});}`,
  });
  await call("Page.navigate", { url: backend.base + "/chat" });
  await waitFor(
    () =>
      evaluate(
        `document.querySelectorAll('.ft').length===${attachments.length}`,
      ),
    "载入附件记录",
  );
  await evaluate(
    `window.previewSaves=[];document.addEventListener('click',event=>{const link=event.target.closest('.pv-acts a');if(link)previewSaves.push(link.download);});`,
  );
  await open(portraitName);
  const entrance = await evaluate(
    `(() => { const animation=document.querySelector('.pv-motion').getAnimations()[0]; return {duration:animation.effect.getTiming().duration,easing:animation.effect.getTiming().easing,start:animation.effect.getKeyframes()[0].transform,sheetDelays:Array.from(document.querySelectorAll('.pv-under'),el=>el.getAnimations()[0].effect.getTiming().delay)}; })()`,
  );
  assert.equal(entrance.duration, 320);
  assert.equal(entrance.easing, "cubic-bezier(0.22, 0.8, 0.3, 1)");
  assert.match(entrance.start, /translate3d\(0(?:px)?,\s*16px,\s*0(?:px)?\)/);
  assert.match(entrance.start, /scale\(0?\.96\)/);
  assert.deepEqual(entrance.sheetDelays, [40, 40]);
  await settle();
  await evaluate("document.fonts.ready");
  const appearance = await evaluate(`(() => {
    const css=selector=>getComputedStyle(document.querySelector(selector)), image=document.querySelector('img.pv-photo');
    const save=document.querySelector('.pv-acts a').getBoundingClientRect();
    return {mask:css('.pv-mask').backgroundColor,paper:css('.pv-card').backgroundColor,padding:css('.pv-card').padding,angle:Math.atan2(new DOMMatrix(css('.pv-card').transform).b,new DOMMatrix(css('.pv-card').transform).a)*180/Math.PI,saveCenter:save.left+save.width/2,removed:!document.querySelector('.pv-clip,.pv-acts button'),hand:[css('.pv-hand').fontFamily,css('.pv-hand').fontSize],number:document.querySelector('.pv-hand').textContent,photo:[parseFloat(css('img.pv-photo').width),parseFloat(css('img.pv-photo').height),image.naturalWidth,image.naturalHeight],fit:css('img.pv-photo').objectFit};
  })()`);
  assert.equal(appearance.mask, "rgba(59, 77, 90, 0.42)");
  assert.equal(appearance.paper, "rgb(251, 250, 246)");
  assert.equal(appearance.padding, "16px 16px 0px");
  assert.ok(Math.abs(appearance.angle + 1.2) < 0.001);
  assert.ok(Math.abs(appearance.saveCenter - 195) < 1);
  assert.equal(appearance.removed, true);
  assert.deepEqual(appearance.hand, ["ZSFT-l, cursive", "22px"]);
  assert.match(appearance.number, /^No\.01\d{2}\.\d{2}$/);
  assert.ok(
    Math.abs(appearance.photo[0] / appearance.photo[1] - 2 / 3) < 0.001,
  );
  assert.equal(appearance.fit, "contain");
  assert.equal(
    resources.some((url) => /\/CodeHighlight-/.test(url)),
    false,
  );
  await writeFile(
    path.join(process.cwd(), ".tmp-polaroid-preview.png"),
    Buffer.from((await call("Page.captureScreenshot")).data, "base64"),
  );

  const textPoint = await evaluate(
    `(() => {const el=document.querySelector('.pv-name'); const r=el.getBoundingClientRect(); return {x:r.right-8,y:r.top+r.height/2};})()`,
  );
  await drag(textPoint, -60, 0);
  await touch("touchEnd", []);
  assert.ok(await evaluate(`document.querySelector('.pv-name').scrollLeft>0`));
  assert.equal(
    await evaluate(
      `new DOMMatrix(getComputedStyle(document.querySelector('.pv-motion')).transform).m42`,
    ),
    0,
  );

  const center = await photoCenter();
  // 提前松手、移动和双指操作都不保存。
  await touch("touchStart", [{ ...center, id: 1 }]);
  await sleep(180);
  assert.equal(
    await evaluate(
      `getComputedStyle(document.querySelector('.pv-motion')).scale`,
    ),
    "0.98",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.pv-photo').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`,
    ),
    false,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.pv-photo').dispatchEvent(new MouseEvent('dragstart',{bubbles:true,cancelable:true}))`,
    ),
    false,
  );
  assert.equal(
    await evaluate(
      `getComputedStyle(document.querySelector('.pv-photo')).userSelect`,
    ),
    "none",
  );
  await touch("touchEnd", []);
  await sleep(2100);
  assert.deepEqual(await evaluate(`previewSaves`), []);
  assert.equal(await evaluate(`!!document.querySelector('.pv-viewer')`), true);

  await drag(center, 11, 0);
  await sleep(2100);
  assert.deepEqual(await evaluate(`previewSaves`), []);
  await touch("touchEnd", []);
  await settle();

  const pinch = async (start, end) => {
    await touch("touchStart", [
      { x: center.x - start, y: center.y, id: 1 },
      { x: center.x + start, y: center.y, id: 2 },
    ]);
    for (let step = 1; step <= 6; step++) {
      const spread = start + ((end - start) * step) / 6;
      await touch("touchMove", [
        { x: center.x - spread, y: center.y, id: 1 },
        { x: center.x + spread, y: center.y, id: 2 },
      ]);
      await sleep(16);
    }
    if (end > start) {
      await sleep(2100);
      assert.deepEqual(await evaluate(`previewSaves`), []);
    }
    await touch("touchEnd", []);
    await settle();
  };
  await pinch(25, 65);
  assert.ok(
    await evaluate(
      `new DOMMatrix(getComputedStyle(document.querySelector('.pv-motion')).transform).a>2`,
    ),
  );
  await pinch(65, 20);
  assert.equal(
    await evaluate(
      `new DOMMatrix(getComputedStyle(document.querySelector('.pv-motion')).transform).a`,
    ),
    1,
  );
  await touch("touchStart", [{ ...(await photoCenter()), id: 1 }]);
  await waitFor(
    () => evaluate(`previewSaves.length===1`),
    "按住两秒，松手前保存",
  );
  assert.deepEqual(await evaluate(`previewSaves`), [portraitName]);
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('.pv-viewer .mail.is-in .mail-title')?.textContent==='已保存'`,
      ),
    "预览上方显示已保存提示",
  );
  await waitFor(async () => {
    try {
      return (
        (await readFile(
          path.join(backend.directory, "downloads", portraitName),
          "utf8",
        )) === svg(600, 900)
      );
    } catch {
      return false;
    }
  }, "长按保存原图");
  await sleep(300);
  await touch("touchEnd", []);
  await settle();
  assert.deepEqual(await evaluate(`previewSaves`), [portraitName]);
  await drag(await photoCenter(), 0, 65);
  assert.ok(
    await evaluate(
      `parseFloat(getComputedStyle(document.querySelector('.pv-mask')).opacity)<1`,
    ),
  );
  await touch("touchEnd", []);
  await settle();
  assert.equal(
    await evaluate(
      `new DOMMatrix(getComputedStyle(document.querySelector('.pv-motion')).transform).m42`,
    ),
    0,
  );
  await drag(await photoCenter(), 0, 160);
  await touch("touchEnd", []);
  const exit = await evaluate(
    `(() => {const animation=document.querySelector('.pv-motion').getAnimations().find(a=>a.effect.getTiming().duration===220);const frames=animation.effect.getKeyframes();return {duration:animation.effect.getTiming().duration,fromY:new DOMMatrix(frames[0].transform).m42,toY:new DOMMatrix(frames[1].transform).m42,opacity:frames[0].opacity}})()`,
  );
  assert.equal(exit.duration, 220);
  assert.ok(Math.abs(exit.fromY - 160) < 1);
  assert.ok(Math.abs(exit.toY - 170) < 1);
  assert.ok(Number(exit.opacity) < 1);
  await waitFor(
    () => evaluate(`!document.querySelector('.pv-viewer')`),
    "下拉关闭",
  );

  for (const [name, ratio] of [
    ["landscape.svg", 2],
    ["tall.svg", 1 / 12],
  ]) {
    await open(name);
    await settle();
    const dimensions = await evaluate(
      `(() => { const style=getComputedStyle(document.querySelector('img.pv-photo')); return [parseFloat(style.width),parseFloat(style.height)]; })()`,
    );
    assert.ok(
      dimensions[0] <= 390 * 0.78 - 32 + 1 && dimensions[1] <= 844 * 0.6 + 1,
    );
    assert.ok(Math.abs(dimensions[0] / dimensions[1] - ratio) < 0.001);
    const blank = await evaluate(
      `(() => {const r=document.querySelector('.pv-acts').getBoundingClientRect();return{x:12,y:r.top+r.height/2}})()`,
    );
    await touch("touchStart", [blank]);
    await touch("touchEnd", []);
    await waitFor(
      () => evaluate(`!document.querySelector('.pv-viewer')`),
      "点遮罩关闭",
    );
  }

  await open("example.ts");
  await settle();
  await waitFor(
    () => evaluate(`!!document.querySelector('.pv-source .hljs-keyword')`),
    "复用代码高亮",
  );
  const textLayout = await evaluate(
    `(() => {const body=document.querySelector('.pv-file-content'),code=document.querySelector('.pv-source code');return {font:getComputedStyle(code).fontSize,mono:getComputedStyle(code).fontFamily,whiteSpace:getComputedStyle(code).whiteSpace,vertical:body.scrollHeight>body.clientHeight,horizontal:body.scrollWidth>body.clientWidth,width:document.querySelector('.pv-card').offsetWidth,height:document.querySelector('.pv-document').offsetHeight};})()`,
  );
  assert.equal(textLayout.font, "12px");
  assert.ok(textLayout.mono.includes("monospace"));
  assert.equal(textLayout.whiteSpace, "pre");
  assert.ok(textLayout.vertical && textLayout.horizontal);
  assert.ok(Math.abs(textLayout.width - 390 * 0.78) < 1);
  assert.ok(textLayout.height <= 844 * 0.6 + 1);
  await writeFile(
    path.join(process.cwd(), ".tmp-letter-preview.png"),
    Buffer.from((await call("Page.captureScreenshot")).data, "base64"),
  );
  const codePoint = await evaluate(
    `(() => {const r=document.querySelector('.pv-file-content').getBoundingClientRect();return{x:r.left+80,y:r.top+180}})()`,
  );
  await drag(codePoint, 0, -80);
  await touch("touchEnd", []);
  await waitFor(
    () => evaluate(`document.querySelector('.pv-file-content').scrollTop>0`),
    "信纸原生滚动",
  );
  assert.equal(
    await evaluate(
      `new DOMMatrix(getComputedStyle(document.querySelector('.pv-motion')).transform).m42`,
    ),
    0,
  );
  await touch("touchStart", [{ ...codePoint, id: 1 }]);
  await waitFor(
    () => evaluate(`previewSaves.includes('example.ts')`),
    "信纸正文长按保存",
  );
  await touch("touchEnd", []);
  await waitFor(async () => {
    try {
      return (
        (await readFile(
          path.join(backend.directory, "downloads/example.ts"),
          "utf8",
        )) === cases.find(([name]) => name === "example.ts")[1]
      );
    } catch {
      return false;
    }
  }, "信纸保存原文件");
  await close();

  assert.equal(
    resources.some((url) => /\/php-/.test(url)),
    false,
  );
  await open("example.php");
  await settle();
  await waitFor(
    () => evaluate(`!!document.querySelector('.pv-source .hljs-keyword')`),
    "PHP 语言按需加载",
  );
  assert.ok(resources.some((url) => /\/php-/.test(url)));
  await close();
  await open("readme.md");
  await settle();
  await waitFor(
    () => evaluate(`!!document.querySelector('.pv-markdown table')`),
    "Markdown 表格",
  );
  assert.equal(
    await evaluate(`document.querySelector('.pv-markdown h1').textContent`),
    "文件标题",
  );
  assert.equal(await evaluate(`!!window.markdownUnsafe`), false);
  await close();
  await open("page.html");
  await settle();
  await waitFor(
    () =>
      evaluate(
        `previewMessages.includes('html-script') && previewMessages.includes('isolated')`,
      ),
    "原始 HTML 脚本在隔离框执行",
  ).catch(async (error) => {
    throw new Error(
      error.message +
        JSON.stringify(
          await evaluate(
            `({messages:previewMessages,srcdoc:document.querySelector('.pv-file-frame').srcdoc,sandbox:document.querySelector('.pv-file-frame').getAttribute('sandbox')})`,
          ),
        ) +
        JSON.stringify(errors),
    );
  });
  assert.equal(
    await evaluate(
      `document.querySelector('.pv-file-frame').getAttribute('sandbox')`,
    ),
    "allow-scripts allow-forms allow-modals allow-popups",
  );
  const buttonPoint = await evaluate(
    `(() => {const r=document.querySelector('.pv-file-frame').getBoundingClientRect();return{x:r.left+60,y:r.top+25}})()`,
  );
  await touch("touchStart", [buttonPoint]);
  await touch("touchEnd", []);
  await waitFor(
    () => evaluate(`previewMessages.includes('html-click')`),
    "HTML onclick 保留交互",
  );
  await close();
  assert.equal(await evaluate(`navigator.pdfViewerEnabled`), true);
  await open("document.pdf");
  await settle();
  assert.ok(
    await evaluate(
      `document.querySelector('.pv-file-frame').src.endsWith('?inline=1')`,
    ),
  );
  await close();

  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `Object.defineProperty(navigator,'pdfViewerEnabled',{get:()=>false});`,
  });
  await call("Page.reload");
  await waitFor(
    () =>
      evaluate(
        `document.querySelectorAll('.ft').length===${attachments.length}`,
      ),
    "模拟没有 PDF 内嵌支持的浏览器",
  );
  for (const name of ["document.pdf", "large.txt", "archive.zip"]) {
    assert.equal(
      await evaluate(
        `(() => {const ticket=Array.from(document.querySelectorAll('.ft')).find(el=>el.querySelector('.ft-name').textContent===${JSON.stringify(name)}); const label=ticket.querySelector('.ft-act').textContent;ticket.click();return label;})()`,
      ),
      "下載",
    );
    await waitFor(async () => {
      try {
        return (
          (await readFile(
            path.join(backend.directory, "downloads", name),
            "utf8",
          )) === cases.find((item) => item[0] === name)[1]
        );
      } catch {
        return false;
      }
    }, `直接下载 ${name}`);
    assert.equal(
      await evaluate(`!!document.querySelector('.pv-viewer')`),
      false,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS 390x844: 共用预览样式、淡入淡出、双指缩放、长按保存与取消、下拉连续关闭、遮罩关闭、长文件名、代码/Markdown/HTML/PDF、原文件保存与直接下载。",
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
