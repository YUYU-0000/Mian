import { useId, useRef, useState, type CSSProperties, type RefObject } from "react";
import { api } from "../api";
import { notify } from "../components/Notify";

const mask = (value: string) => value.length > 4 ? "•".repeat(Math.min(12, value.length - 4)) + value.slice(-4) : value;
export default function VoicePage({ index, total, current, dragged, onAdd, onDelete }: { index: number; total: number; current: boolean; dragged: RefObject<boolean>; onAdd: () => void; onDelete: () => void }) {
  const ringId = useId();
  const [key, setKey] = useState("");
  const [keyFocused, setKeyFocused] = useState(false);
  const [voiceId, setVoiceId] = useState("");
  const [model, setModel] = useState("");
  const [text, setText] = useState("");
  const [pulled, setPulled] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playback = useRef(0);
  const toggle = (event: React.MouseEvent) => {
    if ((event.target as Element).closest("input") || dragged.current) return;
    event.stopPropagation(); setPulled(value => !value);
  };
  const play = async () => {
    const current = ++playback.current;
    if (playing) { setPlaying(false); return; }
    setPlaying(true);
    try { await api.testVoice({ apiKey: key.trim(), voiceId: voiceId.trim(), model: model.trim(), text: text.trim() || "陪你等天亮。" }); }
    catch (error) { notify.fail("試聽失敗", error); }
    if (playback.current === current) setPlaying(false);
  };
  const number = String(index + 1).padStart(2, "0");
  return <div className={`vc-page${current ? " current" : ""}${pulled || playing ? " out" : ""}${playing ? " playing" : ""}`}>
    <div className="paper-holes"><div className="hole" /><div className="hole" /><div className="hole" /><div className="hole" /></div>
    <div className="vc-counter api-custom-counter"><svg className="acc-svg" viewBox="0 0 65 90"><path d="M 23 42 L 52 42 L 11 76 L 30 76" fill="none" stroke="#6b6256" strokeWidth="0.75" strokeLinecap="round" strokeLinejoin="round" /></svg><div className="acc-num-top vc-total">{String(total).padStart(3, "0")}</div><div className="apiBtnAdd vc-add" onClick={e => { e.stopPropagation(); onAdd(); }}>ADD</div><div className={`apiBtnDel vc-del${total <= 1 ? " disabled" : ""}`} onClick={e => { e.stopPropagation(); onDelete(); }}>DEL</div><div className="acc-num-bot vc-current">{number}</div></div>
    <div className="vc-record" onClick={toggle}><div className="vc-record-inner"><svg className="vc-ring-text" viewBox="0 0 118 118"><defs><path id={ringId} d="M 59,59 m -47,0 a 47,47 0 1,1 94,0 a 47,47 0 1,1 -94,0" /></defs><text><textPath href={`#${ringId}`} className="vc-ring-id">聲線 = {voiceId.trim() || "9vQe2LkTm4RzWp8NcYdA"}</textPath></text></svg><div className="vc-label" /></div></div>
    <div className="vc-sleeve" onClick={toggle}><div className="vc-sleeve-side">Mono<span className="vc-side-no">{number}</span></div><svg className="vc-sleeve-birds" viewBox="0 0 26 14"><path d="M1 6 Q4 1 7 6 Q10 1 13 6" fill="none" stroke="#8c8376" strokeWidth="0.8" strokeLinecap="round" /><path d="M12 12 Q14 8.5 16 12 Q18 8.5 20 12" fill="none" stroke="#8c8376" strokeWidth="0.8" strokeLinecap="round" /></svg><input className="vc-note-input" type="text" placeholder="備註" /><div className="vc-sleeve-line" /><div className="vc-sleeve-bar"><span className="vc-bar-icon" /><span className="vc-bar-wave">{[3,6,4,8,5,9,4,7,3,6,9,5,8,4,6,3,7,5,9,4,6].map((height,i) => <i key={i} style={{ "--h": `${height}px`, animationDelay: `${(i % 5) * 0.12}s` } as CSSProperties} />)}</span></div></div>
    <div className="vc-ticket"><div className="vc-ticket-frame" /><div className="vc-ticket-title">Admit One</div><div className="vc-ticket-no">No.<span className="vc-no">{number}</span></div><div className="vc-form">
      <div className="api-field-row"><div className="api-field-label">TOKEN</div><input type="text" className="api-field-input vc-key" placeholder="sk_4f2a9c71e8b05d3a6f91c8" autoComplete="off" spellCheck={false} value={keyFocused ? key : mask(key)} onFocus={() => setKeyFocused(true)} onBlur={() => { setKey(value => value.trim()); setKeyFocused(false); }} onChange={e => setKey(e.target.value)} /></div>
      <div className="api-field-row"><div className="api-field-label">VOICE</div><input type="text" className="api-field-input vc-id" placeholder="9vQe2LkTm4RzWp8NcYdA" spellCheck={false} value={voiceId} onChange={e => setVoiceId(e.target.value)} /></div>
      <div className="api-field-row"><div className="api-field-label">MODEL</div><input type="text" className="api-field-input vc-model" placeholder="eleven_v4" spellCheck={false} value={model} onChange={e => setModel(e.target.value)} /></div>
      <div className="api-field-row"><div className="api-field-label">WORDS</div><input type="text" className="api-field-input vc-line" placeholder="陪你等天亮。" value={text} onChange={e => setText(e.target.value)} /></div>
    </div><div className="vc-perf" /><div className="vc-stub" onClick={() => void play()}><div className="vc-barcode" /><div className="vc-play">Play<b>試聽</b></div></div></div>
  </div>;
}
