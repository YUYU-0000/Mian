// 显示语音票根与台词预览，订阅全局播放器的进度和状态。
import { lazy, Suspense, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { stripVoiceTags, type VoiceClip } from "../../../shared/voice.mjs";
import { cacheLazyImport } from "../lazyImport";
import { api } from "../api";
import { cachedFile } from "../fileCache";
import { voicePlayer } from "../voicePlayer";
import { notify } from "./Notify";
import ScrollText from "./ScrollText";
import AnimatedText from "./AnimatedText";
import AnimatedSwap from "./AnimatedSwap";
import VoiceWave from "./VoiceWave";
import "./file-ticket.css";
import "./voice-ticket.css";

const PaperPreview = lazy(cacheLazyImport("paper-preview", () => import("./PaperPreview")));

function durationLabel(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export default function VoiceTicket({ clip, fallback, animate = false }: { clip: VoiceClip; fallback?: "failed" | "stopped"; animate?: boolean; }) {
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
    const urls = clip.parts?.map(part => part.url) ?? [clip.url];
    for (const url of urls) if (url) void cachedFile(url).catch(() => { });
  }, [clip.url, clip.parts]);
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
  const seek = (position: number) => {
    if (active) voicePlayer.seek(position);
    else void play(position);
  };
  const waveform = <VoiceWave peaks={clip.peaks} playing={playing} progress={progress} duration={duration} onSeek={seek} />;
  const playButton = <button className={`voice-play${playing ? " is-playing" : ""}`} type="button" disabled={!clip.url}
    aria-label={playing ? "暫停語音" : "播放語音"}
    onClick={event => { event.stopPropagation(); toggle(); }} />;
  return (
    <>
      <AnimatedSwap value={fallback ? "text" : "ticket"} className={`voice-reply${animate ? " archive-pop-in" : ""}`}
        style={animate ? { willChange: "transform, opacity" } : undefined}
        onAnimationEnd={event => {
          if (event.target === event.currentTarget) event.currentTarget.style.removeProperty("will-change");
        }}>
        {displayed => displayed === "text"
          ? <div className={`archive-bubble${fallback === "stopped" ? " stopped" : ""}`}><AnimatedText text={transcript} /></div>
          : <div className="voice-ticket"><div className="ft" onClick={() => setViewing(true)}>
            <div className="ft-body" />
            <div className="ft-main">
              <div className="ft-kicker">VOICE  語音</div>
              <div className="voice-row">
                {playButton}
                <AnimatedSwap value={clip.url ? "wave" : "status"} className="voice-wave-slot" blur={false}>
                  {content => content === "wave" ? waveform
                    : <div className="voice-generating" role="status"><AnimatedText text={fallback ? failureText : "生成中"} /></div>}
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
        <PaperPreview label="語音台詞" onClose={closePreview} footer={
          <div className="voice-preview-controls">{playButton}{clip.url && !fallback && waveform}</div>
        }>
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
