import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import {
  authorizeTicketArchive,
  resolveTicketSwipeDirection,
  shouldArchiveTicket,
  ticketSwipeOffset,
  TICKET_SWIPE_MAX_DRAG,
  type TicketSwipeDirection,
} from "./ticketGestures";

type Options = {
  direction: "left" | "down";
  canDismiss?: () => boolean;
  beforeDismiss?: () => Promise<void>;
  onExitComplete: () => void;
};

export function useTicketSwipe({
  direction,
  canDismiss = () => true,
  beforeDismiss,
  onExitComplete,
}: Options) {
  const motionRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastMovePosition: number;
    lastMoveTime: number;
    lastRafTime: number;
    targetOffset: number;
    offset: number;
    angle: number;
    velocity: number;
    direction: TicketSwipeDirection;
    phase: "drag" | "waiting" | "rebound" | "exit";
    completed: boolean;
    height: number;
    claimed: boolean;
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
        const speed = (state.targetOffset - state.offset) / elapsed;
        const targetAngle = Math.max(-1.6, Math.min(1.6, speed * 1.2));
        state.angle += (targetAngle - state.angle) * 0.3;
      }
      state.offset += (state.targetOffset - state.offset) * 0.82;
    } else if (state.phase === "rebound") {
      state.offset += (0 - state.offset) * 0.28;
      state.angle += (0 - state.angle) * 0.28;
      if (Math.abs(state.offset) < 0.5 && Math.abs(state.angle) < 0.05) {
        motion.style.transform = "";
        motion.style.opacity = "";
        motion.style.filter = "";
        motion.style.transition = "";
        dragRef.current = null;
        frameRef.current = null;
        return;
      }
    } else if (state.phase === "exit") {
      state.offset += ((direction === "left" ? -220 : 220) - state.offset) * 0.2;
      state.angle += (0 - state.angle) * 0.2;
      if ((direction === "left" ? -state.offset : state.offset) > 200 && !state.completed) {
        state.completed = true;
        onExitComplete();
        frameRef.current = null;
        return;
      }
    }

    const absX = Math.abs(state.offset);
    let opacity = 1;
    let blurPx = 0;
    if (absX > 18) {
      const progress = Math.min(1, (absX - 18) / 54);
      opacity = Math.max(0.72, 1 - progress * 0.28);
      blurPx = Math.min(0.45, progress * 0.45);
      if (state.phase === "exit")
        opacity = Math.max(0, opacity - Math.max(0, (absX - 72) / 148) * 0.72);
    }
    motion.style.transform = `${direction === "left" ? `translate3d(${state.offset}px, 0, 0)` : `translate3d(0, ${state.offset}px, 0)`} rotate(${state.angle}deg)`;
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
      lastMovePosition: direction === "left" ? event.clientX : event.clientY,
      lastMoveTime: performance.now(),
      lastRafTime: performance.now(),
      targetOffset: 0,
      offset: 0,
      angle: 0,
      velocity: 0,
      direction: null,
      phase: "drag",
      completed: false,
      height: event.currentTarget.offsetHeight,
      claimed: false,
    };
    if (direction === "left") event.currentTarget.setPointerCapture(event.pointerId);
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
      direction === "left" ? deltaX : -Math.abs(deltaX),
      deltaY,
    );
    if (direction === "down" && state.direction) suppressClickRef.current = true;
    if (direction === "down" && state.claimed && deltaY <= 0) state.targetOffset = 0;
    if (direction === "left" ? state.direction !== "horizontal" : state.direction !== "vertical" || deltaY <= 0) return;
    if (direction === "down" && !state.claimed) event.currentTarget.setPointerCapture(event.pointerId);
    state.claimed = true;
    event.preventDefault();
    suppressClickRef.current = true;
    const now = performance.now();
    const velocity =
      ((direction === "left" ? event.clientX : event.clientY) - state.lastMovePosition) / Math.max(1, now - state.lastMoveTime);
    state.velocity = state.velocity * 0.5 + velocity * 0.5;
    state.lastMoveTime = now;
    state.lastMovePosition = direction === "left" ? event.clientX : event.clientY;
    state.targetOffset = direction === "left" ? ticketSwipeOffset(deltaX) : Math.min(TICKET_SWIPE_MAX_DRAG, deltaY);
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
      state.claimed &&
      (direction === "left" ? shouldArchiveTicket(state.offset, state.velocity) : state.targetOffset > state.height * 0.5) &&
      canDismiss()
    ) {
      if (beforeDismiss) {
        state.phase = "waiting";
        void authorizeTicketArchive(beforeDismiss).then((authorized) => {
          if (dragRef.current === state)
            state.phase = authorized ? "exit" : "rebound";
        });
      } else state.phase = "exit";
    } else if (state.claimed) state.phase = "rebound";
    else {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      dragRef.current = null;
      if (motionRef.current) motionRef.current.style.transition = "";
    }
    clearSuppressionSoon();
  };

  const acceptClick = () => !suppressClickRef.current;
  return {
    motionRef,
    acceptClick,
    onPointerDown,
    onPointerMove,
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => endPointer(event),
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => endPointer(event, true),
  };
}
