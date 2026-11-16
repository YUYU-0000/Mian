// 编辑语音预设并调用共用播放器试听，协调纸堆和吊牌选择。
import { pad2 } from "../format";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "../api";
import { notify } from "../components/Notify";
import { ScrollInput } from "../components/ScrollText";
import PasswordToggle from "../components/PasswordToggle";
import type { VoicePreset } from "../../../shared/voice.mjs";
import type { TagConfig } from "../components/ChoiceTag";

type VoiceField = "voice_id" | "model";

export default function VoicePage({
  preset,
  index,
  total,
  current,
  onAdd,
  onDelete,
  onSave,
  onTag,
}: {
  preset: VoicePreset;
  index: number;
  total: number;
  current: boolean;
  onAdd: () => void;
  onDelete: () => void;
  onSave: (preset: VoicePreset) => Promise<VoicePreset>;
  onTag: (tag: TagConfig) => void;
}) {
  const ringId = useId();
  const page = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(preset);
  const [showKey, setShowKey] = useState(false);
  useEffect(() => {
    if (!page.current?.contains(document.activeElement)) setDraft(preset);
  }, [preset]);
  const [pulled, setPulled] = useState(false);
  const [auditioning, setAuditioning] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playback = useRef<AbortController | null>(null);
  const [manual, setManual] = useState<Record<VoiceField, false | "fallback" | "title">>({ voice_id: false, model: false });
  const [loading, setLoading] = useState<VoiceField | null>(null);
  useLayoutEffect(() => {
    const selector = manual.voice_id === "title" ? ".vc-id" : manual.model === "title" ? ".vc-model" : null;
    if (selector) page.current!.querySelector<HTMLInputElement>(selector)!.focus({ preventScroll: true });
  }, [manual]);
  const persist = (sent: VoicePreset) => {
    void onSave(sent).then(saved => setDraft(value => ({
      ...value,
      hasKey: saved.hasKey,
      key: value.key === sent.key ? "" : value.key,
    }))).catch(error => notify.fail("保存失敗", error));
  };
  const save = () => persist(draft);
  const finishManual = (field: VoiceField) => {
    save();
    if (manual[field] === "title") setManual(value => ({ ...value, [field]: false }));
  };
  const choose = async (field: VoiceField) => {
    if (!draft.key?.trim() && !draft.hasKey) {
      notify.note("先把鑰匙給我");
      return;
    }
    setLoading(field);
    try {
      const options = field === "model" ? await api.voiceModels(draft) : await api.voiceList(draft);
      if (!options.length) {
        setManual(value => ({ ...value, [field]: "fallback" }));
        return;
      }
      onTag({
        giant: field === "model" ? "MODEL" : "VOICE", kicker: "SELECT",
        title: field === "model" ? "模型" : "聲音",
        titleConfirm: "你寫",
        titleAction: () => setManual(value => ({ ...value, [field]: "title" })),
        items: options.map(option => ({
          label: field === "model" ? option.id : option.name, value: option.id,
          selected: option.id === (draft[field] || (field === "model" ? "eleven_v4" : ""))
        })),
        onPick: value => {
          const next = {
            ...draft, [field]: value,
            ...(field === "voice_id" ? { voice_name: options.find(option => option.id === value)!.name } : {})
          };
          setDraft(next);
          persist(next);
        },
      });
    } catch (error) {
      setManual(value => ({ ...value, [field]: "fallback" }));
      notify.fail(field === "model" ? "模型讀取失敗" : "聲音讀取失敗", error);
    } finally { setLoading(null); }
  };
  const stop = () => {
    playback.current?.abort();
    playback.current = null;
    setAuditioning(false);
    setPlaying(false);
    setPulled(false);
  };
  useEffect(() => {
    if (!current) stop();
    return () => playback.current?.abort();
  }, [current]);
  const toggle = (event: React.MouseEvent) => {
    if ((event.target as Element).closest("input") || auditioning) return;
    event.stopPropagation();
    setPulled((value) => !value);
  };
  const play = async () => {
    if (playback.current) {
      stop();
      return;
    }
    const controller = new AbortController();
    playback.current = controller;
    setAuditioning(true);
    try {
      await api.testVoice(draft, controller.signal, () => setPlaying(true));
    } catch (error) {
      if (!controller.signal.aborted && (error as Error).name !== "AbortError") notify.fail("試聽失敗", error);
    } finally {
      if (playback.current === controller) stop();
    }
  };
  const number = pad2(index + 1);
  return (
    <div
      ref={page}
      className={`vc-page${current ? " current" : ""}${pulled || auditioning ? " out" : ""}${playing ? " playing" : ""}`}
    >
      <div className="paper-holes">
        <div className="hole" />
        <div className="hole" />
        <div className="hole" />
        <div className="hole" />
      </div>
      <div className="vc-counter api-custom-counter">
        <svg className="acc-svg" viewBox="0 0 65 90">
          <path
            d="M 23 42 L 52 42 L 11 76 L 30 76"
            fill="none"
            stroke="#6b6256"
            strokeWidth="0.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="acc-num-top vc-total">
          {String(total).padStart(3, "0")}
        </div>
        <div
          className="apiBtnAdd vc-add"
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
        >
          ADD
        </div>
        <div
          className={`apiBtnDel vc-del${total <= 1 ? " disabled" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          DEL
        </div>
        <div className="acc-num-bot vc-current">{number}</div>
      </div>
      <div className="vc-record" onClick={toggle}>
        <div className="vc-record-inner">
          <svg className="vc-ring-text" viewBox="0 0 118 118">
            <defs>
              <path
                id={ringId}
                d="M 59,59 m -47,0 a 47,47 0 1,1 94,0 a 47,47 0 1,1 -94,0"
              />
            </defs>
            <text>
              <textPath href={`#${ringId}`} className="vc-ring-id">
                聲線 = {draft.voice_name || draft.voice_id.trim() || "9vQe2LkTm4RzWp8NcYdA"}
              </textPath>
            </text>
          </svg>
          <div className="vc-label" />
        </div>
      </div>
      <div className="vc-sleeve" onClick={toggle}>
        <div className="vc-sleeve-side">
          Mono<span className="vc-side-no">{number}</span>
        </div>
        <svg className="vc-sleeve-birds" viewBox="0 0 26 14">
          <path
            d="M1 6 Q4 1 7 6 Q10 1 13 6"
            fill="none"
            stroke="#8c8376"
            strokeWidth="0.8"
            strokeLinecap="round"
          />
          <path
            d="M12 12 Q14 8.5 16 12 Q18 8.5 20 12"
            fill="none"
            stroke="#8c8376"
            strokeWidth="0.8"
            strokeLinecap="round"
          />
        </svg>
        <ScrollInput className="vc-note-input" type="text" placeholder="備註"
          value={draft.note} onChange={event => setDraft({ ...draft, note: event.target.value })} onBlur={save} />
        <div className="vc-sleeve-line" />
        <div className="vc-sleeve-bar">
          <span className="vc-bar-icon" />
          <span className="vc-bar-wave">
            {[
              3, 6, 4, 8, 5, 9, 4, 7, 3, 6, 9, 5, 8, 4, 6, 3, 7, 5, 9, 4, 6,
            ].map((height, i) => (
              <i
                key={i}
                style={
                  {
                    "--h": `${height}px`,
                    animationDelay: `${(i % 5) * 0.12}s`,
                  } as CSSProperties
                }
              />
            ))}
          </span>
        </div>
      </div>
      <div className="vc-ticket">
        <div className="vc-ticket-frame" />
        <div className="vc-ticket-title">Admit One</div>
        <div className="vc-ticket-no">
          No.<span className="vc-no">{number}</span>
        </div>
        <div className="vc-form">
          <div className="api-field-row">
            <div className="api-field-label">TOKEN</div>
            <ScrollInput
              type={showKey ? "text" : "password"}
              className="api-field-input vc-key"
              placeholder={draft.hasKey ? "••••••••••••" : "sk_"}
              autoComplete="off"
              spellCheck={false}
              value={draft.key ?? ""}
              onBlur={save}
              onChange={(e) => setDraft({ ...draft, key: e.target.value })}
            />
            {draft.key && <PasswordToggle visible={showKey} onToggle={() => setShowKey(value => !value)} />}
          </div>
          <div className="api-field-row">
            <div className="api-field-label">VOICE</div>
            <ScrollInput
              type="text"
              className="api-field-input vc-id"
              placeholder={manual.voice_id ? "那你寫給我" : "選一個給我"}
              readOnly={!manual.voice_id}
              onClick={() => { if (!manual.voice_id && !loading) void choose("voice_id"); }}
              spellCheck={false}
              value={loading === "voice_id" ? "等我一下" : manual.voice_id ? draft.voice_id : draft.voice_name || draft.voice_id}
              onBlur={() => finishManual("voice_id")}
              onChange={(e) => setDraft({ ...draft, voice_id: e.target.value, voice_name: "" })}
            />
          </div>
          <div className="api-field-row">
            <div className="api-field-label">MODEL</div>
            <ScrollInput
              type="text"
              className="api-field-input vc-model"
              placeholder={manual.model ? "那你寫給我" : "選一個給我"}
              readOnly={!manual.model}
              onClick={() => { if (!manual.model && !loading) void choose("model"); }}
              spellCheck={false}
              value={loading === "model" ? "等我一下" : draft.model}
              onBlur={() => finishManual("model")}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            />
          </div>
          <div className="api-field-row">
            <div className="api-field-label">WORDS</div>
            <ScrollInput
              type="text"
              className="api-field-input vc-line"
              placeholder="陪你等天亮。"
              value={draft.words}
              onBlur={save}
              onChange={(e) => setDraft({ ...draft, words: e.target.value })}
            />
          </div>
        </div>
        <div className="vc-perf" />
        <div className="vc-stub" onClick={() => void play()}>
          <div className="vc-barcode" />
          <div className="vc-play">
            Play<b>試聽</b>
          </div>
        </div>
      </div>
    </div>
  );
}
