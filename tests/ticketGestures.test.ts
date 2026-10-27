import assert from "node:assert/strict";
import test from "node:test";
import {
  adjacentConversationId,
  authorizeTicketArchive,
  isTicketArchiveEligible,
  resolveTicketSwipeDirection,
  shouldArchiveTicket,
  ticketSwipeOffset,
} from "../client/src/ticketGestures.ts";
import { hasCompletedConversation } from "../client/src/chatSession.ts";

test("ticket swipe leaves vertical scrolling alone and only captures a clear left gesture", () => {
  assert.equal(resolveTicketSwipeDirection(null, -6, 2), null);
  assert.equal(resolveTicketSwipeDirection(null, -12, 11), "vertical");
  assert.equal(resolveTicketSwipeDirection(null, 20, 1), "vertical");
  assert.equal(resolveTicketSwipeDirection(null, -20, 10), "horizontal");
  assert.equal(resolveTicketSwipeDirection("horizontal", -20, 80), "horizontal");
});

test("ticket swipe uses the reference distance and velocity thresholds", () => {
  assert.equal(shouldArchiveTicket(-43.9, -0.54), false);
  assert.equal(shouldArchiveTicket(-44, 0), true);
  assert.equal(shouldArchiveTicket(-18, -0.55), true);
  assert.equal(shouldArchiveTicket(-17.9, -1), false);
  assert.equal(ticketSwipeOffset(-200), -72);
  assert.equal(ticketSwipeOffset(30), 0);
});

test("a failed backend archive never authorizes frontend removal", async () => {
  let calls = 0;
  assert.equal(
    await authorizeTicketArchive(async () => {
      calls += 1;
      throw new Error("thread/archive failed");
    }),
    false,
  );
  assert.equal(calls, 1);
  assert.equal(await authorizeTicketArchive(async () => undefined), true);
});

test("every ticket including C-01 is archivable unless it is last, active or approval-blocked", () => {
  const eligible = {
    conversationId: "c2",
    conversationCount: 2,
    activeTurnId: null,
    pendingApprovalCount: 0,
  };
  assert.equal(isTicketArchiveEligible(eligible), true);
  assert.equal(
    isTicketArchiveEligible({ ...eligible, conversationId: "c1" }),
    true,
  );
  assert.equal(
    isTicketArchiveEligible({ ...eligible, conversationCount: 1 }),
    false,
  );
  assert.equal(
    isTicketArchiveEligible({ ...eligible, activeTurnId: "turn-1" }),
    false,
  );
  assert.equal(
    isTicketArchiveEligible({ ...eligible, pendingApprovalCount: 1 }),
    false,
  );
});

test("removing the selected ticket chooses the following neighbor, then the previous one", () => {
  assert.equal(adjacentConversationId(["c1", "c2", "c3"], "c2"), "c3");
  assert.equal(adjacentConversationId(["c1", "c2", "c3"], "c3"), "c2");
});

test("only a conversation with a completed assistant turn can branch", () => {
  const base = {
    conversationId: "c2",
    visualReplies: {},
    activeTurnId: null,
  };
  assert.equal(hasCompletedConversation({ ...base, messages: [] }), false);
  assert.equal(
    hasCompletedConversation({
      ...base,
      messages: [
        {
          role: "assistant",
          replyGroupId: "turn-1",
          time: "08:44",
          thinking: "",
          activeReasoningItemIds: [],
          raw: "",
          preToolBubbles: [],
          preToolBubbleIds: [],
          preToolBubbleComplete: [],
          preToolComplete: false,
          bubbles: ["partial"],
          bubbleIds: ["bubble-1"],
          bubbleComplete: [false],
          tools: [],
          approvals: [],
        },
      ],
    }),
    false,
  );
  assert.equal(
    hasCompletedConversation({
      ...base,
      messages: [
        {
          role: "assistant",
          replyGroupId: "turn-2",
          time: "08:45",
          thinking: "done",
          activeReasoningItemIds: [],
          raw: "",
          preToolBubbles: [],
          preToolBubbleIds: [],
          preToolBubbleComplete: [],
          preToolComplete: false,
          bubbles: ["done"],
          bubbleIds: ["bubble-2"],
          bubbleComplete: [true],
          tools: [],
          approvals: [],
          status: "completed",
        },
      ],
    }),
    true,
  );
});
