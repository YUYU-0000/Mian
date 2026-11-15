import { useEffect, useLayoutEffect, useRef } from "react";
import WorkspaceEditor from "../pages/WorkspaceEditor";
import ScrollText from "./ScrollText";
import "./hang-tag.css";
import "./choice-tag.css";
export type TagConfig = {
  giant: string;
  giantY?: number;
  kicker: string;
  title: string;
  titleY?: number;
  titleAction?: () => void;
  items: {
    label: string;
    value?: string;
    selected?: boolean;
    static?: boolean;
  }[];
  onPick?: (value: string) => void;
  workspace?: { value: string; onSave: (directory: string) => Promise<void> };
};

export default function ChoiceTag({ tag, tagVisible, onTagClose, anchor }: {
  tag: TagConfig | null;
  tagVisible: boolean;
  onTagClose: () => void;
  anchor: () => HTMLElement;
}) {
  const root = useRef<HTMLDivElement>(null);
  const updateFade = () => {
    const list = root.current!.querySelector<HTMLElement>("#tagList")!;
    list.classList.toggle("is-overflow", list.scrollTop + list.clientHeight < list.scrollHeight - 1);
  };
  const fitRoof = () => {
    const line = root.current!.querySelector<SVGTextElement>("#tagRoofLine")!;
    const room = root.current!.querySelector<SVGPathElement>("#roofLine")!.getTotalLength() - 14;
    let size = 6.2;
    line.setAttribute("font-size", String(size));
    while (line.getComputedTextLength() > room && size > 4) {
      size -= 0.2;
      line.setAttribute("font-size", size.toFixed(1));
    }
  };
  useEffect(() => {
    let mounted = true;
    void document.fonts.ready.then(() => { if (mounted) fitRoof(); });
    document.fonts.addEventListener("loadingdone", fitRoof);
    return () => {
      mounted = false;
      document.fonts.removeEventListener("loadingdone", fitRoof);
    };
  }, []);
  useLayoutEffect(() => {
    if (!tag || !tagVisible) return;
    fitRoof();
    root.current!.querySelector("#tagList")!.scrollTop = 0;
    updateFade();
    const rect = anchor().getBoundingClientRect();
    const cardH = root.current!.querySelector<HTMLElement>(".tag-card")!.offsetHeight;
    root.current!.querySelector<HTMLElement>("#hangTag")!.style.setProperty(
      "--tag-string", Math.max(20, rect.top + rect.height / 2 - cardH / 2 + 16) + "px",
    );
  }, [tag, tagVisible]);
  return <div className="choice-tag" ref={root}>
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
              <path
                id="roofLine"
                d="M 24 90 L 84 52 Q 94 45.5 104 52 L 164 90"
              />
            </defs>

            <g
              fill="#f5f2ec"
              stroke="#f5f2ec"
              strokeWidth="8"
              strokeLinejoin="round"
            >
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
              fontSize={Math.min(
                28,
                Math.floor(118 / ((tag?.giant.length || 5) * 0.62)),
              )}
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
            <div className="tag-list" id="tagList" onScroll={updateFade}>
              {tag?.workspace && (
                <WorkspaceEditor key={tag.workspace.value} {...tag.workspace} />
              )}
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
  </div>;
}
