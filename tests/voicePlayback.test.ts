// 验证共用播放器、分段跳转、频谱增益和播放中断。
import assert from "node:assert/strict";
import test from "node:test";
import { api } from "../client/src/api.ts";
import { voicePlayer } from "../client/src/voicePlayer.ts";
import { defaultVoicePreset } from "../shared/voice.mjs";

test("one global player waits for playing, replaces older audio, pauses and plays chunks once in order", async t => {
  let onPlay: () => void = () => { };
  let instances = 0;
  let audio: FakeAudio;
  class FakeAudio {
    onplaying: (() => void) | null = null;
    onpause: (() => void) | null = null;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onloadedmetadata: (() => void) | null = null;
    ontimeupdate: (() => void) | null = null;
    src = "";
    loop = true;
    paused = true;
    duration = 1;
    currentTime = 0;
    constructor() { instances++; audio = this; }
    async play() { this.paused = false; onPlay(); }
    pause() { this.paused = true; this.onpause?.(); }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  const previousContext = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  let contexts = 0, sources = 0, resumes = 0;
  const frequencyData = new Uint8Array(1024).fill(128);
  class FakeAudioContext {
    destination = {};
    sampleRate = 48000;
    constructor() { contexts++; }
    createAnalyser() { return { fftSize: 0, connect() { }, getByteFrequencyData(samples: Uint8Array) { samples.set(frequencyData); } }; }
    createMediaElementSource(element: FakeAudio) { assert.equal(element, audio); sources++; return { connect() { } }; }
    async resume() { resumes++; }
  }
  Object.defineProperty(globalThis, "Audio", { configurable: true, value: FakeAudio });
  Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: FakeAudioContext });
  t.after(() => {
    voicePlayer.stop();
    if (previous) Object.defineProperty(globalThis, "Audio", previous);
    else Reflect.deleteProperty(globalThis, "Audio");
    if (previousContext) Object.defineProperty(globalThis, "AudioContext", previousContext);
    else Reflect.deleteProperty(globalThis, "AudioContext");
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
  audio!.onloadedmetadata!();
  audio!.onplaying!();
  let time = performance.now();
  const sample = (elapsed: number) => Array.from(voicePlayer.readSpectrum(time += elapsed));
  const spectrum = sample(45);
  assert.equal(spectrum.length, 38);
  assert.ok(spectrum.every(level => level > 0.4 && level < 0.55), "each band rises quickly with gain headroom");
  frequencyData.fill(0);
  const falling = sample(45);
  assert.ok(falling.every((level, i) => level > spectrum[i] * 0.7 && level < spectrum[i]), "release is slower than attack");
  assert.deepEqual(Array.from(voicePlayer.readSpectrum(time)), falling, "two views share one sample per frame");
  sample(5000);
  frequencyData.fill(0); frequencyData[12] = 255;
  const low = sample(600);
  const lowBand = low.findIndex(value => value > 0.99);
  frequencyData.fill(0); frequencyData[240] = 80;
  const high = sample(900);
  const highBand = high.findIndex(value => value > 0.69);
  assert.ok(lowBand >= 0 && highBand >= 0 && highBand !== lowBand, "a quieter high frequency has its own gain and bar");
  assert.ok(high[highBand] <= 0.701, "automatic gain does not push quieter audio to the ceiling");
  assert.ok(high[lowBand] < 0.01, "the previous band falls independently");
  frequencyData.fill(0);
  assert.ok(sample(1000).every(level => level < 0.01), "silence settles every band");
  assert.equal(started, true);
  audio!.currentTime = 0.6;
  audio!.ontimeupdate!();
  assert.equal(voicePlayer.getSnapshot().currentTime, 0.6);
  voicePlayer.pause();
  assert.equal(audio!.paused, true);
  voicePlayer.resume();
  assert.equal(audio!.src, "/one.mp3");
  ready = new Promise<void>(resolve => { onPlay = resolve; });
  audio!.onended!();
  await ready;
  assert.equal(audio!.src, "/two.mp3");
  audio!.onloadedmetadata!();
  audio!.currentTime = 0.4;
  audio!.ontimeupdate!();
  assert.equal(voicePlayer.getSnapshot().currentTime, 1.4);
  assert.equal(settled, false);
  audio!.onended!();
  await playback;
  assert.equal(settled, true);
  assert.equal(audio!.paused, true);

  ready = new Promise<void>(resolve => { onPlay = resolve; });
  const first = voicePlayer.play("first", async () => clip, undefined, undefined, 1.5);
  const stopped = assert.rejects(first, { name: "AbortError" });
  await ready;
  assert.equal(audio!.src, "/two.mp3");
  audio!.onloadedmetadata!();
  assert.equal(audio!.currentTime, 0.5);
  assert.equal(voicePlayer.getSnapshot().currentTime, 1.5);
  voicePlayer.pause();
  voicePlayer.seek(0.25);
  assert.equal(audio!.src, "/one.mp3");
  assert.equal(audio!.paused, false);
  audio!.onloadedmetadata!();
  assert.equal(audio!.currentTime, 0.25);
  voicePlayer.seek(0.75);
  assert.equal(audio!.currentTime, 0.75);
  assert.equal(voicePlayer.getSnapshot().currentTime, 0.75);
  voicePlayer.seek(1.75);
  audio!.onloadedmetadata!();
  assert.equal(audio!.src, "/two.mp3");
  assert.equal(audio!.currentTime, 0.75);
  assert.equal(voicePlayer.getSnapshot().currentTime, 1.75);
  ready = new Promise<void>(resolve => { onPlay = resolve; });
  const controller = new AbortController();
  const second = api.testVoice(defaultVoicePreset, controller.signal, () => { });
  await stopped;
  await ready;
  assert.equal(instances, 1);
  assert.equal(contexts, 1);
  assert.equal(sources, 1);
  assert.ok(resumes > 1);
  controller.abort();
  await assert.rejects(second, { name: "AbortError" });
  assert.equal(audio!.paused, true);
  assert.equal(audio!.onplaying, null);
  assert.equal(audio!.ontimeupdate, null);
  assert.equal(voicePlayer.getSnapshot().currentTime, 0);

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
