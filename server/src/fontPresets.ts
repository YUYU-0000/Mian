import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "./config.js";

export const DEFAULT_FONT_ID = "1";
export const DEFAULT_BUBBLE_SIZE = 14.5;
export type FontPreset = {
  id: string;
  name: string;
  face: string;
  view: string;
  size: number;
};
export type FontSettings = {
  presets: FontPreset[];
  activeId: string;
  style: { face: string; size: number };
};
export const defaultFont: FontPreset = {
  id: DEFAULT_FONT_ID,
  name: "預設",
  face: "",
  view: "Still water.",
  size: DEFAULT_BUBBLE_SIZE,
};
export const defaultFontSettings = (): FontSettings => ({
  presets: [{ ...defaultFont }],
  activeId: DEFAULT_FONT_ID,
  style: { face: "", size: DEFAULT_BUBBLE_SIZE },
});
const file = path.join(dataDirectory, "font-presets.json");

export async function readFontSettings(): Promise<FontSettings> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return defaultFontSettings();
    throw error;
  }
}

export function fontPreset(input: FontPreset): FontPreset {
  if (
    !input ||
    typeof input.id !== "string" ||
    !input.id ||
    typeof input.name !== "string" ||
    typeof input.face !== "string" ||
    typeof input.view !== "string" ||
    !validFontSize(input.size)
  )
    throw new Error("字體紙片格式不正確。");
  return input.id === DEFAULT_FONT_ID
    ? { ...defaultFont, view: input.view }
    : {
        id: input.id,
        name: input.name,
        face: input.face,
        view: input.view,
        size: input.size,
      };
}

export function validFontSize(size: number) {
  return (
    Number.isInteger(size - DEFAULT_BUBBLE_SIZE) &&
    size >= DEFAULT_BUBBLE_SIZE - 3 &&
    size <= DEFAULT_BUBBLE_SIZE + 3
  );
}

export function fontSettings(input: FontSettings): FontSettings {
  if (
    !input ||
    !Array.isArray(input.presets) ||
    !input.style ||
    typeof input.style.face !== "string" ||
    !validFontSize(input.style.size)
  )
    throw new Error("字體設置格式不正確。");
  const presets = input.presets.map(fontPreset);
  if (
    presets[0]?.id !== DEFAULT_FONT_ID ||
    new Set(presets.map((preset) => preset.id)).size !== presets.length ||
    !presets.some((preset) => preset.id === input.activeId)
  )
    throw new Error("字體設置缺少預設或目前使用的紙片。");
  return {
    presets,
    activeId: input.activeId,
    style:
      input.activeId === DEFAULT_FONT_ID
        ? { face: "", size: DEFAULT_BUBBLE_SIZE }
        : { face: input.style.face, size: input.style.size },
  };
}

export async function writeFontSettings(settings: FontSettings) {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(file, JSON.stringify(settings, null, 2), "utf8");
  return settings;
}

export async function saveFontPreset(input: FontPreset, use = false) {
  const preset = fontPreset(input);
  if (use && preset.id !== DEFAULT_FONT_ID && !preset.face.trim())
    throw new Error("請貼上完整的 @font-face 代碼。");
  const settings = await readFontSettings();
  const index = settings.presets.findIndex((item) => item.id === preset.id);
  if (index < 0) settings.presets.push(preset);
  else settings.presets[index] = preset;
  // 编辑纸片不影响已应用的快照，SAVE STYLE 才切换气泡。
  if (use) {
    settings.activeId = preset.id;
    settings.style = { face: preset.face, size: preset.size };
  }
  return writeFontSettings(settings);
}

export async function deleteFontPreset(id: string) {
  if (id === DEFAULT_FONT_ID) throw new Error("預設字體不能刪除。");
  const settings = await readFontSettings();
  settings.presets = settings.presets.filter((preset) => preset.id !== id);
  if (settings.activeId === id) {
    settings.activeId = DEFAULT_FONT_ID;
    settings.style = { face: "", size: DEFAULT_BUBBLE_SIZE };
  }
  return writeFontSettings(settings);
}
