import { pad2 } from "../format";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ScrollText from "./ScrollText";
import "./notify.css";

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
  ok: (title: string) => show("ok", title),
  note: (title: string) => show("note", title),
  fail: (title: string, err?: unknown) => show("fail", title, reasonOf(err)),
};

export default function Notify({ page }: { page: string }) {
  const pageLabel = page === "/connections" ? "連接設置"
    : page === "/settings" ? "檔案館"
    : page === "/chat" ? "對話" : "主界面";
  const [notice, setNotice] = useState<Notice>({
    kind: "ok",
    title: "",
    reason: "",
    time: new Date(),
  });
  const [visible, setVisible] = useState(false);
  const shown = useRef(false);
  const timer = useRef(0);
  const busy = useRef(0);
  const frame = useRef(0);
  const hide = () => {
    window.clearTimeout(timer.current);
    window.clearTimeout(busy.current);
    cancelAnimationFrame(frame.current);
    shown.current = false;
    setVisible(false);
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
          timer.current = window.setTimeout(
            hide,
            next.kind === "fail" ? 5000 : next.kind === "note" ? 2200 : 1800,
          );
        },
        replace ? 280 : 0,
      );
    };
    events.addEventListener("notice", receive);
    return () => {
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
        className={`mail is-${notice.kind}${visible ? " is-in" : ""}`}
        role="status"
        aria-live="polite"
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
