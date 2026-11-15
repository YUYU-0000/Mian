import assert from "node:assert/strict";
import test from "node:test";
import { api } from "../client/src/api.ts";
import { voicePlayer } from "../client/src/voicePlayer.ts";
import { defaultVoicePreset } from "../shared/voice.mjs";

test("one global player waits for playing, replaces older audio, pauses and plays chunks once in order", async t => {
  let onPlay: () => void = () => {};
  let instances = 0;
  let audio: FakeAudio;
  class FakeAudio {
    onplaying: (() => void) | null = null;
    onpause: (() => void) | null = null;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onloadedmetadata: (() => void) | null = null;
    src = "";
    loop = true;
    paused = true;
    duration = 1;
    constructor() { instances++; audio = this; }
    async play() { this.paused = false; onPlay(); }
    pause() { this.paused = true; this.onpause?.(); }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  Object.defineProperty(globalThis, "Audio", { configurable: true, value: FakeAudio });
  t.after(() => {
    voicePlayer.stop();
    if (previous) Object.defineProperty(globalThis, "Audio", previous);
    else Reflect.deleteProperty(globalThis, "Audio");
  });
  const clip = { url: "/one.mp3", text: "陪你。", duration: 2, parts: [{ url: "/one.mp3", duration: 1 }, { url: "/two.mp3", duration: 1 }] };
  t.mock.method(globalThis, "fetch", async () => Response.json(clip));
  let ready = new Promise<void>(resolve => { onPlay = resolve; });
  let started = false, settled = false;
  const playback = api.testVoice(defaultVoicePreset, new AbortController().signal, () => { started = true; });
  void playback.then(() => { settled = true; });
  await ready;
  assert.equal(started, false);
  assert.equal(settled, false);
  assert.equal(audio!.loop, false);
  audio!.onplaying!();
  assert.equal(started, true);
  voicePlayer.pause();
  assert.equal(audio!.paused, true);
  voicePlayer.resume();
  assert.equal(audio!.src, "/one.mp3");
  ready = new Promise<void>(resolve => { onPlay = resolve; });
  audio!.onended!();
  await ready;
  assert.equal(audio!.src, "/two.mp3");
  assert.equal(settled, false);
  audio!.onended!();
  await playback;
  assert.equal(settled, true);
  assert.equal(audio!.paused, true);

  ready = new Promise<void>(resolve => { onPlay = resolve; });
  const first = voicePlayer.play("first", async () => clip);
  const stopped = assert.rejects(first, { name: "AbortError" });
  await ready;
  ready = new Promise<void>(resolve => { onPlay = resolve; });
  const controller = new AbortController();
  const second = api.testVoice(defaultVoicePreset, controller.signal, () => {});
  await stopped;
  await ready;
  assert.equal(instances, 1);
  controller.abort();
  await assert.rejects(second, { name: "AbortError" });
  assert.equal(audio!.paused, true);
  assert.equal(audio!.onplaying, null);

  let release!: (value: typeof clip) => void;
  const waiting = voicePlayer.play("pending", async () => new Promise(resolve => { release = resolve; }));
  const canceled = assert.rejects(waiting, { name: "AbortError" });
  voicePlayer.stop("pending");
  release(clip);
  await canceled;
  await Promise.resolve();
  assert.equal(voicePlayer.getSnapshot().id, null);
  assert.equal(audio!.paused, true);
});

test("preview preserves the server's ElevenLabs error message", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "quota_exceeded: remaining credits 0" }, { status: 400 }));
  await assert.rejects(api.testVoice(defaultVoicePreset, new AbortController().signal, () => assert.fail("must not start")), /quota_exceeded: remaining credits 0/);
});
