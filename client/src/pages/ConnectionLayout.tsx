import type { RefObject, ReactNode } from "react";
import WorkspaceEditor from "./WorkspaceEditor";
import ScrollText from "../components/ScrollText";
export type TagConfig = {
  giant: string;
  giantY?: number;
  kicker: string;
  title: string;
  titleY?: number;
  titleAction?: () => void;
  items: { label: string; value?: string; selected?: boolean; static?: boolean }[];
  onPick?: (value: string) => void;
  workspace?: { value: string; onSave: (directory: string) => Promise<void> };
};
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
  onTagScroll: () => void;
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
  onTagScroll,
  subPages,
  apiPages,
}: Props) {
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
        className={`stack${open === "sub" ? " is-visible" : ""}`}
        id="subStack"
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
        className={`stack${open === "api" ? " is-visible" : ""}`}
        id="apiStack"
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

      <div
        className={`tag-overlay${tagVisible ? " is-visible" : ""}`}
        onClick={onTagClose}
        id="tagOverlay"
      ></div>
      <div
        className={`hang-tag${tagVisible ? " is-visible" : ""}`}
        id="hangTag"
        role="dialog"
      >
        <div className="tag-string"></div>
        <div className="tag-card">
          <svg className="tag-roof" viewBox="0 0 188 150" aria-hidden="true">
            <defs>
              <path id="roofLine" d="M 24 90 L 84 52 Q 94 45.5 104 52 L 164 90" />
            </defs>

            <g fill="#f5f2ec" stroke="#f5f2ec" strokeWidth="8" strokeLinejoin="round">
              <circle cx="94" cy="15" r="5" strokeWidth="5" />
              <path d="M 94 22 L 184 80 L 176 86 L 176 156 L 12 156 L 12 86 L 4 80 Z" />
            </g>
            <circle cx="94" cy="15" r="2" fill="#5d6b75" />

            <path
              d="M 94 38 L 166 84 L 160 88 L 160 140 L 28 140 L 28 88 L 22 84 Z"
              fill="#7590a3"
              stroke="#7590a3"
              strokeWidth="6"
              strokeLinejoin="round"
            />

            <text
              id="tagRoofLine"
              xmlSpace="preserve"
              style={{ whiteSpace: "pre" }}
              fontSize="6.2"
              letterSpacing="1.3"
              fill="rgba(241,239,233,.5)"
            >
              <textPath href="#roofLine" startOffset="50%" textAnchor="middle">
                SOFTLY REMEMBERING WARMLY
              </textPath>
            </text>
            <text
              id="tagGiant"
              x="94"
              y={tag?.giantY || 117}
              textAnchor="middle"
              fontSize={Math.min(28, Math.floor(118 / ((tag?.giant.length || 5) * 0.62)))}
              fontWeight="300"
              letterSpacing="1"
              fill="#f1efe9"
            >
              {tag?.giant || "MODEL"}
            </text>
            <text
              id="tagTitle"
              className={tag?.titleAction ? "is-action" : ""}
              onClick={() => {
                if (tag?.titleAction) {
                  onTagClose();
                  tag.titleAction();
                }
              }}
              x="94"
              y={tag?.titleY || 132}
              textAnchor="middle"
              fontSize="8.5"
              letterSpacing="2"
              fill="rgba(241,239,233,.72)"
            >
              {tag?.title || "模型"}
            </text>
          </svg>
          <div className="tag-walls">
            <div className="tag-kicker" id="tagKicker">
              {tag?.kicker || "SELECT"}
            </div>
            <div className="tag-list" id="tagList" onScroll={onTagScroll}>
              {tag?.workspace && <WorkspaceEditor key={tag.workspace.value} {...tag.workspace} />}
              {tag?.items.map((item, index) => (
                <button
                  key={index}
                  type="button"
                  className={`tag-option${item.selected ? " is-selected" : ""}${item.static ? " is-static" : ""}`}
                  onClick={() => {
                    if (!item.static) {
                      onTagClose();
                      tag.onPick!(item.value!);
                    }
                  }}
                >
                  <ScrollText>{item.label}</ScrollText>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
