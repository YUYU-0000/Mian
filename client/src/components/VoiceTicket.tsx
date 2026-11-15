import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { stripVoiceTags, type VoiceClip } from "../../../shared/voice.mjs";
import { voicePlayer } from "../voicePlayer";
import { notify } from "./Notify";
import "./file-ticket.css";
import "./voice-ticket.css";

const emptyPeaks = Array<number>(38).fill(0);

function durationLabel(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export default function VoiceTicket({ clip, time }: { clip: VoiceClip; time: string }) {
  const player = useSyncExternalStore(voicePlayer.subscribe, voicePlayer.getSnapshot);
  const active = player.id === clip.url;
  const playing = active && player.playing;
  const [expanded, setExpanded] = useState(false);
  const transcriptId = useId();
  const [knownDuration, setKnownDuration] = useState<number | null>(null);
  const duration = clip.duration ?? knownDuration;
  const progress = active && duration ? player.currentTime / duration : 0;
  useEffect(() => {
    if (active && player.duration !== null) setKnownDuration(player.duration);
  }, [active, player.duration]);
  useEffect(() => () => voicePlayer.stop(clip.url), [clip.url]);
  const play = async (startAt = 0) => {
    try { await voicePlayer.play(clip.url, async () => clip, undefined, undefined, startAt); }
    catch (error) { if ((error as Error).name !== "AbortError") notify.fail("播放失敗", error); }
  };
  const toggle = () => {
    if (active) {
      if (playing) voicePlayer.pause();
      else voicePlayer.resume();
    } else void play();
  };
  return (
    <div className={`voice-ticket${playing ? " on" : ""}${expanded ? " open" : ""}`}>
      <div className="ft" onClick={() => setExpanded(value => !value)}>
        <div className="ft-body" />
        <div className="ft-main">
          <div className="ft-kicker">VOICE  語音</div>
          <div className="voice-row">
            <button className="voice-play" type="button" disabled={!clip.url}
              aria-label={playing ? "暫停語音" : "播放語音"}
              onClick={event => { event.stopPropagation(); toggle(); }} />
            {clip.url ? <button className="voice-wave" type="button" disabled={duration === null}
              aria-label="跳轉語音播放位置"
              onClick={event => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                const position = fraction * duration!;
                if (active) voicePlayer.seek(position);
                else void play(position);
              }}>
              {(clip.peaks ?? emptyPeaks).map((peak, index) => <i key={index} aria-hidden="true"
                className={index / 38 < progress ? "done" : undefined} style={{ height: `${peak * 20}px` }} />)}
            </button> : <div className="voice-generating" role="status">生成中</div>}
          </div>
          <div className="ft-meta">
            <span><b>{duration === null ? "--:--" : durationLabel(duration)}</b></span>
            <span>{time}</span>
            <button className="ft-act" type="button" aria-expanded={expanded} aria-controls={transcriptId}>台詞</button>
          </div>
        </div>
        <div className="ft-perf" />
        <div className="ft-stub"><div className="ft-ext">VOICE</div></div>
      </div>
      <div className="voice-transcript" id={transcriptId} aria-hidden={!expanded}>
        <div className="voice-transcript-paper">
          <div className="voice-transcript-kicker">TRANSCRIPT  台詞</div>
          <div className="voice-transcript-text">{stripVoiceTags(clip.text)}</div>
        </div>
      </div>
    </div>
  );
}
