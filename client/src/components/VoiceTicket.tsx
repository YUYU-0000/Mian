import { useEffect, useState, useSyncExternalStore } from "react";
import { stripVoiceTags, type VoiceClip } from "../../../shared/voice.mjs";
import { voicePlayer } from "../voicePlayer";
import { notify } from "./Notify";
import "./voice-ticket.css";

export default function VoiceTicket({ clip }: { clip: VoiceClip }) {
  const player = useSyncExternalStore(voicePlayer.subscribe, voicePlayer.getSnapshot);
  const playing = player.id === clip.url && player.playing;
  const [knownDuration, setKnownDuration] = useState<number | null>(null);
  const duration = clip.duration ?? knownDuration;
  useEffect(() => {
    if (player.id === clip.url && player.duration !== null) setKnownDuration(player.duration);
  }, [player, clip.url]);
  useEffect(() => () => voicePlayer.stop(clip.url), [clip.url]);
  const toggle = async () => {
    if (player.id === clip.url) {
      if (playing) voicePlayer.pause();
      else voicePlayer.resume();
      return;
    }
    try { await voicePlayer.play(clip.url, async () => clip); }
    catch (error) { if ((error as Error).name !== "AbortError") notify.fail("播放失敗", error); }
  };
  return (
    <div className="voice-ticket">
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
        <div className="archive-bubble">{stripVoiceTags(clip.text)}</div>
      </details>
    </div>
  );
}
