import type { ConversationRecord } from "./types";

export function upsertConversation(
  conversations: ConversationRecord[],
  incoming: ConversationRecord,
) {
  const index = conversations.findIndex(
    (conversation) => conversation.conversationId === incoming.conversationId,
  );
  if (index < 0) return [...conversations, incoming];
  if (conversations[index] === incoming) return conversations;
  const next = [...conversations];
  next[index] = incoming;
  return next;
}

export function resolveAvailableConversationId(
  conversations: ConversationRecord[],
  preferredConversationId: string | undefined,
  emptyFallbackId: string,
) {
  if (
    preferredConversationId &&
    conversations.some(
      (conversation) =>
        conversation.conversationId === preferredConversationId,
    )
  )
    return preferredConversationId;
  return conversations[0]?.conversationId ?? emptyFallbackId;
}
