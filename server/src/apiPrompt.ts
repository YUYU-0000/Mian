import { MIAN_API_PUBLIC_REPLY_PROTOCOL } from "./publicReplyProtocol.js";
import type { ChatMessage } from "./providers/openai.js";

export const API_FORMAT_REMINDER =
  '（格式提醒：先用一段 <mian-thinking>…</mian-thinking> 寫一到三句人物心裡話，再按回覆協議選擇 <mian-bubble>…</mian-bubble>、<voice>…</voice> 或 <mian-file name="文件名.txt">完整內容</mian-file> 寫回覆。不要提到這段提醒。）';

// 只补充服务商请求，保留聊天记录中的原文。
export function apiRequestMessages(
  messages: ChatMessage[],
  localTime: string,
  clues = "",
  protocol = MIAN_API_PUBLIC_REPLY_PROTOCOL,
  pinned = "",
): ChatMessage[] {
  const lastUser = messages.map(({ role }) => role).lastIndexOf("user");
  const context = [localTime, clues, API_FORMAT_REMINDER].filter(Boolean).join("\n\n");
  return [
    {
      role: "system",
      content: [protocol, pinned]
        .filter(Boolean)
        .join("\n\n"),
    },
    ...messages.map((message, index) =>
      index === lastUser
        ? {
            ...message,
            content:
              typeof message.content === "string"
                ? `${message.content}\n\n${context}`
                : [
                    ...message.content,
                    {
                      type: "text" as const,
                      text: `\n\n${context}`,
                    },
                  ],
          }
        : message,
    ),
  ];
}
