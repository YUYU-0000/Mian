import type { ApiPreset } from "./connectionTypes";
import { createId } from "./id";

export type Draft = ApiPreset & { paperKey: string; plus?: boolean };
type StoredDraft = Pick<
  Draft,
  "id" | "paperKey" | "plus" | "note" | "endpoint" | "model"
>;
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const API_DRAFTS_KEY = "mian.api-drafts.v1";
export const API_PAPER_KEY = "mian.api-paper.v1";

export const blankDraft = (): Draft => ({
  id: "",
  note: "",
  endpoint: "",
  key: "",
  model: "",
  format: "openai",
  paperKey: createId(),
  plus: true,
});

export function readApiDrafts(storage: DraftStorage): StoredDraft[] {
  return JSON.parse(storage.getItem(API_DRAFTS_KEY) ?? "[]");
}

const paperId = (draft: Draft) =>
  draft.plus ? "plus" : draft.id || draft.paperKey;

export function rememberApiPaper(storage: DraftStorage, draft: Draft) {
  storage.setItem(API_PAPER_KEY, paperId(draft));
}

// 只挑出可暂存字段，Key 不进入 sessionStorage。
export function saveApiDraft(storage: DraftStorage, draft: Draft) {
  const { id, paperKey, plus, note, endpoint, model } = draft;
  const stored: StoredDraft = { id, paperKey, plus, note, endpoint, model };
  const drafts = readApiDrafts(storage);
  const index = drafts.findIndex((item) => item.paperKey === paperKey);
  if (index < 0) drafts.push(stored);
  else drafts[index] = stored;
  storage.setItem(API_DRAFTS_KEY, JSON.stringify(drafts));
  rememberApiPaper(storage, draft);
}

export function removeApiDraft(storage: DraftStorage, draft: Draft) {
  const remaining = readApiDrafts(storage).filter(
    (item) => item.paperKey !== draft.paperKey,
  );
  if (remaining.length)
    storage.setItem(API_DRAFTS_KEY, JSON.stringify(remaining));
  else storage.removeItem(API_DRAFTS_KEY);
  if (storage.getItem(API_PAPER_KEY) === paperId(draft))
    storage.removeItem(API_PAPER_KEY);
}

// 合并后端纸片与本标签页的草稿，按纸片身份恢复位置。
export function restoreApiDrafts(
  storage: DraftStorage,
  saved: ApiPreset[],
  activeId: string | null,
) {
  const drafts = readApiDrafts(storage);
  const presets: Draft[] = saved.map((preset) => ({
    ...preset,
    paperKey: preset.id,
    ...drafts.find((draft) => draft.id === preset.id),
    key: "",
  }));
  presets.push(
    ...drafts
      .filter((draft) => !draft.id && !draft.plus)
      .map((draft) => ({
        ...draft,
        key: "",
        format: "openai" as const,
      })),
  );
  const plus: Draft = {
    ...blankDraft(),
    ...drafts.find((draft) => draft.plus),
    key: "",
  };
  const focused = storage.getItem(API_PAPER_KEY) ?? activeId;
  const focus = Math.max(
    0,
    [...presets, plus].findIndex((draft) => paperId(draft) === focused),
  );
  return { presets, plus, focus };
}
