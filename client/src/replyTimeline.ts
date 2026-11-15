import type { ChatGroup } from "../../shared/chatModel.mjs";
import { readableToolResult } from "./toolPresentation";
import type { VisualReply, VisualTarget } from "./visualPlayback";

export function visualTarget(
  message: Extract<ChatGroup, { role: "assistant" }>,
): VisualTarget {
  const toolTimelineReady =
    message.tools.length === 0 || hasCompletedPreToolBubble(message);
  const readyBubbles = (bubbles: string[], ids: string[]) => {
    if (message.status) return bubbles;
    const pendingFile = ids.findIndex(id => message.fileBubbleIds?.includes(id) && !message.files?.some(file => file.replyBubbleId === id));
    return pendingFile < 0 ? bubbles : bubbles.slice(0, pendingFile);
  };
  return {
    thinking: message.thinking,
    preToolBubbles: readyBubbles(message.preToolBubbles, message.preToolBubbleIds),
    tools: toolTimelineReady
      ? message.tools.map((tool) => ({
          id: tool.id,
          text: tool.state === "running" ? "" : readableToolResult(tool),
          tool,
        }))
      : [],
    bubbles: toolTimelineReady ? readyBubbles(message.bubbles, message.bubbleIds) : [],
    done: Boolean(message.status),
  };
}

function hasCompletedPreToolBubble(
  message: Extract<ChatGroup, { role: "assistant" }>,
) {
  return message.preToolBubbles.length > 0 && message.preToolComplete;
}

export function isToolTimelineVisible(
  message: Extract<ChatGroup, { role: "assistant" }>,
  visual: VisualReply,
) {
  return message.tools.length > 0 && visual.visibleToolIds.length > 0;
}
