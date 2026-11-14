import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { build } from "esbuild";
import { WebSocket } from "ws";

const workspace = process.cwd();
const profile = await mkdtemp(path.join(workspace, ".tmp-render-browser-"));
const bundle = await build({
  entryPoints: ["tests/replyRendering.fixture.tsx"],
  bundle: true,
  write: false,
  outdir: profile,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
const builtPage = await readFile("client/dist/index.html", "utf8");
const style = builtPage.match(
  /<link rel="stylesheet"[^>]*href="([^"]+\.css)"/,
)[1];
const app = express();
app.get("/fixture.js", (_req, res) =>
  res
    .type("js")
    .send(bundle.outputFiles.find((file) => file.path.endsWith(".js")).text),
);
app.get("/fixture.css", (_req, res) =>
  res
    .type("css")
    .send(bundle.outputFiles.find((file) => file.path.endsWith(".css")).text),
);
app.get("/", (_req, res) =>
  res.send(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${style}"><link rel="stylesheet" href="/fixture.css"><style>body,#root{width:100%;height:auto;overflow:auto}#root{padding-top:20px}</style><div id="root"></div><script src="/fixture.js"></script>`,
  ),
);
app.use(express.static(path.join(workspace, "client/dist")));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const debugPort = 9351;
const browser = spawn(
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (read, description) => {
  const deadline = Date.now() + 15_000;
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
      targets = await (
        await fetch(`http://127.0.0.1:${debugPort}/json`)
      ).json();
      return true;
    } catch {
      return false;
    }
  }, "Edge did not start");
  cdp = new WebSocket(
    targets.find((target) => target.type === "page").webSocketDebuggerUrl,
  );
  await once(cdp, "open");
  let nextId = 0;
  const pending = new Map();
  const errors = [];
  cdp.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.method === "Runtime.exceptionThrown")
      errors.push(
        message.params.exceptionDetails.exception?.description ??
          message.params.exceptionDetails.text,
      );
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      cdp.send(JSON.stringify({ id, method, params }));
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
  const render = (bubbles, typing = false, page = "/chat") =>
    evaluate(
      `renderFixture(${JSON.stringify(bubbles)}, ${typing}, ${JSON.stringify(page)})`,
    );
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await call("Page.navigate", {
    url: `http://127.0.0.1:${server.address().port}`,
  });
  await waitFor(
    () => evaluate("typeof renderFixture === 'function'"),
    "Rendering fixture did not load",
  );

  const markdown = [
    "# 一級標題",
    "## 二級標題",
    "### 三級標題",
    "#### 四級標題",
    "##### 五級標題",
    "###### 六級標題",
    "**粗體** *斜體* ~~刪除~~ `行內碼`",
    "1. 有序\n2. 第二項",
    "- 無序\n- [x] 已完成\n- [ ] 未完成",
    "> 引用",
    "[安全連結](https://example.com)",
    "---",
    "| 名稱 | 數量 |\n| --- | ---: |\n| 紙片 | 2 |",
    "<b>粗</b><i>斜</i><u>底線</u><s>刪</s><mark>標記</mark><br><sub>下</sub><sup>上</sup><kbd>Ctrl</kbd>",
    '<span style="color:rgb(1,2,3);background-color:#eeeeee;font-weight:700;position:fixed;inset:0;background-image:url(javascript:alert(1))" onclick="window.__xss=1">安全樣式</span>',
    "<details><summary>更多</summary>折疊內容</details>",
    '<script>window.__xss=1</script><iframe srcdoc="bad"></iframe><img src="/missing.png" onerror="window.__xss=1">',
    '[危險連結](javascript:alert(1)) <a href="javascript:alert(1)" onmouseover="window.__xss=1">壞連結</a>',
  ].join("\n\n");
  await render([markdown]);
  await waitFor(
    () => evaluate("Boolean(document.querySelector('.reply-markdown table'))"),
    "Markdown did not render",
  );
  assert.deepEqual(
    await evaluate(`(() => {
    const body = document.querySelector('.reply-markdown');
    const styled = [...body.querySelectorAll('span')].find(el => el.textContent === '安全樣式');
    return {
      headings: body.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
      formatting: ['strong','em','del','ol','ul','blockquote','hr','code','b','i','u','s','mark','br','sub','sup','kbd','details','summary'].every(tag => body.querySelector(tag)),
      tasks: [...body.querySelectorAll('input')].map(el => [el.checked, el.disabled]),
      dangerous: body.querySelectorAll('script,iframe,[onclick],[onerror],[onmouseover],[href^="javascript:"]').length,
      color: styled.style.color, weight: styled.style.fontWeight, position: styled.style.position,
      image: styled.style.backgroundImage, xss: Boolean(window.__xss)
    };
  })()`),
    {
      headings: 6,
      formatting: true,
      tasks: [
        [true, true],
        [false, true],
      ],
      dangerous: 0,
      color: "rgb(1, 2, 3)",
      weight: "700",
      position: "",
      image: "",
      xss: false,
    },
  );

  assert.deepEqual(
    await evaluate(`(() => {
      const root = document.querySelector('.reply-markdown');
      const style = (selector, pseudo) => getComputedStyle(root.querySelector(selector), pseudo);
      return {
        ink: getComputedStyle(root).color,
        headingUnderline: style('h1').borderBottom,
        headingWeight: style('h1').fontWeight,
        listMarker: style('ul > li', '::before').width,
        taskMarker: style('li:has(> input)', '::before').display,
        quoteBorder: style('blockquote').borderLeftStyle,
        quotePaper: style('blockquote').backgroundColor,
        tableScroll: style('.reply-table-scroll').overflowX,
        tableHeading: style('th').borderBottomStyle,
        tableRow: style('td').borderLeftStyle,
        detailRadius: style('details').borderRadius,
      };
    })()`),
    {
      ink: "rgb(59, 77, 90)",
      headingUnderline: "1px solid rgb(59, 77, 90)",
      headingWeight: "600",
      listMarker: "4px",
      taskMarker: "none",
      quoteBorder: "none",
      quotePaper: "rgba(147, 167, 181, 0.1)",
      tableScroll: "auto",
      tableHeading: "solid",
      tableRow: "none",
      detailRadius: "2px",
    },
  );

  const code = `const message = "${"long line ".repeat(60)}";`;
  await render(["```javascript\n" + code + "\n```"]);
  await waitFor(
    () =>
      evaluate("Boolean(document.querySelector('.reply-code .hljs-keyword'))"),
    "Code highlighting missing",
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.reply-code-head span').textContent",
    ),
    "javascript",
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.reply-code pre').scrollWidth > document.querySelector('.reply-code pre').clientWidth",
    ),
    true,
  );
  assert.equal(
    await evaluate("document.documentElement.scrollWidth <= innerWidth"),
    true,
  );
  assert.deepEqual(
    await evaluate(`(() => {
      const style = selector => getComputedStyle(document.querySelector(selector));
      return {
        paper: style('.reply-code').backgroundColor,
        radius: style('.reply-code').borderRadius,
        header: style('.reply-code-head').borderBottomStyle,
        padding: style('.reply-code pre').padding,
        whitespace: style('.reply-code pre').whiteSpace,
        font: style('.reply-code code').fontSize,
        mono: style('.reply-code code').fontFamily.includes('ui-monospace'),
        highlight: style('.reply-code .hljs-keyword').color,
      };
    })()`),
    {
      paper: "rgb(245, 242, 236)",
      radius: "2px",
      header: "dashed",
      padding: "10px 14px 12px",
      whitespace: "pre",
      font: "12px",
      mono: true,
      highlight: "rgb(79, 106, 128)",
    },
  );
  await evaluate(
    `Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }); document.execCommand = command => { window.copiedCode = document.querySelector('textarea').value; return command === 'copy'; }; document.querySelector('.reply-code-head button').click()`,
  );
  await waitFor(
    () => evaluate("typeof window.copiedCode === 'string'"),
    "HTTP copy did not run",
  );
  assert.equal(await evaluate("window.copiedCode"), code);

  const html =
    '<!doctype html><html><head><style>body{margin:0}section{height:900px;background:#ddd}</style></head><body><section>預覽內容</section><script>parent.__xss=1</script><iframe src="about:blank"></iframe></body></html>';
  const htmlBubble = "```html\n" + html + "\n```";
  await render([htmlBubble]);
  await waitFor(
    () =>
      evaluate("Boolean(document.querySelector('.reply-code-preview button'))"),
    "HTML preview action missing",
  );
  await evaluate(
    "document.querySelector('.reply-code-preview button').click()",
  );
  await waitFor(
    () =>
      evaluate("document.querySelector('iframe')?.style.height === '480px'"),
    "HTML preview height was not capped",
  );
  assert.deepEqual(
    await evaluate(`(() => {
    const frame = document.querySelector('iframe'); window.openedPreview = frame;
    return { sandbox: frame.getAttribute('sandbox'), opaque: frame.contentDocument === null, modelScript: frame.srcdoc.includes('parent.__xss'), nestedFrame: frame.srcdoc.includes('<iframe'), xss: Boolean(window.__xss) };
  })()`),
    {
      sandbox: "allow-scripts",
      opaque: true,
      modelScript: false,
      nestedFrame: false,
      xss: false,
    },
  );
  assert.deepEqual(
    await evaluate(`(() => {
      const style = getComputedStyle(document.querySelector('iframe'));
      return { maxHeight: style.maxHeight, margin: style.marginTop, border: style.borderStyle, radius: style.borderRadius };
    })()`),
    { maxHeight: "480px", margin: "10px", border: "none", radius: "2px" },
  );
  await render([htmlBubble + "\n\n後面的文字"], true);
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.reply-markdown')?.textContent.includes('後面的文字')",
      ),
    "Text after HTML block missing",
  );
  assert.equal(
    await evaluate("document.querySelector('iframe') === window.openedPreview"),
    true,
  );
  await evaluate(
    "document.querySelector('.reply-code-preview button').click()",
  );
  await render(['```html\n<div style="height:70px">短預覽</div>\n```']);
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.reply-code pre')?.textContent.includes('短預覽')",
      ),
    "Short preview source missing",
  );
  await evaluate(
    "document.querySelector('.reply-code-preview button').click()",
  );
  await waitFor(
    () =>
      evaluate(
        "parseFloat(document.querySelector('iframe')?.style.height) > 60 && parseFloat(document.querySelector('iframe')?.style.height) < 150",
      ),
    "Short preview height did not adapt",
  );

  await render(["```js\nconst unfinished = 1", "後一個氣泡"], true);
  await waitFor(
    () =>
      evaluate(
        "document.querySelectorAll('.reply-markdown')[1]?.textContent === '後一個氣泡'",
      ),
    "Unfinished fence swallowed the next bubble",
  );
  await render(["```js\nconst unfinished = 1\n```\n\n圍欄後的正文"]);
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.reply-markdown > p')?.textContent === '圍欄後的正文'",
      ),
    "Closed fence swallowed later text",
  );

  const renders = await evaluate(`(async () => {
    renderFixture(['起'], true);
    await new Promise(resolve => setTimeout(resolve, 120));
    let count = 0;
    const observer = new MutationObserver(() => count++);
    observer.observe(document.querySelector('.reply-markdown'), { childList: true, subtree: true, characterData: true });
    for (let i = 1; i <= 60; i++) {
      renderFixture(['起' + '字'.repeat(i)], true);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    renderFixture(['最終正文'], false);
    await new Promise(resolve => setTimeout(resolve, 60));
    observer.disconnect(); return count;
  })()`);
  assert.ok(renders < 20, `Streaming caused ${renders} DOM updates`);
  assert.equal(
    await evaluate("document.querySelector('.reply-markdown').textContent"),
    "最終正文",
  );
  for (const [page, label] of [
    ["/connections", "連接設置 →"],
    ["/settings", "檔案館 →"],
    ["/chat", "對話 →"],
    ["/", "主界面 →"],
  ]) {
    await render(["正文"], false, page);
    await waitFor(
      () =>
        evaluate(
          `document.querySelector('.mail-kicker span')?.textContent === ${JSON.stringify(label)}`,
        ),
      "Notice page label incorrect",
    );
  }
  const command = "python " + "long-argument ".repeat(60);
  const output = Array.from(
    { length: 14 },
    (_, index) => `output line ${index}`,
  ).join("\n");
  await evaluate(
    `renderToolFixture(${JSON.stringify(command)}, ${JSON.stringify(output)})`,
  );
  await waitFor(
    () => evaluate("Boolean(document.querySelector('.archive-tool-more'))"),
    "Long tool output did not collapse",
  );
  assert.deepEqual(
    await evaluate(`(() => {
    const pre = document.querySelector('.archive-tool-output'); const style = getComputedStyle(pre);
    return { lines: pre.textContent.split('\\n').length, font: style.fontFamily.includes('ui-monospace'), size: style.fontSize, whitespace: style.whiteSpace, scroll: pre.scrollWidth > pre.clientWidth };
  })()`),
    { lines: 6, font: true, size: "11px", whitespace: "pre", scroll: true },
  );
  assert.equal(
    await evaluate(
      "getComputedStyle(document.querySelector('.archive-tool-step'), '::before').content",
    ),
    "none",
  );
  await evaluate("document.querySelector('.archive-tool-more').click()");
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.archive-tool-output').textContent.includes('output line 13')",
      ),
    "Full tool output did not expand",
  );
  await evaluate("document.querySelector('.archive-tool-more').click()");
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.archive-tool-output').textContent.split('\\n').length === 6",
      ),
    "Tool output did not collapse again",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS Markdown/GFM, HTML sanitization, highlighting, HTTP copy, isolated adaptive preview, streaming throttle and notice labels (390x844).",
  );
} finally {
  cdp?.close();
  const exited = once(browser, "exit");
  spawnSync("taskkill.exe", ["/PID", String(browser.pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  await exited;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  assert.equal(path.dirname(profile), workspace);
  await rm(profile, { recursive: true });
}
