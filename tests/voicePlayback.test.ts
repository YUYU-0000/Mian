import assert from "node:assert/strict";
import test from "node:test";
import { api } from "../client/src/api.ts";
import { defaultVoicePreset } from "../shared/voice.mjs";

test("preview waits for actual playback and resolves only after ended; stop and playback errors clean up", async t => {
  let created: (audio: FakeAudio) => void;
  class FakeAudio {
    onplaying: (() => void) | null = null;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    paused = true;
    constructor(public src: string) { created(this); }
    async play() { this.paused = false; }
    pause() { this.paused = true; }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  Object.defineProperty(globalThis, "Audio", { configurable: true, value: FakeAudio });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "Audio", previous);
    else Reflect.deleteProperty(globalThis, "Audio");
  });
  t.mock.method(globalThis, "fetch", async () => new Response("audio", { headers: { "content-type": "audio/mpeg" } }));
  let ready = new Promise<FakeAudio>(resolve => { created = resolve; });
  let started = false, settled = false;
  const playback = api.testVoice(defaultVoicePreset, new AbortController().signal, () => { started = true; });
  void playback.then(() => { settled = true; });
  const audio = await ready;
  assert.equal(started, false);
  assert.equal(settled, false);
  audio.onplaying!();
  assert.equal(started, true);
  assert.equal(settled, false);
  audio.onended!();
  await playback;
  assert.equal(settled, true);
  assert.equal(audio.paused, true);

  ready = new Promise<FakeAudio>(resolve => { created = resolve; });
  const controller = new AbortController();
  const stopped = api.testVoice(defaultVoicePreset, controller.signal, () => {});
  const stoppedAudio = await ready;
  controller.abort();
  await assert.rejects(stopped, { name: "AbortError" });
  assert.equal(stoppedAudio.paused, true);
  assert.equal(stoppedAudio.onplaying, null);

  ready = new Promise<FakeAudio>(resolve => { created = resolve; });
  const failed = api.testVoice(defaultVoicePreset, new AbortController().signal, () => {});
  (await ready).onerror!();
  await assert.rejects(failed, /音頻播放失敗/);
});

test("preview preserves the server's ElevenLabs error message", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "quota_exceeded: remaining credits 0" }, { status: 400 }));
  await assert.rejects(api.testVoice(defaultVoicePreset, new AbortController().signal, () => assert.fail("must not start")), /quota_exceeded: remaining credits 0/);
});
