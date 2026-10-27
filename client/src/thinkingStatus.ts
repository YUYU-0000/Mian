import {
  isThinkingRunning,
  type ReplyGroup,
} from "./chatModel";
import type { VisualReply } from "./visualPlayback";

const THINKING_OPEN = "<mian-thinking>";
const THINKING_CLOSE = "</mian-thinking>";

function isWaitingForThinkingOutput(reply: ReplyGroup, activeTurnId: string | null) {
  if (activeTurnId !== reply.replyGroupId || reply.status) return false;
  if (reply.tools.length > 0 || reply.approvals.length > 0) return false;
  const raw = reply.raw.trimStart();
  if (!raw) return true;
  if (THINKING_OPEN.startsWith(raw)) return true;
  return raw.startsWith(THINKING_OPEN) && !raw.includes(THINKING_CLOSE);
}

export function shouldShowThinkingHourglass(
  reply: ReplyGroup,
  visual: VisualReply,
  activeTurnId: string | null,
): boolean {
  const visualThinkingPending = visual.thinking !== reply.thinking;
  return (
    isThinkingRunning(reply) ||
    visualThinkingPending ||
    isWaitingForThinkingOutput(reply, activeTurnId)
  );
}
