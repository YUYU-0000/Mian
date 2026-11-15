import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import WorkspaceEditor from "../pages/WorkspaceEditor";
import AnimatedText from "./AnimatedText";
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
  titleConfirm?: string;
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
  const list = useRef<HTMLDivElement>(null);
  const roofText = useRef<SVGTextElement>(null);
  const roofPath = useRef<SVGPathElement>(null);
  const hanging = useRef<HTMLDivElement>(null);
  const roofId = useId();
  const [titleArmed, setTitleArmed] = useState(false);
  const close = () => {
    setTitleArmed(false);
    onTagClose();
  };
  const updateFade = () => {
    const element = list.current!;
    element.classList.toggle("is-overflow", element.scrollTop + element.clientHeight < element.scrollHeight - 1);
  };
  const fitRoof = () => {
    const line = roofText.current!;
    const room = roofPath.current!.getTotalLength() - 14;
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
    setTitleArmed(false);
    if (!tag || !tagVisible) return;
    fitRoof();
    list.current!.scrollTop = 0;
    updateFade();
    const rect = anchor().getBoundingClientRect();
    const cardH = root.current!.querySelector<HTMLElement>(".tag-card")!.offsetHeight;
    hanging.current!.style.setProperty(
      "--tag-string", Math.max(20, rect.top + rect.height / 2 - cardH / 2 + 16) + "px",
    );
  }, [tag, tagVisible]);
  return <div className="choice-tag" ref={root}>
      <div
        className={`tag-overlay${tagVisible ? " is-visible" : ""}`}
        onClick={close}
      ></div>
      <div
        className={`hang-tag${tagVisible ? " is-visible" : ""}`}
        ref={hanging}
        inert={!tagVisible}
        aria-hidden={!tagVisible}
        role="dialog"
      >
        <div className="tag-string"></div>
        <div className="tag-card">
          <svg className="tag-roof" viewBox="0 0 188 150" aria-hidden="true">
            <defs>
              <path
                id={roofId}
                ref={roofPath}
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
              ref={roofText}
              xmlSpace="preserve"
              style={{ whiteSpace: "pre" }}
              fontSize="6.2"
              letterSpacing="1.3"
              fill="rgba(241,239,233,.5)"
            >
              <textPath href={`#${roofId}`} startOffset="50%" textAnchor="middle">
                SOFTLY REMEMBERING WARMLY
              </textPath>
            </text>
            <text
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
              className={`tag-title${tag?.titleAction ? " is-action" : ""}`}
              onClick={() => {
                if (tag?.titleAction) {
                  if (tag.titleConfirm && !titleArmed) setTitleArmed(true);
                  else {
                    close();
                    tag.titleAction();
                  }
                }
              }}
              x="94"
              y={tag?.titleY || 132}
              textAnchor="middle"
              fontSize="8.5"
              letterSpacing="2"
              fill="rgba(241,239,233,.72)"
            >
              {tag?.titleConfirm
                ? <AnimatedText as="tspan" text={titleArmed ? tag.titleConfirm : tag.title} />
                : tag?.title || "模型"}
            </text>
          </svg>
          <div className="tag-walls">
            <div className="tag-kicker">
              {tag?.kicker || "SELECT"}
            </div>
            <div className="tag-list" ref={list} onScroll={updateFade}>
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
                      close();
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
