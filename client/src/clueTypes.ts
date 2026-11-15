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
