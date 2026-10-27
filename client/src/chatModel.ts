import { createId } from "./id";
import type { Approval, ChatEvent, ToolEvent } from "./types";

export const CHAT_STORAGE_KEY = "mian.chat-groups.v2";

export type UserRecord = { messageId: string; text: string; time: string };
export type UserGroup = {
  groupId: string;
  role: "user";
  time: string;
  pending: boolean;
  records: UserRecord[];
};
export type ReplyGroup = {
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
};
export type ChatGroup = UserGroup | ReplyGroup;

export function isThinkingRunning(reply: ReplyGroup): boolean {
  return (
    Array.isArray(reply.activeReasoningItemIds) &&
    reply.activeReasoningItemIds.length > 0
  );
}

export function buildPublicReplyPrompt(userText: string): string {
  return `[USER_RECORDS]\n${userText}\n[/USER_RECORDS]`;
}

type TaggedSegment = {
  content: string;
  complete: boolean;
  start: number;
  end: number;
};

const protocolMarkers = [
  "<mian-thinking>",
  "</mian-thinking>",
  "<mian-pre-tool>",
  "</mian-pre-tool>",
  "<mian-tool-summary>",
  "</mian-tool-summary>",
  "<mian-bubble>",
  "</mian-bubble>",
];

function normalizeBubbleBody(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\n[\t ]*\n(?:[\t ]*\n)+/g, "\n\n")
    .trim();
}

function hideTrailingPartialMarker(value: string, final: boolean): string {
  const start = value.lastIndexOf("<");
  if (start < 0) return value;
  const fragment = value.slice(start);
  const isMarkerPrefix = protocolMarkers.some((marker) =>
    marker.startsWith(fragment),
  );
  if (!isMarkerPrefix || (final && fragment === "<")) return value;
  return value.slice(0, start);
}

function taggedSegments(
  raw: string,
  tag: string,
  final: boolean,
): TaggedSegment[] {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const segments: TaggedSegment[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf(open, cursor);
    if (start < 0) break;
    const contentStart = start + open.length;
    const closeStart = raw.indexOf(close, contentStart);
    if (closeStart < 0) {
      segments.push({
        content: hideTrailingPartialMarker(raw.slice(contentStart), final),
        complete: false,
        start,
        end: raw.length,
      });
      break;
    }
    segments.push({
      content: raw.slice(contentStart, closeStart),
      complete: true,
      start,
      end: closeStart + close.length,
    });
    cursor = closeStart + close.length;
  }
  return segments;
}

function maskRanges(raw: string, ranges: Array<{ start: number; end: number }>) {
  let masked = raw;
  for (const range of [...ranges].sort((left, right) => right.start - left.start))
    masked =
      masked.slice(0, range.start) +
      " ".repeat(Math.max(0, range.end - range.start)) +
      masked.slice(range.end);
  return masked;
}

function stripProtocolMarkers(value: string): string {
  let stripped = value;
  for (const marker of protocolMarkers) stripped = stripped.split(marker).join("");
  const lastOpen = stripped.lastIndexOf("<");
  if (lastOpen >= 0) {
    const fragment = stripped.slice(lastOpen);
    if (
      fragment.length > 1 &&
      protocolMarkers.some((marker) => marker.startsWith(fragment))
    )
      stripped = stripped.slice(0, lastOpen);
  }
  return stripped;
}

export function parsePublicReply(
  raw: string,
  options: { final?: boolean } = {},
): {
  thinking: string;
  preToolBubbles: string[];
  preToolBubbleComplete: boolean[];
  preToolComplete: boolean;
  toolSummaries: string[];
  bubbles: string[];
  bubbleComplete: boolean[];
} {
  const final = options.final === true;
  const thinkingSegments = taggedSegments(raw, "mian-thinking", final);
  const thinking = normalizeBubbleBody(thinkingSegments[0]?.content ?? "");
  const summarySegments = taggedSegments(raw, "mian-tool-summary", final);
  const toolSummaries = summarySegments
    .filter((segment) => segment.complete)
    .map((segment) => normalizeBubbleBody(segment.content))
    .filter((summary) => /^[\u3400-\u9fff]{4,12}$/.test(summary));

  const preToolContainers = taggedSegments(raw, "mian-pre-tool", final);
  const preToolBubbles: string[] = [];
  const preToolBubbleComplete: boolean[] = [];
  let everyPreToolContainerComplete = preToolContainers.length > 0;
  for (const container of preToolContainers) {
    everyPreToolContainerComplete &&= container.complete;
    const nested = taggedSegments(container.content, "mian-bubble", final);
    if (nested.length > 0) {
      for (const segment of nested) {
        const content = normalizeBubbleBody(segment.content);
        if (!content) continue;
        preToolBubbles.push(content);
        preToolBubbleComplete.push(segment.complete);
      }
      continue;
    }
    // Compatibility with already persisted replies using the original
    // <mian-pre-tool>text</mian-pre-tool> shape.
    const legacy = normalizeBubbleBody(
      stripProtocolMarkers(
        hideTrailingPartialMarker(container.content, final),
      ),
    );
    if (legacy) {
      preToolBubbles.push(legacy);
      preToolBubbleComplete.push(container.complete);
    }
  }

  const postRaw = maskRanges(raw, preToolContainers);
  const postSegments = taggedSegments(postRaw, "mian-bubble", final);
  const bubbles: string[] = [];
  const bubbleComplete: boolean[] = [];
  for (const segment of postSegments) {
    const content = normalizeBubbleBody(segment.content);
    if (!content) continue;
    bubbles.push(content);
    bubbleComplete.push(segment.complete);
  }

  if (final && postSegments.length === 0) {
    const controlRanges = [
      ...preToolContainers,
      ...thinkingSegments,
      ...summarySegments,
    ];
    const fallback = normalizeBubbleBody(
      stripProtocolMarkers(maskRanges(raw, controlRanges)),
    );
    if (fallback) {
      bubbles.push(fallback);
      bubbleComplete.push(true);
    }
  }

  return {
    thinking,
    preToolBubbles,
    preToolBubbleComplete,
    preToolComplete:
      preToolBubbles.length > 0 &&
      everyPreToolContainerComplete &&
      preToolBubbleComplete.every(Boolean),
    toolSummaries,
    bubbles,
    bubbleComplete,
  };
}

export function visibleToolSummary(tool: ToolEvent): string {
  if (tool.summary && /^[\u3400-\u9fff]{4,12}$/.test(tool.summary)) return tool.summary;
  const kind = (tool.kind || tool.rawName || "").toLowerCase();
  if (kind.includes("read_file") || kind.includes("readfile")) return "读取文件";
  if (kind.includes("write_file") || kind.includes("filechange")) return "修改文件";
  if (kind.includes("list_directory") || kind.includes("listdirectory")) return "查看目录";
  if (kind.includes("mcp") || kind.includes("dynamictool")) return "调用外部工具";
  if (kind.includes("websearch")) return "搜索网页";
  if (kind.includes("imageview")) return "查看图片";
  return "执行命令";
}

function stripTerminalControl(text: string): string {
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").trim();
}

export function readableToolResult(tool: ToolEvent): string {
  let text = stripTerminalControl(String(tool.result ?? tool.detail ?? ""));
  if (!text) {
    if (tool.state === "running") return "";
    if (tool.state === "success") return "工具已完成，无额外输出";
    if (tool.state === "rejected") return "工具调用已拒绝，无额外输出";
    return "工具执行失败，无额外错误信息";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
    if (typeof parsed === "string") text = parsed;
  } catch {
    parsed = undefined;
  }
  if (/\bGet-Location\b/i.test(tool.command || "")) {
    if (parsed && typeof parsed === "object" && "Path" in parsed) {
      return `当前工作目录：\n${String((parsed as { Path: unknown }).Path)}`;
    }
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/^Path$/i.test(line) && !/^-+$/.test(line));
    const path = lines.find((line) => /^[A-Za-z]:\\/.test(line));
    if (path) return `当前工作目录：\n${path}`;
  }
  return text;
}

export function appendUserRecord(
  groups: ChatGroup[],
  text: string,
  time: string,
  messageId = createId(),
  groupId = createId(),
): ChatGroup[] {
  const last = groups.at(-1);
  const record = { messageId, text, time };
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

export function recoverLastUnansweredUserGroup(groups: ChatGroup[]): ChatGroup[] {
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
    const parsed = parsePublicReply(raw);
    updated = {
      ...group,
      raw,
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
  } else if (event.type === "tool") {
    const toolIndex = group.tools.findIndex((tool) => tool.id === event.tool.id);
    const parsedSummaries = parsePublicReply(group.raw).toolSummaries;
    const normalized = { ...event.tool, rawName: event.tool.rawName || event.tool.name, result: event.tool.result ?? event.tool.detail, summary: event.tool.summary || parsedSummaries[toolIndex < 0 ? group.tools.length : toolIndex] };
    updated = {
      ...group,
      tools: toolIndex >= 0
        ? group.tools.map((tool) =>
            tool.id === event.tool.id ? { ...tool, ...normalized, summary: normalized.summary || tool.summary } : tool,
          )
        : [...group.tools, normalized],
    };
  } else if (event.type === "approval")
    updated = { ...group, approvals: [...group.approvals, event.approval] };
  else if (event.type === "turn-completed") {
    const parsed = parsePublicReply(group.raw, { final: true });
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
      const parsed = parsePublicReply(
        typeof group.raw === "string" ? group.raw : "",
        { final: Boolean(group.status) },
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
          Array.isArray(group.preToolBubbleIds)
            ? group.preToolBubbleIds
            : [],
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
