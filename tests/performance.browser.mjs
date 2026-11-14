import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { gzipSync } from "node:zlib";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

// 正式构建、固定数据和手势，录制可在 Chrome Performance 面板打开的轨迹。
const label = process.argv[2] ?? "current";
const workspace = process.cwd();
const output = path.join(workspace, ".tmp-performance", label);
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(workspace, ".tmp-perf-chrome-"));
const assets = path.join(workspace, "client/dist/assets");
const sizes = [];
const maps = new Map();
for (const name of await readdir(assets)) {
  if (/\.(js|css)$/.test(name)) {
    const bytes = await readFile(path.join(assets, name));
    sizes.push({ name, bytes: bytes.length, gzip: gzipSync(bytes).length });
  } else if (name.endsWith(".js.map")) {
    maps.set(
      name.slice(0, -4),
      new TraceMap(JSON.parse(await readFile(path.join(assets, name), "utf8"))),
    );
  }
}
const paragraph =
  "這段內容用來觀察長回覆的排版與播放。保留原本的字體、間距和動畫，讓表格與程式碼逐步出現。";
const section = (index) =>
  `## 第 ${index} 段\n\n${paragraph.repeat(3)}\n\n| 項目 | 數值 | 說明 |\n| --- | ---: | --- |\n${Array.from({ length: 5 }, (_, row) => `| 項目 ${row} | ${row * 12} | 保留完整文字 |`).join("\n")}\n\n\`\`\`javascript\n${Array.from({ length: 12 }, (_, line) => `const value${line} = items.map(item => ({ ...item, score: item.score + ${line} }));`).join("\n")}\n\`\`\`\n`;
const oldHistory = Array.from({ length: 12 }, (_, index) => [
  {
    role: "user",
    groupId: `user-${index}`,
    time: "10:00",
    pending: false,
    records: [
      { messageId: `m-${index}`, text: `測試問題 ${index}`, time: "10:00" },
    ],
  },
  {
    role: "assistant",
    format: "api",
    replyGroupId: `reply-${index}`,
    time: "10:01",
    thinking: "",
    activeReasoningItemIds: [],
    raw: "",
    preToolBubbles: [],
    preToolBubbleIds: [],
    preToolBubbleComplete: [],
    preToolComplete: true,
    bubbles: [section(index)],
    bubbleIds: [`bubble-${index}`],
    bubbleComplete: [true],
    tools: [],
    approvals: [],
    status: "completed",
  },
]).flat();
const reply = `<mian-thinking>先整理清楚，再逐段說明。</mian-thinking>${[1, 2, 3].map((index) => `<mian-bubble>${section(index)}</mian-bubble>`).join("")}`;
const conversation = {
  conversationId: "c1",
  threadId: null,
  parentConversationId: null,
  rootNumber: 1,
  branchPath: [],
  branchCounter: 0,
  abbr: "C-01",
  title: "效能錄製",
  frontName: "Mian",
  image: "",
  pinned: true,
  model: null,
  reasoningEffort: null,
  totalTokens: null,
  uncachedTotalTokens: null,
  lastActivityAt: null,
  lastMessage: null,
  collaborationMode: null,
  createdAt: "2026-11-14T00:00:00.000Z",
  updatedAt: "2026-11-14T00:00:00.000Z",
};
const channel = { kind: "api", presetId: "paper-0", name: "效能測試" };
const app = express();
app.use(express.json());
app.get("/api/conversations", (_req, res) =>
  res.json({ conversations: [conversation], defaultConversationId: "c1" }),
);
app.patch("/api/conversations/c1/activity", (req, res) =>
  res.json({ conversation: Object.assign(conversation, req.body) }),
);
app.get("/api/api-presets", (_req, res) =>
  res.json({
    presets: [0, 1, 2].map((index) => ({
      id: `paper-${index}`,
      note: `測試紙片 ${index}`,
      endpoint: "https://example.test",
      hasKey: true,
      keyHint: "sk-test",
      model: "test-model",
      format: "openai",
    })),
    activeId: "paper-0",
  }),
);
app.get("/api/subscriptions/codex", (_req, res) =>
  res.json({ loggedIn: true, account: "fixture", plan: "plus", model: "test" }),
);
app.get("/api/subscriptions/codex/quota", (_req, res) =>
  res.json({ left: 50, resetAt: "11月20日 17:10" }),
);
app.get("/api/config", (_req, res) =>
  res.json({
    workingDirectory: "C:\\Users\\Example\\MianWorkspace",
    sandbox: "workspace-write",
    model: "test",
    channel,
  }),
);
app.use(express.static(path.join(workspace, "client/dist")));
app.get("*splat", (_req, res) =>
  res.sendFile(path.join(workspace, "client/dist/index.html")),
);
const server = createServer(app);
const sockets = new WebSocketServer({ server, path: "/ws" });
let seq = 0;
sockets.on("connection", (socket) =>
  socket.send(
    JSON.stringify({
      kind: "session",
      streamId: "performance",
      seq,
      reset: false,
      threadId: null,
      activeTurnId: null,
      activeTurns: {},
      conversations: [conversation],
      defaultConversationId: "c1",
      channel,
      connectionStatus: { state: "ready", message: "READY" },
    }),
  ),
);
const publish = (event) => {
  const message = JSON.stringify({
    kind: "event",
    streamId: "performance",
    seq: ++seq,
    event: {
      conversationId: "c1",
      format: "api",
      turnId: "long-reply",
      ...event,
    },
  });
  for (const socket of sockets.clients) socket.send(message);
};
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const browser = spawn(
  process.env.CHROME_PATH ??
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  [
    "--headless=new",
    "--remote-debugging-port=9360",
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
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await sleep(100);
  }
  throw new Error(description);
};
let cdp;
const recordings = [];
try {
  let targets;
  await waitFor(async () => {
    try {
      targets = await (await fetch("http://127.0.0.1:9360/json")).json();
      return true;
    } catch {
      return false;
    }
  }, "Chrome did not start");
  cdp = new WebSocket(
    targets.find((target) => target.type === "page").webSocketDebuggerUrl,
  );
  await once(cdp, "open");
  const pending = new Map();
  const events = new Map();
  const errors = [];
  let nextId = 0;
  cdp.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.method === "Runtime.exceptionThrown")
      errors.push(
        message.params.exceptionDetails.exception?.description ??
          message.params.exceptionDetails.text,
      );
    events.get(message.method)?.(message.params);
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
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );
    return result.result.value;
  };
  const click = (selector) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const navigate = async (route, ready) => {
    await call("Page.navigate", { url: base + route });
    await waitFor(
      () =>
        evaluate(`Boolean(document.querySelector(${JSON.stringify(ready)}))`),
      `Missing ${ready}`,
    );
    await evaluate("document.fonts.ready");
    await sleep(800);
  };
  const touch = async (selector) => {
    const point = await evaluate(
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`,
    );
    await call("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
    });
    await call("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };
  const selectedPaper = (track) =>
    evaluate(
      `[...document.querySelector(${JSON.stringify(track)}).children].filter(el => !el.classList.contains('stack-shadow')).findIndex(el => !el.inert)`,
    );
  const drag = async (track, dx) => {
    const previous = await selectedPaper(track);
    const point = await evaluate(
      `(() => { const r = document.querySelector(${JSON.stringify(track)}).getBoundingClientRect(); return {x: ${dx < 0 ? "r.right-45" : "r.left+45"}, y:r.top+r.height*.43}; })()`,
    );
    await call("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
    });
    for (let step = 1; step <= 12; step++) {
      await call("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: point.x + (dx * step) / 12, y: point.y }],
      });
      await sleep(16);
    }
    await call("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await sleep(850);
    assert.equal(
      await selectedPaper(track),
      previous + (dx < 0 ? 1 : -1),
      `${track} did not turn a paper`,
    );
  };
  const metrics = async () =>
    Object.fromEntries(
      (await call("Performance.getMetrics")).metrics.map((metric) => [
        metric.name,
        metric.value,
      ]),
    );
  const profileSummary = (cpu) => {
    const nodes = new Map(cpu.nodes.map((node) => [node.id, node]));
    const totals = new Map();
    for (let i = 0; i < cpu.samples.length; i++) {
      const frame = nodes.get(cpu.samples[i]).callFrame;
      if (frame.functionName === "(idle)") continue;
      const source = maps.get(frame.url.split("/").at(-1));
      const original =
        source &&
        originalPositionFor(source, {
          line: frame.lineNumber + 1,
          column: frame.columnNumber,
        });
      const name = original?.source
        ? `${original.source}:${original.line} ${original.name ?? frame.functionName}`
        : `${frame.functionName || "(anonymous)"} ${frame.url}`;
      totals.set(name, (totals.get(name) ?? 0) + cpu.timeDeltas[i] / 1000);
    }
    return [...totals]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name, ms]) => ({ name, ms: Math.round(ms * 10) / 10 }));
  };
  const record = async (name, action) => {
    const traceEvents = [];
    events.set("Tracing.dataCollected", ({ value }) =>
      traceEvents.push(...value),
    );
    const complete = new Promise((resolve) =>
      events.set("Tracing.tracingComplete", resolve),
    );
    await call("Tracing.start", {
      categories:
        "devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,toplevel,blink.user_timing,cc",
      options: "record-as-much-as-possible",
    });
    await call("Profiler.start");
    const before = await metrics();
    const start = Date.now();
    await action();
    const elapsedMs = Date.now() - start;
    const after = await metrics();
    const { profile: cpu } = await call("Profiler.stop");
    await call("Tracing.end");
    await complete;
    const main = traceEvents.find(
      (event) =>
        event.name === "thread_name" && event.args.name === "CrRendererMain",
    );
    const mainEvents = traceEvents.filter(
      (event) =>
        event.pid === main.pid && event.tid === main.tid && event.ph === "X",
    );
    const tasks = mainEvents
      .filter((event) => event.name === "RunTask")
      .map((event) => event.dur / 1000);
    const duration = (eventName) =>
      traceEvents
        .filter((event) => event.name === eventName && event.ph === "X")
        .reduce((sum, event) => sum + event.dur / 1000, 0);
    const summary = {
      name,
      elapsedMs,
      mainThreadMs: (after.TaskDuration - before.TaskDuration) * 1000,
      scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
      layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
      styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
      paintMs: duration("Paint"),
      rasterMs: duration("RasterTask"),
      longestTaskMs: Math.max(0, ...tasks),
      longTasks: tasks.filter((ms) => ms > 50).length,
      topFunctions: profileSummary(cpu),
    };
    recordings.push(summary);
    await writeFile(
      path.join(output, `${name}.trace.json.gz`),
      gzipSync(JSON.stringify({ traceEvents })),
    );
    await writeFile(
      path.join(output, `${name}.cpuprofile`),
      JSON.stringify(cpu),
    );
    await writeFile(
      path.join(output, `${name}.png`),
      Buffer.from((await call("Page.captureScreenshot")).data, "base64"),
    );
    console.log(JSON.stringify(summary));
  };
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Performance.enable");
  await call("Profiler.enable");
  await call("Profiler.setSamplingInterval", { interval: 1000 });
  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await call("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  await call("Emulation.setCPUThrottlingRate", { rate: 4 });
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `if (!localStorage.getItem('perf-seeded')) { localStorage.setItem('mian.conversation.c1.mian.chat-groups.v2', ${JSON.stringify(JSON.stringify(oldHistory))}); localStorage.setItem('perf-seeded','1'); }`,
  });
  await navigate("/", ".home-screen");
  await record("home-button", async () => {
    await touch(".dock-1");
    await waitFor(
      () =>
        evaluate(
          "Boolean(document.querySelector('.connections-page')) && document.querySelector('.route-transition-frame').dataset.transitionActive === 'false'",
        ),
      "Home transition did not finish",
    );
    await sleep(400);
    assert.equal(
      await evaluate(
        "document.querySelectorAll('.route-transition-layer').length",
      ),
      1,
    );
    assert.equal(
      await evaluate("document.querySelector('.home-screen') === null"),
      true,
    );
  });
  await click("#apiTie");
  await sleep(1000);
  assert.equal(await selectedPaper("#apiTrack"), 0);
  await record("connections-swipe", async () => {
    await drag("#apiTrack", -210);
    await drag("#apiTrack", 210);
    await drag("#apiTrack", -210);
    await drag("#apiTrack", 210);
  });
  await navigate("/settings", "#folderApiSettings");
  await click("#folderApiSettings");
  await sleep(700);
  await click(".apiBtnAdd");
  await sleep(800);
  await record("settings-swipe", async () => {
    await drag("#apiWrapper .settings-stack-track", 210);
    await drag("#apiWrapper .settings-stack-track", -210);
    await click("#paperOverlay");
    await sleep(600);
    await click("#folderVoiceSettings");
    await sleep(600);
    await click(".vc-add");
    await sleep(800);
    await drag("#voiceWrapper .settings-stack-track", 210);
    await drag("#voiceWrapper .settings-stack-track", -210);
  });
  await navigate("/", ".home-screen");
  await record("chat-open", async () => {
    await touch(".icon-1");
    await waitFor(
      () =>
        evaluate(
          "document.querySelectorAll('.reply-markdown table').length === 12 && document.querySelector('.route-transition-frame').dataset.transitionActive === 'false'",
        ),
      "Chat history did not open",
    );
    await evaluate("document.fonts.ready");
    await sleep(500);
    assert.equal(
      await evaluate(
        "document.querySelectorAll('.route-transition-layer').length",
      ),
      1,
    );
  });
  await record("chat-stream", async () => {
    publish({ type: "turn-started" });
    for (let offset = 0; offset < reply.length; offset += 64) {
      publish({
        type: "assistant-delta",
        delta: reply.slice(offset, offset + 64),
      });
      await sleep(40);
    }
    publish({ type: "turn-completed", status: "completed" });
    await waitFor(
      () =>
        evaluate(
          "document.querySelectorAll('.reply-markdown table').length === 15 && document.querySelectorAll('.reply-code').length === 15 && !document.querySelector('.archive-reply-body .cursor-blink')",
        ),
      "Long reply did not finish",
    );
    await sleep(300);
  });
  assert.deepEqual(errors, []);
  const result = {
    label,
    browser: await call("Browser.getVersion"),
    cpuThrottle: 4,
    viewport: "390x844 @2x",
    historyReplies: 12,
    replyCharacters: reply.length,
    chunkCharacters: 64,
    chunkIntervalMs: 40,
    sizes,
    recordings,
  };
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(`PASS Performance recordings: ${output}`);
} finally {
  cdp?.close();
  spawnSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  for (const socket of sockets.clients) socket.terminate();
  sockets.close();
  server.close();
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
