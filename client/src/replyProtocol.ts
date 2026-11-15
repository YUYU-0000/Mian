import type { ReplyFormat } from "./types";

export function parseReply(raw: string, format?: ReplyFormat, final = false) {
  if (format !== "plain")
    return parsePublicReply(raw, { final, plainStreaming: format === "api" });
  return {
    thinking: "",
    preToolBubbles: [],
    preToolBubbleComplete: [],
    preToolComplete: false,
    toolSummaries: [],
    bubbles: raw ? [raw] : [],
    bubbleComplete: raw ? [final] : [],
  };
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
  let fence = "";
  let blanks = 0;
  // 聊天段落收拢空行，代码围栏里的空白原样保留。
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (
          marker &&
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length &&
          !marker[2].trim()
        )
          fence = "";
        return true;
      }
      if (marker) fence = marker[1];
      blanks = line.trim() ? 0 : blanks + 1;
      return blanks <= 1;
    })
    .join("\n");
  return /^( {4}|\t)/.test(normalized)
    ? normalized.trimEnd()
    : normalized.trim();
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

function withoutRanges(
  raw: string,
  ranges: Array<{ start: number; end: number }>,
) {
  let masked = raw;
  for (const range of [...ranges].sort(
    (left, right) => right.start - left.start,
  ))
    masked = masked.slice(0, range.start) + masked.slice(range.end);
  return masked;
}

export function stripProtocolMarkers(value: string): string {
  let stripped = value;
  for (const marker of protocolMarkers)
    stripped = stripped.split(marker).join("");
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
  options: { final?: boolean; plainStreaming?: boolean } = {},
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
    // 兼容旧记录里直接写在 pre-tool 标签中的正文。
    const legacy = normalizeBubbleBody(
      stripProtocolMarkers(hideTrailingPartialMarker(container.content, final)),
    );
    if (legacy) {
      preToolBubbles.push(legacy);
      preToolBubbleComplete.push(container.complete);
    }
  }

  const postRaw = withoutRanges(raw, preToolContainers);
  const postSegments = taggedSegments(postRaw, "mian-bubble", final);
  const bubbles: string[] = [];
  const bubbleComplete: boolean[] = [];
  for (const segment of postSegments) {
    const content = normalizeBubbleBody(segment.content);
    if (!content) continue;
    bubbles.push(content);
    bubbleComplete.push(segment.complete);
  }

  if ((final || options.plainStreaming) && postSegments.length === 0) {
    const controlRanges = [
      ...preToolContainers,
      ...thinkingSegments,
      ...summarySegments,
    ];
    const fallback = normalizeBubbleBody(
      stripProtocolMarkers(
        hideTrailingPartialMarker(withoutRanges(raw, controlRanges), final),
      ),
    );
    if (fallback) {
      bubbles.push(fallback);
      bubbleComplete.push(final);
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
