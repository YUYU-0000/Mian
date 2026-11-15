import type { ConversationRecord } from "../types";
import ScrollText from "./ScrollText";
import { useTicketSwipe } from "../useTicketSwipe";

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
  const { motionRef, acceptClick, ...gesture } = useTicketSwipe({
    direction: "left",
    canDismiss: canArchive,
    beforeDismiss: onArchive,
    onExitComplete,
  });

  return (
    <div
      className={`mini-ticket-container ${active ? "active" : ""} ${entering ? "entering" : ""}`}
      data-id={conversation.conversationId}
      {...gesture}
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