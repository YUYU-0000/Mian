import { createRoot } from "react-dom/client";
import Settings from "../client/src/pages/Settings";
import Notify from "../client/src/components/Notify";
import { api } from "../client/src/api";
import { defaultVoicePreset, type VoiceSettings } from "../shared/voice.mjs";
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
let voices: VoiceSettings = { presets: [{ ...defaultVoicePreset }], activeId: defaultVoicePreset.id };
fixture.voiceSettings = voices;
api.voicePresets = async () => { throw new Error("fixture preset read failure"); };
api.voiceModels = async preset => {
  fixture.requestedVoicePreset = preset;
  return new Promise(resolve => { fixture.resolveVoiceModels = resolve; });
};
api.voiceList = async preset => {
  fixture.requestedVoicePreset = preset;
  return new Promise(resolve => { fixture.resolveVoiceList = resolve; });
};
api.saveVoicePreset = async input => {
  const { key, ...preset } = input;
  const index = voices.presets.findIndex(item => item.id === input.id);
  const saved = { ...preset, hasKey: Boolean(key) || voices.presets[index]?.hasKey };
  if (index < 0) voices.presets.push(saved);
  else voices.presets[index] = saved;
  return structuredClone(voices);
};
api.useVoicePreset = async id => {
  voices.activeId = id;
  return structuredClone(voices);
};
api.deleteVoicePreset = async id => {
  const index = voices.presets.findIndex(item => item.id === id);
  voices.presets = voices.presets.filter(item => item.id !== id);
  if (voices.activeId === id) voices.activeId = voices.presets[Math.max(0, index - 1)].id;
  return structuredClone(voices);
};
api.testVoice = (_preset, signal, onPlaying) =>
  new Promise<void>((resolve, reject) => {
    fixture.startVoice = onPlaying;
    fixture.finishVoice = resolve;
    fixture.failVoice = () => reject(new Error("ElevenLabs: test failure"));
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

createRoot(document.getElementById("root")!).render(
  <>
    <Settings onBack={() => {}} />
    <Notify page="/settings" />
  </>,
);
