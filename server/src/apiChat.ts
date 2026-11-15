import { randomUUID } from "node:crypto";
import type { ChatEvent } from "../../shared/types.mjs";
import { parseReply } from "../../shared/replyProtocol.mjs";
import { ChatFiles } from "./chatFiles.js";
import { completeClueChat, type ApiClues } from "./clueChat.js";
import {
  providerMessage,
  type ChatMessage,
  type ProviderConfig,
  type TokenUsage,
} from "./providers/openai.js";

type ActiveTurn = { turnId: string; controller: AbortController };
type ApiChatEvent = Extract<ChatEvent, { type: "turn-started" | "assistant-delta" | "files" | "turn-completed" }> & {
  conversationId: string;
  format: "api";
};

// API 通道沿用会话事件，不产生工具或审批事件。
export class ApiChat {
  private readonly turns = new Map<string, ActiveTurn>();

  constructor(
    private readonly emit: (event: ApiChatEvent) => void,
    private readonly recordUsage: (
      conversationId: string,
      usage: TokenUsage,
    ) => Promise<void>,
    private readonly files = new ChatFiles(),
  ) {}

  getActiveTurns() {
    return Object.fromEntries(
      [...this.turns].map(([id, turn]) => [id, turn.turnId]),
    );
  }

  isBusy(conversationId: string) {
    return this.turns.has(conversationId);
  }

  startTurn(
    conversationId: string,
    config: ProviderConfig,
    messages: ChatMessage[],
    localTime = `現在是 ${new Date().toLocaleString("zh-CN", { dateStyle: "full", timeStyle: "short", hour12: false })}`,
    clues?: ApiClues,
    protocol?: string,
  ) {
    if (this.isBusy(conversationId))
      throw new Error("当前会话已有正在运行的 turn");
    const turn = { turnId: randomUUID(), controller: new AbortController() };
    this.turns.set(conversationId, turn);
    this.emit({
      type: "turn-started",
      conversationId,
      turnId: turn.turnId,
      format: "api",
    });
    void this.run(conversationId, turn, config, messages, localTime, clues, protocol);
    return { conversationId, turnId: turn.turnId };
  }

  interrupt(turnId: string, conversationId: string) {
    const turn = this.turns.get(conversationId);
    if (!turn || turn.turnId !== turnId)
      throw new Error("当前 turn 不属于这个会话");
    turn.controller.abort();
  }

  close() {
    for (const turn of this.turns.values()) turn.controller.abort();
  }

  private async run(
    conversationId: string,
    turn: ActiveTurn,
    config: ProviderConfig,
    messages: ChatMessage[],
    localTime: string,
    clues?: ApiClues,
    protocol?: string,
  ) {
    const base = {
      conversationId,
      turnId: turn.turnId,
      format: "api" as const,
    };
    let status = "completed";
    let error: string | undefined;
    let usage: TokenUsage | undefined;
    let raw = "";
    try {
      for await (const event of completeClueChat(
        config,
        messages,
        localTime,
        turn.controller.signal,
        clues,
        protocol,
      )) {
        if (event.type === "usage") usage = event.usage;
        else if (event.type === "text") {
          raw += event.text;
          this.emit({
            ...base,
            type: "assistant-delta",
            delta: event.text,
            immediate: event.immediate && !event.text.includes("<mian-") && !event.text.includes("<voice"),
          });
        }
      }
      for (const output of parseReply(raw, "api", true).files ?? []) {
        if (!output.complete) continue;
        turn.controller.signal.throwIfAborted();
        const file = await this.files.save(conversationId, output.name, Buffer.from(output.content, "utf8"), "text/plain", turn.turnId);
        this.emit({ ...base, type: "files", files: [{ ...file, replyBubbleId: `${turn.turnId}:${output.section}:${output.index}` }] });
      }
    } catch (cause) {
      status = turn.controller.signal.aborted ? "interrupted" : "failed";
      if (status === "failed")
        error = providerMessage((cause as Error).message);
    }
    try {
      if (usage) await this.recordUsage(conversationId, usage);
    } catch (cause) {
      console.error("[api-usage]", cause);
    } finally {
      this.turns.delete(conversationId);
      this.emit({ ...base, type: "turn-completed", status, error });
    }
  }
}
