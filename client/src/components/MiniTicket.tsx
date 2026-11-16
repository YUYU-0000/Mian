// 显示抽屉中的单张票根，复用图片显影与票根删除手势。
import DevelopingMedia from "./DevelopingMedia";
import { memo } from "react";
import type { ConversationRecord } from "../types";
import ScrollText from "./ScrollText";
import { useTicketSwipe } from "../useTicketSwipe";

export default memo(function MiniTicket({
  conversation,
  active,
  onActivate,
  onImage,
  canArchive,
  onArchive,
  onExitComplete,
}: {
  conversation: ConversationRecord;
  active: boolean;
  onActivate: (id: string) => void;
  onImage: (id: string) => void;
  canArchive: (id: string) => boolean;
  onArchive: (id: string) => Promise<void>;
  onExitComplete: (id: string) => void;
}) {
  const fontSize = Math.max(
    9,
    15 - Math.max(0, conversation.abbr.length - 4) * 0.9,
  );
  const { motionRef, acceptClick, ...gesture } = useTicketSwipe({
    direction: "left",
    canDismiss: () => canArchive(conversation.conversationId),
    beforeDismiss: () => onArchive(conversation.conversationId),
    onExitComplete: () => onExitComplete(conversation.conversationId),
  });

  return (
    <div
      className={`mini-ticket-container ${active ? "active" : ""}`}
      data-id={conversation.conversationId}
      {...gesture}
    >
      <div ref={motionRef} className="mini-ticket-motion">
        <div className="mini-ticket-visual">
          <div className="ticket-part char-part upper mini-upper">
            <button
              type="button"
              className="mini-box"
              aria-label={`为 ${conversation.abbr} 导入图片`}
              onClick={(event) => {
                if (!acceptClick()) {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                event.stopPropagation();
                onActivate(conversation.conversationId);
                onImage(conversation.conversationId);
              }}
            >
              {conversation.image && <DevelopingMedia src={conversation.image} className="mini-photo" />}
            </button>
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
              onActivate(conversation.conversationId);
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
});
