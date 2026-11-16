// 为线索与媒体交互测试挂载隔离的页面和内存数据。
import { createRoot } from "react-dom/client";
import { api } from "../client/src/api";
import type { ClueWall } from "../client/src/clueTypes";
import Clues from "../client/src/pages/Clues";
import Home from "../client/src/pages/Home";
import Media from "../client/src/components/Media";
import { removeSettingsMedia } from "../client/src/mediaStorage";
import Notify, { notify } from "../client/src/components/Notify";
import "../client/src/theme.css";
import "../client/src/components/scroll-text.css";
import "../client/src/pages/settings.css";

const fixture = window as any;
fixture.removeHomePhoto = () => removeSettingsMedia("home_photo_widget");
const root = createRoot(document.getElementById("root")!);
let mount = 0;
let wall: ClueWall = {
  cards: [{
    id: "saved-card", title: "已保存", content: "正文", mode: "pinned",
    when: "", scenes: [], layout: 0, order: 0,
    x: 24, y: 140, w: 84, h: 88, r: 0,
    createdAt: "2026-11-15", updatedAt: "2026-11-15",
  }],
  portrait: { x: 190, y: 280, w: 104, h: 126, r: -1.5 },
  pins: [], threads: [],
};
Object.assign(api.clues, {
  getSnapshot: () => structuredClone(wall),
  watch: (receive: (value: ClueWall) => void) => { receive(structuredClone(wall)); return () => { }; },
});
api.saveClueWall = async (next) => {
  wall = structuredClone(next);
  return structuredClone(wall);
};
fixture.readClueWall = () => wall;
fixture.showNotice = (kind: "ok" | "fail" = "fail") =>
  kind === "ok" ? notify.ok("已保存") : notify.fail("測試通知", "可向上滑動收起");
fixture.renderClues = () => root.render(
  <>
    <Clues key={++mount} onBack={() => { }} />
    <Notify page="/clues" />
  </>,
);
fixture.renderHome = () => root.render(
  <>
    <Home status={{ state: "ready", message: "ready" }} channelName="TEST"
      onChat={() => { }} onConnections={() => { }} onSettings={() => { }} onClues={() => { }} />
    <div className="settings-page" style={{ position: "absolute", left: 500, top: 0 }}>
      <div className="api-polaroid-container">
        <div className="polaroid-img-placeholder">
          <Media storageKey="fixture_effect" />
        </div>
      </div>
    </div>
  </>,
);
fixture.renderClues();
