export type FrozenConversationFrame = {
  conversationId: string;
  html: string;
  scrollTop: number;
  inputTopY: string;
  inputAreaHeight: string;
};

export type ConversationTransitionView = {
  outgoingFrame: FrozenConversationFrame;
  generation: number;
};
