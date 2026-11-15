import type { Clue } from "./clues.js";
import type { ChatMessage } from "./providers/openai.js";

export const CLUE_SELECTION_INSTRUCTION =
  "下面是一些卡片的标题和使用时机，根据最近的对话，挑出现在应该参考的卡片，只回 id，用逗号隔开，一张都不需要就回空";

const CLUE_READING_INSTRUCTION =
  "這些是你可以翻閱的卡片。覺得對話用得上時，調用 read_clue 讀取內容，可以一次讀幾張，也可以讀完再讀。讀卡的過程用戶看不到，不要在回覆裡提到你讀了卡。";

function clueMetadata({ id, title, when }: Clue) {
  return { id, title, when };
}

function matchesScene(clue: Clue, scenes: Clue["scenes"]) {
  return clue.scenes.some((scene) => scenes.includes(scene));
}

const compareClueIds = (a: Clue, b: Clue) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const compareClues = (a: Clue, b: Clue) => a.order - b.order || compareClueIds(a, b);
const formatClue = (clue: Clue) => `【${clue.title}】\n${clue.content}`;

export function pinnedCluePrompt(clues: Clue[]) {
  return clues.filter(clue => clue.mode === "pinned").sort(compareClueIds).map(formatClue).join("\n\n");
}

export function clueDirectory(clues: Clue[], withTools = false) {
  const cards = clues
    .filter((clue) => clue.mode === "trigger")
    .sort(compareClues)
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

type ClueSelector = (
  system: string,
  messages: ChatMessage[],
) => Promise<string>;

export function getActiveScenes(generating?: "voice"): Clue["scenes"] {
  return generating === "voice" ? ["voice"] : [];
}

// 模型可以在同一轮里自行选择语音，先给出台词专用条件段，不能等 TTS 时才读卡。
export function voiceCluePrompt(clues: Clue[]) {
  const scenes = getActiveScenes("voice");
  const prompt = cluePrompt(clues.filter(clue => clue.mode === "trigger" && matchesScene(clue, scenes)), [], scenes);
  return prompt ? `生成語音條時的線索：以下內容僅在撰寫 <voice> 台詞時使用，普通文字回覆不啟用。\n${prompt}` : "";
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
        compareClues(a, b),
    )
    .map(formatClue)
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
  ).sort(compareClues);
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
