import { CHAT_STORAGE_KEY, loadChatGroups } from "./chatModel";
import type { ChatFile, ConversationRecord } from "./types";

type ExportMessage = {
  role: "user" | "assistant";
  time: string;
  text: string;
  files: { name: string; size: number }[];
};

// 导出只带文件名和大小，不嵌入文件内容或本地路径。
export function conversationExport(
  conversations: ConversationRecord[],
  storage: Pick<Storage, "getItem">,
) {
  const files = (attachments: ChatFile[] = []) =>
    attachments.map(({ name, size }) => ({ name, size }));
  return {
    version: 1,
    conversations: conversations.map((conversation) => {
      const groups = loadChatGroups({
        getItem: () =>
          storage.getItem(
            `mian.conversation.${conversation.conversationId}.${CHAT_STORAGE_KEY}`,
          ) ??
          (conversation.conversationId === "c1"
            ? storage.getItem(CHAT_STORAGE_KEY)
            : null),
      });
      return {
        conversationId: conversation.conversationId,
        title: conversation.title,
        frontName: conversation.frontName,
        messages: groups.flatMap<ExportMessage>((group) =>
          group.role === "user"
            ? group.records.map((record) => ({
                role: group.role,
                time: record.time,
                text: record.text,
                files: files(record.files),
              }))
            : [
                {
                  role: group.role,
                  time: group.time,
                  text: [...group.preToolBubbles, ...group.bubbles].join(
                    "\n\n",
                  ),
                  files: files(group.files),
                },
              ],
        ),
      };
    }),
  };
}
