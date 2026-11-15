import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "./config.js";

export type Clue = {
  id: string;
  title: string;
  content: string;
  mode: "pinned" | "trigger";
  keywords: string[];
  scenes: "voice"[];
  order: number;
  createdAt: string;
  updatedAt: string;
};

const file = path.join(dataDirectory, "clues.json");

export async function readClues(): Promise<Clue[]> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function writeClues(clues: Clue[]) {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(file, JSON.stringify(clues, null, 2), "utf8");
}

export function parseClue(value: Clue): Clue {
  if (
    !value ||
    ![
      value.id,
      value.title,
      value.content,
      value.createdAt,
      value.updatedAt,
    ].every((text) => typeof text === "string" && text.trim()) ||
    !["pinned", "trigger"].includes(value.mode) ||
    !Number.isFinite(value.order) ||
    !Array.isArray(value.keywords) ||
    !value.keywords.every((word) => typeof word === "string") ||
    !Array.isArray(value.scenes) ||
    !value.scenes.every((scene) => scene === "voice")
  )
    throw new Error("線索卡片格式不正確，請填寫標題和內容。");
  return {
    id: value.id,
    title: value.title,
    content: value.content,
    mode: value.mode,
    keywords:
      value.mode === "trigger"
        ? value.keywords.map((word) => word.trim()).filter(Boolean)
        : [],
    scenes: value.mode === "trigger" ? value.scenes : [],
    order: value.order,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function getActiveScenes(): Clue["scenes"] {
  return [];
}

export function cluePrompt(
  clues: Clue[],
  latestUserMessage: string,
  scenes = getActiveScenes(),
): string {
  const message = latestUserMessage.toLowerCase();
  return clues
    .filter(
      (clue) =>
        clue.mode === "pinned" ||
        clue.keywords.some(
          (word) => word.trim() && message.includes(word.toLowerCase()),
        ) ||
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
