import type { VoiceClip, VoicePart } from "../../shared/voice.mjs";

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

  play(id: string, load: (signal: AbortSignal) => Promise<VoiceClip>, signal?: AbortSignal, onPlaying?: () => void, startAt = 0) {
    this.stop();
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
    const clip = await load(playback.controller.signal);
    playback.controller.signal.throwIfAborted();
    playback.parts = clip.parts ?? [{ url: clip.url, duration: clip.duration ?? 0 }];
    this.update({ duration: clip.duration ?? (clip.parts ? clip.parts.reduce((sum, part) => sum + part.duration, 0) : null) });
    const audio = this.audio ??= new Audio();
    audio.loop = false;
    audio.onplaying = () => {
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

  private startPart(playback: Playback, position: number) {
    playback.seekTo = position;
    this.update({ playing: false, currentTime: playback.offset + position });
    this.audio!.src = playback.parts[playback.index].url;
    return this.audio!.play();
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
    if (playback?.parts.length && this.audio) void this.audio.play().catch(error => this.finish(playback, error));
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
