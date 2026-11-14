import { CHAT_STORAGE_KEY, loadChatGroups, type ChatGroup } from "./chatModel";
import type { Config, ConversationRecord } from "./types";
import type { ApiPreset } from "./connectionTypes";
import type { FontSettings } from "./settingsTypes";

export type ServerBackup = {
  format: "mian-backup";
  version: 1;
  config: Config;
  apiPresets: Omit<ApiPreset, "key" | "hasKey" | "keyHint">[];
  fonts: FontSettings;
  conversations: ConversationRecord[];
};
export type Backup = ServerBackup & {
  exportedAt: string;
  chats: Record<string, ChatGroup[]>;
  preferences: Record<string, string | null>;
};
const preferenceKeys = ["launcher_settings", "mian.active-conversation.v1"];
const chatKey = (id: string) => `mian.conversation.${id}.${CHAT_STORAGE_KEY}`;

// 对话正文在当前浏览器，档案和设置由后端提供。
export function completeBackup(
  server: ServerBackup,
  storage: Pick<Storage, "getItem">,
): Backup {
  return {
    ...server,
    exportedAt: new Date().toISOString(),
    chats: Object.fromEntries(
      server.conversations.map(({ conversationId }) => [
        conversationId,
        loadChatGroups({
          getItem: () =>
            storage.getItem(chatKey(conversationId)) ??
            (conversationId === "c1"
              ? storage.getItem(CHAT_STORAGE_KEY)
              : null),
        }),
      ]),
    ),
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
    storage.setItem(chatKey(conversationId), JSON.stringify(groups));
  }
  for (const key of preferenceKeys) {
    const value = backup.preferences[key];
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, value);
  }
}

export function backupFilename(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `mian-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.json`;
}
