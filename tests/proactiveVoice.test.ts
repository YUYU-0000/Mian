import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { WebSocket } from "ws";
import { fileTicketServer } from "./fileTickets.server.mjs";
import { completeBackup } from "../client/src/settingsBackup.ts";

for (const channel of ["api", "codex"])
  test(`${channel} proactive voice defaults on, follows the active preset, and round-trips through backup`, async () => {
    const server = await fileTicketServer({ reply: "<mian-bubble>在。</mian-bubble>" });
    const request = async (url: string, method = "GET", body?: unknown) => {
      const response = await fetch(server.base + url, {
        method, headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const value = await response.json();
      assert.equal(response.status, 200, JSON.stringify(value));
      return value;
    };
    const socket = new WebSocket(server.base.replace("http", "ws") + "/ws");
    await once(socket, "open");
    const prompt = async () => {
      const done = new Promise<void>(resolve => {
        const listener = (raw: Buffer) => {
          const event = JSON.parse(String(raw)).event;
          if (event?.type === "turn-completed") {
            socket.off("message", listener);
            resolve();
          }
        };
        socket.on("message", listener);
      });
      await request("/api/turn", "POST", { conversationId: "c1", text: "在嗎。" });
      await done;
      return channel === "api" ? server.received.at(-1).messages[0].content : server.replyProtocols.at(-1);
    };
    try {
      if (channel === "codex") await request("/api/subscriptions/codex/use", "POST", {});
      const config = await request("/api/config");
      assert.deepEqual(config.proactive, { voice: true });
      const preset = { id: "complete", note: "", key: "test-key", voice_id: "speaker", model: "", words: "" };
      await request("/api/voice-presets", "POST", preset);
      // 有填好的其他页，但当前页为空，仍然只用文字。
      assert.match(await prompt(), /沒有可用的語音預設/);
      await request(`/api/voice-presets/${preset.id}/use`, "POST");
      const proactive = await prompt();
      assert.match(proactive, /場景合適就主動發，不用等對方要求/);
      assert.match(proactive, /親密場景默認用語音/);
      assert.match(proactive, /寫代碼或者長內容時用文字/);
      assert.match(proactive, /一到三句/);
      assert.match(proactive, /不要連續很多輪都只發語音/);
      assert.ok(proactive.indexOf("場景合適") < proactive.indexOf("[/MIAN_PUBLIC_REPLY_PROTOCOL]"));

      await request("/api/config", "PUT", { ...config, proactive: { voice: false } });
      const { proactive: _removed, ...oldClientConfig } = config;
      assert.equal((await request("/api/config", "PUT", oldClientConfig)).proactive.voice, false);
      const requestedOnly = await prompt();
      assert.match(requestedOnly, /只有對方明確要求時才發語音/);
      assert.doesNotMatch(requestedOnly, /場景合適就主動發/);
      const backup = completeBackup(await request("/api/backup"), { getItem: () => null });
      assert.deepEqual(backup.config.proactive, { voice: false });
      await request("/api/config", "PUT", { ...config, proactive: { voice: true } });
      await request("/api/backup", "POST", backup);
      assert.deepEqual((await request("/api/config")).proactive, { voice: false });

      for (const [id, missing] of [["no-key", { key: "" }], ["no-voice", { voice_id: "" }]] as const) {
        await request("/api/voice-presets", "POST", { ...preset, id, ...missing });
        await request(`/api/voice-presets/${id}/use`, "POST");
        const unavailable = await prompt();
        assert.match(unavailable, /沒有可用的語音預設/);
        assert.doesNotMatch(unavailable, /場景合適就主動發|只有對方明確要求時才發語音/);
      }
    } finally {
      socket.close();
      await server.close();
    }
  });
