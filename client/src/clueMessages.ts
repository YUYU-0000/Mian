import type { ChatGroup } from "./chatModel";
import type { ChatMessage } from "./types";

export function recentClueMessages(groups: ChatGroup[]): ChatMessage[] {
  return groups
    .flatMap((group): ChatMessage[] => {
      if (group.role === "user")
        return group.records.map(({ text }) => ({
          role: "user",
          content: text,
        }));
      if (group.status === "failed") return [];
      return [
        {
          role: "assistant",
          content: [...group.preToolBubbles, ...group.bubbles].join("\n\n"),
        },
      ];
    })
    .slice(-6);
}
