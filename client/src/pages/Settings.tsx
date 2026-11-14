import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import { notify } from "../components/Notify";
import { removeSettingsMedia } from "../mediaStorage";
import { useSettingsPaperStack } from "../components/useSettingsPaperStack";
import SettingsLayout from "./SettingsLayout";
import FontPage from "./SettingsFont";
import VoicePage from "./SettingsVoice";

export default function Settings({ onBack }: { onBack: () => void }) {
  const root = useRef<HTMLElement>(null);
  const storage = useRef<HTMLDivElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [fontPages, setFontPages] = useState([1]);
  const [voicePages, setVoicePages] = useState([1]);
  const nextFont = useRef(2);
  const nextVoice = useRef(2);
  const font = useSettingsPaperStack(fontPages.length, active === 1);
  const voice = useSettingsPaperStack(voicePages.length, active === 3);
  const [exporting, setExporting] = useState(false);
  const close = () => {
    storage.current!.classList.remove("lit");
    setActive(null);
    navigator.vibrate?.(10);
  };
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem("launcher_settings") || "null");
    if (saved?.cssVars)
      for (const [key, value] of Object.entries(saved.cssVars))
        root.current!.style.setProperty(key, String(value));
  }, []);
  useLayoutEffect(() => {
    const align = () => {
      const sub = storage.current!.querySelector<HTMLElement>(".st-sub")!;
      if (sub.offsetWidth)
        storage.current!.querySelector<HTMLElement>(".st-actions")!.style.width =
          sub.offsetWidth - 6 + "px";
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
  return (
    <SettingsLayout
      rootRef={root}
      active={active}
      onBack={onBack}
      onClose={close}
      onFolder={(id) => {
        setActive((current) => (current === id ? null : id));
        navigator.vibrate?.(10);
      }}
      storageRef={storage}
      importRef={importInput}
      onExport={() => void exportData()}
      exporting={exporting}
      onImport={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file)
          void api
            .importData(file)
            .then(() => notify.ok("已導入"))
            .catch((error) => notify.fail("導入失敗", error));
      }}
      fontPages={
        <div className="settings-stack-viewport">
          <div className="settings-stack-track" ref={font.track}>
            {fontPages.map((id, index) => (
              <FontPage
                key={id}
                id={id}
                index={index}
                total={fontPages.length}
                active={active === 1 && index === font.index}
                onAdd={() => {
                  font.showAdded();
                  setFontPages((pages) => [...pages, nextFont.current++]);
                }}
                onDelete={() => {
                  if (fontPages.length <= 1) return;
                  void removeSettingsMedia(`api_${id}`).catch((error) =>
                    notify.fail("保存失敗", error),
                  );
                  font.remove(() => setFontPages((pages) => pages.filter((page) => page !== id)));
                }}
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
                  voice.remove(() => setVoicePages((pages) => pages.filter((page) => page !== id)));
                }}
              />
            ))}
          </div>
        </div>
      }
    />
  );
}
