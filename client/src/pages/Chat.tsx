import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ChatSessionStore, type ChatSessionSnapshot } from "../chatSession";
import type { ConversationRecord } from "../types";
import { emptyVisualReply } from "../visualPlayback";
import type {
  ConversationTransitionView,
  FrozenConversationFrame,
} from "../conversationTransition";
import ArchiveRibbonTitle from "../components/ArchiveRibbonTitle";
import TicketDrawer from "../components/TicketDrawer";
import ChatMessage, { collectHistoricalAnimationIds } from "./ChatMessage";

export default function Chat({
  session,
  onBack,
  conversations,
  activeConversationId,
  displayedConversation,
  onSelectConversation,
  onCreateConversation,
  onForkConversation,
  onUpdateConversation,
  canArchiveConversation,
  onArchiveConversation,
  onArchivedConversation,
  conversationTransition,
  onConversationSwitchEnd,
  onRegisterFrameCapture,
  initialDraft,
  initialScrollTop,
  onViewStateChange,
}: {
  session: ChatSessionStore;
  onBack: () => void;
  conversations: ConversationRecord[];
  activeConversationId: string;
  displayedConversation: ConversationRecord;
  onSelectConversation: (conversationId: string) => void;
  onCreateConversation: () => Promise<ConversationRecord>;
  onForkConversation: (
    conversationId: string,
  ) => Promise<ConversationRecord | null>;
  onUpdateConversation: (
    conversationId: string,
    patch: Partial<
      Pick<ConversationRecord, "title" | "frontName" | "image" | "pinned">
    >,
  ) => Promise<ConversationRecord>;
  canArchiveConversation: (conversationId: string) => boolean;
  onArchiveConversation: (conversationId: string) => Promise<void>;
  onArchivedConversation: (
    conversationId: string,
    adjacentConversationId: string,
  ) => void;
  conversationTransition: ConversationTransitionView | null;
  onConversationSwitchEnd: (generation: number) => void;
  onRegisterFrameCapture: (
    capture: (() => FrozenConversationFrame | null) | null,
  ) => void;
  initialDraft: string;
  initialScrollTop: number | null;
  onViewStateChange: (
    conversationId: string,
    patch: { draft?: string; scrollTop?: number },
  ) => void;
}) {
  const snapshot: ChatSessionSnapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const { messages, visualReplies, activeTurnId, turnPhase } = snapshot;
  const active = turnPhase !== "idle";
  const historicalAnimationIds = useMemo(
    () => collectHistoricalAnimationIds(session.getSnapshot().messages),
    [session],
  );
  const [expandedTools, setExpandedTools] = useState<Set<string>>(
    () => new Set(),
  );
  const toolExpansionFrames = useRef(new Map<string, number>());
  const [drafts, setDrafts] = useState<Record<string, string>>(() => ({
    [session.conversationId]: initialDraft,
  }));
  const text = drafts[session.conversationId] ?? initialDraft;
  const setText = (value: string) =>
    setDrafts((current) => ({
      ...current,
      [session.conversationId]: value,
    }));
  const [ticketDrawerOpen, setTicketDrawerOpen] = useState(false);
  const stream = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const inputArea = useRef<HTMLFormElement>(null);
  const outgoingStream = useRef<HTMLDivElement>(null);
  const scrollConversationId = useRef<string | null>(null);
  const shouldFollowBottom = useRef(true);
  const inputFocused = useRef(false);
  const requestViewportSync = useRef<(forceBottom?: boolean) => void>(() => {});
  const captureConversationFrame =
    useCallback((): FrozenConversationFrame | null => {
      const element = stream.current;
      if (!element) return null;
      return {
        conversationId: session.conversationId,
        html: element.innerHTML,
        scrollTop: element.scrollTop,
        inputTopY: element.style.getPropertyValue("--input-top-y"),
        inputAreaHeight: element.style.getPropertyValue("--input-area-height"),
      };
    }, [session.conversationId]);
  useLayoutEffect(() => {
    onRegisterFrameCapture(captureConversationFrame);
    return () => onRegisterFrameCapture(null);
  }, [captureConversationFrame, onRegisterFrameCapture]);
  useLayoutEffect(() => {
    const element = outgoingStream.current;
    const frame = conversationTransition?.outgoingFrame;
    if (!element || !frame) return;
    element.scrollTop = frame.scrollTop;
    if (frame.inputTopY)
      element.style.setProperty("--input-top-y", frame.inputTopY);
    if (frame.inputAreaHeight)
      element.style.setProperty("--input-area-height", frame.inputAreaHeight);
    element.inert = true;
  }, [conversationTransition]);
  useEffect(
    () => () => {
      for (const frame of toolExpansionFrames.current.values())
        cancelAnimationFrame(frame);
      toolExpansionFrames.current.clear();
    },
    [],
  );
  const toggleToolExpansion = useCallback(
    (key: string) => {
      const pending = toolExpansionFrames.current.get(key);
      if (pending !== undefined) {
        cancelAnimationFrame(pending);
        toolExpansionFrames.current.delete(key);
        return;
      }
      if (expandedTools.has(key)) {
        setExpandedTools((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        return;
      }
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setExpandedTools((current) => new Set(current).add(key));
        return;
      }
      const frame = requestAnimationFrame(() => {
        toolExpansionFrames.current.delete(key);
        setExpandedTools((current) => new Set(current).add(key));
      });
      toolExpansionFrames.current.set(key, frame);
    },
    [expandedTools],
  );
  useLayoutEffect(() => {
    const streamElement = stream.current,
      inputElement = inputArea.current;
    if (!streamElement || !inputElement) return;
    let frame = 0;
    let forcedFrames = 0;
    let stableFrames = 0;
    let lastGeometry = "";
    const updateNow = (forceBottom = false) => {
      const streamRect = streamElement.getBoundingClientRect();
      const inputRect = inputElement.getBoundingClientRect();
      const top = Math.max(
        53,
        Math.min(streamElement.clientHeight, inputRect.top - streamRect.top),
      );
      streamElement.style.setProperty("--input-top-y", `${top}px`);
      streamElement.style.setProperty(
        "--input-area-height",
        `${inputRect.height + 30}px`,
      );
      if (forceBottom || shouldFollowBottom.current)
        streamElement.scrollTop = streamElement.scrollHeight;
      const viewport = window.visualViewport;
      return [
        viewport?.height ?? window.innerHeight,
        viewport?.offsetTop ?? 0,
        inputRect.top,
        inputRect.height,
        streamElement.clientHeight,
      ].join(":");
    };
    const settleLayout = () => {
      const geometry = updateNow(forcedFrames > 0);
      if (forcedFrames > 0) forcedFrames -= 1;
      stableFrames = geometry === lastGeometry ? stableFrames + 1 : 0;
      lastGeometry = geometry;
      if (forcedFrames > 0 && stableFrames < 2) {
        frame = requestAnimationFrame(settleLayout);
      } else if (stableFrames >= 2) {
        forcedFrames = 0;
      }
    };
    const scheduleUpdate = (forceBottom = false) => {
      if (forceBottom) {
        forcedFrames = 12;
        stableFrames = 0;
        shouldFollowBottom.current = true;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(settleLayout);
    };
    requestViewportSync.current = scheduleUpdate;
    const observer = new ResizeObserver(() => scheduleUpdate());
    observer.observe(streamElement);
    observer.observe(inputElement);
    const observeMessages = () => {
      for (const message of streamElement.querySelectorAll(".archive-msg"))
        observer.observe(message);
    };
    observeMessages();
    const mutationObserver = new MutationObserver(() => {
      observeMessages();
      scheduleUpdate();
    });
    mutationObserver.observe(streamElement, { childList: true });
    const onWindowLayout = () => scheduleUpdate();
    let viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    let viewportOffsetTop = window.visualViewport?.offsetTop ?? 0;
    const onViewportLayout = () => {
      const nextHeight = window.visualViewport?.height ?? window.innerHeight;
      const nextOffsetTop = window.visualViewport?.offsetTop ?? 0;
      const geometryChanged =
        Math.abs(nextHeight - viewportHeight) > 0.5 ||
        Math.abs(nextOffsetTop - viewportOffsetTop) > 0.5;
      viewportHeight = nextHeight;
      viewportOffsetTop = nextOffsetTop;
      scheduleUpdate(inputFocused.current && geometryChanged);
    };
    window.addEventListener("resize", onWindowLayout);
    window.addEventListener("orientationchange", onWindowLayout);
    window.visualViewport?.addEventListener("resize", onViewportLayout);
    window.visualViewport?.addEventListener("scroll", onViewportLayout);
    updateNow();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutationObserver.disconnect();
      requestViewportSync.current = () => {};
      window.removeEventListener("resize", onWindowLayout);
      window.removeEventListener("orientationchange", onWindowLayout);
      window.visualViewport?.removeEventListener("resize", onViewportLayout);
      window.visualViewport?.removeEventListener("scroll", onViewportLayout);
    };
  }, []);
  useLayoutEffect(() => {
    const element = stream.current;
    if (!element) return;
    if (scrollConversationId.current !== session.conversationId) {
      if (initialScrollTop === null) element.scrollTop = element.scrollHeight;
      else
        element.scrollTop = Math.max(
          0,
          Math.min(
            initialScrollTop,
            element.scrollHeight - element.clientHeight,
          ),
        );
      scrollConversationId.current = session.conversationId;
      shouldFollowBottom.current =
        element.scrollHeight - element.scrollTop - element.clientHeight <= 50;
      return;
    }
  }, [initialScrollTop, session.conversationId]);
  useLayoutEffect(() => {
    let mounted = true;
    void document.fonts?.ready.then(() => {
      const element = stream.current;
      if (mounted && element && shouldFollowBottom.current)
        element.scrollTop = element.scrollHeight;
    });
    return () => {
      mounted = false;
    };
  }, []);
  useLayoutEffect(() => {
    const elements = [stream.current, inputArea.current];
    for (const element of elements)
      if (element) element.inert = ticketDrawerOpen;
    return () => {
      for (const element of elements) if (element) element.inert = false;
    };
  }, [ticketDrawerOpen]);

  const resize = () => {
    if (input.current) {
      input.current.style.height = "auto";
      input.current.style.height = `${Math.min(input.current.scrollHeight, 120)}px`;
    }
  };
  useLayoutEffect(() => {
    resize();
  }, [session.conversationId]);
  const saveRecord = (value: string) => {
    shouldFollowBottom.current = true;
    session.saveUserRecord(value);
    setText("");
    onViewStateChange(session.conversationId, { draft: "" });
    requestAnimationFrame(() => {
      resize();
      requestViewportSync.current(true);
    });
  };
  const act = () => {
    if (active) return session.stopCurrentTurn();
    const value = text.trim();
    if (value) {
      saveRecord(value);
      return;
    }
    return session.startPendingTurn();
  };
  return (
    <main
      className={`archive-chat ${ticketDrawerOpen ? "ticket-layer-open" : ""}`}
      data-active-conversation-id={activeConversationId}
      data-displayed-conversation-id={displayedConversation.conversationId}
    >
      <header className="archive-header">
        <div className="archive-ribbon">
          <svg viewBox="0 0 370 59" preserveAspectRatio="xMidYMid meet">
            <polygon points="0,25 40,25 40,59 0,59 12,42" />
            <polygon className="ribbon-dark" points="30,49 40,49 40,59" />
            <polygon points="370,25 330,25 330,59 370,59 358,42" />
            <polygon className="ribbon-dark" points="340,49 330,49 330,59" />
            <rect x="30" y="15" width="310" height="34" />
          </svg>
          <button
            className="ribbon-back-hit"
            onClick={onBack}
            aria-label="返回主界面"
          />
          <button
            className="ribbon-ticket-hit"
            type="button"
            aria-label={ticketDrawerOpen ? "关闭票根管理" : "打开票根管理"}
            aria-controls="ticketDrawer"
            aria-expanded={ticketDrawerOpen}
            onClick={() => setTicketDrawerOpen((open) => !open)}
          />
          <ArchiveRibbonTitle
            conversationId={displayedConversation.conversationId}
            title={displayedConversation.title}
          />
        </div>
      </header>
      <div className="archive-message-stage" aria-live="polite">
        {conversationTransition && (
          <div
            ref={outgoingStream}
            className={`archive-stream archive-message-layer archive-message-layer-outgoing transition-${conversationTransition.generation % 2 ? "a" : "b"}`}
            data-conversation-id={
              conversationTransition.outgoingFrame.conversationId
            }
            aria-hidden="true"
            dangerouslySetInnerHTML={{
              __html: conversationTransition.outgoingFrame.html,
            }}
          />
        )}
        <div
          ref={stream}
          className={`archive-stream archive-message-layer archive-message-layer-current ${
            conversationTransition
              ? `is-conversation-incoming transition-${conversationTransition.generation % 2 ? "a" : "b"}`
              : ""
          }`}
          data-conversation-id={displayedConversation.conversationId}
          data-conversation-switch-phase={
            conversationTransition ? "overlap" : "idle"
          }
          data-conversation-switch-generation={
            conversationTransition?.generation ?? 0
          }
          onAnimationEnd={(event) => {
            if (
              event.currentTarget === event.target &&
              conversationTransition &&
              event.animationName ===
                `chatConversationIncoming${conversationTransition.generation % 2 ? "A" : "B"}`
            )
              onConversationSwitchEnd(conversationTransition.generation);
          }}
          onScroll={(event) => {
            const element = event.currentTarget;
            const distance =
              element.scrollHeight - element.scrollTop - element.clientHeight;
            shouldFollowBottom.current = distance <= 50;
            onViewStateChange(session.conversationId, {
              scrollTop: element.scrollTop,
            });
          }}
        >
          {messages.map((message) => (
            <ChatMessage
              key={
                message.role === "user" ? message.groupId : message.replyGroupId
              }
              message={message}
              visual={
                message.role === "assistant"
                  ? (visualReplies[message.replyGroupId] ?? emptyVisualReply())
                  : null
              }
              activeTurnId={activeTurnId}
              historicalAnimationIds={historicalAnimationIds}
              expandedTools={expandedTools}
              onToggleTool={toggleToolExpansion}
              session={session}
            />
          ))}
        </div>
      </div>
      <form
        ref={inputArea}
        className="archive-input"
        onSubmit={(event) => {
          event.preventDefault();
          void act();
        }}
      >
        <button type="button" disabled aria-label="附件稍后开放">
          <svg viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <textarea
          ref={input}
          rows={1}
          value={text}
          onInput={resize}
          onFocus={() => {
            inputFocused.current = true;
            shouldFollowBottom.current = true;
            requestViewportSync.current(true);
          }}
          onBlur={() => {
            inputFocused.current = false;
            requestViewportSync.current();
          }}
          onChange={(event) => {
            const draft = event.target.value;
            setText(draft);
            onViewStateChange(session.conversationId, { draft });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void act();
            }
          }}
          placeholder="留存新的记录"
        />
        <button type="button" disabled aria-label="语音稍后开放">
          <svg viewBox="0 0 24 24">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
          </svg>
        </button>
        <button
          className={active ? "is-streaming" : ""}
          type="submit"
          aria-label={active ? "停止" : "发送"}
        >
          <span className="send-icon">
            <svg viewBox="0 0 24 24">
              <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </span>
          <span className="stop-icon">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="13" r="9" />
              <path d="M9 2h6M12 4V2M18.36 6.64l1.5-1.5" />
              <circle cx="12" cy="13" r="1.2" />
              <path d="M12 11.8V7" />
            </svg>
          </span>
        </button>
      </form>
      <TicketDrawer
        open={ticketDrawerOpen}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onOpenChange={setTicketDrawerOpen}
        onSelect={onSelectConversation}
        onCreate={onCreateConversation}
        onFork={onForkConversation}
        onUpdate={onUpdateConversation}
        canArchive={canArchiveConversation}
        onArchive={onArchiveConversation}
        onArchived={onArchivedConversation}
      />
    </main>
  );
}
