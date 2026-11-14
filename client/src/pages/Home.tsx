import { ChatGlyph, House, DockHouse, DockSliders } from "../components/HomeIcons";
import { pad2 } from "../format";
import { useEffect, useRef, useState } from "react";
import type { ConnectionStatus } from "../types";
const Icon = ({
  className = "",
  onClick,
}: {
  className?: string;
  onClick?: () => void;
}) => (
  <button
    className={`home-app-icon ${className}`}
    onClick={onClick}
    aria-hidden={!onClick}
  />
);
export default function Home({
  status,
  channelName,
  onChat,
  onConnections,
  onSettings,
}: {
  status: ConnectionStatus;
  channelName: string;
  onChat: () => void;
  onConnections: () => void;
  onSettings: () => void;
}) {
  const [now, setNow] = useState(new Date());
  const [page, setPage] = useState(0);
  const [sliding, setSliding] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);
  const onScroll = () => {
    const el = wrap.current;
    if (!el) return;
    setPage(Math.round(el.scrollLeft / el.clientWidth));
    setSliding(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSliding(false), 1000);
  };
  const connectionClass = status.state === "ready" ? "success" : "failed";
  return (
    <main className="home-screen">
      <div
        ref={wrap}
        className="home-pages"
        onScroll={onScroll}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") {
            drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft };
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            e.currentTarget.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <section className="home-page">
          <header className="home-top">
            <div className="home-date">
              {now.toLocaleDateString("en-US", {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </div>
            <div className="home-time">
              <span>{pad2(now.getHours())}</span>
              <span>{pad2(now.getMinutes())}</span>
            </div>
          </header>
          <div className="home-spacer" />
          <div className="home-grid">
            <button className="home-app-icon icon-1 bg-1" onClick={onChat}>
              <ChatGlyph />
            </button>
            <div className="home-label lbl-1">CHAT</div>
            <Icon className="icon-2 bg-2" />
            <div className="home-label lbl-2">APP</div>
            <Icon className="icon-3 bg-3" />
            <div className="home-label lbl-3">APP</div>
            <Icon className="icon-4 bg-4" />
            <div className="home-label lbl-4">APP</div>
            <div className="home-photo widget">
              <span>
                TAP TO
                <br />
                UPLOAD
              </span>
            </div>
            <div className="home-label widget-label">PHOTO</div>
          </div>
        </section>
        <section className="home-page">
          <div className="home-grid-2">
            <div className="home-photo wide">
              <span>
                TAP TO
                <br />
                UPLOAD
              </span>
            </div>
            <div className="home-label wide-label">PHOTO</div>
            <div className="home-photo square-left">
              <span>
                TAP TO
                <br />
                UPLOAD
              </span>
            </div>
            <div className="home-label square-left-label">PHOTO</div>
            {[1, 2, 3, 4].map((n) => (
              <div className={`p2-pair p2-a${n}`} key={`a${n}`}>
                <Icon className={n === 1 || n === 4 ? "bg-1" : "bg-2"} />
                <div className="home-label">APP</div>
              </div>
            ))}
            {[5, 6, 7, 8].map((n) => (
              <div className={`p2-pair p2-a${n}`} key={`a${n}`}>
                <Icon className={n === 5 ? "bg-3" : n === 8 ? "bg-2" : "bg-1"} />
                <div className="home-label">APP</div>
              </div>
            ))}
            <div className="home-photo square-right">
              <span>
                TAP TO
                <br />
                UPLOAD
              </span>
            </div>
            <div className="home-label square-right-label">PHOTO</div>
          </div>
        </section>
      </div>
      <div className={`home-capsule indicator-capsule ${sliding ? "sliding" : ""}`}>
        <div className={`home-code-status status-content ${connectionClass}`}>
          <House />
          <span className="capsule-text">{channelName}</span>
        </div>
        <div className="home-dots">
          <i />
          <i className={page === 0 ? "active" : ""} />
          <i className={page === 1 ? "active" : ""} />
        </div>
      </div>
      <footer className="home-dock">
        <button
          className="home-app-icon dock-1"
          aria-label="连接中心"
          onClick={onConnections}
        >
          <DockHouse />
        </button>
        <button className="home-app-icon dock-2" aria-label="设置" onClick={onSettings}>
          <DockSliders />
        </button>
        <Icon className="dock-3" />
        <Icon className="dock-4" />
      </footer>
    </main>
  );
}
