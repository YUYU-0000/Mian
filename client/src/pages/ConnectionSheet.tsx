import { pad2 } from "../format";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "../api";
import type { ApiPreset } from "../connectionTypes";
import type { Draft } from "../apiDrafts";
import AnimatedText from "../components/AnimatedText";
import ScrollText, { ScrollInput } from "../components/ScrollText";
import { notify } from "../components/Notify";
import type { TagConfig } from "./ConnectionLayout";

function apiAccent(i: number, count: number) {
  const t = count === 1 ? 0 : i / (count - 1);
  return `rgb(${Math.round(81 + 83 * t)}, ${Math.round(101 + 83 * t)}, ${Math.round(117 + 81 * t)})`;
}
export default function ApiSheet({
  draft,
  index,
  total,
  activeId,
  onChange,
  onAdd,
  onSave,
  onUse,
  onDeleteStart,
  onDelete,
  onTag,
}: {
  draft: Draft;
  index: number;
  total: number;
  activeId: string | null;
  onChange: (patch: Partial<ApiPreset>) => void;
  onAdd: () => void;
  onSave: (preset: ApiPreset) => void;
  onUse: () => void;
  onDeleteStart: () => void;
  onDelete: () => void;
  onTag: (tag: TagConfig) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [showKey, setShowKey] = useState(false);
  const [armed, setArmed] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [manualModel, setManualModel] = useState(false);
  const timer = useRef(0);
  const wasPlus = useRef(draft.plus);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (wasPlus.current && !draft.plus)
      ref.current!.querySelector(".api-giant")!.animate(
        [
          { opacity: 0, transform: "translateY(4px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 260, easing: "ease-out" },
      );
    wasPlus.current = draft.plus;
  }, [draft.plus]);
  const form = (): ApiPreset => ({
    id: draft.id,
    note: draft.note.trim(),
    endpoint: draft.endpoint.trim(),
    key: draft.key?.trim() ?? "",
    model: draft.model,
    format: draft.format,
  });
  const isOn = !!draft.id && activeId === draft.id;
  const status = testing ? "TESTING" : !draft.id ? "NEW" : isOn ? "IN USE" : "STANDBY";
  const model = async () => {
    const cfg = form();
    if (!cfg.endpoint || (!cfg.key && !draft.hasKey)) {
      notify.note("先填網址金鑰");
      return;
    }
    setLoadingModels(true);
    try {
      const list = await api.apiModels(cfg);
      if (!list.length) {
        setManualModel(true);
        return;
      }
      onTag({
        giant: "MODEL",
        kicker: "SELECT",
        title: "模型",
        items: list.map((m) => ({ label: m, value: m, selected: m === cfg.model })),
        onPick: (value) => onChange({ model: value }),
      });
    } catch (error) {
      setManualModel(true);
      notify.fail("模型讀取失敗", error);
    } finally {
      setLoadingModels(false);
    }
  };
  const save = async () => {
    const cfg = form();
    if (!cfg.note) {
      notify.note("寫個備註吧");
      ref.current!.querySelector<HTMLInputElement>(".js-note")!.focus();
      return;
    }
    if (!cfg.endpoint || (!cfg.key && !draft.hasKey) || !cfg.model) {
      notify.note("三項都要填");
      return;
    }
    try {
      onSave(await api.saveApiPreset(cfg));
      notify.ok("已保存");
    } catch (error) {
      notify.fail("保存失敗", error);
    }
  };
  const test = async () => {
    const cfg = form();
    if (!cfg.endpoint || (!cfg.key && !draft.hasKey) || !cfg.model) {
      notify.note("三項都要填");
      return;
    }
    setTesting(true);
    try {
      await api.apiTest(cfg);
      notify.ok("連接成功");
    } catch (error) {
      notify.fail("連接失敗", error);
    } finally {
      setTesting(false);
    }
  };
  const remove = async () => {
    if (!armed) {
      setArmed(true);
      timer.current = window.setTimeout(() => setArmed(false), 2500);
      return;
    }
    try {
      if (draft.id) await api.deleteApiPreset(draft.id);
      onDeleteStart();
      const sheet = ref.current!;
      sheet.inert = true;
      const fromTransform = sheet.style.transform;
      sheet.style.opacity = "0";
      const fall = sheet.animate(
        [
          { transform: fromTransform, opacity: 1 },
          {
            transform: "translate3d(-6px, 10px, 0) rotate(-1deg) scale(.985)",
            opacity: 0.85,
            offset: 0.35,
          },
          {
            transform: "translate3d(-18px, 34px, 0) rotate(-3deg) scale(.95)",
            opacity: 0,
          },
        ],
        { duration: 520, easing: "cubic-bezier(.4,.1,.5,1)", fill: "both" },
      );
      fall.onfinish = () => {
        sheet.style.visibility = "hidden";
        onDelete();
        fall.cancel();
        notify.ok("已刪除");
      };
    } catch (error) {
      notify.fail("刪除失敗", error);
    }
  };
  return (
    <div
      ref={ref}
      className="api-sheet"
      data-i={index}
      style={
        {
          "--accent": draft.plus ? "#b8c3ca" : apiAccent(index, total - 1),
        } as CSSProperties
      }
    >
      <div className="api-lines" />
      <div className="api-block" />
      <div className="api-bar" />
      <div className="api-hatch" />
      <div className="api-side">REMOTE CONNECT</div>
      <div className="api-head">
        <div className="api-giant">
          {draft.plus ? (
            <button
              className="api-plus js-add"
              type="button"
              aria-label="新增一張紙"
              onClick={onAdd}
            >
              +
            </button>
          ) : (
            pad2(index + 1)
          )}
          <span className="api-total">/ {pad2(total)}</span>
        </div>
        <label className="api-note-label">NOTE 備註</label>
        <ScrollInput
          className="api-note js-note"
          type="text"
          maxLength={16}
          autoComplete="off"
          placeholder={!draft.id ? "新紙，寫個備註" : "寫個備註，好分清楚"}
          value={draft.note}
          onChange={(e) => onChange({ note: e.target.value })}
        />
      </div>
      <div className="api-rule">
        <span>A QUIET LINE</span>
        <span className="api-rule-line" />
        {!draft.plus && (
          <button className="api-del js-del" type="button" onClick={() => void remove()}>
            <AnimatedText text={armed ? "再點一次刪除" : "DELETE"} />
          </button>
        )}
      </div>
      <div className="api-form">
        <label className="api-field">
          <span className="api-label">
            <b>01</b>ENDPOINT
          </span>
          <span className="api-row">
            <ScrollInput
              className="api-input js-endpoint"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://api.deepseek.com"
              value={draft.endpoint}
              onChange={(e) => onChange({ endpoint: e.target.value })}
            />
          </span>
        </label>
        <label className="api-field">
          <span className="api-label">
            <b>02</b>KEY
          </span>
          <span className="api-row">
            <ScrollInput
              className="api-input js-key"
              type={showKey ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              placeholder={draft.hasKey ? draft.keyHint : "sk-"}
              value={draft.key ?? ""}
              onChange={(e) => onChange({ key: e.target.value })}
            />
            {draft.key && <button
              className="api-mini js-toggle"
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setShowKey((value) => !value);
              }}
            >
              {showKey ? "HIDE" : "SHOW"}
            </button>}
          </span>
        </label>
        <div className="api-field">
          <span className="api-label">
            <b>03</b>MODEL
          </span>
          <span className="api-row">
            {manualModel ? <ScrollInput
              className="api-input js-model"
              type="text"
              aria-label="MODEL 模型名稱"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              placeholder="輸入模型名稱"
              value={draft.model}
              onChange={event => onChange({ model: event.target.value })}
              onBlur={() => onChange({ model: draft.model.trim() })}
            /> : <button
              className={`api-pick js-model${draft.model ? "" : " is-empty"}`}
              type="button"
              onClick={() => void model()}
            >
              <ScrollText><AnimatedText
                text={loadingModels ? "讀取中" : draft.model || "點擊讀取"}
              /></ScrollText>
            </button>}
          </span>
        </div>
      </div>
      <div className="api-foot">
        <AnimatedText
          className={`api-status js-status${isOn ? " is-on" : ""}`}
          text={status}
        />
        <span className="api-actions">
          <button className="api-act js-test" type="button" onClick={() => void test()}>
            TEST
          </button>
          {draft.id && (
            <button
              className="api-act js-use"
              type="button"
              onClick={() => {
                void api
                  .useApiPreset(draft.id)
                  .then(() => {
                    onUse();
                    notify.ok("已切換");
                  })
                  .catch((error) => notify.fail("切換失敗", error));
              }}
            >
              USE
            </button>
          )}
          <button
            className="api-act is-primary js-save"
            type="button"
            onClick={() => void save()}
          >
            SAVE
          </button>
        </span>
      </div>
    </div>
  );
}
