import { useRef } from "react";
import { flushSync } from "react-dom";
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
    onDragStart: () => {
      const rect = slot.current!.getBoundingClientRect();
      slot.current!.style.height = `${rect.height}px`;
      Object.assign(motionRef.current!.style, {
        left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`,
      });
      motionRef.current!.classList.add("file-draft-floating");
    },
    onReboundComplete: () => {
      motionRef.current!.classList.remove("file-draft-floating");
      for (const property of ["left", "top", "width", "height"])
        motionRef.current!.style.removeProperty(property);
      slot.current!.style.removeProperty("height");
    },
    onExitStart: () => {
      slot.current!.dataset.exiting = "true";
      onExitStart?.();
    },
    onExitComplete: remove,
  });
  return (
    <div className="file-draft" ref={slot} {...gesture} onPointerDownCapture={onPointerDown} onClickCapture={event => {
      if (!acceptClick()) { event.preventDefault(); event.stopPropagation(); }
    }}>
      <div ref={motionRef}>
        <FileTicket file={draft.file} conversationId={conversationId} mine pending
          previewUrl={draft.previewUrl} progress={draft.progress} uploadComplete={draft.uploaded} />
      </div>
    </div>
  );
}
