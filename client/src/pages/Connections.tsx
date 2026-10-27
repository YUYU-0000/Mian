import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api } from "../api";
import type { Config, ConnectionStatus, Sandbox } from "../types";

const blank: Config = {
  workingDirectory: "",
  sandbox: "workspace-write",
  model: "",
};
const sandboxOptions: Sandbox[] = [
  "read-only",
  "workspace-write",
  "danger-full-access",
];

type PaperPhase = "closed" | "opening" | "open" | "closing";

const shortEnglishStatus =
  "[A-Za-z0-9][A-Za-z0-9._/+:-]*(?:[ \\t]+[A-Za-z0-9][A-Za-z0-9._/+:-]*)*";
const shortChineseStatus =
  "[\\u3400-\\u9fff][\\u3400-\\u9fff，。！？、：；（）「」『』·]*(?:[ \\t]+\\([A-Za-z0-9._/+:-]+\\))?";

function shortMixedStatus(text: string) {
  const value = text.trim();
  const englishFirst = value.match(
    new RegExp(`^(${shortEnglishStatus})\\s*(${shortChineseStatus})$`, "u"),
  );
  const chineseFirst = value.match(
    new RegExp(`^(${shortChineseStatus})\\s*(${shortEnglishStatus})$`, "u"),
  );
  const match = englishFirst ?? chineseFirst;
  if (!match) return null;
  const english = englishFirst ? match[1] : match[2];
  const chinese = englishFirst ? match[2] : match[1];
  if (
    Array.from(english).length > 24 ||
    Array.from(chinese).length > 10 ||
    Array.from(`${english} ${chinese}`).length > 32
  )
    return null;
  return { english, chinese };
}

function StatusResult({ text }: { text: string }) {
  const short = shortMixedStatus(text);
  if (short)
    return (
      <span className="status-result status-result-short">
        <span className="status-source">{short.english}</span>{" "}
        <span className="status-chinese">{short.chinese}</span>
      </span>
    );
  const firstChinese = text.search(/[\u3400-\u9fff]/);
  if (firstChinese < 0)
    return <span className="status-result">{text}</span>;
  return (
    <span className="status-result">
      {text.slice(0, firstChinese)}
      <span className="status-chinese">{text.slice(firstChinese)}</span>
    </span>
  );
}

type StatusTextPhase = "idle" | "exiting" | "entering";

type StatusTextMachine = {
  displayed: string;
  phase: StatusTextPhase;
};

const statusExitDuration = 140;
const statusEnterDuration = 180;

function reducedStatusMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function useStatusTextTransition(text: string) {
  const [machine, setMachine] = useState<StatusTextMachine>(() => ({
    displayed: text,
    phase: reducedStatusMotion() ? "idle" : "entering",
  }));
  const nodeRef = useRef<HTMLSpanElement>(null);
  const latestTargetRef = useRef(text);
  const animationRef = useRef<Animation | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      animationRef.current?.cancel();
      animationRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    latestTargetRef.current = text;
    if (reducedStatusMotion()) {
      generationRef.current += 1;
      animationRef.current?.cancel();
      animationRef.current = null;
      setMachine({ displayed: text, phase: "idle" });
      return;
    }
    setMachine((current) => {
      if (current.displayed === text || current.phase === "exiting")
        return current;
      return { ...current, phase: "exiting" };
    });
  }, [text]);

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    if (machine.phase === "idle" || reducedStatusMotion()) {
      animationRef.current?.cancel();
      animationRef.current = null;
      node.style.opacity = "1";
      node.style.filter = "blur(0px)";
      return;
    }

    const currentStyle = getComputedStyle(node);
    const startOpacity = Number.parseFloat(currentStyle.opacity);
    const startFilter = currentStyle.filter === "none" ? "blur(0px)" : currentStyle.filter;
    const token = generationRef.current + 1;
    generationRef.current = token;
    animationRef.current?.cancel();

    const animation =
      machine.phase === "exiting"
        ? node.animate(
            [
              {
                opacity: Number.isFinite(startOpacity) ? startOpacity : 1,
                filter: startFilter,
              },
              { opacity: 0, filter: "blur(1.25px)" },
            ],
            { duration: statusExitDuration, easing: "ease-out", fill: "both" },
          )
        : node.animate(
            [
              { opacity: 0, filter: "blur(0px)" },
              { opacity: 1, filter: "blur(0px)" },
            ],
            { duration: statusEnterDuration, easing: "ease-out", fill: "both" },
          );
    animationRef.current = animation;

    void animation.finished
      .then(() => {
        if (!mountedRef.current || generationRef.current !== token) return;
        animationRef.current = null;
        if (machine.phase === "exiting") {
          setMachine({
            displayed: latestTargetRef.current,
            phase: "entering",
          });
          return;
        }
        setMachine((current) =>
          latestTargetRef.current === current.displayed
            ? { ...current, phase: "idle" }
            : { ...current, phase: "exiting" },
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Status text animation failed", error);
      });

    return () => {
      if (animationRef.current === animation) animationRef.current = null;
      generationRef.current += 1;
      animation.cancel();
    };
  }, [machine.displayed, machine.phase]);

  return { machine, nodeRef };
}

function AnimatedStatusResult({ text }: { text: string }) {
  const { machine, nodeRef } = useStatusTextTransition(text);

  return (
    <span
      className="status-result-transition"
      role="status"
      aria-label={text}
      data-status-text={text}
      data-status-phase={machine.phase}
    >
      <span
        ref={nodeRef}
        className="status-result-text status-text-node"
        aria-hidden="true"
      >
        <StatusResult text={machine.displayed} />
      </span>
    </span>
  );
}

function paperStatusText(status: ConnectionStatus) {
  return status.state === "ready"
    ? "READY"
    : status.state === "checking"
      ? "CHECKING"
      : status.state === "login-required"
        ? "LOGIN REQUIRED"
        : status.state === "error"
          ? "ERROR"
          : "NOT CONNECTED";
}

function AnimatedPaperStatus({ status }: { status: ConnectionStatus }) {
  const text = paperStatusText(status);
  const { machine, nodeRef } = useStatusTextTransition(text);

  return (
    <strong
      className={`paper-status paper-status-transition ${status.state}`}
      role="status"
      aria-label={text}
      data-status-text={text}
      data-status-phase={machine.phase}
    >
      <span
        ref={nodeRef}
        className="paper-status-text status-text-node"
        aria-hidden="true"
      >
        {machine.displayed}
      </span>
    </strong>
  );
}

function restoredConnectionResult(status: ConnectionStatus) {
  return status.state === "ready" || status.state === "login-required"
    ? status.message
    : "None";
}

function sameConnectionStatus(
  left: ConnectionStatus,
  right: ConnectionStatus,
) {
  return left.state === right.state && left.message === right.message;
}

export default function Connections({
  status,
  onStatus,
  onBack,
}: {
  status: ConnectionStatus;
  onStatus: (status: ConnectionStatus) => void;
  onBack: () => void;
}) {
  const [config, setConfig] = useState(blank);
  const [result, setResult] = useState(() => restoredConnectionResult(status));
  const [paperPhase, setPaperPhase] = useState<PaperPhase>("closed");
  const [selected, setSelected] = useState<"codex" | "api">("codex");
  const [stampOpen, setStampOpen] = useState(false);
  const [focusedOption, setFocusedOption] = useState(0);
  const [frozen, setFrozen] = useState<{
    height: number;
    scale: string;
  } | null>(null);
  const [paperViewport, setPaperViewport] = useState<{
    top: number;
    maxHeight: number;
  } | null>(null);
  const [stampPosition, setStampPosition] = useState({ top: 0, left: 0 });
  const [action, setAction] = useState<"save" | "test" | null>(null);
  const pageRef = useRef<HTMLElement>(null);
  const paperRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const stampRef = useRef<HTMLDivElement>(null);
  const codexTieRef = useRef<HTMLDivElement>(null);
  const paperPhaseRef = useRef<PaperPhase>("closed");
  const actionRef = useRef<"save" | "test" | null>(null);
  const locallyPublishedStatusRef = useRef<ConnectionStatus | null>(null);

  const paperMounted = paperPhase !== "closed";
  const paperVisible = paperPhase === "open";

  useEffect(() => {
    api
      .getConfig()
      .then(setConfig)
      .catch((error) =>
        setResult(error instanceof Error ? error.message : "读取失败"),
      );
  }, []);
  useEffect(() => {
    const locallyPublished = locallyPublishedStatusRef.current;
    if (locallyPublished && sameConnectionStatus(locallyPublished, status)) {
      locallyPublishedStatusRef.current = null;
      return;
    }
    if (actionRef.current) return;
    setResult(restoredConnectionResult(status));
  }, [status]);
  useEffect(() => {
    if (!paperMounted) return;
    const viewport = window.visualViewport;
    const updatePaper = () => {
      const height = viewport?.height ?? window.innerHeight;
      const offset = viewport?.offsetTop ?? 0;
      setPaperViewport({
        top: offset + height / 2,
        maxHeight: Math.floor(height * 0.85),
      });
    };
    updatePaper();
    viewport?.addEventListener("resize", updatePaper);
    viewport?.addEventListener("scroll", updatePaper);
    return () => {
      viewport?.removeEventListener("resize", updatePaper);
      viewport?.removeEventListener("scroll", updatePaper);
    };
  }, [paperMounted]);
  useEffect(() => {
    if (!stampOpen) return;
    const trigger = triggerRef.current?.getBoundingClientRect();
    const paper = paperRef.current?.getBoundingClientRect();
    if (trigger && paper)
      setStampPosition({
        top: trigger.bottom - paper.top + 4,
        left: trigger.left - paper.left,
      });
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !stampRef.current?.contains(target)
      )
        setStampOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [stampOpen]);

  useLayoutEffect(() => {
    if (paperPhase !== "opening") return;
    const frame = requestAnimationFrame(() => {
      if (paperPhaseRef.current !== "opening") return;
      paperPhaseRef.current = "open";
      setPaperPhase("open");
    });
    return () => cancelAnimationFrame(frame);
  }, [paperPhase]);

  const openPaper = (opener: HTMLElement) => {
    if (paperPhaseRef.current !== "closed") return;
    const page = pageRef.current;
    const scale = page
      ? getComputedStyle(page).getPropertyValue("--mail-scale").trim() || "1"
      : "1";
    setFrozen({
      height: page?.getBoundingClientRect().height ?? window.innerHeight,
      scale,
    });
    codexTieRef.current = opener as HTMLDivElement;
    paperPhaseRef.current = "opening";
    setPaperPhase("opening");
  };
  const closePaper = () => {
    if (paperPhaseRef.current !== "open") return;
    setStampOpen(false);
    if (
      document.activeElement instanceof HTMLElement &&
      paperRef.current?.contains(document.activeElement)
    )
      document.activeElement.blur();
    paperPhaseRef.current = "closing";
    setPaperPhase("closing");
  };
  const finishClosingPaper = () => {
    if (paperPhaseRef.current !== "closing") return;
    paperPhaseRef.current = "closed";
    setPaperPhase("closed");
    setFrozen(null);
    setPaperViewport(null);
    requestAnimationFrame(() => codexTieRef.current?.focus());
  };

  useEffect(() => {
    if (!paperMounted) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (stampOpen) setStampOpen(false);
      else closePaper();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [paperMounted, stampOpen]);

  const save = async () => {
    if (actionRef.current) return;
    actionRef.current = "save";
    setAction("save");
    try {
      setConfig(await api.saveConfig(config));
      setResult("Saved");
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Save failed");
    } finally {
      actionRef.current = null;
      setAction(null);
    }
  };
  const test = async () => {
    if (actionRef.current) return;
    actionRef.current = "test";
    setAction("test");
    const checkingStatus: ConnectionStatus = {
      state: "checking",
      message: "正在检查",
    };
    locallyPublishedStatusRef.current = checkingStatus;
    onStatus(checkingStatus);
    setResult("Checking...");
    try {
      const next = await api.test();
      locallyPublishedStatusRef.current = next;
      onStatus(next);
      setResult(next.message);
    } catch (error) {
      const next = {
        state: "error" as const,
        message: error instanceof Error ? error.message : "连接失败",
      };
      locallyPublishedStatusRef.current = next;
      onStatus(next);
      setResult(next.message);
    } finally {
      actionRef.current = null;
      setAction(null);
    }
  };
  const chooseSandbox = (value: Sandbox) => {
    setConfig((current) => ({ ...current, sandbox: value }));
    setFocusedOption(sandboxOptions.indexOf(value));
    setStampOpen(false);
    triggerRef.current?.focus();
  };
  const toggleStamp = () => {
    setStampOpen((current) => {
      const opening = !current;
      if (opening)
        setFocusedOption(Math.max(0, sandboxOptions.indexOf(config.sandbox)));
      return opening;
    });
  };
  const openStamp = () => {
    setFocusedOption(Math.max(0, sandboxOptions.indexOf(config.sandbox)));
    setStampOpen(true);
  };
  const stampKeyDown = (event: React.KeyboardEvent) => {
    if (
      !stampOpen &&
      ["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)
    ) {
      event.preventDefault();
      openStamp();
      return;
    }
    if (!stampOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setStampOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setFocusedOption(
        (current) =>
          (current +
            (event.key === "ArrowDown" ? 1 : -1) +
            sandboxOptions.length) %
          sandboxOptions.length,
      );
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseSandbox(sandboxOptions[focusedOption]);
    }
  };

  const frozenStyle = frozen
    ? ({
        height: `${frozen.height}px`,
        minHeight: `${frozen.height}px`,
        maxHeight: `${frozen.height}px`,
        "--mail-scale": frozen.scale,
      } as React.CSSProperties)
    : undefined;
  const paperStyle = paperViewport
    ? {
        top: `${paperViewport.top}px`,
        maxHeight: `${paperViewport.maxHeight}px`,
      }
    : undefined;
  return (
    <main
      ref={pageRef}
      className={`connection-page ${paperMounted ? "paper-is-open" : ""}`}
      style={frozenStyle}
    >
      <div className="connection-header">
        <button onClick={onBack} aria-label="返回主界面">
          <svg width="24" height="24" viewBox="0 0 24 24">
            <path d="M10 4 2 12l8 8" />
            <circle cx="9" cy="12" r="1.4" />
            <path d="m18 8.5-4.5 3.5 4.5 3.5" />
          </svg>
        </button>
      </div>
      <div
        className={`mail-envelope mail-first ${selected === "codex" ? "is-active" : ""}`}
        role="button"
        tabIndex={0}
        aria-pressed={selected === "codex"}
        onClick={() => setSelected("codex")}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setSelected("codex");
          }
        }}
      >
        <div className="mail-side-flap" />
        <div className="mail-first-title">
          CODEX <i>LOCAL</i>
        </div>
        <div
          ref={codexTieRef}
          className="tie-container-v mail-tie-v"
          role="button"
          tabIndex={0}
          aria-label="打开 Codex 设置"
          onClick={(event) => {
            event.stopPropagation();
            openPaper(event.currentTarget);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              openPaper(event.currentTarget);
            }
          }}
        >
          <div className="tie-btn" />
          <div className="tie-btn" />
          <svg className="string-svg-v">
            <path d="M 16,11 L 56,11 M 16,21 L 56,21" fill="none" />
          </svg>
        </div>
      </div>
      <div
        className={`mail-envelope mail-second ${selected === "api" ? "is-active" : ""}`}
        role="button"
        tabIndex={0}
        aria-pressed={selected === "api"}
        onClick={() => setSelected("api")}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setSelected("api");
          }
        }}
      >
        <div className="env-top-flap-wrapper">
          <div className="env-top-flap" />
        </div>
        <div className="mail-second-title">
          <div>REMOTE</div>
          <i>CONNECT</i>
        </div>
        <div className="mail-footer">
          <span>ENDPOINT</span>
          <span>KEY</span>
          <span>MODEL</span>
        </div>
        <div className="tie-container-h mail-tie-h">
          <div className="tie-btn" />
          <div className="tie-btn" />
          <svg className="string-svg-h">
            <path d="M 11,16 L 11,56 M 21,16 L 21,56" fill="none" />
          </svg>
        </div>
      </div>
      {paperMounted && (
        <>
          <button
            className={`paper-overlay ${paperVisible ? "is-visible" : ""}`}
            onClick={closePaper}
            aria-label="关闭设置"
          />
          <section
            ref={paperRef}
            className={`connection-paper ${paperVisible ? "is-visible" : ""}`}
            style={paperStyle}
            role="dialog"
            aria-modal="true"
            aria-label="Codex connection settings"
            onTransitionEnd={(event) => {
              if (
                event.target === event.currentTarget &&
                event.propertyName === "transform"
              )
                finishClosingPaper();
            }}
          >
            <div
              className="paper-content"
              onScroll={() => {
                if (stampOpen) setStampOpen(false);
              }}
            >
              <header>
                <div>
                  <h1>CODEX</h1>
                  <small>v0.1.0</small>
                </div>
                <AnimatedPaperStatus status={status} />
              </header>
              <div className="paper-gap" />
              <section>
                <h2>CONNECTION</h2>
                <label>
                  Executable
                  <input value="codex" disabled />
                </label>
                <label>
                  Working Directory
                  <input
                    value={config.workingDirectory}
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        workingDirectory: event.target.value,
                      })
                    }
                  />
                </label>
              </section>
              <div className="paper-gap" />
              <section>
                <h2>BEHAVIOR</h2>
                <label>
                  Model
                  <input
                    value={config.model}
                    onChange={(event) =>
                      setConfig({ ...config, model: event.target.value })
                    }
                  />
                </label>
                <label>
                  Sandbox
                  <div className="custom-select-wrapper">
                    <select
                      className="field-select-hidden"
                      tabIndex={-1}
                      aria-hidden="true"
                      value={config.sandbox}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          sandbox: event.target.value as Sandbox,
                        })
                      }
                    >
                      {sandboxOptions.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <div
                      ref={triggerRef}
                      className="custom-select-trigger"
                      tabIndex={0}
                      role="combobox"
                      aria-expanded={stampOpen}
                      aria-controls="sandbox-dropdown"
                      aria-haspopup="listbox"
                      onClick={toggleStamp}
                      onKeyDown={stampKeyDown}
                    >
                      <span>{config.sandbox}</span>
                    </div>
                    <div
                      ref={stampRef}
                      id="sandbox-dropdown"
                      className={`stamp-dropdown ${stampOpen ? "is-open" : ""}`}
                      role="listbox"
                      aria-hidden={!stampOpen}
                      style={{
                        top: stampPosition.top,
                        left: stampPosition.left,
                      }}
                    >
                      <div className="stamp-inner">
                        {sandboxOptions.map((value, index) => (
                          <div
                            key={value}
                            className={`stamp-option ${config.sandbox === value ? "is-selected" : ""} ${focusedOption === index ? "is-focused" : ""}`}
                            role="option"
                            aria-selected={config.sandbox === value}
                            onPointerEnter={() => setFocusedOption(index)}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              chooseSandbox(value);
                            }}
                          >
                            {value}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </label>
                <label>
                  Timeout
                  <input type="number" value="" disabled />
                </label>
              </section>
              <footer>
                <div className="paper-result">
                  <AnimatedStatusResult text={result} />
                </div>
                <span>
                  <button
                    disabled={action !== null}
                    aria-busy={action === "save"}
                    onClick={() => void save()}
                  >
                    [ SAVE ]
                  </button>
                  <i>X</i>
                  <button
                    disabled={action !== null}
                    aria-busy={action === "test"}
                    onClick={() => void test()}
                  >
                    [ TEST ]
                  </button>
                </span>
              </footer>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
