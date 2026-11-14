import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import { notify } from "../components/Notify";
import { removeSettingsMedia } from "../mediaStorage";
import { useSettingsPaperStack } from "../components/useSettingsPaperStack";
import SettingsLayout from "./SettingsLayout";
import FontPage from "./SettingsFont";
import VoicePage from "./SettingsVoice";
import SettingsAvatar from "./SettingsAvatar";
import { createId } from "../id";
import { applyBubbleFont, parseFontFace } from "../bubbleFont";
import {
  defaultFont,
  defaultFontSettings,
  type FontPreset,
} from "../settingsTypes";
import type { Backup } from "../settingsBackup";

export default function Settings({ onBack }: { onBack: () => void }) {
  const root = useRef<HTMLElement>(null);
  const storage = useRef<HTMLDivElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [fonts, setFonts] = useState(defaultFontSettings);
  const fontPages = fonts.presets;
  const [voicePages, setVoicePages] = useState([1]);
  const fontWrites = useRef<Promise<unknown>>(Promise.resolve());
  const nextVoice = useRef(2);
  const font = useSettingsPaperStack(fontPages.length, active === 1);
  const voice = useSettingsPaperStack(voicePages.length, active === 3);
  const avatars = useSettingsPaperStack(2, active === 2);
  const [exporting, setExporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<Backup | null>(null);
  const [importing, setImporting] = useState(false);
  const writeFont = <T,>(operation: () => Promise<T>) => {
    const result = fontWrites.current.then(operation, operation);
    fontWrites.current = result;
    return result;
  };
  const editFont = (preset: FontPreset) => {
    void writeFont(() => api.saveFontPreset(preset)).catch((error) =>
      notify.fail("保存失敗", error),
    );
  };
  const saveFont = async (preset: FontPreset) => {
    const saved = await writeFont(() => api.saveFontPreset(preset, true));
    applyBubbleFont(saved);
    setFonts(saved);
    return saved.presets.find((item) => item.id === preset.id)!;
  };
  const close = () => {
    storage.current!.classList.remove("lit");
    setActive(null);
    setPendingImport(null);
    navigator.vibrate?.(10);
  };
  useEffect(() => {
    void api
      .fontPresets()
      .then(setFonts)
      .catch((error) => notify.fail("字體讀取失敗", error));
    const saved = JSON.parse(
      localStorage.getItem("launcher_settings") || "null",
    );
    if (saved?.cssVars)
      for (const [key, value] of Object.entries(saved.cssVars))
        root.current!.style.setProperty(key, String(value));
  }, []);
  useLayoutEffect(() => {
    const align = () => {
      const sub = storage.current!.querySelector<HTMLElement>(".st-sub")!;
      if (sub.offsetWidth)
        storage.current!.querySelector<HTMLElement>(
          ".st-actions",
        )!.style.width = sub.offsetWidth - 6 + "px";
    };
    align();
    window.addEventListener("resize", align);
    return () => window.removeEventListener("resize", align);
  }, [active]);
  const exportData = async () => {
    storage.current!.classList.remove("lit");
    void storage.current!.offsetWidth;
    storage.current!.classList.add("lit");
    setExporting(true);
    try {
      await fontWrites.current;
      await Promise.all([
        api.exportData(),
        new Promise((resolve) => window.setTimeout(resolve, 3400)),
      ]);
      notify.ok("已導出");
    } catch (error) {
      storage.current!.classList.remove("lit");
      notify.fail("導出失敗", error);
    } finally {
      setExporting(false);
    }
  };
  const importData = async () => {
    if (!pendingImport) {
      importInput.current!.click();
      return;
    }
    setImporting(true);
    try {
      if (pendingImport.fonts.style.face)
        parseFontFace(pendingImport.fonts.style.face, "import");
      await fontWrites.current;
      await api.importData(pendingImport);
      sessionStorage.setItem("mian.imported", "1");
      window.location.reload();
    } catch (error) {
      setImporting(false);
      setPendingImport(null);
      notify.fail("導入失敗", error);
    }
  };
  return (
    <SettingsLayout
      rootRef={root}
      active={active}
      onBack={onBack}
      onClose={close}
      onFolder={(id) => {
        setPendingImport(null);
        setActive((current) => (current === id ? null : id));
        navigator.vibrate?.(10);
      }}
      storageRef={storage}
      importRef={importInput}
      onExport={() => void exportData()}
      exporting={exporting}
      confirmingImport={pendingImport !== null}
      importing={importing}
      onImportClick={() => void importData()}
      onImport={async (event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (!file) return;
        try {
          const backup: Backup = JSON.parse(await file.text());
          if (
            !backup ||
            backup.format !== "mian-backup" ||
            backup.version !== 1
          )
            throw new Error("請選擇 Mian 匯出的完整備份 JSON。");
          setPendingImport(backup);
          notify.note("再點覆蓋資料");
        } catch (error) {
          setPendingImport(null);
          notify.fail("導入失敗", error);
        }
      }}
      fontPages={
        <div className="settings-stack-viewport">
          <div className="settings-stack-track" ref={font.track}>
            {fontPages.map((preset, index) => (
              <FontPage
                key={preset.id}
                preset={preset}
                index={index}
                total={fontPages.length}
                active={active === 1 && index === font.index}
                inUse={fonts.activeId === preset.id}
                onChange={editFont}
                onSave={saveFont}
                onAdd={() => {
                  const added = { ...defaultFont, id: createId(), name: "" };
                  void writeFont(() => api.saveFontPreset(added))
                    .then((saved) => {
                      font.showAdded();
                      setFonts(saved);
                    })
                    .catch((error) => notify.fail("保存失敗", error));
                }}
                onDelete={() => {
                  void writeFont(async () => {
                    const saved = await api.deleteFontPreset(preset.id);
                    await removeSettingsMedia(`api_${preset.id}`);
                    applyBubbleFont(saved);
                    font.remove(() => setFonts(saved));
                  }).catch((error) => notify.fail("保存失敗", error));
                }}
              />
            ))}
          </div>
        </div>
      }
      avatarPages={
        <div className="settings-stack-viewport">
          <div className="settings-stack-track" ref={avatars.track}>
            {(["assistant", "user"] as const).map((role, index) => (
              <SettingsAvatar
                key={role}
                role={role}
                active={active === 2 && avatars.index === index}
              />
            ))}
          </div>
        </div>
      }
      voicePages={
        <div className="settings-stack-viewport">
          <div className="settings-stack-track" ref={voice.track}>
            {voicePages.map((id, index) => (
              <VoicePage
                key={id}
                index={index}
                total={voicePages.length}
                current={index === voice.index}
                onAdd={() => {
                  voice.showAdded();
                  setVoicePages((pages) => [...pages, nextVoice.current++]);
                }}
                onDelete={() => {
                  if (voicePages.length <= 1) return;
                  voice.remove(() =>
                    setVoicePages((pages) =>
                      pages.filter((page) => page !== id),
                    ),
                  );
                }}
              />
            ))}
          </div>
        </div>
      }
    />
  );
}
