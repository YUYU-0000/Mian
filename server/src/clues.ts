import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "./config.js";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  type Clue,
  type ClueWall,
} from "../../shared/clues.mjs";

export { removeClue } from "../../shared/clues.mjs";
export type { Clue, ClueWall } from "../../shared/clues.mjs";

const file = path.join(dataDirectory, "clues.json");
type LegacyClue = Partial<Clue> & { keywords?: string[] };
type StoredWall = Partial<Omit<ClueWall, "cards">> & {
  cards: LegacyClue[];
};

export function migrateClues(value: StoredWall | LegacyClue[] = []): ClueWall {
  const stored = Array.isArray(value) ? { cards: value } : value;
  const portrait = stored.portrait ?? {
    x: 146,
    y: 246,
    w: 104,
    h: 126,
    r: -1.5,
  };
  let bottom = Math.max(
    portrait.y + portrait.h,
    ...stored.cards.map((card) =>
      card.y === undefined ? 0 : card.y + (card.h ?? CARD_HEIGHT),
    ),
  );
  const cards = stored.cards.map((card, index) => {
    const { keywords, ...fields } = card;
    const rect = { x: 24, y: bottom + 24, w: CARD_WIDTH, h: CARD_HEIGHT, r: 0 };
    if (card.y === undefined) bottom = rect.y + rect.h;
    return {
      layout: index % 8,
      ...rect,
      ...fields,
      when:
        card.when ?? (keywords?.length ? `提到 ${keywords.join("、")} 時` : ""),
      scenes: card.scenes ?? [],
    } as Clue;
  });
  return {
    cards,
    portrait,
    pins: stored.pins ?? [],
    threads: stored.threads ?? [],
  };
}

export async function readClues(): Promise<ClueWall> {
  try {
    return migrateClues(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return migrateClues();
    throw error;
  }
}

export async function writeClues(wall: ClueWall) {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(file, JSON.stringify(wall, null, 2), "utf8");
}

export function parseClue(value: Clue): Clue {
  if (
    !value ||
    ![
      value.id,
      value.title,
      value.content,
      value.when,
      value.createdAt,
      value.updatedAt,
    ].every((text) => typeof text === "string") ||
    !["pinned", "trigger"].includes(value.mode) ||
    ![value.x, value.y, value.w, value.h, value.r, value.order].every(
      Number.isFinite,
    ) ||
    !Number.isInteger(value.layout) ||
    value.layout < 0 ||
    value.layout > 7 ||
    !Array.isArray(value.scenes) ||
    !value.scenes.every((scene) => scene === "voice")
  )
    throw new Error("線索卡片格式不正確。");
  const {
    id,
    title,
    content,
    mode,
    when,
    scenes,
    layout,
    x,
    y,
    w,
    h,
    r,
    order,
    createdAt,
    updatedAt,
  } = value;
  return {
    id,
    title,
    content,
    mode,
    when,
    scenes,
    layout,
    x,
    y,
    w,
    h,
    r,
    order,
    createdAt,
    updatedAt,
  };
}

