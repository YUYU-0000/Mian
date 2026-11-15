import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "./config.js";

export type WallRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
};
export type Clue = WallRect & {
  id: string;
  title: string;
  content: string;
  mode: "pinned" | "trigger";
  when: string;
  scenes: "voice"[];
  layout: number;
  order: number;
  createdAt: string;
  updatedAt: string;
};
export type CluePin = {
  id: string;
  cardId: string | null;
  x: number;
  y: number;
};
export type ClueThread = { from: string; to: string };
export type ClueWall = {
  cards: Clue[];
  pins: CluePin[];
  threads: ClueThread[];
  portrait: WallRect;
};

const file = path.join(dataDirectory, "clues.json");
type LegacyClue = Partial<Clue> & { keywords?: string[] };
type StoredWall = {
  cards: LegacyClue[];
  pins?: CluePin[];
  threads?: ClueThread[];
  portrait?: WallRect;
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
      card.y === undefined ? 0 : card.y + (card.h ?? 88),
    ),
  );
  const cards = stored.cards.map((card, index) => {
    const { keywords, ...fields } = card;
    const rect = { x: 24, y: bottom + 24, w: 84, h: 88, r: 0 };
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

export function removeClue(wall: ClueWall, id: string): ClueWall {
  const pins = wall.pins.filter((pin) => pin.cardId !== id);
  const ids = new Set(pins.map((pin) => pin.id));
  return {
    ...wall,
    cards: wall.cards.filter((card) => card.id !== id),
    pins,
    threads: wall.threads.filter(
      (thread) => ids.has(thread.from) && ids.has(thread.to),
    ),
  };
}
