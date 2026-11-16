import { pad2 } from "../format";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import ScrollText from "./ScrollText";
import "./notify.css";
import { BackendUnavailable, OFFLINE_MESSAGE } from "../backend";
import { onQueuedSave, recentlyQueuedSave } from "../offline";

type Notice = { kind: "ok" | "note" | "fail"; title: string; reason: string; time: Date };
const events = new EventTarget();
const show = (kind: Notice["kind"], title: string, reason = "") =>
  events.dispatchEvent(
    new CustomEvent<Notice>("notice", {
      detail: { kind, title, reason, time: new Date() },
    }),
  );
const reasonOf = (err: unknown) =>
  (typeof err === "string"
    ? err
    : err && typeof err === "object" && "message" in err
      ? String(err.message || "")
      : "") || "沒有收到具體原因，可以稍後再試一次。";
export const notify = {
  ok: (title: string) => recentlyQueuedSave() ? show("note", "先記下了，連上再存") : show("ok", title),
  note: (title: string) => show("note", title),
  fail: (title: string, err?: unknown) => err instanceof BackendUnavailable
    ? show("note", OFFLINE_MESSAGE) : show("fail", title, reasonOf(err)),
};

export default function Notify({ page }: { page: string }) {
  const pageLabel = page === "/connections" ? "連接設置"
    : page === "/settings" ? "檔案館"
    : page === "/chat" ? "對話"
    : page === "/clues" ? "線索" : "主界面";
  const [notice, setNotice] = useState<Notice>({
    kind: "ok",
    title: "",
    reason: "",
    time: new Date(),
  });
  const [visible, setVisible] = useState(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const shown = useRef(false);
  const timer = useRef(0);
  const busy = useRef(0);
  const frame = useRef(0);
  const duration = useRef(1800);
  const swipe = useRef<{
    id: number;
    x: number;
    y: number;
    offset: number;
    active: boolean;
  } | null>(null);
  const moved = useRef(false);
  const hide = () => {
    window.clearTimeout(timer.current);
    window.clearTimeout(busy.current);
    cancelAnimationFrame(frame.current);
    shown.current = false;
    swipe.current = null;
    setDragging(false);
    setOffset(0);
    setVisible(false);
  };
  const startSwipe = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    moved.current = false;
    swipe.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offset: 0,
      active: false,
    };
  };
  const moveSwipe = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 6) moved.current = true;
    if (!start.active) {
      if (dy >= -6 || Math.abs(dy) <= Math.abs(dx)) return;
      start.active = true;
      window.clearTimeout(timer.current);
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    event.preventDefault();
    event.stopPropagation();
    start.offset = Math.min(0, dy);
    setOffset(start.offset);
  };
  const finishSwipe = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const start = swipe.current;
    if (!start || start.id !== event.pointerId) return;
    swipe.current = null;
    if (!start.active) return;
    event.stopPropagation();
    if (!cancelled && start.offset <= -36) hide();
    else {
      setDragging(false);
      setOffset(0);
      timer.current = window.setTimeout(hide, duration.current);
    }
  };
  useEffect(() => {
    const receive = (event: Event) => {
      const next = (event as CustomEvent<Notice>).detail;
      const replace = shown.current;
      hide();
      busy.current = window.setTimeout(
        () => {
          setNotice(next);
          frame.current = requestAnimationFrame(() => {
            frame.current = requestAnimationFrame(() => {
              shown.current = true;
              setVisible(true);
            });
          });
          duration.current =
            next.kind === "fail" ? 5000 : next.kind === "note" ? 2200 : 1800;
          timer.current = window.setTimeout(hide, duration.current);
        },
        replace ? 280 : 0,
      );
    };
    events.addEventListener("notice", receive);
    const stopQueued = onQueuedSave(() => notify.note("先記下了，連上再存"));
    return () => {
      stopQueued();
      events.removeEventListener("notice", receive);
      window.clearTimeout(timer.current);
      window.clearTimeout(busy.current);
      cancelAnimationFrame(frame.current);
    };
  }, []);
  const mark =
    notice.kind === "fail" ? "RETRY" : notice.kind === "note" ? "NOTE" : "DONE";
  return createPortal(
    <div className="notify-surface">
      <div
        className={`mail is-${notice.kind}${visible ? " is-in" : ""}${dragging ? " is-dragging" : ""}`}
        style={{ "--notice-offset": `${offset}px` } as CSSProperties}
        role="status"
        aria-live="polite"
        onPointerDownCapture={startSwipe}
        onPointerMoveCapture={moveSwipe}
        onPointerUpCapture={(event) => finishSwipe(event)}
        onPointerCancelCapture={(event) => finishSwipe(event, true)}
        onClickCapture={(event) => {
          if (moved.current && event.detail !== 0) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onClick={hide}
      >
        <div className="mail-strip-wrap">
          <div className="mail-back" />
          <div className="mail-strip">
            <div className="mail-mark">{mark}</div>
            <div className="mail-row">
              <div className="mail-kicker">
                <b>{notice.kind === "fail" ? "未成功" : mark}</b>
                <span>{pageLabel} →</span>
              </div>
              <ScrollText className="mail-title">{notice.title}</ScrollText>
              <span className="mail-time">
                <small>{`${pad2(notice.time.getMonth() + 1)}.${pad2(notice.time.getDate())}`}</small>
                <span>{`${pad2(notice.time.getHours())}:${pad2(notice.time.getMinutes())}`}</span>
              </span>
            </div>
            <div className="mail-reason"><ScrollText>{notice.reason}</ScrollText></div>
          </div>
        </div>
        <span className="mail-tape" />
      </div>
    </div>,
    // 预览是顶层弹窗，保存提示也放到这一层。
    document.querySelector(".pv-viewer[open]") ?? document.body,
  );
}
