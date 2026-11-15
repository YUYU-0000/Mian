import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ConversationRecord } from "../types";
import ScrollText from "./ScrollText";
import {
  authorizeTicketArchive,
  resolveTicketSwipeDirection,
  shouldArchiveTicket,
  ticketSwipeOffset,
  type TicketSwipeDirection,
} from "../ticketGestures";

export default function MiniTicket({
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
  const fontSize = Math.max(
    9,
    15 - Math.max(0, conversation.abbr.length - 4) * 0.9,
  );
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
    if (
      dragRef.current?.phase === "waiting" ||
      dragRef.current?.phase === "exit"
    )
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
      (event.clientX - state.lastMoveX) / Math.max(1, now - state.lastMoveTime);
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
            <ScrollText
              className="mini-abbr"
              style={{
                fontSize,
                letterSpacing: conversation.abbr.length > 7 ? -0.3 : undefined,
              }}
            >
              {conversation.abbr}
            </ScrollText>
          </button>
        </div>
      </div>
    </div>
  );
}
