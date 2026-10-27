import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ConversationRecord } from "../types";
import {
  displayConversationValue,
  formatLastActivity,
  formatLastMessage,
  formatTokenUsage,
} from "../conversationDisplay";
import {
  adjacentConversationId,
  authorizeTicketArchive,
  resolveTicketSwipeDirection,
  shouldArchiveTicket,
  ticketSwipeOffset,
  type TicketSwipeDirection,
} from "../ticketGestures";

type ConversationPatch = Partial<
  Pick<ConversationRecord, "title" | "frontName" | "image" | "pinned">
>;

type Props = {
  open: boolean;
  conversations: ConversationRecord[];
  activeConversationId: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (conversationId: string) => void;
  onCreate: () => Promise<ConversationRecord>;
  onFork: (conversationId: string) => Promise<ConversationRecord | null>;
  onUpdate: (
    conversationId: string,
    patch: ConversationPatch,
  ) => Promise<ConversationRecord>;
  canArchive: (conversationId: string) => boolean;
  onArchive: (conversationId: string) => Promise<void>;
  onArchived: (
    conversationId: string,
    adjacentConversationId: string,
  ) => void;
};

function ticketNumber(conversation: ConversationRecord) {
  return `NO. ${conversation.abbr.replace(/^C-/, "")}`;
}

function MiniTicket({
  conversation,
  active,
  entering,
  onActivate,
  onImage,
  canArchive,
  onArchive,
  onExitComplete,
}: {
  conversation: ConversationRecord;
  active: boolean;
  entering: boolean;
  onActivate: () => void;
  onImage: () => void;
  canArchive: () => boolean;
  onArchive: () => Promise<void>;
  onExitComplete: () => void;
}) {
  const fontSize = Math.max(9, 15 - Math.max(0, conversation.abbr.length - 4) * 0.9);
  const motionRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastMoveX: number;
    lastMoveTime: number;
    lastRafTime: number;
    targetX: number;
    x: number;
    angle: number;
    velocity: number;
    direction: TicketSwipeDirection;
    phase: "drag" | "waiting" | "rebound" | "exit";
    completed: boolean;
  } | null>(null);

  const clearSuppressionSoon = () => {
    if (suppressTimerRef.current !== null)
      window.clearTimeout(suppressTimerRef.current);
    suppressTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false;
      suppressTimerRef.current = null;
    }, 50);
  };

  const runFrame = (now: number) => {
    const state = dragRef.current;
    const motion = motionRef.current;
    if (!state || !motion) return;
    const elapsed = Math.max(1, now - state.lastRafTime);
    state.lastRafTime = now;
    if (state.phase === "drag") {
      if (now - state.lastMoveTime > 60)
        state.angle += (0 - state.angle) * 0.15;
      else {
        const speed = (state.targetX - state.x) / elapsed;
        const targetAngle = Math.max(-1.6, Math.min(1.6, speed * 1.2));
        state.angle += (targetAngle - state.angle) * 0.3;
      }
      state.x += (state.targetX - state.x) * 0.82;
    } else if (state.phase === "rebound") {
      state.x += (0 - state.x) * 0.28;
      state.angle += (0 - state.angle) * 0.28;
      if (Math.abs(state.x) < 0.5 && Math.abs(state.angle) < 0.05) {
        motion.style.transform = "";
        motion.style.opacity = "";
        motion.style.filter = "";
        motion.style.transition = "";
        dragRef.current = null;
        frameRef.current = null;
        return;
      }
    } else if (state.phase === "exit") {
      state.x += (-220 - state.x) * 0.2;
      state.angle += (0 - state.angle) * 0.2;
      if (state.x < -200 && !state.completed) {
        state.completed = true;
        onExitComplete();
        frameRef.current = null;
        return;
      }
    }

    const absX = Math.abs(state.x);
    let opacity = 1;
    let blurPx = 0;
    if (absX > 18) {
      const progress = Math.min(1, (absX - 18) / 54);
      opacity = Math.max(0.72, 1 - progress * 0.28);
      blurPx = Math.min(0.45, progress * 0.45);
      if (state.phase === "exit")
        opacity = Math.max(0, opacity - Math.max(0, (absX - 72) / 148) * 0.72);
    }
    motion.style.transform = `translate3d(${state.x}px, 0, 0) rotate(${state.angle}deg)`;
    if (state.phase !== "rebound") {
      motion.style.opacity = String(opacity);
      motion.style.filter = `blur(${blurPx}px)`;
    }
    frameRef.current = requestAnimationFrame(runFrame);
  };

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (suppressTimerRef.current !== null)
        window.clearTimeout(suppressTimerRef.current);
    },
    [],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.phase === "waiting" || dragRef.current?.phase === "exit")
      return;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    const motion = motionRef.current;
    if (motion) motion.style.transition = "none";
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastMoveX: event.clientX,
      lastMoveTime: performance.now(),
      lastRafTime: performance.now(),
      targetX: 0,
      x: 0,
      angle: 0,
      velocity: 0,
      direction: null,
      phase: "drag",
      completed: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    frameRef.current = requestAnimationFrame(runFrame);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.phase !== "drag" || state.pointerId !== event.pointerId)
      return;
    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    state.direction = resolveTicketSwipeDirection(
      state.direction,
      deltaX,
      deltaY,
    );
    if (state.direction !== "horizontal") return;
    event.preventDefault();
    suppressClickRef.current = true;
    const now = performance.now();
    const velocity =
      (event.clientX - state.lastMoveX) /
      Math.max(1, now - state.lastMoveTime);
    state.velocity = state.velocity * 0.5 + velocity * 0.5;
    state.lastMoveTime = now;
    state.lastMoveX = event.clientX;
    state.targetX = ticketSwipeOffset(deltaX);
  };

  const endPointer = (
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled = false,
  ) => {
    const state = dragRef.current;
    if (!state || state.phase !== "drag" || state.pointerId !== event.pointerId)
      return;
    if (
      !cancelled &&
      state.direction === "horizontal" &&
      shouldArchiveTicket(state.x, state.velocity) &&
      canArchive()
    ) {
      state.phase = "waiting";
      void authorizeTicketArchive(onArchive).then((authorized) => {
        if (dragRef.current === state)
          state.phase = authorized ? "exit" : "rebound";
      });
    } else if (state.direction === "horizontal") state.phase = "rebound";
    else {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      dragRef.current = null;
      if (motionRef.current) motionRef.current.style.transition = "";
    }
    clearSuppressionSoon();
  };

  const acceptClick = () => !suppressClickRef.current;
  return (
    <div
      className={`mini-ticket-container ${active ? "active" : ""} ${entering ? "entering" : ""}`}
      data-id={conversation.conversationId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endPointer(event)}
      onPointerCancel={(event) => endPointer(event, true)}
    >
      <div ref={motionRef} className="mini-ticket-motion">
        <div className="mini-ticket-visual">
          <div className="ticket-part char-part upper mini-upper">
            <button
              type="button"
              className="mini-box"
              style={{
                backgroundImage: conversation.image
                  ? `url("${conversation.image}")`
                  : "none",
              }}
              aria-label={`为 ${conversation.abbr} 导入图片`}
               onClick={(event) => {
                if (!acceptClick()) {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                event.stopPropagation();
                onActivate();
                onImage();
              }}
            />
          </div>
          <button
            type="button"
            className="ticket-part char-part lower mini-lower"
            aria-label={`查看 ${conversation.abbr} ${conversation.title}`}
            onClick={(event) => {
              if (!acceptClick()) {
                event.preventDefault();
                return;
              }
              onActivate();
            }}
          >
            <span
              className="mini-abbr"
              style={{
                fontSize,
                letterSpacing: conversation.abbr.length > 7 ? -0.3 : undefined,
              }}
            >
              {conversation.abbr}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TicketDrawer({
  open,
  conversations,
  activeConversationId,
  onOpenChange,
  onSelect,
  onCreate,
  onFork,
  onUpdate,
  canArchive,
  onArchive,
  onArchived,
}: Props) {
  const [previewId, setPreviewId] = useState(activeConversationId);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const enteringTimer = useRef<number | null>(null);
  const pinFrame = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const stripArea = useRef<HTMLDivElement>(null);
  const pendingImageId = useRef<string | null>(null);
  const pendingSelectionId = useRef<string | null>(null);
  const flipRemoval = useRef<{
    before: Map<string, DOMRect>;
    adjacentId: string;
    switchAfter: boolean;
  } | null>(null);
  const archiveInFlight = useRef<string | null>(null);
  const preview =
    conversations.find((item) => item.conversationId === previewId) ??
    conversations.find((item) => item.conversationId === activeConversationId) ??
    conversations[0];

  useEffect(() => {
    if (!conversations.some((item) => item.conversationId === previewId))
      setPreviewId(
        conversations.find(
          (item) => item.conversationId === activeConversationId,
        )?.conversationId ?? conversations[0]?.conversationId ?? "",
      );
  }, [activeConversationId, conversations, previewId]);

  useLayoutEffect(() => {
    const removal = flipRemoval.current;
    if (!removal) return;
    flipRemoval.current = null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animations: Animation[] = [];
    if (!reduced)
      for (const node of stripArea.current?.querySelectorAll<HTMLElement>(
        ".mini-ticket-container",
      ) ?? []) {
        const oldRect = node.dataset.id
          ? removal.before.get(node.dataset.id)
          : undefined;
        if (!oldRect) continue;
        const deltaY = oldRect.top - node.getBoundingClientRect().top;
        if (Math.abs(deltaY) <= 0.5) continue;
        animations.push(
          node.animate(
            [
              { transform: `translate3d(0, ${deltaY}px, 0)` },
              { transform: "translate3d(0, 0, 0)" },
            ],
            { duration: 220, easing: "cubic-bezier(.22,1,.36,1)" },
          ),
        );
      }
    const finish = () => {
      archiveInFlight.current = null;
      if (removal.switchAfter) onSelect(removal.adjacentId);
    };
    if (animations.length)
      void Promise.allSettled(animations.map((animation) => animation.finished)).then(finish);
    else finish();
  }, [conversations, onSelect]);

  useEffect(() => {
    if (!open) return;
    setPreviewId(activeConversationId);
    setFlipped(false);
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [activeConversationId, onOpenChange, open]);
  useEffect(() => {
    if (
      !open &&
      pendingSelectionId.current &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      const conversationId = pendingSelectionId.current;
      pendingSelectionId.current = null;
      onSelect(conversationId);
    }
  }, [onSelect, open]);
  useEffect(
    () => () => {
      if (enteringTimer.current !== null)
        window.clearTimeout(enteringTimer.current);
      if (pinFrame.current !== null) cancelAnimationFrame(pinFrame.current);
    },
    [],
  );

  const run = async (operation: () => Promise<ConversationRecord | null>) => {
    if (busy) return;
    setBusy(true);
    try {
      const conversation = await operation();
      if (!conversation) return;
      setPreviewId(conversation.conversationId);
      setFlipped(false);
      setEnteringId(conversation.conversationId);
      if (enteringTimer.current !== null)
        window.clearTimeout(enteringTimer.current);
      enteringTimer.current = window.setTimeout(() => {
        enteringTimer.current = null;
        setEnteringId(null);
      }, 250);
    } catch (error) {
      console.error(error);
    } finally {
      setBusy(false);
    }
  };

  const finishArchive = (conversationId: string) => {
    const adjacentId = adjacentConversationId(
      conversations.map((item) => item.conversationId),
      conversationId,
    );
    if (!adjacentId) return;
    const before = new Map<string, DOMRect>();
    for (const node of stripArea.current?.querySelectorAll<HTMLElement>(
      ".mini-ticket-container",
    ) ?? [])
      if (node.dataset.id && node.dataset.id !== conversationId)
        before.set(node.dataset.id, node.getBoundingClientRect());
    flipRemoval.current = {
      before,
      adjacentId,
      switchAfter: activeConversationId === conversationId,
    };
    if (previewId === conversationId) {
      setPreviewId(adjacentId);
      setFlipped(false);
    }
    onArchived(conversationId, adjacentId);
  };

  const importImage = (conversationId: string) => {
    pendingImageId.current = conversationId;
    if (fileInput.current) fileInput.current.value = "";
    fileInput.current?.click();
  };

  const onImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const conversationId = pendingImageId.current;
    pendingImageId.current = null;
    if (!file || !conversationId || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      void onUpdate(conversationId, { image: reader.result }).catch(console.error);
    };
    reader.readAsDataURL(file);
  };

  const pinPreview = async () => {
    if (!preview || busy) return;
    const before = new Map<string, DOMRect>();
    for (const node of stripArea.current?.querySelectorAll<HTMLElement>(
      ".mini-ticket-container",
    ) ?? [])
      if (node.dataset.id) before.set(node.dataset.id, node.getBoundingClientRect());
    setBusy(true);
    try {
      await onUpdate(preview.conversationId, { pinned: true });
      if (!stripArea.current) return;
      if (pinFrame.current !== null) cancelAnimationFrame(pinFrame.current);
      pinFrame.current = requestAnimationFrame(() => {
        pinFrame.current = null;
        for (const node of stripArea.current?.querySelectorAll<HTMLElement>(
          ".mini-ticket-container",
        ) ?? []) {
          const oldRect = node.dataset.id ? before.get(node.dataset.id) : undefined;
          if (!oldRect) continue;
          const deltaY = oldRect.top - node.getBoundingClientRect().top;
          if (Math.abs(deltaY) <= .5) continue;
          node.animate(
            [
              { transform: `translate3d(0, ${deltaY}px, 0)` },
              { transform: "translate3d(0, 0, 0)" },
            ],
            { duration: 320, easing: "cubic-bezier(.22,1,.36,1)" },
          );
        }
        stripArea.current?.scrollTo({ top: 0, behavior: "smooth" });
      });
    } catch (error) {
      console.error(error);
    } finally {
      setBusy(false);
    }
  };

  const flipWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setFlipped(true);
  };

  const image = preview?.image ?? "";
  return (
    <section
      id="ticketDrawer"
      className={`ticket-drawer ${open ? "is-open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="票根管理"
      aria-hidden={!open}
    >
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={onImageChange}
      />
      <div
        className="ticket-drawer-stage"
        onPointerDown={(event) => {
          if (event.currentTarget === event.target) onOpenChange(false);
        }}
      >
        <div
          className="ticket-workspace"
          onTransitionEnd={(event) => {
            if (
              event.currentTarget !== event.target ||
              event.propertyName !== "opacity" ||
              open ||
              !pendingSelectionId.current
            )
              return;
            const conversationId = pendingSelectionId.current;
            pendingSelectionId.current = null;
            onSelect(conversationId);
          }}
        >
          <div className="strip-col">
            <button
              className="strip-toggle"
              type="button"
              aria-label="新建真实对话"
              disabled={busy}
              onClick={() => void run(onCreate)}
            />
            <div ref={stripArea} className="ticket-strip-area">
              {conversations.map((conversation) => (
                <MiniTicket
                  key={conversation.conversationId}
                  conversation={conversation}
                  active={conversation.conversationId === preview?.conversationId}
                  entering={conversation.conversationId === enteringId}
                  onActivate={() => {
                    setPreviewId(conversation.conversationId);
                    setFlipped(false);
                  }}
                  onImage={() => importImage(conversation.conversationId)}
                  canArchive={() =>
                    archiveInFlight.current === null &&
                    !busy &&
                    canArchive(conversation.conversationId)
                  }
                  onArchive={async () => {
                    if (archiveInFlight.current) throw new Error("archive busy");
                    archiveInFlight.current = conversation.conversationId;
                    try {
                      await onArchive(conversation.conversationId);
                    } catch (error) {
                      archiveInFlight.current = null;
                      throw error;
                    }
                  }}
                  onExitComplete={() =>
                    finishArchive(conversation.conversationId)
                  }
                />
              ))}
            </div>
          </div>
          <div className="ticket-builder-area">
            <div className={`ticket-flipper ${flipped ? "flipped" : ""}`}>
              <div
                className="ticket-face front"
                role="button"
                tabIndex={0}
                aria-label="翻到票根背面"
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest(".front-text")) return;
                  setFlipped(true);
                }}
                onKeyDown={flipWithKeyboard}
              >
                <div className="ticket-part char-part upper main-upper">
                  {image && <img className="ticket-bg-img" src={image} alt="" />}
                  <div className="part-overlay front-overlay" />
                </div>
                <div className="ticket-part char-part lower main-lower">
                  {image && <img className="ticket-bg-img" src={image} alt="" />}
                  <div className="part-overlay front-overlay" />
                </div>
                {preview && (
                  <div
                    className="front-text"
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    onBlur={(event) => {
                      const frontName = event.currentTarget.textContent?.trim();
                      if (frontName && frontName !== preview.frontName)
                        void onUpdate(preview.conversationId, { frontName }).catch(console.error);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                  >
                    {preview.frontName}
                  </div>
                )}
              </div>

              <div
                className="ticket-face back"
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest(".back-grid")) return;
                  setFlipped(false);
                }}
              >
                <div className="ticket-part char-part upper main-upper">
                  {image && <img className="ticket-bg-img" src={image} alt="" />}
                  <div className="part-overlay back-overlay" />
                </div>
                <div className="ticket-part char-part lower main-lower">
                  {image && <img className="ticket-bg-img" src={image} alt="" />}
                  <div className="part-overlay back-overlay" />
                </div>
                {preview && (
                  <div className="back-content-layer">
                    <div className="back-header">
                      <span>CONVERSATION LOG</span>
                      <span>{ticketNumber(preview)}</span>
                    </div>
                    <div className="back-grid">
                      <label className="bg-row row-title">
                        <span className="box-label">Nickname</span>
                        <input
                          key={`${preview.conversationId}:title`}
                          type="text"
                          className="back-input cursive-input"
                          defaultValue={preview.title}
                          onBlur={(event) => {
                            const title = event.currentTarget.value.trim();
                            if (title && title !== preview.title)
                              void onUpdate(preview.conversationId, { title }).catch(console.error);
                          }}
                        />
                      </label>
                      <div className="bg-row row-info">
                        <div className="info-line"><span className="box-label">Model :</span><span className="back-input">{displayConversationValue(preview.model)}</span></div>
                        <div className="info-line"><span className="box-label">Effort :</span><span className="back-input">{displayConversationValue(preview.reasoningEffort)}</span></div>
                        <div className="info-line"><span className="box-label">Token Used :</span><span className="back-input">{formatTokenUsage(preview.uncachedTotalTokens)}</span></div>
                      </div>
                      <div className="bg-row row-rating"><span className="box-label">Seen</span><span className="back-input tone-input">{formatLastActivity(preview.lastActivityAt)}</span></div>
                      <div className="bg-row row-review"><span className="box-label">Last MSG</span><div className="back-textarea">{formatLastMessage(preview.lastMessage)}</div></div>
                      <div className="bg-row row-datetime">
                        <div className="info-line"><span className="box-label">Mode :</span><span className="back-input">{displayConversationValue(preview.collaborationMode)}</span></div>
                        <div className="info-line"><span className="box-label">Mem :</span><span className="back-input">NONE</span></div>
                      </div>
                      <div className="row-seat">
                        <button
                          className="seat-col"
                          type="button"
                          disabled={busy}
                          onClick={() => void pinPreview()}
                        ><span className="box-label">Pin</span><span className="seat-val">置顶</span></button>
                        <button
                          className="seat-col border-left"
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => onFork(preview.conversationId))}
                        ><span className="box-label">Branch</span><span className="seat-val">分支</span></button>
                        <button
                          className="seat-col border-left"
                          type="button"
                          onClick={() => {
                            pendingSelectionId.current = preview.conversationId;
                            onOpenChange(false);
                          }}
                        ><span className="box-label">Select</span><span className="seat-val">选择</span></button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
