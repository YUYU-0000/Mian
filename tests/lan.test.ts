import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocket } from "ws";

test(
  "built LAN server serves the SPA, API and WebSocket on one LAN listener without HMR",
  { timeout: 15_000 },
  async () => {
    const workspace = process.cwd();
    const directory = await mkdtemp(path.join(workspace, ".tmp-lan-test-"));
    // 用空闲端口运行正式构建，不占用正在使用的局域网服务。
    const bootstrap = `
    import { Server } from 'node:http';
    const listen = Server.prototype.listen;
    Server.prototype.listen = function(requestedPort, host, ...args) {
      this.once('listening', () => process.send({ requestedPort, host, port: this.address().port }));
      return listen.call(this, 0, host, ...args);
    };
    process.argv.push('--lan');
    await import(${JSON.stringify(pathToFileURL(path.join(workspace, "server/dist/index.js")).href)});
  `;
    const backend = spawn(
      process.execPath,
      ["--input-type=module", "--eval", bootstrap],
      {
        cwd: directory,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    let logs = "";
    backend.stderr.on("data", (chunk) => {
      logs += chunk;
    });
    let socket: WebSocket | undefined;
    try {
      const [{ requestedPort, host, port }] = await Promise.race([
        once(backend, "message") as Promise<
          [{ requestedPort: number; host: string; port: number }]
        >,
        once(backend, "exit").then(() => {
          throw new Error(logs || "LAN server did not start");
        }),
      ]);
      assert.equal(requestedPort, 5173);
      assert.equal(host, "0.0.0.0");
      const base = `http://127.0.0.1:${port}`;
      const page = await fetch(base + "/connections");
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.doesNotMatch(html, /@vite\/client|react-refresh/);
      const script = html.match(/src="(\/assets\/[^\"]+\.js)"/)![1];
      const asset = await fetch(base + script);
      assert.equal(asset.status, 200);
      assert.match(asset.headers.get("content-type")!, /javascript/);
      assert.equal((await fetch(base + "/api/config")).status, 200);
      const conversations = await (
        await fetch(base + "/api/conversations")
      ).json();
      assert.equal(conversations.conversations.length, 1);
      socket = new WebSocket(base.replace("http", "ws") + "/ws");
      const [message] = await once(socket, "message");
      assert.equal(JSON.parse(String(message)).kind, "session");
    } finally {
      socket?.terminate();
      const exited = once(backend, "exit");
      if (process.platform === "win32")
        spawnSync("taskkill.exe", ["/PID", String(backend.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      else backend.kill("SIGKILL");
      await exited;
      assert.equal(path.dirname(directory), workspace);
      await rm(directory, { recursive: true });
    }
  },
);
