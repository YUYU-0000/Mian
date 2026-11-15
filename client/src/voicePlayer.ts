import type { VoiceClip } from "../../shared/voice.mjs";

type Playback = {
  id: string;
  controller: AbortController;
  urls: string[];
  index: number;
  resolve: () => void;
  reject: (error: unknown) => void;
  detach: () => void;
  onPlaying?: () => void;
};
type PlayerState = { id: string | null; playing: boolean; duration: number | null };

// 试听和聊天共用这一个 Audio。只有用户点击会装载新的播放队列。
class VoicePlayer {
  private audio: HTMLAudioElement | null = null;
  private playback: Playback | null = null;
  private state: PlayerState = { id: null, playing: false, duration: null };
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

  play(id: string, load: (signal: AbortSignal) => Promise<VoiceClip>, signal?: AbortSignal, onPlaying?: () => void) {
    this.stop();
    let playback: Playback;
    const done = new Promise<void>((resolve, reject) => {
      playback = { id, controller: new AbortController(), urls: [], index: 0, resolve, reject, detach: () => {}, onPlaying };
    });
    this.playback = playback!;
    this.update({ id, playing: false, duration: null });
    const stop = () => this.finish(playback, signal!.reason);
    signal?.addEventListener("abort", stop, { once: true });
    playback!.detach = () => signal?.removeEventListener("abort", stop);
    if (signal?.aborted) stop();
    else void this.load(playback!, load).catch(error => this.finish(playback, error));
    return done;
  }

  private async load(playback: Playback, load: (signal: AbortSignal) => Promise<VoiceClip>) {
    const clip = await load(playback.controller.signal);
    playback.controller.signal.throwIfAborted();
    playback.urls = clip.parts?.map(part => part.url) ?? [clip.url];
    this.update({ duration: clip.duration ?? null });
    const audio = this.audio ??= new Audio();
    audio.loop = false;
    audio.onplaying = () => {
      this.update({ playing: true });
      playback.onPlaying?.();
    };
    audio.onpause = () => this.update({ playing: false });
    audio.onloadedmetadata = () => {
      if (clip.duration === undefined) this.update({ duration: audio.duration });
    };
    audio.onerror = () => this.finish(playback, new Error("音頻播放失敗。"));
    audio.onended = () => {
      playback.index++;
      if (playback.index === playback.urls.length) this.finish(playback);
      else {
        audio.src = playback.urls[playback.index];
        void audio.play().catch(error => this.finish(playback, error));
      }
    };
    audio.src = playback.urls[0];
    await audio.play();
  }

  pause() { this.audio?.pause(); }
  resume() {
    const playback = this.playback;
    if (playback && this.audio) void this.audio.play().catch(error => this.finish(playback, error));
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
      this.audio.onplaying = this.audio.onpause = this.audio.onended = this.audio.onerror = this.audio.onloadedmetadata = null;
      this.audio.pause();
    }
    this.update({ id: null, playing: false, duration: null });
    if (error) playback.reject(error);
    else playback.resolve();
  }
}

export const voicePlayer = new VoicePlayer();
