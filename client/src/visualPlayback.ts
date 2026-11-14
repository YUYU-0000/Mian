export const ASSISTANT_CHARACTER_MS = 50;
export const FAST_CHARACTER_MS = 30;
export const BUBBLE_PAUSE_MS = 300;

export type VisualCursor =
  | { kind: "thinking" }
  | { kind: "tool"; toolId: string }
  | { kind: "preToolBubble"; index: number }
  | { kind: "bubble"; index: number };

export type VisualTarget = {
  thinking: string;
  preToolBubbles: string[];
  tools: Array<{ id: string; text: string; tool?: ToolEvent }>;
  bubbles: string[];
  done: boolean;
};

export type VisualReply = {
  thinking: string;
  preToolBubbles: string[];
  visiblePreToolBubbleCount: number;
  tools: Record<string, string>;
  visibleToolIds: string[];
  toolStates: Record<string, ToolEvent>;
  bubbles: string[];
  visibleBubbleCount: number;
  preToolBubbleReadyAt: Record<number, number>;
  bubbleReadyAt: Record<number, number>;
  cursor: VisualCursor | null;
  channelKey: string | null;
  nextCharacterAt: number;
};

export type PlaybackTick = {
  view: VisualReply;
  changed: boolean;
  wait: number | null;
  settled: boolean;
};

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export function splitGraphemes(value: string): string[] {
  if (segmenter)
    return Array.from(segmenter.segment(value), (part) => part.segment);
  return Array.from(value);
}

function nextGrapheme(displayed: string, target: string): string {
  if (!target.startsWith(displayed)) return target;
  return splitGraphemes(target.slice(displayed.length))[0] ?? "";
}

function sameCursor(left: VisualCursor | null, right: VisualCursor | null) {
  if (left?.kind !== right?.kind) return false;
  if (!left || !right) return left === right;
  if (left.kind === "tool" && right.kind === "tool")
    return left.toolId === right.toolId;
  if (left.kind === "preToolBubble" && right.kind === "preToolBubble")
    return left.index === right.index;
  if (left.kind === "bubble" && right.kind === "bubble")
    return left.index === right.index;
  return true;
}

function channelKey(cursor: VisualCursor): string {
  if (cursor.kind === "thinking") return "thinking";
  if (cursor.kind === "tool") return `tool:${cursor.toolId}`;
  if (cursor.kind === "preToolBubble") return `pre-tool:${cursor.index}`;
  return `bubble:${cursor.index}`;
}

function speedFor(cursor: VisualCursor): number {
  return cursor.kind === "bubble" || cursor.kind === "preToolBubble"
    ? ASSISTANT_CHARACTER_MS
    : FAST_CHARACTER_MS;
}

function pendingChannel(
  view: VisualReply,
  target: VisualTarget,
): VisualCursor | null {
  if (view.thinking !== target.thinking) return { kind: "thinking" };
  for (let index = 0; index < target.preToolBubbles.length; index += 1)
    if ((view.preToolBubbles[index] ?? "") !== target.preToolBubbles[index])
      return { kind: "preToolBubble", index };
  for (const tool of target.tools)
    if (
      !view.visibleToolIds.includes(tool.id) ||
      (view.tools[tool.id] ?? "") !== tool.text ||
      (tool.tool &&
        (view.toolStates[tool.id]?.state !== tool.tool.state ||
          view.toolStates[tool.id]?.summary !== tool.tool.summary ||
          view.toolStates[tool.id]?.command !== tool.tool.command))
    )
      return { kind: "tool", toolId: tool.id };
  for (let index = 0; index < target.bubbles.length; index += 1)
    if ((view.bubbles[index] ?? "") !== target.bubbles[index])
      return { kind: "bubble", index };
  return null;
}

function currentText(view: VisualReply, cursor: VisualCursor): string {
  if (cursor.kind === "thinking") return view.thinking;
  if (cursor.kind === "preToolBubble")
    return view.preToolBubbles[cursor.index] ?? "";
  if (cursor.kind === "tool") return view.tools[cursor.toolId] ?? "";
  return view.bubbles[cursor.index] ?? "";
}

function targetText(target: VisualTarget, cursor: VisualCursor): string {
  if (cursor.kind === "thinking") return target.thinking;
  if (cursor.kind === "preToolBubble")
    return target.preToolBubbles[cursor.index] ?? "";
  if (cursor.kind === "tool")
    return target.tools.find((tool) => tool.id === cursor.toolId)?.text ?? "";
  return target.bubbles[cursor.index] ?? "";
}

function replaceText(
  view: VisualReply,
  cursor: VisualCursor,
  value: string,
): VisualReply {
  if (cursor.kind === "thinking") return { ...view, thinking: value };
  if (cursor.kind === "preToolBubble") {
    const preToolBubbles = [...view.preToolBubbles];
    preToolBubbles[cursor.index] = value;
    return { ...view, preToolBubbles };
  }
  if (cursor.kind === "tool")
    return { ...view, tools: { ...view.tools, [cursor.toolId]: value } };
  const bubbles = [...view.bubbles];
  bubbles[cursor.index] = value;
  return { ...view, bubbles };
}

export function emptyVisualReply(): VisualReply {
  return {
    thinking: "",
    preToolBubbles: [],
    visiblePreToolBubbleCount: 0,
    tools: {},
    visibleToolIds: [],
    toolStates: {},
    bubbles: [],
    visibleBubbleCount: 0,
    preToolBubbleReadyAt: {},
    bubbleReadyAt: {},
    cursor: { kind: "thinking" },
    channelKey: null,
    nextCharacterAt: 0,
  };
}

export function hydrateVisualReply(target: VisualTarget): VisualReply {
  return {
    thinking: target.thinking,
    preToolBubbles: [...target.preToolBubbles],
    visiblePreToolBubbleCount: target.preToolBubbles.length,
    tools: Object.fromEntries(target.tools.map((tool) => [tool.id, tool.text])),
    visibleToolIds: target.tools.map((tool) => tool.id),
    toolStates: Object.fromEntries(
      target.tools
        .filter((tool) => tool.tool)
        .map((tool) => [tool.id, tool.tool!]),
    ),
    bubbles: [...target.bubbles],
    visibleBubbleCount: target.bubbles.length,
    preToolBubbleReadyAt: {},
    bubbleReadyAt: {},
    cursor: null,
    channelKey: null,
    nextCharacterAt: 0,
  };
}

export function tickVisualReply(
  current: VisualReply,
  target: VisualTarget,
  now: number,
): PlaybackTick {
  let view = current;
  let changed = false;

  const preToolBubbles = [...view.preToolBubbles];
  while (preToolBubbles.length < target.preToolBubbles.length)
    preToolBubbles.push("");
  if (preToolBubbles.length !== view.preToolBubbles.length) {
    view = { ...view, preToolBubbles };
    changed = true;
  }

  const bubbles = [...view.bubbles];
  while (bubbles.length < target.bubbles.length) bubbles.push("");
  if (bubbles.length !== view.bubbles.length) {
    view = { ...view, bubbles };
    changed = true;
  }

  const candidate = pendingChannel(view, target);
  if (!candidate) {
    const cursor = target.done
      ? null
      : (view.cursor ?? { kind: "thinking" as const });
    if (!sameCursor(cursor, view.cursor)) {
      view = { ...view, cursor };
      changed = true;
    }
    return { view, changed, wait: null, settled: target.done };
  }

  if (
    candidate.kind === "preToolBubble" &&
    candidate.index >= view.visiblePreToolBubbleCount
  ) {
    if (candidate.index === 0) {
      view = {
        ...view,
        visiblePreToolBubbleCount: 1,
      };
      changed = true;
    } else {
      let readyAt = view.preToolBubbleReadyAt[candidate.index];
      if (readyAt === undefined) {
        readyAt = now + BUBBLE_PAUSE_MS;
        view = {
          ...view,
          preToolBubbleReadyAt: {
            ...view.preToolBubbleReadyAt,
            [candidate.index]: readyAt,
          },
        };
        changed = true;
      }
      if (readyAt > now)
        return {
          view,
          changed,
          wait: readyAt - now,
          settled: false,
        };
      view = {
        ...view,
        visiblePreToolBubbleCount: candidate.index + 1,
      };
      changed = true;
    }
  }

  if (
    candidate.kind === "bubble" &&
    candidate.index >= view.visibleBubbleCount
  ) {
    if (candidate.index === 0) {
      view = { ...view, visibleBubbleCount: 1 };
      changed = true;
    } else {
      let readyAt = view.bubbleReadyAt[candidate.index];
      if (readyAt === undefined) {
        readyAt = now + BUBBLE_PAUSE_MS;
        view = {
          ...view,
          bubbleReadyAt: { ...view.bubbleReadyAt, [candidate.index]: readyAt },
        };
        changed = true;
      }
      if (readyAt > now)
        return {
          view,
          changed,
          wait: readyAt - now,
          settled: false,
        };
      view = { ...view, visibleBubbleCount: candidate.index + 1 };
      changed = true;
    }
  }

  const key = channelKey(candidate);
  const readyAt = view.channelKey === key ? view.nextCharacterAt : now;
  if (readyAt > now) {
    if (!sameCursor(candidate, view.cursor)) {
      view = { ...view, cursor: candidate };
      changed = true;
    }
    return { view, changed, wait: readyAt - now, settled: false };
  }

  const displayed = currentText(view, candidate);
  const received = targetText(target, candidate);
  view = revealChannel(view, target, candidate);
  const grapheme = nextGrapheme(displayed, received);
  const value = received.startsWith(displayed)
    ? displayed + grapheme
    : received;
  view = replaceText(view, candidate, value);
  view = {
    ...view,
    cursor: candidate,
    channelKey: key,
    nextCharacterAt: now + speedFor(candidate),
  };
  changed = true;

  const remaining = pendingChannel(view, target);
  if (!remaining && target.done) {
    view = { ...view, cursor: null, channelKey: null, nextCharacterAt: 0 };
    return { view, changed: true, wait: null, settled: true };
  }
  if (
    (candidate.kind === "bubble" || candidate.kind === "preToolBubble") &&
    remaining?.kind === candidate.kind &&
    remaining.index === candidate.index + 1 &&
    value === received
  ) {
    const readyAt = now + BUBBLE_PAUSE_MS;
    view =
      candidate.kind === "bubble"
        ? {
            ...view,
            bubbleReadyAt: {
              ...view.bubbleReadyAt,
              [remaining.index]: readyAt,
            },
          }
        : {
            ...view,
            preToolBubbleReadyAt: {
              ...view.preToolBubbleReadyAt,
              [remaining.index]: readyAt,
            },
          };
    return {
      view,
      changed: true,
      wait: BUBBLE_PAUSE_MS,
      settled: false,
    };
  }
  return {
    view,
    changed,
    wait: remaining ? speedFor(candidate) : null,
    settled: false,
  };
}

function revealChannel(
  view: VisualReply,
  target: VisualTarget,
  cursor: VisualCursor,
): VisualReply {
  if (cursor.kind === "tool") {
    const tool = target.tools.find((tool) => tool.id === cursor.toolId)!;
    return {
      ...view,
      visibleToolIds: view.visibleToolIds.includes(tool.id)
        ? view.visibleToolIds
        : [...view.visibleToolIds, tool.id],
      toolStates: tool.tool
        ? { ...view.toolStates, [tool.id]: tool.tool }
        : view.toolStates,
    };
  }
  if (cursor.kind === "preToolBubble")
    return {
      ...view,
      visiblePreToolBubbleCount: Math.max(
        view.visiblePreToolBubbleCount,
        cursor.index + 1,
      ),
    };
  if (cursor.kind === "bubble")
    return {
      ...view,
      visibleBubbleCount: Math.max(view.visibleBubbleCount, cursor.index + 1),
    };
  return view;
}

// 按原打字速度估算积压，气泡间停顿也计入。
export function remainingPlaybackMs(view: VisualReply, target: VisualTarget) {
  const textCost = (displayed: string, received: string, speed: number) =>
    splitGraphemes(
      received.startsWith(displayed)
        ? received.slice(displayed.length)
        : received,
    ).length * speed;
  let duration = textCost(view.thinking, target.thinking, FAST_CHARACTER_MS);
  for (const [index, text] of target.preToolBubbles.entries()) {
    duration += textCost(
      view.preToolBubbles[index] ?? "",
      text,
      ASSISTANT_CHARACTER_MS,
    );
    if (index > 0 && index >= view.visiblePreToolBubbleCount)
      duration += BUBBLE_PAUSE_MS;
  }
  for (const tool of target.tools) {
    duration += textCost(
      view.tools[tool.id] ?? "",
      tool.text,
      FAST_CHARACTER_MS,
    );
    if (!view.visibleToolIds.includes(tool.id)) duration += FAST_CHARACTER_MS;
  }
  for (const [index, text] of target.bubbles.entries()) {
    duration += textCost(
      view.bubbles[index] ?? "",
      text,
      ASSISTANT_CHARACTER_MS,
    );
    if (index > 0 && index >= view.visibleBubbleCount)
      duration += BUBBLE_PAUSE_MS;
  }
  return duration;
}

// 追赶时只跳过前缀，最新的一小段继续逐字播放。
export function skipPlaybackPrefix(
  current: VisualReply,
  target: VisualTarget,
  milliseconds: number,
) {
  let view = current;
  let cursor: VisualCursor | null;
  while (milliseconds > 0 && (cursor = pendingChannel(view, target))) {
    if (
      cursor.kind === "bubble" &&
      cursor.index > 0 &&
      cursor.index >= view.visibleBubbleCount
    )
      milliseconds -= BUBBLE_PAUSE_MS;
    if (
      cursor.kind === "preToolBubble" &&
      cursor.index > 0 &&
      cursor.index >= view.visiblePreToolBubbleCount
    )
      milliseconds -= BUBBLE_PAUSE_MS;
    if (cursor.kind === "tool" && !view.visibleToolIds.includes(cursor.toolId))
      milliseconds -= FAST_CHARACTER_MS;
    view = revealChannel(view, target, cursor);
    const displayed = currentText(view, cursor);
    const received = targetText(target, cursor);
    const suffix = splitGraphemes(
      received.startsWith(displayed)
        ? received.slice(displayed.length)
        : received,
    );
    const count = Math.min(
      suffix.length,
      Math.max(0, Math.ceil(milliseconds / speedFor(cursor))),
    );
    view = replaceText(
      view,
      cursor,
      (received.startsWith(displayed) ? displayed : "") +
        suffix.slice(0, count).join(""),
    );
    milliseconds -= count * speedFor(cursor);
  }
  return {
    ...view,
    channelKey: null,
    nextCharacterAt: 0,
    preToolBubbleReadyAt: {},
    bubbleReadyAt: {},
  };
}

export function cursorMatches(
  cursor: VisualCursor | null,
  expected: VisualCursor,
): boolean {
  return sameCursor(cursor, expected);
}
import type { ToolEvent } from "./types";
