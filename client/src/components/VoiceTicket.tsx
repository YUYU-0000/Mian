import { lazy, Suspense, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { stripVoiceTags, type VoiceClip } from "../../../shared/voice.mjs";
import { cacheLazyImport } from "../lazyImport";
import { api } from "../api";
import { voicePlayer } from "../voicePlayer";
import { notify } from "./Notify";
import ScrollText from "./ScrollText";
import AnimatedText from "./AnimatedText";
import AnimatedSwap from "./AnimatedSwap";
import "./file-ticket.css";
import "./voice-ticket.css";

const emptyPeaks = Array<number>(38).fill(0);
const PaperPreview = lazy(cacheLazyImport("paper-preview", () => import("./PaperPreview")));

function durationLabel(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export default function VoiceTicket({ clip, fallback, animate = false }: { clip: VoiceClip; fallback?: "failed" | "stopped"; animate?: boolean }) {
  const player = useSyncExternalStore(voicePlayer.subscribe, voicePlayer.getSnapshot);
  const active = player.id === clip.url;
  const playing = active && player.playing;
  const [viewing, setViewing] = useState(false);
  const [sentAt, setSentAt] = useState(() => clip.url ? "" : new Date().toISOString());
  const closePreview = useCallback(() => setViewing(false), []);
  const [knownDuration, setKnownDuration] = useState<number | null>(null);
  const duration = clip.duration ?? knownDuration;
  const failureText = fallback === "stopped" ? "已停止" : "生成失敗";
  const durationText = fallback ? failureText : duration === null ? "--:--" : durationLabel(duration);
  const previewName = sentAt ? `${sentAt.slice(0, 10).replaceAll("-", ".")}  沈眠` : "沈眠";
  const transcript = stripVoiceTags(clip.text);
  const progress = active && duration ? player.currentTime / duration : 0;
  useEffect(() => {
    if (!viewing || !clip.url) return;
    const controller = new AbortController();
    void api.fileCreatedAt(clip.url, controller.signal).then(setSentAt).catch(error => {
      if (!controller.signal.aborted) notify.fail("日期讀取失敗", error);
    });
    return () => controller.abort();
  }, [viewing, clip.url]);
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
  const playButton = <button className={`voice-play${playing ? " is-playing" : ""}`} type="button" disabled={!clip.url}
    aria-label={playing ? "暫停語音" : "播放語音"}
    onClick={event => { event.stopPropagation(); toggle(); }} />;
  return (
    <>
      <AnimatedSwap value={fallback ? "text" : "ticket"} className={`voice-reply${animate ? " archive-pop-in" : ""}`}>
        {displayed => displayed === "text"
          ? <div className={`archive-bubble${fallback === "stopped" ? " stopped" : ""}`}><AnimatedText text={transcript} /></div>
          : <div className="voice-ticket"><div className="ft" onClick={() => setViewing(true)}>
        <div className="ft-body" />
        <div className="ft-main">
          <div className="ft-kicker">VOICE  語音</div>
          <div className="voice-row">
            {playButton}
            <AnimatedSwap value={clip.url ? "wave" : "status"} className="voice-wave-slot">
              {content => content === "wave" ? <button className="voice-wave" type="button" disabled={duration === null}
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
            </button> : <div className="voice-generating" role="status"><AnimatedText text={fallback ? failureText : "生成中"} /></div>}
            </AnimatedSwap>
          </div>
          <div className="ft-meta">
            <span><b><AnimatedText text={durationText} /></b></span>
            <button className="ft-act" type="button" aria-haspopup="dialog">台詞</button>
          </div>
        </div>
        <div className="ft-perf" />
        <div className="ft-stub"><div className="ft-ext">VOICE</div></div>
      </div></div>}
      </AnimatedSwap>
      {viewing && <Suspense fallback={null}>
        <PaperPreview label="語音台詞" onClose={closePreview} footer={playButton}>
          <div className="pv-photo pv-document">
            <div className="pv-file-head">
              <div className="pv-kicker">VOICE  語音</div>
              <ScrollText className="pv-name" style={{ whiteSpace: "pre" }}><AnimatedText text={previewName} /></ScrollText>
            </div>
            <div className="pv-file-content">
              <div className="pv-source reply-code pv-voice-text">
                <pre><code><AnimatedText text={transcript} /></code></pre>
              </div>
            </div>
          </div>
        </PaperPreview>
      </Suspense>}
    </>
  );
}
