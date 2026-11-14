import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocket } from "ws";
import { API_FORMAT_REMINDER } from "../server/src/apiPrompt.ts";

test(
  "API channel routes persist selection, stream history, fork, stop, and return to Codex",
  { timeout: 30_000 },
  async () => {
    const workspace = process.cwd();
    const directory = await mkdtemp(path.join(workspace, ".tmp-api-channel-"));
    const received: any[] = [];
    let providerStopped: () => void;
    const providerClosed = new Promise<void>((resolve) => {
      providerStopped = resolve;
    });
    const provider = createServer(async (request, response) => {
      assert.equal(request.url, "/relay/chat/completions");
      assert.equal(request.headers.authorization, "Bearer backend-only-key");
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      received.push(body);
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "API 回答" } }] })}\n\n`,
      );
      if (body.messages.at(-1).content === `stop\n\n${API_FORMAT_REMINDER}`) {
        response.on("close", () => providerStopped());
        return;
      }
      response.end(
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { total_tokens: 12 } })}\n\ndata: [DONE]\n\n`,
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const endpoint = `http://127.0.0.1:${(provider.address() as import("node:net").AddressInfo).port}/relay`;
    await mkdir(path.join(directory, "server/data"), { recursive: true });
    await writeFile(
      path.join(directory, "server/data/config.json"),
      JSON.stringify({
        workingDirectory: directory,
        sandbox: "workspace-write",
        model: "",
        channel: { kind: "api", presetId: "paper" },
      }),
    );
    await writeFile(
      path.join(directory, "server/data/api-presets.json"),
      JSON.stringify({
        presets: [
          {
            id: "paper",
            note: "我的 API",
            endpoint,
            key: "backend-only-key",
            model: "manual-model",
            format: "openai",
          },
        ],
      }),
    );
    // 独立端口和数据目录，不连接真实服务商或 Codex。
    const bootstrap = `
    import { Server } from 'node:http';
    const listen = Server.prototype.listen;
    Server.prototype.listen = function(port, ...args) {
      if (port === 8787) { port = 0; this.once('listening', () => process.send({ port: this.address().port })); }
      return listen.call(this, port, ...args);
    };
    await import(${JSON.stringify(pathToFileURL(path.join(workspace, "server/src/index.ts")).href)});
  `;
    const backend = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(path.join(workspace, "node_modules/tsx/dist/loader.mjs"))
          .href,
        "--input-type=module",
        "--eval",
        bootstrap,
      ],
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
      const [{ port }] = await Promise.race([
        once(backend, "message") as Promise<[{ port: number }]>,
        once(backend, "exit").then(() => {
          throw new Error(logs || "Backend exited before listening");
        }),
      ]);
      const base = `http://127.0.0.1:${port}`;
      const request = async (
        url: string,
        method = "GET",
        body?: unknown,
        status = 200,
      ) => {
        const response = await fetch(base + url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await response.text();
        assert.equal(response.status, status, text);
        return text ? JSON.parse(text) : null;
      };
      const events: any[] = [];
      const waiters = new Set<() => void>();
      const waitEvent = (match: (event: any) => boolean): Promise<any> =>
        new Promise((resolve) => {
          const check = () => {
            const event = events.find(match);
            if (event) {
              waiters.delete(check);
              resolve(event);
            }
          };
          waiters.add(check);
          check();
        });
      socket = new WebSocket(base.replace("http", "ws") + "/ws");
      socket.on("message", (raw) => {
        const envelope = JSON.parse(String(raw));
        events.push(envelope.kind === "event" ? envelope.event : envelope);
        for (const check of waiters) check();
      });
      const session = await waitEvent((event) => event.kind === "session");
      assert.deepEqual(session.channel, {
        kind: "api",
        presetId: "paper",
        name: "我的 API",
      });
      const presets = await request("/api/api-presets");
      assert.equal(presets.presets[0].key, undefined);
      const messages = [
        { role: "user", content: "旧问题" },
        { role: "assistant", content: "旧回答" },
        { role: "user", content: "新问题" },
      ];
      const turn = await request("/api/turn", "POST", {
        conversationId: "c1",
        text: "新问题",
        messages,
      });
      await waitEvent(
        (event) =>
          event.type === "turn-completed" && event.turnId === turn.turnId,
      );
      assert.deepEqual(received[0].messages.slice(1), [
        ...messages.slice(0, -1),
        { role: "user", content: `新问题\n\n${API_FORMAT_REMINDER}` },
      ]);
      assert.equal(received[0].messages[0].role, "system");
      assert.match(received[0].messages[0].content, /現在是/);
      assert.match(received[0].messages[0].content, /<mian-thinking>/);
      assert.doesNotMatch(
        received[0].messages[0].content,
        /mian-pre-tool|mian-tool-summary/,
      );
      assert.equal(received[0].stream, true);
      assert.equal(
        events.find((event) => event.type === "assistant-delta").delta,
        "API 回答",
      );
      const list = await request("/api/conversations");
      assert.equal(list.conversations[0].totalTokens, 12);
      assert.equal(list.conversations[0].threadId, null);
      const { conversation: branch } = await request(
        "/api/conversations/c1/fork",
        "POST",
        undefined,
        201,
      );
      assert.equal(branch.parentConversationId, "c1");
      assert.equal(branch.threadId, null);
      const { conversation: root } = await request(
        "/api/conversations",
        "POST",
        undefined,
        201,
      );
      assert.equal(root.parentConversationId, null);
      const stopping = await request("/api/turn", "POST", {
        conversationId: branch.conversationId,
        text: "stop",
        messages: [
          ...messages,
          { role: "assistant", content: "API 回答" },
          { role: "user", content: "stop" },
        ],
      });
      await waitEvent(
        (event) =>
          event.type === "assistant-delta" && event.turnId === stopping.turnId,
      );
      assert.equal(received[1].messages.length, 6);
      assert.deepEqual(received[1].messages.slice(1, 4), messages);
      await request(
        `/api/conversations/${branch.conversationId}`,
        "DELETE",
        undefined,
        409,
      );
      await request(
        `/api/turn/${stopping.turnId}/interrupt`,
        "POST",
        { conversationId: "c1" },
        409,
      );
      await request(`/api/turn/${stopping.turnId}/interrupt`, "POST", {
        conversationId: branch.conversationId,
      });
      const interrupted = await waitEvent(
        (event) =>
          event.type === "turn-completed" && event.turnId === stopping.turnId,
      );
      assert.equal(interrupted.status, "interrupted");
      await providerClosed;
      await request(
        `/api/conversations/${branch.conversationId}`,
        "DELETE",
        undefined,
        204,
      );
      await request("/api/subscriptions/codex/use", "POST");
      assert.deepEqual((await request("/api/config")).channel, {
        kind: "codex",
      });
      assert.equal((await request("/api/api-presets")).activeId, null);
      await request("/api/api-presets/paper/use", "POST");
      assert.deepEqual((await request("/api/config")).channel, {
        kind: "api",
        presetId: "paper",
      });
      assert.equal(
        events.some(
          (event) => event.type === "tool" || event.type === "approval",
        ),
        false,
      );
    } finally {
      socket?.close();
      const exited = once(backend, "exit");
      if (process.platform === "win32")
        spawnSync("taskkill.exe", ["/PID", String(backend.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      else backend.kill("SIGKILL");
      await exited;
      provider.closeAllConnections();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      assert.equal(path.dirname(directory), workspace);
      await rm(directory, { recursive: true });
    }
  },
);
