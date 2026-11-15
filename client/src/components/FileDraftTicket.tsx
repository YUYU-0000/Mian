import type { FileDraft } from "../fileDrafts";
import { useTicketSwipe } from "../useTicketSwipe";
import FileTicket from "./FileTicket";

export default function FileDraftTicket({ draft, conversationId, onRemove, onExitStart }: {
  draft: FileDraft;
  conversationId: string;
  onRemove: () => void;
  onExitStart?: () => void;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState<DOMRect | null>(null);
  const remove = () => {
    const siblings = [...slot.current!.parentElement!.children].filter(item => item !== slot.current);
    const positions = siblings.map(item => item.getBoundingClientRect().left);
    flushSync(onRemove);
    siblings.forEach((item, index) => {
      const distance = positions[index] - item.getBoundingClientRect().left;
      item.animate([
        { transform: `translateX(${distance}px)` },
        { transform: "translateX(0)" },
      ], { duration: 200, easing: "ease-out" });
    });
  };
  const { motionRef, acceptClick, onPointerDown, ...gesture } = useTicketSwipe({
    direction: "down",
    onDragStart: () => setFloating(slot.current!.getBoundingClientRect()),
    onReboundComplete: () => setFloating(null),
    onExitStart: () => {
      slot.current!.dataset.exiting = "true";
      onExitStart?.();
    },
    onExitComplete: remove,
  });
  const ticket = <FileTicket file={draft.file} conversationId={conversationId} mine pending
    previewUrl={draft.previewUrl} progress={draft.uploaded ? undefined : draft.progress} />;
  return (
    <div className="file-draft" ref={slot} {...gesture} onPointerDownCapture={onPointerDown} onClickCapture={event => {
      if (!acceptClick()) { event.preventDefault(); event.stopPropagation(); }
    }}>
      <div ref={floating ? undefined : motionRef} style={floating ? { visibility: "hidden" } : undefined}>
        {ticket}
      </div>
      {floating && createPortal(
        <div className="file-draft-floating" style={{ left: floating.left, top: floating.top, width: floating.width, height: floating.height }}>
          <div ref={motionRef}>{ticket}</div>
        </div>, document.body,
      )}
    </div>
  );
}
import { useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
