export type ConversationRuntimeState = {
  conversationId: string;
  threadId: string | null;
  loaded: boolean;
  activeTurnId: string | null;
  startingTurn: boolean;
  threadOperation: Promise<string> | null;
};

/** Keeps all mutable Codex runtime state atomic and keyed by conversationId. */
export class ConversationRuntimeRegistry {
  private readonly states = new Map<string, ConversationRuntimeState>();
  private readonly threadOwners = new Map<string, string>();
  private readonly turnOwners = new Map<string, string>();

  register(conversationId: string, threadId: string | null = null) {
    if (!conversationId) throw new Error("conversationId is required");
    const state = this.states.get(conversationId) ?? {
      conversationId,
      threadId: null,
      loaded: false,
      activeTurnId: null,
      startingTurn: false,
      threadOperation: null,
    };
    this.states.set(conversationId, state);
    if (threadId) this.setThread(conversationId, threadId);
    return state;
  }

  restore(records: Array<{ conversationId: string; threadId: string | null }>) {
    for (const record of records) this.register(record.conversationId, record.threadId);
  }

  require(conversationId: string) {
    const state = this.states.get(conversationId);
    if (!state) throw new Error(`Unknown conversation: ${conversationId}`);
    return state;
  }

  setThread(conversationId: string, threadId: string) {
    const state = this.register(conversationId);
    const existingOwner = this.threadOwners.get(threadId);
    if (existingOwner && existingOwner !== conversationId)
      throw new Error(
        `Thread ${threadId} already belongs to ${existingOwner}`,
      );
    if (state.threadId && state.threadId !== threadId)
      this.threadOwners.delete(state.threadId);
    state.threadId = threadId;
    this.threadOwners.set(threadId, conversationId);
  }

  clearThread(conversationId: string) {
    const state = this.require(conversationId);
    if (state.threadId && this.threadOwners.get(state.threadId) === conversationId)
      this.threadOwners.delete(state.threadId);
    state.threadId = null;
    state.loaded = false;
  }

  conversationForThread(threadId: string) {
    return this.threadOwners.get(threadId) ?? null;
  }

  conversationForTurn(turnId: string) {
    return this.turnOwners.get(turnId) ?? null;
  }

  setActiveTurn(conversationId: string, turnId: string) {
    const state = this.require(conversationId);
    const existingOwner = this.turnOwners.get(turnId);
    if (existingOwner && existingOwner !== conversationId)
      throw new Error(`Turn ${turnId} already belongs to ${existingOwner}`);
    if (state.activeTurnId && state.activeTurnId !== turnId)
      this.turnOwners.delete(state.activeTurnId);
    state.activeTurnId = turnId;
    this.turnOwners.set(turnId, conversationId);
  }

  clearActiveTurn(conversationId: string, turnId?: string) {
    const state = this.require(conversationId);
    if (turnId && state.activeTurnId !== turnId) return false;
    if (state.activeTurnId && this.turnOwners.get(state.activeTurnId) === conversationId)
      this.turnOwners.delete(state.activeTurnId);
    state.activeTurnId = null;
    return true;
  }

  setThreadOperation(conversationId: string, operation: Promise<string> | null) {
    this.require(conversationId).threadOperation = operation;
  }

  getActiveTurns() {
    const result: Record<string, string> = {};
    for (const state of this.states.values())
      if (state.activeTurnId) result[state.conversationId] = state.activeTurnId;
    return result;
  }

  activeTurnCount() {
    let count = 0;
    for (const state of this.states.values()) if (state.activeTurnId) count += 1;
    return count;
  }

  clearTransientState() {
    const interrupted: Array<[string, string]> = [];
    for (const state of this.states.values()) {
      if (state.activeTurnId)
        interrupted.push([state.conversationId, state.activeTurnId]);
      state.activeTurnId = null;
      state.startingTurn = false;
      state.threadOperation = null;
      state.loaded = false;
    }
    this.turnOwners.clear();
    return interrupted;
  }

  remove(conversationId: string) {
    const state = this.states.get(conversationId);
    if (!state) return;
    if (state.threadId && this.threadOwners.get(state.threadId) === conversationId)
      this.threadOwners.delete(state.threadId);
    if (
      state.activeTurnId &&
      this.turnOwners.get(state.activeTurnId) === conversationId
    )
      this.turnOwners.delete(state.activeTurnId);
    this.states.delete(conversationId);
  }
}
