import { createRoot } from "react-dom/client";
import Settings from "../client/src/pages/Settings";
import Notify from "../client/src/components/Notify";
import { api } from "../client/src/api";

const fixture = window as any;
fixture.styleActions = [];
api.saveFontStyle = async () => {
  fixture.styleActions.push("save");
};
api.testFontStyle = async () => {
  fixture.styleActions.push("test");
};
api.testVoice = () =>
  new Promise<void>((resolve) => {
    fixture.finishVoice = resolve;
  });

createRoot(document.getElementById("root")!).render(
  <>
    <Settings onBack={() => {}} />
    <Notify page="/settings" />
  </>,
);
