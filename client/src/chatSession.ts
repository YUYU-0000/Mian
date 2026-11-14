import { api } from "./api";
import { FileDrafts } from "./fileDrafts";
import {
  CHAT_STORAGE_KEY,
  applyReplyEvent,
  appendUserRecord,
  buildPublicReplyPrompt,
  chatHistory,
  closePendingGroup,
  finalizeReplyGroup,
  loadChatGroups,
  pendingUserGroup,
  recoverLastUnansweredUserGroup,
  readableToolResult,
  saveChatGroups,
  type ChatGroup,
} from "./chatModel";
import { loadPending, PENDING_STORAGE_KEY } from "./chatPending";
import { ReplyPlaybackQueue } from "./replyPlaybackQueue";
import type {
  ChatEvent,
  ChatFile,
  ChatMessage,
  ConversationActivity,
} from "./types";
import {
  emptyVisualReply,
  hydrateVisualReply,
  tickVisualReply,
  type VisualReply,
  type VisualTarget,
} from "./visualPlayback";

const SESSION_STORAGE_KEY = "mian.chat-session.v1";
const LEGACY_DEFAULT_CONVERSATION_ID = "c1";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type SessionApi = {
  send: (
    text: string,
    conversationId: string,
    messages?: ChatMessage[],
    files?: ChatFile[],
  ) => Promise<{ turnId: string }>;
  stop: (turnId: string, conversationId: string) => Promise<unknown>;
  decide?: (
    requestId: string,
    allow: boolean,
    conversationId: string,
  ) => Promise<unknown>;
};

export type TurnPhase = "idle" | "starting" | "running" | "playing";

export type ChatSessionSnapshot = {
  conversationId: string;
  messages: ChatGroup[];
  visualReplies: Record<string, VisualReply>;
  activeTurnId: string | null;
  turnPhase: TurnPhase;
};

export type ChatSessionOptions = {
  conversationId: string;
  requireRemoteSynchronization?: boolean;
  storage?: StorageLike;
  apiClient?: SessionApi;
  nowLabel?: () => string;
  nowMs?: () => number;
  nowIso?: () => string;
  onActivity?: (activity: ConversationActivity) => void;
  onSendError?: (error: unknown) => void;
  schedule?: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
};

export function lastVisibleMessageSummary(messages: ChatGroup[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const group = messages[index];
    const candidates =
      group.role === "user"
        ? group.records.map((record) => record.text)
        : [...group.preToolBubbles, ...group.bubbles];
    for (let item = candidates.length - 1; item >= 0; item -= 1) {
      const value = candidates[item].replace(/\s+/g, " ").trim();
      if (!value) continue;
      return value;
    }
  }
  return null;
}

export function hasCompletedConversation(snapshot: ChatSessionSnapshot) {
  return snapshot.messages.some(
    (message) =>
      message.role === "assistant" &&
      ["completed", "success"].includes(
        String(message.status ?? "").toLowerCase(),
      ),
  );
}

function conversationStorage(
  storage: StorageLike,
  conversationId: string,
): StorageLike {
  const scopedKey = (key: string) =>
    `mian.conversation.${conversationId}.${key}`;
  const isDefault = conversationId === LEGACY_DEFAULT_CONVERSATION_ID;
  return {
    getItem(key) {
      return (
        storage.getItem(scopedKey(key)) ??
        (isDefault ? storage.getItem(key) : null)
      );
    },
    setItem(key, value) {
      storage.setItem(scopedKey(key), value);
      // 同步旧存储键，兼容旧版的 C-01。
      if (isDefault) storage.setItem(key, value);
    },
    removeItem(key) {
      storage.removeItem(scopedKey(key));
      if (isDefault) storage.removeItem(key);
    },
  };
}

function currentTimeLabel() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function initialChatGroups(storage: StorageLike): ChatGroup[] {
  const stored = loadChatGroups(storage);
  if (stored.length) return stored;
  const legacy = loadPending(storage);
  return legacy.reduce<ChatGroup[]>(
    (groups, record) =>
      appendUserRecord(groups, record.text, record.time, record.id),
    [],
  );
}

function loadActiveTurn(storage: StorageLike): string | null {
  try {
    const value: unknown = JSON.parse(
      storage.getItem(SESSION_STORAGE_KEY) ?? "null",
    );
    if (
      typeof value === "object" &&
      value !== null &&
      "activeTurnId" in value &&
      typeof value.activeTurnId === "string"
    )
      return value.activeTurnId;
  } catch {
    // 旧会话信息留到下次更新时重写。
  }
  return null;
}

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

export class ChatSessionStore {
  readonly conversationId: string;
  readonly attachments: FileDrafts;
  private readonly storage: StorageLike;
  private readonly apiClient: SessionApi;
  private readonly nowLabel: () => string;
  private readonly nowMs: () => number;
  private readonly nowIso: () => string;
  private readonly onActivity?: ChatSessionOptions["onActivity"];
  private readonly onSendError?: ChatSessionOptions["onSendError"];
  private readonly schedule: ChatSessionOptions["schedule"];
  private readonly cancelSchedule: ChatSessionOptions["cancelSchedule"];
  private readonly listeners = new Set<() => void>();
  private readonly eventQueue: ChatEvent[] = [];
  private processingEvents = false;
  private startingTurn = false;
  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  private messages: ChatGroup[];
  private visualReplies: Record<string, VisualReply>;
  private playbackQueues = new Map<string, ReplyPlaybackQueue>();
  private activeTurnId: string | null;
  private turnPhase: TurnPhase;
  private remoteTurnSynchronized: boolean;
  private readonly remoteTurnSynchronization: Promise<void>;
  private resolveRemoteTurnSynchronization: (() => void) | null = null;
  private snapshot: ChatSessionSnapshot;

  constructor(options: ChatSessionOptions) {
    if (!options.conversationId) throw new Error("conversationId is required");
    this.conversationId = options.conversationId;
    this.attachments = new FileDrafts(options.conversationId);
    this.storage = conversationStorage(
      options.storage ?? window.localStorage,
      this.conversationId,
    );
    this.apiClient = options.apiClient ?? api;
    this.nowLabel = options.nowLabel ?? currentTimeLabel;
    this.nowMs = options.nowMs ?? (() => performance.now());
    this.nowIso = options.nowIso ?? (() => new Date().toISOString());
    this.onActivity = options.onActivity;
    this.onSendError = options.onSendError;
    this.schedule =
      options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
    this.cancelSchedule =
      options.cancelSchedule ?? ((timer) => clearTimeout(timer));
    this.messages = initialChatGroups(this.storage);
    this.activeTurnId = loadActiveTurn(this.storage);
    this.turnPhase = this.activeTurnId ? "running" : "idle";
    this.remoteTurnSynchronized = options.requireRemoteSynchronization
      ? false
      : !this.activeTurnId;
    this.remoteTurnSynchronization = this.remoteTurnSynchronized
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          this.resolveRemoteTurnSynchronization = resolve;
        });
    // 把旧 C-01 记录迁入按会话保存的存储键。
    saveChatGroups(this.storage, this.messages);
    this.storage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ activeTurnId: this.activeTurnId }),
    );
    this.visualReplies = Object.fromEntries(
      this.messages
        .filter(
          (group): group is Extract<ChatGroup, { role: "assistant" }> =>
            group.role === "assistant",
        )
        .map((group) => [
          group.replyGroupId,
          hydrateVisualReply(visualTarget(group)),
        ]),
    );
    this.snapshot = this.createSnapshot();
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = () => this.snapshot;

  enqueueEvent(event: ChatEvent) {
    if (event.conversationId && event.conversationId !== this.conversationId)
      throw new Error(
        `Event for ${event.conversationId} cannot enter ${this.conversationId}`,
      );
    this.eventQueue.push(event);
    if (this.processingEvents) return;
    this.processingEvents = true;
    try {
      while (this.eventQueue.length) this.applyEvent(this.eventQueue.shift()!);
    } finally {
      this.processingEvents = false;
    }
  }

  synchronizeRemoteTurn(turnId: string | null, _reset: boolean) {
    if (turnId) {
      if (this.activeTurnId !== turnId) {
        this.activeTurnId = turnId;
        this.turnPhase = "running";
        this.commit(false, true);
      } else if (this.turnPhase !== "running") {
        this.turnPhase = "running";
        this.commit(false, false);
      }
      this.markRemoteTurnSynchronized();
      this.schedulePlayback();
      return;
    }
    // 用服务端快照清除本地已经结束的回复状态。
    if (this.activeTurnId) {
      this.flushTurn(this.activeTurnId);
      this.activeTurnId = null;
      this.turnPhase = "idle";
      this.commit(false, true);
    } else if (this.turnPhase !== "idle") {
      this.turnPhase = "idle";
      this.commit(false, false);
    }
    this.markRemoteTurnSynchronized();
  }

  saveUserRecord(text: string, files: ChatFile[] = []) {
    const value = text.trim();
    if (!value && !files.length) return;
    this.messages = appendUserRecord(
      this.messages,
      value,
      this.nowLabel(),
      undefined,
      undefined,
      files,
    );
    this.commit(true, false);
    this.onActivity?.({
      lastActivityAt: this.nowIso(),
      lastMessage: value || files.map((file) => file.name).join("、"),
    });
  }

  async startPendingTurn() {
    if (!this.remoteTurnSynchronized) await this.remoteTurnSynchronization;
    if (this.activeTurnId || this.startingTurn) return;
    let group = pendingUserGroup(this.messages);
    if (!group) {
      const recovered = recoverLastUnansweredUserGroup(this.messages);
      if (recovered !== this.messages) {
        this.messages = recovered;
        this.commit(true, false);
        group = pendingUserGroup(this.messages);
      }
    }
    if (!group) return;
    const userText = group.records.map((record) => record.text).join("\n\n");
    this.startingTurn = true;
    this.turnPhase = "starting";
    this.commit(false, false);
    try {
      const result = await this.apiClient.send(
        buildPublicReplyPrompt(userText),
        this.conversationId,
        chatHistory(this.messages.slice(0, this.messages.indexOf(group) + 1)),
        group.records.flatMap((record) => record.files ?? []),
      );
      const reply = this.messages.find(
        (message) =>
          message.role === "assistant" &&
          message.replyGroupId === result.turnId,
      );
      // 快速返回的 API 可能先收到结束事件，再收到 HTTP 响应。
      if (reply?.role !== "assistant" || !reply.status) {
        this.activeTurnId = result.turnId;
        this.turnPhase = "running";
      }
      this.messages = closePendingGroup(this.messages, group.groupId);
      this.commit(true, true);
      this.schedulePlayback();
    } catch (error) {
      console.error(error);
      this.onSendError?.(error);
    } finally {
      this.startingTurn = false;
      if (!this.activeTurnId) {
        this.turnPhase = "idle";
        this.commit(false, false);
      }
    }
  }

  async stopCurrentTurn() {
    // 先同步服务端状态，再判断是停止回复还是发送待发记录。
    if (!this.remoteTurnSynchronized) await this.remoteTurnSynchronization;
    const turnId = this.activeTurnId;
    if (!turnId) return this.startPendingTurn();
    const finalized = finalizeReplyGroup(this.messages, turnId, "interrupted");
    const messagesChanged = finalized !== this.messages;
    this.messages = finalized;
    this.flushTurn(turnId);
    this.activeTurnId = null;
    this.turnPhase = "idle";
    this.commit(messagesChanged, true);
    try {
      await this.apiClient.stop(turnId, this.conversationId);
    } catch (error) {
      console.error(error);
    }
  }

  dismissApproval(replyGroupId: string, requestId: string) {
    this.messages = this.messages.map((message) =>
      message.role === "assistant" && message.replyGroupId === replyGroupId
        ? {
            ...message,
            approvals: message.approvals.filter(
              (approval) => approval.requestId !== requestId,
            ),
          }
        : message,
    );
    this.commit(true, false);
  }

  async decideApproval(
    replyGroupId: string,
    requestId: string,
    allow: boolean,
  ) {
    if (!this.apiClient.decide) throw new Error("Approval API is unavailable");
    await this.apiClient.decide(requestId, allow, this.conversationId);
    this.dismissApproval(replyGroupId, requestId);
  }

  seedFrom(source: ChatSessionSnapshot) {
    if (this.messages.length > 0) return;
    this.messages = structuredClone(source.messages);
    this.activeTurnId = null;
    this.turnPhase = "idle";
    this.visualReplies = Object.fromEntries(
      this.messages
        .filter(
          (group): group is Extract<ChatGroup, { role: "assistant" }> =>
            group.role === "assistant",
        )
        .map((group) => [
          group.replyGroupId,
          hydrateVisualReply(visualTarget(group)),
        ]),
    );
    this.commit(true, true);
  }

  clearPersistedData() {
    this.storage.removeItem(CHAT_STORAGE_KEY);
    this.storage.removeItem(SESSION_STORAGE_KEY);
    this.storage.removeItem(PENDING_STORAGE_KEY);
  }

  dispose() {
    this.attachments.dispose();
    if (this.playbackTimer !== null) {
      this.cancelSchedule!(this.playbackTimer);
      this.playbackTimer = null;
    }
    this.eventQueue.length = 0;
    this.listeners.clear();
  }

  private applyEvent(event: ChatEvent) {
    let messagesChanged = false;
    let sessionChanged = false;
    if ("turnId" in event) this.markRemoteTurnSynchronized();
    if (event.type === "turn-started") {
      this.activeTurnId = event.turnId;
      this.turnPhase = "running";
      sessionChanged = true;
    } else if (
      "turnId" in event &&
      event.type !== "turn-completed" &&
      !this.activeTurnId
    ) {
      this.activeTurnId = event.turnId;
      this.turnPhase = "running";
      sessionChanged = true;
    }
    if ("turnId" in event) {
      this.messages = applyReplyEvent(this.messages, event, this.nowLabel());
      messagesChanged = true;
      const message = this.messages.find(
        (group) =>
          group.role === "assistant" && group.replyGroupId === event.turnId,
      ) as Extract<ChatGroup, { role: "assistant" }>;
      const queue =
        this.playbackQueues.get(event.turnId) ?? new ReplyPlaybackQueue();
      queue.enqueue(
        event.type === "tool" ? `tool:${event.tool.id}` : event.type,
        visualTarget(message),
        this.nowMs(),
      );
      this.playbackQueues.set(event.turnId, queue);
    }
    if (event.type === "turn-completed") {
      if (event.error) this.onSendError?.(new Error(event.error));
      if (this.activeTurnId === event.turnId) this.turnPhase = "playing";
      const status = event.status.toLowerCase();
      if (status !== "completed" && status !== "success") {
        this.flushTurn(event.turnId);
        if (this.activeTurnId === event.turnId) {
          this.activeTurnId = null;
          this.turnPhase = "idle";
          sessionChanged = true;
        }
      }
    } else if (event.type === "error") {
      console.error(event.message);
      if (this.activeTurnId) {
        const finalized = finalizeReplyGroup(
          this.messages,
          this.activeTurnId,
          "failed",
        );
        if (finalized !== this.messages) {
          this.messages = finalized;
          messagesChanged = true;
        }
        this.flushTurn(this.activeTurnId);
        this.activeTurnId = null;
        this.turnPhase = "idle";
        sessionChanged = true;
      }
    }
    this.commit(messagesChanged, sessionChanged);
    if (event.type === "assistant-delta" && event.immediate) {
      this.flushTurn(event.turnId);
      this.commit(false, false);
    }
    if (event.type === "assistant-delta" || event.type === "turn-completed") {
      const lastMessage = lastVisibleMessageSummary(this.messages);
      this.onActivity?.({
        lastActivityAt: this.nowIso(),
        ...(lastMessage ? { lastMessage } : {}),
      });
    }
    this.schedulePlayback();
  }

  private markRemoteTurnSynchronized() {
    if (this.remoteTurnSynchronized) return;
    this.remoteTurnSynchronized = true;
    this.resolveRemoteTurnSynchronization?.();
    this.resolveRemoteTurnSynchronization = null;
  }

  private schedulePlayback(delay = 0) {
    if (!this.activeTurnId) return;
    if (this.playbackTimer !== null) this.cancelSchedule!(this.playbackTimer);
    this.playbackTimer = this.schedule!(
      () => {
        this.playbackTimer = null;
        this.pumpPlayback();
      },
      Math.max(0, delay),
    );
  }

  private pumpPlayback() {
    const turnId = this.activeTurnId;
    if (!turnId) return;
    const message = this.messages.find(
      (group): group is Extract<ChatGroup, { role: "assistant" }> =>
        group.role === "assistant" && group.replyGroupId === turnId,
    );
    if (!message) return;
    const target = visualTarget(message);
    const current = this.visualReplies[turnId] ?? emptyVisualReply();
    const tick =
      this.playbackQueues.get(turnId)?.tick(current, this.nowMs()) ??
      tickVisualReply(current, target, this.nowMs());
    if (tick.changed) {
      this.visualReplies = {
        ...this.visualReplies,
        [turnId]: tick.view,
      };
      this.commit(false, false);
    }
    if (tick.settled) {
      this.playbackQueues.delete(turnId);
      if (this.activeTurnId === turnId) {
        this.activeTurnId = null;
        this.turnPhase = "idle";
        this.commit(false, true);
      }
      return;
    }
    if (tick.wait !== null) this.schedulePlayback(tick.wait);
  }

  private flushTurn(turnId: string) {
    this.playbackQueues.delete(turnId);
    const message = this.messages.find(
      (group): group is Extract<ChatGroup, { role: "assistant" }> =>
        group.role === "assistant" && group.replyGroupId === turnId,
    );
    if (!message) return;
    this.visualReplies = {
      ...this.visualReplies,
      [turnId]: hydrateVisualReply(visualTarget(message)),
    };
  }

  private commit(messagesChanged: boolean, sessionChanged: boolean) {
    if (messagesChanged) saveChatGroups(this.storage, this.messages);
    if (sessionChanged)
      this.storage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({ activeTurnId: this.activeTurnId }),
      );
    this.snapshot = this.createSnapshot();
    for (const listener of this.listeners) listener();
  }

  private createSnapshot(): ChatSessionSnapshot {
    return {
      conversationId: this.conversationId,
      messages: this.messages,
      visualReplies: this.visualReplies,
      activeTurnId: this.activeTurnId,
      turnPhase: this.turnPhase,
    };
  }
}
