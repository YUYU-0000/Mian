import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mp3 } from "./voiceFixtures.mjs";
import { synthesizeVoice } from "../server/src/elevenLabs.ts";
import { VoiceGeneration } from "../server/src/voiceGeneration.ts";
import { ChatFiles } from "../server/src/chatFiles.ts";
import { estimatedVoiceDuration, splitVoiceText, stripVoiceTags } from "../shared/voice.mjs";
import { parseReply } from "../shared/replyProtocol.mjs";

const preset = { id: "preset", note: "", key: "secret", voice_id: "voice", model: "", words: "" };
const audioResponse = (seconds = 1) => new Response(mp3(seconds), { headers: { "content-type": "audio/mpeg" } });

test("duration counts only Chinese, ellipses and tags; spoken tags stay intact while display removes them", () => {
  assert.equal(estimatedVoiceDuration("[breath warm, unsteady]你好嗎…… abc [sharp inhale, long trembling exhale]"), 5.9);
  assert.equal(estimatedVoiceDuration("English 123!?"), 0);
  const raw = "[breath warm, unsteady]陪你等天亮。[sharp inhale, long trembling exhale]";
  const parsed = parseReply(`<voice>${raw}</voice>`, "api", true);
  assert.equal(parsed.voices![0].text, raw);
  assert.deepEqual(parsed.bubbles, ["陪你等天亮。"]);
  assert.equal(stripVoiceTags("陪你。[sharp inhale,"), "陪你。");
  const text = `[warm]${"等".repeat(180)}。${"陪".repeat(160)}。`;
  const parts = splitVoiceText(text);
  assert.equal(parts.length, 2);
  assert.equal(parts.join(""), text);
});

test("empty model uses v4; only v3/v4 send square-bracket tags verbatim", async t => {
  const requests: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requests.push(JSON.parse(String(init!.body)));
    return audioResponse();
  });
  const text = "[breath warm, unsteady]陪你等天亮。";
  for (const model of ["", "eleven_v3", "eleven_v4-preview", "eleven_multilingual_v2"])
    await synthesizeVoice({ ...preset, model }, text);
  assert.deepEqual(requests.map(item => item.model_id), ["eleven_v4", "eleven_v3", "eleven_v4-preview", "eleven_multilingual_v2"]);
  assert.deepEqual(requests.map(item => item.text), [text, text, text, "陪你等天亮。"]);
  await assert.rejects(synthesizeVoice({ ...preset, key: "" }, text), /TOKEN/);
  await assert.rejects(synthesizeVoice({ ...preset, voice_id: "" }, text), /VOICE/);
});

test("only an overlong result gets exactly one regeneration", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => audioResponse(++calls === 1 ? 20 : 1));
  const voice = await synthesizeVoice(preset, "陪你等天亮。");
  assert.equal(calls, 2);
  assert.ok(voice.duration < 2);
});

test("message/content cache shares concurrent generation and survives reload; failures never retry", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "mian-voice-cache-"));
  t.after(async () => {
    assert.equal(path.dirname(directory), tmpdir());
    await rm(directory, { recursive: true, force: true });
  });
  const files = new ChatFiles(path.join(directory, "files"));
  const root = path.join(directory, "cache");
  const generation = new VoiceGeneration(files, root);
  let calls = 0;
  let mode: "ok" | "long" | "error" = "ok";
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (mode === "error") return Response.json({ detail: { message: "quota exceeded" } }, { status: 429 });
    return audioResponse(mode === "long" ? 20 : 1);
  });
  const signal = new AbortController().signal;
  const text = `[breath warm, unsteady]${"等".repeat(180)}。${"陪".repeat(160)}。`;
  const [first, duplicate] = await Promise.all([
    generation.chat("c1", "message", text, preset, signal),
    generation.chat("c1", "message", text, preset, signal),
  ]);
  assert.deepEqual(first, duplicate);
  assert.equal(calls, 2);
  assert.equal(first.parts!.length, 2);
  assert.equal(first.text, stripVoiceTags(text));
  assert.equal((await files.export(["c1"])).length, 2);
  assert.deepEqual(await new VoiceGeneration(files, root).chat("c1", "message", text, preset, signal), first);
  assert.equal(calls, 2);
  mode = "long";
  await assert.rejects(generation.chat("c1", "too-long", "你好。", preset, signal), /超出預計時長/);
  assert.equal(calls, 4);
  await assert.rejects(new VoiceGeneration(files, root).chat("c1", "too-long", "你好。", preset, signal), /超出預計時長/);
  assert.equal(calls, 4);
  mode = "error";
  await assert.rejects(generation.chat("c1", "error", "你好。", preset, signal), /quota exceeded/);
  await assert.rejects(generation.chat("c1", "error", "你好。", preset, signal), /quota exceeded/);
  assert.equal(calls, 5);
  assert.equal((await files.export(["c1"])).length, 2);
});
