import type { VoiceClip, VoicePart } from "../../shared/voice.mjs";
import { cachedFileUrl } from "./fileCache";

export const VOICE_BAR_COUNT = 38;
// 固定打散频段，邻条不按音高排列；所有票根和预览共用同一顺序。
const BAND_ORDER = [33, 21, 17, 10, 25, 3, 23, 8, 6, 34, 0, 19, 32, 1, 7, 31, 22, 14, 5,
  12, 15, 11, 35, 24, 27, 2, 13, 29, 36, 26, 37, 18, 9, 16, 4, 20, 28, 30];

type Playback = {
  id: string;
  controller: AbortController;
  parts: VoicePart[];
  index: number;
  offset: number;
  seekTo: number | null;
  resolve: () => void;
  reject: (error: unknown) => void;
  detach: () => void;
  onPlaying?: () => void;
};
type PlayerState = { id: string | null; playing: boolean; duration: number | null; currentTime: number };

// 试听和聊天共用这一个 Audio。只有用户点击会装载新的播放队列。
class VoicePlayer {
  private audio: HTMLAudioElement | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private frequencies = new Uint8Array(1024);
  private spectrum = new Float32Array(VOICE_BAR_COUNT);
  private bandPeaks = new Float32Array(VOICE_BAR_COUNT);
  private spectrumTime = 0;
  private frequencyBands: [number, number][] = [];
  private playback: Playback | null = null;
  private state: PlayerState = { id: null, playing: false, duration: null, currentTime: 0 };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  // 在点击调用栈内创建/恢复，后面的加载和分段播放继续复用同一条音频链。
  private activateAudio() {
    this.audio ??= new Audio();
    if (!this.context) {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = this.frequencies.length * 2;
      this.analyser.minDecibels = -85;
      this.analyser.maxDecibels = -25;
      this.analyser.smoothingTimeConstant = 0;
      // 按对数划分人声频段，避免把大部分条码分给几乎无声的高频。
      const binHz = this.context.sampleRate / this.analyser.fftSize;
      const range = Math.min(8000, this.context.sampleRate / 2) / 80;
      this.frequencyBands = BAND_ORDER.map(index => [
        Math.floor(80 * range ** (index / VOICE_BAR_COUNT) / binHz),
        Math.ceil(80 * range ** ((index + 1) / VOICE_BAR_COUNT) / binHz),
      ]);
      this.context.createMediaElementSource(this.audio).connect(this.analyser);
      this.analyser.connect(this.context.destination);
    }
    return this.context.resume();
  }

  readSpectrum(time = performance.now()) {
    // 同一帧只取样一次，票根和展开的台词预览不会互相加快平滑速度。
    if (time === this.spectrumTime) return this.spectrum;
    const elapsed = time - this.spectrumTime;
    this.spectrumTime = time;
    this.analyser!.getByteFrequencyData(this.frequencies);
    this.frequencyBands.forEach(([start, end], index) => {
      let peak = 0;
      for (let bin = start; bin < end; bin++) peak = Math.max(peak, this.frequencies[bin]);
      const value = Math.max(0, peak / 255 - 0.08) / 0.92;
      // 每段单独保留近期峰值，缓慢释放增益；底噪不放大成满高。
      this.bandPeaks[index] = Math.max(value, this.bandPeaks[index] * Math.exp(-elapsed / 3000));
      const normalized = Math.min(1, value / Math.max(0.12, this.bandPeaks[index]));
      // 常态增益只占七成，剩下的幅度留给本身明显更响的频段。
      const loudness = Math.max(0, (value - 0.72) / 0.28);
      const target = normalized * (0.7 + 0.3 * loudness);
      const response = target > this.spectrum[index] ? 45 : 160;
      this.spectrum[index] += (target - this.spectrum[index]) * (1 - Math.exp(-elapsed / response));
    });
    return this.spectrum;
  }

  play(id: string, load: (signal: AbortSignal) => Promise<VoiceClip>, signal?: AbortSignal, onPlaying?: () => void, startAt = 0) {
    this.stop();
    this.spectrum.fill(0);
    this.bandPeaks.fill(0);
    let playback: Playback;
    const done = new Promise<void>((resolve, reject) => {
      playback = { id, controller: new AbortController(), parts: [], index: -1, offset: 0, seekTo: null, resolve, reject, detach: () => {}, onPlaying };
    });
    this.playback = playback!;
    this.update({ id, playing: false, duration: null, currentTime: 0 });
    const stop = () => this.finish(playback, signal!.reason);
    signal?.addEventListener("abort", stop, { once: true });
    playback!.detach = () => signal?.removeEventListener("abort", stop);
    if (signal?.aborted) stop();
    else void this.load(playback!, load, startAt).catch(error => this.finish(playback, error));
    return done;
  }

  private async load(playback: Playback, load: (signal: AbortSignal) => Promise<VoiceClip>, startAt: number) {
    const [, clip] = await Promise.all([this.activateAudio(), load(playback.controller.signal)]);
    playback.controller.signal.throwIfAborted();
    playback.parts = clip.parts ?? [{ url: clip.url, duration: clip.duration ?? 0 }];
    this.update({ duration: clip.duration ?? (clip.parts ? clip.parts.reduce((sum, part) => sum + part.duration, 0) : null) });
    const audio = this.audio!;
    audio.loop = false;
    audio.onplaying = () => {
      this.spectrumTime = performance.now();
      this.update({ playing: true });
      playback.onPlaying?.();
    };
    audio.onpause = () => this.update({ playing: false });
    audio.onloadedmetadata = () => {
      if (this.state.duration === null) {
        playback.parts[playback.index].duration = audio.duration;
        this.update({ duration: audio.duration });
      }
      if (playback.seekTo !== null) {
        audio.currentTime = playback.seekTo;
        playback.seekTo = null;
      }
    };
    audio.ontimeupdate = () => {
      if (playback.seekTo === null) this.update({ currentTime: playback.offset + audio.currentTime });
    };
    audio.onerror = () => this.finish(playback, new Error("音頻播放失敗。"));
    audio.onended = () => {
      if (playback.index + 1 === playback.parts.length) this.finish(playback);
      else {
        playback.offset += playback.parts[playback.index].duration;
        playback.index++;
        void this.startPart(playback, 0).catch(error => this.finish(playback, error));
      }
    };
    this.seek(startAt);
  }

  private async startPart(playback: Playback, position: number) {
    const ready = this.context!.resume();
    playback.seekTo = position;
    this.audio!.pause();
    this.update({ playing: false, currentTime: playback.offset + position });
    const index = playback.index;
    const source = playback.parts[index].url;
    const url = source.startsWith("/api/") ? await cachedFileUrl(source, playback.controller.signal) : source;
    if (playback.index !== index) return;
    this.audio!.src = url;
    await Promise.all([ready, this.audio!.play()]);
  }

  seek(seconds: number) {
    const playback = this.playback;
    if (!playback || !playback.parts.length) return;
    const time = Math.max(0, Math.min(seconds, this.state.duration ?? 0));
    let index = 0, offset = 0;
    while (index < playback.parts.length - 1 && offset + playback.parts[index].duration <= time) {
      offset += playback.parts[index++].duration;
    }
    playback.offset = offset;
    if (index !== playback.index) {
      playback.index = index;
      void this.startPart(playback, time - offset).catch(error => this.finish(playback, error));
    } else {
      if (playback.seekTo !== null) playback.seekTo = time - offset;
      else this.audio!.currentTime = time - offset;
      this.update({ currentTime: time });
      this.resume();
    }
  }

  pause() { this.audio?.pause(); }
  resume() {
    const playback = this.playback;
    if (playback?.parts.length && this.audio)
      void Promise.all([this.context!.resume(), this.audio.play()]).catch(error => this.finish(playback, error));
  }
  stop(id?: string) {
    if (this.playback && (id === undefined || this.playback.id === id))
      this.finish(this.playback, new DOMException("播放已停止", "AbortError"));
  }
  private finish(playback: Playback, error?: unknown) {
    if (this.playback !== playback) return;
    this.playback = null;
    playback.detach();
    playback.controller.abort();
    if (this.audio) {
      this.audio.onplaying = this.audio.onpause = this.audio.onended = this.audio.onerror = this.audio.onloadedmetadata = this.audio.ontimeupdate = null;
      this.audio.pause();
    }
    this.update({ id: null, playing: false, duration: null, currentTime: 0 });
    if (error) playback.reject(error);
    else playback.resolve();
  }
}

export const voicePlayer = new VoicePlayer();
