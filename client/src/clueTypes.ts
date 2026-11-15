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
