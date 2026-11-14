import { useEffect, useState } from "react";
import { installFont, INVALID_FONT, parseFontFace } from "../bubbleFont";
import {
  DEFAULT_BUBBLE_SIZE,
  DEFAULT_FONT_ID,
  type FontPreset,
} from "../settingsTypes";
import Media from "../components/Media";
import { notify } from "../components/Notify";
import { ScrollInput } from "../components/ScrollText";

export default function FontPage({
  preset,
  index,
  total,
  active,
  inUse,
  onChange,
  onSave,
  onAdd,
  onDelete,
}: {
  preset: FontPreset;
  index: number;
  total: number;
  active: boolean;
  inUse: boolean;
  onChange: (preset: FontPreset) => void;
  onSave: (preset: FontPreset) => Promise<FontPreset>;
  onAdd: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(preset);
  useEffect(() => setDraft(preset), [preset]);
  const { id, name, size, face, view } = draft;
  const fixed = id === DEFAULT_FONT_ID;
  const [direction, setDirection] = useState(-1);
  const [previewFamily, setPreviewFamily] = useState("LXGW Heart Serif");
  const minimum = DEFAULT_BUBBLE_SIZE - 3;
  const maximum = DEFAULT_BUBBLE_SIZE + 3;
  const change = (patch: Partial<FontPreset>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const preview = () => {
    try {
      const font = fixed
        ? { family: "LXGW Heart Serif", css: "" }
        : parseFontFace(face, id);
      installFont(font, id);
      setPreviewFamily(font.family);
      return true;
    } catch {
      notify.fail("字體無效", INVALID_FONT);
      return false;
    }
  };
  return (
    <div className="api-page" data-id={id}>
      <div className="paper-holes">
        <div className="hole" />
        <div className="hole" />
        <div className="hole" />
        <div className="hole" />
      </div>
      <svg className="api-paperclip" viewBox="0 0 24 70">
        <path
          d="M 16,14 L 16,6 A 4,4 0 0,0 8,6 L 8,50 A 3.5,3.5 0 0,0 15,50 L 15,22 A 2,2 0 0,0 11,22 L 11,40"
          stroke="#8ba5b8"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="api-polaroid-container">
        <div className="polaroid">
          <div className="polaroid-img-placeholder">
            <Media storageKey={`api_${id}`} active={active} />
          </div>
          <ScrollInput
            type="text"
            className="api-polaroid-input-main"
            placeholder="UNNAMED"
            value={name}
            readOnly={fixed}
            onChange={(e) => change({ name: e.target.value })}
            onBlur={() => onChange(draft)}
          />
        </div>
      </div>
      <div className="api-typography">
        <div className="api-typo-title">
          TYPE
          <br />
          LETTER
          <br />
          STYLE
        </div>
        <div className="api-typo-greeting">A Path to You</div>
      </div>
      <div className="api-custom-counter">
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
        <div className="acc-num-top apiTotalPages">
          {String(total).padStart(3, "0")}
        </div>
        <div className="apiBtnAdd" onClick={onAdd}>
          ADD
        </div>
        <div
          className={`apiBtnDel${fixed ? " disabled" : ""}`}
          onClick={fixed ? undefined : onDelete}
        >
          DEL
        </div>
        <div className="acc-num-bot apiCurrentPage">
          {String(index + 1).padStart(2, "0")}
        </div>
      </div>
      <div className="api-postcard-form">
        <div className="api-field-row">
          <div className="api-field-label">FACE</div>
          <ScrollInput
            type="text"
            className="api-field-input"
            placeholder={fixed ? "LXGW Heart Serif" : "@font-face { }"}
            value={face}
            readOnly={fixed}
            onChange={(e) => change({ face: e.target.value })}
            onBlur={() => onChange(draft)}
          />
        </div>
        <div className="api-field-row">
          <div className="api-field-label">VIEW</div>
          <ScrollInput
            type="text"
            className="api-field-input"
            placeholder="Still water."
            value={view}
            onChange={(e) => change({ view: e.target.value })}
            onBlur={() => onChange(draft)}
            style={{
              fontFamily: `"ZSFT-br", "${previewFamily}", sans-serif`,
              fontSize: size,
            }}
          />
        </div>
        <div className="api-field-row">
          <div className="api-field-label">SIZE</div>
          <div className="fish-slider-container">
            <input
              type="range"
              className="fish-slider timeout-slider"
              min={minimum}
              max={maximum}
              step="1"
              value={size}
              onChange={(e) => {
                const value = +e.target.value;
                if (value !== size) setDirection(value > size ? -1 : 1);
                change({ size: value });
              }}
              onBlur={() => onChange(draft)}
              onPointerUp={() => onChange(draft)}
            />
            <div
              className="fish-thumb-wrapper"
              style={{
                left: `${((size - minimum) / (maximum - minimum)) * 100}%`,
              }}
            >
              <div className="fish-value">{`${size} px`}</div>
              <svg
                className="fish-svg timeout-fish-svg"
                style={{ transform: `scale(0.9) scaleX(${direction})` }}
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M10 4L2 12L10 20"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="9" cy="12" r="1.4" />
                <path
                  d="M18 8.5L13.5 12L18 15.5"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>
      {inUse && <span className="font-status">IN USE</span>}
      <div className="api-actions">
        <div
          className="action-btn btnSaveStyle"
          onClick={() => {
            if (!preview()) return;
            void onSave(draft)
              .then((saved) => {
                setDraft(saved);
                notify.ok("已保存");
              })
              .catch((error) => notify.fail("保存失敗", error));
          }}
        >
          <span className="btn-text">SAVE STYLE</span>
        </div>
        <div className="action-btn btnTestStyle" onClick={preview}>
          <span className="btn-text">TEST STYLE</span>
        </div>
      </div>
    </div>
  );
}
