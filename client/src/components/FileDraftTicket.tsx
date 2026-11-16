// 连接待发送附件票根与上传状态、拖动及删除交互。
import { memo, useRef } from "react";
import type { FileDraft } from "../fileDrafts";
import { useTicketSwipe } from "../useTicketSwipe";
import FileTicket from "./FileTicket";

export default memo(function FileDraftTicket({ draft, conversationId, onRemove, onExitStart }: {
  draft: FileDraft;
  conversationId: string;
  onRemove: (draftId: string) => void;
  onExitStart?: () => void;
}) {
  const slot = useRef<HTMLDivElement>(null);
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
    onExitComplete: () => onRemove(draft.draftId),
  });
  return (
    <div className="file-draft" data-id={draft.draftId} ref={slot} {...gesture} onPointerDownCapture={onPointerDown} onClickCapture={event => {
      if (!acceptClick()) { event.preventDefault(); event.stopPropagation(); }
    }}>
      <div ref={motionRef}>
        <FileTicket file={draft.file} conversationId={conversationId} mine pending
          previewUrl={draft.previewUrl} progress={draft.progress} uploadComplete={draft.uploaded} />
      </div>
    </div>
  );
});
