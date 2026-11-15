import type { ReplyFormat } from "./types.mjs";
export type ReplyVoice = { section: "pre-tool" | "bubble"; index: number; text: string; complete: boolean };
export declare function parseReply(raw: string, format?: ReplyFormat, final?: boolean): {
    thinking: string;
    preToolBubbles: string[];
    preToolBubbleComplete: boolean[];
    preToolComplete: boolean;
    toolSummaries: string[];
    bubbles: string[];
    bubbleComplete: boolean[];
    voices?: ReplyVoice[];
};
export declare function buildPublicReplyPrompt(userText: string): string;
export declare function stripProtocolMarkers(value: string): string;
export declare function parsePublicReply(raw: string, options?: {
    final?: boolean;
    plainStreaming?: boolean;
}): {
    thinking: string;
    preToolBubbles: string[];
    preToolBubbleComplete: boolean[];
    preToolComplete: boolean;
    toolSummaries: string[];
    bubbles: string[];
    bubbleComplete: boolean[];
    voices?: ReplyVoice[];
};
