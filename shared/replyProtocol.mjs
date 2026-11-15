export function parseReply(raw, format, final = false) {
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
export function buildPublicReplyPrompt(userText) {
    return `[USER_RECORDS]\n${userText}\n[/USER_RECORDS]`;
}
const protocolMarkers = [
    "<mian-thinking>",
    "</mian-thinking>",
    "<mian-pre-tool>",
    "</mian-pre-tool>",
    "<mian-tool-summary>",
    "</mian-tool-summary>",
    "<mian-bubble>",
    "</mian-bubble>",
    "<voice>",
    "</voice>",
];
function normalizeBubbleBody(value) {
    let fence = "";
    let blanks = 0;
    // 聊天段落收拢空行，代码围栏里的空白原样保留。
    const normalized = value
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .filter((line) => {
        const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
        if (fence) {
            if (marker &&
                marker[1][0] === fence[0] &&
                marker[1].length >= fence.length &&
                !marker[2].trim())
                fence = "";
            return true;
        }
        if (marker)
            fence = marker[1];
        blanks = line.trim() ? 0 : blanks + 1;
        return blanks <= 1;
    })
        .join("\n");
    return /^( {4}|\t)/.test(normalized)
        ? normalized.trimEnd()
        : normalized.trim();
}
function hideTrailingPartialMarker(value, final) {
    const start = value.lastIndexOf("<");
    if (start < 0)
        return value;
    const fragment = value.slice(start);
    const isMarkerPrefix = protocolMarkers.some((marker) => marker.startsWith(fragment));
    if (!isMarkerPrefix || (final && fragment === "<"))
        return value;
    return value.slice(0, start);
}
function taggedSegments(raw, tag, final) {
    const open = `<${tag}>`;
    const close = `</${tag}>`;
    const segments = [];
    let cursor = 0;
    while (cursor < raw.length) {
        const start = raw.indexOf(open, cursor);
        if (start < 0)
            break;
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
function withoutRanges(raw, ranges) {
    let masked = raw;
    for (const range of [...ranges].sort((left, right) => right.start - left.start))
        masked = masked.slice(0, range.start) + masked.slice(range.end);
    return masked;
}
function replySegments(raw, final) {
    const bubbles = taggedSegments(raw, "mian-bubble", final);
    const voices = taggedSegments(raw, "voice", final);
    const segments = voices.map(segment => ({ ...segment, voice: true }));
    for (const bubble of bubbles) {
        const contentStart = bubble.start + "<mian-bubble>".length;
        const nested = voices.filter(voice => voice.start >= contentStart && voice.start < bubble.end);
        if (!nested.length) {
            segments.push(bubble);
            continue;
        }
        let cursor = contentStart;
        for (const voice of nested) {
            segments.push({ content: raw.slice(cursor, voice.start), start: cursor, complete: true });
            cursor = voice.end;
        }
        segments.push({ content: raw.slice(cursor, contentStart + bubble.content.length), start: cursor, complete: bubble.complete });
    }
    return segments.sort((left, right) => left.start - right.start);
}
export function stripProtocolMarkers(value) {
    let stripped = value;
    for (const marker of protocolMarkers)
        stripped = stripped.split(marker).join("");
    const lastOpen = stripped.lastIndexOf("<");
    if (lastOpen >= 0) {
        const fragment = stripped.slice(lastOpen);
        if (fragment.length > 1 &&
            protocolMarkers.some((marker) => marker.startsWith(fragment)))
            stripped = stripped.slice(0, lastOpen);
    }
    return stripped;
}
export function parsePublicReply(raw, options = {}) {
    const final = options.final === true;
    const thinkingSegments = taggedSegments(raw, "mian-thinking", final);
    const thinking = normalizeBubbleBody(thinkingSegments[0]?.content ?? "");
    const summarySegments = taggedSegments(raw, "mian-tool-summary", final);
    const toolSummaries = summarySegments
        .filter((segment) => segment.complete)
        .map((segment) => normalizeBubbleBody(segment.content))
        .filter((summary) => /^[\u3400-\u9fff]{4,12}$/.test(summary));
    const preToolContainers = taggedSegments(raw, "mian-pre-tool", final);
    const preToolBubbles = [];
    const preToolBubbleComplete = [];
    const voices = [];
    let everyPreToolContainerComplete = preToolContainers.length > 0;
    for (const container of preToolContainers) {
        everyPreToolContainerComplete &&= container.complete;
        const nested = replySegments(container.content, final);
        if (nested.length > 0) {
            for (const segment of nested) {
                const content = normalizeBubbleBody(segment.content);
                if (!content)
                    continue;
                if (segment.voice)
                    voices.push({ section: "pre-tool", index: preToolBubbles.length, text: content, complete: segment.complete });
                preToolBubbles.push(content);
                preToolBubbleComplete.push(segment.complete);
            }
            continue;
        }
        // 兼容旧记录里直接写在 pre-tool 标签中的正文。
        const legacy = normalizeBubbleBody(stripProtocolMarkers(hideTrailingPartialMarker(container.content, final)));
        if (legacy) {
            preToolBubbles.push(legacy);
            preToolBubbleComplete.push(container.complete);
        }
    }
    const postRaw = withoutRanges(raw, preToolContainers);
    const postSegments = replySegments(postRaw, final);
    const bubbles = [];
    const bubbleComplete = [];
    for (const segment of postSegments) {
        const content = normalizeBubbleBody(segment.content);
        if (!content)
            continue;
        if (segment.voice)
            voices.push({ section: "bubble", index: bubbles.length, text: content, complete: segment.complete });
        bubbles.push(content);
        bubbleComplete.push(segment.complete);
    }
    if ((final || options.plainStreaming) && postSegments.length === 0) {
        const controlRanges = [
            ...preToolContainers,
            ...thinkingSegments,
            ...summarySegments,
        ];
        const fallback = normalizeBubbleBody(stripProtocolMarkers(hideTrailingPartialMarker(withoutRanges(raw, controlRanges), final)));
        if (fallback) {
            bubbles.push(fallback);
            bubbleComplete.push(final);
        }
    }
    return {
        thinking,
        preToolBubbles,
        preToolBubbleComplete,
        preToolComplete: preToolBubbles.length > 0 &&
            everyPreToolContainerComplete &&
            preToolBubbleComplete.every(Boolean),
        toolSummaries,
        bubbles,
        bubbleComplete,
        ...(voices.length ? { voices } : {}),
    };
}
