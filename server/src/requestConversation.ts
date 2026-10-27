/** Keeps the old-client fallback at the HTTP boundary. */
export function requestConversationId(
  body: unknown,
  defaultConversationId: string,
) {
  if (typeof body !== "object" || body === null) return defaultConversationId;
  const conversationId = (body as { conversationId?: unknown }).conversationId;
  return typeof conversationId === "string"
    ? conversationId
    : defaultConversationId;
}
