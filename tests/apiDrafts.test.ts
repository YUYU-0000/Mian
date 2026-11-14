import assert from "node:assert/strict";
import test from "node:test";
import {
  API_DRAFTS_KEY,
  API_PAPER_KEY,
  blankDraft,
  readApiDrafts,
  rememberApiPaper,
  removeApiDraft,
  restoreApiDrafts,
  saveApiDraft,
} from "../client/src/apiDrafts.ts";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const saved = {
  id: "saved",
  note: "已保存",
  endpoint: "https://provider.test",
  model: "old-model",
  hasKey: true,
  format: "openai" as const,
};

test("API drafts preserve unsaved fields but never serialize the key", () => {
  const storage = new MemoryStorage();
  const draft = {
    ...blankDraft(),
    note: "半张纸",
    endpoint: "https://relay.test/custom",
    model: "manual-model",
    key: "do-not-store",
  };
  saveApiDraft(storage, draft);
  assert.doesNotMatch(
    storage.getItem(API_DRAFTS_KEY)!,
    /do-not-store|"key"|hasKey/,
  );
  const restored = restoreApiDrafts(storage, [saved], saved.id);
  assert.equal(restored.plus.note, draft.note);
  assert.equal(restored.plus.endpoint, draft.endpoint);
  assert.equal(restored.plus.model, draft.model);
  assert.equal(restored.plus.key, "");
  assert.equal(restored.focus, 1);
});

test("saved edits and multiple new papers restore with the same focused paper", () => {
  const storage = new MemoryStorage();
  saveApiDraft(storage, {
    ...saved,
    paperKey: saved.id,
    note: "未保存的修改",
    key: "replacement",
  });
  const first = { ...blankDraft(), plus: false, note: "新纸一" };
  const second = { ...blankDraft(), plus: false, note: "新纸二" };
  saveApiDraft(storage, first);
  saveApiDraft(storage, second);
  rememberApiPaper(storage, first);
  const restored = restoreApiDrafts(storage, [saved], saved.id);
  assert.deepEqual(
    restored.presets.map((paper) => paper.note),
    ["未保存的修改", "新纸一", "新纸二"],
  );
  assert.equal(restored.presets[0].hasKey, true);
  assert.equal(
    restored.presets.every((paper) => paper.key === ""),
    true,
  );
  assert.equal(restored.presets[restored.focus].paperKey, first.paperKey);
});

test("saving and deleting clear only their own draft and remove the final draft entry", () => {
  const storage = new MemoryStorage();
  const first = { ...blankDraft(), plus: false, note: "先保存" };
  const second = { ...blankDraft(), plus: false, note: "再删除" };
  saveApiDraft(storage, first);
  saveApiDraft(storage, second);
  removeApiDraft(storage, first);
  const persisted = { ...first, id: "new-id" };
  rememberApiPaper(storage, persisted);
  const restored = restoreApiDrafts(storage, [saved, persisted], saved.id);
  assert.equal(readApiDrafts(storage).length, 1);
  assert.equal(restored.presets[restored.focus].id, "new-id");
  rememberApiPaper(storage, second);
  removeApiDraft(storage, second);
  assert.equal(storage.getItem(API_DRAFTS_KEY), null);
  assert.equal(storage.getItem(API_PAPER_KEY), null);
});

test("an added plus paper stays one draft and deleted server presets are not resurrected", () => {
  const storage = new MemoryStorage();
  const plus = { ...blankDraft(), note: "正在填写" };
  saveApiDraft(storage, plus);
  saveApiDraft(storage, { ...plus, plus: false });
  saveApiDraft(storage, { ...saved, paperKey: saved.id, note: "后来被删除" });
  const restored = restoreApiDrafts(storage, [], null);
  assert.equal(restored.presets.length, 1);
  assert.equal(restored.presets[0].paperKey, plus.paperKey);
  assert.equal(restored.plus.note, "");
});
