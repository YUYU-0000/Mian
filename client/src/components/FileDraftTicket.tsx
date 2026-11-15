import type { FileDraft } from "../fileDrafts";
import { useTicketSwipe } from "../useTicketSwipe";
import FileTicket from "./FileTicket";

export default function FileDraftTicket({ draft, conversationId, onRemove }: {
  draft: FileDraft;
  conversationId: string;
  onRemove: () => void;
}) {
  const { motionRef, acceptClick, onPointerDown, ...gesture } = useTicketSwipe({ direction: "down", onExitComplete: onRemove });
  return (
    <div className="file-draft" {...gesture} onPointerDownCapture={onPointerDown} onClickCapture={event => {
      if (!acceptClick()) { event.preventDefault(); event.stopPropagation(); }
    }}>
      <div ref={motionRef}>
        <FileTicket file={draft.file} conversationId={conversationId} mine pending
          previewUrl={draft.previewUrl} progress={draft.uploaded ? undefined : draft.progress} />
      </div>
    </div>
  );
}
