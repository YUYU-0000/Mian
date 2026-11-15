import { apiRequestMessages } from "./apiPrompt.js";
import type { Clue } from "./clues.js";
import {
  clueDirectory,
  cluePrompt,
  getActiveScenes,
  pinnedCluePrompt,
  selectCluePrompt,
  voiceCluePrompt,
} from "./clueSelection.js";
import {
  completeChat,
  providerJson,
  ProviderError,
  type ChatMessage,
  type ChatTool,
  type CompletionEvent,
  type ProviderConfig,
  type TokenUsage,
  type ToolCall,
} from "./providers/openai.js";

export type ApiClues = {
  cards: Clue[];
  recentMessages: ChatMessage[];
  toolsUnsupported?: boolean;
  markToolsUnsupported: () => Promise<void>;
};

const READ_CLUE_TOOLS: ChatTool[] = [{
  type: "function",
  function: {
    name: "read_clue",
    description: "讀取指定線索卡片的標題與內容，可以一次讀取多張卡片。",
    parameters: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" } } },
      required: ["ids"],
      additionalProperties: false,
    },
  },
}];

function readCards(cards: Clue[], call: ToolCall) {
  if (call.function.name !== "read_clue") return [];
  const { ids } = JSON.parse(call.function.arguments) as { ids: string[] };
  return ids.flatMap((id) => {
    const card = cards.find((item) => item.id === id);
    return card
      ? [{ id: card.id, title: card.title, content: card.content }]
      : [];
  });
}

// 工具消息只存在本次请求的上下文中，不进入聊天事件或记录。
export async function* completeClueChat(
  config: ProviderConfig,
  messages: ChatMessage[],
  localTime: string,
  signal: AbortSignal,
  clues?: ApiClues,
  protocol?: string,
): AsyncGenerator<CompletionEvent> {
  const cards = clues?.cards ?? [];
  const scenes = getActiveScenes();
  const triggers = cards.filter((card) => card.mode === "trigger");
  const pinned = pinnedCluePrompt(cards);
  let useTools = clues !== undefined && !clues.toolsUnsupported;
  const select = () =>
    selectCluePrompt(
      triggers,
      clues?.recentMessages ?? messages,
      async (system, history) => {
        const result = await providerJson(
          config,
          "chat/completions",
          {
            model: config.model,
            messages: [{ role: "system", content: system }, ...history],
            stream: false,
            max_tokens: 256,
          },
          AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
        );
        return result.choices[0].message.content;
      },
      scenes,
    );
  const instructions = useTools
    ? [cluePrompt(triggers, [], scenes), clueDirectory(triggers, true)]
        .filter(Boolean)
        .join("\n\n")
    : triggers.length ? await select() : "";
  const withVoice = (prompt: string) => [prompt, voiceCluePrompt(cards)].filter(Boolean).join("\n\n");
  let history = apiRequestMessages(messages, localTime, withVoice(instructions), protocol, pinned);
  let total: TokenUsage | undefined;
  let round = 0;
  while (true) {
    signal.throwIfAborted();
    const finish = useTools && round === 3;
    if (finish)
      history.push({ role: "user", content: "本輪不再讀卡，請根據已有內容直接回覆使用者。" });
    const tools = useTools ? READ_CLUE_TOOLS : undefined;
    const reading = useTools && triggers.length > 0 && round < 3;
    const pending: Extract<CompletionEvent, { type: "text" }>[] = [];
    let calls: ToolCall[] = [];
    let usage: TokenUsage | undefined;
    try {
      for await (const event of completeChat(config, history, signal, tools, tools && !reading ? "none" : undefined)) {
        if (event.type === "tool-calls") calls = event.calls;
        else if (event.type === "usage") usage = event.usage;
        else if (reading) pending.push(event);
        else yield event;
      }
    } catch (error) {
      if (!tools || !(error instanceof ProviderError) || error.status !== 400)
        throw error;
      await clues!.markToolsUnsupported();
      useTools = false;
      history = apiRequestMessages(messages, localTime, withVoice(await select()), protocol, pinned);
      continue;
    }
    if (usage) {
      total = {
        totalTokens: (total?.totalTokens ?? 0) + usage.totalTokens,
        uncachedTotalTokens:
          (total?.uncachedTotalTokens ?? 0) + usage.uncachedTotalTokens,
      };
      yield { type: "usage", usage: total };
    }
    if (!calls.length) {
      yield* pending;
      return;
    }
    history.push({ role: "assistant", content: "", tool_calls: calls });
    for (const call of calls) {
      history.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(readCards(cards, call)),
      });
    }
    round++;
  }
}
