import { useCallback, type CSSProperties } from "react";
import { voicePlayer, VOICE_BAR_COUNT } from "../voicePlayer";

const emptyPeaks = Array<number>(VOICE_BAR_COUNT).fill(0);

export default function VoiceWave({ peaks = emptyPeaks, playing, progress, duration, onSeek }: {
  peaks?: number[];
  playing: boolean;
  progress: number;
  duration: number | null;
  onSeek: (position: number) => void;
}) {
  const animateWave = useCallback((element: HTMLButtonElement | null) => {
    if (!element || !playing) return;
    const bars = [...element.querySelectorAll("i")];
    let frame: number;
    const animate = (time: number) => {
      const spectrum = voicePlayer.readSpectrum(time);
      bars.forEach((bar, index) => {
        bar.style.transform = `scaleY(${0.15 + spectrum[index] * 0.55})`;
      });
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      for (const bar of bars) bar.style.removeProperty("transform");
    };
  }, [playing]);

  return <button ref={animateWave} className={`voice-wave${playing ? " is-playing" : ""}`}
    type="button" disabled={duration === null} aria-label="跳轉語音播放位置"
    onClick={event => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      onSeek(fraction * duration!);
    }}>
    {peaks.map((peak, index) => <i key={index} aria-hidden="true"
      className={index / VOICE_BAR_COUNT < progress ? "done" : undefined}
      style={{ "--voice-static": Math.max(0.18, peak) } as CSSProperties} />)}
  </button>;
}
