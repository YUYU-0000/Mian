import type { RefObject, ReactNode } from "react";
import ChoiceTag, { type TagConfig } from "../components/ChoiceTag";
import { useHiddenLayer } from "../components/useHiddenLayer";
type Props = {
  rootRef: RefObject<HTMLElement | null>;
  subTrackRef: RefObject<HTMLDivElement | null>;
  apiTrackRef: RefObject<HTMLDivElement | null>;
  selected: string;
  open: "sub" | "api" | null;
  onSelect: (value: string) => void;
  onOpen: (value: "sub" | "api") => void;
  onBack: () => void;
  onClose: () => void;
  tag: TagConfig | null;
  tagVisible: boolean;
  onTagClose: () => void;
  tagAnchor: () => HTMLElement;
  subPages: ReactNode;
  apiPages: ReactNode;
};
export default function ConnectionLayout({
  rootRef,
  subTrackRef,
  apiTrackRef,
  selected,
  open,
  onSelect,
  onOpen,
  onBack,
  onClose,
  tag,
  tagVisible,
  onTagClose,
  tagAnchor,
  subPages,
  apiPages,
}: Props) {
  const subLayer = useHiddenLayer(open === "sub", "transform");
  const apiLayer = useHiddenLayer(open === "api", "transform");
  return (
    <main className="connections-page" ref={rootRef}>
      <div className="settings-header">
        <div
          className="back-btn"
          onClick={onBack}
          role="button"
          tabIndex={0}
          aria-label="返回主界面"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M10 4L2 12L10 20"
              stroke="var(--btn)"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="9" cy="12" r="1.4" fill="var(--btn)" />
            <path
              d="M18 8.5L13.5 12L18 15.5"
              stroke="var(--btn)"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      <div
        className={`envelope env-first${selected === "sub" ? " is-active" : ""}`}
        id="conn-codex"
        tabIndex={0}
        role="button"
        aria-pressed={selected === "sub"}
        onClick={() => onSelect("sub")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect("sub");
          }
        }}
      >
        <div className="env-side-flap"></div>
        <div className="env1-title-container">
          <div className="env1-title-text">
            CLOUD <span className="maison">PLANS</span>
          </div>
        </div>
        <div
          className="tie-container-v"
          id="codexTie"
          role="button"
          tabIndex={0}
          aria-label="開啟訂閱連接"
          onClick={(e) => {
            e.stopPropagation();
            onOpen("sub");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") onOpen("sub");
          }}
        >
          <div className="tie-btn"></div>
          <div className="tie-btn"></div>
          <svg className="string-svg-v">
            <path
              d="M 13,8 L 51,8 M 13,18 L 51,18"
              fill="none"
              stroke="var(--ink)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>

      <div
        className={`envelope env-second${selected === "api" ? " is-active" : ""}`}
        id="conn-api"
        tabIndex={0}
        role="button"
        aria-pressed={selected === "api"}
        onClick={() => onSelect("api")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect("api");
          }
        }}
      >
        <div className="env-top-flap-wrapper">
          <div className="env-top-flap"></div>
        </div>
        <div className="env2-center-title">
          <div className="forma">REMOTE</div>
          <div className="maison">CONNECT</div>
        </div>
        <div className="env2-footer">
          <span>ENDPOINT</span>
          <span>KEY</span>
          <span>MODEL</span>
        </div>
        <div
          className="tie-container-h"
          id="apiTie"
          role="button"
          tabIndex={0}
          aria-label="開啟 API 預設"
          onClick={(e) => {
            e.stopPropagation();
            onOpen("api");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") onOpen("api");
          }}
        >
          <div className="tie-btn"></div>
          <div className="tie-btn"></div>
          <svg className="string-svg-h">
            <path
              d="M 8,13 L 8,51 M 18,13 L 18,51"
              fill="none"
              stroke="var(--ink)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>

      <div
        className={`paper-overlay${open ? " is-visible" : ""}`}
        onClick={onClose}
        id="paperOverlay"
      ></div>
      <div
        {...subLayer}
        className={`stack${open === "sub" ? " is-visible" : ""}`}
        id="subStack"
        inert={open !== "sub"}
        role="dialog"
        aria-label="CLOUD PLANS"
      >
        <div className="stack-bot"></div>
        <div className="stack-mid"></div>
        <div className="stack-vp">
          <div className="stack-track" id="subTrack" ref={subTrackRef}>
            {subPages}
          </div>
        </div>
      </div>
      <div
        {...apiLayer}
        className={`stack${open === "api" ? " is-visible" : ""}`}
        id="apiStack"
        inert={open !== "api"}
        role="dialog"
        aria-label="REMOTE CONNECT"
      >
        <div className="stack-bot"></div>
        <div className="stack-mid"></div>
        <div className="stack-vp">
          <div className="stack-track" id="apiTrack" ref={apiTrackRef}>
            {apiPages}
          </div>
        </div>
      </div>

      <ChoiceTag tag={tag} tagVisible={tagVisible} onTagClose={onTagClose} anchor={tagAnchor} />
    </main>
  );
}
