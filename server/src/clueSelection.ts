import type { Clue } from "./clues.js";
import type { ChatMessage } from "./providers/openai.js";

export const CLUE_SELECTION_INSTRUCTION =
  "下面是一些卡片的标题和使用时机，根据最近的对话，挑出现在应该参考的卡片，只回 id，用逗号隔开，一张都不需要就回空";

export const CLUE_READING_INSTRUCTION =
  "這些是你可以翻閱的卡片。覺得對話用得上時，調用 read_clue 讀取內容，可以一次讀幾張，也可以讀完再讀。讀卡的過程用戶看不到，不要在回覆裡提到你讀了卡。";

function clueMetadata({ id, title, when }: Clue) {
  return { id, title, when };
}

function matchesScene(clue: Clue, scenes: Clue["scenes"]) {
  return clue.scenes.some((scene) => scenes.includes(scene));
}

export function clueDirectory(clues: Clue[], withTools = false) {
  const cards = clues
    .filter((clue) => clue.mode === "trigger")
    .sort((a, b) => a.order - b.order)
    .map((clue) =>
      withTools ? clueMetadata(clue) : { title: clue.title, when: clue.when },
    );
  if (!cards.length) return "";
  return [
    withTools ? CLUE_READING_INSTRUCTION : "",
    "線索目錄",
    JSON.stringify(cards),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type ClueSelector = (
  system: string,
  messages: ChatMessage[],
) => Promise<string>;

export function getActiveScenes(): Clue["scenes"] {
  return [];
}

export function cluePrompt(
  clues: Clue[],
  selectedIds: string[],
  scenes = getActiveScenes(),
) {
  return clues
    .filter(
      (clue) =>
        clue.mode === "pinned" ||
        selectedIds.includes(clue.id) ||
        matchesScene(clue, scenes),
    )
    .sort(
      (a, b) =>
        Number(a.mode === "trigger") - Number(b.mode === "trigger") ||
        a.order - b.order,
    )
    .map((clue) => `【${clue.title}】\n${clue.content}`)
    .join("\n\n");
}

export async function selectCluePrompt(
  clues: Clue[],
  messages: ChatMessage[],
  select: ClueSelector,
  scenes = getActiveScenes(),
) {
  const candidates = clues.filter(
    (clue) => clue.mode === "trigger" && !matchesScene(clue, scenes),
  );
  let selected: string[] = [];
  if (candidates.length) {
    const system = `${CLUE_SELECTION_INSTRUCTION}\n\n${JSON.stringify(candidates.map(clueMetadata))}`;
    const recent = messages
      .filter(
        (message) => message.role === "user" || message.role === "assistant",
      )
      .slice(-12)
      .map(({ role, content }) => ({ role, content }));
    try {
      selected = (await select(system, recent))
        .split(/[,，]/u)
        .map((id) => id.trim());
    } catch {
      // 挑选失败不阻断正式回复，场景命中仍然保留。
    }
  }
  return [cluePrompt(clues, selected, scenes), clueDirectory(clues)]
    .filter(Boolean)
    .join("\n\n");
}
