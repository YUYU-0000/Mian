import { MIAN_API_PUBLIC_REPLY_PROTOCOL } from "./publicReplyProtocol.js";
import type { ChatMessage } from "./providers/openai.js";

export const API_FORMAT_REMINDER =
  "（格式提醒：先用一段 <mian-thinking>…</mian-thinking> 寫一到三句人物心裡話，再用一個或多個 <mian-bubble>…</mian-bubble> 寫回覆。不要提到這段提醒。）";

export const API_HTML_STYLE =
  "當你寫 HTML 頁面時，請遵守這個視覺風格：米白偏暖的底色（#f5f2ec 或 #e8e6df），墨藍色文字（#3b4d5a），輔助色用灰藍（#6b8396、#93a7b5）；細線、留白多、圓角很小（2px 左右）；按鈕用細邊框或帶下劃線的小字，不要用亮藍色實心大按鈕、大圓角卡片、漸層和霓虹色；不要用左側粗豎線當裝飾；字體用 serif 或系統字體，小號標籤可以用字距拉開的大寫英文。";

// 只补充服务商请求，保留聊天记录中的原文。
export function apiRequestMessages(
  messages: ChatMessage[],
  localTime: string,
): ChatMessage[] {
  const lastUser = messages.map(({ role }) => role).lastIndexOf("user");
  return [
    {
      role: "system",
      content: [MIAN_API_PUBLIC_REPLY_PROTOCOL, API_HTML_STYLE, localTime].join(
        "\n\n",
      ),
    },
    ...messages.map((message, index) =>
      index === lastUser
        ? {
            ...message,
            content: `${message.content}\n\n${API_FORMAT_REMINDER}`,
          }
        : message,
    ),
  ];
}
