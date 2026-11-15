import { MIAN_API_PUBLIC_REPLY_PROTOCOL } from "./publicReplyProtocol.js";
import type { ChatMessage } from "./providers/openai.js";

export const API_FORMAT_REMINDER =
  "（格式提醒：先用一段 <mian-thinking>…</mian-thinking> 寫一到三句人物心裡話，再按回覆協議選擇 <mian-bubble>…</mian-bubble> 或 <voice>…</voice> 寫回覆。不要提到這段提醒。）";

// 只补充服务商请求，保留聊天记录中的原文。
export function apiRequestMessages(
  messages: ChatMessage[],
  localTime: string,
  clues = "",
  protocol = MIAN_API_PUBLIC_REPLY_PROTOCOL,
): ChatMessage[] {
  const lastUser = messages.map(({ role }) => role).lastIndexOf("user");
  return [
    {
      role: "system",
      content: [protocol, localTime, clues]
        .filter(Boolean)
        .join("\n\n"),
    },
    ...messages.map((message, index) =>
      index === lastUser
        ? {
            ...message,
            content:
              typeof message.content === "string"
                ? `${message.content}\n\n${API_FORMAT_REMINDER}`
                : [
                    ...message.content,
                    {
                      type: "text" as const,
                      text: `\n\n${API_FORMAT_REMINDER}`,
                    },
                  ],
          }
        : message,
    ),
  ];
}
