import type { ChatGroup } from "./chatModel";
import { readableToolResult } from "./toolPresentation";
import type { VisualReply, VisualTarget } from "./visualPlayback";

export function visualTarget(
  message: Extract<ChatGroup, { role: "assistant" }>,
): VisualTarget {
  const toolTimelineReady =
    message.tools.length === 0 || hasCompletedPreToolBubble(message);
  return {
    thinking: message.thinking,
    preToolBubbles: message.preToolBubbles,
    tools: toolTimelineReady
      ? message.tools.map((tool) => ({
          id: tool.id,
          text: tool.state === "running" ? "" : readableToolResult(tool),
          tool,
        }))
      : [],
    bubbles: toolTimelineReady ? message.bubbles : [],
    done: Boolean(message.status),
  };
}

export function hasCompletedPreToolBubble(
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
