import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { fileTicketServer } from "./fileTickets.server.mjs";
import { parseReply } from "../shared/replyProtocol.mjs";
import { chatHistory, type ReplyGroup } from "../shared/chatModel.mjs";
import { getActiveScenes } from "../server/src/clueSelection.ts";
import { completeBackup } from "../client/src/settingsBackup.ts";
import { mp3 } from "./voiceFixtures.mjs";

const reply = "<mian-thinking>陪她坐一會兒。</mian-thinking><mian-bubble>在。</mian-bubble><voice>陪你等天亮。</voice><mian-bubble>聽見了嗎。</mian-bubble>";
const preset = { id: "voice-test", note: "夜晚", key: "test-secret", voice_id: "speaker-one", model: "eleven_v3", words: "" };

test("voice markers retain order and partial streaming hides protocol fragments", () => {
  for (const format of [undefined, "api"] as const) {
    const parsed = parseReply(reply, format, true);
    assert.deepEqual(parsed.bubbles, ["在。", "陪你等天亮。", "聽見了嗎。"]);
    assert.deepEqual(parsed.voices, [{ section: "bubble", index: 1, text: "陪你等天亮。", complete: true }]);
    const partial = parseReply("<voice>等等。</voi", format);
    assert.deepEqual(partial.bubbles, ["等等。"]);
    assert.equal(partial.voices![0].complete, false);
    const nested = parseReply("<mian-pre-tool><voice>我看看。</voice></mian-pre-tool><mian-bubble>前<voice>語音</voice>後</mian-bubble>", format, true);
    assert.deepEqual(nested.preToolBubbles, ["我看看。"]);
    assert.deepEqual(nested.bubbles, ["前", "語音", "後"]);
    assert.deepEqual(nested.voices!.map(({ section, index }) => [section, index]), [["pre-tool", 0], ["bubble", 1]]);
  }
  assert.deepEqual(getActiveScenes(), []);
  assert.deepEqual(getActiveScenes("voice"), ["voice"]);
});

test("voice pages save all fields, mask keys, choose a preset and preview the requested page", async () => {
  const server = await fileTicketServer({ voice: true });
  const request = (url: string, method = "GET", body?: unknown) => fetch(server.base + url, {
    method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    const saved = await (await request("/api/voice-presets", "POST", preset)).json();
    assert.equal(saved.presets[1].hasKey, true);
    assert.equal(JSON.stringify(saved).includes(preset.key), false);
    assert.equal("key" in saved.presets[1], false);
    const selected = await (await request(`/api/voice-presets/${preset.id}/use`, "POST")).json();
    assert.equal(selected.activeId, preset.id);
    const edited = { ...saved.presets[1], note: "已保存", words: "另一頁的試聽。", voice_id: "speaker-two" };
    await request("/api/voice-presets", "POST", edited);
    const reopened = await (await request("/api/voice-presets")).json();
    assert.equal(reopened.activeId, preset.id);
    assert.equal(reopened.presets[1].words, edited.words);
    const stored = JSON.parse(await readFile(path.join(server.directory, "server/data/voice-presets.json"), "utf8"));
    assert.equal(stored.presets[1].key, preset.key);
    assert.equal(stored.presets[1].note, edited.note);
    assert.deepEqual(await (await request("/api/voice-models", "POST", edited)).json(), [{ id: "eleven_v4", name: "Eleven v4" }]);
    assert.deepEqual(await (await request("/api/voice-list", "POST", edited)).json(), [{ id: "speaker-one", name: "夜晚" }, { id: "speaker-two", name: "另一個聲音" }]);
    const preview = await (await request("/api/voice-test", "POST", { ...edited, voice_id: "preview-only", model: "" })).json();
    const audio = await request(preview.url);
    assert.equal(audio.headers.get("content-type"), "audio/mpeg");
    assert.deepEqual(Buffer.from(await audio.arrayBuffer()), mp3());
    assert.match(server.speechRequests[0].url, /text-to-speech\/preview-only\?output_format=mp3_44100_128$/);
    assert.equal(server.speechRequests[0].headers["xi-api-key"], preset.key);
    assert.deepEqual(server.speechRequests[0].body, { text: edited.words, model_id: "eleven_v4" });
    await request("/api/voice-test", "POST", { ...edited, words: "  " });
    assert.equal(server.speechRequests[1].body.text, "陪你等天亮。");
    const failed = await request("/api/voice-test", "POST", { ...edited, key: "reject-key" });
    assert.equal((await failed.json()).error, "ElevenLabs: invalid API key");
    const removed = await (await request(`/api/voice-presets/${preset.id}`, "DELETE")).json();
    assert.equal(removed.presets.length, 1);
    assert.equal(removed.activeId, removed.presets[0].id);
  } finally { await server.close(); }
});

for (const channel of ["api", "codex"])
  test(`${channel} voice messages persist audio, inject scene clues, fall back to text and survive backup`, async () => {
    const server = await fileTicketServer({ reply, voice: true });
    const request = (url: string, method = "GET", body?: unknown) => fetch(server.base + url, {
      method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const socket = new WebSocket(server.base.replace("http", "ws") + "/ws");
    await once(socket, "open");
    const events: any[] = [];
    socket.on("message", raw => events.push(JSON.parse(String(raw)).event));
    const completed = () => new Promise<any>(resolve => {
      const listen = (raw: Buffer) => {
        const event = JSON.parse(String(raw)).event;
        if (event?.type === "turn-completed") { socket.off("message", listen); resolve(event); }
      };
      socket.on("message", listen);
    });
    const start = async () => {
      const done = completed();
      const response = await request("/api/turn", "POST", { conversationId: "c1", text: "說給我聽。" });
      assert.equal(response.status, 200);
      return { done, turn: await response.json() };
    };
    try {
      await request("/api/voice-presets", "POST", preset);
      await request(`/api/voice-presets/${preset.id}/use`, "POST");
      await request("/api/clues", "POST", {
        id: "voice-clue", title: "生成語音條", content: "VOICE_SCENE_WORDING", mode: "trigger", when: "", scenes: ["voice"],
        layout: 0, x: 0, y: 0, w: 84, h: 88, r: 0, order: 0, createdAt: "before", updatedAt: "before",
      });
      if (channel === "codex") await request("/api/subscriptions/codex/use", "POST", {});
      await (await start()).done;
      const scenePrompt = channel === "api" ? server.received[0].messages[0].content : server.systemPrompts[0];
      assert.match(scenePrompt, /生成語音條時的線索/);
      assert.match(scenePrompt, /VOICE_SCENE_WORDING/);
      const snapshot = await (await request("/api/conversations/c1/messages")).json();
      const group = snapshot.groups.at(-1) as ReplyGroup;
      assert.equal(group.status, "completed");
      assert.deepEqual(group.bubbles, ["在。", "陪你等天亮。", "聽見了嗎。"]);
      const clip = group.voices![group.bubbleIds[1]];
      assert.equal(clip.text, "陪你等天亮。");
      assert.match(clip.url, /^\/api\/conversations\/c1\/files\/.+\?inline=1$/);
      assert.deepEqual(Buffer.from(await (await request(clip.url)).arrayBuffer()), mp3());
      assert.equal(JSON.stringify(snapshot).includes(mp3().toString("base64")), false);
      assert.equal(chatHistory(snapshot.groups).at(-1)!.content, "在。\n\n陪你等天亮。\n\n聽見了嗎。");
      const exported = completeBackup(await (await request("/api/backup")).json(), { getItem: () => null });
      assert.equal(JSON.stringify(exported).includes(preset.key), false);
      assert.equal(exported.voices!.activeId, preset.id);
      const audioFile = exported.files!.find(item => item.file.mimeType === "audio/mpeg")!;
      assert.deepEqual(Buffer.from(audioFile.content, "base64"), mp3());
      await writeFile(path.join(server.directory, "server/data/files/c1", audioFile.file.id, "content"), "replace-me");
      assert.equal((await request("/api/backup", "POST", exported)).status, 200);
      assert.deepEqual(Buffer.from(await (await request(clip.url)).arrayBuffer()), mp3());
      assert.equal((await (await request("/api/voice-presets")).json()).presets[1].hasKey, true);

      await request("/api/voice-presets", "POST", { ...preset, key: "reject-key" });
      const voiceCount = events.filter(event => event?.type === "voice").length;
      await (await start()).done;
      const fallback = (await (await request("/api/conversations/c1/messages")).json()).groups.at(-1);
      assert.equal(fallback.status, "completed");
      assert.equal(fallback.voices, undefined);
      assert.deepEqual(fallback.bubbles, group.bubbles);
      assert.equal(events.filter(event => event?.type === "voice").length, voiceCount);

      await writeFile(path.join(server.directory, "server/data/voice-presets.json"), JSON.stringify({ presets: [], activeId: "" }));
      assert.equal((await request("/api/backup", "POST", exported)).status, 200);
      const imported = await (await request("/api/voice-presets")).json();
      assert.equal(imported.presets[1].hasKey, false);
    } finally { socket.close(); await server.close(); }
  });
