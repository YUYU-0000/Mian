// 组织聊天票根抽屉、分支会话操作和纸片切换。
import DevelopingMedia from "./DevelopingMedia";
import MiniTicket from "./MiniTicket";
import { useTicketLayout } from "../useTicketLayout";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import type { ConversationRecord } from "../types";
import ScrollText, { ScrollInput } from "./ScrollText";
import { useHiddenLayer } from "./useHiddenLayer";
import {
  displayConversationValue,
  formatLastActivity,
  formatLastMessage,
  formatTokenUsage,
} from "../conversationDisplay";
import { adjacentConversationId } from "../ticketGestures";
import { blobToDataURL, compressImage } from "../imageCompression";

type ConversationPatch = Partial<
  Pick<ConversationRecord, "title" | "frontName" | "image" | "pinned">
>;

type Props = {
  open: boolean;
  conversations: ConversationRecord[];
  activeConversationId: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (conversationId: string) => void;
  onCreate: () => Promise<ConversationRecord>;
  onFork: (conversationId: string) => Promise<ConversationRecord | null>;
  onUpdate: (
    conversationId: string,
    patch: ConversationPatch,
  ) => Promise<ConversationRecord>;
  canArchive: (conversationId: string) => boolean;
  onArchive: (conversationId: string) => Promise<void>;
  onArchived: (conversationId: string, adjacentConversationId: string) => void;
};

function ticketNumber(conversation: ConversationRecord) {
  return `NO. ${conversation.abbr.replace(/^C-/, "")}`;
}

export default memo(function TicketDrawer({
  open,
  conversations,
  activeConversationId,
  onOpenChange,
  onSelect,
  onCreate,
  onFork,
  onUpdate,
  canArchive,
  onArchive,
  onArchived,
}: Props) {
  const layer = useHiddenLayer<HTMLElement>(open, "visibility");
  const [previewId, setPreviewId] = useState(activeConversationId);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const pinFrame = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const stripArea = useRef<HTMLDivElement>(null);
  const layoutFinished = useTicketLayout(stripArea, conversations.map(item => item.conversationId).join("|"), open);
  const pendingImageId = useRef<string | null>(null);
  const pendingSelectionId = useRef<string | null>(null);
  const flipRemoval = useRef<{
    adjacentId: string;
    switchAfter: boolean;
  } | null>(null);
  const archiveInFlight = useRef<string | null>(null);
  const preview =
    conversations.find((item) => item.conversationId === previewId) ??
    conversations.find(
      (item) => item.conversationId === activeConversationId,
    ) ??
    conversations[0];

  useEffect(() => {
    if (!conversations.some((item) => item.conversationId === previewId))
      setPreviewId(
        conversations.find(
          (item) => item.conversationId === activeConversationId,
        )?.conversationId ??
        conversations[0]?.conversationId ??
        "",
      );
  }, [activeConversationId, conversations, previewId]);

  useLayoutEffect(() => {
    const removal = flipRemoval.current;
    if (!removal) return;
    flipRemoval.current = null;
    const finish = () => {
      archiveInFlight.current = null;
      if (removal.switchAfter) onSelect(removal.adjacentId);
    };
    void layoutFinished().then(finish);
  }, [conversations, onSelect]);

  useEffect(() => {
    if (!open) return;
    setPreviewId(activeConversationId);
    setFlipped(false);
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [activeConversationId, onOpenChange, open]);
  useEffect(() => {
    if (
      !open &&
      pendingSelectionId.current &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      const conversationId = pendingSelectionId.current;
      pendingSelectionId.current = null;
      onSelect(conversationId);
    }
  }, [onSelect, open]);
  useEffect(
    () => () => {
      if (pinFrame.current !== null) cancelAnimationFrame(pinFrame.current);
    },
    [],
  );

  const run = async (operation: () => Promise<ConversationRecord | null>) => {
    if (busy) return;
    setBusy(true);
    try {
      const conversation = await operation();
      if (!conversation) return;
      setPreviewId(conversation.conversationId);
      setFlipped(false);
    } catch (error) {
      console.error(error);
    } finally {
      setBusy(false);
    }
  };

  const finishArchive = (conversationId: string) => {
    const adjacentId = adjacentConversationId(
      conversations.map((item) => item.conversationId),
      conversationId,
    );
    if (!adjacentId) return;
    flipRemoval.current = {
      adjacentId,
      switchAfter: activeConversationId === conversationId,
    };
    if (previewId === conversationId) {
      setPreviewId(adjacentId);
      setFlipped(false);
    }
    onArchived(conversationId, adjacentId);
  };

  const importImage = (conversationId: string) => {
    pendingImageId.current = conversationId;
    if (fileInput.current) fileInput.current.value = "";
    fileInput.current?.click();
  };

  const onImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const conversationId = pendingImageId.current;
    pendingImageId.current = null;
    if (!file || !conversationId || !file.type.startsWith("image/")) return;
    try {
      const image = await blobToDataURL(await compressImage(file, 1200));
      await onUpdate(conversationId, { image });
    } catch (error) {
      console.error(error);
    }
  };

  const pinPreview = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      await onUpdate(preview.conversationId, { pinned: true });
      if (!stripArea.current) return;
      if (pinFrame.current !== null) cancelAnimationFrame(pinFrame.current);
      pinFrame.current = requestAnimationFrame(() => {
        pinFrame.current = null;
        stripArea.current?.scrollTo({ top: 0, behavior: "smooth" });
      });
    } catch (error) {
      console.error(error);
    } finally {
      setBusy(false);
    }
  };

  const flipWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setFlipped(true);
  };

  const handlers = useRef({ finishArchive, importImage, canArchive, onArchive, busy });
  handlers.current = { finishArchive, importImage, canArchive, onArchive, busy };
  // 列表子项只接收稳定回调，增删和上传进度不会让整排票根重新渲染。
  const ticketActions = useMemo(() => ({
    onActivate: (id: string) => { setPreviewId(id); setFlipped(false); },
    onImage: (id: string) => handlers.current.importImage(id),
    canArchive: (id: string) => archiveInFlight.current === null && !handlers.current.busy && handlers.current.canArchive(id),
    onArchive: async (id: string) => {
      archiveInFlight.current = id;
      try { await handlers.current.onArchive(id); }
      catch (error) { archiveInFlight.current = null; throw error; }
    },
    onExitComplete: (id: string) => handlers.current.finishArchive(id),
  }), []);

  const image = preview?.image ?? "";
  return (
    <section
      {...layer}
      id="ticketDrawer"
      className={`ticket-drawer ${open ? "is-open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="票根管理"
      aria-hidden={!open}
    >
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={onImageChange}
      />
      <div
        className="ticket-drawer-stage"
        onPointerDown={(event) => {
          if (event.currentTarget === event.target) onOpenChange(false);
        }}
      >
        <div
          className="ticket-workspace"
          onTransitionEnd={(event) => {
            if (
              event.currentTarget !== event.target ||
              event.propertyName !== "opacity" ||
              open ||
              !pendingSelectionId.current
            )
              return;
            const conversationId = pendingSelectionId.current;
            pendingSelectionId.current = null;
            onSelect(conversationId);
          }}
        >
          <div className="strip-col">
            <button
              className="strip-toggle"
              type="button"
              aria-label="新建真实对话"
              disabled={busy}
              onClick={() => void run(onCreate)}
            />
            <div ref={stripArea} className="ticket-strip-area">
              {conversations.map((conversation) => (
                <MiniTicket
                  key={conversation.conversationId}
                  conversation={conversation}
                  active={
                    conversation.conversationId === preview?.conversationId
                  }
                  {...ticketActions}
                />
              ))}
            </div>
          </div>
          <div className="ticket-builder-area" data-keyboard-surface>
            <div className={`ticket-flipper ${flipped ? "flipped" : ""}`}>
              <div
                className="ticket-face front"
                role="button"
                tabIndex={0}
                aria-label="翻到票根背面"
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest(".front-text"))
                    return;
                  setFlipped(true);
                }}
                onKeyDown={flipWithKeyboard}
              >
                <div className="ticket-part char-part upper main-upper">
                  {image && (
                    <DevelopingMedia className="ticket-bg-img" src={image} />
                  )}
                  <div className="part-overlay front-overlay" />
                </div>
                <div className="ticket-part char-part lower main-lower">
                  {image && (
                    <DevelopingMedia className="ticket-bg-img" src={image} />
                  )}
                  <div className="part-overlay front-overlay" />
                </div>
                {preview && (
                  <ScrollText
                    className="front-text"
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    onBlur={(event) => {
                      const frontName = event.currentTarget.textContent?.trim();
                      if (frontName && frontName !== preview.frontName)
                        void onUpdate(preview.conversationId, {
                          frontName,
                        }).catch(console.error);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                  >
                    {preview.frontName}
                  </ScrollText>
                )}
              </div>

              <div
                className="ticket-face back"
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest(".back-grid"))
                    return;
                  setFlipped(false);
                }}
              >
                <div className="ticket-part char-part upper main-upper">
                  {image && (
                    <DevelopingMedia className="ticket-bg-img" src={image} />
                  )}
                  <div className="part-overlay back-overlay" />
                </div>
                <div className="ticket-part char-part lower main-lower">
                  {image && (
                    <DevelopingMedia className="ticket-bg-img" src={image} />
                  )}
                  <div className="part-overlay back-overlay" />
                </div>
                {preview && (
                  <div className="back-content-layer">
                    <div className="back-header">
                      <span>CONVERSATION LOG</span>
                      <span>{ticketNumber(preview)}</span>
                    </div>
                    <div className="back-grid">
                      <label className="bg-row row-title">
                        <span className="box-label">Nickname</span>
                        <ScrollInput
                          key={`${preview.conversationId}:title`}
                          type="text"
                          className="back-input cursive-input"
                          defaultValue={preview.title}
                          onBlur={(event) => {
                            const title = event.currentTarget.value.trim();
                            if (title && title !== preview.title)
                              void onUpdate(preview.conversationId, {
                                title,
                              }).catch(console.error);
                          }}
                        />
                      </label>
                      <div className="bg-row row-info">
                        <div className="info-line">
                          <span className="box-label">Model :</span>
                          <ScrollText className="back-input">
                            {displayConversationValue(preview.model)}
                          </ScrollText>
                        </div>
                        <div className="info-line">
                          <span className="box-label">Effort :</span>
                          <ScrollText className="back-input">
                            {displayConversationValue(preview.reasoningEffort)}
                          </ScrollText>
                        </div>
                        <div className="info-line">
                          <span className="box-label">Token Used :</span>
                          <ScrollText className="back-input">
                            {formatTokenUsage(preview.uncachedTotalTokens)}
                          </ScrollText>
                        </div>
                      </div>
                      <div className="bg-row row-rating">
                        <span className="box-label">Seen</span>
                        <ScrollText className="back-input tone-input">
                          {formatLastActivity(preview.lastActivityAt)}
                        </ScrollText>
                      </div>
                      <div className="bg-row row-review">
                        <span className="box-label">Last MSG</span>
                        <ScrollText className="back-textarea">
                          {formatLastMessage(preview.lastMessage)}
                        </ScrollText>
                      </div>
                      <div className="bg-row row-datetime">
                        <div className="info-line">
                          <span className="box-label">Mode :</span>
                          <ScrollText className="back-input">
                            {displayConversationValue(
                              preview.collaborationMode,
                            )}
                          </ScrollText>
                        </div>
                        <div className="info-line">
                          <span className="box-label">Mem :</span>
                          <span className="back-input">NONE</span>
                        </div>
                      </div>
                      <div className="row-seat">
                        <button
                          className="seat-col"
                          type="button"
                          disabled={busy}
                          onClick={() => void pinPreview()}
                        >
                          <span className="box-label">Pin</span>
                          <span className="seat-val">置顶</span>
                        </button>
                        <button
                          className="seat-col border-left"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() => onFork(preview.conversationId))
                          }
                        >
                          <span className="box-label">Branch</span>
                          <span className="seat-val">分支</span>
                        </button>
                        <button
                          className="seat-col border-left"
                          type="button"
                          onClick={() => {
                            pendingSelectionId.current = preview.conversationId;
                            onOpenChange(false);
                          }}
                        >
                          <span className="box-label">Select</span>
                          <span className="seat-val">选择</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});
