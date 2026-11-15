import { pad2 } from "./format";
import type { ClueWall } from "./clueTypes";
import { CHAT_STORAGE_KEY, type ChatGroup } from "../../shared/chatModel.mjs";
import type { Config, ConversationRecord } from "./types";
import type { ApiPreset } from "./connectionTypes";
import type { FontSettings } from "./settingsTypes";

export type ServerBackup = {
  format: "mian-backup";
  version: 1;
  config: Config;
  apiPresets: Omit<ApiPreset, "key" | "hasKey" | "keyHint">[];
  fonts: FontSettings;
  clues?: ClueWall;
  conversations: ConversationRecord[];
  chats: Record<string, ChatGroup[]>;
  files?: { conversationId: string; file: import("./types").ChatFile; content: string }[];
};
export type Backup = ServerBackup & {
  exportedAt: string;
  preferences: Record<string, string | null>;
  homePhotos?: Record<string, string>;
};
const preferenceKeys = ["launcher_settings", "mian.active-conversation.v1"];
const chatKey = (id: string) => `mian.conversation.${id}.${CHAT_STORAGE_KEY}`;

// 正文和附件来自服务器，浏览器只补充显示偏好。
export function completeBackup(
  server: ServerBackup,
  storage: Pick<Storage, "getItem">,
): Backup {
  return {
    ...server,
    exportedAt: new Date().toISOString(),
    preferences: Object.fromEntries(
      preferenceKeys.map((key) => [key, storage.getItem(key)]),
    ),
  };
}

export function restoreBrowserBackup(backup: Backup, storage: Storage) {
  // 运行中的会话状态不随备份复活，正文和附件票根保留。
  for (const key of Object.keys(storage)) {
    if (
      key.startsWith("mian.conversation.") ||
      [
        CHAT_STORAGE_KEY,
        "mian.chat-session.v1",
        "mian.pending-user-records.v1",
        "mian.chat-event-cursor.v1",
      ].includes(key)
    )
      storage.removeItem(key);
  }
  for (const { conversationId } of backup.conversations) {
    const groups = backup.chats[conversationId].map((group) =>
      group.role === "user"
        ? { ...group, pending: false }
        : {
            ...group,
            status: group.status || "interrupted",
            approvals: [],
            activeReasoningItemIds: [],
            preToolComplete: true,
            preToolBubbleComplete: group.preToolBubbles.map(() => true),
            bubbleComplete: group.bubbles.map(() => true),
          },
    );
    try { storage.setItem(chatKey(conversationId), JSON.stringify(groups)); }
    catch { /* 导入正文已保存在服务器，浏览器缓存可稍后重建。 */ }
  }
  for (const key of preferenceKeys) {
    const value = backup.preferences[key];
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, value);
  }
}

export function backupFilename(date = new Date()) {
  return `mian-backup-${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}.json`;
}
