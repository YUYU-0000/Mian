import {
  Fragment,
  memo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import {
  readableToolResult,
  visibleToolSummary,
  type ChatGroup,
} from "../chatModel";
import { ChatSessionStore, isToolTimelineVisible } from "../chatSession";
import type { Approval, ToolEvent } from "../types";
import {
  cursorMatches,
  emptyVisualReply,
  type VisualReply,
} from "../visualPlayback";
import { shouldShowThinkingHourglass } from "../thinkingStatus";
import ToolOutput from "../components/ToolOutput";
import ReplyMarkdown from "../components/DeferredReplyMarkdown";
import FileTicket from "../components/FileTicket";

const Hourglass = () => (
  <svg
    className="status-icon hourglass"
    viewBox="0 0 24 24"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="5" y1="3" x2="19" y2="3" />
    <line x1="5" y1="21" x2="19" y2="21" />
    <path d="M7 3v5l5 4 5-4V3M7 21v-5l5-4 5 4v5" />
  </svg>
);
const StateIcon = ({ state }: { state: ToolEvent["state"] }) =>
  state === "running" ? (
    <Hourglass />
  ) : (
    <svg
      className={`status-icon status-${state}`}
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {state === "success" ? (
        <>
          <path d="m9 11 3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </>
      ) : state === "failed" ? (
        <>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </>
      ) : (
        <>
          <circle cx="8.66" cy="14.92" r="4.86" />
          <path d="m20.78 2.8-8.83 8.83M19.12 9.42l2.76-2.76" />
        </>
      )}
    </svg>
  );

function ModuleHeader({
  title,
  running,
  expanded,
  onToggle,
}: {
  title: "THINKING" | "TOOL CALLS";
  running: boolean;
  expanded: boolean;
  onToggle: (event: SyntheticEvent) => void;
}) {
  return (
    <summary
      className="archive-module-header"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className="archive-toggle-slot" aria-hidden="true">
        <svg className="archive-toggle-arrow" viewBox="0 0 24 24">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </span>
      <span className="archive-module-title">{title}</span>
      <span className="archive-header-status">
        {running ? <Hourglass /> : null}
      </span>
    </summary>
  );
}

function useDisclosureMotion(duration: number) {
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const target = useRef(false);
  const frame = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const toggle = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const next = !target.current;
    target.current = next;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (timer.current !== null) window.clearTimeout(timer.current);
    frame.current = null;
    timer.current = null;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setExpanded(next);
      setMounted(next);
      return;
    }
    if (next) {
      setMounted(true);
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (target.current) setExpanded(true);
      });
      return;
    }
    setExpanded(false);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (!target.current) setMounted(false);
    }, duration);
  };
  return { mounted, expanded, toggle };
}

function ArchiveModule({
  title,
  running,
  className = "",
  timelineKind,
  children,
}: {
  title: "THINKING" | "TOOL CALLS";
  running: boolean;
  className?: string;
  timelineKind?: string;
  children: ReactNode;
}) {
  const disclosure = useDisclosureMotion(280);
  return (
    <details
      open={disclosure.mounted}
      className={`archive-module ${className} ${disclosure.expanded ? "is-expanded" : ""}`}
      data-timeline-kind={timelineKind}
    >
      <ModuleHeader
        title={title}
        running={running}
        expanded={disclosure.expanded}
        onToggle={disclosure.toggle}
      />
      <div className="collapsible-content-wrap">
        <div className="collapsible-content">{children}</div>
      </div>
    </details>
  );
}

export function ToolRow({
  tool,
  open,
  animate,
  displayedResult,
  streamingResult,
  onToggle,
}: {
  tool: ToolEvent;
  open: boolean;
  animate: boolean;
  displayedResult: string;
  streamingResult: boolean;
  onToggle: () => void;
}) {
  const result = readableToolResult(tool);
  const toggle = (event: SyntheticEvent) => {
    event.stopPropagation();
    onToggle();
  };
  return (
    <div
      className={`archive-tool-step tool-step ${open ? "open is-expanded" : ""} ${animate ? "archive-pop-in" : ""}`}
      data-tool-id={tool.id}
    >
      <div
        className="step-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          toggle(event);
        }}
      >
        <StateIcon state={tool.state} />
        <span className="archive-step-summary step-summary">
          {visibleToolSummary(tool)}
        </span>
      </div>
      {(result || tool.command) && (
        <div className="step-body-wrap">
          <div className="archive-step-body step-body">
            <ToolOutput
              command={tool.command}
              result={displayedResult}
              streaming={streamingResult}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const userAnimationId = (messageId: string) => `user:${messageId}`;
const replyHeaderAnimationId = (replyGroupId: string) =>
  `reply-head:${replyGroupId}`;
const preToolAnimationId = (bubbleId: string) => `pre-tool:${bubbleId}`;
const bubbleAnimationId = (bubbleId: string) => `bubble:${bubbleId}`;
const toolAnimationId = (replyGroupId: string, toolId: string) =>
  `tool:${replyGroupId}:${toolId}`;

export function collectHistoricalAnimationIds(
  groups: ChatGroup[],
): Set<string> {
  const ids = new Set<string>();
  for (const group of groups) {
    if (group.role === "user") {
      for (const record of group.records)
        ids.add(userAnimationId(record.messageId));
      continue;
    }
    ids.add(replyHeaderAnimationId(group.replyGroupId));
    for (const id of group.preToolBubbleIds) ids.add(preToolAnimationId(id));
    for (const id of group.bubbleIds) ids.add(bubbleAnimationId(id));
    for (const tool of group.tools)
      ids.add(toolAnimationId(group.replyGroupId, tool.id));
  }
  return ids;
}

function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: Approval;
  onDecide: (allow: boolean) => Promise<void>;
}) {
  return (
    <div className="archive-approval">
      <b>{approval.title}</b>
      <pre>{approval.detail}</pre>
      <div>
        <button onClick={() => void onDecide(true)}>[ 允许 ]</button>
        <button onClick={() => void onDecide(false)}>[ 拒绝 ]</button>
      </div>
    </div>
  );
}

// 历史消息保持原节点，只有当前回复跟随播放更新。
export default memo(function ChatMessage({
  message,
  visual,
  activeTurnId,
  historicalAnimationIds,
  expandedTools,
  onToggleTool,
  session,
}: {
  message: ChatGroup;
  visual: VisualReply | null;
  activeTurnId: string | null;
  historicalAnimationIds: Set<string>;
  expandedTools: Set<string>;
  onToggleTool: (key: string) => void;
  session: ChatSessionStore;
}) {
  const preToolReady =
    message.role === "assistant" &&
    isToolTimelineVisible(message, visual ?? emptyVisualReply());
  const displayedTools =
    message.role === "assistant"
      ? message.tools
          .filter((tool) => visual!.visibleToolIds.includes(tool.id))
          .map((tool) => visual!.toolStates[tool.id] ?? tool)
      : [];
  return (
    <article
      key={message.role === "user" ? message.groupId : message.replyGroupId}
      className="archive-msg"
      data-role={message.role}
    >
      {message.role === "user" ? (
        <>
          <div className="archive-msg-head">
            <div className="archive-avatar user">
              <time>{message.time}</time>
            </div>
          </div>
          <div className="archive-msg-content">
            {message.records.map((record) => (
              <Fragment key={record.messageId}>
                {record.files?.map((file) => (
                  <FileTicket
                    key={file.id}
                    file={file}
                    conversationId={session.conversationId}
                    mine
                  />
                ))}
                {record.text && (
                  <div
                    className={`archive-bubble ${historicalAnimationIds.has(userAnimationId(record.messageId)) ? "" : "archive-pop-in"}`}
                  >
                    {record.text}
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        </>
      ) : (
        <>
          <div
            className={`archive-reply-head ${historicalAnimationIds.has(replyHeaderAnimationId(message.replyGroupId)) ? "" : "archive-pop-in"}`}
            data-timeline-kind="THINKING"
          >
            <div className="archive-msg-head">
              <div className="archive-avatar assistant">
                <time>{message.time}</time>
              </div>
            </div>
            <div className="archive-msg-content archive-reply-head-content">
              {(!message.format || message.thinking) && (
                <ArchiveModule
                  title="THINKING"
                  running={shouldShowThinkingHourglass(
                    message,
                    visual ?? emptyVisualReply(),
                    activeTurnId,
                  )}
                >
                  <div className="archive-thought">
                    {visual?.thinking}
                    {cursorMatches(visual?.cursor ?? null, {
                      kind: "thinking",
                    }) && <span className="cursor-blink" />}
                  </div>
                </ArchiveModule>
              )}
            </div>
          </div>
          <div className="archive-msg-content archive-reply-body">
            {message.preToolBubbles
              .slice(0, visual?.visiblePreToolBubbleCount ?? 0)
              .map((_bubble, index) => (
                <div
                  key={message.preToolBubbleIds[index]}
                  className={`archive-bubble ${historicalAnimationIds.has(preToolAnimationId(message.preToolBubbleIds[index])) ? "" : "archive-pop-in"}`}
                  data-timeline-kind="ASSISTANT_BUBBLE"
                >
                  <ReplyMarkdown
                    text={visual?.preToolBubbles[index] ?? ""}
                    typing={cursorMatches(visual?.cursor ?? null, {
                      kind: "preToolBubble",
                      index,
                    })}
                  />
                </div>
              ))}
            {message.tools.length > 0 && preToolReady && (
              <ArchiveModule
                className="tool-calls-module"
                timelineKind="TOOL_CALLS"
                title="TOOL CALLS"
                running={displayedTools.some(
                  (tool) => tool.state === "running",
                )}
              >
                <div className="archive-tool-path tool-path-block">
                  {displayedTools.map((tool) => (
                    <ToolRow
                      key={tool.id}
                      tool={tool}
                      animate={
                        !historicalAnimationIds.has(
                          toolAnimationId(message.replyGroupId, tool.id),
                        )
                      }
                      open={expandedTools.has(
                        `${message.replyGroupId}:${tool.id}`,
                      )}
                      displayedResult={visual?.tools[tool.id] ?? ""}
                      streamingResult={cursorMatches(visual?.cursor ?? null, {
                        kind: "tool",
                        toolId: tool.id,
                      })}
                      onToggle={() => {
                        const key = `${message.replyGroupId}:${tool.id}`;
                        onToggleTool(key);
                      }}
                    />
                  ))}
                </div>
              </ArchiveModule>
            )}
            {message.bubbles
              .slice(0, visual?.visibleBubbleCount ?? 0)
              .map((_bubble, index) => (
                <div
                  key={message.bubbleIds[index]}
                  className={`archive-bubble ${message.status === "interrupted" ? "stopped" : ""} ${historicalAnimationIds.has(bubbleAnimationId(message.bubbleIds[index])) ? "" : "archive-pop-in"}`}
                  data-timeline-kind="ASSISTANT_BUBBLE"
                >
                  <ReplyMarkdown
                    text={visual?.bubbles[index] ?? ""}
                    typing={cursorMatches(visual?.cursor ?? null, {
                      kind: "bubble",
                      index,
                    })}
                  />
                </div>
              ))}
            {message.status &&
              activeTurnId !== message.replyGroupId &&
              message.files?.map((file) => (
                <FileTicket
                  key={file.id}
                  file={file}
                  conversationId={session.conversationId}
                />
              ))}
            {message.approvals.map((approval) => (
              <ApprovalCard
                key={approval.requestId}
                approval={approval}
                onDecide={(allow) =>
                  session.decideApproval(
                    message.replyGroupId,
                    approval.requestId,
                    allow,
                  )
                }
              />
            ))}
          </div>
        </>
      )}
    </article>
  );
});
