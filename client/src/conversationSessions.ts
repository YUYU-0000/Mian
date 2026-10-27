import type {
  ChatEvent,
  ConversationActivity,
  ConversationRecord,
  RealtimeSession,
} from "./types";
import { ChatSessionStore, type ChatSessionOptions } from "./chatSession";

type ConversationSessionsOptions = {
  initialConversationIds: string[];
  onActivity: (
    conversationId: string,
    activity: ConversationActivity,
  ) => void;
  storage?: ChatSessionOptions["storage"];
  apiClient?: ChatSessionOptions["apiClient"];
};

/** Owns every conversation-scoped client runtime. UI selection lives elsewhere. */
export class ConversationSessions {
  private readonly stores = new Map<string, ChatSessionStore>();
  private readonly knownConversationIds = new Set<string>();
  private readonly onActivity: ConversationSessionsOptions["onActivity"];
  private readonly storage?: ChatSessionOptions["storage"];
  private readonly apiClient?: ChatSessionOptions["apiClient"];
  private authoritativeTurns: Readonly<Record<string, string>> = {};
  private hasAuthoritativeSession = false;
  private latestReset = true;

  constructor(options: ConversationSessionsOptions) {
    this.onActivity = options.onActivity;
    this.storage = options.storage;
    this.apiClient = options.apiClient;
    for (const conversationId of options.initialConversationIds)
      this.register(conversationId);
  }

  register(conversation: ConversationRecord | string) {
    const conversationId =
      typeof conversation === "string"
        ? conversation
        : conversation.conversationId;
    if (!conversationId) throw new Error("conversationId is required");
    this.knownConversationIds.add(conversationId);
    return this.get(conversationId);
  }

  registerAll(conversations: ConversationRecord[]) {
    for (const conversation of conversations) this.register(conversation);
  }

  get(conversationId: string) {
    if (!conversationId) throw new Error("conversationId is required");
    if (!this.knownConversationIds.has(conversationId))
      throw new Error(`Unknown conversation: ${conversationId}`);
    let store = this.stores.get(conversationId);
    if (!store) {
      store = new ChatSessionStore({
        conversationId,
        requireRemoteSynchronization: true,
        ...(this.storage ? { storage: this.storage } : {}),
        ...(this.apiClient ? { apiClient: this.apiClient } : {}),
        onActivity: (activity) => this.onActivity(conversationId, activity),
      });
      this.stores.set(conversationId, store);
      if (this.hasAuthoritativeSession)
        store.synchronizeRemoteTurn(
          this.authoritativeTurns[conversationId] ?? null,
          this.latestReset,
        );
    }
    return store;
  }

  route(event: ChatEvent) {
    if (!event.conversationId)
      throw new Error(`Conversation event ${event.type} is missing conversationId`);
    this.get(event.conversationId).enqueueEvent(event);
  }

  synchronize(session: RealtimeSession) {
    const conversations = session.conversations ?? [];
    if (session.conversations) {
      const remoteIds = new Set(
        conversations.map((conversation) => conversation.conversationId),
      );
      for (const conversationId of [...this.knownConversationIds])
        if (!remoteIds.has(conversationId)) this.remove(conversationId);
    }
    this.registerAll(conversations);
    const activeTurns = { ...(session.activeTurns ?? {}) };
    // Legacy session fields are accepted only at this transport migration edge.
    if (
      session.activeTurnId &&
      session.defaultConversationId &&
      !activeTurns[session.defaultConversationId]
    )
      activeTurns[session.defaultConversationId] = session.activeTurnId;
    this.authoritativeTurns = activeTurns;
    this.hasAuthoritativeSession = true;
    this.latestReset = session.reset;
    for (const conversation of conversations)
      this.get(conversation.conversationId).synchronizeRemoteTurn(
        activeTurns[conversation.conversationId] ?? null,
        session.reset,
      );
  }

  remove(conversationId: string) {
    const store = this.stores.get(conversationId);
    store?.clearPersistedData();
    store?.dispose();
    this.stores.delete(conversationId);
    this.knownConversationIds.delete(conversationId);
    if (conversationId in this.authoritativeTurns) {
      const next = { ...this.authoritativeTurns };
      delete next[conversationId];
      this.authoritativeTurns = next;
    }
  }

  dispose() {
    for (const store of this.stores.values()) store.dispose();
    this.stores.clear();
    this.knownConversationIds.clear();
  }
}
