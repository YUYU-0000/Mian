import { createRoot } from "react-dom/client";
import Settings from "../client/src/pages/Settings";
import Notify from "../client/src/components/Notify";
import { api } from "../client/src/api";
import {
  defaultFontSettings,
  defaultFont,
  DEFAULT_FONT_ID,
} from "../client/src/settingsTypes";

const fixture = window as any;
fixture.styleActions = [];
let fonts = defaultFontSettings();
api.fontPresets = async () => structuredClone(fonts);
api.saveFontPreset = async (input, use) => {
  const preset =
    input.id === DEFAULT_FONT_ID ? { ...defaultFont, view: input.view } : input;
  const index = fonts.presets.findIndex((item) => item.id === input.id);
  if (index < 0) fonts.presets.push(preset);
  else fonts.presets[index] = preset;
  if (use) {
    fixture.styleActions.push("save");
    fonts = {
      ...fonts,
      activeId: preset.id,
      style: { face: preset.face, size: preset.size },
    };
  }
  return structuredClone(fonts);
};
api.deleteFontPreset = async (id) => {
  fonts.presets = fonts.presets.filter((item) => item.id !== id);
  return structuredClone(fonts);
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
