export const TICKET_SWIPE_DIRECTION_DISTANCE = 8;
export const TICKET_SWIPE_DIRECTION_RATIO = 1.2;
export const TICKET_SWIPE_MAX_DRAG = 72;
export const TICKET_SWIPE_DISTANCE_THRESHOLD = 44;
export const TICKET_SWIPE_VELOCITY_THRESHOLD = -0.55;
export const TICKET_SWIPE_VELOCITY_MIN_DISTANCE = 18;

export type TicketSwipeDirection = "horizontal" | "vertical" | null;

export function resolveTicketSwipeDirection(
  current: TicketSwipeDirection,
  deltaX: number,
  deltaY: number,
): TicketSwipeDirection {
  if (current !== null) return current;
  if (
    Math.abs(deltaX) <= TICKET_SWIPE_DIRECTION_DISTANCE &&
    Math.abs(deltaY) <= TICKET_SWIPE_DIRECTION_DISTANCE
  )
    return null;
  return deltaX < 0 && Math.abs(deltaX) > Math.abs(deltaY) * TICKET_SWIPE_DIRECTION_RATIO
    ? "horizontal"
    : "vertical";
}

export function ticketSwipeOffset(deltaX: number) {
  const distance = Math.min(
    TICKET_SWIPE_MAX_DRAG,
    Math.max(0, -deltaX - TICKET_SWIPE_DIRECTION_DISTANCE) * 0.78,
  );
  return distance === 0 ? 0 : -distance;
}

export function shouldArchiveTicket(offsetX: number, velocityX: number) {
  return (
    offsetX <= -TICKET_SWIPE_DISTANCE_THRESHOLD ||
    (velocityX <= TICKET_SWIPE_VELOCITY_THRESHOLD &&
      offsetX <= -TICKET_SWIPE_VELOCITY_MIN_DISTANCE)
  );
}

export function adjacentConversationId(
  conversationIds: string[],
  removedId: string,
) {
  const index = conversationIds.indexOf(removedId);
  if (index < 0) return conversationIds[0] ?? null;
  return conversationIds[index + 1] ?? conversationIds[index - 1] ?? null;
}

export async function authorizeTicketArchive(
  requestArchive: () => Promise<void>,
) {
  try {
    await requestArchive();
    return true;
  } catch {
    return false;
  }
}

export function isTicketArchiveEligible({
  conversationCount,
  activeTurnId,
  pendingApprovalCount,
}: {
  conversationId: string;
  conversationCount: number;
  activeTurnId: string | null;
  pendingApprovalCount: number;
}) {
  return (
    conversationCount > 1 &&
    activeTurnId === null &&
    pendingApprovalCount === 0
  );
}
