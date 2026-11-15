import { useEffect, useState } from "react";
import { api } from "../api";
import type { Clue } from "../clueTypes";
import { createId } from "../id";
import { notify } from "../components/Notify";
import ScrollText, { ScrollInput } from "../components/ScrollText";
import "./clues.css";

export default function Clues({ onBack }: { onBack: () => void }) {
  const [clues, setClues] = useState<Clue[]>([]);
  const [draft, setDraft] = useState<Clue | null>(null);
  const [keywords, setKeywords] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void api
      .clues()
      .then(setClues)
      .catch((error) => notify.fail("線索讀取失敗", error))
      .finally(() => setLoading(false));
  }, []);

  const edit = (clue: Clue) => {
    setDraft(clue);
    setKeywords(clue.keywords.join(", "));
  };
  const add = () => {
    const now = new Date().toISOString();
    edit({
      id: createId(),
      title: "",
      content: "",
      mode: "pinned",
      keywords: [],
      scenes: [],
      order: Math.max(-1, ...clues.map((clue) => clue.order)) + 1,
      createdAt: now,
      updatedAt: now,
    });
  };
  const existing = draft && clues.some((clue) => clue.id === draft.id);
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const card = {
        ...draft,
        keywords:
          draft.mode === "trigger"
            ? keywords.split(/[,，\s]+/u).filter(Boolean)
            : [],
        scenes: draft.mode === "trigger" ? draft.scenes : [],
      };
      const saved = await (existing
        ? api.updateClue(card)
        : api.createClue(card));
      setClues((current) =>
        existing
          ? current.map((clue) => (clue.id === saved.id ? saved : clue))
          : [...current, saved],
      );
      setDraft(null);
      notify.ok("線索已保存");
    } catch (error) {
      notify.fail("線索保存失敗", error);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await api.deleteClue(draft.id);
      setClues((current) => current.filter((clue) => clue.id !== draft.id));
      setDraft(null);
      notify.ok("線索已刪除");
    } catch (error) {
      notify.fail("線索刪除失敗", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="clues-page">
      <header className="clues-header">
        <button
          className="clues-back"
          disabled={saving}
          onClick={() => (draft ? setDraft(null) : onBack())}
        >
          返回
        </button>
        <h1>{draft ? "編輯線索" : "線索"}</h1>
        {!draft && (
          <button disabled={loading} onClick={add}>
            新增
          </button>
        )}
      </header>
      {draft ? (
        <form
          className="clues-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={saving}>
            <label>
              標題
              <ScrollInput
                name="title"
                required
                value={draft.title}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
              />
            </label>
            <label>
              內容
              <textarea
                name="content"
                required
                rows={9}
                value={draft.content}
                onChange={(event) =>
                  setDraft({ ...draft, content: event.target.value })
                }
              />
            </label>
            <label>
              模式
              <select
                name="mode"
                value={draft.mode}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    mode: event.target.value as Clue["mode"],
                  })
                }
              >
                <option value="pinned">常駐</option>
                <option value="trigger">觸發</option>
              </select>
            </label>
            {draft.mode === "trigger" && (
              <>
                <label>
                  關鍵詞
                  <ScrollInput
                    name="keywords"
                    value={keywords}
                    placeholder="用逗號或空格分隔"
                    onChange={(event) => setKeywords(event.target.value)}
                  />
                </label>
                <label className="clues-scene">
                  <input
                    name="voice"
                    type="checkbox"
                    checked={draft.scenes.includes("voice")}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        scenes: event.target.checked ? ["voice"] : [],
                      })
                    }
                  />
                  語音
                </label>
              </>
            )}
          </fieldset>
          <footer className="clues-actions">
            <button
              type="button"
              disabled={saving || !existing}
              onClick={() => void remove()}
            >
              刪除
            </button>
            <button type="submit" disabled={saving}>
              {saving ? "保存中" : "保存"}
            </button>
          </footer>
        </form>
      ) : (
        <div className="clues-list">
          {loading ? (
            <p>讀取中</p>
          ) : (
            (["pinned", "trigger"] as const).map((mode) => {
              const group = clues
                .filter((clue) => clue.mode === mode)
                .sort((a, b) => a.order - b.order);
              return (
                <section key={mode} data-mode={mode}>
                  <h2>{mode === "pinned" ? "常駐" : "觸發"}</h2>
                  {group.length ? (
                    group.map((clue) => (
                      <button
                        className="clues-card"
                        key={clue.id}
                        onClick={() => edit(clue)}
                      >
                        <ScrollText>{clue.title}</ScrollText>
                        <ScrollText className="clues-preview">
                          {clue.content}
                        </ScrollText>
                      </button>
                    ))
                  ) : (
                    <p>暫無線索</p>
                  )}
                </section>
              );
            })
          )}
        </div>
      )}
    </main>
  );
}
