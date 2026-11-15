import type { Clue } from "./clues.js";
import type { ChatMessage } from "./providers/openai.js";

export const CLUE_SELECTION_INSTRUCTION =
  "下面是一些卡片的标题和使用时机，根据最近的对话，挑出现在应该参考的卡片，只回 id，用逗号隔开，一张都不需要就回空";

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
        clue.scenes.some((scene) => scenes.includes(scene)),
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
    (clue) =>
      clue.mode === "trigger" &&
      !clue.scenes.some((scene) => scenes.includes(scene)),
  );
  let selected: string[] = [];
  if (candidates.length) {
    const system = `${CLUE_SELECTION_INSTRUCTION}\n\n${JSON.stringify(candidates.map(({ id, title, when }) => ({ id, title, when })))}`;
    const recent = messages
      .filter(
        (message) => message.role === "user" || message.role === "assistant",
      )
      .slice(-6)
      .map(({ role, content }) => ({ role, content }));
    try {
      selected = (await select(system, recent))
        .split(/[,，]/u)
        .map((id) => id.trim());
    } catch {
      // 挑选失败不阻断正式回复，场景命中仍然保留。
    }
  }
  return cluePrompt(clues, selected, scenes);
}
