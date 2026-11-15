import { useEffect, useRef, useState } from "react";
import type { Clue } from "../../clueTypes";
import { ScrollInput } from "../../components/ScrollText";
import { PAPER_LAYOUTS } from "./CluePaper";

export default function ClueSheet({
  card,
  onSave,
  onTear,
  onClose,
}: {
  card: Clue;
  onSave: (card: Clue) => Promise<unknown>;
  onTear: (id: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(card);
  const [show, setShow] = useState(false);
  const [tearArmed, setTearArmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setShow(true));
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer.current);
    };
  }, []);
  const close = async (tear = false) => {
    setSaving(true);
    try {
      if (tear) await onTear(draft.id);
      else
        await onSave({
          ...draft,
          title: draft.title.trim() || "標題",
          when: draft.when.trim(),
          updatedAt: new Date().toISOString(),
        });
      setShow(false);
      timer.current = setTimeout(onClose, 220);
    } catch {
      setSaving(false);
    }
  };
  return (
    <div
      className={`sw on${show ? " show" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="編輯線索"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) void close();
      }}
    >
      <div
        className="dim"
        onClick={() => {
          if (!saving) void close();
        }}
      />
      <div className="sheet" aria-busy={saving}>
        <div className="s-top">
          <span className="no">
            {PAPER_LAYOUTS[draft.layout].en.toLowerCase()}{" "}
            {String(draft.order + 1).padStart(2, "0")}
          </span>
          <div className="mode">
            {(["pinned", "trigger"] as const).map((mode) => (
              <button
                type="button"
                key={mode}
                data-mode={mode}
                className={draft.mode === mode ? "on" : ""}
                aria-pressed={draft.mode === mode}
                disabled={saving}
                onClick={() => setDraft({ ...draft, mode })}
              >
                {mode === "pinned" ? "常駐" : "觸發"}
              </button>
            ))}
          </div>
        </div>
        <div className="s-head">
          <div className="sc">
            {draft.mode === "trigger" ? "when it matters" : "always"}
          </div>
          <ScrollInput
            className="s-title"
            name="title"
            aria-label="標題"
            spellCheck={false}
            disabled={saving}
            value={draft.title}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
          <div className="orn">
            <i>CLUE</i>
          </div>
          <div className="dd">
            {draft.createdAt.slice(0, 10).replaceAll("-", ".")}
          </div>
        </div>
        <div className="s-body">
          {draft.mode === "trigger" && (
            <>
              <div className="fld">
                <label className="lab" htmlFor="clueWhen">
                  WHEN<b>什麼時候想起</b>
                </label>
                <ScrollInput
                  className="when"
                  id="clueWhen"
                  name="when"
                  value={draft.when}
                  placeholder="比如她说累了、聊到画画的时候"
                  disabled={saving}
                  onChange={(event) =>
                    setDraft({ ...draft, when: event.target.value })
                  }
                />
              </div>
              <div className="fld">
                <div className="lab">
                  SCENE<b>場景</b>
                </div>
                <div className="scn">
                  <button
                    type="button"
                    data-scene="voice"
                    className={draft.scenes.includes("voice") ? "on" : ""}
                    aria-pressed={draft.scenes.includes("voice")}
                    disabled={saving}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        scenes: draft.scenes.includes("voice") ? [] : ["voice"],
                      })
                    }
                  >
                    生成語音條
                  </button>
                </div>
              </div>
            </>
          )}
          <textarea
            className="content"
            name="content"
            aria-label="內容"
            value={draft.content}
            disabled={saving}
            placeholder="写下这张卡片要告诉他的事"
            onChange={(event) =>
              setDraft({ ...draft, content: event.target.value })
            }
          />
        </div>
        <div className="s-foot">
          <button
            type="button"
            className={`tear${tearArmed ? " warn" : ""}`}
            disabled={saving}
            onClick={() => {
              if (tearArmed) void close(true);
              else setTearArmed(true);
            }}
          >
            {tearArmed ? "再點一次撕掉" : "撕掉"}
          </button>
          <span className="meta">{draft.content.length} 字</span>
          <button
            type="button"
            className="done"
            disabled={saving}
            onClick={() => void close()}
          >
            收起
          </button>
        </div>
      </div>
    </div>
  );
}
