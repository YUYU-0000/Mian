import { useRef, useState } from "react";
import type { VoiceClip } from "../../../shared/voice.mjs";
import { notify } from "./Notify";
import "./voice-ticket.css";

export default function VoiceTicket({ clip }: { clip: VoiceClip }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const toggle = async () => {
    if (!audio.current!.paused) {
      audio.current!.pause();
      return;
    }
    try { await audio.current!.play(); }
    catch (error) { notify.fail("播放失敗", error); }
  };
  return (
    <div className="voice-ticket">
      <audio ref={audio} src={clip.url || undefined} preload="metadata"
        onLoadedMetadata={event => setDuration(event.currentTarget.duration)}
        onPlaying={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      <div className="ft">
        <div className="ft-body" />
        <div className="ft-main">
          <div className="ft-kicker">VOICE  語音</div>
          <div className="ft-name">{clip.url ? "語音訊息" : "生成中"}</div>
          <div className="ft-meta">
            {duration === null ? "--:--" : `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}`}
          </div>
        </div>
        <div className="ft-perf" />
        <button className="ft-stub" type="button" disabled={!clip.url} onClick={() => void toggle()}
          aria-label={playing ? "暫停語音" : "播放語音"}>{playing ? "暫停" : "播放"}</button>
      </div>
      <details>
        <summary>台詞</summary>
        <div className="archive-bubble">{clip.text}</div>
      </details>
    </div>
  );
}
