import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { build } from "esbuild";
import { WebSocket } from "ws";

const workspace = process.cwd();
const profile = await mkdtemp(path.join(tmpdir(), "mian-settings-stack-"));
const bundle = await build({
  entryPoints: ["tests/settingsPaperStack.fixture.tsx"],
  bundle: true,
  write: false,
  outdir: profile,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
const page = await readFile("client/dist/index.html", "utf8");
const style = page.match(/<link rel="stylesheet"[^>]*href="([^"]+\.css)"/)[1];
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
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${style}"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>`,
  ),
);
app.use(express.static(path.join(workspace, "client/dist")));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const debugPort = 9353;
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
    await sleep(40);
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
  const pending = new Map();
  const errors = [];
  let nextId = 0;
  cdp.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.method === "Runtime.exceptionThrown")
      errors.push(
        message.params.exceptionDetails.exception?.description ??
          message.params.exceptionDetails.text,
      );
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
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
  const click = (selector) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const current = (wrapper) =>
    `${wrapper} .settings-stack-track > :not(.stack-shadow):not([inert])`;
  const selected = (wrapper) =>
    evaluate(
      `Array.from(document.querySelector('${wrapper} .settings-stack-track').children).filter(page => !page.classList.contains('stack-shadow')).findIndex(page => !page.inert)`,
    );
  const settle = (wrapper) =>
    evaluate(
      `Promise.all(Array.from(document.querySelector('${wrapper} .settings-stack-track').children).flatMap(page => page.getAnimations()).map(animation => animation.finished))`,
    );
  const folder = async (selector) => {
    await click(selector);
    await evaluate(
      "Promise.all(document.querySelector('.paper-stack-container').getAnimations().map(animation => animation.finished))",
    );
  };
  const drag = async (wrapper, dx, inspect) => {
    const point = await evaluate(`(() => {
      const rect = document.querySelector('${current(wrapper)}').getBoundingClientRect();
      return { x: ${dx < 0 ? "rect.right - 40" : "rect.left + 40"}, y: rect.top + rect.height * .43 };
    })()`);
    await call("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
    });
    for (let step = 1; step <= 6; step++) {
      await call("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: point.x + (dx * step) / 6, y: point.y }],
      });
      await sleep(16);
    }
    if (inspect) await inspect();
    await call("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await settle(wrapper);
  };
  const dragControl = async (selector, dx) => {
    const point = await evaluate(
      `(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:rect.right - 10,y:rect.top + rect.height / 2}; })()`,
    );
    await call("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
    });
    for (let step = 1; step <= 6; step++) {
      await call("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: point.x + (dx * step) / 6, y: point.y }],
      });
      await sleep(16);
    }
    await call("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };
  await call("Page.enable");
  await call("Runtime.enable");
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
  await call("Page.navigate", {
    url: `http://127.0.0.1:${server.address().port}`,
  });
  await waitFor(
    () => evaluate("Boolean(document.querySelector('#folderApiSettings'))"),
    "Settings did not load",
  );
  await folder("#folderApiSettings");
  const dimensions = await evaluate(
    `(() => { const page = document.querySelector('.api-page'), surface = document.querySelector('.paper-main'); return {width:page.offsetWidth,height:page.offsetHeight,surfaceWidth:surface.clientWidth,surfaceHeight:surface.clientHeight}; })()`,
  );
  assert.equal(dimensions.width, dimensions.surfaceWidth);
  assert.equal(dimensions.height, dimensions.surfaceHeight);
  for (let count = 2; count <= 3; count++) {
    await click(`${current("#apiWrapper")} .apiBtnAdd`);
    await waitFor(
      async () => (await selected("#apiWrapper")) === count - 1,
      "Added font page was not selected",
    );
  }
  const layers = await evaluate(
    "[...document.querySelectorAll('.api-page')].map(page => page.style.zIndex)",
  );
  await drag("#apiWrapper", 170);
  assert.equal(await selected("#apiWrapper"), 1);
  await drag("#apiWrapper", -170, async () => {
    assert.deepEqual(
      await evaluate(`(() => {
      const page = document.querySelector('${current("#apiWrapper")}'); const shadow = document.querySelector('#apiWrapper .stack-shadow');
      return {rotated: new DOMMatrix(getComputedStyle(page).transform).b !== 0, shadow: Number(shadow.style.opacity) > 0, follows: shadow.style.transform === page.style.transform};
    })()`),
      { rotated: true, shadow: true, follows: true },
    );
  });
  assert.equal(await selected("#apiWrapper"), 2);
  assert.deepEqual(
    await evaluate(
      "[...document.querySelectorAll('.api-page')].map(page => page.style.zIndex)",
    ),
    layers,
  );
  await drag("#apiWrapper", 170);
  await drag("#apiWrapper", 170);
  assert.equal(await selected("#apiWrapper"), 0);
  assert.deepEqual(
    await evaluate(
      "[...document.querySelectorAll('.api-page')].map(page => [page.style.visibility,page.inert])",
    ),
    [
      ["visible", false],
      ["visible", true],
      ["hidden", true],
    ],
  );
  await drag("#apiWrapper", -10);
  assert.equal(await selected("#apiWrapper"), 0);
  await dragControl(`${current("#apiWrapper")} .btnSaveStyle`, -80);
  assert.equal(await selected("#apiWrapper"), 0);
  assert.equal(
    await evaluate(
      "document.querySelector('#apiWrapper .stack-shadow').style.opacity",
    ),
    "0",
  );
  await click(`${current("#apiWrapper")} .btnSaveStyle`);
  await click(`${current("#apiWrapper")} .btnTestStyle`);
  assert.ok((await evaluate("window.styleActions")).includes("save"));
  assert.equal(
    await evaluate(
      "document.querySelector('.api-page .api-field-input').readOnly",
    ),
    true,
  );
  await click(`${current("#apiWrapper")} .apiBtnDel`);
  assert.equal(
    await evaluate("document.querySelectorAll('.api-page').length"),
    3,
  );
  await drag("#apiWrapper", -170);
  const longText = "FontFamily-".repeat(35);
  const field = `${current("#apiWrapper")} .api-field-input`;
  await evaluate(
    `(() => { const field = document.querySelector('${field}'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(longText)}); field.dispatchEvent(new Event('input',{bubbles:true})); field.scrollLeft=0; })()`,
  );
  await dragControl(field, -100);
  assert.ok(
    await evaluate(`document.querySelector('${field}').scrollLeft > 30`),
  );
  assert.equal(
    await evaluate(`document.querySelector('${field}').value`),
    longText,
  );
  assert.equal(await selected("#apiWrapper"), 1);
  await click(`${current("#apiWrapper")} .apiBtnDel`);
  await waitFor(
    () => evaluate("document.querySelectorAll('.api-page').length === 2"),
    "Font deletion did not finish",
  );
  assert.equal(await selected("#apiWrapper"), 0);

  await click("#paperOverlay");
  await folder("#folderVoiceSettings");
  assert.equal(
    await evaluate("document.querySelectorAll('.vc-page.current').length"),
    1,
  );
  await click(".vc-page.current .vc-record");
  await click(".vc-page.current .vc-stub");
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.vc-page.current')?.classList.contains('playing')",
      ),
    "Voice playback did not start",
  );
  assert.deepEqual(
    await evaluate(
      `({record:getComputedStyle(document.querySelector('.vc-page.current .vc-record-inner')).animationName,wave:getComputedStyle(document.querySelector('.vc-page.current .vc-bar-wave i')).animationName})`,
    ),
    { record: "vcSpin", wave: "vcWave" },
  );
  for (let count = 2; count <= 3; count++) {
    await click(".vc-page.current .vc-add");
    await waitFor(
      async () => (await selected("#voiceWrapper")) === count - 1,
      "Added voice page was not selected",
    );
    assert.equal(
      await evaluate("document.querySelectorAll('.vc-page.current').length"),
      1,
    );
  }
  await click(".vc-page.current .vc-del");
  assert.equal(
    await evaluate("document.querySelectorAll('.vc-page').length"),
    3,
  );
  assert.ok(
    await evaluate(
      "[...document.querySelector('#voiceWrapper .settings-stack-track').children].some(page => page.getAnimations().length > 0)",
    ),
  );
  await waitFor(
    () => evaluate("document.querySelectorAll('.vc-page').length === 2"),
    "Voice deletion did not wait for the paper motion",
  );
  assert.equal(await selected("#voiceWrapper"), 1);
  await drag("#voiceWrapper", 170);
  assert.equal(await selected("#voiceWrapper"), 0);
  assert.equal(
    await evaluate(
      "document.querySelector('.vc-page.current').classList.contains('playing')",
    ),
    true,
  );
  await evaluate("window.finishVoice()");
  await waitFor(
    () =>
      evaluate(
        "!document.querySelector('.vc-page.current').classList.contains('playing')",
      ),
    "Voice playback did not finish",
  );
  await click(".vc-page.current .vc-del");
  await waitFor(
    () => evaluate("document.querySelectorAll('.vc-page').length === 1"),
    "First voice page deletion did not select the adjacent page",
  );
  assert.equal(await selected("#voiceWrapper"), 0);
  await click(".vc-page.current .vc-del");
  assert.equal(
    await evaluate("document.querySelectorAll('.vc-page').length"),
    1,
  );
  await call("Emulation.setDeviceMetricsOverride", {
    width: 430,
    height: 900,
    deviceScaleFactor: 1,
    mobile: true,
  });
  assert.equal(await selected("#voiceWrapper"), 0);
  await click("#paperOverlay");
  await folder("#folderStorageSettings");
  assert.equal(
    await evaluate(
      "document.querySelector('.paper-stack-container').classList.contains('has-paper-stack')",
    ),
    false,
  );
  assert.equal(
    await evaluate(
      "getComputedStyle(document.querySelector('.paper-main > .paper-holes')).display",
    ),
    "flex",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS settings shared paper stacks, fixed layers, shadow/rotation, return/rebound, controls, full-text scrolling, page add/delete and voice animations.",
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
  assert.equal(path.dirname(profile), tmpdir());
  await rm(profile, { recursive: true });
}
