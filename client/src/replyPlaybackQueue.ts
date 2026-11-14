import {
  hydrateVisualReply,
  remainingPlaybackMs,
  skipPlaybackPrefix,
  tickVisualReply,
  type PlaybackTick,
  type VisualReply,
  type VisualTarget,
} from "./visualPlayback";

export const MAX_PLAYBACK_BACKLOG_MS = 2000;
const LIVE_TAIL_MS = 1000;
type Frame = { key: string; target: VisualTarget };

// 保留文字与工具事件的先后边界，连续文字分片合并。
export class ReplyPlaybackQueue {
  private frames: Frame[] = [];
  private completedAt: number | null = null;

  enqueue(key: string, target: VisualTarget, now: number) {
    const last = this.frames.at(-1);
    if (last?.key === key) last.target = target;
    else this.frames.push({ key, target });
    if (target.done && this.completedAt === null) this.completedAt = now;
  }

  tick(current: VisualReply, now: number): PlaybackTick {
    const latest = this.frames.at(-1)!.target;
    if (
      this.completedAt !== null &&
      now - this.completedAt >= MAX_PLAYBACK_BACKLOG_MS
    )
      return {
        view: hydrateVisualReply(latest),
        changed: true,
        wait: null,
        settled: true,
      };

    let view = current;
    const backlog = remainingPlaybackMs(view, latest);
    if (backlog > MAX_PLAYBACK_BACKLOG_MS) {
      let skip = backlog - LIVE_TAIL_MS;
      while (this.frames.length > 1) {
        const cost = remainingPlaybackMs(view, this.frames[0].target);
        if (cost > skip) break;
        view = hydrateVisualReply(this.frames.shift()!.target);
        skip -= cost;
      }
      if (skip > 0)
        view = skipPlaybackPrefix(view, this.frames[0].target, skip);
    }

    let changed = view !== current;
    for (;;) {
      const tick = tickVisualReply(view, this.frames[0].target, now);
      changed ||= tick.changed;
      if (tick.wait !== null || this.frames.length === 1)
        return { ...tick, changed };
      this.frames.shift();
      view = tick.view;
    }
  }
}
