// 挂载票根列表，验证真实手势和增删补位共用的布局动画。
import { useRef, useState } from "react";
import { useTicketLayout } from "../client/src/useTicketLayout";
import { createRoot } from "react-dom/client";
import FileDraftTicket from "../client/src/components/FileDraftTicket";
import MiniTicket from "../client/src/components/MiniTicket";
import type { ConversationRecord } from "../client/src/types";
import "../client/src/components/file-ticket.css";
import "../client/src/components/scroll-text.css";
import "../client/src/ticket-drawer.css";

const result = { removed: 0, archived: 0, exited: 0, activated: 0, exitOpacity: 1, exitWillChange: "", miniExitWillChange: "" };
Object.assign(window, { result });
function Fixture() {
  const [ids, setIds] = useState([0, 1, 2, 3]);
  const [mini, setMini] = useState(true);
  const drafts = useRef<HTMLDivElement>(null);
  useTicketLayout(drafts, ids.join("|"));
  return <>
    <div className="ticket-drawer is-open" style={{ position: "absolute", left: 90, top: 40, width: 100, height: 200, opacity: 1, transform: "none" }}>
      {mini && <MiniTicket conversation={{ conversationId: "a", abbr: "C-01", title: "test", image: "" } as ConversationRecord}
        active={false} onActivate={() => { result.activated++; }} onImage={() => { result.activated++; }}
        canArchive={() => true} onArchive={async () => { result.archived++; }}
        onExitComplete={() => {
          result.miniExitWillChange = document.querySelector<HTMLElement>('.mini-ticket-motion')!.style.willChange;
          result.exited++; setMini(false);
        }} />}
    </div>
    <div className="archive-input" style={{ position: "absolute", top: 500, bottom: "auto", height: 40 }}>
      <div className="file-drafts" ref={drafts}>{ids.map(id => <FileDraftTicket key={id} conversationId="a"
        draft={{ draftId: String(id), file: { id: String(id), name: id === 1 ? "note.txt" : `image-${id}.png`, size: 1, mimeType: id === 1 ? "text/plain" : "image/png", createdAt: "2026-11-16" }, progress: 100, uploaded: true,
          previewUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" }}
        onRemove={() => {
          const motion = document.querySelector<HTMLElement>('.file-draft-floating')!;
          result.exitOpacity = Number(getComputedStyle(motion).opacity);
          result.exitWillChange = motion.style.willChange;
          result.removed++;
          setIds(values => values.filter(value => value !== id));
        }} />)}</div>
      <textarea />
    </div>
  </>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
