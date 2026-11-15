import { parsePublicReply, parseReply } from "./replyProtocol";
import { createId } from "./id";
import type {
  Approval,
  ChatEvent,
  ChatFile,
  ChatMessage,
  ReplyFormat,
  ToolEvent,
} from "./types";

export const CHAT_STORAGE_KEY = "mian.chat-groups.v2";

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
};
export type ChatGroup = UserGroup | ReplyGroup;

// 用可见正文组成完整历史，不带工具、思考或 Codex 协议标记。
export function chatHistory(groups: ChatGroup[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const group of groups) {
    if (group.role === "assistant" && group.status === "failed") continue;
    const content =
      group.role === "user"
        ? group.records.map((record) => record.text).join("\n\n")
        : [...group.preToolBubbles, ...group.bubbles].join("\n\n");
    const files =
      group.role === "user"
        ? group.records.flatMap((record) => record.files ?? [])
        : [];
    if (!content && !files.length) continue;
    const previous = messages.at(-1);
    if (previous?.role === group.role) {
      previous.content += `\n\n${content}`;
      if (files.length) previous.files = [...(previous.files ?? []), ...files];
    } else
      messages.push({
        role: group.role,
        content,
        ...(files.length ? { files } : {}),
      });
  }
  return messages;
}

export function isThinkingRunning(reply: ReplyGroup): boolean {
  return (
    Array.isArray(reply.activeReasoningItemIds) &&
    reply.activeReasoningItemIds.length > 0
  );
}

export function appendUserRecord(
  groups: ChatGroup[],
  text: string,
  time: string,
  messageId = createId(),
  groupId = createId(),
  files: ChatFile[] = [],
): ChatGroup[] {
  const last = groups.at(-1);
  const record = { messageId, text, time, ...(files.length ? { files } : {}) };
  if (last?.role === "user" && last.pending)
    return [
      ...groups.slice(0, -1),
      { ...last, records: [...last.records, record] },
    ];
  return [
    ...groups,
    { groupId, role: "user", time, pending: true, records: [record] },
  ];
}

export function pendingUserGroup(groups: ChatGroup[]): UserGroup | undefined {
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group.role === "user" && group.pending) return group;
  }
  return undefined;
}

export function recoverLastUnansweredUserGroup(
  groups: ChatGroup[],
): ChatGroup[] {
  const last = groups.at(-1);
  const user = groups.at(-2);
  if (
    last?.role === "assistant" &&
    last.format &&
    last.status === "failed" &&
    user?.role === "user"
  )
    return [...groups.slice(0, -2), { ...user, pending: true }];
  let lastAssistantIndex = -1;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    if (groups[index].role === "assistant") {
      lastAssistantIndex = index;
      break;
    }
  }
  const unanswered = groups.slice(lastAssistantIndex + 1);
  if (
    unanswered.length === 0 ||
    unanswered.some((group) => group.role !== "user")
  )
    return groups;
  const userGroups = unanswered as UserGroup[];
  const records = userGroups.flatMap((group) => group.records);
  if (records.length === 0) return groups;
  if (userGroups.length === 1 && userGroups[0].pending) return groups;
  return [
    ...groups.slice(0, lastAssistantIndex + 1),
    {
      ...userGroups[0],
      pending: true,
      records,
    },
  ];
}

export function applyReplyEvent(
  groups: ChatGroup[],
  event: Extract<ChatEvent, { turnId: string }>,
  time: string,
): ChatGroup[] {
  let index = groups.findIndex(
    (group) =>
      group.role === "assistant" && group.replyGroupId === event.turnId,
  );
  let next = groups;
  if (index < 0) {
    next = [
      ...groups,
      {
        replyGroupId: event.turnId,
        role: "assistant",
        format: "format" in event ? event.format : undefined,
        time,
        thinking: "",
        activeReasoningItemIds: [],
        raw: "",
        preToolBubbles: [],
        preToolBubbleIds: [],
        preToolBubbleComplete: [],
        preToolComplete: false,
        bubbles: [],
        bubbleIds: [],
        bubbleComplete: [],
        tools: [],
        approvals: [],
      },
    ];
    index = next.length - 1;
  }
  const group = next[index] as ReplyGroup;
  const activeReasoningItemIds = Array.isArray(group.activeReasoningItemIds)
    ? group.activeReasoningItemIds
    : [];
  let updated = group;
  if (event.type === "thinking-started") {
    updated = {
      ...group,
      activeReasoningItemIds: activeReasoningItemIds.includes(event.itemId)
        ? activeReasoningItemIds
        : [...activeReasoningItemIds, event.itemId],
    };
  } else if (event.type === "thinking-delta" && event.itemId) {
    updated = {
      ...group,
      activeReasoningItemIds: activeReasoningItemIds.includes(event.itemId)
        ? activeReasoningItemIds
        : [...activeReasoningItemIds, event.itemId],
    };
  } else if (event.type === "thinking-completed") {
    updated = {
      ...group,
      activeReasoningItemIds: activeReasoningItemIds.filter(
        (itemId) => itemId !== event.itemId,
      ),
    };
  } else if (event.type === "assistant-delta") {
    const raw = group.raw + event.delta;
    const format = event.format ?? group.format;
    const parsed = parseReply(raw, format);
    updated = {
      ...group,
      raw,
      format,
      thinking: parsed.thinking,
      preToolBubbles: parsed.preToolBubbles,
      preToolBubbleIds: alignIds(
        group.preToolBubbleIds,
        parsed.preToolBubbles.length,
      ),
      preToolBubbleComplete: parsed.preToolBubbleComplete,
      preToolComplete: parsed.preToolComplete,
      bubbles: parsed.bubbles,
      bubbleIds: alignIds(group.bubbleIds, parsed.bubbles.length),
      bubbleComplete: parsed.bubbleComplete,
      tools: group.tools.map((tool, toolIndex) => ({
        ...tool,
        summary: parsed.toolSummaries[toolIndex] || tool.summary,
      })),
    };
  } else if (event.type === "files") {
    updated = {
      ...group,
      files: [
        ...(group.files ?? []).filter(
          (file) => !event.files.some((incoming) => incoming.id === file.id),
        ),
        ...event.files,
      ],
    };
  } else if (event.type === "tool") {
    const toolIndex = group.tools.findIndex(
      (tool) => tool.id === event.tool.id,
    );
    const parsedSummaries = parsePublicReply(group.raw).toolSummaries;
    const normalized = {
      ...event.tool,
      rawName: event.tool.rawName || event.tool.name,
      result: event.tool.result ?? event.tool.detail,
      summary:
        event.tool.summary ||
        parsedSummaries[toolIndex < 0 ? group.tools.length : toolIndex],
    };
    updated = {
      ...group,
      tools:
        toolIndex >= 0
          ? group.tools.map((tool) =>
              tool.id === event.tool.id
                ? {
                    ...tool,
                    ...normalized,
                    summary: normalized.summary || tool.summary,
                  }
                : tool,
            )
          : [...group.tools, normalized],
    };
  } else if (event.type === "approval")
    updated = { ...group, approvals: [...group.approvals, event.approval] };
  else if (event.type === "turn-completed") {
    const parsed = parseReply(group.raw, group.format, true);
    const needsCompatibilityBridge =
      group.tools.length > 0 &&
      (parsed.preToolBubbles.length === 0 || !parsed.preToolComplete);
    updated = {
      ...group,
      activeReasoningItemIds: [],
      thinking: parsed.thinking,
      preToolBubbles: parsed.preToolBubbles,
      preToolBubbleIds: alignIds(
        group.preToolBubbleIds,
        parsed.preToolBubbles.length,
      ),
      preToolBubbleComplete: parsed.preToolBubbleComplete,
      preToolComplete: parsed.preToolComplete,
      bubbles: parsed.bubbles,
      bubbleIds: alignIds(group.bubbleIds, parsed.bubbles.length),
      bubbleComplete: parsed.bubbleComplete,
      tools: group.tools.map((tool, toolIndex) => ({
        ...tool,
        summary: parsed.toolSummaries[toolIndex] || tool.summary,
      })),
      status: event.status,
      ...(needsCompatibilityBridge
        ? {
            preToolBubbles: ["我先确认一下。"],
            preToolBubbleIds:
              group.preToolBubbleIds.length > 0
                ? [group.preToolBubbleIds[0]]
                : [createId()],
            preToolBubbleComplete: [true],
            preToolComplete: true,
          }
        : {}),
    };
  }
  return [...next.slice(0, index), updated, ...next.slice(index + 1)];
}

export function closePendingGroup(
  groups: ChatGroup[],
  groupId: string,
): ChatGroup[] {
  return groups.map((group) =>
    group.role === "user" && group.groupId === groupId
      ? { ...group, pending: false }
      : group,
  );
}

export function finalizeReplyGroup(
  groups: ChatGroup[],
  turnId: string,
  status: string,
): ChatGroup[] {
  const group = groups.find(
    (item) => item.role === "assistant" && item.replyGroupId === turnId,
  );
  if (!group || group.role !== "assistant") return groups;
  return applyReplyEvent(
    groups,
    { type: "turn-completed", turnId, status },
    group.time,
  );
}

export function saveChatGroups(
  storage: Pick<Storage, "setItem">,
  groups: ChatGroup[],
): void {
  storage.setItem(CHAT_STORAGE_KEY, JSON.stringify(groups));
}
export function loadChatGroups(storage: Pick<Storage, "getItem">): ChatGroup[] {
  try {
    const value: unknown = JSON.parse(
      storage.getItem(CHAT_STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(value)) return [];
    return (value as ChatGroup[]).map((group) => {
      if (group.role !== "assistant") return group;
      const parsed = parseReply(
        typeof group.raw === "string" ? group.raw : "",
        group.format,
        Boolean(group.status),
      );
      const preToolBubbles =
        Array.isArray(group.preToolBubbles) && group.preToolBubbles.length > 0
          ? group.preToolBubbles
          : parsed.preToolBubbles;
      const bubbles =
        Array.isArray(group.bubbles) && group.bubbles.length > 0
          ? group.bubbles
          : parsed.bubbles;
      return {
        ...group,
        activeReasoningItemIds:
          group.status || !Array.isArray(group.activeReasoningItemIds)
            ? []
            : group.activeReasoningItemIds.filter(
                (itemId): itemId is string => typeof itemId === "string",
              ),
        preToolBubbles,
        preToolBubbleIds: alignIds(
          Array.isArray(group.preToolBubbleIds) ? group.preToolBubbleIds : [],
          preToolBubbles.length,
        ),
        preToolBubbleComplete: alignCompletion(
          Array.isArray(group.preToolBubbleComplete)
            ? group.preToolBubbleComplete
            : parsed.preToolBubbleComplete,
          preToolBubbles.length,
          Boolean(group.status),
        ),
        preToolComplete:
          typeof group.preToolComplete === "boolean"
            ? group.preToolComplete
            : parsed.preToolComplete ||
              (Boolean(group.status) && preToolBubbles.length > 0),
        bubbles,
        bubbleIds: alignIds(
          Array.isArray(group.bubbleIds) ? group.bubbleIds : [],
          bubbles.length,
        ),
        bubbleComplete: alignCompletion(
          Array.isArray(group.bubbleComplete)
            ? group.bubbleComplete
            : parsed.bubbleComplete,
          bubbles.length,
          Boolean(group.status),
        ),
      };
    });
  } catch {
    return [];
  }
}

function alignIds(existing: string[], length: number): string[] {
  const ids = existing.slice(0, length);
  while (ids.length < length) ids.push(createId());
  return ids;
}

function alignCompletion(
  existing: boolean[],
  length: number,
  completedFallback: boolean,
): boolean[] {
  const completion = existing.slice(0, length);
  while (completion.length < length) completion.push(completedFallback);
  return completion;
}
