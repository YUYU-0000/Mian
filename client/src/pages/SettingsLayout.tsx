import type { RefObject, ReactNode, ChangeEventHandler, CSSProperties } from "react";
import Media from "../components/Media";
import { storageHeart, wallpaperFlower } from "./SettingsArt";
type Props = {
  rootRef: RefObject<HTMLElement | null>;
  active: number | null;
  onBack: () => void;
  onFolder: (id: number) => void;
  onClose: () => void;
  fontPages: ReactNode;
  voicePages: ReactNode;
  storageRef: RefObject<HTMLDivElement | null>;
  importRef: RefObject<HTMLInputElement | null>;
  onExport: () => void;
  exporting: boolean;
  onImport: ChangeEventHandler<HTMLInputElement>;
};
export default function SettingsLayout({
  rootRef,
  active,
  onBack,
  onFolder,
  onClose,
  fontPages,
  voicePages,
  storageRef,
  importRef,
  onExport,
  exporting,
  onImport,
}: Props) {
  return (
    <main
      className="settings-page"
      ref={rootRef}
      onClick={(event) => {
        const flora = (event.target as Element).closest(".clickable-flora");
        if (flora) {
          event.stopPropagation();
          flora.classList.remove("wobble");
          requestAnimationFrame(() =>
            requestAnimationFrame(() => flora.classList.add("wobble")),
          );
          navigator.vibrate?.(5);
        }
      }}
      onAnimationEnd={(event) => {
        (event.target as Element).closest(".clickable-flora")?.classList.remove("wobble");
      }}
    >
      <div className="settings-header">
        <div
          className="back-btn"
          id="headerBackBtn"
          onClick={onBack}
          role="button"
          tabIndex={0}
          aria-label="返回主界面"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M10 4L2 12L10 20"
              stroke="var(--icon-bg-4)"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="9" cy="12" r="1.4" fill="var(--icon-bg-4)" />
            <path
              d="M18 8.5L13.5 12L18 15.5"
              stroke="var(--icon-bg-4)"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="right-decor">
          <div className="archive-en">ARCHIVES</div>
          <div className="decor-line"></div>
          <div className="archive-cn">檔案館</div>
        </div>
      </div>

      <div className="folders-container">
        <div
          className={`folder f1${active === 1 ? " active" : ""}`}
          id="folderApiSettings"
          onClick={() => onFolder(1)}
        >
          <div className="tab-wrapper">
            <div className="tab-bg"></div>
            <div className="tab-text">字體設置</div>
          </div>
          <div className="folder-body"></div>
        </div>
        <div
          className={`folder f2${active === 2 ? " active" : ""}`}
          id="folderWallpaperSettings"
          onClick={() => onFolder(2)}
        >
          <div className="tab-wrapper">
            <div className="tab-bg"></div>
            <div className="tab-text">壁紙設置</div>
          </div>
          <div className="folder-body"></div>
        </div>
        <div
          className={`folder f3${active === 3 ? " active" : ""}`}
          id="folderVoiceSettings"
          onClick={() => onFolder(3)}
        >
          <div className="tab-wrapper">
            <div className="tab-bg"></div>
            <div className="tab-text">語音設置</div>
          </div>
          <div className="folder-body"></div>
        </div>
        <div
          className={`folder f4${active === 4 ? " active" : ""}`}
          id="folderStorageSettings"
          onClick={() => onFolder(4)}
        >
          <div className="tab-wrapper">
            <div className="tab-bg"></div>
            <div className="tab-text">存儲設置</div>
          </div>
          <div className="folder-body">
            <div className="front-deco">
              <div className="front-hand">ARCHIVE</div>
              <div className="front-sub">SYSTEM PREFERENCES</div>
            </div>
          </div>
        </div>
      </div>

      <div
        id="paperOverlay"
        className={`paper-overlay${active ? " active" : ""}`}
        onClick={onClose}
      >
        <div className={`paper-stack-container${active === 1 || active === 3 ? " has-paper-stack" : ""}`} onClick={(e) => e.stopPropagation()}>
          <div className="paper-layer-bot"></div>
          <div className="paper-layer-mid"></div>
          <div className="paper-main">
            <div className="paper-holes">
              <div className="hole"></div>
              <div className="hole"></div>
              <div className="hole"></div>
              <div className="hole"></div>
            </div>

            <div
              id="apiWrapper"
              style={{ display: active === 1 ? "block" : "none" }}
              className="api-wrapper"
            >
              {fontPages}
            </div>

            <div
              id="voiceWrapper"
              style={{ display: active === 3 ? "block" : "none" }}
              className="voice-wrapper"
            >
              {voicePages}
            </div>

            <div
              id="storageWrapper"
              style={{ display: active === 4 ? "block" : "none" }}
              className="storage-wrapper"
              ref={storageRef}
            >
              <div className="st-layout">
                <div className="st-head">
                  <div className="st-title">KEPT</div>
                  <div className="st-sub">Two halves&nbsp;&nbsp;one archive</div>
                </div>
                <div className="st-hearts">{storageHeart}</div>
                <div className="st-actions">
                  <button
                    className={`st-btn${exporting ? " busy" : ""}`}
                    id="stExportBtn"
                    onClick={onExport}
                  >
                    EXPORT
                  </button>
                  <button
                    className="st-btn"
                    id="stImportBtn"
                    onClick={() => importRef.current!.click()}
                  >
                    IMPORT
                  </button>
                  <input
                    type="file"
                    id="stImportInput"
                    ref={importRef}
                    onChange={onImport}
                    accept=".json,application/json"
                    style={{ display: "none" } as CSSProperties}
                  />
                </div>
              </div>
            </div>

            <div
              id="wallpaperWrapper"
              style={{ display: active === 2 ? "block" : "none" }}
              className="wallpaper-wrapper"
            >
              <div className="wp-layout">
                <div className="wp-backing-wrapper">
                  <div className="wp-backing"></div>
                </div>
                <div className="wp-photo-container">
                  <div className="wp-tape"></div>
                  <div className="polaroid">
                    <div className="polaroid-img-placeholder" id="mediaContainer_wp">
                      <Media storageKey="wp" active={active === 2} />
                    </div>
                  </div>
                </div>
                <div className="wp-typography">
                  <div className="wp-typo-title">壁紙選集</div>
                  <div className="wp-typo-divider"></div>
                  <div className="wp-typo-subtitle">
                    Collected & Preserved
                    <br />
                    For Our Little Corner
                  </div>
                </div>
                <div className="wp-typo-vertical">
                  <span>COLLECTION</span>
                  <span>DETAIL</span>
                </div>
                <div className="wp-flower-container">
                  <div className="wp-flower-tape"></div>
                  {wallpaperFlower}
                </div>
                <div className="wp-note-card">
                  <svg
                    className="wp-note-clip"
                    viewBox="0 0 24 60"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M 8,14 L 8,6 A 4,4 0 0,1 16,6 L 16,42 A 3,3 0 0,1 10,42 L 10,20"
                      stroke="#8ba5b8"
                      strokeWidth="1.5"
                      fill="none"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="wp-note-text">
                    Species: Crab &amp; Fish
                    <br />
                    Habitat: The Drain
                    <br />
                    Status: Together
                    <br />
                    Notes: Stay close,
                    <br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;stay warm.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
