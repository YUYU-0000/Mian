import type { Approval, ChatEvent, ChatFile, ChatMessage, ReplyFormat, ToolEvent } from "./types.mjs";
export declare const CHAT_STORAGE_KEY = "mian.chat-groups.v2";
export type UserRecord = {
    messageId: string;
    text: string;
    time: string;
    files?: ChatFile[];
};
export type UserGroup = {
    groupId: string;
    role: "user";
    time: string;
    pending: boolean;
    records: UserRecord[];
};
export type ReplyGroup = {
    format?: ReplyFormat;
    replyGroupId: string;
    role: "assistant";
    time: string;
    thinking: string;
    activeReasoningItemIds: string[];
    raw: string;
    preToolBubbles: string[];
    preToolBubbleIds: string[];
    preToolBubbleComplete: boolean[];
    preToolComplete: boolean;
    bubbles: string[];
    bubbleIds: string[];
    bubbleComplete: boolean[];
    tools: ToolEvent[];
    approvals: Approval[];
    status?: string;
    files?: ChatFile[];
    voices?: Record<string, import("./voice.mjs").VoiceClip>;
    voiceBubbleIds?: string[];
    fileBubbleIds?: string[];
};
export type ChatGroup = UserGroup | ReplyGroup;
export declare function chatHistory(groups: ChatGroup[]): ChatMessage[];
export declare function isThinkingRunning(reply: ReplyGroup): boolean;
export declare function appendUserRecord(groups: ChatGroup[], text: string, time: string, messageId?: string, groupId?: string, files?: ChatFile[]): ChatGroup[];
export declare function pendingUserGroup(groups: ChatGroup[]): UserGroup | undefined;
export declare function recoverLastUnansweredUserGroup(groups: ChatGroup[]): ChatGroup[];
export declare function applyReplyEvent(groups: ChatGroup[], event: Extract<ChatEvent, {
    turnId: string;
}>, time: string): ChatGroup[];
export declare function closePendingGroup(groups: ChatGroup[], groupId: string): ChatGroup[];
export declare function finalizeReplyGroup(groups: ChatGroup[], turnId: string, status: string): ChatGroup[];
export declare function saveChatGroups(storage: Pick<Storage, "setItem">, groups: ChatGroup[]): void;
export declare function loadChatGroups(storage: Pick<Storage, "getItem">): ChatGroup[];

export declare function mergeUserGroups(groups: ChatGroup[], incoming: UserGroup[]): ChatGroup[];

export declare function recentClueMessages(groups: ChatGroup[]): ChatMessage[];
