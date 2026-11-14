import { randomUUID } from "node:crypto";
import { apiRequestMessages } from "./apiPrompt.js";
import {
  completeChat,
  providerMessage,
  type ChatMessage,
  type ProviderConfig,
  type TokenUsage,
} from "./providers/openai.js";

type ActiveTurn = { turnId: string; controller: AbortController };
type ApiChatEvent = {
  type: "turn-started" | "assistant-delta" | "turn-completed";
  conversationId: string;
  turnId: string;
  format: "api";
  delta?: string;
  immediate?: boolean;
  status?: string;
  error?: string;
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
    void this.run(
      conversationId,
      turn,
      config,
      apiRequestMessages(messages, localTime),
    );
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
  ) {
    const base = {
      conversationId,
      turnId: turn.turnId,
      format: "api" as const,
    };
    let status = "completed";
    let error: string | undefined;
    let usage: TokenUsage | undefined;
    try {
      for await (const event of completeChat(
        config,
        messages,
        turn.controller.signal,
      )) {
        if (event.type === "usage") usage = event.usage;
        else
          this.emit({
            ...base,
            type: "assistant-delta",
            delta: event.text,
            immediate: event.immediate && !event.text.includes("<mian-"),
          });
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
